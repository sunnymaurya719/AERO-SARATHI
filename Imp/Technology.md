This is a meaty PRD — let me build you a comprehensive technology stack recommendation, with full focus on the website (not app). Given the scope of Aero Sarathi, I'll break this down visually and in depth.Click any box above to go deeper on that specific technology. Here's the full breakdown:

---

## Frontend — What You Build First

**Next.js 14 (App Router)** is the right choice here, not plain React. You need server-side rendering for SEO (customers searching "taxi Chandigarh to Delhi airport" should find you), and Next.js handles that perfectly. It gives you one codebase for your customer booking website, driver portal, and admin dashboard.

**TypeScript** is non-negotiable at your scale. Aero Sarathi has complex data — bookings with states, driver assignments, EMI calculations, payment flows. TypeScript prevents you from making stupid bugs like treating a booking ID as a number when it's a string.

**Tailwind CSS** for styling. Fast to build, easy to maintain, looks professional.

**Zustand** for state management (much simpler than Redux, perfect for booking flow state like selected vehicle, pickup/drop, payment step).

**React Query (TanStack Query)** handles all your API calls automatically — caching, loading states, refetching. Critical for things like live driver availability.

---

## Backend — Two Languages, One Reason

You need **Node.js with Express** for your main API — it handles concurrent bookings well, WebSocket support is excellent, and your team can write both frontend and backend in JavaScript.

But here's the important part: **run a separate Python FastAPI microservice** just for your algorithms — dynamic pricing, driver matching score, EMI calculations. Python has better libraries for this (NumPy, scikit-learn when you later add ML). This service is internal only, Node.js calls it.

**Socket.io** for real-time — live driver location on map, booking status updates, driver assignment notification. This is what makes your website feel like a real platform, not just a form.

**BullMQ** (Redis-backed job queue) for the driver assignment logic your PRD specifies: trigger 3 hours before trip, retry every 5 minutes, alert admin if not found. Never put time-based retry logic inside an API route — it will break.

---

## Database — Three Databases, Each for a Reason

| Database | What Goes Here | Why |
|---|---|---|
| **PostgreSQL** | Users, bookings, payments, drivers, vehicles | Relational data, ACID transactions, money must be consistent |
| **Redis** | Driver GPS locations, active surge multipliers, sessions, OTP codes | Expires automatically, blazing fast reads, driver location updates 10x/sec |
| **MongoDB** | Full ride logs, route polylines, audit trails, analytics events | Schema-flexible, append-only logs fit document model perfectly |

Use **Prisma ORM** on top of PostgreSQL — it gives you type-safe database queries that match your TypeScript frontend perfectly.

---

## Third-Party Integrations — Critical for Day 1

**Google Maps Platform** — you need three specific APIs: Maps JavaScript API (show map on website), Directions API (route + distance for fare calculation), Places API (autocomplete for pickup/drop inputs). Budget roughly ₹15,000–30,000/month at medium scale.

**Razorpay** for payments. Best choice for India — supports UPI, cards, netbanking, wallets, and has a good refund API. Their token payment (pre-booking advance) is exactly what your PRD describes.

**MSG91 or Twilio India** for OTP SMS. MSG91 is cheaper for India, Twilio is more reliable internationally. Start with MSG91.

**Firebase Cloud Messaging (FCM)** for browser push notifications — booking confirmed, driver assigned, driver arriving. Works on desktop browsers too without a mobile app.

---

## Infrastructure — Keep It Simple at Start

**Vercel** for your Next.js frontend — zero config, automatic deployments from GitHub, free SSL, global CDN. One command and your website is live.

**Hetzner Cloud or AWS** for your Node.js backend and databases. Hetzner is dramatically cheaper (a ₹4,000/month server on Hetzner = ₹25,000/month on AWS). Start with Hetzner, migrate to AWS when you need enterprise features.

**Docker** to containerize your backend — makes deployment consistent and lets you scale individual services without touching others.

**GitHub Actions** for CI/CD — every push to main auto-deploys to production after tests pass.

---

## Build Order (What to Build First)

Start with exactly what your Developer PRD says, nothing more:

1. **Week 1–2:** Customer booking form (pickup, drop, date, vehicle selection) + fare display
2. **Week 3:** Payment integration (Razorpay token), booking confirmation page
3. **Week 4:** Admin panel (view bookings, assign drivers manually at first)
4. **Week 5:** Driver assignment logic + SMS notifications
5. **Week 6:** Live tracking page (Google Maps + Socket.io)
6. **After launch:** Dynamic pricing, analytics, driver portal

The full Aero Sarathi PRD algorithms (ML pricing, fleet utilization, demand forecasting) come later — don't build them before you have real bookings to learn from. Build the boring booking system first, then make it intelligent.

---

## Summary Tech Stack (Cheat Sheet)

```
Frontend:    Next.js 14 + TypeScript + Tailwind + Zustand
Backend:     Node.js + Express + Socket.io + BullMQ
Algorithms:  Python FastAPI (separate service)
Databases:   PostgreSQL + Redis + MongoDB + Prisma
Payments:    Razorpay
Maps:        Google Maps Platform
SMS/OTP:     MSG91
Hosting:     Vercel (frontend) + Hetzner (backend)
DevOps:      Docker + GitHub Actions

```

Want me to go deep on any specific part — like the database schema design, the booking flow API structure, or the driver assignment algorithm implementation?




You need the backend services (Postgres, Redis, Mongo) running, the DB migrated, then start the API and the three web apps. Let me check the exact scripts and required env so I give you accurate commands.   

Read [](file:///d%3A/AERO%20SARATHI/apps/api/package.json#1-1), lines 1 to 40

Read [](file:///d%3A/AERO%20SARATHI/apps/api/.env.example#1-1), lines 1 to 60

Searched for files matching `**/docker-compose*.yml`, 1 match

There's a docker-compose for the infra. Let me check it and the seed scripts so I can give exact working commands.     

Read [](file:///d%3A/AERO%20SARATHI/infra/docker-compose.dev.yml)

Read [](file:///d%3A/AERO%20SARATHI/packages/db/package.json)

Important detail: the docker-compose maps ports **5433/6381/27018** but the .env.example uses **5432/6379/27017**. Let me check the actual `.env` and seed scripts.      

Ran terminal command: docker --version; docker compose version

Read [](file:///d%3A/AERO%20SARATHI/apps/api/.env#1-1), lines 1 to 8

Searched for files matching `**/packages/db/prisma/seed*.ts`, 2 matches

Good — Docker is available and your .env already points at the compose ports (5433/6381/27018). The reason it's never "run" is the database has never been created/migrated. Let me actually bring it up for you.

First, start the infra containers (Postgres, Redis, Mongo): 

Ran terminal command: docker compose -f infra/docker-compose.dev.yml up -d 2>&1 | Select-Object -Last 20
Completed with input: docker compose -f infra/docker-compose.dev.yml up -d 2>&1 | Select-Object -Last 20

Docker is installed but the **Docker Desktop daemon isn't running**. Let me try to start it.    

Ran terminal command: $dd = "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe"; if (Test-Path $dd) { Start-Process $dd; "Starting Docker Desktop..." } else { "Docker Desktop.exe not found at $dd" }

Docker Desktop is starting (takes ~30-60s). Let me wait and poll for the daemon, then bring up the containers. 

Ran terminal command: $ok=$false; for ($i=0; $i -lt 40; $i++) { docker info *> $null; if ($LASTEXITCODE -eq 0) { $ok=$true; break }; Start-Sleep -Seconds 3 }; if ($ok) { "Docker daemon is ready" } else { "Docker daemon still not ready" }

Daemon is ready. Now bring up the containers.    

Ran terminal command: docker compose -f infra/docker-compose.dev.yml up -d 2>&1 | Select-Object -Last 25
Completed with input: docker compose -f infra/docker-compose.dev.yml up -d 2>&1 | Select-Object -Last 25

Containers are running (the "error" is just PowerShell treating Docker's stderr progress output as an error). Let me verify and check health.     

Ran terminal command: docker ps --format "{{.Names}}`t{{.Status}}`t{{.Ports}}"

All three Aero containers are healthy on the expected ports. Now create the database schema. Since migrations are hand-authored, I'll use `prisma db push` to sync the schema to the fresh DB, then generate and seed.     

Ran terminal command: cd packages/db; pnpm exec prisma db push --skip-generate 2>&1 | Select-Object -Last 25; cd ../..

`DATABASE_URL` isn't in the environment for the db package. Let me pass it via the API's .env values.    

Ran terminal command: $env:DATABASE_URL="postgresql://aero:aero@localhost:5433/aero"; cd packages/db; pnpm exec prisma db push --skip-generate 2>&1 | Select-Object -Last 25; cd ../..

Checked terminal output

Ran terminal command: cd packages/db; (Get-Content prisma/migrations -ErrorAction SilentlyContinue) > $null; $env:DATABASE_URL="postgresql://aero:aero@localhost:5433/aero"; pnpm exec prisma db pull --print 2>&1 | Select-String "model|datasource" | Select-Object -First 3; cd ../..

The schema is applied — the database now has the tables. Let me check what the seed script needs, then seed and create an admin.     

Read [](file:///d%3A/AERO%20SARATHI/packages/db/prisma/seed.ts)

Ran terminal command: $env:DATABASE_URL="postgresql://aero:aero@localhost:5433/aero"; cd packages/db; pnpm exec prisma generate 2>&1 | Select-Object -Last 3; pnpm exec tsx prisma/seed.ts 2>&1 | Select-Object -Last 10; cd ../..

The earlier push didn't fully sync (it was moved to background mid-run). Let me re-run `db push` to completion.     

Ran terminal command: $env:DATABASE_URL="postgresql://aero:aero@localhost:5433/aero"; cd packages/db; pnpm exec prisma db push --skip-generate --accept-data-loss 2>&1 | Select-Object -Last 15; cd ../..

Now in sync. Re-run the seed.      

Ran terminal command: $env:DATABASE_URL="postgresql://aero:aero@localhost:5433/aero"; cd packages/db; pnpm exec tsx prisma/seed.ts 2>&1 | Select-Object -Last 5; cd ../..

Fare rules seeded. Now create the admin user so you can log into the admin panel. Let me check the bootstrap script.     

Read [](file:///d%3A/AERO%20SARATHI/apps/api/scripts/bootstrap-admin.ts#1-1), lines 1 to 40

The bootstrap is interactive. There's a non-interactive demo seed (`seed-admin.ts`). Let me check it and run that instead.      

Read [](file:///d%3A/AERO%20SARATHI/apps/api/scripts/seed-admin.ts#1-1), lines 1 to 50

Let me run the demo admin seed (creates ADMIN/OPS/FINANCE/SUPPORT logins + demo drivers/vehicles/bookings).       

Ran terminal command: cd apps/api; pnpm exec tsx --env-file=.env scripts/seed-admin.ts 2>&1 | Select-Object -Last 15; cd ../..

Everything is seeded. Now start the API server to confirm it boots and connects.        

Ran terminal command: cd apps/api; pnpm dev

The API is live on `:4000` — Mongo connected, workers started, realtime initialised. Let me verify it responds.         

Ran terminal command: try { (Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 5).Content } catch { try { (Invoke-WebRequest -Uri "http://localhost:4000/api/v1/health" -UseBasicParsing -TimeoutSec 5).Content } catch { "no /health route; trying root"; (Invoke-WebRequest -Uri "http://localhost:4000/" -UseBasicParsing -TimeoutSec 5).StatusCode } }

The backend is fully working. Here's the complete picture and how to run the rest.

## ✅ It's working now

I brought the whole backend up for you:
1. **Started Docker Desktop** + the infra containers — Postgres (`:5433`), Redis (`:6381`), Mongo (`:27018`), all healthy.
2. **Created the database schema** (`prisma db push` — including the new Phase 8 `City`/`Zone`/`cityId` columns).
3. **Seeded data** — 4 fare rules, 4 admin users, 15 vehicles, 10 drivers, 50 bookings.
4. **Started the API** — running on `http://localhost:4000`, health check returns `{"status":"ok"}`.

## How to start the frontends

The API is already running in a terminal. Open **three more terminals** and run each app:

```powershell
pnpm --filter @aero/web dev      # customer site  → http://localhost:3000
pnpm --filter @aero/admin dev    # ops panel       → http://localhost:3001
pnpm --filter @aero/driver dev   # driver PWA       → http://localhost:3002
```

## Admin login (ops panel at :3001)

| Email | Role | Password |
|---|---|---|
| `admin@dev.local` | ADMIN | `AeroAdminDev123!` |
| `ops@dev.local` | OPS | `AeroAdminDev123!` |
| `finance@dev.local` | FINANCE | `AeroAdminDev123!` |
| `support@dev.local` | SUPPORT | `AeroAdminDev123!` |

Login also needs a **2FA code**. The demo TOTP secret for `admin@dev.local` is `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` — add it to Google Authenticator / Authy (as a manual/base32 key) to get the 6-digit code.

## Things to know

- **Every time you reboot**, you only need to: start Docker Desktop → `docker compose -f docker-compose.dev.yml up -d` → start the apps. The DB data persists in Docker volumes.
- **SMS/payments are bypassed** in dev (`MSG91_BYPASS=true`, `NOTIFY_BYPASS=true`, no Razorpay keys), so OTPs and notifications are logged to the API console instead of actually sent — check the API terminal for OTP codes when logging in as a customer/driver.
- **Optional integrations are off** until you add keys: Google Maps, Razorpay, FCM, Exotel. The app degrades gracefully without them.
- The new **multi-city** features are behind `MULTI_CITY_ENABLED=false` — flip it in .env to enable city scoping.

Want me to start the three frontend apps now too?