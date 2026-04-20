import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const url = new URL(req.url);
    const path = url.pathname.replace("/system", "");

    if (path === "/health" || path === "/health/") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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

    if (path === "/flags" || path === "/flags/") {
      if (req.method === "GET") {
        const { data } = await supabase
          .from("system_flags")
          .select("*")
          .eq("client_id", clientId);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const flagMatch = path.match(/^\/flags\/(.+)$/);
    if (flagMatch && req.method === "POST") {
      const { data: memberRole } = await supabase
        .from("client_members")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!memberRole || !["owner", "admin"].includes(memberRole.role)) {
        return new Response(
          JSON.stringify({ error: "Only admins can modify system flags" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const key = flagMatch[1];
      const { value } = await req.json();
      await supabase
        .from("system_flags")
        .upsert({ client_id: clientId, key, value });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "/metrics" || path === "/metrics/") {
      const { data: brandIds } = await supabase
        .from("brand_profiles")
        .select("id")
        .eq("client_id", clientId);
      const brandIdList = brandIds?.map((b) => b.id) || [];
      const emptyBrandList =
        brandIdList.length > 0
          ? brandIdList
          : ["00000000-0000-0000-0000-000000000000"];

      const { data: leads } = await supabase
        .from("leads")
        .select("id", { count: "exact" })
        .in("brand_id", emptyBrandList);
      const { data: outreach } = await supabase
        .from("outreach")
        .select("id", { count: "exact" })
        .in("brand_id", emptyBrandList);
      return new Response(
        JSON.stringify({
          leads: leads?.length || 0,
          campaigns: outreach?.length || 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
