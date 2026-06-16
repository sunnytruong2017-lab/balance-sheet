import { useState } from "react";
import { format, parseISO } from "date-fns";
import DataTable, { NumCell, TableFooter } from "./DataTable";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export default function EntriesTable({
  title, entries, type, loading, color,
  onEdit, onDelete, renderAmount, renderMeta,
}) {
  const [selectedEntry, setSelected] = useState(null);

  const isExpense = type === "expense";
  const total = isExpense
    ? entries.reduce((s, e) => s + (e.amount || 0), 0)
    : entries.reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);

  const columns = [
    {
      key: "date",
      label: "Date",
      width: "90px",
      render: (row) => (
        <div style={{
          background: selectedEntry?.id === row.id ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--surface2)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 7px",
          textAlign: "center",
          transition: "background 0.15s",
        }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {row.date ? format(parseISO(row.date), "MMM") : "—"}
          </div>
          <div style={{ fontSize: "var(--text-md)", fontWeight: 700, lineHeight: 1, color: selectedEntry?.id === row.id ? "var(--accent)" : "var(--text)" }}>
            {row.date ? format(parseISO(row.date), "d") : "—"}
          </div>
        </div>
      ),
    },
    {
      key: "description",
      label: "Description",
      render: (row) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: "var(--text-base)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.description || "—"}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {renderMeta(row)}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      width: "110px",
      render: (row) => (
        <NumCell value={renderAmount(row)} color={color} bold />
      ),
    },
    {
      key: "actions",
      label: "",
      width: "72px",
      render: (row, hovered) => (
        <div style={{ display: "flex", gap: "var(--sp-1)", justifyContent: "flex-end", opacity: hovered || selectedEntry?.id === row.id ? 1 : 0, transition: "opacity 0.15s" }}>
          <IconBtn onClick={(e) => { e.stopPropagation(); onEdit(row); }} title="Edit">
            <EditIcon />
          </IconBtn>
          <IconBtn onClick={(e) => { e.stopPropagation(); onDelete(row.id); }} title="Delete" danger>
            <TrashIcon />
          </IconBtn>
        </div>
      ),
    },
    {
      key: "chevron",
      label: "",
      width: "24px",
      render: (row) => (
        <span style={{
          fontSize: 11,
          color: "var(--text-dim)",
          display: "block",
          textAlign: "center",
          transform: selectedEntry?.id === row.id ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s var(--ease)",
        }}>▾</span>
      ),
    },
  ];

  function handleRowClick(row) {
    setSelected((prev) => prev?.id === row.id ? null : row);
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      overflow: "hidden",
    }}>
      {/* Panel header */}
      <div style={{
        padding: "13px 18px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, letterSpacing: "0.01em" }}>{title}</span>
          {!loading && (
            <span style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-dim)",
              background: "var(--surface2)",
              padding: "2px 7px",
              borderRadius: 20,
              fontWeight: 500,
            }}>{entries.length}</span>
          )}
        </div>
        {!loading && (
          <span style={{
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color,
          }}>{fmtCurrency(total)}</span>
        )}
      </div>

      {/* Rows */}
      <div>
        {loading ? (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {[1,2,3].map((i) => <div key={i} className="loading-skeleton" style={{ height: 52, opacity: 1 - i * 0.2 }} />)}
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: "var(--sp-8)", textAlign: "center", color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>
            No {title.toLowerCase()} entries yet
          </div>
        ) : (
          entries.map((entry, idx) => {
            const isSelected = selectedEntry?.id === entry.id;
            return (
              <div key={entry.id}>
                <EntryRow
                  entry={entry}
                  columns={columns}
                  isSelected={isSelected}
                  last={idx === entries.length - 1 && !isSelected}
                  idx={idx}
                  onClick={() => handleRowClick(entry)}
                />
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
          })
        )}
      </div>
    </div>
  );
}

function EntryRow({ entry, columns, isSelected, last, idx, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "90px 1fr 110px 72px 24px",
        padding: "11px 18px",
        borderBottom: (!last || isSelected) ? "1px solid var(--border)" : "none",
        background: isSelected ? "var(--accent-dim)" : hovered ? "var(--surface2)" : "transparent",
        cursor: "pointer",
        userSelect: "none",
        alignItems: "center",
        gap: "var(--sp-3)",
        transition: "background 0.1s var(--ease)",
        animation: "fadeIn 0.18s var(--ease-out) both",
        animationDelay: `${Math.min(idx * 30, 200)}ms`,
      }}
    >
      {columns.map((col) => (
        <div key={col.key} style={{ minWidth: 0 }}>
          {col.render ? col.render(entry, hovered) : entry[col.key]}
        </div>
      ))}
    </div>
  );
}

function DetailPanel({ entry, type, color, last }) {
  const isIncome = type === "income";
  return (
    <div style={{
      borderBottom: last ? "none" : "1px solid var(--border)",
      background: "var(--surface2)",
      animation: "fadeIn 0.15s var(--ease-out) forwards",
    }}>
      <div style={{ padding: "14px 18px 16px" }}>
        {/* Date */}
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
          {entry.date ? format(parseISO(entry.date), "EEEE, MMMM d, yyyy") : "—"}
          {entry.category && (
            <span style={{
              marginLeft: 10,
              fontSize: "var(--text-xs)",
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 20,
              background: "var(--surface3)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-light)",
            }}>{entry.category}</span>
          )}
        </div>

        {isIncome ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-2)" }}>
            <DetailField label="Cash Revenue"  value={fmtCurrency(entry.cashRevenue)} color="var(--green)"   show={!!entry.cashRevenue} />
            <DetailField label="Card Revenue"  value={fmtCurrency(entry.cardRevenue)} color="var(--green)"   show={!!entry.cardRevenue} />
            <DetailField label="Tip (Cash)"    value={fmtCurrency(entry.tipCash)}    color="var(--yellow)"  show={!!entry.tipCash} />
            <DetailField label="Tip (Card)"    value={fmtCurrency(entry.tipCard)}    color="var(--yellow)"  show={!!entry.tipCard} />
            <DetailField label="Tax Collected" value={fmtCurrency(entry.tax)}        color="var(--text-muted)" show={!!entry.tax} />
            <DetailField
              label="Total Revenue"
              value={fmtCurrency((entry.cashRevenue||0)+(entry.cardRevenue||0)+(entry.tipCash||0)+(entry.tipCard||0))}
              color="var(--green)" bold show
            />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
            <DetailField label="Amount"   value={fmtCurrency(entry.amount)} color={color} bold show />
            <DetailField label="Category" value={entry.category || "—"} show />
          </div>
        )}

        {entry.notes && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Notes</div>
            <div style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              padding: "8px 12px",
              background: "var(--surface)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
            }}>{entry.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value, color, bold, show }) {
  if (!show) return null;
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius-sm)", padding: "8px 12px", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)", fontWeight: bold ? 700 : 500, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

function IconBtn({ onClick, title, danger, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28, height: 28, borderRadius: "var(--radius-sm)",
        background: hovered ? (danger ? "var(--red-dim)" : "var(--surface3)") : "transparent",
        color: hovered ? (danger ? "var(--red)" : "var(--text-muted)") : "var(--text-dim)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.12s, color 0.12s",
        flexShrink: 0,
      }}
    >{children}</button>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}
