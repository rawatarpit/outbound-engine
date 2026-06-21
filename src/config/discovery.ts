/* =========================================================
   DISCOVERY CONFIG — Centralized defaults
   All hardcoded patterns, lists, maps, and thresholds
   live here. Brand-specific overrides can be loaded
   from DB and merged on top of these defaults.
========================================================= */

/* -----------------------------------------
   1. SERVICE PROVIDER FILTER
   ----------------------------------------- */

export const PROVIDER_TLDS = [
  ".agency", ".studio", ".dev", ".services", ".solutions", ".consulting",
  ".ventures", ".digital", ".media", ".marketing", ".technology",
  ".management", ".company", ".enterprises", ".industries",
  ".systems", ".network", ".global", ".international",
]

export const KNOWN_AGGREGATOR_PLATFORMS = [
  "producthunt.com", "crunchbase.com", "angel.co", "wellfound.com",
  "linkedin.com", "indeed.com", "glassdoor.com", "upwork.com",
  "fiverr.com", "freelancer.com", "toptal.com", "peopleperhour.com",
  "guru.com", "remoteok.com", "weworkremotely.com", "flexjobs.com",
  "builtin.com", "stackoverflow.com", "quora.com", "medium.com",
  "dev.to", "hashnode.com", "indiehackers.com", "hackernews.com",
  "news.ycombinator.com", "producthunt.com",
]

export const PROVIDER_CONTENT_INDICATORS = [
  "we offer", "we provide", "we build", "we create", "we develop",
  "our services", "our solutions", "our products", "we specialize in",
  "we help companies", "we work with clients", "our team of experts",
  "years of experience", "proven track record", "trusted by",
  "award winning", "leading provider", "top rated", "best in class",
  "contact us", "get a quote", "schedule a consultation",
  "our portfolio", "our clients", "case studies", "testimonials",
  "book a demo", "talk to sales", "request a demo",
]

/* -----------------------------------------
   2. GEOGRAPHIC VALIDATION
   ----------------------------------------- */

export const TARGET_REGIONS = [
  { name: "uae", patterns: [/dubai/i, /uae/i, /united arab emirates/i, /abu dhabi/i, /sharjah/i, /\.ae\b/] },
  { name: "uk", patterns: [/uk\b/i, /united kingdom/i, /england/i, /scotland/i, /wales/i, /northern ireland/i, /london/i, /\.uk\b/] },
  { name: "germany", patterns: [/germany/i, /deutschland/i, /berlin/i, /munich/i, /hamburg/i, /frankfurt/i, /\.de\b/] },
  { name: "france", patterns: [/france/i, /paris/i, /lyon/i, /marseille/i, /\.fr\b/] },
  { name: "netherlands", patterns: [/netherlands/i, /holland/i, /amsterdam/i, /rotterdam/i, /\.nl\b/] },
  { name: "spain", patterns: [/spain/i, /españa/i, /madrid/i, /barcelona/i, /\.es\b/] },
  { name: "italy", patterns: [/italy/i, /italia/i, /rome/i, /milan/i, /\.it\b/] },
  { name: "sweden", patterns: [/sweden/i, /sverige/i, /stockholm/i, /\.se\b/] },
  { name: "norway", patterns: [/norway/i, /norge/i, /oslo/i, /\.no\b/] },
  { name: "denmark", patterns: [/denmark/i, /danmark/i, /copenhagen/i, /\.dk\b/] },
  { name: "finland", patterns: [/finland/i, /suomi/i, /helsinki/i, /\.fi\b/] },
  { name: "belgium", patterns: [/belgium/i, /brussels/i, /\.be\b/] },
  { name: "austria", patterns: [/austria/i, /vienna/i, /\.at\b/] },
  { name: "switzerland", patterns: [/switzerland/i, /zurich/i, /geneva/i, /\.ch\b/] },
  { name: "ireland", patterns: [/ireland/i, /dublin/i, /\.ie\b/] },
  { name: "us", patterns: [/united states/i, /usa\b/i, /new york/i, /california/i, /texas/i, /florida/i, /\.us\b/] },
  { name: "canada", patterns: [/canada/i, /toronto/i, /vancouver/i, /montreal/i, /\.ca\b/] },
]

export const TARGET_TLDS = [
  ".ae", ".uk", ".de", ".fr", ".nl", ".es", ".it", ".se", ".no", ".dk",
  ".fi", ".be", ".at", ".ch", ".pl", ".cz", ".ie", ".us", ".ca",
]

export const GENERIC_TLDS = [
  ".com", ".org", ".net", ".io", ".app", ".co", ".ai", ".dev", ".info",
  ".biz", ".online", ".site", ".tech", ".xyz", ".live", ".pro",
]

export const NON_TARGET_REGIONS = [
  { name: "india", patterns: [/india/i, /bengaluru/i, /bangalore/i, /mumbai/i, /delhi\b/i, /pune\b/i, /hyderabad/i, /chennai/i, /kolkata/i, /gurgaon/i, /noida/i, /ahmedabad/i, /\.in\b/] },
  { name: "china", patterns: [/china/i, /beijing/i, /shanghai/i, /shenzhen/i, /guangzhou/i, /hong\s*kong/i, /\.cn\b/] },
  { name: "japan", patterns: [/japan/i, /tokyo/i, /osaka/i, /kyoto/i, /\.jp\b/] },
  { name: "south_korea", patterns: [/south\s*korea/i, /seoul/i, /\.kr\b/] },
  { name: "singapore", patterns: [/singapore/i, /\.sg\b/] },
  { name: "australia", patterns: [/australia/i, /sydney/i, /melbourne/i, /\.au\b/] },
  { name: "new_zealand", patterns: [/new\s+zealand/i, /auckland/i, /wellington/i, /\.nz\b/] },
  { name: "russia", patterns: [/russia/i, /moscow/i, /st\.?\s*petersburg/i, /\.ru\b/] },
  { name: "brazil", patterns: [/brazil/i, /brasil/i, /sao\s+paulo/i, /rio\s+de\s+janeiro/i, /\.br\b/] },
  { name: "mexico", patterns: [/mexico/i, /mexico\s+city/i, /\.mx\b/] },
  { name: "south_africa", patterns: [/south\s+africa/i, /cape\s+town/i, /johannesburg/i, /\.za\b/] },
  { name: "southeast_asia", patterns: [/vietnam/i, /thailand/i, /indonesia/i, /philippines/i, /malaysia/i, /bangladesh/i, /pakistan/i, /sri\s+lanka/i, /\.vn\b/, /\.th\b/, /\.id\b/, /\.ph\b/, /\.my\b/] },
  { name: "middle_east_non_gulf", patterns: [/saudi\s+arabia/i, /riyadh/i, /jeddah/i, /qatar/i, /doha/i, /oman/i, /muscat/i, /kuwait/i, /bahrain/i, /manama/i, /iraq/i, /baghdad/i, /iran/i, /tehran/i, /israel/i, /tel\s+aviv/i, /jerusalem/i, /jordan/i, /amman/i, /lebanon/i, /beirut/i, /turkey/i, /turkiye/i, /istanbul/i, /ankara/i] },
]

/* -----------------------------------------
   3. DOMAIN LISTS (enterprise, media, platform)
   ----------------------------------------- */

export const MEDIA_DOMAINS = [
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
  "businesswire.com", "prnewswire.com", "prweb.com", "globenewswire.com",
  "marketwired.com", "newsfilecorp.com", "accesswire.com",
  "newsdirect.com", "einpresswire.com", "prleap.com",
  "digitaljournal.com", "newswire.com",
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
]

export const ENTERPRISE_DOMAINS = [
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
  "ringcentral.com", "8x8.com",
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
  "mckinsey.com", "bain.com", "bcg.com", "boozallen.com",
  "leadiq.com", "warmly.ai", "koala.io", "uplexsoft.com",
  "apify.com", "scrapingbee.com", "scrapinghub.com", "brightdata.com",
  "oxylabs.io", "smartproxy.com", "netnut.io",
  "sevenfigureagency.com",
]

export const ENTERPRISE_KEYWORDS = [
  "fortune 500", "fortune500", "global 2000", "s&p 500",
  "enterprise", "multinational", "conglomerate",
]

/* -----------------------------------------
   4. FIRMOGRAPHIC INDICATORS
   ----------------------------------------- */

export const ENTERPRISE_INDICATORS = [
  /fortune\s+500/i, /global\s+leader/i, /multinational/i,
  /enterprise/i, /corporation/i, /incorporated/i, /inc\.?\b/i,
  /ltd\b/i, /limited/i, /plc\b/i, /group\s+holdings/i,
  /headquarters/i, /hq\b/i, /subsidiary/i, /publicly\s+traded/i,
  /nasdaq/i, /nyse\b/i,
]

export const SMALL_BIZ_INDICATORS = [
  /freelancer/i, /solopreneur/i, /independent\s+contractor/i,
  /self-?employed/i, /one\s+person/i, /sole\s+proprietor/i,
  /side\s+hustle/i, /startup/i,
]

export const EMPLOYEE_SIZE_PATTERNS = [
  /(?:we\s+(?:are\s+)?|our\s+team\s+(?:of\s+)?|(?:a|an)\s+)(\d+)\s*(?:-|\s+to\s+)?(\d+)?\s*(?:people|person|employees?|staff|team\s+members?)/i,
  /(?:team\s+of\s+|staff\s+of\s+)(\d+)\s*(?:-|\s+to\s+)?(\d+)?/i,
  /(\d+)\s*(?:-|\s+to\s+)?(\d+)?\s*(?:people|person|employees?|staff)\s+(?:team|strong)/i,
  /(?:grown\s+to\s+|expanded\s+to\s+|now\s+at\s+)(\d+)\s*(?:-|\s+to\s+)?(\d+)?\s*(?:people|person|employees?)/i,
]

export const B2B_INDUSTRY_INDICATORS = [
  /b2b\b/i, /business\s+to\s+business/i, /manufacturing/i,
  /healthcare/i, /finance\b/i, /banking/i, /insurance/i,
  /retail/i, /ecommerce/i, /logistics/i, /supply\s+chain/i,
  /real\s+estate/i, /education/i, /nonprofit/i, /government/i,
  /municipal/i, /construction/i, /transportation/i,
  /hospitality/i, /food\s+(and|&)\s+beverage/i,
]

export const PURE_TECH_INDICATORS = [
  /software\s+company/i, /saas\s+company/i, /tech\s+startup/i,
  /app\s+developer/i, /game\s+developer/i, /software\s+product/i,
  /tech\s+product/i, /software\s+vendor/i, /it\s+company/i,
  /software\s+house/i, /dev\s+agency/i, /development\s+agency/i,
]

/* -----------------------------------------
   4. SIGNAL QUALITY
   ----------------------------------------- */

export const SPECIFICITY_INDICATORS = [
  /(?:specifically|exactly|precisely)\s+(?:need|looking|want)/i,
  /(?:our\s+)?(?:budget|spend|investment)\s+(?:is|of|for)\s+/i,
  /(?:current|existing)\s+(?:tech\s+stack|system|platform|tool|process)/i,
  /(?:we\s+)?(?:use|run|operate)\s+/i,
  /(?:number|count|amount|volume)\s+(?:of|is)\s+/i,
  /\$\d+[kbm]?\b/i,
  /\d+%\s+(?:of|faster|more|better)/i,
]

export const RECENCY_INDICATORS = [
  /(?:this|next|current)\s+(?:quarter|month|week|year)/i,
  /q[1-4]\s+\d{4}/i,
  /(?:launching|releasing|shipping|deploying)\s+(?:next|this|in)/i,
  /(?:immediately|urgently|asap|as soon as possible)/i,
  /(?:by|before|until)\s+(?:\w+\s+\d{1,2})/i,
  /\d{4}-\d{2}-\d{2}/,
  /(?:deadline|due\s+date|timeline)/i,
]

export const AUTHORITY_INDICATORS = [
  /(?:vp|director|head|chief|senior\s+(?:vp|director|manager)|cto|cio|cmo|coo|ceo|founder|owner|principal|lead)\s+(?:of|for|engineer|developer|architect)/i,
  /(?:title|role|position)\s*:\s*(?:vp|director|head|chief|senior)/i,
  /\b(vp|director|head\s+of)\b/i,
]

/* -----------------------------------------
   5. REVENUE / CONTACT INDICATORS
   ----------------------------------------- */

export const REVENUE_INDICATORS = [
  /\$\d+[kbm]?\s+(?:annual|monthly|yearly|quarterly)\s+(?:revenue|income|sales|turnover|billings)/i,
  /(?:annual|monthly|yearly|quarterly)\s+(?:revenue|income|sales|turnover|billings)\s+(?:of|:)?\s*\$?\d+[kbm]?/i,
  /(?:revenue|sales|turnover|billings)\s+(?:grew|increased|rose|climbed).*?\$?\d+[kbm]/i,
  /\$\d+[kbm]?\s+(?:ARPU|ARR|MRR|LTV|CAC|GMV)/i,
  /ARR\s+(?:of|:)?\s*\$?\d+[kbm]?/i,
  /MRR\s+(?:of|:)?\s*\$?\d+[kbm]?/i,
  /(?:funding|revenue|valuation).*?\$?\d+[kbm]/i,
  /\$\d+[kbm].*?(?:run\s+rate|annualized)/i,
]

export const CONTACT_INFO_PATTERNS = [
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /\d{1,5}\s+[A-Za-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Plaza|Square|Sq)\b/i,
  /\b(?:P\.?O\.?\s+Box|Post\s+Office\s+Box)\s+\d+/i,
  /\b(?:Suite|Ste|Unit|Floor|Fl|Office)\s+#?\d+/i,
]

/* -----------------------------------------
   6. SIGNAL ADAPTER MAP
   ----------------------------------------- */

export const SIGNAL_ADAPTER_MAP: Record<string, string[]> = {
  hiring: ["hn_hiring", "indeed", "wellfound", "jobs", "search", "web_research", "reddit"],
  pain: ["reddit", "hackernews", "search", "web_research", "community", "pushshift"],
  funding: ["techcrunch", "crunchbase", "news", "search", "web_research"],
  automation_need: ["reddit", "hackernews", "search", "web_research", "pushshift", "community"],
  tech_usage: ["stackshare", "github", "search", "web_research"],
  growth_activity: ["yc", "producthunt", "news", "search", "web_research", "wellfound", "linkedin"],
  partnership: ["search", "news", "blogs", "linkedin"],
  outbound_pain: ["reddit", "hackernews", "community", "search"],
  expansion: ["news", "search", "techcrunch", "web_research"],
  migration: ["search", "reddit", "hackernews", "stackshare"],
  compliance: ["news", "search", "blogs"],
  burnout: ["reddit", "hackernews", "community", "jobs"],
}

/* -----------------------------------------
   7. ADAPTER PERFORMANCE DATA
   ----------------------------------------- */

export const ADAPTER_PERFORMANCE: Record<string, { rateLimit: string; reliability: string; bestFor: string }> = {
  search: { rateLimit: "30/min", reliability: "high", bestFor: "finding companies via signal-rich Google searches" },
  yc: { rateLimit: "60/min", reliability: "high", bestFor: "structured Y Combinator company data with batch, industry, hiring status" },
  hackernews: { rateLimit: "60/min", reliability: "high", bestFor: "Show HN launches and Ask HN hiring threads" },
  hn_hiring: { rateLimit: "60/min", reliability: "high", bestFor: "who is hiring threads — active hiring companies with verified domains" },
  jobs: { rateLimit: "10/min", reliability: "high", bestFor: "job postings at SaaS startups via Google Jobs" },
  pushshift: { rateLimit: "120/min", reliability: "high", bestFor: "archival Reddit data in startup/entrepreneur subreddits" },
  techcrunch: { rateLimit: "30/min", reliability: "medium", bestFor: "funding announcements and acquisition news" },
  news: { rateLimit: "10/min", reliability: "high", bestFor: "Google News search for funding/launch/partnership news" },
  reddit: { rateLimit: "10/min", reliability: "medium", bestFor: "current Reddit posts in startup/entrepreneur/SaaS subreddits" },
  producthunt: { rateLimit: "10/min", reliability: "medium", bestFor: "new product launches with traction (real companies)" },
  freelance: { rateLimit: "10/min", reliability: "medium", bestFor: "companies posting projects on Upwork/Fiverr/Toptal" },
  blogs: { rateLimit: "10/min", reliability: "medium", bestFor: "engineering blogs on Medium/Dev.to mentioning tech stack issues" },
  community: { rateLimit: "10/min", reliability: "medium", bestFor: "pain signals on IndieHackers/Quora/StackOverflow" },
  github: { rateLimit: "60/min", reliability: "low", bestFor: "active repos in relevant tech stacks (needs GITHUB_TOKEN)" },
  indeed: { rateLimit: "5/min", reliability: "low", bestFor: "companies actively hiring software engineers" },
  crunchbase: { rateLimit: "2/min", reliability: "low", bestFor: "funded companies by keyword" },
  wellfound: { rateLimit: "10/min", reliability: "medium", bestFor: "startups hiring on AngelList/Wellfound with structured company data" },
  stackshare: { rateLimit: "5/min", reliability: "low", bestFor: "companies using specific tech stacks" },
  linkedin: { rateLimit: "10/min", reliability: "medium", bestFor: "LinkedIn company pages via Google site search — industry, size, description" },
}

/* -----------------------------------------
   8. SCORING THRESHOLDS
   ----------------------------------------- */

export const SCORING_THRESHOLDS = {
  relevanceThreshold: 70,
  coldStartRelevanceThreshold: 50,
  compositeThreshold: 0.30,
  coldStartCompositeThreshold: 0.20,
  keywordWeight: 0.40,
  llmWeight: 0.30,
  domainWeight: 0.10,
  signalWeight: 0.10,
  extractionWeight: 0.10,
  llmHardRejectionThreshold: 30,
}

/* -----------------------------------------
   9. EMBEDDING CONFIG
   ----------------------------------------- */

export const EMBEDDING_CONFIG = {
  enabled: true,
  url: "http://localhost:11434/v1/embeddings",
  model: "nomic-embed-text",
  dimensions: 768,
  batchSize: 20,
  timeout: 15000,
  batchTimeout: 30000,
}

/* -----------------------------------------
   10. BRAND DISCOVERY CONFIG TYPE
   ----------------------------------------- */

export interface BrandDiscoveryConfigOverrides {
  targetRegions?: typeof TARGET_REGIONS
  nonTargetRegions?: typeof NON_TARGET_REGIONS
  providerTlds?: string[]
  aggregatorPlatforms?: string[]
  providerContentIndicators?: string[]
  enterpriseIndicators?: RegExp[]
  smallBizIndicators?: RegExp[]
  pureTechIndicators?: RegExp[]
  b2bIndicators?: RegExp[]
  signalAdapterMap?: typeof SIGNAL_ADAPTER_MAP
  adapterPerformance?: typeof ADAPTER_PERFORMANCE
  scoringThresholds?: typeof SCORING_THRESHOLDS
  embeddingConfig?: typeof EMBEDDING_CONFIG
}

export type DiscoveryConfig = typeof import("./discovery")
