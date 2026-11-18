// Shapes returned by the backend.
export interface Session {
  sessionId: string;
  fileName: string;
  chunks: number;
  fileCount?: number;
}
export interface ChatResult {
  answer: string;
  sources: string[];
}
export interface ChatHistoryMessage {
  role: "user" | "bot";
  text: string;
}

export const MAX_PDF_BYTES = 4 * 1024 * 1024; // Matches the server limit (4MB)

// Reads the JSON reply and turns any failure into a readable error.
async function parse<T>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Platform errors (like 413) may not be JSON.
  }
  if (!res.ok) {
    if (res.status === 413) throw new Error(data?.error || "PDFs exceed the 4MB total limit.");
    if (res.status === 504) throw new Error(data?.error || "Processing took too long. Try fewer or smaller PDFs.");
    throw new Error(data?.error || `Request failed (${res.status}). Please try again.`);
  }
  return data as T;
}

// Wraps fetch so network failures also give a clear message.
async function request<T>(url: string, init: RequestInit): Promise<T> {
  try {
    return await parse<T>(await fetch(url, init));
  } catch (e) {
    if (e instanceof TypeError) throw new Error("Could not reach the server. Check your connection.");
    throw e;
  }
}

// Sends one or more PDFs to the backend (relative /api path works locally and on Vercel).
export function uploadPdfs(files: File[]): Promise<Session> {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  return request<Session>("/api/upload", { method: "POST", body: form });
}

// Convenience wrapper for single PDF upload
export function uploadPdf(file: File): Promise<Session> {
  return uploadPdfs([file]);
}

// Asks a question about the uploaded PDF.
export function askQuestion(
  sessionId: string,
  question: string,
  history?: ChatHistoryMessage[]
): Promise<ChatResult> {
  return request<ChatResult>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, question, history }),
  });
}