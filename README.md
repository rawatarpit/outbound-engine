# Outbound Engine v2

Autonomous multi-agent B2B outbound engine for lead generation, company discovery, contact enrichment, personalized outreach, qualification scoring, negotiation drafting, and reply analysis.

**Supabase-backed | Resend/IMAP-driven | LLM-integrated (Ollama/Groq/OpenAI) | PM2-managed**

---

## Architecture

```
src/
├── index.ts                     # Entry: cron scheduler, IMAP monitor, webhook server
│
├── agents/                      # 7 specialized AI agents
│   ├── research.ts              #   Company research
│   ├── deepResearch.ts          #   Enhanced deep research (Playwright + LLM)
│   ├── outreach.ts              #   Personalized email generation
│   ├── qualification.ts         #   Lead scoring (0-100)
│   ├── negotiation.ts           #   Negotiation draft generation
│   ├── replyAnalysis.ts         #   Email intent classification + auto-unsubscribe
│   └── feedback.ts              #   Per-brand feedback loop
│
├── harness/                     # Agent execution framework (error handling, observability, tool registry)
├── orchestrator/                # State machine, lifecycle management, retry policy
│
├── discovery/                   # Dual-path discovery engine
│   ├── signals/                 #   Signal-driven pipeline (20 adapters + query generation + buffered logging)
│   ├── rag/                     #   Vector embeddings + similarity search with RAG
│   ├── core/                    #   Signal processing pipeline (extraction, validation, scoring)
│   ├── contacts/                #   Contact discovery + LLM enrichment
│   ├── utils/                   #   Shared utilities (query cache, rate limiter, domain resolver, ...)
│   └── adapters/                #   Platform-specific source adapters (Reddit, HN, ProductHunt, ...)
│
├── enrichment/                  # Multi-strategy enrichment (9 strategies: website scrape, Apollo, Hunter, Prospeo, SMTP verification, ...)
├── email/                       # Email delivery (Resend/SMTP) + IMAP monitoring
├── queue/                       # Send queue processing
├── reputation/                  # Sender reputation (circuit breaker, bounce classification, throttling, domain health)
├── llm/                         # LLM clients (Ollama, Groq, OpenAI) + sanitization
├── db/                          # Supabase client + 80+ data access functions
└── config/                      # Environment validation + reliability constants
```

---

## Pipeline (State Machine)

```
Research → Qualification → Outreach → Send
  ↑             ↑              ↑
Discovery ── Enrichment ──────┘
```

The state machine runs every minute per brand:
1. **Claim** — pick companies from the queue
2. **Research** — run the research agent → store research data
3. **Qualify** — score the lead (0-100) using industry, pain points, buying signals, automation maturity
4. **Outreach** — generate a personalized email draft
5. **Sync** — prepare leads for send

---

## Discovery Engine

Two parallel paths:

### Source-driven
Per-platform adapters that scrape structured data from Reddit, Hacker News, ProductHunt, RemoteOK, IndieHackers, and more.

### Signal-driven
1. **RAG search** — embed brand context and find similar past intents
2. **Query generation** — LLM generates targeted search queries per intent
3. **Phase 1 (Broad search)** — dispatch queries across 20+ adapters
4. **Phase 2 (Filter)** — domain validation, aggregator/enterprise filtering, keyword scoring
5. **Phase 3 (Deep dive)** — scrape + LLM extraction, composite scoring, company enrichment, contact discovery
6. **Phase 4 (Seed extraction)** — content-based lead discovery from scraped pages

---

## Performance Optimizations (Phase 1)

### Query Cache (`src/discovery/utils/query-cache.ts`)
In-memory cache with 30s TTL for Supabase queries. Reduces redundant DB calls across the pipeline.

```ts
import { queryCache } from "../utils/query-cache"

const data = await queryCache.getOrFetch("namespace", async () => {
  return supabase.from("table").select("col1, col2").eq("id", id)
}, "id", id)
```

### Batched Writes (`src/discovery/signals/engine.ts`)
`bufferQueryLogEntry()` replaces direct `supabase.insert()` calls. Buffers up to 20 entries or 30s before flushing — drastically reduces write operations on discovery_query_log. Graceful flush on SIGINT/SIGTERM.

### Column Pruning
All `.select("*")` replaced with explicit column lists across 6 files — cuts data transfer and memory usage:
- `contextAssembler.ts` — 4 queries pruned
- `qualification.ts`, `outreach.ts`, `negotiation.ts`, `replyAnalysis.ts` — agents only fetch needed fields
- `claim.ts` — explicit 8-column select instead of fetching raw_payload every cycle

### Supabase Archival (`archive-discovery.cjs`)
Node.js script that moves stale data from Supabase to a local PostgreSQL instance:

| Table | Window | Action |
|---|---|---|
| `discovery_query_log` | >7 days | Archive → Delete from Supabase |
| `discovered_companies.raw_payload` | Processed rows | Archive → Nullify |
| `research.raw_content` | >30 days | Archive → Nullify |

**Cron**: runs daily at 2 AM. Already archived 431+ rows on first run.

---

## Integrations

| Service | Purpose |
|---|---|
| **Supabase** | Primary database (80+ access functions, RPCs, edge functions) |
| **Resend** | Transactional email delivery |
| **SMTP** | Custom email delivery (nodemailer) |
| **IMAP** | Inbound email monitoring (ImapFlow) |
| **Ollama / Groq / OpenAI** | LLM inference + embeddings |
| **Apollo.io / Hunter.io / Prospeo** | Contact enrichment APIs |
| **Playwright** | Headless browser scraping |
| **Crawl4AI / FORGE** | Python-based scraping + enrichment |
| **DuckDuckGo / SearXNG** | Web search |
| **node-cron** | Scheduling |
| **PM2** | Process management (main engine + workers) |
| **Pino** | Structured JSON logging |

---

## Quick Start

```bash
cp .env.example .env
npm install
npm run build
```

### Run main engine
```bash
npm run dev           # ts-node-dev with hot-reload
npm start             # compiled dist
```

### Run workers
```bash
npm run discovery     # Signal-driven discovery worker
npm run enrichment    # Multi-strategy enrichment worker
npm run send          # Send queue processor
```

### PM2 (production)
```bash
npm run pm2:all       # Start all workers: discovery + enrichment + send
pm2 list              # Check status
pm2 logs              # Tail logs
```

### Archival (production)
```bash
node archive-discovery.cjs    # Manual archival run
# Or via cron (daily 2 AM):
0 2 * * * cd /path/to/outbound-engine && node archive-discovery.cjs >> logs/archive.log 2>&1
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run with ts-node-dev (hot reload) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled dist |
| `npm run enrichment` | Run enrichment worker |
| `npm run discovery` | Run discovery engine |
| `npm run discovery:scheduler` | Run discovery scheduler |
| `npm run discovery:processor` | Run discovery processor |
| `npm run send` | Run send processor |
| `npm test` | Run tests (Vitest) |
| `npm run pm2:all` | Start all PM2 managed processes |
| `node archive-discovery.cjs` | Run Supabase → local archive |

---

## Deployment

The engine runs under PM2 on Ubuntu. Updates are deployed via rsync:

```bash
rsync -avz --delete --exclude='node_modules' --exclude='dist' \
  --exclude='.git' --exclude='logs' --exclude='data' --exclude='.env' \
  ./ ubuntu@<server>:~/outbound-engine/ \
  -e "ssh -i <key>"

ssh <server> "cd ~/outbound-engine && npm install && npm run build && pm2 restart outbound-engine"
```
