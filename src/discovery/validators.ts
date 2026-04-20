import { z } from "zod"

export const tokenAuthSchema = z.object({
  type: z.literal("token"),
  apiKey: z.string().min(10),
})

export const oauthSchema = z.object({
  type: z.literal("oauth"),
  clientId: z.string(),
  clientSecret: z.string(),
  refreshToken: z.string().optional(),
})

export const baseAuthSchema = z.discriminatedUnion("type", [
  tokenAuthSchema,
  oauthSchema,
  z.object({ type: z.literal("none") }),
])

export const baseConfigSchema = z.object({
  auth: baseAuthSchema.optional(),
  options: z.record(z.any()).optional(),
})

export function validateBaseConfig(input: unknown) {
  return baseConfigSchema.parse(input)
}