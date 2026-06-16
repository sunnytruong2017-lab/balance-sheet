import { useState, useEffect, useCallback } from "react";
import { format, startOfMonth, endOfMonth, getDaysInMonth, parseISO } from "date-fns";
import { useIsMobile } from "../lib/useIsMobile";

// Normalize position strings to FOH or BOH
function normalizeRole(pos) {
  const p = String(pos).toLowerCase();
  if (p.includes("foh") || p.includes("server")) return "FOH";
  if (p.includes("boh") || p.includes("kitchen")) return "BOH";
  return pos || "FOH";
}

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

function makeWeekKey(scope, identifier) {
  return `${scope}:${identifier}`;
}

// Returns the two biweekly periods for a given month
function getBiweeklyPeriods(refDate) {
  const d        = refDate || new Date();
  const year     = d.getFullYear();
  const month    = d.getMonth();
  const lastDay  = getDaysInMonth(d);
  return [
    {
      label: `${format(d, "MMM")} 1–15`,
      start: format(new Date(year, month, 1),       "yyyy-MM-dd"),
      end:   format(new Date(year, month, 15),      "yyyy-MM-dd"),
    },
    {
      label: `${format(d, "MMM")} 16–${lastDay}`,
      start: format(new Date(year, month, 16),      "yyyy-MM-dd"),
      end:   format(new Date(year, month, lastDay), "yyyy-MM-dd"),
    },
  ];
}

// Detect which period today falls in and return its index (0 or 1)
function currentPeriodIndex() {
  return new Date().getDate() <= 15 ? 0 : 1;
}

export default function PayrollPanel() {
  const isMobile = useIsMobile();

  const [sheetsData, setSheetsData]     = useState(null);
  const [wages, setWages]               = useState({});
  const [savedWages, setSavedWages]     = useState({});
  const [payouts, setPayouts]           = useState({});
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState({});
  const [payoutSaving, setPayoutSaving] = useState({});
  const [error, setError]               = useState("");
  const [activeView, setActiveView]     = useState("wages_biweekly");

  // Biweekly period selector state
  const [periodMonth, setPeriodMonth]   = useState(new Date());
  const [periodIdx, setPeriodIdx]       = useState(currentPeriodIndex());
  const periods = getBiweeklyPeriods(periodMonth);
  const selectedPeriod = periods[periodIdx];

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sheetsRes, wagesRes, payoutsRes] = await Promise.all([
        fetch("/api/sheets"),
        fetch("/api/wages"),
        fetch("/api/tip-payouts"),
      ]);
      if (sheetsRes.ok)  setSheetsData(await sheetsRes.json());
      if (wagesRes.ok) {
        const wd = await wagesRes.json();
        const wm = {};
        // Key: "Employee::Role" e.g. "Sunny::FOH", "Sunny::BOH"
        wd.forEach((w) => { wm[`${w.employee}::${w.role}`] = w.hourlyRate; });
        setSavedWages(wm);
        setWages(wm);
      }
      if (payoutsRes.ok) {
        const pd = await payoutsRes.json();
        const pm = {};
        pd.forEach((p) => { pm[`${p.weekKey}::${p.employee}`] = p; });
        setPayouts(pm);
      }
    } catch (e) {
      setError("Failed to load payroll data: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveWage(employee, role, rate) {
    const key = `${employee}::${role}`;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await fetch("/api/wages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee, role, hourlyRate: parseFloat(rate) }),
      });
      setSavedWages((s) => ({ ...s, [key]: parseFloat(rate) }));
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  async function togglePayout(employee, weekKey, amount, currentPaid) {
    const key = `${weekKey}::${employee}`;
    setPayoutSaving((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch("/api/tip-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee, weekKey, amount, paid: !currentPaid }),
      });
      if (res.ok) {
        const record = await res.json();
        setPayouts((p) => ({ ...p, [key]: record }));
      }
    } finally {
      setPayoutSaving((s) => ({ ...s, [key]: false }));
    }
  }

  function getPayout(weekKey, employee) {
    return payouts[`${weekKey}::${employee}`] || { paid: false, amount: 0 };
  }

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {[1,2,3].map((i) => <div key={i} className="loading-skeleton" style={{ height: 80, borderRadius: 10 }} />)}
    </div>
  );

  if (error) return (
    <div style={{ padding: 24, color: "var(--red)", background: "var(--red-dim)", borderRadius: 10, fontSize: 13 }}>{error}</div>
  );

  const current = sheetsData?.current || { employees: [], weeklyTipsTotal: 0, dailyBlocks: [], weeklyTips: {}, weekLabel: null };
  const past    = sheetsData?.past    || { employees: [], weeklyTipsTotal: 0, dailyBlocks: [], weeklyTips: {}, weekLabel: null };

  const allEmployeeNames = [...new Set([
    ...current.employees.map((e) => e.name),
    ...past.employees.map((e) => e.name),
  ])].filter(Boolean).sort();

  // Sum hours from all daily blocks within the selected period.
  // For dual-role employees, hours are split by position and each rate applied separately.
  function buildBiweeklyPayroll() {
    const { start, end } = selectedPeriod;
    return allEmployeeNames.map((name) => {
      // Collect hours broken down by role from daily blocks.
      // For merged employees, use roleHours map; for single-role use position.
      const hoursByRole = {}; // { FOH: x, BOH: y }
      const daysWorked  = [];

      for (const sheetData of [current, past]) {
        for (const day of sheetData.dailyBlocks) {
          if (day.date < start || day.date > end) continue;
          const emp = day.employees.find((e) => e.name === name);
          if (!emp || emp.hours === 0) continue;

          if (emp.roleHours) {
            // Dual-role employee — split hours by role
            Object.entries(emp.roleHours).forEach(([role, hrs]) => {
              if (hrs > 0) {
                hoursByRole[role] = (hoursByRole[role] || 0) + hrs;
              }
            });
          } else {
            const role = normalizeRole(emp.position);
            hoursByRole[role] = (hoursByRole[role] || 0) + emp.hours;
          }
          daysWorked.push({ date: day.date, dayName: day.dayName, hours: emp.hours });
        }
      }

      const totalHours = Object.values(hoursByRole).reduce((s, h) => s + h, 0);
      if (totalHours === 0) return null;

      // Calculate gross pay: each role's hours × its saved rate
      let grossPay = 0;
      const roleBreakdown = [];
      for (const [role, hrs] of Object.entries(hoursByRole)) {
        const rate = savedWages[`${name}::${role}`] || 0;
        grossPay += hrs * rate;
        roleBreakdown.push({ role, hours: hrs, rate, pay: hrs * rate });
      }

      // Primary position for display (most hours)
      const primaryRole = Object.entries(hoursByRole).sort((a,b) => b[1]-a[1])[0]?.[0] || "";
      const isDualRole  = Object.keys(hoursByRole).length > 1;

      return { name, position: primaryRole, isDualRole, roleBreakdown, hours: totalHours, grossPay, daysWorked };
    }).filter(Boolean);
  }

  // Build payroll for a single sheet (for the tips tabs)
  function buildWeeklyPayroll(sheetData) {
    return sheetData.employees.map((emp) => {
      const rate  = savedWages[emp.name] || 0;
      const hours = sheetData.dailyBlocks.reduce((sum, day) => {
        const de = day.employees.find((e) => e.name === emp.name);
        return sum + (de?.hours || 0);
      }, 0);
      return { name: emp.name, position: emp.position, hours, rate, grossPay: hours * rate, weeklyTips: emp.weeklyTips || 0 };
    });
  }

  const biweeklyPayroll  = buildBiweeklyPayroll();
  const currentPayroll   = buildWeeklyPayroll(current);
  const pastPayroll      = buildWeeklyPayroll(past);
  const allWeeks         = sheetsData?.past?.allWeeks || [];

  // Build a map of dual-role employees: { name: Set(['FOH','BOH']) }
  // Detected from daily blocks where roleHours contains multiple roles
  const employeeRolesMap = {};
  for (const sheetData of [current, past]) {
    for (const day of sheetData.dailyBlocks) {
      for (const emp of day.employees) {
        if (!employeeRolesMap[emp.name]) employeeRolesMap[emp.name] = new Set();
        if (emp.roleHours) {
          Object.keys(emp.roleHours).forEach((r) => employeeRolesMap[emp.name].add(r));
        } else {
          employeeRolesMap[emp.name].add(normalizeRole(emp.position));
        }
      }
    }
  }
  // Helper: render badges for an employee (one or two)
  function EmployeeBadges({ name, position }) {
    const roles = employeeRolesMap[name];
    if (roles && roles.size > 1) {
      return <>{[...roles].sort((a,b) => a === "FOH" ? -1 : 1).map((r) => <Badge key={r} pos={r}>{r}</Badge>)}</>;
    }
    return <Badge pos={position}>{position}</Badge>;
  }

  const totalBiweeklyWages = biweeklyPayroll.reduce((s, e) => s + e.grossPay, 0);
  const totalCurrentTips   = current.weeklyTipsTotal || 0;
  const totalPastTips      = past.weeklyTipsTotal    || 0;

  const subViews = [
    { id: "tips_current",   label: isMobile ? "This Wk" : "This Week's Tips",    desc: `${current.weekLabel || "Current week"} — weekly tip totals` },
    { id: "tips_daily",     label: isMobile ? "Daily"   : "Daily Tip Breakdown", desc: "Per-day tip amounts pulled from Google Sheets" },
    { id: "tips_past",      label: isMobile ? "Last Wk" : "Last Week's Tips",    desc: `${past.weekLabel || "Past week"} — weekly tip totals` },
    { id: "history",        label: isMobile ? "History" : "Tips History",         desc: "All past weeks tip totals" },
    { id: "wages_biweekly", label: isMobile ? "Wages"   : "Biweekly Wages",      desc: "Hours × hourly rate for the selected pay period" },
    { id: "wage_settings",  label: isMobile ? "Settings": "Hourly Rate Settings", desc: "Set each employee's hourly rate" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24 }}>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
        {isMobile ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {selectedPeriod.label} Pay Period
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
              {[
                { label: "Est. Wages",   value: fmt(totalBiweeklyWages), color: "var(--blue)"   },
                { label: "Curr Tips",    value: fmt(totalCurrentTips),   color: "var(--yellow)" },
                { label: "Last Wk Tips", value: fmt(totalPastTips),      color: "var(--yellow)" },
              ].map((item, i) => (
                <div key={item.label} style={{ textAlign: i === 0 ? "left" : i === 1 ? "center" : "right" }}>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <StatCard
              label={`Biweekly Wages — ${selectedPeriod.label}`}
              value={fmt(totalBiweeklyWages)}
              color="var(--blue)"
              hint={`Estimated wages for the ${selectedPeriod.label} pay period. Based on hours worked × each employee's hourly rate.`}
            />
            <StatCard
              label={`Tips — ${current.weekLabel || "This Week"}`}
              value={fmt(totalCurrentTips)}
              color="var(--yellow)"
              hint="Weekly tip pool from Google Sheets. Tips are distributed weekly, separate from the biweekly wage cycle."
            />
            <StatCard
              label={`Tips — ${past.weekLabel || "Last Week"}`}
              value={fmt(totalPastTips)}
              color="var(--yellow)"
              hint="Last week's tip pool from Google Sheets."
            />
          </>
        )}
      </div>

      {/* Info banner */}
      <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, background: "var(--blue-dim)", border: "1px solid rgba(96,165,250,0.2)", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--blue)" }}>Pay schedule:</strong> Wages are paid <strong>biweekly</strong> (1st–15th and 16th–end of month). Tips are tracked and paid out <strong>weekly</strong> via Google Sheets. Use the tabs below to view each separately.
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: isMobile ? 0 : 4, borderBottom: "1px solid var(--border)" }}>
        {subViews.map((v) => (
          <button key={v.id} onClick={() => setActiveView(v.id)} style={{
            flex: isMobile ? 1 : "initial",
            padding: isMobile ? "10px 4px" : "8px 14px",
            fontSize: isMobile ? 9 : 12, textAlign: "center",
            fontWeight: activeView === v.id ? 600 : 400,
            color: activeView === v.id ? "var(--text)" : "var(--text-muted)",
            borderBottom: `2px solid ${activeView === v.id ? "var(--accent)" : "transparent"}`,
            transition: "all 0.15s ease", background: "none", border: "none",
            borderBottom: `2px solid ${activeView === v.id ? "var(--accent)" : "transparent"}`,
            cursor: "pointer",
          }}>{v.label}</button>
        ))}
      </div>

      {/* ── Biweekly Wages ── */}
      {activeView === "wages_biweekly" && (
        <>
          {/* Period selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pay period:</span>
            <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
              {periods.map((p, idx) => (
                <button key={idx} onClick={() => setPeriodIdx(idx)} style={{
                  padding: "5px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                  fontWeight: periodIdx === idx ? 600 : 400,
                  background: periodIdx === idx ? "var(--surface)" : "transparent",
                  color: periodIdx === idx ? "var(--text)" : "var(--text-muted)",
                  border: periodIdx === idx ? "1px solid var(--border)" : "1px solid transparent",
                  transition: "all 0.15s ease",
                }}>{p.label}</button>
              ))}
            </div>
            {/* Month nav */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
              <button onClick={() => setPeriodMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "center" }}>{format(periodMonth, "MMM yyyy")}</span>
              <button onClick={() => setPeriodMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>›</button>
            </div>
          </div>

          <Panel>
            <PanelHeader
              title={`Biweekly Wages — ${selectedPeriod.label} (${selectedPeriod.start} to ${selectedPeriod.end})`}
              hint="Hours worked within this pay period × each employee's hourly rate. Only days within the date range are counted."
            />
            {isMobile ? (
              biweeklyPayroll.length === 0
                ? <Empty text={`No hours logged between ${selectedPeriod.start} and ${selectedPeriod.end} in Google Sheets`} />
                : (
                  <div>
                    {biweeklyPayroll.map((emp, i) => (
                      <BiweeklyEmployeeCard key={emp.name} emp={emp} last={i === biweeklyPayroll.length - 1} />
                    ))}
                    <MobileTotalFooter label="Est. Biweekly Wages" value={fmt(totalBiweeklyWages)} color="var(--blue)" />
                  </div>
                )
            ) : (
              <>
                <TableHeader cols={["Employee", "Position / Role", "Days Worked", "Hours", "Rate / hr", "Estimated Wages"]} />
                {biweeklyPayroll.length === 0
                  ? <Empty text={`No hours logged between ${selectedPeriod.start} and ${selectedPeriod.end} in Google Sheets`} />
                  : biweeklyPayroll.map((emp, i) => (
                    <TableRow key={emp.name} cols={6} last={i === biweeklyPayroll.length - 1} cells={[
                      <Name>{emp.name}</Name>,
                      <Badge pos={emp.position}>{emp.position}</Badge>,
                      <Mono muted>{emp.daysWorked.length} day{emp.daysWorked.length !== 1 ? "s" : ""}</Mono>,
                      <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                      <Mono muted>{emp.rate ? fmt(emp.rate) : <Warn />}</Mono>,
                      <Mono accent bold>{emp.rate ? fmt(emp.grossPay) : "—"}</Mono>,
                    ]} />
                  ))
                }
                {biweeklyPayroll.length > 0 && (
                  <TotalFooter items={[
                    { label: `Estimated Wages — ${selectedPeriod.label}`, value: fmt(totalBiweeklyWages), color: "var(--blue)", bold: true },
                  ]} />
                )}
              </>
            )}
          </Panel>
        </>
      )}

      {/* ── This Week's Tips ── */}
      {activeView === "tips_current" && (
        <Panel>
          <PanelHeader
            title={`${current.weekLabel || "This Week"} — Weekly Tip Totals`}
            hint="Each employee's share of this week's tip pool, pulled from Google Sheets. Tips are paid out weekly, independent of the biweekly wage cycle."
          />
          {isMobile ? (
            currentPayroll.length === 0 ? <Empty text="No data in current week sheet" /> : (
              <div>
                {currentPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("current", current.weekLabel || "current");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  return (
                    <EmployeeCard key={emp.name} emp={emp} last={i === currentPayroll.length - 1}
                      payout={payout} saving={!!payoutSaving[sk]}
                      onTogglePayout={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />
                  );
                })}
                <MobileTotalFooter label="This Week's Tips" value={fmt(totalCurrentTips)} color="var(--yellow)" />
              </div>
            )
          ) : (
            <>
              <TableHeader cols={["Employee", "Position", "Hours This Week", "CC Tips", "Cash Tips", "Total Weekly Tips", "Tips Paid Out?"]} />
              {currentPayroll.length === 0 ? <Empty text="No data in current week sheet" /> : (
                currentPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("current", current.weekLabel || "current");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  // Get cc/cash breakdown from daily blocks
                  const ccTips   = current.dailyBlocks.reduce((s, d) => s + (d.employees.find((e) => e.name === emp.name)?.ccTips   || 0), 0);
                  const cashTips = current.dailyBlocks.reduce((s, d) => s + (d.employees.find((e) => e.name === emp.name)?.cashTips || 0), 0);
                  return (
                    <TableRow key={emp.name} cols={7} last={i === currentPayroll.length - 1} cells={[
                      <Name>{emp.name}</Name>,
                      <EmployeeBadges name={emp.name} position={emp.position} />,
                      <Mono muted>{emp.hours.toFixed(2)} hrs</Mono>,
                      <Mono muted>{fmt(ccTips)}</Mono>,
                      <Mono muted>{fmt(cashTips)}</Mono>,
                      <Mono yellow bold>{fmt(emp.weeklyTips)}</Mono>,
                      <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                        onToggle={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />,
                    ]} />
                  );
                })
              )}
              {currentPayroll.length > 0 && (
                <TotalFooter items={[
                  { label: "Total CC Tips",   value: fmt(currentPayroll.reduce((s, e) => { const cc = current.dailyBlocks.reduce((a, d) => a + (d.employees.find((x) => x.name === e.name)?.ccTips || 0), 0); return s + cc; }, 0)), color: "var(--text-muted)" },
                  { label: "Total Cash Tips", value: fmt(currentPayroll.reduce((s, e) => { const cash = current.dailyBlocks.reduce((a, d) => a + (d.employees.find((x) => x.name === e.name)?.cashTips || 0), 0); return s + cash; }, 0)), color: "var(--text-muted)" },
                  { label: "Total Weekly Tips", value: fmt(totalCurrentTips), color: "var(--yellow)", bold: true },
                ]} />
              )}
            </>
          )}
        </Panel>
      )}

      {/* ── Last Week's Tips ── */}
      {activeView === "tips_past" && (
        <Panel>
          <PanelHeader
            title={`${past.weekLabel || "Last Week"} — Weekly Tip Totals`}
            hint="Each employee's share of last week's tip pool. Tips are paid out weekly, independent of the biweekly wage cycle."
          />
          {isMobile ? (
            pastPayroll.length === 0 ? <Empty text="No data in past weeks sheet" /> : (
              <div>
                <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>
                  {past.weekLabel} — hours and tips for that week
                </div>
                {pastPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("past", past.weekLabel || "past");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  return (
                    <EmployeeCard key={emp.name} emp={emp} last={i === pastPayroll.length - 1}
                      payout={payout} saving={!!payoutSaving[sk]} employeeRolesMap={employeeRolesMap}
                      onTogglePayout={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />
                  );
                })}
                <MobileTotalFooter label="Last Week's Tips" value={fmt(totalPastTips)} color="var(--yellow)" />
              </div>
            )
          ) : (
            <>
              <TableHeader cols={["Employee", "Position", "Hours Last Week", "CC Tips", "Cash Tips", "Total Weekly Tips", "Tips Paid Out?"]} />
              {pastPayroll.length === 0 ? <Empty text="No data in past weeks sheet" /> : (
                pastPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("past", past.weekLabel || "past");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  const ccTips   = past.dailyBlocks.reduce((s, d) => s + (d.employees.find((e) => e.name === emp.name)?.ccTips   || 0), 0);
                  const cashTips = past.dailyBlocks.reduce((s, d) => s + (d.employees.find((e) => e.name === emp.name)?.cashTips || 0), 0);
                  return (
                    <TableRow key={emp.name} cols={7} last={i === pastPayroll.length - 1} cells={[
                      <Name>{emp.name}</Name>,
                      <EmployeeBadges name={emp.name} position={emp.position} />,
                      <Mono muted>{emp.hours.toFixed(2)} hrs</Mono>,
                      <Mono muted>{fmt(ccTips)}</Mono>,
                      <Mono muted>{fmt(cashTips)}</Mono>,
                      <Mono yellow bold>{fmt(emp.weeklyTips)}</Mono>,
                      <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                        onToggle={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />,
                    ]} />
                  );
                })
              )}
              {pastPayroll.length > 0 && (
                <TotalFooter items={[
                  { label: "Total CC Tips",   value: fmt(pastPayroll.reduce((s, e) => { const cc = past.dailyBlocks.reduce((a, d) => a + (d.employees.find((x) => x.name === e.name)?.ccTips || 0), 0); return s + cc; }, 0)), color: "var(--text-muted)" },
                  { label: "Total Cash Tips", value: fmt(pastPayroll.reduce((s, e) => { const cash = past.dailyBlocks.reduce((a, d) => a + (d.employees.find((x) => x.name === e.name)?.cashTips || 0), 0); return s + cash; }, 0)), color: "var(--text-muted)" },
                  { label: "Total Weekly Tips", value: fmt(totalPastTips), color: "var(--yellow)", bold: true },
                ]} />
              )}
            </>
          )}
        </Panel>
      )}

      {/* ── Daily Tip Breakdown ── */}
      {activeView === "tips_daily" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, background: "var(--blue-dim)", border: "1px solid rgba(96,165,250,0.2)", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Daily tip amounts per employee based on hours worked and shift type, pulled from Google Sheets. Mark each day's tips as paid out once distributed.
          </div>
          {current.dailyBlocks.length === 0 && <Panel><Empty text="No daily data found in current week sheet" /></Panel>}
          {current.dailyBlocks.map((day) => (
            <Panel key={day.date}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{day.dayName}</span>
                  <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: 8, fontFamily: "var(--font-mono)" }}>{day.date}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow)", fontWeight: 600, fontSize: 12 }}>
                  Daily Tip Pool: {fmt(day.employees.reduce((s, e) => s + (e.totalTips || 0), 0))}
                </span>
              </div>
              {isMobile ? (
                <div>
                  {day.employees.filter((e) => e.hours > 0 || e.totalTips > 0).map((emp, i, arr) => {
                    const wk     = makeWeekKey("daily", `${day.date}:${day.dayName}`);
                    const payout = getPayout(wk, emp.name);
                    const sk     = `${wk}::${emp.name}`;
                    return (
                      <DailyEmployeeCard key={emp.name} emp={emp} last={i === arr.length - 1}
                        payout={payout} saving={!!payoutSaving[sk]} employeeRolesMap={employeeRolesMap}
                        onTogglePayout={() => togglePayout(emp.name, wk, emp.totalTips, payout.paid)} />
                    );
                  })}
                </div>
              ) : (
                <>
                  <TableHeader cols={["Employee", "Position", "Hours Worked", "CC Tips Allocated", "Cash Tips Allocated", "Total Tips", "Tips Paid Out?"]} />
                  {day.employees.filter((e) => e.hours > 0 || e.totalTips > 0).map((emp, i, arr) => {
                    const wk     = makeWeekKey("daily", `${day.date}:${day.dayName}`);
                    const payout = getPayout(wk, emp.name);
                    const sk     = `${wk}::${emp.name}`;
                    return (
                      <TableRow key={emp.name} cols={7} last={i === arr.length - 1} cells={[
                        <Name>{emp.name}</Name>,
                        <EmployeeBadges name={emp.name} position={emp.position} />,
                        <Mono muted>{emp.hours.toFixed(2)} hrs</Mono>,
                        <Mono muted>{fmt(emp.ccTips)}</Mono>,
                        <Mono muted>{fmt(emp.cashTips)}</Mono>,
                        <Mono yellow bold>{fmt(emp.totalTips)}</Mono>,
                        <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                          onToggle={() => togglePayout(emp.name, wk, emp.totalTips, payout.paid)} />,
                      ]} />
                    );
                  })}
                  {/* Daily totals row */}
                  {(() => {
                    const filtered = day.employees.filter((e) => e.hours > 0 || e.totalTips > 0);
                    return filtered.length > 0 ? (
                      <TotalFooter items={[
                        { label: "Total CC Tips",   value: fmt(filtered.reduce((s, e) => s + (e.ccTips   || 0), 0)), color: "var(--text-muted)" },
                        { label: "Total Cash Tips", value: fmt(filtered.reduce((s, e) => s + (e.cashTips || 0), 0)), color: "var(--text-muted)" },
                        { label: "Day Total",       value: fmt(filtered.reduce((s, e) => s + (e.totalTips || 0), 0)), color: "var(--yellow)", bold: true },
                      ]} />
                    ) : null;
                  })()}
                </>
              )}
            </Panel>
          ))}
        </div>
      )}

      {/* ── Tips History ── */}
      {activeView === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, background: "var(--yellow-dim)", border: "1px solid rgba(246,201,14,0.2)", color: "var(--text-muted)", lineHeight: 1.6 }}>
            All weeks from the <strong>Tips [Past Weeks]</strong> sheet, newest first. Weekly tip totals per employee.
          </div>

          {allWeeks.length === 0 ? (
            <Panel><Empty text="No week history found in Past Weeks sheet" /></Panel>
          ) : allWeeks.map((week) => {
            const weekTotal = week.weeklyTipsTotal || 0;
            const wk = makeWeekKey("history", week.weekLabel);
            return (
              <Panel key={week.weekLabel}>
                <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{week.weekLabel}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow)", fontWeight: 700, fontSize: 13 }}>
                    {fmt(weekTotal)} total
                  </span>
                </div>
                {isMobile ? (
                  <div>
                    {week.employees.map((emp, idx) => {
                      const payout = getPayout(wk, emp.name);
                      const sk     = `${wk}::${emp.name}`;
                      return (
                        <div key={emp.name} style={{
                          padding: "10px 14px",
                          borderBottom: idx < week.employees.length - 1 ? "1px solid var(--border)" : "none",
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 500, fontSize: 13 }}>{emp.name}</span>
                            <EmployeeBadges name={emp.name} position={emp.position} />
                          </div>
                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow)", fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
                            {fmt(emp.weeklyTips)}
                          </span>
                          <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                            onToggle={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <TableHeader cols={["Employee", "Position", "Weekly Tips", "Tips Paid Out?"]} />
                    {week.employees.map((emp, idx) => {
                      const payout = getPayout(wk, emp.name);
                      const sk     = `${wk}::${emp.name}`;
                      return (
                        <TableRow key={emp.name} cols={4} last={idx === week.employees.length - 1} cells={[
                          <Name>{emp.name}</Name>,
                          <EmployeeBadges name={emp.name} position={emp.position} />,
                          <Mono yellow bold>{fmt(emp.weeklyTips)}</Mono>,
                          <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                            onToggle={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />,
                        ]} />
                      );
                    })}
                    <TotalFooter items={[
                      { label: "Paid Out",   value: fmt(week.employees.filter((e) => getPayout(wk, e.name).paid).reduce((s, e) => s + e.weeklyTips, 0)), color: "var(--green)" },
                      { label: "Unpaid",     value: fmt(week.employees.filter((e) => !getPayout(wk, e.name).paid).reduce((s, e) => s + e.weeklyTips, 0)), color: "var(--text-muted)" },
                      { label: "Week Total", value: fmt(weekTotal), color: "var(--yellow)", bold: true },
                    ]} />
                  </>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {/* ── Hourly Rate Settings ── */}
      {activeView === "wage_settings" && (
        <Panel>
          <PanelHeader
            title="Hourly Rate Settings"
            hint="Set hourly rates per role. Employees with both FOH and BOH roles (like Sunny and My) have separate rates for each. Rates are saved to Notion."
          />
          {allEmployeeNames.length === 0 ? <Empty text="No employees found in Google Sheet" /> : (
            allEmployeeNames.map((emp, i) => {
              // Detect which roles this employee has worked across both sheets.
              // For dual-role employees, roleHours contains { FOH: x, BOH: y }.
              const empRoles = new Set();
              for (const sheetData of [current, past]) {
                for (const day of sheetData.dailyBlocks) {
                  const found = day.employees.find((e) => e.name === emp);
                  if (!found) continue;
                  if (found.roleHours) {
                    // Dual-role employee — add each role that has hours
                    Object.entries(found.roleHours).forEach(([role, hrs]) => {
                      if (hrs > 0) empRoles.add(role);
                    });
                  } else if (found.hours > 0) {
                    empRoles.add(normalizeRole(found.position));
                  }
                }
              }
              // Always show at least their primary role from weekly summary
              const primaryPos = current.employees.find((e) => e.name === emp)?.position
                              || past.employees.find((e) => e.name === emp)?.position || "FOH";
              if (empRoles.size === 0) empRoles.add(normalizeRole(primaryPos));

              const roles = [...empRoles].sort(); // FOH before BOH alphabetically

              return (
                <div key={emp} style={{
                  padding: isMobile ? "12px 14px" : "14px 18px",
                  borderBottom: i < allEmployeeNames.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  {/* Employee name + role rate rows */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500, fontSize: isMobile ? 13 : 14, minWidth: 80, paddingTop: roles.length > 1 ? 8 : 0 }}>{emp}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                      {roles.map((role) => {
                        const key        = `${emp}::${role}`;
                        const isSaved    = String(savedWages[key]) === String(wages[key]);
                        return (
                          <div key={role} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Badge pos={role}>{role}</Badge>
                            <span style={{ color: "var(--text-dim)", fontSize: 13 }}>$</span>
                            <input
                              type="number" min="0" step="0.25"
                              value={wages[key] !== undefined ? wages[key] : ""}
                              onChange={(e) => setWages((w) => ({ ...w, [key]: e.target.value }))}
                              placeholder="0.00"
                              style={{ width: isMobile ? 72 : 90, padding: "7px 8px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}
                            />
                            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>/hr</span>
                            <button
                              onClick={() => saveWage(emp, role, wages[key] || 0)}
                              disabled={saving[key]}
                              style={{
                                padding: "7px 12px", borderRadius: 7,
                                background: isSaved ? "var(--surface2)" : "var(--accent)",
                                color: isSaved ? "var(--text-muted)" : "#000",
                                fontSize: 12, fontWeight: 600, transition: "all 0.15s ease",
                                opacity: saving[key] ? 0.7 : 1, cursor: "pointer", border: "none",
                              }}
                            >
                              {saving[key] ? "…" : isSaved ? "✓" : "Save"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Mobile card components ─────────────────────────────────

function BiweeklyEmployeeCard({ emp, last }) {
  return (
    <div style={{ padding: "14px 14px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</span>
        {emp.isDualRole
          ? emp.roleBreakdown.map((rb) => <Badge key={rb.role} pos={rb.role}>{rb.role}</Badge>)
          : <Badge pos={emp.position}>{emp.position}</Badge>
        }
        <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>{emp.daysWorked.length} day{emp.daysWorked.length !== 1 ? "s" : ""}</span>
      </div>
      {emp.isDualRole ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {emp.roleBreakdown.map((rb) => (
            <div key={rb.role} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              <MiniStat label={`${rb.role} Hrs`}  value={`${rb.hours.toFixed(1)}h`} />
              <MiniStat label={`${rb.role} Rate`} value={rb.rate ? `$${rb.rate}/h` : "—"} warn={!rb.rate} />
              <MiniStat label={`${rb.role} Pay`}  value={rb.rate ? fmt(rb.pay) : "—"} color="var(--blue)" />
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginTop: 2 }}>
            <MiniStat label="Total Hours" value={`${emp.hours.toFixed(1)}h`} />
            <MiniStat label="Est. Wages"  value={fmt(emp.grossPay)} color="var(--accent)" />
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <MiniStat label="Total Hours" value={`${emp.hours.toFixed(1)}h`} />
          <MiniStat label="Rate"        value={emp.roleBreakdown[0]?.rate ? `$${emp.roleBreakdown[0].rate}/h` : "—"} warn={!emp.roleBreakdown[0]?.rate} />
          <MiniStat label="Est. Wages"  value={emp.grossPay > 0 ? fmt(emp.grossPay) : "—"} color="var(--blue)" />
        </div>
      )}
    </div>
  );
}

function EmployeeCard({ emp, last, payout, saving, onTogglePayout, employeeRolesMap }) {
  return (
    <div style={{ padding: "14px 14px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</span>
          {employeeRolesMap?.[emp.name]?.size > 1
            ? [...(employeeRolesMap[emp.name])].sort((a,b) => a === "FOH" ? -1 : 1).map((r) => <Badge key={r} pos={r}>{r}</Badge>)
            : <Badge pos={emp.position}>{emp.position}</Badge>
          }
        </div>
        <PayoutButton paid={payout.paid} saving={saving} onToggle={onTogglePayout} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
        <MiniStat label="Hours This Wk" value={`${emp.hours.toFixed(1)}h`} />
        <MiniStat label="Weekly Tips"   value={fmt(emp.weeklyTips)} color="var(--yellow)" />
      </div>
    </div>
  );
}

function DailyEmployeeCard({ emp, last, payout, saving, onTogglePayout, employeeRolesMap }) {
  return (
    <div style={{ padding: "12px 14px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</span>
          {employeeRolesMap?.[emp.name]?.size > 1
            ? [...(employeeRolesMap[emp.name])].sort((a,b) => a === "FOH" ? -1 : 1).map((r) => <Badge key={r} pos={r}>{r}</Badge>)
            : <Badge pos={emp.position}>{emp.position}</Badge>
          }
        </div>
        <PayoutButton paid={payout.paid} saving={saving} onToggle={onTogglePayout} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <MiniStat label="Hours"     value={`${emp.hours.toFixed(1)}h`} />
        <MiniStat label="CC Tips"   value={fmt(emp.ccTips)}   color="var(--text-muted)" />
        <MiniStat label="Cash Tips" value={fmt(emp.cashTips)} color="var(--text-muted)" />
        <MiniStat label="Total"     value={fmt(emp.totalTips)} color="var(--yellow)" />
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, warn }) {
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 6, padding: "5px 8px" }}>
      <div style={{ fontSize: 9, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: warn ? "var(--red)" : color || "var(--text)" }}>
        {warn ? "⚠ " : ""}{value}
      </div>
    </div>
  );
}

function MobileTotalFooter({ label, value, color }) {
  return (
    <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

// ── Payout button ──────────────────────────────────────────

function PayoutButton({ paid, saving, onToggle }) {
  const [hover, setHover] = useState(false);
  if (saving) return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: "var(--surface2)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}>
      <Spinner /> Saving…
    </div>
  );
  if (paid) return (
    <button onClick={onToggle} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Click to mark as unpaid"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: hover ? "rgba(79,216,122,0.05)" : "var(--accent-dim)", border: "1px solid var(--accent-glow)", color: "var(--accent)", fontSize: 11, fontWeight: 600, transition: "all 0.15s ease" }}>
      <span>✓</span>{hover ? "Undo" : "Paid"}
    </button>
  );
  return (
    <button onClick={onToggle} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Click to mark tips as paid out"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: hover ? "var(--yellow-dim)" : "var(--surface2)", border: `1px solid ${hover ? "rgba(246,201,14,0.3)" : "var(--border)"}`, color: hover ? "var(--yellow)" : "var(--text-dim)", fontSize: 11, fontWeight: 500, transition: "all 0.15s ease" }}>
      <span>○</span>{hover ? "Mark paid" : "Unpaid"}
    </button>
  );
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 10, height: 10, border: "1.5px solid var(--border)", borderTopColor: "var(--text-muted)", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />;
}

// ── Layout helpers ─────────────────────────────────────────

function StatCard({ label, value, color, hint }) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 20px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1, lineHeight: 1.4 }}>{label}</div>
        {hint && (
          <button onMouseEnter={() => setShowHint(true)} onMouseLeave={() => setShowHint(false)}
            style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10, cursor: "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 6 }}>?</button>
        )}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color, letterSpacing: "-1px" }}>{value}</div>
      {showHint && hint && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, zIndex: 10, boxShadow: "var(--shadow)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function PanelHeader({ title, hint }) {
  return (
    <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: hint ? 4 : 0 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function Panel({ children }) {
  return <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>{children}</div>;
}

function TableHeader({ cols }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
      {cols.map((c) => <span key={c} style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{c}</span>)}
    </div>
  );
}

function TableRow({ cells, cols, last }) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "grid", gridTemplateColumns: `repeat(${cols || cells.length}, 1fr)`, padding: "11px 18px", borderBottom: last ? "none" : "1px solid var(--border)", background: hover ? "var(--surface2)" : "transparent", transition: "background 0.1s ease", alignItems: "center", fontSize: 13 }}>
      {cells.map((cell, i) => <div key={i}>{cell}</div>)}
    </div>
  );
}

function TotalFooter({ items }) {
  return (
    <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 28 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.label}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: item.bold ? 15 : 13, fontWeight: item.bold ? 700 : 500, color: item.color || "var(--text)" }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function Name({ children }) { return <span style={{ fontWeight: 500 }}>{children}</span>; }

function Badge({ pos, children }) {
  const p = String(pos).toLowerCase();
  // Support both old (Server/Kitchen) and new (FOH/BOH) position labels
  const isFront = p.includes("server") || p.includes("foh");
  const isBack  = p.includes("kitchen") || p.includes("boh");
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: isFront ? "var(--blue-dim)" : isBack ? "rgba(251,146,60,0.12)" : "var(--surface2)", color: isFront ? "var(--blue)" : isBack ? "#fb923c" : "var(--text-muted)" }}>
      {children || "—"}
    </span>
  );
}

function Mono({ children, muted, accent, yellow, bold }) {
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: accent ? "var(--accent)" : yellow ? "var(--yellow)" : muted ? "var(--text-muted)" : "var(--text)", fontWeight: bold ? 700 : accent || yellow ? 600 : 400 }}>{children}</span>;
}

function Warn()  { return <span style={{ color: "var(--red)", fontSize: 11 }}>⚠ Not set</span>; }
function Empty({ text }) { return <div style={{ padding: 32, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>{text}</div>; }
