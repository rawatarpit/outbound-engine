import crypto from "crypto";
import pino from "pino";
import {
  getBrandProfile,
  supabase,
} from "../db/supabase";
import { AgentResultStatus, researchResultSchema } from "../agents/types";
import { generateStructured } from "../llm/ollama";
import { buildResearchPrompt } from "../harness/promptBuilder";
import { runResearchAgent } from "../agents/research";
import { runQualificationAgent } from "../agents/qualification";
import { runOutreachAgent } from "../agents/outreach";
import { startSignalDiscovery } from "../discovery/signals/engine";
import { executeScraplingSearch, ScraplingResult } from "../core/utils/scrapling";
import { runBrowserEnrich } from "../core/utils/browserEnrich";
import { scrapeUrl } from "../core/utils/scraper";
import { getProvider } from "../email/providers";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

const COMPANY_PAGE_PATHS = ["/contact"];

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {}
  return null;
}

export interface ToolInput {
  brand_id: string;
  client_id?: string;
  query?: string;
  location?: string;
  industry?: string;
  offset?: number;
  max_leads?: number;
  company_id?: string;
  lead_id?: string;
  search_queries?: string[];
  [key: string]: unknown;
}

export async function executeTool(
  tool: string,
  input: ToolInput,
): Promise<unknown> {
  logger.info({ tool, input: { ...input, brand_id: input.brand_id } }, "Executing tool");

  switch (tool) {
    case "discover_leads":
      return discoverLeads(input);
    case "research_leads":
      return researchLeads(input);
    case "enrich_leads":
      return enrichLeads(input);
    case "qualify_leads":
      return qualifyLeads(input);
    case "draft_emails":
      return draftEmails(input);
    case "send_emails":
      return sendEmails(input);
    case "get_pipeline":
      return getPipeline(input);
    case "analyze_reply":
      return analyzeReply(input);
    case "search_web":
      return searchWeb(input);
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

async function searchWeb(input: ToolInput): Promise<{ results: { title: string; url: string; snippet: string }[] }> {
  const query = input.query || "";
  if (!query) return { results: [] };
  const results = await executeScraplingSearch(query, "google", (input.max_results as number) || 10);
  return {
    results: results.map((r) => ({ title: r.title || "", url: r.url || "", snippet: r.body || "" })),
  };
}

// Known non-company domains to skip
const KNOWN_NON_COMPANY_DOMAINS = new Set([
  "medium.com", "blogspot.com", "wordpress.com", "wixsite.com",
  "youtube.com", "facebook.com", "instagram.com", "twitter.com",
  "pinterest.com", "tumblr.com", "reddit.com", "quora.com",
  "wikipedia.org", "en.wikipedia.org", "github.com", "stackoverflow.com",
  "claude.ai", "chatgpt.com", "google.com",
  "ycombinator.com", "linkedin.com", "crunchbase.com",
  "manta.com", "zippia.com", "lensa.com", "dribbble.com",
  "builtin.com", "builtinnyc.com",
  "visualcapitalist.com", "companiesmarketcap.com", "bestcompany.com",
  "welcometothejungle.com", "glassdoor.com", "indeed.com",
  "osmthome.com", "marcaria.com",
]);

// Domains that look like article/blog publishers, not real companies
function isNonCompanyDomain(domain: string): boolean {
  if (KNOWN_NON_COMPANY_DOMAINS.has(domain)) return true;
  // Info/org/gov/edu domains that aren't companies
  if (/\.(gov|edu|org|wiki)$/.test(domain) && !/\.co\.|\.com\.|\.io\./.test(domain)) return true;
  // Blog platforms
  if (/\.blog\.|substack\.|hashnode\.|dev\.to/.test(domain)) return true;
  return false;
}

// Extract a clean company name from domain
function companyNameFromDomain(domain: string): string {
  return domain
    .replace(/^www\./, "")
    .split(".")[0]
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Extract company name from a LinkedIn URL
function linkedInCompanyName(url: string): string | null {
  const match = url.match(/linkedin\.com\/company\/([^/?]+)/);
  if (match) {
    return match[1]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  return null;
}

async function discoverLeads(input: ToolInput): Promise<{ leads: unknown[]; queries: string[] }> {
  const brandId = input.brand_id;
  let queries = input.search_queries || [];
  const maxLeads = input.max_leads || 10;
  const offset = (input.offset as number) || 0;
  const industry = (input.industry || "") as string;

  // Build query from user's request
  const rawQuery = (input.query || "").replace(/^(find|search|discover|get)\s+/i, "").trim() ||
    (input.location ? `${industry} ${input.location}` : industry) || "companies";

  // Use targeted queries that return actual company pages
  const location = rawQuery.replace(/.*in\s+/i, "").trim();
  const industry2 = rawQuery.replace(/\s+in\s+.*/i, "").trim();
  queries = [
    // Directory-specific searches (more likely to have clean company data)
    `site:clutch.co "${industry2}" "${location}"`,
    `site:goodfirms.co "${industry2}" "${location}"`,
    `"${industry2}" "${location}" "www." -blog -article`,
    `"${industry2}" "${location}" company website`,
  ];

  // Load already-seen domains from DB to avoid duplicates across batches
  const { data: existingCompanies } = await supabase
    .from("companies")
    .select("domain")
    .eq("brand_id", brandId)
    .not("domain", "is", null);
  const seen = new Set<string>((existingCompanies ?? []).map(c => c.domain).filter(Boolean));

  // Collect fresh results from multiple queries
  const allRaw: ScraplingResult[] = [];
  for (const q of queries.slice(0, 3)) {
    const results = await executeScraplingSearch(q, "google", 15 + offset).catch(() => []);
    allRaw.push(...results);
  }

  const leads: any[] = [];
  const processedDomains = new Set<string>();

  for (const r of allRaw) {
    const domain = r.url ? extractDomain(r.url) : null;
    const url = r.url || "";
    if (!domain || seen.has(domain) || processedDomains.has(domain)) continue;

    // Skip non-company domains
    if (isNonCompanyDomain(domain)) continue;

    processedDomains.add(domain);

    // For LinkedIn URLs, extract company name from URL
    let name = r.company || "";
    if (!name && url.includes("linkedin.com/company/")) {
      name = linkedInCompanyName(url) || "";
    }
    if (!name) {
      name = companyNameFromDomain(domain);
    }
    if (name.length < 2) continue;

    const { error: insertErr } = await supabase.from("companies").insert({
      domain, name, brand_id: brandId, source: r.url,
    });
    if (insertErr) {
      logger.warn({ err: insertErr, domain, name }, "Failed to insert company");
      continue;
    }

    leads.push({ name, domain, source: r.url, summary: (r.body || r.title || "").slice(0, 500), brand_id: brandId });
    if (leads.length >= maxLeads) break;
  }

  logger.info({ brandId, leadCount: leads.length, totalResults: allRaw.length }, "Discovery completed");

  if (leads.length > 0) return { leads, queries };

  // Last resort: signal discovery
  try {
    const results = (await startSignalDiscovery(brandId, maxLeads)) ?? [];
    return { leads: results, queries };
  } catch (err) {
    logger.warn({ err }, "Full discovery failed");
    return { leads, queries };
  }
}

/* ── Multi-source Research Orchestrator ──────────────────────────────── */

const RESEARCH_SEARCHES = [
  (name: string) => `"${name}" company overview services`,
  (name: string) => `"${name}" LinkedIn OR Facebook OR Instagram OR Twitter`,
  (name: string) => `"${name}" reviews OR testimonial OR case study`,
  (name: string) => `"${name}" news OR announcement OR press release OR funding`,
  (name: string) => `"${name}" jobs OR careers OR hiring`,
];

async function researchLeads(input: ToolInput): Promise<{ researched: unknown[] }> {
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, website, domain, brand_id")
    .eq("brand_id", input.brand_id)
    .limit(input.max_leads || 10);

  const results: unknown[] = [];
  for (const company of companies ?? []) {
    try {
      const website = company.website || (company.domain ? `https://${company.domain}` : undefined);
      const agentResult = await runResearchAgent({
        id: company.id,
        name: company.name,
        website,
        brand_id: company.brand_id,
      });

      if (agentResult.status === AgentResultStatus.SUCCESS) {
        results.push({ company_id: company.id, status: "success" });
        continue;
      }

      // Agent failed — run multi-source research
      const saved = await multiSourceResearch(company);
      results.push({
        company_id: company.id,
        status: saved ? "partial" : "error",
        note: saved
          ? "Multi-source research completed (web search + socials + reviews + news)"
          : agentResult.error || "All research sources failed",
      });
    } catch (err: any) {
      logger.error({ company_id: company.id, err }, "Research failed");
      results.push({ company_id: company.id, status: "error", error: err.message });
    }
  }
  return { researched: results };
}

async function multiSourceResearch(company: {
  id: string; name: string; domain?: string | null; brand_id: string;
}): Promise<boolean> {
  try {
    // Phase 1: Gather data from multiple sources in parallel
    const searches = RESEARCH_SEARCHES.map(fn => fn(company.name))
      .map(query => executeScraplingSearch(query, "google", 5)
        .catch(() => [] as { title?: string; body?: string }[]));

    const scrapePromise = company.domain
      ? scrapeUrl(`https://${company.domain}`, 6000).catch(() => null)
      : Promise.resolve(null);

    const searchResults = await Promise.all(searches);
    const websiteContent = await scrapePromise;

    // Phase 2: Aggregate into a single text corpus
    const parts: string[] = [];

    if (websiteContent) {
      const clean = websiteContent.replace(/\s+/g, " ").trim().slice(0, 4000);
      parts.push(`=== WEBSITE ===\n${clean}`);
    }

    const labels = ["Overview", "Social Media", "Reviews", "News/Press", "Jobs"];
    for (let i = 0; i < searchResults.length; i++) {
      const results = searchResults[i];
      if (results.length > 0) {
        const snippet = results
          .map(r => `${r.title || ""}: ${(r.body || "").slice(0, 300)}`)
          .join("\n")
          .slice(0, 2000);
        if (snippet) parts.push(`=== ${labels[i]} ===\n${snippet}`);
      }
    }

    const aggregatedContent = parts.join("\n\n").slice(0, 8000);

    if (!aggregatedContent) {
      const { error } = await supabase.from("research").insert({
        company_id: company.id,
        brand_id: company.brand_id,
        industry: null,
        summary: `Basic entry for ${company.name} — no detailed sources found`,
        raw_content: null,
      });
      return !error || error.code === "23505";
    }

    // Phase 3: Try LLM to extract structured research from aggregated content
    try {
      const brand = await getBrandProfile(company.brand_id);

      const prompt = buildResearchPrompt({
        brandName: brand?.brand_name || "Our Brand",
        positioning: brand?.positioning || "",
        coreOffer: brand?.core_offer || "",
        audience: brand?.audience || "",
        content: aggregatedContent,
      });

      const parsed = await generateStructured(prompt, researchResultSchema, undefined, brand?.client_id ?? undefined);

      const { error } = await supabase.from("research").insert({
        company_id: company.id,
        brand_id: company.brand_id,
        industry: parsed.industry,
        size_estimate: parsed.size_estimate,
        pain_points: parsed.pain_points,
        buying_signals: parsed.buying_signals,
        automation_maturity: parsed.automation_maturity,
        sponsorship_potential: parsed.sponsorship_potential,
        summary: parsed.summary,
        raw_content: aggregatedContent,
      });

      if (error && error.code !== "23505") {
        logger.warn({ error }, "LLM research insert failed");
        return false;
      }
      return true;
    } catch {
      // Phase 4: LLM failed — save raw aggregated content as summary
      const { error } = await supabase.from("research").insert({
        company_id: company.id,
        brand_id: company.brand_id,
        industry: null,
        size_estimate: null,
        pain_points: null,
        buying_signals: null,
        automation_maturity: null,
        sponsorship_potential: false,
        summary: aggregatedContent.slice(0, 3000),
        raw_content: aggregatedContent,
      });

      if (error && error.code !== "23505") {
        logger.warn({ error }, "Raw research insert failed");
        return false;
      }
      return true;
    }
  } catch (err) {
    logger.warn({ err, company: company.name }, "Multi-source research failed");
    return false;
  }
}

/* ── Multi-source Enrich (Contact Discovery) ────────────────────────── */

const ENRICH_SEARCHES = [
  (name: string) => `"${name}" email OR contact OR info`,
  (name: string) => `"${name}" founder OR CEO OR director OR manager`,
  (name: string) => `"${name}" LinkedIn OR "decision maker" OR leadership`,
];

interface CompanyRef {
  id: string;
  name: string;
  domain?: string | null;
  brand_id: string;
}

async function enrichLeads(input: ToolInput): Promise<{ contacts: unknown[] }> {
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, domain, brand_id")
    .eq("brand_id", input.brand_id)
    .limit(input.max_leads || 10);

  // Check which companies already have leads
  const companyIds = (companies ?? []).map(c => c.id);
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("company_id")
    .in("company_id", companyIds)
    .limit(companyIds.length);
  const companiesWithLeads = new Set<string>((existingLeads ?? []).map(l => l.company_id));

  // Filter to only companies without existing contacts
  const toProcess = (companies ?? []).filter(c => !companiesWithLeads.has(c.id));

  const contacts: unknown[] = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(company => {
        const TIMEOUT_MS = 60000;
        return Promise.race([
          multiSourceEnrich(company),
          new Promise<[]>((_, reject) => setTimeout(() => reject(new Error("Per-company enrich timeout")), TIMEOUT_MS)),
        ]);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        contacts.push(...r.value);
      } else {
        logger.warn({ err: r.reason }, "Multi-source enrich batch failed");
      }
    }
  }
  return { contacts };
}

async function multiSourceEnrich(company: CompanyRef): Promise<unknown[]> {
  const domain = company.domain || "";

  // Phase 1: Gather from multiple sources in parallel (30s per-company timeout)
  const searches = ENRICH_SEARCHES.map(fn => fn(company.name))
    .map(query => executeScraplingSearch(query, "google", 8).catch(() => []));

  // Only scrape company pages if domain looks like a real company site (not blog/article)
  const isGenericDomain = !domain || domain.includes("example") || /\.(blog|medium|wordpress)\./.test(domain) || !domain.includes(".");
  const pageScrapes = domain && !isGenericDomain
    ? COMPANY_PAGE_PATHS.map(p => scrapeUrl(`https://${domain}${p}`, 5000).catch(() => null))
    : [];

  const allResults = await Promise.all([...searches, ...pageScrapes]);
  const numSearches = searches.length;
  const searchResults = allResults.slice(0, numSearches) as { title?: string; body?: string }[][];
  const pageContents = allResults.slice(numSearches) as (string | null)[];

  // Phase 2: Extract unique contacts from all sources
  const seenEmails = new Set<string>();
  const contacts: unknown[] = [];
  const extracted: Array<{
    email: string; name: string | null; title: string | null;
    linkedin: string | null; phone: string | null;
  }> = [];

  function extractFromText(text: string) {
    for (const m of [...text.matchAll(EMAIL_REGEX)]) {
      const email = m[0].toLowerCase();
      if (seenEmails.has(email) || email.includes("example.com") || email.includes("domain.com")) continue;
      seenEmails.add(email);
      extracted.push({
        email,
        name: extractNameFromText(text, company.name),
        title: extractTitleFromText(text),
        linkedin: extractLinkedinFromText(text),
        phone: extractPhoneFromText(text),
      });
    }
  }

  // From search results
  for (const results of searchResults) {
    for (const r of results) {
      extractFromText(`${r.title || ""} ${r.body || ""}`);
    }
  }

  // From company pages (contact, about, team, etc.)
  for (const content of pageContents) {
    if (content) extractFromText(content);
  }

  // Phase 3: Browser enrich — Playwright-powered website scraping for contacts
  if (extracted.length === 0 && domain && !isGenericDomain) {
    const browserResult = await runBrowserEnrich(domain, company.name, 85000).catch(() => ({
      success: false, contacts: [], domain, error: "browser enrich error",
    }));
    for (const c of browserResult.contacts || []) {
      if (c.email && !seenEmails.has(c.email)) {
        seenEmails.add(c.email);
        extracted.push({
          email: c.email,
          name: c.name || null,
          title: c.title || null,
          linkedin: c.linkedin || null,
          phone: c.phone || null,
        });
      }
      if (c.linkedin && !extracted.some(e => e.linkedin === c.linkedin)) {
        // Save as a contact with just LinkedIn
        const guessedEmail = c.email || `${c.name?.split(" ")[0]?.toLowerCase() || "contact"}@${domain}`;
        if (!seenEmails.has(guessedEmail)) {
          seenEmails.add(guessedEmail);
          extracted.push({
            email: guessedEmail,
            name: c.name || null,
            title: c.title || null,
            linkedin: c.linkedin || null,
            phone: null,
          });
        }
      }
    }
  }

  // Phase 4: Fallback — if we found names but no email, guess from domain
  if (extracted.length === 0 && domain && !domain.includes("example")) {
    const name = extractNameFromText(
      searchResults.flatMap(r => r.map(s => `${s.title || ""} ${s.body || ""}`)).join(" "),
      company.name
    );
    if (name) {
      const firstName = name.split(" ")[0].toLowerCase();
      const guessedEmail = `${firstName}@${domain}`;
      if (!seenEmails.has(guessedEmail)) {
        seenEmails.add(guessedEmail);
        extracted.push({
          email: guessedEmail,
          name, title: null, linkedin: null, phone: null,
        });
      }
    }
  }

  // Phase 5: Save each unique contact
  const seenNames = new Set<string>();
  for (const item of extracted) {
    if (item.name && seenNames.has(item.name)) continue;
    if (item.name) seenNames.add(item.name);

    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", item.email)
      .eq("company_id", company.id)
      .maybeSingle();

    if (existing) continue;

    const { data: lead } = await supabase
      .from("leads")
      .insert({
        full_name: item.name,
        email: item.email,
        title: item.title,
        linkedin_url: item.linkedin,
        phone: item.phone,
        brand_id: company.brand_id,
        company_id: company.id,
        source: "web_search",
        confidence_score: item.name ? 0.6 : 0.4,
      })
      .select("id, full_name, email, title, company_id")
      .maybeSingle();

    if (lead) {
      try { await supabase.from("lead_company_map").insert({ lead_id: lead.id, company_id: company.id }); } catch {}
      contacts.push(lead);
    }
  }

  return contacts;
}

function extractPhoneFromText(text: string): string | null {
  const m = text.match(PHONE_REGEX);
  if (m) return m[0].trim().slice(0, 20);
  return null;
}

function extractNameFromText(text: string, companyName: string): string | null {
  const patterns = [
    /(?:founder|CEO|director|manager|owner|president|head)\s*[:\-–]\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)/,
    /([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)\s*[:\-–]\s*(?:founder|CEO|director|manager|owner|president|head)/,
    /(?:contact|email|reach)\s*[:\-–]\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const name = m[1].trim().slice(0, 100);
      if (!name.toLowerCase().includes(companyName.toLowerCase().split(" ")[0])) return name;
    }
  }
  return null;
}

function extractTitleFromText(text: string): string | null {
  const p = /(?:title|role|position)\s*[:\-–]\s*([A-Za-z\s&/]+?)(?:\.|,|$)/i;
  const m = text.match(p);
  if (m) return m[1].trim().slice(0, 50);
  return null;
}

function extractLinkedinFromText(text: string): string | null {
  const p = /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/;
  const m = text.match(p);
  if (m) return `https://linkedin.com/in/${m[1]}`;
  return null;
}

/* ── Multi-source Qualification ──────────────────────────────────────── */

async function qualifyLeads(input: ToolInput): Promise<{ qualified: unknown[] }> {
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, domain, brand_id")
    .eq("brand_id", input.brand_id)
    .limit(input.max_leads || 10);

  const results: unknown[] = [];
  for (const company of companies ?? []) {
    try {
      const agentResult = await runQualificationAgent({
        id: company.id,
        name: company.name,
        brand_id: company.brand_id,
      });

      if (agentResult.status === AgentResultStatus.SUCCESS) {
        results.push({ company_id: company.id, status: "success", data: agentResult.data });
        continue;
      }

      if (agentResult.status === AgentResultStatus.SKIPPED) {
        // No research data — do keyword-based scoring as fallback
        const fallbackScore = await fallbackQualify(company);
        results.push({
          company_id: company.id,
          status: "success",
          data: { fitScore: fallbackScore },
          note: "Fallback keyword scoring used (no research data)",
        });
      } else {
        results.push({ company_id: company.id, status: "error", error: agentResult.error });
      }
    } catch (err: any) {
      logger.error({ company_id: company.id, err }, "Qualification failed");
      results.push({ company_id: company.id, status: "error", error: err.message });
    }
  }
  return { qualified: results };
}

async function fallbackQualify(company: CompanyRef): Promise<number> {
  try {
    const brand = await getBrandProfile(company.brand_id);
    if (!brand) return 50;

    const brandContext = `${brand.audience || ""} ${brand.core_offer || ""} ${brand.positioning || ""}`.toLowerCase();
    const companyName = (company.name || "").toLowerCase();
    const domain = (company.domain || "").toLowerCase();

    let score = 50;
    if (brandContext && companyName) {
      const keywords = brandContext.split(/[,;\s]+/).filter(k => k.length > 3);
      const matches = keywords.filter(k => companyName.includes(k) || domain.includes(k));
      score += matches.length * 5;
    }

    // Company has a real domain → slightly better signal
    if (company.domain) score += 5;
    // Avoid generic aggregator domains
    const generic = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"];
    if (domain && generic.some(g => domain.includes(g))) score -= 20;

    return Math.max(0, Math.min(100, score));
  } catch {
    return 50;
  }
}

/* ── Multi-source Drafting ───────────────────────────────────────────── */

async function draftEmails(input: ToolInput): Promise<{ drafts: unknown[] }> {
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, domain, brand_id")
    .eq("brand_id", input.brand_id)
    .limit(input.max_leads || 10);

  const results: unknown[] = [];
  for (const company of companies ?? []) {
    try {
      const agentResult = await runOutreachAgent({
        id: company.id,
        name: company.name,
        brand_id: company.brand_id,
      });

      if (agentResult.status === AgentResultStatus.SUCCESS) {
        results.push({ company_id: company.id, status: "success", data: agentResult.data });
        continue;
      }

      if (agentResult.status === AgentResultStatus.SKIPPED) {
        // No research/lead data — fallback to template draft
        const draft = await fallbackDraft(company);
        if (draft) {
          results.push({ company_id: company.id, status: "success", data: draft, note: "Template draft used" });
        } else {
          results.push({ company_id: company.id, status: "error", error: agentResult.error || "Could not generate draft" });
        }
      } else {
        results.push({ company_id: company.id, status: "error", error: agentResult.error });
      }
    } catch (err: any) {
      logger.error({ company_id: company.id, err }, "Draft failed");
      results.push({ company_id: company.id, status: "error", error: err.message });
    }
  }
  return { drafts: results };
}

async function fallbackDraft(company: CompanyRef): Promise<{ subject: string; body: string } | null> {
  try {
    const brand = await getBrandProfile(company.brand_id);
    if (!brand) return null;

    const brandName = brand.brand_name || "Our Team";
    const companyName = company.name || "your company";
    const positioning = brand.positioning || "help businesses grow";

    const subject = `Quick thought about ${companyName}`;
    const body = `Hi there,

I came across ${companyName} and wanted to reach out.

At ${brandName}, we ${positioning}. I think there could be a great opportunity for us to collaborate.

Would you be open to a quick chat next week?

Best,
${brandName}`;

    const { error } = await supabase.from("outreach").insert({
      company_id: company.id,
      brand_id: company.brand_id,
      subject,
      body,
      status: "draft",
    });

    if (error && error.code !== "23505") {
      logger.warn({ error }, "Fallback draft insert failed");
      return null;
    }

    return { subject, body };
  } catch (err) {
    logger.warn({ err, company: company.name }, "Fallback draft failed");
    return null;
  }
}

/* ── Direct Send (no queue dependency) ──────────────────────────────── */

async function sendEmails(input: ToolInput): Promise<{ sent: unknown[] }> {
  const brand = await getBrandProfile(input.brand_id);
  if (!brand || brand.is_paused || !brand.outbound_enabled) {
    return { sent: [{ brand_id: input.brand_id, status: "skipped", reason: "Brand cannot send" }] };
  }

  const { data: drafts } = await supabase
    .from("outreach")
    .select("id, company_id, subject, body, brand_id")
    .eq("brand_id", input.brand_id)
    .eq("status", "draft")
    .limit(input.max_leads || 10);

  if (!drafts?.length) {
    return { sent: [{ brand_id: input.brand_id, status: "no_drafts" }] };
  }

  const results: unknown[] = [];
  for (const draft of drafts) {
    try {
      const { data: leadMap } = await supabase
        .from("lead_company_map")
        .select("lead_id")
        .eq("company_id", draft.company_id)
        .maybeSingle();

      if (!leadMap?.lead_id) {
        results.push({ company_id: draft.company_id, status: "skipped", reason: "No lead linked" });
        continue;
      }

      const { data: lead } = await supabase
        .from("leads")
        .select("email")
        .eq("id", leadMap.lead_id)
        .maybeSingle();

      if (!lead?.email) {
        results.push({ company_id: draft.company_id, status: "skipped", reason: "No recipient email" });
        continue;
      }

      const provider = await getProvider(brand);
      const messageKey = crypto
        .createHash("sha256")
        .update(`${draft.company_id}-${draft.brand_id}`)
        .digest("hex");

      await supabase.from("sent_messages").insert({
        brand_id: draft.brand_id,
        company_id: draft.company_id,
        lead_id: leadMap.lead_id,
        message_key: messageKey,
        direction: "outbound",
        status: "pending",
        subject: draft.subject,
        body: draft.body,
      });

      const transportMessageId = await provider.send({
        brandId: draft.brand_id,
        brandName: brand.brand_name,
        to: lead.email,
        subject: draft.subject,
        body: draft.body,
        threadMeta: { companyId: draft.company_id, leadId: leadMap.lead_id },
        messageKey,
      });

      await supabase
        .from("sent_messages")
        .update({ status: "sent", smtp_message_id: transportMessageId, sent_at: new Date().toISOString() })
        .eq("message_key", messageKey);

      await supabase
        .from("outreach")
        .update({ status: "sent", sent_at: new Date().toISOString(), message_id: transportMessageId })
        .eq("id", draft.id);

      logger.info({ company_id: draft.company_id, to: lead.email }, "Email sent");
      results.push({ company_id: draft.company_id, status: "sent", to: lead.email });
    } catch (err: any) {
      logger.error({ draft_id: draft.id, err: err.message }, "Send failed");
      results.push({ company_id: draft.company_id, status: "error", error: err.message });
    }
  }

  return { sent: results };
}

/* ── Pipeline & Utilities ────────────────────────────────────────────── */

async function getPipeline(input: ToolInput): Promise<{ summary: string; companies: unknown[] }> {
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, status, lead_score, domain")
    .eq("brand_id", input.brand_id)
    .order("created_at", { ascending: false })
    .limit(20);

  const byStatus: Record<string, number> = {};
  for (const c of companies ?? []) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }

  const summary = Object.entries(byStatus)
    .map(([s, n]) => `${s}: ${n}`)
    .join(", ");

  return { summary: summary || "No companies found", companies: companies ?? [] };
}

async function analyzeReply(_input: ToolInput): Promise<{ result: string }> {
  return { result: "Reply analysis: check the replies table for latest inbound messages" };
}
