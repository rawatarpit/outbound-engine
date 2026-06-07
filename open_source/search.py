#!/usr/bin/env python3
"""
Search — DuckDuckGo search for B2B company discovery.

Input:  JSON via argv[1] or stdin
        {queries: [{text, signal, intent_id}], max_results: int, mode: "web"|"news"}
Output: JSON to stdout (single line)
        {companies: [{url, domain, signal_type, intent_id}], meta: {total}}
"""
import json, sys, time, re, os, random, urllib.request

from lib import log, is_likely_company

try:
    from duckduckgo_search import DDGS
except ImportError:
    from ddgs import DDGS

DDGS_TIMEOUT = int(os.environ.get("DDGS_TIMEOUT", "20"))
SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")

def searxng_search(query: str, max_results: int = 10) -> list[dict]:
    """Search via SearXNG with JSON API."""
    import urllib.request
    url = "%s/search?q=%s&format=json&language=en&safesearch=0&categories=general" % (SEARXNG_URL.rstrip("/"), urllib.request.quote(query))
    try:
        resp = urllib.request.urlopen(url, timeout=15)
        data = json.loads(resp.read().decode())
        results = data.get("results", [])
        # Filter out clearly garbage domains (gibberish subdomains)
        filtered = []
        seen = set()
        for r in results:
            url = r.get("url", "") or ""
            if not url:
                continue
            try:
                domain = url.split("/")[2].lower()
            except:
                continue
            # Skip domains with gibberish (random-looking subdomains)
            parts = domain.split(".")
            if len(parts) >= 3:
                sub = parts[0]
                # Check if subdomain looks like random letters (more than 5 consonant-only chars)
                if len(sub) > 5 and all(c in "bcdfghjklmnpqrstvwxyz" for c in sub.lower()):
                    continue
            if domain in seen:
                continue
            seen.add(domain)
            filtered.append({
                "title": r.get("title", ""),
                "href": url,
                "url": url,
                "body": r.get("content", ""),
                "engine": r.get("engine", "searxng"),
            })
        return filtered[:max_results]
    except Exception as e:
        log("SearXNG search failed: %s" % e)
        return []

DDG_BAD_SITES = {
    "linkedin.com", "linkedin.com/company",
    "facebook.com", "twitter.com", "x.com",
    "instagram.com", "tiktok.com", "youtube.com",
    "reddit.com", "medium.com", "dev.to", "hashnode.com",
    "github.com", "gitlab.com", "bitbucket.org",
    "stackoverflow.com", "stackexchange.com",
    "producthunt.com", "wellfound.com", "crunchbase.com",
    "techcrunch.com", "indeed.com", "glassdoor.com",
    "monster.com", "ziprecruiter.com",
    "meta.com", "fb.com", "snapchat.com",
    "pinterest.com", "quora.com",
}

_sleep_until = 0.0

def _rate_limit_sleep():
    """Ensure we wait at least until _sleep_until, with exponential backoff tracking."""
    global _sleep_until
    now = time.time()
    if now < _sleep_until:
        wait = _sleep_until - now
        log(f"  Rate limit cooldown: waiting {wait:.1f}s")
        time.sleep(wait)

def _mark_rate_limited(base_wait: float = 5.0):
    """Record that we got rate limited — next query will wait at least base_wait seconds."""
    global _sleep_until
    now = time.time()
    _sleep_until = max(_sleep_until, now) + base_wait + random.uniform(0, 2)

def sanitize_query_for_ddg(raw: str) -> str:
    q = raw.strip()
    # Strip ALL site: operators — DDG returns zero results for site: queries
    q = re.sub(r'\bsite:\s*\S+', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\bsubreddit:\s*\S+', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\bOR\b', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\bAND\b', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\s+', ' ', q).strip()
    return q

def _do_search(search_fn, query: str, max_results: int, attempt: int = 1) -> list[dict]:
    """Execute search with exponential backoff on rate limit."""
    max_attempts = 3
    for attempt_num in range(1, max_attempts + 1):
        try:
            _rate_limit_sleep()
            results = list(search_fn(query, max_results))
            # If we got here, the request succeeded
            return results
        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "ratelimit" in err_str or "403" in err_str or "429" in err_str

            if is_rate_limit:
                backoff = min(5 * (2 ** (attempt_num - 1)), 30)
                jitter = random.uniform(0, 2)
                log(f"  Rate limited (attempt {attempt_num}/{max_attempts}), backing off {backoff:.0f}s...")
                _mark_rate_limited(backoff + jitter)
            else:
                if attempt_num < max_attempts:
                    backoff = 2 * attempt_num
                    log(f"  Search error (attempt {attempt_num}/{max_attempts}): {e}. Retrying in {backoff}s...")
                    time.sleep(backoff)
                else:
                    raise

    raise Exception(f"All {max_attempts} attempts failed for query")

def ddg_web_search(query: str, max_results: int = 10) -> list[dict]:
    with DDGS(timeout=DDGS_TIMEOUT) as ddgs:
        return _do_search(lambda q, mr: ddgs.text(q, max_results=mr), query, max_results)


def simplify_ddg_query(raw: str) -> str:
    """Remove quoted strings and operators to create a simpler fallback query."""
    q = raw
    q = re.sub(r'"[^"]*"', '', q)
    q = re.sub(r"'[^']*'", '', q)
    for op in ['OR', 'AND', 'NOT']:
        q = re.sub(r'\b' + op + r'\b', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\bsite:\s*\S+', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\bsubreddit:\s*\S+', '', q, flags=re.IGNORECASE)
    q = re.sub(r'\s+', ' ', q).strip()
    words = q.split()
    return ' '.join(words[:5]) if words else raw.split()[0] if raw.split() else raw


def ddg_search_with_fallback(query_text: str, max_results: int):
    """Try DDG, if 0 results try SearXNG, then simplified DDG."""
    results = ddg_web_search(query_text, max_results * 3)
    if len(results) > 0:
        return results, False
    log(f"  DDG 0 results, trying SearXNG: {query_text[:60]}")
    time.sleep(1)
    sx_results = searxng_search(query_text, max_results * 3)
    if len(sx_results) > 0:
        return sx_results, True
    simple = simplify_ddg_query(query_text)
    if simple and simple != query_text:
        log(f"  SearXNG also 0, retrying simplified DDG: {simple[:80]}")
        time.sleep(2)
        results = ddg_web_search(simple, max_results * 3)
        if len(results) > 0:
            return results, True
    return results, False

def ddg_news_search(query: str, max_results: int = 10) -> list[dict]:
    with DDGS(timeout=DDGS_TIMEOUT) as ddgs:
        return _do_search(lambda q, mr: ddgs.news(q, max_results=mr), query, max_results)

def extract_candidates_from_results(results: list[dict], max_results: int) -> list[dict]:
    candidates = []
    seen_domains = set()
    for r in results:
        url = r.get("href", "") or r.get("url", "") or ""
        if not url:
            continue
        try:
            domain = url.split("/")[2].replace("www.", "")
            if domain in seen_domains:
                continue
            if not is_likely_company(domain):
                log(f"  Skipping non-company domain: {domain}")
                continue
            # Skip clearly non-company content by title/body
            title = (r.get("title", "") or "").lower()
            body = (r.get("body", "") or r.get("content", "") or "").lower()
            skip_patterns = ["definition", "meaning", "synonym", "thesaurus",
                           "how to", "tutorial", "dictionary", "wikipedia",
                           "geeksforgeeks", "investopedia"]
            if any(p in title for p in skip_patterns):
                log(f"  Skipping non-company content: {domain} - {title[:40]}")
                continue
            seen_domains.add(domain)
            candidates.append({"url": url, "domain": domain})
            if len(candidates) >= max_results:
                break
        except:
            pass
    return candidates

QUERY_DELAY = float(os.environ.get("DDG_QUERY_DELAY", "3.0"))

def main():
    if len(sys.argv) >= 2:
        params = json.loads(sys.argv[1])
    else:
        params = json.loads(sys.stdin.read())

    queries = params.get("queries", [])
    max_results = int(params.get("max_results", 5))
    mode = params.get("mode", "web")

    start = time.time()
    all_candidates = []
    seen_domains = set()

    search_fn = ddg_news_search if mode == "news" else ddg_search_with_fallback

    for i, q in enumerate(queries):
        query_text = sanitize_query_for_ddg(q["text"])
        if not query_text:
            fallback_q = ' '.join(q["text"].split()[:4])
            query_text = sanitize_query_for_ddg(fallback_q) or fallback_q
        if not query_text:
            log(f"  Skipping empty query after all sanitization: {q['text'][:60]}")
            continue
        try:
            log(f"  Searching DDG ({mode}): {query_text[:80]}")
            if mode == "news":
                results = ddg_news_search(query_text, max_results * 3)
                used_fallback = False
            else:
                results, used_fallback = search_fn(query_text, max_results)
            candidates = extract_candidates_from_results(results, max_results)
        except Exception as e:
            log(f"DDG search failed for: {query_text[:60]}: {e}")
            candidates = []
            results = []

        log(f"  Query '{query_text[:70]}': {len(candidates)} candidates from {len(results) if results else 0} results")
        if i < len(queries) - 1:
            time.sleep(QUERY_DELAY)

        for c in candidates:
            if c["domain"] not in seen_domains:
                seen_domains.add(c["domain"])
                c["signal_type"] = q.get("signal", "")
                c["intent_id"] = q.get("intent_id", "")
                all_candidates.append(c)

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
