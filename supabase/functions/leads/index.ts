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
    const path = url.pathname.replace("/leads", "");
    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const status = url.searchParams.get("status");
        const search = url.searchParams.get("search");
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "25");
        const offset = (page - 1) * limit;
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        let query = supabase.from("leads").select("id, brand_id, client_id, status, full_name, email, phone, domain, company_name, lead_score, deal_value, source, created_at, contacted_at, last_outcome_at, reply_count, bounce_count", {
          count: "exact"
        }).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).range(offset, offset + limit - 1).order("created_at", {
          ascending: false
        });
        if (status) {
          query = query.eq("status", status);
        }
        if (search) {
          query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,domain.ilike.%${search}%`);
        }
        const { data, error, count } = await query;
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
          leads: data,
          total: count,
          totalPages: Math.ceil((count || 0) / limit),
          page
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
        const { data: defaultBrand } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId).limit(1).maybeSingle();
        const brandId = body.brand_id || defaultBrand?.id;
        if (!brandId) {
          return new Response(JSON.stringify({
            error: "No brand found for client. Create a brand first."
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        const { data, error } = await supabase.from("leads").insert({
          ...body,
          client_id: clientId,
          brand_id: brandId
        }).select("id, brand_id, client_id, status, full_name, email, phone, domain, company_name, lead_score, deal_value, source, created_at").single();
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
        return new Response(JSON.stringify(data), {
          status: 201,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (path === "/import" && req.method === "POST") {
      const body = await req.json();
      const leads = body.leads || [];
      const inserts = leads.map((lead)=>({
          ...lead,
          client_id: clientId,
          source: "import"
        }));
      const { data, error } = await supabase.from("leads").insert(inserts).select("id, brand_id, client_id, status, full_name, email, phone, domain, company_name, lead_score, deal_value, source, created_at");
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
        imported: data?.length || 0,
        leads: data
      }), {
        status: 201,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) {
      const id = idMatch[1];
      if (req.method === "GET") {
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { data, error } = await supabase.from("leads").select("id, brand_id, client_id, status, full_name, email, phone, domain, company_name, lead_score, deal_value, source, created_at, contacted_at, last_outcome_at, reply_count, bounce_count, notes, custom_fields").eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).single();
        if (error) {
          return new Response(JSON.stringify({
            error: error.message
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
      if (req.method === "PATCH") {
        const body = await req.json();
        const { data: brandIds } = await supabase.from("brand_profiles").select("id").eq("client_id", clientId);
        const brandIdList = brandIds?.map((b)=>b.id) || [];
        const { data, error } = await supabase.from("leads").update(body).eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]).select("id, brand_id, client_id, status, full_name, email, phone, domain, company_name, lead_score, deal_value, source, created_at, contacted_at").single();
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
        const { error } = await supabase.from("leads").delete().eq("id", id).in("brand_id", brandIdList.length > 0 ? brandIdList : [
          "00000000-0000-0000-0000-000000000000"
        ]);
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
