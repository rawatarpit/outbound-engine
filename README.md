# Outbound Engine Worker

An autonomous, event-driven email outreach system that discovers leads, crafts personalized outreach, sends emails, processes replies, and manages the full sales pipeline automatically.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OUTBOUND ENGINE WORKER                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐              │
│   │ Discovery  │────▶│ Enrichment  │────▶│ Outgoing   │              │
│   │ Scheduler  │     │   Worker    │     │  Processor │              │
│   └──────────────┘     └──────────────┘     └──────────────┘              │
│         │                   │                   │                              │
│         ▼                   ▼                   ▼                              │
│   ┌──────────────────────────────────────────────────────────┐              │
│   │              Supabase Database                      │              │
│   │  • discovered_companies                            │              │
│   │  • discovered_contacts                         │              │
│   │  • leads                                    │              │
│   │  • companies                                │              │
│   │  • messages                                 │              │
│   │  • replies                                  │              │
│   └──────────────────────────────────────────────────────────┘              │
│                              │                                          │
│                              ▼                                          │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐              │
│   │ IMAP        │◀────│  State      │◀────│  SMTP      │              │
│   │ Inbound    │     │  Machine    │     │  Sender    │              │
│   └──────────────┘     └──────────────┘     └──────────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Worker Flow (Start to Finish)

### 1. Discovery Scheduler (`src/discovery/scheduler.ts`)
**Triggers:** Manual request, cron schedule, or backlog check

```
Manual/Cron → Claim Sources → Execute Source → Record Metrics → Release Source
```

- Claims available discovery sources via `rpc_claim_discovery_sources()`
- Executes source-specific extraction logic
- Records metrics to `discovery_metrics`
- Releases source back for next run

### 2. Enrichment Worker (`src/enrichment/worker.ts`)
**Triggers:** New company/contact discovered

```
Claim → Enrich → Score → Update → Release
```

1. Claims pending items via `claim_companies_for_enrichment()`
2. Runs multi-strategy enrichment:
   - Domain enrichment (company data)
   - Email finder (contact discovery)
   - LLM inference (title, intent signals)
3. Computes confidence score from enrichment quality
4. Updates `discovered_companies` with enriched data
5. Marks as processed via `rpc_complete_discovered_company()`

### 3. Send Processor (`src/queue/sendProcessor.ts`)
**Triggers:** Available quota, draft-ready outreach

```
Reserve Quota → Validate → Generate → Send → Record → Update
```

1. Checks quota via `checkSendQuota()` 
2. Validates lead: `confidence_score >= 0.5`
3. Generates personalized email via Outreach Agent
4. Sends via SMTP (with thread metadata)
5. Records to `sent_messages`
6. Updates lead status to `contacted`

### 4. IMAP Inbound (`src/email/imap.ts`)
**Triggers:** New email in inbox (polling)

```
Fetch → Parse → Store → Analyze → Route
```

1. Connects to brand IMAP server
2. Fetches new messages
3. Parses and stores in `replies`
4. Runs `replyAnalysis` agent
5. Routes based on intent:
   - `unsubscribe` → suppress list
   - `meeting_requested` → negotiation
   - `objection` → objection handling
   - ` interested` → pipeline

### 5. State Machine (`src/orchestrator/stateMachine.ts`)
**Triggers:** Periodic cron, reply inserted

```
Check Companies → Get Replies → Analyze → Update → Trigger Agent
```

1. Claims companies in processing states
2. Gets latest reply via `replies.created_at DESC`
3. Runs reply analysis
4. Updates company status based on intent
5. Triggers downstream agents (negotiation, etc.)

### 6. Reputation Monitor (`src/reputation/domainReputation.ts`)
**Triggers:** Send attempt, bounce event

```
Check → ReserveQuota → BounceReport → Throttle
```

- Monitors bounce rates per sending domain
- Auto-disables domains exceeding 2% bounce threshold
- Manages warmup schedules

---

## Dynamic & Self-Healing Features

### Queue-Based Processing
All workers operate on a **claim-lock-release pattern**:
```
Claim (FOR UPDATE SKIP LOCKED) → Process → Update → Release
```
This enables:
- **Horizontal scaling** (multiple workers)
- **Crash resilience** (locked items auto-release on timeout)
- **At-least-once delivery** (retry on failure)

### Circuit Breaker
Prevents cascade failures:
```
Track Failure → Open → Half-Open → Close
```
- Opens after N consecutive failures
- Half-open probes every 30s
- Auto-recovers on success

### Dead Letter Queue
Failed items after max retries:
- Moved to `dead_letters` table
- Preserves full payload for manual review
- Enables reprocessing after fix

### Auto-Pause
Monitors health metrics:
- High bounce rate → pause brand
- High failure rate → pause client  
- Stuck processing → reclaim stale items

---

## Configuration

All config via environment:

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx

# Workers (optional, can use Supabase)
REDIS_URL=redis://localhost:6379

# LLM (optional)
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=llama3.3
```

---

## Running Workers

```bash
# All workers (PM2)
npm run pm2:all

# Individual workers
npm run dev         # Development
npm run discovery  # Discovery scheduler
npm run enrichment # Enrichment worker
npm run send      # Send processor
npm run inbound   # IMAP inbound
```

---

## Key Database Tables

| Table | Purpose |
|-------|--------|
| `discovered_companies` | Raw discovery queue |
| `leads` | Qualified prospects |
| `companies` | Accounts in pipeline |
| `outreach` | Draft emails |
| `sent_messages` | Send tracking |
| `replies` | Inbound responses |
| `dead_letters` | Failed items |

---

## Extending the Worker

### Adding a New Discovery Source
1. Add source type to `brand_discovery_sources`
2. Implement in `src/discovery/sources/`
3. Register in `src/discovery/engine.ts`

### Adding a New Lead Score
1. Add strategy to `scoring_versions`
2. Weights auto-adjust via `rpc_adjust_scoring_weights()`

### Adding a New Agent
1. Implement in `src/agents/`
2. Add to state machine transitions
3. Add RLS policy on target table

---

## Supabase Integration

This worker connects to a shared Supabase instance. Schema:
- Run `supabase/migrations/001_fix_engine_bugs.sql` for bug fixes
- Use service role for worker operations
- All state flows through database

## License

MIT