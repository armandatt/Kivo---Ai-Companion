import { prisma } from "@repo/db/client";

const fallbackUsers: Record<string, CompanionUser> = {};

export type CompanionUser = {
  id: string;
  name: string;
  persona: string;
  tonePreference: string;
  platform: string;
  platformChatId: string;
  preferredCheckInTime?: string | null;
  timezone?: string | null;
};


export async function getUser(userId: string) {
  try {
    const user = await prisma.messengerUser.upsert({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId: userId,
        },
      },
      update: {},
      create: {
        platform: "telegram",
        platformChatId: userId,
        aspirationWords: [],
        activeModules: [],
      },
    });

    return {
      id: user.id,
      name: user.displayName || user.username || "there",
      persona: user.persona,
      tonePreference: user.tonePreference,
      platform: user.platform,
      platformChatId: user.platformChatId,
      preferredCheckInTime: user.preferredCheckInTime,
      timezone: user.timezone,
    };
  } catch (error) {
    console.error("Failed to load messenger user:", error);

    fallbackUsers[userId] ||= {
      id: userId,
      name: "there",
      persona: "rex",
      tonePreference: "hard",
      platform: "telegram",
      platformChatId: userId,
      preferredCheckInTime: null,
      timezone: null,
    };

    return fallbackUsers[userId];
  }
}


export async function getUsersDueForDynamicCheckIn(now: Date) {
  // Fire if due within the last 12 minutes (2.4× the 5-minute cron interval).
  // This survives a single missed tick without spamming on server restarts.
  // Entries older than 12 minutes are silently cleared by advanceDynamicCheckIn.
  const staleThreshold = new Date(now.getTime() - 12 * 60 * 1000);
  try {
    return await prisma.messengerUser.findMany({
      where: {
        platform: "telegram",
        nextCheckInAt: {
          lte: now,
          gte: staleThreshold,
        },
      },
      select: {
        platformChatId: true,
        checkInIntervalMin: true,
        nextCheckInAt: true,
      },
    });
  } catch (error) {
    console.error("Failed to load dynamic check-in users:", error);
    return [];
  }
}

// Clear check-in entries that are past the stale threshold without firing them.
// Called on each cron tick to prevent very late messages after downtime.
export async function clearStaleCheckIns(now: Date) {
  const staleThreshold = new Date(now.getTime() - 12 * 60 * 1000);
  try {
    await prisma.messengerUser.updateMany({
      where: {
        platform: "telegram",
        nextCheckInAt: {
          lt: staleThreshold,
        },
        checkInIntervalMin: null, // one-shot only; repeating reschedules itself via advanceDynamicCheckIn
      },
      data: {
        nextCheckInAt: null,
      },
    });
  } catch (error) {
    console.error("Failed to clear stale check-ins:", error);
  }
}

export async function advanceDynamicCheckIn(
  platformChatId: string,
  intervalMin: number | null,
  now: Date
) {
  await prisma.messengerUser.updateMany({
    where: { platform: "telegram", platformChatId },
    data: {
      nextCheckInAt: intervalMin ? new Date(now.getTime() + intervalMin * 60 * 1000) : null,
      checkInIntervalMin: intervalMin ?? null,
    },
  });
}

export async function updateUserProfile(
  userId: string,
  input: {
    displayName?: string;
    username?: string;
  }
) {
  try {
    await prisma.messengerUser.upsert({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId: userId,
        },
      },
      update: {
        displayName: input.displayName,
        username: input.username,
      },
      create: {
        platform: "telegram",
        platformChatId: userId,
        displayName: input.displayName,
        username: input.username,
        aspirationWords: [],
        activeModules: [],
      },
    });
  } catch (error) {
    console.error("Failed to update messenger user profile:", error);
  }
}
