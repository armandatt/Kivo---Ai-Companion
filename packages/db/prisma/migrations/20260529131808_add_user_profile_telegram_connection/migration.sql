-- AlterTable
ALTER TABLE "UserProfile"
ADD COLUMN "telegramConnectToken" TEXT,
ADD COLUMN "telegramChatId" TEXT,
ADD COLUMN "telegramConnected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "telegramConnectedAt" TIMESTAMP(3),
ADD COLUMN "nextMessageTime" TIMESTAMP(3),
ADD COLUMN "lastMessageSentAt" TIMESTAMP(3),
ADD COLUMN "lastActivityAt" TIMESTAMP(3),
ADD COLUMN "messageSchedule" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_telegramConnectToken_key" ON "UserProfile"("telegramConnectToken");
