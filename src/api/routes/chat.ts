import { Router, Request, Response } from "express";
import pino from "pino";
import { getBrandProfile } from "../../db/supabase";
import { runAgentLoop } from "../../harness/agentLoop";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { message, session_id, brand_id } = req.body;
  const auth = req.auth!;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const effectiveBrandId = brand_id || auth.brand_id;
  if (!effectiveBrandId) {
    res.status(400).json({ error: "brand_id is required in body or auth token" });
    return;
  }

  const brand = await getBrandProfile(effectiveBrandId);
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  try {
    const output = await runAgentLoop({
      message,
      brand,
      sessionId: session_id,
      onProgress: (event) => {
        sendEvent(event.type, {
          step_id: event.step_id,
          tool: event.tool,
          data: event.data,
          error: event.error,
        });
      },
    });

    sendEvent("session", { session_id: output.sessionId });

    sendEvent("intent", { intent: output.intent.intent, confidence: output.intent.confidence, parameters: output.intent.parameters, missingParams: output.intent.missingParams });

    const requiredParams = output.intent.intent === "discover" ? ["location", "industry"] : [];
    const isMissingRequired = requiredParams.length > 0 && requiredParams.some((p) => !output.intent.parameters[p]);
    if (output.intent.confidence < 0.6 || isMissingRequired) {
      sendEvent("clarify", { questions: output.response.askClarification || output.intent.missingParams });
    }

    if (output.plan.steps.length > 0) {
      sendEvent("plan", { steps: output.plan.steps.map((s) => ({ tool: s.tool, dependsOn: s.dependsOn })) });
    }

    if (output.plan.searchQueries && output.plan.searchQueries.length > 0) {
      sendEvent("queries", { queries: output.plan.searchQueries, intentDescription: output.plan.intentDescription });
    }

    sendEvent("message", { text: output.response.message, suggestions: output.response.suggestions });

    if (output.saveCampaign?.shouldSave) {
      sendEvent("save_campaign", {
        summary: output.saveCampaign.summary,
        queries: output.saveCampaign.queries,
      });
    }

    sendEvent("done", { session_id: output.sessionId });
  } catch (err: any) {
    logger.error({ err }, "Chat processing error");
    sendEvent("error", { message: err.message || "Internal error" });
  } finally {
    res.end();
  }
});

export { router as chatRouter };
