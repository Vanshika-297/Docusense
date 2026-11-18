import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { MAX_PDF_BYTES, MAX_CHUNKS } from "./config";
import { AppError, extractText, chunkText } from "./pdf";
import { ingestChunks, answerQuestion } from "./rag";

const router = Router();

// Keeps uploaded PDFs in memory (serverless has no persistent disk). Up to 5 files supported.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 5 } });

// Fails with a clear error if work runs past the serverless time budget.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError("This took too long to process. Try fewer or smaller PDFs.", 504)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Quick check that the API is up.
router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Upload: Support single or multiple PDFs -> text -> chunks -> embeddings -> Pinecone namespace.
router.post("/upload", (req: Request, res: Response, next: NextFunction) => {
  upload.any()(req, res, async (err: any) => {
    try {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") throw new AppError("Upload exceeds size limit (max 4MB total).", 413);
        if (err.code === "LIMIT_FILE_COUNT") throw new AppError("Too many files. Max 5 PDFs allowed simultaneously.", 400);
        throw new AppError(err.message || "Upload failed.");
      }

      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) throw new AppError("No files received. Please choose at least one PDF.");

      // Verify total file size across all documents
      const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
      if (totalBytes > MAX_PDF_BYTES) {
        throw new AppError("Total size of PDFs exceeds 4MB. Try smaller files.", 413);
      }

      let allDocs: any[] = [];
      const fileNames: string[] = [];

      for (const file of files) {
        if (file.mimetype !== "application/pdf" && !file.originalname.toLowerCase().endsWith(".pdf")) {
          throw new AppError(`"${file.originalname}" is not a valid PDF file.`);
        }
        const text = await extractText(file.buffer);
        const docs = await chunkText(text, file.originalname);
        allDocs = allDocs.concat(docs);
        fileNames.push(file.originalname);
      }

      if (allDocs.length === 0) {
        throw new AppError("No readable text found in the provided PDF(s).");
      }

      // If chunks exceed MAX_CHUNKS, evenly sample them so embedding completes quickly and within serverless timeouts
      let docsToIngest = allDocs;
      if (allDocs.length > MAX_CHUNKS) {
        console.log(`Document produced ${allDocs.length} chunks. Sampling down to ${MAX_CHUNKS} for performance.`);
        const step = allDocs.length / MAX_CHUNKS;
        docsToIngest = [];
        for (let i = 0; i < MAX_CHUNKS; i++) {
          docsToIngest.push(allDocs[Math.floor(i * step)]);
        }
      }

      const sessionId = randomUUID(); // One Pinecone namespace per session
      await withTimeout(ingestChunks(sessionId, docsToIngest), 50_000);

      const displayName =
        fileNames.length === 1 ? fileNames[0] : `${fileNames.length} PDFs (${fileNames.join(", ")})`;

      res.json({
        sessionId,
        chunks: docsToIngest.length,
        fileName: displayName,
        fileCount: fileNames.length,
      });
    } catch (e) {
      next(e);
    }
  });
});

// Chat: retrieve top chunks for this session and answer from them only.
router.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId, question, history } = req.body ?? {};
    if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new AppError("Invalid session. Please upload your PDF again.");
    }
    if (typeof question !== "string" || !question.trim()) {
      throw new AppError("Please type a question.");
    }
    if (question.length > 2000) throw new AppError("Question is too long (max 2000 characters).");

    const validatedHistory = Array.isArray(history)
      ? history.filter((h) => h && typeof h.text === "string" && (h.role === "user" || h.role === "bot"))
      : [];

    const result = await withTimeout(answerQuestion(sessionId, question.trim(), validatedHistory), 50_000);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Turns any thrown error into a clear JSON message the UI can show.
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error("Server API Error:", err);
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  const message = err?.message || "Something went wrong on the server. Please try again.";
  res.status(500).json({ error: message });
}

export default router;