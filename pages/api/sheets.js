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
 * Dynamically discovers employee columns by scanning the names row for
 * non-empty strings starting at col C (index 2). Blank spacer columns
 * are skipped automatically.
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
 * Sheet layout for each daily block (Current Week):
 *
 *   Row A (trigger): colB = date "06/09/2026", colC = "Pooled Credit Card Tips"
 *                    colC=$92.06, colD=$8.00, colE=$100.06 (Total Tips),
 *                    colF=$5.60, colG=$0.28/hr, colH=$2.40, colI=$0.08/hr
 *   Row B:           colB = "Tuesday",  (same pool values repeated or blank)
 *   Row C:           colB = "",  colC..= employee names  ← names row
 *   Row D:           colB = "Position", colC..= positions
 *   Row E:           colB = "Hours Worked", colC..= hours
 *   Row F+G:         colB = "Credit Card Tips\n(Based on Shifts)" — MERGED CELL
 *                    label may appear on row F or G; values on same row as label
 *   Row H+I:         colB = "Cash Tips\n(Based on Hours)" — MERGED CELL
 *   Row J:           colB = "Total Tips Allocated", colC..= totals
 *
 * Key insight: the TRIGGER row itself (row A) holds the pool totals.
 *   colE (index 4) = Total Tips pool — this is the reliable column to read.
 *
 * "Credit Card Tips" label spans 2 merged rows. The Sheets API returns the
 * label text on the FIRST of the two rows and "" on the second. We must NOT
 * mistake the second blank row for the names row, so we only accept a names
 * row AFTER we've already found the pool/day-name rows.
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

    // ── Weekly summary block ──────────────────────────────────────────
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
          const pos  = posRow[col] || "";
          const tips = toNum(tipsRow[col]);
          empList.push({ name: name.trim(), position: pos, weeklyTips: tips });
          weeklyTips[name.trim()] = tips;
        }
      }

      employees       = empList;
      weeklyTipsTotal = empList.reduce((s, e) => s + e.weeklyTips, 0);
      i += 3;
      continue;
    }

    // ── Daily block trigger ───────────────────────────────────────────
    // Triggered when colC is the pool header label.
    // The TRIGGER ROW itself (row i) contains the pool totals:
    //   colC = Pooled CC Tips, colD = Pooled Cash Tips, colE = Total Tips
    if (colC === "Pooled Credit Card Tips" || colC === "Card Tips") {
      const dateStr = formatDate(colB);

      // Read pool total directly from the trigger row:
      // colE (index 4) = Total Tips for Current Week
      // colC (index 2) = Pooled CC Tips (fallback for Past Weeks layout)
      const triggerRow    = row;
      const totalTipsPool = toNum(triggerRow[4]) || toNum(triggerRow[2]);

      // Now scan forward to find labelled rows
      let dayName  = "";
      let nameRow  = null;
      let posRow   = null;
      let hoursRow = null;
      let ccRow    = null;
      let cashRow  = null;
      let totalRow = null;
      let blockEnd = i + 1;
      let foundDayName = false;

      for (let j = i + 1; j < Math.min(i + 16, rows.length); j++) {
        const r = rows[j] || [];
        const b = r[1];
        const c = r[2];

        // Day name row (e.g. "Tuesday") — col B matches day name
        if (!foundDayName && typeof b === "string" && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(b)) {
          dayName = b;
          foundDayName = true;

        // Names row: col B is empty AND col C is a non-empty string (employee name)
        // Only accept AFTER we've found the day name to avoid picking up
        // the second row of a merged "Credit Card Tips" cell
        } else if (!nameRow && foundDayName && (b === null || b === "") && typeof c === "string" && c.trim().length > 0) {
          nameRow = r;

        } else if (!posRow && b === "Position") {
          posRow = r;

        } else if (!hoursRow && b === "Hours Worked") {
          hoursRow = r;

        // Credit Card Tips — label may be on either of two merged rows.
        // Accept any row whose col B starts with "Credit Card" OR whose
        // col B is empty but we haven't found ccRow yet AND hoursRow is set
        // (meaning we're past the names/position/hours rows).
        } else if (!ccRow && typeof b === "string" && b.startsWith("Credit Card")) {
          ccRow = r;
        } else if (!ccRow && hoursRow && (b === null || b === "") && !nameRow === false && !cashRow) {
          // Second row of merged "Credit Card Tips" cell — values are here
          // Only pick this up if the row has numeric data in employee columns
          const hasData = r.slice(2).some((v) => typeof v === "number" && v > 0);
          if (hasData) ccRow = r;

        } else if (!cashRow && typeof b === "string" && b.startsWith("Cash Tips")) {
          cashRow = r;

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

      if (dayEmployees.length > 0 || totalTipsPool > 0) {
        dailyBlocks.push({ date: dateStr, dayName, totalTipsPool, employees: dayEmployees });
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
  const n = parseFloat(String(val).replace(/[$,\/a-zA-Z\s]/g, ""));
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
