# Phase 1 — Customer Booking Flow (Weeks 1–2)

**Parent document:** [implementation.md](implementation.md)
**Phase status:** Not started
**Duration:** 2 weeks (10 working days)
**Prereq:** Phase 0 (Foundations) complete — monorepo, CI, dev DB, Vercel + Hetzner ready.

---

## 1. Phase Goal

Ship a working **quote → vehicle pick → OTP login → `PENDING` booking** flow on the customer website. No payments yet. No driver assignment yet. The output of this phase is a real booking row in Postgres, created by a real user who authenticated with a real OTP, based on a real Google-Directions-computed fare.

**Definition of "done" for Phase 1:**
> A first-time visitor to `dev.aerosarathi.com` can, in under 2 minutes, enter a Chandigarh → Delhi Airport trip, see four fare options, verify their phone via OTP, and land on a "Pending Payment" screen displaying a unique booking code stored in Postgres.

---

## 2. Scope

### In scope
- Customer-facing Next.js site (`apps/web`) with homepage, routes page, vehicles page, about, contact.
- Booking widget on homepage with pickup/drop Google Places autocomplete.
- Server-side quote computation using Google Directions API.
- Vehicle selection screen with deterministic fares from `FareRule` table.
- Phone OTP authentication via MSG91 (request + verify).
- JWT-based session (access + refresh).
- Booking creation API → `PENDING` status.
- "My Bookings" minimal page (list + detail, read-only).
- SEO: metadata, sitemap, robots.txt, Open Graph.
- Analytics events to Mongo (`booking_started`, `quote_seen`, `vehicle_selected`, `otp_requested`, `otp_verified`, `booking_created`).
- Unit + integration test coverage for fare logic, OTP flow, booking creation.

### Explicitly OUT of scope (deferred to Phase 2+)
- Razorpay / any payment integration.
- Booking confirmation emails / SMS.
- Cancellation UI or refund logic.
- Driver assignment.
- Live tracking.
- Admin panel.
- Dynamic pricing / surge.
- PDF receipts.
- Multi-language support.
- Coupons / wallet / referrals.

---

## 3. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-1.1 | first-time visitor | type "Chandigarh" and see address suggestions | I don't have to spell exact addresses |
| US-1.2 | visitor | pick a future date and time | I can pre-book for an upcoming flight |
| US-1.3 | visitor | see distance, ETA, and 4 fare options | I can compare and choose what fits my budget |
| US-1.4 | visitor | verify my phone with an OTP in <30s | I trust the platform with my booking |
| US-1.5 | logged-in user | create a pending booking | I have a confirmed slot before paying |
| US-1.6 | returning user | see my past bookings | I can re-book the same route |
| US-1.7 | platform | reject bookings with invalid data | bad data never enters the system |

---

## 4. Architecture Slice for Phase 1

```
┌──────────────────────────────────────────────────────────┐
│  Customer Web (Next.js 14, App Router)                    │
│  - Homepage with booking widget                           │
│  - /book/quote  (vehicle picker)                          │
│  - /book/confirm (OTP + create)                           │
│  - /account/bookings                                      │
└──────────────────┬───────────────────────────────────────┘
                   │  HTTPS (JSON) + Bearer JWT
                   ▼
┌──────────────────────────────────────────────────────────┐
│  API (Node 20 + Express)                                  │
│  Routers: /quotes  /auth  /bookings  /me                  │
│  Middleware: helmet · cors · pino-http · rate-limit · jwt │
└──┬───────────┬──────────────┬──────────────┬─────────────┘
   │           │              │              │
   ▼           ▼              ▼              ▼
Postgres    Redis          MongoDB        External
(Prisma)   (OTP, rate-    (analytics_     - Google Directions
           limit, JWT      events,         - Google Places
           denylist)       audit_events)   - MSG91 OTP
```

External services touched in Phase 1: **Google Places**, **Google Directions**, **MSG91**. No Razorpay, no FCM, no S3.

---

## 5. Data Model (Phase 1 subset)

Only the tables needed in Phase 1. Full schema lives in [implementation.md §6](implementation.md).

### 5.1 Prisma schema (`packages/db/prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  phone     String   @unique
  name      String?
  email     String?
  role      Role     @default(CUSTOMER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  bookings  Booking[]
  sessions  Session[]
}

enum Role { CUSTOMER ADMIN OPS DRIVER }

model Session {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshHash  String   @unique
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  revokedAt    DateTime?
  createdAt    DateTime @default(now())
  @@index([userId])
}

model OtpRequest {
  id        String   @id @default(uuid())
  phone     String
  codeHash  String                     // bcrypt hash of 6-digit code
  attempts  Int      @default(0)
  consumed  Boolean  @default(false)
  expiresAt DateTime                   // now + 5 min
  createdAt DateTime @default(now())
  @@index([phone, createdAt])
}

model Quote {
  id              String   @id @default(uuid())
  pickupAddress   String
  pickupLat       Float
  pickupLng       Float
  dropAddress     String
  dropLat         Float
  dropLng         Float
  scheduledAt     DateTime
  distanceKm      Float
  durationMin     Int
  fares           Json                  // [{ category, total, breakdown }]
  expiresAt       DateTime              // now + 15 min
  createdAt       DateTime @default(now())
  @@index([createdAt])
}

model Booking {
  id              String   @id @default(uuid())
  code            String   @unique      // AS-260530-A1B2
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  quoteId         String
  vehicleCategory VehicleCategory
  passengerName   String
  passengerPhone  String
  pickupAddress   String
  pickupLat       Float
  pickupLng       Float
  dropAddress     String
  dropLat         Float
  dropLng         Float
  scheduledAt     DateTime
  estimatedKm     Float
  estimatedMin    Int
  fareTotal       Int                   // paise
  tokenAmount     Int                   // paise (computed but not paid in Phase 1)
  balanceAmount   Int                   // paise
  status          BookingStatus @default(PENDING)
  statusHistory   BookingStatusEvent[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([userId, createdAt])
  @@index([scheduledAt, status])
}

enum VehicleCategory { HATCHBACK SEDAN SUV LUXURY }

enum BookingStatus {
  PENDING CONFIRMED DRIVER_ASSIGNED EN_ROUTE ONGOING COMPLETED CANCELLED NO_SHOW
}

model BookingStatusEvent {
  id        String   @id @default(uuid())
  bookingId String
  booking   Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  from      BookingStatus?
  to        BookingStatus
  actorId   String?
  reason    String?
  createdAt DateTime @default(now())
  @@index([bookingId, createdAt])
}

model FareRule {
  id              String   @id @default(uuid())
  category        VehicleCategory
  baseFare        Int                   // paise
  baseKm          Int                   // km included in baseFare
  perKm           Int                   // paise per km beyond baseKm
  perMin          Int                   // paise per min
  nightSurcharge  Float    @default(0)  // 0.10 = +10% between 22:00-06:00
  minFare         Int                   // paise floor
  tokenPercent    Float    @default(0.20) // 20% token by default
  effectiveFrom   DateTime
  effectiveTo     DateTime?
  @@index([category, effectiveFrom])
}
```

### 5.2 Initial migration

```bash
cd packages/db
pnpm prisma migrate dev --name phase1_init
pnpm prisma generate
```

### 5.3 Seed data (`packages/db/prisma/seed.ts`)

```ts
import { PrismaClient, VehicleCategory } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Fare rules effective from today, no end date
  const now = new Date();
  const rules: Array<{ category: VehicleCategory; baseFare: number; baseKm: number; perKm: number; perMin: number; minFare: number; }> = [
    { category: 'HATCHBACK', baseFare: 80_000,  baseKm: 10, perKm: 1_400, perMin: 200, minFare: 80_000 },   // ₹800
    { category: 'SEDAN',     baseFare: 100_000, baseKm: 10, perKm: 1_700, perMin: 250, minFare: 100_000 },  // ₹1000
    { category: 'SUV',       baseFare: 140_000, baseKm: 10, perKm: 2_200, perMin: 300, minFare: 140_000 },  // ₹1400
    { category: 'LUXURY',    baseFare: 250_000, baseKm: 10, perKm: 3_500, perMin: 400, minFare: 250_000 },  // ₹2500
  ];
  for (const r of rules) {
    await prisma.fareRule.create({
      data: { ...r, nightSurcharge: 0.10, tokenPercent: 0.20, effectiveFrom: now },
    });
  }
  console.log('Seeded', rules.length, 'fare rules');
}

main().finally(() => prisma.$disconnect());
```

Run with `pnpm --filter @aero/db seed`.

---

## 6. API Specification

Base URL: `https://api-dev.aerosarathi.com/api/v1` (dev).
All responses are JSON. Errors follow [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) shape:

```json
{ "type": "about:blank", "title": "ValidationError", "status": 400, "detail": "pickup is required", "errors": [...] }
```

### 6.1 `POST /quotes`

**Auth:** none.
**Rate limit:** 30/min/IP.

Request:
```json
{
  "pickup":  { "address": "Sector 17, Chandigarh", "lat": 30.7410, "lng": 76.7822, "placeId": "ChIJ..." },
  "drop":    { "address": "IGI Airport T3, Delhi",  "lat": 28.5562, "lng": 77.1000, "placeId": "ChIJ..." },
  "scheduledAt": "2026-06-15T05:00:00.000Z"
}
```

Response 200:
```json
{
  "quoteId": "9f2c...",
  "distanceKm": 252.4,
  "durationMin": 246,
  "expiresAt": "2026-05-29T18:15:00.000Z",
  "fares": [
    { "category": "HATCHBACK", "total": 459800, "tokenAmount": 91960, "balanceAmount": 367840, "breakdown": {...} },
    { "category": "SEDAN",     "total": 530500, "tokenAmount": 106100,"balanceAmount": 424400, "breakdown": {...} },
    { "category": "SUV",       "total": 678100, "tokenAmount": 135620,"balanceAmount": 542480, "breakdown": {...} },
    { "category": "LUXURY",    "total": 1097400,"tokenAmount": 219480,"balanceAmount": 877920, "breakdown": {...} }
  ]
}
```

All amounts are **paise** (integer). Frontend divides by 100 for display.

**Server steps:**
1. Validate input with Zod (see §7.1).
2. Reject `scheduledAt` < `now + 2h` (configurable `MIN_LEAD_TIME_MIN`).
3. Reject `scheduledAt` > `now + 90 days`.
4. Cache key: `directions:{pickupRounded}:{dropRounded}` (round lat/lng to 3 decimals = ~110m). TTL 1h in Redis.
5. On cache miss, call Google Directions API with `mode=driving`, `departure_time=scheduledAt` (only future timestamps allowed by Google), `traffic_model=best_guess`.
6. Compute fare per category using `FareLogic.computeFare()` (§9.1).
7. Insert `Quote` row, return `quoteId` + fares.

### 6.2 `POST /auth/otp/request`

**Auth:** none.
**Rate limit:** **strict** — 3 requests per phone per 10 min, 10 requests per IP per hour, 30 per IP per day. Backed by Redis counters with sliding window.

Request: `{ "phone": "+919876543210" }`

Response 200: `{ "otpId": "uuid", "expiresInSec": 300, "channel": "sms" }`

**Server steps:**
1. Validate E.164 phone (`+91` only in Phase 1).
2. Check rate-limit keys: `otp:rate:phone:{phone}` and `otp:rate:ip:{ip}`. Reject 429 if exceeded.
3. Invalidate any prior unconsumed `OtpRequest` rows for this phone (`consumed = true`).
4. Generate 6-digit numeric code with `crypto.randomInt(100000, 1000000)`.
5. `codeHash = bcrypt.hash(code, 10)`.
6. Insert `OtpRequest` with `expiresAt = now + 5min`.
7. Call MSG91 Send OTP API (DLT-approved template) — **never log the code**.
8. On MSG91 failure: log error, return 502; do not retry inside the request (let user retry).

### 6.3 `POST /auth/otp/verify`

**Auth:** none.

Request: `{ "phone": "+919876543210", "code": "482917" }`

Response 200:
```json
{
  "accessToken": "eyJ...",      // 15 min
  "refreshToken": "rk_...",     // 30 day, opaque
  "user": { "id": "uuid", "phone": "+91...", "name": null }
}
```

**Server steps:**
1. Find latest non-consumed `OtpRequest` for phone where `expiresAt > now`.
2. If none → 401 `OTP_EXPIRED_OR_MISSING`.
3. If `attempts >= 5` → 429 `OTP_LOCKED`, invalidate.
4. `bcrypt.compare(code, row.codeHash)`. On mismatch → increment attempts, return 401.
5. On match → `consumed = true`. Upsert `User` by phone. Issue tokens.
6. `accessToken` = JWT (HS256), payload `{ sub: userId, role, jti }`, exp 15min.
7. `refreshToken` = `rk_` + 32 random bytes (base64url). Store `bcrypt(refreshToken)` in `Session.refreshHash` with `expiresAt = now + 30d`.

### 6.4 `POST /auth/refresh`

Request: `{ "refreshToken": "rk_..." }` → same shape as verify. Rotates refresh token (old one revoked).

### 6.5 `POST /auth/logout`

**Auth:** Bearer. Body: `{ "refreshToken": "rk_..." }`. Revokes session and adds JWT `jti` to Redis denylist with TTL = remaining JWT lifetime.

### 6.6 `POST /bookings`

**Auth:** Bearer (CUSTOMER).
**Idempotency:** `Idempotency-Key` header required. Server stores `{key → bookingId}` in Redis for 24h; duplicate requests within window return the original booking.

Request:
```json
{
  "quoteId": "9f2c...",
  "vehicleCategory": "SEDAN",
  "passengerName": "Aman Singh",
  "passengerPhone": "+919876543210"
}
```

Response 201:
```json
{
  "id": "uuid",
  "code": "AS-260530-A1B2",
  "status": "PENDING",
  "scheduledAt": "...",
  "fareTotal": 530500,
  "tokenAmount": 106100,
  "balanceAmount": 424400,
  "vehicleCategory": "SEDAN",
  "pickupAddress": "...",
  "dropAddress": "...",
  "createdAt": "..."
}
```

**Server steps:**
1. Load quote by id. Reject if `expiresAt < now` (`QUOTE_EXPIRED`).
2. Validate `vehicleCategory` exists in quote.fares.
3. Generate code: `AS-` + `yyMMdd` + `-` + 4-char base32 random.
4. Transaction:
   - Insert `Booking` (status PENDING).
   - Insert `BookingStatusEvent` `null → PENDING`.
5. Emit analytics event `booking_created` to Mongo.
6. Return booking.

### 6.7 `GET /bookings/:id`

**Auth:** Bearer. 404 if not owned by `req.user.id` (do not leak existence).

### 6.8 `GET /me/bookings`

Query: `?status=PENDING&limit=20&cursor=...`. Cursor pagination by `createdAt desc`. Returns max 50.

### 6.9 `GET /me`

Returns current user profile.

### 6.10 OpenAPI

Generate `apps/api/openapi.yaml` from Zod schemas using `zod-to-openapi`. Served at `GET /api/v1/docs` (Swagger UI) in dev/staging only.

---

## 7. Backend Implementation (`apps/api`)

### 7.1 Tech & layout

```
apps/api/
├── src/
│   ├── index.ts                  # Express bootstrap
│   ├── env.ts                    # Zod-validated env
│   ├── logger.ts                 # Pino instance
│   ├── prisma.ts                 # singleton PrismaClient
│   ├── redis.ts                  # singleton ioredis
│   ├── mongo.ts                  # MongoClient
│   ├── middleware/
│   │   ├── auth.ts               # JWT verify + denylist check
│   │   ├── error.ts              # central error handler → RFC7807
│   │   ├── rate-limit.ts         # rate-limiter-flexible wrappers
│   │   ├── idempotency.ts
│   │   └── request-id.ts
│   ├── modules/
│   │   ├── quotes/
│   │   │   ├── quotes.router.ts
│   │   │   ├── quotes.service.ts
│   │   │   ├── quotes.schema.ts  # Zod
│   │   │   └── fare.ts           # pure fare math
│   │   ├── auth/
│   │   │   ├── auth.router.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── otp.service.ts
│   │   │   └── tokens.ts
│   │   ├── bookings/
│   │   │   ├── bookings.router.ts
│   │   │   ├── bookings.service.ts
│   │   │   └── code.ts           # AS-yyMMdd-XXXX generator
│   │   └── me/
│   │       └── me.router.ts
│   ├── integrations/
│   │   ├── google-directions.ts
│   │   └── msg91.ts
│   ├── analytics/
│   │   └── events.ts             # writeEvent(name, payload)
│   └── types.ts                  # Express Request augmentation
├── test/
│   ├── unit/
│   │   ├── fare.spec.ts
│   │   ├── code.spec.ts
│   │   └── otp.spec.ts
│   └── integration/
│       ├── quote.flow.spec.ts
│       ├── otp.flow.spec.ts
│       └── booking.flow.spec.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 7.2 Environment variables (`apps/api/.env.example`)

```ini
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
DATABASE_URL=postgresql://aero:aero@localhost:5432/aero
REDIS_URL=redis://localhost:6379
MONGO_URL=mongodb://localhost:27017/aero_logs

# JWT
JWT_SECRET=change-me-min-32-chars
JWT_ACCESS_TTL=900           # 15 min (seconds)
JWT_REFRESH_TTL=2592000      # 30 days

# Google Maps (server key, never expose to browser)
GOOGLE_MAPS_API_KEY=
GOOGLE_DIRECTIONS_CACHE_TTL=3600

# MSG91
MSG91_AUTH_KEY=
MSG91_OTP_TEMPLATE_ID=
MSG91_SENDER_ID=AEROSR

# Quote / booking rules
MIN_LEAD_TIME_MIN=120
MAX_LEAD_TIME_DAYS=90
QUOTE_TTL_MIN=15

# CORS
CORS_ORIGINS=http://localhost:3000,https://dev.aerosarathi.com
```

`env.ts` validates via Zod and **fails fast** on boot if any required var is missing or malformed.

### 7.3 Express bootstrap (`src/index.ts`)

```ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './env';
import { logger } from './logger';
import { requestId } from './middleware/request-id';
import { errorHandler } from './middleware/error';
import { quotesRouter } from './modules/quotes/quotes.router';
import { authRouter } from './modules/auth/auth.router';
import { bookingsRouter } from './modules/bookings/bookings.router';
import { meRouter } from './modules/me/me.router';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(requestId);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS, credentials: false }));
app.use(express.json({ limit: '32kb' }));
app.use(pinoHttp({ logger, customProps: (req) => ({ reqId: req.id }) }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1/quotes', quotesRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/me', meRouter);

app.use(errorHandler);

app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api up'));
```

### 7.4 Fare math (`modules/quotes/fare.ts`)

Pure functions. Zero IO. Easy to unit-test.

```ts
export interface FareInput {
  distanceKm: number;
  durationMin: number;
  scheduledAt: Date;
  rule: {
    baseFare: number; baseKm: number; perKm: number; perMin: number;
    nightSurcharge: number; minFare: number; tokenPercent: number;
  };
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  nightSurcharge: number;
  subtotal: number;
  total: number;
  tokenAmount: number;
  balanceAmount: number;
}

export function computeFare(input: FareInput): FareBreakdown {
  const { distanceKm, durationMin, scheduledAt, rule } = input;

  const base = rule.baseFare;
  const extraKm = Math.max(0, distanceKm - rule.baseKm);
  const distance = Math.round(extraKm * rule.perKm);
  const time = Math.round(durationMin * rule.perMin);

  const subtotalBeforeSurcharge = base + distance + time;

  const hour = scheduledAt.getUTCHours(); // store rule in UTC offset-aware later
  const isNight = hour >= 22 || hour < 6;
  const nightSurcharge = isNight
    ? Math.round(subtotalBeforeSurcharge * rule.nightSurcharge)
    : 0;

  const subtotal = subtotalBeforeSurcharge + nightSurcharge;
  const total = Math.max(subtotal, rule.minFare);

  const tokenAmount = Math.round(total * rule.tokenPercent);
  const balanceAmount = total - tokenAmount;

  return { base, distance, time, nightSurcharge, subtotal, total, tokenAmount, balanceAmount };
}
```

### 7.5 Google Directions integration (`integrations/google-directions.ts`)

```ts
import { env } from '../env';
import { redis } from '../redis';
import { logger } from '../logger';

interface DirectionsResult { distanceKm: number; durationMin: number; }

function roundCoord(n: number) { return Math.round(n * 1000) / 1000; }

export async function getDirections(
  pickup: { lat: number; lng: number },
  drop: { lat: number; lng: number },
  departureAt: Date,
): Promise<DirectionsResult> {
  const key = `dir:${roundCoord(pickup.lat)},${roundCoord(pickup.lng)}:${roundCoord(drop.lat)},${roundCoord(drop.lng)}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${pickup.lat},${pickup.lng}`);
  url.searchParams.set('destination', `${drop.lat},${drop.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('departure_time', String(Math.max(Math.floor(departureAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 60)));
  url.searchParams.set('traffic_model', 'best_guess');
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`directions_http_${res.status}`);
  const data: any = await res.json();
  if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
    logger.warn({ status: data.status }, 'directions_failed');
    throw new Error(`directions_${data.status}`);
  }
  const leg = data.routes[0].legs[0];
  const result: DirectionsResult = {
    distanceKm: leg.distance.value / 1000,
    durationMin: Math.round((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
  };
  await redis.set(key, JSON.stringify(result), 'EX', env.GOOGLE_DIRECTIONS_CACHE_TTL);
  return result;
}
```

### 7.6 MSG91 integration (`integrations/msg91.ts`)

```ts
import { env } from '../env';
import { logger } from '../logger';

export async function sendOtp(phone: string, code: string): Promise<void> {
  // phone must be E.164 without '+' for MSG91 (e.g. 919876543210)
  const mobile = phone.replace(/^\+/, '');
  const url = `https://control.msg91.com/api/v5/otp?template_id=${env.MSG91_OTP_TEMPLATE_ID}&mobile=${mobile}&otp=${code}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, 'msg91_send_failed');
    throw new Error('otp_send_failed');
  }
}
```

### 7.7 Booking code generator (`modules/bookings/code.ts`)

```ts
import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function generateBookingCode(now = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const bytes = randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `AS-${yy}${mm}${dd}-${suffix}`;
}
```

Collision handling: `bookings.service.ts` retries up to 3 times on Postgres unique violation (`P2002`).

### 7.8 JWT + sessions (`modules/auth/tokens.ts`)

- Library: `jose` (modern, supports HS256/RS256).
- Access token claims: `{ sub, role, jti, iat, exp }`.
- Denylist: on logout, `SET jwt:denylist:{jti} 1 EX <remaining>`.
- Refresh token: opaque random 32 bytes, base64url, stored hashed.
- Rotation: every refresh creates new session row, marks old `revokedAt = now`. Reuse detection → revoke all sessions for user.

### 7.9 Error handling

Custom `AppError(code, status, detail)` thrown everywhere. Central middleware maps to RFC7807. Zod errors → 400 with `errors[]`. Prisma `P2002` → 409. Anything else → 500, **and** logged with full stack, but response is generic to avoid leakage.

---

## 8. Frontend Implementation (`apps/web`)

### 8.1 Layout

```
apps/web/
├── app/
│   ├── layout.tsx                # root layout: header, footer, providers
│   ├── page.tsx                  # homepage (hero + booking widget)
│   ├── routes/page.tsx
│   ├── vehicles/page.tsx
│   ├── about/page.tsx
│   ├── contact/page.tsx
│   ├── book/
│   │   ├── quote/page.tsx        # vehicle picker (uses quoteId from URL)
│   │   └── confirm/page.tsx      # OTP + create booking
│   ├── account/
│   │   ├── layout.tsx            # auth-gated
│   │   └── bookings/
│   │       ├── page.tsx
│   │       └── [id]/page.tsx
│   ├── api/                      # Next route handlers (BFF proxy if needed)
│   │   └── places/route.ts       # proxies Places Autocomplete to hide key
│   ├── sitemap.ts
│   └── robots.ts
├── components/
│   ├── BookingWidget/
│   │   ├── BookingWidget.tsx
│   │   ├── PlaceInput.tsx
│   │   ├── DateTimeInput.tsx
│   │   └── VehicleQuickPick.tsx
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── OtpModal.tsx
│   └── ...
├── lib/
│   ├── api.ts                    # uses @aero/sdk
│   ├── store/
│   │   └── booking.ts            # Zustand
│   ├── auth.ts                   # client-side token storage + refresh
│   └── analytics.ts              # fires events to API
├── styles/globals.css
├── tailwind.config.ts
├── next.config.mjs
└── package.json
```

### 8.2 Design system

Port the existing `aero-sarathi-homepage.html` design tokens into `tailwind.config.ts`:

```ts
export default {
  theme: {
    extend: {
      colors: {
        orange: { DEFAULT: '#F48024', dark: '#d96a10', light: '#fef0e3' },
        navy: { DEFAULT: '#1E2D5A', dark: '#131d3d', mid: '#2d4178' },
      },
      fontFamily: {
        display: ['Rajdhani', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
      },
    },
  },
};
```

Use the existing HTML as the visual reference for the homepage components. Convert each `<section>` into a typed React component in `components/home/`.

### 8.3 Booking state (Zustand, persisted)

```ts
// lib/store/booking.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Place { address: string; lat: number; lng: number; placeId: string; }

interface BookingDraft {
  pickup: Place | null;
  drop: Place | null;
  scheduledAt: string | null;       // ISO
  quoteId: string | null;
  quote: QuoteResponse | null;
  vehicleCategory: 'HATCHBACK' | 'SEDAN' | 'SUV' | 'LUXURY' | null;
  setPickup: (p: Place) => void;
  setDrop: (p: Place) => void;
  setScheduledAt: (s: string) => void;
  setQuote: (q: QuoteResponse) => void;
  selectVehicle: (c: BookingDraft['vehicleCategory']) => void;
  reset: () => void;
}

export const useBooking = create<BookingDraft>()(persist((set) => ({
  pickup: null, drop: null, scheduledAt: null, quoteId: null, quote: null, vehicleCategory: null,
  setPickup: (pickup) => set({ pickup }),
  setDrop: (drop) => set({ drop }),
  setScheduledAt: (scheduledAt) => set({ scheduledAt }),
  setQuote: (quote) => set({ quote, quoteId: quote.quoteId }),
  selectVehicle: (vehicleCategory) => set({ vehicleCategory }),
  reset: () => set({ pickup: null, drop: null, scheduledAt: null, quoteId: null, quote: null, vehicleCategory: null }),
}), { name: 'aero-booking-draft', version: 1 }));
```

### 8.4 Google Places autocomplete (server-proxied)

**Why proxied:** to keep the Places API key server-side and apply our own session-token logic + rate limit.

`app/api/places/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  const session = req.nextUrl.searchParams.get('session');
  if (!q || q.length < 2) return NextResponse.json({ predictions: [] });
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', q);
  url.searchParams.set('components', 'country:in');
  url.searchParams.set('sessiontoken', session ?? '');
  url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY!);
  const r = await fetch(url, { next: { revalidate: 0 } });
  const data = await r.json();
  return NextResponse.json({
    predictions: (data.predictions ?? []).map((p: any) => ({
      placeId: p.place_id, description: p.description, main: p.structured_formatting?.main_text,
    })),
  });
}
```

And a `/api/places/details` route for `place_id → lat/lng`. Always pass the same `sessiontoken` from first keystroke until selection (lower billing).

### 8.5 OTP modal flow

`OtpModal` component:
1. Step 1: phone input → `POST /auth/otp/request` → on success, move to step 2 with a 30s resend cooldown.
2. Step 2: 6-digit input (auto-advance per box, paste-aware) → `POST /auth/otp/verify`.
3. On success: store tokens (access in memory + cookie `__Host-aero_at` httpOnly secure samesite=strict; refresh in httpOnly cookie). Resolve modal promise with user.
4. Error states: invalid code (shake + counter), expired (offer resend), locked (5 wrong attempts → 1h cooldown shown).

**Token storage decision:** Use **httpOnly cookies** for both access and refresh tokens (set by a Next route handler `/api/auth/exchange` that proxies to API). Client never sees raw tokens → XSS-resistant. CSRF mitigated by samesite=strict + same-origin.

### 8.6 Pages

- **`/` (homepage)** — port from `aero-sarathi-homepage.html`. Booking widget submits → POST `/quotes` → router pushes `/book/quote?id=...`.
- **`/book/quote`** — fetch quote by id (TanStack Query). Show 4 vehicle cards with fare. On select → if not authed, open OTP modal → on success, POST `/bookings` → redirect `/book/confirm/:code`.
- **`/book/confirm/[code]`** — shows "Pending Payment" with booking code, summary, and a placeholder "Pay now" button disabled (`Phase 2`).
- **`/account/bookings`** — auth-gated layout (redirect to `/` with toast if no session). List with status pill.
- **`/account/bookings/[id]`** — read-only detail with full status timeline.

### 8.7 SEO

- `app/sitemap.ts` enumerates static routes + top 10 city pairs (`/routes/chandigarh-to-delhi-airport`).
- `app/robots.ts` allows all, points to sitemap, disallows `/account/*` and `/book/*`.
- Per-page `generateMetadata()` with `title`, `description`, `openGraph`, `twitter` cards.
- JSON-LD `Organization` + `LocalBusiness` on homepage.

### 8.8 Analytics

`lib/analytics.ts` posts to `POST /api/v1/analytics/events` (fire-and-forget, beacon API on unload). Events:
- `page_view` (every route change)
- `booking_started` (first widget interaction)
- `quote_seen` (vehicles screen rendered)
- `vehicle_selected`
- `otp_requested`, `otp_verified`, `otp_failed`
- `booking_created`

---

## 9. External Service Setup

### 9.1 Google Cloud
1. Create project `aero-sarathi-dev`.
2. Enable **Maps JavaScript API**, **Places API**, **Directions API**.
3. Create two API keys:
   - **Browser key** — referrer restricted to `*.aerosarathi.com`, `localhost:3000`. Only Maps JavaScript API allowed.
   - **Server key** — IP-restricted to Hetzner API server + Vercel egress (or use unrestricted in dev with budget alerts). Allowed: Places, Directions.
4. Set budget alert at ₹5,000 / month with email + Slack notification.
5. Repeat for `aero-sarathi-prod`.

### 9.2 MSG91
1. Sign up, complete KYC (PAN, GST).
2. Register DLT (Distributed Ledger Technology) entity on Jio / Vodafone DLT portal.
3. Register sender ID `AEROSR` (or similar, 6 chars).
4. Register OTP template: `Your Aero Sarathi OTP is {{otp}}. Valid for 5 minutes. Do not share.` (must match the registered DLT template id exactly, including variable count).
5. Generate Auth Key → store in 1Password → load into Hetzner env.

### 9.3 Sentry
- Two projects: `aero-web` (Next.js), `aero-api` (Node).
- DSNs in env vars per env.
- Source maps uploaded by Vercel build / GitHub Actions.

---

## 10. Local Development

### 10.1 docker-compose.dev.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: aero
      POSTGRES_PASSWORD: aero
      POSTGRES_DB: aero
    ports: ["5432:5432"]
    volumes: [pg:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: [mongo:/data/db]
volumes:
  pg: {}
  mongo: {}
```

### 10.2 First-time setup

```powershell
git clone <repo> aero-sarathi
cd aero-sarathi
pnpm install
docker compose -f infra/compose/docker-compose.dev.yml up -d
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
pnpm --filter @aero/db prisma migrate dev
pnpm --filter @aero/db seed
pnpm dev   # boots web (3000) + api (4000)
```

### 10.3 Useful scripts (root `package.json`)

```json
{
  "scripts": {
    "dev":        "turbo run dev --parallel",
    "build":      "turbo run build",
    "lint":       "turbo run lint",
    "typecheck":  "turbo run typecheck",
    "test":       "turbo run test",
    "test:e2e":   "pnpm --filter @aero/web exec playwright test",
    "db:migrate": "pnpm --filter @aero/db prisma migrate dev",
    "db:reset":   "pnpm --filter @aero/db prisma migrate reset --force"
  }
}
```

---

## 11. Testing Plan

### 11.1 Unit tests (Vitest)

| Spec | Cases ≥ |
|---|---|
| `fare.spec.ts` | 12 — base only, base + extra km, night surcharge, min fare floor, all 4 categories, token split |
| `code.spec.ts` | 4 — format, no ambiguous chars, length, uniqueness on 10k samples |
| `otp.spec.ts` | 6 — hash/verify, expired, attempts > 5, consumed, rate limit, invalid phone |
| `tokens.spec.ts` | 5 — sign+verify, expired, bad sig, denylist, refresh rotation |

### 11.2 Integration tests (Supertest + Testcontainers Postgres + ioredis-mock)

- `quote.flow`: POST /quotes with mocked Directions → quote row in DB, all 4 fares present, expiresAt set.
- `otp.flow`: request → verify happy path; verify with wrong code; rate-limit enforcement after 3 requests.
- `booking.flow`: full chain — quote → otp → booking with idempotency-key; duplicate idempotency-key returns same booking; expired quote → 410.

### 11.3 E2E (Playwright, runs on dev URL nightly)

- `book-happy.spec.ts`: visit homepage → fill pickup/drop (mock Places via intercept) → click Book → vehicles screen → pick SEDAN → OTP modal → mock OTP (test phone `+919999999999` returns code `123456` in dev env via `MSG91_BYPASS` flag) → see Pending Payment screen with `AS-` code visible.
- `auth-required.spec.ts`: clicking Book without auth opens OTP modal, NOT a redirect.
- `quote-expired.spec.ts`: stale quoteId → friendly error + reset flow.

### 11.4 Acceptance criteria (must all pass before merging Phase 1)

- [ ] All unit + integration tests green in CI.
- [ ] E2E happy path passes on `dev.aerosarathi.com`.
- [ ] Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95, SEO 100.
- [ ] Fare computation matches the formula spec for 10+ hand-calculated scenarios (in `docs/qa/fare-cases.md`).
- [ ] OTP rate limit verified by manual test: 4th request within 10 min returns 429.
- [ ] Booking row visible in Postgres after E2E run.
- [ ] No `console.log` / `console.error` of phone or OTP code in logs (grep CI check).
- [ ] No new Sentry errors after 24h of dev usage.

---

## 12. Security Checklist (Phase 1 specific)

- [ ] All API endpoints under HTTPS only (Caddy redirects in prod; Vercel handles web).
- [ ] CORS allowlist enforced — no `*`.
- [ ] Helmet enabled on API; CSP on web (`script-src 'self' https://maps.googleapis.com`).
- [ ] OTP rate limits enforced server-side: 3/phone/10min, 10/IP/hour, 30/IP/day.
- [ ] OTP codes hashed with bcrypt (cost 10), never logged, never returned in API responses.
- [ ] JWT secret ≥ 32 chars, loaded from env, distinct per environment.
- [ ] Refresh tokens stored hashed, rotation enforced, reuse triggers session-family revocation.
- [ ] Tokens stored in httpOnly + secure + samesite=strict cookies. No `localStorage`.
- [ ] Idempotency-Key required for POST /bookings; missing → 400.
- [ ] Google Maps server key IP-restricted; browser key referrer-restricted.
- [ ] No PII in logs (phone partially masked: `+91XXXXX1234`).
- [ ] Dependabot enabled; `pnpm audit --prod` is a CI step (non-blocking warn for now).
- [ ] Postgres user has only `aero` schema permissions, not superuser.

---

## 13. Observability (Phase 1)

- **Logs:** Pino JSON to stdout. Fields: `ts`, `level`, `reqId`, `userId?`, `route`, `latencyMs`, `status`. Shipped to Better Stack from Hetzner.
- **Metrics:** Prometheus client exposes `/metrics`:
  - `http_requests_total{route,method,status}`
  - `http_request_duration_seconds_bucket`
  - `quotes_created_total`
  - `bookings_created_total`
  - `otp_requests_total{result}`
  - `directions_cache_hits_total` / `_misses_total`
- **Sentry:** all unhandled errors + manual `Sentry.captureException` in catch blocks of integrations.
- **Dashboard** (Grafana): bookings/day, OTP success rate, quote-to-booking funnel, Directions API daily spend (computed from cache miss count × ₹ rate).

---

## 14. Deployment (Phase 1)

### 14.1 Web (`apps/web`)
- Vercel project linked to repo, root directory `apps/web`, ignored build step `git diff --quiet HEAD^ HEAD -- apps/web packages/`.
- Branch `develop` → `dev.aerosarathi.com`.
- Branch `main` → `aerosarathi.com` (still gated by manual promotion in Phase 1 since no prod traffic yet).
- Env vars set per environment in Vercel dashboard.

### 14.2 API (`apps/api`)
- GitHub Actions on push to `develop`:
  1. `pnpm install`, `pnpm test`, `pnpm build`.
  2. `docker build -f infra/docker/api.Dockerfile -t ghcr.io/<org>/aero-api:${{sha}} .`
  3. `docker push`.
  4. SSH to Hetzner: `docker pull`, run migrations (`docker run --rm aero-api migrate`), restart service via `systemctl restart aero-api`. Caddy in front handles TLS + proxy.
- Single VM (CX22) is fine for Phase 1. Horizontal scale begins Phase 4.

### 14.3 Rollback
`git revert <sha> && git push` triggers re-deploy. For API, also possible via `docker pull ghcr.io/.../aero-api:<previous-sha> && systemctl restart aero-api`.

---

## 15. Two-Week Day-by-Day Plan

### Week 1
| Day | Owner | Tasks |
|---|---|---|
| Mon | BE | `apps/api` scaffold, env validation, Pino, error middleware, healthcheck. Prisma schema + first migration. Seed fare rules. |
| Mon | FE | `apps/web` scaffold, Tailwind tokens, port homepage HTML → React components (Header, Hero, Routes, Vehicles, Why, Testimonials, Footer). |
| Tue | BE | Google Directions integration + Redis cache. `POST /quotes` with Zod validation. Unit tests for `fare.ts`. |
| Tue | FE | Booking widget component, Place autocomplete via `/api/places` BFF proxy, Zustand store. |
| Wed | BE | MSG91 integration. `OtpRequest` model. `POST /auth/otp/request` + `/verify` + rate limits. JWT issuance. |
| Wed | FE | `/book/quote` page with vehicle cards bound to quote response. |
| Thu | BE | `POST /bookings` with idempotency, code generator, status events. `GET /bookings/:id`, `GET /me/bookings`. |
| Thu | FE | OTP modal component. Cookie-based auth via `/api/auth/exchange` Next route. |
| Fri | Both | Integration tests pass. Wire `/book/confirm/[code]` page. End-to-end manual test on `localhost`. Fix bugs. |

### Week 2
| Day | Owner | Tasks |
|---|---|---|
| Mon | FE | `/account/bookings` list + detail. Auth-gated layout. Toast / loading states. |
| Mon | BE | Analytics events endpoint + Mongo writer. Prometheus metrics. |
| Tue | FE | SEO: sitemap, robots, metadata per route, JSON-LD. Lighthouse pass → fix biggest 3 issues. |
| Tue | BE | OpenAPI generation from Zod, Swagger UI at `/docs`. Security headers review. |
| Wed | Both | Playwright E2E setup. Write happy-path spec. Wire `MSG91_BYPASS` for test env. |
| Wed | DevOps | GitHub Actions CI: lint, typecheck, test, build, deploy `develop` → Hetzner + Vercel. |
| Thu | All | QA day on `dev.aerosarathi.com`. Manual run-through of all acceptance criteria. Bug bash. |
| Fri | All | Fix remaining bugs. Demo to stakeholders. Tag `v0.1.0-phase1`. Update [implementation.md](implementation.md) status. |

---

## 16. Risks (Phase 1)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MSG91 DLT template approval delayed | Medium | Blocks OTP | Apply for template Day 1; have `MSG91_BYPASS=true` dev mode with fixed code `123456` for `+919999999999` |
| Google Directions returns ZERO_RESULTS for rural Punjab points | Low | Bad UX | Friendly error + fallback to straight-line distance × 1.3 estimate, flagged "approximate" |
| Quote/fare changes between vehicle-pick and booking-create | Low | User confusion | Quote frozen on creation; never recomputed in `POST /bookings` |
| Phone number reuse / SIM swap fraud | Medium | Account hijack | Limit to 3 device sessions per user; alert user on new-IP login (logged for Phase 2) |
| Vercel cold-start on `/book/quote` slow | Low | UX | Mark page `dynamic = 'force-dynamic'` only where needed; keep most pages static |
| Postgres on shared CX22 disk too slow | Low | Slow APIs | Move to managed Postgres if p95 > 500ms (Phase 6 plan); monitor from Day 1 |

---

## 17. Deliverables Checklist

Code:
- [ ] `apps/web` deployed to `dev.aerosarathi.com`.
- [ ] `apps/api` deployed to `api-dev.aerosarathi.com`.
- [ ] Prisma schema + migration `phase1_init` applied.
- [ ] Fare rules seeded for all 4 categories.
- [ ] `@aero/sdk` typed client published to workspace.

Docs:
- [ ] OpenAPI YAML in `apps/api/openapi.yaml`.
- [ ] `docs/qa/fare-cases.md` with 10+ hand-calculated scenarios.
- [ ] This file updated with actual durations and any deviations.

Ops:
- [ ] Sentry receiving errors from both `web` and `api`.
- [ ] Grafana dashboard with the metrics from §13.
- [ ] Better Stack / Loki receiving logs.
- [ ] Daily Postgres `pg_dump` to S3.

---

## 18. Handoff to Phase 2

Phase 2 starts the moment all checklists above are green. Phase 2 will add:
- Razorpay order + verify + webhooks → moves bookings `PENDING → CONFIRMED`.
- Cancellation logic + refund.
- Booking confirmation SMS + email.
- PDF receipt.

The contract from Phase 1 that Phase 2 depends on:
- `Booking.status` enum already includes `CONFIRMED`.
- `Booking.tokenAmount` and `balanceAmount` already computed and stored.
- `Payment` model will be added in Phase 2 migration (not in `phase1_init`).
- `POST /bookings` returns a booking id usable as the payment intent target.

---

**End of Phase 1 document.**
