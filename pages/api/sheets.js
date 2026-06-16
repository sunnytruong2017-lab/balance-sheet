export default async function handler(req, res) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const API_KEY  = process.env.GOOGLE_SHEETS_API_KEY;

  if (!SHEET_ID || !API_KEY) {
    return res.status(500).json({ error: "Google Sheets credentials not configured" });
  }

  try {
    const sheetDefs = [
      { key: "current", range: "Tips [Current Week]!A1:Z300" },
      { key: "past",    range: "Tips [Past Weeks]!A1:Z600"  },
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

// ── Row classifier ────────────────────────────────────────────────────────
// Identifies each row by what's in col B (index 1).
// Returns one of these tags, or null if the row should be skipped.

function classifyRow(row) {
  const b = (row[1] ?? "").toString().trim();
  const c = row[2];

  if (!b && !c) return null;                                          // blank

  if (b.startsWith("Week "))                      return "week_label";
  if (b === "Position")                            return "position";
  if (b === "Hours Worked" ||
      b === "Total Hours Worked")                  return "hours";
  if (b.startsWith("Credit Card"))                 return "cc_tips";
  if (b.startsWith("Cash Tips"))                   return "cash_tips";
  if (b === "Total Tips Allocated" ||
      b.startsWith("Tips Portioned"))              return "total_tips";
  if (b === "Weekly Tips")                         return "weekly_tips";
  if (b === "Tip Payouts" ||
      b === "Payment Received")                    return "ignore";
  if (b === "Pooled Credit Card Tips" ||
      b === "Pooled CC Tips"           ||
      b === "Card Tips"                ||
      c  === "Pooled Credit Card Tips" ||
      c  === "Pooled CC Tips"          ||
      c  === "Card Tips")                          return "pool_header";
  // Day-name row immediately after a pool header
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(b)) return "day_name";
  // FOH/BOH tip rate labels — ignore
  if (b === "FOH Tips" || b === "BOH Tips")       return "ignore";

  return null; // skip anything else (banners, notes, error checkers…)
}

// ── Employee column discovery ─────────────────────────────────────────────
// Scans a names row. Adjacent blank columns are treated as the second column
// of a merged employee cell (e.g. Sunny spans E+F, My spans I+J).

function getEmployees(nameRow) {
  const employees = [];
  let current = null;

  for (let i = 2; i < nameRow.length; i++) {
    const val    = nameRow[i];
    const isName = val && typeof val === "string" && val.trim().length > 0
                   && val.trim().length <= 40
                   && !val.includes(":")
                   && !(val.trim() === val.trim().toUpperCase() && val.trim().length > 6);
    const isEmpty = !val || val === "";

    if (isName) {
      current = { name: val.trim(), cols: [i] };
      employees.push(current);
    } else if (isEmpty && current && current.cols.length === 1) {
      current.cols.push(i); // merge second column
    } else {
      current = null;       // spacer — reset
    }
  }
  return employees;
}


// Names row: col B is empty/"", col C is a short employee name string
// Only used inside block scanners, not at the top level
function isNamesRow(row) {
  const b = row[1];
  const c = row[2];
  return (b === "" || b === null || b === undefined) &&
         typeof c === "string" &&
         c.trim().length > 0 &&
         c.trim().length <= 40 &&
         !c.includes(":") &&
         !(c.trim() === c.trim().toUpperCase() && c.trim().length > 6);
}

function sumCols(row, cols) {
  return cols.reduce((s, col) => s + toNum((row || [])[col]), 0);
}

function hasNumericData(row) {
  return (row || []).slice(2).some((v) => typeof v === "number" && v > 0);
}

// ── Main parser ───────────────────────────────────────────────────────────

function parseSheet(rows) {
  const dailyBlocks   = [];
  let weekLabel       = null;
  let employees       = [];
  let weeklyTips      = {};
  let weeklyTipsTotal = 0;

  let i = 0;
  while (i < rows.length) {
    const row = rows[i] || [];
    const tag = classifyRow(row);

    // ── Weekly summary block ──────────────────────────────────────────
    if (tag === "week_label") {
      weekLabel = (row[1] ?? "").toString().trim();

      // Scan forward by label until we find names + weekly_tips
      let namesRow_    = null;
      let posRow_      = null;
      let hoursRow_    = null;
      let weeklyTipsRow_ = null;

      for (let j = i + 1; j < Math.min(i + 16, rows.length); j++) {
        const r   = rows[j] || [];
        const rtag = classifyRow(r);
        if (isNamesRow(r)           && !namesRow_)      namesRow_      = r;
        if (rtag === "position"     && !posRow_)        posRow_        = r;
        if (rtag === "hours"        && !hoursRow_)      hoursRow_      = r;
        if (rtag === "weekly_tips"  && !weeklyTipsRow_) {
          // Weekly Tips may be a merged cell — values might be on next row
          weeklyTipsRow_ = hasNumericData(r) ? r : (rows[j + 1] || []);
          break;
        }
        if (rtag === "ignore") break; // hit Tip Payouts row — done
      }

      const nr = namesRow_ || [];
      const pr = posRow_   || [];
      const tr = weeklyTipsRow_ || [];

      const empList = getEmployees(nr).map(({ name, cols }) => ({
        name,
        position:   pr[cols[0]] || "",
        weeklyTips: sumCols(tr, cols),
      }));

      employees       = empList;
      weeklyTipsTotal = empList.reduce((s, e) => s + e.weeklyTips, 0);
      empList.forEach((e) => { weeklyTips[e.name] = e.weeklyTips; });

      // Advance past this entire summary block
      i++;
      continue;
    }

    // ── Daily block ───────────────────────────────────────────────────
    if (tag === "pool_header") {
      const dateStr     = formatDate(row[1]);
      const labelRow    = row; // contains "Total Tips" column header

      // Find "Total Tips" column in label row
      let totalTipsCol = -1;
      for (let k = 2; k < labelRow.length; k++) {
        if (typeof labelRow[k] === "string" &&
            labelRow[k].trim().toLowerCase() === "total tips") {
          totalTipsCol = k;
          break;
        }
      }

      // Scan forward collecting labelled rows
      let dayName      = "";
      let namesRow_    = null;
      let posRow_      = null;
      let hoursRow_    = null;
      let ccRow_       = null;
      let cashRow_     = null;
      let totalRow_    = null;
      let valRow_      = null; // day-name row (holds pool dollar values)
      let blockEnd     = i + 1;

      for (let j = i + 1; j < Math.min(i + 24, rows.length); j++) {
        const r    = rows[j] || [];
        const rtag = classifyRow(r);

        // Stop if we hit the next block
        if (rtag === "pool_header" || rtag === "week_label") {
          blockEnd = j;
          break;
        }

        // Collect each labelled row independently (no else-if — a row matches at most one)
        if (!valRow_   && rtag === "day_name")  { valRow_  = r; dayName = (r[1] ?? "").toString().trim(); continue; }
        if (!namesRow_ && isNamesRow(r))         { namesRow_ = r; continue; }
        if (!posRow_   && rtag === "position")   { posRow_   = r; continue; }
        if (!hoursRow_ && rtag === "hours")      { hoursRow_ = r; continue; }
        if (!ccRow_    && rtag === "cc_tips") {
          ccRow_ = hasNumericData(r) ? r : (rows[j + 1] || []);
          if (!hasNumericData(r)) j++;
          continue;
        }
        if (!cashRow_  && rtag === "cash_tips") {
          cashRow_ = hasNumericData(r) ? r : (rows[j + 1] || []);
          if (!hasNumericData(r)) j++;
          continue;
        }
        if (!totalRow_ && rtag === "total_tips") {
          totalRow_ = r;
          blockEnd  = j + 1;
          break;
        }
      }

      // Pool total from values row at the "Total Tips" column
      const totalTipsPool = (valRow_ && totalTipsCol >= 0)
        ? toNum(valRow_[totalTipsCol])
        : 0;

      const empCols = namesRow_ ? getEmployees(namesRow_) : [];
      const pr = posRow_   || [];
      const hr = hoursRow_ || [];
      const cr = ccRow_    || [];
      const sr = cashRow_  || [];
      const tr = totalRow_ || [];

      const dayEmployees = empCols.map(({ name, cols }) => ({
        name,
        position:  pr[cols[0]] || "",
        hours:     sumCols(hr, cols),
        ccTips:    sumCols(cr, cols),
        cashTips:  sumCols(sr, cols),
        totalTips: sumCols(tr, cols),
      })).filter((e) => e.hours > 0 || e.totalTips > 0);

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
