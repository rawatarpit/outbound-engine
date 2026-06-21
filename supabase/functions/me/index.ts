import { authenticateUser } from "../_shared/auth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
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
    const { supabase, member, clientId } = auth;
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
    const { data: client, error: clientError } = await supabase.from("clients").select("id, name, slug, owner_email, owner_name, created_at, updated_at, plan, is_active, is_paused, subscription_status, stripe_customer_id, logo_url, website, phone, daily_send_limit, hourly_send_limit, leads_limit, contacts_limit").eq("id", clientId).maybeSingle();
    if (clientError) {
      return new Response(JSON.stringify({
        error: "Client query failed: " + clientError.message,
        code: clientError.code
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!client) {
      return new Response(JSON.stringify({
        error: "Client not found for id: " + clientId
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      client,
      member
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
