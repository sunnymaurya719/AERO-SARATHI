import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MONGO_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2_592_000),

  GOOGLE_MAPS_API_KEY: z.string().default(''),
  GOOGLE_DIRECTIONS_CACHE_TTL: z.coerce.number().default(3600),

  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_OTP_TEMPLATE_ID: z.string().default(''),
  MSG91_SENDER_ID: z.string().default('AEROSR'),
  MSG91_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  MIN_LEAD_TIME_MIN: z.coerce.number().default(120),
  MAX_LEAD_TIME_DAYS: z.coerce.number().default(90),
  QUOTE_TTL_MIN: z.coerce.number().default(15),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  PAYMENT_INTENT_TTL_MIN: z.coerce.number().default(15),

  // SendGrid (transactional email)
  SENDGRID_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Aero Sarathi <bookings@aerosarathi.com>'),

  // MSG91 transactional template IDs (Phase 2)
  MSG91_TEMPLATE_BOOKING_CONFIRMED: z.string().default(''),
  MSG91_TEMPLATE_CANCELLATION: z.string().default(''),
  MSG91_TEMPLATE_REFUND: z.string().default(''),
  MSG91_TEMPLATE_PAYMENT_FAILED: z.string().default(''),

  // Notification bypass for local dev (logs instead of sending)
  NOTIFY_BYPASS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Public base URLs (used in SMS/email links)
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),

  // ── Phase 3: Admin Panel ──
  ADMIN_PANEL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ADMIN_SESSION_TTL_SEC: z.coerce.number().default(43_200), // 12h absolute
  ADMIN_SESSION_IDLE_SEC: z.coerce.number().default(1_800), // 30 min idle
  ADMIN_PASSWORD_PEPPER: z.string().default(''), // base64, appended before hashing
  ADMIN_TOTP_ISSUER: z.string().default('Aero Sarathi'),
  ADMIN_LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  ADMIN_LOCK_MINUTES: z.coerce.number().default(15),
  ADMIN_IP_ALLOWLIST: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADMIN_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3001')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ADMIN_INVITE_TTL_HOURS: z.coerce.number().default(48),
  ADMIN_PUBLIC_URL: z.string().default('http://localhost:3001'),

  // S3 / Hetzner Object Storage (driver documents)
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('fsn1'),
  S3_BUCKET: z.string().default('aero-driver-docs-local'),
  S3_KEY: z.string().default(''),
  S3_SECRET: z.string().default(''),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // SendGrid admin invite template
  SENDGRID_TEMPLATE_ADMIN_INVITE: z.string().default(''),

  // ── Phase 4: Assignment Automation & Driver Portal ──
  ASSIGNMENT_AUTOMATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DRIVER_PORTAL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ASSIGNMENT_LEAD_HOURS: z.coerce.number().default(3),
  ASSIGNMENT_RETRY_MIN: z.coerce.number().default(5),
  ASSIGNMENT_CUTOFF_MIN: z.coerce.number().default(30),
  ASSIGNMENT_MAX_ATTEMPTS: z.coerce.number().default(30),
  OFFER_TTL_SEC: z.coerce.number().default(60),
  OFFER_TTL_SHORT_SEC: z.coerce.number().default(30),
  OFFER_TTL_VERY_SHORT_SEC: z.coerce.number().default(20),
  POOL_TOP_N: z.coerce.number().default(5),
  DRIVER_HEARTBEAT_TTL_SEC: z.coerce.number().default(90),

  // FCM (Firebase Cloud Messaging — web push)
  FCM_PROJECT_ID: z.string().default(''),
  FCM_PRIVATE_KEY: z.string().default(''),
  FCM_CLIENT_EMAIL: z.string().default(''),

  // Slack ops alerts
  SLACK_OPS_CHANNEL: z.string().default('#aero-ops'),
  SLACK_BOT_TOKEN: z.string().default(''),
  OPS_ALERT_EMAIL: z.string().default('ops@aerosarathi.com'),

  // Realtime (Socket.io)
  SOCKET_IO_PATH: z.string().default('/realtime'),

  // Driver portal public base URL (used in offer SMS deep links)
  DRIVER_PUBLIC_URL: z.string().default('http://localhost:3002'),
  DRIVER_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3002')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // MSG91 Phase 4 DLT templates
  MSG91_TEMPLATE_DRIVER_OFFER: z.string().default(''),
  MSG91_TEMPLATE_DRIVER_ASSIGNMENT_CONFIRMED: z.string().default(''),
  MSG91_TEMPLATE_DRIVER_TRIP_CANCELLED: z.string().default(''),
  MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED: z.string().default(''),
  MSG91_TEMPLATE_PASSENGER_T_MINUS_30: z.string().default(''),
  MSG91_TEMPLATE_PASSENGER_NO_DRIVER: z.string().default(''),
  MSG91_TEMPLATE_PASSENGER_DRIVER_REASSIGNED: z.string().default(''),

  // Internal service-to-service auth (assignment internal endpoints)
  INTERNAL_AUTH_SECRET: z.string().default(''),
  TEST_CLOCK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ── Phase 5: Live Tracking ──
  TRACKING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SOS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  FRAUD_AUTO_REVIEW: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // 32+ byte secret for HMAC-signing shareable /track links.
  TRACK_LINK_SECRET: z.string().default('dev-track-link-secret-change-me-32bytes!!'),
  TRACK_LINK_DEFAULT_TTL_HOURS: z.coerce.number().default(24),
  PASSENGER_NS_PATH: z.string().default('/passenger'),
  TRACK_NS_PATH: z.string().default('/track'),
  // ETA recompute cadence (seconds) — slows down with fewer active trips.
  ETA_TICK_BASE_SEC: z.coerce.number().default(60),
  ETA_TICK_BUSY_SEC: z.coerce.number().default(30),
  ETA_TICK_HOT_SEC: z.coerce.number().default(15),
  ETA_DAILY_BUDGET_INR: z.coerce.number().default(2500),
  ETA_DIRECTIONS_UNIT_INR: z.coerce.number().default(0.4),
  // Fraud thresholds.
  FRAUD_FLAG_REVIEW_THRESHOLD: z.coerce.number().default(0.6),
  FRAUD_FLAG_HOLD_THRESHOLD: z.coerce.number().default(0.85),
  // Browser-restricted Maps key (passenger page). Distinct from the server key.
  GOOGLE_MAPS_BROWSER_KEY: z.string().default(''),
  // Ride-log raw ping retention.
  RIDE_LOG_TTL_DAYS: z.coerce.number().default(90),
  // Trip lifecycle start window relative to scheduledAt (minutes).
  TRIP_START_EARLY_MIN: z.coerce.number().default(60),
  TRIP_START_LATE_MIN: z.coerce.number().default(120),
  // Passenger-facing public web base (the /track host).
  PUBLIC_TRACK_URL: z.string().default('http://localhost:3000'),

  // ── Phase 6: Intelligence Layer ──
  // Track A — Pricing / surge
  SURGE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SURGE_SHADOW_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SURGE_GLOBAL_CAP: z.coerce.number().default(1.8),
  SURGE_FLOOR: z.coerce.number().default(1.0),
  DEMAND_WINDOW_MIN: z.coerce.number().default(30),
  SUPPLY_REFRESH_SEC: z.coerce.number().default(60),
  // Track C — Wallet / ledger
  WALLET_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  WALLET_HOLD_TTL_MIN: z.coerce.number().default(20),
  // Track D — Referrals
  REFERRAL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  REFERRAL_REFERRER_REWARD_PAISE: z.coerce.number().default(10_000), // ₹100
  REFERRAL_REFEREE_REWARD_PAISE: z.coerce.number().default(10_000),
  REFERRAL_MONTHLY_CAP: z.coerce.number().default(20),
  // Reviews / rating
  REVIEWS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RATING_SMOOTHING_C: z.coerce.number().default(20),
  RATING_GLOBAL_MEAN: z.coerce.number().default(4.6),
  RATING_LOW_THRESHOLD: z.coerce.number().default(3.5),
  REVIEW_WINDOW_DAYS: z.coerce.number().default(7),
  // EMI / earnings / commission
  DEFAULT_COMMISSION_RATE: z.coerce.number().default(0.15),
  // Analytics / reports
  ANALYTICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // ── Phase 7: Mobile Apps ──
  // In-trip chat (WS + Mongo) and Exotel masked calling.
  CHAT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  CHAT_MAX_LEN: z.coerce.number().default(500),
  CHAT_READONLY_AFTER_HOURS: z.coerce.number().default(24),
  CALLS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Exotel click-to-call / number masking.
  EXOTEL_SID: z.string().default(''),
  EXOTEL_API_KEY: z.string().default(''),
  EXOTEL_API_TOKEN: z.string().default(''),
  EXOTEL_SUBDOMAIN: z.string().default('api.exotel.com'),
  EXOTEL_CALLER_ID: z.string().default(''), // ExoPhone (virtual number)
  EXOTEL_WEBHOOK_ALLOWLIST: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  CALL_RATE_LIMIT_PER_HOUR: z.coerce.number().default(10),
  // Mobile config / force-update fallbacks (used when no AppVersionPolicy row exists).
  MOBILE_PASSENGER_MIN_VERSION: z.string().default('0.7.0'),
  MOBILE_PASSENGER_LATEST_VERSION: z.string().default('0.7.0'),
  MOBILE_DRIVER_MIN_VERSION: z.string().default('0.7.0'),
  MOBILE_DRIVER_LATEST_VERSION: z.string().default('0.7.0'),
  MOBILE_MAINTENANCE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ── Phase 8 — Workstream B: Multi-City ──
  MULTI_CITY_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DEFAULT_CITY_CODE: z.string().default('CHD'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast on boot with a readable error.
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
