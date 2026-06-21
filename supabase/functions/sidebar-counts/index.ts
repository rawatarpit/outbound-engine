import { authenticateUser } from "../_shared/auth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const auth = await authenticateUser(req);
    if (auth.error) {
      return new Response(JSON.stringify({
        error: auth.error
      }), {
        status: auth.status || 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { supabase, clientId } = auth;
    if (!clientId) {
      return new Response(JSON.stringify({
        error: "No client ID associated"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const [leadsRes, pipelineRes, outreachRes] = await Promise.all([
      supabase.from("leads").select("id", {
        count: "exact",
        head: true
      }).eq("client_id", clientId),
      supabase.from("leads").select("id", {
        count: "exact",
        head: true
      }).eq("client_id", clientId).not("status", "eq", "new"),
      supabase.from("outreach").select("id", {
        count: "exact",
        head: true
      }).eq("client_id", clientId)
    ]);
    const data = {
      leads: leadsRes.count ?? 0,
      pipeline: pipelineRes.count ?? 0,
      outreach: outreachRes.count ?? 0
    };
    return new Response(JSON.stringify({
      data
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: "Internal error: " + (error instanceof Error ? error.message : String(error))
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
