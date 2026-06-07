import { supabase } from "../../db/supabase"

const envCache: Record<string, string | undefined> = {}

function env(key: string): string | undefined {
  if (!(key in envCache)) {
    envCache[key] = process.env[key]
  }
  return envCache[key]
}

export async function getApiKey(keyName: string, clientId?: string): Promise<string | null> {
  if (clientId) {
    try {
      const { data, error } = await supabase
        .from("client_settings")
        .select("config")
        .eq("client_id", clientId)
        .maybeSingle()

      if (!error && data?.config && typeof data.config === "object") {
        const config = data.config as Record<string, unknown>
        const val = config[keyName]
        if (val && typeof val === "string" && val.length > 0) {
          return val
        }
      }
    } catch { /* fall through to env */ }
  }

  const envVar = keyName.toUpperCase()
  return env(envVar) || env(`REACT_APP_${envVar}`) || null
}

export async function getGithubToken(clientId?: string): Promise<string | null> {
  return getApiKey("github_token", clientId)
}

export async function getSearxngUrl(clientId?: string): Promise<string> {
  return getApiKey("searxng_url", clientId) || env("SEARXNG_URL") || "http://localhost:8080"
}

export async function getRedditUserAgent(clientId?: string): Promise<string> {
  return getApiKey("reddit_user_agent", clientId) || env("REDDIT_USER_AGENT") || "outbound-engine:v2.0 (by /u/opencode)"
}

export async function getLLMApiKey(clientId?: string): Promise<string | null> {
  if (clientId) {
    try {
      const { data, error } = await supabase
        .from("client_settings")
        .select("llm_api_key")
        .eq("client_id", clientId)
        .maybeSingle()

      if (!error && data?.llm_api_key) {
        return data.llm_api_key
      }
    } catch { /* fall through */ }
  }
  return env("LLM_API_KEY") || null
}

export async function getLLMBaseUrl(clientId?: string): Promise<string | null> {
  if (clientId) {
    try {
      const { data, error } = await supabase
        .from("client_settings")
        .select("llm_base_url, llm_api_key")
        .eq("client_id", clientId)
        .maybeSingle()

      if (!error && data?.llm_base_url) {
        return data.llm_base_url
      }
    } catch { /* fall through */ }
  }
  return env("LLM_BASE_URL") || null
}

export async function getLLMModel(clientId?: string): Promise<string | null> {
  if (clientId) {
    try {
      const { data, error } = await supabase
        .from("client_settings")
        .select("llm_model")
        .eq("client_id", clientId)
        .maybeSingle()

      if (!error && data?.llm_model) {
        return data.llm_model
      }
    } catch { /* fall through */ }
  }
  return env("LLM_MODEL") || null
}
