#!/usr/bin/env python3
import sys
import json
import os
import urllib.request
import urllib.parse

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")

def search(query: str, max_results: int = 10, engines: list = None) -> list[dict]:
    params = {
        "q": query,
        "format": "json",
        "language": "en",
        "safesearch": "0",
    }
    if engines:
        params["engines"] = ",".join(engines)

    url = f"{SEARXNG_URL}/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "outbound-engine/2.0"})

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode())
            results = []
            for item in data.get("results", [])[:max_results]:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "body": item.get("content", ""),
                    "source": item.get("engine", "searxng"),
                    "score": item.get("score", 0)
                })
            return results
    except Exception as e:
        print(f"[SearXNG] Search failed: {e}", file=sys.stderr)
        return []

if __name__ == "__main__":
    payload = json.loads(sys.argv[1])
    results = search(
        payload["query"],
        payload.get("max_results", 10),
        payload.get("engines")
    )
    print(json.dumps(results))
