# Aero Sarathi — Implementation Plan

**Company:** Indo Chariot Pvt Ltd
**Product:** Aero Sarathi — Pre-booking taxi platform (Punjab ↔ Airport ↔ Intercity)
**Document type:** Engineering execution plan (web-first, app later)
**Owner:** Engineering
**Status:** Draft v1

---

## 0. Document Purpose

This document is the single source of truth for *how* Aero Sarathi gets built. It translates the Business PRD, Developer PRD, and Technology stack decisions into a phased, week-by-week engineering roadmap with concrete deliverables, schemas, APIs, infrastructure, and acceptance criteria for each phase.

If a feature is not in this document, it is **not** in scope yet. Scope changes require an explicit update here.

---

## 1. Guiding Principles

1. **Ship the boring booking system first.** No ML, no dynamic pricing, no driver app until the core "user pays → driver assigned → ride completed" loop works end-to-end with real money.
2. **Web before app.** Customer website + admin panel + driver web portal — then native apps.
3. **Money is sacred.** Every payment, refund, payout flows through an idempotent, audit-logged path. No direct DB writes for financial state.
4. **Time-based logic lives in a queue.** Driver assignment, retries, reminders → BullMQ jobs. Never `setTimeout` inside an API handler.
5. **Real data over assumed data.** Build dashboards from week 1 so we learn what to optimize.
6. **One database per concern.** Postgres = truth, Redis = ephemeral/fast, Mongo = logs/analytics.
7. **TypeScript everywhere it runs on Node.** Python only for the algorithm microservice.

---

## 2. High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                       CLIENTS                                  │
│  Customer Web (Next.js)   Admin Web (Next.js)   Driver Web     │
└──────────────┬───────────────────┬───────────────────┬─────────┘
               │ HTTPS / WSS                                       
               ▼                                                   
┌────────────────────────────────────────────────────────────────┐
│           API GATEWAY  (Node.js + Express + Socket.io)         │
│   Auth · Bookings · Payments · Drivers · Tracking · Admin      │
└──────┬──────────┬──────────┬────────────┬──────────┬───────────┘
       │          │          │            │          │            
       ▼          ▼          ▼            ▼          ▼            
   Postgres    Redis    BullMQ Jobs   MongoDB   Python FastAPI   
   (Prisma)  (cache+   (assignment,  (logs,     (pricing,         
             pubsub)    retries,     audit,     matching score,   
                        reminders)   events)    EMI calc)         
       │                                                          
       ▼                                                          
   External: Razorpay · Google Maps · MSG91 · FCM · S3            
```

---

## 3. Tech Stack (Locked)

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | Next.js 14 (App Router) | SSR for SEO, one codebase for 3 surfaces |
| Language | TypeScript (strict) | All Node + frontend code |
| Styling | Tailwind CSS + design tokens | Tokens mirror current homepage CSS variables |
| Client state | Zustand | Booking flow state |
| Server state | TanStack Query | API caching, retries |
| Backend | Node.js 20 + Express | Main API |
| Realtime | Socket.io | Tracking, booking status |
| Job queue | BullMQ (Redis-backed) | All scheduled/retry logic |
| Algorithms svc | Python 3.11 + FastAPI | Pricing, matching, EMI |
| Primary DB | PostgreSQL 16 + Prisma | Users, bookings, payments |
| Cache / pubsub | Redis 7 | GPS, sessions, OTP, surge |
| Logs / analytics | MongoDB 7 | Ride logs, audit, events |
| Payments | Razorpay | Token + final payment |
| Maps | Google Maps Platform | Maps JS, Directions, Places |
| SMS / OTP | MSG91 | India-first |
| Push | Firebase Cloud Messaging | Web push, later mobile |
| Object storage | S3-compatible (Hetzner / AWS S3) | Driver docs, receipts |
| Hosting (web) | Vercel | Customer + Admin + Driver web |
| Hosting (api) | Hetzner Cloud (CX-series) → AWS later | Docker on Ubuntu |
| Container | Docker + docker-compose (dev), systemd or Coolify (prod) | |
| CI/CD | GitHub Actions | Test → build → deploy |
| Error tracking | Sentry | Frontend + backend |
| Logs | Pino → Better Stack / Grafana Loki | Structured JSON |
| Uptime | UptimeRobot or BetterStack | |

---

## 4. Repository Structure (Monorepo)

```
aero-sarathi/
├── apps/
│   ├── web/                # Next.js — customer site
│   ├── admin/              # Next.js — admin panel
│   ├── driver/             # Next.js — driver web portal
│   ├── api/                # Node.js + Express + Socket.io
│   └── algo/               # Python FastAPI microservice
├── packages/
│   ├── db/                 # Prisma schema + client
│   ├── types/              # Shared TS types (DTOs, enums)
│   ├── ui/                 # Shared React components (design system)
│   ├── config/             # Shared config: ESLint, TS, Tailwind
│   └── sdk/                # Typed API client used by web/admin/driver
├── infra/
│   ├── docker/             # Dockerfiles
│   ├── compose/            # docker-compose.dev.yml
│   └── deploy/             # Deployment scripts, Caddy/nginx config
├── docs/
│   ├── implementation.md   # ← this file
│   ├── api.md              # OpenAPI / endpoint reference
│   └── runbooks/           # On-call procedures
├── .github/workflows/      # CI/CD
├── turbo.json              # Turborepo
├── pnpm-workspace.yaml
└── package.json
```

**Tooling:** pnpm + Turborepo. Single `pnpm install`, single `pnpm dev` boots everything.

---

## 5. Environments

| Env | URL | Purpose | Data |
|---|---|---|---|
| `local` | localhost | Developer machine | Seeded fake data |
| `dev` | dev.aerosarathi.com | Auto-deploy from `develop` | Sandbox payments, test SMS |
| `staging` | staging.aerosarathi.com | Pre-prod QA, demo for stakeholders | Production-like, sandbox payments |
| `prod` | aerosarathi.com | Live | Real money |

Razorpay test mode + MSG91 test sender for non-prod. Separate Google Maps API keys per env with HTTP referrer + IP restrictions.

---

## 6. Database Schema (Phase 1 baseline)

PostgreSQL via Prisma. Snake_case columns, UUID primary keys (`gen_random_uuid()`).

```prisma
// packages/db/prisma/schema.prisma

model User {
  id          String   @id @default(uuid())
  phone       String   @unique           // +91XXXXXXXXXX
  name        String?
  email       String?
  role        Role     @default(CUSTOMER)
  createdAt   DateTime @default(now())
  bookings    Booking[]
}

enum Role { CUSTOMER ADMIN OPS DRIVER }

model Driver {
  id            String   @id @default(uuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id])
  licenseNo     String   @unique
  status        DriverStatus @default(OFFBOARDING)
  homeCity      String
  vehicleId     String?  @unique
  vehicle       Vehicle? @relation(fields: [vehicleId], references: [id])
  rating        Float    @default(5.0)
  totalTrips    Int      @default(0)
  bookings      Booking[]
}

enum DriverStatus { ACTIVE INACTIVE ON_TRIP OFFBOARDING SUSPENDED }

model Vehicle {
  id            String   @id @default(uuid())
  regNo         String   @unique          // PB-XX-XXXX
  category      VehicleCategory
  model         String
  capacity      Int
  ownership     Ownership                // COMPANY | PARTNER
  emiPlanId     String?
  driver        Driver?
}

enum VehicleCategory { HATCHBACK SEDAN SUV LUXURY TEMPO }
enum Ownership { COMPANY PARTNER }

model Booking {
  id               String   @id @default(uuid())
  code             String   @unique       // AS-YYMMDD-XXXX
  userId           String
  user             User     @relation(fields: [userId], references: [id])
  driverId         String?
  driver           Driver?  @relation(fields: [driverId], references: [id])
  vehicleCategory  VehicleCategory
  pickupAddress    String
  pickupLat        Float
  pickupLng        Float
  dropAddress      String
  dropLat          Float
  dropLng          Float
  scheduledAt      DateTime
  estimatedKm      Float
  estimatedMin     Int
  fareTotal        Int                    // paise
  tokenAmount      Int                    // paise (paid online)
  balanceAmount    Int                    // paise (paid to driver)
  status           BookingStatus @default(PENDING)
  statusHistory    BookingStatusEvent[]
  payments         Payment[]
  cancellation     Cancellation?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([scheduledAt, status])
  @@index([userId])
}

enum BookingStatus {
  PENDING CONFIRMED DRIVER_ASSIGNED EN_ROUTE ONGOING COMPLETED CANCELLED NO_SHOW
}

model BookingStatusEvent {
  id         String   @id @default(uuid())
  bookingId  String
  booking    Booking  @relation(fields: [bookingId], references: [id])
  from       BookingStatus?
  to         BookingStatus
  actorId    String?
  reason     String?
  createdAt  DateTime @default(now())
}

model Payment {
  id              String   @id @default(uuid())
  bookingId       String
  booking         Booking  @relation(fields: [bookingId], references: [id])
  amount          Int                    // paise
  type            PaymentType            // TOKEN | BALANCE | REFUND
  status          PaymentStatus
  gateway         String   @default("razorpay")
  gatewayOrderId  String?  @unique
  gatewayPayId    String?  @unique
  failureReason   String?
  createdAt       DateTime @default(now())
}

enum PaymentType { TOKEN BALANCE REFUND }
enum PaymentStatus { CREATED PENDING SUCCESS FAILED REFUNDED }

model Cancellation {
  id           String   @id @default(uuid())
  bookingId    String   @unique
  booking      Booking  @relation(fields: [bookingId], references: [id])
  cancelledBy  Role
  reason       String
  feeAmount    Int                       // paise
  refundAmount Int                       // paise
  createdAt    DateTime @default(now())
}

model FareRule {
  id              String   @id @default(uuid())
  category        VehicleCategory
  baseFare        Int                    // paise
  perKm           Int
  perMin          Int
  nightSurcharge  Float    @default(0)
  tollIncluded    Boolean  @default(false)
  effectiveFrom   DateTime
  effectiveTo     DateTime?
}

model OtpRequest {
  id         String   @id @default(uuid())
  phone      String
  codeHash   String
  attempts   Int      @default(0)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  @@index([phone, createdAt])
}
```

**Redis keys (conventions):**
- `driver:loc:{driverId}` → GeoJSON, TTL 30s, updated every 5s from driver client.
- `surge:{routeKey}` → multiplier float, TTL 5min.
- `otp:lock:{phone}` → rate-limit counter, TTL 1h.
- `session:{jti}` → JWT denylist on logout.

**Mongo collections:**
- `ride_logs` — per-second GPS pings during ride.
- `audit_events` — every state change with before/after.
- `analytics_events` — funnel events (`booking_started`, `quote_seen`, `payment_initiated`, etc.).

---

## 7. Phased Roadmap

Each phase has: **Goal · Deliverables · APIs · Acceptance criteria · Out of scope**.

---

### **Phase 0 — Foundations (Pre-Week 1)**

**Goal:** Repo, environments, and CI ready before any product code.

**Deliverables**
- Monorepo scaffolded with pnpm + Turborepo (structure in §4).
- `apps/web` boots with the existing homepage HTML ported to Next.js components (already partially designed — see `aero-sarathi-homepage.html`).
- Prisma initialized; Postgres + Redis + Mongo running via `docker-compose.dev.yml`.
- Shared packages: `db`, `types`, `ui`, `config`, `sdk`.
- ESLint + Prettier + Husky pre-commit running typecheck.
- GitHub Actions: lint → typecheck → unit tests → build on every PR.
- Vercel projects created for `web`, `admin`, `driver` (placeholders).
- Hetzner CX22 VM provisioned with Docker, Caddy reverse proxy, automatic TLS.
- Sentry projects created (one per app).
- `.env.example` files committed for every app.
- Branch protection on `main` and `develop`. PRs require 1 review + green CI.

**Acceptance**
- `pnpm install && pnpm dev` brings up web (3000), api (4000), algo (5000), and all databases.
- A pushed commit to `develop` auto-deploys `web` to `dev.aerosarathi.com`.

---

### **Phase 1 — Customer Booking Flow (Weeks 1–2)**

**Goal:** A visitor can land on the site, get a fare quote, and create a `PENDING` booking. No payments yet, no auth required for the quote step.

**Deliverables**
1. **Homepage** ported from `aero-sarathi-homepage.html` into Next.js with:
   - Routing (`/`, `/routes`, `/vehicles`, `/about`, `/contact`).
   - Booking widget as a real React component backed by Zustand store.
2. **Pickup/Drop autocomplete** via Google Places API (debounced, session tokens, India region biased).
3. **Quote endpoint** that calls Google Directions API server-side (key never exposed to client) and computes fare from `FareRule`.
4. **Vehicle selection screen** (`/book/quote`) showing 4 categories with per-category fares.
5. **Booking draft** stored client-side (Zustand + localStorage) until login.
6. **Phone OTP auth** (MSG91) — required to confirm booking.
7. **Booking creation** in `PENDING` state.
8. Basic SEO: metadata per route, sitemap, robots.txt, Open Graph tags.

**APIs (api app)**
```
POST   /api/v1/quotes              { pickup, drop, scheduledAt }
                                   → { quoteId, distanceKm, durationMin, fares: [...] }
POST   /api/v1/auth/otp/request    { phone }
POST   /api/v1/auth/otp/verify     { phone, code } → { accessToken, refreshToken }
POST   /api/v1/bookings            { quoteId, vehicleCategory, passengerName, passengerPhone }
                                   → Booking (status: PENDING)
GET    /api/v1/bookings/:id        → Booking (own only)
```

**Acceptance**
- A user can complete: enter pickup → enter drop → pick date/time → see 4 fare options → tap "Book" → OTP login → land on a "Pending Payment" screen with a booking ID.
- All fares match a deterministic formula from the active `FareRule`. Unit tests cover ≥10 fare scenarios.
- Lighthouse mobile score ≥ 85 on the homepage.

**Out of scope:** payments, driver assignment, tracking, cancellation policies UI.

---

### **Phase 2 — Payments & Confirmation (Week 3)**

**Goal:** Booking flow becomes real money. `PENDING → CONFIRMED` on successful token payment.

**Deliverables**
1. **Razorpay integration** (Standard Checkout on web).
   - Server creates Razorpay order, returns `orderId`.
   - Client opens checkout; on success, sends `payment_id` + `signature` to server.
   - Server **verifies signature** (HMAC SHA256 with key secret) and only then marks `CONFIRMED`.
2. **Webhook endpoint** for Razorpay events (`payment.captured`, `payment.failed`, `refund.processed`). Idempotent — dedupe by `event.id` in a `webhook_events` table.
3. **Booking confirmation page** with booking code, fare breakdown, downloadable PDF receipt.
4. **Email + SMS confirmation** to passenger (MSG91 transactional template, SendGrid for email).
5. **My Bookings page** (`/account/bookings`) — list + detail views.
6. **Cancellation UI** (Phase 2 policy from PRD): free <30min after booking, ₹200 within 24h, 25% 6–24h, 50–100% <6h, no refund for no-show. Refunds go via Razorpay Refunds API. Logic centralized in `algo` service so policy can be tweaked without redeploying API.

**APIs**
```
POST   /api/v1/bookings/:id/payment/intent   → { razorpayOrderId, amount, key }
POST   /api/v1/bookings/:id/payment/verify   { razorpay_payment_id, razorpay_signature }
POST   /api/v1/webhooks/razorpay             (Razorpay only, signature-verified)
POST   /api/v1/bookings/:id/cancel           { reason } → { refundAmount, feeAmount }
GET    /api/v1/bookings/:id/receipt          → PDF stream
```

**Security**
- Webhook secret in env, never logged.
- Idempotency keys on `POST /payment/verify`.
- Payment state transitions only via webhook OR verified client callback; never client-trusted.

**Acceptance**
- Test booking with Razorpay test card moves `PENDING → CONFIRMED` and triggers SMS within 30s.
- Killing the browser mid-payment but completing it later still results in `CONFIRMED` (webhook drives state).
- Refund triggered by cancellation appears in Razorpay dashboard with correct amount per policy.

---

### **Phase 3 — Admin Panel v1 (Week 4)**

**Goal:** Internal team can run the business manually before automation arrives.

**Deliverables (apps/admin)**
1. **Auth**: email/password + 2FA (TOTP), role-gated routes.
2. **Dashboard**: today's bookings count, revenue, pending-assignment count, alerts.
3. **Bookings table** — filter by status / date / route; detail drawer with full timeline.
4. **Manual driver assignment** — searchable picker, sets `DRIVER_ASSIGNED`.
5. **Drivers CRUD** + document upload to S3 (license, RC, insurance, PUC) with expiry tracking.
6. **Vehicles CRUD** with EMI plan attachment.
7. **Fare rules editor** — versioned, effective-dated.
8. **Refund console** — initiate manual refund with reason; audit-logged.
9. **Audit log viewer** (reads from Mongo `audit_events`).

**APIs (admin-only, RBAC)**
```
GET    /api/v1/admin/bookings?...
POST   /api/v1/admin/bookings/:id/assign-driver { driverId }
POST   /api/v1/admin/bookings/:id/refund        { amount, reason }
GET    /api/v1/admin/drivers
POST   /api/v1/admin/drivers
PATCH  /api/v1/admin/drivers/:id
POST   /api/v1/admin/drivers/:id/documents
GET    /api/v1/admin/vehicles
POST   /api/v1/admin/fare-rules
GET    /api/v1/admin/audit?entity=booking&id=...
```

**Acceptance**
- Ops user can fulfill an entire booking end-to-end manually from this panel.
- Every state-changing admin action writes an entry to `audit_events`.

---

### **Phase 4 — Driver Assignment Automation + SMS (Week 5)**

**Goal:** Replace manual assignment with the PRD's automated logic.

**Deliverables**
1. **BullMQ queues**:
   - `booking-assignment` — schedule a job at `scheduledAt - 3h` when booking is `CONFIRMED`.
   - `assignment-retry` — every 5 min until success or T-30min cutoff.
   - `admin-alert` — fires if cutoff reached without assignment.
   - `pre-trip-reminders` — passenger SMS at T-24h and T-2h.
2. **Driver matching** (in `algo` FastAPI service):
   - Inputs: pickup point, vehicle category, scheduled time, available drivers.
   - Score = weighted sum of (distance to pickup, rating, idle time, home-city match).
   - Returns ranked list; API service picks the top candidate and offers it.
3. **Driver web portal v1** (`apps/driver`):
   - Phone OTP login.
   - "Available / Unavailable" toggle.
   - "New offer" screen with accept / decline (60s timeout → decline).
   - Today's trips list.
4. **SMS templates** (MSG91 DLT-registered):
   - Passenger: booking confirmed, driver assigned (name + phone + car + plate), driver arriving, ride started, ride completed.
   - Driver: new assignment offer with deep link.

**Worker architecture**
- Workers run in a separate Node process (`apps/api/src/worker.ts`), same image, different command. This isolates job failures from API responsiveness.

**Acceptance**
- For a booking scheduled 4h in the future, an assignment job fires at T-3h, picks a driver, and SMS arrives to both parties within 60s.
- If first driver declines, system retries within 5min with the next-best driver.
- If no driver is found by T-30min, admin gets a Slack/email alert and the booking surfaces in a red "needs attention" list.
- Unit tests for matcher score function; integration test with fake drivers in Postgres.

---

### **Phase 5 — Live Tracking (Week 6)**

**Goal:** Passenger can watch the driver approach and follow the live trip.

**Deliverables**
1. **Driver location publisher** — driver web/app sends `{ lat, lng, heading, speed }` every 5s via Socket.io while on duty.
2. **Server** stores latest in Redis (`driver:loc:{driverId}`, TTL 30s), appends to Mongo `ride_logs` if `ONGOING`.
3. **Passenger tracking page** (`/track/:bookingCode`):
   - Public link (HMAC-signed, expires after trip + 24h) — shareable with family.
   - Google Map with driver marker, pickup/drop pins, polyline route.
   - ETA recomputed every 30s via Directions API (cached aggressively).
   - Status timeline: Assigned → En route → Arrived → Ongoing → Completed.
4. **Trip lifecycle endpoints** (driver app):
   ```
   POST /api/v1/driver/trips/:id/start    (status → ONGOING)
   POST /api/v1/driver/trips/:id/arrive   (at pickup)
   POST /api/v1/driver/trips/:id/complete { finalKm, finalAmount }
   ```
5. **SOS button** on tracking page → triggers admin alert + logs event.

**Acceptance**
- Tracking page updates driver position within 10s of GPS change.
- Closing and reopening the tab restores live state.
- 1000-concurrent-tracker load test passes on a single CX32 instance.

---

### **Phase 6 — Post-Launch: Intelligence Layer (Weeks 7–10)**

Build only after we have ≥500 real bookings of data.

1. **Dynamic pricing v1** — rule-based surge by (route × time-of-day × day-of-week × demand/supply ratio). Multiplier capped at 1.8x, surfaced transparently in fare breakdown.
2. **Analytics dashboard** (admin) — funnel, conversion, cancellation reasons, driver utilization, route-level P&L.
3. **EMI tracker** — per-vehicle finance ledger, monthly P&L statement export.
4. **Driver earnings statements** — weekly auto-generated PDF + payout reconciliation.
5. **Customer wallet** — store credits from refunds, referral credits.
6. **Referral program** — share code → first ride discount for both parties.
7. **Reviews & ratings** post-trip (passenger ↔ driver).

---

### **Phase 7 — Mobile Apps (Weeks 11–16)**

After web product-market fit signals (repeat bookings, retention).

- **React Native + Expo** for both passenger and driver apps to reuse TypeScript SDK and ~60% of UI logic.
- Native push (FCM + APNs), background location for driver, deep links from SMS.
- Same backend, no rewrites.

---

### **Phase 8 — Scale & Expansion (Weeks 17+)**

- Demand forecasting (Prophet / lightweight ML in `algo` service).
- Multi-city onboarding workflow (city configs, local fare rules, hub locations).
- Corporate accounts (invoicing, GST, monthly billing).
- EV fleet — charging-aware assignment.
- Migration plan Hetzner → AWS if/when we need multi-region or enterprise compliance.

---

## 8. Non-Functional Requirements

| Area | Target |
|---|---|
| Availability | 99.5% in Phase 1–5, 99.9% from Phase 6 |
| API p95 latency | < 300ms (excluding payment gateway) |
| Page TTI (web) | < 3s on 4G mobile |
| Tracking update latency | < 10s end-to-end |
| Payment webhook processing | < 5s, with retry on failure |
| Data backup | Postgres daily snapshot + 7-day PITR; offsite copy to S3 weekly |
| RPO / RTO | RPO 1h, RTO 4h in Phase 1–5 |
| Security | OWASP Top 10 covered, dependency audit weekly, secrets via env (no commits) |
| PII | Phone numbers + addresses encrypted at rest (Postgres `pgcrypto`) from Phase 2 |
| Logging | Structured JSON, no PII in logs, 30-day retention |

---

## 9. Security Checklist (applies to every phase)

- [ ] All endpoints behind HTTPS (Caddy auto-TLS).
- [ ] JWT access tokens (15min) + refresh tokens (7d, rotated, denylist in Redis).
- [ ] Rate limit OTP requests: 3/min/phone, 10/hour/IP.
- [ ] Razorpay webhook signature verification — request rejected if invalid.
- [ ] Google Maps key restricted by HTTP referrer (web) and IP (server).
- [ ] CORS allowlist per env (no wildcards in prod).
- [ ] Helmet + CSP headers on all Next.js apps.
- [ ] SQL — Prisma only, no raw queries unless reviewed.
- [ ] File uploads scanned (ClamAV) + extension/mimetype allowlist + signed S3 URLs.
- [ ] Admin panel: 2FA mandatory, IP allowlist option, session timeout 30min idle.
- [ ] Secrets in Doppler or 1Password Connect, never in repo.
- [ ] Dependabot + `pnpm audit` in CI.

---

## 10. Testing Strategy

| Layer | Tool | Coverage target |
|---|---|---|
| Unit (TS) | Vitest | ≥ 70% on `algo` logic + fare/cancellation rules |
| Unit (Py) | Pytest | ≥ 80% on matcher + pricing |
| API integration | Supertest + test Postgres (Testcontainers) | All critical paths |
| E2E web | Playwright | Booking flow, payment (Razorpay test mode), cancellation |
| Load | k6 | 1000 concurrent quotes, 200 concurrent payments |
| Manual QA checklist | Per release | In `docs/qa/` |

Every PR runs unit + integration. E2E + load run nightly on `staging`.

---

## 11. Observability

- **Logs:** Pino (Node) + structlog (Py) → stdout → Loki via Promtail. Trace ID per request, propagated to algo service.
- **Metrics:** Prometheus scraping `/metrics` on api + algo + workers. Grafana dashboards for: bookings/min, payment success rate, assignment latency, queue depth, error rate.
- **Errors:** Sentry with source maps; release tracking tied to git SHA.
- **Alerts:** PagerDuty (or BetterStack on-call) for: 5xx rate > 1%, payment failure rate > 5%, queue depth > 100, no assignment success in 15min.

---

## 12. Deployment

**Web apps** — Vercel auto-deploys per branch. Preview URLs on every PR.

**API + algo + workers** — Docker images built in CI, pushed to GitHub Container Registry, pulled by Hetzner VM on tag push. Zero-downtime via Caddy + two-container rolling restart. Database migrations run as a separate `migrate` job before the new container goes live.

**Rollback** — `git revert` + redeploy, OR `docker pull <previous-tag> && systemctl restart aero-api`. Documented in `docs/runbooks/rollback.md`.

---

## 13. Definition of Done (per ticket)

- [ ] Code merged to `develop` via PR with ≥ 1 review.
- [ ] All CI checks green.
- [ ] Unit + integration tests added/updated.
- [ ] Schema changes via Prisma migration (no manual SQL).
- [ ] API documented in `docs/api.md` (or OpenAPI spec).
- [ ] No new Sentry errors after 24h on `dev`.
- [ ] Manual QA passed on `staging`.
- [ ] Feature flagged if risky (use `unleash` or simple env-based flags).

---

## 14. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Razorpay outage during peak | Lost bookings | Queue payment retries; manual offline-booking fallback in admin |
| Google Maps cost overrun | ₹ burn | Cache directions per (pickup, drop, hour); per-day budget alerts; session tokens for autocomplete |
| Driver supply gap | Failed assignments | Admin alert at T-30min; partner-fleet integration as backup; over-recruit in Phase 0 |
| GPS spoofing by driver | Fraud | Server-side speed/distance sanity checks; randomized in-person checks |
| Payment fraud / chargebacks | ₹ + reputation | 3DS enforced; Razorpay risk rules; manual review queue for high-value bookings |
| Single Hetzner VM failure | Total outage | Phase 6: move Postgres to managed (Neon / RDS), API to ≥2 instances behind LB |
| PII leak | Legal + reputation | Encryption at rest; access logs; principle of least privilege; quarterly access review |

---

## 15. Open Decisions (need answers before next phase kickoff)

1. Razorpay account legal entity ready? (PAN, GST, bank account in Indo Chariot Pvt Ltd name)
2. MSG91 DLT template registration — who owns this?
3. Hetzner vs AWS for Phase 1 — confirm Hetzner (assumed in stack).
4. Logo + brand assets — final SVGs in `packages/ui/assets/`?
5. Domain DNS — who controls `aerosarathi.com`?
6. Payout schedule to drivers — weekly? bi-weekly? (Drives wallet model.)
7. Customer support channel for v1 — WhatsApp Business? phone? in-app chat (later)?

---

## 16. Appendix — Week-by-Week Cheat Sheet

| Week | Focus | Demo at end of week |
|---|---|---|
| 0 | Foundations | `pnpm dev` runs everything; homepage live on dev URL |
| 1 | Quote + autocomplete | Get fare for any Punjab → Delhi airport route |
| 2 | OTP + booking creation | Logged-in user creates a PENDING booking |
| 3 | Razorpay + cancellation | End-to-end paid booking; cancellation with refund |
| 4 | Admin panel | Ops team operates a booking entirely from admin |
| 5 | Automated assignment | T-3h job assigns driver, SMS both parties |
| 6 | Live tracking | Family member opens share link, watches driver |
| 7–10 | Intelligence layer | Dynamic pricing, analytics, driver earnings |
| 11–16 | Mobile apps | Passenger + driver RN apps on stores |
| 17+ | Scale | Multi-city, corporate, EV-aware |

---

**End of document.**

Update history at the top of this file when phases close or scope changes.
