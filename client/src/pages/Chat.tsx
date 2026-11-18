import { useEffect, useRef, useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { askQuestion } from "../api";
import type { Session } from "../api";

interface Message {
  role: "user" | "bot";
  text: string;
  sources?: string[];
  isError?: boolean;
}

const SUGGESTIONS = [
  "Give me a clear summary of the key points in this PDF.",
  "What are the most important topics discussed in this document?",
  "Highlight some practical examples or use cases from the PDF.",
  "Explain the complex parts of this document in simple terms.",
];

export default function Chat({ session }: { session: Session | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keeps the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Copies the answer text to the clipboard.
  function handleCopy(text: string, index: number) {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  // Without a processed PDF there is nothing to chat with.
  if (!session) {
    return (
      <div className="card">
        <h1>Chat</h1>
        <p className="hint">You have not uploaded a PDF yet.</p>
        <div className="upload-actions">
          <Link className="btn" to="/upload">Upload a PDF</Link>
        </div>
      </div>
    );
  }

  // Sends a question to the backend and adds the response to chat.
  async function submitQuestion(questionText: string) {
    const question = questionText.trim();
    if (!question || loading || !session) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const res = await askQuestion(session.sessionId, question, history);
      setMessages((m) => [...m, { role: "bot", text: res.answer, sources: res.sources }]);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((m) => [...m, { role: "bot", text, isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    submitQuestion(input);
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="file">{session.fileName} ({session.chunks} chunks)</span>
        <Link className="btn secondary" to="/upload">Upload another PDF</Link>
      </div>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">Your PDF is ready! Try one of these questions:</p>
            <div className="prompt-chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip-btn"
                  onClick={() => submitQuestion(s)}
                  disabled={loading}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.isError ? " error" : ""}`}>
            <div className="bubble">
              {m.role === "bot" && !m.isError ? (
                <div className="markdown-content">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              ) : (
                m.text
              )}
            </div>

            {m.role === "bot" && !m.isError && (
              <div className="msg-actions">
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => handleCopy(m.text, i)}
                  title="Copy answer"
                >
                  {copiedIndex === i ? "✓ Copied" : "📋 Copy"}
                </button>
              </div>
            )}

            {m.sources && m.sources.length > 0 && (
              <details className="sources">
                <summary>Sources from your PDF ({m.sources.length})</summary>
                {m.sources.map((s, j) => (
                  <blockquote key={j}>{s}...</blockquote>
                ))}
              </details>
            )}
          </div>
        ))}
        {loading && (
          <div className="status info">
            <span className="spinner" /> Searching your PDF and thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={handleSend}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask any question about your PDF (English, Hindi, etc.)..."
          maxLength={1000}
          disabled={loading}
        />
        <button className="btn" type="submit" disabled={!input.trim() || loading}>Send</button>
      </form>
    </div>
  );
}