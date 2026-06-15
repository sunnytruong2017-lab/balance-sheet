import { useState } from "react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subDays, subMonths } from "date-fns";
import { useIsMobile } from "../lib/useIsMobile";

const PRESET_RANGES = [
  { id: "today",      label: "Today" },
  { id: "this_week",  label: "This Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_30",    label: "Last 30 Days" },
  { id: "last_90",    label: "Last 90 Days" },
  { id: "all",        label: "All Time" },
  { id: "custom",     label: "Custom Range" },
];

function getPresetDates(preset) {
  const now = new Date();
  const d   = (dt) => format(dt, "yyyy-MM-dd");
  if (preset === "today")      return { start: d(now), end: d(now) };
  if (preset === "this_week")  return { start: d(startOfWeek(now, { weekStartsOn: 1 })), end: d(endOfWeek(now, { weekStartsOn: 1 })) };
  if (preset === "this_month") return { start: d(startOfMonth(now)), end: d(endOfMonth(now)) };
  if (preset === "last_30")    return { start: d(subDays(now, 29)), end: d(now) };
  if (preset === "last_90")    return { start: d(subDays(now, 89)), end: d(now) };
  if (preset === "all")        return { start: "2000-01-01", end: d(now) };
  return null;
}

const SECTIONS = [
  {
    id:    "income",
    label: "Income",
    desc:  "Cash revenue, card revenue, tips, tax collected",
    color: "var(--accent)",
    icon:  "↑",
    usesDateFilter: true,
  },
  {
    id:    "expenses_daily",
    label: "Daily Expenses",
    desc:  "Supplies, groceries, and other daily costs",
    color: "var(--red)",
    icon:  "↓",
    usesDateFilter: true,
  },
  {
    id:    "expenses_biweekly",
    label: "Biweekly Expenses",
    desc:  "Employee pay, tips",
    color: "var(--red)",
    icon:  "↓",
    usesDateFilter: true,
  },
  {
    id:    "expenses_monthly",
    label: "Monthly Expenses",
    desc:  "Rent, utilities, taxes",
    color: "var(--red)",
    icon:  "↓",
    usesDateFilter: true,
  },
  {
    id:    "expenses_startup",
    label: "Startup Costs",
    desc:  "Initial capital expenses",
    color: "var(--blue)",
    icon:  "★",
    usesDateFilter: false,
  },
  {
    id:    "all_expenses",
    label: "All Expenses",
    desc:  "Every expense entry across all frequencies",
    color: "var(--red)",
    icon:  "↓",
    usesDateFilter: true,
  },
  {
    id:    "payroll_tips",
    label: "Tip Payouts",
    desc:  "All employees with tip amounts and payout status",
    color: "var(--yellow)",
    icon:  "⚡",
    usesDateFilter: true,
  },
  {
    id:    "wages",
    label: "Wage Rates",
    desc:  "Current hourly rates per employee",
    color: "var(--blue)",
    icon:  "👤",
    usesDateFilter: false,
  },
];

export default function ExportPanel() {
  const isMobile = useIsMobile();
  const [selected, setSelected]       = useState(new Set());
  const [preset, setPreset]           = useState("this_month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd]     = useState(format(new Date(), "yyyy-MM-dd"));
  const [exporting, setExporting]     = useState(false);
  const [lastExport, setLastExport]   = useState(null);
  const [error, setError]             = useState("");

  const presetDates = preset !== "custom" ? getPresetDates(preset) : null;
  const start = presetDates ? presetDates.start : customStart;
  const end   = presetDates ? presetDates.end   : customEnd;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll()  { setSelected(new Set(SECTIONS.map((s) => s.id))); }
  function selectNone() { setSelected(new Set()); }

  async function handleExport() {
    if (selected.size === 0) { setError("Select at least one section to export."); return; }
    setError("");
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: [...selected], startDate: start, endDate: end }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Export failed");
      }

      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement("a");
      const date     = format(new Date(), "yyyy-MM-dd");
      a.href         = url;
      a.download     = `ledger_export_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      setLastExport({ time: new Date().toLocaleTimeString(), sheets: selected.size });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24, maxWidth: 720 }}>

      {/* Header */}
      <div>
        <h2 style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, marginBottom: 4 }}>Export Data</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Select sections and a date range. Everything exports as a single formatted <strong>.xlsx</strong> file with one sheet per section.
        </p>
      </div>

      {/* Date range */}
      <Section title="Date Range">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: preset === "custom" ? 12 : 0 }}>
          {PRESET_RANGES.map((r) => (
            <button key={r.id} onClick={() => setPreset(r.id)} style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              fontWeight: preset === r.id ? 600 : 400,
              background: preset === r.id ? "var(--accent-dim)" : "var(--surface2)",
              color: preset === r.id ? "var(--accent)" : "var(--text-muted)",
              border: `1px solid ${preset === r.id ? "var(--accent-glow)" : "var(--border)"}`,
              transition: "all 0.15s ease",
            }}>{r.label}</button>
          ))}
        </div>

        {preset === "custom" && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)" }}>From</label>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              style={{ padding: "6px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontSize: 13 }} />
            <label style={{ fontSize: 11, color: "var(--text-dim)" }}>To</label>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              style={{ padding: "6px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontSize: 13 }} />
          </div>
        )}
        {preset !== "custom" && presetDates && (
          <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
            {presetDates.start} → {presetDates.end}
          </p>
        )}
      </Section>

      {/* Section selection */}
      <Section
        title="Select Sections"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <TextBtn onClick={selectAll}>All</TextBtn>
            <TextBtn onClick={selectNone}>None</TextBtn>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SECTIONS.map((section) => {
            const isSelected = selected.has(section.id);
            return (
              <button
                key={section.id}
                onClick={() => toggle(section.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 14px", borderRadius: 9, cursor: "pointer", textAlign: "left",
                  background: isSelected ? "var(--surface2)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--border-light)" : "var(--border)"}`,
                  transition: "all 0.15s ease",
                }}
              >
                {/* Checkbox */}
                <div style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                  background: isSelected ? "var(--accent)" : "var(--surface2)",
                  border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border-light)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s ease",
                }}>
                  {isSelected && <span style={{ color: "#000", fontSize: 11, lineHeight: 1, fontWeight: 700 }}>✓</span>}
                </div>

                {/* Icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: isSelected ? `color-mix(in srgb, ${section.color} 15%, transparent)` : "var(--surface2)",
                  border: `1px solid ${isSelected ? section.color : "var(--border)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: isSelected ? section.color : "var(--text-dim)",
                  transition: "all 0.15s ease",
                }}>{section.icon}</div>

                {/* Label + desc */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{section.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>{section.desc}</div>
                </div>

                {/* Date filter badge */}
                <span style={{
                  fontSize: 10, color: "var(--text-dim)",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {section.usesDateFilter ? "Uses date range" : "All time"}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", background: "var(--red-dim)", border: "1px solid rgba(245,101,101,0.3)", borderRadius: 8, fontSize: 13, color: "var(--red)" }}>
          {error}
        </div>
      )}

      {/* Last export confirmation */}
      {lastExport && (
        <div style={{ padding: "10px 14px", background: "var(--accent-dim)", border: "1px solid var(--accent-glow)", borderRadius: 8, fontSize: 13, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
          <span>✓</span>
          <span>Exported {lastExport.sheets} sheet{lastExport.sheets !== 1 ? "s" : ""} at {lastExport.time} — check your downloads for <strong>ledger_export.xlsx</strong></span>
        </div>
      )}

      {/* Export button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleExport}
          disabled={exporting || selected.size === 0}
          style={{
            padding: "10px 28px", borderRadius: 9, fontSize: 14, fontWeight: 600,
            cursor: selected.size === 0 ? "not-allowed" : "pointer",
            background: selected.size === 0 ? "var(--surface2)" : "var(--accent)",
            color: selected.size === 0 ? "var(--text-dim)" : "#000",
            border: "none", opacity: exporting ? 0.7 : 1,
            transition: "all 0.15s ease",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {exporting ? <><Spinner /> Generating…</> : <>↓ Export {selected.size > 0 ? `(${selected.size} sheets)` : ""}</>}
        </button>
        {selected.size > 0 && !exporting && (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Single .xlsx file · {start} to {end}
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function TextBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "#000", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
  );
}
