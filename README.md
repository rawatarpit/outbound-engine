# Outbound Engine

An autonomous, event-driven email outreach system that discovers leads, crafts personalized outreach, sends emails, processes replies, and manages the full sales pipeline automatically.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OUTBOUND ENGINE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│   │ Discovery  │────▶│ Enrichment  │────▶│ Outgoing   │ │
│   │ Scheduler  │     │   Worker    │     │  Processor │ │
│   └──────────────┘     └──────────────┘     └──────────────┘ │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│   ┌──────────────────────────────────────────────────┐      │
│   │              Supabase Database                   │      │
│   │  • brand_intents (signal definitions)          │      │
│   │  • opportunities (signal-driven queue)         │      │
│   │  • discovered_companies / leads              │      │
│   │  • messages / replies                        │      │
│   └──────────────────────────────────────────────────┘ │
│                              │                          │
│                              ▼                          │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│   │ IMAP       │◀────│  State      │◀────│  SMTP       │ │
│   │ Inbound   │     │  Machine    │     │  Sender     │ │
│   └──────────────┘     └──────────────┘     └──────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [System Modes](#system-modes)
3. [Database Schema](#database-schema)
4. [Discovery System](#discovery-system)
5. [Enrichment System](#enrichment-system)
6. [Outbound System](#outbound-system)
7. [Supabase Edge Functions](#supabase-edge-functions)
8. [Scrapling Setup](#scrapling-setup)
9. [Configuration](#configuration)
10. [Running the System](#running-the-system)
11. [Extending the System](#extending-the-system)
12. [Environment Variables](#environment-variables)
13. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+ (for Scrapling)
- Supabase project
- PostgreSQL database

### Installation

```bash
# Clone and install dependencies
npm install

# Install Scrapling for discovery
pip install scrapling
scrapling install  # Install browsers and dependencies

# Set up environment
cp .env.example .env
# Edit .env with your Supabase credentials
```

### Start Discovery

```bash
npm run discovery:scheduler
```

---

## System Modes

### 1. Legacy Mode (Source-First)

```
Claim Sources → Execute → Deduplicate → Store → Enrich
```

Uses `brand_discovery_sources` table with fixed executors:
- GitHub
- Apollo
- Hunter
- Reddit
- ProductHunt
- IndieHackers
- CSV

### 2. Signal-Driven Mode (Intent-First)

```
Brand → Intent → Signals → Query Generator → Search Adapters → Normalize → Opportunities → Enrichment → Leads
```

Uses `brand_intents` and `opportunities` tables:
- Dynamic query generation based on brand profile
- Adapters: Google (Scrapling), Jobs API, Reddit

---

## Database Schema

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `clients` | Multi-tenant organization | name, plan, daily_send_limit, discovery_enabled |
| `client_members` | User membership | client_id, user_id, role, email |
| `brand_profiles` | Brand/Product configuration | product, positioning, audience, smtp_*, discovery_* |
| `brand_intents` | Signal intent definitions | brand_id, intent, signals (jsonb), priority |
| `opportunities` | Signal-driven discovery queue | brand_id, intent_id, name, domain, signal, score |
| `discovered_companies` | Legacy discovery queue | brand_id, domain, confidence, enrichment_status |
| `discovered_contacts` | Legacy contact queue | brand_id, discovered_company_id, email, title |

### Lead Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `leads` | Individual contacts | email, domain, title, status, confidence_score, lead_score |
| `companies` | Accounts/companies | name, domain, status, deal_value, brand_id |
| `lead_company_map` | Lead-company relationship | lead_id, company_id, brand_id |

### Communication Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `messages` | Draft emails | lead_id, subject, body, status, brand_id |
| `sent_messages` | Send tracking | lead_id, smtp_message_id, status, sent_at |
| `replies` | Inbound responses | company_id, intent, sentiment, meeting_requested |

### Discovery Tables

| Table | Purpose |
|-------|---------|
| `brand_discovery_sources` | Legacy source configurations |
| `brand_intents` | Signal intent definitions |
| `opportunities` | Signal-driven queue |
| `discovered_companies` | Company discovery queue |
| `discovered_contacts` | Contact discovery queue |
| `discovery_metrics` | Execution stats |

### Metrics Tables

| Table | Purpose |
|-------|---------|
| `discovery_metrics` | Discovery execution stats |
| `signal_performance` | Signal performance tracking |
| `signal_source_performance` | Source-level performance |
| `campaign_analytics` | Campaign stats |

### Supporting Tables

| Table | Purpose |
|-------|---------|
| `activity_logs` | Activity tracking |
| `audit_logs` | Audit trail |
| `blacklist` | Suppression list |
| `circuit_breaker_state` | Circuit breaker state |
| `api_rate_limit` | Rate limiting |
| `dead_letter_queue` | Failed message queue |

---

## Discovery System

### Signal Types

| Signal | Weight | Description | Adapters |
|--------|--------|-------------|----------|
| `hiring` | 30 | Companies actively hiring | Jobs API, Google |
| `funding` | 25 | Companies with funding | Google |
| `launch` | 20 | New product launches | ProductHunt, Google |
| `pain` | 25 | Pain points expressed | Reddit, Google |
| `advertising` | 20 | Running paid ads | Google |
| `partnership` | 15 | Seeking partnerships | Google |
| `tech_usage` | 15 | Using relevant tech | Google |
| `growth_activity` | 10 | Scaling/growing | Reddit, Google |

### Signal Discovery Flow

```
1. claimBrandIntents() - Get active intents from DB
2. generateQueries() - Generate search queries from brand profile
3. SearchAdapter.fetch() - Execute search via Scrapling
4. normalize() - Convert to opportunities
5. enrichOpportunities() - Enrich with company data
6. convertToLeads() - Create lead records
```

### Key Discovery RPC Functions

| Function | Purpose |
|----------|---------|
| `rpc_claim_brand_intents` | Claim intents for processing |
| `rpc_claim_discovery_sources` | Claim legacy sources |
| `rpc_release_discovery_source` | Release source after processing |
| `rpc_request_manual_discovery` | Trigger manual discovery |
| `increment_discovery_counter` | Increment daily count |
| `reset_discovery_counters` | Reset daily counters |

### Adapters

#### SearchAdapter (Google Search)

- **Source**: `google_search`
- **Default**: Scrapling (free, no API key)
- **Fallback**: Zenserp (if API key configured)
- **Signal Types**: All

```typescript
// Usage
const adapter = new SearchAdapter({ zenserpApiKey: "optional-key" })
const results = await adapter.fetch({ query: "companies using CRM hiring", signal: "hiring" })
const opportunities = adapter.normalize(results.raw)
```

#### JobsAdapter

- **Source**: `adzuna`
- **Signal Types**: `hiring`

#### RedditAdapter

- **Source**: `reddit`
- **Signal Types**: `pain`, `growth_activity`

---

## Enrichment System

### Enrichment Flow

```
1. claimCompaniesForEnrichment() - Get companies needing enrichment
2. executeEnrichment() - Run enrichment strategies
3. updateCompanyEnrichment() - Store results
4. convertToLeads() - Create lead records
```

### Enrichment Strategies

| Strategy | Source | Priority |
|----------|--------|----------|
| `apollo` | Apollo.io | 1 |
| `hunter` | Hunter.io | 2 |
| `company_website` | Direct scrape | 3 |
| `llm_fallback` | LLM inference | 4 |

### Key Enrichment RPC Functions

| Function | Purpose |
|----------|---------|
| `claim_companies_for_enrichment` | Get companies to enrich |
| `claim_contacts_for_enrichment` | Get contacts to enrich |
| `update_company_enrichment` | Update company data |
| `update_contact_enrichment` | Update contact data |
| `rpc_complete_discovered_company` | Mark company complete |
| `rpc_complete_discovered_contact` | Mark contact complete |

---

## Outbound System

### Send Flow

```
1. claimOutreachDraft() - Get draft to send
2. runOutreachAgent() - Generate personalized email
3. sendEmail() - Send via SMTP/Resend
4. markLeadContacted() - Update lead status
5. recordDiscoveryMetric() - Track metrics
```

### Email Providers

| Provider | Key Fields |
|-----------|------------|
| `smtp` | smtp_host, smtp_port, smtp_email, smtp_password |
| `resend` | provider_api_key |

### Key Send RPC Functions

| Function | Purpose |
|----------|---------|
| `rpc_claim_outreach_draft` | Get draft to send |
| `check_client_send_quota` | Check send quota |
| `consume_send_quota` | Reserve send slot |
| `rpc_mark_lead_contacted` | Mark as contacted |

---

## Supabase Edge Functions

### Available Functions

| Function | Purpose | Endpoint |
|----------|---------|----------|
| Auth | Login/Signup | `/auth`, `/login`, `/signup` |
| Clients | Client management | `/clients` |
| Brands | Brand CRUD | `/brands` |
| Discovery | Discovery control | `/discovery` |
| Leads | Lead management | `/leads` |
| Pipeline | Pipeline overview | `/pipeline` |
| Campaigns | Campaign management | `/campaigns` |
| Analytics | Analytics data | `/analytics` |
| Webhooks | Webhook management | `/webhooks` |
| Settings | User settings | `/settings` |
| Scoring | Lead scoring | `/scoring` |
| Templates | Email templates | `/templates` |
| Team | Team management | `/team` |
| Dashboard | Dashboard data | `/dashboard` |
| Workers | Background workers | `/workers` |
| System | System status | `/system` |

### Authentication

All functions require Bearer token in Authorization header:

```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/brands', {
  headers: {
    'Authorization': 'Bearer <user-jwt-token>',
    'Content-Type': 'application/json'
  }
})
```

---

## Scrapling Setup

### What is Scrapling?

[Scrapling](https://github.com/D4Vinci/Scrapling) is a free, open-source web scraping framework that:
- Bypasses anti-bot protection (Cloudflare, etc.)
- Uses adaptive element tracking
- Supports proxy rotation
- Has MCP server integration

### Installation

```bash
# Install Scrapling
pip install scrapling

# Install browser dependencies
scrapling install

# Or force reinstall
scrapling install --force
```

### How It Works in This System

The `SearchAdapter` uses Scrapling by default:

```
1. executeScraplingSearch(query)
   - Runs: scrapling extract stealthy-fetch "https://google.com/search?q=..." 
   - Uses: --solve-cloudflare --css-selector .g .rc
2. If Scrapling fails → executeZenserpSearch() (if API key configured)
3. If both fail → return empty results
```

### Without API Key (Free)

- Scrapling is tried first
- No configuration needed
- Zero per-request cost

### With API Key (Optional)

To use Zenserp as fallback, set `discovery_api_key` in `brand_profiles`:

```sql
UPDATE brand_profiles 
SET discovery_api_key = 'your-zenserp-key'
WHERE id = 'brand-uuid';
```

---

## Configuration

### Brand Profile Configuration

| Field | Type | Description |
|-------|------|-------------|
| `product` | text | Product name |
| `positioning` | text | Positioning statement |
| `audience` | text | Target audience |
| `tone` | text | Email tone |
| `smtp_host` | text | SMTP server |
| `smtp_port` | integer | SMTP port |
| `smtp_email` | text | SMTP email |
| `smtp_password` | text | SMTP password |
| `provider` | text | Email provider (smtp/resend) |
| `provider_api_key` | text | Resend API key |
| `discovery_enabled` | boolean | Enable discovery |
| `discovery_daily_limit` | integer | Daily discovery limit |
| `discovery_api_key` | text | Zenserp API key (optional) |
| `outbound_enabled` | boolean | Enable outbound |
| `daily_send_limit` | integer | Daily send limit |

### Brand Intent Configuration

```sql
INSERT INTO brand_intents (brand_id, intent, signals, priority) VALUES
(
  'brand-uuid',
  'Find companies using CRMs',
  '["hiring", "tech_usage"]'::jsonb,
  1
);
```

### Signal Configuration

| Signal | Queries Generated |
|--------|-------------------|
| `hiring` | "[product] hiring", "[product] job openings" |
| `funding` | "[product] raised", "[product] series" |
| `launch` | "[product] launched", "[product] release" |
| `pain` | "[product] alternatives", "[product] problem" |
| `growth_activity` | "[product] scaling", "[product] growth" |

---

## Running the System

### Development

```bash
# All workers
npm run dev

# Individual workers
npm run discovery:scheduler
npm run enrichment
npm run send
npm run inbound

# Signal-driven discovery
npm run discovery
```

### Production (PM2)

```bash
# Start all workers
npm run pm2:all

# Individual workers
npm run pm2:discovery
npm run pm2:enrichment
npm run pm2:send
npm run pm2:inbound

# Stop all
npm run pm2:stop
```

### Build

```bash
npm run build
```

### Testing

```bash
npm run test
npm run test:watch
npm run test:coverage
```

---

## Extending the System

### Adding a New Signal Adapter

1. Create adapter in `src/discovery/signals/adapters/`:

```typescript
// src/discovery/signals/adapters/myadapter.ts
import { DiscoveryAdapter } from "../adapter"
import { SignalType } from "../types"

export class MyAdapter extends DiscoveryAdapter {
  source = "my_source"
  supportedSignals = ["hiring", "pain"]
  
  async fetch(params) {
    // Execute search
    const raw = await this.executeSearch(params.query)
    return { raw, metadata: {} }
  }
  
  normalize(raw) {
    // Convert to opportunities
    return raw.map(item => this.createOpportunity({...}))
  }
}
```

2. Register in `src/discovery/signals/engine.ts`:

```typescript
import { MyAdapter } from "./adapters/myadapter"

// Add to adapter registry
adapters.push(new MyAdapter())
```

### Adding a New Enrichment Strategy

1. Create strategy in `src/enrichment/strategies/`:

```typescript
export async function executeEnrichment(params) {
  // Your enrichment logic
  return { success: true, data: {...} }
}
```

2. Register in `src/enrichment/strategies/registry.ts`

### Adding a New Discovery Executor

1. Create executor in `src/discovery/executors/`:

```typescript
// src/discovery/executors/myexecutor/executor.ts
export async function myExecutor(config) {
  // Execute discovery
  return results
}

// src/discovery/executors/myexecutor/transform.ts
export function transformMyResult(raw) {
  return {...}
}
```

2. Register in `src/discovery/executor.ts`

---

## Environment Variables

### Required

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### Optional

```bash
# LLM
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.3
OLLAMA_API_KEY=xxx

# Resend (email)
RESEND_API_KEY=xxx

# SMTP (optional override)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=xxx
SMTP_PASS=xxx
```

---

## Database Indexes

### Key Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| `leads` | `idx_leads_brand_status` | Lead processing |
| `leads` | `idx_leads_next_retry` | Retry queue |
| `companies` | `idx_companies_brand_status` | Company processing |
| `opportunities` | `idx_opp_brand_qual_status` | Opportunity queue |
| `brand_intents` | `idx_brand_intents_active` | Intent discovery |
| `discovery_sources` | `idx_sources_ready` | Source queue |

---

## Row-Level Security

### RLS Policies

| Table | Policy | Access |
|-------|--------|--------|
| `brand_profiles` | own | client_id = client_id() |
| `leads` | own | client_id = client_id() |
| `companies` | own | client_id = client_id() |
| `messages` | own | client_id = client_id() |
| `client_members` | own | user_id = auth.uid() |

### Service Role

Service role bypasses all RLS. Use only in:
- Edge functions (server-side)
- Background workers

Never expose service role key in frontend code.

---

## Troubleshooting

### Discovery Not Running

```bash
# Check if discovery is enabled
SELECT discovery_enabled FROM brand_profiles WHERE id = 'brand-id';

# Enable if disabled
UPDATE brand_profiles SET discovery_enabled = true WHERE id = 'brand-id';
```

### No Opportunities Found

```bash
# Check intents exist
SELECT * FROM brand_intents WHERE brand_id = 'brand-id';

# Create intent if missing
INSERT INTO brand_intents (brand_id, intent, signals, priority)
VALUES ('brand-id', 'My Intent', '["hiring"]'::jsonb, 1);
```

### Scrapling Errors

```bash
# Verify Scrapling is installed
scrapling --version

# Reinstall browsers
scrapling install --force

# Test manually
scrapling extract get 'https://example.com' output.txt
```

### Rate Limiting

```bash
# Check rate limits
SELECT * FROM client_hourly_send WHERE client_id = 'client-id';
SELECT * FROM client_daily_send WHERE client_id = 'client-id';

# Wait for reset (hourly limits reset on the hour)
```

### Circuit Breaker Open

```bash
# Check circuit breaker state
SELECT * FROM circuit_breaker_state WHERE brand_id = 'brand-id';

# Reset if needed
UPDATE circuit_breaker_state SET state = 'closed' WHERE brand_id = 'brand-id';
```

---

## API Reference

### Key Functions in Code

#### Discovery Signals (`src/discovery/signals/`)

| Function | Purpose |
|----------|---------|
| `executeSignalDiscovery()` | Execute signal-driven discovery |
| `generateQueries()` | Generate search queries |
| `startSignalScheduler()` | Start scheduler loop |
| `getAdaptersForSignal()` | Get adapters for signal |

#### Enrichment (`src/enrichment/`)

| Function | Purpose |
|----------|---------|
| `processOpportunitiesForEnrichment()` | Process opportunities |
| `executeEnrichment()` | Run enrichment |
| `claimCompaniesForEnrichment()` | Get companies to enrich |

#### Outbound (`src/queue/`)

| Function | Purpose |
|----------|---------|
| `processSendQueue()` | Process email queue |
| `runOutreachAgent()` | Generate outreach |

#### Reputation (`src/reputation/`)

| Function | Purpose |
|----------|---------|
| `canSend()` | Check circuit breaker |
| `recordSuccess()` | Record success |
| `recordFailure()` | Record failure |
| `isSuppressed()` | Check suppression |

---

## Metrics & Monitoring

### Key Metrics

| Metric | Source Table |
|-------|--------------|
| Discovery Count | `discovery_count_today` (brand_profiles) |
| Send Count | `client_daily_send.send_count` |
| Reply Rate | `replies` table |
| Bounce Rate | `sent_messages.bounced_at` |

### Tracking

```sql
-- Discovery metrics
SELECT * FROM discovery_metrics ORDER BY executed_at DESC LIMIT 10;

-- Signal performance
SELECT * FROM signal_performance ORDER BY total_leads DESC;

-- Pipeline stages
SELECT status, COUNT(*) FROM companies GROUP BY status;
```

---

## Security

### Best Practices

1. **Never expose service role key** in frontend
2. **Use RLS** for all user-facing queries
3. **Validate input** in edge functions
4. **Rate limit** API endpoints
5. **Log audits** for sensitive operations

### Blacklist

```sql
-- Add to blacklist
INSERT INTO blacklist (email, domain, reason)
VALUES ('bad@example.com', 'spam.com', 'spam');

-- Check before sending
SELECT isBlacklisted('email@example.com');
```

---

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: Update this README
- Supabase: Use dashboard for manual database operations

---

## License

BSD-3-Clause License