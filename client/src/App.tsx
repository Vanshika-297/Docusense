import { useState, useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { Session } from "./api";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Chat from "./pages/Chat";

// Restores the last session so a page refresh keeps the chat.
function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem("Docusense-session");
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("docusense-theme") === "dark";
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("docusense-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("docusense-theme", "light");
    }
  }, [darkMode]);

  // Saves the new session and opens the chat page.
  function handleUploaded(s: Session) {
    setSession(s);
    try {
      sessionStorage.setItem("Docusense-session", JSON.stringify(s));
    } catch {
      // Storage can be blocked, the chat still works until refresh.
    }
    navigate("/chat");
  }

  return (
    <div className="app">
      <header className="nav">
        <div className="nav-left">
          <span className="brand">Docusense</span>
          <nav>
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/upload">Upload PDF</NavLink>
            <NavLink to="/chat">Chat</NavLink>
          </nav>
        </div>
        <div className="nav-right">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setDarkMode((prev) => !prev)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <a
            href="https://github.com/Vanshika-297/Docusense"
            target="_blank"
            rel="noreferrer"
            className="github-link"
            title="GitHub Repository"
          >
            <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/upload" element={<Upload onUploaded={handleUploaded} />} />
          <Route path="/chat" element={<Chat session={session} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}