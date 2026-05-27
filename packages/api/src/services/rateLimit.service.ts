import { prisma } from "@repo/db/client";

const limitsByTier = {
  free: { hourly: 20, daily: 50 },
  pro: { hourly: 60, daily: 300 },
  elite: { hourly: 200, daily: 1000 },
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

    const [hourlyCount, dailyCount] = await Promise.all([
      prisma.companionMessage.count({
        where: {
          userId: user.id,
          role: "user",
          createdAt: { gte: hourAgo },
        },
      }),
      prisma.companionMessage.count({
        where: {
          userId: user.id,
          role: "user",
          createdAt: { gte: dayAgo },
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
