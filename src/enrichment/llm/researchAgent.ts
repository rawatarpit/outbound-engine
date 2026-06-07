import { z } from "zod";
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
import { generateStructured } from "../../llm/ollama";
import { isValidPersonalEmail } from "../utils/email-validator";

const contactSchema = z.object({
  full_name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Invalid email format — likely hallucinated",
    }),
  linkedin_url: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional().default(0),
  notes: z.string().nullable().optional(),
});

const companySchema = z.object({
  company_name: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  employee_count: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v ? String(v) : undefined),
  description: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional().default(0.5),
});

export const llmResearchExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext): Promise<EnrichmentResult> {
    const { type, entity } = context;

    if (type === "contact") {
      const contact = entity as ClaimedContact;

      if (!contact.domain) {
        return { status: EnrichmentStatus.FAILED };
      }

      const prompt = `
Research this professional contact using ONLY reliable data. Do NOT invent or guess.

Name: ${sanitizeForPrompt(contact.full_name ?? "Unknown")}
Domain: ${sanitizeForPrompt(contact.domain)}
Title: ${sanitizeForPrompt(contact.title ?? "Unknown")}

CRITICAL RULES:
- Set email to null unless you have actual proof of the email address.
- Set linkedin_url to null unless you have the actual profile URL.
- Set confidence to 0 if you are guessing.

Return JSON with: full_name, title, email, linkedin_url, confidence (0-1), notes
`;

      try {
        const result = await generateStructured(prompt, contactSchema, 0, undefined, 500);
        return {
          status: EnrichmentStatus.PARTIAL,
          data: {
            full_name: result.full_name ?? contact.full_name ?? undefined,
            title: result.title ?? contact.title ?? undefined,
            email: result.email && isValidPersonalEmail(result.email) ? result.email : undefined,
            linkedin_url: result.linkedin_url,
            domain: contact.domain,
            confidence: result.email && isValidPersonalEmail(result.email) ? result.confidence : Math.min(result.confidence, 0.3),
            strategy: EnrichmentStrategyType.LLM_RESEARCH,
            raw: result,
          },
        };
      } catch {
        return {
          status: EnrichmentStatus.PARTIAL,
          data: {
            full_name: contact.full_name ?? undefined,
            title: contact.title ?? undefined,
            domain: contact.domain,
            confidence: 0.4,
            strategy: EnrichmentStrategyType.LLM_RESEARCH,
          },
        };
      }
    }

    if (type === "company") {
      const company = entity as ClaimedCompany;

      if (!company.domain && !company.website) {
        return { status: EnrichmentStatus.FAILED };
      }

      const prompt = `
Research this company and return structured data. Use ONLY reliable, verifiable information. Do NOT invent or guess.

Domain: ${sanitizeForPrompt(company.domain ?? "Unknown")}
Website: ${sanitizeForPrompt(company.website ?? "Unknown")}
Name: ${sanitizeForPrompt(company.name ?? "Unknown")}

CRITICAL RULES:
- NEVER invent a domain or website. Set to null if not known.
- NEVER invent employee count or industry details. Set confidence to 0 if guessing.
- If the company name appears made up or is just a generic word, set company_name to null.

Return JSON with: company_name, domain, website, industry, employee_count, description, confidence (0-1)
`;

      try {
        const result = await generateStructured(prompt, companySchema, 0, undefined, 500);
        return {
          status: EnrichmentStatus.PARTIAL,
          data: {
            company_name: result.company_name ?? company.name ?? undefined,
            domain: result.domain ?? company.domain ?? undefined,
            website: result.website ?? company.website ?? undefined,
            confidence: result.confidence,
            strategy: EnrichmentStrategyType.LLM_RESEARCH,
            raw: result,
          },
        };
      } catch {
        return {
          status: EnrichmentStatus.PARTIAL,
          data: {
            company_name: company.name ?? undefined,
            domain: company.domain ?? undefined,
            website: company.website ?? undefined,
            confidence: 0.4,
            strategy: EnrichmentStrategyType.LLM_RESEARCH,
          },
        };
      }
    }

    return { status: EnrichmentStatus.FAILED };
  },
};
