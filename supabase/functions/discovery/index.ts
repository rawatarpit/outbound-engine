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

    const clientId = member.client_id;
    const url = new URL(req.url);
    const path = url.pathname.replace("/discovery", "");

    const brandIdMatch = path.match(/^\/([^/]+)/);
    const brandId = brandIdMatch ? brandIdMatch[1] : null;

    if (brandId) {
      const { data: brand } = await supabase
        .from("brand_profiles")
        .select("id")
        .eq("id", brandId)
        .eq("client_id", clientId)
        .maybeSingle();

      if (!brand) {
        return new Response(
          JSON.stringify({ error: "Brand not found or access denied" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const remainingPath = path.replace(/^\/[^/]+/, "");

      if (remainingPath === "" || remainingPath === "/") {
        if (req.method === "GET") {
          const { data, error } = await supabase
            .from("brand_discovery_sources")
            .select("*")
            .eq("brand_id", brandId)
            .order("created_at", { ascending: false });

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ sources: data }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (req.method === "POST") {
          const body = await req.json();
          const { data, error } = await supabase
            .from("brand_discovery_sources")
            .insert({
              ...body,
              brand_id: brandId,
              client_id: clientId,
            })
            .select()
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ success: true, source: data }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const sourceIdMatch = remainingPath.match(/^\/([^/]+)$/);
      if (sourceIdMatch) {
        const sourceId = sourceIdMatch[1];

        if (req.method === "GET") {
          const { data, error } = await supabase
            .from("brand_discovery_sources")
            .select("*")
            .eq("id", sourceId)
            .eq("brand_id", brandId)
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: "Source not found" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (req.method === "PATCH" || req.method === "PUT") {
          const body = await req.json();
          const { data, error } = await supabase
            .from("brand_discovery_sources")
            .update(body)
            .eq("id", sourceId)
            .eq("brand_id", brandId)
            .select()
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ success: true, source: data }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (req.method === "DELETE") {
          const { error } = await supabase
            .from("brand_discovery_sources")
            .delete()
            .eq("id", sourceId)
            .eq("brand_id", brandId);

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      if (remainingPath === "/trigger" && req.method === "POST") {
        const { data: flags } = await supabase
          .from("system_flags")
          .select("automation_enabled")
          .eq("client_id", clientId)
          .maybeSingle();

        if (!flags?.automation_enabled) {
          return new Response(
            JSON.stringify({ error: "Automation is disabled system-wide" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        const { error } = await supabase.rpc("rpc_request_manual_discovery", {
          p_brand_id: brandId,
        });

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ success: true, message: "Discovery triggered" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (remainingPath === "/companies" && req.method === "GET") {
        const { data, error } = await supabase
          .from("discovered_companies")
          .select("*")
          .eq("brand_id", brandId)
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ companies: data }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (remainingPath === "/contacts" && req.method === "GET") {
        const { data, error } = await supabase
          .from("discovered_contacts")
          .select("*")
          .eq("brand_id", brandId)
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ contacts: data }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
