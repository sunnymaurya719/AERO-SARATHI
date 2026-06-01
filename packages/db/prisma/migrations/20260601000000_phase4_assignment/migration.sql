-- Phase 4: Driver Assignment Automation + Driver Portal
-- Additive migration. New enums, tables, columns, and indexes.

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('POOL_EMPTY', 'OFFER_SENT', 'ALL_DECLINED', 'ACCEPTED', 'ABORTED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('UNASSIGNED_T_MINUS_30', 'POOL_EMPTY', 'DRIVER_NO_SHOW', 'REFUND_STUCK', 'DOC_EXPIRY', 'WEBHOOK_DLQ');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Driver"
  ADD COLUMN "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Booking"
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "assignmentJobId" TEXT;

-- CreateTable
CREATE TABLE "DriverFcmToken" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DriverFcmToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "responseReason" TEXT,
    "notificationIds" TEXT[],

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAttempt" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidatePool" JSONB NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "reason" TEXT,
    "jobId" TEXT,

    CONSTRAINT "AssignmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverOfferStats" (
    "driverId" TEXT NOT NULL,
    "offersTotal" INTEGER NOT NULL DEFAULT 0,
    "offersAccepted" INTEGER NOT NULL DEFAULT 0,
    "offersDeclined" INTEGER NOT NULL DEFAULT 0,
    "offersExpired" INTEGER NOT NULL DEFAULT 0,
    "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgResponseSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverOfferStats_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "SystemAlert" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "ackedById" TEXT,
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverFcmToken_token_key" ON "DriverFcmToken"("token");
CREATE INDEX "DriverFcmToken_driverId_idx" ON "DriverFcmToken"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_bookingId_driverId_attemptNumber_key" ON "Offer"("bookingId", "driverId", "attemptNumber");
CREATE INDEX "Offer_bookingId_status_idx" ON "Offer"("bookingId", "status");
CREATE INDEX "Offer_driverId_status_idx" ON "Offer"("driverId", "status");
CREATE INDEX "Offer_expiresAt_status_idx" ON "Offer"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentAttempt_bookingId_attemptNumber_key" ON "AssignmentAttempt"("bookingId", "attemptNumber");
CREATE INDEX "AssignmentAttempt_bookingId_idx" ON "AssignmentAttempt"("bookingId");

-- CreateIndex
CREATE INDEX "SystemAlert_status_createdAt_idx" ON "SystemAlert"("status", "createdAt");
CREATE INDEX "SystemAlert_type_status_idx" ON "SystemAlert"("type", "status");

-- CreateIndex (Driver online partial index for fast pool selection)
CREATE INDEX "Driver_availability_idx" ON "Driver"("availability");
CREATE INDEX "driver_online_idx" ON "Driver" ("availability") WHERE "availability" = 'ONLINE';

-- AddForeignKey
ALTER TABLE "DriverFcmToken" ADD CONSTRAINT "DriverFcmToken_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssignmentAttempt" ADD CONSTRAINT "AssignmentAttempt_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentAttempt" ADD CONSTRAINT "AssignmentAttempt_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverOfferStats" ADD CONSTRAINT "DriverOfferStats_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one ACCEPTED offer per booking (race guard).
CREATE UNIQUE INDEX "one_accepted_per_booking" ON "Offer" ("bookingId") WHERE "status" = 'ACCEPTED';

-- GiST overlap index for driver double-booking detection.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE INDEX "booking_overlap_idx" ON "Booking" USING GIST (
  "driverId",
  tstzrange("scheduledAt" - INTERVAL '2 hours',
            "scheduledAt" + ("estimatedMin" || ' minutes')::interval + INTERVAL '2 hours')
) WHERE status IN ('DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING');

-- Backfill: a DriverOfferStats row (zeros) for every existing driver.
INSERT INTO "DriverOfferStats" ("driverId", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP FROM "Driver"
ON CONFLICT ("driverId") DO NOTHING;
