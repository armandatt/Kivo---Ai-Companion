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

export async function getUsersDueForCheckIn(currentTime: string) {
  try {
    const includeDefaultMorningUsers = currentTime === "08:00";

    return await prisma.messengerUser.findMany({
      where: {
        platform: "telegram",
        OR: [
          { preferredCheckInTime: currentTime },
          ...(includeDefaultMorningUsers ? [{ preferredCheckInTime: null }] : []),
        ],
      },
      select: {
        platformChatId: true,
      },
    });
  } catch (error) {
    console.error("Failed to load check-in users:", error);
    return [];
  }
}

export async function getUsersForCompanionVisit(currentTime: string) {
  try {
    const visitKind = getVisitKind(currentTime);

    if (!visitKind) return [];

    const users = await prisma.messengerUser.findMany({
      where: {
        platform: "telegram",
      },
      select: {
        platformChatId: true,
        preferredCheckInTime: true,
      },
    });

    return users
      .filter((user) => {
        if (visitKind !== "morning") return true;
        return (user.preferredCheckInTime || "08:00") === currentTime;
      })
      .map((user) => ({
        platformChatId: user.platformChatId,
        visitKind,
      }));
  } catch (error) {
    console.error("Failed to load companion visit users:", error);
    return [];
  }
}

function getVisitKind(currentTime: string) {
  if (currentTime === "08:00") return "morning";
  if (currentTime === "14:00") return "plan_nudge";
  if (currentTime === "20:00") return "evening";
  return null;
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
      },
    });
  } catch (error) {
    console.error("Failed to update messenger user profile:", error);
  }
}
