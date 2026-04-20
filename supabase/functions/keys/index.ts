import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: member } = await supabase.from("client_members").select("*, clients!inner(name)").eq("user_id", user.id).maybeSingle();
    if (!member || !member.client_id) {
      return new Response(JSON.stringify({ error: "No client associated" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const clientId = member.client_id;
    const path = new URL(req.url).pathname.replace("/keys", "");

    if (path === "/" || path === "") {
      if (req.method === "GET") {
        const { data } = await supabase.from("client_api_keys").select("*").eq("client_id", clientId);
        return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (req.method === "POST") {
        const { name } = await req.json();
        const keyValue = crypto.randomUUID() + "-" + crypto.randomUUID();
        const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyValue)).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""));
        const { data } = await supabase.from("client_api_keys").insert({ client_id: clientId, name: name || "API Key", key_hash: keyHash }).select().single();
        return new Response(JSON.stringify({ ...data, raw_key: keyValue }), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (path.match(/^\/([^/]+)$/) && req.method === "DELETE") {
      const id = path.split("/")[1];
      await supabase.from("client_api_keys").delete().eq("id", id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});