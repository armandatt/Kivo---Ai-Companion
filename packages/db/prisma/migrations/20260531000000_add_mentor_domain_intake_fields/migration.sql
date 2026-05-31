-- AlterTable: add mentor domain and intake tracking fields to UserProfile
ALTER TABLE "UserProfile"
ADD COLUMN "mentorDomain"         TEXT,
ADD COLUMN "mentorIntakeStarted"  BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mentorIntakeComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "intakeState"          JSONB;
