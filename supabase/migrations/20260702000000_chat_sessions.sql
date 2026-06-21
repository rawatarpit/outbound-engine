CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_brand_id ON public.chat_sessions(brand_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON public.chat_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.brand_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brand_profiles(id) ON DELETE CASCADE,
  client_id UUID,
  summary TEXT NOT NULL,
  search_queries TEXT[] NOT NULL DEFAULT '{}',
  leads_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_campaigns_brand_id ON public.brand_campaigns(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_campaigns_created_at ON public.brand_campaigns(created_at DESC);
