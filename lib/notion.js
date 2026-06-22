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
