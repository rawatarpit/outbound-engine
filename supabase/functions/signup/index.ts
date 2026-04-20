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

    const { email, password, name, company } = body;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Creating user:", email);

    // Create auth user
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      console.log("Auth error:", authError.message);
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authUser.user.id;
    console.log("User created:", userId);

    // Create client with same ID
    const clientSlug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    const clientName = company || email.split("@")[0];

    console.log("Creating client:", clientName);

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
      console.log("Client error:", clientError.message);
      return new Response(JSON.stringify({ error: "Failed to create client: " + clientError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Client created:", client.id);

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
      console.log("Member error:", memberError.message);
      return new Response(JSON.stringify({ error: "Failed to create member: " + memberError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("All created successfully!");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account created! Please log in.",
        userId: userId,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Signup error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});