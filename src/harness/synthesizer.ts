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
  const { userMessage, results, brand, stage, searchQueries, intentDescription, previousMessages } = input;

  if (results.length === 0 && stage === "init") {
    return templateSynthesizer(userMessage, results, brand.brand_name);
  }

  const successes = results.filter((r) => r.status === "success");
  const errors = results.filter((r) => r.status === "error");

  const resultsSummary = results.map((r) => {
    const out = r.output as any;
    let summary = "";
    if (r.tool === "discover_leads") summary = `${out?.leads?.length ?? 0} leads found`;
    else if (r.tool === "research_leads") summary = `${out?.researched?.length ?? 0} companies researched`;
    else if (r.tool === "enrich_leads") summary = `${out?.contacts?.length ?? 0} contacts found`;
    else if (r.tool === "qualify_leads") summary = `${out?.qualified?.length ?? 0} companies qualified`;
    else if (r.tool === "draft_emails") summary = `${out?.drafts?.length ?? 0} drafts created`;
    else if (r.tool === "send_emails") summary = "sent";
    else summary = JSON.stringify(out).slice(0, 200);
    return `${r.tool}: ${r.status} — ${summary}`;
  }).join("\n");

  const pipelineStageDescriptions: Record<string, string> = {
    init: "Conversation just started. No leads found yet.",
    discovery: "Leads have been found. User may want to research, enrich, or qualify them.",
    research: "Leads have been researched. User may want enrichment or qualification next.",
    enrich: "Contacts have been found. User may want qualification or outreach next.",
    qualify: "Leads have been scored. User may want drafts or pipeline review.",
    draft: "Drafts are ready. User may want to send or review.",
    send: "Emails have been sent. User may want to save this campaign or start fresh.",
    done: "Pipeline complete.",
  };

  try {
    const prompt = `You are a sales assistant for ${brand.brand_name}. Generate a helpful response to the user.

Brand context:
${brand.positioning ? `- Positioning: ${brand.positioning}` : ""}
${brand.core_offer ? `- Core offer: ${brand.core_offer}` : ""}
${brand.tone ? `- Tone: ${brand.tone}` : ""}
${brand.audience ? `- Audience: ${brand.audience}` : ""}

Current pipeline stage: ${stage}
${pipelineStageDescriptions[stage] || ""}
${searchQueries.length > 0 ? `Search queries used: ${searchQueries.join(", ")}` : ""}
${intentDescription ? `Intent: ${intentDescription}` : ""}

Tool execution results:
${resultsSummary}
${errors.length > 0 ? `\nErrors: ${errors.map(e => `${e.tool}: ${e.error}`).join("; ")}` : ""}

Previous conversation context:
${previousMessages || "(none)"}

User message: ${userMessage}

Rules:
- Be concise and direct. No fluff.
- If errors occurred, acknowledge them and suggest retrying.
- Suggest 2-4 natural next actions based on the pipeline stage and results.
- If this is the first interaction (no tool results), introduce yourself briefly.
- If the user provided specific criteria (location, industry), confirm you understood them.
- Tone: ${brand.tone || "professional and helpful"}
- At the end, if the pipeline is complete (emails sent) and results were positive, include a saveCampaign offering to save.

${errors.length === results.length && results.length > 0 ?
  "All steps failed. Offer to retry or ask the user to refine their request." : ""}

${results.some(r => r.tool === "send_emails" && r.status === "success") ?
  `The send step just completed successfully. Offer to save the campaign with a saveCampaign block.` : ""}

Respond with valid JSON only:
{
  "message": "your response here",
  "suggestions": ["suggestion1", "suggestion2", "suggestion3"],
  "askClarification": null,
  "saveCampaign": null
}

If the pipeline is complete and send succeeded, include:
{
  "message": "...",
  "suggestions": [...],
  "saveCampaign": {
    "shouldSave": true,
    "summary": "brief summary of what was done",
    "queries": ${JSON.stringify(searchQueries)}
  }
}`;

    const result = await generateStructured(prompt, SynthesizerResultSchema, 0.2, brand.client_id, 500, undefined, 60000);
    logger.info({ stage, resultLen: result.message.length }, "Response synthesized (LLM)");
    return result;
  } catch (err) {
    logger.warn({ err }, "LLM synthesizer failed, using template fallback");
    return templateSynthesizer(userMessage, results, brand.brand_name);
  }
}
