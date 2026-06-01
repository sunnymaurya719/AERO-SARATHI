-- Phase 7: Mobile Apps
-- Additive migration. New enum, tables, columns, and indexes. Backward-compatible.

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- AlterTable: DriverFcmToken (native platform metadata)
ALTER TABLE "DriverFcmToken"
  ADD COLUMN "platform" "DevicePlatform",
  ADD COLUMN "appVersion" TEXT;

-- CreateTable: DeviceToken (customer push)
CREATE TABLE "DeviceToken" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "platform"   "DevicePlatform" NOT NULL,
  "appVersion" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"  TIMESTAMP(3),
  CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");
ALTER TABLE "DeviceToken"
  ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CallLog (masked-call audit)
CREATE TABLE "CallLog" (
  "id"          TEXT NOT NULL,
  "bookingId"   TEXT NOT NULL,
  "fromRole"    TEXT NOT NULL,
  "exotelSid"   TEXT,
  "status"      TEXT NOT NULL,
  "durationSec" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CallLog_bookingId_idx" ON "CallLog"("bookingId");

-- CreateTable: AppVersionPolicy (force-update + maintenance gate)
CREATE TABLE "AppVersionPolicy" (
  "id"           TEXT NOT NULL,
  "platform"     "DevicePlatform" NOT NULL,
  "app"          TEXT NOT NULL,
  "minSupported" TEXT NOT NULL,
  "latest"       TEXT NOT NULL,
  "maintenance"  BOOLEAN NOT NULL DEFAULT false,
  "message"      TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppVersionPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppVersionPolicy_platform_app_key" ON "AppVersionPolicy"("platform", "app");
