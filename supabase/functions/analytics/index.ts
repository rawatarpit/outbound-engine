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
    const path = url.pathname.replace("/analytics", "");
    if (path === "/overview" || path === "/overview/") {
      if (req.method === "GET") {
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const emptyBrandList = brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ];
        const { data: leads } = await supabase.from("leads").select("status").in("brand_id", emptyBrandList);
        const { data: outreach } = await supabase.from("outreach").select("status").in("brand_id", emptyBrandList);
        const { count: sentCount } = await supabase.from("sent_messages").select("id", {
          count: "exact"
        }).in("brand_id", emptyBrandList).eq("status", "sent");
        const { count: replyCount } = await supabase.from("replies").select("id", {
          count: "exact"
        }).in("brand_id", emptyBrandList);
        const { count: bounceCount } = await supabase.from("sent_messages").select("id", {
          count: "exact"
        }).in("brand_id", emptyBrandList).eq("status", "bounced");
        const sent = sentCount || 0;
        const replied = replyCount || 0;
        const bounced = bounceCount || 0;
        const replyRate = sent > 0 ? (replied / sent * 100).toFixed(1) : "0";
        const bounceRate = sent > 0 ? (bounced / sent * 100).toFixed(1) : "0";
        const overview = {
          totalLeads: leads?.length || 0,
          newLeads: leads?.filter((l)=>l.status === "new").length || 0,
          contactedLeads: leads?.filter((l)=>l.status === "contacted").length || 0,
          qualifiedLeads: leads?.filter((l)=>l.status === "qualified").length || 0,
          totalCampaigns: outreach?.length || 0,
          activeCampaigns: outreach?.filter((c)=>c.status === "sent").length || 0,
          sentCount: sent,
          replyRate,
          bounceRate
        };
        return new Response(JSON.stringify(overview), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (path === "/activity" || path === "/activity/") {
      if (req.method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const emptyBrandList = brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ];
        const { data: recentReplies } = await supabase.from("replies").select("id, created_at, raw_message, intent").in("brand_id", emptyBrandList).order("created_at", {
          ascending: false
        }).limit(limit);
        const { data: recentSends } = await supabase.from("sent_messages").select("id, sent_at, subject").in("brand_id", emptyBrandList).order("sent_at", {
          ascending: false
        }).limit(limit);
        return new Response(JSON.stringify({
          replies: recentReplies,
          sends: recentSends
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (path === "/chart" || path === "/chart/") {
      if (req.method === "GET") {
        const days = parseInt(url.searchParams.get("days") || "7");
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const emptyBrandList = brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ];
        const { data: sends } = await supabase.from("sent_messages").select("sent_at").in("brand_id", emptyBrandList).gte("sent_at", since).eq("status", "sent");
        const { data: replies } = await supabase.from("replies").select("created_at").in("brand_id", emptyBrandList).gte("created_at", since);
        const chartData = {};
        for(let i = 0; i < days; i++){
          const date = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
          chartData[date] = {
            sent: 0,
            replied: 0
          };
        }
        sends?.forEach((s)=>{
          const date = s.sent_at?.toString().split("T")[0];
          if (date && chartData[date]) chartData[date].sent++;
        });
        replies?.forEach((r)=>{
          const date = r.created_at?.toString().split("T")[0];
          if (date && chartData[date]) chartData[date].replied++;
        });
        const result = Object.entries(chartData).map(([date, data])=>({
            date,
            ...data
          })).reverse();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (path === "/leads" || path === "/leads/") {
      if (req.method === "GET") {
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const status = url.searchParams.get("status");
        let query = supabase.from("leads").select("id, brand_id, status, full_name, email, phone, domain, company_name, lead_score, deal_value, source, created_at, contacted_at, reply_count, bounce_count").in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).order("created_at", {
          ascending: false
        }).limit(100);
        if (status) query = query.eq("status", status);
        const { data, error } = await query;
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
    }
    if (path === "/campaigns" || path === "/campaigns/") {
      if (req.method === "GET") {
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { data, error } = await supabase.from("outreach").select("id, brand_id, company_id, status, subject, content, scheduled_at, sent_at, created_at, updated_at").in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).order("created_at", {
          ascending: false
        });
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
