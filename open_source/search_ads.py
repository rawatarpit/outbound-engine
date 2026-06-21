#!/usr/bin/env python3
"""
search_ads — Meta/Facebook Ad Library discovery via meta-ads-collector.

Input:  JSON via argv[1] or stdin
        {queries: [{text, signal, intent_id}], max_results: int}
Output: JSON to stdout (single line)
        {companies: [{url, domain, signal_type, intent_id, title}], meta: {total}}
"""
import json, sys, time, re, os
from lib import log

AD_LIBRARY_TIMEOUT = int(os.environ.get("AD_LIBRARY_TIMEOUT", "30"))

def extract_domain(url_text: str) -> str | None:
    urls = re.findall(r'https?://(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)', url_text)
    if not urls:
        # Maybe it's a bare domain like "tireagent.com"
        bare = re.findall(r'([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)', url_text)
        urls = bare
    skip_domains = {"facebook.com", "instagram.com", "meta.com", "fb.com",
                    "messenger.com", "whatsapp.com", "google.com", "youtube.com",
                    "twitter.com", "x.com", "linkedin.com", "tiktok.com"}
    for u in urls:
        lower = u.lower()
        if lower in skip_domains:
            continue
        return lower
    return None

def search_ads(query_text: str, max_results: int) -> list[dict]:
    try:
        q = query_text.lower()
        if any(c in q for c in ["dubai", "uae", "abu dhabi", "sharjah", "gcc"]):
            country = "AE"
        elif any(c in q for c in ["uk", "london", "europe", "berlin", "paris"]):
            country = "GB"
        elif any(c in q for c in ["india", "mumbai", "bangalore"]):
            country = "IN"
        elif any(c in q for c in ["singapore"]):
            country = "SG"
        elif any(c in q for c in ["canada", "toronto"]):
            country = "CA"
        elif any(c in q for c in ["australia", "sydney"]):
            country = "AU"
        else:
            country = "US"
        from meta_ads_collector import MetaAdsCollector
        collector = MetaAdsCollector()
        ads = list(collector.search(
            query=query_text,
            country=country,
            ad_type="ALL",
            status="ALL",
            search_type="KEYWORD_UNORDERED",
            max_results=max_results,
        ))
        results = []
        for ad in ads:
            d = ad.to_dict()
            page = d.get("page", {}) or {}
            page_name = page.get("name", "") or ""
            page_url = page.get("page_url", "") or ""
            creatives = d.get("creatives", []) or []
            creative = creatives[0] if creatives else {}

            # Extract domain: check creative caption (often contains domain), then link_url
            domain = None
            caption = creative.get("caption", "") or ""
            if caption:
                domain = extract_domain(caption)
            if not domain:
                link_url = creative.get("link_url", "") or ""
                domain = extract_domain(link_url)
            if not domain:
                domain = extract_domain(page_url)
            company_name = page_name or domain or "Unknown"

            # Build a useful body from creative text
            body_parts = []
            if creative.get("title"):
                body_parts.append(creative["title"])
            if creative.get("body"):
                body_parts.append(creative["body"][:500])
            body = ". ".join(body_parts)

            results.append({
                "title": page_name,
                "url": page_url,
                "domain": domain or f"{re.sub(r'[^a-z0-9]', '', company_name.lower())}.com",
                "body": body[:1000],
                "company": company_name,
                "page_name": page_name,
                "ad_library_id": d.get("ad_library_id") or d.get("id", ""),
            })
        return results
    except ImportError:
        log("meta-ads-collector not installed, falling back to Playwright-based Meta Ad Library scrape")
    except Exception as e:
        log(f"MetaAdsCollector error: {e}")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("Playwright not available for ads fallback")
        return []

    ads = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            search_url = f"https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q={query_text}&sort_data=relevance"
            page.goto(search_url, timeout=30000)
            page.wait_for_timeout(3000)
            items = page.query_selector_all('[data-pagelet="AdLibrary"]')
            for item in items[:max_results]:
                text = item.inner_text()[:1000]
                domain = extract_domain(text)
                ads.append({
                    "title": query_text,
                    "url": page.url,
                    "domain": domain or "unknown.com",
                    "body": text[:500],
                    "company": domain or "Unknown",
                })
            browser.close()
    except Exception as e:
        log(f"Playwright Meta Ad Library fallback error: {e}")

    return ads[:max_results]

QUERY_DELAY = float(os.environ.get("ADS_QUERY_DELAY", "2.0"))

def main():
    if len(sys.argv) >= 2:
        params = json.loads(sys.argv[1])
    else:
        params = json.loads(sys.stdin.read())

    queries = params.get("queries", [])
    max_results = int(params.get("max_results", 5))

    start = time.time()
    all_candidates = []
    seen_domains = set()

    for i, q in enumerate(queries):
        query_text = q["text"].strip()
        if not query_text:
            continue
        try:
            log(f"  Searching Meta Ad Library: {query_text[:80]}")
            results = search_ads(query_text, max_results)
        except Exception as e:
            log(f"Meta Ad Library search failed for: {query_text[:60]}: {e}")
            results = []

        log(f"  Query '{query_text[:70]}': {len(results)} ads found")
        if i < len(queries) - 1:
            time.sleep(QUERY_DELAY)

        for ad in results:
            domain = ad.get("domain") or "unknown.com"
            if domain not in seen_domains:
                seen_domains.add(domain)
                all_candidates.append({
                    "url": ad.get("url") or "",
                    "domain": domain,
                    "signal_type": q.get("signal", ""),
                    "intent_id": q.get("intent_id", ""),
                    "title": ad.get("title") or ad.get("page_name") or "",
                    "company": ad.get("company") or domain,
                })

    result = {
        "companies": all_candidates,
        "meta": {
            "total": len(all_candidates),
            "queries": len(queries),
        },
        "_duration_ms": int((time.time() - start) * 1000),
    }

    print(json.dumps(result))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
