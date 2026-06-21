import pino from "pino";
import crypto from "crypto";
import { supabase } from "../db/supabase";
import { PipelineStage, PipelineState, UserPreferences } from "../harness/types";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export type MessageRole = "user" | "assistant" | "tool_call" | "tool_result" | "system";

export interface ChatMessage {
  role: MessageRole;
  content: string;
  tool_calls?: Array<{ name: string; input: unknown }>;
  tool_results?: Array<{ name: string; output: unknown }>;
  created_at: string;
}

export interface ChatSession {
  id: string;
  client_id: string;
  brand_id: string;
  user_id: string;
  messages: ChatMessage[];
  state: PipelineState;
  preferences: UserPreferences;
  lastActivity: number;
  createdAt: number;
}

const sessions = new Map<string, ChatSession>();
const SESSION_TTL_MS = 60 * 60 * 1000;

function createPipelineState(brandId: string, clientId: string): PipelineState {
  return {
    stage: "init",
    leads: [],
    researched: [],
    enriched: [],
    qualified: [],
    drafts: [],
    sent: [],
    searchQueries: [],
    intentDescription: "",
    brandId,
    clientId,
  };
}

function createDefaultPreferences(): UserPreferences {
  return {
    likedCompanyIds: [],
    dislikedCompanyIds: [],
    preferredKeywords: [],
    avoidKeywords: [],
    batchCount: 0,
  };
}

export function createSession(
  client_id: string,
  brand_id: string,
  user_id: string,
): ChatSession {
  const session: ChatSession = {
    id: crypto.randomUUID(),
    client_id,
    brand_id,
    user_id,
    messages: [],
    state: createPipelineState(brand_id, client_id),
    preferences: createDefaultPreferences(),
    lastActivity: Date.now(),
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ChatSession | undefined {
  const s = sessions.get(id);
  if (s && Date.now() - s.lastActivity > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  if (s) s.lastActivity = Date.now();
  return s;
}

export function addMessage(sessionId: string, message: ChatMessage): void {
  const s = sessions.get(sessionId);
  if (s) {
    s.messages.push(message);
    s.lastActivity = Date.now();
  }
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  return sessions.get(sessionId)?.messages ?? [];
}

export function getPipelineState(sessionId: string): PipelineState | undefined {
  return sessions.get(sessionId)?.state;
}

export function setPipelineStage(sessionId: string, stage: PipelineStage): void {
  const s = sessions.get(sessionId);
  if (s) {
    s.state.stage = stage;
    s.lastActivity = Date.now();
  }
}

export function updatePipelineState(sessionId: string, updates: Partial<PipelineState>): void {
  const s = sessions.get(sessionId);
  if (s) {
    Object.assign(s.state, updates);
    s.lastActivity = Date.now();
  }
}

export function getUserPreferences(sessionId: string): UserPreferences {
  const s = sessions.get(sessionId);
  return s?.preferences ?? createDefaultPreferences();
}

export function updateUserPreferences(sessionId: string, updates: Partial<UserPreferences>): void {
  const s = sessions.get(sessionId);
  if (s) {
    Object.assign(s.preferences, updates);
    s.lastActivity = Date.now();
  }
}

export function incrementBatchCount(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) {
    s.preferences.batchCount++;
    s.lastActivity = Date.now();
  }
}

export function getConversationContext(sessionId: string, maxTurns: number = 3): string {
  const s = sessions.get(sessionId);
  if (!s) return "";
  return s.messages
    .slice(-maxTurns * 2)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");
}

export async function saveSessionToDB(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;

  try {
    const { error } = await supabase.from("chat_sessions").upsert({
      id: s.id,
      client_id: s.client_id,
      brand_id: s.brand_id,
      user_id: s.user_id,
      messages: s.messages,
      state: s.state,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    if (error) logger.error({ error }, "Failed to save session to DB");
  } catch (err) {
    logger.error({ err }, "Failed to save session to DB");
  }
}

export async function saveCampaignToDB(
  sessionId: string,
  summary: string,
  queries: string[],
  intentDescription: string,
): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;

  try {
    const { error: intentError } = await supabase.from("brand_intents").insert({
      brand_id: s.brand_id,
      intent: intentDescription || summary,
      signals: ["discovery"],
      search_queries: queries,
      priority: 99,
      is_active: true,
    });

    if (intentError) {
      logger.error({ error: intentError }, "Failed to save brand intent");
    }

    const { error: campaignError } = await supabase.from("brand_campaigns").insert({
      brand_id: s.brand_id,
      client_id: s.client_id,
      summary,
      search_queries: queries,
      leads_count: s.state.leads.length,
      sent_count: s.state.sent.length,
      state: s.state,
      created_at: new Date().toISOString(),
    });

    if (campaignError) {
      logger.error({ error: campaignError }, "Failed to save campaign");
    }

    logger.info({ sessionId, intentDescription, queryCount: queries.length }, "Campaign saved");
  } catch (err) {
    logger.error({ err }, "Failed to save campaign");
  }
}

export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
