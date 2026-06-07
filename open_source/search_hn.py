#!/usr/bin/env python3
"""
HN Search — Hacker News Algolia search for Who Is Hiring and startup posts.

Input:  JSON via argv[1] or stdin
        {queries: [{text, signal, intent_id}], max_results: int}
Output: JSON to stdout (single line)
        {companies: [{url, domain, signal_type, intent_id}], meta: {total}}
"""
import json, sys, time, re, urllib.request, urllib.parse

from lib import log, is_likely_company

HN_ALGOLIA = "https://hn.algolia.com/api/v1"

def search_algolia(params: dict) -> dict:
    url = f"{HN_ALGOLIA}/search_by_date?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "outbound-engine/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        log(f"HN Algolia request failed: {e}")
        return {"hits": []}

def search_stories(query: str, max_results: int = 10) -> list[dict]:
    data = search_algolia({
        "query": query,
        "tags": "story",
        "hitsPerPage": str(max_results * 2),
        "attributesToRetrieve": "title,url,author,objectID,created_at_i,points",
    })
    return data.get("hits", [])

def get_story_comments(story_id: str, max_results: int = 100) -> list[dict]:
    data = search_algolia({
        "tags": f"comment,story_{story_id}",
        "hitsPerPage": str(max_results),
        "attributesToRetrieve": "comment_text,author,created_at_i",
    })
    return data.get("hits", [])

def find_latest_hiring_story() -> dict | None:
    cutoff = int(time.time()) - 120 * 86400
    data = search_algolia({
        "query": '"Ask HN: Who is hiring"',
        "tags": "story",
        "hitsPerPage": "10",
        "numericFilters": f"created_at_i>={cutoff}",
        "attributesToRetrieve": "title,url,author,objectID,created_at_i,points",
    })
    for hit in data.get("hits", []):
        title = (hit.get("title") or "").lower()
        if "who is hiring" in title and "ask hn" in title:
            log(f"  Found hiring story: {hit.get('title')} ({hit.get('objectID')}, {hit.get('points', 0)} pts)")
            return hit
    return None

ALGOLIA_SEARCH = "https://hn.algolia.com/api/v1/search"

def search_stories_by_relevance(query: str, max_results: int = 10) -> list[dict]:
    data = search_algolia({
        "query": query,
        "tags": "story",
        "hitsPerPage": str(max_results * 2),
        "attributesToRetrieve": "title,url,author,objectID,created_at_i,points",
    })
    return data.get("hits", [])

def find_hiring_threads_by_search(max_results: int = 5) -> list[dict]:
    cutoff = int(time.time()) - 120 * 86400
    data = search_algolia({
        "query": '"who is hiring"',
        "tags": "story",
        "hitsPerPage": str(max_results),
        "numericFilters": f"created_at_i>={cutoff}",
        "attributesToRetrieve": "title,url,author,objectID,created_at_i,points",
    })
    stories = []
    for hit in data.get("hits", []):
        title = (hit.get("title") or "").lower()
        if "who is hiring" in title and "ask hn" in title:
            stories.append(hit)
    return stories

def extract_company_from_comment(text: str) -> str | None:
    if not text or len(text) < 15:
        return None
    first_line = text.strip().split("\n")[0].strip()

    skip_phrases = ["who is hiring", "reply", "comment", "please post",
                    "i am", "i'm", "we are", "we're", "i work", "i would"]
    text_lower = text.lower()
    for phrase in skip_phrases:
        if text_lower.startswith(phrase):
            return None

    pipe_parts = first_line.split("|")
    candidate = pipe_parts[0].strip().rstrip("|").strip()

    numbered = re.match(r'^[\d\s\)\.]+(.+)', candidate)
    if numbered:
        candidate = numbered.group(1).strip()

    if not candidate or len(candidate) > 60 or len(candidate) < 2:
        return None

    if not re.match(r'^[A-Za-z0-9][A-Za-z0-9\s\.\-&\'\+]+$', candidate):
        return None

    bad_words = ["remote", "onsite", "hybrid", "full-time", "contract", "intern",
                 "salary", "equity", "title:", "role:", "position:", "hiring:"]
    if candidate.lower() in bad_words:
        return None

    return candidate

def parse_hiring_comments(comments: list[dict], max_results: int) -> list[dict]:
    companies = []
    seen = set()
    for c in comments:
        text = c.get("comment_text", "") or ""
        company = extract_company_from_comment(text)
        if company and company.lower() not in seen:
            seen.add(company.lower())
            slug = re.sub(r'[^a-zA-Z0-9]', '', company.lower())
            domain_guess = f"{slug}.com" if slug else None
            if domain_guess:
                companies.append({
                    "url": f"https://news.ycombinator.com/item?id={c.get('objectID', '')}",
                    "domain": domain_guess,
                    "source_type": "hn_hiring",
                })
            if len(companies) >= max_results:
                break
    return companies

def search_hackernews_stories(query: str, max_results: int = 10) -> list[dict]:
    hits = search_stories_by_relevance(query, max_results * 2)
    companies = []
    seen_domains = set()
    for hit in hits:
        url = hit.get("url", "") or ""
        if not url:
            continue
        try:
            domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
            if domain in seen_domains:
                continue
            if not is_likely_company(domain):
                continue
            seen_domains.add(domain)
            companies.append({
                "url": url,
                "domain": domain,
                "source_type": "hackernews",
            })
            if len(companies) >= max_results:
                break
        except:
            pass
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
    hiring_done = False

    for q in queries:
        query_text = q["text"]
        q_source = q.get("source", "") or ""
        candidates = []

        if q_source == "hn_hiring" and not hiring_done:
            log("  Searching HN Who Is Hiring threads...")
            stories = find_hiring_threads_by_search(3)
            for story in stories:
                log(f"  Getting comments from: {story.get('title')}")
                comments = get_story_comments(story["objectID"], max_results * 10)
                log(f"  Got {len(comments)} comments")
                parsed = parse_hiring_comments(comments, max_results)
                candidates.extend(parsed)
            hiring_done = True
        elif q_source == "hackernews":
            log(f"  Searching HN stories for: {query_text[:60]}")
            candidates = search_hackernews_stories(query_text, max_results)
        else:
            log(f"  Searching HN stories (default) for: {query_text[:60]}")
            candidates = search_hackernews_stories(query_text, max_results)

        for c in candidates:
            domain = c.get("domain", "")
            if domain and domain not in seen_domains:
                seen_domains.add(domain)
                c["signal_type"] = q.get("signal", "")
                c["intent_id"] = q.get("intent_id", "")
                all_candidates.append(c)

    result = {
        "companies": [
            {"url": c["url"], "domain": c["domain"],
             "signal_type": c.get("signal_type", ""), "intent_id": c.get("intent_id", "")}
            for c in all_candidates
        ],
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