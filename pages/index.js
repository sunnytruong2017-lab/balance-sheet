import { useState, useEffect, useCallback } from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from "date-fns";
import EntryModal from "../components/EntryModal";
import PayrollPanel from "../components/PayrollPanel";
import SummaryBar from "../components/SummaryBar";
import EntriesTable from "../components/EntriesTable";

const tabs = ["Daily", "Biweekly", "Monthly", "Startup", "Payroll"];

function getDateRange(tab, ref) {
  const d = ref || new Date();
  if (tab === "Daily")     return { start: format(startOfDay(d), "yyyy-MM-dd"), end: format(endOfDay(d), "yyyy-MM-dd") };
  if (tab === "Biweekly") return { start: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") };
  if (tab === "Monthly")  return { start: format(startOfMonth(d), "yyyy-MM-dd"), end: format(endOfMonth(d), "yyyy-MM-dd") };
  return { start: "2000-01-01", end: format(new Date(), "yyyy-MM-dd") };
}

const EXPENSE_CATEGORIES = {
  Daily:    ["Supplies", "Groceries", "Other"],
  Biweekly: ["Employee Pay", "Employee Tips", "Other"],
  Monthly:  ["Rent", "Utilities", "Taxes", "Other"],
  Startup:  ["Equipment", "Renovation", "Permits & Licenses", "Initial Inventory", "Furniture", "Marketing", "Other"],
};

function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

export default function Home() {
  const [activeTab, setActiveTab]       = useState("Daily");
  const [modal, setModal]               = useState(null);
  const [expenses, setExpenses]         = useState([]);
  const [income, setIncome]             = useState([]);
  const [loading, setLoading]           = useState(false);
  const [referenceDate, setReferenceDate] = useState(new Date());

  const dateRange = getDateRange(activeTab, referenceDate);
  const frequency = activeTab === "Startup" ? "Startup" : activeTab;

  const fetchData = useCallback(async () => {
    if (activeTab === "Payroll") return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ frequency });
      if (dateRange.start) params.set("startDate", dateRange.start);
      if (dateRange.end)   params.set("endDate",   dateRange.end);

      const [expRes, incRes] = await Promise.all([
        fetch(`/api/expenses?${params}`),
        activeTab !== "Startup"
          ? fetch(`/api/income?${params}`)
          : Promise.resolve({ ok: true, json: async () => [] }),
      ]);
      if (expRes.ok) setExpenses(await expRes.json());
      if (incRes.ok) setIncome(await incRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateRange.start, dateRange.end, frequency]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleSaveExpense(data) {
    const method = data.id ? "PUT" : "POST";
    const res = await fetch("/api/expenses", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, frequency }),
    });
    if (res.ok) { setModal(null); fetchData(); }
  }

  async function handleSaveIncome(data) {
    const method = data.id ? "PUT" : "POST";
    const res = await fetch("/api/income", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) { setModal(null); fetchData(); }
  }

  async function handleDelete(type, id) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/${type}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchData();
  }

  const totalIncome   = income.reduce((s, e) => s + (e.cashRevenue || 0) + (e.cardRevenue || 0) + (e.tipCash || 0) + (e.tipCard || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const net = totalIncome - totalExpenses;

  const periodLabel = {
    Daily:    format(referenceDate, "MMMM d, yyyy"),
    Biweekly: `Week of ${format(parseISO(dateRange.start), "MMM d")}`,
    Monthly:  format(referenceDate, "MMMM yyyy"),
    Startup:  "All Time",
    Payroll:  "Payroll",
  }[activeTab];

  function shiftDate(delta) {
    const d = new Date(referenceDate);
    if (activeTab === "Daily")     d.setDate(d.getDate() + delta);
    else if (activeTab === "Biweekly") d.setDate(d.getDate() + delta * 7);
    else                           d.setMonth(d.getMonth() + delta);
    setReferenceDate(d);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px" }}>AN</span>
              <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Restaurant Ledger</span>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {format(new Date(), "EEE, MMM d")}
            </span>
          </div>
        </div>

        {activeTab !== "Payroll" && (
          <SummaryBar totalIncome={totalIncome} totalExpenses={totalExpenses} net={net} period={periodLabel} loading={loading} />
        )}

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", display: "flex", gap: 4 }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "var(--text)" : "var(--text-muted)",
                borderBottom: `2px solid ${activeTab === tab ? "var(--accent)" : "transparent"}`,
                transition: "all 0.15s ease",
                background: "none",
                border: "none",
                borderBottom: `2px solid ${activeTab === tab ? "var(--accent)" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, maxWidth: 1100, margin: "0 auto", width: "100%", padding: "28px 24px" }}>
        {activeTab === "Payroll" ? (
          <PayrollPanel />
        ) : (
          <>
            {/* Period nav + actions */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {activeTab !== "Startup" ? (
                  <>
                    <NavBtn onClick={() => shiftDate(-1)}>‹</NavBtn>
                    <span style={{ fontSize: 15, fontWeight: 600, minWidth: 160, textAlign: "center" }}>{periodLabel}</span>
                    <NavBtn onClick={() => shiftDate(1)}>›</NavBtn>
                  </>
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Startup Costs</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {activeTab !== "Startup" && (
                  <ActionBtn onClick={() => setModal({ type: "income" })} color="var(--accent)" label="+ Income" />
                )}
                <ActionBtn onClick={() => setModal({ type: "expense" })} color="var(--red)" label="+ Expense" />
              </div>
            </div>

            {/* Two-column grid */}
            <div style={{ display: "grid", gridTemplateColumns: activeTab === "Startup" ? "1fr" : "1fr 1fr", gap: 20 }}>
              <EntriesTable
                title="Expenses"
                entries={expenses}
                type="expense"
                loading={loading}
                color="var(--red)"
                onEdit={(e) => setModal({ type: "expense", entry: e })}
                onDelete={(id) => handleDelete("expenses", id)}
                renderAmount={(e) => fmt(e.amount)}
                renderMeta={(e) => e.category}
              />
              {activeTab !== "Startup" && (
                <EntriesTable
                  title="Income"
                  entries={income}
                  type="income"
                  loading={loading}
                  color="var(--accent)"
                  onEdit={(e) => setModal({ type: "income", entry: e })}
                  onDelete={(id) => handleDelete("income", id)}
                  renderAmount={(e) => fmt((e.cashRevenue || 0) + (e.cardRevenue || 0) + (e.tipCash || 0) + (e.tipCard || 0))}
                  renderMeta={(e) => {
                    const parts = [];
                    if (e.cashRevenue) parts.push(`Cash ${fmt(e.cashRevenue)}`);
                    if (e.cardRevenue) parts.push(`Card ${fmt(e.cardRevenue)}`);
                    if (e.tipCash || e.tipCard) parts.push(`Tips ${fmt((e.tipCash || 0) + (e.tipCard || 0))}`);
                    return parts.join(" · ") || "—";
                  }}
                />
              )}
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      {modal?.type === "expense" && (
        <EntryModal
          title={modal.entry ? "Edit Expense" : "New Expense"}
          entry={modal.entry}
          categories={EXPENSE_CATEGORIES[activeTab] || EXPENSE_CATEGORIES.Daily}
          type="expense"
          defaultDate={format(referenceDate, "yyyy-MM-dd")}
          onSave={handleSaveExpense}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "income" && (
        <EntryModal
          title={modal.entry ? "Edit Income" : "New Income"}
          entry={modal.entry}
          categories={[]}
          type="income"
          defaultDate={format(referenceDate, "yyyy-MM-dd")}
          onSave={handleSaveIncome}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function NavBtn({ onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28, borderRadius: "50%",
        background: hover ? "var(--surface2)" : "transparent",
        color: hover ? "var(--text)" : "var(--text-muted)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, lineHeight: 1,
        transition: "all 0.15s ease",
        cursor: "pointer", border: "none",
      }}
    >
      {children}
    </button>
  );
}

function ActionBtn({ onClick, color, label }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "7px 14px",
        borderRadius: 6,
        border: `1px solid ${color}`,
        color: hover ? "#000" : color,
        background: hover ? color : "transparent",
        fontSize: 13, fontWeight: 500,
        transition: "all 0.15s ease",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
