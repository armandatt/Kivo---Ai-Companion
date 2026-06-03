ALTER TABLE "MessengerUser"
ADD COLUMN IF NOT EXISTS "splitState" JSONB,
ADD COLUMN IF NOT EXISTS "personalRecords" JSONB,
ADD COLUMN IF NOT EXISTS "gymStreak" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "TelegramWorkoutSession" (
  "id" TEXT NOT NULL,
  "messengerUserId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "splitDayIndex" INTEGER NOT NULL,
  "musclesTrained" TEXT[],
  "durationMinutes" INTEGER,
  "completed" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "TelegramWorkoutSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TelegramSetLog" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "exerciseName" TEXT NOT NULL,
  "setNumber" INTEGER NOT NULL,
  "reps" INTEGER NOT NULL,
  "weightKg" DOUBLE PRECISION NOT NULL,
  "rpe" INTEGER,
  "completed" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "TelegramSetLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TelegramWorkoutSession_messengerUserId_fkey'
  ) THEN
    ALTER TABLE "TelegramWorkoutSession"
    ADD CONSTRAINT "TelegramWorkoutSession_messengerUserId_fkey"
    FOREIGN KEY ("messengerUserId") REFERENCES "MessengerUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TelegramSetLog_sessionId_fkey'
  ) THEN
    ALTER TABLE "TelegramSetLog"
    ADD CONSTRAINT "TelegramSetLog_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "TelegramWorkoutSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TelegramWorkoutSession_messengerUserId_date_idx"
ON "TelegramWorkoutSession"("messengerUserId", "date");

CREATE INDEX IF NOT EXISTS "TelegramSetLog_sessionId_idx"
ON "TelegramSetLog"("sessionId");

CREATE INDEX IF NOT EXISTS "TelegramSetLog_sessionId_exerciseName_idx"
ON "TelegramSetLog"("sessionId", "exerciseName");
