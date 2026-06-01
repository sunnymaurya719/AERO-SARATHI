# Phase 4 — Driver Assignment Automation + Driver Portal (Week 5)

**Parent document:** [implementation.md](implementation.md)
**Previous phases:** [phase1.md](phase1.md) · [phase2.md](phase2.md) · [phase3.md](phase3.md)
**Phase status:** Not started
**Duration:** 1 week (5 working days)
**Prereq:** Phases 1–3 complete — bookings can be paid, cancelled, refunded; admin panel can manually assign drivers; `Driver`, `DriverDocument`, `Vehicle` rows exist; notification queue + `Notification` model wired.

---

## 1. Phase Goal

Replace human dispatchers with an automated pipeline that finds, offers, and confirms a driver for every `CONFIRMED` booking — starting 3 hours before pickup, retrying every 5 minutes, and escalating to admin if no driver accepts by T-30 min. Drivers receive offers on a phone-OTP driver web portal and accept/decline within 60 seconds. The PRD's exact algorithm gets implemented; the admin panel's manual assign stays available as a permanent override.

**Definition of "done" for Phase 4:**
> A `CONFIRMED` booking scheduled 4h in the future automatically: (1) creates a delayed BullMQ job at `scheduledAt − 3h`; (2) the job ranks available drivers via the `algo /matching/score` endpoint; (3) sends an offer SMS + push to the top driver with a deep link to `driver.aerosarathi.com/offers/:id`; (4) the driver accepts within 60s → booking transitions to `DRIVER_ASSIGNED`, passenger gets SMS with driver name/phone/car/plate; (5) if no driver accepts by `scheduledAt − 30 min`, admin alert fires and the booking surfaces in the admin "needs attention" tray. Every step is observable, idempotent, and reversible.

---

## 2. Scope

### In scope
- New Next.js app `apps/driver` — driver-facing portal (phone OTP login, availability toggle, offer accept/decline, today's trips).
- BullMQ queues: `booking-assignment`, `assignment-retry`, `pre-trip-reminders`, `admin-alert`.
- Delayed-job scheduling on booking `CONFIRMED` transition (Phase 2 hook point).
- `algo` service additions: `/matching/score` ranking endpoint.
- Driver matching engine on the API: pool selection → score → offer → timeout → next candidate.
- Offer state machine: `OFFERED → ACCEPTED | DECLINED | EXPIRED | CANCELLED`.
- Driver-side SMS templates (DLT-registered): offer, cancellation, day-of reminder.
- Passenger-side SMS additions: driver-assigned, driver-arriving (T-30 min before pickup), driver no-show / reassignment.
- Web Push to driver portal via Firebase Cloud Messaging (FCM) Web for instant offer notifications when the tab is closed.
- Admin alerts surfaced in dashboard tray (Phase 3 hook) when assignment fails by cutoff.
- Driver-document gating: drivers with expired/unverified critical docs are excluded from matching.
- Driver overlap protection: a driver cannot be offered or assigned to a booking that overlaps another active booking (±2h window).
- Manual reassignment from admin (Phase 3 path stays, now also re-triggers passenger SMS).

### Explicitly OUT of scope (deferred)
- Real-time GPS tracking + map UI (Phase 5).
- Trip lifecycle endpoints (`start`, `arrive`, `complete`) — Phase 5.
- Earnings dashboard for drivers (Phase 6).
- Driver ratings / two-sided reviews (Phase 6).
- ML-based scoring (Phase 8).
- Native mobile driver app (Phase 7).
- Surge pricing inputs into offer order (Phase 6).
- Multi-leg trips / shared rides.
- Hub-based pre-positioning of drivers.

---

## 3. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-4.1 | passenger | be told my driver's name, phone, car and plate as soon as one is assigned | I can plan and identify the car |
| US-4.2 | passenger | get an SMS 30 min before pickup with driver ETA | I know when to come down |
| US-4.3 | platform | not block on a single offline driver | the system tries the next-best automatically |
| US-4.4 | driver | log in with phone OTP only | I don't need passwords on a shared phone |
| US-4.5 | driver | toggle myself online/offline | I control my work hours |
| US-4.6 | driver | see a new offer with full trip details and accept in one tap | I decide fast and don't miss work |
| US-4.7 | driver | see today's confirmed trips list with pickup times | I can plan my day |
| US-4.8 | ops | get a Slack/email alert if any booking is unassigned at T-30 min | I can intervene before the passenger notices |
| US-4.9 | platform | exclude drivers with expired licence from offers | we stay legally compliant |
| US-4.10 | platform | never offer the same driver overlapping trips | we don't no-show passengers |

---

## 4. Architecture Slice for Phase 4

```
┌───────────────────────────────────────────────────────────────┐
│  Driver Web (Next.js — driver.aerosarathi.com)                │
│  /login  /home  /offers/:id  /trips  /trips/:id  /settings    │
│  - OTP auth (reuses Phase 1 auth, role=DRIVER)                │
│  - FCM Web push subscription                                  │
│  - Socket.io for live offer pushes + availability echo        │
└──────────────────────────┬────────────────────────────────────┘
                           │ HTTPS + WSS
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  API (Node + Express + Socket.io)                             │
│  /api/v1/driver/*      — driver actions                        │
│  /api/v1/admin/*       — manual assign (Phase 3, unchanged)    │
│  WS: nsp /driver       — push offers, availability ack         │
└──┬───────────┬──────────┬───────────┬──────────────┬──────────┘
   │           │          │           │              │
   ▼           ▼          ▼           ▼              ▼
Postgres   Redis      BullMQ       Algo (FastAPI)   FCM
(Booking,  (driver    queues:      /matching/score  (web push)
 Driver,   online     - booking-                    +
 Offer,    set,       assignment   matcher.py       MSG91 SMS
 Notif)    offer      - assignment-                 (templates)
           locks,     retry
           idempot.)  - pre-trip-
                       reminders
                     - admin-alert
```

External services added: **Firebase Cloud Messaging (FCM Web)**. MSG91 + Razorpay continue from earlier phases.

---

## 5. Data Model Changes

Migration name: `phase4_assignment`.

### 5.1 New / changed Prisma models

```prisma
model Driver {
  // ... existing Phase 1-3 fields ...
  availability    DriverAvailability @default(OFFLINE)
  lastSeenAt      DateTime?
  fcmTokens       DriverFcmToken[]
  offers          Offer[]
  offerStats      DriverOfferStats?
}

enum DriverAvailability { OFFLINE ONLINE BUSY }

model DriverFcmToken {
  id         String   @id @default(uuid())
  driverId   String
  driver     Driver   @relation(fields: [driverId], references: [id], onDelete: Cascade)
  token      String   @unique
  userAgent  String?
  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())
  revokedAt  DateTime?
  @@index([driverId])
}

model Offer {
  id              String   @id @default(uuid())
  bookingId       String
  booking         Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  driverId        String
  driver          Driver   @relation(fields: [driverId], references: [id])
  attemptNumber   Int                      // 1..N within this booking
  score           Float
  scoreBreakdown  Json
  status          OfferStatus @default(OFFERED)
  offeredAt       DateTime @default(now())
  expiresAt       DateTime                 // offeredAt + 60s by default
  respondedAt     DateTime?
  responseReason  String?
  notificationIds String[]                 // ids in Notification table
  @@unique([bookingId, driverId, attemptNumber])
  @@index([bookingId, status])
  @@index([driverId, status])
  @@index([expiresAt, status])
}

enum OfferStatus { OFFERED ACCEPTED DECLINED EXPIRED CANCELLED }

model AssignmentAttempt {
  id              String   @id @default(uuid())
  bookingId       String
  booking         Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  attemptNumber   Int
  triggeredAt     DateTime @default(now())
  candidatePool   Json                     // [{ driverId, score, breakdown }]
  outcome         AttemptOutcome
  reason          String?
  jobId           String?                  // BullMQ job id for trace
  @@unique([bookingId, attemptNumber])
  @@index([bookingId])
}

enum AttemptOutcome {
  POOL_EMPTY            // no eligible drivers at all
  OFFER_SENT            // we sent an offer; await response
  ALL_DECLINED          // pool exhausted without acceptance this attempt
  ACCEPTED              // driver accepted
  ABORTED               // booking cancelled / state changed before assigning
}

model DriverOfferStats {
  driverId         String   @id
  driver           Driver   @relation(fields: [driverId], references: [id], onDelete: Cascade)
  offersTotal      Int      @default(0)
  offersAccepted   Int      @default(0)
  offersDeclined   Int      @default(0)
  offersExpired    Int      @default(0)
  acceptanceRate   Float    @default(0)
  avgResponseSec   Float    @default(0)
  updatedAt        DateTime @updatedAt
}

model SystemAlert {
  id          String   @id @default(uuid())
  type        AlertType
  severity    AlertSeverity @default(WARNING)
  entityType  String?
  entityId    String?
  payload     Json
  status      AlertStatus @default(OPEN)
  ackedById   String?
  ackedAt     DateTime?
  resolvedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([status, createdAt])
  @@index([type, status])
}

enum AlertType { UNASSIGNED_T_MINUS_30 POOL_EMPTY DRIVER_NO_SHOW REFUND_STUCK DOC_EXPIRY WEBHOOK_DLQ }
enum AlertSeverity { INFO WARNING CRITICAL }
enum AlertStatus { OPEN ACKED RESOLVED }

model Booking {
  // additions
  assignedAt        DateTime?
  assignmentJobId   String?              // BullMQ delayed job for the FIRST attempt
}
```

### 5.2 Indexes worth highlighting
- `Offer (expiresAt, status)` — sweeper finds `OFFERED` past expiry.
- `Booking (scheduledAt, status)` (already exists from Phase 1) — used by the assignment-due query.
- Partial index for ONLINE drivers: `CREATE INDEX driver_online_idx ON "Driver" (availability) WHERE availability = 'ONLINE';` (raw SQL migration).

### 5.3 Backfill
On migration, populate `DriverOfferStats` row for every existing driver with zeros. No data migration for `Offer` / `AssignmentAttempt` (new tables).

---

## 6. Driver Matching Algorithm

Pure deterministic v1. Rule-based, transparent, easy to test and tune. ML comes Phase 8.

### 6.1 Eligibility filter (hard gates — fail = excluded)

A driver enters the candidate pool only if **all** are true:

1. `Driver.status === 'ACTIVE'`.
2. `Driver.availability === 'ONLINE'` AND `lastSeenAt > now − 2 min` (heartbeat alive).
3. Has an assigned `Vehicle` whose `category === booking.vehicleCategory`.
4. All **critical** documents present, `verified === true`, and `expiresAt > booking.scheduledAt`. Critical = `LICENSE`, `RC`, `INSURANCE`, `PERMIT` (PUC is warning-only).
5. No overlapping `Offer` with status `ACCEPTED` AND no `Booking` already assigned to this driver in status `DRIVER_ASSIGNED | EN_ROUTE | ONGOING` where the other trip's `[scheduledAt − 2h, scheduledAt + estimatedMin + 2h]` window intersects this booking's window.
6. No active `OFFERED` offer to this driver for **another** booking (one open offer per driver at a time).
7. Has not declined or expired an offer for **this** booking already in any attempt (skip cool-down).

### 6.2 Score (higher is better, 0–100)

```
score = w_distance  * proximityScore
      + w_rating    * (driver.rating / 5)
      + w_idle      * idleScore
      + w_home      * homeCityScore
      + w_history   * acceptanceRateScore
      - penalty_recent_decline
```

Component definitions (v1 weights in parens, sum = 1.0):

- `proximityScore` (0.40): distance from driver's last known location (Redis `driver:loc:{id}`, fallback `homeCity` centroid) to `booking.pickup`. Score = `max(0, 1 − distanceKm / 50)`. Drivers farther than 50 km score 0 on this axis but still considered.
- `rating` (0.15): `driver.rating ∈ [1, 5]`, normalised to 0–1.
- `idleScore` (0.15): minutes since last completed trip or going-online event, normalised: `min(1, idleMin / 120)`. Reward longer-idle drivers (anti-starvation).
- `homeCityScore` (0.15): 1.0 if `driver.homeCity === booking.pickupCity` (resolved by reverse geocoding pickup, cached); 0.5 if adjacent city in a small lookup table; 0 otherwise.
- `acceptanceRateScore` (0.15): `DriverOfferStats.acceptanceRate`, clamped 0–1. Drivers with < 5 historical offers get 0.5 (neutral).
- `penalty_recent_decline`: −0.20 if driver declined any offer in the last 60 min.

Final score normalised to 0–100. Ties broken by lower driver `id` (deterministic).

### 6.3 Pool selection rule
After scoring, take **top N = 5** candidates. Offer to position 1. If declined/expired, offer to position 2, etc. **One offer at a time per booking** (no fan-out — fan-out leads to driver-side cancellations and bad UX). After all 5 declined/expired, the attempt ends with `ALL_DECLINED` and the retry job re-runs in 5 min with a fresh pool (drivers come online; some recover from cool-down).

### 6.4 Cutoff
- First attempt fires at `scheduledAt − 3h`.
- Retries every 5 min on `ALL_DECLINED` or `POOL_EMPTY`.
- Hard cutoff at `scheduledAt − 30 min`: stop trying, create `SystemAlert.UNASSIGNED_T_MINUS_30`, notify admins (Slack + email), and surface in admin tray. Admin may then assign manually (Phase 3 path).
- If pickup time passes with no driver, booking auto-transitions to `CANCELLED` with reason `system_no_driver` and a full refund is issued (regardless of bucket). This is the platform's fault, not the customer's.

### 6.5 Offer TTL
- Default 60 seconds from `offeredAt`.
- Tightens automatically when retry budget is low: if `scheduledAt − now < 60 min`, TTL drops to 30 s; if `< 45 min`, TTL drops to 20 s.

---

## 7. Algo Service Additions (`apps/algo`)

### 7.1 New endpoint

```
POST /algo/v1/matching/score
```

Request:
```json
{
  "booking": {
    "id": "uuid",
    "scheduledAt": "2026-06-01T05:00:00Z",
    "pickup": { "lat": 30.741, "lng": 76.782, "city": "Chandigarh" },
    "vehicleCategory": "SEDAN",
    "estimatedMin": 246
  },
  "candidates": [
    {
      "driverId": "uuid",
      "rating": 4.7,
      "homeCity": "Chandigarh",
      "lastLocation": { "lat": 30.71, "lng": 76.80, "ageSec": 12 },
      "idleMin": 45,
      "acceptanceRate": 0.78,
      "offersHistorical": 132,
      "recentDeclineMin": null
    }
  ],
  "weights": { "distance": 0.40, "rating": 0.15, "idle": 0.15, "home": 0.15, "history": 0.15 },
  "penaltyRecentDecline": 0.20,
  "now": "2026-06-01T02:00:00Z"
}
```

Response:
```json
{
  "ranked": [
    {
      "driverId": "uuid",
      "score": 78.4,
      "breakdown": {
        "proximity": 0.92, "rating": 0.94, "idle": 0.38, "home": 1.0, "history": 0.78,
        "penaltyRecentDecline": 0
      }
    }
  ]
}
```

Pure function, no IO, no DB access. Easy to unit-test and replay.

### 7.2 Implementation (Python)

```python
# apps/algo/app/domain/matching.py
from dataclasses import dataclass
from datetime import datetime
from math import radians, sin, cos, asin, sqrt

ADJACENT = {
    "Chandigarh": {"Mohali", "Panchkula", "Zirakpur"},
    "Amritsar":   {"Tarn Taran", "Batala"},
    # ... extend in seed file
}

def haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    R = 6371.0
    dlat = radians(b_lat - a_lat); dlng = radians(b_lng - a_lng)
    h = sin(dlat/2)**2 + cos(radians(a_lat))*cos(radians(b_lat))*sin(dlng/2)**2
    return 2 * R * asin(sqrt(h))

def home_score(driver_home: str, pickup_city: str) -> float:
    if driver_home == pickup_city: return 1.0
    if pickup_city in ADJACENT.get(driver_home, set()): return 0.5
    return 0.0

def score_one(c, pickup_lat, pickup_lng, pickup_city, w, penalty):
    if c.last_location and c.last_location.age_sec <= 300:
        dist_km = haversine_km(c.last_location.lat, c.last_location.lng, pickup_lat, pickup_lng)
    else:
        dist_km = 50.0  # unknown location → neutral-low
    proximity = max(0.0, 1.0 - dist_km / 50.0)
    rating    = max(0.0, min(1.0, c.rating / 5.0))
    idle      = min(1.0, max(0.0, c.idle_min) / 120.0)
    home      = home_score(c.home_city, pickup_city)
    history   = 0.5 if c.offers_historical < 5 else max(0.0, min(1.0, c.acceptance_rate))
    raw = (w.distance*proximity + w.rating*rating + w.idle*idle + w.home*home + w.history*history)
    if c.recent_decline_min is not None and c.recent_decline_min <= 60:
        raw -= penalty
    return max(0.0, min(1.0, raw)) * 100.0, {
        "proximity": proximity, "rating": rating, "idle": idle, "home": home, "history": history,
        "penaltyRecentDecline": penalty if (c.recent_decline_min is not None and c.recent_decline_min <= 60) else 0
    }
```

### 7.3 Tests
- `test_matching.py`: ≥ 25 cases — boundary distances (0, 25, 50, 51), missing last location, recent decline penalty, tie-breaking by driverId, weight sums ≠ 1 normalisation, all-zero pool, single candidate, 50-candidate ordering deterministic.

---

## 8. Backend Implementation (`apps/api`)

### 8.1 New modules

```
apps/api/src/
├── modules/driver/
│   ├── driver-auth.router.ts          # phone OTP, role=DRIVER (reuses Phase 1 auth)
│   ├── driver-me.router.ts            # /me, availability toggle, FCM token register
│   ├── driver-offers.router.ts        # GET active, POST accept/decline
│   └── driver-trips.router.ts         # GET today + by id (read-only in Phase 4)
├── modules/assignment/
│   ├── assignment.service.ts          # orchestrator: pool → score → offer
│   ├── assignment.router.ts           # internal-only: POST /internal/assignment/run (for tests + admin replay)
│   ├── eligibility.ts                 # hard gates from §6.1
│   ├── pool.ts                        # builds candidate list from Postgres + Redis
│   ├── offer.service.ts               # create/accept/decline/expire transitions
│   └── workers/
│       ├── assignment.worker.ts       # consumes booking-assignment + assignment-retry
│       ├── offer-expiry.worker.ts     # consumes offer-expiry delayed jobs
│       ├── reminders.worker.ts        # pre-trip-reminders (T-24h, T-2h, T-30min)
│       └── admin-alert.worker.ts      # creates SystemAlert + Slack + email
├── modules/alerts/
│   ├── alerts.router.ts               # admin: list/ack/resolve
│   └── alerts.service.ts
├── realtime/
│   ├── io.ts                          # Socket.io server + driver namespace
│   └── driver-namespace.ts            # auth, room per driverId, offer push event
├── queues/
│   ├── assignment.queue.ts
│   ├── offer-expiry.queue.ts
│   ├── reminders.queue.ts
│   └── admin-alert.queue.ts
└── hooks/
    └── booking.confirmed.hook.ts      # called from Phase 2 verify/webhook paths
```

### 8.2 Booking → assignment scheduling

When a booking transitions to `CONFIRMED` (Phase 2 `transitionBooking` post-commit hook), schedule the **first** assignment attempt:

```ts
// hooks/booking.confirmed.hook.ts
import { assignmentQueue } from '../queues/assignment.queue';

const LEAD_MS = 3 * 60 * 60 * 1000;       // 3 hours
const MIN_DELAY_MS = 5_000;                 // run almost-immediately if scheduled < 3h out

export async function onBookingConfirmed(bookingId: string, scheduledAt: Date) {
  const runAt = scheduledAt.getTime() - LEAD_MS;
  const delay = Math.max(MIN_DELAY_MS, runAt - Date.now());
  const job = await assignmentQueue.add(
    'assign',
    { bookingId, attemptNumber: 1, triggerReason: 'initial_t_minus_3h' },
    {
      delay,
      jobId: `assign:${bookingId}:1`,                  // idempotent: same id can't be re-added
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: false,
    },
  );
  await prisma.booking.update({ where: { id: bookingId }, data: { assignmentJobId: job.id } });
}
```

Also schedule **pre-trip reminders** at the same time: T-24h passenger SMS, T-2h passenger SMS, T-30min passenger driver-arriving SMS (these run regardless of assignment status; the T-30min one only fires if a driver is assigned, otherwise it's overtaken by the unassigned alert).

When a booking is **cancelled** (any path), the assignment service removes pending delayed jobs by jobId and any active OFFERS are set to `CANCELLED` with reason `booking_cancelled`. Driver gets a "Trip cancelled" SMS.

### 8.3 Assignment worker (the core)

```ts
// modules/assignment/workers/assignment.worker.ts
import { Worker } from 'bullmq';
import { redisConnection } from '../../../redis';
import { prisma } from '../../../prisma';
import { runAssignmentAttempt } from '../assignment.service';

export const assignmentWorker = new Worker(
  'booking-assignment',
  async (job) => {
    const { bookingId, attemptNumber, triggerReason } = job.data as {
      bookingId: string; attemptNumber: number; triggerReason: string;
    };
    return runAssignmentAttempt({ bookingId, attemptNumber, triggerReason, bullJobId: job.id });
  },
  { connection: redisConnection, concurrency: 8, lockDuration: 30_000 },
);
```

`runAssignmentAttempt` (orchestrator) does this, all inside a single Postgres transaction where possible:

1. Load booking with `FOR UPDATE`. If status not in `{CONFIRMED}` → return `ABORTED`. Idempotent.
2. Check time gate. If `now > scheduledAt − 30min` → end the loop:
   - Insert `AssignmentAttempt` with outcome `POOL_EMPTY` (or whatever last reason) and reason `cutoff_reached`.
   - Enqueue `admin-alert` job with `{ type: 'UNASSIGNED_T_MINUS_30', bookingId }`.
   - Schedule a final job at `scheduledAt`: if still unassigned, transition booking → `CANCELLED` + auto-refund + passenger SMS.
   - Return.
3. Call `buildPool(booking)` (§8.4) → list of `{driverId, ...features}`.
4. If pool empty → insert attempt with `POOL_EMPTY` → schedule retry in 5 min (BullMQ delayed re-enqueue with `attemptNumber + 1`).
5. POST to `algo /matching/score` with the candidates → ranked list.
6. Take top 1 not previously offered for this booking. If none left in current top-N → outcome `ALL_DECLINED` → retry in 5 min.
7. Create `Offer` row with `status=OFFERED`, `expiresAt = now + TTL` (§6.5).
8. Acquire `offer-lock:{driverId}` in Redis (NX, EX=TTL+5s) to enforce one-open-offer-per-driver. If lock fails, mark this offer `CANCELLED` and continue to next candidate.
9. Schedule `offer-expiry` job with `delay = TTL`, `jobId = expiry:{offerId}`.
10. Enqueue notifications:
    - SMS `driver_offer` to driver (template includes pickup/drop, scheduledAt, fare, deep link `https://driver.aerosarathi.com/offers/{offerId}`).
    - FCM Web push to all `DriverFcmToken` for that driver (data-only payload + `actions: ['Accept','Decline']`).
    - Socket.io emit on driver's room: `offer:new` with full offer payload (instant if app is open).
11. Insert `AssignmentAttempt` with `outcome=OFFER_SENT`, `candidatePool=ranked[:N]`.
12. Return. **Do not** await acceptance — the next state transition comes from `POST /driver/offers/:id/accept` or the `offer-expiry` worker.

All step transitions audit-logged.

### 8.4 Pool builder

```ts
// modules/assignment/pool.ts
// Single SQL query returning eligible drivers with everything we need to score.
export async function buildPool(booking: Booking): Promise<Candidate[]> {
  const rows = await prisma.$queryRaw<PoolRow[]>`
    SELECT d.id, d.rating, d."homeCity",
           u.phone,
           v.id AS "vehicleId", v.category, v."regNo",
           dos."acceptanceRate", dos."offersTotal" AS "offersHistorical"
    FROM "Driver" d
    JOIN "User"   u ON u.id = d."userId"
    JOIN "Vehicle" v ON v.id = d."vehicleId"
    LEFT JOIN "DriverOfferStats" dos ON dos."driverId" = d.id
    WHERE d.status = 'ACTIVE'
      AND d.availability = 'ONLINE'
      AND d."lastSeenAt" > NOW() - INTERVAL '2 minutes'
      AND v.category = ${booking.vehicleCategory}::"VehicleCategory"
      AND NOT EXISTS (
        SELECT 1 FROM "DriverDocument" doc
        WHERE doc."driverId" = d.id
          AND doc.type IN ('LICENSE','RC','INSURANCE','PERMIT')
          AND (doc.verified = false OR doc."expiresAt" < ${booking.scheduledAt})
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Booking" b2
        WHERE b2."driverId" = d.id
          AND b2.status IN ('DRIVER_ASSIGNED','EN_ROUTE','ONGOING')
          AND tstzrange(b2."scheduledAt" - INTERVAL '2 hours',
                        b2."scheduledAt" + (b2."estimatedMin" || ' minutes')::interval + INTERVAL '2 hours')
              && tstzrange(${booking.scheduledAt} - INTERVAL '2 hours',
                           ${booking.scheduledAt} + (${booking.estimatedMin} || ' minutes')::interval + INTERVAL '2 hours')
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Offer" o
        WHERE o."driverId" = d.id AND o.status = 'OFFERED'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Offer" o2
        WHERE o2."bookingId" = ${booking.id} AND o2."driverId" = d.id
          AND o2.status IN ('DECLINED','EXPIRED')
      )
    LIMIT 50;
  `;
  // Enrich with Redis last-location + idle minutes (last completed trip from Postgres or last online toggle).
  return enrichWithRealtimeFeatures(rows, booking);
}
```

`tstzrange` with `&&` operator gives us O(log n) overlap detection if we add a GiST index. Migration includes:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE INDEX booking_overlap_idx ON "Booking" USING GIST (
  "driverId",
  tstzrange("scheduledAt" - INTERVAL '2 hours',
            "scheduledAt" + ("estimatedMin" || ' minutes')::interval + INTERVAL '2 hours')
) WHERE status IN ('DRIVER_ASSIGNED','EN_ROUTE','ONGOING');
```

### 8.5 Accept / decline flow

```
POST /api/v1/driver/offers/:id/accept
```

1. Auth: driver session (JWT role=DRIVER).
2. Load offer with `FOR UPDATE`. Must be `status=OFFERED`, `driverId === me`, `expiresAt > now`. Else 409 with current state.
3. Reload booking with `FOR UPDATE`. Must be `status=CONFIRMED`. Else mark offer `CANCELLED` reason `booking_state_changed` and 409.
4. Transaction:
   - `Offer.status = ACCEPTED`, `respondedAt = now`.
   - `Booking.driverId = me`, `vehicleId = my.vehicleId`, `assignedAt = now`.
   - `transitionBooking(CONFIRMED → DRIVER_ASSIGNED, reason='offer_accepted')`.
   - Cancel sibling `OFFERED` offers for the same booking (there shouldn't be any in v1, but defensive) → `CANCELLED`.
   - Update `DriverOfferStats` counters.
5. Release `offer-lock:{driverId}` in Redis.
6. Remove the `offer-expiry` BullMQ job (by jobId).
7. Enqueue notifications:
   - Passenger SMS `driver_assigned` (driver name, masked phone, car model, plate, ETA at pickup).
   - Passenger email same.
   - Driver SMS `assignment_confirmed` (booking code, pickup, scheduledAt, passenger name + phone for contact).
8. Socket.io emit on passenger booking room: `booking:driver_assigned`.
9. Return updated booking snapshot.

```
POST /api/v1/driver/offers/:id/decline
```

Body: `{ reason: string }` (required, ≥ 8 chars; canned reasons in UI: "Too far", "Not available", "Vehicle issue", "Other").

1. Same guard checks.
2. `Offer.status = DECLINED`, `respondedAt`, `responseReason`.
3. Update `DriverOfferStats`.
4. Release lock + cancel expiry job.
5. Enqueue a new `assignment-retry` job immediately with `attemptNumber + 1` (skips the 5-min wait — the booking still has time and the next candidate is ready).

**Offer expiry worker:** when `offer-expiry:{offerId}` fires, atomically set `OFFERED → EXPIRED` (idempotent), release lock, increment stats, enqueue retry. If status is already `ACCEPTED` / `DECLINED` / `CANCELLED`, no-op.

### 8.6 Availability + heartbeat

```
PATCH /api/v1/driver/me/availability   { availability: 'ONLINE' | 'OFFLINE' }
```

- Setting `ONLINE`: requires at least the LICENSE + RC verified & unexpired; otherwise 422 with which document is missing/expired.
- Setting `OFFLINE`: rejected if driver has an `OFFERED` open offer (must decline first) or an assigned booking in `DRIVER_ASSIGNED|EN_ROUTE|ONGOING`.

**Heartbeat:** while online, the driver client pings `POST /api/v1/driver/me/heartbeat` every 30s. Server updates `Driver.lastSeenAt` and writes to Redis `driver:online:{id}` with TTL 90s. If TTL expires without refresh, a Redis keyspace notification → handler flips `availability = OFFLINE` in Postgres. (Backup: a cron every 1 min sweeps drivers whose `lastSeenAt < now − 2 min` and flips them offline.)

### 8.7 FCM Web push

- Use Firebase Admin SDK on the server (`firebase-admin`).
- Store `DriverFcmToken` rows on registration: `POST /api/v1/driver/me/fcm-token { token, userAgent }`.
- On offer creation, send a **data message** (not notification) so the SW chooses the UX:
  ```json
  { "type":"offer", "offerId":"...", "code":"AS-...", "expiresAt":"...", "deepLink":"/offers/..." }
  ```
- Service worker (`apps/driver/public/firebase-messaging-sw.js`) shows the notification, attaches "Accept" / "Decline" actions that call back into the app via `clients.openWindow`.
- On send failure with code `registration-token-not-registered` → soft-delete the row (`revokedAt = now`).

### 8.8 Real-time channel

- Socket.io server mounted at `/realtime`, namespace `/driver`.
- Connection auth: JWT in `auth.token`. Reject if role ≠ DRIVER.
- On connect, join room `driver:{driverId}`.
- Server emits to room on:
  - `offer:new` — when an Offer is created for this driver (alternative to FCM when app is open).
  - `offer:cancelled` — booking cancelled while offer pending.
  - `booking:assigned` — passenger-side notice (sent on passenger namespace, planned for Phase 5; stubbed now).

Reconnect logic: client reconnects with backoff; on reconnect, calls `GET /api/v1/driver/offers/active` to fetch any currently OFFERED offer (in case it missed the push).

### 8.9 Admin alert worker

```ts
// modules/assignment/workers/admin-alert.worker.ts
export const adminAlertWorker = new Worker('admin-alert', async (job) => {
  const { type, bookingId, payload } = job.data;
  const alert = await prisma.systemAlert.create({
    data: { type, severity: 'CRITICAL', entityType: 'Booking', entityId: bookingId, payload, status: 'OPEN' },
  });
  await postToSlack({ channel: env.SLACK_OPS_CHANNEL, text: formatAlert(type, payload) });
  await sendEmail({ to: env.OPS_ALERT_EMAIL, subject: `[Aero] ${type} ${payload.code}`, html: ... });
  return alert.id;
}, { connection: redisConnection, concurrency: 4 });
```

Admin dashboard `/dashboard` tray (Phase 3 §6.2) reads open `SystemAlert` rows. New endpoints:

- `GET /api/v1/admin/alerts?status=OPEN` — list.
- `POST /api/v1/admin/alerts/:id/ack` — set ackedById + ackedAt.
- `POST /api/v1/admin/alerts/:id/resolve` — set resolvedAt.

### 8.10 Environment variables

```ini
# Assignment
ASSIGNMENT_LEAD_HOURS=3
ASSIGNMENT_RETRY_MIN=5
ASSIGNMENT_CUTOFF_MIN=30
OFFER_TTL_SEC=60
OFFER_TTL_SHORT_SEC=30
OFFER_TTL_VERY_SHORT_SEC=20
POOL_TOP_N=5

# FCM
FCM_PROJECT_ID=aero-sarathi
FCM_PRIVATE_KEY=
FCM_CLIENT_EMAIL=

# Slack
SLACK_OPS_CHANNEL=#aero-ops
SLACK_BOT_TOKEN=

OPS_ALERT_EMAIL=ops@aerosarathi.com

# Realtime
SOCKET_IO_PATH=/realtime
```

---

## 9. Driver Web Portal (`apps/driver`)

### 9.1 Stack & folder layout

Next.js 14 (App Router), TypeScript strict, Tailwind. Mobile-first (drivers use phones). PWA-installable.

```
apps/driver/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx           # phone → OTP
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── layout.tsx               # bottom tab bar
│   │   ├── home/page.tsx            # availability toggle + status card
│   │   ├── offers/[id]/page.tsx     # full-screen offer with timer
│   │   ├── trips/
│   │   │   ├── page.tsx             # today's list
│   │   │   └── [id]/page.tsx        # read-only detail
│   │   └── settings/page.tsx        # docs status, notifications, sign out
│   └── layout.tsx                   # registers SW, FCM token
├── public/
│   ├── firebase-messaging-sw.js
│   ├── manifest.webmanifest
│   └── icons/...
├── components/
│   ├── AvailabilityToggle.tsx
│   ├── OfferCard.tsx
│   ├── CountdownRing.tsx
│   ├── TripListItem.tsx
│   └── BigButton.tsx
├── lib/
│   ├── api.ts
│   ├── socket.ts                    # Socket.io client wrapper
│   ├── fcm.ts                       # token registration, foreground handler
│   ├── geo.ts                       # navigator.geolocation wrapper (Phase 5 uses heavier; Phase 4 only needs coarse for last-seen)
│   └── store/driver.ts              # Zustand: online state, current offer
├── middleware.ts                     # redirect unauth to /login
└── tailwind.config.ts
```

### 9.2 Login flow

- `/login`: phone input → reuses Phase 1 OTP endpoints. Server upserts `User` with role inferred from the existence of a `Driver` row for that phone. If no `Driver` row, returns 403 `not_a_driver` (drivers are created by admin in Phase 3; they cannot self-register).
- On success, sets the same httpOnly cookies as customer site **but scoped to `driver.aerosarathi.com`** — no cross-site leakage.

### 9.3 Home screen

- Top: big avatar + name + rating + acceptance rate.
- Center: huge **AvailabilityToggle** (red OFFLINE / green ONLINE), glove-friendly.
- Below: doc warnings (any expiring within 14 days → yellow card; expired → red card + link to upload via admin, with a "Tap to call dispatcher" button).
- Below: next assigned trip (if any) with countdown.
- Persistent banner if location permission denied — explains we need coarse GPS for offer ranking.

When ONLINE:
- Service worker keeps a heartbeat ping running via `Background Sync` if supported; otherwise the open tab pings every 30s via the API client.
- Browser request: `Notification.permission` ; if not granted, friendly modal explains why and links to a how-to.

### 9.4 Offer screen `/offers/[id]`

Triggered by:
- FCM notification tap → deep link.
- Socket `offer:new` event when app open → router pushes.
- Manual visit from `/home` "Pending offer" badge.

Layout (full-screen, no nav):
- Big **CountdownRing** showing remaining seconds (turns red < 10s).
- Pickup / drop with addresses + estimated distance + ETA.
- Scheduled at (formatted in IST with day-of-week).
- Fare to driver (`balanceAmount` in Phase 4 since payouts come later).
- Two huge buttons: green ACCEPT, red DECLINE.
- DECLINE opens a sheet with canned reasons + free-text "Other".

Polls offer state every 5s as a safety net (web push or socket may have raced). If offer state changes to `EXPIRED|CANCELLED|ACCEPTED-by-system` while user looks, screen swaps to "Offer expired" / "Offer was cancelled" with a soft return to home.

Audio + vibration on offer arrival (`navigator.vibrate([300,100,300])`, short MP3 beep — user can disable in settings).

### 9.5 Trips list `/trips`

Read-only in Phase 4. Today + upcoming (next 7 days). Each row: code, scheduledAt, pickup → drop, status pill, passenger name + masked phone (tap to reveal full, audit-logged).

### 9.6 Settings

- Account info.
- Documents: each critical doc with status (verified ✓ / pending ⏳ / expired ✗). Upload not in driver portal v1 (admin handles via Phase 3). Driver sees status only.
- Notifications: enable/disable sound, vibration, FCM (unregisters token).
- Sign out.

---

## 10. Notification Templates (Phase 4 additions)

DLT-registered MSG91 templates (English; Punjabi/Hindi variants registered same way, served by `locale` on `User`):

| Template key | To | Body (variables in `{#var#}`) |
|---|---|---|
| `driver_offer` | Driver | "Aero Sarathi: New trip {#var#}. {#var#} → {#var#} on {#var#}. Fare ₹{#var#}. Tap to accept (60s): {#var#}" |
| `driver_assignment_confirmed` | Driver | "Aero Sarathi: Trip {#var#} confirmed. Pickup {#var#} at {#var#}. Passenger {#var#} ({#var#})." |
| `driver_trip_cancelled` | Driver | "Aero Sarathi: Trip {#var#} was cancelled. Sorry for the inconvenience." |
| `passenger_driver_assigned` | Passenger | "Aero Sarathi: Driver {#var#} ({#var#}) will arrive in car {#var#} ({#var#}) for booking {#var#}." |
| `passenger_t_minus_30` | Passenger | "Aero Sarathi: Your driver {#var#} will arrive at {#var#} in ~{#var#} min for booking {#var#}." |
| `passenger_no_driver_found` | Passenger | "Aero Sarathi: We could not find a driver for booking {#var#}. Full refund of ₹{#var#} initiated. Sorry — our team will reach out." |
| `passenger_driver_reassigned` | Passenger | "Aero Sarathi: New driver assigned for {#var#}. {#var#} ({#var#}) in {#var#} ({#var#})." |

Email versions (React Email) mirror SMS content with branded layout, used for `passenger_*` templates only.

---

## 11. External Service Setup

### 11.1 Firebase (FCM Web)
1. Create Firebase project `aero-sarathi` (one project, multiple envs via separate apps).
2. Add a Web App for each env: `driver-dev`, `driver-prod`. Note `VAPID public key`.
3. Generate a service account JSON with `Firebase Cloud Messaging API` access. Store private key in 1Password → env vars.
4. Configure web app's `firebaseConfig` (apiKey, projectId, messagingSenderId, appId) — these are public.
5. `firebase-messaging-sw.js` placed at root of `apps/driver/public`.
6. Test push from Firebase console to a registered token.

### 11.2 Slack
1. Create a Slack app `Aero Ops Alerts` in the company workspace.
2. Bot scopes: `chat:write`. Install to workspace, copy bot token to `SLACK_BOT_TOKEN`.
3. Invite the bot to `#aero-ops` channel.

### 11.3 MSG91 (new templates)
Register 7 new DLT templates from §10. Update env IDs `MSG91_TEMPLATE_*`.

### 11.4 Vercel
- New project `aero-driver-dev` and `aero-driver-prod`, root `apps/driver`. Custom domains `driver-dev.aerosarathi.com` and `driver.aerosarathi.com`. Vercel preview password for non-prod.

---

## 12. Local Development

### 12.1 Compose additions
Nothing new (FCM is cloud-only; emulator not needed for v1 — use real Firebase project's dev app key with a personal device token).

### 12.2 Run all four web apps + workers

Root `package.json`:
```json
"dev": "turbo run dev --parallel"
```
Ports:
- `apps/web`     → 3000
- `apps/admin`   → 3001
- `apps/driver`  → 3002
- `apps/api`     → 4000 (HTTP) + 4001 (Socket.io if separate port; default same)
- `apps/api` worker → started by `pnpm --filter @aero/api dev:worker`
- `apps/algo`    → 5000

### 12.3 Fake clock + replay endpoints (dev/staging only)

For testing assignment flow without waiting hours:

- `POST /api/v1/test/clock { now: ISO }` — advances a server-side mock clock (only when `NODE_ENV !== 'production'` AND `TEST_CLOCK_ENABLED=true`).
- `POST /api/v1/test/assignment/run-now { bookingId }` — bypasses delay, runs `runAssignmentAttempt` immediately.

These routes are wired only when the env flag is on; the route file `__throws__` at import in prod to fail loud if accidentally bundled.

### 12.4 Seed drivers + vehicles

`packages/db/prisma/seed.phase4.ts`:
- 8 drivers, mix of cities (Chandigarh×4, Amritsar×2, Ludhiana×2), all `ACTIVE`, all with verified critical docs valid 1 year, all with vehicles spanning all 4 categories.
- 4 of them start `ONLINE`, last-seen now; 4 `OFFLINE`.
- A test passenger booking is auto-CONFIRMED on seed, scheduled in 10 min — triggers an immediate assignment.

---

## 13. Testing Plan

### 13.1 Unit (Vitest + Pytest)

| Spec | Cases ≥ |
|---|---|
| `eligibility.spec.ts` | 12 — each hard gate violated; vehicle category mismatch; expired doc; overlap; existing OPEN offer; previously declined this booking |
| `offer.service.spec.ts` | 10 — accept happy, accept after expired, decline, double-accept idempotent, expire idempotent, cancel on booking cancel |
| `pool.spec.ts` (with Testcontainers Postgres) | 6 — overlap detection via GiST, doc-gating, online filter, lastSeen freshness |
| `test_matching.py` | 25 — ordering, ties, weights, penalty, missing-location, single, empty |
| `assignment.service.spec.ts` (with mocked queues + algo) | 10 — first-attempt offer sent, retry on decline, retry on expiry, cutoff alert, booking cancelled mid-flow, idempotent re-run |

### 13.2 Integration (Supertest + Testcontainers + ioredis-mock)

- **Happy path:** seed a CONFIRMED booking 4h out → trigger assignment via `test/assignment/run-now` → assert one Offer in DOM, one Notification queued, FCM mock called once, Socket.io emit recorded.
- **Driver accepts:** POST accept → booking is DRIVER_ASSIGNED, passenger notification queued, offer-lock released, expiry job removed.
- **Driver declines:** POST decline with reason → next-best driver gets an Offer within 1s (immediate retry).
- **Offer expires:** advance fake clock past TTL → expiry worker flips to EXPIRED, retry runs, next driver offered.
- **All decline:** 5 sequential declines → AssignmentAttempt outcome ALL_DECLINED, retry scheduled 5 min later (delayed job exists in queue).
- **Cutoff:** fast-forward to T-29m with no acceptance → admin-alert worker creates SystemAlert + Slack stub called + email queued.
- **Booking cancelled during offer:** customer cancels (Phase 2) while offer pending → offer becomes CANCELLED, driver gets cancellation SMS, queue jobs removed.
- **Driver toggles offline with open offer:** PATCH availability → 409.
- **Heartbeat expiry:** stop heartbeat → after 2 min, driver flips OFFLINE.
- **Race: two accepts:** simulate two simultaneous accepts on the same offer → one wins, the other gets 409.
- **Race: simultaneous accept + booking cancel:** transition contention resolved by `FOR UPDATE`; offer ends up CANCELLED if booking won, ACCEPTED if accept won.

### 13.3 E2E (Playwright)

- `driver-login.spec.ts`: open driver app → enter test driver phone → enter OTP (test bypass `123456`) → land on home.
- `driver-offer-accept.spec.ts`: dev test-route creates a booking; offer appears in driver UI within 3s via Socket; accept → success screen → trip shows in /trips.
- `driver-offer-decline.spec.ts`: same, decline with reason → screen returns to home; new offer arrives for a different test driver.
- `driver-doc-blocks-online.spec.ts`: driver with expired licence taps ONLINE → blocked with error.
- `passenger-sees-driver.spec.ts`: customer-side My Bookings auto-refreshes (poll or socket) and shows assigned driver name + plate after the accept above.

### 13.4 Load test (k6)

Scenario: 200 CONFIRMED bookings spread over 5 minutes, 50 online drivers, all eligible. Assert:
- p95 time from `runAssignmentAttempt` start → offer sent < 500ms.
- p95 time from accept request → booking row in DRIVER_ASSIGNED < 300ms.
- No deadlocks under contention (pool query takes < 100ms p95 with seeded data of 10k drivers).

### 13.5 Acceptance criteria

- [ ] All unit + integration + E2E + load thresholds green in CI / nightly.
- [ ] Bookable end-to-end: customer pays → 3h later (or fake-clock immediately) → driver phone gets SMS + push → driver accepts → passenger gets SMS within 60s.
- [ ] Cutoff path verified on staging: a CONFIRMED booking with all drivers OFFLINE produces a SystemAlert in admin tray + Slack message within 1 min after T-30m.
- [ ] Auto-cancel + refund path verified for the no-driver-by-pickup scenario.
- [ ] No double-assignment under simulated contention (10 parallel accepts).
- [ ] Driver with expired LICENCE never appears in any offer pool (DB-level test with seeded driver).
- [ ] Manual admin assign (Phase 3) still works and triggers the same passenger SMS.
- [ ] Driver portal Lighthouse on `/home`: Performance ≥ 85 (mobile), Accessibility ≥ 95, PWA installable.

---

## 14. Security Checklist (Phase 4 specific)

- [ ] Driver namespace JWT verified on every WS connection; closed if role flips.
- [ ] Driver cannot accept an offer for a booking they're not the offered driver of (server-checked, not trusted from client).
- [ ] Offer accept/decline rate-limited: 30/min/driver (prevents abuse loops).
- [ ] Slack and FCM secrets in env only; never logged.
- [ ] Passenger phone shown to driver only after assignment, masked everywhere else in driver UI.
- [ ] FCM tokens scoped per driver; on logout, server revokes all this device's tokens.
- [ ] No raw passenger PII in driver SMS templates beyond name + masked phone (full phone only after ACCEPTED, as call-bridge would replace this later).
- [ ] Heartbeat endpoint rate-limited: 4/min/driver.
- [ ] Internal `/internal/assignment/run` endpoint requires `X-Internal-Auth` shared secret AND originates from API container network only (Caddy doesn't expose it).
- [ ] Test endpoints (`/api/v1/test/*`) absent from prod build (compile-time guard).
- [ ] `Driver.availability` writes only via authenticated driver endpoint or admin endpoint — no direct DB writes in business code.
- [ ] Audit events emitted for: driver assigned (auto or manual), driver unassigned, offer accepted, offer expired/cancelled, booking auto-cancelled by system.

---

## 15. Observability

New metrics:
- `assignment_attempts_total{outcome}` (OFFER_SENT | ALL_DECLINED | POOL_EMPTY | ACCEPTED | ABORTED)
- `assignment_attempt_duration_seconds`
- `offers_total{result}` (accepted | declined | expired | cancelled)
- `offer_response_seconds{result}` (histogram)
- `assignment_pool_size` (gauge per attempt)
- `driver_online_count` (gauge)
- `driver_heartbeat_age_seconds` (histogram)
- `system_alerts_open{type}` (gauge)
- `fcm_send_total{result}`
- `socket_io_connections{namespace}` (gauge)

Dashboards:
- "Assignment funnel" — CONFIRMED → first attempt → offers sent → accepted → DRIVER_ASSIGNED, with conversion %.
- "Driver supply" — online count over time, heartbeat lag, per-city availability.
- "Offer health" — acceptance rate, p50/p95 response time, declined reasons breakdown.

Alerts:
- `assignment_attempts_total{outcome="POOL_EMPTY"}` > 5 in 15 min → page on-call (driver supply collapse).
- `system_alerts_open{type="UNASSIGNED_T_MINUS_30"}` > 0 → page on-call (already user-impacting).
- `offer_response_seconds p95 > 50s` for 15 min → warn (drivers slow / push broken).
- `driver_online_count` drops > 30% in 5 min → warn.
- `fcm_send_total{result="error"} / total > 10%` → page (auth or quota issue).

Runbook: `docs/runbooks/no-drivers.md` — covers POOL_EMPTY storm response (mass SMS to standby drivers, raise short-term surge, contact partner fleet).

---

## 16. Deployment

### 16.1 Order
1. Run migration `phase4_assignment` (additive + GiST index — CONCURRENTLY where supported).
2. Deploy `apps/algo` (matching endpoint).
3. Deploy `apps/api` (workers as separate container `aero-api-worker`).
4. Deploy `apps/driver`.
5. Re-deploy `apps/web` & `apps/admin` if any shared package changes (`@aero/types`).
6. Smoke test on staging: end-to-end driver acceptance using the fake-clock route.
7. Send announcement SMS to onboarded drivers with portal URL + login instructions.

### 16.2 Worker process layout (Hetzner)

Single VM, multiple systemd-managed Docker containers from the same image with different commands:

```
aero-api            (HTTP + Socket.io)        ports 4000
aero-api-worker-1   (assignment + offer-expiry)
aero-api-worker-2   (notifications)
aero-api-worker-3   (reminders + admin-alert + webhook + reconcile)
```

Workers are stateless; horizontally scale by changing systemd unit count. BullMQ uses `lockDuration` + `stalledInterval` to recover from worker crashes (configure to 30s / 30s).

### 16.3 Feature flags
- `ASSIGNMENT_AUTOMATION_ENABLED` — when false, the `confirmed` hook does NOT enqueue jobs; admin must assign manually. Lets us roll back automation without redeploying.
- `DRIVER_PORTAL_ENABLED` — when false, driver app shows a maintenance banner.

### 16.4 Rollback
- Toggle `ASSIGNMENT_AUTOMATION_ENABLED=false`. Admin team falls back to Phase 3 manual assign. No data loss.
- For the driver app, Vercel "Promote previous deployment".

---

## 17. Five-Day Plan

| Day | Owner | Tasks |
|---|---|---|
| Mon | BE | Migration `phase4_assignment` (tables + GiST index). Eligibility filter + pool builder (raw SQL). Hook into Phase 2 `transitionBooking` to enqueue first attempt. Queues + worker scaffold. |
| Mon | Algo | `/matching/score` endpoint + 25-case test suite. |
| Mon | FE | `apps/driver` scaffold (Next.js, Tailwind, PWA manifest). Login (reuses OTP) + Home with AvailabilityToggle. |
| Tue | BE | Offer service (create/accept/decline/expire) with row locks. Idempotent state machine. Offer-lock in Redis. Audit logs. |
| Tue | BE | Driver heartbeat endpoint + Redis TTL + Postgres mirror + cron sweeper. Availability toggle endpoint with doc gates. |
| Tue | FE | Offer screen with CountdownRing, accept/decline + canned reasons sheet. Trips list (read-only). |
| Wed | BE | FCM integration (token register, send on offer create). Socket.io `/driver` namespace + auth + room push. Assignment worker orchestrator end-to-end. Cutoff branch + admin-alert worker. |
| Wed | FE | FCM service worker, foreground handler, audio + vibration. Reconnect-and-poll safety net. Settings page (docs status, notification prefs). |
| Wed | DevOps | Hetzner systemd units for `aero-api-worker-1/2/3`. Slack app + bot install. MSG91 7 new DLT templates submitted. Vercel projects + domains. |
| Thu | BE | Pre-trip reminders worker. Auto-cancel + auto-refund on no-driver-by-pickup. Manual reassign passenger SMS hook. `/admin/alerts` endpoints. Test-clock + run-now dev routes. |
| Thu | FE (admin) | Admin dashboard tray reads alerts; ack / resolve flow. Booking detail shows assignment timeline (attempts, offers, responses). |
| Thu | All | Integration tests pass (Testcontainers Postgres incl. GiST). E2E happy-path on dev. Load test (k6) at 200 bookings / 50 drivers. |
| Fri | All | Staging dress rehearsal: founder + 2 real test drivers + 2 test passenger phones go through the full loop. Bug bash. Tag `v0.4.0-phase4`. Update [implementation.md](implementation.md) status. |

---

## 18. Risks (Phase 4)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Web Push unreliable on iOS Safari | High | Drivers miss offers | Always send SMS in parallel; rely on Socket.io when app is open; document "keep app open" in onboarding; push to native app (Phase 7) for full reliability |
| Driver leaves app, FCM token stale | High | Missed offers | Token refresh on every visit; invalidate on send failure; SMS is the guaranteed channel |
| Pool query slow at scale (10k drivers) | Medium | Assignment latency spikes | GiST index on overlap; partial index on online drivers; benchmark in load test; cap query at 50 rows |
| Two drivers accept "the same" offer (impossible by design, but race) | Low | Double-book | `FOR UPDATE` on Offer + Booking rows; the unique constraint `(bookingId, status=ACCEPTED)` via partial index added: `CREATE UNIQUE INDEX one_accepted_per_booking ON "Offer" ("bookingId") WHERE status='ACCEPTED';` |
| Driver cherry-picks high-fare trips, declines low | Medium | Bad supply for low-value rides | Track per-driver decline rate; surface in admin; penalty score already drops them; consider Phase 6 incentives |
| FCM send failures hide assignment failures | Medium | Silent breakage | Treat FCM failure as warning, not blocker; SMS is the source of truth; metric + alert on `fcm_send_total{result="error"}` |
| Slack outage masks alerts | Low | Ops blind | Email is sent in parallel; alert also visible in admin tray |
| Auto-refund on no-driver creates moral hazard (passengers learn to last-min-book hoping for failure) | Low | Refund cost | Track per-user "system-cancelled" count; if > 2 in 30 days, manual review before refund |
| Heartbeat drains driver phone battery | Medium | Drivers go OFFLINE involuntarily (close app) | 30s interval (not 5s); SW handles it efficiently; tab-visible check pauses when backgrounded; Phase 7 native app does it properly |
| Bug puts a booking into infinite retry loop | Low | Queue floods, ₹ burn on SMS | Hard cap: max 30 attempts per booking; circuit breaker on `assignment-retry` queue (depth > 500 → pause queue + page) |

---

## 19. Deliverables Checklist

Code:
- [ ] Migration `phase4_assignment` applied to dev + staging.
- [ ] GiST overlap index in place + benchmark recorded.
- [ ] `apps/algo` `/matching/score` deployed.
- [ ] `apps/api` exposes driver namespace, driver endpoints, alerts endpoints; workers running as `aero-api-worker-1/2/3` systemd units.
- [ ] `apps/driver` deployed at `driver-dev.aerosarathi.com`.
- [ ] Phase 2 `transitionBooking` hooks call `onBookingConfirmed` on every CONFIRMED transition.
- [ ] Admin dashboard alert tray functional.

Ops:
- [ ] 4 Firebase web apps (driver-dev, driver-staging, driver-prod, plus reserved).
- [ ] Slack `Aero Ops Alerts` bot installed; test alert posted.
- [ ] MSG91 templates 5–11 approved by DLT; IDs in env.
- [ ] Grafana dashboards "Assignment funnel", "Driver supply", "Offer health" live.
- [ ] Alerts wired (POOL_EMPTY storm, T-30 unassigned, p95 response time).
- [ ] At least 5 real test drivers onboarded on staging.
- [ ] Runbook `docs/runbooks/no-drivers.md` published.

Docs:
- [ ] OpenAPI updated.
- [ ] `docs/runbooks/assignment-stuck.md` (how to inspect AssignmentAttempt + Offer + queue depth + manually re-run).
- [ ] `docs/qa/assignment-cases.md` with 20+ scenarios.
- [ ] Driver onboarding 1-pager (login URL, how to go online, offer screen explainer).

---

## 20. Handoff to Phase 5

Phase 5 (live tracking) starts the moment Phase 4 is live and stable. Contracts Phase 5 depends on:

- `Driver.lastSeenAt` + Redis `driver:loc:{id}` already populated by the driver client (Phase 4 only needs coarse location; Phase 5 will upgrade to 5-second high-accuracy pings).
- `Booking.driverId` and `Booking.assignedAt` reliably set after acceptance.
- Socket.io `/driver` namespace exists; Phase 5 adds `/passenger` namespace + `/track/:bookingCode` public namespace.
- Driver portal already has location permission flow; Phase 5 extends it.
- `BookingStatusEvent` ledger records every transition — Phase 5's `EN_ROUTE`, `ONGOING`, `COMPLETED` transitions fit the same model.

Open items pushed to Phase 5:
- Driver trip lifecycle endpoints (`/driver/trips/:id/start|arrive|complete`).
- High-frequency GPS streaming + Mongo `ride_logs` storage.
- Passenger tracking page `/track/:code` with HMAC-signed shareable link.
- SOS button.
- ETA recomputation via Directions API with aggressive caching.

---

**End of Phase 4 document.**
