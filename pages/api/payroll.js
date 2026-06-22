import {
  getWages, syncEmployeesFromSheets,
  upsertPayrollRecord, getPayrollRecords, markPayrollPaid,
  upsertTipPayout, getTipPayouts, markTipPaid,
} from "../../lib/notion";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY  = process.env.GOOGLE_SHEETS_API_KEY;

// ── Parse Calculation Sheet ────────────────────────────────

async function fetchCalculationSheet() {
  const range = "Calculation Sheet!A1:M500";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch Calculation Sheet");
  const data = await res.json();
  return data.values || [];
}

function excelDateToISO(serial) {
  // Excel date serial to YYYY-MM-DD
  if (!serial || typeof serial !== "number") return null;
  const date = new Date((serial - 25569) * 86400 * 1000);
  return date.toISOString().split("T")[0];
}

function parseCalculationSheet(rows) {
  // Skip header row (row 0)
  const shifts  = [];
  const orders  = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];

    // Left side: shifts (cols A-H, indices 0-7)
    if (row[0] && row[3]) { // Employee name and Date Value
      const dateISO = excelDateToISO(row[3]);
      if (dateISO) {
        // Parse "Last, First" → "First" for display
        const fullName = String(row[0]).trim();
        const nameParts = fullName.includes(",")
          ? fullName.split(",").map((p) => p.trim()).reverse()
          : [fullName];
        const displayName = nameParts.join(" ");

        shifts.push({
          employeeFull: fullName,
          employeeName: displayName,
          jobTitle:     String(row[1] || "").trim(),
          role:         String(row[2] || "").trim(), // FOH or BOH
          date:         dateISO,
          shiftIn:      row[4] ? String(row[4]) : null,
          shiftOut:     row[5] ? String(row[5]) : null,
          hours:        typeof row[6] === "number" ? row[6] : 0,
          tipsAllocated: typeof row[7] === "number" ? row[7] : 0,
        });
      }
    }

    // Right side: orders (cols J-M, indices 9-12)
    if (row[9] && row[10]) { // Order # and Date Value
      const dateISO = excelDateToISO(row[10]);
      if (dateISO) {
        orders.push({
          orderNum:  row[9],
          date:      dateISO,
          closedAt:  row[11] ? String(row[11]) : null,
          tipAmount: typeof row[12] === "number" ? row[12] : 0,
        });
      }
    }
  }

  return { shifts, orders };
}

// ── Aggregate payroll for a period ────────────────────────

function getBiweeklyPeriod(month, year, half) {
  // half: 1 = 1st-15th, 2 = 16th-end
  const start = half === 1
    ? `${year}-${String(month).padStart(2,"0")}-01`
    : `${year}-${String(month).padStart(2,"0")}-16`;

  const lastDay = new Date(year, month, 0).getDate();
  const end = half === 1
    ? `${year}-${String(month).padStart(2,"0")}-15`
    : `${year}-${String(month).padStart(2,"0")}-${lastDay}`;

  return { start, end };
}

function aggregatePayroll(shifts, orders, periodStart, periodEnd, wageRates) {
  // Filter shifts to period
  const periodShifts = shifts.filter((s) => s.date >= periodStart && s.date <= periodEnd);

  // Tips per day from orders
  const tipsByDay = {};
  orders
    .filter((o) => o.date >= periodStart && o.date <= periodEnd)
    .forEach((o) => {
      tipsByDay[o.date] = (tipsByDay[o.date] || 0) + o.tipAmount;
    });

  // Build employee map: { "Name::Role": { hours, tipsAllocated, ... } }
  const empMap = {};
  const allEmployees = new Set();

  periodShifts.forEach((shift) => {
    const key = `${shift.employeeName}::${shift.role}`;
    if (!empMap[key]) {
      empMap[key] = {
        employee:  shift.employeeName,
        role:      shift.role,
        jobTitle:  shift.jobTitle,
        hours:     0,
        tipsAllocated: 0,
        shifts:    [],
      };
    }
    empMap[key].hours         += shift.hours;
    empMap[key].tipsAllocated += shift.tipsAllocated;
    empMap[key].shifts.push(shift);
    allEmployees.add(shift.employeeName);
  });

  // Apply wage rates and compute totals
  const records = Object.values(empMap).map((emp) => {
    const rateKey    = `${emp.employee}::${emp.role}`;
    const hourlyRate = wageRates[rateKey] || 0;
    const wages      = emp.hours * hourlyRate;
    const tips       = emp.tipsAllocated;
    const total      = wages + tips;

    return {
      ...emp,
      hourlyRate,
      wages:    Math.round(wages  * 100) / 100,
      tips:     Math.round(tips   * 100) / 100,
      total:    Math.round(total  * 100) / 100,
    };
  }).sort((a, b) => a.employee.localeCompare(b.employee));

  // Summary totals
  const totals = records.reduce((acc, r) => ({
    hours: acc.hours + r.hours,
    wages: acc.wages + r.wages,
    tips:  acc.tips  + r.tips,
    total: acc.total + r.total,
  }), { hours: 0, wages: 0, tips: 0, total: 0 });

  // Daily tip totals (for tips breakdown view)
  const dailyTips = Object.entries(tipsByDay)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Unique employees for wage settings sync
  const uniqueEmployees = [...new Set(periodShifts.map((s) => `${s.employeeName}::${s.role}`))]
    .map((key) => {
      const [name, role] = key.split("::");
      return { name, role };
    });

  return { records, totals, dailyTips, uniqueEmployees, periodStart, periodEnd };
}

// ── Auto-sync to Notion ────────────────────────────────────

async function syncToNotion(payrollData, wageRates) {
  const { records, periodStart, periodEnd, uniqueEmployees } = payrollData;

  // 1. Sync any new employees to Wages DB (rate=0 if missing)
  await syncEmployeesFromSheets(uniqueEmployees);

  // 2. Upsert payroll record per employee per role
  const upsertPromises = records.map((rec) =>
    upsertPayrollRecord({
      employee:    rec.employee,
      role:        rec.role,
      periodStart,
      periodEnd,
      hours:       rec.hours,
      hourlyRate:  rec.hourlyRate,
      wages:       rec.wages,
      tips:        rec.tips,
      total:       rec.total,
    })
  );
  await Promise.all(upsertPromises);

  // 3. Upsert tip payout records per employee per period
  const tipUpserts = records.map((rec) =>
    upsertTipPayout({
      employee:  rec.employee,
      role:      rec.role,
      periodKey: periodStart, // period key = period start date
      ccTips:    0, // CC/cash split not in Calculation Sheet — just total
      cashTips:  0,
      total:     rec.tips,
    })
  );
  await Promise.all(tipUpserts);
}

// ── Handler ────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    // GET: fetch payroll data for a period, auto-sync to Notion
    if (req.method === "GET") {
      const { month, year, half } = req.query;
      const now = new Date();
      const m   = parseInt(month) || (now.getMonth() + 1);
      const y   = parseInt(year)  || now.getFullYear();
      const h   = parseInt(half)  || (now.getDate() <= 15 ? 1 : 2);

      const { start, end } = getBiweeklyPeriod(m, y, h);

      // Fetch raw sheet data and wage rates in parallel
      const [rows, wages] = await Promise.all([
        fetchCalculationSheet(),
        getWages(),
      ]);

      const { shifts, orders } = parseCalculationSheet(rows);

      // Build wage rate lookup: "Name::Role" → rate
      const wageRates = {};
      wages.forEach((w) => { wageRates[`${w.employee}::${w.role}`] = w.hourlyRate; });

      // Aggregate for this period
      const payrollData = aggregatePayroll(shifts, orders, start, end, wageRates);

      // Auto-sync to Notion in background (don't await — return to user faster)
      syncToNotion(payrollData, wageRates).catch(console.error);

      // Fetch existing Notion records for paid status
      const [notionPayroll, notionTips] = await Promise.all([
        getPayrollRecords(start),
        getTipPayouts(start),
      ]);

      // Merge paid status from Notion into calculated records
      const payrollMap = {};
      notionPayroll.forEach((r) => { payrollMap[`${r.employee}::${r.role}`] = r; });
      const tipMap = {};
      notionTips.forEach((r) => { tipMap[`${r.employee}::${r.role}`] = r; });

      const recordsWithStatus = payrollData.records.map((rec) => {
        const key     = `${rec.employee}::${rec.role}`;
        const pRecord = payrollMap[key];
        const tRecord = tipMap[key];
        return {
          ...rec,
          notionId:    pRecord?.id    || null,
          paid:        pRecord?.paid  || false,
          tipNotionId: tRecord?.id    || null,
          tipPaid:     tRecord?.paid  || false,
        };
      });

      return res.status(200).json({
        ...payrollData,
        records: recordsWithStatus,
        period: { start, end, month: m, year: y, half: h },
        wageRates,
      });
    }

    // POST: mark payroll or tips as paid/unpaid
    if (req.method === "POST") {
      const { type, notionId, paid } = req.body;
      if (!notionId) return res.status(400).json({ error: "notionId required" });

      let record;
      if (type === "tips") {
        record = await markTipPaid(notionId, paid);
      } else {
        record = await markPayrollPaid(notionId, paid);
      }
      return res.status(200).json(record);
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
