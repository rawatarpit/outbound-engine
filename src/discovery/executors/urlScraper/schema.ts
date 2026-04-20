import { z } from "zod";

export const urlScraperSchema = z.object({
  url: z.string().url(),
  company_name: z.string().optional(),
  scrape_contacts: z.boolean().default(true),
  max_contacts: z.number().min(1).max(10).default(5),
});

export type UrlScraperConfig = z.infer<typeof urlScraperSchema>;

export const URL_SCRAPER_MAX_ITEMS = 10;
