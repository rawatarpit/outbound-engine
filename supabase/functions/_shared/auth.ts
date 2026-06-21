import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashToken, validateOrigin } from "./security.ts";
const ALLOWED_DEVICE_STATUSES = [
  'online',
  'available',
  'busy'
];
const REQUIRED_AUTH_FIELDS = [
  "id",
  "org_id",
  "status",
  "revoked_at"
];
function extractAgentToken(req) {
  const token = req.headers.get("x-agent-token");
  if (!token) {
    return {
      token: null,
      error: "Missing x-agent-token header"
    };
  }
  if (token.trim() === "") {
    return {
      token: null,
      error: "x-agent-token cannot be empty"
    };
  }
  return {
    token,
    error: null
  };
}
async function validateAndGetDevice(supabase, hashedToken, selectFields = "id, org_id, name, status, revoked_at") {
  const fieldSet = new Set([
    ...selectFields.split(",").map((f)=>f.trim()),
    ...REQUIRED_AUTH_FIELDS
  ]);
  const finalSelect = Array.from(fieldSet).join(", ");
  const { data: device, error: dbError } = await supabase.from("devices").select(finalSelect).eq("access_token_hash", hashedToken).maybeSingle();
  console.log("[auth] Query result:", {
    hasData: !!device,
    hasError: !!dbError,
    errorCode: dbError?.code,
    device: device ? {
      id: device.id,
      status: device.status,
      revoked_at: device.revoked_at
    } : null
  });
  if (dbError) {
    console.error("[auth] Database error:", dbError.message, dbError.code);
    return {
      device: null,
      error: "Auth query failed"
    };
  }
  if (!device) {
    console.warn("[auth] No device found for token hash:", hashedToken.substring(0, 8) + "...");
    return {
      device: null,
      error: "Unauthorized — invalid token"
    };
  }
  if (device.revoked_at !== null && device.revoked_at !== undefined) {
    console.warn("[auth] Device revoked:", device.id);
    return {
      device: null,
      error: "Device has been revoked"
    };
  }
  if (device.status === null || device.status === undefined) {
    console.error("[auth] CRITICAL: Device has null/undefined status - DB corruption!", device.id);
    return {
      device: null,
      error: "Device missing status (DB corruption)"
    };
  }
  if (typeof device.status !== 'string') {
    console.error("[auth] CRITICAL: Device status is not a string!", device.id, typeof device.status);
    return {
      device: null,
      error: "Device status has invalid type (DB corruption)"
    };
  }
  if (!ALLOWED_DEVICE_STATUSES.includes(device.status)) {
    console.warn("[auth] Device not operational:", device.id, "status:", device.status);
    return {
      device: null,
      error: `Device is not operational (status: ${device.status})`
    };
  }
  console.log("[auth] Device validated:", device.id, "status:", device.status);
  return {
    device: device,
    error: null
  };
}
async function updateLastSeen(supabase, deviceId) {
  try {
    await supabase.from("devices").update({
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", deviceId);
  } catch (err) {
    console.error("[auth] Failed to update last_seen:", err);
  }
}
export async function authenticateDevice(req) {
  const origin = req.headers.get("origin");
  if (origin && !validateOrigin(req)) {
    return {
      error: "Forbidden"
    };
  }
  const { token, error: tokenError } = extractAgentToken(req);
  if (tokenError) {
    return {
      error: tokenError
    };
  }
  const hashedToken = await hashToken(token);
  console.log("[auth] Token hashed, length:", hashedToken.length);
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const { device, error } = await validateAndGetDevice(supabase, hashedToken);
  if (error || !device) {
    return {
      error: error || "Authentication failed"
    };
  }
  await updateLastSeen(supabase, device.id);
  return {
    device
  };
}
export async function authenticateDeviceWithDetails(req, selectFields) {
  const origin = req.headers.get("origin");
  if (origin && !validateOrigin(req)) {
    return {
      error: "Forbidden"
    };
  }
  const { token, error: tokenError } = extractAgentToken(req);
  if (tokenError) {
    return {
      error: tokenError
    };
  }
  const hashedToken = await hashToken(token);
  console.log("[auth] Token hashed for authWithDetails, length:", hashedToken.length);
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const select = selectFields || "id, org_id, name, status, revoked_at";
  const { device, error } = await validateAndGetDevice(supabase, hashedToken, select);
  if (error || !device) {
    return {
      error: error || "Authentication failed"
    };
  }
  await updateLastSeen(supabase, device.id);
  return {
    device
  };
}
export async function requireAuth(req) {
  const result = await authenticateDevice(req);
  if (!result.device) {
    throw new Error(result.error || "Unauthorized");
  }
  return result.device;
}
export async function requireAuthWithDetails(req, selectFields) {
  const result = await authenticateDeviceWithDetails(req, selectFields);
  if (!result.device) {
    throw new Error(result.error || "Unauthorized");
  }
  return result.device;
}
/**
 * Authenticates a user by verifying the JWT from the Authorization header.
 * Creates a single client with the service_role key (for DB access) and
 * the user's JWT (for auth verification via getUser()).
 * Returns { user, member, clientId, supabase } on success.
 */ export async function authenticateUser(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return {
      error: "Missing authorization header",
      status: 401
    };
  }
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) {
    return {
      error: "Invalid authorization header",
      status: 401
    };
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // Create client with service_role key + user's JWT in global headers
  // The service_role key bypasses RLS for DB queries.
  // The user's JWT in global headers allows getUser() to verify the token.
  const supabase = createClient(supabaseUrl, serviceKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    },
    auth: {
      persistSession: false
    }
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.error("[user-auth] JWT verification failed:", authError?.message);
    return {
      error: "Invalid or expired token",
      status: 401
    };
  }
  const { data: member, error: memberError } = await supabase.from("client_members").select("client_id, role, email, id").eq("user_id", user.id).maybeSingle();
  if (memberError || !member || !member.client_id) {
    console.error("[user-auth] No client member found:", memberError?.message);
    return {
      error: "No client associated",
      status: 403
    };
  }
  return {
    user,
    member,
    clientId: member.client_id,
    error: null,
    status: 200,
    supabase
  };
}
export async function requireUserAuth(req) {
  const result = await authenticateUser(req);
  if (result.error) {
    throw new Error(result.error);
  }
  return result;
}
