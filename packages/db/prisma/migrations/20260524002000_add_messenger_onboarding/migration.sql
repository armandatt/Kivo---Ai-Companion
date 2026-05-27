-- AlterTable
ALTER TABLE "MessengerUser" ADD COLUMN     "onboardingStep" TEXT NOT NULL DEFAULT 'not_started',
ADD COLUMN     "onboardingAnswers" JSONB,
ADD COLUMN     "energyPattern" TEXT,
ADD COLUMN     "corePain" TEXT,
ADD COLUMN     "primaryGoal30d" TEXT,
ADD COLUMN     "goalCategory" TEXT,
ADD COLUMN     "accountabilityStyle" TEXT,
ADD COLUMN     "aspirationWords" TEXT[],
ADD COLUMN     "creatureType" TEXT,
ADD COLUMN     "creatureColor" TEXT,
ADD COLUMN     "creatureName" TEXT;
