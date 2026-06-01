# Phase 3 — Admin Panel v1 (Week 4)

**Parent document:** [implementation.md](implementation.md)
**Previous phases:** [phase1.md](phase1.md) · [phase2.md](phase2.md)
**Phase status:** Not started
**Duration:** 1 week (5 working days)
**Prereq:** Phases 1 & 2 complete — bookings can be created, paid, cancelled, and refunded by customers.

---

## 1. Phase Goal

Give the internal team (ops, finance, support) a secure web panel to run the business **manually** while we wait for Phase 4 automation. Every customer action that was automated in Phase 2 (and every future action) must be reproducible and observable from the admin panel.

**Definition of "done" for Phase 3:**
> An ops user can log into `admin-dev.aerosarathi.com` with email + password + TOTP, see today's bookings on a dashboard, drill into any booking, manually assign a driver, change a booking's status with a reason, issue a partial or full refund, onboard a new driver (with documents) and a new vehicle, update the fare rules, replay a stuck webhook, and inspect a full audit trail — all without engineering involvement.

---

## 2. Scope

### In scope
- Separate Next.js app (`apps/admin`) — not a route inside `apps/web`.
- Email + password auth with **mandatory TOTP 2FA**.
- Role-based access control: `SUPER_ADMIN`, `ADMIN`, `OPS`, `FINANCE`, `SUPPORT`.
- Dashboard with today's KPIs and alert tray.
- Bookings table (filter, sort, paginate) + detail drawer with full timeline.
- Manual driver assignment from a searchable picker.
- Manual booking status changes (with reason; routed through `transitionBooking`).
- Drivers CRUD + document uploads to S3-compatible storage (Hetzner Object Storage) with expiry tracking.
- Vehicles CRUD with optional EMI plan attachment.
- Fare rules editor (versioned, effective-dated, never deleted).
- Refunds console (full + partial, manual) using existing Razorpay refund pipe.
- Webhook inspector (list + payload + replay).
- Audit log viewer (read-only) sourced from Mongo `audit_events`.
- IP allowlist (optional) and session-idle timeout for admin sessions.
- Comprehensive RBAC enforced both in API routes and in admin UI menus.

### Explicitly OUT of scope (deferred)
- Driver assignment automation (Phase 4).
- Live tracking maps (Phase 5).
- Analytics dashboards / charts beyond KPI cards (Phase 6).
- Driver earnings statements / payouts (Phase 6).
- Coupons, wallet, referrals admin (Phase 6).
- Bulk operations beyond CSV export (Phase 6).
- Customer support inbox / WhatsApp integration.
- City / hub configuration UI (multi-city is Phase 8).

---

## 3. Personas & Roles

| Role | Who | Sees / Does |
|---|---|---|
| `SUPER_ADMIN` | Founders, CTO | Everything + user management + IP allowlist + dangerous operations (delete driver, force status, edit fare history) |
| `ADMIN` | Ops lead, finance head | Everything except SUPER_ADMIN-only items |
| `OPS` | Dispatchers | Bookings, drivers, vehicles, manual assignment, status changes; NO refund issuance, NO fare rules edit |
| `FINANCE` | Accountant | Bookings (read), payments, refunds (issue + view), reconciliation export; NO drivers/vehicles edit |
| `SUPPORT` | CX agents | Bookings (read), notifications (resend), audit (read); NO money operations |

Permission matrix below in §6.5.

---

## 4. Architecture Slice for Phase 3

```
┌─────────────────────────────────────────────────────────────┐
│  Admin Web (Next.js 14 App Router)                          │
│  /login  /2fa  /dashboard  /bookings  /drivers  /vehicles   │
│  /fare-rules  /refunds  /webhooks  /audit  /users           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS, httpOnly cookie session
                           │ + CSRF token (double-submit)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  API  (Node + Express)  /api/v1/admin/*                     │
│  - Separate auth pipeline (admin session ≠ customer JWT)    │
│  - RBAC middleware per route                                 │
│  - All mutations write to Mongo audit_events                 │
└──┬───────────┬──────────┬───────────┬─────────────┬─────────┘
   │           │          │           │             │
   ▼           ▼          ▼           ▼             ▼
Postgres   Redis      Mongo       S3 (Hetzner)  Razorpay
(Admin     (admin     (audit_     (driver       (refunds)
 User,     session,   events)     docs)
 etc.)     2FA seed,
           CSRF nonce)
```

The admin app is **physically separate** from `apps/web`:
- Different Vercel project, different domain (`admin-dev.aerosarathi.com`).
- Different cookie scope (`Domain=admin-dev.aerosarathi.com`, never `.aerosarathi.com`).
- Different CORS allowlist on the API.
- All admin endpoints under `/api/v1/admin/*` go through a dedicated middleware chain.

---

## 5. Data Model Changes

Migration name: `phase3_admin`.

### 5.1 New / changed Prisma models

```prisma
model AdminUser {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String                       // argon2id
  name          String
  role          AdminRole
  totpSecret    String?                      // base32, set on enrolment
  totpEnabled   Boolean  @default(false)
  status        AdminStatus @default(ACTIVE)
  lastLoginAt   DateTime?
  failedAttempts Int     @default(0)
  lockedUntil   DateTime?
  createdById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  sessions      AdminSession[]
  @@index([status])
}

enum AdminRole   { SUPER_ADMIN ADMIN OPS FINANCE SUPPORT }
enum AdminStatus { ACTIVE DISABLED }

model AdminSession {
  id           String   @id @default(uuid())
  userId       String
  user         AdminUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String   @unique             // sha256 of opaque session token
  ip           String
  userAgent    String
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  expiresAt    DateTime
  revokedAt    DateTime?
  @@index([userId])
}

model AdminInvite {
  id          String   @id @default(uuid())
  email       String   @unique
  role        AdminRole
  tokenHash   String   @unique
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())
}

model Driver {
  // ... existing fields from Phase 1/2 ...
  documents   DriverDocument[]
  notes       DriverNote[]
}

model DriverDocument {
  id          String   @id @default(uuid())
  driverId    String
  driver      Driver   @relation(fields: [driverId], references: [id], onDelete: Cascade)
  type        DocType
  fileKey     String                        // S3 key
  fileName    String
  mimeType    String
  sizeBytes   Int
  issuedAt    DateTime?
  expiresAt   DateTime?
  verified    Boolean  @default(false)
  verifiedById String?
  verifiedAt  DateTime?
  uploadedById String?
  createdAt   DateTime @default(now())
  @@index([driverId, type])
  @@index([expiresAt])
}

enum DocType { LICENSE RC INSURANCE PUC PERMIT AADHAAR PAN OTHER }

model DriverNote {
  id         String   @id @default(uuid())
  driverId   String
  driver     Driver   @relation(fields: [driverId], references: [id], onDelete: Cascade)
  authorId   String
  body       String
  createdAt  DateTime @default(now())
  @@index([driverId, createdAt])
}

model EmiPlan {
  id              String   @id @default(uuid())
  vehicleId       String   @unique
  principalAmount Int                       // paise
  monthlyEmi      Int                       // paise
  tenureMonths    Int
  startDate       DateTime
  lender          String
  loanRef         String
  notes           String?
  createdAt       DateTime @default(now())
}

model FareRule {
  // existing fields ...
  createdById   String?
  supersededBy  String?                     // id of newer rule that replaced this
  notes         String?
}
```

### 5.2 Audit events (Mongo)

Collection: `audit_events`. One document per state-changing admin action.

```json
{
  "_id": "ObjectId",
  "ts": "2026-06-01T12:34:56.000Z",
  "actor": { "id": "admin-uuid", "email": "ops@aerosarathi.com", "role": "OPS", "ip": "1.2.3.4" },
  "action": "booking.assignDriver",
  "entity": { "type": "Booking", "id": "uuid", "code": "AS-260601-A1B2" },
  "before": { "driverId": null, "status": "CONFIRMED" },
  "after":  { "driverId": "driver-uuid", "status": "DRIVER_ASSIGNED" },
  "reason": "Manually assigned per ops decision",
  "requestId": "req-uuid"
}
```

Indexes: `{ ts: -1 }`, `{ "entity.type": 1, "entity.id": 1, ts: -1 }`, `{ "actor.id": 1, ts: -1 }`, `{ action: 1, ts: -1 }`.

Retention: 18 months hot, then archived to S3 as gzip JSONL.

### 5.3 Bootstrap super admin

A one-off CLI:

```powershell
pnpm --filter @aero/api ts-node scripts/bootstrap-admin.ts --email founder@aerosarathi.com --name "Founder"
```

Prompts (stdin, masked) for password. Inserts `AdminUser` with `SUPER_ADMIN`. Outputs the TOTP enrolment URI so the operator can scan into their authenticator app. Refuses to run if any SUPER_ADMIN already exists (must be deleted via SQL — intentional friction).

---

## 6. API Specification

All routes under `/api/v1/admin`. Base middleware chain:

```
helmet → cors(adminOriginsOnly) → cookieParser → adminSession
       → csrfDoubleSubmit (mutations only) → rbac(requiredRoles)
       → idempotency (mutations) → handler → auditLogger
```

### 6.1 Auth

**`POST /admin/auth/login`** — body `{ email, password }`. Response: `{ requires2fa: true, challengeId }` if TOTP enabled (it must be). Sets temporary `__Host-admin_challenge` cookie (5 min).

**`POST /admin/auth/2fa`** — body `{ challengeId, code }`. On success:
- Creates `AdminSession` (TTL 12h absolute, 30min idle).
- Sets `__Host-admin_sid` httpOnly + secure + samesite=strict cookie.
- Sets `__Host-admin_csrf` non-httpOnly cookie (double-submit token).
- Clears challenge cookie.

**`POST /admin/auth/logout`** — revokes session.

**`POST /admin/auth/totp/enrol`** — only callable once per user. Generates a fresh base32 secret, returns otpauth URI; user must verify with a code before `totpEnabled = true`.

**`POST /admin/auth/totp/verify-enrol`** — `{ code }` → enables TOTP.

**Rate limits:**
- `/login`: 5/min/IP, 20/hour/IP, 10/email/hour.
- After 5 failed attempts within 15 min on a single email → lock for 15 min (`AdminUser.lockedUntil`).

**Argon2 params:** `argon2id`, memoryCost = 64 MB, timeCost = 3, parallelism = 1.

### 6.2 Dashboard

**`GET /admin/dashboard`** — returns:

```json
{
  "today": {
    "bookingsCount": 42,
    "revenue": 2156000,
    "cancellations": 3,
    "refundsAmount": 22500,
    "pendingAssignment": 7
  },
  "alerts": [
    { "type": "unassigned_t_minus_30", "bookingId": "...", "code": "AS-...", "scheduledAt": "..." },
    { "type": "refund_stuck", "refundId": "...", "ageHours": 51 },
    { "type": "webhook_dlq", "count": 2 },
    { "type": "doc_expiry", "driverId": "...", "type": "LICENSE", "expiresAt": "..." }
  ],
  "queueDepth": { "notifications": 3, "webhooks": 0, "assignment": 0 }
}
```

KPIs are computed live via Postgres aggregates over indexed columns; alerts are pulled from a `system_alerts` Mongo collection refreshed by background jobs.

### 6.3 Bookings

**`GET /admin/bookings`** — query params:
- `status` (multi: `?status=PENDING,CONFIRMED`)
- `from`, `to` (createdAt or scheduledAt — `dateField=scheduled|created`)
- `q` (search booking code, passenger phone, passenger name)
- `driverId`, `vehicleCategory`
- `cursor`, `limit` (max 100)

Response: paginated rows + `total` (cached, 30s).

**`GET /admin/bookings/:id`** — full detail: booking + payments + refunds + cancellation + driver + vehicle + status history + notification history.

**`POST /admin/bookings/:id/transition`** — `{ to: BookingStatus, reason: string }`. Calls `transitionBooking()`. Roles: `OPS+`. Reason required and stored.

**`POST /admin/bookings/:id/assign-driver`** — `{ driverId, reason? }`. Verifies driver `ACTIVE`, has a vehicle of compatible category, and has no overlapping `DRIVER_ASSIGNED|EN_ROUTE|ONGOING` booking within ±2h of `scheduledAt`. Then sets `driverId` + transitions to `DRIVER_ASSIGNED` + enqueues SMS notifications (reuses Phase 2 pipeline; uses placeholder template until Phase 4 templates land).

**`POST /admin/bookings/:id/unassign-driver`** — `{ reason }`. Sets `driverId = null`, transitions back to `CONFIRMED`. Roles: `OPS+`.

**`POST /admin/bookings/:id/cancel`** — admin-initiated cancellation. Body `{ reason, refundOverride?: number }`. Refund preview from `algo` is shown in UI; admin can override **only if** `SUPER_ADMIN` or `ADMIN` role, override is capped at `tokenPaid`. Audit logs both computed and final values.

**`POST /admin/bookings/:id/notes`** — `{ body }`. Internal-only note attached via a new `BookingNote` table (added in this migration).

**`POST /admin/bookings/:id/resend-notification`** — `{ template }` — re-enqueues. Roles: `OPS+`, `SUPPORT`.

**`GET /admin/bookings/export.csv`** — same filters as list, streams CSV. Roles: `FINANCE+`. Header row includes booking code, status, scheduled at, fare, token, balance, payment status, refund, driver, vehicle.

### 6.4 Drivers

**`GET /admin/drivers`** — list with filters: `status`, `city`, `q` (name, phone, license), `hasVehicle`, `docExpiringWithinDays`.

**`POST /admin/drivers`** — create. Body: `{ phone, name, licenseNo, homeCity }`. Creates `User` row with role `DRIVER` (no password — phone OTP via driver portal in Phase 4) + `Driver` row.

**`PATCH /admin/drivers/:id`** — update editable fields: `name, homeCity, status, rating?` (rating only `ADMIN+`).

**`POST /admin/drivers/:id/vehicle`** — `{ vehicleId }` assign.
**`DELETE /admin/drivers/:id/vehicle`** — unassign.

**`POST /admin/drivers/:id/documents`** — multipart upload, max 10 MB, types in `DocType`. Two-step:
1. `POST /admin/drivers/:id/documents/intent` → `{ type, fileName, mimeType, sizeBytes }` → server returns a **pre-signed S3 PUT URL** + `fileKey`.
2. Client PUTs the file directly to S3.
3. `POST /admin/drivers/:id/documents` → `{ type, fileKey, fileName, mimeType, sizeBytes, issuedAt?, expiresAt? }` — creates `DriverDocument` row.

This keeps the API server free of large-file traffic.

**`GET /admin/drivers/:id/documents/:docId/url`** — returns a 5-min pre-signed GET URL. Audit-logged.

**`POST /admin/drivers/:id/documents/:docId/verify`** — `{ verified: true }`. Roles: `OPS+`.

**`DELETE /admin/drivers/:id/documents/:docId`** — soft-delete (sets `deletedAt`), keeps S3 object for 30 days then a cron purges. Roles: `ADMIN+`.

**`POST /admin/drivers/:id/notes`** — `{ body }`.

### 6.5 Vehicles

**`GET /admin/vehicles`** — list with filters.
**`POST /admin/vehicles`** — `{ regNo, category, model, capacity, ownership, emiPlan? }`. If `ownership === 'COMPANY'` and `emiPlan` provided, creates `EmiPlan` in same transaction.
**`PATCH /admin/vehicles/:id`** — partial.
**`POST /admin/vehicles/:id/emi-plan`** / **`DELETE`** — manage finance ledger.

### 6.6 Fare rules

**`GET /admin/fare-rules`** — list, sortable by `effectiveFrom`.
**`GET /admin/fare-rules/active`** — current active rule per category.
**`POST /admin/fare-rules`** — `{ category, baseFare, baseKm, perKm, perMin, nightSurcharge, minFare, tokenPercent, effectiveFrom }`. Server marks previous active rule for that category `effectiveTo = newRule.effectiveFrom`, sets `supersededBy`. Roles: `ADMIN+` (not OPS).
**`POST /admin/fare-rules/preview`** — `{ rule, sampleTrips: [{distanceKm, durationMin, scheduledAt}] }` → returns computed fares against the candidate rule. **No DB write.** Lets ops sanity-check before activating.

Fare rules are **append-only**. No update or delete endpoint — corrections are made by inserting a new rule that supersedes.

### 6.7 Refunds (manual)

**`POST /admin/bookings/:id/refund`** — `{ paymentId, amount, reason }`. Amount in paise, ≤ remaining refundable (= `payment.amountPaid − sum(existingRefunds.amount)`). Calls Razorpay refund API, creates `Refund` row, enqueues notification. Roles: `FINANCE` or `ADMIN+`.

**`GET /admin/refunds`** — list with filters: `status`, `from/to`, `gatewayRefundId`.

**`POST /admin/refunds/:id/reconcile`** — `SUPER_ADMIN` only. Pulls current state from Razorpay and updates DB row if drift detected. Used when webhook was missed.

### 6.8 Webhooks inspector

**`GET /admin/webhooks`** — list `WebhookEvent` rows. Filters: `eventType`, `from/to`, `processed=true|false|errored`.
**`GET /admin/webhooks/:id`** — full payload (pretty-printed). Sensitive Razorpay payload fields not redacted (admin-only).
**`POST /admin/webhooks/:id/replay`** — re-enqueues the BullMQ job. Audit-logged. Roles: `ADMIN+`.

### 6.9 Audit log

**`GET /admin/audit`** — query: `entityType`, `entityId`, `actorId`, `action`, `from/to`, `cursor`. Reads Mongo. Streams via cursor pagination. Roles: any admin role.

### 6.10 User management

**`GET /admin/users`** / **`POST /admin/users/invite`** / **`POST /admin/users/:id/disable`** / **`POST /admin/users/:id/role`**. All `SUPER_ADMIN` only.

Invite flow: `POST /invite` with `{ email, role }` → generates token → emails magic link (`/admin/accept-invite?token=...`, 48h TTL) → accepter sets password + TOTP.

### 6.11 RBAC matrix (enforced server-side)

| Action | SUPER_ADMIN | ADMIN | OPS | FINANCE | SUPPORT |
|---|---|---|---|---|---|
| View dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| List/view bookings | ✓ | ✓ | ✓ | ✓ | ✓ |
| Transition booking | ✓ | ✓ | ✓ | ✗ | ✗ |
| Assign / unassign driver | ✓ | ✓ | ✓ | ✗ | ✗ |
| Cancel booking (admin) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Refund (issue) | ✓ | ✓ | ✗ | ✓ | ✗ |
| Refund override > computed | ✓ | ✓ | ✗ | ✗ | ✗ |
| CRUD drivers | ✓ | ✓ | ✓ (edit, no delete) | ✗ | ✗ |
| Upload/verify driver docs | ✓ | ✓ | ✓ | ✗ | ✗ |
| CRUD vehicles | ✓ | ✓ | ✓ (edit, no delete) | ✗ | ✗ |
| Fare rules edit | ✓ | ✓ | ✗ | ✗ | ✗ |
| Webhook replay | ✓ | ✓ | ✗ | ✗ | ✗ |
| Audit log read | ✓ | ✓ | ✓ | ✓ | ✓ |
| User management | ✓ | ✗ | ✗ | ✗ | ✗ |
| Bookings CSV export | ✓ | ✓ | ✓ | ✓ | ✗ |
| Resend notification | ✓ | ✓ | ✓ | ✗ | ✓ |

Implemented via `rbac(...roles)` middleware factory and a single source of truth in `apps/api/src/rbac/matrix.ts`. The admin frontend reads the matrix to hide menu items but never relies on it for security.

---

## 7. Backend Implementation (`apps/api`)

### 7.1 New modules

```
apps/api/src/
├── modules/admin/
│   ├── auth/
│   │   ├── admin-auth.router.ts
│   │   ├── admin-auth.service.ts
│   │   ├── password.ts            # argon2id
│   │   ├── totp.ts                # otplib
│   │   └── csrf.ts                # double-submit token
│   ├── dashboard/
│   │   ├── dashboard.router.ts
│   │   └── dashboard.service.ts
│   ├── bookings/
│   │   └── admin-bookings.router.ts
│   ├── drivers/
│   │   ├── admin-drivers.router.ts
│   │   └── s3-uploads.ts
│   ├── vehicles/
│   │   └── admin-vehicles.router.ts
│   ├── fare-rules/
│   │   └── fare-rules.router.ts
│   ├── refunds/
│   │   └── admin-refunds.router.ts
│   ├── webhooks/
│   │   └── webhooks-inspector.router.ts
│   ├── audit/
│   │   └── audit.router.ts
│   └── users/
│       └── admin-users.router.ts
├── rbac/
│   ├── matrix.ts
│   └── middleware.ts
├── middleware/
│   ├── admin-session.ts           # reads __Host-admin_sid
│   └── audit.ts                   # writes Mongo audit_events
├── integrations/
│   ├── s3.ts                      # AWS SDK v3 client → Hetzner Object Storage
│   └── otplib.ts                  # wrapper
└── jobs/
    ├── doc-expiry.cron.ts         # scans docs expiring in 30/14/7/0 days, creates system_alerts
    └── refund-recon.cron.ts       # already added Phase 2; now also writes alerts
```

### 7.2 Admin session middleware

```ts
// middleware/admin-session.ts
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../prisma';

const IDLE_MS = 30 * 60 * 1000;

export async function adminSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies['__Host-admin_sid'];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) {
    return res.status(401).json({ error: 'session_expired' });
  }
  if (now.getTime() - session.lastSeenAt.getTime() > IDLE_MS) {
    await prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: now } });
    return res.status(401).json({ error: 'idle_timeout' });
  }
  if (session.user.status !== 'ACTIVE') return res.status(403).json({ error: 'user_disabled' });
  // touch lastSeenAt (fire-and-forget)
  prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
  (req as any).admin = { id: session.user.id, role: session.user.role, email: session.user.email, sessionId: session.id, ip: req.ip };
  next();
}
```

### 7.3 CSRF (double-submit cookie)

- On 2FA success, server sets `__Host-admin_csrf` cookie (non-httpOnly, secure, samesite=strict) with a random 32-byte token.
- Frontend reads the cookie and sends it back as `X-CSRF-Token` header on every state-changing request (POST/PATCH/DELETE).
- Middleware compares header against cookie (constant-time). Missing or mismatched → 403.
- Token rotated on every successful login.

### 7.4 RBAC middleware

```ts
// rbac/middleware.ts
import { AdminRole } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

export function rbac(...allowed: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as any).admin?.role as AdminRole | undefined;
    if (!role) return res.status(401).json({ error: 'unauthenticated' });
    if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
// Helpers
export const opsPlus     = rbac('OPS','ADMIN','SUPER_ADMIN');
export const financePlus = rbac('FINANCE','ADMIN','SUPER_ADMIN');
export const adminPlus   = rbac('ADMIN','SUPER_ADMIN');
export const superOnly   = rbac('SUPER_ADMIN');
```

### 7.5 Audit middleware

A thin wrapper that handlers call after a successful mutation:

```ts
// middleware/audit.ts
import { mongo } from '../mongo';

export async function audit(opts: {
  req: any; action: string;
  entity: { type: string; id: string; code?: string };
  before?: any; after?: any; reason?: string;
}) {
  await mongo.db().collection('audit_events').insertOne({
    ts: new Date(),
    actor: { id: opts.req.admin.id, email: opts.req.admin.email, role: opts.req.admin.role, ip: opts.req.ip },
    action: opts.action,
    entity: opts.entity,
    before: opts.before,
    after: opts.after,
    reason: opts.reason,
    requestId: opts.req.id,
  });
}
```

Every admin write route MUST call `audit()` exactly once after success. A custom ESLint rule (`local/admin-must-audit`) flags handlers in `modules/admin/**` that contain `await prisma.*` mutations but no `await audit(`.

### 7.6 S3 client (Hetzner Object Storage)

S3-compatible. Uses AWS SDK v3:

```ts
// integrations/s3.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,                     // https://fsn1.your-objectstorage.com
  region: env.S3_REGION,                         // fsn1
  credentials: { accessKeyId: env.S3_KEY, secretAccessKey: env.S3_SECRET },
  forcePathStyle: true,
});

export async function presignPut(key: string, contentType: string, sizeBytes: number) {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
    ServerSideEncryption: 'AES256',
  });
  return getSignedUrl(s3, cmd, { expiresIn: 300 });
}

export async function presignGet(key: string) {
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 300 });
}
```

File-key convention: `drivers/{driverId}/{docType}/{uuid}-{slug(filename)}`. Bucket has lifecycle rule deleting non-current versions after 365 days, plus a `soft-deleted/` prefix purge at 30 days.

Allowed mime types: `application/pdf`, `image/jpeg`, `image/png`. Max 10 MB. Enforced both at presign time and via S3 bucket policy.

### 7.7 New environment variables

```ini
# Admin
ADMIN_COOKIE_DOMAIN=admin-dev.aerosarathi.com
ADMIN_SESSION_TTL_SEC=43200          # 12h absolute
ADMIN_SESSION_IDLE_SEC=1800          # 30 min idle
ADMIN_BCRYPT_PEPPER=                 # 32 random bytes, base64
ADMIN_TOTP_ISSUER=Aero Sarathi

# S3 / Hetzner Object Storage
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_BUCKET=aero-driver-docs-dev
S3_KEY=
S3_SECRET=

# CORS for admin
ADMIN_CORS_ORIGINS=https://admin-dev.aerosarathi.com,http://localhost:3001
```

### 7.8 Bootstrap script

```ts
// apps/api/scripts/bootstrap-admin.ts
import { prisma } from '../src/prisma';
import { hashPassword } from '../src/modules/admin/auth/password';
import { generateTotpSecret, otpauthUri } from '../src/modules/admin/auth/totp';
import readline from 'readline';

async function main() {
  const email = process.argv[process.argv.indexOf('--email') + 1];
  const name  = process.argv[process.argv.indexOf('--name') + 1];
  if (!email || !name) throw new Error('--email and --name required');
  const existing = await prisma.adminUser.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (existing) throw new Error('A SUPER_ADMIN already exists. Refusing to create another via this script.');

  const password = await prompt('Password (min 12 chars, will be hidden): ', true);
  if (password.length < 12) throw new Error('password too short');

  const passwordHash = await hashPassword(password);
  const totp = generateTotpSecret();

  const user = await prisma.adminUser.create({
    data: { email, name, passwordHash, role: 'SUPER_ADMIN', totpSecret: totp, totpEnabled: false },
  });
  console.log('Created admin user', user.id);
  console.log('TOTP enrolment URI (scan in Google Authenticator / 1Password):');
  console.log(otpauthUri(email, totp));
  console.log('After scanning, log in and complete the 2FA enrolment to fully activate.');
}

function prompt(q: string, hide = false): Promise<string> { /* readline impl */ return Promise.resolve(''); }
main().finally(() => prisma.$disconnect());
```

---

## 8. Frontend Implementation (`apps/admin`)

### 8.1 Stack

- Next.js 14 (App Router), TypeScript strict.
- Tailwind CSS, reusing the same tokens as `apps/web` for visual consistency.
- **Tremor** (`@tremor/react`) for charts and KPI cards in dashboard.
- **TanStack Table** for all data tables (sortable, filterable, server-paginated).
- **TanStack Query** for server state.
- **react-hook-form + Zod** for forms.
- **sonner** for toasts.
- **shadcn/ui** primitives for modals, drawers, dropdowns.

### 8.2 Folder layout

```
apps/admin/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── 2fa/page.tsx
│   │   ├── accept-invite/page.tsx
│   │   └── layout.tsx              # no shell
│   ├── (dash)/
│   │   ├── layout.tsx              # shell: sidebar + topbar
│   │   ├── dashboard/page.tsx
│   │   ├── bookings/
│   │   │   ├── page.tsx            # table
│   │   │   └── [id]/page.tsx       # detail
│   │   ├── drivers/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── vehicles/
│   │   ├── fare-rules/
│   │   ├── refunds/
│   │   ├── webhooks/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── audit/page.tsx
│   │   └── users/page.tsx          # SUPER_ADMIN only
│   ├── api/
│   │   └── auth/                   # tiny BFF proxies if needed
│   └── layout.tsx
├── components/
│   ├── Shell.tsx                   # sidebar with role-gated menu
│   ├── DataTable.tsx
│   ├── StatusPill.tsx
│   ├── Timeline.tsx
│   ├── ConfirmDialog.tsx
│   ├── ReasonField.tsx             # textarea, min 8 chars
│   ├── DocUploader.tsx
│   ├── PayloadViewer.tsx           # JSON tree viewer for webhooks/audit
│   └── PermissionGate.tsx
├── lib/
│   ├── api.ts                      # fetch wrapper, attaches CSRF header
│   ├── auth.ts                     # currentUser hook
│   ├── rbac.ts                     # client mirror of matrix
│   └── format.ts                   # money (paise → ₹), dates IST
├── middleware.ts                   # Next middleware: redirect to /login if no session cookie
└── tailwind.config.ts
```

### 8.3 Auth UX

- `/login` — email + password.
- `/2fa` — 6-digit code, auto-advance, paste-aware. "Lost your authenticator?" link opens a modal with a phone number for the founders.
- On successful 2FA, redirect to `?next=` param or `/dashboard`.
- Top-right user menu shows email + role + "Sign out" + "Sessions" (lists active sessions with revoke).

### 8.4 Shell (sidebar)

Sections, conditionally rendered via `<PermissionGate role={['OPS','ADMIN','SUPER_ADMIN']}>`:

- Dashboard
- Bookings
- Drivers
- Vehicles
- Fare rules (admin+)
- Refunds (finance/admin)
- Webhooks (admin+)
- Audit log
- Users (super only)

Top bar: environment badge (`DEV` / `STAGING` / `PROD` in colour), today's date IST, session expiry countdown when < 5 min.

### 8.5 Bookings page

Table columns: code, status (pill), passenger (name + masked phone), route (pickup → drop, 1-line), scheduled at (IST), vehicle, fare, driver, actions.

Filters bar: status multi-select, date range (scheduledAt|createdAt toggle), search, driver picker, category. Filters reflected in URL query so they're shareable.

Row click → `/bookings/:id` (full-page detail).

Detail page sections:
1. **Header** — code, status pill, big actions: Assign Driver, Cancel, Resend SMS.
2. **Trip** — pickup/drop with Google static map thumbnail (low cost, generated server-side and cached 24h), scheduled at, vehicle category, distance, ETA.
3. **Passenger** — name, phone (clickable to copy full), email.
4. **Fare** — breakdown table.
5. **Payments** — list with status pills, click → modal with full Razorpay metadata.
6. **Refunds** — list with status, "Issue refund" button (gated).
7. **Driver & Vehicle** — current assignment with details, history of assignments.
8. **Timeline** — vertical timeline from `BookingStatusEvent` + `audit_events` joined client-side.
9. **Notifications** — list of `Notification` rows with channel, template, status, resend button.
10. **Internal notes** — list + add note.

### 8.6 Drivers page

Table + filters. "New driver" button opens a wizard:
1. Basics (phone, name, license, home city).
2. Vehicle assignment (optional — pick existing or "later").
3. Document upload (license + RC required to proceed past `OFFBOARDING`).

Driver detail page tabs: Overview / Documents / Trips / Earnings (placeholder, Phase 6) / Notes.

Documents tab uses `DocUploader` component: drag-drop, shows progress as the file PUTs to S3 via the pre-signed URL, then submits metadata.

### 8.7 Webhooks inspector

List rows with badges: `processed`, `pending`, `errored`. Detail page shows pretty-printed JSON in `PayloadViewer` (collapsible nodes), the computed event id, signature, received at, processed at, error if any. Big "Replay" button (admin+), confirms via dialog.

### 8.8 Audit log

Single page with filter bar (entity type / id / actor / action / date range). Infinite-scroll virtualised list (one event per row, expandable diff view showing `before` vs `after` as a unified JSON diff).

### 8.9 Fare rule preview

Editor form with all numeric fields. Sample trip section lets ops add up to 5 routes (distance + duration + scheduled hour). On change, debounced call to `/admin/fare-rules/preview` shows the computed fare for each category. "Save & activate" gated behind a confirm dialog showing the diff vs current active rule.

### 8.10 Errors & loading

- All queries use TanStack Query with `suspense: false`; pages render skeletons.
- 401 from API → automatic redirect to `/login?next=...`.
- 403 → friendly "Your role doesn't allow this" empty state with a "Request access" mailto link to ops lead.
- 5xx → toast + Sentry capture.

---

## 9. External Service Setup

### 9.1 Hetzner Object Storage
1. Create project bucket `aero-driver-docs-dev` (region `fsn1` or `nbg1`).
2. Generate API token (access + secret).
3. Bucket policy: block all public access; only the API server's S3 credentials can read/write.
4. Lifecycle rule: delete objects under prefix `soft-deleted/` after 30 days.
5. CORS rule on bucket: allow `PUT` from `https://admin-dev.aerosarathi.com`, headers `Content-Type, Content-Length`, max age 300.
6. Repeat for prod with separate bucket + separate token.

### 9.2 Vercel
- Create `aero-admin-dev` and `aero-admin-prod` Vercel projects, root `apps/admin`.
- Env vars per env: `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_ENV_LABEL`, Sentry DSN.
- Custom domain: `admin-dev.aerosarathi.com` (CNAME to Vercel).
- Password-protect Vercel preview deployments to avoid leaking unreleased admin UI.

### 9.3 SendGrid (admin invite emails)
Already enabled in Phase 2. Add a new template `admin_invite` (subject "You're invited to Aero Sarathi Admin"). API key scoped same as before (Mail Send only).

---

## 10. Local Development

### 10.1 Run the admin app

```powershell
copy apps\admin\.env.example apps\admin\.env
pnpm --filter @aero/admin dev    # boots on http://localhost:3001
```

### 10.2 Create local super admin

```powershell
pnpm --filter @aero/api ts-node scripts/bootstrap-admin.ts --email me@local.test --name "Local Dev"
```

Scan the printed `otpauth://` URI into Google Authenticator (or use any TOTP CLI). Log in at `http://localhost:3001/login`.

### 10.3 Seed test data

```ts
// packages/db/prisma/seed.admin.ts
// - 50 fake bookings spanning last 30 days (various statuses)
// - 10 drivers (some active, some OFFBOARDING, some with expiring docs)
// - 15 vehicles (mix of HATCHBACK/SEDAN/SUV/LUXURY)
// - 1 ADMIN, 1 OPS, 1 FINANCE, 1 SUPPORT admin user (TOTP pre-enabled with known seeds, dev only)
```

Run via `pnpm --filter @aero/db seed:admin`. Refuses to run when `NODE_ENV=production`.

### 10.4 Local S3 (MinIO)

Add to `docker-compose.dev.yml`:

```yaml
minio:
  image: minio/minio
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: aero
    MINIO_ROOT_PASSWORD: aero-secret-32-chars-min
  ports: ["9000:9000", "9001:9001"]
  volumes: [minio:/data]
```

Local env points `S3_ENDPOINT=http://localhost:9000`, `S3_BUCKET=aero-driver-docs-local`. A bootstrap script creates the bucket on first run.

---

## 11. Testing Plan

### 11.1 Unit (Vitest)

| Spec | Cases ≥ |
|---|---|
| `password.spec.ts` | 5 — argon2 round-trip, pepper applied, wrong password rejected, timing-safe (mock), upgrade old hash on login |
| `totp.spec.ts` | 6 — current code accepts, ±1 window accepts, ±2 rejects, replay rejected within window, secret entropy ≥ 80 bits |
| `csrf.spec.ts` | 4 — token issued, header+cookie match passes, mismatch fails, missing fails |
| `rbac.spec.ts` | All matrix rows (≥ 25) — explicit pass/fail per (role, action) |
| `s3-presign.spec.ts` | 4 — URL has expiry, content-type pinned, size pinned, encryption header |
| `audit-eslint.spec.ts` | 2 — lint rule fires on missing audit; passes when audit present |

### 11.2 Integration (Supertest + Testcontainers + MinIO)

- **Login + 2FA happy path** → session cookie set, CSRF cookie set, subsequent authed request succeeds.
- **Login wrong password 5x** → account locked for 15 min; 6th attempt returns `locked`.
- **TOTP replay** → same code within 30s window rejected on 2nd use.
- **Idle timeout** → after 30 min no activity, session 401.
- **CSRF missing** → POST returns 403.
- **RBAC** parameterized: for each (role, route), assert expected status.
- **Booking assign-driver** → conflict detection rejects overlapping assignments.
- **Doc upload happy path** → presign → MinIO PUT → metadata POST → row exists → presigned GET works → audit row written.
- **Fare rule supersession** → new rule sets prior `effectiveTo` + `supersededBy`; only one active per category.
- **Manual refund** → calls Razorpay (mocked) → Refund row → audit row.
- **Webhook replay** → re-enqueues, worker reprocesses idempotently (no double state change).

### 11.3 E2E (Playwright)

- `admin-login.spec.ts`: login + 2FA (test admin with deterministic TOTP secret in dev env) → dashboard renders.
- `assign-driver.spec.ts`: open a CONFIRMED booking → pick a driver → status pill updates to DRIVER_ASSIGNED → timeline shows event → notification row appears.
- `cancel-with-override.spec.ts`: SUPER_ADMIN cancels with override; another role attempt is blocked.
- `upload-doc.spec.ts`: upload a small PDF to a driver → verify → re-fetch shows verified state.
- `rbac-menu.spec.ts`: log in as OPS → "Fare rules", "Users" menu items hidden; direct URL navigation returns 403 page.

### 11.4 Acceptance criteria

- [ ] All unit + integration + E2E green in CI.
- [ ] Bootstrap script creates super admin and TOTP enrolment works (manually verified on staging with a real authenticator).
- [ ] Every admin write route writes exactly one `audit_events` document (asserted by an automated test that runs every route with a seeded admin and counts inserts).
- [ ] OPS user cannot perform any FINANCE or ADMIN-only action via direct API calls (parameterized RBAC test ≥ 25 cases).
- [ ] Bookings table loads 1000 rows in < 800ms p95 (test with seed data).
- [ ] Document upload of 8 MB PDF succeeds in < 5s on a 50 Mbps connection (manual on staging).
- [ ] Webhook replay re-runs the original processor with no double-side-effects (verified by integration test).
- [ ] Lighthouse on `/dashboard` (logged in) ≥ 90 perf, ≥ 95 a11y.
- [ ] No PII (full phone, full email, full passenger name) appears in URLs or in non-admin logs.

---

## 12. Security Checklist (Phase 3 specific)

- [ ] Passwords hashed with argon2id (memory 64 MB, time 3, parallelism 1) + 32-byte env-loaded pepper.
- [ ] TOTP mandatory for all admins; enrolment required on first login.
- [ ] Admin session cookie: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`.
- [ ] CSRF token: double-submit, rotated on login, required on every mutating request.
- [ ] Idle timeout 30 min, absolute timeout 12 h, both enforced server-side.
- [ ] Failed login lockout: 5 attempts per 15 min per email.
- [ ] Rate limit `/admin/auth/login` and `/admin/auth/2fa`: 5/min/IP.
- [ ] Optional IP allowlist enforced at Caddy + API layer for `prod` admin.
- [ ] Admin CORS allowlist contains only admin domains; never the customer site.
- [ ] All admin write routes audit-logged (lint enforced + automated test).
- [ ] S3 uploads via pre-signed URLs only; bucket blocks public reads; SSE-AES256 enforced.
- [ ] Pre-signed URLs expire in 5 min; download URLs are not stored anywhere.
- [ ] Admin Vercel deployment behind Vercel Authentication for preview branches.
- [ ] No customer JWT can authenticate to `/api/v1/admin/*` (separate session model).
- [ ] Webhook replay requires explicit confirmation and is rate-limited to 10/min/admin.
- [ ] PII redaction: passenger phones masked in tables (`+91XXXXX1234`), full only on hover/copy and audit-logged.
- [ ] All admin pages set `Cache-Control: no-store`.
- [ ] CSP on admin app: `default-src 'self'; img-src 'self' data: https://maps.googleapis.com https://*.your-objectstorage.com; script-src 'self'`.
- [ ] No `dangerouslySetInnerHTML` anywhere in admin app (lint rule).
- [ ] Dependabot + `pnpm audit` block CI on critical/high vulns for admin.

---

## 13. Observability

New metrics:
- `admin_logins_total{result}` (success | bad_password | bad_totp | locked)
- `admin_session_active_count` (gauge, scraped from Postgres)
- `admin_actions_total{action,role,result}`
- `admin_audit_inserts_total`
- `s3_presign_total{op}` (put | get)
- `s3_upload_failures_total`

Alerts:
- `admin_logins_total{result="locked"}` > 3 in 10 min → page on-call (possible brute force).
- `admin_audit_inserts_total` flatlines for 1h while mutations occur (cross-checked against `http_requests_total{route="/admin/...",method!="GET"}`) → page (audit pipeline broken).
- Driver document `expiresAt < now + 7d` count > 0 → daily Slack to ops.
- Refund age > 48h still `PENDING` → daily Slack.

Audit log itself is observability — it powers an "admin activity" dashboard (Grafana with Mongo data source) showing per-role action counts per day.

---

## 14. Deployment

### 14.1 Order
1. Run migration `phase3_admin`.
2. Deploy `apps/api` (new admin routes, backward-compatible).
3. Deploy `apps/admin` to Vercel.
4. Run bootstrap script in prod from a secured admin laptop, SSH-tunneled to the prod DB via a jump host.
5. Founder completes TOTP enrolment; invites other admins via `/admin/users`.

### 14.2 Feature flags
- `ADMIN_PANEL_ENABLED` env on the API — gates all `/api/v1/admin/*` routes. Lets us hide the panel during incidents.
- `ADMIN_IP_ALLOWLIST` env (CSV CIDRs) — when set, only listed IPs may hit admin routes.

### 14.3 Rollback
- API: redeploy previous tag.
- Admin app: Vercel "Promote previous deployment".
- Migration: additive only; no rollback DDL needed. If the new tables must be removed, that's a follow-up migration, not a hot rollback.

---

## 15. Five-Day Plan

| Day | Owner | Tasks |
|---|---|---|
| Mon | BE | Migration `phase3_admin`. `AdminUser`, `AdminSession`, `AdminInvite`, `DriverDocument`, `DriverNote`, `EmiPlan`, fare rule extras. Password (argon2id) + TOTP + bootstrap script. Admin auth routes + session middleware + CSRF. |
| Mon | FE | `apps/admin` scaffold (Next.js, Tailwind tokens, Shell, sidebar, login + 2FA pages). |
| Tue | BE | RBAC middleware + matrix + ESLint audit rule. Admin bookings list + detail endpoints. Manual transition, assign-driver, unassign, admin-cancel, notes, resend-notification. CSV export. |
| Tue | FE | Bookings table page (TanStack Table, filters in URL). Booking detail page with sections (header, trip, fare, payments, refunds, driver, timeline, notifications, notes). |
| Wed | BE | Drivers CRUD + documents (presign + metadata + verify + GET URL). Vehicles CRUD + EmiPlan. Fare rules list + preview + supersede. |
| Wed | FE | Drivers list + new-driver wizard + detail tabs + `DocUploader`. Vehicles list + form. Fare-rules editor with live preview. |
| Thu | BE | Manual refund endpoint. Webhooks inspector list/detail/replay. Audit list. User management (invite, role change, disable). |
| Thu | FE | Refunds console + issue-refund modal. Webhooks inspector + payload viewer + replay confirm. Audit log virtualised list. Users page (SUPER_ADMIN). |
| Thu | DevOps | Provision Hetzner Object Storage bucket (dev) + MinIO in compose. Wire `admin-dev.aerosarathi.com` to Vercel. Configure Vercel preview password. |
| Fri | All | Integration + E2E pass. Run bootstrap on dev, log in with real TOTP, do a full ops walkthrough. Bug bash. Tag `v0.3.0-phase3`. Update [implementation.md](implementation.md) status. |

---

## 16. Risks (Phase 3)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Admin user phishing / password reuse | Medium | Account compromise → company-wide impact | Argon2id + pepper, mandatory TOTP, idle timeout, IP allowlist for prod, security training note in [implementation.md](implementation.md) §15 |
| Forgotten audit log on a mutation | High (humans) | Compliance / debug blind spot | ESLint rule + automated test that walks every admin write route and asserts an audit insert |
| Pre-signed URL leaked in support emails | Medium | Driver document exposure | 5-min expiry; URL never stored; download events audit-logged so we can detect repeated fetches |
| S3 bucket misconfigured public | Low | Massive PII leak | Bucket policy blocks public; weekly automated check via `aws s3api get-bucket-policy-status`; deploy fails if drift |
| OPS user accidentally cancels wrong booking | Medium | Customer impact + refund cost | Two-step confirm dialog showing booking code + passenger phone last-4; soft "undo cancel within 5 min" (only if no refund processed yet) |
| Webhook replay causes double-charge | Low | Money | Worker handlers are idempotent (Phase 2 contract); replay still goes through the same processor |
| Admin session theft via XSS on customer site | Low | Cross-site session use | Admin cookie scoped to `admin-dev.aerosarathi.com`, never `.aerosarathi.com`; CSP + no inline scripts in admin |
| Race when two ops users assign different drivers to same booking | Low | Inconsistent state | `transitionBooking()` uses `SELECT FOR UPDATE`; second request errors with 409, UI re-fetches |
| TOTP device loss | Medium | Lockout | Recovery procedure: SUPER_ADMIN can reset another user's TOTP via `/users/:id/reset-2fa` (audit-logged, requires reason); SUPER_ADMINS keep recovery codes printed in a safe |

---

## 17. Deliverables Checklist

Code:
- [ ] Migration `phase3_admin` applied to dev + staging.
- [ ] `apps/admin` deployed to `admin-dev.aerosarathi.com`.
- [ ] `apps/api` exposes all `/api/v1/admin/*` routes from §6.
- [ ] Bootstrap script committed and used to create dev/staging super admin.
- [ ] Seed script for fake admin data.
- [ ] Local MinIO compose service running.
- [ ] Hetzner Object Storage bucket created with correct policy.

Ops:
- [ ] SUPER_ADMIN onboarded on staging with real TOTP.
- [ ] OPS / FINANCE / SUPPORT roles created and tested.
- [ ] Grafana dashboard "Admin activity" live.
- [ ] Alerts wired (login locked, audit flatline, doc expiry).
- [ ] Vercel preview password set.

Docs:
- [ ] OpenAPI updated.
- [ ] `docs/runbooks/admin-onboarding.md` (how to invite a new admin).
- [ ] `docs/runbooks/totp-reset.md` (how to recover a locked admin).
- [ ] `docs/runbooks/webhook-replay.md`.
- [ ] RBAC matrix exported as a printable PDF for compliance.

---

## 18. Handoff to Phase 4

Phase 4 (driver assignment automation) builds directly on this admin scaffold. Contracts Phase 4 depends on:

- `Driver.status` enum and `vehicleId` association are in place and editable.
- `DriverDocument` exists so the automated assigner can refuse drivers with expired/unverified documents.
- `transitionBooking()` is the only state mutator — the automation will call it identically to the manual admin action.
- Notification queue + `Notification` model already wired (Phase 2); Phase 4 adds driver-targeted templates.
- `system_alerts` Mongo collection populated by background jobs; the admin alert tray (§6.2) will surface "no driver found by T-30min" alerts produced by Phase 4 workers.
- Admin "manual assign" path stays available as a permanent override for when automation fails.

Open items pushed to Phase 4:
- Driver web portal (`apps/driver`) — phone OTP login, accept/decline offer screen, today's trips list.
- BullMQ `booking-assignment`, `assignment-retry`, `pre-trip-reminders`, `admin-alert` queues.
- `algo` `/matching/score` endpoint.
- New SMS templates for driver-side messaging.

---

**End of Phase 3 document.**
