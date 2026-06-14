export default async function handler(req, res) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

  if (!SHEET_ID || !API_KEY) {
    return res.status(500).json({ error: "Google Sheets credentials not configured" });
  }

  try {
    // Fetch both sheets — enough rows to cover all days + summary
    const sheetDefs = [
      { key: "current", name: "Tips [Current Week]", range: "Tips [Current Week]!A1:Q200" },
      { key: "past",    name: "Tips [Past Weeks]",   range: "Tips [Past Weeks]!A1:Q500"  },
    ];

    const results = {};

    for (const sheet of sheetDefs) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
        sheet.range
      )}?key=${API_KEY}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.json();
        results[sheet.key] = { error: err.error?.message || "Failed to fetch" };
        continue;
      }

      const data = await response.json();
      results[sheet.key] = parseSheet(data.values || []);
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Parses a Tips sheet (Current Week or Past Weeks).
 *
 * Sheet structure (0-indexed columns, col A = index 0):
 *   Each day block:
 *     Row N   : col B = date string, col C = "Pooled Credit Card Tips" (header)
 *     Row N+1 : col B = day name (Tuesday etc), col C = pooled CC tips amount
 *     Row N+2 : col B = null, col C+ = employee names (with null spacers at G and K)
 *     Row N+3 : col B = "Position", col C+ = Server/Kitchen per employee
 *     Row N+4 : col B = "Hours Worked", col C+ = hours per employee
 *     Row N+5 : col B = "Credit Card Tips (Based on Shifts)", col C+ = CC tips
 *     Row N+6 : col B = "Cash Tips (Based on Hours)", col C+ = cash tips
 *     Row N+7 : col B = "Total Tips Allocated" or "Tips Portioned", col C+ = totals
 *
 *   Weekly summary block (after all days):
 *     Row M   : col B = "Week XX", col C+ = employee names
 *     Row M+1 : col B = "Position", col C+ = positions
 *     Row M+2 : col B = "Weekly Tips", col C+ = weekly tip totals per employee
 *
 * Employee columns: C(2), D(3), E(4), F(5), [G(6)=spacer], H(7), I(8), J(9),
 *                   [K(10)=spacer], L(11), M(12), N(13), O(14), P(15)
 */
function parseSheet(rows) {
  // Col B = index 1. Employee data starts at col C = index 2.
  // Employee column indices (skip spacers at 6 and 10):
  const EMP_COLS = [2, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15];

  const dailyBlocks = [];
  let weekLabel = null;
  let employees = [];      // [{name, position, col}]
  let weeklyTips = {};     // { employeeName: amount }
  let weeklyTipsTotal = 0;

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    const colB = row?.[1];
    const colC = row?.[2];

    // Detect weekly summary: col B contains "Week" string
    if (typeof colB === "string" && colB.startsWith("Week ")) {
      weekLabel = colB;
      // Build employee map from this row
      const nameRow = row;
      const posRow  = rows[i + 1] || [];
      const tipsRow = rows[i + 2] || [];

      const empList = [];
      for (const col of EMP_COLS) {
        const name = nameRow[col];
        if (name && typeof name === "string" && name.trim()) {
          const pos  = posRow[col] || "";
          const tips = tipsRow[col];
          empList.push({ name: name.trim(), position: pos, weeklyTips: toNum(tips) });
          weeklyTips[name.trim()] = toNum(tips);
        }
      }
      employees = empList;
      weeklyTipsTotal = empList.reduce((s, e) => s + e.weeklyTips, 0);
      i += 3;
      continue;
    }

    // Detect a date row: col C === "Pooled Credit Card Tips" or "Card Tips"
    if (colC === "Pooled Credit Card Tips" || colC === "Card Tips") {
      // colB is a date string like "06/09/2026" or a serial number
      const dateStr = formatDate(colB);
      const poolRow  = rows[i + 1] || []; // day name + pooled amounts
      const nameRow  = rows[i + 2] || []; // employee names
      const posRow   = rows[i + 3] || []; // positions
      const hoursRow = rows[i + 4] || []; // hours worked
      const ccRow    = rows[i + 5] || []; // credit card tips
      const cashRow  = rows[i + 6] || []; // cash tips
      const totalRow = rows[i + 7] || []; // total tips allocated

      const dayName       = poolRow[1] || "";
      const totalTipsPool = toNum(poolRow[6]);

      const dayEmployees = [];
      for (const col of EMP_COLS) {
        const name = nameRow[col];
        if (name && typeof name === "string" && name.trim()) {
          dayEmployees.push({
            name:      name.trim(),
            position:  posRow[col] || "",
            hours:     toNum(hoursRow[col]),
            ccTips:    toNum(ccRow[col]),
            cashTips:  toNum(cashRow[col]),
            totalTips: toNum(totalRow[col]),
          });
        }
      }

      if (dayEmployees.length > 0 || totalTipsPool > 0) {
        dailyBlocks.push({ date: dateStr, dayName, totalTipsPool, employees: dayEmployees });
      }

      i += 8;
      continue;
    }

    i++;
  }

  return {
    weekLabel,
    employees,        // weekly summary employees with weeklyTips
    weeklyTipsTotal,
    weeklyTips,       // { name: amount } lookup
    dailyBlocks,      // per-day breakdown
  };
}

function toNum(val) {
  if (val === null || val === undefined || val === "") return 0;
  const n = parseFloat(String(val).replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatDate(val) {
  if (!val) return "";
  // Google Sheets returns dates as "MM/DD/YYYY" strings when using FORMATTED_STRING
  if (typeof val === "string") {
    // Try to parse MM/DD/YYYY → YYYY-MM-DD
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return val;
  }
  // Numeric serial (shouldn't happen with FORMATTED_STRING but just in case)
  return String(val);
}
