import pino from "pino";
import { getActiveScheduledQueries, markSavedQueryRun } from "../db/chat";
import { getBrandProfile } from "../db/supabase";
import { generatePlan } from "../harness/planner";
import { executePlan } from "../harness/dispatcher";
import type { ExecutionPlan } from "../harness/types";
import { processSendQueue } from "../queue/sendProcessor";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

function shouldRunCron(cronExpr: string, lastRun: Date | null): boolean {
  if (!lastRun) return true;

  const parts = cronExpr.trim().split(/\s+/);

  if (parts.length < 5) return false;

  const now = new Date();
  const minutesSinceLastRun = (now.getTime() - lastRun.getTime()) / 60000;

  if (parts[0] !== "*") {
    const minute = parseInt(parts[0]);
    if (now.getMinutes() !== minute) return false;
  }

  if (parts[1] !== "*") {
    const hour = parseInt(parts[1]);
    if (now.getHours() !== hour) return false;
  }

  if (parts[4] !== "*") {
    const dayOfWeek = parseInt(parts[4]);
    if (now.getDay() !== dayOfWeek) return false;
  }

  return minutesSinceLastRun >= 10;
}

export function startSavedQueryScheduler(): void {
  setInterval(async () => {
    try {
      const queries = await getActiveScheduledQueries();
      logger.debug({ count: queries.length }, "Checking scheduled queries");

      for (const query of queries) {
        if (!query.schedule) continue;

        const now = new Date();
        const lastRun = query.last_run_at ? new Date(query.last_run_at) : null;

        if (!shouldRunCron(query.schedule, lastRun)) continue;

        logger.info({ query_id: query.id, name: query.name }, "Running scheduled query");

        try {
          const brand = await getBrandProfile(query.brand_id);
          if (!brand) {
            logger.warn({ query_id: query.id }, "Brand not found for scheduled query");
            continue;
          }

          const plan = await generatePlan({
            intent: "discover",
            parameters: { query: query.query_text },
            brand,
          });

          const executionPlan: ExecutionPlan = {
            steps: plan.steps.map((s, i) => ({
              id: `${s.tool}_${Date.now()}_${i}`,
              tool: s.tool,
              input: s.input,
              parallel_group: null,
              depends_on: s.dependsOn.map((d) => `${plan.steps[d].tool}_${Date.now()}_${d}`),
              max_retries: 2,
              timeout_ms: 180000,
            })),
            brand_id: brand.id,
            client_id: brand.client_id || "",
            intent: "discover",
            max_leads: 10,
          };

          await executePlan(executionPlan);

          if (query.auto_approve_threshold) {
            const { supabase } = await import("../db/supabase");
            const { data: drafts } = await supabase
              .from("outreach")
              .select("id")
              .eq("brand_id", query.brand_id)
              .eq("status", "draft");

            if (drafts && drafts.length > 0) {
              await supabase
                .from("outreach")
                .update({ status: "approved" })
                .in("id", drafts.map((d) => d.id));

              await processSendQueue(query.brand_id);
              logger.info({ query_id: query.id, count: drafts.length }, "Auto-approved drafts");
            }
          }

          await markSavedQueryRun(query.id);
        } catch (err: any) {
          logger.error({ query_id: query.id, err }, "Scheduled query failed");
        }
      }
    } catch (err: any) {
      logger.error({ err }, "Saved query scheduler error");
    }
  }, 60_000);

  logger.info("Saved query scheduler initialized (checks every 60s)");
}
