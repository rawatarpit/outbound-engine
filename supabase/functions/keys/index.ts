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
    const { supabase, clientId } = auth;
    const path = new URL(req.url).pathname.replace("/keys", "");
    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const { data } = await supabase.from("client_api_keys").select("id, client_id, name, created_at, last_used_at").eq("client_id", clientId);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (req.method === "POST") {
        const { name } = await req.json();
        const keyValue = crypto.randomUUID() + "-" + crypto.randomUUID();
        const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyValue)).then((buf)=>Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join(""));
        const { data } = await supabase.from("client_api_keys").insert({
          client_id: clientId,
          name: name || "API Key",
          key_hash: keyHash
        }).select("id, client_id, name, created_at").single();
        return new Response(JSON.stringify({
          ...data,
          raw_key: keyValue
        }), {
          status: 201,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (path.match(/^\/([^/]+)$/) && req.method === "DELETE") {
      const id = path.split("/")[1];
      const { error } = await supabase.from("client_api_keys").delete().eq("id", id);
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
        success: true
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
  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
