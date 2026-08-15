# MedBridge Pass

**Seamless Cross-Border Patient & Medical Experiences**

A B2B & B2C healthcare platform that bridges Singapore patients with hospitals and clinics in
Batam, Indonesia — bundling **medical treatment, ferry tickets, local transport and recovery
hotels** into a single 1-click digital pass.

This package is the **frontend**: the hospital operations portal, the patient-facing itinerary
pass, the API service layer, and a complete offline mock backend so the whole product runs with
no server at all.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # typecheck + production bundle
npm run typecheck    # types only
npm run preview      # serve the built bundle
```

Runs against mock data out of the box (`VITE_USE_MOCKS=true`). Copy `.env.example` to `.env` and
set `VITE_USE_MOCKS=false` to point at a real backend.

> **Run the pitch:** click **RUN LIVE DEMO** in the top bar. See [Live demo mode](#live-demo-mode).

---

## Architecture

```
WhatsApp / Telegram message
        │
        ▼
  Backend API  ──────────────►  AI Agent (Hermes)
        │                              │
        │        ◄─── Structured JSON ─┘
        ▼
  Business Logic  ──►  PostgreSQL
        │
        ▼
  Hospital Operations Dashboard
        │
        ▼
  Staff / Doctor Approval   ◄── HUMAN-IN-THE-LOOP GATE
        │
        ▼
  Final Itinerary  ──►  Patient link  /itinerary/:token
```

### Security & architecture rules

These are enforced in code, not just documented.

**1. The frontend never talks to an LLM.**
There is no model SDK, no provider endpoint and no API key in this bundle. `services/http.ts` is
the only egress path and it speaks exclusively to the MedBridge backend, which owns the Hermes
agent. The UI consumes structured REST responses plus SSE/WebSocket event frames.

**2. Every key is a UUID v4.**
No auto-incrementing integers anywhere. Every `id` and foreign key in `src/types/index.ts` is
typed `UUID`; the seed catalogue uses fixed v4 values so foreign keys stay stable across reloads,
and `lib/utils.ts#uuid()` generates v4 from the platform CSPRNG. `MBP-2026-0001`-style references
are human-readable labels, never keys.

**3. Human-in-the-loop is a hard gate.**
`CONFIDENCE_THRESHOLD = 0.75`. An extraction escalates to `HUMAN_REVIEW_REQUIRED` when **any** of
these hold — confidence below threshold, no catalogue procedure matched, emergency language
detected, or the procedure is flagged `requiresDoctorReview`. See
`mock/generators.ts#evaluateReviewGate`. **Only a human approval mints a patient token** — the
approve action in `QuoteBuilder` is the sole path that creates an itinerary link.

**4. Patient routes carry no database keys and no PII.**
`/itinerary/:token` resolves an opaque, non-UUID token (`mbp_…`, `lib/utils.ts#itineraryToken`),
deliberately shaped so a leaked link cannot be replayed as a database key. The public payload
carries **first name only** — no full name, phone, email, UUID, or clinical history.

**5. Raw AI output is never displayed.**
The UI renders structured cards, badges and status indicators. The JSON inspector on `/ai-activity`
shows **backend event payloads** — parsed fields, scores, decisions — never model text or
chain-of-thought, which never leaves the server.

---

## Routes

### Hospital Operations Portal

| Route | What it does |
|---|---|
| `/dashboard` | KPI tiles (SG leads, AI itineraries, pending reviews, confirmed bookings, SGD saved) + live activity feed + escalation queue |
| `/inquiries` | Pipeline as **Kanban** or **Table**, with search / status / channel filters |
| `/inquiries/:id` | Patient info · AI extracted request · **Quote Builder** · Doctor review panel |
| `/ai-activity` | Real-time workflow log with a JSON debug inspector per event |
| `/messages` | Unified WhatsApp / Telegram / internal inbox with editable AI-drafted replies |
| `/analytics` | Conversion funnel, treatment mix, SGD price comparison, volume trend |

### Patient-facing

| Route | What it does |
|---|---|
| `/itinerary/:token` | Mobile-first pass: 5-step care journey, cost comparison, and CTAs |

Rendered **outside** the operations shell — no sidebar, no internal navigation, no cross-links.

---

## Inquiry pipeline

`NEW_INQUIRY` → `AI_PROCESSING` → `AI_ITINERARY_READY` → `HOSPITAL_REVIEW_REQUIRED` →
`DOCTOR_REVIEW_REQUIRED` → `QUOTE_APPROVED` → `PATIENT_CONFIRMATION_PENDING` →
`CONFIRMED_BOOKING` → `TRAVEL_READY` → `COMPLETED`

`HUMAN_TAKEOVER` is an exception lane reachable from any state when the AI stands down.

Presentation for each status lives in one place: `STATUS_META` in `lib/constants.ts`.

---

## Live demo mode

**RUN LIVE DEMO** in the top bar replays a ~60 second inbound-to-review loop. It drives the same
write paths and emits the same realtime events as a real backend, so the audience watches the
actual UI react to actual state changes.

| t | Stage | What happens |
|---|---|---|
| 0s | `NEW INQUIRY` | Telegram message arrives · toast + chime · card appears on the board |
| 7s | `AI PROCESSING` | Hermes invoked on the backend |
| 20s | `TREATMENT IDENTIFIED` | Mapped to Dental Implant at 94% confidence |
| 33s | `PRICING CALCULATED` | Treatment + specialist fees priced vs the SG benchmark |
| 45s | `TRAVEL CALCULATED` | Ferry, transport and hotel bundled |
| 57s | `HOSPITAL REVIEW REQUIRED` | **AI stops.** Operator lands in the Quote Builder |

Then **Approve Quote** → `QUOTE_APPROVED` → *"Patient Itinerary Ready"* with a live link to
`/itinerary/:token`. The demo deliberately cannot finish itself — the approval is a human action.

Sounds are synthesised with the Web Audio API (no asset files); mute with the speaker icon.

---

## Project structure

```
src/
├── types/index.ts            Domain model — every id typed UUID
├── lib/
│   ├── constants.ts          Thresholds, status metadata, validated chart tokens
│   ├── format.ts             SGD/IDR, dates, relative time, SLA countdowns
│   └── utils.ts              cn(), uuid(), itineraryToken(), masking
├── services/
│   ├── http.ts               Only egress path · timeout · mock fallback
│   ├── api.ts                REST surface, 1:1 with backend endpoints
│   ├── realtime.ts           SSE / WebSocket client with backoff + mock bus
│   ├── demo.ts               Live demo orchestrator
│   └── sound.ts              Web Audio notification tones
├── mock/
│   ├── seed.ts               Fixed-UUID catalogue (patients, hospitals, …)
│   ├── generators.ts         Quote builder, itinerary assembly, HITL gate
│   └── db.ts                 In-memory PostgreSQL stand-in + event bus
├── store/useAppStore.ts      Realtime status, activity feed, demo state
├── hooks/queries.ts          TanStack Query bindings + realtime→cache bridge
├── components/
│   ├── ui/                   Shadcn primitives
│   ├── shared/               StatusBadge, ConfidenceMeter, JsonInspector, …
│   ├── layout/               AppShell, Sidebar, Topbar, DemoRail
│   ├── dashboard/            KpiCard, ActivityFeed
│   ├── inquiries/            KanbanBoard, InquiryTable, QuoteBuilder, panels
│   ├── analytics/            ChartCard, ChartTooltip
│   └── itinerary/            JourneyTimeline
└── pages/                    One file per route
```

---

## Mock data

Pre-seeded with fixed UUID v4 keys so the demo is identical on every reload.

| Entity | Count | Examples |
|---|---|---|
| Singapore patients | 6 | Tan Wei Ming, Priya Menon, Jonathan Lee, Siti Rahman, Marcus Chia, Angela Koh |
| Batam hospitals | 3 | Batam Medical Center — Sekupang SEZ, Awal Bros Batam, Elisabeth Batam Kota |
| Doctors | 5 | Prosthodontics, Ophthalmology, Orthopedics, Internal Medicine, General Surgery |
| Procedures | 6 | Dental Implant, Health Screening, LASIK, Cataract, Knee Arthroscopy, Endoscopy |
| Ferry routes | 6 | HarbourFront ↔ Batam Centre / Sekupang (Batam Fast, Sindo, Majestic, Horizon) |
| Recovery hotels | 4 | HARRIS Batam Centre, Radisson Golf, Nagoya Hill, Best Western Panbil |
| Ground transport | 4 | Private car, wheelchair van, shuttle, ambulance |
| Seeded inquiries | 10 | Covering 10 of the 11 pipeline states |

> These are **demo fixtures**. The hospitals, hotels and ferry operators named are real
> Singapore/Batam businesses used to make the prototype concrete, and are **not contracted
> partners**. Prices are indicative market ranges, not quotations.

Example bundle — dental implant, 1 traveller:

| Line | SGD |
|---|---|
| Dental implant incl. crown | 1,450 |
| Specialist consultation | 45 |
| Ferry, both legs | 58 |
| Recovery hotel, 1 night | 62 |
| Private transport | 48 |
| MedBridge coordination | 35 |
| **Total** | **1,698** |
| Singapore benchmark | 4,980 |
| **Patient saves** | **3,282 (66%)** |

---

## Backend contract

The frontend expects these endpoints under `VITE_API_BASE_URL` (default `/api/v1`). Every
handler in `services/api.ts` falls back to the mock database when the backend is unreachable,
so the UI degrades instead of breaking.

```
GET    /dashboard/kpis
GET    /inquiries?status=&search=&channel=
GET    /inquiries/:id
PATCH  /inquiries/:id/status                          { status, note }
PATCH  /inquiries/:id/assign                          { doctorId, staffName }
POST   /inquiries/:id/quote/line-items                QuoteLineItem
PATCH  /inquiries/:id/quote/line-items/:lineItemId    { quantity, unitPriceSgd, label, detail }
DELETE /inquiries/:id/quote/line-items/:lineItemId
POST   /inquiries/:id/quote/approve                   { approvedByName }     ← mints the token
POST   /inquiries/:id/quote/reject                    { reason }
POST   /inquiries/:id/doctor-review                   { decision, clinicalNotes, doctorId }
GET    /activity?limit=
GET    /messages/threads
POST   /messages/threads/:id/send                     { body, senderName }   ← human-reviewed only
POST   /messages/threads/:id/read
GET    /analytics/summary
GET    /itinerary/:token                              ← public, token-scoped, no PII
POST   /itinerary/:token/confirm
GET    /catalogue/{hospitals|doctors|procedures|ferry-routes|hotels|ground-transport}
GET    /stream                                        ← SSE / WebSocket event frames
```

Realtime frames match the `RealtimeEvent` union in `src/types/index.ts`:
`activity` · `inquiry.created` · `inquiry.updated` · `message.received` · `kpis.updated` ·
`demo.stage`.

### Database notes for the backend

- Every table's primary key is `uuid` with `DEFAULT gen_random_uuid()`; every foreign key is
  `uuid`. No `bigserial`, anywhere.
- `inquiries.itinerary_token` is a separate opaque column with a unique index — **not** the row
  UUID — and should carry an expiry.
- Patient contact fields must be masked at the serializer, not the client. The operations UI
  receives `phoneMasked` / `emailMasked` only.
- Persist `ai_extractions.confidence`, `requires_human_review` and `review_reasons` so the gate
  decision is auditable after the fact.

---

## Design system

Modern healthcare SaaS. Sky Blue primary (`#0ea5e9`), Teal secondary (`#14b8a6`), clinical light
gray canvas (`#f8fafc`), Slate ink (`#0f172a`). Tailwind tokens in `tailwind.config.js`, CSS
variables in `src/index.css`.

**Chart colours are validated, not eyeballed.** The categorical palette in `lib/constants.ts`
passes all six accessibility checks in light *and* dark: lightness band, chroma floor, adjacent
CVD separation (ΔE 21.0 deuteranopia), the normal-vision floor (ΔE 27.1), and ≥3:1 contrast.
Brand sky and brand teal are deliberately **not adjacent slots** — as a pair they measure ΔE 12.8,
below the 15 floor. The funnel uses a separate one-hue ordinal ramp because its stages are
ordered. Every chart ships a table view twin.

---

## Verification

- `npm run typecheck` — clean under `strict`, `noUnusedLocals`, `noUnusedParameters`
- `npm run build` — production bundle builds clean
- Business logic covered by a smoke suite: UUID v4 across all seeds and generated ids, foreign-key
  integrity, the human-in-the-loop gate (low confidence / emergency language / unknown procedure),
  quote arithmetic and SGD→IDR conversion, token opacity and absence of PII in the public payload,
  approval minting a token, realtime event emission, and demo cancellation

---

## Note on the repository

This app lives in `MedBridge/web/`. The Laravel skeleton in the parent directory is an untouched
stock install and is not used by this frontend.
