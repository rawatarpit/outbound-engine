import dotenv from "dotenv";
import pino from "pino";
import { z } from "zod";

dotenv.config();

const logger = pino({ level: "info" });

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  OLLAMA_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),

  CORS_ORIGIN: z.string().optional(),

  RESEND_WEBHOOK_SECRET: z.string().optional(),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  logger.fatal("❌ Invalid environment configuration");
  logger.fatal(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

export function validateEnv() {
  // If we reached here, validation already passed.
  logger.info("✅ Environment validated successfully");

  // Production warnings for critical optional variables
  if (env.NODE_ENV === "production") {
    if (!env.CORS_ORIGIN) {
      logger.warn(
        "⚠️  CORS_ORIGIN not set - CORS will be disabled in production",
      );
    }
    if (!env.RESEND_WEBHOOK_SECRET) {
      logger.warn(
        "⚠️  RESEND_WEBHOOK_SECRET not set - webhook verification disabled",
      );
    }
  }
}
