// Central place for limits, model names and env access.
export const MAX_PDF_BYTES = 4 * 1024 * 1024; // Vercel body limit is ~4.5MB, so cap at 4MB
export const MAX_CHUNKS = 120; // Keeps embedding time inside the function timeout
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;
export const TOP_K = 8;

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSION = 3072; // Pinecone index dimension must match this
export const CHAT_MODEL = "gemini-flash-latest"; // Alias that always points to the current Flash model

// Reads a required env var or throws a clear error.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}