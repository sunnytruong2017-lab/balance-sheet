import { getExpenses, createExpense, updateExpense, deleteExpense } from "../../lib/notion";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { startDate, endDate, frequency } = req.query;
      const data = await getExpenses({ startDate, endDate, frequency });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const entry = await createExpense(req.body);
      return res.status(201).json(entry);
    }

    if (req.method === "PUT") {
      const { id, ...data } = req.body;
      const entry = await updateExpense(id, data);
      return res.status(200).json(entry);
    }

    if (req.method === "DELETE") {
      await deleteExpense(req.body.id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
