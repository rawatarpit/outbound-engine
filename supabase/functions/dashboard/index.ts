import { authenticateUser } from "../_shared/auth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};
function safeBrandIds(ids) {
  return ids.length > 0 ? ids : [
    "00000000-0000-0000-0000-000000000000"
  ];
}
function daysAgoISO(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}
function todayStartISO() {
  return new Date().toISOString().split("T")[0] + "T00:00:00Z";
}
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
    const path = url.pathname.replace("/dashboard", "");
    // ─── OVERVIEW ──────────────────────────────────────────────
    if ((path === "/overview" || path === "/overview/") && req.method === "GET") {
      const { data: brandProfiles } = await supabase.from("brand_profiles").select("id, is_active, discovery_enabled, outbound_enabled, brand_name, product, discovery_daily_limit, daily_send_limit, hourly_send_limit, is_paused, deliverability_score, last_discovery_date").eq("client_id", clientId).order("created_at", {
        ascending: false
      });
      const brands = brandProfiles || [];
      const brandIds = safeBrandIds(brands.map((b)=>b.id));
      const activeBrand = brands.find((b)=>b.is_active) || brands[0];
      // ── Discovered Companies ──
      const { data: dcAll } = await supabase.from("discovered_companies").select("id, enrichment_status, rejection_reason, source, composite_score, created_at, signal_type, relevance_score, confidence, intent_score, risk").in("brand_id", brandIds);
      const companies = dcAll || [];
      const raw24h = companies.filter((c)=>new Date(c.created_at) > new Date(Date.now() - 86400000)).length;
      const approved = companies.filter((c)=>c.enrichment_status === "approved" || c.enrichment_status === "enriched").length;
      const enriched = companies.filter((c)=>c.enrichment_status === "enriched").length;
      const rejected = companies.filter((c)=>c.enrichment_status === "rejected").length;
      const pending = companies.filter((c)=>c.enrichment_status === "pending").length;
      // ── Contacts & Leads ──
      const { data: dcContacts } = await supabase.from("discovered_contacts").select("id").in("brand_id", brandIds);
      const contactsTotal = dcContacts?.length || 0;
      const { data: leadsData } = await supabase.from("leads").select("id, status, lead_score, deal_value, created_at, contacted_at, last_outcome_at, reply_count, bounce_count").in("brand_id", brandIds);
      const leadsArr = leadsData || [];
      const leadsCount = leadsArr.length;
      // ── Lead Status Breakdown ──
      const leadStatusBreakdown = {};
      leadsArr.forEach((l)=>{
        leadStatusBreakdown[l.status] = (leadStatusBreakdown[l.status] || 0) + 1;
      });
      const leadsWithReplies = leadsArr.filter((l)=>(l.reply_count || 0) > 0).length;
      const leadsWithBounces = leadsArr.filter((l)=>(l.bounce_count || 0) > 0).length;
      const leadsNew = leadsArr.filter((l)=>l.status === "new").length;
      const leadsContacted = leadsArr.filter((l)=>l.status === "contacted" || l.contacted_at).length;
      // ── Rejection Breakdown ──
      const rejectionMap = new Map();
      companies.filter((c)=>c.rejection_reason).forEach((c)=>{
        rejectionMap.set(c.rejection_reason, (rejectionMap.get(c.rejection_reason) || 0) + 1);
      });
      const rejectionBreakdown = Array.from(rejectionMap.entries()).map(([reason, count])=>({
          reason,
          count
        })).sort((a, b)=>b.count - a.count);
      // ── Source Performance ──
      const sourceMap = new Map();
      companies.filter((c)=>c.source).forEach((c)=>{
        const entry = sourceMap.get(c.source) || {
          total: 0,
          approved: 0
        };
        entry.total++;
        if (c.enrichment_status === "approved" || c.enrichment_status === "enriched") entry.approved++;
        sourceMap.set(c.source, entry);
      });
      const sourcePerformance = Array.from(sourceMap.entries()).map(([source, { total, approved }])=>({
          source,
          total,
          approved,
          approval_rate: total > 0 ? Math.round(approved / total * 100) : 0
        })).sort((a, b)=>b.total - a.total);
      // ── Score Distribution ──
      const buckets = [
        "0-20",
        "21-40",
        "41-60",
        "61-80",
        "81-100"
      ];
      const scoreBuckets = new Map(buckets.map((b)=>[
          b,
          0
        ]));
      companies.filter((c)=>c.composite_score != null).forEach((c)=>{
        const s = c.composite_score;
        let key = "0-20";
        if (s >= 81) key = "81-100";
        else if (s >= 61) key = "61-80";
        else if (s >= 41) key = "41-60";
        else if (s >= 21) key = "21-40";
        scoreBuckets.set(key, (scoreBuckets.get(key) || 0) + 1);
      });
      const scoreDistribution = buckets.map((range)=>({
          range,
          count: scoreBuckets.get(range) || 0
        })).filter((d)=>d.count > 0);
      // ── Signal Type Distribution ──
      const signalMap = new Map();
      companies.filter((c)=>c.signal_type).forEach((c)=>{
        signalMap.set(c.signal_type, (signalMap.get(c.signal_type) || 0) + 1);
      });
      const signalDistribution = Array.from(signalMap.entries()).map(([name, value])=>({
          name,
          value
        })).sort((a, b)=>b.value - a.value);
      // ── Risk Distribution ──
      const riskMap = new Map();
      companies.filter((c)=>c.risk).forEach((c)=>{
        riskMap.set(c.risk, (riskMap.get(c.risk) || 0) + 1);
      });
      const riskDistribution = Array.from(riskMap.entries()).map(([name, value])=>({
          name,
          value
        }));
      // ── Pipeline (Companies) ──
      const { data: companiesPipe } = await supabase.from("companies").select("status, estimated_value, deal_value, created_at, industry, source").in("brand_id", brandIds);
      const cp = companiesPipe || [];
      const pipelineStages = {
        researching: 0,
        qualified: 0,
        draft_ready: 0,
        contacted: 0,
        replied: 0,
        closed_won: 0,
        closed_lost: 0
      };
      cp.forEach((c)=>{
        if (c.status in pipelineStages) pipelineStages[c.status]++;
      });
      const wonRevenue = cp.filter((c)=>c.status === "closed_won").reduce((sum, c)=>sum + (c.estimated_value || c.deal_value || 0), 0);
      // Industry breakdown
      const industryMap = new Map();
      cp.filter((c)=>c.industry).forEach((c)=>{
        industryMap.set(c.industry, (industryMap.get(c.industry) || 0) + 1);
      });
      const industryBreakdown = Array.from(industryMap.entries()).map(([industry, count])=>({
          industry,
          count
        })).sort((a, b)=>b.count - a.count).slice(0, 8);
      // ── Send Health ──
      const today = todayStartISO();
      const sevenDaysAgo = daysAgoISO(7);
      const fourteenDaysAgo = daysAgoISO(14);
      const { data: sentMessages } = await supabase.from("sent_messages").select("id, status, opened_at, bounced_at, replied_at, created_at, to_email, from_email").in("brand_id", brandIds).gte("created_at", today);
      const sm = sentMessages || [];
      const sentToday = sm.length;
      const deliveredToday = sm.filter((m)=>m.status === "delivered").length;
      const openedToday = sm.filter((m)=>m.opened_at !== null).length;
      const bouncedToday = sm.filter((m)=>m.bounced_at !== null).length;
      const repliedToday = sm.filter((m)=>m.replied_at !== null).length;
      const sentThisHour = sm.filter((m)=>{
        const h = new Date(m.created_at).getHours();
        return h === new Date().getHours();
      }).length;
      // 14-day trend
      const { data: last14 } = await supabase.from("sent_messages").select("id, status, opened_at, bounced_at, replied_at, created_at").in("brand_id", brandIds).gte("created_at", fourteenDaysAgo);
      const last14Days = {};
      for(let i = 13; i >= 0; i--){
        const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
        last14Days[d] = {
          sent: 0,
          delivered: 0,
          opened: 0,
          bounced: 0,
          replied: 0
        };
      }
      (last14 || []).forEach((m)=>{
        const d = m.created_at?.split("T")[0];
        if (d && last14Days[d]) {
          last14Days[d].sent++;
          if (m.status === "delivered") last14Days[d].delivered++;
          if (m.opened_at) last14Days[d].opened++;
          if (m.bounced_at) last14Days[d].bounced++;
          if (m.replied_at) last14Days[d].replied++;
        }
      });
      const sendTrend14 = Object.entries(last14Days).map(([date, vals])=>({
          date,
          ...vals
        }));
      // ── Bounce by Domain ──
      const bounceDomainMap = new Map();
      sm.filter((m)=>m.bounced_at !== null && m.to_email).forEach((m)=>{
        const domain = m.to_email.split("@")[1] || "unknown";
        bounceDomainMap.set(domain, (bounceDomainMap.get(domain) || 0) + 1);
      });
      const bounceByDomain = Array.from(bounceDomainMap.entries()).map(([domain, count])=>({
          domain,
          count
        })).sort((a, b)=>b.count - a.count).slice(0, 10);
      // ── Lead Conversion Trends (14 days) ──
      const leadTrend14 = {};
      for(let i = 13; i >= 0; i--){
        const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
        leadTrend14[d] = {
          created: 0,
          contacted: 0
        };
      }
      leadsArr.forEach((l)=>{
        const cd = l.created_at?.split("T")[0];
        if (cd && leadTrend14[cd]) leadTrend14[cd].created++;
        const cod = l.contacted_at?.split("T")[0];
        if (cod && leadTrend14[cod]) leadTrend14[cod].contacted++;
      });
      const leadTrend = Object.entries(leadTrend14).map(([date, vals])=>({
          date,
          ...vals
        }));
      // ── Worker Status ──
      const discoveryEnabled = brands.some((b)=>b.discovery_enabled);
      const outboundEnabled = brands.some((b)=>b.outbound_enabled);
      const { data: systemFlags } = await supabase.from("system_flags").select("automation_enabled, send_enabled, imap_enabled, discovery_enabled, discovery_circuit_breaker, enrichment_circuit_breaker, send_circuit_breaker, reply_circuit_breaker").eq("client_id", clientId).maybeSingle();
      const flags = systemFlags || {};
      // ── Activity Feed ──
      const { data: activities } = await supabase.from("activity_logs").select("id, client_id, brand_id, activity_type, description, entity_type, entity_id, metadata, created_at").eq("client_id", clientId).order("created_at", {
        ascending: false
      }).limit(20);
      // ── Dead Letters ──
      const { data: deadLetters } = await supabase.from("dead_letters").select("id, entity_type, resolved").eq("client_id", clientId);
      const dlArr = deadLetters || [];
      const deadLettersByType = {};
      dlArr.forEach((dl)=>{
        deadLettersByType[dl.entity_type] = (deadLettersByType[dl.entity_type] || 0) + 1;
      });
      const deadLetterCount = dlArr.length;
      const unresolvedDeadLetters = dlArr.filter((dl)=>!dl.resolved).length;
      // ── Suppression / Blacklist ──
      const { data: suppressions } = await supabase.from("suppression_list").select("id", {
        count: "exact"
      }).eq("client_id", clientId);
      const suppressionCount = suppressions?.length || 0;
      const { data: blacklisted } = await supabase.from("blacklist").select("id", {
        count: "exact"
      }).eq("client_id", clientId);
      const blacklistCount = blacklisted?.length || 0;
      // ── Sending Domains ──
      const { data: sendDomains } = await supabase.from("sending_domains").select("domain, daily_limit, sent_today, is_active, bounce_count, total_sent, disabled_reason, verified, dns_verified").in("brand_id", brandIds);
      const sdArr = sendDomains || [];
      const sendingDomainHealth = sdArr.map((sd)=>({
          domain: sd.domain,
          daily_limit: sd.daily_limit,
          sent_today: sd.sent_today,
          is_active: sd.is_active,
          bounce_count: sd.bounce_count,
          total_sent: sd.total_sent,
          disabled_reason: sd.disabled_reason
        }));
      const activeDomains = sdArr.filter((sd)=>sd.is_active).length;
      const disabledDomains = sdArr.filter((sd)=>!sd.is_active).length;
      // ── Team Stats ──
      const { data: teamMembers } = await supabase.from("client_members").select("id, role, is_active, last_login_at, created_at").eq("client_id", clientId);
      const tmArr = teamMembers || [];
      const teamStats = {
        total: tmArr.length,
        active: tmArr.filter((m)=>m.is_active).length,
        admins: tmArr.filter((m)=>m.role === "admin" || m.role === "owner").length,
        members: tmArr.filter((m)=>m.role === "member").length,
        recent_joins: tmArr.filter((m)=>new Date(m.created_at) > new Date(daysAgoISO(7))).length
      };
      // ── Campaign Analytics ──
      const { data: campaignAnalytics } = await supabase.from("campaign_analytics").select("campaign_name, sent_count, delivered_count, opened_count, replied_count, bounced_count, date, brand_id").in("brand_id", brandIds).gte("date", sevenDaysAgo.split("T")[0]);
      const caArr = campaignAnalytics || [];
      const campaignSummary = {
        total_campaigns: [
          ...new Set(caArr.map((c)=>c.campaign_name).filter(Boolean))
        ].length,
        total_sent: caArr.reduce((s, c)=>s + (c.sent_count || 0), 0),
        total_delivered: caArr.reduce((s, c)=>s + (c.delivered_count || 0), 0),
        total_opened: caArr.reduce((s, c)=>s + (c.opened_count || 0), 0),
        total_replied: caArr.reduce((s, c)=>s + (c.replied_count || 0), 0),
        total_bounced: caArr.reduce((s, c)=>s + (c.bounced_count || 0), 0)
      };
      // ── Discovery Metrics ──
      const { data: discMetrics } = await supabase.from("discovery_metrics").select("id, executed_at, success, companies_discovered, contacts_discovered, brand_id").gte("executed_at", sevenDaysAgo).order("executed_at", {
        ascending: false
      });
      const dmArr = discMetrics || [];
      const discoveryRuns = dmArr.length;
      const discoverySuccesses = dmArr.filter((m)=>m.success).length;
      const totalCompaniesDiscovered = dmArr.reduce((s, m)=>s + (m.companies_discovered || 0), 0);
      const totalContactsDiscovered = dmArr.reduce((s, m)=>s + (m.contacts_discovered || 0), 0);
      // ── Recent Replies ──
      const { data: recentReplies } = await supabase.from("replies").select("id, sentiment, intent, meeting_requested, objection_detected, created_at, summary").in("brand_id", brandIds).order("created_at", {
        ascending: false
      }).limit(10);
      const replyArr = recentReplies || [];
      const repliesToday = replyArr.filter((r)=>new Date(r.created_at) > new Date(Date.now() - 86400000)).length;
      const positiveReplies = replyArr.filter((r)=>r.sentiment === "positive" || r.sentiment === "interested").length;
      const meetingsRequested = replyArr.filter((r)=>r.meeting_requested).length;
      // ── Circuit Breaker States ──
      const { data: cbStates } = await supabase.from("circuit_breaker_state").select("entity_type, state, failure_count, last_failure_reason, reset_at").eq("client_id", clientId);
      const cbArr = cbStates || [];
      const circuitBreakers = cbArr.map((cb)=>({
          entity_type: cb.entity_type,
          state: cb.state,
          failure_count: cb.failure_count,
          last_failure_reason: cb.last_failure_reason,
          reset_at: cb.reset_at
        }));
      const openBreakers = cbArr.filter((cb)=>cb.state === "open").length;
      // ── Avg Scores ──
      const scored = companies.filter((c)=>c.composite_score != null);
      const avgCompositeScore = scored.length > 0 ? Math.round(scored.reduce((s, c)=>s + c.composite_score, 0) / scored.length) : null;
      const scoredLeads = leadsArr.filter((l)=>l.lead_score != null);
      const avgLeadScore = scoredLeads.length > 0 ? Math.round(scoredLeads.reduce((s, l)=>s + l.lead_score, 0) / scoredLeads.length) : null;
      // ── Brand Performance Comparison ──
      const brandPerformance = await Promise.all(brands.slice(0, 10).map(async (b)=>{
        const bid = b.id;
        const { count: bCompanies } = await supabase.from("companies").select("id", {
          count: "exact",
          head: true
        }).eq("brand_id", bid);
        const { count: bLeads } = await supabase.from("leads").select("id", {
          count: "exact",
          head: true
        }).eq("brand_id", bid);
        const { count: bSent } = await supabase.from("sent_messages").select("id", {
          count: "exact",
          head: true
        }).eq("brand_id", bid);
        return {
          id: b.id,
          name: b.brand_name || b.product,
          is_active: b.is_active,
          companies: bCompanies || 0,
          leads: bLeads || 0,
          sent: bSent || 0,
          discovery_enabled: b.discovery_enabled,
          outbound_enabled: b.outbound_enabled
        };
      }));
      // ── Avg deal value ──
      const leadsWithDealValue = leadsArr.filter((l)=>l.deal_value != null && l.deal_value > 0);
      const avgDealValue = leadsWithDealValue.length > 0 ? Math.round(leadsWithDealValue.reduce((s, l)=>s + l.deal_value, 0) / leadsWithDealValue.length) : null;
      // ── Response: Build the full payload ──
      const payload = {
        brand: activeBrand ? {
          id: activeBrand.id,
          name: activeBrand.brand_name || activeBrand.product,
          discovery_daily_limit: activeBrand.discovery_daily_limit || 100,
          daily_send_limit: activeBrand.daily_send_limit || 50,
          hourly_send_limit: activeBrand.hourly_send_limit || 20,
          discovery_enabled: activeBrand.discovery_enabled,
          outbound_enabled: activeBrand.outbound_enabled,
          is_paused: activeBrand.is_paused,
          deliverability_score: activeBrand.deliverability_score
        } : null,
        funnel: {
          raw_24h: raw24h,
          pending,
          approved,
          enriched,
          rejected,
          contacts: contactsTotal,
          leads: leadsCount,
          stages: [
            {
              name: "Raw",
              count: raw24h + pending,
              dropToNext: "Approved",
              dropRate: raw24h + pending > 0 ? Math.round(approved / Math.max(raw24h + pending, 1) * 100) : 0
            },
            {
              name: "Approved",
              count: approved,
              dropToNext: "Enriched",
              dropRate: approved > 0 ? Math.round(enriched / Math.max(approved, 1) * 100) : 0
            },
            {
              name: "Enriched",
              count: enriched,
              dropToNext: "Contacts",
              dropRate: enriched > 0 ? Math.round(contactsTotal / Math.max(enriched, 1) * 100) : 0
            },
            {
              name: "Contacts",
              count: contactsTotal,
              dropToNext: "Leads",
              dropRate: contactsTotal > 0 ? Math.round(leadsCount / Math.max(contactsTotal, 1) * 100) : 0
            },
            {
              name: "Leads",
              count: leadsCount,
              dropToNext: null,
              dropRate: null
            }
          ]
        },
        pipeline: {
          stages: pipelineStages,
          total: Object.values(pipelineStages).reduce((a, b)=>a + b, 0),
          won_revenue: wonRevenue
        },
        send_health: {
          sent_today: sentToday,
          delivered_today: deliveredToday,
          opened_today: openedToday,
          bounced_today: bouncedToday,
          replied_today: repliedToday,
          daily: {
            used: sentToday,
            limit: activeBrand?.daily_send_limit || 50
          },
          hourly: {
            used: sentThisHour,
            limit: activeBrand?.hourly_send_limit || 20
          },
          last_7_days: sendTrend14.slice(-7),
          last_14_days: sendTrend14,
          deliverability_score: sentToday > 0 ? Math.round(deliveredToday / sentToday * 100) : null
        },
        leads: {
          total: leadsCount,
          new: leadsNew,
          contacted: leadsContacted,
          with_replies: leadsWithReplies,
          with_bounces: leadsWithBounces,
          status_breakdown: leadStatusBreakdown,
          avg_lead_score: avgLeadScore,
          avg_deal_value: avgDealValue,
          trend_14d: leadTrend
        },
        team: teamStats,
        campaign_summary: campaignSummary,
        discovery: {
          runs: discoveryRuns,
          successes: discoverySuccesses,
          companies_discovered: totalCompaniesDiscovered,
          contacts_discovered: totalContactsDiscovered,
          success_rate: discoveryRuns > 0 ? Math.round(discoverySuccesses / discoveryRuns * 100) : null
        },
        replies: {
          total: replyArr.length,
          today: repliesToday,
          positive: positiveReplies,
          meetings_requested: meetingsRequested,
          recent: replyArr.slice(0, 5).map((r)=>({
              id: r.id,
              sentiment: r.sentiment,
              intent: r.intent,
              meeting_requested: r.meeting_requested,
              summary: r.summary,
              created_at: r.created_at
            }))
        },
        dead_letters: {
          total: deadLetterCount,
          unresolved: unresolvedDeadLetters,
          by_type: deadLettersByType
        },
        suppression: {
          suppressed: suppressionCount,
          blacklisted: blacklistCount
        },
        sending_domains: {
          domains: sendingDomainHealth,
          active: activeDomains,
          disabled: disabledDomains
        },
        circuit_breakers: {
          total: cbArr.length,
          open: openBreakers,
          items: circuitBreakers
        },
        brand_performance: brandPerformance,
        rejection_breakdown: rejectionBreakdown,
        source_performance: sourcePerformance,
        score_distribution: scoreDistribution,
        signal_distribution: signalDistribution,
        risk_distribution: riskDistribution,
        industry_breakdown: industryBreakdown,
        avg_composite_score: avgCompositeScore,
        bounce_by_domain: bounceByDomain,
        workers: {
          discovery: {
            status: discoveryEnabled ? "running" : "idle",
            last_run: activeBrand?.last_discovery_date,
            circuit_breaker: flags.discovery_circuit_breaker || false,
            pending: pending
          },
          enrichment: {
            status: pending > 0 ? "running" : "idle",
            pending,
            circuit_breaker: flags.enrichment_circuit_breaker || false
          },
          send: {
            status: outboundEnabled ? "running" : "paused",
            reason: outboundEnabled ? null : "disabled",
            circuit_breaker: flags.send_circuit_breaker || false
          },
          reply: {
            status: flags.imap_enabled ? "running" : "idle",
            circuit_breaker: flags.reply_circuit_breaker || false
          }
        },
        activity_feed: activities || []
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // ─── TOGGLE ─────────────────────────────────────────────
    const brandIdMatch = path.match(/^\/([^/]+)\/toggle$/);
    if (brandIdMatch && (req.method === "PATCH" || req.method === "PUT")) {
      const brandId = brandIdMatch[1];
      const body = await req.json();
      const { data: brand } = await supabase.from("brand_profiles").select("id, brand_name, product, discovery_enabled, outbound_enabled, is_paused").eq("id", brandId).eq("client_id", clientId).single();
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
      const updates = {
        updated_at: new Date().toISOString()
      };
      if (body.discovery !== undefined) {
        updates.discovery_enabled = body.discovery;
        if (body.discovery) updates.manual_discovery_requested = true;
        await supabase.from("activity_logs").insert({
          client_id: clientId,
          brand_id: brandId,
          activity_type: body.discovery ? "discovery_enabled" : "discovery_disabled",
          description: `Discovery ${body.discovery ? "enabled" : "disabled"} for ${brand.brand_name || brand.product}`
        });
      }
      if (body.outbound !== undefined) {
        updates.outbound_enabled = body.outbound;
        updates.execution_state = body.outbound ? "running" : "idle";
        await supabase.from("activity_logs").insert({
          client_id: clientId,
          brand_id: brandId,
          activity_type: body.outbound ? "outbound_enabled" : "outbound_disabled",
          description: `Email automation ${body.outbound ? "enabled" : "disabled"} for ${brand.brand_name || brand.product}`
        });
      }
      const { data: updatedBrand, error } = await supabase.from("brand_profiles").update(updates).eq("id", brandId).select("id, brand_name, product, discovery_enabled, outbound_enabled, is_paused, execution_state, updated_at").single();
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
        brand: updatedBrand
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
