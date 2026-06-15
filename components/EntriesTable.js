import { format, parseISO } from "date-fns";
import { useState } from "react";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export default function EntriesTable({
  title, entries, type, loading, color,
  onEdit, onDelete, renderAmount, renderMeta,
}) {
  const [hoveredId, setHoveredId]   = useState(null);
  const [selectedEntry, setSelected] = useState(null);

  function handleRowClick(entry) {
    setSelected((prev) => (prev?.id === entry.id ? null : entry));
  }

  return (
    <>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
            {!loading && (
              <span style={{
                fontSize: 11, color: "var(--text-dim)", background: "var(--surface2)",
                padding: "2px 7px", borderRadius: 10,
              }}>{entries.length}</span>
            )}
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color, fontWeight: 600 }}>
            {!loading && fmt(
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
              {[1, 2, 3].map((i) => (
                <div key={i} className="loading-skeleton" style={{ height: 44, borderRadius: 8 }} />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
              No {title.toLowerCase()} entries yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {entries.map((entry, idx) => {
                const isSelected = selectedEntry?.id === entry.id;
                const isHovered  = hoveredId === entry.id;
                return (
                  <div key={entry.id}>
                    {/* Row */}
                    <div
                      onClick={() => handleRowClick(entry)}
                      onMouseEnter={() => setHoveredId(entry.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{
                        padding: "11px 18px",
                        display: "flex", alignItems: "center", gap: 12,
                        borderBottom: (isSelected || idx < entries.length - 1) ? "1px solid var(--border)" : "none",
                        background: isSelected
                          ? "var(--accent-dim)"
                          : isHovered ? "var(--surface2)" : "transparent",
                        transition: "background 0.1s ease",
                        animation: "fadeIn 0.2s ease forwards",
                        animationDelay: `${idx * 0.04}s`,
                        opacity: 0,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      {/* Date badge */}
                      <div style={{
                        minWidth: 44, textAlign: "center",
                        background: isSelected ? "rgba(79,216,122,0.15)" : "var(--surface2)",
                        borderRadius: 6, padding: "4px 6px",
                        transition: "background 0.1s",
                      }}>
                        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>
                          {entry.date ? format(parseISO(entry.date), "MMM") : "—"}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: isSelected ? "var(--accent)" : "var(--text)", lineHeight: 1 }}>
                          {entry.date ? format(parseISO(entry.date), "d") : "—"}
                        </div>
                      </div>

                      {/* Description + meta */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 500,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          color: isSelected ? "var(--text)" : "var(--text)",
                        }}>
                          {entry.description || "—"}
                        </div>
                        <div style={{
                          fontSize: 11, color: "var(--text-muted)", marginTop: 2,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {renderMeta(entry)}
                        </div>
                      </div>

                      {/* Amount */}
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                        color, whiteSpace: "nowrap",
                      }}>
                        {renderAmount(entry)}
                      </div>

                      {/* Edit / Delete — visible on hover or selected */}
                      <div style={{
                        display: "flex", gap: 4,
                        opacity: isHovered || isSelected ? 1 : 0,
                        transition: "opacity 0.15s ease",
                      }}>
                        <IconBtn
                          onClick={(e) => { e.stopPropagation(); onEdit(entry); }}
                          title="Edit"
                        >✏️</IconBtn>
                        <IconBtn
                          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                          title="Delete"
                        >🗑</IconBtn>
                      </div>

                      {/* Expand indicator */}
                      <div style={{
                        fontSize: 11, color: "var(--text-dim)",
                        transition: "transform 0.2s ease",
                        transform: isSelected ? "rotate(180deg)" : "rotate(0deg)",
                        lineHeight: 1, flexShrink: 0,
                      }}>▾</div>
                    </div>

                    {/* Detail panel — slides open when selected */}
                    {isSelected && (
                      <DetailPanel
                        entry={entry}
                        type={type}
                        color={color}
                        last={idx === entries.length - 1}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailPanel({ entry, type, color, last }) {
  const isIncome = type === "income";

  return (
    <div style={{
      borderBottom: last ? "none" : "1px solid var(--border)",
      background: "var(--surface2)",
      animation: "slideDown 0.18s ease forwards",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; max-height: 0; }
          to   { opacity: 1; max-height: 400px; }
        }
      `}</style>

      <div style={{ padding: "16px 18px 18px 18px" }}>
        {/* Top row: full date + category/type */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {entry.date ? format(parseISO(entry.date), "EEEE, MMMM d, yyyy") : "—"}
            </span>
          </div>
          {!isIncome && entry.category && (
            <span style={{
              fontSize: 11, fontWeight: 500,
              padding: "2px 10px", borderRadius: 20,
              background: "rgba(79,216,122,0.08)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-light)",
            }}>{entry.category}</span>
          )}
        </div>

        {/* Fields grid */}
        {isIncome ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <DetailField label="Cash Revenue"  value={fmt(entry.cashRevenue)} color="var(--accent)" show={!!entry.cashRevenue} />
            <DetailField label="Card Revenue"  value={fmt(entry.cardRevenue)} color="var(--accent)" show={!!entry.cardRevenue} />
            <DetailField label="Tip (Cash)"    value={fmt(entry.tipCash)}    color="var(--yellow)" show={!!entry.tipCash} />
            <DetailField label="Tip (Card)"    value={fmt(entry.tipCard)}    color="var(--yellow)" show={!!entry.tipCard} />
            <DetailField label="Tax Collected" value={fmt(entry.tax)}        color="var(--text-muted)" show={!!entry.tax} />
            <DetailField
              label="Total Revenue"
              value={fmt((entry.cashRevenue || 0) + (entry.cardRevenue || 0) + (entry.tipCash || 0) + (entry.tipCard || 0))}
              color="var(--accent)"
              bold
              show
            />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            <DetailField label="Amount" value={fmt(entry.amount)} color={color} bold show />
            <DetailField label="Category" value={entry.category || "—"} show />
          </div>
        )}

        {/* Notes */}
        {entry.notes && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
              Notes
            </div>
            <div style={{
              fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
              padding: "8px 12px", background: "var(--surface)",
              borderRadius: 7, border: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
            }}>
              {entry.notes}
            </div>
          </div>
        )}

        {/* Entry ID (subtle, for debugging) */}
        <div style={{ marginTop: 12, fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          ID: {entry.id?.replace(/-/g, "").slice(0, 16)}…
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value, color, bold, show }) {
  if (!show) return null;
  return (
    <div style={{
      background: "var(--surface)", borderRadius: 7,
      padding: "8px 12px", border: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 13,
        fontWeight: bold ? 700 : 500,
        color: color || "var(--text)",
      }}>
        {value}
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28, borderRadius: 6,
        background: hover ? "var(--border)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, transition: "background 0.1s ease",
        cursor: "pointer", border: "none",
      }}
    >{children}</button>
  );
}
