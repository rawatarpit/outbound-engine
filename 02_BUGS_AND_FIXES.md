# Outbound Engine — Bugs, Issues & Fixes

> Separated into: **Backend (Supabase/DB)** and **Engine/Worker (TypeScript)**  
> Severity: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## BACKEND — Supabase / Database

---

### 🔴 BUG-B01: Duplicate Client-Creation Triggers

**File:** `Supabase_Snippet_List_Database_Triggers.csv`

**Problem:**  
Two triggers on `clients` fire on INSERT: `trigger_handle_new_client` and `on_new_client`. Both call `handle_new_client()` which inserts a row into `system_flags`. The second trigger will silently fail (or succeed due to `ON CONFLICT DO NOTHING`) but this creates confusion, potential double execution of any side effects added later, and unnecessary DB overhead.

```sql
-- Both exist:
trigger_handle_new_client  → AFTER INSERT → EXECUTE FUNCTION handle_new_client()
on_new_client              → AFTER INSERT → EXECUTE FUNCTION handle_new_client()
```

**Fix:**
```sql
DROP TRIGGER IF EXISTS on_new_client ON public.clients;
-- Keep only: trigger_handle_new_client
```

---

### 🔴 BUG-B02: Plaintext SMTP/IMAP Passwords in brand_profiles

**File:** `Supabase_Snippet_Database_Column_Inventory.csv`

**Problem:**  
`brand_profiles.smtp_password`, `brand_profiles.imap_password`, `brand_profiles.provider_api_key`, and `client_settings.smtp_password`, `client_settings.imap_password`, `client_settings.provider_api_key` are stored as plaintext `text` columns. The `edge_function_secrets` table also stores `key_value` as plaintext.

**Risk:** Any SQL injection, misconfigured RLS, or compromised service role key exposes all client email credentials.

**Fix:**
```sql
-- Option 1: Use pgcrypto for symmetric encryption
ALTER TABLE brand_profiles ADD COLUMN smtp_password_enc bytea;
UPDATE brand_profiles 
SET smtp_password_enc = pgp_sym_encrypt(smtp_password, current_setting('app.encryption_key'));
-- Decrypt via SECURITY DEFINER function only

-- Option 2: Store credentials in Supabase Vault (preferred)
-- Use supabase_vault.create_secret() and retrieve via vault.decrypted_secrets
```

---

### 🔴 BUG-B03: `handle_new_client()` Inserts Wrong Schema

**File:** `Supabase_Snippet_List_Public_Schema_Functions_and_Definitions.csv`

**Problem:**  
The `handle_new_client` function inserts into `system_flags` with columns that don't match the table's actual schema:

```sql
-- Function inserts:
INSERT INTO system_flags (client_id, key, automation_enabled, send_enabled, imap_enabled, discovery_enabled)

-- But system_flags table only has columns:
-- key (text), value (boolean), client_id (uuid)
-- There is NO: automation_enabled, send_enabled, imap_enabled, discovery_enabled
```

This trigger will **silently fail** on every new client creation because the column names don't exist on the table.

**Fix:**
```sql
CREATE OR REPLACE FUNCTION public.handle_new_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO system_flags (client_id, key, value)
  VALUES 
    (NEW.id, 'automation_enabled', true),
    (NEW.id, 'send_enabled', true),
    (NEW.id, 'imap_enabled', false),
    (NEW.id, 'discovery_enabled', true)
  ON CONFLICT (client_id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

---

### 🔴 BUG-B04: `rpc_insert_reply` References Non-Existent Column

**File:** `Supabase_Snippet_List_Public_Schema_Functions_and_Definitions.csv`

**Problem:**  
```sql
INSERT INTO replies (company_id, lead_id, message_id, body, subject, brand_id)
```
The `replies` table does **not** have a `lead_id` column (confirmed in column inventory) or a `body` column (column is `raw_message`) or a `subject` column. This function will always error.

**Actual replies columns:** `id, company_id, message_id, raw_message, intent, sentiment, objection_detected, meeting_requested, summary, created_at, confidence, analyzed_at, brand_id, client_id`

**Fix:**
```sql
CREATE OR REPLACE FUNCTION public.rpc_insert_reply(
  p_company_id uuid, p_lead_id uuid, p_message_id text, p_body text, p_subject text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO replies (company_id, message_id, raw_message, brand_id)
  SELECT p_company_id, p_message_id, p_body, brand_id
  FROM companies WHERE id = p_company_id
  ON CONFLICT (message_id) DO NOTHING;
  RETURN FOUND;
END;
$$;
```

---

### 🔴 BUG-B05: `rpc_insert_negotiation_draft` References Non-Existent Columns

**File:** `Supabase_Snippet_List_Public_Schema_Functions_and_Definitions.csv`

**Problem:**  
```sql
INSERT INTO public.messages (brand_id, company_id, body, direction)
```
The `messages` table does **not** have a `company_id` column. It has `lead_id`, `subject`, `body`, `message_id`, `direction`, `status`, `brand_id`, `client_id`. This function will always fail.

**Fix:**
```sql
CREATE OR REPLACE FUNCTION public.rpc_insert_negotiation_draft(p_company_id uuid, p_draft text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_brand_id uuid;
  v_lead_id uuid;
BEGIN
  SELECT brand_id INTO v_brand_id FROM public.companies WHERE id = p_company_id;
  
  SELECT lead_id INTO v_lead_id 
  FROM public.lead_company_map 
  WHERE company_id = p_company_id 
  LIMIT 1;

  INSERT INTO public.messages (brand_id, lead_id, body, direction, status)
  VALUES (v_brand_id, v_lead_id, p_draft, 'outbound', 'pending');
END;
$$;
```

---

### 🔴 BUG-B06: `rpc_mark_lead_contacted` References Non-Existent Column

**File:** `Supabase_Snippet_List_Public_Schema_Functions_and_Definitions.csv`

**Problem:**  
```sql
UPDATE public.leads
SET status = 'contacted', contacted_at = now(), updated_at = now()
```
The `leads` table does **not** have a `contacted_at` column. This UPDATE will fail in production.

**Fix:**
```sql
-- Either add the column:
ALTER TABLE public.leads ADD COLUMN contacted_at timestamp with time zone;

-- Or remove from the update:
UPDATE public.leads
SET status = 'contacted', last_outcome_at = now(), updated_at = now()
WHERE id = p_lead_id;
```

---

### 🔴 BUG-B07: `rpc_activate_scoring_version` Uses Wrong Column

**File:** `Supabase_Snippet_List_Public_Schema_Functions_and_Definitions.csv`

**Problem:**  
```sql
UPDATE scoring_versions
SET is_active = false
WHERE product = (SELECT product FROM scoring_versions WHERE id = p_version_id);
```
The `scoring_versions` table does **not** have a `product` column. It has `brand_id`. This function will always error or deactivate the wrong records.

**Fix:**
```sql
CREATE OR REPLACE FUNCTION public.rpc_activate_scoring_version(p_version_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE scoring_versions
  SET is_active = false
  WHERE brand_id = (SELECT brand_id FROM scoring_versions WHERE id = p_version_id);
  
  UPDATE scoring_versions
  SET is_active = true
  WHERE id = p_version_id;
END;
$$;
```

---

### 🔴 BUG-B08: `get_domain_health` References Non-Existent `domain` Column in `send_counters`

**File:** `Supabase_Snippet_List_Public_Schema_Functions_and_Definitions.csv`

**Problem:**  
```sql
FROM send_counters
WHERE brand_id = p_brand_id
  AND domain = p_domain   -- ← 'domain' column does not exist in send_counters
  AND created_at > NOW() - INTERVAL '24 hours';
```
`send_counters` columns are: `id, product, counter_type, bucket_start, send_count, created_at, brand_id`. There is no `domain` column. The function returns 0 values for all queries and the bounce rate calculation is always 0, making domain health always appear healthy.

**Fix:** Either add `domain text` column to `send_counters` or redesign to use `sending_domains` table which tracks per-domain metrics:
```sql
-- Add domain column:
ALTER TABLE public.send_counters ADD COLUMN domain text;

-- Or query sending_domains:
SELECT sent_today, bounce_count FROM sending_domains
WHERE brand_id = p_brand_id AND domain = p_domain;
```

---

### 🟠 BUG-B09: `register_domain_bounce` References Non-Existent `domain` in `send_counters`

Same root cause as BUG-B08. The bounce increment:
```sql
UPDATE send_counters
SET bounce_count = bounce_count + 1
WHERE brand_id = p_brand_id AND domain = p_domain -- no domain column, no bounce_count column
```
`send_counters` has no `bounce_count` column either. Bounces are silently not recorded, and `sending_domains` is never auto-disabled based on bounce rate, meaning the 2% cap is effectively never enforced.

**Fix:** Add `bounce_count integer DEFAULT 0` and `domain text` to `send_counters`, or redirect the bounce tracking to `sending_domains.bounce_count`.

---

### 🟠 BUG-B10: `disableDomain` in TypeScript References Non-Existent `disabled_reason` Column

**File:** `src/reputation/domainReputation.ts`

**Problem:**  
```typescript
await supabase.from("sending_domains").update({
  is_active: false,
  disabled_reason: reason,   // ← column does not exist
  disabled_at: new Date().toISOString(),  // ← column does not exist
})
```
`sending_domains` columns: `id, brand_id, domain, daily_limit, sent_today, total_sent, bounce_count, last_reset_at, is_active, created_at`. No `disabled_reason` or `disabled_at`. The update silently sets only `is_active = false` (or fails with strict mode).

**Fix:**
```sql
ALTER TABLE public.sending_domains ADD COLUMN disabled_reason text;
ALTER TABLE public.sending_domains ADD COLUMN disabled_at timestamp with time zone;
```

---

### 🟠 BUG-B11: `reserve_send_quota` RPC Does Not Exist

**File:** `src/reputation/domainReputation.ts`

**Problem:**  
`reserveQuota()` calls `supabase.rpc("reserve_send_quota", {...})` but this function is **not in the functions inventory**. It will always return an error, causing `quotaResult.allowed = false` and blocking all sends permanently.

The available functions are `rpc_reserve_daily_send` and `rpc_reserve_hourly_send` (separate) and `get_send_quota_status` (doesn't exist either).

**Fix:** Create the missing function or rewrite `reserveQuota()` to call the two existing RPCs:
```typescript
// In domainReputation.ts:
export async function reserveQuota(brandId: string, domain: string) {
  const dailyOk = await supabase.rpc('rpc_reserve_daily_send', { p_brand_id: brandId });
  if (!dailyOk.data) return { allowed: false, reason: 'daily_limit_exceeded' };
  
  const hourlyOk = await supabase.rpc('rpc_reserve_hourly_send', { p_brand_id: brandId });
  if (!hourlyOk.data) return { allowed: false, reason: 'hourly_limit_exceeded' };
  
  return { allowed: true };
}
```

---

### 🟠 BUG-B12: Overlapping and Potentially Conflicting RLS Policies

**File:** `Supabase_Snippet_List_Row-Level_Security_Policies.csv`

**Problem:**  
Multiple tables have 4–7 overlapping PERMISSIVE policies including:
1. `Allow all authenticated` (role=authenticated, using=true) — allows **all** authenticated users to see ALL rows
2. `{table}_can_view_own` (client_id = client_id()) — more restrictive

Because all policies are PERMISSIVE, they are OR'd — so the broad `Allow all authenticated` policy makes the scoped policies irrelevant. Any authenticated user can read all `brand_profiles`, `companies`, `leads`, `replies`, etc. from any client.

**Affected tables:** activity_logs, audit_logs, brand_discovery_sources, brand_profiles, client_api_keys, client_members, client_settings, client_webhooks, clients, companies, dead_letter_queue, discovered_companies, discovered_contacts, email_events, inbound_events, leads, messages, notification_preferences, outbound_events, replies, sent_messages.

**Fix:** Drop the broad `Allow all authenticated` policies:
```sql
DROP POLICY IF EXISTS "Allow all authenticated" ON public.brand_profiles;
DROP POLICY IF EXISTS "Allow all authenticated" ON public.companies;
DROP POLICY IF EXISTS "Allow all authenticated" ON public.leads;
-- ... repeat for each affected table
```

---

### 🟠 BUG-B13: `circuit_breaker_state` Has Wrong Unique Constraint for Upsert

**File:** `src/reputation/circuitBreaker.ts` + column inventory

**Problem:**  
`saveBreakerState` uses `{ onConflict: "brand_id" }` but the `circuit_breaker_state` unique index is on `(client_id, entity_type, entity_id)`, not on `brand_id` alone. The upsert may create duplicate rows or fail.

**Fix:**
```sql
-- Add unique index on brand_id for the upsert to work:
CREATE UNIQUE INDEX IF NOT EXISTS circuit_breaker_brand_unique 
ON public.circuit_breaker_state(brand_id) 
WHERE entity_type = 'brand';

-- Or change the upsert to use the composite key
```

---

### 🟡 BUG-B14: `daily_send_limits` Table Appears Unused / Duplicate

**File:** Column inventory

**Problem:**  
There are three overlapping daily send tracking tables: `daily_send_limits`, `daily_send_tracker`, and `client_daily_send`. The `daily_send_limits` table (columns: `product, send_date, sent_count`) only has `service_role` RLS — no code in the engine appears to write to or read from it. It may be a legacy artifact.

**Fix:** Verify if table is used and either clean it up or document its intended purpose.

---

### 🟡 BUG-B15: `send_counters` Has Two Conflicting Unique Indexes

**File:** Cron jobs CSV (actually the indexes CSV)

**Problem:**
```
idx_unique_send_hour: (brand_id, counter_type, bucket_start)
unique_product_bucket: (product, counter_type, bucket_start)
```
`send_counters` has both `brand_id` and `product` columns. `rpc_reserve_hourly_send` uses `brand_id`, while some functions use `product`. These are different fields and the table may be tracking duplicates via two different keys.

**Fix:** Decide on one canonical key (`brand_id`) and remove the `product` column or vice versa.

---

### 🟡 BUG-B16: `rpc_adjust_scoring_weights` Reads from Non-Existent `brand_profiles.scoring_config`

**File:** Functions inventory

**Problem:**
```sql
SELECT scoring_config INTO v_config FROM public.brand_profiles WHERE id = v_row.brand_id;
```
`brand_profiles` does not have a `scoring_config` column. The auto-tuning function will always fail silently.

**Fix:**
```sql
-- The config should come from scoring_versions:
SELECT scoring_config INTO v_config 
FROM public.scoring_versions 
WHERE brand_id = v_row.brand_id AND is_active = true
LIMIT 1;

-- And update back to scoring_versions, not brand_profiles:
UPDATE public.scoring_versions SET scoring_config = v_config 
WHERE brand_id = v_row.brand_id AND is_active = true;
```

---

### 🟡 BUG-B17: `rpc_recalibrate_lead_confidence` Updates Non-Existent `confidence` Column

**Problem:**
```sql
UPDATE public.leads
SET confidence = p_new_confidence, last_outcome_at = now()
WHERE id = p_lead_id;
```
`leads` has `confidence_score`, not `confidence`. Update silently fails.

**Fix:** `SET confidence_score = p_new_confidence`

---

### 🟡 BUG-B18: `rpc_increment_company_retry` Writes to Wrong Dead Letter Table

**Problem:**
```sql
INSERT INTO dead_letters (entity_id, entity_type, error, created_at)
VALUES (p_id, 'company', p_error, NOW());
```
Missing required NOT NULL columns: `brand_id`, `failure_stage`, `retry_count`. The insert will fail, leaving retry counter stuck and the company never dead-lettered.

**Fix:**
```sql
INSERT INTO dead_letters (brand_id, entity_id, entity_type, failure_stage, error_message, retry_count)
SELECT brand_id, id, 'company', status, p_error, retry_count
FROM discovered_companies WHERE id = p_id;
```

---

## ENGINE / WORKER — TypeScript

---

### 🔴 BUG-E01: `sendProcessor.ts` Queries `leads.email_verified` — Column Does Not Exist

**File:** `src/queue/sendProcessor.ts`

**Problem:**
```typescript
const { data: lead } = await supabase
  .from("leads")
  .select("email, email_verified, id")
```
`leads` table has no `email_verified` column. The select will return `null` for that field. The subsequent check `if (lead.email_verified === false)` will never be true (since it's `undefined`/`null`), so unverified leads are never filtered — emails are sent to unverified addresses.

**Fix:**
```typescript
// Option 1: Remove the check until column is added
// Option 2: Add the column:
// ALTER TABLE public.leads ADD COLUMN email_verified boolean DEFAULT null;
// Option 3: Use confidence_score as proxy:
.select("email, confidence_score, id")
// if (lead.confidence_score !== null && lead.confidence_score < 0.5) → reject
```

---

### 🔴 BUG-E02: IMAP Thread Metadata Extraction Relies on Injected Body Text — Never Injected

**File:** `src/email/imap.ts`

**Problem:**
```typescript
function extractCompanyFromThread(raw: string): string | null {
  const match = raw.match(/company_id:(.*?)\n/);
  return match ? match[1].trim() : null;
}
```
These patterns (`company_id:xxx`, `lead_id:xxx`) must be injected into outbound email bodies to be extractable from replies. Looking at `src/agents/outreach.ts` and `src/email/smtp.ts`, **no code ever injects these values** into the outbound email body.

Result: `companyId` and `leadId` are **always null** for every inbound message. The IMAP handler logs `"Inbound message missing thread metadata"` and marks every reply as seen without processing it. Reply tracking is completely broken.

**Fix:**
```typescript
// In smtp.ts or the send pipeline, inject metadata into email body:
const bodyWithMeta = `${body}\n\n\n--\ncompany_id:${companyId}\nlead_id:${leadId}`;

// Or better: use a hidden HTML comment in HTML emails
// Or: embed in the Message-ID and extract from In-Reply-To header
```

---

### 🔴 BUG-E03: `stateMachine.ts` — `processReplied` Queries `replies.body` — Wrong Column Name

**File:** `src/orchestrator/stateMachine.ts`

**Problem:**
```typescript
const { data: reply } = await supabase
  .from("replies")
  .select("id, body, subject")
  .eq("company_id", company.id)
  .order("received_at", { ascending: false })
```
The `replies` table has `raw_message` not `body`. And `received_at` does not exist — correct column is `created_at`. The query returns records but with `body = null` and `subject = null`. `runReplyAnalysis` is called with an empty `rawMessage`.

**Fix:**
```typescript
.select("id, raw_message, created_at")
.order("created_at", { ascending: false })
// Pass: runReplyAnalysis(company.id, reply.id, reply.raw_message)
```

---

### 🔴 BUG-E04: `checkSendQuota` Calls Non-Existent `get_send_quota_status` RPC

**File:** `src/db/supabase.ts`

**Problem:**
```typescript
const { data, error } = await supabase.rpc("get_send_quota_status", {...})
```
This RPC does not exist. The function always returns `null`. Any code path relying on quota status will silently use `null`.

**Fix:** Either create the RPC in Supabase or rewrite to use `check_client_send_quota` which exists and returns `(allowed boolean, daily_remaining integer, hourly_remaining integer, reason text)`.

---

### 🔴 BUG-E05: `updateSignalSourcePerformance` Calls Non-Existent `rpc_update_signal_source_performance`

**File:** `src/db/supabase.ts`

**Problem:**
```typescript
await safeRpc("rpc_update_signal_source_performance", {...})
```
This RPC is not in the functions inventory. Every call throws an error. `signal_source_performance` table is never updated, breaking performance analytics for discovery sources.

**Fix:** Create the missing RPC:
```sql
CREATE OR REPLACE FUNCTION public.rpc_update_signal_source_performance(
  p_brand_id uuid, p_source_id uuid, 
  p_send_delta int DEFAULT 0, p_reply_delta int DEFAULT 0, p_bounce_delta int DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO signal_source_performance (source_id, brand_id, sends, replies, bounces, last_updated)
  VALUES (p_source_id, p_brand_id, p_send_delta, p_reply_delta, p_bounce_delta, now())
  ON CONFLICT (source_id, brand_id) DO UPDATE SET
    sends = signal_source_performance.sends + p_send_delta,
    replies = signal_source_performance.replies + p_reply_delta,
    bounces = signal_source_performance.bounces + p_bounce_delta,
    last_updated = now();
END;
$$;
```

---

### 🟠 BUG-E06: SMTP Transport Pool Never Invalidated on Credential Update

**File:** `src/email/smtp.ts`

**Problem:**
```typescript
const transportPool = new Map<string, nodemailer.Transporter>()
```
Once a transport is cached, it's used until a send failure. If SMTP credentials are rotated in `brand_profiles`, the cached transport still uses old credentials — all sends fail until the process restarts.

**Fix:**
```typescript
// Add TTL or force reload on credential change
const transportTTL = new Map<string, number>()
const TRANSPORT_TTL_MS = 30 * 60 * 1000 // 30 minutes

// In getTransport:
if (transportPool.has(brandId) && Date.now() < (transportTTL.get(brandId) ?? 0)) {
  return transportPool.get(brandId)!
}
// Force refresh otherwise
```

---

### 🟠 BUG-E07: `replyAnalysis.ts` Triggers Negotiation Both in Agent AND in State Machine (Double Execution)

**File:** `src/agents/replyAnalysis.ts` + `src/orchestrator/stateMachine.ts`

**Problem:**  
`runReplyAnalysis` (called from both IMAP handler and state machine) has:
```typescript
if ((parsed.intent === "high" || parsed.meeting_requested) && parsed.confidence >= 0.75) {
  await runNegotiationAgent(companyId);
}
```
AND `stateMachine.processReplied` also routes to negotiation:
```typescript
const newStatus = intent === "interested" || intent === "meeting_requested" ? "negotiating" : "contacted"
```
This means negotiation can be triggered twice: once eagerly inside `runReplyAnalysis`, and again when the state machine processes the `replied` status. The negotiation agent will run twice for hot leads.

**Fix:** Remove the direct `runNegotiationAgent` call from `replyAnalysis.ts`. Let the state machine handle the transition exclusively.

---

### 🟠 BUG-E08: `replyAnalysis.ts` — Unsubscribe Logic Extracts Email from Raw Body (Fragile)

**File:** `src/agents/replyAnalysis.ts`

**Problem:**
```typescript
const emailMatch = rawMessage.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)
const email = emailMatch[1].toLowerCase()
await supabase.from("suppression_list").insert({ brand_id: brand.id, email, ... })
```
This regex extracts the first email found in the raw message body — which could be the brand's own email address, a quoted email from the original outbound message, or any email in the reply chain. High probability of suppressing the **wrong** email address.

**Fix:**
```typescript
// Extract from the SMTP envelope's From header instead:
const fromMatch = rawMessage.match(/^From:\s.*?<([^>]+)>/im)
const senderEmail = fromMatch?.[1]?.toLowerCase()
```

---

### 🟠 BUG-E09: `outreach.ts` Brand ID Resolution UUID Check is Fragile

**File:** `src/agents/outreach.ts`

**Problem:**
```typescript
if (brandId && !brandId.includes("-")) {
  const resolvedId = await resolveBrandByProduct(brandId);
```
This attempts to detect a UUID by checking for `-`. All UUIDs contain `-` (e.g. `550e8400-e29b-41d4-a716-446655440000`). The condition `!brandId.includes("-")` is always false for any valid UUID, so `resolveBrandByProduct` is never called. If a `product` name is accidentally passed as `brand_id`, it won't be resolved.

**Fix:**
```typescript
import { validate as isUUID } from 'uuid';
if (brandId && !isUUID(brandId)) {
  const resolvedId = await resolveBrandByProduct(brandId);
```

---

### 🟠 BUG-E10: Discovery Engine Double-Release on `processSource`

**File:** `src/discovery/scheduler.ts`

**Problem:**  
`processSource()` calls `executeSource()` which internally calls `releaseDiscoverySource()` on success. Then `processSource()` also calls `releaseDiscoverySource()` again after `executeSource()` succeeds:

```typescript
await executeSource(source);                    // ← releases internally
await incrementBrandDiscoveryCount(...);
await releaseDiscoverySource({ success: true }); // ← releases AGAIN
```

This means `discovery_metrics` gets two rows per run and `manual_discovery_requested` may be cleared incorrectly (or the second release fails because `is_running` is already false).

**Fix:** Remove the `releaseDiscoverySource` call inside `executeSource` on success, OR remove it from `processSource`. Pick one location.

---

### 🟡 BUG-E11: `sendProcessor.ts` — Brand Name Used as SMTP `From` Display Name

**File:** `src/email/smtp.ts`

**Problem:**
```typescript
from: `"${brandId}" <${senderEmail}>`
```
The `from` display name is set to `brandId` (a UUID), not the brand name. All outbound emails show a UUID as the sender name.

**Fix:**
```typescript
// Pass brand_name to sendEmail:
from: `"${brandName}" <${senderEmail}>`
// Or fetch from BrandCredentials: add brand_name to get_brand_credentials() return
```

---

### 🟡 BUG-E12: `processReplied` in State Machine Fetches Reply Without `brand_id` Scope

**File:** `src/orchestrator/stateMachine.ts`

**Problem:**
```typescript
const { data: reply } = await supabase
  .from("replies")
  .select("id, body, subject")
  .eq("company_id", company.id)
```
No `.eq("brand_id", brandId)` filter. If multiple brands have a reply for the same company (unlikely but possible due to data anomaly), wrong reply could be picked up.

**Fix:** Add `.eq("brand_id", brandId)` to the query.

---

### 🟡 BUG-E13: Enrichment Worker — `enrichedData` Assignment Logic Reversed

**File:** `src/enrichment/worker.ts`

**Problem:**
```typescript
if (!enrichedData || newConfidence >= finalConfidence) {
  enrichedData = result.data
}
```
This condition updates `enrichedData` when `newConfidence >= finalConfidence` — but at this point `finalConfidence` has **already been updated** to `Math.max(finalConfidence, newConfidence)` on the line above. The condition is therefore always `true` after the first successful strategy, meaning later (potentially lower quality) strategies can overwrite good data from earlier strategies.

**Fix:**
```typescript
const prevConfidence = finalConfidence;
finalConfidence = Math.max(finalConfidence, newConfidence);
if (!enrichedData || newConfidence > prevConfidence) {
  enrichedData = result.data;
}
```

---

### 🟡 BUG-E14: Startup — IMAP Monitor Errors Are Swallowed Silently

**File:** `src/index.ts`

**Problem:**
```typescript
startIMAPMonitor().catch((err) => {
  logger.error({ err }, "IMAP monitor crashed");
});
```
If IMAP setup fails (e.g. wrong credentials for all brands), the error is logged but the process continues. There's no alerting, no retry at bootstrap level, and no restart logic unless configured externally (e.g. systemd restart policy).

**Recommendation:** Add a startup health check for IMAP connectivity, or ensure systemd `Restart=on-failure` is configured.

---

### 🟡 BUG-E15: `detectStuckLeads` in `lifecycleManager.ts` is Redundant

**File:** `src/orchestrator/lifecycleManager.ts`

**Problem:**  
`detectAndRequeueStuckLeads()` and `escalateStuckLeads()` both call `detectStuckLeads()` and do the same thing. `escalateStuckLeads` claims to "escalate permanently stuck leads" but just re-runs the same detection. The state machine also calls `detectStuckLeads` via `runStuckDetector()`. This results in the function being potentially called from multiple places with no differentiation.

**Fix:** Consolidate into a single caller (the state machine). Remove the duplicate lifecycle manager functions or give them distinct behavior.

---

### 🟢 BUG-E16: `.DS_Store` File Committed to Repository

**File:** `src/.DS_Store` (in zip)

**Problem:** macOS metadata file committed to the repository. Not a runtime bug but a security/hygiene issue — may reveal directory structure info.

**Fix:**
```bash
echo ".DS_Store" >> .gitignore
git rm --cached src/.DS_Store
```

---

### 🟢 BUG-E17: Missing `await` on State Machine Startup

**File:** `src/index.ts`

**Problem:**
```typescript
startStateMachine();           // returns void, no await
startDiscoveryScheduler();     // returns Promise<void>, no await
startDiscoveryProcessor();     // returns Promise<void>, no await
```
`startDiscoveryScheduler` is `async` and loads brand counts from DB. Without `await`, it starts without waiting for initialization to complete, meaning the first discovery tick may run before counts are loaded.

**Fix:**
```typescript
await Promise.all([
  startDiscoveryScheduler(),
  startDiscoveryProcessor(),
]);
startStateMachine();
```

---

## Summary Table

| ID | Severity | Component | Description |
|---|---|---|---|
| B01 | 🔴 | DB | Duplicate client-creation triggers |
| B02 | 🔴 | DB | Plaintext SMTP/IMAP passwords |
| B03 | 🔴 | DB | `handle_new_client` inserts wrong columns |
| B04 | 🔴 | DB | `rpc_insert_reply` wrong column names |
| B05 | 🔴 | DB | `rpc_insert_negotiation_draft` wrong columns |
| B06 | 🔴 | DB | `rpc_mark_lead_contacted` non-existent `contacted_at` |
| B07 | 🔴 | DB | `rpc_activate_scoring_version` uses `product` instead of `brand_id` |
| B08 | 🔴 | DB | `get_domain_health` queries non-existent `domain` on `send_counters` |
| B09 | 🟠 | DB | `register_domain_bounce` same issue — 2% cap never enforced |
| B10 | 🟠 | DB | `disableDomain` TS writes non-existent columns |
| B11 | 🟠 | DB | `reserve_send_quota` RPC doesn't exist — all sends blocked |
| B12 | 🟠 | DB | Overly broad RLS policies — cross-tenant data exposure |
| B13 | 🟠 | DB | Circuit breaker wrong upsert conflict target |
| B14 | 🟡 | DB | Unused `daily_send_limits` table |
| B15 | 🟡 | DB | Dual unique indexes on `send_counters` |
| B16 | 🟡 | DB | `rpc_adjust_scoring_weights` reads non-existent column |
| B17 | 🟡 | DB | `rpc_recalibrate_lead_confidence` wrong column name |
| B18 | 🟡 | DB | `rpc_increment_company_retry` missing dead_letter columns |
| E01 | 🔴 | Engine | `email_verified` column doesn't exist — unverified sends |
| E02 | 🔴 | Engine | Thread metadata never injected — all reply tracking broken |
| E03 | 🔴 | Engine | `replies.body` should be `raw_message`, `received_at` → `created_at` |
| E04 | 🔴 | Engine | `get_send_quota_status` RPC doesn't exist |
| E05 | 🔴 | Engine | `rpc_update_signal_source_performance` RPC doesn't exist |
| E06 | 🟠 | Engine | SMTP transport never refreshed on credential rotation |
| E07 | 🟠 | Engine | Negotiation triggered twice (agent + state machine) |
| E08 | 🟠 | Engine | Unsubscribe extracts wrong email from body |
| E09 | 🟠 | Engine | UUID check in outreach agent always false |
| E10 | 🟠 | Engine | Discovery source double-released |
| E11 | 🟡 | Engine | UUID used as SMTP sender display name |
| E12 | 🟡 | Engine | Reply query missing brand_id scope |
| E13 | 🟡 | Engine | Enrichment confidence update logic reversed |
| E14 | 🟡 | Engine | IMAP startup errors swallowed |
| E15 | 🟡 | Engine | Duplicate stuck lead detection functions |
| E16 | 🟢 | Engine | .DS_Store in repository |
| E17 | 🟢 | Engine | Missing await on async startup functions |

---

*Document generated: April 2026*
