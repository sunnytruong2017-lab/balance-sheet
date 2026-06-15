import { useState, useEffect, useRef } from "react";
import { format, subDays, subMonths, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, eachMonthOfInterval } from "date-fns";
import { useIsMobile } from "../lib/useIsMobile";

const fmt     = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtFull = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const RANGES = [
  { id: "7d",  label: "7D"  },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "12m", label: "12M" },
];

export default function AnalyticsPanel() {
  const isMobile = useIsMobile();
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
  const buckets   = buildBuckets(expenses, income, start, end, isMonthly);

  const totalIncome   = income.reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount||0), 0);
  const net           = totalIncome - totalExpenses;
  const margin        = totalIncome > 0 ? ((net / totalIncome) * 100).toFixed(1) : "0.0";

  const byCategory = {};
  expenses.forEach((e) => { const c = e.category || "Other"; byCategory[c] = (byCategory[c] || 0) + (e.amount || 0); });
  const categoryData = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const incomeBreakdown = {
    "Cash Revenue": income.reduce((s, e) => s + (e.cashRevenue||0), 0),
    "Card Revenue": income.reduce((s, e) => s + (e.cardRevenue||0), 0),
    "Tips (Cash)":  income.reduce((s, e) => s + (e.tipCash||0), 0),
    "Tips (Card)":  income.reduce((s, e) => s + (e.tipCard||0), 0),
  };

  const gap = isMobile ? 14 : 24;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>

      {/* Header + range selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600 }}>Analytics</h2>
        <div style={{ display: "flex", gap: 3, background: "var(--surface2)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} style={{
              padding: isMobile ? "5px 10px" : "5px 12px",
              borderRadius: 6, fontSize: isMobile ? 11 : 12,
              fontWeight: range === r.id ? 600 : 400,
              background: range === r.id ? "var(--surface)" : "transparent",
              color: range === r.id ? "var(--text)" : "var(--text-muted)",
              border: range === r.id ? "1px solid var(--border)" : "1px solid transparent",
              cursor: "pointer", transition: "all 0.15s ease",
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 8 : 12 }}>
        <KpiCard label="Revenue"  value={loading ? null : fmtFull(totalIncome)}   color="var(--accent)"                                          isMobile={isMobile} />
        <KpiCard label="Expenses" value={loading ? null : fmtFull(totalExpenses)} color="var(--red)"                                             isMobile={isMobile} />
        <KpiCard label="Net"      value={loading ? null : fmtFull(net)}           color={net >= 0 ? "var(--accent)" : "var(--red)"}              isMobile={isMobile} />
        <KpiCard label="Margin"   value={loading ? null : `${margin}%`}           color={parseFloat(margin) >= 0 ? "var(--accent)" : "var(--red)"} isMobile={isMobile} />
      </div>

      {/* Revenue vs Expenses bar chart */}
      <ChartCard title="Revenue vs Expenses" loading={loading} isMobile={isMobile}>
        <BarChart buckets={buckets} isMobile={isMobile} />
      </ChartCard>

      {/* Breakdowns — stack on mobile, side-by-side on desktop */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20 }}>
        <ChartCard title="Expenses by Category" loading={loading} isMobile={isMobile}>
          <HorizontalBars data={categoryData} total={totalExpenses} color="var(--red)" isMobile={isMobile} />
        </ChartCard>
        <ChartCard title="Revenue Breakdown" loading={loading} isMobile={isMobile}>
          <HorizontalBars
            data={Object.entries(incomeBreakdown).filter(([,v]) => v > 0)}
            total={totalIncome} color="var(--accent)" isMobile={isMobile}
          />
        </ChartCard>
      </div>

      {/* Net profit trend line */}
      <ChartCard title="Net Profit Trend" loading={loading} isMobile={isMobile}>
        <LineChart buckets={buckets} isMobile={isMobile} />
      </ChartCard>

    </div>
  );
}

// ── Bar Chart ──────────────────────────────────────────────

function BarChart({ buckets, isMobile }) {
  const maxVal    = Math.max(...buckets.map((b) => Math.max(b.income, b.expenses)), 1);
  const chartH    = isMobile ? 140 : 200;
  // On mobile with many buckets, thin them out
  const step      = isMobile && buckets.length > 14 ? Math.ceil(buckets.length / 10) : 1;
  const displayed = isMobile ? buckets.filter((_, i) => i % step === 0) : buckets;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 0, height: chartH + 20 }}>
        {/* Y labels */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", paddingBottom: 20, paddingRight: 6, minWidth: isMobile ? 44 : 56 }}>
          {[1, 0.5, 0].map((pct) => (
            <span key={pct} style={{ fontSize: isMobile ? 8 : 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
              {fmt(maxVal * pct)}
            </span>
          ))}
        </div>
        {/* Chart area */}
        <div style={{ flex: 1, position: "relative" }}>
          {[0, 0.5, 1].map((pct) => (
            <div key={pct} style={{ position: "absolute", left: 0, right: 0, top: `${(1 - pct) * (100 - 14)}%`, borderTop: "1px dashed var(--border)", opacity: 0.5 }} />
          ))}
          <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? 1 : 2, height: chartH, padding: "0 2px" }}>
            {displayed.map((b, i) => (
              <div key={i} style={{ flex: 1, display: "flex", gap: 1, alignItems: "flex-end" }}>
                <Bar value={b.income}   max={maxVal} color="var(--accent)" label={fmtFull(b.income)}   />
                <Bar value={b.expenses} max={maxVal} color="var(--red)"    label={fmtFull(b.expenses)} />
              </div>
            ))}
          </div>
          {/* X labels */}
          <div style={{ display: "flex", gap: isMobile ? 1 : 2, padding: "0 2px" }}>
            {displayed.map((b, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <span style={{ fontSize: isMobile ? 7 : 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        <Legend color="var(--accent)" label="Revenue" />
        <Legend color="var(--red)"    label="Expenses" />
      </div>
    </div>
  );
}

function Bar({ value, max, color, label }) {
  const [hover, setHover] = useState(false);
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative", height: "100%" }}
    >
      {hover && value > 0 && (
        <div style={{ position: "absolute", bottom: `${pct}%`, left: "50%", transform: "translate(-50%, -4px)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 7px", fontSize: 10, color: "var(--text)", whiteSpace: "nowrap", zIndex: 10, boxShadow: "var(--shadow)" }}>{label}</div>
      )}
      <div style={{ width: "100%", height: `${pct}%`, minHeight: value > 0 ? 2 : 0, background: color, opacity: hover ? 1 : 0.7, borderRadius: "2px 2px 0 0", transition: "opacity 0.15s" }} />
    </div>
  );
}

// ── Line Chart ─────────────────────────────────────────────

function LineChart({ buckets, isMobile }) {
  const H   = isMobile ? 120 : 160;
  const W   = 800;
  const PAD = { top: 12, right: 12, bottom: isMobile ? 18 : 24, left: isMobile ? 44 : 60 };
  const iW  = W - PAD.left - PAD.right;
  const iH  = H - PAD.top - PAD.bottom;

  const nets   = buckets.map((b) => b.income - b.expenses);
  const minVal = Math.min(...nets, 0);
  const maxVal = Math.max(...nets, 0);
  const range  = maxVal - minVal || 1;

  const x = (i) => PAD.left + (i / Math.max(nets.length - 1, 1)) * iW;
  const y = (v) => PAD.top  + iH - ((v - minVal) / range) * iH;

  const points  = nets.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area    = `M${x(0)},${y(nets[0])} ` + nets.map((v, i) => `L${x(i)},${y(v)}`).join(" ") + ` L${x(nets.length-1)},${PAD.top+iH} L${x(0)},${PAD.top+iH} Z`;

  // Thin x-labels on mobile
  const labelEvery = isMobile ? Math.ceil(buckets.length / 8) : Math.ceil(buckets.length / 15);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <defs>
          <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines — just 3 on mobile */}
        {(isMobile ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((pct) => {
          const val = minVal + range * (1 - pct);
          const yy  = PAD.top + iH * pct;
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={yy} x2={W - PAD.right} y2={yy} stroke="var(--border)" strokeDasharray="4 4" strokeOpacity={0.5} />
              <text x={PAD.left - 4} y={yy + 4} fontSize={isMobile ? 8 : 9} fill="var(--text-dim)" fontFamily="monospace" textAnchor="end">{fmt(val)}</text>
            </g>
          );
        })}
        {/* Zero line */}
        {minVal < 0 && maxVal > 0 && <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} stroke="var(--border-light)" strokeWidth={1.5} />}
        <path d={area} fill="url(#netGrad)" />
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={isMobile ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
        {nets.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r={isMobile ? 2 : 3} fill={v >= 0 ? "var(--accent)" : "var(--red)"} stroke="var(--surface)" strokeWidth={1.5} />
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - (isMobile ? 2 : 4)} fontSize={isMobile ? 7 : 8} fill="var(--text-dim)" fontFamily="monospace" textAnchor="middle">{buckets[i]?.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Horizontal Bars ────────────────────────────────────────

function HorizontalBars({ data, total, color, isMobile }) {
  if (!data || data.length === 0) return <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>No data</div>;
  const max = data[0]?.[1] || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 8 : 10 }}>
      {data.map(([label, value]) => {
        const pct  = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
        const barW = max > 0 ? (value / max) * 100 : 0;
        return (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "baseline" }}>
              <span style={{ fontSize: isMobile ? 11 : 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{label}</span>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{pct}%</span>
                <span style={{ fontSize: isMobile ? 11 : 12, fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>{fmtFull(value)}</span>
              </div>
            </div>
            <div style={{ height: isMobile ? 5 : 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${barW}%`, background: color, borderRadius: 3, opacity: 0.75, transition: "width 0.5s cubic-bezier(0.34,1.1,0.64,1)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── UI Helpers ─────────────────────────────────────────────

function KpiCard({ label, value, color, isMobile }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: isMobile ? "12px 14px" : "16px 18px" }}>
      <div style={{ fontSize: isMobile ? 9 : 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: isMobile ? 5 : 8 }}>{label}</div>
      {value ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: isMobile ? 14 : 18, fontWeight: 700, color, letterSpacing: "-0.5px", wordBreak: "break-all" }}>{value}</div>
      ) : (
        <div className="loading-skeleton" style={{ height: isMobile ? 18 : 24, width: "80%" }} />
      )}
    </div>
  );
}

function ChartCard({ title, children, loading, isMobile }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: isMobile ? "14px 14px" : "18px 20px" }}>
      <div style={{ marginBottom: isMobile ? 12 : 18 }}>
        <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600 }}>{title}</span>
      </div>
      {loading ? <div className="loading-skeleton" style={{ height: isMobile ? 120 : 160 }} /> : children}
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.75 }} />
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// ── Data helpers ───────────────────────────────────────────

function getRangeDates(range) {
  const now = new Date();
  const end = format(now, "yyyy-MM-dd");
  let start;
  if (range === "7d")  start = format(subDays(now, 6),    "yyyy-MM-dd");
  if (range === "30d") start = format(subDays(now, 29),   "yyyy-MM-dd");
  if (range === "90d") start = format(subDays(now, 89),   "yyyy-MM-dd");
  if (range === "12m") start = format(subMonths(now, 11), "yyyy-MM-dd");
  return { start, end };
}

function buildBuckets(expenses, income, start, end, isMonthly) {
  const startDate = parseISO(start);
  const endDate   = parseISO(end);
  if (isMonthly) {
    return eachMonthOfInterval({ start: startDate, end: endDate }).map((month) => {
      const mS = format(startOfMonth(month), "yyyy-MM-dd");
      const mE = format(endOfMonth(month),   "yyyy-MM-dd");
      const inc = income.filter((e) => e.date >= mS && e.date <= mE).reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);
      const exp = expenses.filter((e) => e.date >= mS && e.date <= mE).reduce((s, e) => s + (e.amount||0), 0);
      return { label: format(month, "MMM"), income: inc, expenses: exp };
    });
  }
  return eachDayOfInterval({ start: startDate, end: endDate }).map((day) => {
    const d   = format(day, "yyyy-MM-dd");
    const inc = income.filter((e) => e.date === d).reduce((s, e) => s + (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0), 0);
    const exp = expenses.filter((e) => e.date === d).reduce((s, e) => s + (e.amount||0), 0);
    return { label: format(day, "M/d"), income: inc, expenses: exp };
  });
}
