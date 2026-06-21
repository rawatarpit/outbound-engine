# Authentication Flow — Frontend Guide

## Overview

The Express app verifies JWTs by calling **Supabase Auth's `getUser()` API** — it no longer uses a shared `JWT_SECRET` for local verification. The same Supabase Auth JWT you already use for edge functions works with the Express app without any custom token generation.

## Flow

```
Frontend                      Supabase Auth              Express App
    │                              │                          │
    │   POST /auth/v1/token        │                          │
    │   (email + password) ──────► │                          │
    │                              │                          │
    │◄─────── JWT (access_token)   │                          │
    │                              │                          │
    │   POST /api/chat             │                          │
    │   Authorization: Bearer JWT ──────────────────────────► │
    │                              │                          │
    │                              │   GET /auth/v1/user      │
    │                              │   (verify JWT) ────────► │
    │                              │◄──────── user ────────── │
    │                              │                          │
    │                              │   SELECT client_members  │
    │                              │   (lookup client_id) ───►│
    │                              │◄──── member ──────────── │
    │                              │                          │
    │◄──────── SSE stream ─────────────────────────────────── │
```

## What the Frontend Does

### 1. Authenticate via Supabase (existing login flow unchanged)

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: "user@example.com",
  password: "...",
});

const jwt = data.session.access_token; // ← this is your auth token
```

### 2. Send the same JWT to the Express app

The JWT from `supabase.auth.signInWithPassword()` works as-is:

```typescript
// Chat
fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify({
    message: "Find SaaS companies hiring sales teams",
    brand_id: "brand-uuid",
  }),
});

// Approval endpoints
fetch("/api/approval", {
  headers: { Authorization: `Bearer ${jwt}` },
});
```

### 3. Handle token expiry

Supabase Auth JWT tokens have an expiration (default 1 hour). The frontend should:

- Listen to Supabase `onAuthStateChange` events to detect expiry
- Refresh the token via `supabase.auth.refreshSession()` before calling the Express app
- Store the token in memory (not localStorage) — re-fetch on page reload via `supabase.auth.getSession()`

```typescript
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
    const newJwt = session.access_token;
    // Update your API client's auth header
  }
});
```

## Auth Payload Injected by Middleware

After verification, the Express app sets `req.auth`:

```typescript
req.auth = {
  client_id: "uuid",     // required — identifies the tenant
  user_id: "uuid",       // from auth.users
  brand_id: "uuid",      // optional — default brand for the client
};
```

The `brand_id` from the auth payload is used as a fallback if none is provided in the request body.

## Error Responses

| Status | Meaning | Frontend Action |
|--------|---------|----------------|
| `401` | Missing, invalid, or expired JWT | Re-authenticate via Supabase |
| `403` | No client membership found | User needs to be added to a client |
| `200/SSE` | Authenticated — streaming response | Parse SSE events |

## Key Differences from the Old Approach

| Before | After |
|--------|-------|
| JWT signed with a shared `JWT_SECRET` | JWT issued by Supabase Auth (ES256/RS256) |
| `client_id` in JWT payload | `client_id` looked up from `client_members` DB table |
| Need to configure `JWT_SECRET` in `.env` | No shared secret needed — uses `SUPABASE_SERVICE_ROLE_KEY` |
| Custom JWT format | Standard Supabase Auth JWT |

## Migration for Existing UI

If your frontend currently:

1. **Stores a separate custom token** → Stop. Use the Supabase `access_token` directly.
2. **Sends tokens to edge functions** → The same token works for both edge functions and Express.
3. **Implements custom token refresh** → Use Supabase's built-in `refreshSession()` instead.

No frontend code changes are required if you already send `Authorization: Bearer <supabase-jwt>` headers to the Express app.
