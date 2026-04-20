import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

    const clientId = member.client_id;
    const url = new URL(req.url);
    const path = url.pathname.replace("/workers", "");

    // GET /workers/status - Get worker status
    if (path === "/status" || path === "/status/") {
      if (req.method === "GET") {
        const { data: brandProfiles } = await supabase
          .from("brand_profiles")
          .select("id, brand_name, product, discovery_enabled, outbound_enabled, execution_state")
          .eq("client_id", clientId);

        const workers = (brandProfiles || []).map((brand) => ({
          brand_id: brand.id,
          brand_name: brand.brand_name || brand.product,
          discovery: {
            is_running: brand.discovery_enabled || false,
            is_paused: !brand.discovery_enabled,
            last_run: brand.last_discovery_run_at,
          },
          outbound: {
            is_running: brand.outbound_enabled || false,
            is_paused: !brand.outbound_enabled,
            state: brand.execution_state,
          },
        }));

        return new Response(JSON.stringify({ workers }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // GET /workers/metrics - Get worker metrics
    if (path === "/metrics" || path === "/metrics/") {
      if (req.method === "GET") {
        const brandId = url.searchParams.get("brand_id") || url.searchParams.get("client_id");

        let query = supabase
          .from("brand_profiles")
          .select("id, brand_name, product, discovery_count_today, sent_count")
          .eq("client_id", clientId);

        if (brandId) {
          query = query.eq("id", brandId);
        }

        const { data: brands } = await query;

        const metrics = (brands || []).map((brand) => ({
          brand_id: brand.id,
          brand_name: brand.brand_name || brand.product,
          discovery_count_today: brand.discovery_count_today || 0,
          sent_count: brand.sent_count || 0,
        }));

        return new Response(JSON.stringify({ metrics }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // POST /workers/{workerName}/trigger - Trigger a worker
    const triggerMatch = path.match(/^\/([^/]+)\/trigger$/);
    if (triggerMatch && req.method === "POST") {
      const workerName = triggerMatch[1];

      // Only allow triggering discovery
      if (workerName === "discovery") {
        const { data: brands } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId)
          .limit(1);

        if (brands && brands.length > 0) {
          await supabase
            .from("brand_profiles")
            .update({
              manual_discovery_requested: true,
              discovery_enabled: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", brands[0].id);
        }

        return new Response(
          JSON.stringify({ success: true, worker: workerName, action: "triggered" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ error: "Unknown worker" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /workers/{workerName}/pause - Pause a worker
    const pauseMatch = path.match(/^\/([^/]+)\/pause$/);
    if (pauseMatch && req.method === "POST") {
      const workerName = pauseMatch[1];

      const updates: Record<string, unknown> = {};
      if (workerName === "discovery") {
        updates.discovery_enabled = false;
      } else if (workerName === "outbound" || workerName === "send") {
        updates.outbound_enabled = false;
        updates.execution_state = "paused";
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("brand_profiles")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("client_id", clientId);
      }

      return new Response(
        JSON.stringify({ success: true, worker: workerName, action: "paused" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // POST /workers/{workerName}/resume - Resume a worker
    const resumeMatch = path.match(/^\/([^/]+)\/resume$/);
    if (resumeMatch && req.method === "POST") {
      const workerName = resumeMatch[1];

      const updates: Record<string, unknown> = {};
      if (workerName === "discovery") {
        updates.discovery_enabled = true;
        updates.manual_discovery_requested = true;
      } else if (workerName === "outbound" || workerName === "send") {
        updates.outbound_enabled = true;
        updates.execution_state = "running";
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("brand_profiles")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("client_id", clientId);
      }

      return new Response(
        JSON.stringify({ success: true, worker: workerName, action: "resumed" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});