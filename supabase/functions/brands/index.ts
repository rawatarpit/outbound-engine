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
        status: auth.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { supabase, clientId } = auth;
    const url = new URL(req.url);
    const path = url.pathname.replace("/brands", "");
    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const { data, error } = await supabase.from("brand_profiles").select("id, client_id, brand_name, product, created_at, updated_at, is_active, is_paused, discovery_enabled, outbound_enabled, transport_mode, provider, sending_domain, daily_send_limit, hourly_send_limit, discovery_daily_limit, deliverability_score").eq("client_id", clientId).order("created_at", {
          ascending: false
        });
        if (error) {
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
        return new Response(JSON.stringify({
          brands: data
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "POST") {
        const body = await req.json();
        if (body.transport_mode === "mailbox" && !body.smtp_email) {
          return new Response(JSON.stringify({
            error: "SMTP email is required for mailbox transport mode"
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        if (body.provider === "resend" && !body.provider_api_key) {
          return new Response(JSON.stringify({
            error: "API key is required for Resend provider"
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        const { data, error } = await supabase.from("brand_profiles").insert({
          ...body,
          client_id: clientId,
          discovery_enabled: body.discovery_enabled ?? false,
          outbound_enabled: body.outbound_enabled ?? false,
          manual_discovery_requested: false
        }).select("id, client_id, brand_name, product, created_at, updated_at, is_active, is_paused, discovery_enabled, outbound_enabled, transport_mode, provider, provider_api_key, smtp_email, sending_domain, daily_send_limit, hourly_send_limit, discovery_daily_limit, deliverability_score").single();
        if (error) {
          return new Response(JSON.stringify({
            error: error.message
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        return new Response(JSON.stringify({
          success: true,
          brand: data
        }), {
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
        const { data, error } = await supabase.from("brand_profiles").select("id, client_id, brand_name, product, created_at, updated_at, is_active, is_paused, discovery_enabled, outbound_enabled, transport_mode, provider, provider_api_key, smtp_email, smtp_host, smtp_port, smtp_password, sending_domain, daily_send_limit, hourly_send_limit, discovery_daily_limit, deliverability_score").eq("id", id).eq("client_id", clientId).single();
        if (error) {
          return new Response(JSON.stringify({
            error: "Brand not found"
          }), {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "PATCH" || req.method === "PUT") {
        const body = await req.json();
        if (body.discovery_enabled !== undefined || body.outbound_enabled !== undefined) {
          let { data: flag } = await supabase.from("system_flags").select("value").eq("key", "automation_enabled").eq("client_id", clientId).maybeSingle();
          if (!flag) {
            await supabase.from("system_flags").insert([
              {
                client_id: clientId,
                key: "automation_enabled",
                value: "true"
              },
              {
                client_id: clientId,
                key: "send_enabled",
                value: "true"
              },
              {
                client_id: clientId,
                key: "imap_enabled",
                value: "false"
              },
              {
                client_id: clientId,
                key: "discovery_enabled",
                value: "true"
              }
            ]);
            flag = {
              value: "true"
            };
          }
          if (flag?.value === "false" && (body.discovery_enabled || body.outbound_enabled)) {
            return new Response(JSON.stringify({
              error: "Automation is disabled. Enable it in Settings > System Flags first."
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            });
          }
        }
        const { data, error } = await supabase.from("brand_profiles").update({
          ...body,
          updated_at: new Date().toISOString()
        }).eq("id", id).eq("client_id", clientId).select("id, client_id, brand_name, product, created_at, updated_at, is_active, is_paused, discovery_enabled, outbound_enabled, transport_mode, provider, sending_domain, daily_send_limit, hourly_send_limit, discovery_daily_limit, deliverability_score").single();
        if (error) {
          return new Response(JSON.stringify({
            error: error.message
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        return new Response(JSON.stringify({
          success: true,
          brand: data
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "DELETE") {
        const { error } = await supabase.from("brand_profiles").delete().eq("id", id).eq("client_id", clientId);
        if (error) {
          return new Response(JSON.stringify({
            error: error.message
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
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
    const triggerMatch = path.match(/^\/([^/]+)\/trigger-discovery$/);
    if (triggerMatch && req.method === "POST") {
      const brandId = triggerMatch[1];
      const { data: brand } = await supabase.from("brand_profiles").select("id, discovery_enabled").eq("id", brandId).eq("client_id", clientId).single();
      if (!brand) {
        return new Response(JSON.stringify({
          error: "Brand not found"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (!brand.discovery_enabled) {
        return new Response(JSON.stringify({
          error: "Discovery is not enabled for this brand"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { error } = await supabase.rpc("rpc_request_manual_discovery", {
        p_brand_id: brandId
      });
      if (error) {
        return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        success: true,
        message: "Discovery triggered"
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
