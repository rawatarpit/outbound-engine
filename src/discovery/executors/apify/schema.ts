// src/discovery/executors/apify/schema.ts

import { z } from "zod"

/* -----------------------------------------
   Mapping Schema
------------------------------------------ */

export const ApifyMappingSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional(),
  title: z.string().optional()
}).refine(obj => Object.keys(obj).length > 0, {
  message: "Mapping must contain at least one field"
})

/* -----------------------------------------
   Filters Schema
------------------------------------------ */

export const ApifyFilterSchema = z.object({
  requireEmail: z.boolean().optional(),
  requireDomain: z.boolean().optional(),
  minConfidence: z.number().min(0).max(1).optional()
}).optional()

/* -----------------------------------------
   Full Config Schema
------------------------------------------ */

export const ApifyConfigSchema = z.object({
  actorId: z.string().min(1),
  input: z.any(),
  mapping: ApifyMappingSchema,
  filters: ApifyFilterSchema,
  limit: z.number().min(1).max(1000).optional()
})

export type ApifyConfig = z.infer<typeof ApifyConfigSchema>