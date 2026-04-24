# Discovery Engine - Migration to ScraperAPI

## Overview
Migrated the outbound engine's scraping pipeline from Scrapling to ScraperAPI/direct HTTP with retry logic.

---

## Changes

### ✅ 1. Removed Scrapling Completely
- **Deleted**: All `execSync` calls to `scrapling` CLI
- **Deleted**: Temp file handling (`/tmp/scrapling_output.html`)
- **Deleted**: Stealthy-fetch / fetch wrappers
- **Removed**: `scrapling` from imports and runtime

### ✅ 2. Added New Scraping Module

**Location**: `src/discovery/signals/adapters/search.ts` (inlined)

**Features**:
- ✅ ScraperAPI integration (primary)
- ✅ Direct HTTP fallback
- ✅ Retry with exponential backoff (3 retries)
- ✅ Rotating User-Agents
- ✅ Timeout handling (20s default)

### ✅ 3. Architecture

```
Request Flow:
┌─────────────────┐
│  scrapeUrl(url)  │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Try     │
    │ScraperAPI│
    └────┬────┘
         │
    ┌────▼────┐ (if fail)
    │ Retry 1  │ ◄── exponential backoff
    └────┬────┘
         │
    ┌────▼────┐ (if fail)
    │ Direct  │
    │ HTTP   │
    └────┬────┘
         │
    ┌────▼────┐ (if fail)
    │ Retry 2 │
    └────┬────┘
         │
    ▼ Return result or error
```

### ✅ 4. Adapter Configuration

**Environment Variables**:
| Variable | Purpose |
|----------|---------|
| `SCRAPER_API_KEY` | ScraperAPI.com key (optional) |
| `APIFY_API_KEY` | Apify key (future support) |
| `SCRAPER_DEBUG=true` | Save raw HTML for debugging |
| `ALLOW_MOCK=true` | Enable mock data fallback |

**Database Fields** (brand_profiles):
- `scraper_api_key`
- `apify_api_key`

### ✅ 5. Supported Sources

| Source | URL | Status |
|--------|-----|--------|
| Hacker News | `hn.algolia.com` | ✅ Working |
| Indie Hackers | `indiehackers.com` | ✅ Working |
| Product Hunt | `producthunt.com` | ✅ Working |
| Reddit | `old.reddit.com` | ✅ Working |

### ✅ 6. Query Simplification

Automatic query generation for outbound sales:
- "struggling with outbound sales"
- "can't generate leads"
- "outbound sales problems"
- "need help with pipeline"
- "hiring sales rep"
- "sales pipeline issues"
- "cold calling help"
- "best outbound tools"
- "lead generation SaaS"
- "outbound software"

### ✅ 7. Intent Classification

| Intent | Keywords | Score |
|--------|-----------|-------|
| pain | struggling, can't, help, frustrated, problem, stuck | 0.85 |
| hiring | looking for, hire, need someone, recruit | 0.8 |
| tool_search | recommend, best tool, alternatives, vs | 0.6 |
| discussion | other | 0.3 |

---

## Logging Stages

| Stage | Meaning |
|-------|---------|
| `SCRAPER_INIT` | Scraper configured |
| `SCRAPE_START` | Starting scrape |
| `SCRAPERAPI_SUCCESS` | ScraperAPI worked |
| `SCRAPERAPI_ERROR` | ScraperAPI failed |
| `DIRECT_SUCCESS` | Direct HTTP worked |
| `DIRECT_ERROR` | Direct HTTP failed |
| `RETRY_DELAY` | Waiting before retry |
| `ADAPTER_EXECUTION` | Adapter started |
| `QUERY_VARIATIONS` | Generated queries |
| `HN_REQUEST` / `HN_SUCCESS` | Hacker News |
| `INDIE_HACKERS_REQUEST` / `INDIE_HACKERS_SUCCESS` | Indie Hackers |
| `PRODUCT_HUNT_REQUEST` / `PRODUCT_HUNT_SUCCESS` | Product Hunt |
| `REDDIT_REQUEST` / `REDDIT_SUCCESS` | Reddit |
| `SEARCH_SUCCESS` | Results found |
| `NO_RESULTS` | All sources failed |

---

## Usage

### Configuration
```typescript
// Via brand config
const adapter = new SearchAdapter({
  scraperApiKey: "your-key",
  apifyApiKey: "your-key",
}, brandId)
```

### Direct Use
```typescript
const result = await scrapeUrl("https://example.com")
// Returns: { url, title, raw_html, text_content, metadata, success, source }
```

---

## Git History

```
bf4b867 - feat: remove Scrapling, add ScraperAPI scraping with retry
80884db - fix: better parsers for HN, Indie Hackers, Product Hunt
89a42f3 - feat: try HN first, then Indie Hackers, Product Hunt, Reddit last
0128ee2 - fix: better query simplification for outbound sales, detect block pages
6fa23e6 - fix: change SearchAdapter source to 'community_search' to avoid collision
dacc185 - fix: remove JobsAdapter (Adzuna requires API key)
3fd4ed7 - fix: make SearchAdapter support all signals (override supports method)
5ce739a - docs: add discovery engine architecture doc
a6e0f06 - feat: add Indie Hackers + Product Hunt scraping, query simplification
83ca61e - feat: remove Google scraping, add Reddit + HN with intent classification
```

---

## Future Enhancements

- [ ] Add Apify web scraper actor support
- [ ] Add proxy rotation
- [ ] Add Redis caching layer
- [ ] Add more community sources (Stack Overflow, Dev.to)

---

## Troubleshooting

### No results?
1. Check logs for error stages
2. Try `SCRAPER_DEBUG=true` to save HTML
3. Verify sources are accessible from server
4. Add API keys if needed

### Blocked by sources?
- Reddit often blocks - try HN/Indie Hackers/Product Hunt first
- Direct HTTP has lower success rate - recommend ScraperAPI key