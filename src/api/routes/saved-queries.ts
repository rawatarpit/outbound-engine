import { Router, Request, Response } from "express";
import pino from "pino";
import {
  createSavedQuery,
  getSavedQueries,
  updateSavedQuery,
  deleteSavedQuery,
} from "../../db/chat";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const brandId = req.query.brand_id as string | undefined;
  const activeOnly = req.query.active_only as string | undefined;

  if (!brandId) {
    res.status(400).json({ error: "brand_id is required" });
    return;
  }

  try {
    const queries = await getSavedQueries(brandId, activeOnly === "true");
    res.json({ queries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const { brand_id, name, query_text, plan_snapshot, schedule, max_leads, auto_approve_threshold } = req.body;

  if (!brand_id || !name || !query_text) {
    res.status(400).json({ error: "brand_id, name, and query_text are required" });
    return;
  }

  try {
    const saved = await createSavedQuery({
      brand_id,
      client_id: auth.client_id,
      user_id: auth.user_id,
      name,
      query_text,
      plan_snapshot: plan_snapshot ?? null,
      schedule: schedule ?? null,
      max_leads: max_leads ?? 10,
      auto_approve_threshold: auto_approve_threshold ?? null,
      is_active: true,
    });
    res.status(201).json({ query: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const updates = req.body;

  try {
    await updateSavedQuery(id, updates);
    res.json({ message: "Query updated" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    await deleteSavedQuery(id);
    res.json({ message: "Query deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as savedQueriesRouter };
