import pino from "pino";
import { BrandProfile } from "../db/supabase";
import { routeIntent } from "./router";
import { StepResult, ProgressCallback, RouterOutput, PlannerOutput, SynthesizerOutput } from "./types";
import { runAgenticWorker } from "../agentLoop/agenticWorker";
import { createSession, getSession, addMessage, getPipelineState, getConversationContext, saveSessionToDB, saveCampaignToDB } from "../agentLoop/conversation";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export interface AgentLoopInput {
  message: string;
  brand: BrandProfile;
  sessionId?: string;
  onProgress?: ProgressCallback;
}

export interface AgentLoopOutput {
  intent: RouterOutput;
  plan: PlannerOutput;
  results: StepResult[];
  response: SynthesizerOutput;
  sessionId: string;
  saveCampaign?: SynthesizerOutput["saveCampaign"];
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopOutput> {
  const { message, brand, sessionId: existingSessionId } = input;

  let session = existingSessionId ? getSession(existingSessionId) : undefined;
  if (!session) {
    session = createSession(brand.client_id || "", brand.id, "anonymous");
  }

  addMessage(session.id, { role: "user", content: message, created_at: new Date().toISOString() });

  const conversationContext = getConversationContext(session.id);
  const currentState = getPipelineState(session.id)!;

  const intent = await routeIntent(message, brand, conversationContext);
  logger.info({ intent: intent.intent, confidence: intent.confidence, params: intent.parameters }, "Intent routed");

  const requiredParams = intent.intent === "discover" ? ["location", "industry"] : [];
  const isMissingRequired = intent.intent === "discover" && requiredParams.every((p) => !intent.parameters[p]);

  if (intent.confidence < 0.6 || isMissingRequired) {
    let message: string;
    let askFor: string[] = [];
    if (intent.intent === "discover" && isMissingRequired) {
      askFor = requiredParams.filter((p) => !intent.parameters[p]);
      message = `I'll help you find leads! I just need a bit more info. Which ${askFor.join(" and ")} are you looking for?`;
    } else if (intent.intent === "chat" || intent.confidence < 0.6) {
      message = `Hey! I'm your outbound assistant for ${brand.brand_name}. What would you like to do?\n\nYou can ask me to:\n- Find leads matching specific criteria\n- Research a company\n- Qualify existing leads\n- Draft outreach emails\n- Find contact information\n- Check pipeline status`;
    } else {
      message = `Sure, I can help with that. Could you provide more details?`;
    }

    const response: SynthesizerOutput = { message, suggestions: ["Find me leads", "Research a company", "Show pipeline", "Save this search"], askClarification: askFor };

    addMessage(session.id, { role: "assistant", content: response.message, created_at: new Date().toISOString() });
    saveSessionToDB(session.id);

    return {
      intent: intent as RouterOutput,
      plan: { steps: [] },
      results: [],
      response,
      sessionId: session.id,
    };
  }

  // Agentic loop for actionable intents
  const { results, response } = await runAgenticWorker({
    message,
    brand,
    intent: intent as RouterOutput,
    sessionId: session.id,
  });

  // Build plan from results for backward compatibility
  const plan: PlannerOutput = {
    steps: results.map((r, i) => ({
      tool: r.tool,
      input: {},
      dependsOn: i > 0 ? [i - 1] : [],
    })),
    searchQueries: (intent.parameters.search_queries as string[]) || currentState.searchQueries,
    intentDescription: intent.intent,
  };

  saveSessionToDB(session.id);

  const saveCampaign = (response as SynthesizerOutput).saveCampaign;
  if (saveCampaign?.shouldSave) {
    await saveCampaignToDB(
      session.id,
      saveCampaign.summary,
      saveCampaign.queries,
      currentState.intentDescription || saveCampaign.summary,
    );
  }

  return {
    intent: intent as RouterOutput,
    plan,
    results,
    response: response as SynthesizerOutput,
    sessionId: session.id,
    saveCampaign,
  };
}
