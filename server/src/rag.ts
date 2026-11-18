import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import type { Document } from "@langchain/core/documents";
import { EMBEDDING_MODEL, TOP_K, requireEnv } from "./config";
import { AppError } from "./pdf";

export interface ChatHistoryItem {
  role: "user" | "bot";
  text: string;
}

// Tried in order: modern Gemini Flash models.
const CHAT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-flash-latest",
];

// Builds the Gemini embeddings client.
function getEmbeddings() {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: requireEnv("GEMINI_API_KEY"),
    model: EMBEDDING_MODEL,
  });
}

// Returns the Pinecone index handle.
function getIndex() {
  const pc = new Pinecone({ apiKey: requireEnv("PINECONE_API_KEY") });
  return pc.index(requireEnv("PINECONE_INDEX"));
}

// Embeds the chunks and stores them in this session's own namespace in safe batches.
export async function ingestChunks(sessionId: string, docs: Document[]) {
  const embeddings = getEmbeddings();
  const pineconeIndex = getIndex();
  const BATCH_SIZE = 40; // Avoids hitting Google Gemini API batch limits and large payload sizes

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await PineconeStore.fromDocuments(batch, embeddings, {
      pineconeIndex,
      namespace: sessionId,
    });
  }
}

// Calls Gemini's REST endpoint with system instructions and generous timeout.
async function generate(model: string, userPrompt: string, systemInstruction?: string): Promise<string> {
  console.log(`Calling Gemini ${model}...`);
  const payload: any = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.text();
  console.log(`Gemini ${model} -> ${res.status}`);
  if (!res.ok) {
    throw Object.assign(new Error(`${res.status} ${body.slice(0, 300)}`), { status: res.status });
  }

  const data = JSON.parse(body);
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty answer.");
  return text;
}

// Retrieves top chunks and answers user questions intelligently and conversationally.
export async function answerQuestion(
  sessionId: string,
  question: string,
  history: ChatHistoryItem[] = []
) {
  const trimmedQ = question.trim();
  const isGreeting = /^(hi|hello|hey|hola|namaste|greetings|who are you|kaise ho|kya haal hai|help)\b/i.test(trimmedQ);

  let matches: Document[] = [];
  try {
    const store = await PineconeStore.fromExistingIndex(getEmbeddings(), {
      pineconeIndex: getIndex(),
      namespace: sessionId,
    });

    // Smart query expansion: if user asked a short/follow-up question (e.g. "who made it?", "features?"),
    // combine with previous user query so vector search retrieves relevant chunks.
    let searchQuery = trimmedQ;
    if (!isGreeting && trimmedQ.split(/\s+/).length <= 4 && history.length > 0) {
      const prevUserMessage = [...history].reverse().find((m) => m.role === "user");
      if (prevUserMessage) {
        searchQuery = `${prevUserMessage.text} ${trimmedQ}`;
      }
    }

    matches = await store.similaritySearch(searchQuery, TOP_K);
    console.log(`Retrieved ${matches.length} chunks for query: "${searchQuery}"`);

    // If similarity search returned 0 matches and it's not a greeting, try a broader search
    if (matches.length === 0 && !isGreeting) {
      matches = await store.similaritySearch("summary overview introduction details", TOP_K);
      console.log(`Fallback retrieved ${matches.length} chunks`);
    }
  } catch (e: any) {
    console.error("Retrieval failed:", e?.message || e);
    throw new AppError(`Could not search your PDF: ${String(e?.message || e).slice(0, 300)}`, 502);
  }

  // Handle conversational greetings gracefully
  if (isGreeting && matches.length === 0) {
    return {
      answer: "Hello! I am DocuSense AI. I have analyzed your document and I am ready to answer any questions, explain concepts, or summarize sections for you. What would you like to know?",
      sources: [] as string[],
    };
  }

  if (matches.length === 0) {
    return {
      answer: "I couldn't find specific information regarding that in the uploaded document. Could you try rephrasing or asking about a specific section or topic from the document?",
      sources: [] as string[],
    };
  }

  const context = matches
    .map((d, i) => `[Chunk ${i + 1}${d.metadata?.source ? ` (${d.metadata.source})` : ""}]\n${d.pageContent}`)
    .join("\n\n");

  const formattedHistory =
    history.length > 0
      ? history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "User" : "DocuSense"}: ${m.text}`)
          .join("\n")
      : "";

  const systemInstruction =
    "You are DocuSense AI, an intelligent, helpful, and comprehensive document assistant.\n" +
    "Your objective is to answer the user's questions clearly, accurately, and thoroughly using the provided document context.\n\n" +
    "Instructions:\n" +
    "1. Base your answers on the provided document context. Extract relevant points, synthesize concepts, and provide structured, well-formatted answers (using markdown, bullet points, and headers where helpful).\n" +
    "2. Language: Always answer in the SAME language that the user asks in. If the user asks in Hindi or Hinglish, respond fluently in Hindi or Hinglish. If the user asks in English, respond in English.\n" +
    "3. Greetings: If the user greets you (e.g. 'hi', 'hello', 'namaste') or asks who you are, introduce yourself warmly as DocuSense AI and offer to help with their document.\n" +
    "4. Explanations: When asked to explain or simplify concepts from the document, provide clear, easy-to-understand explanations while staying faithful to the document's core content.\n" +
    "5. Related context: If the exact detail is not explicitly written in the context, do NOT bluntly say 'I couldn't find that'. Instead, explain what the document DOES state about related topics, provide the closest relevant details, and politely clarify what is not explicitly detailed in the document.\n" +
    "6. Context awareness: Take previous conversation turns into account for follow-up questions.";

  const userPrompt =
    (formattedHistory ? `Recent Conversation History:\n${formattedHistory}\n\n` : "") +
    `Document Context:\n${context}\n\n` +
    `User Question: ${trimmedQ}\n` +
    `Answer:`;

  // Fall through model list until one answers
  let lastError = "";
  for (const name of CHAT_MODELS) {
    try {
      const answer = await generate(name, userPrompt, systemInstruction);
      console.log(`Answered with ${name}`);
      return {
        answer,
        sources: matches.map(
          (d) => (d.metadata?.source ? `[${d.metadata.source}] ` : "") + d.pageContent.slice(0, 200)
        ),
      };
    } catch (e: any) {
      lastError = String(e?.message || e);
      console.error(`Model ${name} failed:`, lastError);
      if (e?.status === 401 || e?.status === 403) break; // Key error, other models will fail too
    }
  }
  throw new AppError(`Gemini could not answer: ${lastError.slice(0, 300)}`, 502);
}
