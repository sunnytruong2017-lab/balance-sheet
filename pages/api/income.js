import { getIncome, createIncome, updateIncome, deleteIncome } from "../../lib/notion";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { startDate, endDate } = req.query;
      const data = await getIncome({ startDate, endDate });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const entry = await createIncome(req.body);
      return res.status(201).json(entry);
    }

    if (req.method === "PUT") {
      const { id, ...data } = req.body;
      const entry = await updateIncome(id, data);
      return res.status(200).json(entry);
    }

    if (req.method === "DELETE") {
      await deleteIncome(req.body.id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
