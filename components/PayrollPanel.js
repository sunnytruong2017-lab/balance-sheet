import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { useIsMobile } from "../lib/useIsMobile";

const fmt    = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const fmtHrs = (n) => `${(n || 0).toFixed(2)} hrs`;
const round2 = (n) => Math.round((n || 0) * 100) / 100;

const VIEWS = ["Payroll", "Tips", "History"];

export default function PayrollPanel() {
  const isMobile = useIsMobile();
  const [activeView, setActiveView]       = useState("Payroll");
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [data, setData]                   = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState("");
  const [saving, setSaving]               = useState({});

  const load = useCallback(async (periodStart) => {
    setLoading(true);
    setError("");
    try {
      const url = periodStart ? `/api/payroll?periodStart=${periodStart}` : "/api/payroll";
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
      const json = await res.json();
      setData(json);
      if (!selectedPeriod && json.periods?.[0]) {
        setSelectedPeriod(json.periods[0].periodStart);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod]);

  useEffect(() => { load(); }, []);

  function selectPeriod(periodStart) {
    setSelectedPeriod(periodStart);
    load(periodStart);
  }

  async function togglePaid(record, type) {
    const key = `${type}::${record.name}::${record.role}`;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const paid = type === "tips" ? !record.paid : !record.paid;
      const res  = await fetch("/api/payroll", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, notionId: record.notionId, paid }),
      });
      if (res.ok) {
        setData((prev) => {
          if (!prev) return prev;
          if (type === "tips") {
            return {
              ...prev,
              tipsData: {
                ...prev.tipsData,
                employees: prev.tipsData.employees.map((e) =>
                  e.name === record.name && e.role === record.role ? { ...e, paid } : e
                ),
              },
            };
          } else {
            return {
              ...prev,
              payrollPeriod: {
                ...prev.payrollPeriod,
                employees: prev.payrollPeriod.employees.map((e) =>
                  e.name === record.name && e.role === record.role ? { ...e, paid } : e
                ),
              },
            };
          }
        });
      }
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  if (error) return (
    <div style={{ padding: 24, color: "var(--red)", background: "var(--red-dim)", borderRadius: 10, fontSize: 13 }}>{error}</div>
  );

  const period   = data?.payrollPeriod;
  const tipsData = data?.tipsData;
  const periods  = data?.periods || [];
  const totals   = data?.totals  || { hours: 0, wages: 0, tips: 0, total: 0 };
  const records  = period?.employees || [];
  const totalUnpaid = records.filter((r) => !r.paid).reduce((s, r) => s + (r.withTips || r.wages + r.tipsTotal), 0);

  // Group by employee name
  const empGroups = {};
  records.forEach((r) => {
    if (!empGroups[r.name]) empGroups[r.name] = [];
    empGroups[r.name].push(r);
  });
  const employees = Object.entries(empGroups);

  const tipGroups = {};
  (tipsData?.employees || []).forEach((r) => {
    if (!tipGroups[r.name]) tipGroups[r.name] = [];
    tipGroups[r.name].push(r);
  });
  const tipEmployees = Object.entries(tipGroups);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 20 }}>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
        <KpiCard label="Wages"       value={fmt(totals.wages)} color="var(--blue)"   loading={loading} />
        <KpiCard label="Tips"        value={fmt(totals.tips)}  color="var(--accent)" loading={loading} />
        <KpiCard label="Total"       value={fmt(totals.total)} color="var(--green)"  loading={loading} bold />
        <KpiCard label="Outstanding" value={fmt(totalUnpaid)}  color="var(--red)"    loading={loading} />
      </div>

      {/* Period selector */}
      {periods.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pay period:</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {periods.map((p) => (
              <button key={p.periodStart} onClick={() => selectPeriod(p.periodStart)} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                fontWeight: selectedPeriod === p.periodStart ? 600 : 400,
                background: selectedPeriod === p.periodStart ? "var(--surface2)" : "transparent",
                color: selectedPeriod === p.periodStart ? "var(--text)" : "var(--text-muted)",
                border: `1px solid ${selectedPeriod === p.periodStart ? "var(--border)" : "transparent"}`,
                transition: "all 0.15s ease",
              }}>
                {formatPeriodLabel(p.periodStart, p.periodEnd)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sub-nav */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: isMobile ? 0 : 4 }}>
        {VIEWS.map((v) => (
          <button key={v} onClick={() => setActiveView(v)} style={{
            flex: isMobile ? 1 : "initial",
            padding: isMobile ? "10px 4px" : "8px 16px",
            fontSize: isMobile ? 11 : 13,
            fontWeight: activeView === v ? 600 : 400,
            color: activeView === v ? "var(--text)" : "var(--text-muted)",
            background: "none", border: "none",
            borderBottom: `2px solid ${activeView === v ? "var(--accent)" : "transparent"}`,
            cursor: "pointer", transition: "all 0.15s ease",
          }}>{v}</button>
        ))}
      </div>

      {/* ── Payroll view ── */}
      {activeView === "Payroll" && (
        <Panel>
          <PanelHeader
            title={period ? `Payroll — ${formatPeriodLabel(period.periodStart, period.periodEnd)}` : "Payroll"}
            hint="From the Payroll sheet. Total Pay includes wages + tips. Auto-synced to Notion."
          />
          {loading ? <Loading /> : employees.length === 0 ? <Empty text="No payroll data found" /> : (
            <>
              {!isMobile && (
                <>
                  <TableHead cols={["Employee", "Position", "Hours", "Rate/hr", "Wages", "Tips", "Total Pay", "Status"]} />
                  {employees.map(([name, recs]) => (
                    <EmployeeRows key={name} recs={recs} saving={saving} onToggle={(r) => togglePaid(r, "wages")} />
                  ))}
                  <TotalRow items={[
                    { label: "Hours",  value: fmtHrs(totals.hours) },
                    { label: "Wages",  value: fmt(totals.wages), color: "var(--blue)"   },
                    { label: "Tips",   value: fmt(totals.tips),  color: "var(--accent)" },
                    { label: "Total",  value: fmt(totals.total), color: "var(--green)", bold: true },
                  ]} />
                </>
              )}
              {isMobile && employees.map(([name, recs]) => (
                <MobilePayrollCard key={name} recs={recs} saving={saving} onToggle={(r) => togglePaid(r, "wages")} />
              ))}
            </>
          )}
        </Panel>
      )}

      {/* ── Tips view ── */}
      {activeView === "Tips" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Period pool summary */}
          {tipsData && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <KpiCard label="CC Tips Pool"    value={fmt(tipsData.poolCC)}    color="var(--blue)"   loading={loading} />
              <KpiCard label="Cash Tips Pool"  value={fmt(tipsData.poolCash)}  color="var(--accent)" loading={loading} />
              <KpiCard label="Total Tips Pool" value={fmt(tipsData.poolTotal)} color="var(--green)"  loading={loading} bold />
            </div>
          )}

          <Panel>
            <PanelHeader
              title={tipsData ? `Tips — ${tipsData.periodLabel}` : "Tips"}
              hint="Pooled tip distribution from the Tips sheet. CC and cash tips allocated per employee per role."
            />
            {loading ? <Loading /> : tipEmployees.length === 0 ? <Empty text="No tips data found" /> : (
              <>
                {!isMobile && (
                  <>
                    <TableHead cols={["Employee", "Role", "Hours", "CC Tips", "Cash Tips", "Total Tips", "Status"]} />
                    {tipEmployees.map(([name, recs]) => (
                      <TipRows key={name} recs={recs} saving={saving} onToggle={(r) => togglePaid(r, "tips")} />
                    ))}
                    <TotalRow items={[
                      { label: "Total CC Tips",   value: fmt(tipsData?.poolCC),    color: "var(--blue)"   },
                      { label: "Total Cash Tips", value: fmt(tipsData?.poolCash),  color: "var(--text-muted)" },
                      { label: "Total Tips",      value: fmt(tipsData?.poolTotal), color: "var(--accent)", bold: true },
                    ]} />
                  </>
                )}
                {isMobile && tipEmployees.map(([name, recs]) => (
                  <MobileTipCard key={name} recs={recs} saving={saving} onToggle={(r) => togglePaid(r, "tips")} />
                ))}
              </>
            )}
          </Panel>

          {/* Daily breakdowns */}
          {(tipsData?.dailyBreakdowns || []).map((day) => (
            <Panel key={day.date}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{formatDay(day.date)}</span>
                <div style={{ display: "flex", gap: 16, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  <span style={{ color: "var(--text-muted)" }}>CC: {fmt(day.poolCC)}</span>
                  <span style={{ color: "var(--text-muted)" }}>Cash: {fmt(day.poolCash)}</span>
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>Total: {fmt(day.poolTotal)}</span>
                </div>
              </div>
              {!isMobile && (
                <>
                  <TableHead cols={["Employee", "Role", "Hours", "CC Tips", "Cash Tips", "Total"]} />
                  {day.employees.map((emp, i) => (
                    <div key={`${emp.name}::${emp.role}`} style={{
                      display: "grid", gridTemplateColumns: "1.5fr 80px 90px 100px 110px 110px",
                      padding: "10px 18px", borderBottom: i < day.employees.length - 1 ? "1px solid var(--border)" : "none",
                      fontSize: 13, alignItems: "center",
                    }}>
                      <span style={{ fontWeight: 500 }}>{emp.name}</span>
                      <RoleBadge role={emp.role} />
                      <Mono muted>{fmtHrs(emp.hours)}</Mono>
                      <Mono muted>{fmt(emp.ccTips)}</Mono>
                      <Mono muted>{fmt(emp.cashTips)}</Mono>
                      <Mono color="var(--accent)" bold>{fmt(emp.total)}</Mono>
                    </div>
                  ))}
                </>
              )}
              {isMobile && day.employees.map((emp) => (
                <div key={`${emp.name}::${emp.role}`} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{emp.name}</span>
                    <RoleBadge role={emp.role} />
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>{fmt(emp.total)}</span>
                </div>
              ))}
            </Panel>
          ))}
        </div>
      )}

      {/* ── History view ── */}
      {activeView === "History" && (
        <Panel>
          <PanelHeader title="Pay Period History" hint="All pay periods found in the Payroll sheet, newest first." />
          {loading ? <Loading /> : periods.length === 0 ? <Empty text="No pay periods found" /> : (
            periods.map((p, i) => (
              <div key={p.periodStart} style={{
                padding: "13px 18px", borderBottom: i < periods.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "pointer", transition: "background 0.1s ease",
              }}
                onClick={() => { setSelectedPeriod(p.periodStart); setActiveView("Payroll"); load(p.periodStart); }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontWeight: 500, fontSize: 13 }}>{formatPeriodLabel(p.periodStart, p.periodEnd)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--blue)", fontSize: 13 }}>{fmt(p.totalWages)}</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>›</span>
                </div>
              </div>
            ))
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Row components ────────────────────────────────────────

function EmployeeRows({ recs, saving, onToggle }) {
  const isDual = recs.length > 1;
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {recs.map((rec, i) => {
        const sk = `wages::${rec.name}::${rec.role}`;
        const isFirst = i === 0;
        return (
          <div key={`${rec.name}::${rec.role}`} style={{
            display: "grid", gridTemplateColumns: "1.5fr 1fr 90px 90px 100px 100px 110px 110px",
            padding: "11px 18px", alignItems: "center", fontSize: 13,
            background: i % 2 === 1 && isDual ? "color-mix(in srgb, var(--surface2) 40%, transparent)" : "transparent",
          }}>
            <span style={{ fontWeight: isFirst ? 500 : 400, color: isFirst ? "var(--text)" : "var(--text-muted)" }}>
              {isFirst ? rec.name : ""}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{rec.position}</span>
            <Mono muted>{fmtHrs(rec.hours)}</Mono>
            <Mono muted>{fmt(rec.rate)}</Mono>
            <Mono color="var(--blue)">{fmt(rec.wages)}</Mono>
            <Mono color="var(--accent)">{fmt(rec.tipsTotal)}</Mono>
            <Mono color="var(--green)" bold>{fmt(rec.withTips || rec.wages + rec.tipsTotal)}</Mono>
            {isFirst ? <PayBtn paid={rec.paid} saving={!!saving[sk]} onToggle={() => onToggle(rec)} /> : <span />}
          </div>
        );
      })}
    </div>
  );
}

function TipRows({ recs, saving, onToggle }) {
  const isDual = recs.length > 1;
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {recs.map((rec, i) => {
        const sk = `tips::${rec.name}::${rec.role}`;
        const isFirst = i === 0;
        return (
          <div key={`${rec.name}::${rec.role}`} style={{
            display: "grid", gridTemplateColumns: "1.5fr 80px 90px 100px 110px 120px 110px",
            padding: "11px 18px", alignItems: "center", fontSize: 13,
            background: i % 2 === 1 && isDual ? "color-mix(in srgb, var(--surface2) 40%, transparent)" : "transparent",
          }}>
            <span style={{ fontWeight: isFirst ? 500 : 400, color: isFirst ? "var(--text)" : "var(--text-muted)" }}>
              {isFirst ? rec.name : ""}
            </span>
            <RoleBadge role={rec.role} />
            <Mono muted>{fmtHrs(rec.hours)}</Mono>
            <Mono muted>{fmt(rec.ccTips)}</Mono>
            <Mono muted>{fmt(rec.cashTips)}</Mono>
            <Mono color="var(--accent)" bold>{fmt(rec.total)}</Mono>
            {isFirst ? <PayBtn paid={rec.paid} saving={!!saving[sk]} onToggle={() => onToggle(rec)} /> : <span />}
          </div>
        );
      })}
    </div>
  );
}

function MobilePayrollCard({ recs, saving, onToggle }) {
  const name = recs[0]?.name;
  const sk   = `wages::${name}::${recs[0]?.role}`;
  return (
    <div style={{ padding: "14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
          {recs.map((r) => <RoleBadge key={r.role} role={r.role} />)}
        </div>
        <PayBtn paid={recs[0]?.paid} saving={!!saving[sk]} onToggle={() => onToggle(recs[0])} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <MiniStat label="Hours" value={fmtHrs(recs.reduce((s, r) => s + r.hours, 0))} />
        <MiniStat label="Wages" value={fmt(recs.reduce((s, r) => s + r.wages, 0))} color="var(--blue)" />
        <MiniStat label="Total" value={fmt(recs.reduce((s, r) => s + (r.withTips || r.wages + r.tipsTotal), 0))} color="var(--green)" />
      </div>
    </div>
  );
}

function MobileTipCard({ recs, saving, onToggle }) {
  const name = recs[0]?.name;
  const sk   = `tips::${name}::${recs[0]?.role}`;
  return (
    <div style={{ padding: "14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
          {recs.map((r) => <RoleBadge key={r.role} role={r.role} />)}
        </div>
        <PayBtn paid={recs[0]?.paid} saving={!!saving[sk]} onToggle={() => onToggle(recs[0])} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(recs.length + 1, 4)}, 1fr)`, gap: 6 }}>
        {recs.map((r) => <MiniStat key={r.role} label={`${r.role} Tips`} value={fmt(r.total)} color="var(--accent)" />)}
        {recs.length > 1 && <MiniStat label="Total" value={fmt(recs.reduce((s, r) => s + r.total, 0))} color="var(--accent)" />}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function formatPeriodLabel(start, end) {
  if (!start || !end) return "";
  try {
    const s = new Date(start + "T12:00:00");
    const e = new Date(end   + "T12:00:00");
    return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
  } catch { return `${start} – ${end}`; }
}

function formatDay(dateStr) {
  if (!dateStr) return "";
  try { return format(new Date(dateStr + "T12:00:00"), "EEE, MMM d, yyyy"); }
  catch { return dateStr; }
}

function RoleBadge({ role }) {
  const isFOH = role === "FOH";
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500,
      background: isFOH ? "var(--blue-dim)" : "rgba(251,146,60,0.12)",
      color: isFOH ? "var(--blue)" : "#fb923c" }}>
      {role || "—"}
    </span>
  );
}

function PayBtn({ paid, saving, onToggle }) {
  const [hover, setHover] = useState(false);
  if (saving) return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:6, background:"var(--surface2)", border:"1px solid var(--border)", fontSize:11, color:"var(--text-dim)" }}>
      <Spinner /> Saving…
    </div>
  );
  return (
    <button onClick={onToggle} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:6,
        cursor:"pointer", fontSize:11, fontWeight:500, transition:"all 0.15s ease",
        background: paid ? (hover ? "rgba(61,184,122,0.05)" : "var(--green-dim)") : (hover ? "var(--surface2)" : "transparent"),
        color:  paid ? "var(--green)" : hover ? "var(--text-muted)" : "var(--text-dim)",
        border: paid ? "1px solid var(--green-glow)" : `1px solid ${hover ? "var(--border)" : "transparent"}`,
      }}>
      {paid ? (hover ? "Undo" : "✓ Paid") : (hover ? "Mark paid" : "○ Unpaid")}
    </button>
  );
}

function KpiCard({ label, value, color, loading, bold }) {
  return (
    <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"14px 18px" }}>
      <div style={{ fontSize:11, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{label}</div>
      {loading
        ? <div className="loading-skeleton" style={{ width:80, height:20 }} />
        : <div style={{ fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums", fontSize:18, fontWeight: bold ? 700 : 600, color, letterSpacing:"-0.5px" }}>{value}</div>
      }
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ background:"var(--surface2)", borderRadius:6, padding:"5px 8px" }}>
      <div style={{ fontSize:9, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:2 }}>{label}</div>
      <div style={{ fontFamily:"var(--font-mono)", fontSize:12, fontWeight:600, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

function TableHead({ cols }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:`repeat(${cols.length}, 1fr)`, padding:"10px 18px", borderBottom:"1px solid var(--border)", background:"var(--surface2)" }}>
      {cols.map((c) => <span key={c} style={{ fontSize:10, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{c}</span>)}
    </div>
  );
}

function TotalRow({ items }) {
  return (
    <div style={{ padding:"12px 18px", borderTop:"1px solid var(--border)", display:"flex", justifyContent:"flex-end", gap:28 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
          <span style={{ fontSize:10, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{item.label}</span>
          <span style={{ fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums", fontSize: item.bold ? 15 : 13, fontWeight: item.bold ? 700 : 500, color: item.color || "var(--text)" }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ children }) {
  return <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>{children}</div>;
}

function PanelHeader({ title, hint }) {
  return (
    <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border)" }}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom: hint ? 3 : 0 }}>{title}</div>
      {hint && <div style={{ fontSize:11, color:"var(--text-dim)", lineHeight:1.5 }}>{hint}</div>}
    </div>
  );
}

function Mono({ children, muted, color, bold }) {
  return (
    <span style={{ fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums", fontSize:13,
      color: color || (muted ? "var(--text-muted)" : "var(--text)"),
      fontWeight: bold ? 700 : 400 }}>
      {children}
    </span>
  );
}

function Empty({ text }) { return <div style={{ padding:32, textAlign:"center", color:"var(--text-dim)", fontSize:13 }}>{text}</div>; }
function Loading() {
  return (
    <div style={{ padding:16, display:"flex", flexDirection:"column", gap:10 }}>
      {[1,2,3,4].map((i) => <div key={i} className="loading-skeleton" style={{ height:44, borderRadius:8 }} />)}
    </div>
  );
}
function Spinner() {
  return <span style={{ display:"inline-block", width:10, height:10, border:"1.5px solid var(--border)", borderTopColor:"var(--text-muted)", borderRadius:"50%", animation:"spin 0.6s linear infinite" }} />;
}
