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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, email, password, name, company } = body;

    if (action === "logout") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Signup
    if (action === "signup") {
      // Create auth user
      const { data: authUser, error: authError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

      if (authError) {
        return new Response(JSON.stringify({ error: authError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = authUser.user.id;
      
      // Create client using the same ID
      const clientSlug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      const clientName = company || email.split("@")[0];

      const { data: client, error: clientError } = await supabase
        .from("clients")
        .insert({
          id: userId,
          name: clientName,
          slug: `${clientSlug}-${Date.now()}`,
          owner_email: email,
          owner_name: name || email.split("@")[0],
        })
        .select()
        .single();

      if (clientError) {
        return new Response(JSON.stringify({ error: "Failed to create client: " + clientError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create member
      const { error: memberError } = await supabase
        .from("client_members")
        .insert({
          client_id: userId,
          email,
          name: name || email.split("@")[0],
          role: "owner",
          user_id: userId,
        });

      if (memberError) {
        return new Response(JSON.stringify({ error: "Failed to create member: " + memberError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Return success - user can now log in normally
      return new Response(
        JSON.stringify({
          success: true,
          userCreated: true,
          email: email,
          message: "Account created! Please log in.",
        }),
        {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Login
    console.log("Login attempt for:", email);
    const { data: session, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log("Login result:", session, "error:", loginError);

    if (loginError) {
      console.log("Login error:", loginError.message);
      return new Response(JSON.stringify({ error: loginError.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!session?.access_token) {
      console.log("No session/access_token in result");
      return new Response(JSON.stringify({ error: "Login failed - no session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Login success, token:", session.access_token.substring(0, 20) + "...");

    // Find member
    let member = await supabase
      .from("client_members")
      .select("*, clients!inner(name)")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!member) {
      member = await supabase
        .from("client_members")
        .select("*, clients!inner(name)")
        .eq("email", email)
        .maybeSingle();
    }

    return new Response(
      JSON.stringify({
        token: session.access_token,
        user: {
          id: session.user.id,
          email: member?.email || session.user.email,
          name: member?.name || session.user.user_metadata?.name || email.split("@")[0],
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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});