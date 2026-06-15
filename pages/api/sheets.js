export default async function handler(req, res) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const API_KEY  = process.env.GOOGLE_SHEETS_API_KEY;

  if (!SHEET_ID || !API_KEY) {
    return res.status(500).json({ error: "Google Sheets credentials not configured" });
  }

  try {
    const sheetDefs = [
      { key: "current", range: "Tips [Current Week]!A1:Z200" },
      { key: "past",    range: "Tips [Past Weeks]!A1:Z500"  },
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
 * Returns column indices (starting at 2) where the nameRow has a non-empty
 * string — these are employee columns. Blank/spacer columns are skipped.
 */
function getEmpCols(nameRow) {
  const cols = [];
  for (let i = 2; i < nameRow.length; i++) {
    const val = nameRow[i];
    if (val && typeof val === "string" && val.trim().length > 0) {
      cols.push(i);
    }
  }
  return cols;
}

/**
 * Returns true if a row has at least one numeric value > 0 in employee
 * columns (index 2+). Used to distinguish value rows from label/blank rows.
 */
function hasNumericData(row) {
  return (row || []).slice(2).some((v) => typeof v === "number" && v > 0);
}

/**
 * Sheet layout per daily block (Current Week, Tips [Current Week] tab):
 *
 *   Row 12: colB=date, colC="Pooled Credit Card Tips", colD="Pooled Cash Tips",
 *           colE="Total Tips", colF="Server Cash Tips", ...   ← LABEL row
 *   Row 13: colB="Tuesday", colC=$92.06, colD=$8.00, colE=$100.06, ...  ← VALUES row
 *   Row 14: (blank)
 *   Row 15: colB="", colC="Khôi", colD="Ngân", ...           ← NAMES row
 *   Row 16: colB="Position", colC=Server, ...                 ← POSITION row
 *   Row 17: colB="Hours Worked", colC=10.26, ...              ← HOURS row
 *   Row 18: colB="Credit Card Tips\n(Based on Shifts)", values may be $0 ← CC LABEL
 *   Row 19: colB="", colC=$32.22, ...                         ← CC VALUES (merged cell)
 *   Row 20: colB="Cash Tips\n(Based on Hours)", values may be $0  ← CASH LABEL
 *   Row 21: colB="", colC=$2.87, ...                          ← CASH VALUES (merged cell)
 *   Row 22: (blank)
 *   Row 23: colB="Total Tips Allocated", colC=$35.09, ...     ← TOTALS row
 *
 * Key insight: "Credit Card Tips" and "Cash Tips" are VERTICALLY MERGED cells.
 * The Sheets API puts the label text on the first row of the merge and "" on
 * the second. The actual dollar values appear on the SECOND row of the merge.
 * So after finding the label row, we always check the next row for real data.
 *
 * Pool total: read from the VALUES row (day-name row) using the column index
 * where the LABEL row says "Total Tips".
 */
function parseSheet(rows) {
  const dailyBlocks   = [];
  let weekLabel       = null;
  let employees       = [];
  let weeklyTips      = {};
  let weeklyTipsTotal = 0;

  let i = 0;
  while (i < rows.length) {
    const row  = rows[i] || [];
    const colB = row[1];
    const colC = row[2];

    // ── Weekly summary block: col B starts with "Week " ──────────────
    if (typeof colB === "string" && colB.startsWith("Week ")) {
      weekLabel = colB;

      const nameRow = row;
      const posRow  = rows[i + 1] || [];
      const tipsRow = rows[i + 2] || [];

      const empCols = getEmpCols(nameRow);
      const empList = [];
      for (const col of empCols) {
        const name = nameRow[col];
        if (name && typeof name === "string" && name.trim()) {
          empList.push({
            name:       name.trim(),
            position:   posRow[col] || "",
            weeklyTips: toNum(tipsRow[col]),
          });
          weeklyTips[name.trim()] = toNum(tipsRow[col]);
        }
      }

      employees       = empList;
      weeklyTipsTotal = empList.reduce((s, e) => s + e.weeklyTips, 0);
      i += 3;
      continue;
    }

    // ── Daily block: triggered by the pool label row ──────────────────
    if (colC === "Pooled Credit Card Tips" || colC === "Card Tips") {
      const dateStr = formatDate(colB);

      // Row i   = label row  (colC = "Pooled Credit Card Tips", colE = "Total Tips")
      // Row i+1 = values row (colB = "Tuesday", colE = $100.06)
      // Find which column in the label row says "Total Tips"
      const labelRow  = row;
      const valRow    = rows[i + 1] || [];
      const dayName   = valRow[1] || "";

      let totalTipsCol = -1;
      for (let k = 2; k < labelRow.length; k++) {
        if (typeof labelRow[k] === "string" &&
            labelRow[k].trim().toLowerCase() === "total tips") {
          totalTipsCol = k;
          break;
        }
      }
      // Pool total from values row at the Total Tips column
      // Fall back to summing employee tips later if column not found
      const totalTipsPool = totalTipsCol >= 0 ? toNum(valRow[totalTipsCol]) : 0;

      // Scan forward from i+2 for the inner data rows
      let nameRow  = null;
      let posRow   = null;
      let hoursRow = null;
      let ccRow    = null;
      let cashRow  = null;
      let totalRow = null;
      let blockEnd = i + 2;

      for (let j = i + 2; j < Math.min(i + 20, rows.length); j++) {
        const r = rows[j] || [];
        const b = r[1];
        const c = r[2];

        // Names row: col B empty, col C is a non-empty employee name string
        if (!nameRow && (b === null || b === "") &&
            typeof c === "string" && c.trim().length > 0) {
          nameRow = r;

        } else if (!posRow && b === "Position") {
          posRow = r;

        } else if (!hoursRow && b === "Hours Worked") {
          hoursRow = r;

        // CC Tips: label is on this row, but values are on the NEXT row
        // (vertically merged cell — Sheets API splits across two rows)
        } else if (!ccRow && typeof b === "string" && b.startsWith("Credit Card")) {
          // Prefer the next row if it has numeric data (the merge's value row)
          const nextRow = rows[j + 1] || [];
          if (hasNumericData(nextRow)) {
            ccRow = nextRow;
            j++;  // skip the value row since we just consumed it
          } else if (hasNumericData(r)) {
            ccRow = r;  // values are on the label row itself
          } else {
            ccRow = r;  // fallback
          }

        // Cash Tips: same merged-cell pattern as CC Tips
        } else if (!cashRow && typeof b === "string" && b.startsWith("Cash Tips")) {
          const nextRow = rows[j + 1] || [];
          if (hasNumericData(nextRow)) {
            cashRow = nextRow;
            j++;
          } else if (hasNumericData(r)) {
            cashRow = r;
          } else {
            cashRow = r;
          }

        } else if (!totalRow && typeof b === "string" &&
                   (b.startsWith("Total Tips") || b.startsWith("Tips Portioned"))) {
          totalRow = r;
          blockEnd = j + 1;
          break;
        }
      }

      const empCols = nameRow ? getEmpCols(nameRow) : [];
      const nr = nameRow  || [];
      const pr = posRow   || [];
      const hr = hoursRow || [];
      const cr = ccRow    || [];
      const sr = cashRow  || [];
      const tr = totalRow || [];

      const dayEmployees = [];
      for (const col of empCols) {
        const name = nr[col];
        if (name && typeof name === "string" && name.trim()) {
          dayEmployees.push({
            name:      name.trim(),
            position:  pr[col] || "",
            hours:     toNum(hr[col]),
            ccTips:    toNum(cr[col]),
            cashTips:  toNum(sr[col]),
            totalTips: toNum(tr[col]),
          });
        }
      }

      // Use parsed pool total, or fall back to summing employee totals
      const pool = totalTipsPool > 0
        ? totalTipsPool
        : dayEmployees.reduce((s, e) => s + e.totalTips, 0);

      if (dayEmployees.length > 0 || pool > 0) {
        dailyBlocks.push({
          date: dateStr, dayName,
          totalTipsPool: pool,
          employees: dayEmployees,
        });
      }

      i = blockEnd;
      continue;
    }

    i++;
  }

  return { weekLabel, employees, weeklyTipsTotal, weeklyTips, dailyBlocks };
}

function toNum(val) {
  if (val === null || val === undefined || val === "") return 0;
  const s = String(val);
  // Values containing "/" are rates (e.g. "$0.28/hr") — not dollar totals
  if (s.includes("/")) return 0;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatDate(val) {
  if (!val) return "";
  if (typeof val === "string") {
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return val;
  }
  return String(val);
}
