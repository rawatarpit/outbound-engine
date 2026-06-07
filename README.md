# Outbound Engine v2

An agent-based B2B outbound engine for lead generation, company discovery, contact enrichment, personalized outreach, qualification scoring, negotiation drafting, and reply analysis.

## Architecture

```
src/
├── index.ts                  # Entry: cron scheduler, IMAP monitor, webhook server
├── agents/                   # 7 specialized agents
│   ├── research.ts           # Company research agent
│   ├── deepResearch.ts       # Enhanced deep research (Playwright + LLM)
│   ├── outreach.ts           # Personalized email generation
│   ├── qualification.ts      # Lead scoring (0-100)
│   ├── negotiation.ts        # Negotiation draft generation
│   ├── replyAnalysis.ts      # Email intent classification + auto-unsubscribe
│   └── feedback.ts           # Per-brand feedback loop
├── harness/                  # Agent execution framework
├── orchestrator/             # State machine, lifecycle, retry policy
├── discovery/                # Dual-path discovery engine
│   ├── adapters/             # Platform-specific source adapters (5)
│   ├── signals/              # Signal-driven pipeline (20 adapters)
│   ├── core/                 # Signal processing pipeline
│   ├── rag/                  # Vector embeddings + similarity search
│   ├── contacts/             # Contact discovery + enrichment
│   └── utils/                # 18 utility modules
├── enrichment/               # Multi-strategy enrichment (9 strategies)
├── email/                    # Email delivery (Resend/SMTP) + IMAP monitoring
├── queue/                    # Send queue processing
├── reputation/               # Sender reputation management
├── llm/                      # LLM client (Ollama/Groq/OpenAI)
├── db/                       # Supabase client + 80+ data access functions
└── config/                   # Env validation + reliability constants
```

## Pipeline

```
Research → Qualification → Outreach → Send
  ↑             ↑              ↑
Discovery ── Enrichment ──────┘
```

The state machine runs every minute per brand:
1. Claim companies from queue
2. Run research agent → store research
3. Run qualification agent → store score
4. Run outreach agent → store draft
5. Sync company leads → prepare for send

## Discovery

Two parallel paths:
- **Source-driven**: Per-platform adapters (Reddit, HN, ProductHunt, RemoteOK, IndieHackers)
- **Signal-driven**: RAG intent matching → query generation → 20 search adapters → signal extraction → opportunity matching → scoring → pre-validation → store

## Integrations

| Service | Purpose |
|---|---|
| Supabase | Primary database (80+ access functions, RPCs) |
| Resend | Transactional email delivery |
| SMTP | Custom email delivery (nodemailer) |
| IMAP | Inbound email monitoring (ImapFlow) |
| Ollama/Groq/OpenAI | LLM inference + embeddings |
| Apollo.io / Hunter.io / Prospeo | Contact enrichment APIs |
| Playwright | Headless browser scraping |
| Crawl4AI / FORGE | Python scraping + enrichment |
| DuckDuckGo / SearXNG | Web search |
| node-cron | Scheduling |
| PM2 | Process management |

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run with ts-node-dev |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled dist |
| `npm run enrichment` | Run enrichment worker |
| `npm run discovery` | Run discovery engine |
| `npm run send` | Run send processor |
| `npm test` | Run tests |
| `npm run pm2:all` | Run all PM2 processes |
