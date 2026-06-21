import type { ToolDefinition } from "./types";
import { z } from "zod";

export const CHAT_TOOLS: ToolDefinition[] = [
  {
    name: "discover_leads",
    description: `
      WHAT: Finds leads by searching across multiple sources (web, social media, news, job boards, Eventbrite, Meetup, HN, Reddit). Uses either brand intents from DB or dynamically generated search queries.
      WHEN: User asks to find, discover, or search for leads/companies/prospects.
      RETURNS: Array of discovered companies with domain, signal type, relevance score.
    `,
    input_schema: z.object({
      brand_id: z.string().describe("Brand ID to discover leads for"),
      client_id: z.string().optional(),
      limit: z.number().default(10).describe("Maximum leads to return"),
      search_queries: z.array(z.string()).optional().describe("Custom search queries to use instead of brand intents"),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "search",
      timeout_ms: 120000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },
  {
    name: "research_leads",
    description: `
      WHAT: Researches discovered companies by scraping websites and running LLM analysis.
      WHEN: After leads are discovered, or user asks to research specific companies.
      RETURNS: Research data including industry, pain points, buying signals, automation maturity.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
      max_leads: z.number().default(10),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "compute",
      timeout_ms: 180000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },
  {
    name: "enrich_leads",
    description: `
      WHAT: Finds decision-maker contact details (email, title, LinkedIn) for leads using multiple strategies.
      WHEN: After research is complete, or user asks for contact info.
      RETURNS: Array of contacts with email, name, title, confidence.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
      max_leads: z.number().default(10),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "compute",
      timeout_ms: 180000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "expensive",
    },
  },
  {
    name: "qualify_leads",
    description: `
      WHAT: Scores leads 0-100 against the brand's ideal customer profile based on research data.
      WHEN: After research is complete, or user asks to score/qualify leads.
      RETURNS: Fit score, confidence, and reasoning per lead.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
      max_leads: z.number().default(10),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "compute",
      timeout_ms: 120000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },
  {
    name: "draft_emails",
    description: `
      WHAT: Generates personalized cold outreach email drafts for qualified leads.
      WHEN: User asks to draft emails, send emails, or after qualification is complete.
      RETURNS: Array of drafts with subject line and body.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
      max_leads: z.number().default(10),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "compute",
      timeout_ms: 180000,
      retryable: true,
      requires_confirmation: true,
      cost_tier: "cheap",
    },
  },
  {
    name: "send_emails",
    description: `
      WHAT: Sends approved email drafts to recipients through the configured email provider.
      WHEN: User approves drafts and asks to send them.
      RETURNS: Confirmation of sent status.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
      draft_ids: z.array(z.string()).optional(),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "io",
      timeout_ms: 60000,
      retryable: false,
      requires_confirmation: true,
      cost_tier: "free",
    },
  },
  {
    name: "get_pipeline",
    description: `
      WHAT: Returns the current pipeline status for a brand - leads by stage.
      WHEN: User asks about pipeline, status, or wants to see current leads.
      RETURNS: Summary of pipeline by status and list of companies.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "search",
      timeout_ms: 30000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
  {
    name: "analyze_reply",
    description: `
      WHAT: Analyzes an inbound email reply to determine intent (interested, unsubscribe, OOO, objection).
      WHEN: User asks about replies or wants to analyze a specific response.
      RETURNS: Intent classification with confidence and summary.
    `,
    input_schema: z.object({
      brand_id: z.string(),
      client_id: z.string().optional(),
      message_id: z.string().optional(),
    }),
    executor: async () => { throw new Error("handled by orchestrator"); },
    metadata: {
      category: "compute",
      timeout_ms: 60000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },
];
