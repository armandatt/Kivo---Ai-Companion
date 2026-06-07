import { prisma } from "@repo/db/client";

const limitsByTier = {
  // Free tier was 20/hr — too low for active onboarding sessions.
  // Raised to 60/hr so a normal gym coaching session never hits the limit.
  free:  { hourly: 60,  daily: 200  },
  pro:   { hourly: 120, daily: 600  },
  elite: { hourly: 400, daily: 2000 },
};

export async function checkRateLimit(platformChatId: string) {
  try {
    const user = await prisma.messengerUser.upsert({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId,
        },
      },
      update: {},
      create: {
        platform: "telegram",
        platformChatId,
      },
    });

    const tier = user.tier as keyof typeof limitsByTier;
    const limits = limitsByTier[tier] || limitsByTier.free;
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60 * 1000);
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Exclude intake messages — they're mandatory (onboarding can't be skipped)
    // and should not deplete the conversational quota.
    const [hourlyCount, dailyCount] = await Promise.all([
      prisma.companionMessage.count({
        where: {
          userId: user.id, role: "user", createdAt: { gte: hourAgo },
          OR: [{ intent: null }, { intent: { not: "intake" } }],
        },
      }),
      prisma.companionMessage.count({
        where: {
          userId: user.id, role: "user", createdAt: { gte: dayAgo },
          OR: [{ intent: null }, { intent: { not: "intake" } }],
        },
      }),
    ]);

    const allowed = hourlyCount < limits.hourly && dailyCount < limits.daily;
    const ratio = Math.max(hourlyCount / limits.hourly, dailyCount / limits.daily);

    return {
      allowed,
      warning: allowed && ratio >= 0.8,
      hourlyCount,
      dailyCount,
      limits,
    };
  } catch (error) {
    console.error("Rate limit check failed:", error);
    return {
      allowed: true,
      warning: false,
      hourlyCount: 0,
      dailyCount: 0,
      limits: limitsByTier.free,
    };
  }
}
