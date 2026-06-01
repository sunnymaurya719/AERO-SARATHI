# Phase 2 — Payments & Confirmation (Week 3)

**Parent document:** [implementation.md](implementation.md)
**Previous phase:** [phase1.md](phase1.md)
**Phase status:** Not started
**Duration:** 1 week (5 working days)
**Prereq:** Phase 1 complete — `PENDING` bookings creatable, OTP auth working, all Phase 1 acceptance criteria green.

---

## 1. Phase Goal

Make bookings real. A `PENDING` booking becomes `CONFIRMED` only after a verified Razorpay token payment. Users get an SMS + email confirmation with a downloadable PDF receipt. Users can cancel a booking and receive a refund computed by the PRD policy.

**Definition of "done" for Phase 2:**
> A user can complete: visit homepage → pick route → select vehicle → OTP → **pay token via Razorpay (UPI/card)** → land on confirmation screen → receive SMS + email within 60s → view/download receipt → cancel within policy → see refund initiated in Razorpay dashboard. Every state transition is webhook-driven, idempotent, and audit-logged.

---

## 2. Scope

### In scope
- Razorpay order creation server-side.
- Razorpay Standard Checkout on web (UPI, cards, netbanking, wallets).
- Server-side **signature verification** on client callback.
- **Webhook receiver** with signature validation + idempotent processing (`payment.captured`, `payment.failed`, `payment.authorized`, `refund.created`, `refund.processed`, `refund.failed`).
- Booking state machine enforcement (`PENDING → CONFIRMED`, `CONFIRMED → CANCELLED`).
- Cancellation logic with PRD-specified policy, executed by the `algo` service.
- Razorpay Refunds API integration.
- Transactional SMS via MSG91 (DLT-approved templates).
- Transactional email via SendGrid (or Resend as fallback).
- PDF receipt generation (server-side, streamed).
- "My Bookings" upgrades: cancel button, refund status, receipt download.
- New tables: `Payment`, `Cancellation`, `WebhookEvent`, `Notification`.

### Explicitly OUT of scope (deferred)
- Driver assignment / SMS to drivers (Phase 4).
- Live tracking (Phase 5).
- Wallet credits / coupons / referrals (Phase 6).
- In-app refund of partial amount to wallet vs original method (Phase 6).
- COD / "pay at pickup" mode.
- Subscription billing.
- Multi-currency.

---

## 3. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-2.1 | logged-in user | pay a 20% token via UPI in <30s | I lock the booking quickly |
| US-2.2 | user | see a clear fare breakdown before paying | I trust the price I'm charged |
| US-2.3 | user | receive SMS + email confirmation with booking code | I have proof of booking |
| US-2.4 | user | download a PDF receipt anytime | I can claim travel reimbursement |
| US-2.5 | user | cancel a booking from My Bookings | plans change |
| US-2.6 | user | see exact refund amount before confirming cancel | no surprises |
| US-2.7 | platform | never lose a payment to lost network | webhook drives state |
| US-2.8 | platform | never double-charge a card | idempotency enforced |
| US-2.9 | finance | reconcile every Razorpay payout to bookings | no leakage |

---

## 4. Architecture Slice for Phase 2

```
┌─────────────────────────────────────────────────────────┐
│ Customer Web (Next.js)                                  │
│  /book/pay/[code]  ─ opens Razorpay Checkout JS         │
│  /account/bookings/[id]  ─ cancel + download receipt    │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ API (Node + Express)                                    │
│  POST /bookings/:id/payment/intent                       │
│  POST /bookings/:id/payment/verify                       │
│  POST /bookings/:id/cancel                               │
│  GET  /bookings/:id/receipt           (PDF stream)       │
│  POST /webhooks/razorpay              (Razorpay → us)    │
└──┬──────────┬──────────┬──────────┬──────────┬─────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
Postgres   Redis      Mongo     Razorpay   Notification
(Booking,  (idem.    (audit_   (Orders,    Workers
 Payment,  keys,     events,    Payments,  ├─ MSG91 SMS
 Cancel,   webhook   webhook    Refunds)   ├─ SendGrid email
 Webhook   dedupe)   raw       ─ Webhooks  └─ PDF gen
 Event)              payloads)              (pdfkit)
                                            ↑
                                       BullMQ queue
                                       "notifications"
```

External services added this phase: **Razorpay**, **SendGrid** (or Resend). MSG91 already wired in Phase 1.

---

## 5. Data Model Changes

Migration name: `phase2_payments`.

### 5.1 New / changed Prisma models

```prisma
model Booking {
  // ... existing Phase 1 fields ...
  payments      Payment[]
  cancellation  Cancellation?
  notifications Notification[]
  confirmedAt   DateTime?
  cancelledAt   DateTime?
}

model Payment {
  id               String        @id @default(uuid())
  bookingId        String
  booking          Booking       @relation(fields: [bookingId], references: [id])
  amount           Int                              // paise — total intended
  amountPaid       Int           @default(0)        // paise — actually captured
  currency         String        @default("INR")
  type             PaymentType
  status           PaymentStatus @default(CREATED)
  gateway          String        @default("razorpay")
  gatewayOrderId   String?       @unique            // order_xxx
  gatewayPayId     String?       @unique            // pay_xxx
  gatewayMethod    String?                          // upi | card | netbanking | wallet
  gatewayFee       Int?                             // paise, from webhook
  gatewayTax       Int?                             // paise
  failureCode      String?
  failureReason    String?
  notes            Json?                            // anything from Razorpay notes
  capturedAt       DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  @@index([bookingId, type])
  @@index([gatewayOrderId])
}

enum PaymentType    { TOKEN BALANCE REFUND }
enum PaymentStatus  { CREATED PENDING SUCCESS FAILED REFUNDED PARTIAL_REFUNDED }

model Refund {
  id               String   @id @default(uuid())
  paymentId        String
  payment          Payment  @relation(fields: [paymentId], references: [id])
  amount           Int                              // paise
  status           RefundStatus @default(CREATED)
  gatewayRefundId  String?  @unique                 // rfnd_xxx
  reason           String
  initiatedBy      Role                             // CUSTOMER | ADMIN | OPS | SYSTEM
  failureReason    String?
  processedAt      DateTime?
  createdAt        DateTime @default(now())
  @@index([paymentId])
}

enum RefundStatus { CREATED PENDING PROCESSED FAILED }

model Cancellation {
  id            String   @id @default(uuid())
  bookingId     String   @unique
  booking       Booking  @relation(fields: [bookingId], references: [id])
  cancelledBy   Role
  reason        String
  policyBucket  CancelBucket
  feeAmount     Int                                 // paise retained
  refundAmount  Int                                 // paise to refund
  refundId      String?
  createdAt     DateTime @default(now())
}

enum CancelBucket { GRACE_30_MIN FLAT_200 PCT_25 PCT_50 PCT_100 NO_SHOW }

model WebhookEvent {
  id           String   @id @default(uuid())
  gateway      String                              // razorpay
  eventId      String   @unique                    // Razorpay event id
  eventType    String                              // payment.captured, etc.
  signature    String
  payload      Json
  processedAt  DateTime?
  processingError String?
  receivedAt   DateTime @default(now())
  @@index([eventType, receivedAt])
}

model Notification {
  id          String   @id @default(uuid())
  bookingId   String?
  booking     Booking? @relation(fields: [bookingId], references: [id])
  userId      String?
  channel     NotifChannel
  template    String
  payload     Json
  status      NotifStatus @default(QUEUED)
  attempts    Int      @default(0)
  lastError   String?
  sentAt      DateTime?
  createdAt   DateTime @default(now())
  @@index([status, createdAt])
}

enum NotifChannel { SMS EMAIL PUSH }
enum NotifStatus  { QUEUED SENT FAILED }
```

### 5.2 Booking state machine (enforced server-side)

```
              POST /payment/verify (SUCCESS)
              OR webhook: payment.captured
PENDING ─────────────────────────────────────────► CONFIRMED
   │                                                  │
   │ POST /cancel                                     │ POST /cancel
   │ (free bucket)                                    │ (any bucket)
   ▼                                                  ▼
CANCELLED ◄──────────────────────────────────── CANCELLED
                                                      │
                                                      │ (Phase 4)
                                                      ▼
                                              DRIVER_ASSIGNED
```

Transitions are gated by a `transitionBooking(bookingId, to, ctx)` function that:
1. Loads booking with `SELECT ... FOR UPDATE` inside a transaction.
2. Checks allowed transitions table.
3. Writes new status + `BookingStatusEvent` + audit log atomically.
4. Throws `IllegalStateError` (HTTP 409) on disallowed move.

---

## 6. Cancellation Policy (PRD-canonical)

The PRD specifies windows **relative to the scheduled pickup time** (`scheduledAt`), not booking creation. The "within 30 min" grace is from **booking creation** (typical industry pattern; confirm with biz). Logic lives in `algo` service so it can be tuned without redeploying API.

Bucket selection algorithm (executed when cancellation is requested):

```
now = current UTC
created = booking.createdAt
sched   = booking.scheduledAt
hoursToTrip = (sched - now) / 1h
minSinceCreate = (now - created) / 1min

if minSinceCreate <= 30:               bucket = GRACE_30_MIN
elif hoursToTrip >= 24:                bucket = FLAT_200
elif 6 <= hoursToTrip < 24:            bucket = PCT_25
elif 0 < hoursToTrip < 6:              bucket = PCT_50      # later bumped to 100 in §8
elif hoursToTrip <= 0:                 bucket = NO_SHOW
```

Fee + refund computation (`tokenPaid` = sum of successful TOKEN payments in paise):

| Bucket | Fee | Refund |
|---|---|---|
| GRACE_30_MIN | 0 | tokenPaid |
| FLAT_200 | min(20000, tokenPaid) | tokenPaid − fee |
| PCT_25 | round(tokenPaid × 0.25) | tokenPaid − fee |
| PCT_50 | round(tokenPaid × 0.50) | tokenPaid − fee |
| PCT_100 | tokenPaid | 0 |
| NO_SHOW | tokenPaid | 0 |

**`algo` exposes:**

```
POST /algo/v1/cancellation/quote
  body: { tokenPaid, createdAt, scheduledAt, now? }
  → { bucket, feeAmount, refundAmount, explanation }
```

API service calls this both for the **preview** (`GET /bookings/:id/cancel/preview`) and the **execute** path (`POST /bookings/:id/cancel`). Preview never mutates DB.

---

## 7. API Specification

All routes under `/api/v1`. JWT required unless noted. Errors follow RFC 7807 (set in Phase 1).

### 7.1 `POST /bookings/:id/payment/intent`

Creates a Razorpay Order for the token amount, or returns the existing open one (idempotent).

Request: empty body. `Idempotency-Key` header required.

Response 200:
```json
{
  "paymentId": "uuid",
  "razorpayKeyId": "rzp_test_xxx",
  "razorpayOrderId": "order_xxx",
  "amount": 106100,                   // paise (token)
  "currency": "INR",
  "name": "Aero Sarathi",
  "description": "Token for AS-260530-A1B2",
  "prefill": { "name": "Aman Singh", "contact": "+919876543210", "email": null },
  "notes": { "bookingId": "uuid", "bookingCode": "AS-260530-A1B2" }
}
```

Server steps:
1. Load booking, assert ownership + `status === 'PENDING'`.
2. If a `Payment` of type `TOKEN` exists with status `CREATED` or `PENDING` and an active Razorpay order (< 15 min old), return it.
3. Else create Razorpay order:
   ```
   POST https://api.razorpay.com/v1/orders
   { amount: booking.tokenAmount, currency: "INR", receipt: booking.code,
     notes: { bookingId, bookingCode }, payment_capture: 1 }
   ```
4. Insert `Payment` row, status `CREATED`, `gatewayOrderId = order.id`.
5. Return payload.

Errors:
- `409 BOOKING_NOT_PENDING` — booking is not in PENDING state.
- `410 BOOKING_EXPIRED` — `scheduledAt < now + MIN_LEAD_TIME_MIN`.
- `502 GATEWAY_UNAVAILABLE` — Razorpay 5xx.

### 7.2 `POST /bookings/:id/payment/verify`

Called by the web client immediately after Razorpay checkout `handler` fires.

Request:
```json
{
  "razorpay_order_id": "order_xxx",
  "razorpay_payment_id": "pay_xxx",
  "razorpay_signature": "hex..."
}
```

Server steps:
1. Compute `expected = HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, RAZORPAY_KEY_SECRET)`.
2. Constant-time compare with `razorpay_signature`. Mismatch → 400 `BAD_SIGNATURE`, log incident, **do not** mark anything paid.
3. Inside transaction, with row lock on `Payment` by `gatewayOrderId`:
   - If already `SUCCESS`: return current state (idempotent).
   - Set `gatewayPayId`, `status = PENDING` (final SUCCESS comes from webhook to avoid race), `capturedAt = now`.
4. Fetch payment from Razorpay (`GET /payments/:id`) to read `status`, `method`, `fee`, `tax`. If `status === 'captured'`, mark `Payment.status = SUCCESS`, `amountPaid = amount`, transition booking `PENDING → CONFIRMED`, set `confirmedAt`.
5. Enqueue notification jobs: `notif.send` with `{ template: 'booking_confirmed_sms' }` and `{ template: 'booking_confirmed_email' }`.
6. Return booking snapshot.

Response 200:
```json
{ "booking": { "id":"...", "code":"AS-260530-A1B2", "status":"CONFIRMED", "confirmedAt":"..." } }
```

### 7.3 `POST /webhooks/razorpay`

**No JWT.** Public endpoint, but signed.

Headers:
- `X-Razorpay-Signature: <hex>` — HMAC-SHA256 of raw body with `RAZORPAY_WEBHOOK_SECRET`.
- `X-Razorpay-Event-Id: evt_xxx` (some payloads include `event` + `created_at`; the unique key we use is `payload.payment.entity.id` + `event` + `created_at` if `X-Razorpay-Event-Id` missing).

Server steps:
1. Read raw body (must use `express.raw({ type: 'application/json' })` on this route only, before JSON parsing).
2. Compute HMAC; constant-time compare. Mismatch → 401 + alert.
3. Build `eventKey = req.headers['x-razorpay-event-id'] || hash(body)`.
4. Insert `WebhookEvent` (unique on `eventId`). On Postgres `P2002` → already processed, return 200 immediately.
5. Respond `200 OK` **synchronously** within 5s.
6. Enqueue BullMQ job `webhook.process` with `{ webhookEventId }`. Heavy work happens in worker.

Worker (`webhook.process`):
- Loads `WebhookEvent`. Routes by `eventType`:
  - `payment.captured` → mark Payment SUCCESS, transition booking → CONFIRMED, enqueue notifications (skip if already CONFIRMED).
  - `payment.failed` → mark Payment FAILED with reason; booking stays PENDING; enqueue `payment_failed_sms` to the user.
  - `payment.authorized` → log only (auto-capture is enabled).
  - `refund.created` → mark Refund PENDING.
  - `refund.processed` → mark Refund PROCESSED, Payment status → REFUNDED (or PARTIAL_REFUNDED), enqueue `refund_completed_sms`.
  - `refund.failed` → mark Refund FAILED, alert admin via `admin_alert` queue.
- Always wraps in try/catch; on error sets `WebhookEvent.processingError` and rethrows so BullMQ retries (max 5, exponential backoff).

### 7.4 `GET /bookings/:id/cancel/preview`

Returns what would happen if cancel were submitted right now. No mutation.

Response 200:
```json
{
  "eligible": true,
  "bucket": "PCT_25",
  "feeAmount": 26525,
  "refundAmount": 79575,
  "explanation": "Cancellation between 6 and 24 hours of pickup: 25% fee on token paid.",
  "tokenPaid": 106100
}
```

If `eligible: false` (e.g. already cancelled, completed, no-show), include `reason`.

### 7.5 `POST /bookings/:id/cancel`

Request: `{ "reason": "Trip postponed", "confirm": true }`. `Idempotency-Key` required.

Server steps:
1. Load booking + payments + existing cancellation. If already cancelled → return existing (idempotent).
2. Assert `status in {PENDING, CONFIRMED}`.
3. Call `algo` `/cancellation/quote`. Recompute fee server-side (do not trust client).
4. Transaction:
   - Insert `Cancellation` row.
   - Transition booking → CANCELLED, set `cancelledAt`.
5. If `refundAmount > 0` and a successful TOKEN payment exists:
   - Call Razorpay `POST /payments/:id/refund` with `{ amount: refundAmount, speed: "normal", notes: { bookingId } }`.
   - Insert `Refund` row, status CREATED → PENDING after API ack.
6. Enqueue notifications: `cancellation_confirmed_sms` + `_email`. If refund initiated, message includes refund amount + ETA (5–7 working days).
7. Return cancellation summary.

### 7.6 `GET /bookings/:id/receipt`

Streams a PDF receipt. JWT-gated (owner only). Content-Type `application/pdf`, `Content-Disposition: attachment; filename="AS-260530-A1B2-receipt.pdf"`.

PDF is regenerated on every request (cheap, ~50ms). Cached for 24h in Redis keyed by `receipt:{bookingCode}:{updatedAt}`.

### 7.7 `GET /me/bookings/:id` (Phase 2 additions)

Response now includes:
```json
{
  ...phase1Fields,
  "payments": [{ "id":"...", "type":"TOKEN", "status":"SUCCESS", "amount":106100, "method":"upi", "capturedAt":"..." }],
  "cancellation": { "bucket":"PCT_25", "feeAmount":26525, "refundAmount":79575, "refundStatus":"PROCESSED" } | null,
  "canCancel": true,
  "cancellationPreview": { ...same as 7.4 if canCancel }
}
```

---

## 8. Algo Service Additions (`apps/algo`)

### 8.1 Folder layout

```
apps/algo/
├── app/
│   ├── main.py
│   ├── deps.py                    # FastAPI dependencies
│   ├── routers/
│   │   └── cancellation.py
│   ├── domain/
│   │   ├── cancellation.py        # pure functions
│   │   └── models.py              # Pydantic
│   └── settings.py
├── tests/
│   └── test_cancellation.py       # ≥ 20 cases
├── pyproject.toml
└── Dockerfile
```

### 8.2 Pure function

```python
# app/domain/cancellation.py
from dataclasses import dataclass
from datetime import datetime, timezone

@dataclass
class Quote:
    bucket: str
    fee_amount: int
    refund_amount: int
    explanation: str

GRACE_MIN = 30
FLAT_FEE_PAISE = 20_000  # ₹200

def compute(token_paid: int, created_at: datetime, scheduled_at: datetime, now: datetime | None = None) -> Quote:
    now = now or datetime.now(timezone.utc)
    min_since_create = (now - created_at).total_seconds() / 60
    hours_to_trip    = (scheduled_at - now).total_seconds() / 3600

    if min_since_create <= GRACE_MIN:
        return Quote("GRACE_30_MIN", 0, token_paid, "Free cancellation within 30 minutes of booking.")
    if hours_to_trip <= 0:
        return Quote("NO_SHOW", token_paid, 0, "Pickup time has passed; no refund.")
    if hours_to_trip < 6:
        # PRD says 50–100%. Phase 2 uses 100% for <6h to discourage last-minute cancels.
        return Quote("PCT_100", token_paid, 0, "Cancellation within 6 hours of pickup: no refund.")
    if hours_to_trip < 24:
        fee = round(token_paid * 0.25)
        return Quote("PCT_25", fee, token_paid - fee, "Cancellation between 6 and 24 hours of pickup: 25% fee on token paid.")
    fee = min(FLAT_FEE_PAISE, token_paid)
    return Quote("FLAT_200", fee, token_paid - fee, "Cancellation more than 24 hours before pickup: flat ₹200 fee.")
```

### 8.3 Endpoint

```python
# app/routers/cancellation.py
from fastapi import APIRouter
from pydantic import BaseModel, Field
from datetime import datetime
from ..domain.cancellation import compute

router = APIRouter(prefix="/algo/v1/cancellation", tags=["cancellation"])

class QuoteIn(BaseModel):
    token_paid: int = Field(ge=0)
    created_at: datetime
    scheduled_at: datetime
    now: datetime | None = None

class QuoteOut(BaseModel):
    bucket: str
    fee_amount: int
    refund_amount: int
    explanation: str

@router.post("/quote", response_model=QuoteOut)
def quote(body: QuoteIn) -> QuoteOut:
    q = compute(body.token_paid, body.created_at, body.scheduled_at, body.now)
    return QuoteOut(bucket=q.bucket, fee_amount=q.fee_amount, refund_amount=q.refund_amount, explanation=q.explanation)
```

### 8.4 Auth between API and algo

Both services on the same Docker network; algo is **not** exposed publicly. Caddy does not proxy `/algo/*`. API calls `http://algo:5000/algo/v1/...` via an internal hostname. Additionally, a shared `INTERNAL_SHARED_SECRET` header is required (`X-Internal-Auth`) — defence in depth.

---

## 9. Backend Implementation (`apps/api`)

### 9.1 New modules

```
apps/api/src/
├── modules/
│   ├── payments/
│   │   ├── payments.router.ts
│   │   ├── payments.service.ts
│   │   └── razorpay.ts              # SDK wrapper
│   ├── webhooks/
│   │   ├── webhooks.router.ts
│   │   └── webhooks.worker.ts       # BullMQ processor
│   ├── cancellations/
│   │   ├── cancel.router.ts
│   │   └── cancel.service.ts
│   ├── receipts/
│   │   ├── receipts.router.ts
│   │   └── receipts.pdf.ts          # pdfkit template
│   └── notifications/
│       ├── notifications.service.ts
│       ├── notifications.worker.ts  # BullMQ processor
│       ├── channels/
│       │   ├── sms.msg91.ts
│       │   └── email.sendgrid.ts
│       └── templates/
│           ├── booking_confirmed.sms.ts
│           ├── booking_confirmed.email.tsx   # React Email
│           ├── cancellation_confirmed.sms.ts
│           ├── cancellation_confirmed.email.tsx
│           └── payment_failed.sms.ts
├── queues/
│   ├── index.ts                     # createQueue, getQueueEvents
│   ├── webhook.queue.ts
│   └── notifications.queue.ts
└── state/
    └── booking.transitions.ts       # allowed state map + transitionBooking()
```

### 9.2 New environment variables (`apps/api/.env.example` additions)

```ini
# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# SendGrid (or Resend)
SENDGRID_API_KEY=
EMAIL_FROM="Aero Sarathi <bookings@aerosarathi.com>"

# MSG91 transactional template IDs (Phase 2 additions)
MSG91_TEMPLATE_BOOKING_CONFIRMED=
MSG91_TEMPLATE_CANCELLATION=
MSG91_TEMPLATE_REFUND=
MSG91_TEMPLATE_PAYMENT_FAILED=

# Algo service
ALGO_BASE_URL=http://algo:5000
INTERNAL_SHARED_SECRET=change-me-32-chars

# Booking
MIN_LEAD_TIME_MIN=120
PAYMENT_INTENT_TTL_MIN=15
```

`env.ts` (Zod) updated to validate all new vars.

### 9.3 Razorpay wrapper

```ts
// modules/payments/razorpay.ts
import Razorpay from 'razorpay';
import { env } from '../../env';
import { createHmac, timingSafeEqual } from 'crypto';

export const rzp = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### 9.4 State machine (`state/booking.transitions.ts`)

```ts
import { BookingStatus, PrismaClient } from '@prisma/client';

const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  PENDING:         ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:       ['DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE:        ['ONGOING', 'NO_SHOW', 'CANCELLED'],
  ONGOING:         ['COMPLETED'],
  COMPLETED:       [],
  CANCELLED:       [],
  NO_SHOW:         [],
};

export class IllegalTransitionError extends Error {
  constructor(public from: BookingStatus, public to: BookingStatus) {
    super(`Illegal transition ${from} -> ${to}`);
  }
}

export async function transitionBooking(
  prisma: PrismaClient,
  bookingId: string,
  to: BookingStatus,
  ctx: { actorId?: string; reason?: string },
) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.$queryRaw<{ status: BookingStatus }[]>`
      SELECT status FROM "Booking" WHERE id = ${bookingId} FOR UPDATE
    `;
    const from = b[0]?.status;
    if (!from) throw new Error('booking_not_found');
    if (from === to) return; // idempotent
    if (!ALLOWED[from].includes(to)) throw new IllegalTransitionError(from, to);

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: to,
        ...(to === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
        ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    });
    await tx.bookingStatusEvent.create({
      data: { bookingId, from, to, actorId: ctx.actorId, reason: ctx.reason },
    });
  });
}
```

### 9.5 Webhook router (raw body!)

```ts
// modules/webhooks/webhooks.router.ts
import { Router, raw } from 'express';
import { prisma } from '../../prisma';
import { verifyWebhookSignature } from '../payments/razorpay';
import { webhookQueue } from '../../queues/webhook.queue';
import { logger } from '../../logger';

export const webhooksRouter = Router();

webhooksRouter.post(
  '/razorpay',
  raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    const signature = req.header('x-razorpay-signature') ?? '';
    const rawBody = req.body as Buffer;
    if (!verifyWebhookSignature(rawBody, signature)) {
      logger.warn({ ip: req.ip }, 'razorpay_bad_signature');
      return res.status(401).json({ error: 'bad_signature' });
    }
    const parsed = JSON.parse(rawBody.toString('utf8'));
    const eventId = req.header('x-razorpay-event-id')
                 ?? `${parsed.event}:${parsed.payload?.payment?.entity?.id ?? ''}:${parsed.created_at}`;
    try {
      const we = await prisma.webhookEvent.create({
        data: {
          gateway: 'razorpay',
          eventId,
          eventType: parsed.event,
          signature,
          payload: parsed,
        },
      });
      await webhookQueue.add('process', { webhookEventId: we.id }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      });
    } catch (e: any) {
      if (e.code !== 'P2002') {
        logger.error({ err: e }, 'webhook_insert_failed');
        return res.status(500).json({ error: 'internal' });
      }
      // P2002 = duplicate eventId → already processed
    }
    res.status(200).json({ ok: true });
  },
);
```

**Important:** mount this router *before* `express.json()` for the `/webhooks` path, or register only this route with `raw()`. The Phase 1 bootstrap applies `express.json()` globally — update §7.3 of phase1 to skip `/api/v1/webhooks/*`.

Adjustment in `src/index.ts`:

```ts
app.use('/api/v1/webhooks', webhooksRouter);   // mounted with raw() inside
app.use(express.json({ limit: '32kb' }));      // for everything after
```

### 9.6 Webhook worker

```ts
// modules/webhooks/webhooks.worker.ts
import { Worker } from 'bullmq';
import { prisma } from '../../prisma';
import { redisConnection } from '../../redis';
import { transitionBooking } from '../../state/booking.transitions';
import { enqueueNotification } from '../notifications/notifications.service';

export const webhookWorker = new Worker(
  'webhooks',
  async (job) => {
    const we = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: job.data.webhookEventId } });
    if (we.processedAt) return;
    const p: any = we.payload;
    const ent = p.payload?.payment?.entity ?? p.payload?.refund?.entity;
    if (!ent) throw new Error('no_entity');

    switch (we.eventType) {
      case 'payment.captured': {
        const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: ent.order_id } });
        if (!payment) throw new Error('payment_not_found_for_order');
        if (payment.status === 'SUCCESS') break;
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCESS',
            gatewayPayId: ent.id,
            gatewayMethod: ent.method,
            gatewayFee: ent.fee ?? null,
            gatewayTax: ent.tax ?? null,
            amountPaid: ent.amount,
            capturedAt: new Date(ent.created_at * 1000),
          },
        });
        if (payment.type === 'TOKEN') {
          await transitionBooking(prisma, payment.bookingId, 'CONFIRMED', { reason: 'razorpay_webhook' });
          await enqueueNotification(payment.bookingId, 'booking_confirmed');
        }
        break;
      }
      case 'payment.failed': {
        const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: ent.order_id } });
        if (!payment) break;
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureCode: ent.error_code,
            failureReason: ent.error_description,
            gatewayPayId: ent.id,
          },
        });
        await enqueueNotification(payment.bookingId, 'payment_failed');
        break;
      }
      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed': {
        const refund = await prisma.refund.findUnique({ where: { gatewayRefundId: ent.id } });
        if (!refund) break; // we only track refunds we initiated
        const status = we.eventType === 'refund.processed' ? 'PROCESSED'
                      : we.eventType === 'refund.failed' ? 'FAILED' : 'PENDING';
        await prisma.refund.update({
          where: { id: refund.id },
          data: {
            status,
            processedAt: status === 'PROCESSED' ? new Date() : null,
            failureReason: ent.notes?.failure_reason ?? null,
          },
        });
        if (status === 'PROCESSED') {
          await prisma.payment.update({
            where: { id: refund.paymentId },
            data: { status: 'REFUNDED' },
          });
          await enqueueNotification(/* bookingId via payment */, 'refund_completed');
        }
        break;
      }
      default:
        // ignore unhandled events but mark processed
        break;
    }
    await prisma.webhookEvent.update({ where: { id: we.id }, data: { processedAt: new Date() } });
  },
  { connection: redisConnection, concurrency: 4 },
);
```

### 9.7 Notification worker

- Queue `notifications`, separate process from API.
- Job: `{ bookingId, template, channel }`.
- Loads booking + user.
- Renders template.
- Calls channel adapter. On success → `Notification.status = SENT`. On failure → increment attempts, throw (BullMQ retries up to 5 with exponential backoff, then DLQ).

SMS template example (`templates/booking_confirmed.sms.ts`):

```ts
export function render(b: { code: string; pickup: string; drop: string; when: string }) {
  return `Aero Sarathi: Booking ${b.code} confirmed. ${b.pickup} -> ${b.drop} on ${b.when}. Track: aerosarathi.com/track/${b.code}`;
}
```

DLT template registered with MSG91 must exactly match, with variables in same positions.

Email uses React Email (`@react-email/components`) compiled to HTML at runtime — clean look, dark-mode safe.

### 9.8 PDF receipt

`pdfkit` (mature, no headless browser needed). Template includes:
- Logo (loaded from `packages/ui/assets/logo.png`).
- Booking code + status pill.
- Passenger info, pickup, drop, scheduled time, vehicle category.
- Fare breakdown (base, distance, time, night surcharge, total).
- Payment block: method, gateway payment id, captured at, amount paid.
- Cancellation block (if any) with fee + refund.
- Footer: GSTIN, company address, support email.

Cached to Redis after first generation; key invalidated on booking update.

---

## 10. Frontend Implementation (`apps/web`)

### 10.1 New / updated pages

```
apps/web/app/
├── book/
│   ├── pay/[code]/page.tsx        # NEW — opens Razorpay
│   └── confirmed/[code]/page.tsx  # NEW — success screen
├── account/
│   └── bookings/[id]/
│       ├── page.tsx               # UPDATED — adds cancel button, payments, receipt link
│       └── cancel/page.tsx        # NEW — review + confirm cancel
```

### 10.2 Razorpay Checkout integration

Razorpay's `checkout.js` is loaded *only* on `/book/pay/[code]`. Use `next/script` with `strategy="lazyOnload"`:

```tsx
'use client';
import Script from 'next/script';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

declare global { interface Window { Razorpay: any } }

export default function PayPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [intent, setIntent] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.post(`/bookings/by-code/${params.code}/payment/intent`, {}, {
      headers: { 'Idempotency-Key': `pay-${params.code}` },
    }).then((r) => setIntent(r.data)).catch((e) => setError(e.message));
  }, [params.code]);

  function openCheckout() {
    if (!intent || !window.Razorpay) return;
    setLoading(true);
    const rzp = new window.Razorpay({
      key: intent.razorpayKeyId,
      order_id: intent.razorpayOrderId,
      amount: intent.amount,
      currency: intent.currency,
      name: intent.name,
      description: intent.description,
      prefill: intent.prefill,
      notes: intent.notes,
      theme: { color: '#F48024' },
      retry: { enabled: false },
      modal: { ondismiss: () => setLoading(false) },
      handler: async (resp: any) => {
        try {
          await api.post(`/bookings/${intent.notes.bookingId}/payment/verify`, resp);
          router.replace(`/book/confirmed/${params.code}`);
        } catch (e: any) {
          setError('Verification failed. Refresh My Bookings to see latest status.');
        } finally { setLoading(false); }
      },
    });
    rzp.on('payment.failed', (resp: any) => {
      setLoading(false);
      setError(resp.error?.description ?? 'Payment failed');
    });
    rzp.open();
  }
  // ... render summary card + Pay button + error
}
```

**Why call `handler` AND rely on webhook:** the handler gives instant UX, but the webhook is the source of truth. If the handler never fires (user closes tab), the webhook still moves the booking to CONFIRMED within seconds. `/book/confirmed/[code]` polls `GET /bookings/by-code/:code` for up to 30s waiting for `status === 'CONFIRMED'`.

### 10.3 Cancellation UI

`/account/bookings/[id]/cancel`:
1. On mount: `GET /bookings/:id/cancel/preview`.
2. Show banner with `bucket`, `explanation`, fee, refund.
3. Reason textarea (required, ≥ 8 chars).
4. Two-button: "Keep booking" / "Cancel & refund ₹X".
5. On submit: `POST /bookings/:id/cancel` with `Idempotency-Key: cancel-{bookingId}`.
6. Success → toast + redirect to detail page showing cancellation status.

### 10.4 Confirmation screen polling

`/book/confirmed/[code]`:
- Reads booking.
- If `status === 'CONFIRMED'` → green check + "Receipt sent to phone & email" + "Download receipt" button.
- If `status === 'PENDING'` → spinner + "Confirming your payment…", polls every 2s up to 30s. On timeout → "Still processing. Check My Bookings shortly."

### 10.5 Receipt download

Anchor `<a href="/api/v1/bookings/:id/receipt" download>Download receipt (PDF)</a>`. Browser handles streaming.

---

## 11. External Service Setup

### 11.1 Razorpay
1. Sign up at razorpay.com with **Indo Chariot Pvt Ltd** PAN, GST, current account.
2. Complete KYC. While in review, Test Mode is fully usable.
3. Generate **Test Key + Secret** → store in 1Password, load into `dev`/`staging` env.
4. Generate **Webhook secret**; configure webhook URL:
   - Dev: `https://api-dev.aerosarathi.com/api/v1/webhooks/razorpay`
   - Prod: `https://api.aerosarathi.com/api/v1/webhooks/razorpay`
5. Subscribe to events: `payment.captured`, `payment.failed`, `payment.authorized`, `refund.created`, `refund.processed`, `refund.failed`.
6. Set "Active events sent only" = on.
7. Whitelist Razorpay IPs is **not** needed (signature is the security boundary), but blocking large bodies (>256KB) is.

### 11.2 SendGrid
1. Create account, verify sender domain `aerosarathi.com` (SPF + DKIM TXT records in DNS).
2. Generate API key with **Mail Send only** scope.
3. Create transactional templates if using their template engine; we use inline HTML from React Email so only the API key is needed.

### 11.3 MSG91 templates (Phase 2 additions)
Register 4 new DLT templates and obtain their IDs:
- `MSG91_TEMPLATE_BOOKING_CONFIRMED`: "Aero Sarathi: Booking {#var#} confirmed. {#var#} to {#var#} on {#var#}. Track: {#var#}"
- `MSG91_TEMPLATE_CANCELLATION`: "Aero Sarathi: Booking {#var#} cancelled. Refund of Rs.{#var#} will be processed in 5-7 days."
- `MSG91_TEMPLATE_REFUND`: "Aero Sarathi: Refund of Rs.{#var#} for booking {#var#} processed."
- `MSG91_TEMPLATE_PAYMENT_FAILED`: "Aero Sarathi: Payment for booking {#var#} failed. Please try again from My Bookings."

---

## 12. Local Development

### 12.1 docker-compose additions

```yaml
services:
  algo:
    build: ./apps/algo
    environment:
      INTERNAL_SHARED_SECRET: dev-internal-secret-32-chars-min
    ports: ["5000:5000"]
  # API gets `ALGO_BASE_URL=http://algo:5000` when run via docker
```

### 12.2 Razorpay test cards / UPI
- Card success: `4111 1111 1111 1111`, CVV `100`, any future expiry.
- Card failure: `5104 0600 0000 0008`.
- UPI success: `success@razorpay`.
- UPI failure: `failure@razorpay`.

### 12.3 Webhook testing locally
Use `ngrok` or `cloudflared` to tunnel localhost:
```powershell
cloudflared tunnel --url http://localhost:4000
```
Set the printed HTTPS URL in Razorpay Dashboard → Webhooks for the "dev-local" entry. **Never** point prod webhooks at a tunnel.

---

## 13. Testing Plan

### 13.1 Unit (Vitest)

| Spec | Cases ≥ |
|---|---|
| `razorpay.spec.ts` | 6 — verifyCheckoutSignature happy, tampered, length-diff timing, verifyWebhookSignature happy, wrong secret, raw-body type |
| `booking.transitions.spec.ts` | 8 — every allowed + 3 illegal transitions throw, idempotent same-state, concurrent-update via mock |
| `cancellation.algo.test.py` | 20 — every bucket boundary, exact 30 min, exact 24h, exact 6h, T=0, negative T, token=0 |
| `notif.template.spec.ts` | 4 — every template renders, escapes user input, length under DLT cap |

### 13.2 Integration (Supertest + Testcontainers)

- **Payment intent**: PENDING booking → intent → reuses existing on second call within 15 min → creates new after expiry.
- **Verify happy path**: simulates Razorpay handler payload (signature signed with test key) → booking CONFIRMED.
- **Verify bad signature**: returns 400, booking stays PENDING.
- **Webhook idempotency**: same `eventId` posted 3 times → only 1 `WebhookEvent` row, booking transitions once.
- **Webhook race vs handler**: handler verify + webhook arrive concurrently → only one transition (test with `Promise.all`).
- **Cancel preview** in every bucket (parameterized using fake clocks).
- **Cancel execute** in `PCT_25` → Cancellation row + Razorpay refund call mocked → Refund row created → on webhook `refund.processed` → Payment REFUNDED.
- **Cancel of already-cancelled**: returns existing, no new refund.
- **Cancel of COMPLETED**: 409.

### 13.3 E2E (Playwright)

- `pay-happy.spec.ts`: from a freshly created PENDING booking → click Pay → Razorpay test card → Confirmed screen renders within 10s → receipt link works.
- `pay-failed.spec.ts`: use failing card → error shown, booking still PENDING, Pay button re-enabled.
- `cancel-grace.spec.ts`: create booking < 30 min ago → cancel → full refund preview shown → confirm → status CANCELLED.
- `cancel-25pct.spec.ts`: with fake clock (test API endpoint `/test/clock` available only in dev) → cancel in 12h-to-trip window → 25% fee shown.

### 13.4 Acceptance criteria (all must pass)

- [ ] All unit + integration + E2E tests green.
- [ ] Razorpay test payment with UPI moves booking PENDING → CONFIRMED end-to-end through both client handler **and** webhook.
- [ ] SMS arrives at test phone within 60s of CONFIRMED (manual verification on staging).
- [ ] Email arrives in inbox (not spam) within 60s; DKIM and SPF pass (use `mail-tester.com`, score ≥ 8).
- [ ] PDF receipt opens in Chrome, Acrobat, and on iOS — all sections rendered.
- [ ] Cancellation refund appears in Razorpay dashboard with matching amount + booking code in notes.
- [ ] Replaying the same webhook payload 5 times causes exactly 1 state change.
- [ ] Killing the browser between Razorpay success and `/verify` call still results in CONFIRMED (webhook drives state).
- [ ] No raw OTP, signature, or webhook payload PII appears in app logs (grep CI check).
- [ ] Razorpay test-mode dashboard reconciles 1:1 with `Payment` rows for 10 test bookings.

---

## 14. Security Checklist (Phase 2 specific)

- [ ] Razorpay secret only in env; never sent to browser.
- [ ] Browser receives only `RAZORPAY_KEY_ID` (the public key id), never `KEY_SECRET`.
- [ ] Webhook signature verified with constant-time compare on **raw body** (no JSON parse before verify).
- [ ] Webhook endpoint excluded from JSON body parser; `express.raw()` cap at 256KB.
- [ ] Idempotency-Key required on `/payment/intent`, `/payment/verify`, `/cancel`.
- [ ] State transitions go through `transitionBooking()` only; no direct `prisma.booking.update({ status })` in business code (lint rule).
- [ ] `WebhookEvent.eventId` is unique → DB-enforced dedupe.
- [ ] Refund API calls authenticated with HTTP Basic (`key_id:secret`), TLS-only.
- [ ] PII in PDFs: passenger phone partially masked on visible page, full only in metadata for support.
- [ ] Email link to receipt is **not** in the email body (avoids token-in-URL leaks); users must log in.
- [ ] SendGrid API key scoped to Mail Send only.
- [ ] CSP updated: `frame-src https://api.razorpay.com https://checkout.razorpay.com; script-src ... https://checkout.razorpay.com`.
- [ ] Rate limit `/cancel`: 5 per booking per hour, 30 per user per day (prevents accidental retry loops).
- [ ] All payments + refunds logged to `audit_events` (Mongo) with before/after JSON.

---

## 15. Observability

New metrics:
- `payments_intent_total{result}`
- `payments_verified_total{result}` (success | bad_sig | gateway_pending)
- `payments_captured_total{method}` from webhook
- `webhook_events_received_total{type}`
- `webhook_processing_duration_seconds`
- `webhook_dlq_depth`
- `cancellations_total{bucket}`
- `refunds_initiated_total{status}`
- `notifications_sent_total{channel,template,result}`
- `notification_send_duration_seconds{channel}`

Alerts:
- Webhook processing p95 > 3s for 5 min → page on-call.
- Webhook DLQ depth > 5 → page on-call.
- Payment success rate (last 1h, ≥ 20 attempts) < 90% → page.
- Notification send failure rate > 10% over 15 min → page.
- Any `refund.failed` → immediate Slack to #aero-ops + admin alert.

Dashboards: "Payments funnel" (intent → checkout opened → verified → captured), "Cancellations & refunds", "Notification deliverability".

---

## 16. Deployment

### 16.1 Order of operations on release
1. Run DB migration first (additive only — safe to run before code).
2. Deploy `algo` (no client deps).
3. Deploy `api` (depends on algo) — uses zero-downtime swap.
4. Deploy `web`.
5. In Razorpay dashboard, enable new webhook events if not already.
6. Smoke test: POST a synthetic booking → pay test card → verify CONFIRMED → cancel.

### 16.2 Feature flags
- `PAYMENTS_ENABLED` env flag — when false, `/book/pay/[code]` shows "Coming soon" and `POST /payment/intent` returns 503. Lets us merge Phase 2 code to `main` without exposing partial flow.
- `EMAIL_ENABLED`, `SMS_ENABLED` per channel — allow disabling either during incidents without code changes.

---

## 17. Five-Day Plan

| Day | Owner | Tasks |
|---|---|---|
| Mon | BE | Migration `phase2_payments`. Razorpay wrapper. State machine + tests. `POST /payment/intent`. Mount webhook router with raw body. |
| Mon | FE | `/book/pay/[code]` skeleton with Razorpay script. Booking-summary card. |
| Mon | Algo | Cancellation domain + endpoint + 20 unit tests. Dockerfile. Wire into compose. |
| Tue | BE | `POST /payment/verify` (signature + Razorpay GET + transition + notif enqueue). Webhook worker for `payment.captured` / `failed`. |
| Tue | FE | Wire Razorpay handler → verify → confirmed page polling. `/book/confirmed/[code]`. |
| Wed | BE | Cancel preview + execute. Refund initiation. Webhook handlers for refund events. |
| Wed | FE | Cancellation page (preview → reason → confirm). My Bookings detail upgrades (payments list, refund status). |
| Wed | BE | Notification queue + workers (SMS, email). React Email templates. PDF receipt route + pdfkit template. |
| Thu | All | Integration & E2E test pass. Deploy to `dev`. Configure Razorpay test webhook to dev URL. Run reconciliation script over 10 test bookings. |
| Thu | DevOps | Add Prometheus metrics. Grafana dashboards. Alerts. Mail-tester score check. |
| Fri | All | QA on `staging` with finance team observer. Bug bash. Tag `v0.2.0-phase2`. Update [implementation.md](implementation.md) status. |

---

## 18. Risks (Phase 2)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Razorpay KYC pending blocks live mode | Medium | Cannot go to prod | Run entire Phase 2 in Test mode on `dev`/`staging`; KYC in parallel from Day 1 of Phase 0 |
| Webhook signature mismatch in prod due to body-parser order | Medium | All webhooks fail | Integration test specifically asserts raw body is preserved; deployment smoke test posts a signed test event |
| Duplicate captures (user double-clicks Pay) | Low | Double-charge | Razorpay rejects duplicate captures on same order; client disables Pay after first click; Idempotency-Key on verify |
| Refund stuck in PENDING for days | Medium | Customer complaint | Daily cron reconciles Razorpay refunds vs DB; admin alert on age > 48h |
| SendGrid emails to spam | Medium | UX | DMARC + SPF + DKIM verified Day 1; warm-up sending volume; mail-tester score gate in QA |
| MSG91 DLT template mismatch → all SMS fail | Medium | UX | Test send during deploy; template payload strictly matches DLT registration; CI lint compares template strings against registered variables |
| Currency rounding bug → off-by-1 paise | Low | Reconciliation noise | All money is integer paise; never float; specific unit test |
| Webhook flood (replay attack with valid sigs from leaked secret) | Low | Resource exhaustion | Rotate webhook secret quarterly; Postgres unique on eventId limits damage; rate-limit `/webhooks/razorpay` to 100 rps |

---

## 19. Deliverables Checklist

Code:
- [ ] Migration `phase2_payments` applied.
- [ ] `apps/algo` deployed and reachable from `api` only on internal network.
- [ ] `apps/api` exposes payment, webhook, cancel, receipt routes.
- [ ] `apps/web` ships pay / confirmed / cancel pages.
- [ ] Notification workers running as separate process.
- [ ] PDF receipt downloadable.

Ops:
- [ ] Razorpay test webhook configured for `dev` and `staging`.
- [ ] SendGrid domain authenticated; mail-tester ≥ 8.
- [ ] MSG91 templates 1–4 approved by telecom DLT and IDs in env.
- [ ] Grafana dashboards for payments, cancellations, notifications live.
- [ ] Daily refund reconciliation cron set up (`reconcile.refunds.cron.ts`).

Docs:
- [ ] OpenAPI updated with all new endpoints.
- [ ] `docs/runbooks/webhook-debugging.md` (how to replay a webhook from `WebhookEvent` table).
- [ ] `docs/runbooks/refund-stuck.md`.
- [ ] `docs/qa/cancellation-cases.md` with the 20 boundary cases.

---

## 20. Handoff to Phase 3

Phase 3 (Admin Panel v1) builds on the data shape produced here. Phase 2 contracts Phase 3 depends on:

- `Booking` carries `confirmedAt`, `cancelledAt` for filters.
- `Payment`, `Refund`, `Cancellation` rows exist and are queryable by `bookingId`.
- `BookingStatusEvent` records every transition for the admin timeline view.
- `WebhookEvent` retains raw payloads for admin debugging.
- `Notification` rows expose delivery status for the admin "comms" tab.
- `transitionBooking()` is the only authorised state mutator — admin actions will reuse it.

Open items pushed to Phase 3:
- Manual refund console (admin-initiated, partial amounts).
- Webhook replay UI (read from `WebhookEvent`, re-enqueue).
- Reconciliation report (Razorpay settlement vs `Payment` rows).

---

**End of Phase 2 document.**
