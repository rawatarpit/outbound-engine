import { sanitizeForPrompt } from "../llm/sanitize";
import type { AgentConfig } from "./types";

export function buildSystemPrompt(config: AgentConfig): string {
  return [
    `## Identity`,
    config.identity,
    ``,
    `## Objective`,
    config.objective,
    ``,
    `## Capabilities`,
    config.capabilities,
    ``,
    `## Constraints`,
    config.constraints,
    ``,
    `## Output format`,
    config.outputFormat,
    ``,
    `## Context`,
    config.injectedContext,
  ].join("\n");
}

export function buildAgentPrompt(params: {
  systemPrompt: string;
  contextPreamble?: string;
  compaction?: string;
  userMessage: string;
}): string {
  const blocks: string[] = [];

  if (params.compaction) {
    blocks.push(params.compaction);
  }

  if (params.contextPreamble) {
    blocks.push(params.contextPreamble);
  }

  blocks.push(params.userMessage);

  return blocks.join("\n\n");
}

export function buildResearchPrompt(input: {
  brandName: string;
  positioning: string;
  coreOffer: string;
  audience: string;
  content: string;
  contextPreamble?: string;
  compaction?: string;
}): string {
  return buildAgentPrompt({
    systemPrompt: "",
    contextPreamble: input.contextPreamble,
    compaction: input.compaction,
    userMessage: [
      `You are conducting strategic research for ${sanitizeForPrompt(input.brandName)}.`,
      ``,
      `Brand Positioning:`,
      sanitizeForPrompt(input.positioning ?? "N/A"),
      ``,
      `Core Offer:`,
      sanitizeForPrompt(input.coreOffer ?? "N/A"),
      ``,
      `Target Audience:`,
      sanitizeForPrompt(input.audience ?? "N/A"),
      ``,
      `Analyze this company website content.`,
      ``,
      `Return JSON:`,
      `industry,`,
      `size_estimate,`,
      `pain_points,`,
      `buying_signals,`,
      `automation_maturity,`,
      `sponsorship_potential,`,
      `summary`,
      ``,
      `Content:`,
      sanitizeForPrompt(input.content),
    ].join("\n"),
  });
}

export function buildQualificationPrompt(input: {
  brandName: string;
  coreOffer: string;
  industry: string;
  painPoints: string;
  automationMaturity: string;
  buyingSignals: string;
  contextPreamble?: string;
  compaction?: string;
}): string {
  return buildAgentPrompt({
    systemPrompt: "",
    contextPreamble: input.contextPreamble,
    compaction: input.compaction,
    userMessage: [
      `You are qualifying a lead for ${sanitizeForPrompt(input.brandName)}.`,
      ``,
      `Brand Offer:`,
      sanitizeForPrompt(input.coreOffer ?? "N/A"),
      ``,
      `Industry: ${sanitizeForPrompt(input.industry)}`,
      `Pain Points: ${sanitizeForPrompt(input.painPoints)}`,
      `Automation Maturity: ${sanitizeForPrompt(input.automationMaturity)}`,
      `Buying Signals: ${sanitizeForPrompt(input.buyingSignals)}`,
      ``,
      `Return ONLY valid JSON with these exact fields:`,
      `- "fit_score": number between 0 and 100`,
      `- "reasoning": a single string explaining the score (NOT an array)`,
      `- "confidence": number between 0 and 1`,
    ].join("\n"),
  });
}

export function buildOutreachPrompt(input: {
  senderName: string;
  brandName: string;
  positioning: string;
  tone: string;
  recipientName: string;
  companyName: string;
  painPoints: string;
  contextPreamble?: string;
  compaction?: string;
}): string {
  return buildAgentPrompt({
    systemPrompt: "",
    contextPreamble: input.contextPreamble,
    compaction: input.compaction,
    userMessage: [
      `You are ${sanitizeForPrompt(input.senderName)}, founder of ${sanitizeForPrompt(input.brandName)}.`,
      ``,
      `Brand Positioning:`,
      sanitizeForPrompt(input.positioning ?? "N/A"),
      ``,
      `Tone:`,
      sanitizeForPrompt(input.tone ?? "N/A"),
      ``,
      `Recipient: ${sanitizeForPrompt(input.recipientName)}`,
      `Company: ${sanitizeForPrompt(input.companyName)}`,
      `Pain Points: ${sanitizeForPrompt(input.painPoints)}`,
      ``,
      `CRITICAL IDENTITY RULES:`,
      `- You are ${sanitizeForPrompt(input.senderName)}, founder of ${sanitizeForPrompt(input.brandName)}.`,
      `- The company you are emailing is ${sanitizeForPrompt(input.companyName)}.`,
      `- Do NOT say "we developed ${sanitizeForPrompt(input.companyName)}" or "At ${sanitizeForPrompt(input.companyName)}, we...".`,
      `- NEVER mention the target company's name as if it's your product.`,
      `- You are selling TO ${sanitizeForPrompt(input.companyName)}, not representing them.`,
      ``,
      `Write a personalized cold email under 150 words to ${sanitizeForPrompt(input.recipientName)}.`,
      `Use their name naturally in the email body. Include a clear CTA.`,
      `Do NOT use placeholders like [Your Name] or [link] — use real names.`,
      `CRITICAL RULES:`,
      `- If recipient name is "there", write the email without using any name (do NOT invent a name).`,
      `- NEVER invent details about the recipient or company that are not in the Pain Points or research data.`,
      `- Keep the email factual — only reference information explicitly provided above.`,
      ``,
      `Return ONLY valid JSON in this exact format:`,
      `{"subject": "email subject line", "body": "email body text"}`,
      ``,
      `Do NOT include markdown, code fences, or any other text.`,
    ].join("\n"),
  });
}
