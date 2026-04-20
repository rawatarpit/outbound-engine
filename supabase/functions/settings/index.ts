import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const LLM_PROVIDERS = {
  ollama: {
    models: [
      "llama3:8b",
      "llama3:70b",
      "mixtral:8x7b",
      "codellama:7b",
      "mistral:7b",
    ],
  },
  groq: {
    models: [
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
  },
  openai: { models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"] },
  anthropic: {
    models: [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
    ],
  },
  cloudflare: {
    models: [
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/meta/llama-3-8b-instruct",
      "@cf/meta/llama-2-7b-chat-int8",
    ],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: member } = await supabase
      .from("client_members")
      .select("*, clients!inner(name)")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member || !member.client_id) {
      return new Response(JSON.stringify({ error: "No client associated" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/settings", "");

    if ((path === "/" || path === "") && req.method === "GET") {
      const { data: settings } = await supabase
        .from("client_settings")
        .select("*")
        .eq("client_id", member.client_id)
        .maybeSingle();

      return new Response(
        JSON.stringify(
          settings || {
            llm_provider: "ollama",
            llm_model: "llama3:8b",
          },
        ),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (
      (path === "/" || path === "") &&
      (req.method === "PUT" || req.method === "PATCH")
    ) {
      const body = await req.json();
      const { data, error } = await supabase
        .from("client_settings")
        .upsert({
          client_id: member.client_id,
          ...body,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, settings: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "/llm/providers" && req.method === "GET") {
      return new Response(
        JSON.stringify({ providers: Object.keys(LLM_PROVIDERS) }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (path === "/llm/models" && req.method === "GET") {
      const provider = url.searchParams.get("provider");
      if (!provider || !LLM_PROVIDERS[provider as keyof typeof LLM_PROVIDERS]) {
        return new Response(JSON.stringify({ error: "Invalid provider" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          provider,
          models: LLM_PROVIDERS[provider as keyof typeof LLM_PROVIDERS].models,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (path === "/llm" || path === "/llm/") {
      if (req.method === "GET") {
        const { data: settings } = await supabase
          .from("client_settings")
          .select("*")
          .eq("client_id", member.client_id)
          .maybeSingle();
        return new Response(
          JSON.stringify(
            settings || { llm_provider: "ollama", llm_model: "llama3:8b" },
          ),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (req.method === "PUT") {
        const body = await req.json();
        const { data, error } = await supabase
          .from("client_settings")
          .upsert({ client_id: member.client_id, ...body })
          .select()
          .single();
        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        return new Response(JSON.stringify({ success: true, settings: data }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/email" || path === "/email/") {
      if (req.method === "GET") {
        const { data: settings, error } = await supabase
          .from("client_settings")
          .select(
            "smtp_host, smtp_port, smtp_secure, smtp_email, smtp_from_name, smtp_from_email, imap_host, imap_port, imap_secure, imap_email, email_provider, provider_api_key, sending_domain, imap_enabled",
          )
          .eq("client_id", member.client_id)
          .maybeSingle();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(settings || {}), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (req.method === "PUT" || req.method === "PATCH") {
        const body = await req.json();

        const allowedFields = [
          "smtp_host",
          "smtp_port",
          "smtp_secure",
          "smtp_email",
          "smtp_password",
          "smtp_from_name",
          "smtp_from_email",
          "imap_host",
          "imap_port",
          "imap_secure",
          "imap_email",
          "imap_password",
          "email_provider",
          "provider_api_key",
          "sending_domain",
          "imap_enabled",
        ];

        const filteredBody: Record<string, unknown> = {};
        for (const key of allowedFields) {
          if (body[key] !== undefined) {
            filteredBody[key] = body[key];
          }
        }

        const { data, error } = await supabase
          .from("client_settings")
          .upsert({
            client_id: member.client_id,
            ...filteredBody,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true, settings: data }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
