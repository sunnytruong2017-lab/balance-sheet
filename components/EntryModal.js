import { useState, useEffect } from "react";
import { format } from "date-fns";

export default function EntryModal({ title, entry, categories, type, defaultDate, onSave, onClose }) {
  const isIncome = type === "income";

  const [form, setForm] = useState(
    entry
      ? { ...entry }
      : {
          description: "",
          date: defaultDate || format(new Date(), "yyyy-MM-dd"),
          category: categories[0] || "",
          notes: "",
          // expense fields
          amount: "",
          // income fields
          cashRevenue: "",
          cardRevenue: "",
          tipCash: "",
          tipCard: "",
          tax: "",
        }
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.date) return setError("Date is required");

    if (!isIncome && !form.amount) return setError("Amount is required");
    if (isIncome) {
      const total =
        parseFloat(form.cashRevenue || 0) +
        parseFloat(form.cardRevenue || 0) +
        parseFloat(form.tipCash || 0) +
        parseFloat(form.tipCard || 0);
      if (total === 0) return setError("Enter at least one revenue amount");
    }

    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(4px)",
        animation: "fadeIn 0.15s ease forwards",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 480,
          animation: "slideUp 0.2s ease forwards",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: "var(--surface2)",
              color: "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Date + Description */}
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
            <Field label="Date">
              <input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Description">
              <input
                type="text"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Brief description..."
                style={inputStyle}
              />
            </Field>
          </div>

          {/* Category (only for expense) */}
          {!isIncome && (
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
              >
                {categories.map((c) => (
                  <option key={c} value={c} style={{ background: "#1a1d28" }}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Amount (expense) or Revenue breakdown (income) */}
          {!isIncome ? (
            <Field label="Amount (USD)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0.00"
                style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              />
            </Field>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: -8 }}>
                Revenue Breakdown
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Cash Revenue">
                  <input type="number" min="0" step="0.01" value={form.cashRevenue}
                    onChange={(e) => set("cashRevenue", e.target.value)}
                    placeholder="0.00" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                </Field>
                <Field label="Card Revenue">
                  <input type="number" min="0" step="0.01" value={form.cardRevenue}
                    onChange={(e) => set("cardRevenue", e.target.value)}
                    placeholder="0.00" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                </Field>
                <Field label="Tip (Cash)">
                  <input type="number" min="0" step="0.01" value={form.tipCash}
                    onChange={(e) => set("tipCash", e.target.value)}
                    placeholder="0.00" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                </Field>
                <Field label="Tip (Card)">
                  <input type="number" min="0" step="0.01" value={form.tipCard}
                    onChange={(e) => set("tipCard", e.target.value)}
                    placeholder="0.00" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                </Field>
              </div>
              <Field label="Tax Collected">
                <input type="number" min="0" step="0.01" value={form.tax}
                  onChange={(e) => set("tax", e.target.value)}
                  placeholder="0.00" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
              </Field>

              {/* Live total */}
              <div style={{
                padding: "10px 14px",
                background: "var(--accent-dim)",
                border: "1px solid var(--accent-glow)",
                borderRadius: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Total Revenue</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 700 }}>
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                    parseFloat(form.cashRevenue || 0) +
                    parseFloat(form.cardRevenue || 0) +
                    parseFloat(form.tipCash || 0) +
                    parseFloat(form.tipCard || 0)
                  )}
                </span>
              </div>
            </>
          )}

          {/* Notes */}
          <Field label="Notes (optional)">
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Additional details..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
          </Field>

          {error && (
            <div style={{ fontSize: 12, color: "var(--red)", padding: "8px 12px", background: "var(--red-dim)", borderRadius: 6 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px", borderRadius: 7,
                background: "var(--surface2)",
                color: "var(--text-muted)",
                fontSize: 13, fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "8px 20px", borderRadius: 7,
                background: isIncome ? "var(--accent)" : "var(--red)",
                color: "#000",
                fontSize: 13, fontWeight: 600,
                opacity: saving ? 0.7 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {saving ? "Saving..." : entry ? "Save Changes" : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  color: "var(--text)",
  fontSize: 13,
  transition: "border-color 0.15s ease",
};

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
