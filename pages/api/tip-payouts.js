import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB = process.env.NOTION_TIP_PAYOUTS_DB;

export default async function handler(req, res) {
  if (!DB) return res.status(500).json({ error: "NOTION_TIP_PAYOUTS_DB not set" });

  try {
    // GET — fetch all payout records, optionally filtered by weekKey
    if (req.method === "GET") {
      const { weekKey } = req.query;
      const params = {
        database_id: DB,
        sorts: [{ property: "Employee", direction: "ascending" }],
      };
      if (weekKey) {
        params.filter = { property: "WeekKey", rich_text: { contains: weekKey } };
      }
      const response = await notion.databases.query(params);
      return res.status(200).json(response.results.map(pageToRecord));
    }

    // POST — upsert a payout record (create or update paid status)
    if (req.method === "POST") {
      const { employee, weekKey, amount, paid } = req.body;
      if (!employee || !weekKey) return res.status(400).json({ error: "employee and weekKey required" });

      // Check if record already exists
      const existing = await notion.databases.query({
        database_id: DB,
        filter: {
          and: [
            { property: "Employee", rich_text: { equals: employee } },
            { property: "WeekKey",  rich_text: { equals: weekKey  } },
          ],
        },
      });

      if (existing.results.length > 0) {
        // Update existing
        const page = await notion.pages.update({
          page_id: existing.results[0].id,
          properties: {
            Paid:   { checkbox: !!paid },
            Amount: { number: parseFloat(amount) || 0 },
          },
        });
        return res.status(200).json(pageToRecord(page));
      } else {
        // Create new
        const page = await notion.pages.create({
          parent: { database_id: DB },
          properties: {
            Employee: { title: [{ text: { content: employee } }] },
            WeekKey:  { rich_text: [{ text: { content: weekKey } }] },
            Amount:   { number: parseFloat(amount) || 0 },
            Paid:     { checkbox: !!paid },
          },
        });
        return res.status(201).json(pageToRecord(page));
      }
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

function pageToRecord(page) {
  const p = page.properties;
  return {
    id:       page.id,
    employee: p.Employee?.title?.[0]?.plain_text || "",
    weekKey:  p.WeekKey?.rich_text?.[0]?.plain_text || "",
    amount:   p.Amount?.number || 0,
    paid:     p.Paid?.checkbox || false,
  };
}
