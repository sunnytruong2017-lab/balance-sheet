import { useState, useEffect, useRef } from "react";
import { format, subDays, subMonths, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, eachMonthOfInterval, startOfDay, endOfDay } from "date-fns";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtFull = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const RANGES = [
  { id: "7d",  label: "7 Days"   },
  { id: "30d", label: "30 Days"  },
  { id: "90d", label: "90 Days"  },
  { id: "12m", label: "12 Months"},
];

export default function AnalyticsPanel() {
  const [range, setRange]       = useState("30d");
  const [expenses, setExpenses] = useState([]);
  const [income, setIncome]     = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { start, end } = getRangeDates(range);
      try {
        const [expRes, incRes] = await Promise.all([
          fetch(`/api/expenses?startDate=${start}&endDate=${end}`),
          fetch(`/api/income?startDate=${start}&endDate=${end}`),
        ]);
        if (expRes.ok) setExpenses(await expRes.json());
        if (incRes.ok) setIncome(await incRes.json());
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [range]);

  const { start, end } = getRangeDates(range);
  const isMonthly = range === "12m";

  // Build time-series buckets
  const buckets = buildBuckets(expenses, income, start, end, isMonthly);

  // Totals
  const totalIncome   = income.reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount||0), 0);
  const net           = totalIncome - totalExpenses;
  const margin        = totalIncome > 0 ? ((net / totalIncome) * 100).toFixed(1) : "0.0";

  // Expense by category
  const byCategory = {};
  expenses.forEach((e) => {
    const cat = e.category || "Other";
    byCategory[cat] = (byCategory[cat] || 0) + (e.amount || 0);
  });
  const categoryData = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  // Income breakdown
  const incomeBreakdown = {
    "Cash Revenue": income.reduce((s, e) => s + (e.cashRevenue||0), 0),
    "Card Revenue": income.reduce((s, e) => s + (e.cardRevenue||0), 0),
    "Tips (Cash)":  income.reduce((s, e) => s + (e.tipCash||0), 0),
    "Tips (Card)":  income.reduce((s, e) => s + (e.tipCard||0), 0),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Range selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>Analytics</h2>
        <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: range === r.id ? 600 : 400,
              background: range === r.id ? "var(--surface)" : "transparent",
              color: range === r.id ? "var(--text)" : "var(--text-muted)",
              border: range === r.id ? "1px solid var(--border)" : "1px solid transparent",
              cursor: "pointer", transition: "all 0.15s ease",
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Total Revenue"  value={loading ? null : fmtFull(totalIncome)}   color="var(--accent)" />
        <KpiCard label="Total Expenses" value={loading ? null : fmtFull(totalExpenses)} color="var(--red)"    />
        <KpiCard label="Net Profit"     value={loading ? null : fmtFull(net)}           color={net >= 0 ? "var(--accent)" : "var(--red)"} />
        <KpiCard label="Profit Margin"  value={loading ? null : `${margin}%`}           color={parseFloat(margin) >= 0 ? "var(--accent)" : "var(--red)"} />
      </div>

      {/* Main chart — Revenue vs Expenses over time */}
      <ChartCard title="Revenue vs Expenses" subtitle={`${formatRangeLabel(range)}`} loading={loading}>
        <BarChart buckets={buckets} />
      </ChartCard>

      {/* Two column: category breakdown + income breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <ChartCard title="Expenses by Category" loading={loading}>
          <HorizontalBars data={categoryData} total={totalExpenses} color="var(--red)" />
        </ChartCard>
        <ChartCard title="Revenue Breakdown" loading={loading}>
          <HorizontalBars
            data={Object.entries(incomeBreakdown).filter(([, v]) => v > 0)}
            total={totalIncome}
            color="var(--accent)"
          />
        </ChartCard>
      </div>

      {/* Net profit trend */}
      <ChartCard title="Net Profit Trend" loading={loading}>
        <LineChart buckets={buckets} />
      </ChartCard>
    </div>
  );
}

// ── Charts ─────────────────────────────────────────────────

function BarChart({ buckets }) {
  const maxVal = Math.max(...buckets.map((b) => Math.max(b.income, b.expenses)), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: 220 }}>
      {/* Y axis + bars */}
      <div style={{ display: "flex", gap: 0, height: "100%" }}>
        {/* Y labels */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", paddingBottom: 24, paddingRight: 8, minWidth: 56 }}>
          {[1, 0.75, 0.5, 0.25, 0].map((pct) => (
            <span key={pct} style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
              {fmt(maxVal * pct)}
            </span>
          ))}
        </div>

        {/* Chart area */}
        <div style={{ flex: 1, position: "relative" }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
            <div key={pct} style={{
              position: "absolute", left: 0, right: 0,
              top: `${(1 - pct) * (100 - 11)}%`,
              borderTop: "1px dashed var(--border)", opacity: 0.6,
            }} />
          ))}

          {/* Bars */}
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 2,
            height: "calc(100% - 24px)", padding: "0 4px",
          }}>
            {buckets.map((b, i) => (
              <div key={i} style={{ flex: 1, display: "flex", gap: 1, alignItems: "flex-end", position: "relative" }}>
                <Bar value={b.income}   max={maxVal} color="var(--accent)" opacity={0.7} label={fmtFull(b.income)} />
                <Bar value={b.expenses} max={maxVal} color="var(--red)"    opacity={0.7} label={fmtFull(b.expenses)} />
              </div>
            ))}
          </div>

          {/* X axis labels */}
          <div style={{ display: "flex", gap: 2, padding: "0 4px" }}>
            {buckets.map((b, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
        <Legend color="var(--accent)" label="Revenue" />
        <Legend color="var(--red)"    label="Expenses" />
      </div>
    </div>
  );
}

function Bar({ value, max, color, opacity, label }) {
  const [hover, setHover] = useState(false);
  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative" }}
    >
      {hover && value > 0 && (
        <div style={{
          position: "absolute", bottom: `${pct}%`, left: "50%",
          transform: "translate(-50%, -4px)",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 5, padding: "3px 7px", fontSize: 10,
          color: "var(--text)", whiteSpace: "nowrap", zIndex: 10,
          boxShadow: "var(--shadow)",
        }}>{label}</div>
      )}
      <div style={{
        width: "100%", height: `${pct}%`, minHeight: value > 0 ? 2 : 0,
        background: color, opacity: hover ? 1 : opacity,
        borderRadius: "3px 3px 0 0",
        transition: "opacity 0.15s, height 0.4s cubic-bezier(0.34,1.1,0.64,1)",
      }} />
    </div>
  );
}

function LineChart({ buckets }) {
  const svgRef = useRef(null);
  const W = 800, H = 160, PAD = { top: 16, right: 16, bottom: 24, left: 60 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const nets = buckets.map((b) => b.income - b.expenses);
  const minVal = Math.min(...nets, 0);
  const maxVal = Math.max(...nets, 0);
  const range  = maxVal - minVal || 1;

  function x(i) { return PAD.left + (i / Math.max(nets.length - 1, 1)) * innerW; }
  function y(v) { return PAD.top + innerH - ((v - minVal) / range) * innerH; }

  const points = nets.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area   = `M${x(0)},${y(0)} ` + nets.map((v, i) => `L${x(i)},${y(v)}`).join(" ") + ` L${x(nets.length-1)},${PAD.top+innerH} L${x(0)},${PAD.top+innerH} Z`;
  const zeroY  = y(0);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <defs>
          <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="netGradNeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const val = minVal + range * (1 - pct);
          const yy  = PAD.top + innerH * pct;
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={yy} x2={W - PAD.right} y2={yy}
                stroke="var(--border)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <text x={PAD.left - 6} y={yy + 4} fontSize={9} fill="var(--text-dim)"
                fontFamily="monospace" textAnchor="end">{fmt(val)}</text>
            </g>
          );
        })}

        {/* Zero line */}
        {minVal < 0 && maxVal > 0 && (
          <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
            stroke="var(--border-light)" strokeWidth={1.5} />
        )}

        {/* Area fill */}
        <path d={area} fill="url(#netGrad)" />

        {/* Line */}
        <polyline points={points} fill="none"
          stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots + X labels */}
        {nets.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r={3}
              fill={v >= 0 ? "var(--accent)" : "var(--red)"}
              stroke="var(--surface)" strokeWidth={1.5} />
            {(buckets.length <= 15 || i % Math.ceil(buckets.length / 15) === 0) && (
              <text x={x(i)} y={H - 4} fontSize={8} fill="var(--text-dim)"
                fontFamily="monospace" textAnchor="middle">{buckets[i]?.label}</text>
            )}
          </g>
        ))}
      </svg>

      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
        <Legend color="var(--accent)" label="Profit" />
        <Legend color="var(--red)"    label="Loss"   />
      </div>
    </div>
  );
}

function HorizontalBars({ data, total, color }) {
  if (!data || data.length === 0) {
    return <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>No data</div>;
  }
  const max = data[0]?.[1] || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map(([label, value]) => {
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
        const barW = max > 0 ? (value / max) * 100 : 0;
        return (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{pct}%</span>
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>{fmtFull(value)}</span>
              </div>
            </div>
            <div style={{ height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${barW}%`, background: color,
                borderRadius: 3, opacity: 0.75,
                transition: "width 0.5s cubic-bezier(0.34,1.1,0.64,1)",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{label}</div>
      {value ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{value}</div>
      ) : (
        <div className="loading-skeleton" style={{ height: 24, width: 100 }} />
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, children, loading }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{subtitle}</span>}
      </div>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="loading-skeleton" style={{ height: 160 }} />
        </div>
      ) : children}
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.75 }} />
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// ── Data helpers ───────────────────────────────────────────

function getRangeDates(range) {
  const now  = new Date();
  const end  = format(now, "yyyy-MM-dd");
  let start;
  if (range === "7d")  start = format(subDays(now, 6),   "yyyy-MM-dd");
  if (range === "30d") start = format(subDays(now, 29),  "yyyy-MM-dd");
  if (range === "90d") start = format(subDays(now, 89),  "yyyy-MM-dd");
  if (range === "12m") start = format(subMonths(now, 11), "yyyy-MM-dd");
  return { start, end };
}

function formatRangeLabel(range) {
  if (range === "7d")  return "Last 7 days";
  if (range === "30d") return "Last 30 days";
  if (range === "90d") return "Last 90 days";
  if (range === "12m") return "Last 12 months";
  return "";
}

function buildBuckets(expenses, income, start, end, isMonthly) {
  const startDate = parseISO(start);
  const endDate   = parseISO(end);

  if (isMonthly) {
    const months = eachMonthOfInterval({ start: startDate, end: endDate });
    return months.map((month) => {
      const mStart = format(startOfMonth(month), "yyyy-MM-dd");
      const mEnd   = format(endOfMonth(month),   "yyyy-MM-dd");
      const inc = income.filter((e) => e.date >= mStart && e.date <= mEnd)
        .reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);
      const exp = expenses.filter((e) => e.date >= mStart && e.date <= mEnd)
        .reduce((s, e) => s + (e.amount||0), 0);
      return { label: format(month, "MMM"), income: inc, expenses: exp };
    });
  }

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  return days.map((day) => {
    const d   = format(day, "yyyy-MM-dd");
    const inc = income.filter((e) => e.date === d)
      .reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);
    const exp = expenses.filter((e) => e.date === d)
      .reduce((s, e) => s + (e.amount||0), 0);
    return { label: format(day, "M/d"), income: inc, expenses: exp };
  });
}
