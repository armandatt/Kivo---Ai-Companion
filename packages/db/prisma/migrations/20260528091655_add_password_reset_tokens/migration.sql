-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "currentSplit" TEXT,
ADD COLUMN     "dietType" TEXT,
ADD COLUMN     "gymMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gymOnboardingComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phaseWeek" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sessionTime" TEXT,
ALTER COLUMN "aspirationWords" DROP DEFAULT;

-- CreateTable
CREATE TABLE "WorkoutLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "skipReason" TEXT,
    "intensityScore" INTEGER,
    "energyScore" INTEGER,
    "musclesWorked" TEXT[],
    "notes" TEXT,

    CONSTRAINT "WorkoutLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiftLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutLogId" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "isPR" BOOLEAN NOT NULL DEFAULT false,
    "prPrevious" DOUBLE PRECISION,

    CONSTRAINT "LiftLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SorenessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "muscleGroup" TEXT NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "SorenessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyweightLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "trend" TEXT,

    CONSTRAINT "BodyweightLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnergyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "morningScore" INTEGER,
    "preSessionScore" INTEGER,
    "postSessionScore" INTEGER,
    "sleepHours" DOUBLE PRECISION,
    "moodTag" TEXT,

    CONSTRAINT "EnergyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InjuryFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "exercise" TEXT,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstReported" TIMESTAMP(3) NOT NULL,
    "lastReported" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InjuryFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutLog_userId_date_idx" ON "WorkoutLog"("userId", "date");

-- CreateIndex
CREATE INDEX "LiftLog_userId_exercise_idx" ON "LiftLog"("userId", "exercise");

-- CreateIndex
CREATE INDEX "LiftLog_workoutLogId_idx" ON "LiftLog"("workoutLogId");

-- CreateIndex
CREATE INDEX "SorenessLog_userId_date_idx" ON "SorenessLog"("userId", "date");

-- CreateIndex
CREATE INDEX "SorenessLog_userId_muscleGroup_idx" ON "SorenessLog"("userId", "muscleGroup");

-- CreateIndex
CREATE INDEX "BodyweightLog_userId_date_idx" ON "BodyweightLog"("userId", "date");

-- CreateIndex
CREATE INDEX "EnergyLog_userId_date_idx" ON "EnergyLog"("userId", "date");

-- CreateIndex
CREATE INDEX "InjuryFlag_userId_active_idx" ON "InjuryFlag"("userId", "active");

-- CreateIndex
CREATE INDEX "InjuryFlag_userId_bodyPart_idx" ON "InjuryFlag"("userId", "bodyPart");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "WorkoutLog" ADD CONSTRAINT "WorkoutLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiftLog" ADD CONSTRAINT "LiftLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiftLog" ADD CONSTRAINT "LiftLog_workoutLogId_fkey" FOREIGN KEY ("workoutLogId") REFERENCES "WorkoutLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SorenessLog" ADD CONSTRAINT "SorenessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyweightLog" ADD CONSTRAINT "BodyweightLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyLog" ADD CONSTRAINT "EnergyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InjuryFlag" ADD CONSTRAINT "InjuryFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
