import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // Login function - no JWT verification needed, users provide email/password
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    // Create client with anon key for user-facing auth operations
    const supabase = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    let body;
    try {
      body = await req.json();
    } catch  {
      return new Response(JSON.stringify({
        error: "Invalid JSON body"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { email, password } = body;
    if (!email || !password) {
      return new Response(JSON.stringify({
        error: "Email and password are required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Login using anon client (required for session)
    console.log("Login attempt for:", email);
    const { data: authData, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    console.log("Login result:", JSON.stringify({
      hasData: !!authData,
      loginError: loginError?.message
    }));
    if (loginError) {
      console.log("Login error:", loginError.message);
      return new Response(JSON.stringify({
        error: loginError.message
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const authSession = authData?.session;
    if (!authSession?.access_token) {
      console.log("No access token in session");
      return new Response(JSON.stringify({
        error: "Login failed - no session"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Login successful, finding member...", authSession.user.id);
    // Switch to service role client for admin queries (member lookup)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false
      }
    });
    console.log("Query 1: Looking for member with user_id =", authSession.user.id);
    let member = await adminClient.from("client_members").select("client_id, email, name, role, clients(id, name)").eq("user_id", authSession.user.id).maybeSingle();
    console.log("Query 1 result:", member);
    if (!member) {
      console.log("Query 2: Looking for member with email =", email);
      member = await adminClient.from("client_members").select("client_id, email, name, role, clients(id, name)").eq("email", email).maybeSingle();
      console.log("Query 2 result:", member);
    }
    // If still no member, check if user owns a client
    if (!member) {
      console.log("Query 3: Looking for client with owner_email =", email);
      const { data: client } = await adminClient.from("clients").select("id, name").eq("owner_email", email).maybeSingle();
      console.log("Query 3 result:", client);
      if (client) {
        member = await adminClient.from("client_members").select("client_id, email, name, role, clients(id, name)").eq("client_id", client.id).maybeSingle();
      }
    }
    console.log("Final member found:", member?.email, member?.client_id);
    return new Response(JSON.stringify({
      token: authSession.access_token,
      user: {
        id: authSession.user.id,
        email: member?.email || authSession.user.email,
        name: member?.name || authSession.user.user_metadata?.name || email.split("@")[0],
        role: member?.role || "owner",
        clientId: member?.client_id,
        clientName: member?.clients?.name
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Login error:", message);
    return new Response(JSON.stringify({
      error: message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
