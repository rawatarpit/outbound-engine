# End-to-End Testing Guide — Discovery Pipeline

> **Testing the discovery-first workflow**
> **Supabase:** Your cloud instance

---

## Deployment — OCI Instances

### Instance Details

| Instance | Public IP | Shape | OS |
|----------|-----------|-------|-----|
| ARM Server | 129.154.254.115 | VM.Standard.A1.Flex (6GB) | Ubuntu 22.04 aarch64 |
| x86 Server | 80.225.210.56 | VM.Standard.E2.1.Micro (1GB) | Ubuntu 22.04 |

### Deploy to Both Servers

```bash
# 1. Upload release archive
scp -i ~/.ssh/your-key outbound-engine-release.tar.gz ubuntu@129.154.254.115:/home/ubuntu/
scp -i ~/.ssh/your-key outbound-engine-release.tar.gz ubuntu@80.225.210.56:/home/ubuntu/

# 2. SSH into each server and run:
ssh -i ~/.ssh/your-key ubuntu@129.154.254.115

# On both servers:
tar -xzf outbound-engine-release.tar.gz
cp .env.example .env
# Edit .env with your configuration

npm install

# 3. Start the engine
npm run start                    # Main API server
npm run dev                    # Development mode (auto-reload)

# Or with PM2 for production:
npm install -g pm2
npm run pm2:all              # Start all workers
pm2 logs                     # View logs
pm2 status                    # Check status
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run start` | Main API server |
| `npm run dev` | Development mode |
| `npm run enrichment` | Enrichment worker |
| `npm run discovery` | Discovery processor |
| `npm run send` | Send processor |
| `npm run inbound` | Inbound email listener |
| `npm run pm2:all` | Start all workers via PM2 |
| `npm run pm2:stop` | Stop all PM2 processes |

---

## Prerequisites

### 1. Environment Variables

Create `.env` file in project root:

```bash
# Supabase (required)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# LLM Provider - GROQ (recommended for testing)
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxx

# Node
NODE_ENV=production
LOG_LEVEL=info
PORT=10000
```

### 2. Get Groq API Key

1. Go to https://console.groq.com/keys
2. Create new API key
3. Add to `.env` as `GROQ_API_KEY`

### 3. Test Connectivity

```bash
# Test Groq API
curl https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"

# Test DB connection
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
sb.from('system_flags').select('key').limit(1).then(({ data, error }) => {
  if (error) { console.error('❌ DB FAIL:', error.message); process.exit(1); }
  console.log('✅ DB connected');
});
"
```

---

## Step 1 — Create Test Brand

Run in Supabase SQL Editor:

```sql
-- Create test client
INSERT INTO public.clients (id, name, slug, plan, owner_email, daily_send_limit, hourly_send_limit, leads_limit, is_active)
VALUES (
  gen_random_uuid(),
  'Test Client Discovery',
  'test-client-discovery',
  'starter',
  'admin@testclient.com',
  50,
  10,
  1000,
  true
)
RETURNING id;
-- Save as $CLIENT_ID

-- Create test brand
INSERT INTO public.brand_profiles (
  id, client_id, product, brand_name, positioning, core_offer, tone, audience,
  smtp_host, smtp_port, smtp_secure, smtp_email, smtp_password,
  imap_host, imap_port, imap_secure, imap_email, imap_password,
  provider, transport_mode,
  daily_send_limit, hourly_send_limit,
  discovery_enabled, discovery_daily_limit,
  is_active, is_paused, outbound_enabled
)
VALUES (
  gen_random_uuid(),
  '$CLIENT_ID',
  'test-product',
  'Test Brand',
  'We help SaaS companies',
  'AI outbound engine',
  'professional',
  'SaaS founders',
  'smtp.gmail.com', 587, false, 'test@yourdomain.com', 'app_password',
  'imap.gmail.com', 993, true, 'test@yourdomain.com', 'app_password',
  'smtp', 'mailbox',
  20, 5,
  true, 100,
  true, false, true
)
RETURNING id;
-- Save as $BRAND_ID
```

---

## Step 2 — Test CSV Discovery Source

### 2a. Create Test CSV File

Create `/tmp/test_companies.csv`:

```csv
name,domain,email,first_name
Acme Corp,acme.com,john@acme.com,John
TechStart,techstart.io,jane@techstart.io,Jane
DataFlow,dataflow.co,mike@dataflow.co,Mike
```

### 2b. Create Discovery Source

```sql
INSERT INTO public.brand_discovery_sources (
  brand_id, client_id, name, type, config, is_active, execution_mode, rate_limit_per_min
)
VALUES (
  '$BRAND_ID', '$CLIENT_ID',
  'Test CSV Source',
  'csv',
  '{"file_path": "/tmp/test_companies.csv", "column_map": {"name": "name", "domain": "domain", "email": "email"}}'::jsonb,
  true, 'pull', 60
)
RETURNING id;
-- Save as $SOURCE_ID
```

### 2c. Trigger Discovery

```sql
-- Request manual discovery
SELECT public.rpc_request_manual_discovery(p_brand_id := '$BRAND_ID');
```

### 2d. Run Discovery Worker

```bash
# Option 1: Direct
npm run discovery

# Option 2: Via PM2
pm2 start npm --name outbound-discovery -- run discovery
```

### 2e. Verify Discovery Results

```sql
-- Check discovered companies
SELECT domain, name, status, confidence FROM public.discovered_companies
WHERE brand_id = '$BRAND_ID';

-- Check discovered contacts
SELECT email, first_name, full_name, domain, status, requires_enrichment
FROM public.discovered_contacts
WHERE brand_id = '$BRAND_ID';
```

---

## Step 3 — Test Hunter Executor

```sql
-- 3a. Create Hunter source (requires HUNTER_API_KEY in config)
INSERT INTO public.brand_discovery_sources (
  brand_id, client_id, name, type, config, is_active, execution_mode, rate_limit_per_min
)
VALUES (
  '$BRAND_ID', '$CLIENT_ID',
  'Hunter Source',
  'hunter',
  '{"domain": "techstart.io"}'::jsonb,
  true, 'pull', 10
)
RETURNING id;
-- Save as $HUNTER_SOURCE_ID
```

```bash
# Run discovery for this source
npm run discovery
```

Verify:
```sql
SELECT email, first_name, full_name, domain, source
FROM public.discovered_contacts
WHERE brand_id = '$BRAND_ID' AND source = 'hunter';
```

---

## Step 4 — Test Apollo Executor

```sql
-- 4a. Create Apollo source (requires APOLLO_API_KEY)
INSERT INTO public.brand_discovery_sources (
  brand_id, client_id, name, type, config, is_active, execution_mode, rate_limit_per_min
)
VALUES (
  '$BRAND_ID', '$CLIENT_ID',
  'Apollo Source',
  'apollo',
  '{"query": "category=company_size:1-10", "limit": 10}'::jsonb,
  true, 'pull', 5
)
RETURNING id;
```

Run and verify:
```sql
SELECT domain, name, source, confidence
FROM public.discovered_companies
WHERE brand_id = '$BRAND_ID' AND source = 'apollo';
```

---

## Step 5 — Test Enriched Contact Flow

Contacts with high confidence auto-ingest as leads.

```sql
-- Check which contacts were auto-ingested
SELECT id, email, status, enrichment_status
FROM public.discovered_contacts
WHERE brand_id = '$BRAND_ID';

-- If requires_enrichment=true, manual lead creation needed
-- Check leads table for auto-ingested
SELECT id, email, first_name, domain, source, status
FROM public.leads
WHERE brand_id = '$BRAND_ID' AND source = 'discovery';
```

---

## Step 6 — Test Contact Processing (Validation + Ingestion)

The contact processor runs automatically via discovery scheduler.

```bash
# Run discovery processor (includes contact processing)
pm2 start npm --name outbound-discovery -- run discovery
```

Or test manually:
```bash
# Process pending contacts
node -e "
const { startDiscoveryProcessor } = require('./dist/discovery/processor');
startDiscoveryProcessor();
"
```

Verify:
```sql
-- Contacts marked for enrichment
SELECT email, enrichment_status, requires_enrichment
FROM public.discovered_contacts
WHERE brand_id = '$BRAND_ID' AND enrichment_status = 'pending';

-- Leads created (auto-ingested)
SELECT email, status, lead_score
FROM public.leads
WHERE brand_id = '$BRAND_ID';
```

---

## Step 7 — Test Enrichment Worker

Contacts marked `requires_enrichment=true` need enrichment before lead creation.

```bash
# Run enrichment worker
npm run enrichment

# Or via PM2
pm2 start npm --name outbound-enrichment -- run enrichment
```

Verify:
```sql
SELECT email, enrichment_status, enrichment_attempts
FROM public.discovered_contacts
WHERE brand_id = '$BRAND_ID'
ORDER BY created_at DESC LIMIT 10;
```

---

## Step 8 — Test Send Pipeline

Once contacts become leads and pass scoring:

```sql
-- Check leads ready for outreach
SELECT id, email, first_name, status
FROM public.leads
WHERE brand_id = '$BRAND_ID' AND status = 'icp_passed';

-- Set up outreach company
INSERT INTO public.companies (brand_id, lead_id, domain, name, status)
SELECT '$BRAND_ID', id, domain, COALESCE(company_name, domain), 'new'
FROM public.leads
WHERE brand_id = '$BRAND_ID' AND status = 'icp_passed'
LIMIT 1
RETURNING id;
-- Save as $COMPANY_ID
```

Run outreach agent (generate draft):
```bash
node -e "
const { runOutreachAgent } = require('./dist/agents/outreach');
runOutreachAgent({ id: '$COMPANY_ID', brand_id: '$BRAND_ID' })
  .then(r => console.log(JSON.stringify(r, null, 2)));
"
```

Send:
```bash
npm run send
```

Verify:
```sql
SELECT subject, status, sent_at
FROM public.sent_messages
WHERE company_id = '$COMPANY_ID';
```

---

## Step 9 — Full Discovery Pipeline Checklist

- [ ] DB connection ✅
- [ ] Client & brand created ✅
- [ ] CSV source discovers companies ✅
- [ ] CSV source discovers contacts ✅
- [ ] Hunter source works ✅
- [ ] Apollo source works ✅
- [ ] Discovered contacts validated ✅
- [ ] High-confidence contacts auto-ingested as leads ✅
- [ ] Enrichment worker processes pending contacts ✅
- [ ] Lead scoring works ✅
- [ ] Outreach agent generates draft ✅
- [ ] Email sent ✅

---

## Supported Discovery Sources

| Source | Type | Risk Level | Requires API Key |
|--------|------|-----------|------------------|
| CSV | `csv` | SAFE_API | No |
| Hunter | `hunter` | SAFE_API | Yes |
| Apollo | `apollo` | SAFE_API | Yes |
| GitHub | `github` | MODERATE_PUBLIC | No |
| ProductHunt | `producthunt` | MODERATE_PUBLIC | No |
| IndieHackers | `indiehackers` | MODERATE_PUBLIC | No |
| Reddit | `reddit` | MODERATE_PUBLIC | No |
| URL Scraper | `urlScraper` | HIGH_SCRAPE | No |
| Apify | `apify` | Varies | Yes |

---

## Cleanup

```sql
-- Remove test data
DELETE FROM public.sent_messages WHERE brand_id = '$BRAND_ID';
DELETE FROM public.outreach WHERE brand_id = '$BRAND_ID';
DELETE FROM public.leads WHERE brand_id = '$BRAND_ID';
DELETE FROM public.companies WHERE brand_id = '$BRAND_ID';
DELETE FROM public.discovered_contacts WHERE brand_id = '$BRAND_ID';
DELETE FROM public.discovered_companies WHERE brand_id = '$BRAND_ID';
DELETE FROM public.brand_discovery_sources WHERE brand_id = '$BRAND_ID';
DELETE FROM public.brand_profiles WHERE id = '$BRAND_ID';
DELETE FROM public.clients WHERE id = '$CLIENT_ID';
```

---

## Troubleshooting

```bash
# View discovery logs
pm2 logs outbound-discovery

# Check pending sources
psql -c "SELECT id, name, status FROM brand_discovery_sources WHERE status = 'pending';"

# Force retry a failed source
UPDATE brand_discovery_sources SET status = 'pending' WHERE id = '$SOURCE_ID';

# Check processor errors
psql -c "SELECT * FROM discovery_logs ORDER BY created_at DESC LIMIT 10;"
```

---

*Last update: April 2026*