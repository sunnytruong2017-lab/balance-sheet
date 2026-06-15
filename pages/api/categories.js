const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB = process.env.NOTION_CATEGORIES_DB;

export default async function handler(req, res) {
  if (!DB) return res.status(500).json({ error: "NOTION_CATEGORIES_DB not set" });

  try {
    if (req.method === "GET") {
      const response = await notion.databases.query({
        database_id: DB,
        sorts: [{ property: "Tab", direction: "ascending" }],
      });
      const cats = response.results.map((page) => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || "",
        tab:  page.properties.Tab?.select?.name || "",
        type: page.properties.Type?.select?.name || "expense",
      }));
      return res.status(200).json(cats);
    }

    if (req.method === "POST") {
      const { name, tab, type } = req.body;
      if (!name || !tab) return res.status(400).json({ error: "name and tab required" });

      const page = await notion.pages.create({
        parent: { database_id: DB },
        properties: {
          Name: { title: [{ text: { content: name.trim() } }] },
          Tab:  { select: { name: tab } },
          Type: { select: { name: type || "expense" } },
        },
      });
      return res.status(201).json({
        id:   page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || "",
        tab:  page.properties.Tab?.select?.name || "",
        type: page.properties.Type?.select?.name || "",
      });
    }

    if (req.method === "DELETE") {
      await notion.pages.update({ page_id: req.body.id, archived: true });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
