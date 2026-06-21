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
    const path = url.pathname.replace("/discovery", "");
    const brandIdMatch = path.match(/^\/([^/]+)/);
    const brandId = brandIdMatch ? brandIdMatch[1] : null;
    if (brandId) {
      const { data: brand } = await supabase.from("brand_profiles").select("id").eq("id", brandId).eq("client_id", clientId).maybeSingle();
      if (!brand) {
        return new Response(JSON.stringify({
          error: "Brand not found or access denied"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const remainingPath = path.replace(/^\/[^/]+/, "");
      if (remainingPath === "" || remainingPath === "/") {
        if (req.method === "GET") {
          const { data, error } = await supabase.from("brand_discovery_sources").select("id, brand_id, client_id, name, source_type, config, is_active, created_at, updated_at, last_run_at").eq("brand_id", brandId).order("created_at", {
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
            sources: data
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
          const { data, error } = await supabase.from("brand_discovery_sources").insert({
            ...body,
            brand_id: brandId,
            client_id: clientId
          }).select("id, brand_id, client_id, name, source_type, config, is_active, created_at").single();
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
            source: data
          }), {
            status: 201,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
      }
      const sourceIdMatch = remainingPath.match(/^\/([^/]+)$/);
      if (sourceIdMatch) {
        const sourceId = sourceIdMatch[1];
        if (req.method === "GET") {
          const { data, error } = await supabase.from("brand_discovery_sources").select("id, brand_id, client_id, name, source_type, config, is_active, created_at, updated_at, last_run_at").eq("id", sourceId).eq("brand_id", brandId).single();
          if (error) {
            return new Response(JSON.stringify({
              error: "Source not found"
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
          const { data, error } = await supabase.from("brand_discovery_sources").update(body).eq("id", sourceId).eq("brand_id", brandId).select("id, brand_id, client_id, name, source_type, config, is_active, created_at, updated_at").single();
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
            source: data
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        if (req.method === "DELETE") {
          const { error } = await supabase.from("brand_discovery_sources").delete().eq("id", sourceId).eq("brand_id", brandId);
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
      if (remainingPath === "/trigger" && req.method === "POST") {
        const { data: flags } = await supabase.from("system_flags").select("automation_enabled").eq("client_id", clientId).maybeSingle();
        if (!flags?.automation_enabled) {
          return new Response(JSON.stringify({
            error: "Automation is disabled system-wide"
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
      if (remainingPath === "/companies" && req.method === "GET") {
        const { data, error } = await supabase.from("discovered_companies").select("id, brand_id, name, domain, website, enrichment_status, source, composite_score, confidence, relevance_score, intent_score, risk, signal_type, rejection_reason, created_at, enrichment_attempts").eq("brand_id", brandId).order("created_at", {
          ascending: false
        }).limit(100);
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
          companies: data
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (remainingPath === "/contacts" && req.method === "GET") {
        const { data, error } = await supabase.from("discovered_contacts").select("id, brand_id, company_id, full_name, email, phone, job_title, linkedin_url, source, enrichment_status, created_at").eq("brand_id", brandId).order("created_at", {
          ascending: false
        }).limit(100);
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
          contacts: data
        }), {
          status: 200,
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
