import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";

export default function EntryModal({
  title, entry, categories, type, defaultDate,
  onSave, onClose, onCategoryAdded, onCategoryDeleted,
}) {
  const isIncome = type === "income";

  const [form, setForm] = useState(
    entry ? { ...entry } : {
      description: "",
      date: defaultDate || format(new Date(), "yyyy-MM-dd"),
      category: categories[0] || "",
      notes: "",
      amount: "",
      cashRevenue: "", cardRevenue: "", tipCash: "", tipCard: "", tax: "",
    }
  );

  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");
  const [addingCat, setAddingCat]     = useState(false);
  const [newCatName, setNewCatName]   = useState("");
  const [savingCat, setSavingCat]     = useState(false);
  const [catError, setCatError]       = useState("");
  const newCatRef                     = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
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
      const total = parseFloat(form.cashRevenue || 0) + parseFloat(form.cardRevenue || 0)
                  + parseFloat(form.tipCash || 0) + parseFloat(form.tipCard || 0);
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

  const totalRevenue = parseFloat(form.cashRevenue || 0) + parseFloat(form.cardRevenue || 0)
                     + parseFloat(form.tipCash || 0) + parseFloat(form.tipCard || 0);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, animation: "fadeIn 0.15s ease forwards",
      }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 14, width: "100%", maxWidth: 480,
        animation: "slideUp 0.2s ease forwards", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, background: "var(--surface2)",
            color: "var(--text-muted)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 18, lineHeight: 1, cursor: "pointer", border: "none",
          }}>×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16, maxHeight: "80vh", overflowY: "auto" }}>

          {/* Date + Description */}
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
            <Field label="Date">
              <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Description">
              <input type="text" value={form.description} onChange={(e) => set("description", e.target.value)}
                placeholder="Brief description..." style={inputStyle} />
            </Field>
          </div>

          {/* Category — expense only */}
          {!isIncome && (
            <Field label="Category">
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {/* Select with delete option per item */}
                <div style={{ flex: 1 }}>
                  <select
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    style={{ ...inputStyle, appearance: "none", cursor: "pointer", width: "100%" }}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c} style={{ background: "#1a1d28" }}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Manage / Add button */}
                <button
                  type="button"
                  onClick={() => { setAddingCat((v) => !v); setCatError(""); setNewCatName(""); }}
                  title={addingCat ? "Cancel" : "Add category"}
                  style={{
                    flexShrink: 0, width: 34, height: 34, borderRadius: 7,
                    background: addingCat ? "var(--surface2)" : "var(--border)",
                    color: "var(--text-muted)", fontSize: 18, lineHeight: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", border: "none", transition: "background 0.15s",
                  }}
                >
                  {addingCat ? "×" : "+"}
                </button>
              </div>

              {/* Inline add-category row */}
              {addingCat && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, animation: "fadeIn 0.15s ease" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      ref={newCatRef}
                      type="text"
                      value={newCatName}
                      onChange={(e) => { setNewCatName(e.target.value); setCatError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                      placeholder="New category name..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={savingCat}
                      style={{
                        padding: "0 14px", borderRadius: 7, flexShrink: 0,
                        background: "var(--accent)", color: "#000",
                        fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                        opacity: savingCat ? 0.7 : 1,
                      }}
                    >
                      {savingCat ? "..." : "Add"}
                    </button>
                  </div>
                  {catError && (
                    <span style={{ fontSize: 11, color: "var(--red)" }}>{catError}</span>
                  )}

                  {/* Category list with delete buttons */}
                  {categories.length > 0 && (
                    <div style={{
                      background: "var(--surface2)", borderRadius: 7,
                      border: "1px solid var(--border)", overflow: "hidden", marginTop: 4,
                    }}>
                      <div style={{ padding: "6px 10px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)" }}>
                        Manage categories
                      </div>
                      {categories.map((cat, idx) => (
                        <CategoryRow
                          key={cat}
                          cat={cat}
                          last={idx === categories.length - 1}
                          onDelete={onCategoryDeleted ? () => onCategoryDeleted(cat) : null}
                        />
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
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0.00" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
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
              <div style={{
                padding: "10px 14px", background: "var(--accent-dim)",
                border: "1px solid var(--accent-glow)", borderRadius: 8,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Total Revenue</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 700 }}>
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalRevenue)}
                </span>
              </div>
            </>
          )}

          {/* Notes */}
          <Field label="Notes (optional)">
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Additional details..." rows={2}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} />
          </Field>

          {error && (
            <div style={{ fontSize: 12, color: "var(--red)", padding: "8px 12px", background: "var(--red-dim)", borderRadius: 6 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              padding: "8px 16px", borderRadius: 7, background: "var(--surface2)",
              color: "var(--text-muted)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", border: "none",
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              padding: "8px 20px", borderRadius: 7,
              background: isIncome ? "var(--accent)" : "var(--red)",
              color: "#000", fontSize: 13, fontWeight: 600,
              opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
              cursor: "pointer", border: "none",
            }}>
              {saving ? "Saving..." : entry ? "Save Changes" : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategoryRow({ cat, last, onDelete }) {
  const [hover, setHover] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setConfirming(false); }}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 10px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        background: hover ? "rgba(255,255,255,0.02)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{cat}</span>
      {onDelete && (
        confirming ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => onDelete(cat)} style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 4,
              background: "var(--red)", color: "#fff", cursor: "pointer", border: "none", fontWeight: 600,
            }}>Delete</button>
            <button type="button" onClick={() => setConfirming(false)} style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 4,
              background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer", border: "1px solid var(--border)",
            }}>Cancel</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            style={{
              fontSize: 11, color: "var(--text-dim)", background: "none", border: "none",
              cursor: "pointer", opacity: hover ? 1 : 0, transition: "opacity 0.1s",
              padding: "2px 6px",
            }}
          >✕</button>
        )
      )}
    </div>
  );
}


const inputStyle = {
  width: "100%", padding: "8px 12px",
  background: "var(--surface2)", border: "1px solid var(--border)",
  borderRadius: 7, color: "var(--text)", fontSize: 13,
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
