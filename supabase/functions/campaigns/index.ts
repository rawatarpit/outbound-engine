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
    const { supabase, member, clientId } = auth;
    if (!member.role || ![
      "owner",
      "admin"
    ].includes(member.role)) {
      return new Response(JSON.stringify({
        error: "Forbidden"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const url = new URL(req.url);
    const path = url.pathname.replace("/campaigns", "");
    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        if (brandIdList.length === 0) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        // Get outreach with company data via join
        const { data, error } = await supabase.from("outreach").select(`
          id, brand_id, company_id, client_id, status, subject, body, sent_at, created_at, updated_at,
          companies:company_id (id, name, domain)
        `).in("brand_id", brandIdList).order("created_at", {
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
        // Transform to flatten company data
        const transformed = (data || []).map((item)=>({
            ...item,
            company_name: item.companies?.name || null,
            company_domain: item.companies?.domain || null
          }));
        return new Response(JSON.stringify(transformed), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { data, error } = await supabase.from("outreach").insert({
          ...body,
          brand_id: body.brand_id || brandIdList[0],
          client_id: clientId
        }).select("id, brand_id, company_id, client_id, status, subject, created_at").single();
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
        return new Response(JSON.stringify(data), {
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
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { data, error } = await supabase.from("outreach").select("id, brand_id, company_id, client_id, status, subject, body, sent_at, created_at, updated_at").eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).single();
        if (error) return new Response(JSON.stringify({
          error: error.message
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
      if (req.method === "PATCH") {
        const body = await req.json();
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { data, error } = await supabase.from("outreach").update(body).eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).select("id, brand_id, company_id, client_id, status, subject, created_at, updated_at").single();
        if (error) return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 400,
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
      if (req.method === "DELETE") {
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { error } = await supabase.from("outreach").delete().eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]);
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
    }
    const actionMatch = path.match(/^\/([^/]+)\/(launch|pause)$/);
    if (actionMatch && req.method === "POST") {
      const id = actionMatch[1];
      const action = actionMatch[2];
      const status = action === "launch" ? "sent" : "paused";
      const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
      const brandIdList = brandIds?.map((b)=>b.id) || [];
      const { error } = await supabase.from("outreach").update({
        status,
        sent_at: action === "launch" ? new Date().toISOString() : null
      }).eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
        "00000000-0000-0000-0000-000000000000"
      ]);
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
        message: `Campaign ${action}ed`
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
