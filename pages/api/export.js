import * as XLSX from "xlsx";
import { getExpenses, getIncome } from "../../lib/notion";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ── Style helpers ──────────────────────────────────────────

const HEADER_FILL  = { fgColor: { rgb: "1A1D28" } };
const ACCENT_FILL  = { fgColor: { rgb: "0D2B1A" } };
const ALT_FILL     = { fgColor: { rgb: "F7F9FC" } };
const HEADER_FONT  = { bold: true, color: { rgb: "4FD87A" }, name: "Arial", sz: 10 };
const TITLE_FONT   = { bold: true, color: { rgb: "1A1D28" }, name: "Arial", sz: 12 };
const LABEL_FONT   = { bold: true, name: "Arial", sz: 10 };
const BODY_FONT    = { name: "Arial", sz: 10 };
const MONEY_FMT    = "$#,##0.00";
const DATE_FMT     = "yyyy-mm-dd";

function currency(v) { return { v: Math.round((v||0)*100)/100, t: "n", z: MONEY_FMT }; }
function dateCell(v) { return { v: v||"", t: "s" }; }
function text(v)     { return { v: v||"", t: "s" }; }
function bold(v)     { return { v: v||"", t: "s", s: { font: LABEL_FONT } }; }

function headerCell(v) {
  return { v, t: "s", s: { font: HEADER_FONT, fill: HEADER_FILL, alignment: { horizontal: "center" } } };
}

function titleCell(v) {
  return { v, t: "s", s: { font: TITLE_FONT, alignment: { horizontal: "left" } } };
}

// Build a sheet with a title row, styled headers, and alternating row fills
function buildSheet(title, headers, rows, colWidths) {
  const ws = {};
  const range = { s: { r: 0, c: 0 }, e: { r: rows.length + 2, c: headers.length - 1 } };

  // Row 0: title
  ws[XLSX.utils.encode_cell({ r: 0, c: 0 })] = titleCell(title);
  for (let c = 1; c < headers.length; c++) {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { v: "", t: "s" };
  }

  // Row 1: blank
  // Row 2: headers
  headers.forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 2, c })] = headerCell(h);
  });

  // Data rows
  rows.forEach((row, ri) => {
    row.forEach((cell, c) => {
      ws[XLSX.utils.encode_cell({ r: ri + 3, c })] = cell;
    });
  });

  ws["!ref"] = XLSX.utils.encode_range(range);
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];

  return ws;
}

// ── Sheet builders ─────────────────────────────────────────

function buildIncomeSheet(incomeData) {
  const headers = ["Date", "Description", "Cash Revenue", "Card Revenue", "Tip (Cash)", "Tip (Card)", "Tax", "Total Revenue", "Notes"];
  const rows = incomeData.map((e) => {
    const total = (e.cashRevenue||0) + (e.cardRevenue||0) + (e.tipCash||0) + (e.tipCard||0);
    return [
      dateCell(e.date), text(e.description),
      currency(e.cashRevenue), currency(e.cardRevenue),
      currency(e.tipCash), currency(e.tipCard),
      currency(e.tax), currency(total),
      text(e.notes),
    ];
  });

  // Total row
  if (rows.length > 0) {
    const startR = 4, endR = 3 + rows.length;
    rows.push([
      { v: "TOTAL", t: "s", s: { font: LABEL_FONT } }, text(""),
      { v: `=SUM(C${startR}:C${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      { v: `=SUM(D${startR}:D${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      { v: `=SUM(E${startR}:E${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      { v: `=SUM(F${startR}:F${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      { v: `=SUM(G${startR}:G${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      { v: `=SUM(H${startR}:H${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      text(""),
    ]);
  }

  return buildSheet("Income", headers, rows, [12, 28, 14, 14, 12, 12, 10, 16, 30]);
}

function buildExpensesSheet(expensesData, label) {
  const headers = ["Date", "Description", "Category", "Frequency", "Amount", "Notes"];
  const rows = expensesData.map((e) => [
    dateCell(e.date), text(e.description),
    text(e.category), text(e.frequency),
    currency(e.amount), text(e.notes),
  ]);

  if (rows.length > 0) {
    const startR = 4, endR = 3 + rows.length;
    rows.push([
      { v: "TOTAL", t: "s", s: { font: LABEL_FONT } },
      text(""), text(""), text(""),
      { v: `=SUM(E${startR}:E${endR})`, t: "n", z: MONEY_FMT, s: { font: LABEL_FONT } },
      text(""),
    ]);
  }

  return buildSheet(label, headers, rows, [12, 32, 20, 14, 12, 30]);
}

async function buildTipPayoutsSheet(sheetsData, payoutsData, startDate, endDate) {
  const headers = ["Employee", "Period", "Date", "Tips Amount", "Paid", "Notes"];
  const payoutMap = {};
  payoutsData.forEach((p) => { payoutMap[`${p.weekKey}::${p.employee}`] = p; });

  const rows = [];

  function addSection(sheetData, scope, scopeLabel) {
    if (!sheetData?.employees?.length) return;
    const weekKey = `${scope}:${sheetData.weekLabel || scope}`;

    // Section separator
    rows.push([
      { v: scopeLabel, t: "s", s: { font: { bold: true, name: "Arial", sz: 10, color: { rgb: "4FD87A" } } } },
      text(""), text(""), text(""), text(""), text(""),
    ]);

    sheetData.employees.forEach((emp) => {
      const key    = `${weekKey}::${emp.name}`;
      const record = payoutMap[key];
      rows.push([
        text(emp.name),
        text(sheetData.weekLabel || scopeLabel),
        text(""),
        currency(emp.weeklyTips),
        text(record?.paid ? "✓ Paid" : "Unpaid"),
        text(""),
      ]);
    });

    // Daily breakdown — filtered by date range
    (sheetData.dailyBlocks || []).forEach((day) => {
      if (startDate && day.date < startDate) return;
      if (endDate   && day.date > endDate)   return;
      if (!day.employees?.length) return;

      rows.push([
        { v: `  ${day.dayName} ${day.date}`, t: "s", s: { font: { italic: true, name: "Arial", sz: 9 } } },
        text(""), text(""), text(""), text(""), text(""),
      ]);

      day.employees.forEach((emp) => {
        const dayKey = `daily:${day.date}:${day.dayName}`;
        const key    = `${dayKey}::${emp.name}`;
        const record = payoutMap[key];
        rows.push([
          { v: `    ${emp.name}`, t: "s" },
          text("Daily"),
          text(day.date),
          currency(emp.totalTips),
          text(record?.paid ? "✓ Paid" : "Unpaid"),
          text(""),
        ]);
      });
    });
  }

  addSection(sheetsData.current, "current", `Current Week (${sheetsData.current?.weekLabel || ""})`);
  rows.push([text(""), text(""), text(""), text(""), text(""), text("")]);
  addSection(sheetsData.past, "past", `Past Week (${sheetsData.past?.weekLabel || ""})`);

  return buildSheet("Tip Payouts", headers, rows, [22, 18, 14, 14, 12, 20]);
}

async function buildWagesSheet(wagesData) {
  const headers = ["Employee", "Hourly Rate (USD)"];
  const rows = wagesData.map((w) => [text(w.employee), currency(w.hourlyRate)]);
  return buildSheet("Wage Rates", headers, rows, [24, 20]);
}

// ── Main handler ───────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  try {
    const { sections, startDate, endDate } = req.body;
    const wb = XLSX.utils.book_new();

    for (const sectionId of sections) {
      if (sectionId === "income") {
        const data = await getIncome({ startDate, endDate });
        const ws   = buildIncomeSheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Income");
      }

      if (sectionId === "all_expenses") {
        const data = await getExpenses({ startDate, endDate });
        const ws   = buildExpensesSheet(data, "All Expenses");
        XLSX.utils.book_append_sheet(wb, ws, "All Expenses");
      }

      if (sectionId === "expenses_daily") {
        const data = await getExpenses({ startDate, endDate, frequency: "Daily" });
        const ws   = buildExpensesSheet(data, "Daily Expenses");
        XLSX.utils.book_append_sheet(wb, ws, "Daily Expenses");
      }

      if (sectionId === "expenses_biweekly") {
        const data = await getExpenses({ startDate, endDate, frequency: "Biweekly" });
        const ws   = buildExpensesSheet(data, "Biweekly Expenses");
        XLSX.utils.book_append_sheet(wb, ws, "Biweekly Expenses");
      }

      if (sectionId === "expenses_monthly") {
        const data = await getExpenses({ startDate, endDate, frequency: "Monthly" });
        const ws   = buildExpensesSheet(data, "Monthly Expenses");
        XLSX.utils.book_append_sheet(wb, ws, "Monthly Expenses");
      }

      if (sectionId === "expenses_startup") {
        const data = await getExpenses({ startDate: "2000-01-01", endDate, frequency: "Startup" });
        const ws   = buildExpensesSheet(data, "Startup Costs");
        XLSX.utils.book_append_sheet(wb, ws, "Startup Costs");
      }

      if (sectionId === "payroll_tips") {
        // Fetch sheets data + payout records
        const [sheetsRes, payoutsRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/sheets`),
          fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/tip-payouts`),
        ]);
        const sheetsData  = sheetsRes.ok  ? await sheetsRes.json()  : {};
        const payoutsData = payoutsRes.ok ? await payoutsRes.json() : [];
        const ws = await buildTipPayoutsSheet(sheetsData, payoutsData, startDate, endDate);
        XLSX.utils.book_append_sheet(wb, ws, "Tip Payouts");
      }

      if (sectionId === "wages") {
        const res2 = await notion.databases.query({ database_id: process.env.NOTION_WAGES_DB });
        const data = res2.results.map((p) => ({
          employee:   p.properties.Employee?.title?.[0]?.plain_text || "",
          hourlyRate: p.properties.HourlyRate?.number || 0,
        }));
        const ws = await buildWagesSheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Wage Rates");
      }
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="ledger_export_${date}.xlsx"`);
    return res.status(200).send(buf);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
