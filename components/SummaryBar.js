const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export default function SummaryBar({ totalIncome, totalExpenses, net, loading }) {
  const netPositive = net >= 0;
  const margin = totalIncome > 0 ? Math.abs(Math.round((net / totalIncome) * 100)) : 0;

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      borderBottom: "1px solid var(--border)",
      background: "var(--bg)",
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 var(--sp-6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-8)", height: 48 }}>
          <Stat label="Revenue"  value={loading ? null : fmtCurrency(totalIncome)}   color="var(--green)" />
          <Divider />
          <Stat label="Expenses" value={loading ? null : fmtCurrency(totalExpenses)} color="var(--red)" />
          <Divider />
          <Stat label="Net"      value={loading ? null : fmtCurrency(net)}           color={netPositive ? "var(--green)" : "var(--red)"} bold />

          {!loading && (
            <div style={{ marginLeft: "auto" }}>
              <span style={{
                padding: "3px 10px",
                borderRadius: 20,
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                background: netPositive ? "var(--green-dim)" : "var(--red-dim)",
                color: netPositive ? "var(--green)" : "var(--red)",
                border: `1px solid ${netPositive ? "var(--green-glow)" : "var(--red-glow)"}`,
              }}>
                {netPositive ? "▲" : "▼"} {margin}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, bold }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </span>
      {value != null ? (
        <span style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--text-md)",
          fontWeight: bold ? 700 : 500,
          color,
          letterSpacing: "-0.3px",
        }}>{value}</span>
      ) : (
        <div className="loading-skeleton" style={{ width: 80, height: 18 }} />
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: "var(--border)" }} />;
}
