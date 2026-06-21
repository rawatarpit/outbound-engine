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
    const url = new URL(req.url);
    const path = url.pathname.replace("/webhooks", "");
    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const { data, error } = await supabase.from("client_webhooks").select("id, client_id, name, url, events, is_active, created_at, last_triggered_at").eq("client_id", clientId);
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const { data, error } = await supabase.from("client_webhooks").insert({
          ...body,
          client_id: clientId
        }).select("id, client_id, name, url, secret, events, is_active, created_at").single();
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) {
      const id = idMatch[1];
      if (req.method === "GET") {
        const { data, error } = await supabase.from("client_webhooks").select("id, client_id, name, url, secret, events, is_active, created_at, updated_at, last_triggered_at").eq("id", id).single();
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "PATCH") {
        const body = await req.json();
        const { data, error } = await supabase.from("client_webhooks").update(body).eq("id", id).select("id, client_id, name, url, events, is_active, updated_at").single();
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "DELETE") {
        const { error } = await supabase.from("client_webhooks").delete().eq("id", id);
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
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
    }
    if (path.match(/^\/([^/]+)\/test$/) && req.method === "POST") {
      const id = path.match(/^\/([^/]+)\/test$/)[1];
      const { data: webhook, error: webhookError } = await supabase.from("client_webhooks").select("id, client_id, name, url, secret, events, is_active").eq("id", id).eq("client_id", clientId).single();
      if (webhookError || !webhook) {
        return new Response(JSON.stringify({
          error: "Webhook not found"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const testPayload = {
        event: "test",
        timestamp: new Date().toISOString(),
        message: "This is a test webhook payload"
      };
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(()=>controller.abort(), 10000);
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": webhook.secret || ""
          },
          body: JSON.stringify(testPayload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const responseBody = await response.text().catch(()=>"Unable to read response body");
        return new Response(JSON.stringify({
          success: response.ok,
          statusCode: response.status,
          message: response.ok ? "Webhook test successful" : `Webhook test failed with status ${response.status}`,
          responseBody: responseBody.slice(0, 500)
        }), {
          status: response.ok ? 200 : 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          message: "Webhook test failed",
          error: error.message || "Unknown error"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
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
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
