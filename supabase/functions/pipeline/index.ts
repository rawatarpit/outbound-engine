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
    const path = url.pathname.replace("/pipeline", "");

    const brandIdMatch = path.match(/^\/([^/]+)/);
    const brandId = brandIdMatch ? brandIdMatch[1] : null;

    if (!brandId) {
      if (path === "/overview" || path === "/overview/") {
        const { data: brands } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId);

        const brandIds = brands?.map((b) => b.id) || [];

        if (brandIds.length === 0) {
          return new Response(JSON.stringify({ stages: [] }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: companies } = await supabase
          .from("companies")
          .select("status")
          .in("brand_id", brandIds);

        const stages = {
          researching:
            companies?.filter((c) => c.status === "researching").length || 0,
          qualified:
            companies?.filter((c) => c.status === "qualified").length || 0,
          draft_ready:
            companies?.filter((c) => c.status === "draft_ready").length || 0,
          contacted:
            companies?.filter((c) => c.status === "contacted").length || 0,
        };

        return new Response(JSON.stringify({ stages }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Brand ID required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        const status = url.searchParams.get("status");
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const offset = (page - 1) * limit;

        let query = supabase
          .from("companies")
          .select("*", { count: "exact" })
          .eq("brand_id", brandId)
          .range(offset, offset + limit - 1)
          .order("created_at", { ascending: false });

        if (status) {
          query = query.eq("status", status);
        }

        const { data: companies, error, count } = await query;

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({
            companies,
            total: count,
            totalPages: Math.ceil((count || 0) / limit),
            page,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const companyIdMatch = remainingPath.match(/^\/([^/]+)/);
    if (companyIdMatch) {
      const companyId = companyIdMatch[1];
      const companyPath = remainingPath.replace(/^\/[^/]+/, "");

      if (companyPath === "" || companyPath === "/") {
        if (req.method === "GET") {
          const { data, error } = await supabase
            .from("companies")
            .select("*")
            .eq("id", companyId)
            .eq("brand_id", brandId)
            .single();

          if (error) {
            return new Response(
              JSON.stringify({ error: "Company not found" }),
              {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }

          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (req.method === "PATCH" || req.method === "PUT") {
          const body = await req.json();

          const allowedStatuses = [
            "researching",
            "qualified",
            "draft_ready",
            "contacted",
            "closed_won",
            "rejected",
            "negotiating",
          ];

          if (body.status && !allowedStatuses.includes(body.status)) {
            return new Response(
              JSON.stringify({ error: "Invalid status value" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }

          if (body.status && allowedStatuses.includes(body.status)) {
            const { data: member } = await supabase
              .from("client_members")
              .select("role")
              .eq("user_id", user.id)
              .maybeSingle();

            if (!member || !["owner", "admin"].includes(member.role)) {
              return new Response(
                JSON.stringify({
                  error: "Only admins can manually change status",
                }),
                {
                  status: 403,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }
          }

          const { data, error } = await supabase
            .from("companies")
            .update({
              ...body,
              updated_at: new Date().toISOString(),
            })
            .eq("id", companyId)
            .eq("brand_id", brandId)
            .select()
            .single();

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(
            JSON.stringify({ success: true, company: data }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      if (companyPath === "/outreach" || companyPath === "/outreach/") {
        if (req.method === "GET") {
          const { data, error } = await supabase
            .from("outreach")
            .select("*")
            .eq("company_id", companyId)
            .eq("brand_id", brandId)
            .order("created_at", { ascending: false });

          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ outreach: data }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
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
