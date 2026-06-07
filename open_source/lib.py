import sys, os, logging, contextlib

logging.getLogger().setLevel(logging.ERROR)
os.environ["CRAWL4AI_LOG_LEVEL"] = "ERROR"

import warnings
warnings.filterwarnings("ignore")

_REAL_STDOUT = sys.stdout

@contextlib.contextmanager
def stdout_to_stderr():
    old_stdout = sys.stdout
    saved_fd = os.dup(1)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.close(devnull)
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = old_stdout
        os.dup2(saved_fd, 1)
        os.close(saved_fd)

def log(msg):
    print(msg, file=sys.stderr, flush=True)

NON_COMPANY_DOMAINS = {
    "wikipedia.org", "wikimedia.org", "wiktionary.org", "wikidata.org",
    "britannica.com", "merriam-webster.com", "dictionary.com",
    "thesaurus.com", "encyclopedia.com",
    "facebook.com", "twitter.com", "x.com", "linkedin.com", "instagram.com",
    "tiktok.com", "snapchat.com", "pinterest.com", "reddit.com",
    "youtube.com", "vimeo.com", "twitch.tv", "discord.com",
    "medium.com", "dev.to", "blogspot.com", "wordpress.com",
    "substack.com", "ghost.org", "wixsite.com", "squarespace.com",
    "wix.com", "weebly.com",
    "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com",
    "stackexchange.com", "npmjs.com", "pypi.org", "docker.com",
    "kubernetes.io", "docs.google.com", "developer.apple.com",
    "developer.mozilla.org", "cloudflare.com",
    "coursera.org", "udemy.com", "edx.org", "khanacademy.org",
    "geeksforgeeks.org", "tutorialspoint.com", "w3schools.com",
    "udacity.com", "pluralsight.com", "skillshare.com",
    "cnn.com", "bbc.com", "bbc.co.uk", "nytimes.com", "wsj.com",
    "reuters.com", "bloomberg.com", "forbes.com", "techcrunch.com",
    "theverge.com", "wired.com", "arstechnica.com", "zdnet.com",
    "venturebeat.com", "businessinsider.com", "fortune.com",
    "gov", "gov.uk", "usa.gov", "whitehouse.gov",
    ".edu", ".ac.uk", ".edu.au", ".edu.cn", ".edu.in", ".edu.sg", ".edu.hk",
    "mailchimp.com", "hubspot.com", "salesforce.com", "zendesk.com",
    "slack.com", "notion.so", "miro.com", "figma.com", "canva.com",
    "typeform.com", "calendly.com", "zoom.us", "atlassian.com",
    "apple.com", "google.com", "microsoft.com", "amazon.com",
    "meta.com", "netflix.com", "oracle.com", "ibm.com", "sap.com",
    "adobe.com", "cisco.com", "dell.com", "hp.com", "intel.com",
    "nvidia.com", "tesla.com", "spacex.com",
    "producthunt.com", "betalist.com", "alternativeto.net",
    "cambridge.org", "merriam-webster.com", "thefreedictionary.com",
    "collinsdictionary.com", "dictionary.com", "thesaurus.com", "encyclopedia.com",
    "britannica.com", "wikihow.com", "howtogeek.com",
    "geeksforgeeks.org", "tutorialspoint.com",
    "w3schools.com", "javatpoint.com", "programiz.com",
    "investopedia.com", "fastercapital.com",
    "zhihu.com", "baidu.com", "baike.baidu.com",
    "jingyan.baidu.com", "sohu.com", "bing.com",
    "archive.org", "amazonaws.com", "readthedocs.io",
    "netlify.app", "vercel.app", "pages.dev",
    "fly.dev", "railway.app", "onrender.com",
    "g2.com", "capterra.com", "trustpilot.com",
    "yelp.com", "tripadvisor.com", "angieslist.com",
    "indeed.com", "glassdoor.com", "wellfound.com", "angel.co",
    "linkedin.com/jobs", "monster.com", "ziprecruiter.com",
    "craigslist.org",
    "apps.apple.com", "play.google.com",
    "archive.org", "github.io", "readthedocs.io",
    "googleusercontent.com", "amazonaws.com", "vercel.app",
    "netlify.app", "pages.dev", "fly.dev", "railway.app",
}

def is_likely_company(domain: str) -> bool:
    domain_lower = domain.lower()
    if domain_lower in NON_COMPANY_DOMAINS:
        return False
    for suffix in NON_COMPANY_DOMAINS:
        if domain_lower.endswith("." + suffix):
            return False
    if domain_lower.endswith(".github.io") or domain_lower.endswith(".gitlab.io"):
        return False
    if domain_lower.endswith(".blogspot.com") or domain_lower.endswith(".wordpress.com"):
        return False
    if domain_lower.endswith(".wixsite.com") or domain_lower.endswith(".squarespace.com"):
        return False
    if ".edu." in domain_lower or domain_lower.endswith(".edu"):
        return False
    if ".gov." in domain_lower or domain_lower.endswith(".gov"):
        return False
    parts = domain_lower.split(".")
    if len(parts) < 2:
        return False
    if len(parts) == 2 and parts[1] in ("co", "com", "org", "net", "io", "app", "dev", "ai"):
        return True
    # Reject gibberish subdomains (all consonants, >5 chars)
    if len(parts) >= 3:
        sub = parts[0]
        if len(sub) > 5 and all(c in "bcdfghjklmnpqrstvwxyz" for c in sub.lower()):
            return False
    return True

def verify_grounding(extracted: dict, all_text: str) -> dict:
    text_lower = all_text.lower()
    verified = {"name": None, "industry": None, "description": None,
                "tech_stack": [], "employees": None, "funding": None,
                "key_people": []}
    fields_found = 0
    total_fields = 0

    if extracted.get("name"):
        total_fields += 1
        if extracted["name"].lower() in text_lower:
            verified["name"] = extracted["name"]
            fields_found += 1

    if extracted.get("industry"):
        total_fields += 1
        if extracted["industry"].lower() in text_lower:
            verified["industry"] = extracted["industry"]
            fields_found += 1

    if extracted.get("description"):
        total_fields += 1
        desc_words = set(extracted["description"].lower().split())
        if desc_words:
            match_ratio = sum(1 for w in desc_words if w in text_lower) / len(desc_words)
            if match_ratio >= 0.7:
                verified["description"] = extracted["description"]
                fields_found += 1

    if extracted.get("tech_stack"):
        for item in extracted["tech_stack"]:
            if item and item.lower() in text_lower:
                verified["tech_stack"].append(item)

    if extracted.get("employees"):
        total_fields += 1
        if extracted["employees"].lower() in text_lower:
            verified["employees"] = extracted["employees"]
            fields_found += 1

    if extracted.get("funding"):
        total_fields += 1
        if extracted["funding"].lower() in text_lower:
            verified["funding"] = extracted["funding"]
            fields_found += 1

    if extracted.get("key_people"):
        for person in extracted["key_people"]:
            name = (person.get("name") or "").strip()
            title = (person.get("title") or "").strip()
            if name and (name.lower() in text_lower or name.split()[-1].lower() in text_lower):
                verified["key_people"].append({"name": name, "title": title})

    confidence = 0.0
    if total_fields > 0:
        confidence = round(fields_found / total_fields, 2)
    elif verified["name"] or verified["industry"]:
        confidence = 0.5
    elif extracted:
        confidence = 0.3

    verified["_confidence"] = confidence
    verified["_fields_found"] = fields_found
    verified["_fields_attempted"] = total_fields
    return verified

def compute_confidence_tier(confidence: float) -> str:
    if confidence >= 0.8:
        return "high"
    elif confidence >= 0.5:
        return "medium"
    return "low"
