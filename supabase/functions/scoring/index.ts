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
    const { supabase, clientId } = auth;
    const path = new URL(req.url).pathname.replace("/scoring", "");
    if (path === "/" || path === "") {
      if (req.method === "POST") {
        const { product, version_name, scoring_config } = await req.json();
        if (!product || !version_name) return new Response(JSON.stringify({
          error: "product and version_name required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
        const { data: brand } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId).maybeSingle();
        const { data, error } = await supabase.from("scoring_versions").insert({
          product: product.toLowerCase(),
          version_name,
          scoring_config: scoring_config || {},
          is_active: false,
          brand_id: brand?.id || null
        }).select("id, product, version_name, scoring_config, is_active, brand_id, created_at").single();
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
          success: true,
          version: data
        }), {
          status: 201,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (path === "/activate" && req.method === "POST") {
      const { version_id } = await req.json();
      if (!version_id) return new Response(JSON.stringify({
        error: "version_id required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      const { error } = await supabase.rpc("rpc_activate_scoring_version", {
        p_version_id: version_id
      });
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
    const activeMatch = path.match(/^\/active\/(.+)$/);
    if (activeMatch && req.method === "GET") {
      const product = activeMatch[1].toLowerCase();
      const { data, error } = await supabase.from("scoring_versions").select("id, product, version_name, scoring_config, is_active, brand_id, created_at").eq("product", product).eq("is_active", true).maybeSingle();
      if (!data) return new Response(JSON.stringify({
        error: "No active version"
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
    if (path.match(/^\/[^/]+$/) && req.method === "GET") {
      const product = path.slice(1).toLowerCase();
      const { data } = await supabase.from("scoring_versions").select("id, product, version_name, scoring_config, is_active, brand_id, created_at").eq("product", product).order("created_at", {
        ascending: false
      });
      return new Response(JSON.stringify(data), {
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
