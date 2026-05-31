-- AlterTable: add tone_modifier to UserProfile for secondary persona calibration
ALTER TABLE "UserProfile"
ADD COLUMN "toneModifier" TEXT;
