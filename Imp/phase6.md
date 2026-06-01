# Phase 6 — Intelligence Layer (Weeks 7–10)

**Parent document:** [implementation.md](implementation.md)
**Previous phases:** [phase1.md](phase1.md) · [phase2.md](phase2.md) · [phase3.md](phase3.md) · [phase4.md](phase4.md) · [phase5.md](phase5.md)
**Phase status:** Not started
**Duration:** 4 weeks (20 working days)
**Prereq:** Phases 1–5 complete — booking, payment, admin, assignment automation, live tracking all live. `Trip` rows have `actualKm/actualMin`, `ride_logs` populated, Razorpay refunds working, audit pipeline operational.

---

## 1. Phase Goal

Layer **business intelligence and growth mechanics** on top of the working operational platform. Until now the platform *runs trips*. Phase 6 makes it *smart and sticky*:

- Prices adapt to demand/supply (rule-based surge, capped, transparent).
- Operators see the business through dashboards instead of raw tables.
- Drivers get earnings statements + EMI tracking for vehicle-financed drivers.
- Customers get a wallet, referrals, and the ability to rate trips.
- Reviews feed back into the assignment score (Phase 4) closing the quality loop.

This is the largest phase by surface area, so it is split into **four weekly tracks** that can partly parallelize: pricing, analytics, money (wallet/EMI/earnings), and engagement (referrals/reviews/notifications-centre).

**Definition of "done" for Phase 6:**
> A founder opens an analytics dashboard and sees today's GMV, trips, cancellation rate, and driver utilization. A customer books at 6 PM Friday CHD→DEL and sees "Demand is high — fares up to 1.4x" with the surged price shown transparently before paying, applies a ₹100 wallet credit earned from referring a friend, completes the trip, and rates the driver 5 stars. The driver sees the trip in a weekly earnings statement; if they're on an EMI plan, the platform-retained EMI cut is itemized. The 5-star rating nudges that driver's assignment score up for the next ride.

---

## 2. Scope

### Track A — Dynamic Pricing v1 (Week 7)
- Rule-based surge multiplier per **route × time-bucket × demand/supply ratio**, capped at **1.8x**, floor **1.0x**.
- Computed in `apps/algo` `/pricing/quote`; consumed by the Phase 1 quote endpoint.
- Surge transparency: customer always sees base fare + surge component separately; never silently inflated.
- Surge "freeze": the quoted multiplier is locked into the `Quote` row for its 15-min validity (no bait-and-switch).
- Admin surge controls: per-route caps, blackout (force 1.0x), manual surge override with audit + auto-expiry.
- Surge heatmap in admin live view.

### Track B — Analytics & Reporting (Week 8)
- Analytics event pipeline → Mongo `analytics_events` → nightly rollups into Postgres `daily_metrics`.
- Operator dashboard: GMV, trips, AOV, cancellation %, no-show %, driver utilization, acceptance rate, surge incidence, top routes, funnel (quote→book→pay→complete).
- Finance dashboard: revenue, refunds, EMI collections, payout liability, GST summary.
- Scheduled email reports (daily ops digest, weekly founder summary).
- CSV/Excel export for any table.

### Track C — Money: Wallet, EMI, Driver Earnings (Week 9)
- Customer wallet (credits from refunds + referrals + goodwill; debit on booking). Ledger-based, double-entry, immutable.
- Wallet as a partial payment method alongside Razorpay.
- EMI tracker: vehicle-financed drivers; platform retains an EMI slice per trip; schedule, paid/pending, arrears.
- Driver earnings statements: weekly PDF, per-trip breakdown (fare − commission − EMI cut + incentives), payout reconciliation.
- Payout liability ledger (we owe driver X) — actual disbursement is manual bank transfer logged in admin (real payout rails deferred).

### Track D — Engagement: Referrals, Reviews, Notification Centre (Week 10)
- Referral program: unique code per customer, reward both sides on referee's first completed trip, fraud guards.
- Reviews & ratings: 1–5 stars + tags + free text, both directions (customer→driver, driver→customer).
- Rating aggregation → `Driver.rating` (Bayesian-smoothed) feeding Phase 4 assignment score.
- In-app notification centre (web): persistent feed of booking events, wallet changes, promos.
- Customer-facing trip history with receipts, ratings, rebook.

### Explicitly OUT of scope (deferred)
- ML demand forecasting (Prophet/ML) — Phase 8. Phase 6 surge is **rule-based only**.
- Automated payout rails (RazorpayX / bank API) — manual transfer + ledger only.
- In-trip chat / call masking — moved here from Phase 5 scope note but **deferred to Phase 7** with native apps unless time permits as a stretch.
- Loyalty tiers / subscriptions.
- Coupon/promo-code engine beyond referral credits (basic promo codes are a stretch goal).
- Multi-currency, corporate billing/GST invoicing per-company — Phase 8.

---

## 3. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-6.1 | customer | see if a fare is surged and why, before paying | I trust the price |
| US-6.2 | customer | use my referral/refund credits toward a booking | I save money |
| US-6.3 | customer | rate my driver and trip | good drivers get rewarded |
| US-6.4 | customer | refer a friend and both get credit | we both benefit |
| US-6.5 | customer | see all my past trips with receipts and rebook | it's convenient |
| US-6.6 | driver | see a weekly earnings statement with EMI itemized | I understand my pay |
| US-6.7 | driver | know my rating and how it affects assignments | I improve service |
| US-6.8 | ops | see live business metrics on a dashboard | I run the business by data |
| US-6.9 | finance | export revenue/refund/EMI/GST reports | I close the books |
| US-6.10 | finance | track EMI collections and arrears per driver | financed vehicles stay current |
| US-6.11 | ops | override or cap surge on a route | I respond to ground reality |
| US-6.12 | platform | down-rank low-rated drivers in assignment | quality self-corrects |

---

## 4. Architecture Slice for Phase 6

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer Web                Admin Web              Driver Web     │
│  - surge-aware quote         - analytics dash       - earnings     │
│  - wallet + apply credit     - finance dash         - rating view  │
│  - referrals + reviews       - surge controls                      │
│  - trip history              - reviews moderation                  │
└───────┬───────────────────────────┬───────────────────┬──────────┘
        │                           │                   │
        ▼                           ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  API (apps/api)  /api/v1 + /admin + /driver                       │
│  modules: pricing, wallet, emi, earnings, referrals, reviews,     │
│           analytics, reports                                       │
│  ledger services (double-entry) · rollup workers · report workers │
└───┬──────────┬──────────┬───────────┬───────────┬────────────────┘
    │          │          │           │           │
    ▼          ▼          ▼           ▼           ▼
Postgres    Redis     Mongo        algo        BullMQ
(ledgers,  (surge    (analytics_   /pricing    (rollup-nightly,
 wallet,    cache,    events,      /quote      report-email,
 emi,       demand    rollup       (surge      rating-recompute,
 reviews,   counters) source)      rules)      referral-credit)
 metrics)
```

`apps/algo` gains `/pricing/quote` (surge math). Everything else is API + DB + workers. No new third-party services except an optional spreadsheet export lib and the existing SendGrid for reports.

---

## 5. Track A — Dynamic Pricing v1

### 5.1 Concept

Final fare = `baseFare(vehicleClass, distance, route) × surgeMultiplier`, where `surgeMultiplier ∈ [1.0, 1.8]`.

Surge is a pure function of three rule inputs:
1. **Route bucket** — origin-zone → dest-zone pair (e.g. CHD↔DEL, CHD↔Local, Intercity-A).
2. **Time bucket** — day-type (weekday/weekend/holiday) × hour-band (e.g. 0–5, 5–8 morning peak, 8–17, 17–21 evening peak, 21–24).
3. **Live demand/supply ratio** — `activeDemand / availableSupply` in the origin zone over a rolling 30-min window.

No machine learning. All rules live in `FareRule` (extended) + a new `SurgeRule` table, both editable in admin and append-only/versioned (mirrors Phase 3 fare-rule pattern).

### 5.2 Demand/supply signal

Maintained in Redis, updated by existing events:
- `demand:{zone}` — sorted set of booking-create timestamps in last 30 min (ZADD on quote→book, ZREMRANGEBYSCORE to trim). Count = demand.
- `supply:{zone}` — count of drivers `ONLINE` whose `home zone` or `lastLoc zone` == zone (from Phase 4/5 driver location). Refreshed by a 60s job.
- `ratio = demand / max(supply, 1)`.

Mapped to a surge step:

| ratio | surge |
|---|---|
| < 0.8 | 1.0x |
| 0.8–1.2 | 1.1x |
| 1.2–1.8 | 1.25x |
| 1.8–2.5 | 1.4x |
| 2.5–3.5 | 1.6x |
| > 3.5 | 1.8x (cap) |

Time-bucket adds a **base multiplier floor** (e.g. evening peak forces minimum 1.1x even if supply is fine). Final = `max(demandSurge, timeFloor)`, then clamped to route cap.

### 5.3 `apps/algo` `/pricing/quote`

```
POST /algo/v1/pricing/quote   (internal, X-Internal-Auth)
req:  { routeBucket, timeBucket, demand, supply, vehicleClass, baseFare, routeCapMultiplier }
res:  { surgeMultiplier, surgedFare, breakdown: { demandSurge, timeFloor, capApplied }, ruleVersion }
```

Pure, deterministic, fully unit-tested (≥ 20 cases incl. cap, floor, clamp, divide-by-zero supply). Stateless — API supplies demand/supply read from Redis.

### 5.4 Integration into Phase 1 quote

`POST /api/v1/quotes` (Phase 1) now:
1. Compute baseFare (Phase 1 logic, unchanged).
2. Resolve route + time bucket; read demand/supply from Redis; look up route cap from `SurgeRule`.
3. Call `algo /pricing/quote`.
4. Persist `Quote` with `baseFare`, `surgeMultiplier`, `surgedFare`, `surgeRuleVersion`, `surgeBreakdown`. **Lock** this multiplier for the quote's 15-min TTL.
5. Return both numbers + a human label: `"Demand is high in Chandigarh — fares up to 1.4x right now."` only when multiplier > 1.0.

When the customer proceeds to pay (Phase 2), the **locked** surged fare from the Quote row is used — never recomputed. Prevents bait-and-switch and race conditions.

### 5.5 Admin surge controls

`/admin/pricing` (ADMIN+, FINANCE read):
- Surge rule table (route caps, time floors) — append-only versioned edits with audit, identical pattern to Phase 3 fare rules.
- **Blackout toggle** per route → forces 1.0x (e.g. festival goodwill).
- **Manual override**: set a fixed multiplier on a route for a time window (auto-expires; audit-logged; banner in customer UI stays honest — still shows the surged price transparently).
- Live surge heatmap overlay on the Phase 5 `/admin/live` map (zone color by current multiplier).

### 5.6 Data model (Track A)

```prisma
model SurgeRule {
  id              String   @id @default(uuid())
  routeBucket     String                       // "CHD-DEL", "CHD-LOCAL", ...
  capMultiplier   Float    @default(1.8)
  timeFloors      Json                          // [{ dayType, hourBand, floor }]
  blackout        Boolean  @default(false)
  version         Int
  supersededById  String?
  createdById     String                        // AdminUser
  createdAt       DateTime @default(now())
  @@index([routeBucket, version])
}

model SurgeOverride {
  id            String   @id @default(uuid())
  routeBucket   String
  multiplier    Float
  startsAt      DateTime
  endsAt        DateTime
  reason        String
  createdById   String
  createdAt     DateTime @default(now())
  @@index([routeBucket, startsAt, endsAt])
}

model Quote {
  // existing Phase 1 fields ...
  baseFare           Int
  surgeMultiplier    Float    @default(1.0)
  surgedFare         Int
  surgeRuleVersion   Int?
  surgeBreakdown     Json?
}
```

---

## 6. Track B — Analytics & Reporting

### 6.1 Event pipeline

A small `track(event, props)` helper (server + client) writes to Mongo `analytics_events`:

```json
{ "_id":"...", "event":"quote_created", "ts":"...", "userId":"...|null",
  "sessionId":"...", "props":{ "routeBucket":"CHD-DEL","vehicleClass":"SEDAN","surge":1.4 } }
```

Key events: `quote_created`, `booking_created`, `payment_succeeded`, `booking_cancelled`, `trip_completed`, `no_show`, `offer_sent/accepted/declined`, `referral_signup`, `review_submitted`, `wallet_credit/debit`, `surge_applied`, `track_page_view`.

Client events go through a single batched `POST /api/v1/events` (max 20/batch, fire-and-forget). Server events written directly. PII minimized — store ids, not names/phones.

### 6.2 Rollups

Nightly worker `rollup-nightly` (runs 02:30 IST) aggregates yesterday's `analytics_events` + Postgres truth tables into `daily_metrics`:

```prisma
model DailyMetric {
  id              String   @id @default(uuid())
  date            DateTime @db.Date
  dimension       String                       // "global" | "route:CHD-DEL" | "vehicle:SEDAN"
  trips           Int
  gmvPaise        BigInt
  aovPaise        BigInt
  quotes          Int
  bookings        Int
  cancellations   Int
  noShows         Int
  refundsPaise    BigInt
  surgeTripCount  Int
  avgSurge        Float
  driverActive    Int
  acceptanceRate  Float
  utilization     Float                        // ongoing-driver-hours / online-driver-hours
  createdAt       DateTime @default(now())
  @@unique([date, dimension])
}
```

Rollup is **idempotent** (upsert on `[date, dimension]`) so it can be re-run for backfill. Truth metrics (GMV, refunds) come from Postgres; behavioral metrics (funnel) from Mongo.

### 6.3 Dashboards

`/admin/analytics` (OPS+, FINANCE):
- KPI cards: today GMV, trips, AOV, cancellation %, no-show %, utilization (with WoW delta).
- Funnel chart: quotes → bookings → paid → completed (conversion at each step).
- Time series: trips/GMV by day (last 30/90d), toggleable.
- Top routes table, vehicle-class mix, surge incidence.
- Live "today so far" panel reads Redis counters (real-time-ish), historical reads `daily_metrics`.

`/admin/finance` (FINANCE, SUPER_ADMIN):
- Revenue, refunds, net, EMI collected, payout liability outstanding.
- GST summary (output tax on platform commission; placeholder rates, configurable).
- Per-driver payout statement export.

Charts: Recharts (already in `packages/ui` from earlier, or add). All tables get a **Export CSV/XLSX** button (server-streamed for big ranges).

### 6.4 Scheduled reports

`report-email` worker:
- **Daily ops digest** (08:00 IST → ops + founders): yesterday's KPIs, anomalies (cancellation spike, unassigned trips, SOS count).
- **Weekly founder summary** (Mon 08:00): WoW trends, top routes, driver leaderboard, financial snapshot.
- Rendered with React Email; KPIs embedded as inline SVG sparklines; CSV attached.

---

## 7. Track C — Money: Wallet, EMI, Driver Earnings

### 7.1 Double-entry ledger foundation

All money movement uses an **immutable double-entry ledger**. No balance is ever stored as a mutable column; balances are derived (and cached). This is the single most important correctness decision in Phase 6.

```prisma
model LedgerAccount {
  id          String   @id @default(uuid())
  type        LedgerAccountType            // CUSTOMER_WALLET | DRIVER_PAYABLE | EMI_RECEIVABLE | PLATFORM_REVENUE | PLATFORM_CASH | PROMO_LIABILITY
  ownerId     String?                      // userId / driverId / null for platform
  currency    String   @default("INR")
  createdAt   DateTime @default(now())
  @@unique([type, ownerId])
}

model LedgerEntry {
  id            String   @id @default(uuid())
  txnId         String                       // groups the balanced legs
  accountId     String
  account       LedgerAccount @relation(fields: [accountId], references: [id])
  direction     LedgerDirection              // DEBIT | CREDIT
  amountPaise   BigInt
  refType       String                       // "booking" | "refund" | "referral" | "emi" | "payout" | "goodwill"
  refId         String
  memo          String?
  createdAt     DateTime @default(now())
  @@index([accountId, createdAt])
  @@index([txnId])
}
```

Invariant enforced in a service wrapper: **every `txnId` group sums DEBIT == CREDIT**. A unit test + a nightly reconciliation job assert global `Σdebit == Σcredit`. Any drift → CRITICAL alert.

Balance = `Σcredit − Σdebit` for an account (cached in Redis `wallet:bal:{userId}` invalidated on write; always recomputable from entries).

### 7.2 Customer wallet

- Credits: refunds (Phase 2 now routes optional refund-to-wallet), referral rewards, goodwill adjustments (admin).
- Debits: applied to a booking at payment time.
- `GET /api/v1/wallet` → balance + paginated ledger (customer-friendly view, not raw legs).
- At checkout (Phase 2 extended): customer can apply wallet up to min(balance, payable). Remainder goes to Razorpay. If wallet covers 100%, skip Razorpay entirely (booking confirmed directly; a wallet-debit txn instead of a payment).
- Wallet debit is **reserved** at order-create and **committed** on payment success (or **released** on payment failure/timeout) — uses a `WalletHold` row to prevent double-spend across concurrent bookings.

```prisma
model WalletHold {
  id          String   @id @default(uuid())
  userId      String
  amountPaise BigInt
  bookingId   String
  status      WalletHoldStatus             // HELD | COMMITTED | RELEASED
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  @@index([userId, status])
}
```

### 7.3 EMI tracker

For drivers whose vehicle is financed *through the platform* (the `EmiPlan` table from Phase 3 is now activated):

```prisma
model EmiPlan {
  // Phase 3 created the shell; Phase 6 activates:
  id                String   @id @default(uuid())
  driverId          String
  vehicleId         String
  principalPaise    BigInt
  perTripCutPaise   BigInt                   // flat amount retained per completed trip
  weeklyTargetPaise BigInt?                  // optional weekly floor
  totalDuePaise     BigInt
  collectedPaise    BigInt   @default(0)
  status            EmiStatus                // ACTIVE | COMPLETED | DEFAULTED | PAUSED
  startedAt         DateTime
  createdAt         DateTime @default(now())
}

model EmiCollection {
  id          String   @id @default(uuid())
  emiPlanId   String
  bookingId   String?                        // null for manual/bulk collection
  amountPaise BigInt
  source      EmiCollectionSource            // PER_TRIP | MANUAL | ADJUSTMENT
  collectedAt DateTime @default(now())
  @@index([emiPlanId, collectedAt])
}
```

On `trip_completed` for an EMI-plan driver: a ledger txn moves `perTripCutPaise` from `DRIVER_PAYABLE` → `EMI_RECEIVABLE`, an `EmiCollection(PER_TRIP)` row is written, `collectedPaise += cut`. When `collectedPaise >= totalDuePaise` → plan `COMPLETED`, cuts stop. Arrears detection: if a weekly target isn't met, flag `behindBy` and surface in finance dashboard; repeated misses → `DEFAULTED` + alert.

### 7.4 Driver earnings statements

`earnings.service.ts` computes per-trip net:

```
gross         = fare actually collected (token + balance; token via Razorpay, balance often cash)
commissionCut = gross × commissionRate(routeBucket/vehicleClass)   // platform revenue
emiCut        = perTripCutPaise if on active EMI plan else 0
incentives    = surge bonus / completion bonus (configurable, optional)
net           = gross − commissionCut − emiCut + incentives
```

Each completed trip writes ledger legs:
- `PLATFORM_CASH` debit (token collected by platform), etc. — full mapping documented in `docs/ledger-map.md`.
- `DRIVER_PAYABLE` credit (net owed to driver), `PLATFORM_REVENUE` credit (commission), `EMI_RECEIVABLE` (emi cut).

Weekly worker `driver-statement` (Mon 06:00) generates a PDF per active driver: trip list, totals, EMI itemization, payout liability, "paid out on …" once finance disburses. Driver sees it in `apps/driver` `/earnings` + receives SMS/email link.

### 7.5 Payouts (manual, ledgered)

Real bank rails deferred. Finance sees per-driver `DRIVER_PAYABLE` balance, transfers via their bank manually, then records a `Payout` in admin:

```prisma
model Payout {
  id           String   @id @default(uuid())
  driverId     String
  amountPaise  BigInt
  method       String                        // "bank_transfer_manual"
  reference    String                        // UTR / txn ref entered by finance
  periodStart  DateTime
  periodEnd    DateTime
  createdById  String
  createdAt    DateTime @default(now())
}
```

Recording a payout writes a ledger txn `DRIVER_PAYABLE debit / PLATFORM_CASH credit`, zeroing the payable. Audit-logged. Idempotent on `reference`.

---

## 8. Track D — Engagement: Referrals, Reviews, Notifications

### 8.1 Referrals

- Every customer gets a code on signup: `AERO-{base32(userId-hash)}` (short, shareable). Stored on `User.referralCode`.
- New user enters a code at signup or first booking → `Referral` row `PENDING`.
- Reward triggers on referee's **first COMPLETED trip** (not just signup — prevents fake-account farming):
  - Referrer: ₹X wallet credit. Referee: ₹Y wallet credit (configurable; e.g. ₹100/₹100).
  - Ledger txn from `PROMO_LIABILITY` → both wallets.
- Fraud guards: one reward per referee; device/phone dedup; referrer ≠ referee; cap N rewards/referrer/month; admin review queue for anomalies; new-account-from-same-device blocked.

```prisma
model Referral {
  id            String   @id @default(uuid())
  referrerId    String
  refereeId     String   @unique
  code          String
  status        ReferralStatus               // PENDING | REWARDED | REJECTED
  rewardTxnId   String?
  rejectedReason String?
  createdAt     DateTime @default(now())
  rewardedAt    DateTime?
  @@index([referrerId, status])
}
```

### 8.2 Reviews & ratings

- After `COMPLETED`, both parties can rate within 7 days:
  - Customer→Driver: 1–5 stars + tag chips (clean car, safe driving, on time, polite) + optional text.
  - Driver→Customer: 1–5 stars + tags (ready on time, respectful) — used internally for problem-passenger flags.

```prisma
model Review {
  id          String   @id @default(uuid())
  bookingId   String
  direction   ReviewDirection                // CUSTOMER_TO_DRIVER | DRIVER_TO_CUSTOMER
  raterId     String
  rateeId     String
  stars       Int                            // 1..5
  tags        String[]
  text        String?
  hidden      Boolean  @default(false)       // moderated out
  createdAt   DateTime @default(now())
  @@unique([bookingId, direction])
  @@index([rateeId, createdAt])
}
```

### 8.3 Rating aggregation → assignment feedback

Worker `rating-recompute` (on each new review + nightly safety net):
- `Driver.rating` = **Bayesian-smoothed** average:
  `(C·m + Σstars) / (C + n)` where `m` = global mean (e.g. 4.6), `C` = smoothing constant (e.g. 20). Avoids a single 1-star tanking a new driver.
- Also store `ratingCount`, `last30Rating`.
- This `rating` is exactly the input Phase 4's assignment score already reads (weight 0.15). Closing the loop: better-rated drivers get more offers. Persistently low (< 3.5 over ≥ 20 trips) → `SystemAlert` for ops review / coaching / suspension.

Moderation: text reviews pass a profanity filter; flagged ones go to an admin `/admin/reviews` queue; admins can hide a review (audit-logged) but ratings still count unless the review is rejected as fake.

### 8.4 Notification centre

- Persistent `Notification` table already exists (Phase 2). Phase 6 adds a **web feed**: bell icon → dropdown of recent notifications (booking events, wallet credits, referral rewards, promos), unread badge, mark-as-read, deep links.
- `GET /api/v1/notifications?cursor=`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`.
- Real-time push via the Phase 5 `/passenger` socket (reuse) — new notifications appear without refresh.

### 8.5 Customer trip history

`apps/web` `/account/trips`: paginated list of all bookings with status, fare, download-receipt, rebook (pre-fills a new quote with same route), and a "Rate this trip" CTA if pending. Past trip detail shows the Phase 5 `trip_summaries` route map (static).

---

## 9. API Surface (Phase 6 additions)

**Customer (`/api/v1`)**
```
POST /events                          # batched analytics
GET  /wallet                          # balance + ledger view
GET  /referrals                       # my code, status, earned
POST /referrals/apply                 # apply a code (pre-first-trip)
GET  /trips                           # history
POST /reviews                         # rate a completed trip
GET  /notifications                   # feed
POST /notifications/:id/read
POST /notifications/read-all
# quote endpoint (Phase 1) now returns surge fields
# checkout (Phase 2) now accepts applyWalletPaise
```

**Driver (`/api/v1/driver`)**
```
GET  /earnings                        # statements list
GET  /earnings/:periodId              # detail + PDF link
GET  /emi                             # plan + schedule + collected/pending
GET  /rating                          # my rating, count, recent reviews
POST /reviews                         # rate the customer
```

**Admin (`/api/v1/admin`)**
```
GET  /analytics/kpis?range=
GET  /analytics/funnel?range=
GET  /analytics/timeseries?metric=&range=
GET  /finance/summary?range=
GET  /finance/payout-liability
POST /finance/payouts                 # record manual payout
GET  /pricing/surge-rules
POST /pricing/surge-rules             # append-only versioned
POST /pricing/overrides               # manual surge, auto-expiry
POST /pricing/blackout
GET  /emi                             # all plans, arrears
POST /emi                             # create/activate a plan
GET  /referrals?status=               # review queue
POST /referrals/:id/reject
GET  /reviews?flagged=                # moderation
POST /reviews/:id/hide
GET  /reports/export?type=&format=    # CSV/XLSX stream
```

All admin endpoints RBAC-gated (Phase 3 matrix extended) and audit-logged. All money mutations idempotent.

---

## 10. Backend Module Layout

```
apps/api/src/
├── modules/pricing/        # surge resolve, rules CRUD, overrides, demand/supply counters
├── modules/wallet/         # balance, holds, apply-at-checkout
├── modules/ledger/         # double-entry core (postTxn, balanceOf, reconcile)
├── modules/emi/            # plans, per-trip cut hook, arrears
├── modules/earnings/       # per-trip net calc, weekly statements
├── modules/payouts/        # manual payout recording
├── modules/referrals/      # code gen, apply, reward, fraud guards
├── modules/reviews/        # submit, aggregate, moderate
├── modules/analytics/      # event ingest, query services
├── modules/reports/        # CSV/XLSX export, scheduled emails
├── modules/notifications/  # feed (extends Phase 2)
└── workers/
    ├── rollup-nightly.worker.ts
    ├── report-email.worker.ts
    ├── rating-recompute.worker.ts
    ├── referral-credit.worker.ts
    ├── driver-statement.worker.ts
    ├── supply-zone-refresh.worker.ts      # 60s driver-by-zone counts
    └── ledger-reconcile.worker.ts         # nightly Σdebit==Σcredit
```

Hooks into earlier phases:
- Phase 1 quote → calls pricing.
- Phase 2 `transitionBooking(...→COMPLETED)` / payment success → ledger postings, EMI cut, analytics event.
- Phase 2 refund → optional wallet credit path.
- Phase 4 assignment score → reads `Driver.rating` (now actively maintained).
- Phase 5 trip complete → triggers earnings + EMI + review-eligibility.

---

## 11. Environment Variables (Phase 6)

```ini
# Pricing
SURGE_ENABLED=true
SURGE_GLOBAL_CAP=1.8
DEMAND_WINDOW_MIN=30
SUPPLY_REFRESH_SEC=60

# Wallet / Ledger
WALLET_ENABLED=true
WALLET_HOLD_TTL_MIN=20
LEDGER_RECONCILE_CRON=30 3 * * *

# Referrals
REFERRAL_REFERRER_REWARD_PAISE=10000     # ₹100
REFERRAL_REFEREE_REWARD_PAISE=10000
REFERRAL_MONTHLY_CAP=20
REFERRAL_ENABLED=true

# Reviews
RATING_SMOOTHING_C=20
RATING_GLOBAL_MEAN=4.6
RATING_LOW_THRESHOLD=3.5

# EMI / Earnings / Commission
DEFAULT_COMMISSION_RATE=0.15
DRIVER_STATEMENT_CRON=0 6 * * 1
ROLLUP_CRON=30 2 * * *

# Reports
REPORT_DAILY_DIGEST_CRON=0 8 * * *
REPORT_WEEKLY_CRON=0 8 * * 1
```

All feature flags default OFF in prod until each track's QA passes (staged rollout within the phase).

---

## 12. Testing Plan

### 12.1 Unit
| Spec | Cases ≥ |
|---|---|
| `surge.spec.ts` (algo) | 20 — every ratio bucket, time floor wins, cap clamp, blackout, divide-by-zero supply, override window |
| `ledger.spec.ts` | 15 — balanced txn enforced, unbalanced rejected, balanceOf, multi-leg, reconcile detects drift |
| `wallet.spec.ts` | 12 — hold/commit/release, double-spend prevented, 100%-wallet checkout, expiry release |
| `emi.spec.ts` | 10 — per-trip cut, plan completion stops cuts, arrears, defaulted |
| `earnings.spec.ts` | 10 — net calc with/without EMI/incentives, cash vs token split |
| `referrals.spec.ts` | 12 — reward on first completed trip only, self-referral blocked, dedup, monthly cap, reject |
| `rating.spec.ts` | 8 — Bayesian smoothing, low-rating alert, hidden review still counts |
| `rollup.spec.ts` | 8 — idempotent re-run, GMV from Postgres, funnel from Mongo, backfill |

### 12.2 Integration
- Surge quote → lock → pay uses locked multiplier (no recompute) even if demand changes mid-flow.
- Refund-to-wallet → balance updated → applied to next booking → Razorpay charges only remainder.
- Concurrent bookings can't double-spend the same wallet balance (two parallel checkouts, one wins the hold).
- EMI driver completes trip → EmiCollection written, payable reduced, plan completes at target.
- Referral end-to-end: A refers B, B completes first trip → both credited exactly once; B's second trip credits nobody.
- Review submitted → `Driver.rating` recomputed (Bayesian) → next assignment score reflects it.
- Nightly rollup → dashboard KPI matches hand-computed expected from seeded data.
- Ledger reconcile passes after a day of mixed simulated activity (Σdebit == Σcredit).

### 12.3 E2E (Playwright)
- Customer sees surge banner + transparent breakdown, pays surged price.
- Customer applies wallet credit at checkout; payable reduces.
- Customer rates a completed trip; stars persist; appears in driver's review list.
- Customer refers friend; second account books + completes; first account's wallet shows +₹100.
- Admin opens analytics dashboard; KPI cards render; CSV export downloads.
- Finance records a manual payout; driver payable zeroes; audit entry created.

### 12.4 Acceptance criteria
- [ ] All unit/integration/E2E green.
- [ ] Ledger global invariant Σdebit==Σcredit holds in reconcile job across a seeded month.
- [ ] Surge never exceeds route cap or global 1.8x; quoted multiplier is honored at payment.
- [ ] Wallet cannot be double-spent under concurrency (load test 50 parallel checkouts on one account → exactly one succeeds for the held amount).
- [ ] Referral rewards exactly once, only after referee's first completed trip; fraud guards block same-device farming.
- [ ] Driver weekly statement PDF math matches ledger to the paise.
- [ ] Bayesian rating feeds Phase 4 score (verified by a low rating reducing offer rank in an assignment dry-run).
- [ ] Dashboards load < 2s for 90-day ranges (served from `daily_metrics`, not live scans).
- [ ] Every admin money/pricing mutation writes an audit_event (Phase 3 ESLint rule + test still green).

---

## 13. Security & Correctness Checklist

- [ ] Money mutations only through the ledger service; no direct balance column writes anywhere (enforced by a custom ESLint rule `local/no-direct-balance-write` + code review).
- [ ] Every ledger txn balanced (DEBIT==CREDIT) — enforced at write + nightly reconcile + CRITICAL alert on drift.
- [ ] Wallet holds prevent double-spend; holds expire and auto-release.
- [ ] Idempotency keys on payouts, EMI collections, referral credits, refunds-to-wallet.
- [ ] Surge multiplier locked in Quote; payment uses locked value; server never trusts a client-sent fare.
- [ ] Referral fraud: device fingerprint + phone dedup + self-referral block + monthly cap + admin review queue.
- [ ] Analytics events store ids, not PII (no names/phones/emails in `props`).
- [ ] Reports/exports RBAC-gated (FINANCE for money, OPS for ops); export actions audit-logged.
- [ ] Review text profanity-filtered + XSS-escaped on render; rate-limited (one per booking per direction).
- [ ] Surge overrides + blackouts + fare/surge rule edits all append-only versioned + audited (no destructive edits).
- [ ] EMI cuts cannot push driver payable negative; clamp + alert if attempted.
- [ ] Negative wallet balance impossible (hold + ledger guards).

---

## 14. Observability

New metrics:
- `surge_multiplier{routeBucket}` (gauge), `surge_trips_total`, `surge_capped_total`.
- `demand_supply_ratio{zone}` (gauge).
- `wallet_balance_total_paise` (gauge), `wallet_holds_active`, `wallet_double_spend_blocked_total`.
- `ledger_txns_total{refType}`, `ledger_reconcile_drift_paise` (must be 0).
- `emi_collected_paise_total`, `emi_arrears_drivers` (gauge).
- `referral_rewards_total`, `referral_rejected_total{reason}`.
- `reviews_submitted_total{direction}`, `driver_rating_avg` (gauge), `low_rated_drivers` (gauge).
- `rollup_duration_seconds`, `report_email_sent_total{type}`.

Dashboards: "Pricing & demand", "Money & ledger health", "Engagement (referrals/reviews)", "Business KPIs" (mirrors the operator dashboard for SREs).

Alerts:
- `ledger_reconcile_drift_paise != 0` → **CRITICAL page** (money integrity).
- `surge_multiplier > 1.8` anywhere → bug, page.
- `wallet_double_spend_blocked_total` rising fast → investigate concurrency.
- `emi_arrears_drivers` step change → finance notify.
- `rollup` job fail or > 30 min → warn (dashboards stale).
- Referral reject rate > 30% → possible abuse wave.

---

## 15. Deployment

### 15.1 Order
1. Migration `phase6_intelligence` (all new tables; additive).
2. Seed default `SurgeRule` per route (all caps 1.8, sensible time floors), `LedgerAccount` platform accounts, default commission rates.
3. Deploy `apps/algo` (adds `/pricing/quote`).
4. Deploy `apps/api` + workers (new `aero-api-worker-5` for rollup/report/statement/reconcile cron jobs; `supply-zone-refresh` on worker-1 alongside assignment).
5. Deploy `apps/web`, `apps/admin`, `apps/driver`.
6. **Staged flag rollout within phase:** enable `SURGE_ENABLED` on staging → shadow-mode (compute & log surge but bill base) for 3 days → enable billing on one route → all routes. `WALLET_ENABLED`, `REFERRAL_ENABLED`, reviews each gated and turned on after their track's QA.

### 15.2 Worker layout (updated)
```
aero-api            (HTTP + Socket.io)
aero-api-worker-1   (assignment + offer-expiry + supply-zone-refresh)
aero-api-worker-2   (notifications)
aero-api-worker-3   (reminders + admin-alert + webhook + reconcile-payments)
aero-api-worker-4   (eta-tick + trip-fraud-check + trip-stale-watchdog + ride-logs-archive)
aero-api-worker-5   (rollup-nightly + report-email + rating-recompute + referral-credit + driver-statement + ledger-reconcile)
```

### 15.3 Rollback
- Per-track flags: flip off `SURGE_ENABLED` → fares revert to base (Quote still stores 1.0x). `WALLET_ENABLED=false` → checkout hides wallet, Razorpay-only. `REFERRAL_ENABLED=false` → no new rewards (existing balances untouched). Reviews flag off → hide UI, data retained.
- Ledger tables are additive and immutable; nothing to roll back destructively.
- Shadow-mode for surge means the risky pricing change is observed before it bills a single rupee.

---

## 16. Four-Week Plan

### Week 7 — Pricing
| Day | Tasks |
|---|---|
| Mon | `SurgeRule`/`SurgeOverride` models + migration; seed routes/caps/time-floors. |
| Tue | `apps/algo` `/pricing/quote` pure function + 20 unit tests. Redis demand/supply counters + `supply-zone-refresh` worker. |
| Wed | Integrate surge into Phase 1 quote; lock multiplier into Quote; Phase 2 pays locked fare. |
| Thu | Admin `/admin/pricing`: rules CRUD (versioned), blackout, manual override, audit. |
| Fri | Surge heatmap on `/admin/live`. Customer surge banner + transparent breakdown. Shadow-mode deploy to staging. Tests green. |

### Week 8 — Analytics
| Day | Tasks |
|---|---|
| Mon | `track()` helper + `analytics_events` schema + `POST /events` batched ingest; instrument key events server+client. |
| Tue | `DailyMetric` model + `rollup-nightly` worker (idempotent); backfill last 30d. |
| Wed | `/admin/analytics`: KPI cards, funnel, time series, top routes (Recharts). |
| Thu | `/admin/finance` summary + payout-liability; CSV/XLSX export streaming. |
| Fri | `report-email` worker (daily digest + weekly summary, React Email). Tests + dashboard load-time check. |

### Week 9 — Money
| Day | Tasks |
|---|---|
| Mon | Ledger core (`postTxn`, `balanceOf`, reconcile) + 15 unit tests + ESLint `no-direct-balance-write`. Platform accounts seed. |
| Tue | Wallet: holds, balance, refund-to-wallet path; checkout `applyWalletPaise` (Phase 2 integration) + double-spend test. |
| Wed | EMI activation: per-trip cut hook on trip-complete, `EmiCollection`, arrears, `/driver/emi` + `/admin/emi`. |
| Thu | Earnings: per-trip net calc, `driver-statement` weekly PDF, `/driver/earnings`. |
| Fri | Payouts: manual record + ledger zeroing + audit. `ledger-reconcile` nightly. Money E2E + invariant test. |

### Week 10 — Engagement
| Day | Tasks |
|---|---|
| Mon | Referral codes, `Referral` model, apply flow, fraud guards. |
| Tue | `referral-credit` worker (reward on first completed trip) + dedup/cap tests. |
| Wed | Reviews: submit both directions, `Review` model, `/admin/reviews` moderation; profanity filter. |
| Thu | `rating-recompute` Bayesian aggregation → `Driver.rating`; verify Phase 4 score consumes it; low-rating alert. |
| Fri | Notification centre web feed + real-time push. Customer `/account/trips` history + rebook. Full Phase 6 regression + tag `v0.6.0-phase6`. Update [implementation.md](implementation.md). |

---

## 17. Risks (Phase 6)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Surge feels unfair / hurts trust | Medium | Customer churn | Cap 1.8x, full transparency (show breakdown), shadow-mode validation, blackout switch, conservative time floors |
| Ledger bug corrupts money state | Low | Critical | Double-entry + nightly reconcile + balanced-txn invariant + ESLint guard + idempotency; immutable entries (append-only, never update) |
| Wallet double-spend under concurrency | Medium | Financial loss | WalletHold rows + load-tested 50-parallel checkout; balance derived from ledger, not a mutable column |
| Referral farming | High | Promo liability burn | Reward only on referee first **completed** trip; device/phone dedup; monthly cap; admin review queue; same-device block |
| Dashboard slow on big ranges | Medium | Ops frustration | Pre-aggregated `daily_metrics`; never scan raw events for historical; Redis for "today" |
| EMI cut leaves driver with too little | Medium | Driver hardship/disputes | Cap cut so payable can't go negative; weekly target with grace; transparent statement; pause/restructure in admin |
| Analytics PII leak | Low | Compliance | Store ids only; review event props in code review; access RBAC-gated + audited |
| Rating gaming (fake reviews) | Medium | Quality signal corrupted | One review per booking per direction; Bayesian smoothing; moderation queue; anomaly alerts |
| Scope creep (4 tracks in 4 weeks) | High | Slipping timeline | Hard per-track flags; ship dark, enable progressively; chat/call-masking explicitly deferred to Phase 7 |
| Surge demand/supply signal noisy at low volume | High (early) | Erratic pricing | Min-supply floor (max(supply,1)); conservative ratio bands; start with time-floors dominating until volume grows |

---

## 18. Deliverables Checklist

Code:
- [ ] Migration `phase6_intelligence` applied (dev/staging/prod).
- [ ] `apps/algo` `/pricing/quote` live + tested.
- [ ] Surge integrated into quote (locked) + admin controls + heatmap.
- [ ] Analytics pipeline + `daily_metrics` rollup + operator/finance dashboards + exports + scheduled reports.
- [ ] Double-entry ledger + wallet + checkout integration + EMI + earnings statements + manual payouts.
- [ ] Referrals + reviews + Bayesian rating into Phase 4 score + notification centre + trip history.
- [ ] `aero-api-worker-5` deployed with all Phase 6 cron/queue jobs.

Ops:
- [ ] Default surge rules + ledger platform accounts + commission rates seeded.
- [ ] Per-track feature flags wired; surge shipped in shadow-mode first.
- [ ] Grafana dashboards + ledger-drift CRITICAL alert live.
- [ ] Env vars + secrets set in all environments.

Docs:
- [ ] `docs/ledger-map.md` — every event → ledger legs mapping.
- [ ] `docs/pricing/surge-rules.md` — bands, floors, caps, override policy.
- [ ] `docs/runbooks/ledger-drift.md` — what to do when reconcile drift fires.
- [ ] `docs/runbooks/referral-abuse.md` — investigating + clawing back.
- [ ] OpenAPI updated for all new endpoints.

---

## 19. Handoff to Phase 7

Phase 7 (mobile apps — React Native + Expo) builds passenger + driver native apps on the now-complete API. Contracts Phase 7 depends on:

- Full stable REST + WS API surface (Phases 1–6) — native apps are new clients, not new backend.
- Background GPS (the real fix for Phase 5's iOS-Safari limitation) lands natively here.
- Push: FCM (Android) + APNs (iOS) via the existing `DriverFcmToken` pattern, extended with a `DeviceToken` table for customers.
- Wallet, referrals, reviews, trip history, earnings — all already API-backed; native just re-skins them.
- Surge transparency UI patterns reused.
- In-trip chat + call masking (Exotel) — deferred from Phase 5/6 — implemented natively in Phase 7.

Open items pushed to Phase 7 / 8:
- Native background location + geofencing (Phase 7).
- Deep links + app-install attribution for referrals (Phase 7).
- ML demand forecasting (Prophet) to replace rule-based surge inputs (Phase 8).
- Automated payout rails (RazorpayX) (Phase 8).
- Corporate accounts + GST invoicing + multi-city configs (Phase 8).

---

**End of Phase 6 document.**
