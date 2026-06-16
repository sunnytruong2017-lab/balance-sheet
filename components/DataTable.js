import { useState } from "react";

/**
 * DataTable — reusable, properly aligned data table.
 *
 * columns: [{ key, label, align?: 'left'|'right'|'center', width?: string, render?: (row) => node }]
 * rows: array of objects
 * onRowClick?: (row) => void
 * loading?: boolean
 * emptyText?: string
 * footer?: node  — rendered below last row
 * stickyHeader?: boolean
 */
export default function DataTable({
  columns,
  rows,
  onRowClick,
  loading,
  emptyText = "No data",
  footer,
  stickyHeader,
  compact,
  keyField = "id",
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const colWidths = columns.map((c) => c.width || "1fr").join(" ");
  const rowPad    = compact ? "10px 18px" : "13px 18px";
  const headPad   = compact ? "8px 18px"  : "10px 18px";

  return (
    <div style={{ width: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: colWidths,
        padding: headPad,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface2)",
        position: stickyHeader ? "sticky" : "static",
        top: stickyHeader ? 0 : "auto",
        zIndex: stickyHeader ? 1 : "auto",
      }}>
        {columns.map((col) => (
          <span key={col.key} style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            textAlign: col.align === "right" ? "right" : col.align === "center" ? "center" : "left",
          }}>
            {col.label}
          </span>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          {[1,2,3,4].map((i) => (
            <div key={i} className="loading-skeleton" style={{ height: 42, borderRadius: "var(--radius-sm)", opacity: 1 - i * 0.15 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "var(--sp-8)", textAlign: "center", color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>
          {emptyText}
        </div>
      ) : (
        <>
          {rows.map((row, idx) => (
            <div
              key={row[keyField] ?? idx}
              onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                display: "grid",
                gridTemplateColumns: colWidths,
                padding: rowPad,
                borderBottom: idx < rows.length - 1 ? "1px solid var(--border)" : "none",
                background: hoveredIdx === idx ? "var(--surface2)" : "transparent",
                cursor: onRowClick ? "pointer" : "default",
                transition: "background 0.1s var(--ease)",
                alignItems: "center",
                animation: `fadeIn 0.18s var(--ease-out) both`,
                animationDelay: `${Math.min(idx * 30, 200)}ms`,
              }}
            >
              {columns.map((col) => (
                <div key={col.key} style={{
                  textAlign: col.align === "right" ? "right" : col.align === "center" ? "center" : "left",
                  fontSize: "var(--text-base)",
                }}>
                  {col.render ? col.render(row, hoveredIdx === idx) : row[col.key]}
                </div>
              ))}
            </div>
          ))}
          {footer && (
            <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface2)" }}>
              {footer}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Convenience: a right-aligned mono number cell */
export function NumCell({ value, color, bold, dim }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      fontSize: "var(--text-base)",
      fontWeight: bold ? 600 : 400,
      color: color || (dim ? "var(--text-muted)" : "var(--text)"),
      display: "block",
      textAlign: "right",
    }}>
      {value}
    </span>
  );
}

/** Table footer row with right-aligned totals */
export function TableFooter({ items }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-8)", padding: "12px 18px" }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {item.label}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontSize: item.bold ? "var(--text-md)" : "var(--text-sm)",
            fontWeight: item.bold ? 700 : 500,
            color: item.color || "var(--text)",
          }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
