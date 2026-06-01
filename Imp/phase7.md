# Phase 7 — Mobile Apps (React Native CLI) (Weeks 11–16)

**Parent document:** [implementation.md](implementation.md)
**Previous phases:** [phase1.md](phase1.md) · [phase2.md](phase2.md) · [phase3.md](phase3.md) · [phase4.md](phase4.md) · [phase5.md](phase5.md) · [phase6.md](phase6.md)
**Phase status:** Not started
**Duration:** 6 weeks (30 working days)
**Prereq:** Phases 1–6 complete — full REST + WS API, payments, assignment, live tracking, wallet/referrals/reviews all live. The mobile apps are **new clients on the existing backend**, not new backend.

> **Stack decision (locked):** **React Native CLI (bare workflow)** — NOT Expo. We need unrestricted native modules (background geolocation with a foreground service, native FCM/APNs, native Razorpay SDK, call-masking SDK, custom MapView) and full control over `android/` and `ios/` projects. Expo's managed workflow and even prebuild/dev-client add friction for the background-location foreground-service work that is the entire point of this phase. We own the native projects directly.

---

## 1. Phase Goal

Ship two production native apps to the Play Store and App Store:

- **Aero Sarathi (Passenger)** — book, pay, track live, wallet, referrals, reviews, trip history, chat with driver.
- **Aero Sarathi Driver** — go online, receive offers as native push (even when app is backgrounded/killed), navigate, run trip lifecycle, stream **background GPS** reliably, see earnings/EMI/rating.

The headline win over the Phase 5 web tracker: **reliable background location**. A web tab cannot stream GPS when minimized; a native Android **foreground service** + iOS **background location mode** can. This makes the driver experience trustworthy and the passenger map smooth even while the driver uses Google Maps for navigation.

**Definition of "done" for Phase 7:**
> A driver installs the Driver app, logs in via OTP, taps "Go Online", locks their phone, and opens Google Maps to navigate. Their location keeps streaming via a persistent foreground-service notification. A new ride offer arrives as a full-screen native push with sound even though the app is backgrounded; they Accept from the notification. The passenger, on the native passenger app, watches the car move smoothly, chats "I'm at gate 2", taps to call the driver through a **masked number**, pays the balance via the native Razorpay sheet, and rates the trip. Both apps are live on both stores, crash-free rate > 99.5%.

---

## 2. Scope

### In scope
- Two RN CLI apps in the monorepo: `apps/mobile-passenger`, `apps/mobile-driver`, sharing `packages/mobile-shared` (API SDK, auth, design tokens, types).
- Auth: phone + OTP (reuse Phase 1 flow), secure token storage (Keychain/Keystore), biometric unlock (optional).
- Passenger: quote (surge-aware), book, native Razorpay checkout, wallet apply, live tracking (native MapView), chat, masked call, trip history, referrals, reviews, notification centre, profile.
- Driver: OTP login + role check, online/offline toggle, **background GPS foreground service**, native offer push (full-screen, actionable), accept/decline, trip lifecycle (start/arrive/begin/complete/no-show), navigate handoff to Google/Apple Maps, earnings, EMI, rating, document re-upload.
- Push: **native FCM (Android)** + **APNs via FCM (iOS)**; new `DeviceToken` table for customers; reuse `DriverFcmToken` extended for native.
- Background location: Android foreground service (`FOREGROUND_SERVICE_LOCATION`), iOS `UIBackgroundModes: location` + significant-change + standard updates while on-trip.
- In-trip **chat** (text) over WS — deferred from Phase 5/6, lands here.
- **Call masking** via Exotel (number-masking bridge) — driver and passenger never see each other's real number.
- Deep links + universal links / app links (open `track` link, referral codes, booking detail).
- App-install attribution for referrals (deferred from Phase 6).
- OTA-style JS updates via **CodePush (App Center / self-hosted)** for non-native fixes (native changes still require store submission).
- CI/CD: Fastlane lanes, signed builds, store submission; crash reporting (Sentry RN) + analytics.
- Force-update gate (min supported version) + maintenance mode.

### Explicitly OUT of scope (deferred to Phase 8)
- ML demand forecasting / multi-city / corporate / EV — Phase 8.
- Automated payout rails — Phase 8.
- Tablet/large-screen layouts.
- Apple CarPlay / Android Auto.
- Offline-first booking (we require connectivity to book).
- Voice/video calling (we mask PSTN calls only, not VoIP).
- Web app retirement — web (Phases 1–6) continues to run in parallel; the `/track` web link stays for family who don't install.

---

## 3. User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-7.1 | passenger | book and pay entirely in the app | it's faster than the website |
| US-7.2 | passenger | watch my driver smoothly even when they navigate | I trust the ETA |
| US-7.3 | passenger | chat and call my driver without sharing my number | I coordinate pickup privately |
| US-7.4 | passenger | get a push when the driver arrives | I don't stare at the screen |
| US-7.5 | driver | receive offers as push even if the app is closed | I never miss a ride |
| US-7.6 | driver | keep sending location with my phone locked | the passenger always sees me |
| US-7.7 | driver | see a persistent notification when I'm online | I know tracking is active and it won't be killed |
| US-7.8 | driver | jump to Google Maps for turn-by-turn | I navigate with what I know |
| US-7.9 | both | be forced to update when a version is unsafe | the platform stays consistent |
| US-7.10 | platform | push JS bug fixes without a store review | I fix issues fast |

---

## 4. Architecture Slice for Phase 7

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  apps/mobile-passenger (RN)   │     │  apps/mobile-driver (RN)      │
│  - quote/book/pay (Razorpay)  │     │  - online toggle              │
│  - native MapView tracking    │     │  - FG-service background GPS  │
│  - chat + masked call         │     │  - native offer push (accept) │
│  - wallet/referral/reviews    │     │  - trip lifecycle + nav handoff│
│  - FCM/APNs push              │     │  - earnings/EMI/rating         │
└──────────────┬────────────────┘     └───────────────┬───────────────┘
               │                                       │
               │  packages/mobile-shared (SDK/auth/types/tokens)
               │                                       │
               ▼  HTTPS REST + WSS (same API as web)   ▼
┌───────────────────────────────────────────────────────────────────┐
│  API (apps/api)  — NO new business logic, only:                     │
│   + DeviceToken (customer push)                                     │
│   + chat module (messages over /passenger & /driver WS + persist)   │
│   + call-mask module (Exotel click-to-call bridge + webhook)        │
│   + mobile config endpoint (min version, feature flags, force-update)│
└───┬──────────┬───────────┬───────────┬──────────────────────────────┘
    │          │           │           │
    ▼          ▼           ▼           ▼
  FCM/APNs   Exotel     Razorpay     Sentry + analytics
  (push)     (call mask) (native SDK) (crash/usage)
```

The backend changes are intentionally tiny: chat, call-masking bridge, device tokens, and a mobile-config endpoint. Everything else the apps consume already exists from Phases 1–6.

---

## 5. Monorepo Layout & Tooling

```
apps/
  mobile-passenger/
    android/                 # owned native project (Gradle)
    ios/                     # owned native project (CocoaPods)
    src/
      app/                   # navigation (React Navigation), screens
      features/{booking,tracking,wallet,chat,referrals,reviews,profile}
      native/                # native module bridges (geo, push, razorpay, exotel)
      App.tsx
    fastlane/
    .env.*                   # react-native-config
  mobile-driver/
    android/ ios/ src/ fastlane/
packages/
  mobile-shared/             # API SDK (typed), auth/token store, design tokens, shared hooks, zod schemas
  types/                     # already shared with web (Phase 0)
```

Tooling (locked):
- **React Native CLI** (bare). RN latest stable (0.7x), Hermes engine on, New Architecture (Fabric/TurboModules) enabled where libs support it; fallback to old arch if a critical lib lags.
- **TypeScript strict**.
- **React Navigation** (native-stack) for routing.
- **Zustand** + **TanStack Query** (same patterns as web → shared hooks where possible).
- **react-native-config** for env per scheme (dev/staging/prod).
- **Build flavors / schemes:** Android product flavors `dev|staging|prod`; iOS schemes + xcconfig. Separate bundle IDs (`com.aerosarathi.passenger.dev` etc.) so all three installable side by side.
- **pnpm** workspace; Metro configured for monorepo (watchFolders + symlink resolution); separate from Turborepo web build but wired into the same repo CI.

Key native libraries:
| Concern | Library |
|---|---|
| Maps | `react-native-maps` (Google provider both platforms) |
| Background geolocation | `react-native-background-geolocation` (transistorsoft) — robust FG service + iOS modes; or community `@react-native-community/geolocation` + custom FG service. **Decision: transistorsoft** for reliability (licensed). |
| Push | `@react-native-firebase/app` + `/messaging` (FCM; APNs via FCM) |
| Notifications display | `notifee` (full-screen, actions, channels, foreground service notif) |
| Payments | `react-native-razorpay` (official) |
| Secure storage | `react-native-keychain` |
| Crash/perf | `@sentry/react-native` |
| OTA | `react-native-code-push` (App Center or self-hosted server) |
| Deep links | React Navigation linking + native AppLinks/Universal Links |
| Device id | `react-native-device-info` |

---

## 6. Shared SDK (`packages/mobile-shared`)

- **Typed API client** generated from the same OpenAPI used by web (so request/response types can't drift).
- **Auth/token store**: access + refresh in Keychain/Keystore (NOT AsyncStorage). Silent refresh interceptor (reuse the Phase 1 refresh-rotation contract: opaque refresh hashed server-side). Auto-logout on refresh failure.
- **WS client**: wraps socket.io with auth + reconnection; exposes typed event hooks (`useDriverOffers`, `useTripLocation`, `useChat`).
- **Design tokens**: same orange `#F48024` / navy `#1E2D5A`, Rajdhani + DM Sans (bundled font files). A small RN component kit (Button, Card, Sheet, StatusPill) mirroring `packages/ui` semantics.
- **Shared hooks**: `useQuote`, `useBooking`, `useWallet`, `useNotifications` — same query keys/semantics as web.

---

## 7. Driver App — Background Location (the hard part)

### 7.1 Android foreground service

- Permissions: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` (Android 10+), `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (Android 14+), `POST_NOTIFICATIONS` (Android 13+).
- When driver taps **Go Online**: request foreground location → then background location (separate OS prompt with rationale screen) → start `react-native-background-geolocation` with a **persistent foreground-service notification** ("Aero Sarathi is sharing your location — you're Online").
- Config: `desiredAccuracy: HIGH`, `distanceFilter: 20m` while idle/online, switch to **time-based 5s** while on an active trip (`EN_ROUTE|ONGOING`), `stopOnTerminate: false`, `startOnBoot: false` (we don't auto-start on reboot; driver must re-go-online), `enableHeadless: true` so pings continue if JS is torn down.
- Battery: motion-activity detection downshifts to distance-filter when stationary; heartbeat to server every 30s (reuse Phase 4 Redis TTL contract).
- OEM kill mitigation: detect aggressive OEMs (Xiaomi/Oppo/Vivo) and show a one-time "disable battery optimization for Aero" guide deep-linking to the OS setting.

### 7.2 iOS background location

- `UIBackgroundModes: location`. `NSLocationAlwaysAndWhenInUseUsageDescription` + `NSLocationWhenInUseUsageDescription` with clear copy.
- Use standard location updates with `allowsBackgroundLocationUpdates = true` and `pausesLocationUpdatesAutomatically = false` while on trip; significant-change + region monitoring as a wake mechanism when only "online" (not on trip) to save battery.
- The blue status bar indicator is expected and explained to drivers during onboarding.

### 7.3 Ping transport

- Same `location:ping` WS event as Phase 5 (`socket.volatile.emit`), plus the REST fallback `POST /driver/trips/:id/ping`.
- Headless/native pings (when JS engine is paused) go through the background-geolocation library's native HTTP feature directly to the REST `ping` endpoint with the stored auth token — so location flows even when React isn't running.
- Server side unchanged (Phase 5 ingest pipeline already validates/clamps/dedupes by `clientSeq`).

---

## 8. Driver App — Offers via Native Push

### 8.1 Push delivery

- Phase 4 already sends FCM Web push + Socket.io + SMS in parallel. Phase 7 adds **native FCM data messages** to the driver's `DriverFcmToken` (now native tokens).
- A **high-priority data message** wakes the app; `notifee` renders a **full-screen intent** notification (Android `fullScreenIntent` + a high-importance channel with custom sound + vibration) so an offer interrupts like a call. iOS uses a time-sensitive notification + critical alert entitlement (if approved) or a loud custom sound.
- Notification has **Accept / Decline** actions handled in a background handler → calls the existing `POST /driver/offers/:id/accept|decline`. SMS remains the source-of-truth fallback (Phase 4 contract unchanged).

### 8.2 Offer screen

- Tapping the notification (or accept from it) opens the full-screen offer UI: route, fare, pickup distance, scheduled time, **countdown ring** (reuse Phase 4 60s TTL, server-authoritative).
- Foreground socket `/driver` event still drives the live countdown when the app is open; push covers the closed/background case.
- Token registration: on login + on token refresh, `POST /driver/fcm-tokens` (upsert, platform, appVersion). Stale token cleanup on FCM `messaging/registration-token-not-registered`.

---

## 9. Passenger App — Tracking, Chat, Masked Call, Pay

### 9.1 Native live tracking
- `react-native-maps` with Google provider; same data contract as Phase 5 `/passenger` WS room (joined with JWT, not the public HMAC link — the app is authenticated).
- Smooth marker animation via `AnimatedRegion.timing` (1s) between pings; rotate car by heading.
- ETA from the Phase 5 `eta` event; status timeline; SOS button (reuse Phase 5 endpoint).

### 9.2 In-trip chat (new backend module)
- WS-based text chat scoped to a booking, available `DRIVER_ASSIGNED → COMPLETED`.
- `Message` persisted in Postgres (small) or Mongo `chat_messages` (chosen: **Mongo** to match ride_logs pattern and high write volume tolerance), delivered over the existing `/passenger` and `/driver` namespaces (`chat:message` event), with push fallback when recipient offline.
- Quick-replies ("I'm here", "5 min away", "At gate 2") to reduce typing while driving (driver side shows only quick-replies + voice-to-text, no free keyboard while moving — safety).
- Read receipts + unread badge. Chat auto-closes (read-only) 24h after completion.

```js
// Mongo chat_messages
{ bookingId, fromRole:'PASSENGER'|'DRIVER', fromId, text, ts, readAt }
```

### 9.3 Masked call (Exotel)
- New `call-mask` module: `POST /api/v1/calls/connect { bookingId }` → server validates caller is a party on an active booking → calls Exotel click-to-call/number-masking API to bridge the two numbers via an Exotel virtual number. Neither party sees the other's real number.
- Exotel status webhook → `POST /api/v1/webhooks/exotel` records call attempt/duration in Mongo `call_logs` (audit + dispute resolution). Signature/IP allowlist verified.
- Rate-limited; only allowed while booking is active; logged.
- Fallback: if Exotel fails, show masked-call-unavailable + offer in-app chat.

### 9.4 Native payments
- `react-native-razorpay` opens the official native checkout sheet for the Phase 2 balance/token. Order created server-side (Phase 2 `create order` unchanged); signature verified server-side (unchanged). Wallet apply (Phase 6) supported before launching Razorpay; if wallet covers full amount, skip the sheet.
- Handles UPI intent apps (GPay/PhonePe/Paytm) natively — big conversion win over web.

---

## 10. Backend Additions (small, additive)

```prisma
model DeviceToken {            // customer push (mirrors DriverFcmToken)
  id         String   @id @default(uuid())
  userId     String
  token      String   @unique
  platform   DevicePlatform   // ANDROID | IOS
  appVersion String
  lastSeenAt DateTime @default(now())
  createdAt  DateTime @default(now())
  @@index([userId])
}

model CallLog {
  id          String   @id @default(uuid())
  bookingId   String
  fromRole    String
  exotelSid   String?
  status      String          // initiated | ringing | completed | failed
  durationSec Int?
  createdAt   DateTime @default(now())
  @@index([bookingId])
}

model AppVersionPolicy {
  id            String   @id @default(uuid())
  platform      DevicePlatform
  app           String          // "passenger" | "driver"
  minSupported  String          // semver; below → force update
  latest        String
  maintenance   Boolean  @default(false)
  message       String?
  updatedAt     DateTime @updatedAt
  @@unique([platform, app])
}
```

New endpoints:
```
POST /api/v1/device-tokens            # customer push register/upsert
POST /api/v1/driver/fcm-tokens        # extend Phase 4 for native tokens
GET  /api/v1/mobile/config?app=&platform=&version=   # min-version, flags, maintenance
POST /api/v1/calls/connect            # masked call bridge
POST /api/v1/webhooks/exotel          # call status (signed/allowlisted)
# chat over WS: event chat:message on /passenger & /driver; GET /api/v1/bookings/:id/messages (history)
GET  /api/v1/bookings/:id/messages
```

Chat + calls are the only meaningful new server logic; the rest is config + token plumbing. `chat_messages` and `call_logs` are Mongo collections; `DeviceToken`/`CallLog`/`AppVersionPolicy` are Postgres.

---

## 11. Push, Deep Links, Force-Update

### 11.1 Push channels
- Android notification channels: `offers` (max importance, custom sound, full-screen), `trip` (high), `chat` (high), `promos` (low), `tracking_service` (none — silent FG-service channel).
- iOS: APNs via FCM; request provisional auth for promos, explicit for offers/trip; time-sensitive interruption level for offers.

### 11.2 Deep links / app links
- Scheme `aerosarathi://` + Universal Links (`https://aerosarathi.com/...`) and Android App Links (verified `assetlinks.json` / `apple-app-site-association`).
- Handled targets: `track/:code`, `bookings/:id`, `refer/:code` (with install attribution), `wallet`, `trip/:id/rate`.
- Referral install attribution: deferred install via the link → after install + signup, apply the pending referral code (Phase 6 referral apply flow).

### 11.3 Force-update + maintenance
- On launch + resume, call `GET /mobile/config`. If `version < minSupported` → **blocking** update screen (store deep link). If `maintenance` → blocking maintenance screen with message. Otherwise soft "update available" banner if `< latest`.

### 11.4 OTA (CodePush)
- JS-only fixes shipped via CodePush (staging deployment key for internal testers, production key for release). Mandatory vs optional updates flagged. Native changes (new modules, permissions) always go through store review — CodePush never bypasses that.

---

## 12. CI/CD, Signing, Store Release

- **Fastlane** per app: `beta` (internal/TestFlight + Play internal track), `release` (production), `screenshots`, `bump`.
- **Android signing**: upload key in CI secret (or Play App Signing); flavors build separate AABs.
- **iOS signing**: Fastlane **match** with a private certs repo; App Store Connect API key in CI.
- **CI**: GitHub Actions — typecheck + unit (Jest) + Detox e2e on a subset, then Fastlane build & upload to internal tracks on merge to `main`; manual promotion to production.
- **Crash/analytics**: Sentry RN (source maps + dSYM upload in CI), same analytics events as Phase 6 (`track()` → `POST /events`) so mobile funnels merge with web.
- **Store assets**: listings, privacy nutrition labels (location background usage justified), data-safety form (Play), age rating.
- **Phased release**: Play staged rollout (5%→20%→50%→100%); App Store phased release (7-day automatic).

---

## 13. Testing Plan

### 13.1 Unit (Jest + RN Testing Library)
- Shared SDK: auth refresh rotation, WS reconnect, query hooks (mock server).
- Reducers/stores: booking store, offer countdown, chat state, wallet apply.
- Force-update/maintenance gate logic; deep-link route parsing.

### 13.2 Native / integration
- Background-geolocation: on-trip 5s cadence vs idle distance-filter; headless ping fires with app killed (instrumented device test).
- Push: data message wakes app → full-screen offer; Accept from notification hits accept endpoint (Firebase test + real device).
- Razorpay native sheet success/failure/cancel → correct booking state.
- Masked call: connect bridges via Exotel sandbox; webhook logs call.
- Chat: message round-trip over WS; push fallback when offline.

### 13.3 E2E (Detox)
- Passenger: login → quote (surge shown) → apply wallet → pay (mocked Razorpay) → track (mock pings) → chat → rate.
- Driver: login → go online (mock permissions) → receive offer (mock push) → accept → start→arrive→begin→complete → see earnings.

### 13.4 Device matrix
- Android: a low-end Android 10 (background-location + OEM kill behavior), a mid Android 13, an Android 14 (new FG-service-location permission). Xiaomi/Samsung/Pixel.
- iOS: an older iPhone on iOS 16, a current iPhone on latest iOS. Background blue-bar behavior, time-sensitive notifications.

### 13.5 Acceptance criteria
- [ ] Driver location streams with app backgrounded AND phone locked for a 30-min real drive on both platforms (gaps logged, marker keeps moving).
- [ ] Offer push wakes a killed app and Accept-from-notification works on Android + iOS.
- [ ] Crash-free sessions > 99.5% on internal track for one week.
- [ ] Native Razorpay (incl. UPI intent) completes a real ₹1 transaction in staging.
- [ ] Masked call connects without exposing real numbers; logged in `call_logs`.
- [ ] Chat delivers in <2s when both online; push fallback when offline.
- [ ] Force-update gate blocks a sub-min version; maintenance mode blocks both apps.
- [ ] Deep link + referral install attribution credits correctly (ties to Phase 6 referral).
- [ ] Both apps approved and live on Play Store + App Store (production track).
- [ ] No real phone numbers, tokens, or PII in logs/Sentry breadcrumbs.

---

## 14. Security & Privacy Checklist

- [ ] Tokens in Keychain/Keystore only (never AsyncStorage/plaintext). Biometric gate optional.
- [ ] Certificate pinning for API + WS (with a backup pin + kill-switch to avoid bricking on cert rotation).
- [ ] Background location justified in store data-safety forms; clear in-app rationale screens; location only streamed while Online/on-trip.
- [ ] Masked call: caller must be a party on an **active** booking; rate-limited; Exotel webhook signature/IP verified.
- [ ] Chat XSS/length limits; no PII auto-shared; chat read-only 24h post-trip.
- [ ] Razorpay signature verified server-side (unchanged Phase 2); client never trusts amounts.
- [ ] Deep links validated server-side before acting (no open-redirect / forced-action via crafted link).
- [ ] CodePush updates signed; release keys in CI secrets only; native perms changes never via OTA.
- [ ] Sentry scrubs phone/email/token; breadcrumbs sanitized.
- [ ] Root/jailbreak soft-detection → warn (don't hard-block) + disable certain features if needed.
- [ ] Min-TLS, no cleartext traffic (`usesCleartextTraffic=false`, ATS on iOS).

---

## 15. Observability

- Sentry RN: crashes, ANRs, JS errors, release health (crash-free sessions/users), source maps + dSYMs.
- Mobile analytics events merged into Phase 6 pipeline: `app_open`, `login`, `go_online`, `offer_received`, `offer_accepted`, `bg_ping_sent`, `chat_sent`, `call_connected`, `payment_native_success`, `force_update_shown`.
- Backend metrics added: `device_tokens_active{platform,app}`, `native_pushes_sent_total{channel,result}`, `chat_messages_total`, `masked_calls_total{status}`, `mobile_config_force_update_total`.
- Dashboards: "Mobile health" (crash-free, adoption by version, push delivery), "Background GPS health" (ping cadence by platform, gap rate native vs web), "Comms" (chat volume, call success rate).
- Alerts: crash-free < 99% → page; push delivery success < 90% → warn; masked-call failure rate > 10% → warn; bg-ping gap rate spike on a platform → investigate (likely an OS update).

---

## 16. Deployment / Rollout

### 16.1 Order
1. Migration `phase7_mobile` (DeviceToken, CallLog, AppVersionPolicy) + Mongo `chat_messages`, `call_logs` indexes.
2. Deploy API additions (chat, call-mask, device-tokens, mobile-config) — backward-compatible, web unaffected.
3. Set up Firebase project (FCM + APNs key), Exotel account + virtual number, App Center/CodePush, Sentry projects, store listings.
4. Internal track builds (Play internal testing + TestFlight) → founders + ops dogfood for 1–2 weeks.
5. Closed beta with ~20 real drivers + 50 friendly customers.
6. Phased production rollout (staged %).

### 16.2 Coexistence
- Web (Phases 1–6) keeps running. Public `/track` HMAC link stays for non-app family members.
- Feature flags via `mobile/config` allow disabling chat/calls/native-payments independently if a provider breaks.

### 16.3 Rollback
- CodePush: roll back a bad JS release instantly.
- Native: halt the staged rollout in store consoles; force-update can pin everyone to the last-good native version once a fixed build is published.
- Backend additions are additive + flagged; disabling chat/call-mask reverts behavior to web-equivalent without redeploy.

---

## 17. Six-Week Plan

| Week | Focus | Key deliverables |
|---|---|---|
| **11** | Foundation | RN CLI scaffold both apps; monorepo Metro + pnpm; flavors/schemes + bundle IDs; `packages/mobile-shared` SDK (typed client, Keychain auth, WS client, tokens/fonts); OTP login working end-to-end on device; Sentry + Fastlane skeleton + internal-track build pipeline. |
| **12** | Passenger core | Quote (surge-aware) → book → native Razorpay → confirmation; wallet apply; trip history; referrals + reviews screens; notification centre; deep links. |
| **13** | Live tracking + push | Passenger native MapView tracking (WS); FCM/APNs setup; customer push (`DeviceToken`); trip status pushes; SOS. |
| **14** | Driver core + background GPS | Driver OTP+role; online/offline; **background-geolocation foreground service** (Android) + iOS background modes; headless ping; trip lifecycle; nav handoff. **(highest-risk week.)** |
| **15** | Driver offers + chat + calls | Native full-screen offer push + accept/decline from notification; offer countdown; **in-trip chat** (WS + Mongo + quick-replies); **Exotel masked call** + webhook + `call_logs`; earnings/EMI/rating screens. |
| **16** | Hardening + store launch | Force-update/maintenance gate; CodePush; device-matrix testing; Detox E2E; crash-fix bash; store assets + privacy/data-safety; closed beta → phased production rollout; tag `v0.7.0-phase7`; update [implementation.md](implementation.md). |

---

## 18. Risks (Phase 7)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Android OEMs kill the foreground service (Xiaomi/Oppo/Vivo) | High | Driver location stalls | transistorsoft lib + persistent FG notification + battery-optimization-exemption guide + headless native HTTP ping + 30s heartbeat watchdog alerts ops |
| iOS background location restrictions / App Store rejection for bg-location | Medium | Launch delay / feature loss | Clear rationale + data-safety justification; only stream while Online/on-trip; significant-change when idle; pre-review with Apple guidelines; SMS+web fallback always exists |
| Full-screen offer push unreliable when app killed (Doze/iOS) | Medium | Missed offers | High-priority FCM data messages + notifee full-screen intent + time-sensitive iOS; **SMS remains source of truth (Phase 4)**; one-at-a-time offers tolerate a miss → next driver |
| Store review delays/rejections | Medium | Timeline slip | Submit internal/TestFlight early (Week 11); keep listings + privacy forms ready; buffer in Week 16; phased rollout |
| Native module / New Architecture incompatibility | Medium | Build breakage | Pin RN + lib versions; fall back to old arch if a critical lib (maps/bg-geo) lags; CI catches early |
| Exotel masking fails / number leakage | Low/Med | Privacy breach | Server-side party validation; webhook verification; fallback to chat; never expose raw numbers client-side; rate limit |
| Battery drain complaints from drivers | High | Drivers disable GPS | Motion-activity downshift, distance-filter when idle, 5s only on-trip, transparent FG notification, onboarding tips |
| CodePush misuse pushing native-needing change | Low | Crashes | Policy + checklist: native/permission changes always store-reviewed; CI guard flags native diffs |
| Two new app codebases overrun 6 weeks | High | Slip | Shared SDK to cut duplication; passenger first (lower risk), driver bg-GPS week isolated and de-risked early via spike; cut chat/calls to fast-follow if needed (flags) |
| Cert pinning bricks app on rotation | Low | Outage | Backup pin + remote kill-switch via `mobile/config` |

---

## 19. Deliverables Checklist

Code:
- [ ] `apps/mobile-passenger` + `apps/mobile-driver` (RN CLI, owned android/ + ios/) building dev/staging/prod flavors.
- [ ] `packages/mobile-shared` SDK (typed client, Keychain auth + refresh rotation, WS hooks, tokens/fonts, component kit).
- [ ] Background-geolocation foreground service (Android) + iOS background modes + headless ping.
- [ ] Native FCM/APNs push; full-screen actionable offer; `DeviceToken` + extended `DriverFcmToken`.
- [ ] Native Razorpay checkout + wallet apply.
- [ ] In-trip chat (WS + Mongo) + Exotel masked call + `call_logs`.
- [ ] Deep links/app links + referral install attribution.
- [ ] Force-update/maintenance gate + CodePush.

Ops/Infra:
- [ ] Firebase (FCM+APNs), Exotel (virtual number), App Center/CodePush, Sentry RN projects.
- [ ] Fastlane lanes + signing (Android upload key / Play App Signing; iOS match + ASC API key).
- [ ] GitHub Actions: typecheck/unit/Detox + Fastlane internal-track upload; manual prod promotion.
- [ ] Migration `phase7_mobile` + Mongo `chat_messages`/`call_logs` indexes.
- [ ] Store listings, privacy/data-safety forms, phased rollout configured.

Docs:
- [ ] `docs/mobile/setup.md` (RN CLI env, pods, gradle, schemes).
- [ ] `docs/mobile/background-location.md` (per-OS behavior, OEM quirks, debugging).
- [ ] `docs/mobile/release.md` (Fastlane, signing, store submission, CodePush policy).
- [ ] `docs/runbooks/push-not-delivering.md`, `docs/runbooks/bg-gps-stalled.md`.
- [ ] OpenAPI updated (chat, calls, device-tokens, mobile-config).

---

## 20. Handoff to Phase 8

Phase 8 (Scale & Expansion) builds on a fully native, multi-client platform. Contracts Phase 8 depends on:
- Stable mobile analytics events feeding the data warehouse → fuels ML demand forecasting (Prophet) to replace Phase 6 rule-based surge inputs.
- `DeviceToken`/push infra → multi-city + corporate notifications.
- Ledger + earnings (Phase 6) → automated payout rails (RazorpayX) replace manual payouts.
- App config (`mobile/config`) → per-city feature flags for staged multi-city launch.

Open items pushed to Phase 8:
- ML demand forecasting + supply positioning.
- Multi-city configuration + city-scoped fare/surge/zones.
- Corporate accounts + GST invoicing + monthly billing.
- EV charging-aware assignment.
- Automated payouts (RazorpayX).
- Hetzner → AWS migration for scale.
- CarPlay / Android Auto, tablet layouts (if prioritized).

---

**End of Phase 7 document.**
