-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryDomain" TEXT NOT NULL,
    "secondaryDomains" TEXT[],
    "seriousness" TEXT NOT NULL,
    "consistency" TEXT NOT NULL,
    "motivationType" TEXT NOT NULL,
    "failurePattern" TEXT NOT NULL,
    "emotionalTrigger" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "primaryPersona" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "gymExperience" TEXT,
    "gymDaysPerWeek" INTEGER,
    "gymPreferredTime" TEXT,
    "bench" INTEGER,
    "squat" INTEGER,
    "deadlift" INTEGER,
    "gymGoal" TEXT,
    "gymStruggle" TEXT,
    "gymEnvironment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
