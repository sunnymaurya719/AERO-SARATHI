-- Phase 5: Live Tracking
-- Additive migration. New enums, tables, columns, and indexes.

-- CreateEnum
CREATE TYPE "TripReviewStatus" AS ENUM ('NONE', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SosActor" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'SOS_TRIGGERED';
ALTER TYPE "AlertType" ADD VALUE 'TRIP_FRAUD_REVIEW';
ALTER TYPE "AlertType" ADD VALUE 'TRIP_STALE';

-- AlterTable
ALTER TABLE "Booking"
  ADD COLUMN "enRouteAt" TIMESTAMP(3),
  ADD COLUMN "arrivedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "actualKm" DOUBLE PRECISION,
  ADD COLUMN "actualMin" INTEGER;

-- AlterTable
ALTER TABLE "Driver"
  ADD COLUMN "totalTrips" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastTripAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "pickupReachedLat" DOUBLE PRECISION,
    "pickupReachedLng" DOUBLE PRECISION,
    "totalKm" DOUBLE PRECISION,
    "totalMin" INTEGER,
    "topSpeedKmh" DOUBLE PRECISION,
    "avgSpeedKmh" DOUBLE PRECISION,
    "pingCount" INTEGER NOT NULL DEFAULT 0,
    "gapCount" INTEGER NOT NULL DEFAULT 0,
    "fraudScore" DOUBLE PRECISION,
    "fraudFlags" JSONB,
    "reviewStatus" "TripReviewStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "triggeredBy" "SosActor" NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "message" TEXT,
    "alertId" TEXT,
    "ackedById" TEXT,
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackToken" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trip_bookingId_key" ON "Trip"("bookingId");

-- CreateIndex
CREATE INDEX "Trip_driverId_createdAt_idx" ON "Trip"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "SosEvent_bookingId_createdAt_idx" ON "SosEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackToken_tokenHash_key" ON "TrackToken"("tokenHash");

-- CreateIndex
CREATE INDEX "TrackToken_bookingId_idx" ON "TrackToken"("bookingId");

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackToken" ADD CONSTRAINT "TrackToken_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
