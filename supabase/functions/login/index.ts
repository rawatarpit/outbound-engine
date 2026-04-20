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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    // Create client with anon key but pass the JWT for RLS
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, password } = body;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Login using anon client (required for session)
    console.log("Login attempt for:", email);
    const { data, session, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log("Login result:", JSON.stringify({ hasSession: !!session, hasData: !!data, loginError: loginError?.message }));
    
    if (loginError) {
      console.log("Login error:", loginError.message);
      return new Response(JSON.stringify({ error: loginError.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // session might be in data.session
    const authSession = session || data?.session;
    
    if (!authSession?.access_token) {
      console.log("No access token in session or data");
      console.log("data:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "Login failed - no session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Login successful, finding member...", authSession.user.id);

    // Find member using anon client with the session JWT
    console.log("Query 1: Looking for member with user_id =", authSession.user.id);
    let member = await supabase
      .from("client_members")
      .select("*, clients!inner(name)")
      .eq("user_id", authSession.user.id)
      .maybeSingle();

    console.log("Query 1 result:", member);

    if (!member) {
      console.log("Query 2: Looking for member with email =", email);
      member = await supabase
        .from("client_members")
        .select("*, clients!inner(name)")
        .eq("email", email)
        .maybeSingle();
      console.log("Query 2 result:", member);
    }

    // If still no member, check if user owns a client
    if (!member) {
      console.log("Query 3: Looking for client with owner_email =", email);
      const { data: client } = await supabase
        .from("clients")
        .select("id, name")
        .eq("owner_email", email)
        .maybeSingle();
      console.log("Query 3 result:", client);
      
      if (client) {
        member = await supabase
          .from("client_members")
          .select("*, clients!inner(name)")
          .eq("client_id", client.id)
          .maybeSingle();
      }
    }

    console.log("Final member found:", member?.email, member?.client_id);

    return new Response(
      JSON.stringify({
        token: authSession.access_token,
        user: {
          id: authSession.user.id,
          email: member?.email || authSession.user.email,
          name: member?.name || authSession.user.user_metadata?.name || email.split("@")[0],
          role: member?.role || "owner",
          clientId: member?.client_id,
          clientName: member?.clients?.name,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Login error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});