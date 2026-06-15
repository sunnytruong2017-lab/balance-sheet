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
 * Build an employee map from a names row.
 * Returns an array of { name, cols: [idx, ...] } where cols contains ALL
 * column indices belonging to that employee (handles merged multi-column names).
 *
 * Example: if row has [..., "Sunny", "", "Cà", ...] at indices [4,5,6,...]
 *   → Sunny gets cols [4, 5], Cà gets cols [6]
 *
 * A blank cell immediately after a named employee cell is treated as a
 * continuation of that employee's merged column group.
 */
function getEmployees(nameRow) {
  const employees = [];
  let current = null;

  for (let i = 2; i < nameRow.length; i++) {
    const val = nameRow[i];
    const isName = val && typeof val === "string" && val.trim().length > 0;
    const isEmpty = !val || val === "";

    if (isName) {
      // Start a new employee
      current = { name: val.trim(), cols: [i] };
      employees.push(current);
    } else if (isEmpty && current) {
      // Check if the NEXT cell also has a name — if so, this blank is a spacer
      // between two employees, not a continuation. Heuristic: if we've already
      // seen another blank for this employee, stop extending.
      // Simple rule: extend current employee by at most 1 blank column.
      if (current.cols.length === 1) {
        current.cols.push(i);
      } else {
        // More than one blank after a name = spacer between employees, stop
        current = null;
      }
    }
  }

  return employees;
}

/**
 * Sum a set of column indices from a row, treating each as a number.
 */
function sumCols(row, cols) {
  return cols.reduce((s, col) => s + toNum((row || [])[col]), 0);
}

/**
 * Returns true if a row has at least one numeric value > 0 in cols 2+.
 */
function hasNumericData(row) {
  return (row || []).slice(2).some((v) => typeof v === "number" && v > 0);
}

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

    // ── Weekly summary block ──────────────────────────────────────────
    if (typeof colB === "string" && colB.startsWith("Week ")) {
      weekLabel = colB;

      const nameRow = row;
      const posRow  = rows[i + 1] || [];
      const tipsRow = rows[i + 2] || [];

      const empList = getEmployees(nameRow).map(({ name, cols }) => ({
        name,
        position:   posRow[cols[0]] || "",
        weeklyTips: sumCols(tipsRow, cols),
      }));

      employees       = empList;
      weeklyTipsTotal = empList.reduce((s, e) => s + e.weeklyTips, 0);
      empList.forEach((e) => { weeklyTips[e.name] = e.weeklyTips; });
      i += 3;
      continue;
    }

    // ── Daily block ───────────────────────────────────────────────────
    if (colC === "Pooled Credit Card Tips" || colC === "Card Tips") {
      const dateStr = formatDate(colB);

      // Row i   = label row  (colC="Pooled Credit Card Tips", colE="Total Tips")
      // Row i+1 = values row (colB="Wednesday", colE=$97.25)
      const labelRow = row;
      const valRow   = rows[i + 1] || [];
      const dayName  = valRow[1] || "";

      // Find "Total Tips" column from label row, read value from values row
      let totalTipsPool = 0;
      for (let k = 2; k < labelRow.length; k++) {
        if (typeof labelRow[k] === "string" &&
            labelRow[k].trim().toLowerCase() === "total tips") {
          totalTipsPool = toNum(valRow[k]);
          break;
        }
      }

      // Scan forward from i+2 for inner data rows
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

        if (!nameRow && (b === null || b === "") &&
            typeof c === "string" && c.trim().length > 0) {
          nameRow = r;

        } else if (!posRow && b === "Position") {
          posRow = r;

        } else if (!hoursRow && b === "Hours Worked") {
          hoursRow = r;

        } else if (!ccRow && typeof b === "string" && b.startsWith("Credit Card")) {
          // Merged cell — values are on the next row
          const nextRow = rows[j + 1] || [];
          if (hasNumericData(nextRow)) { ccRow = nextRow; j++; }
          else if (hasNumericData(r))  { ccRow = r; }
          else                         { ccRow = r; }

        } else if (!cashRow && typeof b === "string" && b.startsWith("Cash Tips")) {
          const nextRow = rows[j + 1] || [];
          if (hasNumericData(nextRow)) { cashRow = nextRow; j++; }
          else if (hasNumericData(r))  { cashRow = r; }
          else                         { cashRow = r; }

        } else if (!totalRow && typeof b === "string" &&
                   (b.startsWith("Total Tips") || b.startsWith("Tips Portioned"))) {
          totalRow = r;
          blockEnd = j + 1;
          break;
        }
      }

      // Build employee list — summing across all columns for merged employees
      const empDefs = nameRow ? getEmployees(nameRow) : [];
      const nr = nameRow  || [];
      const pr = posRow   || [];
      const hr = hoursRow || [];
      const cr = ccRow    || [];
      const sr = cashRow  || [];
      const tr = totalRow || [];

      const dayEmployees = empDefs.map(({ name, cols }) => ({
        name,
        position:  pr[cols[0]] || "",
        hours:     sumCols(hr, cols),
        ccTips:    sumCols(cr, cols),
        cashTips:  sumCols(sr, cols),
        totalTips: sumCols(tr, cols),
      })).filter((e) => e.hours > 0 || e.totalTips > 0);

      // Pool: use parsed value, fall back to summing employee totals
      const pool = totalTipsPool > 0
        ? totalTipsPool
        : dayEmployees.reduce((s, e) => s + e.totalTips, 0);

      if (dayEmployees.length > 0 || pool > 0) {
        dailyBlocks.push({ date: dateStr, dayName, totalTipsPool: pool, employees: dayEmployees });
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
