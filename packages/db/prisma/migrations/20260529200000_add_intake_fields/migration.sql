-- AlterTable: add intake flow fields to MessengerUser
ALTER TABLE "MessengerUser"
ADD COLUMN "intakeComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "intakeStep"     TEXT    NOT NULL DEFAULT 'not_started',
ADD COLUMN "intakeAnswers"  JSONB,
ADD COLUMN "activeModules"  TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[];
