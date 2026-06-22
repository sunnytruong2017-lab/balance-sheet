import { useState, useEffect, useCallback } from "react";
import { format, getDaysInMonth } from "date-fns";
import { useIsMobile } from "../lib/useIsMobile";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const fmtHrs = (n) => `${(n || 0).toFixed(2)} hrs`;

function getBiweeklyPeriods(refDate) {
  const d       = refDate || new Date();
  const year    = d.getFullYear();
  const month   = d.getMonth() + 1;
  const lastDay = getDaysInMonth(d);
  return [
    { label: `${format(d, "MMM")} 1–15`,        half: 1, month, year, start: `${year}-${String(month).padStart(2,"0")}-01`, end: `${year}-${String(month).padStart(2,"0")}-15` },
    { label: `${format(d, "MMM")} 16–${lastDay}`, half: 2, month, year, start: `${year}-${String(month).padStart(2,"0")}-16`, end: `${year}-${String(month).padStart(2,"0")}-${lastDay}` },
  ];
}

const VIEWS = ["Payroll", "Tips", "Settings"];

export default function PayrollPanel() {
  const isMobile = useIsMobile();
  const [activeView, setActiveView]   = useState("Payroll");
  const [periodMonth, setPeriodMonth] = useState(new Date());
  const [periodHalf, setPeriodHalf]   = useState(new Date().getDate() <= 15 ? 1 : 2);
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [saving, setSaving]           = useState({});
  const [wages, setWages]             = useState({});
  const [savedWages, setSavedWages]   = useState({});
  const [wageSaving, setWageSaving]   = useState({});

  const periods = getBiweeklyPeriods(periodMonth);
  const period  = periods[periodHalf - 1];

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const month = periodMonth.getMonth() + 1;
      const year  = periodMonth.getFullYear();
      const res   = await fetch(`/api/payroll?month=${month}&year=${year}&half=${periodHalf}`);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
      const json = await res.json();
      setData(json);
      // Build local wage state from returned wageRates
      const wm = {};
      Object.entries(json.wageRates || {}).forEach(([k, v]) => { wm[k] = v; });
      setWages(wm);
      setSavedWages({ ...wm });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [periodMonth, periodHalf]);

  useEffect(() => { loadPayroll(); }, [loadPayroll]);

  async function togglePaid(record, type) {
    const key = `${type}::${record.employee}::${record.role}`;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const notionId = type === "tips" ? record.tipNotionId : record.notionId;
      const paid     = type === "tips" ? !record.tipPaid    : !record.paid;
      const res = await fetch("/api/payroll", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, notionId, paid }),
      });
      if (res.ok) {
        setData((prev) => ({
          ...prev,
          records: prev.records.map((r) =>
            r.employee === record.employee && r.role === record.role
              ? type === "tips"
                ? { ...r, tipPaid: paid }
                : { ...r, paid }
              : r
          ),
        }));
      }
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  async function saveWage(employee, role, rate) {
    const key = `${employee}::${role}`;
    setWageSaving((s) => ({ ...s, [key]: true }));
    try {
      await fetch("/api/wages", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ employee, role, hourlyRate: parseFloat(rate) || 0 }),
      });
      setSavedWages((s) => ({ ...s, [key]: parseFloat(rate) || 0 }));
      // Reload to recalculate with new rate
      await loadPayroll();
    } finally {
      setWageSaving((s) => ({ ...s, [key]: false }));
    }
  }

  if (error) return (
    <div style={{ padding: 24, color: "var(--red)", background: "var(--red-dim)", borderRadius: 10, fontSize: 13 }}>{error}</div>
  );

  const records  = data?.records  || [];
  const totals   = data?.totals   || { hours: 0, wages: 0, tips: 0, total: 0 };
  const dailyTips = data?.dailyTips || [];

  const totalPaid   = records.filter((r) => r.paid).reduce((s, r) => s + r.total, 0);
  const totalUnpaid = records.filter((r) => !r.paid).reduce((s, r) => s + r.total, 0);

  // Group records by employee (for dual-role display)
  const employeeGroups = {};
  records.forEach((r) => {
    if (!employeeGroups[r.employee]) employeeGroups[r.employee] = [];
    employeeGroups[r.employee].push(r);
  });
  const employees = Object.entries(employeeGroups);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 22 }}>

      {/* ── KPI cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
        <KpiCard label="Est. Wages"    value={fmt(totals.wages)}  color="var(--blue)"   loading={loading} />
        <KpiCard label="Tips"          value={fmt(totals.tips)}   color="var(--accent)" loading={loading} />
        <KpiCard label="Total Payroll" value={fmt(totals.total)}  color="var(--green)"  loading={loading} bold />
        <KpiCard label="Outstanding"   value={fmt(totalUnpaid)}   color="var(--red)"    loading={loading} />
      </div>

      {/* ── Period selector ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pay period:</span>
        <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
          {periods.map((p) => (
            <button key={p.half} onClick={() => setPeriodHalf(p.half)} style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              fontWeight: periodHalf === p.half ? 600 : 400,
              background: periodHalf === p.half ? "var(--surface)" : "transparent",
              color: periodHalf === p.half ? "var(--text)" : "var(--text-muted)",
              border: periodHalf === p.half ? "1px solid var(--border)" : "1px solid transparent",
              transition: "all 0.15s ease",
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <button onClick={() => setPeriodMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "center" }}>{format(periodMonth, "MMM yyyy")}</span>
          <button onClick={() => setPeriodMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>›</button>
        </div>
      </div>

      {/* ── Sub-nav ── */}
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
          <PanelHeader title={`Payroll — ${period.label}`} hint="Hours × hourly rate from Calculation Sheet. Auto-synced to Notion." />
          {loading ? <Loading /> : employees.length === 0 ? <Empty text={`No shifts found for ${period.label}`} /> : (
            <>
              {/* Desktop table */}
              {!isMobile && (
                <>
                  <TableHead cols={["Employee", "Role(s)", "Hours", "Rate / hr", "Wages", "Tips", "Total", "Status"]} />
                  {employees.map(([empName, recs]) => (
                    <EmployeeRows key={empName} empName={empName} recs={recs}
                      saving={saving} onToggle={(r) => togglePaid(r, "wages")} />
                  ))}
                  <TotalRow items={[
                    { label: "Total Hours",   value: fmtHrs(totals.hours) },
                    { label: "Total Wages",   value: fmt(totals.wages),  color: "var(--blue)"  },
                    { label: "Total Tips",    value: fmt(totals.tips),   color: "var(--accent)"},
                    { label: "Total Payroll", value: fmt(totals.total),  color: "var(--green)", bold: true },
                  ]} />
                </>
              )}
              {/* Mobile cards */}
              {isMobile && employees.map(([empName, recs]) => (
                <MobilePayrollCard key={empName} empName={empName} recs={recs}
                  saving={saving} onToggle={(r) => togglePaid(r, "wages")} />
              ))}
            </>
          )}
        </Panel>
      )}

      {/* ── Tips view ── */}
      {activeView === "Tips" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel>
            <PanelHeader title={`Tips — ${period.label}`} hint="Tip allocations from Calculation Sheet. Paid weekly, tracked separately from wages." />
            {loading ? <Loading /> : employees.length === 0 ? <Empty text={`No tip data for ${period.label}`} /> : (
              <>
                {!isMobile && (
                  <>
                    <TableHead cols={["Employee", "Role(s)", "Hours", "Tips Allocated", "Status"]} />
                    {employees.map(([empName, recs]) => (
                      <TipRows key={empName} empName={empName} recs={recs}
                        saving={saving} onToggle={(r) => togglePaid(r, "tips")} />
                    ))}
                    <TotalRow items={[
                      { label: "Total Tips", value: fmt(totals.tips), color: "var(--accent)", bold: true },
                    ]} />
                  </>
                )}
                {isMobile && employees.map(([empName, recs]) => (
                  <MobileTipCard key={empName} empName={empName} recs={recs}
                    saving={saving} onToggle={(r) => togglePaid(r, "tips")} />
                ))}
              </>
            )}
          </Panel>

          {/* Daily tip breakdown */}
          {dailyTips.length > 0 && (
            <Panel>
              <PanelHeader title="Daily Tip Pool Breakdown" hint="Total tips collected per day from POS orders." />
              {dailyTips.map((day, i) => (
                <div key={day.date} style={{
                  padding: "10px 18px", borderBottom: i < dailyTips.length - 1 ? "1px solid var(--border)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    {format(new Date(day.date + "T12:00:00"), "EEE, MMM d")}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--accent)", fontSize: 13 }}>
                    {fmt(day.amount)}
                  </span>
                </div>
              ))}
              <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--accent)", fontSize: 14 }}>
                  Total: {fmt(dailyTips.reduce((s, d) => s + d.amount, 0))}
                </span>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ── Settings view ── */}
      {activeView === "Settings" && (
        <Panel>
          <PanelHeader title="Hourly Rate Settings"
            hint="Set each employee's hourly rate per role. New employees from the Calculation Sheet appear here automatically with ⚠ until a rate is set." />
          {loading ? <Loading /> : records.length === 0 ? <Empty text="No employees found in Calculation Sheet" /> : (
            employees.map(([empName, recs], i) => (
              <div key={empName} style={{
                padding: isMobile ? "12px 14px" : "14px 18px",
                borderBottom: i < employees.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ fontWeight: 500, fontSize: isMobile ? 13 : 14, marginBottom: recs.length > 1 ? 10 : 0 }}>{empName}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: recs.length > 1 ? 0 : 0 }}>
                  {recs.map((rec) => {
                    const key     = `${rec.employee}::${rec.role}`;
                    const curVal  = wages[key] !== undefined ? wages[key] : "";
                    const isSaved = String(savedWages[key]) === String(curVal);
                    const noRate  = !savedWages[key];
                    return (
                      <div key={rec.role} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <RoleBadge role={rec.role} />
                        {noRate && <span style={{ fontSize: 11, color: "var(--red)" }}>⚠ Rate not set</span>}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>$</span>
                          <input type="number" min="0" step="0.25"
                            value={curVal}
                            onChange={(e) => setWages((w) => ({ ...w, [key]: e.target.value }))}
                            placeholder="0.00"
                            style={{ width: isMobile ? 72 : 90, padding: "7px 8px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}
                          />
                          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>/hr</span>
                          <button onClick={() => saveWage(rec.employee, rec.role, wages[key] || 0)}
                            disabled={wageSaving[key]}
                            style={{
                              padding: "7px 12px", borderRadius: 7, border: "none",
                              background: isSaved ? "var(--surface2)" : "var(--accent)",
                              color: isSaved ? "var(--text-muted)" : "#000",
                              fontSize: 12, fontWeight: 600, cursor: "pointer",
                              opacity: wageSaving[key] ? 0.7 : 1, transition: "all 0.15s ease",
                            }}>
                            {wageSaving[key] ? "…" : isSaved ? "✓" : "Save"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Employee row components ────────────────────────────────

function EmployeeRows({ empName, recs, saving, onToggle }) {
  const isDual = recs.length > 1;
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {recs.map((rec, i) => {
        const sk = `wages::${rec.employee}::${rec.role}`;
        return (
          <div key={rec.role} style={{
            display: "grid", gridTemplateColumns: "1.5fr 80px 90px 90px 100px 100px 110px 110px",
            padding: "11px 18px", alignItems: "center", fontSize: 13,
            background: i % 2 === 1 && isDual ? "color-mix(in srgb, var(--surface2) 40%, transparent)" : "transparent",
          }}>
            <span style={{ fontWeight: i === 0 ? 500 : 400, color: i === 0 ? "var(--text)" : "var(--text-muted)" }}>
              {i === 0 ? empName : ""}
            </span>
            <RoleBadge role={rec.role} />
            <Mono>{fmtHrs(rec.hours)}</Mono>
            <Mono muted>{rec.hourlyRate ? fmt(rec.hourlyRate) : <Warn />}</Mono>
            <Mono color="var(--blue)">{rec.hourlyRate ? fmt(rec.wages) : "—"}</Mono>
            <Mono color="var(--accent)">{fmt(rec.tips)}</Mono>
            <Mono color="var(--green)" bold>{rec.hourlyRate ? fmt(rec.total) : "—"}</Mono>
            <PayBtn paid={rec.paid} saving={!!saving[sk]} onToggle={() => onToggle(rec)} />
          </div>
        );
      })}
    </div>
  );
}

function TipRows({ empName, recs, saving, onToggle }) {
  const isDual = recs.length > 1;
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {recs.map((rec, i) => {
        const sk = `tips::${rec.employee}::${rec.role}`;
        return (
          <div key={rec.role} style={{
            display: "grid", gridTemplateColumns: "1.5fr 80px 90px 130px 110px",
            padding: "11px 18px", alignItems: "center", fontSize: 13,
            background: i % 2 === 1 && isDual ? "color-mix(in srgb, var(--surface2) 40%, transparent)" : "transparent",
          }}>
            <span style={{ fontWeight: i === 0 ? 500 : 400, color: i === 0 ? "var(--text)" : "var(--text-muted)" }}>
              {i === 0 ? empName : ""}
            </span>
            <RoleBadge role={rec.role} />
            <Mono muted>{fmtHrs(rec.hours)}</Mono>
            <Mono color="var(--accent)" bold>{fmt(rec.tips)}</Mono>
            <PayBtn paid={rec.tipPaid} saving={!!saving[sk]} onToggle={() => onToggle(rec)} />
          </div>
        );
      })}
    </div>
  );
}

function MobilePayrollCard({ empName, recs, saving, onToggle }) {
  return (
    <div style={{ padding: "14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{empName}</span>
        {recs.map((r) => <RoleBadge key={r.role} role={r.role} />)}
      </div>
      {recs.map((rec) => {
        const sk = `wages::${rec.employee}::${rec.role}`;
        return (
          <div key={rec.role} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 8 }}>
            <MiniStat label={`${rec.role} Hrs`}   value={fmtHrs(rec.hours)} />
            <MiniStat label="Rate"                 value={rec.hourlyRate ? `$${rec.hourlyRate}/hr` : "—"} warn={!rec.hourlyRate} />
            <MiniStat label="Wages"                value={rec.hourlyRate ? fmt(rec.wages) : "—"} color="var(--blue)" />
            <MiniStat label="Tips"                 value={fmt(rec.tips)} color="var(--accent)" />
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--green)", fontSize: 14 }}>
          {fmt(recs.reduce((s, r) => s + r.total, 0))} total
        </span>
        <PayBtn paid={recs[0]?.paid} saving={!!saving[`wages::${recs[0]?.employee}::${recs[0]?.role}`]} onToggle={() => onToggle(recs[0])} />
      </div>
    </div>
  );
}

function MobileTipCard({ empName, recs, saving, onToggle }) {
  return (
    <div style={{ padding: "14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{empName}</span>
          {recs.map((r) => <RoleBadge key={r.role} role={r.role} />)}
        </div>
        <PayBtn paid={recs[0]?.tipPaid} saving={!!saving[`tips::${recs[0]?.employee}::${recs[0]?.role}`]} onToggle={() => onToggle(recs[0])} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${recs.length > 1 ? 4 : 2}, 1fr)`, gap: 6 }}>
        {recs.map((rec) => (
          <MiniStat key={rec.role} label={`${rec.role} Tips`} value={fmt(rec.tips)} color="var(--accent)" />
        ))}
        <MiniStat label="Total" value={fmt(recs.reduce((s, r) => s + r.tips, 0))} color="var(--accent)" />
      </div>
    </div>
  );
}

// ── Shared small components ────────────────────────────────

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
        display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:500, transition:"all 0.15s ease",
        background: paid ? (hover ? "rgba(61,184,122,0.05)" : "var(--green-dim)") : (hover ? "var(--surface2)" : "transparent"),
        color:  paid ? "var(--green)" : hover ? "var(--text-muted)" : "var(--text-dim)",
        border: paid ? "1px solid var(--green-glow)" : `1px solid ${hover ? "var(--border)" : "transparent"}`,
      }}>
      {paid ? <>{hover ? "Undo" : "✓ Paid"}</> : <>{hover ? "Mark paid" : "○ Unpaid"}</>}
    </button>
  );
}

function KpiCard({ label, value, color, loading, bold }) {
  return (
    <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"14px 18px" }}>
      <div style={{ fontSize:11, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{label}</div>
      {loading
        ? <div className="loading-skeleton" style={{ width:80, height:20 }} />
        : <div style={{ fontFamily:"var(--font-mono)", fontSize:18, fontWeight: bold ? 700 : 600, color, letterSpacing:"-0.5px" }}>{value}</div>
      }
    </div>
  );
}

function RoleBadge({ role }) {
  const isFOH = role === "FOH";
  return (
    <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:10, fontSize:11, fontWeight:500,
      background: isFOH ? "var(--blue-dim)" : "rgba(251,146,60,0.12)",
      color: isFOH ? "var(--blue)" : "#fb923c" }}>
      {role}
    </span>
  );
}

function MiniStat({ label, value, color, warn }) {
  return (
    <div style={{ background:"var(--surface2)", borderRadius:6, padding:"5px 8px" }}>
      <div style={{ fontSize:9, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:2 }}>{label}</div>
      <div style={{ fontFamily:"var(--font-mono)", fontSize:12, fontWeight:600, color: warn ? "var(--red)" : color || "var(--text)" }}>
        {warn ? "⚠ " : ""}{value}
      </div>
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
          <span style={{ fontFamily:"var(--font-mono)", fontSize: item.bold ? 15 : 13, fontWeight: item.bold ? 700 : 500, color: item.color || "var(--text)" }}>{item.value}</span>
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
    <span style={{ fontFamily:"var(--font-mono)", fontSize:13, fontVariantNumeric:"tabular-nums",
      color: color || (muted ? "var(--text-muted)" : "var(--text)"),
      fontWeight: bold ? 700 : 400 }}>
      {children}
    </span>
  );
}

function Warn() { return <span style={{ color:"var(--red)", fontSize:11 }}>⚠ Not set</span>; }
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
