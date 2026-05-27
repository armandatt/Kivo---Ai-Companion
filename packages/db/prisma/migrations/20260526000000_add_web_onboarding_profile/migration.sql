ALTER TABLE "UserProfile"
ADD COLUMN "energyPattern" TEXT,
ADD COLUMN "corePain" TEXT,
ADD COLUMN "primaryGoal30d" TEXT,
ADD COLUMN "goalCategory" TEXT,
ADD COLUMN "accountabilityStyle" TEXT,
ADD COLUMN "aspirationWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "personaName" TEXT,
ADD COLUMN "personaDescription" TEXT,
ADD COLUMN "creatureType" TEXT,
ADD COLUMN "creatureColor" TEXT,
ADD COLUMN "creatureName" TEXT,
ADD COLUMN "preferredCheckInTime" TEXT,
ADD COLUMN "timezone" TEXT,
ADD COLUMN "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "onboardingAnswers" JSONB;

ALTER TABLE "UserProfile"
ALTER COLUMN "primaryDomain" DROP NOT NULL,
ALTER COLUMN "seriousness" DROP NOT NULL,
ALTER COLUMN "consistency" DROP NOT NULL,
ALTER COLUMN "motivationType" DROP NOT NULL,
ALTER COLUMN "failurePattern" DROP NOT NULL,
ALTER COLUMN "emotionalTrigger" DROP NOT NULL,
ALTER COLUMN "riskLevel" DROP NOT NULL,
ALTER COLUMN "primaryPersona" DROP NOT NULL,
ALTER COLUMN "tone" DROP NOT NULL;
