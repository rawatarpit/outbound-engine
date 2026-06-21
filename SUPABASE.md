# Supabase Setup

## Project

| Detail | Value |
|--------|-------|
| **URL** | `https://hxmwrjoorlaeshbtasxh.supabase.co` |
| **Reference** | `hxmwrjoorlaeshbtasxh` |
| **Region** | auto |

## Connection

```
SUPABASE_URL=https://hxmwrjoorlaeshbtasxh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
```

The service_role key is in `.env`. It bypasses all RLS — use only in the Express backend and edge functions.

## What Was Migrated

The Supabase project was replicated from the original project to `hxmwrjoorlaeshbtasxh` with:

- **67 tables** — full schema (clients, brand_profiles, client_members, client_settings, leads, campaigns, devices, system_flags, etc.)
- **240 RPCs** — all PostgreSQL functions (pipeline queries, send quota, etc.)
- **All enums and RLS policies**
- **22 edge functions** deployed at version 2 — login, signup, auth, brands, campaigns, clients, dashboard, discovery, keys, leads, me, pipeline, scoring, settings, sidebar-counts, system, team, templates, webhooks, workers, analytics, complete_job
- **Edge function secrets set** — `SENTRA_HMAC_KEY`, `CORS_ALLOWED_ORIGINS`, `RELAY_WEBHOOK_SECRET`
- **Seed data** — 2 clients, 2 brand_profiles, 2 client_members, 2 client_settings

## Seed Data

| Client | Email | User ID |
|--------|-------|---------|
| Test | try@gmail.com | `e007ac39-...` |
| Fruitloop Creative | vikramstephen8@gmail.com | `d1c5e295-...` |

Both clients have `client_settings` configured with LLM provider set to `openai` (NVIDIA endpoint via `https://integrate.api.nvidia.com`).

## Edge Functions

22 functions deployed at `https://hxmwrjoorlaeshbtasxh.supabase.co/functions/v1/`.

| Function | Purpose |
|----------|---------|
| `login` | Email/password auth, returns Supabase JWT |
| `signup` | Create account + client |
| `auth` | Device token auth (x-agent-token) |
| `brands` | Brand CRUD |
| `campaigns` | Campaign management |
| `clients` | Client settings |
| `dashboard` | Dashboard metrics |
| `discovery` | Discovery triggers |
| `keys` | API key management |
| `leads` | Lead CRUD + pipeline operations |
| `me` | Current user profile |
| `pipeline` | Pipeline stage queries |
| `scoring` | Lead scoring |
| `settings` | Client settings |
| `sidebar-counts` | Pipeline stage counts |
| `system` | System operations |
| `team` | Team member management |
| `templates` | Email templates |
| `webhooks` | Webhook management |
| `workers` | Background worker triggers |
| `analytics` | Analytics data |
| `complete_job` | Job completion |

## Local Development

### Prerequisites

- Node.js 18+
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`

### Resetting the Database

If you need to reset:

```bash
# Apply migrations
psql "$SUPABASE_URL" -f supabase/migrations/20250101000000_remote_schema.sql
psql "$SUPABASE_URL" -f supabase/migrations/20260701000000_saved_queries.sql

# Seed data
psql "$SUPABASE_URL" -f supabase/seed.sql
```

### Deploying Edge Functions

```bash
supabase functions deploy --project-ref hxmwrjoorlaeshbtasxh
```

## System Flags Bug

`system_flags` has a primary key constraint on `key` alone (not `(client_id, key)`). This means keys like `'automation_enabled'` can only exist once across all clients. This is a schema issue — if you create a new client and the trigger tries to insert a row with a key that already exists, it will fail with a duplicate key error.

**Workaround**: Delete the conflicting row before creating a new client:
```sql
DELETE FROM system_flags WHERE key IN ('automation_enabled','send_enabled','imap_enabled','discovery_enabled');
```

## Auth

The Express app verifies JWTs via `supabase.auth.getUser()` (Supabase Auth API), not via a shared `JWT_SECRET`. The `JWT_SECRET` env var is optional and unused. See `AUTH-FLOW.md` for details.
