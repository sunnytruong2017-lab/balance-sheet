import { useState, useEffect, useCallback, useRef } from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from "date-fns";
import EntryModal from "../components/EntryModal";
import SummaryBar from "../components/SummaryBar";
import EntriesTable from "../components/EntriesTable";
import { useTheme } from "../lib/ThemeContext";
import AnalyticsPanel from "../components/AnalyticsPanel";
import PayrollPanel from "../components/PayrollPanel";
import MobileLayout from "../components/MobileLayout";
import { useIsMobile } from "../lib/useIsMobile";
import ExportPanel from "../components/ExportPanel";
import ManagerGate, { useManagerAuth } from "../components/ManagerGate";

const tabs = ["Daily", "Biweekly", "Monthly", "Startup", "Analytics", "Payroll", "Export"];
const MANAGER_TABS = new Set(["Startup", "Analytics", "Payroll", "Export"]);

// Default built-in categories per tab (always shown, cannot be deleted)
const DEFAULT_EXPENSE_CATEGORIES = {
  Daily:    ["Supplies", "Groceries", "Other"],
  Biweekly: ["Employee Pay", "Employee Tips", "Other"],
  Monthly:  ["Rent", "Utilities", "Taxes", "Other"],
  Startup:  ["Equipment", "Renovation", "Permits & Licenses", "Initial Inventory", "Furniture", "Marketing", "Other"],
};

function getDateRange(tab, ref) {
  const d = ref || new Date();
  if (tab === "Daily")     return { start: format(startOfDay(d), "yyyy-MM-dd"), end: format(endOfDay(d), "yyyy-MM-dd") };
  if (tab === "Biweekly") return { start: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") };
  if (tab === "Monthly")  return { start: format(startOfMonth(d), "yyyy-MM-dd"), end: format(endOfMonth(d), "yyyy-MM-dd") };
  return { start: "2000-01-01", end: format(new Date(), "yyyy-MM-dd") };
}

function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

export default function Home() {
  const { theme, toggle } = useTheme();
  const isMobile = useIsMobile();
  const { authed: managerAuthed, login: managerLogin, logout: managerLogout } = useManagerAuth();
  const [pendingTab, setPendingTab] = useState(null); // tab waiting for auth
  const [activeTab, setActiveTab]         = useState("Daily");
  const [modal, setModal]                 = useState(null);
  const [expenses, setExpenses]           = useState([]);
  const [income, setIncome]               = useState([]);
  const [loading, setLoading]             = useState(false);
  const [referenceDate, setReferenceDate] = useState(new Date());
  // Custom categories from Notion: { Daily: [...], Biweekly: [...], Monthly: [...], Startup: [...] }
  const [customCategories, setCustomCategories] = useState({});

  const dateRange = getDateRange(activeTab, referenceDate);
  const frequency = activeTab === "Startup" ? "Startup" : activeTab;

  // Merge defaults + custom for the active tab
  const activeExpenseCategories = [
    ...(DEFAULT_EXPENSE_CATEGORIES[activeTab] || []),
    ...(customCategories[activeTab] || []),
  ];

  // Load custom categories on mount
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.ok ? r.json() : [])
      .then((cats) => {
        const grouped = {};
        cats.forEach(({ name, tab }) => {
          if (!grouped[tab]) grouped[tab] = [];
          grouped[tab].push(name);
        });
        setCustomCategories(grouped);
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    if (activeTab === "Analytics" || activeTab === "Payroll") return;
    setLoading(true);
    try {
      // Daily and Startup show only entries explicitly tagged with that frequency.
      // Biweekly and Monthly are rollup views — they show ALL entries (any frequency)
      // whose date falls within that period, so nothing gets hidden just because
      // it was logged under a different tab.
      const isRollupView = activeTab === "Biweekly" || activeTab === "Monthly";
      const params = new URLSearchParams(isRollupView ? {} : { frequency });
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

  async function handleCategoryAdded(name) {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tab: activeTab, type: "expense" }),
    });
    if (!res.ok) throw new Error("Failed to save category");
    setCustomCategories((prev) => ({
      ...prev,
      [activeTab]: [...(prev[activeTab] || []), name],
    }));
  }

  async function handleCategoryDeleted(name) {
    // Can't delete defaults
    if ((DEFAULT_EXPENSE_CATEGORIES[activeTab] || []).includes(name)) return;

    // Find the Notion page id from a fresh fetch
    const res = await fetch("/api/categories");
    if (!res.ok) return;
    const cats = await res.json();
    const match = cats.find((c) => c.name === name && c.tab === activeTab);
    if (!match) return;

    await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: match.id }),
    });

    setCustomCategories((prev) => ({
      ...prev,
      [activeTab]: (prev[activeTab] || []).filter((c) => c !== name),
    }));
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
    if (activeTab === "Daily")      d.setDate(d.getDate() + delta);
    else if (activeTab === "Biweekly") d.setDate(d.getDate() + delta * 7);
    else                            d.setMonth(d.getMonth() + delta);
    setReferenceDate(d);
  }

  // Shared props for both layouts
  function handleTabClick(tab) {
    if (MANAGER_TABS.has(tab) && !managerAuthed) {
      setPendingTab(tab);
    } else {
      setActiveTab(tab);
    }
  }

  const sharedProps = {
    activeTab, setActiveTab: handleTabClick,
    expenses, income, loading,
    referenceDate, setReferenceDate, periodLabel, shiftDate,
    onAddExpense:   () => setModal({ type: "expense" }),
    onAddIncome:    () => setModal({ type: "income"  }),
    onEditExpense:  (e) => setModal({ type: "expense", entry: e }),
    onEditIncome:   (e) => setModal({ type: "income",  entry: e }),
    onDeleteExpense: (id) => handleDelete("expenses", id),
    onDeleteIncome:  (id) => handleDelete("income",   id),
    totalIncome, totalExpenses, net,
    theme, toggleTheme: toggle,
    managerAuthed, managerLogout, managerLogin,
  };

  if (isMobile) {
    return (
      <>
        <MobileLayout {...sharedProps} />
        {modal?.type === "expense" && (
          <EntryModal
            title={modal.entry ? "Edit Expense" : "New Expense"}
            entry={modal.entry}
            categories={activeExpenseCategories}
            type="expense"
            defaultDate={format(referenceDate, "yyyy-MM-dd")}
            onSave={handleSaveExpense}
            onClose={() => setModal(null)}
            onCategoryAdded={handleCategoryAdded}
            onCategoryDeleted={handleCategoryDeleted}
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
      </>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        position: "sticky", top: 0, zIndex: 50,
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 var(--sp-6)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 58 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src="/logo.png" alt="AN" style={{ height: 30, width: "auto", display: "block" }} />
              <div style={{ width: 1, height: 18, background: "var(--border)" }} />
              <span style={{ color: "var(--text-dim)", fontSize: "var(--text-sm)", fontWeight: 500, letterSpacing: "0.01em" }}>Restaurant Ledger</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                {format(new Date(), "EEE, MMM d")}
              </span>
              <ThemeToggle theme={theme} onToggle={toggle} />
              {managerAuthed ? (
                <ManagerBadge onLogout={() => {
                  managerLogout();
                  if (MANAGER_TABS.has(activeTab)) setActiveTab("Daily");
                }} />
              ) : (
                <ManagerLoginBtn onLogin={() => setPendingTab("__login__")} />
              )}
            </div>
          </div>
        </div>

        {activeTab !== "Analytics" && activeTab !== "Export" && activeTab !== "Payroll" && (
          <SummaryBar totalIncome={totalIncome} totalExpenses={totalExpenses} net={net} period={periodLabel} loading={loading} />
        )}

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 var(--sp-6)" }} className="tab-nav">
          {tabs.map((tab) => {
            const isRestricted = MANAGER_TABS.has(tab) && !managerAuthed;
            return (
              <button key={tab} onClick={() => handleTabClick(tab)}
                className={`tab-btn ${activeTab === tab ? "active" : ""} ${isRestricted ? "restricted" : ""}`}>
                {tab}
                {isRestricted && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ opacity: 0.4 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, maxWidth: 1100, margin: "0 auto", width: "100%", padding: "var(--sp-8) var(--sp-6)" }}>
        {activeTab === "Payroll" ? (
          <PayrollPanel />
        ) : activeTab === "Analytics" ? (
          <AnalyticsPanel />
        ) : activeTab === "Export" ? (
          <ExportPanel />
        ) : (
          <>
            {/* Period nav + actions */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-6)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                {activeTab !== "Startup" ? (
                  <>
                    <NavBtn onClick={() => shiftDate(-1)}>‹</NavBtn>
                    <DatePickerLabel
                      label={periodLabel}
                      value={format(referenceDate, "yyyy-MM-dd")}
                      onChange={(dateStr) => setReferenceDate(parseISO(dateStr))}
                    />
                    <NavBtn onClick={() => shiftDate(1)}>›</NavBtn>
                  </>
                ) : (
                  <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>Startup Costs</span>
                )}
              </div>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                {activeTab !== "Startup" && (
                  <button onClick={() => setModal({ type: "income" })} className="action-btn-income">+ Income</button>
                )}
                <button onClick={() => setModal({ type: "expense" })} className="action-btn-expense">+ Expense</button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: activeTab === "Startup" ? "1fr" : "1fr 1fr", gap: "var(--sp-5)" }}>
              {activeTab !== "Startup" && (
                <EntriesTable
                  title="Income" entries={income} type="income" loading={loading} color="var(--accent)"
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
              <EntriesTable
                title="Expenses" entries={expenses} type="expense" loading={loading} color="var(--red)"
                onEdit={(e) => setModal({ type: "expense", entry: e })}
                onDelete={(id) => handleDelete("expenses", id)}
                renderAmount={(e) => fmt(e.amount)}
                renderMeta={(e) => e.category}
              />
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      {modal?.type === "expense" && (
        <EntryModal
          title={modal.entry ? "Edit Expense" : "New Expense"}
          entry={modal.entry}
          categories={activeExpenseCategories}
          type="expense"
          defaultDate={format(referenceDate, "yyyy-MM-dd")}
          onSave={handleSaveExpense}
          onClose={() => setModal(null)}
          onCategoryAdded={handleCategoryAdded}
          onCategoryDeleted={handleCategoryDeleted}
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

      {/* Manager auth gate */}
      {pendingTab && (
        <ManagerGate
          tabName={pendingTab}
          onSuccess={() => {
            managerLogin(); // called after gate validates password
            if (pendingTab !== "__login__") setActiveTab(pendingTab);
            setPendingTab(null);
          }}
          onCancel={() => setPendingTab(null)}
        />
      )}
    </div>
  );
}
function DatePickerLabel({ label, value, onChange }) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      el.showPicker();
    } else {
      el.focus();
      el.click();
    }
  }

  return (
    <div
      onClick={openPicker}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Click to jump to a specific date"
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        minWidth: 180, padding: "4px 10px", borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        background: hover ? "var(--surface2)" : "transparent",
        border: `1px solid ${hover ? "var(--border)" : "transparent"}`,
        transition: "all 0.15s var(--ease)",
      }}
    >
      <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>{label}</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: hover ? 1 : 0.5, transition: "opacity 0.15s" }}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          opacity: 0, cursor: "pointer", border: "none",
        }}
      />
    </div>
  );
}

function NavBtn({ onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28, borderRadius: "50%",
        background: hover ? "var(--surface2)" : "transparent",
        color: hover ? "var(--text)" : "var(--text-muted)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, lineHeight: 1, transition: "all 0.15s ease",
        cursor: "pointer", border: "none",
      }}>{children}</button>
  );
}
function ActionBtn({ onClick, color, label }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: "7px 14px", borderRadius: 6,
        border: `1px solid ${color}`,
        color: hover ? "#000" : color,
        background: hover ? color : "transparent",
        fontSize: 13, fontWeight: 500,
        transition: "all 0.15s ease", cursor: "pointer",
      }}>{label}</button>
  );
}
function ManagerBadge({ onLogout }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <span style={{
        fontSize: "var(--text-xs)", fontWeight: 600, padding: "3px 9px", borderRadius: 20,
        background: "var(--accent-dim)", color: "var(--accent-text)",
        border: "1px solid var(--accent-glow)", letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}>Manager</span>
      <button onClick={onLogout} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        title="Sign out of manager view"
        style={{
          padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", fontWeight: 500,
          background: hover ? "var(--red-dim)" : "var(--surface2)",
          color: hover ? "var(--red)" : "var(--text-dim)",
          border: `1px solid ${hover ? "var(--red-glow)" : "var(--border)"}`,
          cursor: "pointer", transition: "all 0.12s var(--ease)",
        }}
      >Sign out</button>
    </div>
  );
}

function ManagerLoginBtn({ onLogin }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onLogin} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Sign in as manager"
      style={{
        display: "flex", alignItems: "center", gap: "var(--sp-1)",
        padding: "5px 11px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", fontWeight: 500,
        background: hover ? "var(--surface2)" : "transparent",
        color: hover ? "var(--text-muted)" : "var(--text-dim)",
        border: `1px solid ${hover ? "var(--border)" : "transparent"}`,
        cursor: "pointer", transition: "all 0.12s var(--ease)",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      Manager
    </button>
  );
}


function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      style={{
        width: 32, height: 32, borderRadius: 8,
        background: hover ? "var(--surface2)" : "transparent",
        border: "1px solid " + (hover ? "var(--border)" : "transparent"),
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0,
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      {isDark ? (
        // Moon icon (shown in dark mode → click to go light)
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: "var(--text-muted)", transition: "color 0.15s ease" }}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // Sun icon (shown in light mode → click to go dark)
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: "var(--text-muted)", transition: "color 0.15s ease" }}
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
    </button>
  );
}
