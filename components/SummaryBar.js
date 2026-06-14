export default function SummaryBar({ totalIncome, totalExpenses, net, period, loading }) {
  const fmt = (n) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

  const netPositive = net >= 0;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        padding: "10px 0",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: 32,
        }}
      >
        <Stat
          label="Revenue"
          value={loading ? null : fmt(totalIncome)}
          color="var(--accent)"
        />
        <div style={{ width: 1, height: 24, background: "var(--border)" }} />
        <Stat
          label="Expenses"
          value={loading ? null : fmt(totalExpenses)}
          color="var(--red)"
        />
        <div style={{ width: 1, height: 24, background: "var(--border)" }} />
        <Stat
          label="Net"
          value={loading ? null : fmt(net)}
          color={netPositive ? "var(--accent)" : "var(--red)"}
          bold
        />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {/* Net pill */}
          {!loading && (
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                background: netPositive ? "var(--accent-dim)" : "var(--red-dim)",
                color: netPositive ? "var(--accent)" : "var(--red)",
                border: `1px solid ${netPositive ? "var(--accent-glow)" : "rgba(245,101,101,0.25)"}`,
              }}
            >
              {netPositive ? "▲" : "▼"} {totalIncome > 0 ? Math.abs(Math.round((net / totalIncome) * 100)) : 0}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, bold }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {value ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 15,
            fontWeight: bold ? 700 : 500,
            color,
            letterSpacing: "-0.5px",
          }}
        >
          {value}
        </span>
      ) : (
        <div className="loading-skeleton" style={{ width: 80, height: 18 }} />
      )}
    </div>
  );
}
