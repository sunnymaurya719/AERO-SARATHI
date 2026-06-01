-- Phase 6: Intelligence Layer
-- Additive migration. New enums, tables, columns, and indexes.

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('CUSTOMER_WALLET', 'DRIVER_PAYABLE', 'EMI_RECEIVABLE', 'PLATFORM_REVENUE', 'PLATFORM_CASH', 'PROMO_LIABILITY');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "WalletHoldStatus" AS ENUM ('HELD', 'COMMITTED', 'RELEASED');
CREATE TYPE "EmiCollectionSource" AS ENUM ('PER_TRIP', 'MANUAL', 'ADJUSTMENT');
CREATE TYPE "EmiStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFAULTED', 'PAUSED');
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REJECTED');
CREATE TYPE "ReviewDirection" AS ENUM ('CUSTOMER_TO_DRIVER', 'DRIVER_TO_CUSTOMER');

-- AlterEnum: AlertType (low-rating driver alert)
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'LOW_RATING';


-- AlterTable: Quote (surge fields)
ALTER TABLE "Quote"
  ADD COLUMN "routeBucket" TEXT,
  ADD COLUMN "surgeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN "surgeRuleVersion" INTEGER,
  ADD COLUMN "surgeBreakdown" JSONB;

-- AlterTable: User (referrals)
ALTER TABLE "User"
  ADD COLUMN "referralCode" TEXT,
  ADD COLUMN "referredById" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AlterTable: Driver (rating aggregation)
ALTER TABLE "Driver"
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last30Rating" DOUBLE PRECISION;

-- AlterTable: EmiPlan (per-trip cut activation)
ALTER TABLE "EmiPlan"
  ADD COLUMN "driverId" TEXT,
  ADD COLUMN "perTripCutPaise" BIGINT,
  ADD COLUMN "weeklyTargetPaise" BIGINT,
  ADD COLUMN "totalDuePaise" BIGINT,
  ADD COLUMN "collectedPaise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "status" "EmiStatus" NOT NULL DEFAULT 'PAUSED',
  ADD COLUMN "activatedAt" TIMESTAMP(3);
CREATE INDEX "EmiPlan_driverId_status_idx" ON "EmiPlan"("driverId", "status");

-- AlterTable: Notification (web feed)
ALTER TABLE "Notification"
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "title" TEXT,
  ADD COLUMN "body" TEXT,
  ADD COLUMN "link" TEXT;
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateTable: SurgeRule
CREATE TABLE "SurgeRule" (
    "id" TEXT NOT NULL,
    "routeBucket" TEXT NOT NULL,
    "capMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.8,
    "timeFloors" JSONB NOT NULL,
    "blackout" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "supersededById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurgeRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SurgeRule_routeBucket_version_idx" ON "SurgeRule"("routeBucket", "version");

-- CreateTable: SurgeOverride
CREATE TABLE "SurgeOverride" (
    "id" TEXT NOT NULL,
    "routeBucket" TEXT NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurgeOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SurgeOverride_routeBucket_startsAt_endsAt_idx" ON "SurgeOverride"("routeBucket", "startsAt", "endsAt");

-- CreateTable: LedgerAccount
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "ownerId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerAccount_type_ownerId_key" ON "LedgerAccount"("type", "ownerId");

-- CreateTable: LedgerEntry
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");
CREATE INDEX "LedgerEntry_txnId_idx" ON "LedgerEntry"("txnId");
CREATE INDEX "LedgerEntry_refType_refId_idx" ON "LedgerEntry"("refType", "refId");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: WalletHold
CREATE TABLE "WalletHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "WalletHoldStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WalletHold_userId_status_idx" ON "WalletHold"("userId", "status");
CREATE INDEX "WalletHold_bookingId_idx" ON "WalletHold"("bookingId");

-- CreateTable: EmiCollection
CREATE TABLE "EmiCollection" (
    "id" TEXT NOT NULL,
    "emiPlanId" TEXT NOT NULL,
    "bookingId" TEXT,
    "amountPaise" BIGINT NOT NULL,
    "source" "EmiCollectionSource" NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmiCollection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmiCollection_emiPlanId_collectedAt_idx" ON "EmiCollection"("emiPlanId", "collectedAt");
ALTER TABLE "EmiCollection" ADD CONSTRAINT "EmiCollection_emiPlanId_fkey" FOREIGN KEY ("emiPlanId") REFERENCES "EmiPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Payout
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");
CREATE INDEX "Payout_driverId_createdAt_idx" ON "Payout"("driverId", "createdAt");

-- CreateTable: Referral
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardTxnId" TEXT,
    "rejectedReason" TEXT,
    "deviceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardedAt" TIMESTAMP(3),
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Referral_refereeId_key" ON "Referral"("refereeId");
CREATE INDEX "Referral_referrerId_status_idx" ON "Referral"("referrerId", "status");
CREATE INDEX "Referral_code_idx" ON "Referral"("code");

-- CreateTable: Review
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "direction" "ReviewDirection" NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "tags" TEXT[],
    "text" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Review_bookingId_direction_key" ON "Review"("bookingId", "direction");
CREATE INDEX "Review_rateeId_createdAt_idx" ON "Review"("rateeId", "createdAt");

-- CreateTable: DailyMetric
CREATE TABLE "DailyMetric" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "trips" INTEGER NOT NULL DEFAULT 0,
    "gmvPaise" BIGINT NOT NULL DEFAULT 0,
    "aovPaise" BIGINT NOT NULL DEFAULT 0,
    "quotes" INTEGER NOT NULL DEFAULT 0,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    "cancellations" INTEGER NOT NULL DEFAULT 0,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "refundsPaise" BIGINT NOT NULL DEFAULT 0,
    "surgeTripCount" INTEGER NOT NULL DEFAULT 0,
    "avgSurge" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "driverActive" INTEGER NOT NULL DEFAULT 0,
    "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "utilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyMetric_date_dimension_key" ON "DailyMetric"("date", "dimension");
