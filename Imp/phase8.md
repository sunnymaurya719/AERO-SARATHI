# Phase 8 — Scale & Expansion (Weeks 17+)

**Parent document:** [implementation.md](implementation.md)
**Previous phases:** [phase1.md](phase1.md) · [phase2.md](phase2.md) · [phase3.md](phase3.md) · [phase4.md](phase4.md) · [phase5.md](phase5.md) · [phase6.md](phase6.md) · [phase7.md](phase7.md)
**Phase status:** Not started
**Duration:** Open-ended program (weeks 17+), organized as six independent workstreams shipped incrementally — NOT a single 6-week sprint.
**Prereq:** Phases 1–7 complete — full platform, native apps, ledger, analytics, live tracking all in production with real traffic and accumulated historical data.

> **Framing:** Phase 8 is not "more features" — it is the transition from *a working product in one region* to *a scalable, multi-city, financially-automated business*. Each workstream below (A–F) is independently valuable and independently shippable behind flags. Sequence them by business need; do **not** attempt all six at once. ML and AWS migration in particular should only start once data volume and load actually justify them — premature scaling is the main risk here.

---

## 1. Phase Goal

Take the single-region, manually-operated-at-the-edges platform and make it:

- **Predictive** — forecast demand and pre-position supply instead of reacting (Workstream A).
- **Multi-city** — launch new cities from configuration, not code forks (Workstream B).
- **Enterprise-ready** — corporate accounts, GST invoicing, monthly billing (Workstream C).
- **EV-aware** — charging-aware assignment for an electric fleet (Workstream D).
- **Financially automated** — real payout rails replacing manual transfers (Workstream E).
- **Horizontally scalable** — migrate from a single Hetzner VM to AWS managed infrastructure when (and only when) load demands it (Workstream F).

**Definition of "done" for Phase 8** (per-workstream, not all-at-once):
> A forecasting model predicts tomorrow's CHD→DEL morning demand within an acceptable error band and surfaces "go online at 6 AM near Sector 17 for high demand" nudges to drivers. Ops launches "Ludhiana" entirely from an admin config screen — zones, fares, surge rules — with zero deploy. A corporate customer's employees book rides billed to a company account with a monthly GST invoice. EV vehicles are only offered trips they can complete on current charge. Driver payouts run automatically via RazorpayX every week with the ledger as the source of truth. The platform serves 10x current load on AWS with autoscaling, multi-AZ databases, and zero-downtime deploys.

---

## 2. Workstream Overview

| WS | Name | Core value | Hard dependency | Start when |
|---|---|---|---|---|
| A | ML Demand Forecasting | Pre-position supply, smarter surge | ≥ 3–6 months of trip/analytics data | data volume sufficient |
| B | Multi-City | Launch cities without code changes | none (refactor of existing config) | second city committed |
| C | Corporate & GST | B2B revenue, larger AOV | invoicing/ledger (Phase 6) | first corporate lead |
| D | EV Fleet | Lower cost/km, green positioning | EV vehicles onboarded | EV vehicles exist |
| E | Automated Payouts | Remove manual finance toil | ledger (Phase 6) | payout volume painful |
| F | AWS Migration | Horizontal scale, HA | sustained load near VM limits | Hetzner VM saturating |

Each ships behind flags and is reversible. The rest of this document details each.

---

## 3. Workstream A — ML Demand Forecasting

### 3.1 Goal
Replace the **rule-based surge inputs** (Phase 6 used live demand/supply ratios reactively) with a **predictive layer**: forecast demand per zone × time so we can (a) pre-position/nudge drivers, (b) smooth surge (anticipatory, not jerky), and (c) plan capacity.

### 3.2 Approach (start simple)
- **v1 — classical time series:** Prophet (or statsmodels SARIMA) per zone × route × hourly bucket. Captures daily/weekly seasonality + holidays. Runs as a **batch** job, not real-time. This is deliberately unglamorous and robust.
- **v2 (later) — gradient-boosted (LightGBM)** with features: hour, day-type, weather, holidays, local events, historical demand lags, fuel price, school calendar. Only if v1 error is unacceptable.
- **No deep learning** unless v2 plateaus — the data volume won't justify it for a long time.

### 3.3 Data & pipeline
- Source: Mongo `analytics_events` + Postgres `daily_metrics` + `Trip`/`Booking` history (the data Phases 5–6 have been accumulating).
- Nightly export → a small **warehouse** (start: Postgres read-replica or DuckDB on object storage; graduate to a real warehouse only if needed).
- `apps/algo` gains a forecasting module (Python already — natural fit). Training is offline (scheduled job); serving is a lookup of pre-computed forecasts cached in Redis (`forecast:{zone}:{date}:{hour}`).
- Forecast horizon: next 24–72h, refreshed daily (and a same-day refresh mid-afternoon).

### 3.4 Consumption
- **Driver nudges:** push/notification "High demand expected 6–9 AM near Sector 17 — go online to earn more." (Surfaced in `apps/mobile-driver`, gated, opt-in.)
- **Anticipatory surge:** Phase 6 surge gets a forecast term — blend live ratio with predicted ratio so prices rise *before* the crunch and fall smoothly. Still capped at 1.8x, still transparent, still locked into the Quote.
- **Capacity planning:** ops dashboard shows predicted vs actual demand; helps driver-acquisition targeting per city/zone.

### 3.5 Guardrails
- The model **advises**; it never directly sets a price the customer can't see. Surge transparency (Phase 6) is preserved.
- Shadow-mode first: forecast logged + compared to actuals for ≥ 2 weeks before influencing surge.
- Backtesting harness with MAPE/RMSE per zone; a model only ships if it beats the naive "last-week-same-hour" baseline.
- Kill-switch reverts to Phase 6 pure-reactive surge instantly.

### 3.6 MLOps (lightweight)
- Model registry (versioned artifacts in object storage), training run metadata, evaluation reports.
- Drift monitor: if live error exceeds threshold for N days → alert + auto-fallback to baseline.
- No heavyweight platform (no Kubeflow/SageMaker pipelines) until scale demands — a scheduled job + registry + dashboards suffice.

---

## 4. Workstream B — Multi-City

### 4.1 Goal
Launch a new city (Ludhiana, Amritsar, Jaipur, …) **from configuration**, with no code fork and minimal deploy. Today's implicit "everything is Chandigarh region" assumptions get extracted into a `City` entity.

### 4.2 Data model
```prisma
model City {
  id          String   @id @default(uuid())
  code        String   @unique         // "CHD", "LDH", "ASR"
  name        String
  timezone    String   @default("Asia/Kolkata")
  centerLat   Float
  centerLng   Float
  status      CityStatus               // PLANNED | LIVE | PAUSED
  launchedAt  DateTime?
  createdAt   DateTime @default(now())
}

model Zone {
  id          String   @id @default(uuid())
  cityId      String
  code        String
  name        String
  polygon     Json                      // GeoJSON polygon (point-in-polygon for zone assignment)
  createdAt   DateTime @default(now())
  @@unique([cityId, code])
}
```
- `FareRule`, `SurgeRule`, `Route` buckets all gain a `cityId` scope. Drivers, vehicles, bookings gain `cityId`.
- Zone assignment for a lat/lng = point-in-polygon over `Zone.polygon` (replaces the implicit zone strings from Phases 5–6). Cached.

### 4.3 City launch playbook (admin-driven)
A `/admin/cities` console (SUPER_ADMIN):
1. Create city (code, center, timezone).
2. Draw zones on a map (GeoJSON editor) → seed `Zone` rows.
3. Configure fare rules + surge rules per city (reuse Phase 3/6 versioned editors, now city-scoped).
4. Onboard drivers/vehicles tagged to the city.
5. Flip `status = LIVE` → city becomes bookable. `mobile/config` (Phase 7) exposes live cities to apps per location.

### 4.4 Cross-cutting changes
- All queries that aggregate (analytics, assignment supply counts, surge demand/supply) become **city-scoped**.
- Assignment (Phase 4) only matches drivers within the booking's city.
- Dashboards (Phase 6) gain a city filter; "global" rolls up across live cities.
- Intercity routes (e.g. CHD→DEL) are modeled as routes spanning two cities/zones — handled as a route bucket, not a single-city constraint.

### 4.5 Guardrails
- A city in `PLANNED`/`PAUSED` is never bookable; apps hide it.
- Launch is reversible (`PAUSED`) without data loss.
- No code deploy required to launch a city — config + data only (the headline requirement).

---

## 5. Workstream C — Corporate Accounts & GST Invoicing

### 5.1 Goal
B2B: companies create accounts, add employees, employees book rides billed to the company, finance issues a **monthly consolidated GST invoice**. Higher AOV, predictable revenue.

### 5.2 Data model
```prisma
model CorporateAccount {
  id            String   @id @default(uuid())
  name          String
  gstin         String?                  // validated format
  billingEmail  String
  billingAddress Json
  creditLimitPaise BigInt @default(0)
  paymentTerms  Int      @default(30)     // net-30
  status        CorpStatus               // ACTIVE | SUSPENDED
  createdAt     DateTime @default(now())
}

model CorporateMember {
  id            String   @id @default(uuid())
  corporateId   String
  userId        String
  role          CorpMemberRole           // ADMIN | EMPLOYEE
  monthlyCapPaise BigInt?                 // optional per-employee cap
  costCenter    String?
  createdAt     DateTime @default(now())
  @@unique([corporateId, userId])
}

model CorporateInvoice {
  id            String   @id @default(uuid())
  corporateId   String
  periodStart   DateTime
  periodEnd     DateTime
  subtotalPaise BigInt
  gstPaise      BigInt
  totalPaise    BigInt
  status        InvoiceStatus            // DRAFT | ISSUED | PAID | OVERDUE
  invoiceNumber String   @unique         // sequential, GST-compliant series
  pdfKey        String?                  // object storage
  issuedAt      DateTime?
  dueAt         DateTime?
  paidAt        DateTime?
  createdAt     DateTime @default(now())
  @@index([corporateId, periodStart])
}
```

### 5.3 Billing flow
- Employee books → if they're a corporate member and choose "Bill to company", payment skips Razorpay and books on **corporate credit** (subject to credit limit + employee cap). A ledger txn records `CORPORATE_RECEIVABLE`.
- Month-end worker `corporate-invoice` aggregates all corporate-billed trips per company → builds a **GST-compliant invoice** (sequential invoice number series, GSTIN, HSN/SAC code for transport services, CGST/SGST/IGST split based on place-of-supply rules), renders PDF, stores in object storage, emails finance + corporate billing contact.
- Invoice payment recorded (manual at first; later auto via Workstream E rails) → ledger `CORPORATE_RECEIVABLE` cleared.

### 5.4 GST correctness (get an accountant)
- Invoice numbering: continuous, no gaps, financial-year series — legally required.
- Place-of-supply logic determines CGST+SGST (intra-state) vs IGST (inter-state) — relevant for intercity rides crossing state lines (Punjab ↔ Delhi).
- Rates configurable (transport of passengers SAC 9964) — **validated with a CA before going live**; the system stores rates as config, not hardcoded.
- Credit notes for refunds/cancellations on corporate-billed trips.

### 5.5 Admin/portal
- `/admin/corporate`: manage accounts, members, credit limits, invoices, mark paid, download/regenerate PDF.
- Corporate self-serve portal (stretch): a corporate ADMIN manages their own employees, sees usage, downloads invoices.

### 5.6 Guardrails
- Credit limit + employee monthly cap enforced at booking time (hold pattern from Phase 6 wallet, adapted).
- GST config changes versioned + audited; invoice numbers never reused even on regeneration (regeneration = same number, new PDF).
- Corporate-billed trips clearly tagged in analytics + driver earnings (driver still gets paid normally).

---

## 6. Workstream D — EV Fleet (Charging-Aware Assignment)

### 6.1 Goal
Support electric vehicles whose **range constrains which trips they can accept**. An EV at 40% charge must not be offered a 250 km CHD→DEL trip it can't finish.

### 6.2 Data model
```prisma
model Vehicle {
  // existing fields ...
  fuelType        FuelType          // PETROL | DIESEL | CNG | EV
  batteryKwh      Float?            // EV only
  rangeKmFull     Float?            // rated range
  efficiencyKmPerKwh Float?
}

model VehicleCharge {              // latest known charge state (EV)
  id            String   @id @default(uuid())
  vehicleId     String   @unique
  socPct        Float                       // state of charge 0..100
  estRangeKm    Float
  isCharging    Boolean  @default(false)
  updatedAt     DateTime @updatedAt
}

model ChargingStation {
  id        String   @id @default(uuid())
  cityId    String
  name      String
  lat       Float
  lng       Float
  connectors Json                            // [{type, kw, count}]
  createdAt DateTime @default(now())
}
```

### 6.3 Charging-aware assignment (extends Phase 4)
- Driver app (or telematics, if integrated) reports `socPct`; otherwise driver self-reports at go-online + after charging.
- Eligibility hard gate added to Phase 4 matching: `estRangeKm >= tripDistanceKm × safetyFactor (1.3) + bufferKm (15)`. EVs failing this are excluded from the candidate pool for that trip (petrol/CNG unaffected).
- Soft scoring: prefer EVs with comfortable range for shorter trips; route longer trips to ICE or high-SoC EVs.
- Post-trip: estimate remaining range; if low, nudge driver to the nearest `ChargingStation` and optionally mark them `OFFLINE`/charging.

### 6.4 Ops & analytics
- EV dashboard: fleet SoC distribution, trips deferred due to range, charging-station utilization, cost/km vs ICE.
- Charging-station map overlay on `/admin/live`.

### 6.5 Guardrails
- If SoC data is stale (> N minutes) → treat conservatively (assume lower range) or fall back to self-report prompt; never strand a passenger.
- Range model is configurable per vehicle model (efficiency varies); start conservative.
- EV logic fully behind a flag; zero impact on ICE assignment when off.

---

## 7. Workstream E — Automated Payouts (RazorpayX)

### 7.1 Goal
Replace Phase 6's **manual bank-transfer + ledger-record** payouts with **automated disbursement via RazorpayX** (or a comparable payout API), with the Phase 6 double-entry ledger remaining the **source of truth**.

### 7.2 Flow
- Drivers add + verify bank details / UPI (penny-drop verification via RazorpayX Fund Account validation). Stored encrypted; only last4 shown.
- Weekly payout worker (`auto-payout`, replaces the manual step):
  1. Compute each driver's `DRIVER_PAYABLE` balance from the ledger.
  2. Apply holds (fraud review from Phase 5, EMI arrears, negative adjustments).
  3. For eligible balances ≥ minimum, create a **RazorpayX payout** to the driver's fund account, **idempotent on `(driverId, periodEnd)`**.
  4. On payout success webhook → write the ledger txn `DRIVER_PAYABLE debit / PLATFORM_CASH credit` and a `Payout` row (Phase 6 model reused, `method=razorpayx`, `reference=payoutId`).
  5. On failure → alert finance, leave payable intact, retry next cycle.

### 7.3 Correctness
- Ledger is authoritative; RazorpayX is an execution channel. A payout only debits the ledger **after** confirmed success (webhook), never optimistically.
- Idempotency keys on payout creation prevent double-disbursement on retries.
- Daily reconciliation: RazorpayX settlement report vs ledger payouts must match to the paise → CRITICAL alert on drift (extends Phase 6 reconcile job).
- Holds: fraud-flagged drivers (Phase 5), EMI defaulters, KYC-incomplete → payout blocked + reason surfaced in admin.

### 7.4 Admin/finance
- `/admin/payouts`: upcoming run preview (who gets what), holds, run history, failures, manual retry. Manual payout (Phase 6) retained as a fallback when rails are down.
- Driver app: payout status + history + bank-account management.

### 7.5 Guardrails
- Penny-drop bank verification before first payout.
- Per-run + per-driver caps as a circuit breaker (anomalous payout amount → hold for review).
- Full audit trail; payouts are among the highest-risk actions in the system.
- Feature flag; instant revert to manual ledgered payouts (Phase 6) if RazorpayX has issues.

---

## 8. Workstream F — Hetzner → AWS Migration

### 8.1 When (not before)
Only migrate when the single Hetzner CX VM is genuinely saturating (sustained CPU/memory pressure, WS connection limits, DB IOPS ceiling) **and** business continuity needs multi-AZ HA. Until then, scale vertically on Hetzner (bigger CX/CCX instance) — it's far cheaper. **Premature migration is a documented anti-goal.**

### 8.2 Target architecture (AWS)
```
Route 53 + CloudFront (web/static, apps already on Vercel — may stay or move)
        │
   ALB / API Gateway  ──► ECS Fargate (or EKS) services:
        │                  - api (HTTP) — autoscaled, multi-AZ
        │                  - ws (Socket.io) — sticky / Redis adapter
        │                  - workers (1..n) — queue-driven autoscale
        │                  - algo (FastAPI + ML) — autoscaled
        ▼
   RDS PostgreSQL (Multi-AZ, read replicas)   ← was self-managed PG
   ElastiCache Redis (cluster mode + replica)  ← was single Redis
   DocumentDB / MongoDB Atlas                   ← was self-managed Mongo
   S3 (replaces Hetzner Object Storage)         ← driver docs, invoices, ride-log archives, ML artifacts
   SQS / keep BullMQ-on-Redis                   ← queue layer
   Secrets Manager / Parameter Store            ← env + secrets
   CloudWatch + existing Sentry/Grafana          ← observability
```

### 8.3 Migration strategy (incremental, zero-downtime)
1. **Containerize** (already Dockerized from Phase 0/CI) — minimal app changes; the Phase 5 Socket.io Redis adapter already prepped horizontal scale.
2. **Stand up AWS in parallel** (IaC: Terraform). Migrate **stateless** services first (api/ws/algo/workers) behind a new ALB.
3. **Data migration**: PostgreSQL via logical replication (DMS or native) → cutover with a brief read-only window; Redis is ephemeral (rebuild); Mongo via Atlas live migration or mongodump/restore; object storage via S3 sync (Hetzner is S3-compatible → `rclone`/`aws s3 sync`).
4. **DNS cutover** with low TTL; canary a % of traffic; roll back by repointing DNS if needed.
5. Decommission Hetzner after a stability soak.

### 8.4 Scale enablers unlocked
- Horizontal autoscaling (api/ws/workers/algo) on CPU/queue-depth.
- Multi-AZ RDS + ElastiCache failover for HA (the 99.9% availability NFR).
- Read replicas for analytics/dashboards (offload heavy reads from the write primary).
- Blue/green or rolling ECS deploys → zero-downtime releases.
- Per-city / per-service scaling as multi-city (WS B) grows.

### 8.5 Guardrails
- IaC only (Terraform) — no console-clicked infra; reproducible + reviewable.
- Cost monitoring + budgets from day one (AWS is easy to overspend vs Hetzner; document the cost delta and justify it with load data).
- Migration is reversible until Hetzner is decommissioned; keep it warm during the soak.
- Security: VPC, private subnets for DB, security groups, IAM least-privilege, Secrets Manager, encrypted at rest + in transit, WAF on ALB.

---

## 9. Cross-Cutting Data & Platform Concerns

- **Data warehouse:** as analytics + ML mature, graduate from `daily_metrics`/DuckDB to a real warehouse (Redshift/BigQuery/ClickHouse) only when query volume/complexity justifies it.
- **PII & retention:** multi-city + corporate increases PII surface; formalize a retention policy, data-subject-deletion flow, and per-city data-residency awareness (all India for now).
- **Schema scoping:** the `cityId` rollout (WS B) touches many tables — do it as an early, careful migration since A/C/D/E all benefit from city scoping.
- **Feature-flag platform:** the number of flags is now large (per-workstream, per-city, per-cohort) — consider a proper flag service (config table + admin UI already exists; formalize targeting rules).

---

## 10. Sequencing Recommendation

Although workstreams are independent, a sensible order given typical business drivers:

1. **B (Multi-City)** — foundational; `cityId` scoping benefits everything else. Do early.
2. **E (Automated Payouts)** — removes the most painful manual finance toil; pure win on existing data.
3. **C (Corporate & GST)** — unlocks B2B revenue; moderate effort, high value.
4. **A (ML Forecasting)** — only once enough multi-month, multi-city data exists.
5. **D (EV Fleet)** — when EV vehicles are actually onboarded.
6. **F (AWS Migration)** — last, and only when load genuinely demands it.

This is a recommendation, not a mandate — reorder by real business priority.

---

## 11. Testing & Rollout Principles (apply to every workstream)

- **Shadow-mode first** for anything that changes money or pricing (ML surge, corporate billing, automated payouts): compute + log + compare to the existing behavior before it takes effect.
- **Ledger invariant** (Phase 6) extended to cover corporate receivables and automated payouts: `Σdebit == Σcredit` globally, reconciled nightly, CRITICAL on drift.
- **Per-workstream + per-city feature flags**; every workstream reversible without redeploy.
- **Backtesting** for ML (beat the naive baseline or don't ship).
- **GST correctness** validated by a chartered accountant before corporate invoicing goes live.
- **Payout safety**: penny-drop verification, idempotency, per-run caps, reconciliation, manual fallback.
- **Migration safety** (AWS): parallel-run + canary + DNS rollback + soak before decommission.
- Load test each scale milestone (e.g. 10x current concurrent trips/WS connections) before declaring capacity.

---

## 12. Risks (Phase 8)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Premature scaling (ML/AWS) burns time + money with no ROI | High | Wasted effort, cost | Strict "start when justified" gates per workstream; vertical-scale Hetzner first; baseline-beating requirement for ML |
| GST invoicing errors → legal/compliance exposure | Medium | High | CA validation before launch; sequential invoice series; place-of-supply logic tested; credit notes for refunds |
| Automated payout double-disbursement | Low | Critical (real money out) | Ledger-authoritative; debit only after success webhook; idempotency keys; per-run caps; nightly settlement reconcile |
| ML model worse than reactive surge | Medium | Bad pricing | Shadow-mode + backtesting + naive baseline gate + instant kill-switch to Phase 6 |
| `cityId` migration touches everything, introduces regressions | Medium | Broad bugs | Do it early + carefully; comprehensive tests; backfill existing data to a default city; staged rollout |
| AWS cost overrun vs Hetzner | High | Margin erosion | Budgets + alerts day one; right-size; justify with load data; keep Hetzner option documented |
| Corporate credit risk (unpaid invoices) | Medium | Cash flow | Credit limits enforced at booking; net-30 + overdue tracking; suspend on non-payment |
| EV range model wrong → stranded passenger | Low/Med | Trust damage | Conservative safety factor (1.3) + buffer; stale-SoC fallback; never offer a trip an EV can't finish |
| Migration data loss / downtime | Low | Critical | Logical replication + canary + DNS rollback + soak; backups verified before cutover; reversible until decommission |
| Scope sprawl across six workstreams | High | Nothing finishes | One workstream at a time; flags; clear per-WS definition-of-done; this doc's sequencing guidance |

---

## 13. Per-Workstream Deliverables Checklist

**A — ML Forecasting**
- [ ] Data export → warehouse (DuckDB/replica) pipeline.
- [ ] `apps/algo` forecasting module (Prophet v1) + scheduled training + Redis-cached serving.
- [ ] Backtesting harness (MAPE/RMSE, beats naive baseline).
- [ ] Shadow-mode comparison ≥ 2 weeks before influencing surge.
- [ ] Driver demand nudges (opt-in) + ops predicted-vs-actual dashboard.
- [ ] Drift monitor + kill-switch to Phase 6 reactive surge.

**B — Multi-City**
- [ ] `City`/`Zone` models + GeoJSON point-in-polygon zone assignment.
- [ ] `cityId` scoping migration across fares/surge/drivers/vehicles/bookings/analytics + backfill default city.
- [ ] `/admin/cities` console (create, draw zones, configure, launch/pause).
- [ ] City-scoped assignment + dashboards + `mobile/config` live-cities exposure.
- [ ] Launch a real second city with zero code deploy.

**C — Corporate & GST**
- [ ] Corporate models (account/member/invoice) + `CORPORATE_RECEIVABLE` ledger account.
- [ ] Bill-to-company booking path with credit-limit + employee-cap enforcement.
- [ ] Monthly `corporate-invoice` worker → GST-compliant numbered PDF + email.
- [ ] Place-of-supply CGST/SGST/IGST logic + credit notes; **CA-validated**.
- [ ] `/admin/corporate` management + (stretch) corporate self-serve portal.

**D — EV Fleet**
- [ ] Vehicle EV fields + `VehicleCharge` + `ChargingStation` models.
- [ ] SoC reporting (self-report and/or telematics).
- [ ] Charging-aware eligibility gate in Phase 4 assignment + soft scoring.
- [ ] EV dashboard + charging-station map overlay.
- [ ] Conservative range model + stale-SoC fallback; flag-gated.

**E — Automated Payouts**
- [ ] RazorpayX integration + driver bank/UPI add + penny-drop verification (encrypted storage).
- [ ] `auto-payout` weekly worker (ledger-driven, holds, idempotent).
- [ ] Success-webhook → ledger debit + `Payout` row; failure handling + retry.
- [ ] Settlement-vs-ledger nightly reconciliation + CRITICAL drift alert + per-run caps.
- [ ] `/admin/payouts` console + driver app payout status; manual fallback retained.

**F — AWS Migration**
- [ ] Terraform IaC for ECS/RDS/ElastiCache/DocumentDB|Atlas/S3/Secrets/ALB/VPC.
- [ ] Stateless services migrated behind ALB (Socket.io Redis adapter already in place).
- [ ] Data migration (PG logical replication, Mongo Atlas migrate, S3 sync) + canary + DNS rollback.
- [ ] Autoscaling + Multi-AZ HA + read replicas + blue/green deploys.
- [ ] Cost budgets/alerts; Hetzner decommissioned after soak.

---

## 14. Definition of Done (Program-Level)

Phase 8 is "done" when the business can:
- [ ] Launch a new city from admin config with **zero code deploy**.
- [ ] Bill corporate customers with **legally-compliant GST invoices**.
- [ ] Pay drivers **automatically** with ledger-reconciled accuracy.
- [ ] Assign EV vehicles **only trips they can complete** on charge.
- [ ] Use **forecasted demand** to nudge supply and smooth surge (beating the naive baseline, transparent, capped).
- [ ] Serve **10x** current load with multi-AZ HA and zero-downtime deploys (once migrated).
- [ ] Every money path still satisfies the **double-entry ledger invariant**, reconciled nightly.

…with each capability shipped behind a flag, reversible, and validated in shadow-mode where money or pricing is involved.

---

## 15. Closing — End of Roadmap

Phase 8 closes the planned roadmap (Phases 0–8) defined in [implementation.md](implementation.md). Beyond this, the platform evolves by business need rather than a pre-set plan: deeper ML (dynamic pricing v2, supply positioning optimization), loyalty/subscriptions, two-wheeler/auto categories, intercity pooling, CarPlay/Android Auto, international expansion, and whatever the data tells us matters next.

The throughline across all eight phases held: **ship small, ship behind flags, keep money correct with a double-entry ledger, keep pricing transparent, keep the rider and driver safe, and never scale before the load is real.**

---

**End of Phase 8 document. End of phased implementation roadmap.**
