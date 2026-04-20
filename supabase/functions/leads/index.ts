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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    const path = url.pathname.replace("/leads", "");

    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const status = url.searchParams.get("status");
        const search = url.searchParams.get("search");
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "25");
        const offset = (page - 1) * limit;

        const { data: brandIds } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId);

        const brandIdList = brandIds?.map((b) => b.id) || [];

        let query = supabase
          .from("leads")
          .select("*", { count: "exact" })
          .in(
            "brand_id",
            brandIdList.length > 0
              ? brandIdList
              : ["00000000-0000-0000-0000-000000000000"],
          )
          .range(offset, offset + limit - 1)
          .order("created_at", { ascending: false });

        if (status) {
          query = query.eq("status", status);
        }

        if (search) {
          query = query.or(
            `full_name.ilike.%${search}%,email.ilike.%${search}%,domain.ilike.%${search}%`,
          );
        }

        const { data, error, count } = await query;

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({
            leads: data,
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

      if (req.method === "POST") {
        const body = await req.json();

        const { data: defaultBrand } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId)
          .limit(1)
          .maybeSingle();

        const brandId = body.brand_id || defaultBrand?.id;
        if (!brandId) {
          return new Response(
            JSON.stringify({
              error: "No brand found for client. Create a brand first.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        const { data, error } = await supabase
          .from("leads")
          .insert({ ...body, client_id: clientId, brand_id: brandId })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/import" && req.method === "POST") {
      const body = await req.json();
      const leads = body.leads || [];

      const inserts = leads.map((lead: any) => ({
        ...lead,
        client_id: clientId,
        source: "import",
      }));

      const { data, error } = await supabase
        .from("leads")
        .insert(inserts)
        .select();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ imported: data?.length || 0, leads: data }),
        {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) {
      const id = idMatch[1];

      if (req.method === "GET") {
        const { data: brandIds } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId);

        const brandIdList = brandIds?.map((b) => b.id) || [];

        const { data, error } = await supabase
          .from("leads")
          .select("*")
          .eq("id", id)
          .in(
            "brand_id",
            brandIdList.length > 0
              ? brandIdList
              : ["00000000-0000-0000-0000-000000000000"],
          )
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (req.method === "PATCH") {
        const body = await req.json();
        const { data: brandIds } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId);

        const brandIdList = brandIds?.map((b) => b.id) || [];

        const { data, error } = await supabase
          .from("leads")
          .update(body)
          .eq("id", id)
          .in(
            "brand_id",
            brandIdList.length > 0
              ? brandIdList
              : ["00000000-0000-0000-0000-000000000000"],
          )
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (req.method === "DELETE") {
        const { data: brandIds } = await supabase
          .from("brand_profiles")
          .select("id")
          .eq("client_id", clientId);

        const brandIdList = brandIds?.map((b) => b.id) || [];

        const { error } = await supabase
          .from("leads")
          .delete()
          .eq("id", id)
          .in(
            "brand_id",
            brandIdList.length > 0
              ? brandIdList
              : ["00000000-0000-0000-0000-000000000000"],
          );

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
