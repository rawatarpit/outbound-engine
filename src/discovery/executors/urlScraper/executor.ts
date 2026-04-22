import axios from "axios";
import * as cheerio from "cheerio";
import pino from "pino";

import type { Executor } from "../../registry";
import type { DiscoveryResult } from "../../types";
import { DiscoveryError } from "../../errors";

import {
  urlScraperSchema,
  UrlScraperConfig,
  URL_SCRAPER_MAX_ITEMS,
} from "./schema";
import { transformScrapedData } from "./transform";

const logger = pino({ level: "info" });

interface ScrapedCompanyData {
  name?: string;
  domain?: string;
  description?: string;
  linkedinUrl?: string;
  contacts?: Array<{
    name?: string;
    email?: string;
    title?: string;
    linkedinUrl?: string;
  }>;
}

async function scrapeUrl(url: string): Promise<ScrapedCompanyData> {
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

  const response = await axios.get(normalizedUrl, {
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: (status) => status < 500,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (typeof response.data !== "string") {
    throw new DiscoveryError("Failed to fetch page content", "retryable");
  }

  const $ = cheerio.load(response.data);

  const title =
    $("title").first().text().trim() || $("h1").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content");

  let domain = normalizedUrl
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0];

  const linkedinUrl =
    $('a[href*="linkedin.com"]').first().attr("href") || undefined;

  let contacts: ScrapedCompanyData["contacts"] = [];

  $("a[href*=mailto]").each((_, el) => {
    const href = $(el).attr("href");
    const email = href?.replace("mailto:", "");
    if (email && email.includes("@")) {
      const text = $(el).text().trim();
      contacts.push({
        name: text || email.split("@")[0],
        email,
        title: "Contact",
      });
    }
  });

  contacts = contacts.slice(0, URL_SCRAPER_MAX_ITEMS);

  return {
    name: title,
    domain,
    description: description?.slice(0, 500),
    linkedinUrl,
    contacts,
  };
}

export const urlScraperExecutor: Executor<UrlScraperConfig> = async ({
  sourceId,
  brandId,
  config,
}) => {
  const startTime = Date.now();

  try {
    const parsed = urlScraperSchema.parse(config);

    const scrapedData = await scrapeUrl(parsed.url);

    const { company, contacts } = transformScrapedData({
      scrapedData: {
        ...scrapedData,
        name: parsed.company_name || scrapedData.name,
      },
      sourceId,
      brandId,
      companyName: parsed.company_name,
    });

    const companies = [company];
    const filteredContacts = parsed.scrape_contacts
      ? contacts.slice(0, parsed.max_contacts)
      : [];

    const duration = Date.now() - startTime;

    logger.info(
      {
        sourceId,
        brandId,
        url: parsed.url,
        companies: companies.length,
        contacts: filteredContacts.length,
        duration_ms: duration,
      },
      "URL scraper discovery completed",
    );

    const result: DiscoveryResult = {
      companies,
      contacts: filteredContacts,
      meta: {
        executor: "url_scraper",
        risk: "HIGH_SCRAPE" as any,
        total_fetched: companies.length + filteredContacts.length,
        total_companies: companies.length,
        total_contacts: filteredContacts.length,
        source_health: "healthy",
        duration_ms: duration,
      },
    };

    return result;
  } catch (err: any) {
    if (err instanceof DiscoveryError) {
      throw err;
    }

    throw new DiscoveryError(
      err?.message ?? "URL scraper executor failed",
      "retryable",
    );
  }
};
