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
  // The Sheets API strips leading empty columns per row, so the column
  // indices shift. After stripping col A (always empty), the layout is:
  //
  // Period header row: [date, None, "-", date]  → indices 0,1,2,3
  // Header row:        ["Employee", "Job Position(s)", "Total Hours", "Hourly Rate", "Total Pay...", ...]
  // Employee row:      [name, position, hours, rate, totalPay, paid]  → indices 0-5
  // Second role row:   [position, hours, rate]  → name is missing (col A blank = stripped)
  // Total row:         ["TOTAL LABOR COST...", ?, ?, ?, totalWages]

  const periods = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i] || [];

    // Period header: row[0] is a date string, row[2] is "-", row[3] is a date string
    const periodStart = isoFromString(row[0]);
    const periodEnd   = isoFromString(row[3]);
    const isDash      = String(row[2] || "").trim() === "-";

    if (periodStart && periodEnd && isDash) {
      const period = { periodStart, periodEnd, employees: [], totalWages: 0 };
      let j = i + 2; // skip header row
      let currentName = null;

      while (j < rows.length) {
        const r = rows[j] || [];

        // Detect row type by first non-null value
        const firstVal = String(r[0] || "").trim();

        // TOTAL LABOR COST row → end of this period
        if (firstVal.toUpperCase().startsWith("TOTAL")) {
          period.totalWages = toNum(r[4]);
          i = j + 1;
          break;
        }

        // Next period header → end of this period
        const nextStart = isoFromString(r[0]);
        const nextDash  = String(r[2] || "").trim() === "-";
        if (nextStart && nextDash) {
          i = j;
          break;
        }

        // Skip blank rows and header rows
        if (!firstVal || firstVal === "Employee") { j++; continue; }

        // Check if this is a named employee row or a second-role continuation
        // Named employee: r[0]=name, r[1]=position, r[2]=hours, r[3]=rate, r[4]=pay, r[5]=paid
        // Second role:    r[0]=position, r[1]=hours, r[2]=rate  (name column was empty → stripped)
        //
        // Heuristic: if r[2] is a number (hours) AND r[3] is a number (rate) → named employee
        //            if r[1] is a number (hours) AND r[2] is a number (rate) → second role
        const r2isNum = typeof r[2] === "number";
        const r1isNum = typeof r[1] === "number";
        const r3isNum = typeof r[3] === "number";

        if (r2isNum && r3isNum) {
          // Named employee row: [name, position, hours, rate, pay, paid]
          currentName     = firstVal;
          const pos       = normalizeName(r[1]) || "";
          const hrs       = toNum(r[2]);
          const rate      = toNum(r[3]);
          const pay       = r[4];
          const paid      = r[5] === true;
          const payStr    = String(pay || "");
          const lines     = payStr.split("\n");
          const wages     = toNum(lines[0]);
          const withTips  = lines[1] ? toNum(lines[1].replace(/[()]/g, "")) : wages;
          const tipsTotal = withTips - wages;

          period.employees.push({
            name:      currentName,
            position:  pos,
            role:      deriveRole(pos),
            hours:     hrs,
            rate,
            wages:     Math.round(wages    * 100) / 100,
            tipsTotal: Math.round(tipsTotal * 100) / 100,
            withTips:  Math.round(withTips  * 100) / 100,
            paid,
          });
        } else if (r1isNum && currentName) {
          // Second role row: [position, hours, rate]
          const pos  = firstVal;
          const hrs  = toNum(r[1]);
          const rate = toNum(r[2]);
          const lastEmp = period.employees[period.employees.length - 1];
          period.employees.push({
            name:      currentName,
            position:  pos,
            role:      deriveRole(pos),
            hours:     hrs,
            rate,
            wages:     Math.round(hrs * rate * 100) / 100,
            tipsTotal: 0,
            withTips:  0,
            paid:      lastEmp?.paid || false,
            isSecondRole: true,
          });
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

// Tips sheet layout after Sheets API column stripping (leading empty col A removed):
//
// Period label:  row[0] = "06/16/2026 - 06/21/2026"
// Pool header:   row[0] = "Pooled CC Tips", row[2] = "Pooled Cash Tips", row[4] = "Total Pooled Tips"
// Pool values:   row[0] = 1148.07,          row[2] = 288,                row[4] = 1436.07
// Emp header:    row[0] = "Employee", row[1] = "Job Role(s)", row[2] = "Hours...", ...
// Employee row:  row[0] = name, row[1] = role, row[2] = hours, row[3] = ccTips, row[4] = cashTips, row[5] = total, row[6] = paid
// Second role:   row[0] = role, row[1] = hours, row[2] = ccTips, row[3] = cashTips, row[4] = total, row[5] = paid
// Daily date:    row[0] = Excel serial number (e.g. 46189)
// Error checker: row[0] = "ERROR CHECKER: CORRECT"

function parseTipsSheet(rows) {
  let result = null;
  let i = 0;

  while (i < rows.length) {
    const row = rows[i] || [];
    const r0  = String(row[0] || "").trim();

    // Period label: "06/16/2026 - 06/21/2026"
    if (r0.includes(" - ") && /\d{2}\/\d{2}\/\d{4}/.test(r0)) {
      const parts       = r0.split(" - ");
      const periodStart = isoFromString(parts[0]);
      const periodEnd   = isoFromString(parts[1]);

      // Pool values are 2 rows down
      const poolRow = rows[i + 2] || [];
      result = {
        periodLabel: r0,
        periodStart,
        periodEnd,
        poolCC:    toNum(poolRow[0]),
        poolCash:  toNum(poolRow[2]),
        poolTotal: toNum(poolRow[4]),
        employees: [],
        dailyBreakdowns: [],
      };

      // Find employee header row then start reading
      let j = i + 3;
      while (j < rows.length && !isEmpHeader(rows[j])) j++;
      j++; // skip header

      let currentName = null;

      while (j < rows.length) {
        const r = rows[j] || [];
        const r0v = String(r[0] || "").trim();

        if (isDateRow(r) || isErrorChecker(r)) { i = j; break; }
        if (!r0v || r0v === "Employee") { j++; continue; }

        // Employee vs second-role heuristic:
        // Employee: r[1] is role string (FOH/BOH), r[2] is number (hours)
        // Second role: r[0] is role string, r[1] is number (hours)
        const r1isRole   = typeof r[1] === "string" && ["FOH","BOH"].includes(String(r[1]).trim());
        const r1isNumber = typeof r[1] === "number";

        if (r1isRole) {
          // Named employee: [name, role, hours, ccTips, cashTips, total, paid]
          currentName = r0v;
          result.employees.push(makeTipEmp(r0v, r[1], r[2], r[3], r[4], r[5], r[6]));
        } else if (r1isNumber && currentName) {
          // Second role: [role, hours, ccTips, cashTips, total, paid]
          result.employees.push(makeTipEmp(currentName, r0v, r[1], r[2], r[3], r[4], r[5], true));
        }
        j++;
      }

      // Daily breakdowns
      while (i < rows.length) {
        const r   = rows[i] || [];
        const r0v = r[0];

        if (isDateRow(r)) {
          const date    = isoFromSerial(r0v);
          const pRow    = rows[i + 2] || [];
          const dayPool = {
            date,
            poolCC:    toNum(pRow[0]),
            poolCash:  toNum(pRow[2]),
            poolTotal: toNum(pRow[4]),
            employees: [],
          };

          let k = i + 3;
          while (k < rows.length && !isEmpHeader(rows[k])) k++;
          k++;

          let curName = null;
          while (k < rows.length) {
            const er   = rows[k] || [];
            const er0v = String(er[0] || "").trim();
            if (isDateRow(er) || isErrorChecker(er)) { i = isErrorChecker(er) ? k + 1 : k; break; }
            if (!er0v) { k++; continue; }

            const er1isRole   = typeof er[1] === "string" && ["FOH","BOH"].includes(String(er[1]).trim());
            const er1isNumber = typeof er[1] === "number";

            if (er1isRole) {
              curName = er0v;
              const emp = makeTipEmp(er0v, er[1], er[2], er[3], er[4], er[5], er[6]);
              if (emp.hours > 0 || emp.total > 0) dayPool.employees.push(emp);
            } else if (er1isNumber && curName) {
              const emp = makeTipEmp(curName, er0v, er[1], er[2], er[3], er[4], er[5], true);
              if (emp.hours > 0 || emp.total > 0) dayPool.employees.push(emp);
            }
            k++;
          }

          if (dayPool.employees.length > 0 || dayPool.poolTotal > 0) {
            result.dailyBreakdowns.push(dayPool);
          }
          continue;
        }

        // Stop at next period label or end
        if (typeof r0v === "string" && r0v.includes(" - ") && /\d{2}\/\d{2}\/\d{4}/.test(r0v)) break;
        i++;
      }

      return result;
    }

    i++;
  }

  return result;
}

function makeTipEmp(name, role, hours, ccTips, cashTips, total, paid, isSecondRole) {
  return {
    name:         String(name || "").trim(),
    role:         String(role || "").trim(),
    hours:        toNum(hours),
    ccTips:       Math.round(toNum(ccTips)   * 100) / 100,
    cashTips:     Math.round(toNum(cashTips) * 100) / 100,
    total:        Math.round(toNum(total)    * 100) / 100,
    paid:         paid === true,
    isSecondRole: !!isSecondRole,
  };
}

function isEmpHeader(row) {
  return String((row || [])[0] || "").trim() === "Employee";
}

function isErrorChecker(row) {
  return String((row || [])[0] || "").trim().startsWith("ERROR CHECKER");
}

function isDateRow(row) {
  const v = (row || [])[0];
  return typeof v === "number" && v > 40000 && v < 55000;
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
