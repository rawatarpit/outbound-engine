import { normalizeDomain } from "../../normalizer";
import type { DiscoveryCompany, DiscoveryContact } from "../../types";

export function transformScrapedData(params: {
  scrapedData: {
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
  };
  sourceId: string;
  brandId: string;
  companyName?: string;
}): {
  company: DiscoveryCompany;
  contacts: DiscoveryContact[];
} {
  const domain = normalizeDomain(params.scrapedData.domain ?? "") ?? "";

  const company: DiscoveryCompany = {
    source: "url_scraper",
    risk: "high" as any,
    name: params.scrapedData.name ?? params.companyName ?? undefined,
    domain,
  };

  const contacts: DiscoveryContact[] = (params.scrapedData.contacts ?? []).map(
    (c) => {
      const contact: DiscoveryContact = {
        source: "url_scraper",
        risk: "high" as any,
        domain: domain,
        first_name: c.name?.split(" ")[0] ?? undefined,
        last_name: c.name?.split(" ").slice(1).join(" ") ?? undefined,
        full_name: c.name ?? undefined,
        email: c.email ?? undefined,
        title: c.title ?? undefined,
        linkedin_url: c.linkedinUrl ?? undefined,
      };
      return contact;
    },
  );

  return { company, contacts };
}
