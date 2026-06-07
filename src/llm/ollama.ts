import axios from "axios";
import pino from "pino";
import { ZodSchema } from "zod";
import { getClientLLMSettings } from "../db/supabase";

const logger = pino({ level: "info" });

const MAX_RETRIES = 3;
const TIMEOUT_MS = 120000;

class RateLimiter {
  private maxRequests: number;
  private maxTokens: number;
  private windowMs: number;
  private minIntervalMs: number;
  private timestamps: { at: number; tokens: number }[] = [];
  private lastRequestAt = 0;

  constructor(maxRequests = 1, maxTokens = 5000, windowMs = 70_000, minIntervalMs = 61000) {
    this.maxRequests = maxRequests;
    this.maxTokens = maxTokens;
    this.windowMs = windowMs;
    this.minIntervalMs = minIntervalMs;
  }

  async acquire(estimatedTokens = 700): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t.at < this.windowMs);

    const usedTokens = this.timestamps.reduce((s, t) => s + t.tokens, 0);
    const willExceed = this.timestamps.length >= this.maxRequests || (usedTokens + estimatedTokens) > this.maxTokens;

    if (willExceed) {
      const oldestTs = this.timestamps[0]?.at ?? now;
      const wait = this.windowMs - (now - oldestTs) + 50;
      logger.debug(
        { waitMs: Math.round(wait), rpm: this.timestamps.length, tpm: usedTokens },
        "Rate limiter waiting",
      );
      await new Promise(r => setTimeout(r, wait));
      return this.acquire(estimatedTokens);
    }

    const gap = this.minIntervalMs - (now - this.lastRequestAt);
    if (gap > 0) {
      await new Promise(r => setTimeout(r, gap));
    }

    this.lastRequestAt = Date.now();
    this.timestamps.push({ at: this.lastRequestAt, tokens: estimatedTokens });
  }
}

const rateLimiter = new RateLimiter();

let firstCall = true;

/**
 * FIFO concurrency limiter.
 * Ensures at most N LLM calls are in-flight at once,
 * preventing thundering herds against the rate limiter and API.
 */
class LLMConcurrencyQueue {
  private concurrency: number;
  private active = 0;
  private queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.active >= this.concurrency || this.queue.length === 0) return;
    this.active++;
    const { fn, resolve, reject } = this.queue.shift()!;
    Promise.resolve()
      .then(() => fn())
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.active--;
        this.processNext();
      });
  }
}

const llmQueue = new LLMConcurrencyQueue(2);

/**
 * ===============================
 * LLM PROVIDER TYPES
 * ===============================
 */

export type LLMProvider =
  | "ollama"
  | "groq"
  | "openai"
  | "anthropic"
  | "cloudflare";

interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
}

const defaultConfig: LLMConfig = {
  provider: (process.env.LLM_PROVIDER as LLMProvider) || "ollama",
  baseUrl:
    process.env.LLM_BASE_URL ||
    process.env.OLLAMA_URL ||
    "http://localhost:11434",
  model: process.env.LLM_MODEL || process.env.OLLAMA_MODEL || "llama3:8b",
  apiKey: process.env.LLM_API_KEY || "",
  temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.2"),
};

const DEFAULT_MAX_TOKENS = 1000;

interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * ===============================
 * GET CLIENT LLM CONFIG
 * ===============================
 */

let cachedConfig: LLMConfig | null = null;
let configExpiry = 0;

async function getLLMConfig(clientId?: string): Promise<LLMConfig> {
  const now = Date.now();

  // Use cached config if valid (5 min TTL)
  if (cachedConfig && clientId && configExpiry > now) {
    return cachedConfig;
  }

  // Try to get client-specific config
  if (clientId) {
    try {
      const clientSettings = await getClientLLMSettings(clientId);
      if (clientSettings) {
        cachedConfig = {
          provider:
            (clientSettings.llm_provider as LLMProvider) ||
            defaultConfig.provider,
          baseUrl: clientSettings.llm_base_url || defaultConfig.baseUrl,
          model: clientSettings.llm_model || defaultConfig.model,
          apiKey: clientSettings.llm_api_key || defaultConfig.apiKey,
          temperature:
            parseFloat(String(clientSettings.llm_temperature)) ||
            defaultConfig.temperature,
        };
        configExpiry = now + 5 * 60 * 1000; // 5 min cache
        return cachedConfig;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to get client LLM settings, using defaults");
    }
  }

  return defaultConfig;
}

/**
 * ===============================
 * RAW CALL - BY PROVIDER
 * ===============================
 */

async function rawCall(
  prompt: string,
  config: LLMConfig,
  temperature?: number,
  maxTokens?: number,
): Promise<string> {
  const temp = temperature ?? config.temperature;
  const tokens = maxTokens ?? DEFAULT_MAX_TOKENS;

  switch (config.provider) {
    case "ollama":
      return callOllama(prompt, config, temp);
    case "groq":
      return callGroq(prompt, config, temp, tokens);
    case "openai":
      return callOpenAI(prompt, config, temp, tokens);
    case "anthropic":
      return callAnthropic(prompt, config, temp);
    case "cloudflare":
      return callCloudflare(prompt, config, temp);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * ===============================
 * OLLAMA
 * ===============================
 */

async function callOllama(
  prompt: string,
  config: LLMConfig,
  temperature: number,
): Promise<string> {
  const url = `${config.baseUrl}/api/generate`;

  const response = await axios.post(
    url,
    {
      model: config.model,
      prompt,
      stream: false,
      options: {
        temperature,
      },
    },
    { timeout: TIMEOUT_MS },
  );

  return response.data.response;
}

/**
 * ===============================
 * GROQ
 * ===============================
 */

async function callGroq(
  prompt: string,
  config: LLMConfig,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const url = "https://api.groq.com/openai/v1/chat/completions";

  if (firstCall) {
    firstCall = false;
    logger.info("First LLM call — waiting 10s for stale rate limit window to expire");
    await new Promise(r => setTimeout(r, 10000));
  }
  await rateLimiter.acquire(maxTokens + 1000);

  const response = await axios.post(
    url,
    {
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    },
  );

  return response.data.choices[0]?.message?.content || "";
}

/**
 * ===============================
 * OPENAI (or OpenAI-compatible)
 * ===============================
 */

async function callOpenAI(
  prompt: string,
  config: LLMConfig,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const url = config.baseUrl.includes("openai.com")
    ? "https://api.openai.com/v1/chat/completions"
    : `${config.baseUrl}/v1/chat/completions`;

  if (firstCall) {
    firstCall = false;
    logger.info("First LLM call — waiting 10s for stale rate limit window to expire");
    await new Promise(r => setTimeout(r, 10000));
  }
  await rateLimiter.acquire(maxTokens + 1000);

  const response = await axios.post(
    url,
    {
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    },
  );

  return response.data.choices[0]?.message?.content || "";
}

/**
 * ===============================
 * ANTHROPIC
 * ===============================
 */

async function callAnthropic(
  prompt: string,
  config: LLMConfig,
  temperature: number,
): Promise<string> {
  const url = "https://api.anthropic.com/v1/messages";

  const response = await axios.post(
    url,
    {
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: 4096,
    },
    {
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    },
  );

  return response.data.content[0]?.text || "";
}

/**
 * ===============================
 * CLOUDFLARE WORKERS AI
 * ===============================
 */

async function callCloudflare(
  prompt: string,
  config: LLMConfig,
  temperature: number,
): Promise<string> {
  const url = `${config.baseUrl}/ai/v1/run/@cf/meta/llama-3.1-8b-instruct`;

  const response = await axios.post(
    url,
    {
      prompt,
      options: {
        temperature,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    },
  );

  return response.data.response || "";
}

/**
 * ===============================
 * JSON EXTRACTION
 * ===============================
 */

function extractJSON(text: string): string {
  let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
  // Check the first character to determine if it's an object or array
  if (cleaned.startsWith("[")) {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) return arrayMatch[0];
  } else {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return objMatch[0];
  }
  throw new Error("No JSON object detected in model output");
}

/**
 * ===============================
 * JSON REPAIR ATTEMPT
 * ===============================
 */

function escapeInnerQuotes(str: string): string {
  let result = ""
  let inString = false
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === "\\" && i + 1 < str.length) {
      result += c + str[i + 1]
      i++
      continue
    }
    if (c === '"') {
      if (!inString) {
        inString = true
        result += c
      } else {
        let j = i + 1
        while (j < str.length && (str[j] === " " || str[j] === "\t" || str[j] === "\n")) j++
        if (j < str.length && (str[j] === "," || str[j] === "}" || str[j] === "]" || str[j] === ":")) {
          inString = false
          result += c
        } else {
          result += '\\"'
        }
      }
      continue
    }
    result += c
  }
  return result
}

function attemptRepair(jsonString: string): unknown {
  try {
    return JSON.parse(jsonString);
  } catch {
    try {
      let cleaned = jsonString
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/'/g, '"')
        .replace(/(\S)\n(\S)/g, "$1\\n$2");
      return JSON.parse(cleaned);
    } catch {
      try {
        let cleaned = jsonString.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
        cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/'/g, '"');
        return JSON.parse(cleaned);
      } catch {
        try {
          const sub = jsonString.match(/"subject"\s*:\s*"((?:\\.|[^"\\])*)"/);
          const bod = jsonString.match(/"body"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (sub && bod) return { subject: sub[1], body: bod[1] };
        } catch {}
        try {
          let cleaned = escapeInnerQuotes(jsonString);
          return JSON.parse(cleaned);
        } catch {}
        try {
          let cleaned = jsonString
            .replace(/\r?\n/g, " ")
            .replace(/\t/g, " ")
            .replace(/,\s*}/g, "}")
            .replace(/,\s*]/g, "]")
            .replace(/"/g, '\\"')
            .replace(/\\"([a-zA-Z_]\w*)\\"/g, '"$1"')
            .replace(/\\+"/g, '"');

          const firstBrace = cleaned.indexOf("{");
          const lastBrace = cleaned.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
          }

          cleaned = cleaned.replace(/\\n/g, "\\n").replace(/\\"/g, '"');

          return JSON.parse(cleaned);
        } catch {}
        throw new Error("JSON repair failed");
      }
    }
  }
}

/**
 * ===============================
 * STRUCTURED GENERATE
 * ===============================
 */

export async function generateStructured<T>(
  prompt: string,
  schema: ZodSchema<T>,
  temperature?: number,
  clientId?: string,
  maxTokens?: number,
  modelOverride?: string,
): Promise<T> {
  return llmQueue.enqueue(async () => {
    const baseConfig = await getLLMConfig(clientId);
    const config = modelOverride ? { ...baseConfig, model: modelOverride } : baseConfig;
    logger.debug({ model: config.model, provider: config.provider, keyLen: config.apiKey.length }, "generateStructured config");
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const fullPrompt = [
          "You MUST respond with valid JSON only.",
          "No explanations.",
          "No markdown.",
          "No commentary.",
          "Do NOT invent or hallucinate data. If you don't know, use null.",
          "",
          prompt,
        ].join("\n");

        const raw = await rawCall(fullPrompt, config, temperature, maxTokens);

        let parsed: T;
        try {
          const jsonString = extractJSON(raw);
          parsed = attemptRepair(jsonString) as T;
        } catch (parseErr) {
          logger.warn({ raw: raw.slice(0, 800), error: (parseErr as Error).message }, "LLM output parse failed");
          throw parseErr;
        }

        const validated = schema.parse(parsed);

        return validated;
      } catch (err) {
        lastError = err;
        logger.warn(
          { attempt: attempt + 1, error: (err as Error).message },
          "LLM call failed",
        );
        if (attempt < MAX_RETRIES) {
          const is429 = (err as any)?.response?.status === 429 || (err as Error).message.includes("429");
          // On 429, wait a full 61s (slightly > Groq's 60s token window) to guarantee
          // all stale tokens have expired before retrying.
          const base = is429 ? 61000 : Math.pow(2, attempt) * 1000;
          const jitter = Math.round(Math.random() * 3000);
          const backoff = base + jitter;
          logger.warn({ attempt: attempt + 1, backoffMs: backoff, is429 }, "Retrying LLM call");
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }

    logger.error("LLM failed after retries");
    throw lastError;
  });
}

/**
 * ===============================
 * GET AVAILABLE MODELS
 * ===============================
 */

export function getAvailableProviders(): { id: LLMProvider; name: string }[] {
  return [
    { id: "ollama", name: "Ollama (Local)" },
    { id: "groq", name: "Groq (Fast API)" },
    { id: "openai", name: "OpenAI / Compatible" },
    { id: "anthropic", name: "Anthropic Claude" },
    { id: "cloudflare", name: "Cloudflare Workers AI" },
  ];
}

export function getModelsForProvider(provider: LLMProvider): string[] {
  switch (provider) {
    case "ollama":
      return ["llama3:8b", "llama3:70b", "mistral", "codellama", "phi3"];
    case "groq":
      return [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "mixtral-8x7b-32768",
      ];
    case "openai":
      return ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
    case "anthropic":
      return [
        "claude-3-5-sonnet-20241022",
        "claude-3-opus-20240229",
        "claude-3-haiku-20240307",
      ];
    case "cloudflare":
      return [
        "@cf/meta/llama-3.1-8b-instruct",
        "@cf/meta/llama-3-8b-instruct",
        "@cf/meta/llama-2-7b",
      ];
    default:
      return [];
  }
}

/**
 * ===============================
 * CLEAR CACHE
 * ===============================
 */

export function clearLLMCache(): void {
  cachedConfig = null;
  configExpiry = 0;
}
