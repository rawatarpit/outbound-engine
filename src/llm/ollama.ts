import axios from "axios";
import pino from "pino";
import { ZodSchema } from "zod";
import { getClientLLMSettings } from "../db/supabase";

const logger = pino({ level: "info" });

const MAX_RETRIES = 2;
const TIMEOUT_MS = 30000;

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

  const response = await axios.post(
    url,
    {
      model: "llama-3.1-70b-versatile",
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
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object detected in model output");
  }
  return match[0];
}

/**
 * ===============================
 * JSON REPAIR ATTEMPT
 * ===============================
 */

function attemptRepair(jsonString: string): unknown {
  try {
    return JSON.parse(jsonString);
  } catch {
    try {
      const cleaned = jsonString.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      return JSON.parse(cleaned);
    } catch {
      throw new Error("JSON repair failed");
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
): Promise<T> {
  const config = await getLLMConfig(clientId);
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const fullPrompt = `
You MUST respond with valid JSON only.
No explanations.
No markdown.
No commentary.

${prompt}
`;

      const raw = await rawCall(fullPrompt, config, temperature, maxTokens);

      const jsonString = extractJSON(raw);
      const parsed = attemptRepair(jsonString) as T;

      const validated = schema.parse(parsed);

      return validated;
    } catch (err) {
      lastError = err;
      logger.warn(
        { attempt: attempt + 1, error: (err as Error).message },
        "LLM call failed",
      );
    }
  }

  logger.error("LLM failed after retries");
  throw lastError;
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
        "llama-3.1-70b-versatile",
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
