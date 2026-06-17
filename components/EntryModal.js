import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export default function EntryModal({
  title, entry, categories, type, defaultDate,
  onSave, onClose, onCategoryAdded, onCategoryDeleted,
}) {
  const isIncome = type === "income";

  const [form, setForm] = useState(
    entry ? { ...entry } : {
      description: "", date: defaultDate || format(new Date(), "yyyy-MM-dd"),
      category: categories[0] || "", notes: "", amount: "",
      cashRevenue: "", cardRevenue: "", tipCash: "", tipCard: "", tax: "",
    }
  );
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [addingCat, setAddingCat]   = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [savingCat, setSavingCat]   = useState(false);
  const [catError, setCatError]     = useState("");
  const newCatRef                   = useRef(null);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    if (addingCat && newCatRef.current) newCatRef.current.focus();
  }, [addingCat]);

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.date) return setError("Date is required");
    if (!isIncome && !form.amount) return setError("Amount is required");
    if (isIncome) {
      const total = parseFloat(form.cashRevenue||0) + parseFloat(form.cardRevenue||0)
                  + parseFloat(form.tipCash||0) + parseFloat(form.tipCard||0);
      if (total === 0) return setError("Enter at least one revenue amount");
    }
    setSaving(true);
    try { await onSave(form); }
    catch (err) { setError(err.message || "Failed to save"); }
    finally { setSaving(false); }
  }

  async function handleAddCategory() {
    const name = newCatName.trim();
    if (!name) return setCatError("Enter a category name");
    if (categories.includes(name)) return setCatError("Already exists");
    setSavingCat(true);
    setCatError("");
    try {
      await onCategoryAdded(name);
      setForm((f) => ({ ...f, category: name }));
      setNewCatName("");
      setAddingCat(false);
    } catch (err) {
      setCatError(err.message || "Failed to save category");
    } finally {
      setSavingCat(false);
    }
  }

  const totalRevenue = parseFloat(form.cashRevenue||0) + parseFloat(form.cardRevenue||0)
                     + parseFloat(form.tipCash||0) + parseFloat(form.tipCard||0);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "var(--sp-4)",
        animation: "fadeIn 0.12s var(--ease-out) forwards",
      }}
    >
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        width: "100%", maxWidth: 500,
        boxShadow: "var(--shadow-lg)",
        animation: "slideUp 0.18s var(--ease-out) forwards",
        overflow: "hidden",
        maxHeight: "92vh",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 22px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: "var(--text-lg)" }}>{title}</span>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: "var(--radius-sm)",
            background: "var(--surface2)", color: "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, lineHeight: 1, transition: "background 0.12s, color 0.12s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface3)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface2)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{
          padding: "20px 22px",
          display: "flex", flexDirection: "column", gap: "var(--sp-4)",
          overflowY: "auto", flex: 1,
        }}>
          {/* Date + Description */}
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "var(--sp-3)" }}>
            <Field label="Date">
              <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
                className="input-base" style={{ width: "100%" }} />
            </Field>
            <Field label="Description">
              <input type="text" value={form.description} onChange={(e) => set("description", e.target.value)}
                placeholder="Brief description…" className="input-base" style={{ width: "100%" }} />
            </Field>
          </div>

          {/* Category */}
          {!isIncome && (
            <Field label="Category">
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <select value={form.category} onChange={(e) => set("category", e.target.value)}
                  className="input-base" style={{ flex: 1, appearance: "none", cursor: "pointer" }}>
                  {categories.map((c) => (
                    <option key={c} value={c} style={{ background: "var(--surface2)" }}>{c}</option>
                  ))}
                </select>
                <button type="button" onClick={() => { setAddingCat((v) => !v); setCatError(""); setNewCatName(""); }}
                  style={{
                    flexShrink: 0, width: 36, height: 36, borderRadius: "var(--radius-sm)",
                    background: addingCat ? "var(--surface3)" : "var(--surface2)",
                    color: "var(--text-muted)", fontSize: 20, lineHeight: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1.5px solid var(--border)", transition: "all 0.12s",
                  }}
                >{addingCat ? "×" : "+"}</button>
              </div>

              {addingCat && (
                <div style={{ marginTop: "var(--sp-2)", display: "flex", flexDirection: "column", gap: "var(--sp-2)", animation: "fadeIn 0.12s var(--ease-out)" }}>
                  <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                    <input ref={newCatRef} type="text" value={newCatName}
                      onChange={(e) => { setNewCatName(e.target.value); setCatError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                      placeholder="New category name…" className="input-base" style={{ flex: 1 }} />
                    <button type="button" onClick={handleAddCategory} disabled={savingCat}
                      style={{ padding: "0 16px", borderRadius: "var(--radius-sm)", flexShrink: 0, background: "var(--accent)", color: "#000", fontSize: "var(--text-sm)", fontWeight: 600, opacity: savingCat ? 0.7 : 1 }}>
                      {savingCat ? "…" : "Add"}
                    </button>
                  </div>
                  {catError && <span style={{ fontSize: "var(--text-xs)", color: "var(--red)" }}>{catError}</span>}
                  {categories.length > 0 && (
                    <div style={{ background: "var(--surface2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", overflow: "hidden" }}>
                      <div style={{ padding: "5px 10px", fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)" }}>Manage</div>
                      {categories.map((cat, idx) => (
                        <CategoryRow key={cat} cat={cat} last={idx === categories.length - 1}
                          onDelete={onCategoryDeleted ? () => onCategoryDeleted(cat) : null} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
          )}

          {/* Amount / Revenue */}
          {!isIncome ? (
            <Field label="Amount (USD)">
              <input type="number" min="0" step="0.01" value={form.amount}
                onChange={(e) => set("amount", e.target.value)} placeholder="0.00"
                className="input-base" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }} />
            </Field>
          ) : (
            <>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Revenue Breakdown</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
                {[
                  { label: "Cash Revenue", key: "cashRevenue" },
                  { label: "Card Revenue", key: "cardRevenue" },
                  { label: "Tip (Cash)",   key: "tipCash" },
                  { label: "Tip (Card)",   key: "tipCard" },
                ].map(({ label, key }) => (
                  <Field key={key} label={label}>
                    <input type="number" min="0" step="0.01" value={form[key]}
                      onChange={(e) => set(key, e.target.value)} placeholder="0.00"
                      className="input-base" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }} />
                  </Field>
                ))}
              </div>
              <Field label="Tax Collected">
                <input type="number" min="0" step="0.01" value={form.tax}
                  onChange={(e) => set("tax", e.target.value)} placeholder="0.00"
                  className="input-base" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }} />
              </Field>
              {/* Live total */}
              <div style={{ padding: "10px 14px", background: "var(--green-dim)", border: "1px solid var(--green-glow)", borderRadius: "var(--radius-sm)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Total Revenue</span>
                <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--green)", fontWeight: 700 }}>
                  {fmtCurrency(totalRevenue)}
                </span>
              </div>
            </>
          )}

          {/* Notes */}
          <Field label="Notes (optional)">
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Additional details…" rows={2}
              className="input-base" style={{ resize: "vertical", minHeight: 60 }} />
          </Field>

          {error && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--red)", padding: "9px 13px", background: "var(--red-dim)", borderRadius: "var(--radius-sm)", border: "1px solid var(--red-glow)" }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end", paddingTop: "var(--sp-1)" }}>
            <button type="button" onClick={onClose} style={{
              padding: "9px 18px", borderRadius: "var(--radius-sm)",
              background: "var(--surface2)", color: "var(--text-muted)",
              fontSize: "var(--text-sm)", fontWeight: 500, border: "1px solid var(--border)",
              transition: "all 0.12s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface2)"; }}
            >Cancel</button>
            <button type="submit" disabled={saving} style={{
              padding: "9px 22px", borderRadius: "var(--radius-sm)",
              background: isIncome ? "var(--green)" : "var(--red)",
              color: "#fff", fontSize: "var(--text-sm)", fontWeight: 600,
              opacity: saving ? 0.7 : 1, transition: "opacity 0.12s",
              border: "none",
            }}>
              {saving ? "Saving…" : entry ? "Save Changes" : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategoryRow({ cat, last, onDelete }) {
  const [hover, setHover]         = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setConfirming(false); }}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderBottom: last ? "none" : "1px solid var(--border)", background: hover ? "var(--surface)" : "transparent", transition: "background 0.1s" }}>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{cat}</span>
      {onDelete && (
        confirming ? (
          <div style={{ display: "flex", gap: "var(--sp-1)" }}>
            <button type="button" onClick={() => onDelete(cat)} style={{ fontSize: "var(--text-xs)", padding: "2px 8px", borderRadius: 4, background: "var(--red)", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>Delete</button>
            <button type="button" onClick={() => setConfirming(false)} style={{ fontSize: "var(--text-xs)", padding: "2px 8px", borderRadius: 4, background: "var(--surface3)", color: "var(--text-muted)", border: "1px solid var(--border)", cursor: "pointer" }}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} style={{ fontSize: 11, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", opacity: hover ? 1 : 0, transition: "opacity 0.1s", padding: "2px 6px" }}>✕</button>
        )
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      <label style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
