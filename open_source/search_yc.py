#!/usr/bin/env python3
"""
YC Search — Y Combinator company search via Algolia.

Input:  JSON via argv[1] or stdin
        {queries: [{text, signal, intent_id}], max_results: int}
Output: JSON to stdout (single line)
        {companies: [{url, domain, signal_type, intent_id}], meta: {total}}
"""
import json, sys, time, urllib.request, urllib.parse, re

from lib import log, is_likely_company

ALGOLIA_APP = "45BWZJ1SGC"
ALGOLIA_KEY = "NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE"

def search_yc_companies(query: str, max_results: int = 15) -> list[dict]:
    payload = json.dumps({
        "requests": [{
            "indexName": "YCCompany_production",
            "query": query,
            "params": f"hitsPerPage={max_results}&filters=ycdc_public&facets=%5B%22top_company%22%2C%22tags%22%2C%22batch%22%2C%22industry%22%2C%22regions%22%2C%22status%22%2C%22highlight%22%2C%22is_open_source%22%2C%22nonprofit%22%2C%22black_founded%22%2C%22hispanic_latino_founded%22%2C%22disabled_trans_founded%22%2C%22women_led%22%5D&maxValuesPerFacet=100",
        }]
    }).encode()

    req = urllib.request.Request(
        f"https://{ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries",
        data=payload,
        headers={
            "X-Algolia-API-Key": ALGOLIA_KEY,
            "X-Algolia-Application-Id": ALGOLIA_APP,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        log(f"YC Algolia request failed: {e}")
        return []

    hits = data.get("results", [{}])[0].get("hits", [])
    companies = []
    seen_domains = set()

    for hit in hits:
        name = hit.get("name", "") or ""
        website = hit.get("website", "") or ""
        slug = hit.get("slug", "") or ""
        one_liner = hit.get("one_liner", "") or ""
        batch = hit.get("batch", "") or ""
        industry = hit.get("industry", "") or ""
        is_hiring = hit.get("isHiring", False)
        tags = hit.get("tags", []) or []
        regions = hit.get("regions", []) or []
        yc_url = f"https://www.ycombinator.com/companies/{slug}" if slug else ""

        if website:
            domain = urllib.parse.urlparse(website).netloc.replace("www.", "")
        elif slug:
            domain = f"{slug}.com"
        else:
            continue

        if domain in seen_domains:
            continue
        if not is_likely_company(domain):
            continue
        seen_domains.add(domain)

        companies.append({
            "url": website or yc_url,
            "domain": domain,
            "company_name": name,
            "description": one_liner,
            "batch": batch,
            "industry": industry,
            "is_hiring": is_hiring,
            "tags": tags,
            "regions": regions,
            "source_type": "ycombinator",
        })

    return companies

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

    for q in queries:
        query_text = q["text"]
        log(f"  YC search: '{query_text[:60]}'")
        candidates = search_yc_companies(query_text, max_results * 2)
        log(f"  Found {len(candidates)} YC companies for '{query_text[:60]}'")

        for c in candidates:
            domain = c.get("domain", "")
            if domain and domain not in seen_domains:
                seen_domains.add(domain)
                c["signal_type"] = q.get("signal", "")
                c["intent_id"] = q.get("intent_id", "")
                all_candidates.append(c)
                if len(all_candidates) >= max_results:
                    break
        if len(all_candidates) >= max_results:
            break

    result = {
        "companies": [
            {"url": c["url"], "domain": c["domain"],
             "signal_type": c.get("signal_type", ""), "intent_id": c.get("intent_id", "")}
            for c in all_candidates[:max_results]
        ],
        "meta": {
            "total": min(len(all_candidates), max_results),
            "queries": len(queries),
        },
        "_duration_ms": int((time.time() - start) * 1000),
    }

    print(json.dumps(result))
    sys.stdout.flush()

if __name__ == "__main__":
    main()