import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { env } from "../../config/env";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export interface AuthPayload {
  client_id: string;
  user_id?: string;
  brand_id?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);

  if (token === env.SUPABASE_SERVICE_ROLE_KEY) {
    req.auth = {
      client_id: (req.body?.brand_id as string) || "test-client",
      user_id: "service-role",
      brand_id: req.body?.brand_id as string,
    };
    next();
    return;
  }

  verifyToken(token)
    .then((auth) => {
      req.auth = auth;
      next();
    })
    .catch((err) => {
      logger.warn({ err }, "Token verification failed");
      res.status(401).json({ error: "Invalid or expired token" });
    });
}

async function verifyToken(token: string): Promise<AuthPayload> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error(authError?.message || "Invalid token");
  }

  const { data: member, error: memberError } = await supabase
    .from("client_members")
    .select("client_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError || !member) {
    throw new Error(memberError?.message || "No client membership found");
  }

  const { data: brand } = await supabase
    .from("brand_profiles")
    .select("id")
    .eq("client_id", member.client_id)
    .limit(1)
    .maybeSingle();

  return {
    client_id: member.client_id,
    user_id: user.id,
    brand_id: brand?.id || undefined,
  };
}
