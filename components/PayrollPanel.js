import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "../lib/useIsMobile";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

function makeWeekKey(scope, identifier) {
  return `${scope}:${identifier}`;
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
  const [activeView, setActiveView]     = useState("monthly");

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
        wd.forEach((w) => { wm[w.employee] = w.hourlyRate; });
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

  async function saveWage(employee, rate) {
    setSaving((s) => ({ ...s, [employee]: true }));
    try {
      await fetch("/api/wages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee, hourlyRate: parseFloat(rate) }),
      });
      setSavedWages((s) => ({ ...s, [employee]: parseFloat(rate) }));
    } finally {
      setSaving((s) => ({ ...s, [employee]: false }));
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

  // All unique employee names across both sheets
  const allEmployeeNames = [...new Set([
    ...current.employees.map((e) => e.name),
    ...past.employees.map((e) => e.name),
  ])].filter(Boolean).sort();

  // Build payroll for a single sheet (hours summed from daily blocks for that sheet)
  function buildPayroll(sheetData) {
    return sheetData.employees.map((emp) => {
      const rate  = savedWages[emp.name] || 0;
      const hours = sheetData.dailyBlocks.reduce((sum, day) => {
        const de = day.employees.find((e) => e.name === emp.name);
        return sum + (de?.hours || 0);
      }, 0);
      return { name: emp.name, position: emp.position, hours, rate, grossPay: hours * rate, weeklyTips: emp.weeklyTips || 0 };
    });
  }

  // Monthly summary: combine current + past week hours and tips
  function buildMonthlyPayroll() {
    return allEmployeeNames.map((name) => {
      const rate = savedWages[name] || 0;
      const pos  = current.employees.find((e) => e.name === name)?.position
                || past.employees.find((e) => e.name === name)?.position || "";

      // Hours from current week daily blocks
      const currentHours = current.dailyBlocks.reduce((sum, day) => {
        const de = day.employees.find((e) => e.name === name);
        return sum + (de?.hours || 0);
      }, 0);
      // Hours from past week daily blocks
      const pastHours = past.dailyBlocks.reduce((sum, day) => {
        const de = day.employees.find((e) => e.name === name);
        return sum + (de?.hours || 0);
      }, 0);

      const totalHours = currentHours + pastHours;

      // Tips from both weeks
      const currentTips = current.employees.find((e) => e.name === name)?.weeklyTips || 0;
      const pastTips    = past.employees.find((e) => e.name === name)?.weeklyTips    || 0;
      const totalTips   = currentTips + pastTips;

      return {
        name, position: pos, rate,
        currentHours, pastHours, totalHours,
        currentTips, pastTips, totalTips,
        grossPay: totalHours * rate,
      };
    }).filter((e) => e.totalHours > 0 || e.totalTips > 0);
  }

  const currentPayroll = buildPayroll(current);
  const pastPayroll    = buildPayroll(past);
  const monthlyPayroll = buildMonthlyPayroll();

  const totalCurrentWages  = currentPayroll.reduce((s, e) => s + e.grossPay, 0);
  const totalCurrentTips   = current.weeklyTipsTotal || 0;
  const totalPastWages     = pastPayroll.reduce((s, e) => s + e.grossPay, 0);
  const totalPastTips      = past.weeklyTipsTotal || 0;
  const totalMonthlyWages  = monthlyPayroll.reduce((s, e) => s + e.grossPay, 0);
  const totalMonthlyTips   = monthlyPayroll.reduce((s, e) => s + e.totalTips, 0);

  const subViews = [
    { id: "monthly", label: isMobile ? "Monthly" : "Monthly Summary",    desc: "Combined hours + wages across all tracked weeks" },
    { id: "current", label: isMobile ? "This Week" : "This Week's Tips", desc: `${current.weekLabel || "Current week"} — weekly tip totals per employee` },
    { id: "past",    label: isMobile ? "Last Week" : "Last Week's Tips", desc: `${past.weekLabel || "Past week"} — weekly tip totals per employee` },
    { id: "daily",   label: isMobile ? "Daily" : "Daily Tip Breakdown",  desc: "Per-day tip distribution pulled from Google Sheets" },
    { id: "wages",   label: isMobile ? "Wages" : "Hourly Wage Settings", desc: "Set each employee's hourly rate" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24 }}>

      {/* Summary cards — show monthly totals at the top */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
        {isMobile ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Monthly Totals — {past.weekLabel} + {current.weekLabel}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
              {[
                { label: "Wages (est.)", value: fmt(totalMonthlyWages), color: "var(--blue)" },
                { label: "Tips Total",  value: fmt(totalMonthlyTips),  color: "var(--yellow)" },
                { label: "Total Pay",   value: fmt(totalMonthlyWages + totalMonthlyTips), color: "var(--accent)" },
              ].map((item, i) => (
                <div key={item.label} style={{ textAlign: i === 1 ? "center" : i === 2 ? "right" : "left" }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <StatCard
              label={`Estimated Wages — ${past.weekLabel || ""}  +  ${current.weekLabel || ""}`}
              value={fmt(totalMonthlyWages)}
              color="var(--blue)"
              hint="Hours × hourly rate across both tracked weeks"
            />
            <StatCard
              label="Total Tips — Both Weeks"
              value={fmt(totalMonthlyTips)}
              color="var(--yellow)"
              hint="Sum of weekly tip totals from Google Sheets"
            />
            <StatCard
              label="Estimated Monthly Payroll"
              value={fmt(totalMonthlyWages + totalMonthlyTips)}
              color="var(--accent)"
              hint="Wages estimate + tips. Confirm with your actual pay period."
            />
          </>
        )}
      </div>

      {/* Disclaimer */}
      <div style={{
        padding: "10px 14px", borderRadius: 8, fontSize: 12,
        background: "var(--yellow-dim)", border: "1px solid rgba(246,201,14,0.2)",
        color: "var(--text-muted)", lineHeight: 1.6,
      }}>
        <strong style={{ color: "var(--yellow)" }}>Note:</strong> Wages are estimated from the two weeks currently visible in your Google Sheet (This Week + Last Week). Tips are tracked weekly. Payroll totals above are a reference — confirm with your actual pay period dates before processing payroll.
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: isMobile ? 0 : 4, borderBottom: "1px solid var(--border)" }}>
        {subViews.map((v) => (
          <button key={v.id} onClick={() => setActiveView(v.id)} style={{
            flex: isMobile ? 1 : "initial",
            padding: isMobile ? "10px 4px" : "8px 14px",
            fontSize: isMobile ? 10 : 12, textAlign: "center",
            fontWeight: activeView === v.id ? 600 : 400,
            color: activeView === v.id ? "var(--text)" : "var(--text-muted)",
            borderBottom: `2px solid ${activeView === v.id ? "var(--accent)" : "transparent"}`,
            transition: "all 0.15s ease", background: "none", border: "none",
            borderBottom: `2px solid ${activeView === v.id ? "var(--accent)" : "transparent"}`,
            cursor: "pointer",
          }}>{v.label}</button>
        ))}
      </div>

      {/* ── Monthly Summary ── */}
      {activeView === "monthly" && (
        <Panel>
          <PanelHeader
            title={`Monthly Payroll Estimate — ${past.weekLabel || "Last Week"} + ${current.weekLabel || "This Week"}`}
            hint="Aggregates hours and tips from both tracked weeks. Wages = Total Hours × Hourly Rate."
          />
          {isMobile ? (
            monthlyPayroll.length === 0 ? <Empty text="No data found in Google Sheets" /> : (
              <div>
                {monthlyPayroll.map((emp, i) => (
                  <MonthlyEmployeeCard key={emp.name} emp={emp} last={i === monthlyPayroll.length - 1} />
                ))}
                <MobileTotalFooter
                  wages={totalMonthlyWages}
                  tips={totalMonthlyTips}
                  total={totalMonthlyWages + totalMonthlyTips}
                />
              </div>
            )
          ) : (
            <>
              <TableHeader cols={["Employee", "Position", "Last Wk Hrs", "This Wk Hrs", "Total Hrs", "Rate/hr", "Est. Wages", "Total Tips", "Est. Total Pay"]} />
              {monthlyPayroll.length === 0 ? <Empty text="No data found in Google Sheets" /> : (
                monthlyPayroll.map((emp, i) => (
                  <TableRow key={emp.name} cols={9} last={i === monthlyPayroll.length - 1} cells={[
                    <Name>{emp.name}</Name>,
                    <Badge pos={emp.position}>{emp.position}</Badge>,
                    <Mono muted>{emp.pastHours.toFixed(2)}</Mono>,
                    <Mono muted>{emp.currentHours.toFixed(2)}</Mono>,
                    <Mono>{emp.totalHours.toFixed(2)} hrs</Mono>,
                    <Mono muted>{emp.rate ? fmt(emp.rate) : <Warn />}</Mono>,
                    <Mono accent>{emp.rate ? fmt(emp.grossPay) : "—"}</Mono>,
                    <Mono yellow>{fmt(emp.totalTips)}</Mono>,
                    <Mono accent bold>{emp.rate ? fmt(emp.grossPay + emp.totalTips) : "—"}</Mono>,
                  ]} />
                ))
              )}
              {monthlyPayroll.length > 0 && (
                <TotalFooter items={[
                  { label: "Est. Total Wages",  value: fmt(totalMonthlyWages) },
                  { label: "Total Tips",         value: fmt(totalMonthlyTips),  color: "var(--yellow)" },
                  { label: "Est. Monthly Total", value: fmt(totalMonthlyWages + totalMonthlyTips), color: "var(--accent)", bold: true },
                ]} />
              )}
            </>
          )}
        </Panel>
      )}

      {/* ── This Week's Tips ── */}
      {activeView === "current" && (
        <Panel>
          <PanelHeader
            title={`${current.weekLabel || "This Week"} — Weekly Tip Totals`}
            hint="Each employee's total tips for this week, pulled from Google Sheets. Hours shown are from this week only."
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
                <MobileTotalFooter wages={totalCurrentWages} tips={totalCurrentTips} total={totalCurrentWages + totalCurrentTips} />
              </div>
            )
          ) : (
            <>
              <TableHeader cols={["Employee", "Position", "Hours This Week", "Rate/hr", "Wage (This Wk Only)", "Weekly Tips", "Tips Paid Out?"]} />
              {currentPayroll.length === 0 ? <Empty text="No data in current week sheet" /> : (
                currentPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("current", current.weekLabel || "current");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  return (
                    <TableRow key={emp.name} cols={7} last={i === currentPayroll.length - 1} cells={[
                      <Name>{emp.name}</Name>,
                      <Badge pos={emp.position}>{emp.position}</Badge>,
                      <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                      <Mono muted>{emp.rate ? fmt(emp.rate) : <Warn />}</Mono>,
                      <Mono muted>{emp.rate ? fmt(emp.grossPay) : "—"}</Mono>,
                      <Mono yellow>{fmt(emp.weeklyTips)}</Mono>,
                      <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                        onToggle={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />,
                    ]} />
                  );
                })
              )}
              {currentPayroll.length > 0 && (
                <TotalFooter items={[
                  { label: "Wages (this week only)", value: fmt(totalCurrentWages), color: "var(--text-muted)" },
                  { label: "Weekly Tips Pool",        value: fmt(totalCurrentTips),  color: "var(--yellow)" },
                ]} />
              )}
            </>
          )}
        </Panel>
      )}

      {/* ── Last Week's Tips ── */}
      {activeView === "past" && (
        <Panel>
          <PanelHeader
            title={`${past.weekLabel || "Last Week"} — Weekly Tip Totals`}
            hint="Each employee's total tips for last week, pulled from Google Sheets. Hours shown are from that week only."
          />
          {isMobile ? (
            pastPayroll.length === 0 ? <Empty text="No data in past weeks sheet" /> : (
              <div>
                <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>
                  {past.weekLabel} — cumulative hours for that week
                </div>
                {pastPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("past", past.weekLabel || "past");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  return (
                    <EmployeeCard key={emp.name} emp={emp} last={i === pastPayroll.length - 1}
                      payout={payout} saving={!!payoutSaving[sk]}
                      onTogglePayout={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />
                  );
                })}
              </div>
            )
          ) : (
            <>
              <TableHeader cols={["Employee", "Position", "Hours Last Week", "Rate/hr", "Wage (Last Wk Only)", "Weekly Tips", "Tips Paid Out?"]} />
              {pastPayroll.length === 0 ? <Empty text="No data in past weeks sheet" /> : (
                pastPayroll.map((emp, i) => {
                  const wk     = makeWeekKey("past", past.weekLabel || "past");
                  const payout = getPayout(wk, emp.name);
                  const sk     = `${wk}::${emp.name}`;
                  return (
                    <TableRow key={emp.name} cols={7} last={i === pastPayroll.length - 1} cells={[
                      <Name>{emp.name}</Name>,
                      <Badge pos={emp.position}>{emp.position}</Badge>,
                      <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                      <Mono muted>{emp.rate ? fmt(emp.rate) : <Warn />}</Mono>,
                      <Mono muted>{emp.rate ? fmt(emp.grossPay) : "—"}</Mono>,
                      <Mono yellow>{fmt(emp.weeklyTips)}</Mono>,
                      <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                        onToggle={() => togglePayout(emp.name, wk, emp.weeklyTips, payout.paid)} />,
                    ]} />
                  );
                })
              )}
              {pastPayroll.length > 0 && (
                <TotalFooter items={[
                  { label: "Wages (last week only)", value: fmt(totalPastWages),  color: "var(--text-muted)" },
                  { label: "Weekly Tips Pool",        value: fmt(totalPastTips),   color: "var(--yellow)" },
                ]} />
              )}
            </>
          )}
        </Panel>
      )}

      {/* ── Daily Tip Breakdown ── */}
      {activeView === "daily" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <InfoBanner>
            Tip amounts distributed per employee per day, based on hours worked and shift type. Pulled live from Google Sheets. Use the <strong>Tips Paid Out?</strong> button to mark daily tips as distributed.
          </InfoBanner>
          {current.dailyBlocks.length === 0 && <Panel><Empty text="No daily data found in current week sheet" /></Panel>}
          {current.dailyBlocks.map((day) => (
            <Panel key={day.date}>
              <div style={{
                padding: "12px 14px", borderBottom: "1px solid var(--border)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{day.dayName}</span>
                  <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: 8, fontFamily: "var(--font-mono)" }}>{day.date}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow)", fontWeight: 600, fontSize: 12 }}>
                  Daily Pool: {fmt(day.employees.reduce((s, e) => s + (e.totalTips || 0), 0))}
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
                        payout={payout} saving={!!payoutSaving[sk]}
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
                        <Badge pos={emp.position}>{emp.position}</Badge>,
                        <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                        <Mono muted>{fmt(emp.ccTips)}</Mono>,
                        <Mono muted>{fmt(emp.cashTips)}</Mono>,
                        <Mono yellow>{fmt(emp.totalTips)}</Mono>,
                        <PayoutButton paid={payout.paid} saving={!!payoutSaving[sk]}
                          onToggle={() => togglePayout(emp.name, wk, emp.totalTips, payout.paid)} />,
                      ]} />
                    );
                  })}
                </>
              )}
            </Panel>
          ))}
        </div>
      )}

      {/* ── Hourly Wage Settings ── */}
      {activeView === "wages" && (
        <Panel>
          <PanelHeader
            title="Hourly Wage Settings"
            hint="Set each employee's hourly rate. Used to calculate estimated wages. Rates are saved to your Notion database."
          />
          {allEmployeeNames.length === 0 ? <Empty text="No employees found in Google Sheet" /> : (
            allEmployeeNames.map((emp, i) => (
              <div key={emp} style={{
                padding: isMobile ? "12px 14px" : "14px 18px",
                borderBottom: i < allEmployeeNames.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ flex: 1, fontWeight: 500, fontSize: isMobile ? 13 : 14 }}>{emp}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 13 }}>$</span>
                  <input
                    type="number" min="0" step="0.25"
                    value={wages[emp] !== undefined ? wages[emp] : ""}
                    onChange={(e) => setWages((w) => ({ ...w, [emp]: e.target.value }))}
                    placeholder="0.00"
                    style={{ width: isMobile ? 72 : 90, padding: "7px 8px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>/hr</span>
                  <button
                    onClick={() => saveWage(emp, wages[emp] || 0)}
                    disabled={saving[emp]}
                    style={{
                      padding: "7px 12px", borderRadius: 7,
                      background: String(savedWages[emp]) === String(wages[emp]) ? "var(--surface2)" : "var(--accent)",
                      color: String(savedWages[emp]) === String(wages[emp]) ? "var(--text-muted)" : "#000",
                      fontSize: 12, fontWeight: 600, transition: "all 0.15s ease",
                      opacity: saving[emp] ? 0.7 : 1, cursor: "pointer", border: "none",
                    }}
                  >
                    {saving[emp] ? "…" : String(savedWages[emp]) === String(wages[emp]) ? "✓ Saved" : "Save"}
                  </button>
                </div>
              </div>
            ))
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Mobile card components ─────────────────────────────────

function MonthlyEmployeeCard({ emp, last }) {
  return (
    <div style={{ padding: "14px 14px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</span>
        <Badge pos={emp.position}>{emp.position}</Badge>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 6 }}>
        <MiniStat label="Last Wk Hrs" value={`${emp.pastHours.toFixed(1)}h`} />
        <MiniStat label="This Wk Hrs" value={`${emp.currentHours.toFixed(1)}h`} />
        <MiniStat label="Total Hrs"   value={`${emp.totalHours.toFixed(1)}h`} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <MiniStat label="Rate"       value={emp.rate ? `$${emp.rate}/h` : "—"} warn={!emp.rate} />
        <MiniStat label="Est. Wages" value={emp.rate ? fmt(emp.grossPay) : "—"} color="var(--accent)" />
        <MiniStat label="Total Tips" value={fmt(emp.totalTips)} color="var(--yellow)" />
      </div>
    </div>
  );
}

function EmployeeCard({ emp, last, payout, saving, onTogglePayout }) {
  return (
    <div style={{ padding: "14px 14px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</span>
          <Badge pos={emp.position}>{emp.position}</Badge>
        </div>
        <PayoutButton paid={payout.paid} saving={saving} onToggle={onTogglePayout} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <MiniStat label="Hours"        value={`${emp.hours.toFixed(1)}h`} />
        <MiniStat label="Rate"         value={emp.rate ? `$${emp.rate}/h` : "—"} warn={!emp.rate} />
        <MiniStat label="Wage (wk)"    value={emp.rate ? fmt(emp.grossPay) : "—"} color="var(--accent)" />
        <MiniStat label="Weekly Tips"  value={fmt(emp.weeklyTips)} color="var(--yellow)" />
      </div>
    </div>
  );
}

function DailyEmployeeCard({ emp, last, payout, saving, onTogglePayout }) {
  return (
    <div style={{ padding: "12px 14px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</span>
          <Badge pos={emp.position}>{emp.position}</Badge>
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

function MobileTotalFooter({ wages, tips, total }) {
  return (
    <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Est. Wages</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--blue)" }}>{fmt(wages)}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tips</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--yellow)" }}>{fmt(tips)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Est. Total</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>{fmt(total)}</div>
      </div>
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
          <button
            onMouseEnter={() => setShowHint(true)}
            onMouseLeave={() => setShowHint(false)}
            style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10, cursor: "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 6 }}
          >?</button>
        )}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color, letterSpacing: "-1px" }}>{value}</div>
      {showHint && hint && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, zIndex: 10, boxShadow: "var(--shadow)" }}>
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

function InfoBanner({ children }) {
  return (
    <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, background: "var(--blue-dim)", border: "1px solid rgba(96,165,250,0.2)", color: "var(--text-muted)", lineHeight: 1.6 }}>
      {children}
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
  const isServer  = String(pos).toLowerCase().includes("server");
  const isKitchen = String(pos).toLowerCase().includes("kitchen");
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: isServer ? "var(--blue-dim)" : isKitchen ? "rgba(251,146,60,0.12)" : "var(--surface2)", color: isServer ? "var(--blue)" : isKitchen ? "#fb923c" : "var(--text-muted)" }}>
      {children || "—"}
    </span>
  );
}

function Mono({ children, muted, accent, yellow, bold }) {
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: accent ? "var(--accent)" : yellow ? "var(--yellow)" : muted ? "var(--text-muted)" : "var(--text)", fontWeight: bold ? 700 : accent || yellow ? 600 : 400 }}>{children}</span>;
}

function Warn()  { return <span style={{ color: "var(--red)", fontSize: 11 }}>⚠ Not set</span>; }
function Empty({ text }) { return <div style={{ padding: 32, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>{text}</div>; }
