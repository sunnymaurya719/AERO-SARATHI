// Shared DTOs and enums used across API and web clients.
// Keep these in sync with the Prisma enums in @aero/db.

export type VehicleCategory = 'HATCHBACK' | 'SEDAN' | 'SUV' | 'LUXURY';

export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DRIVER_ASSIGNED'
  | 'EN_ROUTE'
  | 'ONGOING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export const VEHICLE_CATEGORIES: VehicleCategory[] = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'];

export interface Place {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

export interface QuoteRequest {
  pickup: Place;
  drop: Place;
  scheduledAt: string; // ISO
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

export interface FareOption {
  category: VehicleCategory;
  total: number;
  tokenAmount: number;
  balanceAmount: number;
  breakdown: FareBreakdown;
  /** Pre-surge total (present when surge applied). */
  baseTotal?: number;
  /** Surge multiplier applied to this option (1.0 = no surge). */
  surgeMultiplier?: number;
}

export interface QuoteSurgeInfo {
  multiplier: number;
  routeBucket: string;
  /** Human label, e.g. "1.3x — high demand". Empty when no surge. */
  label: string;
  ruleVersion: number | null;
}

export interface QuoteResponse {
  quoteId: string;
  distanceKm: number;
  durationMin: number;
  expiresAt: string;
  fares: FareOption[];
  surge?: QuoteSurgeInfo;
}

export interface AuthUser {
  id: string;
  phone: string;
  name: string | null;
}

export interface OtpRequestResponse {
  otpId: string;
  expiresInSec: number;
  channel: 'sms';
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface CreateBookingRequest {
  quoteId: string;
  vehicleCategory: VehicleCategory;
  passengerName: string;
  passengerPhone: string;
}

export interface BookingResponse {
  id: string;
  code: string;
  status: BookingStatus;
  scheduledAt: string;
  fareTotal: number;
  tokenAmount: number;
  balanceAmount: number;
  vehicleCategory: VehicleCategory;
  passengerName: string;
  passengerPhone: string;
  pickupAddress: string;
  dropAddress: string;
  estimatedKm: number;
  estimatedMin: number;
  createdAt: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: unknown[];
}

// ── Phase 2: Payments & Confirmation ──────────────────────────────────────

export type PaymentType = 'TOKEN' | 'BALANCE' | 'REFUND';
export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIAL_REFUNDED';
export type RefundStatus = 'CREATED' | 'PENDING' | 'PROCESSED' | 'FAILED';
export type CancelBucket = 'GRACE_30_MIN' | 'FLAT_200' | 'PCT_25' | 'PCT_50' | 'PCT_100' | 'NO_SHOW';

export interface PaymentIntentResponse {
  paymentId: string;
  razorpayKeyId: string;
  razorpayOrderId: string;
  amount: number; // paise
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string; email: string | null };
  notes: { bookingId: string; bookingCode: string };
}

export interface PaymentVerifyRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface PaymentVerifyResponse {
  booking: {
    id: string;
    code: string;
    status: BookingStatus;
    confirmedAt: string | null;
  };
}

export interface PaymentSummary {
  id: string;
  type: PaymentType;
  status: PaymentStatus;
  amount: number; // paise
  amountPaid: number; // paise
  method: string | null;
  capturedAt: string | null;
}

export interface CancellationPreview {
  eligible: boolean;
  reason?: string;
  bucket?: CancelBucket;
  feeAmount?: number; // paise
  refundAmount?: number; // paise
  explanation?: string;
  tokenPaid?: number; // paise
}

export interface CancelRequest {
  reason: string;
  confirm: true;
}

export interface CancellationSummary {
  bucket: CancelBucket;
  feeAmount: number;
  refundAmount: number;
  refundStatus: RefundStatus | null;
}

export interface BookingDetailResponse extends BookingResponse {
  confirmedAt: string | null;
  cancelledAt: string | null;
  payments: PaymentSummary[];
  cancellation: CancellationSummary | null;
  canCancel: boolean;
  cancellationPreview: CancellationPreview | null;
}

// ── Phase 3: Admin Panel ──────────────────────────────────────────────────

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPS' | 'FINANCE' | 'SUPPORT';
export type AdminStatus = 'ACTIVE' | 'DISABLED';
export type DriverStatus = 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING' | 'DISABLED';
export type DocType = 'LICENSE' | 'RC' | 'INSURANCE' | 'PUC' | 'PERMIT' | 'AADHAAR' | 'PAN' | 'OTHER';
export type VehicleOwnership = 'DRIVER' | 'COMPANY';
export type VehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

export const ADMIN_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'];

export interface AdminMe {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  totpEnabled: boolean;
}

export interface AdminLoginResponse {
  requires2fa: true;
  challengeId: string;
}

export interface AdminSessionInfo {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface DashboardKpis {
  bookingsCount: number;
  revenue: number; // paise
  cancellations: number;
  refundsAmount: number; // paise
  pendingAssignment: number;
}

export interface DashboardAlert {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  count?: number;
  entityId?: string;
}

export interface DashboardResponse {
  today: DashboardKpis;
  alerts: DashboardAlert[];
  queueDepth: { webhooks: number; notifications: number };
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminBookingRow {
  id: string;
  code: string;
  status: BookingStatus;
  scheduledAt: string;
  vehicleCategory: VehicleCategory;
  passengerName: string;
  passengerPhone: string; // masked
  pickupAddress: string;
  dropAddress: string;
  fareTotal: number;
  driverId: string | null;
  createdAt: string;
}

export interface AdminDriverRow {
  id: string;
  name: string;
  phone: string;
  licenseNo: string;
  homeCity: string;
  status: DriverStatus;
  rating: number | null;
  vehicleId: string | null;
}

export interface AdminVehicleRow {
  id: string;
  regNo: string;
  category: VehicleCategory;
  model: string;
  capacity: number;
  ownership: VehicleOwnership;
  status: VehicleStatus;
}

export interface FareRuleResponse {
  id: string;
  category: VehicleCategory;
  baseFare: number;
  baseKm: number;
  perKm: number;
  perMin: number;
  nightSurcharge: number;
  minFare: number;
  tokenPercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  supersededBy: string | null;
  notes: string | null;
}

export interface AdminRefundRow {
  id: string;
  paymentId: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  gatewayRefundId: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: AdminStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface AuditEventRow {
  id: string;
  action: string;
  actorId: string;
  actorEmail?: string;
  entityType: string;
  entityId: string;
  reason?: string;
  at: string;
}

// ── Phase 4: Assignment Automation & Driver Portal ─────────────────────────

export type DriverAvailability = 'OFFLINE' | 'ONLINE' | 'BUSY';

export type OfferStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';

export type AttemptOutcome =
  | 'POOL_EMPTY'
  | 'OFFER_SENT'
  | 'ALL_DECLINED'
  | 'ACCEPTED'
  | 'ABORTED';

export type AlertType =
  | 'UNASSIGNED_T_MINUS_30'
  | 'POOL_EMPTY'
  | 'DRIVER_NO_SHOW'
  | 'REFUND_STUCK'
  | 'DOC_EXPIRY'
  | 'WEBHOOK_DLQ'
  | 'SOS_TRIGGERED'
  | 'TRIP_FRAUD_REVIEW'
  | 'TRIP_STALE';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type AlertStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

/** Weighting + penalty inputs to the matching score (sum of weights = 1.0). */
export interface MatchingWeights {
  distance: number;
  rating: number;
  idle: number;
  home: number;
  history: number;
}

export interface ScoreBreakdown {
  proximity: number;
  rating: number;
  idle: number;
  home: number;
  history: number;
  penaltyRecentDecline: number;
}

export interface RankedCandidate {
  driverId: string;
  score: number; // 0..100
  breakdown: ScoreBreakdown;
}

/** Driver-facing self profile. */
export interface DriverMe {
  id: string;
  name: string;
  phone: string;
  homeCity: string;
  rating: number | null;
  availability: DriverAvailability;
  status: string;
  acceptanceRate: number;
  vehicle: {
    id: string;
    regNo: string;
    category: VehicleCategory;
    model: string;
  } | null;
  documents: DriverDocStatus[];
}

export interface DriverDocStatus {
  type: string;
  verified: boolean;
  expiresAt: string | null;
  expired: boolean;
  expiringSoon: boolean; // within 14 days
}

/** A live offer shown on the driver portal. */
export interface DriverOfferView {
  id: string;
  bookingCode: string;
  status: OfferStatus;
  offeredAt: string;
  expiresAt: string;
  pickupAddress: string;
  dropAddress: string;
  scheduledAt: string;
  estimatedKm: number;
  estimatedMin: number;
  fareToDriver: number; // paise (balanceAmount in Phase 4)
}

/** Read-only trip row in the driver portal. */
export interface DriverTripRow {
  id: string;
  code: string;
  status: BookingStatus;
  scheduledAt: string;
  pickupAddress: string;
  dropAddress: string;
  passengerName: string;
  passengerPhoneMasked: string;
}

export interface SystemAlertRow {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  ackedById: string | null;
  ackedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AssignmentAttemptRow {
  id: string;
  attemptNumber: number;
  triggeredAt: string;
  outcome: AttemptOutcome;
  reason: string | null;
  candidatePool: RankedCandidate[];
}

export interface AssignmentOfferRow {
  id: string;
  driverId: string;
  driverName: string;
  attemptNumber: number;
  score: number;
  status: OfferStatus;
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  responseReason: string | null;
}

// ── Phase 5: Live Tracking ─────────────────────────────────────────────────

export type TripReviewStatus = 'NONE' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type SosActor = 'PASSENGER' | 'DRIVER' | 'ADMIN';

/** A single GPS ping emitted by the driver client over the `/driver` socket. */
export interface LocationPing {
  bookingId: string;
  clientSeq: number;
  ts: string; // ISO
  lat: number;
  lng: number;
  accuracyM: number;
  speedKmh: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  batteryPct: number | null;
  source: 'gps' | 'wifi' | 'network' | 'unknown';
}

/** Trimmed location broadcast to passenger/track rooms (no driver PII). */
export interface PublicLocation {
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedKmh: number | null;
  ts: string; // ISO
}

/** ETA payload broadcast to passenger/track rooms. */
export interface EtaUpdate {
  phase: 'to_pickup' | 'to_drop';
  minutes: number;
  approx: boolean;
  computedAt: string; // ISO
}

/** Status pill stages for the passenger tracking page. */
export type TrackStage = 'assigned' | 'en_route' | 'arrived' | 'ongoing' | 'completed';

/** Snapshot returned by `GET /tracking/:code/snapshot` (WS fallback). */
export interface TrackSnapshot {
  code: string;
  stage: TrackStage;
  status: BookingStatus;
  scheduledAt: string;
  pickup: { address: string; lat: number; lng: number };
  drop: { address: string; lat: number; lng: number };
  driver: {
    name: string;
    phoneMasked: string;
    carModel: string | null;
    plate: string | null;
  } | null;
  location: PublicLocation | null;
  eta: EtaUpdate | null;
  ended: boolean;
  summary: TripSummary | null;
}

/** Encoded-polyline route for the tracking map. */
export interface TrackRoute {
  polyline: string; // Google encoded polyline
  distanceKm: number;
  durationMin: number;
}

export interface TripSummary {
  actualKm: number | null;
  actualMin: number | null;
  estimatedKm: number;
  estimatedMin: number;
  topSpeedKmh: number | null;
  completedAt: string | null;
}

/** Full trip snapshot returned by the driver run screen endpoints. */
export interface DriverTripDetail {
  id: string;
  code: string;
  status: BookingStatus;
  stage: TrackStage;
  scheduledAt: string;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pickup: { address: string; lat: number; lng: number };
  drop: { address: string; lat: number; lng: number };
  passengerName: string;
  passengerPhoneMasked: string;
  trackUrl: string | null;
  trip: {
    totalKm: number | null;
    totalMin: number | null;
    pingCount: number;
  } | null;
}

export interface FraudFlag {
  type: string;
  detail: string;
  weight: number;
}

export interface SosEventRow {
  id: string;
  bookingId: string;
  bookingCode: string;
  triggeredBy: SosActor;
  lat: number | null;
  lng: number | null;
  message: string | null;
  ackedById: string | null;
  ackedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** Active trip row for the admin live map. */
export interface LiveTripRow {
  bookingId: string;
  code: string;
  driverId: string;
  driverName: string;
  status: BookingStatus;
  location: PublicLocation | null;
}

