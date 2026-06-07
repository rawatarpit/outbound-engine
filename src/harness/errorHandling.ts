import pino from "pino";

const logger = pino({ level: "info" });

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  backoffFactor: 2,
};

export function isNonRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("400") || err.message.includes("401");
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (isNonRetryable(err)) throw err;
      if (attempt < config.maxAttempts) {
        const delay = config.baseDelayMs * Math.pow(config.backoffFactor, attempt - 1);
        const jitter = Math.round(Math.random() * 1000);
        logger.warn({ attempt, delayMs: delay + jitter }, "Retrying operation");
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }
  }

  throw lastError!;
}

export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  onFallback?: (err: Error) => void,
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    onFallback?.(err as Error);
    return await fallback();
  }
}

export function getErrorSuggestion(toolName: string): string {
  const suggestions: Record<string, string> = {
    scrape_website: "The website may be down or blocking requests. Try again later or skip this company.",
    search_web: "Try a different search query or check network connectivity.",
    query_database: "Check the query syntax or verify the database connection.",
    generate_llm: "The LLM returned invalid output. The model may need a clearer prompt or different temperature.",
  };
  return suggestions[toolName] || "Try an alternative approach or skip this item.";
}

export function structuredError(params: {
  tool: string;
  message: string;
  input?: unknown;
}): string {
  return JSON.stringify({
    error: true,
    message: params.message,
    tool: params.tool,
    input: params.input,
    suggestion: getErrorSuggestion(params.tool),
  });
}
