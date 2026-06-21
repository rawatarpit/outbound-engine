import pino from "pino";
import { z } from "zod";
import { generateStructured } from "../llm/ollama";
import { BrandProfile } from "../db/supabase";
import { PipelineStage } from "./types";
import type { StepResult } from "./dispatcher";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const SynthesizerResultSchema = z.object({
  message: z.string(),
  suggestions: z.array(z.string()).max(4),
  askClarification: z.array(z.string()).nullable().optional(),
  saveCampaign: z.object({
    shouldSave: z.boolean(),
    summary: z.string(),
    queries: z.array(z.string()),
  }).nullable().optional(),
});

interface SynthesizerInput {
  userMessage: string;
  results: StepResult[];
  brand: BrandProfile;
  stage: PipelineStage;
  searchQueries: string[];
  intentDescription: string;
  previousMessages?: string;
}

function templateSynthesizer(
  userMessage: string,
  results: StepResult[],
  brandName: string,
): z.infer<typeof SynthesizerResultSchema> {
  const successes = results.filter((r) => r.status === "success");
  const errors = results.filter((r) => r.status === "error");

  let message = "";
  const suggestions: string[] = [];

  if (results.length === 0) {
    message = `Hey! I'm your outbound assistant for ${brandName}. What would you like to do?\n\nYou can ask me to:\n- Find leads matching specific criteria\n- Research a company\n- Qualify existing leads\n- Draft outreach emails\n- Find contact information\n- Check pipeline status`;
    return { message, suggestions: ["Find me leads", "Research a company", "Show pipeline"] };
  }

  const discoveryResult = successes.find((r) => r.tool === "discover_leads");
  const researchResult = successes.find((r) => r.tool === "research_leads");
  const enrichResult = successes.find((r) => r.tool === "enrich_leads");
  const qualifyResult = successes.find((r) => r.tool === "qualify_leads");
  const draftResult = successes.find((r) => r.tool === "draft_emails");
  const sendResult = successes.find((r) => r.tool === "send_emails");
  const pipelineResult = successes.find((r) => r.tool === "get_pipeline");

  if (sendResult) {
    message = "Emails sent successfully!";
    suggestions.push("Track responses", "Start new search");
    return { message, suggestions };
  }

  if (pipelineResult) {
    const data = pipelineResult.output as any;
    message = `Here's your pipeline for ${brandName}:\n\n`;
    if (data?.summary) {
      message += data.summary;
    } else {
      message += "No companies currently in pipeline.\n\nStart by asking me to find leads!";
    }
    suggestions.push("Find new leads", "Research a company");
    return { message, suggestions };
  }

  if (discoveryResult) {
    const leads = (discoveryResult.output as any)?.leads ?? [];
    message = `Found **${leads.length}** leads for ${brandName}.`;

    if (researchResult) {
      const researched = (researchResult.output as any)?.researched ?? [];
      const ok = researched.filter((r: any) => r.status === "success" || r.status === "partial").length;
      message += ok > 0 ? ` Researched **${ok}** companies.` : ` Researched all ${researched.length} leads.`;
    }

    if (enrichResult) {
      const contacts = (enrichResult.output as any)?.contacts ?? [];
      message += ` Found contacts for **${contacts.length}** leads.`;
    }

    if (qualifyResult) {
      const qualified = (qualifyResult.output as any)?.qualified ?? [];
      message += ` Qualified: ${qualified.filter((q: any) => (q.data?.fitScore ?? 0) >= 60).length} high-fit, ${qualified.filter((q: any) => (q.data?.fitScore ?? 0) >= 40 && (q.data?.fitScore ?? 0) < 60).length} medium-fit.`;
    }

    if (draftResult) {
      const drafts = (draftResult.output as any)?.drafts ?? [];
      message += `\n\nDrafted **${drafts.length}** emails ready for your review.`;
      suggestions.push("Show drafts", "Approve drafts");
    } else {
      suggestions.push("Research these leads", "Find contacts for them", "Qualify them");
    }
  } else if (researchResult) {
    const researched = (researchResult.output as any)?.researched ?? [];
    const successCount = researched.filter((r: any) => r.status === "success" || r.status === "partial").length;
    const failCount = researched.filter((r: any) => r.status === "error" || r.status === "TERMINAL_FAILURE").length;
    if (successCount > 0) {
      message = `Researched **${successCount}** companies for ${brandName}.`;
    } else {
      message = `Attempted research on **${researched.length}** companies, but couldn't gather detailed info. You can try finding contacts directly.`;
    }
    suggestions.push("Find contacts for them", "Qualify them");
  } else if (enrichResult) {
    const contacts = (enrichResult.output as any)?.contacts ?? [];
    message = `Found contacts for **${contacts.length}** leads.`;
    suggestions.push("Qualify these leads", "Draft emails");
  } else if (qualifyResult) {
    const qualified = (qualifyResult.output as any)?.qualified ?? [];
    const highFit = qualified.filter((q: any) => (q.data?.fitScore ?? 0) >= 60).length;
    message = `Qualified **${qualified.length}** leads for ${brandName}. **${highFit}** are high-fit.`;
    suggestions.push("Draft emails for high-fit leads", "Find more leads");
  } else if (draftResult) {
    const drafts = (draftResult.output as any)?.drafts ?? [];
    message = `Drafted **${drafts.length}** emails ready for your review.`;
    suggestions.push("Show drafts", "Approve drafts", "Send emails");
  }

  if (errors.length > 0) {
    message += `\n\n⚠️ ${errors.length} step(s) had issues: ${errors.map((e) => e.tool).join(", ")}. I can retry if you'd like.`;
  }

  if (suggestions.length === 0) {
    suggestions.push("Find me leads", "View pipeline", "Save this search");
  }

  return { message, suggestions };
}

export async function synthesizeResults(
  input: SynthesizerInput,
): Promise<z.infer<typeof SynthesizerResultSchema>> {
  const { userMessage, results, brand } = input;

  // Skip LLM synthesizer (times out at 30s) and use template directly
  return templateSynthesizer(userMessage, results, brand.brand_name);
}
