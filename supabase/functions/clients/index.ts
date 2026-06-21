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
    const { supabase, user, member, clientId } = auth;
    const authContext = {
      userId: member.id,
      email: member.email,
      role: member.role,
      clientId
    };
    const url = new URL(req.url);
    const path = url.pathname.replace("/clients", "");
    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const { data, error } = await supabase.from("clients").select("id, name, slug, owner_email, owner_name, created_at, updated_at, plan, is_active, is_paused, subscription_status, stripe_customer_id, logo_url, website, phone, daily_send_limit, hourly_send_limit, leads_limit, contacts_limit").eq("id", authContext.clientId).single();
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
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "POST") {
        if (authContext.clientId) {
          return new Response(JSON.stringify({
            error: "Client already exists"
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        const body = await req.json();
        const clientSlug = authContext.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
        const { data: client, error } = await supabase.from("clients").insert({
          name: body.name,
          slug: `${clientSlug}-${Date.now()}`,
          owner_email: authContext.email,
          owner_name: body.owner_name || authContext.email.split("@")[0]
        }).select("id, name, slug, owner_email, owner_name, created_at, updated_at").single();
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
        if (client) {
          await supabase.from("client_members").update({
            client_id: client.id
          }).eq("id", authContext.userId);
        }
        return new Response(JSON.stringify(client), {
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
        if (!authContext.clientId || id !== authContext.clientId) {
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
        const { data, error } = await supabase.from("clients").select("id, name, slug, owner_email, owner_name, created_at, updated_at, plan, is_active, is_paused, subscription_status, stripe_customer_id, logo_url, website, phone, daily_send_limit, hourly_send_limit, leads_limit, contacts_limit").eq("id", id).single();
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
        if (!authContext.clientId || id !== authContext.clientId) {
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
        const body = await req.json();
        const { data, error } = await supabase.from("clients").update(body).eq("id", id).select("id, name, slug, owner_email, owner_name, created_at, updated_at").single();
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
