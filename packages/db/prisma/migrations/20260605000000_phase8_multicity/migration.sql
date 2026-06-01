-- Phase 8 — Workstream B: Multi-City (additive)
-- All cityId columns are NULLABLE so existing rows backfill to a default city
-- without a blocking NOT NULL constraint. A default "CHD" city is seeded and
-- existing rows are backfilled to it at the end of this migration.

-- 1. Enum + tables --------------------------------------------------------------
CREATE TYPE "CityStatus" AS ENUM ('PLANNED', 'LIVE', 'PAUSED');

CREATE TABLE "City" (
  "id"         TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "timezone"   TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "centerLat"  DOUBLE PRECISION NOT NULL,
  "centerLng"  DOUBLE PRECISION NOT NULL,
  "status"     "CityStatus" NOT NULL DEFAULT 'PLANNED',
  "launchedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");
CREATE INDEX "City_status_idx" ON "City"("status");

CREATE TABLE "Zone" (
  "id"        TEXT NOT NULL,
  "cityId"    TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "polygon"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Zone_cityId_code_key" ON "Zone"("cityId", "code");
CREATE INDEX "Zone_cityId_idx" ON "Zone"("cityId");
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. cityId scoping columns -----------------------------------------------------
ALTER TABLE "FareRule"    ADD COLUMN "cityId" TEXT;
ALTER TABLE "SurgeRule"   ADD COLUMN "cityId" TEXT;
ALTER TABLE "Driver"      ADD COLUMN "cityId" TEXT;
ALTER TABLE "Vehicle"     ADD COLUMN "cityId" TEXT;
ALTER TABLE "Booking"     ADD COLUMN "cityId" TEXT;
ALTER TABLE "DailyMetric" ADD COLUMN "cityId" TEXT;

CREATE INDEX "FareRule_cityId_category_effectiveFrom_idx" ON "FareRule"("cityId", "category", "effectiveFrom");
CREATE INDEX "SurgeRule_cityId_routeBucket_version_idx"    ON "SurgeRule"("cityId", "routeBucket", "version");
CREATE INDEX "Driver_cityId_idx"                           ON "Driver"("cityId");
CREATE INDEX "Vehicle_cityId_status_idx"                   ON "Vehicle"("cityId", "status");
CREATE INDEX "Booking_cityId_scheduledAt_idx"              ON "Booking"("cityId", "scheduledAt");

-- 3. Seed default city + backfill existing data ---------------------------------
-- Chandigarh is the original implicit region (Phases 1–7).
INSERT INTO "City" ("id", "code", "name", "timezone", "centerLat", "centerLng", "status", "launchedAt", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-0000000c4d00', 'CHD', 'Chandigarh', 'Asia/Kolkata', 30.7333, 76.7794, 'LIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

UPDATE "FareRule"    SET "cityId" = '00000000-0000-0000-0000-0000000c4d00' WHERE "cityId" IS NULL;
UPDATE "SurgeRule"   SET "cityId" = '00000000-0000-0000-0000-0000000c4d00' WHERE "cityId" IS NULL;
UPDATE "Driver"      SET "cityId" = '00000000-0000-0000-0000-0000000c4d00' WHERE "cityId" IS NULL;
UPDATE "Vehicle"     SET "cityId" = '00000000-0000-0000-0000-0000000c4d00' WHERE "cityId" IS NULL;
UPDATE "Booking"     SET "cityId" = '00000000-0000-0000-0000-0000000c4d00' WHERE "cityId" IS NULL;
