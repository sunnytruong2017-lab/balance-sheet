export default async function handler(req, res) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

  if (!SHEET_ID || !API_KEY) {
    return res.status(500).json({ error: "Google Sheets credentials not configured" });
  }

  try {
    const sheetDefs = [
      { key: "current", range: "Tips [Current Week]!A1:Q200" },
      { key: "past",    range: "Tips [Past Weeks]!A1:Q500"  },
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

function parseSheet(rows) {
  const EMP_COLS = [2, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15];

  const dailyBlocks = [];
  let weekLabel       = null;
  let employees       = [];
  let weeklyTips      = {};
  let weeklyTipsTotal = 0;

  let i = 0;
  while (i < rows.length) {
    const row  = rows[i] || [];
    const colB = row[1];
    const colC = row[2];

    // Weekly summary block: col B starts with "Week "
    if (typeof colB === "string" && colB.startsWith("Week ")) {
      weekLabel = colB;
      const nameRow = row;
      const posRow  = rows[i + 1] || [];
      const tipsRow = rows[i + 2] || [];

      const empList = [];
      for (const col of EMP_COLS) {
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

    // Daily block: col C is "Pooled Credit Card Tips" or "Card Tips"
    if (colC === "Pooled Credit Card Tips" || colC === "Card Tips") {
      const dateStr = formatDate(colB);

      // Scan forward by label instead of fixed offsets — handles the extra
      // blank row that Past Weeks has after the pool totals row.
      let poolRow  = null;
      let nameRow  = null;
      let posRow   = null;
      let hoursRow = null;
      let ccRow    = null;
      let cashRow  = null;
      let totalRow = null;
      let blockEnd = i + 1;

      for (let j = i + 1; j < Math.min(i + 14, rows.length); j++) {
        const r = rows[j] || [];
        const b = r[1];
        const c = r[2];

        if (!poolRow && typeof b === "string" && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(b)) {
          poolRow = r;
        } else if (!nameRow && b === null && typeof c === "string" && c.trim().length > 0) {
          nameRow = r;
        } else if (!posRow && b === "Position") {
          posRow = r;
        } else if (!hoursRow && b === "Hours Worked") {
          hoursRow = r;
        } else if (!ccRow && typeof b === "string" && b.startsWith("Credit Card")) {
          ccRow = r;
        } else if (!cashRow && typeof b === "string" && b.startsWith("Cash Tips")) {
          cashRow = r;
        } else if (!totalRow && typeof b === "string" &&
                   (b.startsWith("Total Tips") || b.startsWith("Tips Portioned"))) {
          totalRow = r;
          blockEnd = j + 1;
          break;
        }
      }

      const dayName       = poolRow ? (poolRow[1] || "") : "";
      const totalTipsPool = poolRow ? (toNum(poolRow[6]) || toNum(poolRow[4])) : 0;

      const nr = nameRow  || [];
      const pr = posRow   || [];
      const hr = hoursRow || [];
      const cr = ccRow    || [];
      const sr = cashRow  || [];
      const tr = totalRow || [];

      const dayEmployees = [];
      for (const col of EMP_COLS) {
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
  const n = parseFloat(String(val).replace(/[$,]/g, ""));
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
