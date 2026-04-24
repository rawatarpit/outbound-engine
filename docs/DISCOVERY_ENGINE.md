# Discovery Engine - Scrapling-Powered Signal Extraction

## Goal
Build a production-ready discovery pipeline that uses Scrapling as the PRIMARY discovery engine to extract real buyer intent signals from communities for outbound lead generation.

## ⚠️ Non-negotiable Rules
- No Google scraping
- No API-based discovery (no Reddit API, Product Hunt API, etc.)
- Scrapling must be used for ALL sources
- All failures must be logged
- No silent failures - always log errors/warnings

---

## Architecture

### Sources (Scrapling-only)

| Source | URL | Status |
|--------|-----|--------|
| Reddit | `old.reddit.com/search?q=<query>&sort=new` | ✅ Primary |
| Hacker News | `hn.algolia.com/?q=<query>` | ✅ Active |
| Indie Hackers | `indiehackers.com/search?q=<query>` | ✅ Active |
| Product Hunt | `producthunt.com/search?q=<query>` | ✅ Active |

### Pipeline Flow

```
Input Query
    ↓
Query Simplification (5-10 variations)
    ↓
Reddit Search (loop through variations)
    ↓
[If < 10 results] → Hacker News
    ↓
[If < 10 results] → Indie Hackers
    ↓
[If < 10 results] → Product Hunt
    ↓
Intent Classification
    ↓
Normalize to Opportunities
    ↓
[If 0 results AND ALLOW_MOCK=true] → Mock Data
    ↓
[If 0 results] → Return empty (NO SILENT FALLBACK)
```

---

## Features

### 1. Query Simplification
Converts complex robotic queries like `"hiring sales representative B2B founders..."` into human variations:
- `b2b sales problems`
- `struggling with outbound`
- `can't get leads`
- `need help sales pipeline`
- `how to get customers SaaS`

### 2. Intent Classification
Each result is classified into:
- **pain** (85% score) - struggling, can't, help, frustrated, problem
- **hiring** (80% score) - looking for, hire, need someone, recruit
- **tool_search** (60% score) - recommend, best tool, alternatives, vs
- **discussion** (30% score) - low priority

### 3. Strict Failure Handling
- No mock data unless `ALLOW_MOCK=true`
- All failures are logged with stages
- Returns empty array if no results

### 4. Scrapling Rules
- Uses `stealthy-fetch` first, then `fetch`
- Includes headers: `User-Agent`, `Accept-Language`
- Adds delay: 2000-3000ms between requests
- DEBUG mode: `SCRAPER_DEBUG=true` saves raw HTML

---

## Logging Stages

| Stage | Meaning |
|-------|--------|
| `ADAPTER_EXECUTION` | Adapter started |
| `QUERY_VARIATIONS` | Generated variations count |
| `REDDIT_REQUEST` / `REDDIT_SUCCESS` | Reddit fetch |
| `HN_REQUEST` / `HN_SUCCESS` | Hacker News fetch |
| `INDIE_HACKERS_REQUEST` / `INDIE_HACKERS_SUCCESS` | Indie Hackers fetch |
| `PRODUCT_HUNT_REQUEST` / `PRODUCT_HUNT_SUCCESS` | Product Hunt fetch |
| `REQUEST_DELAY` | Delay between requests |
| `SEARCH_SUCCESS` | Final results with counts |
| `NO_RESULTS` | All sources failed |
| `FALLBACK_BLOCKED` | Mock not enabled |
| `SCRAPER_ERROR` | Scrapling failed |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SCRAPER_DEBUG=true` | Save raw HTML to `/tmp/scraper-debug-*.html` |
| `ALLOW_MOCK=true` | Enable mock fallback (only for testing) |

---

## Expected Output

Each run should produce:
- 10-50 real opportunities
- From multiple sources (not just one)
- With intent classification
- No mock data (unless enabled)

---

## Files

- `src/discovery/signals/adapters/search.ts` - Main SearchAdapter
- `src/discovery/signals/engine.ts` - Signal engine
- `src/discovery/types.ts` - Signal types

---

## Future Enhancements

- [ ] Add more scrape-friendly sources (Stack Overflow, Hacker News comments)
- [ ] Add date filtering (only recent posts)
- [ ] Add domain extraction from URLs
- [ ] Add duplicate detection
- [ ] Add scoring based on engagement (comments, votes)

---

## Git History

```
a6e0f06 - feat: add Indie Hackers + Product Hunt scraping, query simplification
83ca61e - feat: remove Google scraping, add Reddit + HN with intent classification
509ebd6 - fix: fallback to original results if Scrapling fails
bb4d93d - feat: robust SearchAdapter with Scrapling - no silent fallbacks
```

---

## Usage

```typescript
const adapter = new SearchAdapter()
const results = await adapter.fetch({
  query: "hiring sales rep for B2B SaaS",
  signal: "hiring"
})

// Returns SearchResult[] with intent classification
```