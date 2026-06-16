import { useState, useRef, useEffect } from "react";
export { ManagerAuthContext, useManagerAuth } from "../lib/ManagerAuthContext";

const MANAGER_PASSWORD = "9999";

// ── Modal component ────────────────────────────────────────────────────────
export default function ManagerGate({ onSuccess, onCancel, tabName }) {
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [shake, setShake]       = useState(false);
  const inputRef                = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  function handleSubmit(e) {
    e.preventDefault();
    if (password === MANAGER_PASSWORD) {
      onSuccess();
    } else {
      setError("Incorrect password");
      setPassword("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  const subtitle = tabName === "__login__"
    ? "Sign in to access manager features."
    : null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        animation: "fadeIn 0.15s ease forwards",
      }}
    >
      <div
        className={shake ? "manager-gate-shake" : ""}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%", maxWidth: 360,
          padding: "28px 28px 24px",
          animation: shake ? undefined : "slideUp 0.2s ease forwards",
        }}
      >
        {/* Lock icon */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, margin: "0 auto 12px",
            background: "var(--surface2)", border: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Manager Access</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {subtitle || (
              <><strong style={{ color: "var(--text)" }}>{tabName}</strong> is restricted to managers.</>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{
              fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase",
              letterSpacing: "0.06em", display: "block", marginBottom: 6,
            }}>
              Manager Password
            </label>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Enter password"
              autoComplete="off"
              style={{
                width: "100%", padding: "10px 14px",
                background: "var(--surface2)",
                border: `1px solid ${error ? "var(--red)" : "var(--border)"}`,
                borderRadius: 8, color: "var(--text)", fontSize: 14,
                letterSpacing: "0.15em",
                transition: "border-color 0.15s ease",
              }}
            />
            {error && (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--red)" }}>{error}</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                background: "var(--surface2)", color: "var(--text-muted)",
                fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                background: "var(--accent)", color: "#000",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
