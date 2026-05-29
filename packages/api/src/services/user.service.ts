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

export type CompanionVisitKind =
  | "morning"
  | "basic_2h"
  | "major_4h"
  | "basic_6h"
  | "major_8h"
  | "basic_10h"
  | "evening";

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
    const users = await prisma.messengerUser.findMany({
      where: {
        platform: "telegram",
      },
      select: {
        platformChatId: true,
        preferredCheckInTime: true,
        timezone: true,
      },
    });

    return users
      .map((user: { preferredCheckInTime: any; platformChatId: any; }) => {
        const visitKind = getVisitKind(currentTime, user.preferredCheckInTime || "08:00");

        if (!visitKind) return null;

        return {
          platformChatId: user.platformChatId,
          visitKind,
        };
      })
      .filter((user: any): user is { platformChatId: string; visitKind: CompanionVisitKind } => Boolean(user));
  } catch (error) {
    console.error("Failed to load companion visit users:", error);
    return [];
  }
}

export async function getUsersForCompanionVisitAt(now: Date) {
  try {
    const users = await prisma.messengerUser.findMany({
      where: {
        platform: "telegram",
      },
      select: {
        platformChatId: true,
        preferredCheckInTime: true,
        timezone: true,
      },
    });

    return users
      .map((user: { timezone: any; preferredCheckInTime: any; platformChatId: any; }) => {
        const localTime = getLocalTime(now, user.timezone || "Asia/Kolkata");
        const visitKind = getVisitKind(localTime, user.preferredCheckInTime || "08:00");

        if (!visitKind) return null;

        return {
          platformChatId: user.platformChatId,
          visitKind,
          localTime,
        };
      })
      .filter(
        (
          user: any
        ): user is {
          platformChatId: string;
          visitKind: CompanionVisitKind;
          localTime: string;
        } => Boolean(user)
      );
  } catch (error) {
    console.error("Failed to load companion visit users:", error);
    return [];
  }
}

function getLocalTime(now: Date, timezone: string) {
  // Floor to 5-minute boundary so a cron running at :01 or :04 still matches a :00 check-in time.
  const floored = new Date(now)
  floored.setMinutes(Math.floor(floored.getMinutes() / 5) * 5, 0, 0)
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(floored)
}

function getVisitKind(currentTime: string, checkInTime: string) {
  if (currentTime === checkInTime) return "morning";
  if (currentTime === addMinutes(checkInTime, 2 * 60)) return "basic_2h";
  if (currentTime === addMinutes(checkInTime, 4 * 60)) return "major_4h";
  if (currentTime === addMinutes(checkInTime, 6 * 60)) return "basic_6h";
  if (currentTime === addMinutes(checkInTime, 8 * 60)) return "major_8h";
  if (currentTime === addMinutes(checkInTime, 10 * 60)) return "basic_10h";
  if (currentTime === addMinutes(checkInTime, 12 * 60)) return "evening";

  return null;
}

function addMinutes(time: string, minutesToAdd: number) {
  const [hours = "0", minutes = "0"] = time.split(":");
  const total = (Number(hours) * 60 + Number(minutes) + minutesToAdd) % (24 * 60);
  const normalized = total < 0 ? total + 24 * 60 : total;
  const nextHours = Math.floor(normalized / 60);
  const nextMinutes = normalized % 60;

  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
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
