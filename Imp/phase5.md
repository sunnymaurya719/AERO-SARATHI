# Phase 5 — Live Tracking (Week 6)

**Parent document:** [implementation.md](implementation.md)
**Previous phases:** [phase1.md](phase1.md) · [phase2.md](phase2.md) · [phase3.md](phase3.md) · [phase4.md](phase4.md)
**Phase status:** Not started
**Duration:** 1 week (5 working days)
**Prereq:** Phase 4 complete — drivers can be assigned automatically, driver portal works, Socket.io `/driver` namespace exists, `Driver.lastSeenAt` + Redis `driver:loc:{id}` are populated (coarsely).

---

## 1. Phase Goal

Turn a `DRIVER_ASSIGNED` booking into a live, watchable trip. The driver app streams high-accuracy GPS every 5 seconds during the active window. The passenger (and anyone they share the link with) sees the driver's position on a Google Map in real time, with status timeline, ETA, and an SOS button. The driver runs the trip lifecycle from a single screen: **Arrived → Start → Complete**. Every GPS ping is logged to MongoDB for post-trip review and fraud detection.

**Definition of "done" for Phase 5:**
> A passenger receives the "driver assigned" SMS, opens the embedded `https://aerosarathi.com/track/AS-260601-A1B2?t=<hmac>` link, sees the driver's car icon move on a map within 10 seconds of the driver moving in reality, watches the status pill advance through "En route → Arrived → Ongoing → Completed", taps an SOS button that pages ops, and after the trip can read a summary including actual distance vs estimated. The driver completes the trip from their phone in three taps. All GPS pings persist for 90 days for audit.

---

## 2. Scope

### In scope
- Driver-side: high-frequency GPS publisher (5s while on duty), foreground-only with explicit permission UI; falls back to 15s when battery saver is on (heuristic).
- Driver trip lifecycle: `Start trip` (→ EN_ROUTE), `Arrived at pickup`, `Begin ride` (→ ONGOING), `Complete ride` (→ COMPLETED).
- Server: Socket.io `/passenger` and public `/track` namespaces; Redis hot store of latest location; Mongo cold store of every ping during `EN_ROUTE | ONGOING`.
- Passenger tracking page `/track/[code]`:
  - HMAC-signed shareable URL with expiry.
  - Google Maps JavaScript API with custom driver marker, pickup/drop pins, route polyline.
  - Live ETA recomputed every 30s via cached Directions API.
  - Status timeline.
  - SOS button (creates SystemAlert + pages ops + records a Mongo event).
- "My Bookings" detail (logged-in customer) replaces the placeholder with the live map for active trips.
- Admin: live map view per booking + per-driver historical trip replay (read from Mongo `ride_logs`).
- Post-trip summary: actual distance, duration, fare reconciliation (token paid + balance due to driver).
- Anti-fraud heuristics on completion: speed clamp, distance vs straight-line ratio, GPS gap detection. Suspicious trips flagged for ops review.
- Persistent passenger SMS at T-30 min (already scheduled in Phase 4) carries the tracking URL.
- Service worker on driver app keeps the heartbeat + GPS pinging while the tab is in foreground.

### Explicitly OUT of scope (deferred)
- Background GPS while phone is locked / app backgrounded — Phase 7 native app territory (Web cannot do this reliably).
- In-trip route deviation alerts (Phase 6).
- Two-way passenger ↔ driver chat (Phase 6).
- Voice call masking (Exotel/Plivo bridge) (Phase 6).
- Live traffic re-routing on the driver side (driver uses their own navigation app; we just track).
- Sharing live location to passenger's contacts as a separate channel beyond the URL.
- Multi-stop trips.
- Trip recordings / dashcam.

---

## 3. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-5.1 | passenger | open one link and see my driver's location moving | I know exactly when to be downstairs |
| US-5.2 | passenger | share the same link with my family | they can watch my ride for safety |
| US-5.3 | passenger | see ETA to pickup, then to destination, refreshed live | I can plan precisely |
| US-5.4 | passenger | press SOS during the ride | ops can intervene immediately |
| US-5.5 | driver | start, arrive, begin, complete the trip from one screen | I don't fumble while driving |
| US-5.6 | driver | be told when GPS permission drops | I know the passenger can't see me |
| US-5.7 | ops | see all active trips on a map | I can spot stuck or off-route trips |
| US-5.8 | ops | replay any past trip's GPS trail | I can investigate complaints |
| US-5.9 | platform | detect impossible speeds | I block GPS-spoofing drivers |

---

## 4. Architecture Slice for Phase 5

```
┌──────────────────────────────────────────────────────────────┐
│  Driver Web (apps/driver)                                    │
│  /trips/[id]/run — Big map + Start/Arrived/Begin/Complete    │
│  geolocation.watchPosition() → throttle 5s → WS publish      │
└────────────┬─────────────────────────────────────────────────┘
             │ WSS  /realtime  ns=/driver  event=location:ping
             ▼
┌──────────────────────────────────────────────────────────────┐
│  API + Socket.io (apps/api)                                  │
│  - Ingestor: validate, clamp, dedupe                          │
│  - Hot store → Redis  driver:loc:{driverId}  TTL 30s          │
│  - Cold store → Mongo ride_logs (only if booking ONGOING|EN)  │
│  - Fanout → ns=/passenger room booking:{id}                   │
│           → ns=/track    room track:{code}                    │
│  - ETA cron job per active booking (30s) → Directions cached  │
└──┬───────────┬──────────┬───────────┬──────────────┬─────────┘
   │           │          │           │              │
   ▼           ▼          ▼           ▼              ▼
Postgres   Redis      Mongo       Google         BullMQ
(Booking   (loc, ETA  (ride_logs, Directions     (eta-tick,
 lifecycle cache,     trip_sum,   API (cached)   trip-stale-
 + Trip    surge,     sos_events)                 watchdog)
 record)   sos-ack)
                              ↑
                       Customer Web + Admin
                       open /track/[code] (public, HMAC) or
                       /account/bookings/[id] (logged-in)
```

External services added: just Google **Maps JavaScript API** on the passenger side (cost-controlled — see §11). Directions API is reused from Phase 1 server-side.

---

## 5. Data Model Changes

Migration name: `phase5_tracking`.

### 5.1 Postgres

```prisma
model Booking {
  // ... existing fields ...
  enRouteAt        DateTime?
  arrivedAt        DateTime?
  startedAt        DateTime?
  completedAt      DateTime?
  actualKm         Float?
  actualMin        Int?
  trip             Trip?
}

model Trip {
  id              String   @id @default(uuid())
  bookingId       String   @unique
  booking         Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  driverId        String
  vehicleId       String
  startLat        Float?
  startLng        Float?
  endLat          Float?
  endLng          Float?
  pickupReachedLat Float?
  pickupReachedLng Float?
  totalKm         Float?
  totalMin        Int?
  topSpeedKmh     Float?
  avgSpeedKmh     Float?
  pingCount       Int      @default(0)
  gapCount        Int      @default(0)            // pings missed > 30s
  fraudScore      Float?                          // 0..1
  fraudFlags      Json?                           // array of {type, detail}
  reviewStatus    TripReviewStatus @default(NONE)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([driverId, createdAt])
}

enum TripReviewStatus { NONE PENDING_REVIEW APPROVED REJECTED }

model SosEvent {
  id          String   @id @default(uuid())
  bookingId   String
  booking     Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  triggeredBy SosActor                            // PASSENGER | DRIVER | ADMIN
  lat         Float?
  lng         Float?
  message     String?
  alertId     String?                             // ref SystemAlert
  ackedById   String?
  ackedAt     DateTime?
  resolvedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([bookingId, createdAt])
}

enum SosActor { PASSENGER DRIVER ADMIN }

model TrackToken {
  id          String   @id @default(uuid())
  bookingId   String
  booking     Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  tokenHash   String   @unique                    // sha256 of token sent in URL
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([bookingId])
}
```

State machine additions to `transitionBooking`:

```
DRIVER_ASSIGNED → EN_ROUTE     (driver: POST /trips/:id/start)
DRIVER_ASSIGNED → CANCELLED    (already supported)
EN_ROUTE        → ARRIVED      (driver: POST /trips/:id/arrived)   // ARRIVED is a sub-state, NOT a separate enum value
                                                                   // we keep status=EN_ROUTE and set arrivedAt
EN_ROUTE        → ONGOING      (driver: POST /trips/:id/begin)
EN_ROUTE        → NO_SHOW      (driver: POST /trips/:id/no-show after 15min at pickup with no passenger)
ONGOING         → COMPLETED    (driver: POST /trips/:id/complete)
```

Note: we intentionally do **not** add an `ARRIVED` enum value to avoid a churning schema change. `arrivedAt` is a timestamp on the booking; UI derives "Arrived" from `enRouteAt != null && arrivedAt != null && startedAt == null`.

### 5.2 MongoDB

Collection `ride_logs` — append-only, sharded later by `bookingId`.

```json
{
  "_id": "ObjectId",
  "bookingId": "uuid",
  "driverId": "uuid",
  "vehicleId": "uuid",
  "ts": "2026-06-01T05:14:32.123Z",
  "lat": 30.74183,
  "lng": 76.78211,
  "accuracyM": 8.2,
  "speedKmh": 42.5,
  "headingDeg": 128.0,
  "altitudeM": 312.4,
  "batteryPct": 64,
  "phase": "EN_ROUTE",                  // EN_ROUTE | ONGOING
  "source": "gps",                      // gps | wifi | network | unknown
  "clientSeq": 8421                     // driver-side monotonic
}
```

Indexes:
- `{ bookingId: 1, ts: 1 }` — replay queries.
- `{ driverId: 1, ts: -1 }` — recent driver activity.
- TTL on `ts` set to 90 days (raw ping retention).

Collection `trip_summaries` — one doc per booking on COMPLETED. Stores the simplified polyline (Douglas–Peucker reduced to ≤500 points), bounds, and per-leg distances. Source of truth for the "My Bookings → past trip → see route" view after the 90-day raw-ping TTL.

Collection `sos_events` — additional richer per-event log mirroring the Postgres `SosEvent` row plus contextual snapshots (last 10 pings, driver heartbeat age, passenger user-agent at SOS time).

### 5.3 Redis keys (new / updated)

| Key | TTL | Purpose |
|---|---|---|
| `driver:loc:{driverId}` | 30s | latest `{lat, lng, heading, speed, ts, accuracy}` JSON (overwrites Phase 4's coarser value) |
| `booking:active:{bookingId}` | trip duration + 1h | `{driverId, status, startedAt}` for fast lookup during fanout |
| `eta:{bookingId}` | 60s | last computed ETA `{toPickup?, toDrop?, computedAt}` |
| `track:rl:{ip}` | 1m | rate-limit counter for `/track` page hits |
| `sos:cooldown:{bookingId}` | 60s | dedup multiple SOS taps |

---

## 6. GPS Publishing (Driver Side)

### 6.1 Permission flow

When the driver opens `/trips/[id]/run`:

1. If permission is `granted` → start watcher immediately.
2. If `prompt` → show a full-screen primer ("Aero Sarathi needs precise location during your trip so the passenger can see your car. Location is only sent while a trip is active.") with two CTAs: **Enable** / **Not now**. Tapping Enable invokes `navigator.geolocation.getCurrentPosition` to surface the OS prompt.
3. If `denied` → show a blocking banner with platform-specific instructions (deep link to Chrome site settings, Safari settings explainer) and a Call Dispatcher button. Trip cannot proceed past EN_ROUTE without it.

A non-blocking yellow toast appears any time `watchPosition` reports a `PERMISSION_DENIED` or `POSITION_UNAVAILABLE` error mid-trip.

### 6.2 watchPosition + throttle

```ts
// apps/driver/lib/geo.ts
import { socket } from './socket';

const HIGH_ACCURACY_OPTS: PositionOptions = {
  enableHighAccuracy: true, maximumAge: 0, timeout: 15_000,
};

let watchId: number | null = null;
let lastSentAt = 0;
let clientSeq = 0;

export function startTripTracking(bookingId: string) {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition(bookingId, pos),
    (err) => onError(err),
    HIGH_ACCURACY_OPTS,
  );
}

export function stopTripTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onPosition(bookingId: string, pos: GeolocationPosition) {
  const intervalMs = (navigator as any).connection?.saveData ? 15_000 : 5_000;
  if (Date.now() - lastSentAt < intervalMs) return;
  lastSentAt = Date.now();
  socket.volatile.emit('location:ping', {
    bookingId,
    clientSeq: ++clientSeq,
    ts: new Date(pos.timestamp).toISOString(),
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM: pos.coords.accuracy,
    speedKmh: pos.coords.speed != null ? Math.max(0, pos.coords.speed * 3.6) : null,
    headingDeg: pos.coords.heading ?? null,
    altitudeM: pos.coords.altitude ?? null,
    batteryPct: await readBattery(),
    source: 'gps',
  });
}
```

Notes:
- `socket.volatile.emit` drops pings instead of buffering on disconnect — old pings are useless.
- `clientSeq` lets the server detect reorderings.
- Throttle is **client-side primary, server-side defensive** (server drops > 1 ping / 2s per driver).
- Battery API: if unavailable, send `null`. We only use it to display "driver battery low" warning to the passenger after 10% (Phase 6).

### 6.3 Page-Visibility handling

When the tab is hidden (driver switches to Google Maps for navigation), browsers throttle JS timers and may pause `watchPosition`. Strategy:
- Keep emitting whatever pings the browser gives us — even at 30s cadence, the passenger marker still moves.
- On `visibilitychange` → `hidden`, show an in-page banner: "Background tracking is limited on web. Use Aero Maps in split-screen or our app (coming soon)."
- Continue WS connection in background; do not close on visibility change.

### 6.4 Network failure

- If the socket disconnects, the watchPosition handler still fires; pings are silently dropped.
- On reconnect, **do not** flush a backlog (privacy + cost). The hot store is "live or nothing".
- A REST fallback `POST /api/v1/driver/trips/:id/ping` accepts a single ping; the driver client posts a ping every 30s as a safety net (in addition to WS). Server dedupes by `(driverId, clientSeq)`.

---

## 7. Server Ingestion

### 7.1 Pipeline

```
WS event "location:ping" on /driver
   │
   ▼
authGuard (driverId from session)
   │
   ▼
validate (zod) + clamp + sanity check
   │
   ├── reject (speed > 200 km/h, accuracy > 200m, NaN, future ts, > 60s old)
   │
   ▼
upsert Redis  driver:loc:{driverId}  EX 30
   │
   ▼
look up Redis booking:active:{driverId}  → bookingId (if any)
   │
   ├── if none → done (driver online but no trip)
   │
   ▼
append Mongo ride_logs (only if phase in EN_ROUTE | ONGOING)
   │
   ▼
emit /passenger ns room booking:{bookingId}  event "loc"
emit /track     ns room track:{code}         event "loc"
   │
   ▼
update Trip.pingCount + Trip.topSpeedKmh (in-memory; periodically flushed)
```

### 7.2 Validation rules

| Rule | Action on violation |
|---|---|
| `accuracyM > 200` | drop ping silently; bump `gapCount` if pattern persists |
| `speedKmh > 200` | drop + record `fraudFlags.high_speed` |
| `ts in future` or `ts < now − 60s` | drop |
| Lat/lng outside India bbox `(6, 68)`–`(38, 98)` | drop + record `fraudFlags.out_of_country` |
| Same `clientSeq` repeated within 60s | drop (dedup) |
| Distance from previous ping > `speed_limit_kmh * gap_seconds + 50m slack` | drop + `fraudFlags.teleport` |

### 7.3 Fanout

Socket.io rooms:
- `/driver` namespace already has `driver:{driverId}` room (Phase 4).
- `/passenger` namespace (new): clients authed via the same customer JWT cookie; on join, server validates `bookingId` belongs to caller, then joins `booking:{bookingId}` room.
- `/track` namespace (new, **public**): clients pass `?code=...&t=...` in the WS handshake; server verifies HMAC + token row not revoked + not expired; joins `track:{code}` room.

Server emits the **trimmed** location to passenger/track rooms (only `lat, lng, heading, speedKmh, ts`) — no driver battery, no accuracy, no source. Driver privacy.

### 7.4 ETA recomputation

A BullMQ repeatable job per active trip — added on `EN_ROUTE` transition, removed on `COMPLETED|CANCELLED|NO_SHOW`:

```
queue: eta-tick
job key: eta:{bookingId}
every: 30s
payload: { bookingId }
```

Worker:
1. Read latest `driver:loc:{driverId}` from Redis. If older than 60s → skip (no fresh data).
2. Pick target: pickup if booking `arrivedAt == null`, otherwise drop.
3. Cache key `eta:{bookingId}:{phase}:{coordsRounded}`. If hit & < 60s old → use cached.
4. On miss, call Google Directions with `origin=driver`, `destination=target`, `mode=driving`, `departure_time=now`. Get `duration_in_traffic`.
5. Write `eta:{bookingId}` Redis key (`{toPickup|toDrop, minutes, computedAt}`), TTL 60s.
6. Emit `eta` event on `/passenger` + `/track` rooms.

Cost cap: 30s × 2 phases × N active trips. With 100 concurrent trips this is ~12k Directions calls / hour. At Google's INR pricing (~₹0.40/call after free tier), that's ~₹5k / hour worst case — too much. **Mitigations:**
- Coord rounding to ~100m on origin → cache key collisions across nearby trips.
- Slow the recompute to 60s if `< 20 trips active`, 30s if `≥ 20`, 15s if `≥ 100` (counterintuitive but cache hit rate goes up with more trips on the same routes).
- Hard daily budget cap; if exceeded, fall back to "ETA based on haversine × 1.4 / avg speed 35 km/h" (clearly labelled "approx" in UI).

---

## 8. Driver Trip Lifecycle (API)

All under `/api/v1/driver`. JWT role=DRIVER. `Idempotency-Key` required on mutations.

### 8.1 `POST /trips/:bookingId/start`

Driver taps **Start trip** on the assigned booking.

Preconditions: booking `status === DRIVER_ASSIGNED`, `driverId === me`, current time within `[scheduledAt − 60min, scheduledAt + 120min]` (configurable).

Server:
1. `transitionBooking(DRIVER_ASSIGNED → EN_ROUTE, reason='driver_start')`.
2. Set `Booking.enRouteAt = now`.
3. Upsert `Trip` row (mostly empty), set `startLat/Lng` from latest Redis loc if available.
4. Set Redis `booking:active:{driverId}` = `{bookingId, status:'EN_ROUTE'}` TTL 8h.
5. Enqueue `eta-tick` repeatable job.
6. Enqueue `trip-stale-watchdog` delayed job (T-15 min after `scheduledAt`, fires if still EN_ROUTE & arrivedAt null & no ping in 5min — pages ops).
7. Emit `booking:status` on `/passenger` and `/track` rooms.
8. Notification: passenger SMS `passenger_driver_en_route` if not already sent at T-30min.

Response: full booking + trip snapshot.

### 8.2 `POST /trips/:bookingId/arrived`

Driver taps **I've arrived** at pickup. No status enum change — just `Booking.arrivedAt = now`, store `Trip.pickupReachedLat/Lng`.

Server-side sanity: `haversine(driver_loc, booking.pickup) < 500m`. If not, return 422 with a "Confirm anyway" path (`?force=true`) that records a `fraudFlags.arrived_far_from_pickup` entry. Audit-logged.

Notification: passenger SMS `passenger_driver_arrived` ("Your driver has arrived. Car: ...").

### 8.3 `POST /trips/:bookingId/begin`

Driver taps **Start ride** when passenger is in the car.

Preconditions: `arrivedAt != null`.

Server:
1. `transitionBooking(EN_ROUTE → ONGOING)`.
2. Set `Booking.startedAt = now`.
3. Redis `booking:active` updated `status:'ONGOING'`.
4. Notification: passenger SMS `passenger_ride_started`.

### 8.4 `POST /trips/:bookingId/complete`

Driver taps **End ride** at destination.

Body: `{ note?: string }` (optional driver note).

Server:
1. Compute trip stats from Mongo `ride_logs` between `startedAt..now`:
   - `actualKm` = sum of consecutive haversine distances, ignoring pings with `accuracyM > 50` for distance summing.
   - `actualMin` = `(now − startedAt) / 60s`.
   - `topSpeedKmh`, `avgSpeedKmh`.
   - `gapCount` = number of inter-ping intervals > 30s.
2. Run fraud heuristics (§9). Set `Trip.fraudScore`, `Trip.fraudFlags`, `Trip.reviewStatus = PENDING_REVIEW` if score > 0.6.
3. Build & store `trip_summaries` doc (reduced polyline).
4. `transitionBooking(ONGOING → COMPLETED)`. Set `completedAt`, `actualKm`, `actualMin`.
5. Remove `eta-tick` repeatable job. Delete `booking:active`.
6. Notifications: passenger SMS `passenger_ride_completed` + email with PDF receipt link (receipt regenerated; now includes actual km vs estimated). Driver SMS `driver_ride_completed` with payable balance reminder.
7. Update `Driver.totalTrips`, `Driver.lastTripAt`.
8. Update `DriverOfferStats` indirectly (acceptance rate already updated on accept; no change here).
9. Mark driver `availability` to `ONLINE` (was `BUSY` if we set it on accept — we did not in Phase 4, but optional).

### 8.5 `POST /trips/:bookingId/no-show`

Driver taps **Passenger no-show** after 15 minutes at pickup (UI enforces; server checks `arrivedAt < now − 15min`).

Server:
1. `transitionBooking(EN_ROUTE → NO_SHOW)`.
2. Cancellation policy: 100% retained, no refund (matches PRD).
3. `Cancellation` row inserted with `cancelledBy=SYSTEM`, `policyBucket=NO_SHOW`.
4. Notifications: passenger SMS, driver SMS confirming no-show recorded.
5. Free driver: clear `booking:active`, remove eta-tick job.

### 8.6 `POST /track/:code/sos`

Public endpoint (no JWT). Body: `{ token, message?, lat?, lng? }`.

1. Validate HMAC token same as page-load (§10.1).
2. Rate-limit: 1 SOS / 60s / bookingId (Redis `sos:cooldown:{bookingId}`). Subsequent presses within window return 200 with `dedup: true`.
3. Insert `SosEvent`, insert `SystemAlert` (`type=DRIVER_NO_SHOW` is wrong here — add new `SOS_TRIGGERED` to enum), severity `CRITICAL`.
4. Slack `#aero-ops` ping with booking code, passenger phone, current driver loc (from Redis), link to admin booking detail.
5. Email + (later) phone-call escalation: integrate Twilio Voice or Exotel auto-call to on-call ops phone (deferred to Phase 6 to avoid setup blocking Phase 5; Phase 5 ships with Slack + email + ops dashboard banner).
6. Emit `sos:new` on admin namespace + on `/track` room (so passenger sees "Help requested" confirmation).

### 8.7 `POST /api/v1/driver/trips/:bookingId/sos` (driver-initiated)

Same shape; `triggeredBy = DRIVER`. Used if driver is in distress.

---

## 9. Anti-Fraud Heuristics

Run on `complete` and continuously on each ping. Each flag has a weight; flags sum → `fraudScore ∈ [0, 1]`. Score > 0.6 → `PENDING_REVIEW`. Score > 0.85 → auto-hold driver payout (Phase 6) and notify admin immediately.

| Flag | Weight | Detection |
|---|---|---|
| `teleport` | 0.4 each occurrence (capped 0.6) | Inter-ping distance / time → speed > 200 km/h |
| `out_of_country` | 0.5 | Any ping outside India bbox |
| `arrived_far_from_pickup` | 0.2 | `haversine(arrived_loc, pickup) > 500m` |
| `completed_far_from_drop` | 0.2 | `haversine(last_loc, drop) > 1km` |
| `gps_gap` | 0.05 per gap > 60s (capped 0.3) | Inter-ping > 60s during ONGOING |
| `straight_line_distance_ratio` | 0.2 | `actualKm < haversine(pickup, drop) × 0.9` (impossible — they straight-lined a curve) |
| `high_speed_sustained` | 0.3 | Median speed in any 60s window > 140 km/h |
| `low_ping_count` | 0.2 | `pingCount < expected = actualMin × 12 × 0.3` (less than 30% of expected pings) |
| `accuracy_consistently_bad` | 0.1 | Median `accuracyM > 100m` over trip |

Heuristics run in a worker job `trip-fraud-check` enqueued on `complete`. The Trip row is updated; if flagged, a SystemAlert (`type=TRIP_FRAUD_REVIEW`, severity `WARNING`) is created.

Admin reviews via `/admin/trips/review` page (Phase 5 stretch: read-only list; full review tooling Phase 6).

---

## 10. Passenger Tracking Page

### 10.1 Shareable URL + HMAC

URL format: `https://aerosarathi.com/track/{code}?t={token}`

`token = base64url( bookingId || expiresAtUnix || HMAC_SHA256(bookingId || expiresAtUnix, TRACK_LINK_SECRET) )`

Generated on `DRIVER_ASSIGNED`:
- `expiresAt = scheduledAt + 24h` (covers delays + post-trip viewing).
- Insert `TrackToken` row with `tokenHash = sha256(token)`.
- Include URL in `passenger_driver_assigned` SMS (already templated in Phase 4; update to inject the token).

Server validation on each request:
1. Decode token, split `bookingId | exp | sig`.
2. Recompute HMAC; constant-time compare.
3. Check `expiresAt > now`.
4. Look up `TrackToken` row; if `revokedAt != null` → 403.
5. Load booking; if `status in {CANCELLED, COMPLETED, NO_SHOW}` and `completedAt + 24h < now` → render a frozen "Trip ended" summary instead of the live map.

Token can be **revoked** by the passenger from My Bookings ("Stop sharing"). Generates a new token if they want to share again (old links 403).

### 10.2 Page layout (`apps/web/app/track/[code]/page.tsx`)

- **Header** (sticky): Aero Sarathi logo, booking code, status pill.
- **Map** (full-width, 60% height on desktop, 70% on mobile): Google Map.
- **Card** (below map, draggable up on mobile to reveal more):
  - Big ETA: "Driver in 8 min" or "Arriving in 1 hr 12 min".
  - Driver chip: name, masked phone (`Call` tap reveals + initiates `tel:`), car model + plate.
  - Status timeline: 5 dots — Assigned · En route · Arrived · Ongoing · Completed.
  - SOS button (red, requires hold-to-confirm 2s to avoid accidental).
  - "Share with family" button → copies the same URL with native share sheet (`navigator.share`).

### 10.3 Map rendering

- Loader: `@googlemaps/js-api-loader` with **browser** API key (referrer-restricted).
- Initial map bounds: fitBounds(pickup, drop, current driver loc).
- Polyline: pre-fetched from server (Phase 1 quote returned distance/duration; Phase 5 endpoint `GET /tracking/:code/route` returns the polyline encoded by Google Directions, cached server-side per (pickup, drop) for 24h).
- Markers:
  - Pickup: small green pin.
  - Drop: small red pin.
  - Driver: custom rotated car SVG (rotation = heading). Smoothly interpolate between WS updates over 1s (CSS `transition: transform 1s linear`).
- "Recenter" floating button bottom-right.
- Re-fits bounds only on first load and on phase change (en_route → ongoing) — otherwise the user can pan freely.

### 10.4 Real-time connection

```ts
const socket = io('/track', {
  path: '/realtime',
  query: { code, token },
  reconnectionDelayMax: 10_000,
});
socket.on('loc', (p) => updateMarker(p));
socket.on('eta', (e) => updateEta(e));
socket.on('booking:status', (s) => updateStatus(s));
socket.on('connect_error', (e) => showOfflineBanner());
```

If WS fails (corporate firewall, etc.), fall back to polling `GET /tracking/:code/snapshot` every 10s.

### 10.5 Privacy considerations

- The map page intentionally does **not** show driver photo or accuracy radius — keeps it clean and protects driver privacy.
- Passenger's own location is never collected on the tracking page.
- HTTP headers: `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` (don't allow embedding to prevent click-jacking the SOS).

---

## 11. Google Maps Cost Control

Maps JavaScript API: ~$7 per 1000 loads (page views). Passenger tracking page loads = booking volume × concurrent viewers (often 1–3 per trip when family is watching). At 500 trips/day with avg 1.5 viewers, that's 750 loads/day → ~$160/month. Acceptable.

Controls:
- **Browser key referrer restriction** to `*.aerosarathi.com` only. Quota alarms set at 80% of monthly cap.
- Single static "trip-ended" map after 24h (uses Static Maps API at $2/1000 — 70% cheaper).
- Lazy-load Maps JS only after the user scrolls into view (rare for this page, but applied to admin live map view).
- Vector tiles enabled (cheaper than raster).
- Daily budget alert at ₹2,500 dev / ₹15,000 prod.

Directions API budget for ETA tick already analysed in §7.4.

---

## 12. Backend Implementation (`apps/api`)

### 12.1 New modules

```
apps/api/src/
├── modules/tracking/
│   ├── tracking.router.ts            # public /track endpoints (snapshot, sos, route)
│   ├── tracking.service.ts
│   ├── track-token.ts                # generate, verify, revoke
│   └── eta.service.ts                # called by eta-tick worker
├── modules/trips/
│   ├── trips.router.ts               # /driver/trips/:id/{start,arrived,begin,complete,no-show,sos,ping}
│   ├── trips.service.ts
│   └── fraud.ts                      # heuristics
├── realtime/
│   ├── passenger-namespace.ts
│   ├── track-namespace.ts
│   └── location-ingest.ts            # the validate→clamp→fanout pipeline
├── workers/
│   ├── eta-tick.worker.ts
│   ├── trip-stale-watchdog.worker.ts
│   └── trip-fraud-check.worker.ts
└── jobs/
    └── ride-logs-archive.cron.ts     # nightly: trips older than 90d → S3 JSONL.gz
```

### 12.2 Environment variables

```ini
# Tracking
TRACK_LINK_SECRET=                # 32 random bytes base64
TRACK_LINK_DEFAULT_TTL_HOURS=24
PASSENGER_NS_PATH=/passenger
TRACK_NS_PATH=/track

# ETA
ETA_TICK_BASE_SEC=60
ETA_TICK_BUSY_SEC=30
ETA_TICK_HOT_SEC=15
ETA_DAILY_BUDGET_INR=2500          # falls back to haversine after exceeded

# Fraud thresholds
FRAUD_FLAG_REVIEW_THRESHOLD=0.6
FRAUD_FLAG_HOLD_THRESHOLD=0.85

# Maps key (different from Phase 1; this one is BROWSER-RESTRICTED)
GOOGLE_MAPS_BROWSER_KEY=
```

### 12.3 Socket.io scaling

With Phase 5, WS traffic grows: per active trip → 1 driver publishing 0.2/s, fanned out to ~3 listeners. 100 trips = ~60 outbound msgs/s. Single Node process handles this easily.

When we scale beyond one API instance (Phase 6+), enable `@socket.io/redis-adapter` so rooms work across nodes. Wire it in Phase 5 even on single-node — costs nothing and avoids a future migration.

---

## 13. Admin Additions

### 13.1 Live ops map

`/admin/live` page (ADMIN+ and OPS roles):

- Full-screen Google Map.
- Pin per active trip (color by status: blue EN_ROUTE, yellow ARRIVED, green ONGOING).
- Click pin → side drawer with booking code, driver, passenger, status, "Open booking" link.
- Auto-refresh from a single WS subscription to `/admin` namespace `room=live`.

Backed by:
```
GET /api/v1/admin/live/active   → [{ bookingId, code, driverId, status, lat, lng }]
WS  /admin event "live:loc"     → fan-out from ingest pipeline
```

### 13.2 Trip replay

`/admin/bookings/[id]` detail page (Phase 3) gets a new tab **Trip Replay** (visible only when `completedAt != null` or any trip data exists):

- Static map with full polyline drawn from `trip_summaries`.
- Scrubber: timeline slider that animates the car along the polyline.
- Side panel: list of fraud flags with timestamps; click a flag → zoom to that point.
- Download GPX button (FINANCE+).

### 13.3 SOS console

`/admin/sos` page (OPS+):
- Open SOS events at top, time-ordered.
- Each row: booking code, passenger, driver, time since trigger, current location.
- One-click acknowledge; sets `ackedBy`, removes Slack `@here` echo.
- Resolution form with reason → moves to "Resolved" archive.

---

## 14. Local Development

### 14.1 GPS spoofer

For dev without a phone, a CLI tool `apps/driver/scripts/spoof.ts`:

```powershell
pnpm --filter @aero/driver spoof --booking AS-260601-A1B2 --route apps/driver/fixtures/chd-del.json --speed 60
```

Reads a JSON of waypoints, interpolates pings at 5s cadence at the given km/h, opens a WS to local API, and streams `location:ping` events as if from a real driver client. Lets us exercise the full pipeline end-to-end on a laptop.

### 14.2 Fake clock + map mocking

Tests use a Playwright Google Maps mock (intercept Maps JS calls + return canned tile responses) so E2E doesn't burn quota. The mock asserts marker `transform` style updates.

---

## 15. Testing Plan

### 15.1 Unit

| Spec | Cases ≥ |
|---|---|
| `track-token.spec.ts` | 6 — sign+verify, expired, bad sig, revoked, wrong booking, base64url edge |
| `location-ingest.spec.ts` | 12 — every validation rule, dedup by clientSeq, teleport detection, throttle |
| `fraud.spec.ts` | 15 — every flag triggered in isolation + a combined scenario |
| `eta.service.spec.ts` | 6 — cache hit, cache miss → Directions call, budget exceeded fallback, stale driver loc skip |
| `trips.service.spec.ts` | 10 — each transition guard, double-start idempotent, complete computes actualKm correctly from canned pings |

### 15.2 Integration

- **Start → Complete happy path**: seed booking, simulate spoofer streaming 200 pings, call start → arrived → begin → complete; assert Trip stats, ride_logs count, trip_summaries doc, notifications enqueued.
- **Token revocation**: passenger revokes link → /track returns 403 with same URL.
- **HMAC tamper**: flip one byte → 403.
- **Public /track rate limit**: 100 hits/min/IP returns 429.
- **WS unauth**: connect to /track with bad token → server disconnects.
- **Trip stale watchdog**: driver starts but never arrives; advance fake clock; alert fires.
- **No-show**: driver `arrived`, waits 16 min, calls no-show; booking NO_SHOW, no refund.
- **Fraud teleport**: spoof a 500 km/h jump; ping rejected; fraud flag recorded; if pattern continues, fraudScore > 0.6 → review.

### 15.3 E2E (Playwright with Maps mocked)

- `track-link.spec.ts`: open SMS link → page loads → marker present → simulate 5 pings via test API endpoint → marker moves.
- `sos.spec.ts`: hold SOS button 2s → confirmation → SystemAlert visible in admin tray within 5s.
- `driver-flow.spec.ts`: driver clicks Start → Arrived → Begin → Complete; assert booking status pill updates on customer side too.
- `share-link.spec.ts`: family member (incognito) opens same link → sees the same live data.
- `expired-link.spec.ts`: token expired → page shows a friendly "Trip ended" view with summary.

### 15.4 Load test (k6 + ws library)

- 200 simultaneous trips, each with one driver ping every 5s and 2 passenger listeners.
- Targets: p95 WS broadcast latency < 500ms, server CPU < 70% on single CX32, no message drops.

### 15.5 Acceptance criteria

- [ ] All unit + integration + E2E + load thresholds green.
- [ ] Real-device test on staging: an Android Chrome driver streams to a real passenger on iOS Safari for a 30-minute drive; gaps logged but pings flow and marker moves smoothly.
- [ ] HMAC tracking link rejected when tampered, revoked, or expired.
- [ ] SOS lands in admin tray + Slack + email within 5s.
- [ ] Trip with simulated teleport flagged `PENDING_REVIEW`.
- [ ] ETA budget kill-switch tested: when daily cap exceeded, ETAs switch to "approx" without errors.
- [ ] No driver PII (battery, accuracy, raw IP) leaks to passenger/track namespaces.
- [ ] 90-day TTL on ride_logs verified by inserting a doc with `ts = now − 91d` and checking it's gone after the daily TTL pass.

---

## 16. Security Checklist (Phase 5 specific)

- [ ] `/track` HMAC uses a dedicated secret (`TRACK_LINK_SECRET`), rotated quarterly.
- [ ] Tokens stored as sha256 hashes; raw tokens never written to logs or DB.
- [ ] Tracking link URL excluded from server access logs path field (logged path = `/track/[redacted]`).
- [ ] Rate limit `/track/[code]` to 100/min/IP, 1000/h/IP.
- [ ] Rate limit `/track/:code/sos` to 1/60s/booking.
- [ ] Public namespace `/track` rejects messages from clients (read-only — server emits, clients only listen). Enforced server-side.
- [ ] Driver namespace `/driver` `location:ping` requires `bookingId` to match driver's currently active booking; otherwise drop + warn.
- [ ] CSP on /track: `script-src 'self' https://maps.googleapis.com; connect-src 'self' wss://api.aerosarathi.com https://maps.googleapis.com; img-src 'self' data: https://maps.gstatic.com https://maps.googleapis.com`.
- [ ] Frame-ancestors none on /track (prevents click-jacking the SOS).
- [ ] Browser Maps API key referrer-restricted; server Directions key IP-restricted.
- [ ] `Referrer-Policy: no-referrer` on /track responses.
- [ ] No `eval`, no remote script loaders on /track.
- [ ] Admin live map only loads when route active; subscriber count visible to ops to detect leaks.
- [ ] SOS endpoint cannot be triggered without a valid HMAC token (no anonymous panic spam).

---

## 17. Observability

New metrics:
- `ws_connections{namespace}` (gauge)
- `location_pings_received_total{result}` (accepted | dropped_validation | dropped_throttle)
- `location_ping_latency_ms{stage}` (ingest, fanout)
- `eta_ticks_total{result}` (cached | computed | budget_skip | stale_loc_skip)
- `directions_api_spend_inr_daily` (gauge, computed from miss count × unit cost)
- `trips_completed_total`
- `trip_pings_per_minute{phase}` (histogram per trip phase)
- `trip_fraud_flagged_total{flag}`
- `sos_events_total{actor}`

Dashboards:
- "Tracking health" — WS connections, ping rate, drop rate, fanout latency, ETA cache hit rate, daily spend.
- "Trip QA" — fraud flag rate, gap rate, top-speed distribution, completed trips per hour.
- "SOS console" — open count, time-to-ack histogram.

Alerts:
- `ws_connections{namespace="/driver"}` drops > 30% in 5 min → page (network or auth issue).
- `location_pings_received_total{result="dropped_validation"} / total > 5%` for 15 min → warn.
- `directions_api_spend_inr_daily` > 80% of budget → warn; > 100% → page + auto-disable.
- Any `sos_events_total` increment that isn't ack'd within 2 min → page on-call ops phone.
- `trip_fraud_flagged_total` rate > 5%/day → warn (model drift or driver pool change).

---

## 18. Deployment

### 18.1 Order
1. Migration `phase5_tracking`.
2. Mongo: ensure `ride_logs` TTL index created (`db.ride_logs.createIndex({ts:1}, {expireAfterSeconds: 7776000})`).
3. Deploy `apps/algo` (no changes typically).
4. Deploy `apps/api` (API + workers — workers grow: add `aero-api-worker-4` for `eta-tick`, `trip-fraud-check`, `trip-stale-watchdog`).
5. Deploy `apps/driver`.
6. Deploy `apps/web` (adds /track route + tracking widget in My Bookings).
7. Deploy `apps/admin` (adds /live, /sos, trip replay tab).
8. Smoke test on staging: spoofer drives a route end-to-end; ops watches /live; QA opens /track link.

### 18.2 Worker layout (Hetzner)
```
aero-api            (HTTP + Socket.io main)
aero-api-worker-1   (assignment + offer-expiry)
aero-api-worker-2   (notifications)
aero-api-worker-3   (reminders + admin-alert + webhook + reconcile)
aero-api-worker-4   (eta-tick + trip-fraud-check + trip-stale-watchdog + ride-logs-archive cron)
```

### 18.3 Socket.io scaling preparation
Even though we still run one API instance, mount the Redis adapter:
```ts
import { createAdapter } from '@socket.io/redis-adapter';
io.adapter(createAdapter(pubClient, subClient));
```
Zero overhead at single-node; lets us add a second node without code changes.

### 18.4 Feature flags
- `TRACKING_ENABLED` — global kill-switch. Off → /track returns "Live tracking is temporarily unavailable" and driver app hides the Start button (fallback to assigned-driver SMS only).
- `SOS_ENABLED` — independent kill (rare maintenance).
- `FRAUD_AUTO_REVIEW` — turning off keeps detection running but does not set `reviewStatus`, useful to evaluate threshold changes safely.

### 18.5 Rollback
Set `TRACKING_ENABLED=false`. Trips continue to be assigned (Phase 4) and completed manually via admin (Phase 3 manual status transition). Migration tables are additive; no DDL rollback needed.

---

## 19. Five-Day Plan

| Day | Owner | Tasks |
|---|---|---|
| Mon | BE | Migration `phase5_tracking`. State machine extensions in `transitionBooking` for EN_ROUTE/ONGOING/COMPLETED/NO_SHOW. Trip & SosEvent & TrackToken models. Booking-active Redis key on transitions. |
| Mon | FE (driver) | `/trips/[id]/run` screen scaffold: big buttons Start/Arrived/Begin/Complete, permission primer, status banner. |
| Mon | DevOps | Mongo TTL index on `ride_logs`. Google Maps browser key with referrer restriction. Sentry release tagging. |
| Tue | BE | Location-ingest pipeline (validate→clamp→Redis→Mongo→fanout). Socket.io `/passenger` and `/track` namespaces. Track token sign/verify. Public /track snapshot + route endpoints. |
| Tue | FE (driver) | `geo.ts` watchPosition + throttle + volatile WS emit + REST fallback ping. Battery-saver detection. Page-Visibility banner. |
| Wed | BE | ETA tick worker (cached + cost-controlled). `/track/:code/sos` + driver SOS. Trip lifecycle endpoints (start/arrived/begin/complete/no-show) with all preconditions + audit. Trip-stale-watchdog. |
| Wed | FE (web) | `/track/[code]` page: map, polyline, driver marker with smooth interp, status timeline, ETA chip, SOS hold-button, share button. Offline fallback to polling. |
| Wed | FE (admin) | `/admin/live` map. `/admin/sos` console. Trip Replay tab in booking detail. |
| Thu | BE | Trip-fraud-check worker + 9 flags. `trip_summaries` writer with Douglas–Peucker. Ride-logs-archive cron (to S3 JSONL.gz). |
| Thu | FE (web) | "My Bookings" detail integrates live tracking widget when status active. SMS templates updated to include track link. |
| Thu | All | Integration tests pass (spoofer + Testcontainers). E2E with mocked Maps. Load test with k6 (200 trips). |
| Fri | All | Real-device dress rehearsal on staging — one founder drives, one watches, family member opens the share link. Hit SOS. Inspect alerts. Bug bash. Tag `v0.5.0-phase5`. Update [implementation.md](implementation.md) status. |

---

## 20. Risks (Phase 5)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| iOS Safari throttles `watchPosition` aggressively in background | High | Pings stall when driver opens nav app | Document "keep Aero tab visible" in onboarding; show passenger "Driver location may be slightly delayed" banner when last ping > 30s; native app (Phase 7) is the real fix |
| Driver phone GPS noisy in urban canyons | High | Jumpy marker, noisy fraud flags | Drop accuracy > 200m at ingest; smoothed marker interpolation; fraud thresholds tuned with 2 weeks of real data before strict enforcement |
| Google Maps cost overrun | Medium | ₹ burn | Daily budget guard with auto-fallback; referrer restriction; cache route polylines per (pickup,drop) for 24h; admin live map uses single shared session |
| WS flood DoS on /track | Low | Service degradation | Per-IP connection limit (5), per-IP rate limits, ws origin check, Cloudflare in front of WSS endpoint in prod |
| HMAC secret leaked | Low | Strangers track random rides | Quarterly rotation script; passenger "Stop sharing" revokes immediately; alerts on anomalous /track hit volume |
| False-positive fraud flags hurt drivers | Medium | Driver morale + payout disputes | Phase 5 only **flags**, doesn't auto-deduct; review queue in admin; transparent breakdown in trip-detail |
| SOS spam by jokers sharing link | Medium | Ops alert fatigue | SOS rate-limited 1/60s/booking; admin can mark "spam" and auto-revoke the share token |
| Battery drain from high-accuracy GPS | High | Drivers turn off GPS / app | 5s throttle (not 1s), volatile emit, foreground-only, fallback to 15s on data-saver, prominent battery-saving tips in driver onboarding |
| Server clock drift causes ETA / token issues | Low | Subtle bugs | NTP synced; client `ts` always normalized against server `now` at ingest; token expiry uses server time |
| Mongo storage growth | Medium | $ + slow queries | 90-day TTL on raw pings; nightly archive to S3; summaries kept forever (small) |

---

## 21. Deliverables Checklist

Code:
- [ ] Migration `phase5_tracking` applied to dev + staging.
- [ ] Mongo TTL + indexes on `ride_logs` verified.
- [ ] `apps/api` exposes /tracking, /driver/trips/*, with new workers running.
- [ ] `apps/driver` `/trips/[id]/run` screen ships with permission primer + watchPosition pipeline.
- [ ] `apps/web` `/track/[code]` page + My Bookings live widget.
- [ ] `apps/admin` /live, /sos, Trip Replay tab.
- [ ] Socket.io Redis adapter mounted.

Ops:
- [ ] Browser Maps API key created + referrer-restricted; budget alerts at 80% + 100%.
- [ ] `TRACK_LINK_SECRET` set in all envs and stored in 1Password.
- [ ] Slack channel `#aero-ops` already wired; verify SOS messages format.
- [ ] Grafana dashboards "Tracking health", "Trip QA", "SOS console" live.
- [ ] Alerts wired (WS drop, ping drop, ETA budget, SOS).
- [ ] Real-device test recorded on staging with screen recording for runbook.

Docs:
- [ ] OpenAPI + WS event catalogue updated.
- [ ] `docs/runbooks/tracking-stuck.md` (driver shows offline / no pings; checks Redis + Mongo + ws status).
- [ ] `docs/runbooks/sos-response.md` (the exact ops checklist when an SOS fires).
- [ ] `docs/qa/fraud-flags.md` describing each flag with example trip ids.
- [ ] Driver onboarding addendum: keeping Aero tab visible, battery, permissions.

---

## 22. Handoff to Phase 6

Phase 6 (intelligence layer) builds on the data Phase 5 generates. Contracts Phase 6 depends on:

- `Trip` table populated with `actualKm`, `actualMin`, `topSpeedKmh` for every COMPLETED booking → fuels driver earnings + EMI P&L.
- `ride_logs` raw pings (90d) + `trip_summaries` (forever) → fuels analytics, route optimization, route-specific surge.
- `SosEvent` + fraud flag history → safety scoring, driver review loop.
- ETA system already has a Directions cache and budget control → Phase 6 dynamic pricing reuses both.
- Public /track page + share token gives us baseline page-view analytics for Phase 6 funnel reporting.

Open items pushed to Phase 6:
- Driver earnings statements (weekly PDF + payout reconciliation).
- Dynamic pricing v1 (route × time × demand/supply ratio with cap 1.8x).
- Customer wallet (refunds + referrals balance).
- Reviews & ratings.
- In-trip chat / call masking (Exotel).
- Voice-call SOS escalation (Twilio Voice / Exotel).
- Native background GPS would belong to Phase 7 (mobile apps).

---

**End of Phase 5 document.**
