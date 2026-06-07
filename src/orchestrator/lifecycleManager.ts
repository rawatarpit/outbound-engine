import { supabase, detectStuckLeads } from "../db/supabase";
import pino from "pino";
import { updateCompanyStatus, registerFailure } from "../db/supabase";

const logger = pino({ level: "info" });

export async function detectAndRequeueStuckLeads(): Promise<number> {
  try {
    const stuckCount = await detectStuckLeads();
    logger.info({ count: stuckCount }, "Stuck lead detection completed");
    return stuckCount;
  } catch (err: any) {
    logger.error({ err: err?.message }, "Stuck lead detection failed");
    return 0;
  }
}

export async function escalateStuckLeads(): Promise<number> {
  try {
    const stuckCount = await detectStuckLeads();
    logger.warn({ count: stuckCount }, "Escalating permanently stuck leads");
    return stuckCount;
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to escalate stuck leads");
    return 0;
  }
}
