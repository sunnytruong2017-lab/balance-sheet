import { useState } from "react";
import { format, parseISO } from "date-fns";
import EntriesTable from "./EntriesTable";
import PayrollPanel from "./PayrollPanel";
import AnalyticsPanel from "./AnalyticsPanel";
import ExportPanel from "./ExportPanel";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

// Tab icons as inline SVGs
const TAB_ICONS = {
  Daily: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Biweekly: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
    </svg>
  ),
  Monthly: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Startup: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Analytics: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  Export: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Payroll: (active) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
};

const TABS = ["Daily", "Biweekly", "Monthly", "Startup", "Analytics", "Payroll", "Export"];

export default function MobileLayout({
  activeTab, setActiveTab,
  expenses, income, loading,
  referenceDate, periodLabel, shiftDate,
  onAddExpense, onAddIncome,
  onEditExpense, onEditIncome,
  onDeleteExpense, onDeleteIncome,
  totalIncome, totalExpenses, net,
  theme, toggleTheme,
}) {
  const [fabOpen, setFabOpen] = useState(false);
  const isTracking = !["Analytics", "Payroll", "Export"].includes(activeTab);
  const netPositive = net >= 0;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}>
      {/* Mobile header */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "var(--surface)", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.5px" }}>AN</span>
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>Ledger</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {format(new Date(), "MMM d")}
            </span>
            <button onClick={toggleTheme} style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "var(--surface2)", color: "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>
              {theme === "dark" ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mini summary strip */}
        {isTracking && (
          <div style={{
            display: "flex", gap: 0,
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
          }}>
            {[
              { label: "Revenue", value: fmt(totalIncome), color: "var(--accent)" },
              { label: "Expenses", value: fmt(totalExpenses), color: "var(--red)" },
              { label: "Net", value: fmt(net), color: netPositive ? "var(--accent)" : "var(--red)" },
            ].map((item, i) => (
              <div key={item.label} style={{
                flex: 1, padding: "8px 12px", textAlign: "center",
                borderRight: i < 2 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ fontSize: 9, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)", color: item.color, marginTop: 1 }}>
                  {loading ? "—" : item.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Period nav — only for tracking tabs */}
        {isTracking && activeTab !== "Startup" && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 16px", borderTop: "1px solid var(--border)",
          }}>
            <button onClick={() => shiftDate(-1)} style={{
              width: 32, height: 32, borderRadius: "50%", border: "none",
              background: "var(--surface2)", color: "var(--text-muted)",
              fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{periodLabel}</span>
            <button onClick={() => shiftDate(1)} style={{
              width: 32, height: 32, borderRadius: "50%", border: "none",
              background: "var(--surface2)", color: "var(--text-muted)",
              fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>›</button>
          </div>
        )}
        {isTracking && activeTab === "Startup" && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Startup Costs</span>
          </div>
        )}
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {activeTab === "Payroll" && <PayrollPanel />}
        {activeTab === "Analytics" && <AnalyticsPanel />}
        {activeTab === "Export" && <ExportPanel />}

        {isTracking && (
          <>
            <EntriesTable
              title="Expenses" entries={expenses} type="expense" loading={loading} color="var(--red)"
              onEdit={onEditExpense} onDelete={onDeleteExpense}
              renderAmount={(e) => fmt(e.amount)}
              renderMeta={(e) => e.category}
            />
            {activeTab !== "Startup" && (
              <EntriesTable
                title="Income" entries={income} type="income" loading={loading} color="var(--accent)"
                onEdit={onEditIncome} onDelete={onDeleteIncome}
                renderAmount={(e) => fmt((e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0))}
                renderMeta={(e) => {
                  const parts = [];
                  if (e.cashRevenue) parts.push(`Cash ${fmt(e.cashRevenue)}`);
                  if (e.cardRevenue) parts.push(`Card ${fmt(e.cardRevenue)}`);
                  if (e.tipCash || e.tipCard) parts.push(`Tips ${fmt((e.tipCash||0)+(e.tipCard||0))}`);
                  return parts.join(" · ") || "—";
                }}
              />
            )}
          </>
        )}
      </main>

      {/* FAB — floating action button for adding entries */}
      {isTracking && (
        <div style={{ position: "fixed", bottom: 84, right: 16, zIndex: 40, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          {/* Sub-buttons (expanded) */}
          {fabOpen && (
            <>
              {activeTab !== "Startup" && (
                <FabSubBtn
                  label="+ Income"
                  color="var(--accent)"
                  onClick={() => { onAddIncome(); setFabOpen(false); }}
                />
              )}
              <FabSubBtn
                label="+ Expense"
                color="var(--red)"
                onClick={() => { onAddExpense(); setFabOpen(false); }}
              />
            </>
          )}

          {/* Main FAB */}
          <button
            onClick={() => setFabOpen((v) => !v)}
            style={{
              width: 52, height: 52, borderRadius: "50%",
              background: fabOpen ? "var(--surface2)" : "var(--accent)",
              border: fabOpen ? "1px solid var(--border)" : "none",
              color: fabOpen ? "var(--text-muted)" : "#000",
              fontSize: 24, fontWeight: 300, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)",
              transform: fabOpen ? "rotate(45deg)" : "rotate(0deg)",
            }}
          >+</button>
        </div>
      )}

      {/* Backdrop for FAB menu */}
      {fabOpen && (
        <div
          onClick={() => setFabOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 35, background: "rgba(0,0,0,0.2)", backdropFilter: "blur(1px)" }}
        />
      )}

      {/* Bottom tab bar — fixed 56px, never resizes */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
        height: 56,
        background: "var(--surface)", borderTop: "1px solid var(--border)",
        display: "flex", alignItems: "stretch",
        // iOS safe area: add padding-bottom via CSS but keep height fixed
        boxSizing: "content-box",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        {TABS.map((tab) => {
          const active = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, height: 56,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer",
              color: active ? "var(--accent)" : "var(--text-dim)",
              transition: "color 0.15s ease",
              flexShrink: 0, minWidth: 0,
            }}>
              {TAB_ICONS[tab]?.(active)}
              <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, letterSpacing: "0.02em", lineHeight: 1 }}>
                {tab}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function FabSubBtn({ label, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 18px", borderRadius: 24,
        background: "var(--surface)", border: `1px solid ${color}`,
        color, fontSize: 13, fontWeight: 600,
        cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
        animation: "fadeIn 0.15s ease forwards",
        whiteSpace: "nowrap",
      }}
    >{label}</button>
  );
}
