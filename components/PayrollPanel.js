import { useState, useEffect } from "react";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export default function PayrollPanel() {
  const [sheetsData, setSheetsData] = useState(null);
  const [wages, setWages] = useState({});
  const [savedWages, setSavedWages] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("current");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [sheetsRes, wagesRes] = await Promise.all([
          fetch("/api/sheets"),
          fetch("/api/wages"),
        ]);
        if (sheetsRes.ok) setSheetsData(await sheetsRes.json());
        if (wagesRes.ok) {
          const wagesData = await wagesRes.json();
          const wMap = {};
          wagesData.forEach((w) => { wMap[w.employee] = w.hourlyRate; });
          setSavedWages(wMap);
          setWages(wMap);
        }
      } catch (e) {
        setError("Failed to load payroll data: " + e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function saveWage(employee, rate) {
    setSaving((s) => ({ ...s, [employee]: true }));
    try {
      const res = await fetch("/api/wages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee, hourlyRate: parseFloat(rate) }),
      });
      if (res.ok) setSavedWages((s) => ({ ...s, [employee]: parseFloat(rate) }));
    } finally {
      setSaving((s) => ({ ...s, [employee]: false }));
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="loading-skeleton" style={{ height: 60, borderRadius: 10 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "var(--red)", background: "var(--red-dim)", borderRadius: 10, fontSize: 13 }}>
        {error}
      </div>
    );
  }

  // sheetsData: { current: { weekLabel, employees, weeklyTipsTotal, weeklyTips, dailyBlocks }, past: {...} }
  const current = sheetsData?.current || { employees: [], weeklyTipsTotal: 0, dailyBlocks: [], weeklyTips: {} };
  const past    = sheetsData?.past    || { employees: [], weeklyTipsTotal: 0, dailyBlocks: [], weeklyTips: {} };

  // All unique employees (union from both sheets)
  const allEmployeeNames = [...new Set([
    ...current.employees.map((e) => e.name),
    ...past.employees.map((e) => e.name),
  ])].filter(Boolean).sort();

  // Current week payroll calculation
  const currentPayroll = current.employees.map((emp) => {
    const rate = savedWages[emp.name] || 0;
    // Sum hours across all daily blocks for this employee
    const totalHours = current.dailyBlocks.reduce((sum, day) => {
      const dayEmp = day.employees.find((e) => e.name === emp.name);
      return sum + (dayEmp?.hours || 0);
    }, 0);
    return {
      name: emp.name,
      position: emp.position,
      hours: totalHours,
      rate,
      grossPay: totalHours * rate,
      weeklyTips: emp.weeklyTips || 0,
    };
  });

  // Past weeks payroll
  const pastPayroll = past.employees.map((emp) => {
    const rate = savedWages[emp.name] || 0;
    const totalHours = past.dailyBlocks.reduce((sum, day) => {
      const dayEmp = day.employees.find((e) => e.name === emp.name);
      return sum + (dayEmp?.hours || 0);
    }, 0);
    return {
      name: emp.name,
      position: emp.position,
      hours: totalHours,
      rate,
      grossPay: totalHours * rate,
      weeklyTips: emp.weeklyTips || 0,
    };
  });

  const totalCurrentWages = currentPayroll.reduce((s, e) => s + e.grossPay, 0);
  const totalCurrentTips  = current.weeklyTipsTotal || 0;

  const subViews = [
    { id: "current", label: "Current Week" },
    { id: "past",    label: "Past Weeks" },
    { id: "daily",   label: "Daily Breakdown" },
    { id: "wages",   label: "Wage Settings" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <StatCard label={`Wages — ${current.weekLabel || "Current Week"}`} value={fmt(totalCurrentWages)} color="var(--blue)" />
        <StatCard label="Tips Pool — Current Week" value={fmt(totalCurrentTips)} color="var(--yellow)" />
        <StatCard label="Total Payroll" value={fmt(totalCurrentWages + totalCurrentTips)} color="var(--accent)" />
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
        {subViews.map((v) => (
          <button key={v.id} onClick={() => setActiveView(v.id)}
            style={{
              padding: "8px 14px", fontSize: 12,
              fontWeight: activeView === v.id ? 600 : 400,
              color: activeView === v.id ? "var(--text)" : "var(--text-muted)",
              borderBottom: `2px solid ${activeView === v.id ? "var(--accent)" : "transparent"}`,
              transition: "all 0.15s ease", background: "none", border: "none",
              borderBottom: `2px solid ${activeView === v.id ? "var(--accent)" : "transparent"}`,
              cursor: "pointer",
            }}
          >{v.label}</button>
        ))}
      </div>

      {/* Current Week */}
      {activeView === "current" && (
        <Panel>
          <TableHeader cols={["Employee", "Position", "Hours", "Rate/hr", "Gross Pay", "Tips"]} />
          {currentPayroll.length === 0 ? <Empty text="No data in current week sheet" /> : (
            currentPayroll.map((emp, i) => (
              <TableRow key={emp.name} last={i === currentPayroll.length - 1} cells={[
                <Name>{emp.name}</Name>,
                <Badge pos={emp.position}>{emp.position}</Badge>,
                <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                <Mono muted>{emp.rate ? fmt(emp.rate) : <Warn />}</Mono>,
                <Mono accent>{emp.rate ? fmt(emp.grossPay) : "—"}</Mono>,
                <Mono yellow>{fmt(emp.weeklyTips)}</Mono>,
              ]} />
            ))
          )}
          {currentPayroll.length > 0 && (
            <TotalFooter items={[
              { label: "Total Wages",   value: fmt(totalCurrentWages) },
              { label: "Tips Pool",     value: fmt(totalCurrentTips),                          color: "var(--yellow)" },
              { label: "Total Payroll", value: fmt(totalCurrentWages + totalCurrentTips),       color: "var(--accent)", bold: true },
            ]} />
          )}
        </Panel>
      )}

      {/* Past Weeks */}
      {activeView === "past" && (
        <Panel>
          <div style={{ padding: "10px 18px 0", fontSize: 12, color: "var(--text-dim)" }}>
            {past.weekLabel || "Past weeks"} — cumulative hours across all days
          </div>
          <TableHeader cols={["Employee", "Position", "Hours", "Rate/hr", "Gross Pay", "Tips"]} />
          {pastPayroll.length === 0 ? <Empty text="No data in past weeks sheet" /> : (
            pastPayroll.map((emp, i) => (
              <TableRow key={emp.name} last={i === pastPayroll.length - 1} cells={[
                <Name>{emp.name}</Name>,
                <Badge pos={emp.position}>{emp.position}</Badge>,
                <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                <Mono muted>{emp.rate ? fmt(emp.rate) : <Warn />}</Mono>,
                <Mono accent>{emp.rate ? fmt(emp.grossPay) : "—"}</Mono>,
                <Mono yellow>{fmt(emp.weeklyTips)}</Mono>,
              ]} />
            ))
          )}
        </Panel>
      )}

      {/* Daily Breakdown */}
      {activeView === "daily" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {current.dailyBlocks.length === 0 && <Panel><Empty text="No daily data found" /></Panel>}
          {current.dailyBlocks.map((day) => (
            <Panel key={day.date}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{day.dayName}</span>
                  <span style={{ color: "var(--text-dim)", fontSize: 12, marginLeft: 8, fontFamily: "var(--font-mono)" }}>{day.date}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow)", fontWeight: 600, fontSize: 13 }}>
                  Tips pool: {fmt(day.totalTipsPool)}
                </span>
              </div>
              <TableHeader cols={["Employee", "Position", "Hours", "CC Tips", "Cash Tips", "Total Tips"]} />
              {day.employees.filter((e) => e.hours > 0 || e.totalTips > 0).map((emp, i, arr) => (
                <TableRow key={emp.name} last={i === arr.length - 1} cells={[
                  <Name>{emp.name}</Name>,
                  <Badge pos={emp.position}>{emp.position}</Badge>,
                  <Mono>{emp.hours.toFixed(2)} hrs</Mono>,
                  <Mono muted>{fmt(emp.ccTips)}</Mono>,
                  <Mono muted>{fmt(emp.cashTips)}</Mono>,
                  <Mono yellow>{fmt(emp.totalTips)}</Mono>,
                ]} />
              ))}
            </Panel>
          ))}
        </div>
      )}

      {/* Wage Settings */}
      {activeView === "wages" && (
        <Panel>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Set hourly rates. Employee names are pulled live from your Google Sheet.
            </p>
          </div>
          {allEmployeeNames.length === 0 ? <Empty text="No employees found" /> : (
            allEmployeeNames.map((emp, i) => (
              <div key={emp} style={{
                padding: "14px 18px",
                borderBottom: i < allEmployeeNames.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex", alignItems: "center", gap: 16,
              }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{emp}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 13 }}>$</span>
                  <input
                    type="number" min="0" step="0.25"
                    value={wages[emp] !== undefined ? wages[emp] : ""}
                    onChange={(e) => setWages((w) => ({ ...w, [emp]: e.target.value }))}
                    placeholder="0.00"
                    style={{ width: 90, padding: "7px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>/hr</span>
                  <button
                    onClick={() => saveWage(emp, wages[emp] || 0)}
                    disabled={saving[emp]}
                    style={{
                      padding: "7px 14px", borderRadius: 7,
                      background: String(savedWages[emp]) === String(wages[emp]) ? "var(--surface2)" : "var(--accent)",
                      color: String(savedWages[emp]) === String(wages[emp]) ? "var(--text-muted)" : "#000",
                      fontSize: 12, fontWeight: 600, transition: "all 0.15s ease",
                      opacity: saving[emp] ? 0.7 : 1, cursor: "pointer", border: "none",
                    }}
                  >
                    {saving[emp] ? "..." : String(savedWages[emp]) === String(wages[emp]) ? "Saved ✓" : "Save"}
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

// ── Sub-components ─────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 20px" }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color, letterSpacing: "-1px" }}>{value}</div>
    </div>
  );
}

function Panel({ children }) {
  return <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>{children}</div>;
}

function TableHeader({ cols }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
      {cols.map((c) => <span key={c} style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{c}</span>)}
    </div>
  );
}

function TableRow({ cells, last }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        padding: "12px 18px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        background: hover ? "var(--surface2)" : "transparent",
        transition: "background 0.1s ease", alignItems: "center", fontSize: 13,
      }}
    >
      {cells.map((cell, i) => <div key={i}>{cell}</div>)}
    </div>
  );
}

function TotalFooter({ items }) {
  return (
    <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 28 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.label}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: item.bold ? 15 : 13, fontWeight: item.bold ? 700 : 500, color: item.color || "var(--text)" }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function Name({ children }) {
  return <span style={{ fontWeight: 500 }}>{children}</span>;
}

function Badge({ pos, children }) {
  const isServer  = String(pos).toLowerCase().includes("server");
  const isKitchen = String(pos).toLowerCase().includes("kitchen");
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500,
      background: isServer ? "rgba(96,165,250,0.12)" : isKitchen ? "rgba(251,146,60,0.12)" : "var(--surface2)",
      color: isServer ? "var(--blue)" : isKitchen ? "#fb923c" : "var(--text-muted)",
    }}>{children || "—"}</span>
  );
}

function Mono({ children, muted, accent, yellow }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 13,
      color: accent ? "var(--accent)" : yellow ? "var(--yellow)" : muted ? "var(--text-muted)" : "var(--text)",
      fontWeight: accent || yellow ? 600 : 400,
    }}>{children}</span>
  );
}

function Warn() {
  return <span style={{ color: "var(--red)", fontSize: 11 }}>⚠ Not set</span>;
}

function Empty({ text }) {
  return <div style={{ padding: 32, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>{text}</div>;
}
