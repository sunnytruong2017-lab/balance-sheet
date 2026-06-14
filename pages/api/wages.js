import { getWages, upsertWage } from "../../lib/notion";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const data = await getWages();
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const { employee, hourlyRate } = req.body;
      const entry = await upsertWage(employee, hourlyRate);
      return res.status(200).json(entry);
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
