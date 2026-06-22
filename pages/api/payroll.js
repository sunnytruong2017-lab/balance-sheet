import {
  getWages, syncEmployeesFromSheets,
  upsertPayrollRecord, getPayrollRecords, markPayrollPaid,
  upsertTipPayout, getTipPayouts, markTipPaid,
} from "../../lib/notion";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY  = process.env.GOOGLE_SHEETS_API_KEY;

// ── Fetch a sheet range ────────────────────────────────────

async function fetchSheet(sheetName, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
    `${sheetName}!${range}`
  )}?key=${API_KEY}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Failed to fetch ${sheetName}`);
  }
  const data = await res.json();
  return data.values || [];
}

// ── Helpers ────────────────────────────────────────────────

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  // Strip $ signs, commas, and parenthetical portion like "$876.69\n($981.92)"
  const s = String(v).split("\n")[0].replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function isoFromSerial(serial) {
  if (!serial || typeof serial !== "number") return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split("T")[0];
}

function isoFromString(s) {
  if (!s) return null;
  s = String(s).trim();
  // "2026-06-16 00:00:00" → "2026-06-16"
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // "06/16/2026 - ..." → "2026-06-16"
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  return null;
}

function normalizeName(v) {
  return v ? String(v).trim() : null;
}

// ── Parse Payroll sheet ────────────────────────────────────
// Returns array of periods:
// { periodStart, periodEnd, employees: [{ name, position, role, hours, rate, wages, tipsTotal, paid }], totalWages }

function parsePayrollSheet(rows) {
  const periods = [];
  let i = 0;

  while (i < rows.length) {
    const row  = rows[i] || [];
    const colB = row[1];
    const colC = row[2];
    const colE = row[4];

    // Period header: col B is a date, col C is "-", col E is a date
    const periodStart = isoFromString(colB);
    const periodEnd   = isoFromString(colE);
    const isDash      = String(colC || "").trim() === "-";

    if (periodStart && periodEnd && isDash) {
      // Skip the header row (i+1: "Employee | Job Position(s) | ...")
      const period = { periodStart, periodEnd, employees: [], totalWages: 0 };
      let j = i + 2; // start at first data row
      let currentName = null;

      while (j < rows.length) {
        const r    = rows[j] || [];
        const name = normalizeName(r[1]);
        const pos  = normalizeName(r[2]);
        const hrs  = toNum(r[3]);
        const rate = toNum(r[4]);
        const pay  = r[5]; // may be string like "$876.69\n($981.92)" or plain number
        const paid = r[6] === true;

        // TOTAL LABOR COST row → end of this period
        if (name && name.toUpperCase().startsWith("TOTAL")) {
          period.totalWages = toNum(r[5]);
          i = j + 1;
          break;
        }

        // New named employee
        if (name && name !== "-") {
          currentName = name;
          // Extract wages (first line) and tips-included total (parenthetical)
          const payStr    = String(pay || "");
          const lines     = payStr.split("\n");
          const wages     = toNum(lines[0]);
          const withTips  = lines[1] ? toNum(lines[1].replace(/[()]/g, "")) : wages;
          const tipsTotal = withTips - wages;

          period.employees.push({
            name:      currentName,
            position:  pos || "",
            role:      deriveRole(pos),
            hours:     hrs,
            rate,
            wages:     Math.round(wages   * 100) / 100,
            tipsTotal: Math.round(tipsTotal * 100) / 100,
            withTips:  Math.round(withTips  * 100) / 100,
            paid,
          });
        } else if (!name && pos && currentName) {
          // Continuation row for dual-role employee (blank name, different position)
          const lastEmp = period.employees[period.employees.length - 1];
          if (lastEmp && lastEmp.name === currentName) {
            // Add a second role entry
            period.employees.push({
              name:      currentName,
              position:  pos,
              role:      deriveRole(pos),
              hours:     hrs,
              rate,
              wages:     Math.round(hrs * rate * 100) / 100,
              tipsTotal: 0,
              withTips:  0,
              paid:      lastEmp.paid, // same paid status
              isSecondRole: true,
            });
          }
        }

        j++;
      }

      periods.push(period);
      continue;
    }

    i++;
  }

  return periods;
}

// ── Parse Tips sheet ───────────────────────────────────────
// Returns:
// { periodLabel, periodStart, periodEnd, poolCC, poolCash, poolTotal,
//   employees: [{ name, role, hours, ccTips, cashTips, total, paid }],
//   dailyBreakdowns: [{ date, poolCC, poolCash, poolTotal, employees: [...] }] }

function parseTipsSheet(rows) {
  let result = null;
  let i = 0;

  while (i < rows.length) {
    const row  = rows[i] || [];
    const colB = row[1];

    // Period label like "06/16/2026 - 06/21/2026"
    if (typeof colB === "string" && colB.includes(" - ") && /\d{2}\/\d{2}\/\d{4}/.test(colB)) {
      const parts = colB.split(" - ");
      const periodStart = isoFromString(parts[0]);
      const periodEnd   = isoFromString(parts[1]);

      // Next row: "Pooled CC Tips | · | Pooled Cash Tips | · | Total Pooled Tips"
      // Row after: actual values
      const poolRow  = rows[i + 2] || [];
      const poolCC   = toNum(poolRow[1]);
      const poolCash = toNum(poolRow[3]);
      const poolTotal = toNum(poolRow[5]);

      result = {
        periodLabel: colB,
        periodStart,
        periodEnd,
        poolCC,
        poolCash,
        poolTotal,
        employees: [],
        dailyBreakdowns: [],
      };

      // Skip to employee data (headers row at i+3, data starts i+4 or i+5)
      let j = i + 3;
      // Find employee header row ("Employee | Job Role(s) | ...")
      while (j < rows.length && !isEmpHeader(rows[j])) j++;
      j++; // skip header row, may have blank row after

      let currentName = null;

      while (j < rows.length) {
        const r    = rows[j] || [];
        const name = normalizeName(r[1]);
        const role = normalizeName(r[2]);

        // Hit a date row (daily breakdown) or ERROR CHECKER → end of period summary
        if (isDateRow(r) || isErrorChecker(r)) {
          i = j;
          break;
        }

        if (name && name !== "·") {
          currentName = name;
          result.employees.push(makeEmpTip(r));
        } else if (!name && role && currentName) {
          // Second role row
          result.employees.push({ ...makeEmpTip(r), name: currentName, isSecondRole: true });
        }

        j++;
      }

      // Parse daily breakdowns
      while (i < rows.length) {
        const r    = rows[i] || [];
        const colB = r[1];

        if (isDateRow(r)) {
          const date    = isoFromString(colB) || isoFromSerial(colB);
          const pRow    = rows[i + 2] || [];
          const dayPool = {
            date,
            poolCC:    toNum(pRow[1]),
            poolCash:  toNum(pRow[3]),
            poolTotal: toNum(pRow[5]),
            employees: [],
          };

          // Find employee header + data
          let k = i + 3;
          while (k < rows.length && !isEmpHeader(rows[k])) k++;
          k++;

          let curName = null;
          while (k < rows.length) {
            const er = rows[k] || [];
            if (isDateRow(er) || isErrorChecker(er) || !er.some((v) => v !== null)) {
              i = isErrorChecker(er) ? k + 1 : k;
              break;
            }
            const ename = normalizeName(er[1]);
            const erole = normalizeName(er[2]);
            if (ename && ename !== "·") {
              curName = ename;
              const emp = makeEmpTip(er);
              if (emp.hours > 0 || emp.total > 0) dayPool.employees.push(emp);
            } else if (!ename && erole && curName) {
              const emp = { ...makeEmpTip(er), name: curName, isSecondRole: true };
              if (emp.hours > 0 || emp.total > 0) dayPool.employees.push(emp);
            }
            k++;
          }

          if (dayPool.employees.length > 0 || dayPool.poolTotal > 0) {
            result.dailyBreakdowns.push(dayPool);
          }
          continue;
        }

        i++;
        // Stop when we hit the next period label or end of sheet
        if (result.dailyBreakdowns.length > 0 && isDateRange(rows[i])) break;
      }

      return result; // Return the first (most recent) period
    }

    i++;
  }

  return result;
}

function makeEmpTip(r) {
  return {
    name:     normalizeName(r[1]) || "",
    role:     normalizeName(r[2]) || "",
    hours:    toNum(r[3]),
    ccTips:   Math.round(toNum(r[4]) * 100) / 100,
    cashTips: Math.round(toNum(r[5]) * 100) / 100,
    total:    Math.round(toNum(r[6]) * 100) / 100,
    paid:     r[7] === true,
  };
}

function isEmpHeader(row) {
  const b = normalizeName((row || [])[1]);
  return b === "Employee";
}

function isErrorChecker(row) {
  const b = String((row || [])[1] || "").trim();
  return b.startsWith("ERROR CHECKER");
}

function isDateRow(row) {
  const b = (row || [])[1];
  return b && typeof b === "number" && b > 40000 && b < 50000; // Excel date serial
}

function isDateRange(row) {
  const b = (row || [])[1];
  return typeof b === "string" && b.includes(" - ") && /\d{2}\/\d{2}\/\d{4}/.test(b);
}

function deriveRole(position) {
  if (!position) return "FOH";
  const p = position.toLowerCase();
  if (p.includes("server") || p.includes("busser") || p.includes("host")) return "FOH";
  return "BOH";
}

// ── Auto-sync to Notion ────────────────────────────────────

async function syncPayrollToNotion(period) {
  const { periodStart, periodEnd, employees } = period;

  // 1. Sync new employees to Wages DB
  const empRoles = employees.map((e) => ({ name: e.name, role: e.role }));
  await syncEmployeesFromSheets(empRoles);

  // 2. Upsert payroll records
  await Promise.all(
    employees.map((emp) =>
      upsertPayrollRecord({
        employee:   emp.name,
        role:       emp.role,
        periodStart,
        periodEnd,
        hours:      emp.hours,
        hourlyRate: emp.rate,
        wages:      emp.wages,
        tips:       emp.tipsTotal,
        total:      emp.withTips || emp.wages + emp.tipsTotal,
      })
    )
  );
}

async function syncTipsToNotion(tipsData) {
  const { periodStart, periodEnd, employees } = tipsData;
  const periodKey = periodStart;

  // Sync employees
  const empRoles = employees.map((e) => ({ name: e.name, role: e.role }));
  await syncEmployeesFromSheets(empRoles);

  // Upsert tip payouts
  await Promise.all(
    employees.map((emp) =>
      upsertTipPayout({
        employee:  emp.name,
        role:      emp.role,
        periodKey,
        ccTips:    emp.ccTips,
        cashTips:  emp.cashTips,
        total:     emp.total,
      })
    )
  );
}

// ── Handler ────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { periodStart } = req.query;

      // Fetch both sheets in parallel
      const [payrollRows, tipsRows] = await Promise.all([
        fetchSheet("Payroll", "A1:H200"),
        fetchSheet("Tips",    "A1:I500"),
      ]);

      const payrollPeriods = parsePayrollSheet(payrollRows);
      const tipsData       = parseTipsSheet(tipsRows);

      // Find matching payroll period or default to most recent
      let payrollPeriod = payrollPeriods[0];
      if (periodStart) {
        payrollPeriod = payrollPeriods.find((p) => p.periodStart === periodStart) || payrollPeriods[0];
      }

      if (!payrollPeriod) {
        return res.status(200).json({ periods: [], tipsData: null, records: [], totals: {} });
      }

      // Auto-sync to Notion in background
      Promise.all([
        syncPayrollToNotion(payrollPeriod),
        tipsData ? syncTipsToNotion(tipsData) : Promise.resolve(),
      ]).catch(console.error);

      // Fetch Notion records for paid status
      const [notionPayroll, notionTips] = await Promise.all([
        getPayrollRecords(payrollPeriod.periodStart),
        tipsData ? getTipPayouts(tipsData.periodStart) : Promise.resolve([]),
      ]);

      // Build paid status lookups
      const payrollPaidMap = {};
      notionPayroll.forEach((r) => {
        payrollPaidMap[`${r.employee}::${r.role}`] = { id: r.id, paid: r.paid };
      });
      const tipsPaidMap = {};
      notionTips.forEach((r) => {
        tipsPaidMap[`${r.employee}::${r.role}`] = { id: r.id, paid: r.paid };
      });

      // Merge paid status into payroll records
      const recordsWithStatus = payrollPeriod.employees.map((emp) => {
        const key     = `${emp.name}::${emp.role}`;
        const pRecord = payrollPaidMap[key] || {};
        return {
          ...emp,
          notionId: pRecord.id   || null,
          paid:     pRecord.paid || false,
        };
      });

      // Merge paid status into tips records
      const tipsWithStatus = tipsData ? {
        ...tipsData,
        employees: tipsData.employees.map((emp) => {
          const key     = `${emp.name}::${emp.role}`;
          const tRecord = tipsPaidMap[key] || {};
          return {
            ...emp,
            notionId: tRecord.id   || null,
            paid:     tRecord.paid || false,
          };
        }),
      } : null;

      // Compute totals
      const totals = recordsWithStatus.reduce((acc, r) => ({
        hours: acc.hours + r.hours,
        wages: acc.wages + r.wages,
        tips:  acc.tips  + r.tipsTotal,
        total: acc.total + (r.withTips || r.wages + r.tipsTotal),
      }), { hours: 0, wages: 0, tips: 0, total: 0 });

      return res.status(200).json({
        periods:      payrollPeriods.map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd, totalWages: p.totalWages })),
        payrollPeriod: { ...payrollPeriod, employees: recordsWithStatus },
        tipsData:     tipsWithStatus,
        totals,
      });
    }

    if (req.method === "POST") {
      const { type, notionId, paid } = req.body;
      if (!notionId) return res.status(400).json({ error: "notionId required" });
      const record = type === "tips"
        ? await markTipPaid(notionId, paid)
        : await markPayrollPaid(notionId, paid);
      return res.status(200).json(record);
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
