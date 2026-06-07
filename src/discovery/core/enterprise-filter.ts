const MEDIA_DOMAINS = new Set([
  // Social & content platforms
  "medium.com", "dev.to", "hashnode.com", "substack.com", "substackcdn.com",
  "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com",
  "linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com",
  "reddit.com", "old.reddit.com", "new.reddit.com",
  "quora.com", "stackexchange.com", "stackoverflow.com", "stack.app",
  "angel.co", "wellfound.com",
  "github.com", "gitlab.com", "bitbucket.org",
  "producthunt.com", "crunchbase.com", "owler.com",
  "g2.com", "capterra.com", "trustpilot.com", "getapp.com",
  "glassdoor.com", "indeed.com", "ziprecruiter.com",
  "blogspot.com", "wordpress.com", "wp.com",
  "tiktok.com", "snap.com", "pinterest.com",
  "hackernews.com", "news.ycombinator.com", "hnrss.org",
  "news.google.com", "news.google.co.in",
  "feeds.feedburner.com", "feedproxy.google.com",
  // News wires & press release distributors
  "businesswire.com", "prnewswire.com", "prweb.com", "globenewswire.com",
  "marketwired.com", "newsfilecorp.com", "accesswire.com",
  "newsdirect.com", "einpresswire.com", "prleap.com",
  "digitaljournal.com", "newswire.com",
  // Major news & financial news
  "finance.yahoo.com", "yahoo.com", "aol.com", "msn.com",
  "businessinsider.com", "insider.com",
  "marketwatch.com", "reuters.com", "bloomberg.com",
  "cnbc.com", "cnn.com", "msnbc.com", "nbcnews.com",
  "forbes.com", "fortune.com", "inc.com", "entrepreneur.com",
  "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com",
  "zdnet.com", "cnet.com", "venturebeat.com", "tech.eu",
  "wsj.com", "nytimes.com", "washingtonpost.com", "bostonglobe.com",
  "theguardian.com", "bbc.com", "bbc.co.uk", "npr.org",
  "economist.com", "newyorker.com", "theatlantic.com",
  "time.com", "newsweek.com", "usatoday.com", "latimes.com",
  "chicagotribune.com", "seattletimes.com", "sfchronicle.com",
  "ft.com", "barrons.com", "investors.com",
  "seekingalpha.com", "benzinga.com", "thestreet.com",
  "crn.com", "theregister.com", "infoworld.com", "computerworld.com",
  "itpro.com", "techradar.com", "tomshardware.com",
  "pcmag.com", "popsci.com", "sciencedaily.com",
  "montgomeryadvertiser.com",
  "alphaleaders.co.uk",
])

export function isMediaDomain(domain: string): boolean {
  const d = domain.toLowerCase().trim().replace(/^www\./, "")
  if (MEDIA_DOMAINS.has(d)) return true
  // Subdomain matching — "finance.yahoo.com" matches "yahoo.com"
  const parts = d.split(".")
  if (parts.length >= 3) {
    const base = parts.slice(-2).join(".")
    if (MEDIA_DOMAINS.has(base)) return true
  }
  return false
}

const ENTERPRISE_DOMAINS = new Set([
  "google.com", "facebook.com", "meta.com", "amazon.com", "apple.com",
  "microsoft.com", "netflix.com", "tesla.com", "nvidia.com", "intel.com",
  "ibm.com", "oracle.com", "salesforce.com", "adobe.com", "cisco.com",
  "vmware.com", "paypal.com", "uber.com", "airbnb.com", "twitter.com",
  "linkedin.com", "snapchat.com", "spotify.com", "shopify.com",
  "cloudflare.com", "datadog.com", "stripe.com", "square.com",
  "palantir.com", "servicenow.com", "workday.com", "sap.com",
  "dell.com", "hp.com", "accenture.com", "deloitte.com", "pwc.com",
  "ey.com", "kpmg.com", "jpmorgan.com", "goldmansachs.com",
  "berkshirehathaway.com", "johnsonandjohnson.com", "proctergamble.com",
  "coca-cola.com", "pepsico.com", "walmart.com", "homedepot.com",
  "verizon.com", "att.com", "comcast.com", "disney.com",
  "pfizer.com", "merck.com", "abbvie.com", "novartis.com",
  "roche.com", "nestle.com", "unilever.com", "bayer.com",
  "siemens.com", "bosch.com", "samsung.com", "lg.com",
  "sony.com", "panasonic.com", "hitachi.com", "canon.com",
  "mit.edu", "harvard.edu", "stanford.edu", "ox.ac.uk", "cam.ac.uk",
  "apollo.io", "hubspot.com", "zendesk.com", "twilio.com", "sendgrid.com",
  "mailchimp.com", "constantcontact.com", "activecampaign.com",
  "zoominfo.com", "lusha.com", "discoverorg.com", "insideview.com",
  "clearbit.com", "fullcontact.com", "intercom.com", "drift.com",
  "outreach.io", "salesloft.com", "cognism.com", "kaspr.io",
  "gong.io", "chilipepper.io", "callrail.com", "dialpad.com",
  "ringcentral.com", "8x8.com", "twilio.com", "avaya.com",
  "monday.com", "asana.com", "clickup.com", "notion.com",
  "atlassian.com", "jira.com", "confluence.com", "trello.com",
  "slack.com", "teams.com", "zoom.us", "zoom.com",
  "docusign.com", "hellosign.com", "box.com", "dropbox.com",
  "okta.com", "crowdstrike.com", "paloaltonetworks.com",
  "splunk.com", "elastic.com", "mongodb.com", "databricks.com",
  "snowflake.com", "teradata.com", "informatica.com", "talend.com",
  "confluent.io", "redhat.com", "docker.com", "hashicorp.com",
  "newrelic.com", "sumologic.com", "dynatrace.com",
  "fiverr.com", "upwork.com", "freelancer.com", "toptal.com",
  "coursera.com", "udemy.com", "udacity.com", "pluralsight.com",
  "indeed.com", "monster.com", "glassdoor.com", "careerbuilder.com",
  "ziprecruiter.com", "roberthalf.com", "randstad.com", "adecco.com",
  "manpower.com", "kellyservices.com", "allegisgroup.com",
  "instacart.com", "doordash.com", "grubhub.com", "ubereats.com",
  "wix.com", "squarespace.com", "weebly.com", "godaddy.com",
  "wordpress.com", "wpengine.com", "bluehost.com", "hostgator.com",
  "infosys.com", "tcs.com", "wipro.com", "hcl.com", "techmahindra.com",
  "cognizant.com", "capgemini.com", "atos.net", "tieto.com",
  "thoughtworks.com", "globant.com", "epamsystems.com",
  "ibm.com", "accenture.com", "deloitte.com", "pwc.com", "ey.com", "kpmg.com",
  "mckinsey.com", "bain.com", "bcg.com", "boozallen.com",
  "leadiq.com", "warmly.ai", "koala.io", "uplexsoft.com",
  "apify.com", "scrapingbee.com", "scrapinghub.com", "brightdata.com",
  "oxylabs.io", "smartproxy.com", "netnut.io",
  "sevenfigureagency.com",
])

const ENTERPRISE_KEYWORDS = [
  "fortune 500", "fortune500", "global 2000", "s&p 500",
  "enterprise", "multinational", "conglomerate",
]

export function isEnterpriseDomain(domain: string): boolean {
  const d = domain.toLowerCase().trim()
  if (ENTERPRISE_DOMAINS.has(d)) return true
  const parts = d.split(".")
  if (parts.length >= 2) {
    const base = parts.slice(-2).join(".")
    if (ENTERPRISE_DOMAINS.has(base)) return true
  }
  return false
}

export function isEnterpriseDescription(description: string): boolean {
  const lower = description.toLowerCase()
  return ENTERPRISE_KEYWORDS.some(kw => lower.includes(kw))
}
