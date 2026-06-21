import { authenticateUser } from "../_shared/auth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/system", "");
    if (path === "/health" || path === "/health/") {
      return new Response(JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const auth = await authenticateUser(req);
    if (auth.error) {
      return new Response(JSON.stringify({
        error: auth.error
      }), {
        status: auth.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { supabase, member, clientId } = auth;
    if (path === "/flags" || path === "/flags/") {
      if (req.method === "GET") {
        const { data } = await supabase.from("system_flags").select("client_id, key, value, automation_enabled, send_enabled, imap_enabled, discovery_enabled, discovery_circuit_breaker, enrichment_circuit_breaker, send_circuit_breaker, reply_circuit_breaker").eq("client_id", clientId).maybeSingle();
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    const flagMatch = path.match(/^\/flags\/(.+)$/);
    if (flagMatch && req.method === "POST") {
      if (!member.role || ![
        "owner",
        "admin"
      ].includes(member.role)) {
        return new Response(JSON.stringify({
          error: "Only admins can modify system flags"
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const key = flagMatch[1];
      const { value } = await req.json();
      await supabase.from("system_flags").upsert({
        client_id: clientId,
        key,
        value
      });
      return new Response(JSON.stringify({
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (path === "/metrics" || path === "/metrics/") {
      const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
      const brandIdList = brandIds?.map((b)=>b.id) || [];
      const emptyBrandList = brandIdList.length > 0 ? brandIdList : [
        "00000000-0000-0000-0000-000000000000"
      ];
      const { data: leads } = await supabase.from("leads").select("id", {
        count: "exact"
      }).in("brand_id", emptyBrandList);
      const { data: outreach } = await supabase.from("outreach").select("id", {
        count: "exact"
      }).in("brand_id", emptyBrandList);
      return new Response(JSON.stringify({
        leads: leads?.length || 0,
        campaigns: outreach?.length || 0
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      error: "Not found"
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
