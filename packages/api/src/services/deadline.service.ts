import { prisma } from "@repo/db/client";
import { addToLongTerm } from "./memory.service";

export async function saveDeadline(input: {
  platformChatId: string;
  title: string;
  dueAt: Date;
}) {
  const user = await prisma.messengerUser.upsert({
    where: {
      platform_platformChatId: {
        platform: "telegram",
        platformChatId: input.platformChatId,
      },
    },
    update: {},
    create: {
      platform: "telegram",
      platformChatId: input.platformChatId,
    },
  });

  const deadline = await prisma.deadline.create({
    data: {
      userId: user.id,
      title: input.title,
      dueAt: input.dueAt,
    },
  });

  await addToLongTerm(
    input.platformChatId,
    "deadlines",
    `${input.title} due ${input.dueAt.toISOString()}`
  );

  return deadline;
}

export async function getUpcomingDeadlines(platformChatId: string, limit = 3) {
  try {
    return await prisma.deadline.findMany({
      where: {
        status: "active",
        dueAt: { gte: new Date() },
        user: {
          platform: "telegram",
          platformChatId,
        },
      },
      orderBy: { dueAt: "asc" },
      take: limit,
    });
  } catch (error) {
    console.error("Failed to load deadlines:", error);
    return [];
  }
}

export async function pushNearestDeadline(platformChatId: string, minutes: number) {
  try {
    const deadline = await prisma.deadline.findFirst({
      where: {
        status: "active",
        dueAt: { gte: new Date() },
        user: {
          platform: "telegram",
          platformChatId,
        },
      },
      orderBy: { dueAt: "asc" },
    });

    if (!deadline) return null;

    return await prisma.deadline.update({
      where: { id: deadline.id },
      data: {
        dueAt: new Date(deadline.dueAt.getTime() + minutes * 60 * 1000),
      },
    });
  } catch (error) {
    console.error("Failed to push deadline:", error);
    return null;
  }
}
