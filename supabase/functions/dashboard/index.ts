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
    const path = url.pathname.replace("/dashboard", "");

    // GET /dashboard/overview - Returns comprehensive dashboard stats
    if (path === "/overview" || path === "/overview/") {
      if (req.method === "GET") {
        // Get brand profiles for this client
        const { data: brandProfiles } = await supabase
          .from("brand_profiles")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false });

        const brands = brandProfiles || [];
        const brandIds = brands.map((b) => b.id);

        // If no brands, return empty stats
        if (brandIds.length === 0) {
          return new Response(
            JSON.stringify({
              discovery_enabled: false,
              outbound_enabled: false,
              brand: null,
              discovery_stats: {
                companies_total: 0,
                companies_pending: 0,
                contacts_total: 0,
                contacts_pending: 0,
              },
              send_stats: {
                sent_today: 0,
                delivered: 0,
                opened: 0,
                bounced: 0,
                daily_limit: 0,
                hourly_limit: 0,
              },
              pipeline: {
                researching: 0,
                qualified: 0,
                draft_ready: 0,
                contacted: 0,
                closed_won: 0,
              },
              workers: {
                discovery: { status: "idle", last_run: null },
                enrichment: { status: "idle", pending: 0 },
                send: { status: "idle", reason: null },
                reply: { status: "idle" },
              },
              activity_feed: [],
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Get first active brand for overview
        const activeBrand = brands.find((b) => b.is_active) || brands[0];
        const brandId = activeBrand.id;

        // Discovery stats - discovered_companies and discovered_contacts
        const emptyBrandList = ["00000000-0000-0000-0000-000000000000"];
        const { data: discoveredCompanies } = await supabase
          .from("discovered_companies")
          .select("id, enrichment_status")
          .in("brand_id", brandIds.length > 0 ? brandIds : emptyBrandList);

        const { data: discoveredContacts } = await supabase
          .from("discovered_contacts")
          .select("id")
          .in("brand_id", brandIds.length > 0 ? brandIds : emptyBrandList);

        const companiesTotal = discoveredCompanies?.length || 0;
        const companiesPending = discoveredCompanies?.filter(
          (c) => c.enrichment_status === "pending",
        ).length || 0;
        const contactsTotal = discoveredContacts?.length || 0;

        // Send stats - sent_messages
        const today = new Date().toISOString().split("T")[0];
        const { data: sentMessages } = await supabase
          .from("sent_messages")
          .select("id, status, opened_at, bounced")
          .in("brand_id", brandIds.length > 0 ? brandIds : emptyBrandList)
          .gte("created_at", `${today}T00:00:00Z`);

        const sentToday = sentMessages?.length || 0;
        const delivered = sentMessages?.filter(
          (m) => m.status === "delivered",
        ).length || 0;
        const opened = sentMessages?.filter((m) => m.opened_at !== null).length || 0;
        const bounced = sentMessages?.filter((m) => m.bounced).length || 0;

        // Pipeline stages - companies table
        const { data: companies } = await supabase
          .from("companies")
          .select("status")
          .in("brand_id", brandIds.length > 0 ? brandIds : emptyBrandList);

        const pipelineStages = {
          researching: companies?.filter((c) => c.status === "researching").length || 0,
          qualified: companies?.filter((c) => c.status === "qualified").length || 0,
          draft_ready: companies?.filter((c) => c.status === "draft_ready").length || 0,
          contacted: companies?.filter((c) => c.status === "contacted").length || 0,
          closed_won: companies?.filter((c) => c.status === "closed_won").length || 0,
        };

        // Worker status - check brand flags
        const discoveryEnabled = brands.some((b) => b.discovery_enabled);
        const outboundEnabled = brands.some((b) => b.outbound_enabled);

        // Get system flags for additional worker status
        const { data: systemFlags } = await supabase
          .from("system_flags")
          .select("*")
          .eq("client_id", clientId)
          .maybeSingle();

        // Activity feed - recent 20 activities
        const { data: activities } = await supabase
          .from("activity_logs")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(20);

        // Get enrichment pending count
        const { data: enrichmentPending } = await supabase
          .from("discovered_companies")
          .select("id", { count: "exact" })
          .in("brand_id", brandIds.length > 0 ? brandIds : emptyBrandList)
          .eq("enrichment_status", "pending");

        return new Response(
          JSON.stringify({
            discovery_enabled: discoveryEnabled,
            outbound_enabled: outboundEnabled,
            brand: {
              id: activeBrand.id,
              name: activeBrand.brand_name || activeBrand.product,
              discovery_daily_limit: activeBrand.discovery_daily_limit || 100,
              discovery_count_today: companiesTotal,
              daily_send_limit: activeBrand.daily_send_limit || 50,
              sent_today: sentToday,
            },
            discovery_stats: {
              companies_total: companiesTotal,
              companies_pending: companiesPending,
              contacts_total: contactsTotal,
              contacts_pending: 0,
            },
            send_stats: {
              sent_today: sentToday,
              delivered,
              opened,
              bounced,
              daily_limit: activeBrand.daily_send_limit || 50,
              hourly_limit: activeBrand.hourly_send_limit || 20,
            },
            pipeline: pipelineStages,
            workers: {
              discovery: {
                status: discoveryEnabled ? "running" : "idle",
                last_run: activeBrand.last_discovery_run_at,
              },
              enrichment: {
                status: enrichmentPending && enrichmentPending.length > 0 ? "running" : "idle",
                pending: enrichmentPending?.length || 0,
              },
              send: {
                status: outboundEnabled ? "running" : "paused",
                reason: outboundEnabled ? null : "disabled",
              },
              reply: {
                status: systemFlags?.imap_enabled ? "running" : "idle",
              },
            },
            activity_feed: activities || [],
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // PATCH /dashboard/{brandId}/toggle - Toggle discovery/outbound workers
    const brandIdMatch = path.match(/^\/([^/]+)\/toggle$/);
    if (brandIdMatch && (req.method === "PATCH" || req.method === "PUT")) {
      const brandId = brandIdMatch[1];
      const body = await req.json();

      // Verify brand belongs to client
      const { data: brand } = await supabase
        .from("brand_profiles")
        .select("*")
        .eq("id", brandId)
        .eq("client_id", clientId)
        .single();

      if (!brand) {
        return new Response(
          JSON.stringify({ error: "Brand not found or access denied" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Check permissions - only owner/admin can toggle
      if (body.discovery_enabled !== undefined || body.outbound_enabled !== undefined) {
        const { data: memberRole } = await supabase
          .from("client_members")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!memberRole || !["owner", "admin"].includes(memberRole.role)) {
          return new Response(
            JSON.stringify({ error: "Only admins can toggle workers" }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>;

      // Handle discovery toggle
      if (body.discovery !== undefined) {
        updates.discovery_enabled = body.discovery;
        if (body.discovery) {
          updates.manual_discovery_requested = true;
        }
        // Log activity
        await supabase.from("activity_logs").insert({
          client_id: clientId,
          brand_id: brandId,
          user_id: user.id,
          activity_type: body.discovery ? "discovery_enabled" : "discovery_disabled",
          description: `Discovery ${body.discovery ? "enabled" : "disabled"} for ${brand.brand_name || brand.product}`,
        });
      }

      // Handle outbound toggle
      if (body.outbound !== undefined) {
        updates.outbound_enabled = body.outbound;
        updates.execution_state = body.outbound ? "running" : "idle";
        // Log activity
        await supabase.from("activity_logs").insert({
          client_id: clientId,
          brand_id: brandId,
          user_id: user.id,
          activity_type: body.outbound ? "outbound_enabled" : "outbound_disabled",
          description: `Email automation ${body.outbound ? "enabled" : "disabled"} for ${brand.brand_name || brand.product}`,
        });
      }

      const { data: updatedBrand, error } = await supabase
        .from("brand_profiles")
        .update(updates)
        .eq("id", brandId)
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          brand: updatedBrand,
          toggles: {
            discovery: body.discovery,
            outbound: body.outbound,
          },
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
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});