import {
  EnrichmentStrategyExecutor,
  EnrichmentContext,
  EnrichmentResult,
  EnrichmentStatus,
  EnrichmentStrategyType,
  ClaimedContact,
  ClaimedCompany,
} from "../types";
import { sanitizeForPrompt } from "../../llm/sanitize";

export const llmResearchExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext): Promise<EnrichmentResult> {
    const { type, entity } = context;

    /* =========================================
       CONTACT LLM RESEARCH
    ========================================== */

    if (type === "contact") {
      const contact = entity as ClaimedContact;

      if (!contact.domain) {
        return { status: EnrichmentStatus.FAILED };
      }

      // ---- Build prompt for contact ----
      const prompt = `
Research this professional contact:

Name: ${sanitizeForPrompt(contact.full_name ?? "Unknown")}
Domain: ${sanitizeForPrompt(contact.domain)}
Title: ${sanitizeForPrompt(contact.title ?? "Unknown")}

Return structured JSON.
`;

      // call your LLM here
      const llmOutput = await callLLM(prompt);

      return {
        status: EnrichmentStatus.PARTIAL,
        data: {
          full_name: contact.full_name ?? undefined,
          title: contact.title ?? undefined,
          domain: contact.domain,
          confidence: 0.6,
          strategy: EnrichmentStrategyType.LLM_RESEARCH,
          raw: llmOutput,
        },
      };
    }

    /* =========================================
       COMPANY LLM RESEARCH
    ========================================== */

    if (type === "company") {
      const company = entity as ClaimedCompany;

      if (!company.domain && !company.website) {
        return { status: EnrichmentStatus.FAILED };
      }

      const prompt = `
Research this company:

Domain: ${sanitizeForPrompt(company.domain ?? "Unknown")}
Website: ${sanitizeForPrompt(company.website ?? "Unknown")}
Name: ${sanitizeForPrompt(company.name ?? "Unknown")}

Return structured JSON.
`;

      const llmOutput = await callLLM(prompt);

      return {
        status: EnrichmentStatus.PARTIAL,
        data: {
          company_name: company.name ?? undefined,
          domain: company.domain ?? undefined,
          website: company.website ?? undefined,
          confidence: 0.55,
          strategy: EnrichmentStrategyType.LLM_RESEARCH,
          raw: llmOutput,
        },
      };
    }

    return { status: EnrichmentStatus.FAILED };
  },
};

/* =========================================
   MOCK LLM CALL (replace with your real call)
========================================== */

async function callLLM(prompt: string): Promise<any> {
  // Replace with Groq/Ollama/etc
  return { mock: true };
}
