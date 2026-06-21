import { Router, Request, Response } from "express";
import pino from "pino";
import {
  supabase,
  getBrandProfile,
  claimOutreachDraft,
} from "../../db/supabase";
import { processSendQueue } from "../../queue/sendProcessor";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const { brand_id, status } = req.query;

  if (!brand_id) {
    res.status(400).json({ error: "brand_id is required" });
    return;
  }

  const q = supabase
    .from("outreach")
    .select("*, companies!inner(name, domain, lead_score)")
    .eq("brand_id", brand_id);

  if (status) q.eq("status", status);
  else q.in("status", ["draft"]);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(20);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ drafts: data ?? [] });
});

router.post("/approve", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const { draft_ids, brand_id } = req.body;

  if (!draft_ids?.length || !brand_id) {
    res.status(400).json({ error: "draft_ids and brand_id are required" });
    return;
  }

  const { error } = await supabase
    .from("outreach")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .in("id", draft_ids)
    .eq("brand_id", brand_id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  logger.info({ draft_ids, brand_id }, "Drafts approved");

  setImmediate(async () => {
    try {
      await processSendQueue(brand_id);
    } catch (err: any) {
      logger.error({ err, brand_id }, "Send queue processing after approval");
    }
  });

  res.json({ approved: draft_ids.length, message: `${draft_ids.length} draft(s) approved and queued for sending` });
});

router.post("/edit", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const { draft_id, subject, body } = req.body;

  if (!draft_id) {
    res.status(400).json({ error: "draft_id is required" });
    return;
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (subject !== undefined) updates.subject = subject;
  if (body !== undefined) updates.body = body;

  const { error } = await supabase
    .from("outreach")
    .update(updates)
    .eq("id", draft_id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ message: "Draft updated" });
});

router.post("/reject", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const { draft_id } = req.body;

  if (!draft_id) {
    res.status(400).json({ error: "draft_id is required" });
    return;
  }

  const { error } = await supabase
    .from("outreach")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", draft_id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ message: "Draft rejected" });
});

export { router as approvalRouter };
