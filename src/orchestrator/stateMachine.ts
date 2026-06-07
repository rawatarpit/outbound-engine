import cron from "node-cron";
import pino from "pino";

import {
  claimCompanies,
  updateCompanyStatus,
  registerFailure,
  getBrandProfile,
  detectStuckLeads,
  getRunnableBrands,
  supabase,
} from "../db/supabase";

import { runResearchAgent } from "../agents/research";
import { runQualificationAgent } from "../agents/qualification";
import { runOutreachAgent } from "../agents/outreach";
import { runReplyAnalysis } from "../agents/replyAnalysis";
import { AgentResultStatus } from "../agents/types";
import {
  evaluateRetryPolicy,
  moveToDeadLetter,
  incrementRetryCount,
} from "./retryPolicy";
import { syncCompanyLeads } from "../enrichment/lead-sync";
import { createRunId, logAgentTurn, withRetry, withFallback } from "../harness";

const logger = pino({ level: "info" });

const BATCH_LIMIT = 10;
const STUCK_CHECK_INTERVAL_MIN = 5;

let tickRunning = false;
let stuckCounter = 0;

export function startStateMachine() {
  logger.info("State machine initialized");

  cron.schedule("*/1 * * * *", async () => {
    if (tickRunning) return;
    tickRunning = true;

    const tickRunId = createRunId("state-machine");
    const tickStart = Date.now();

    try {
      await runStuckDetector();

      const brands = await getRunnableBrands();

      for (const brand of brands) {
        await runBrandPipeline(brand.id);
      }

      logAgentTurn({
        run_id: tickRunId,
        agent_id: "state-machine",
        turn: 1,
        timestamp: new Date().toISOString(),
        input_tokens: 0,
        output_tokens: 0,
        tools_called: [],
        tool_latencies_ms: { pipeline_tick: Date.now() - tickStart },
        tool_errors: [],
        stop_reason: "completed",
        cost_usd: 0,
        context_utilization_pct: 0,
      });
    } catch (err: any) {
      logger.error({ err }, "State machine fatal error");
      logAgentTurn({
        run_id: tickRunId,
        agent_id: "state-machine",
        turn: 1,
        timestamp: new Date().toISOString(),
        input_tokens: 0,
        output_tokens: 0,
        tools_called: [],
        tool_latencies_ms: {},
        tool_errors: [`Fatal: ${err?.message}`],
        stop_reason: "error",
        cost_usd: 0,
        context_utilization_pct: 0,
      });
    } finally {
      tickRunning = false;
    }
  });
}

async function runStuckDetector() {
  stuckCounter++;
  if (stuckCounter < STUCK_CHECK_INTERVAL_MIN) return;
  stuckCounter = 0;

  try {
    const affected = await detectStuckLeads();
    if (affected > 0) {
      logger.warn({ affected }, "Stuck leads auto-corrected");
    }
  } catch (err: any) {
    logger.error({ err }, "Stuck detector failure");
  }
}

async function runBrandPipeline(brandId: string) {
  const brand = await getBrandProfile(brandId);
  if (!brand) return;
  if (brand.is_paused) return;
  if (!brand.discovery_enabled && !brand.outbound_enabled) return;

  await syncCompanyLeads(brandId);

  const pipelineRunId = createRunId(`pipeline-${brandId.slice(0, 8)}`);
  const pipelineStart = Date.now();

  try {
    const researchingCount = await runPipelineStage("researching", () => processResearching(brandId));
    const qualifiedCount = await runPipelineStage("qualified", () => processQualified(brandId));
    const draftCount = await runPipelineStage("draft_ready", () => processDraftReady(brandId));
    const repliedCount = await runPipelineStage("replied", () => processReplied(brandId));
    const negotiatingCount = await runPipelineStage("negotiating", () => processNegotiating(brandId));

    if (researchingCount + qualifiedCount + draftCount + repliedCount + negotiatingCount > 0) {
      logger.info({
        brand: brand.brand_name,
        researching: researchingCount,
        qualified: qualifiedCount,
        drafts: draftCount,
        replies: repliedCount,
        negotiating: negotiatingCount,
        durationMs: Date.now() - pipelineStart,
      }, "Pipeline cycle completed");

      logAgentTurn({
        run_id: pipelineRunId,
        agent_id: "pipeline",
        turn: 1,
        timestamp: new Date().toISOString(),
        input_tokens: 0,
        output_tokens: 0,
        tools_called: [],
        tool_latencies_ms: { pipeline_run: Date.now() - pipelineStart },
        tool_errors: [],
        stop_reason: "completed",
        cost_usd: 0,
        context_utilization_pct: 0,
      });
    }
  } catch (err: any) {
    logger.error({ brand: brand.brand_name, err }, "Brand pipeline failed");
  }
}

async function runPipelineStage(name: string, fn: () => Promise<void>): Promise<number> {
  const stageRunId = createRunId(`stage-${name}`);
  const stageStart = Date.now();
  try {
    await fn();
    const duration = Date.now() - stageStart;
    logAgentTurn({
      run_id: stageRunId,
      agent_id: `pipeline-${name}`,
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: [],
      tool_latencies_ms: { [`stage_${name}`]: duration },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });
    return 1;
  } catch (err: any) {
    logger.error({ stage: name, err }, "Pipeline stage failed");
    return 0;
  }
}

async function processResearching(brandId: string) {
  const companies = await claimCompanies(brandId, "researching", BATCH_LIMIT);
  if (!companies.length) return;

  for (const company of companies) {
    try {
      const result = await runResearchAgent(company);

      if (result.status === AgentResultStatus.TERMINAL_FAILURE) {
        await updateCompanyStatus(company.id, "researching_processing", "rejected", company.brand_id);
        continue;
      }

      if (result.status === AgentResultStatus.RETRYABLE_FAILURE) {
        await handleFailure(company.id, "researching_processing", "researching", new Error(result.error), company.brand_id);
        continue;
      }

      await updateCompanyStatus(company.id, "researching_processing", "qualified", company.brand_id);
    } catch (err: any) {
      await handleFailure(company.id, "researching_processing", "researching", err, company.brand_id);
    }
  }
}

async function processQualified(brandId: string) {
  const brand = await getBrandProfile(brandId);
  const threshold = (brand as any).qualification_threshold ?? 40;
  const companies = await claimCompanies(brandId, "qualified", BATCH_LIMIT);
  if (!companies.length) return;

  for (const company of companies) {
    try {
      const result = await runQualificationAgent(company);

      if (result.status === AgentResultStatus.TERMINAL_FAILURE || result.status === AgentResultStatus.SKIPPED) {
        await updateCompanyStatus(company.id, "qualified_processing", "rejected", company.brand_id);
        continue;
      }

      if (result.status === AgentResultStatus.RETRYABLE_FAILURE) {
        await handleFailure(company.id, "qualified_processing", "qualified", new Error(result.error), company.brand_id);
        continue;
      }

      if (!result.data || result.data.fitScore < threshold) {
        await updateCompanyStatus(company.id, "qualified_processing", "rejected", company.brand_id);
        continue;
      }

      await updateCompanyStatus(company.id, "qualified_processing", "draft_ready", company.brand_id);
    } catch (err: any) {
      await handleFailure(company.id, "qualified_processing", "qualified", err, company.brand_id);
    }
  }
}

async function processDraftReady(brandId: string) {
  const companies = await claimCompanies(brandId, "draft_ready", BATCH_LIMIT);
  if (!companies.length) return;

  for (const company of companies) {
    try {
      const result = await runOutreachAgent(company);

      if (result.status === AgentResultStatus.TERMINAL_FAILURE) {
        await updateCompanyStatus(company.id, "draft_ready_processing", "rejected", company.brand_id);
        continue;
      }

      if (result.status === AgentResultStatus.RETRYABLE_FAILURE) {
        await handleFailure(company.id, "draft_ready_processing", "draft_ready", new Error(result.error), company.brand_id);
        continue;
      }

      if (result.status === AgentResultStatus.SUCCESS) {
        await updateCompanyStatus(company.id, "draft_ready_processing", "contacted", company.brand_id);
      } else {
        await updateCompanyStatus(company.id, "draft_ready_processing", "draft_ready", company.brand_id);
      }
    } catch (err: any) {
      await handleFailure(company.id, "draft_ready_processing", "draft_ready", err, company.brand_id);
    }
  }
}

async function processReplied(brandId: string) {
  const companies = await claimCompanies(brandId, "replied", BATCH_LIMIT);
  if (!companies.length) return;

  for (const company of companies) {
    try {
      const { data: reply } = await supabase
        .from("replies")
        .select("id, raw_message, created_at")
        .eq("company_id", company.id)
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!reply) {
        await updateCompanyStatus(company.id, "replied_processing", "replied", company.brand_id);
        continue;
      }

      const result = await runReplyAnalysis(company.id, reply.id, reply.raw_message);

      if (result.status === AgentResultStatus.SUCCESS) {
        const intent = (result.data as any)?.intent;
        const newStatus = intent === "interested" || intent === "meeting_requested" ? "negotiating" : "contacted";
        await updateCompanyStatus(company.id, "replied_processing", newStatus, company.brand_id);
      } else {
        await updateCompanyStatus(company.id, "replied_processing", "contacted", company.brand_id);
      }
    } catch (err: any) {
      await handleFailure(company.id, "replied_processing", "replied", err, company.brand_id);
    }
  }
}

async function processNegotiating(brandId: string) {
  const companies = await claimCompanies(brandId, "negotiating", BATCH_LIMIT);
  if (!companies.length) return;

  const { runNegotiationAgent } = await import("../agents/negotiation");

  for (const company of companies) {
    try {
      const result = await runNegotiationAgent(company.id);

      if (result.status === AgentResultStatus.TERMINAL_FAILURE) {
        await updateCompanyStatus(company.id, "negotiating_processing", "rejected", company.brand_id);
        continue;
      }

      if (result.status === AgentResultStatus.RETRYABLE_FAILURE) {
        await handleFailure(company.id, "negotiating_processing", "negotiating", new Error(result.error), company.brand_id);
        continue;
      }

      if (result.status === AgentResultStatus.SUCCESS) {
        await updateCompanyStatus(company.id, "negotiating_processing", "closed_won", company.brand_id);
      } else {
        await updateCompanyStatus(company.id, "negotiating_processing", "negotiating", company.brand_id);
      }
    } catch (err: any) {
      await handleFailure(company.id, "negotiating_processing", "negotiating", err, company.brand_id);
    }
  }
}

async function handleFailure(
  companyId: string,
  expectedStatus: string,
  fallbackStatus: string,
  err: any,
  brandId?: string,
) {
  logger.error({ err, companyId }, "Pipeline failure");

  const retryDecision = await evaluateRetryPolicy("company", companyId);

  if (retryDecision.shouldDeadLetter) {
    await moveToDeadLetter("company", companyId, retryDecision.reason);
    return;
  }

  if (!retryDecision.shouldRetry) {
    await updateCompanyStatus(companyId, expectedStatus, fallbackStatus, brandId);
    return;
  }

  try {
    const errorMessage = err?.message || "Unknown error";
    await incrementRetryCount("company", companyId, errorMessage);
    await registerFailure("company", companyId, errorMessage);
    await updateCompanyStatus(companyId, expectedStatus, fallbackStatus, brandId);
  } catch (innerErr: any) {
    logger.fatal({ innerErr }, "Failure handler crashed");
  }
}
