# Outbound Engine — Claude-like Chat UI Specification

## Overview

A conversational chat interface styled like **Claude.ai** / **ChatGPT** that serves as the command center for the outbound engine. Users discover, research, qualify, draft, approve, and send leads entirely through natural language. The UI is clean, minimal, and focuses on progressive disclosure — results appear as inline rich cards, not walls of text.

## Core Principles

1. **Chat is ephemeral** — conversations live in memory (1hr TTL). Only explicit user actions persist (add to pipeline, approve drafts, save queries).
2. **10-lead batches** — every query returns at most 10 leads. Keeps responses focused and actionable.
3. **Brand-aware** — context loaded from auth. System knows the product, ICP, intents, and LLM config.
4. **Approval gate** — drafts must be reviewed and approved before sending. No auto-sending.
5. **Progressive disclosure** — summary first, then drill into details on demand.
6. **Streaming-first** — all responses stream via SSE. Text streams character-by-character. Tool results arrive as structured events.

---

## 1. Global Navigation & Tab Structure

### Top-Level Navigation

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [OB] Outbound Engine                                                      │
│  ┌──────┐ ┌──────────┐ ┌───────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Chat │ │ Pipeline │ │ Leads │ │Campaigns │ │Analytics │ │ Settings │ │
│  └──────┘ └──────────┘ └───────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                    [Fruitloop Creative ▾] │
└────────────────────────────────────────────────────────────────────────────┘
```

A top navigation bar spans all views. It contains:
- **Logo/app name** on the left
- **Tab navigation** in the center
- **Brand selector dropdown** on the right
- Active tab is highlighted

### Tab Definitions

| Tab | Default | Route | Description |
|-----|---------|-------|-------------|
| **Chat** | ✅ (default) | `/` or `/chat` | Claude-like conversational interface — the primary way users interact with the engine |
| **Pipeline** | | `/pipeline` | Visual Kanban board showing leads by pipeline stage (Researching → Qualified → Draft Ready → Sent → Replied → Closed) |
| **Leads** | | `/leads` | Searchable, filterable table of all leads with bulk actions |
| **Campaigns** | | `/campaigns` | Email campaign management, templates, sequence builder |
| **Messages** | | `/messages` | Inbound message inbox — replies from leads, threaded conversations, reply tracking |
| **Analytics** | | `/analytics` | Charts and metrics: leads discovered, emails sent, reply rates, pipeline velocity |
| **Settings** | | `/settings` | Brand profile, LLM config, team management, SMTP settings, API keys |

### Layout per Tab

Each tab has a consistent chrome: the top nav bar is always visible, but the sidebar and main content area change per tab.

| Tab | Sidebar | Main Content |
|-----|---------|-------------|
| **Chat** | Brand, pipeline quick-summary, saved queries | Claude-like chat messages + input |
| **Pipeline** | Stage filters, date range | Kanban board or list view |
| **Leads** | Saved filters, lead source filters | Search bar + data table |
| **Campaigns** | Campaign list | Campaign detail / template editor |
| **Analytics** | Metric selector, date range | Charts and data tables |
| **Settings** | Section navigation | Form panels |

### Breakpoints

| Screen | Nav | Sidebar | Main | Behavior |
|--------|-----|---------|------|----------|
| ≥1024px | Full horizontal tabs | Fixed 280px | Fluid | Everything visible |
| 768-1023px | Collapsible hamburger menu | Slide-over panel | Full width | Tabs in hamburger, sidebar slides over |
| <768px | Bottom tab bar (icons only) | Bottom sheet | Full width | 5-icon bottom nav, sidebar as drawer |

Mobile bottom tab bar:
```
┌──────────────────────────────────────────────┐
│  💬    📋    👥    📊    ⚙️                  │
│ Chat  Pipe  Leads  Anal  Settings            │
└──────────────────────────────────────────────┘
```

---

## 2. Chat Tab Layout

This is the primary interface — a Claude-like conversational chat.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐ │
│  │  Sidebar     │  │  Chat Area                                   │ │
│  │  ─────────── │  │                                              │ │
│  │  Brand:      │  │  ┌────────────────────────────────────────┐ │ │
│  │  [Fruitloop▾]│  │  │  [User]                                │ │ │
│  │              │  │  │  Find me SaaS companies hiring sales    │ │ │
│  │  Pipeline    │  │  └────────────────────────────────────────┘ │ │
│  │  ─────────── │  │  ┌────────────────────────────────────────┐ │ │
│  │  Research ██ │  │  │  [Assistant — streaming text]          │ │ │
│  │  Qualified █ │  │  │  I found 10 leads matching your...     │ │ │
│  │  Draft     █ │  │  │                                        │ │ │
│  │  Sent      █ │  │  │  ┌─────┐ ┌─────┐ ┌─────┐            │ │ │
│  │              │  │  │  │Acme │ │Beta │ │Gamma│            │ │ │
│  │  Saved       │  │  │  └─────┘ └─────┘ └─────┘            │ │ │
│  │  Queries     │  │  └────────────────────────────────────────┘ │ │
│  │  ─────────── │  │                                              │ │
│  │  □ Weekly    │  │  ┌────────────────────────────────────────┐ │ │
│  │  □ SaaS Hunt │  │  │  [ Type a message...        ] [Send]  │ │ │
│  │              │  │  └────────────────────────────────────────┘ │ │
│  └──────────────┘  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Chat-specific Sidebar

Positioned on the left, fixed 280px. Contains:

#### Brand Selector
```
┌──────────────────────────┐
│  [Fruitloop Creative ▾]  │
│  ○ Relayforge            │
│  ○ Acme Corp             │
└──────────────────────────┘
```
- Dropdown at top of sidebar
- Loads brands from `GET /api/me` (which uses the JWT to look up client/brands)
- Switching brand clears the chat and starts a new session

#### Pipeline Quick-summary
```
Pipeline
┌──────────────────────────┐
│  Researching        ██ 4 │
│  Qualified          ░  1 │
│  Draft Ready        █  2 │
│  Sent               ░  1 │
│  Replied/Deal       ░  0 │
└──────────────────────────┘
```
- Simple bar + count per stage
- Click on a stage to show those leads inline in chat
- Click "View full pipeline" to switch to the Pipeline tab
- Data from `GET /api/pipeline?brand_id=xxx`

#### Saved Queries
```
Saved Queries
┌──────────────────────────┐
│  ☐ Weekly SaaS Hunt      │
│  ☑ Enterprise Leads      │
│  ☐ Y Combinator Batch    │
│                    [+ New]│
└──────────────────────────┘
```
- Toggle checkbox to enable/disable auto-run
- Click name to re-run the query in chat
- "New" button opens a save dialog
- Click "Manage" to switch to the saved queries section
- Data from `GET /api/saved-queries?brand_id=xxx`

#### Session Info
```
Session
┌──────────────────────────┐
│  Started: 2:30 PM        │
│  Messages: 14            │
│  [Clear Chat]            │
└──────────────────────────┘
```
- "Clear Chat" button resets the session but preserves pipeline data

---

## 3. Pipeline Tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Pipeline                                              [List view ▾]    │
│                                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │Research  │ │Qualified │ │Draft     │ │Sent      │ │Replied   │     │
│  │          │ │          │ │Ready     │ │          │ │          │     │
│  │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │     │
│  │ │Acme  │ │ │ │Beta  │ │ │ │Gamma │ │ │ │Delta │ │ │ │Echo  │ │     │
│  │ │Score:│ │ │ │Score:│ │ │ │Score:│ │ │ │      │ │ │ │      │ │     │
│  │ │85    │ │ │ │72    │ │ │ │91    │ │ │ │      │ │ │ │      │ │     │
│  │ └──────┘ │ │ └──────┘ │ │ └──────┘ │ │ └──────┘ │ │ └──────┘ │     │
│  │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │     │
│  │ │Zeta  │ │ │ │Theta │ │ │ │Iota  │ │ │ │Kappa │ │ │ │Lambda│ │     │
│  │ └──────┘ │ │ └──────┘ │ │ └──────┘ │ │ └──────┘ │ │ └──────┘ │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Views

| View | Description |
|------|-------------|
| **Kanban** (default) | Drag-and-drop columns by stage. Lead cards show company name, fit score, and contact count. Drag to move between stages. |
| **List** | Flat table with sortable columns: Company, Stage, Fit Score, Contact, Last Updated. Bulk actions via checkboxes. |

### Features
- **Filter bar** above the board: search by company name, filter by date range, filter by score range
- **Lead card** in Kanban: shows company, domain, fit score (colored), stage badge, contact name
- **Click card** → opens lead detail panel (slide-over)
- **Drag and drop** to move leads between stages → `PATCH /api/leads/:id` with new status
- **Empty columns** show placeholder: "No leads in this stage. Try the Chat tab to find new leads."

### Lead Detail Panel (slide-over)
```
┌──────────────────────────────────┐
│ ✕ Lead Detail                    │
│ ───────────────────────────────  │
│                                  │
│  Acme Corp                        │
│  saas · 45 emp · San Francisco   │
│                                  │
│  Fit Score: 85/100 ████████░░    │
│  Stage: Researching              │
│                                  │
│  Contact: Jane (CTO)             │
│  jane@acme.com · +1 555-0100    │
│                                  │
│  Signal: Hiring 3 SDRs           │
│  Source: Hacker News             │
│  Discovered: 2 days ago          │
│                                  │
│  Research                         │
│  ─────────────────────────────   │
│  Pain points: Manual lead routing │
│  Budget: Raised $4M Series A     │
│  Tech: Python, React, AWS        │
│                                  │
│  ┌────────────┐ ┌───────┐       │
│  │ Draft Email│ │Delete │       │
│  └────────────┘ └───────┘       │
└──────────────────────────────────┘
```

---

## 4. Leads Tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Leads                                        [Add Lead ▾] [Export CSV] │
│                                                                          │
│  [ Search companies...                ] [ Stage ▾ ] [ Score ▾ ] [ Date ▾]│
│                                                                          │
│  ☐ ┌─────────┬────────────┬───────────┬─────────┬──────────┬─────────┐ │
│  ☐ │Company  │ Stage      │ Fit Score │ Contact │ Last Act │ Source  │ │
│  ☐ ├─────────┼────────────┼───────────┼─────────┼──────────┼─────────┤ │
│  ☐ │Acme Corp│Researching │ █████ 85  │ j@acme  │ 2h ago   │ HN      │ │
│  ☐ │Beta Inc │Draft Ready │ ████ 72   │ b@beta  │ 1d ago   │ Indeed  │ │
│  ☐ │Gamma    │Qualified   │ █████ 91  │ g@gamma │ 3h ago   │ Forge   │ │
│  ☐ │Delta    │Sent        │ ███ 62    │ d@delta │ 5d ago   │ Manual  │ │
│  └─────────┴────────────┴───────────┴─────────┴──────────┴─────────┘ │
│                                                                          │
│  Showing 1-10 of 47 leads                                    ← 1 2 3 → │
└──────────────────────────────────────────────────────────────────────────┘
```

### Features
- **Search** filters by company name, domain, or contact email (debounced, 300ms)
- **Filters**: Stage (multi-select dropdown), Fit Score range (slider), Source, Date range
- **Sortable columns**: click header to sort asc/desc
- **Bulk actions**: select leads → "Add to Campaign", "Delete", "Export"
- **Pagination**: 25 per page, page controls at bottom
- **Row click** → opens Lead Detail panel (same as Pipeline tab slide-over)
- **"Add Lead" button** → dropdown: "Manual entry" (form) or "Ask Chat to find leads" (switches to Chat tab)

---

## 5. Campaigns Tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Campaigns                                           [+ New Campaign]   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Campaign Name         | Leads | Sent | Opens  | Replies | Status │  │
│  │  ├─────────────────────|───────|──────|────────|─────────|────────┤  │
│  │  │ Q3 Outreach         │ 25    │ 18   │ 45%    │ 12%     │ ● Active│  │
│  │  │ Enterprise Followup │ 12    │ 10   │ 60%    │ 20%     │ ● Active│  │
│  │  │ YC Batch Test       │ 8     │ 8    │ 25%    │ 0%      │ ○ Draft │  │
│  │  │ Old Leads Reboot    │ 50    │ 0    │ —      │ —       │ ◌ Paused│  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  Templates                                         [+ New Template]      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Template Name          | Subject Preview              | Used     │  │
│  │  ├──────────────────────|─────────────────────────────────────────┤  │
│  │  │ Cold Outbound        │ Quick question about {company} │ 47x    │  │
│  │  │ Follow-up Day 3      │ Following up on my note       │ 32x    │  │
│  │  │ LinkedIn Connect     │ Loved your post about...      │ 18x    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Features
- **Campaign list**: name, stats (leads, sent, opens, replies), status badge (Active/Draft/Paused)
- **Click campaign** → campaign detail view with sequence editor
- **Sequence editor**: visual timeline of email steps with delays
- **Template library**: reusable email templates with variable placeholders (`{company}`, `{name}`, `{product}`)
- **"New Campaign"** button → wizard: name → select leads → choose template → set sequence → launch

---

## 6. Messages Tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Messages                                          [Unread ▾] [Date ▾] │
│                                                                          │
│  [ Search messages...              ] [ All ▾ ] [ Starred ▾ ] [ Filter ▾]│
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐│
│  │ ● John (CTO) — Acme Corp                            Just now       ││
│  │   Re: Quick question about your sales stack                         ││
│  │   Hi, thanks for reaching out. We're actually evaluating solutions   ││
│  │   right now. Can you share a demo?                       ★ ☆       ││
│  ├──────────────────────────────────────────────────────────────────────┤│
│  │ ● Sarah (VP Eng) — Beta Inc                            2h ago       ││
│  │   Re: Following up on my note                                        ││
│  │   Sorry for the delay. Not interested at this time.                  ││
│  ├──────────────────────────────────────────────────────────────────────┤│
│  │ ○ Mike (CEO) — Gamma LLC                              Yesterday     ││
│  │   Re: Loved your post about outbound                                 ││
│  │   Hey! Would love to chat. Are you free next Tuesday?    ★          ││
│  ├──────────────────────────────────────────────────────────────────────┤│
│  │ ○ No Subject — Delta Ltd                              3 days ago    ││
│  │   Unsubscribed                                                       ││
│  └──────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  Showing 1-20 of 64 conversations                         ← 1 2 3 4 →  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Conversation Thread View (when a message is selected)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Back to Inbox                                                        │
│                                                                          │
│  John (CTO) — Acme Corp                                      [Actions ▾]│
│  jane@acme.com · Campaign: Q3 Outreach · Stage: Replied                 │
│                                                                          │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ [Outbound] Jun 15, 2:30 PM                                    │       │
│  │ Subject: Quick question about your sales stack                │       │
│  │ ──────────────────────────────────────────                    │       │
│  │ Hi {name},                                                    │       │
│  │                                                               │       │
│  │ I noticed Acme Corp is scaling your sales team...             │       │
│  │                                                               │       │
│  │ Best,                                                         │       │
│  │ Alex                                                          │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ [John] Jun 20, 2:31 PM                                        │       │
│  │ ──────────────────────────────────────────                    │       │
│  │ Hi, thanks for reaching out. We're actually evaluating        │       │
│  │ solutions right now. Can you share a demo?                    │       │
│  │                                                               │       │
│  │ John                                                          │       │
│  │ CTO, Acme Corp                                                │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ [You] Just now                                                │       │
│  │ ──────────────────────────────────────────                    │       │
│  │ Hi John,                                                      │       │
│  │                                                               │       │
│  │ Absolutely! I'd be happy to set up a demo. Would this         │       │
│  │ Thursday at 2 PM work for you?                                │       │
│  │                                                               │       │
│  │ Best,                                                         │       │
│  │ Alex                                                          │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│  ┌──────────────────────────────────────────────┐                        │
│  │  [ Type a reply...                ] [Send ▶] │                        │
│  │  ℹ️ Enter to send · Shift+Enter for newline   │                        │
│  └──────────────────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Inbox Views

| View | Filter | Description |
|------|--------|-------------|
| **Inbox** (default) | All unread first | Chronological list of all inbound messages |
| **Unread** | `is_read = false` | Only messages not yet read |
| **Starred** | `is_starred = true` | Important conversations bookmarked by user |
| **Replied** | Has outbound reply after inbound | Conversations where user has responded |
| **Bounced** | `bounce = true` | Failed deliveries, invalid addresses |

### List Item States

| State | Visual | Behavior |
|-------|--------|----------|
| **Unread** | Bold sender name, blue dot (●) on left | Message not yet opened |
| **Read** | Normal weight, no dot | Previously viewed |
| **Starred** | Filled star (★) in top-right corner | Pinned by user |
| **Replied** | Reply icon indicator | Has outbound response after this message |
| **Bounced** | Red warning icon | Delivery failure, unsubscribed, invalid |

### Thread Features

- **Side-by-side view**: on ≥1024px, list on left (320px) + thread on right
- **Stacked view**: on <1024px, list full width, tap to open thread full screen
- **Reply field**: at bottom of thread, auto-resize textarea
- **Quick actions** on list item: star toggle, mark read/unread
- **Right-click context menu**: Archive, Delete, Move to Pipeline Stage, Create Task

### Thread Actions (Actions ▾ dropdown)

| Action | API |
|--------|-----|
| **Reply** | Focuses reply field |
| **Forward** | Opens forward composer |
| **Mark Unread** | `PATCH /api/messages/:id` |
| **Star/Unstar** | `PATCH /api/messages/:id` |
| **Move to Stage** | `PATCH /api/leads/:id` (changes pipeline stage) |
| **Archive** | `PATCH /api/messages/:id` (archive = true) |
| **Delete** | `DELETE /api/messages/:id` |

### Mobile

```
┌──────────────────────┐
│ ← Messages    [⋮]   │
├──────────────────────┤
│ ● John — Acme Corp   │
│   Re: Quick question  │
│   Hi, thanks...      │
├──────────────────────┤
│ ● Sarah — Beta Inc   │
│   Re: Following up   │
│   Sorry for the...   │
├──────────────────────┤
│ ○ Mike — Gamma LLC   │
│   Re: Loved your...  │
│   Hey! Would love... │
└──────────────────────┘
```

- Single column message list
- Tap → slide to thread view (full screen with back button)
- Bottom action bar: star, archive, delete

---

## 7. Analytics Tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Analytics                                  [Last 30 days ▾] [Export ▾] │
│                                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│  │ Leads    │ │ Emails   │ │ Open     │ │ Reply    │                   │
│  │ 47       │ │ 128      │ │ 42%      │ │ 14%      │                   │
│  │ +12% WoW │ │ +8% WoW  │ │ +3% WoW  │ │ +2% WoW  │                   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Leads Over Time                                    ██████████ │    │
│  │  ██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ████████  │    │
│  │  ██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │    │
│  │  └─────────────────────────────────────────────────────────────┘    │
│  │  Jun 1                     Jun 15                     Jun 30       │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐    │
│  │ Pipeline Distribution    │  │ Top Sources                     │    │
│  │ ┌──────────────────────┐ │  │ ┌──────────────────────────────┐│    │
│  │ │ Research      25     │ │  │ │ Hacker News        █████ 18 ││    │
│  │ │ Qualified     12     │ │  │ │ Indeed             ████  15 ││    │
│  │ │ Draft Ready    8     │ │  │ │ Forge              ███   10 ││    │
│  │ │ Sent           5     │ │  │ │ Manual Entry       ██     4 ││    │
│  │ │ Replied        2     │ │  │ └──────────────────────────────┘│    │
│  │ └──────────────────────┘ │  └──────────────────────────────────┘    │
│  └──────────────────────────┘  └──────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Metric Cards
Four KPI cards at the top with WoW (week-over-week) change indicators:
- **Leads Discovered** — total in selected period
- **Emails Sent** — total sent
- **Open Rate** — unique opens / sent
- **Reply Rate** — unique replies / sent

### Charts
| Chart | Description |
|-------|-------------|
| **Leads Over Time** | Area/bar chart, daily lead discovery count |
| **Pipeline Distribution** | Horizontal bar chart showing leads per stage |
| **Top Sources** | Horizontal bar chart of lead sources by count |
| **Email Performance** | Line chart: opens and replies over time |
| **Campaign Comparison** | Side-by-side bar chart comparing campaign metrics |

### Saved Reports
- Pre-built: "Weekly Summary", "Pipeline Health", "Campaign Performance"
- Custom: save filter/date combinations as named reports

---

## 8. Settings Tab

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Settings                             [Fruitloop Creative ▾]            │
│                                                                          │
│  ┌──────────────┐  ┌─────────────────────────────────────────────────┐  │
│  │  Brand       │  │  Brand Profile                                 │  │
│  │  ─────────── │  │  ─────────────────                             │  │
│  │  ● Profile   │  │                                                │  │
│  │  ○ LLM       │  │  Brand Name: [Fruitloop Creative         ]    │  │
│  │  ○ SMTP      │  │  Product:    [Outbound Automation Platf]      │  │
│  │  ○ Templates │  │  Website:    [https://fruitloop.io      ]    │  │
│  │              │  │                                                │  │
│  │  Team        │  │  Positioning:                                  │  │
│  │  ─────────── │  │  ┌────────────────────────────────────────┐   │  │
│  │  ○ Members   │  │  │ We help B2B SaaS companies automate   │   │  │
│  │              │  │  │ their outbound sales...               │   │  │
│  │  Account     │  │  └────────────────────────────────────────┘   │  │
│  │  ─────────── │  │                                                │  │
│  │  ○ API Keys  │  │  Tone: [Professional  ▾]                      │  │
│  │              │  │                                                │  │
│  └──────────────┘  │  [Save Changes]                                │  │
│                    └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Sections (left sidebar)

| Section | Sub-pages | Description |
|---------|-----------|-------------|
| **Brand** | Profile, LLM, SMTP, Templates | Brand profile info, LLM provider/config, SMTP settings, default email templates |
| **Team** | Members | Invite/manage team members, roles (owner/admin/member/viewer) |
| **Account** | API Keys, Billing | API key management, subscription/plan info |

### LLM Settings
```
LLM Configuration
┌─────────────────────────────────────────────────┐
│  Provider: [OpenAI ▾]                           │
│  API Key:  [••••••••••••••••••] [Test]         │
│  Model:    [gpt-4o ▾]                           │
│  Base URL: [https://api.openai.com/v1     ]    │
│  Temperature: [░░░░░░░░░░○──] 0.2               │
│                                                 │
│  [Test Connection]  [Save]                      │
└─────────────────────────────────────────────────┘
```

---

## 9. Chat Messages

### 3.1 User Messages

```
┌──────────────────────────────────────────────┐
│                                              │
│  Find me SaaS companies in Europe that are   │
│  hiring sales development representatives    │
│                                              │
│                          ┌─────────────────┐ │
│                          │ 2:31 PM    ● ● │ │
│                          └─────────────────┘ │
└──────────────────────────────────────────────┘
```
- Right-aligned, colored bubble
- Timestamp below
- Avatar/icon: user initial or generic user icon
- Max width 70% of container, wraps naturally

### 3.2 Assistant Messages

```
┌──────────────────────────────────────────────┐
│  ┌──┐                                        │
│  │OB│ I found **10 SaaS companies** in Europe │
│  └──┘ that are currently hiring SDRs. Here's │
│       what I found:                           │
│                                              │
│       _Discovered 10 leads · Researched 10 ·  │
│       Found 8 contacts · Qualified 10_        │
│                                              │
│       [lead cards rendered here]              │
│                                              │
│       ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│       │   Add to │ │  Show me │ │ Research│ │
│       │  Pipeline│ │  Drafts  │ │  Acme   │ │
│       └──────────┘ └──────────┘ └─────────┘ │
│                                              │
│                              ┌──────────────┐│
│                              │ OB 2:32 PM   ││
│                              └──────────────┘│
└──────────────────────────────────────────────┘
```
- Left-aligned, white/light gray background
- Avatar: app icon or "OB" (Outbound) badge
- **Markdown rendered**: bold, italic, lists, inline code
- **Rich cards** embedded inline in the message flow
- **Suggestion chips** at the bottom
- Timestamp bottom-right

### 3.3 Processing State (while agent is working)

```
┌──────────────────────────────────────────────┐
│  ┌──┐                                        │
│  │OB│                                        │
│  └──┘                                        │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  🔍 Step 1/4: Searching for leads... │    │
│  │  📊 Step 2/4: Researching companies  │    │
│  │  📧 Step 3/4: Finding contacts       │    │
│  │  ⭐ Step 4/4: Qualifying leads       │    │
│  │                                      │    │
│  │  ████████░░░░░░░░░░░░ 40%           │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  _elapsed: 12.4s_                            │
└──────────────────────────────────────────────┘
```
- Each step lights up in sequence with a pulsing icon
- Completed steps show ✅
- Current step shows a spinner
- Progress bar fills as steps complete
- Elapsed timer updates live

### 3.4 Error State

```
┌──────────────────────────────────────────────┐
│  ┌──┐                                        │
│  │OB│ ⚠️ I ran into an issue while searching │
│  └──┘   for leads. The discovery service     │
│         timed out.                           │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  ✗ Discover leads — timeout          │    │
│  │  ✅ Research companies               │    │
│  │  ✅ Find contacts                    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  Here's what I found with the partial        │
│  results.                                    │
│                                              │
│       ┌──────────┐ ┌──────────┐              │
│       │  Retry   │ │ Continue │              │
│       └──────────┘ └──────────┘              │
└──────────────────────────────────────────────┘
```
- Shows which steps passed/failed
- "Retry" re-runs the failed step
- "Continue" moves on with partial results

---

## 10. Lead Card

Inline rich card rendered inside the assistant message flow:

```
┌────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────┐  │
│  │  Acme Corp                        Fit: ████ │  │
│  │  SaaS · 45 employees · Raised $4M           │  │
│  │  Signal: Hiring 3 SDRs · Built with Python  │  │
│  │                                              │  │
│  │  Pain: Manual lead routing causing drop-off  │  │
│  │                                              │  │
│  │  Contact: Jane (CTO) — jane@acme.com         │  │
│  │           [80% confidence]                   │  │
│  │                                              │  │
│  │  ┌────────┐ ┌────────┐ ┌───────┐ ┌──────┐  │  │
│  │  │Add to  │ │ Draft  │ │View   │ │Hide  │  │  │
│  │  │Pipeline│ │ Email  │ │Details│ │      │  │  │
│  │  └────────┘ └────────┘ └───────┘ └──────┘  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  [Expanded Detail — shown when "View Details"      │
│   is clicked]                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Research Summary                            │  │
│  │  ─────────────────                          │  │
│  │  • Hired 3 SDRs in Q2 — scaling sales       │  │
│  │  • Currently using Salesforce + HubSpot     │  │
│  │  • CTO active on LinkedIn, posting about    │  │
│  │    lead generation challenges               │  │
│  │                                              │  │
│  │  Qualification Breakdown                     │  │
│  │  ─────────────────                          │  │
│  │  • Intent:  85/100 — actively hiring        │  │
│  │  • Fit:     82/100 — perfect ICP match      │  │
│  │  • Budget:  75/100 — raised Series A        │  │
│  │  • Timing:  90/100 — hiring now             │  │
│  │                                              │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │  🔗 acme.com  🔗 LinkedIn  🔗 Crunch  │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### Lead Card States

| State | Visual | Behavior |
|-------|--------|----------|
| **Default** | Card with summary | Shows company, fit score, signal, contact |
| **Expanded** | Full research detail | Shows pain points, qualification breakdown, links |
| **Added** | Green border, checkmark | "Added to Pipeline" badge, button disabled |
| **Drafting** | Spinner on Draft button | Waiting for draft to generate |

### Fit Score Indicator

The fit score is rendered as a horizontal bar:

```
Score: 85/100
██▓▓▓▓▓▓▓▓▓▓▓▓░░░░░  85%
```

Color based on score:
- ≥80: green (#22c55e)
- 60-79: yellow (#eab308)
- <60: red (#ef4444)

### Action Buttons

| Button | Action | API |
|--------|--------|-----|
| **Add to Pipeline** | POST `/api/add-to-pipeline` with lead ID | Lead moves to "Researching" stage |
| **Draft Email** | Triggers drafting for this lead | Shows draft card below |
| **View Details** | Toggles expanded section | No API call — client-side expand |
| **Hide** | Collapses card | No API call — client-side |
| **Links** | Open external in new tab | Direct navigation |

---

## 11. Draft Card

```
┌────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────┐  │
│  │  ✉️ Draft for Acme Corp              Pending │  │
│  │                                              │  │
│  │  Subject:                                    │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │ Quick question about your sales stack│   │  │
│  │  └──────────────────────────────────────┘   │  │
│  │                                              │  │
│  │  Body:                                       │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │ Hi Jane,                             │   │  │
│  │  │                                      │   │  │
│  │  │ I noticed Acme Corp is scaling your  │   │  │
│  │  │ sales team — congrats! We help SaaS  │   │  │
│  │  │ companies automate outbound...       │   │  │
│  │  │                                      │   │  │
│  │  │ Best,                                │   │  │
│  │  │ Alex                                 │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  │                                              │  │
│  │  ┌──────────┐ ┌────────┐ ┌────────┐         │  │
│  │  │ Approve  │ │  Edit  │ │ Reject │         │  │
│  │  └──────────┘ └────────┘ └────────┘         │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### Draft Card States

| State | Visual | Behavior |
|-------|--------|----------|
| **Pending** | Yellow badge, editable fields, action buttons | Default state |
| **Editing** | Fields become textarea, Save/Cancel buttons | Inline editing |
| **Approved** | Green badge, fields readonly | Sent to send queue |
| **Sent** | Blue badge with timestamp | Final state |
| **Rejected** | Gray badge, dimmed | Dismissed |

### Action Buttons

| Button | Action | API |
|--------|--------|-----|
| **Approve** | POST `/api/approval/approve` | Draft enters send queue |
| **Edit** | Toggles inline editing | No API call until save |
| **Save** (while editing) | PUT `/api/approval/edit` | Updates subject/body |
| **Cancel** (while editing) | Discards edits | No API call |
| **Reject** | POST `/api/approval/reject` | Draft archived |

---

## 12. Chat Input

```
┌──────────────────────────────────────────────────────┐
│                                                        │
│  ┌──────────────────────────────────────────────┐     │
│  │                                              │     │
│  │  Find me SaaS companies hiring SDRs...       │     │
│  │                                              │     │
│  │                                    [Send ▶] │     │
│  └──────────────────────────────────────────────┘     │
│                                                        │
│  ℹ️ Enter to send · Shift+Enter for newline            │
└──────────────────────────────────────────────────────┘
```

### Behavior

- Auto-resize textarea (min 1 line, max 6 lines)
- Send button disabled when input is empty
- Send button shows a spinner while processing
- Enter sends, Shift+Enter inserts newline
- Cmd+K opens command palette (future)
- Input is cleared after send

### Suggestion Chips (below input when idle)

```
┌──────────────────────────────────────────────┐
│                                              │
│  [ Find leads ]  [ Research a company  ]     │
│  [ View pipeline ]  [ Save this search ]     │
│                                              │
└──────────────────────────────────────────────┘
```
- Shown when chat is idle (no active message)
- Clicking a chip populates the input
- Chips update based on conversation context

---

## 13. Streaming Implementation

The backend streams responses via **Server-Sent Events (SSE)**. The frontend uses `fetch` with `ReadableStream` (not native `EventSource`) to support POST requests.

### Connection

```typescript
const response = await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    message: "Find SaaS companies hiring SDRs",
    brand_id: "brand-uuid",
    session_id: null, // or existing session_id
  }),
});
```

### SSE Event Stream

```typescript
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  let eventType = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) eventType = line.slice(7);
    else if (line.startsWith("data: ") && eventType) {
      const data = JSON.parse(line.slice(6));
      handleEvent(eventType, data);
      eventType = "";
    }
  }
}
```

### Events

| Event | Payload | UI Action |
|-------|---------|-----------|
| `session` | `{ session_id: "uuid" }` | Store session ID for continuation |
| `intent` | `{ intent: "discover", confidence: 0.95 }` | Show intent badge in processing indicator |
| `plan` | `{ steps: [{id, tool}] }` | Render step indicators in processing state |
| `progress` | `{ step_id, tool, status: "running"\|"done"\|"error", data?, error? }` | Update step state (spinner → checkmark → error) |
| `message` | `{ text: "markdown string", suggestions: ["chip1", "chip2"], tool_results: [...] }` | Render assistant message with inline cards |
| `done` | `{ session_id }` | End stream, enable input |
| `error` | `{ message: "error text" }` | Show error in chat |

### Rendering Text Messages

When a `message` event arrives, the `text` field contains **markdown**. Render it with a markdown library (e.g., `react-markdown`). The `tool_results` array contains structured data for rich card rendering:

```typescript
interface MessageEvent {
  text: string;           // Markdown text
  suggestions: string[];  // Quick action chips
  tool_results: Array<{
    tool: string;
    status: "success" | "error" | "skipped";
    output: any;          // Structured data for card rendering
  }>;
}
```

### Mapping tool_results to Cards

| tool | output format | Render as |
|------|---------------|-----------|
| `discover_leads` | `{ leads: Lead[] }` | Lead cards |
| `research_leads` | `{ leads: ResearchedLead[] }` | Expanded lead sections |
| `enrich_leads` | `{ contacts: Contact[] }` | Contact info on lead cards |
| `qualify_leads` | `{ qualified: QualifiedLead[] }` | Fit scores on lead cards |
| `draft_emails` | `{ drafts: Draft[] }` | Draft cards |
| `get_pipeline` | `{ summary: string, stages: object }` | Pipeline summary |

---

## 14. Session Management

### Client-Side Session Cache

```typescript
// In-memory session map (session_id → messages[])
const sessions = new Map<string, ChatMessage[]>();

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  rich_content?: LeadCard[] | DraftCard[]; // for rich card rendering
  timestamp: string;
}
```

### Session Lifecycle

1. **First message** → no `session_id` → server creates session, returns ID in `session` SSE event
2. **Subsequent messages** → include `session_id` → server appends to existing conversation
3. **Clear chat** → keep session_id but clear local messages (server keeps conversation context)
4. **Switch brand** → clear session_id, start fresh
5. **Session expiry** → server returns session error → client starts new session

### Server-Side Behavior

- Sessions stored in `Map<string, Session>` in Node.js
- TTL: 1 hour since last activity
- Max messages: 50 per session (trims oldest)
- No persistence to DB

---

## 15. Approval Flow

### Triggered by Draft Results

After drafting completes, the `message` SSE event contains draft tool results. Render draft cards inline.

### Batch Approve

If multiple drafts are pending, show a floating action bar:

```
┌──────────────────────────────────────────────────────┐
│  3 drafts pending review         [Approve All] [Hide] │
└──────────────────────────────────────────────────────┘
```
- Appears at bottom of chat (above input)
- "Approve All" calls POST `/api/approval/approve` with all draft IDs
- Individual draft cards have their own Approve button

### Approval Confirmation

After approval, show inline confirmation:

```
┌──────────────────────────────────────────────┐
│  ✅ Draft for Acme Corp approved!            │
│  Email queued for sending.                   │
│                                              │
│  Sent to: jane@acme.com                      │
│  Scheduled: Immediate                        │
└──────────────────────────────────────────────┘
```

---

## 16. Component Tree

```
App
├── AuthProvider (Supabase session context)
│   └── Layout
│       ├── Sidebar
│       │   ├── BrandSelector
│       │   ├── PipelineStatus
│       │   │   └── StageBadge (×6 stages)
│       │   ├── SavedQueries
│       │   │   └── QueryItem (×N, toggle + run)
│       │   └── SessionInfo
│       │       └── ClearChatButton
│       │
│       ├── ChatArea
│       │   ├── MessageList
│       │   │   ├── UserMessage (right-aligned bubble)
│       │   │   ├── AssistantMessage
│       │   │   │   ├── MarkdownRenderer
│       │   │   │   ├── LeadCard (conditional)
│       │   │   │   │   └── ExpandedDetail (toggle)
│       │   │   │   ├── DraftCard (conditional)
│       │   │   │   │   └── DraftEditor (inline edit)
│       │   │   │   └── SuggestionChips
│       │   │   └── ProcessingIndicator (while streaming)
│       │   │       └── ProgressSteps
│       │   │
│       │   └── ChatInput
│       │       ├── AutoResizeTextarea
│       │       ├── SendButton
│       │       └── SuggestionChips (idle state)
│       │
│       └── FloatingBar (conditional)
│           └── BatchApproveBar
```

---

## 17. Data Flow

```
User types message
       │
       ▼
ChatInput validates (non-empty)
       │
       ▼
MessageList adds user message (optimistic)
       │
       ▼
ChatContainer calls sendMessage() → fetch POST /api/chat
       │
       ▼
Response stream starts
       │
       ▼
SSE Parser processes events:
  session → store session_id
  intent  → show intent badge
  plan    → build step indicators
  progress → update step states (spinner/check/done/error)
  message → render assistant message + inline cards
  done    → end stream, re-enable input
  error   → show error in chat
```

---

## 18. Styling Guidelines

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#ffffff` / `#1a1a2e` | Chat background |
| `--bg-secondary` | `#f5f5f5` / `#16213e` | Sidebar background |
| `--bubble-user` | `#2563eb` / `#3b82f6` | User message bubble |
| `--bubble-assistant` | `#f0f0f0` / `#1e293b` | Assistant message bubble |
| `--text-primary` | `#1a1a1a` / `#e2e8f0` | Main text |
| `--text-secondary` | `#666666` / `#94a3b8` | Secondary text |
| `--accent` | `#2563eb` | Links, buttons |
| `--success` | `#22c55e` | Approved, high fit |
| `--warning` | `#eab308` | Pending, medium fit |
| `--error` | `#ef4444` | Rejected, low fit |
| `--card-border` | `#e5e7eb` / `#334155` | Card borders |

### Typography

| Element | Size | Weight |
|---------|------|--------|
| Message text | 15px | 400 |
| Company name in card | 16px | 600 |
| Card metadata | 13px | 400 |
| Timestamps | 12px | 400 |
| Button text | 14px | 500 |
| Sidebar labels | 13px | 600 |
| Input text | 15px | 400 |

### Spacing

- Chat padding: 24px horizontal, 16px vertical
- Card padding: 16px
- Gap between messages: 16px
- Gap between cards: 12px
- Bubble border-radius: 18px (user), 18px (assistant)
- Card border-radius: 12px

---

## 19. Error Handling

| Scenario | UI Behavior |
|----------|-------------|
| **Network error** | Show "Connection lost" banner at top. Auto-retry up to 3 times with exponential backoff. |
| **401 from API** | Show "Session expired" — trigger Supabase `refreshSession()`. If refresh fails, redirect to login. |
| **Tool failure** | Show inline in message: step shows ❌, retry button for failed step, continue button for partial results. |
| **Rate limit (429)** | Show "Too many requests, please wait..." with countdown timer. |
| **SSE connection drops mid-stream** | Show "Reconnecting..." — retry the POST with same `session_id` to resume. |
| **Server error (5xx)** | Show "Something went wrong. Please try again." with retry button. |

---

## 20. States Reference

### ChatContainer

| State | Condition | UI |
|-------|-----------|-----|
| **Idle** | No active request | Show suggestion chips, input enabled |
| **Connecting** | POST request sent, waiting for first SSE event | Show "Connecting..." in input area |
| **Streaming** | Receiving SSE events | Show processing indicator, input disabled |
| **Error** | Non-retryable error | Show error message, re-enable input |
| **Retrying** | Auto-retry in progress | Show "Retrying (attempt 2/3)..." |

### MessageList

| State | Condition | UI |
|-------|-----------|-----|
| **Empty** | No messages | Show centered welcome message + suggestion chips |
| **Has messages** | Messages in session | Render message list with auto-scroll |
| **Loading older** | N/A (no pagination) | N/A — sessions are small |

### LeadCard

| State | Condition | UI |
|-------|-----------|-----|
| **Default** | Not yet added to pipeline | Show all action buttons |
| **Hover** | Mouse over card | Subtle shadow elevation |
| **Added** | Added to pipeline | Green border, "Added" badge, Add button disabled |
| **Error** | Add failed | Red border, "Retry" button |

### DraftCard

| State | Condition | UI |
|-------|-----------|-----|
| **Pending** | Waiting for approval | Editable fields, action buttons |
| **Editing** | User clicked Edit | Fields as textareas, Save/Cancel buttons |
| **Saving** | Save in progress | Spinner on Save button |
| **Approved** | User clicked Approve | Green badge, fields readonly |
| **Sent** | Email sent | Blue badge with timestamp |
| **Rejected** | User clicked Reject | Gray badge, dimmed |
| **Error** | API failure | Red border, retry button |

---

## 21. Mobile Responsiveness

### <768px (Mobile)

```
┌──────────────────────┐
│  ☰ Outbound Engine   │ ← Header with hamburger + brand name
├──────────────────────┤
│                      │
│  [Chat messages]     │ ← Full width
│                      │
│  ┌──────────────┐   │
│  │ [Input] [▶]  │   │
│  └──────────────┘   │
└──────────────────────┘
```

- Sidebar becomes a bottom sheet triggered by ☰
- Lead cards stack in single column
- Draft cards are full width
- Suggestion chips wrap to multiple rows
- Fit score bars are shorter

### 768-1023px (Tablet)

- Sidebar is a slide-over panel (overlays chat)
- Everything else behaves like desktop
- Lead cards in 2-column grid (if viewport width allows)

---

## 22. Performance Considerations

1. **Card lazy rendering** — only render cards that are visible in the viewport. Virtualize the message list if >20 messages.
2. **SSE buffer management** — keep buffer small, parse events incrementally, don't hold large data in memory.
3. **Markdown rendering** — use a lightweight markdown parser (e.g., `react-markdown` with `rehype-raw` disabled for security).
4. **Card images** — lazy load external images (company logos, avatars) with blur placeholder.
5. **CSS animations** — use `transform` and `opacity` only for smooth 60fps animations on step indicators.

---

## 23. Suggested Libraries

| Purpose | Library |
|---------|---------|
| Supabase auth | `@supabase/supabase-js` |
| Markdown rendering | `react-markdown` + `remark-gfm` |
| SSE parsing | Custom (no library needed, simple line parser) |
| State management | React context + useReducer (no Redux needed) |
| Styling | Tailwind CSS |
| Icons | `lucide-react` |
| Auto-resize textarea | CSS-only (`field-sizing: content` in modern browsers, or a lightweight hook) |
