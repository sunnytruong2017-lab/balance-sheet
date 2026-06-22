import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

export const EXPENSES_DB = process.env.NOTION_EXPENSES_DB;
export const INCOME_DB = process.env.NOTION_INCOME_DB;
export const WAGES_DB = process.env.NOTION_WAGES_DB;

// ── Expenses ──────────────────────────────────────────────
export async function getExpenses(filter = {}) {
  const filters = [];

  if (filter.startDate && filter.endDate) {
    filters.push({
      property: "Date",
      date: { on_or_after: filter.startDate },
    });
    filters.push({
      property: "Date",
      date: { on_or_before: filter.endDate },
    });
  }

  if (filter.frequency) {
    filters.push({
      property: "Frequency",
      select: { equals: filter.frequency },
    });
  }

  const params = {
    database_id: EXPENSES_DB,
    sorts: [{ property: "Date", direction: "descending" }],
  };

  if (filters.length === 1) {
    params.filter = filters[0];
  } else if (filters.length > 1) {
    params.filter = { and: filters };
  }

  const res = await notion.databases.query(params);
  return res.results.map(pageToExpense);
}

export async function createExpense(data) {
  const page = await notion.pages.create({
    parent: { database_id: EXPENSES_DB },
    properties: expenseToProperties(data),
  });
  return pageToExpense(page);
}

export async function updateExpense(id, data) {
  const page = await notion.pages.update({
    page_id: id,
    properties: expenseToProperties(data),
  });
  return pageToExpense(page);
}

export async function deleteExpense(id) {
  await notion.pages.update({ page_id: id, archived: true });
}

function expenseToProperties(data) {
  return {
    Name: { title: [{ text: { content: data.description || "" } }] },
    Date: { date: { start: data.date } },
    Amount: { number: parseFloat(data.amount) || 0 },
    Category: { select: { name: data.category } },
    Frequency: { select: { name: data.frequency } },
    Notes: { rich_text: [{ text: { content: data.notes || "" } }] },
  };
}

function pageToExpense(page) {
  const p = page.properties;
  return {
    id: page.id,
    description: p.Name?.title?.[0]?.plain_text || "",
    date: p.Date?.date?.start || "",
    amount: p.Amount?.number || 0,
    category: p.Category?.select?.name || "",
    frequency: p.Frequency?.select?.name || "",
    notes: p.Notes?.rich_text?.[0]?.plain_text || "",
  };
}

// ── Income ────────────────────────────────────────────────
export async function getIncome(filter = {}) {
  const filters = [];

  if (filter.startDate && filter.endDate) {
    filters.push({ property: "Date", date: { on_or_after: filter.startDate } });
    filters.push({ property: "Date", date: { on_or_before: filter.endDate } });
  }

  const params = {
    database_id: INCOME_DB,
    sorts: [{ property: "Date", direction: "descending" }],
  };

  if (filters.length === 1) params.filter = filters[0];
  else if (filters.length > 1) params.filter = { and: filters };

  const res = await notion.databases.query(params);
  return res.results.map(pageToIncome);
}

export async function createIncome(data) {
  const page = await notion.pages.create({
    parent: { database_id: INCOME_DB },
    properties: incomeToProperties(data),
  });
  return pageToIncome(page);
}

export async function updateIncome(id, data) {
  const page = await notion.pages.update({
    page_id: id,
    properties: incomeToProperties(data),
  });
  return pageToIncome(page);
}

export async function deleteIncome(id) {
  await notion.pages.update({ page_id: id, archived: true });
}

function incomeToProperties(data) {
  return {
    Name: { title: [{ text: { content: data.description || "" } }] },
    Date: { date: { start: data.date } },
    CashRevenue: { number: parseFloat(data.cashRevenue) || 0 },
    CardRevenue: { number: parseFloat(data.cardRevenue) || 0 },
    TipCash: { number: parseFloat(data.tipCash) || 0 },
    TipCard: { number: parseFloat(data.tipCard) || 0 },
    Tax: { number: parseFloat(data.tax) || 0 },
    Notes: { rich_text: [{ text: { content: data.notes || "" } }] },
  };
}

function pageToIncome(page) {
  const p = page.properties;
  return {
    id: page.id,
    description: p.Name?.title?.[0]?.plain_text || "",
    date: p.Date?.date?.start || "",
    cashRevenue: p.CashRevenue?.number || 0,
    cardRevenue: p.CardRevenue?.number || 0,
    tipCash: p.TipCash?.number || 0,
    tipCard: p.TipCard?.number || 0,
    tax: p.Tax?.number || 0,
    notes: p.Notes?.rich_text?.[0]?.plain_text || "",
  };
}

// ── Wages (auto-sync) ──────────────────────────────────────
// Unique key: Employee + Role
// Auto-creates missing employees with rate=0, never overwrites paid status

export const PAYROLL_DB     = process.env.NOTION_PAYROLL_DB;
export const TIP_PAYOUTS_DB = process.env.NOTION_TIP_PAYOUTS_DB;

export async function getWages() {
  const res = await notion.databases.query({
    database_id: WAGES_DB,
    sorts: [{ property: "Employee", direction: "ascending" }],
  });
  return res.results.map(pageToWage);
}

export async function upsertWage(employeeName, role, hourlyRate) {
  // Unique key: Employee + Role
  const res = await notion.databases.query({
    database_id: WAGES_DB,
    filter: {
      and: [
        { property: "Employee", title:  { equals: employeeName } },
        { property: "Role",     select: { equals: role          } },
      ],
    },
  });

  if (res.results.length > 0) {
    const page = await notion.pages.update({
      page_id: res.results[0].id,
      properties: {
        HourlyRate: { number: parseFloat(hourlyRate) || 0 },
      },
    });
    return pageToWage(page);
  } else {
    const page = await notion.pages.create({
      parent: { database_id: WAGES_DB },
      properties: {
        Employee:   { title:  [{ text: { content: employeeName } }] },
        Role:       { select: { name: role } },
        HourlyRate: { number: parseFloat(hourlyRate) || 0 },
      },
    });
    return pageToWage(page);
  }
}

// Auto-creates wage records for employees found in sheets but not in Notion
// Never overwrites existing rates — only fills in missing ones
export async function syncEmployeesFromSheets(employees) {
  // employees: [{ name, role }]
  const existing = await getWages();
  const existingKeys = new Set(existing.map((w) => `${w.employee}::${w.role}`));

  const created = [];
  for (const emp of employees) {
    const key = `${emp.name}::${emp.role}`;
    if (!existingKeys.has(key)) {
      const record = await upsertWage(emp.name, emp.role, 0);
      created.push(record);
    }
  }
  return created;
}

function pageToWage(page) {
  const p = page.properties;
  return {
    id:         page.id,
    employee:   p.Employee?.title?.[0]?.plain_text || "",
    role:       p.Role?.select?.name || "",
    hourlyRate: p.HourlyRate?.number || 0,
  };
}

// ── Payroll records (auto-sync) ────────────────────────────
// Unique key: Employee + PeriodStart
// Auto-creates when payroll loads. Updates amount if hours changed.
// Never overwrites paid=true → paid=false.

export async function getPayrollRecords(periodStart) {
  const filter = periodStart
    ? { property: "PeriodStart", rich_text: { equals: periodStart } }
    : undefined;

  const res = await notion.databases.query({
    database_id: PAYROLL_DB,
    filter,
    sorts: [{ property: "Employee", direction: "ascending" }],
  });
  return res.results.map(pageToPayroll);
}

export async function upsertPayrollRecord({ employee, role, periodStart, periodEnd, hours, hourlyRate, wages, tips, total }) {
  // Unique key: Employee + Role + PeriodStart
  const res = await notion.databases.query({
    database_id: PAYROLL_DB,
    filter: {
      and: [
        { property: "Employee",    title:     { equals: employee    } },
        { property: "Role",        select:    { equals: role        } },
        { property: "PeriodStart", rich_text: { equals: periodStart } },
      ],
    },
  });

  const props = {
    PeriodEnd:   { rich_text: [{ text: { content: periodEnd   || "" } }] },
    Hours:       { number: Math.round(hours  * 100) / 100 },
    HourlyRate:  { number: hourlyRate || 0 },
    Wages:       { number: Math.round(wages  * 100) / 100 },
    Tips:        { number: Math.round(tips   * 100) / 100 },
    Total:       { number: Math.round(total  * 100) / 100 },
  };

  if (res.results.length > 0) {
    const existing = pageToPayroll(res.results[0]);
    // Don't recalculate if already marked paid — preserve paid status
    const page = await notion.pages.update({
      page_id: res.results[0].id,
      properties: {
        ...props,
        // Only reset to unpaid if it was already unpaid
        ...(existing.paid ? {} : { Paid: { checkbox: false } }),
      },
    });
    return pageToPayroll(page);
  } else {
    const page = await notion.pages.create({
      parent: { database_id: PAYROLL_DB },
      properties: {
        Employee:    { title:     [{ text: { content: employee    } }] },
        Role:        { select:    { name: role                       } },
        PeriodStart: { rich_text: [{ text: { content: periodStart } }] },
        Paid:        { checkbox: false },
        ...props,
      },
    });
    return pageToPayroll(page);
  }
}

export async function markPayrollPaid(pageId, paid) {
  const page = await notion.pages.update({
    page_id: pageId,
    properties: { Paid: { checkbox: paid } },
  });
  return pageToPayroll(page);
}

function pageToPayroll(page) {
  const p = page.properties;
  return {
    id:          page.id,
    employee:    p.Employee?.title?.[0]?.plain_text || "",
    role:        p.Role?.select?.name || "",
    periodStart: p.PeriodStart?.rich_text?.[0]?.plain_text || "",
    periodEnd:   p.PeriodEnd?.rich_text?.[0]?.plain_text   || "",
    hours:       p.Hours?.number       || 0,
    hourlyRate:  p.HourlyRate?.number  || 0,
    wages:       p.Wages?.number       || 0,
    tips:        p.Tips?.number        || 0,
    total:       p.Total?.number       || 0,
    paid:        p.Paid?.checkbox      || false,
  };
}

// ── Tip payout records (auto-sync) ────────────────────────
// Unique key: Employee + Role + PeriodKey (e.g. "2026-06-16")
// Auto-creates when tips load. Updates amount if recalculated. Never unpays.

export async function getTipPayouts(periodKey) {
  const filter = periodKey
    ? { property: "PeriodKey", rich_text: { equals: periodKey } }
    : undefined;

  const res = await notion.databases.query({
    database_id: TIP_PAYOUTS_DB,
    filter,
    sorts: [{ property: "Employee", direction: "ascending" }],
  });
  return res.results.map(pageToTipPayout);
}

export async function upsertTipPayout({ employee, role, periodKey, ccTips, cashTips, total }) {
  // Unique key: Employee + Role + PeriodKey
  const res = await notion.databases.query({
    database_id: TIP_PAYOUTS_DB,
    filter: {
      and: [
        { property: "Employee",  title:     { equals: employee  } },
        { property: "Role",      select:    { equals: role      } },
        { property: "PeriodKey", rich_text: { equals: periodKey } },
      ],
    },
  });

  const props = {
    CCTips:   { number: Math.round(ccTips   * 100) / 100 },
    CashTips: { number: Math.round(cashTips * 100) / 100 },
    Total:    { number: Math.round(total    * 100) / 100 },
  };

  if (res.results.length > 0) {
    const existing = pageToTipPayout(res.results[0]);
    const page = await notion.pages.update({
      page_id: res.results[0].id,
      properties: {
        ...props,
        ...(existing.paid ? {} : { Paid: { checkbox: false } }),
      },
    });
    return pageToTipPayout(page);
  } else {
    const page = await notion.pages.create({
      parent: { database_id: TIP_PAYOUTS_DB },
      properties: {
        Employee:  { title:     [{ text: { content: employee  } }] },
        Role:      { select:    { name: role                     } },
        PeriodKey: { rich_text: [{ text: { content: periodKey } }] },
        Paid:      { checkbox: false },
        ...props,
      },
    });
    return pageToTipPayout(page);
  }
}

export async function markTipPaid(pageId, paid) {
  const page = await notion.pages.update({
    page_id: pageId,
    properties: { Paid: { checkbox: paid } },
  });
  return pageToTipPayout(page);
}

function pageToTipPayout(page) {
  const p = page.properties;
  return {
    id:         page.id,
    employee:   p.Employee?.title?.[0]?.plain_text || "",
    role:       p.Role?.select?.name || "",
    periodKey:  p.PeriodKey?.rich_text?.[0]?.plain_text || "",
    ccTips:     p.CCTips?.number   || 0,
    cashTips:   p.CashTips?.number || 0,
    total:      p.Total?.number    || 0,
    paid:       p.Paid?.checkbox   || false,
  };
}
