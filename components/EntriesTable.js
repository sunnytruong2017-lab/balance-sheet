import { format, parseISO } from "date-fns";
import { useState } from "react";

export default function EntriesTable({
  title, entries, type, loading, color,
  onEdit, onDelete, renderAmount, renderMeta,
}) {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</span>
          {!loading && (
            <span style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface2)", padding: "2px 7px", borderRadius: 10 }}>
              {entries.length}
            </span>
          )}
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color, fontWeight: 600 }}>
          {!loading && new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
            type === "expense"
              ? entries.reduce((s, e) => s + (e.amount || 0), 0)
              : entries.reduce((s, e) => s + (e.cashRevenue || 0) + (e.cardRevenue || 0) + (e.tipCash || 0) + (e.tipCard || 0), 0)
          )}
        </span>
      </div>

      {/* Rows */}
      <div style={{ minHeight: 120 }}>
        {loading ? (
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            {[1, 2, 3].map((i) => <div key={i} className="loading-skeleton" style={{ height: 44, borderRadius: 8 }} />)}
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
            No {title.toLowerCase()} entries yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {entries.map((entry, idx) => (
              <div
                key={entry.id}
                onMouseEnter={() => setHoveredId(entry.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  padding: "11px 18px", display: "flex", alignItems: "center", gap: 12,
                  borderBottom: idx < entries.length - 1 ? "1px solid var(--border)" : "none",
                  background: hoveredId === entry.id ? "var(--surface2)" : "transparent",
                  transition: "background 0.1s ease",
                }}
              >
                {/* Date badge */}
                <div style={{ minWidth: 44, textAlign: "center", background: "var(--surface2)", borderRadius: 6, padding: "4px 6px" }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>
                    {entry.date ? format(parseISO(entry.date), "MMM") : "—"}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
                    {entry.date ? format(parseISO(entry.date), "d") : "—"}
                  </div>
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {entry.description || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {renderMeta(entry)}
                  </div>
                </div>

                {/* Amount */}
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color, whiteSpace: "nowrap" }}>
                  {renderAmount(entry)}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 4, opacity: hoveredId === entry.id ? 1 : 0, transition: "opacity 0.15s ease" }}>
                  <IconBtn onClick={() => onEdit(entry)} title="Edit">✏️</IconBtn>
                  <IconBtn onClick={() => onDelete(entry.id)} title="Delete">🗑</IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ width: 28, height: 28, borderRadius: 6, background: hover ? "var(--border)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, transition: "background 0.1s ease" }}>
      {children}
    </button>
  );
}
