import { prisma } from "@repo/db/client";

const shortTermStore: Record<string, string[]> = {};
const longTermStore: Record<string, any> = {};

const MAX_SHORT = 20;

// ✅ GET MEMORY
export async function getMemory(userId: string) {
  try {
    const user = await prisma.messengerUser.findUnique({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId: userId,
        },
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: MAX_SHORT,
        },
        memories: {
          where: { archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 40,
        },
        goals: {
          where: { status: "active" },
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
        deadlines: {
          where: { status: "active" },
          orderBy: { dueAt: "asc" },
          take: 5,
        },
      },
    });

    if (!user) {
      return getFallbackMemory(userId);
    }

    return {
      shortTerm: user.messages
        .reverse()
        .map((message) => `${message.role}: ${message.text}`),
      longTerm: {
        goals: [
          ...user.goals.map((goal) => goal.title),
          ...user.memories
            .filter((memory) => memory.type === "goal")
            .map((memory) => memory.value),
        ],
        struggles: user.memories
          .filter((memory) => memory.type === "struggle")
          .map((memory) => memory.value),
        deadlines: [
          ...user.deadlines.map(
            (deadline) => `${deadline.title} due ${deadline.dueAt.toISOString()}`
          ),
          ...user.memories
            .filter((memory) => memory.type === "deadline")
            .map((memory) => memory.value),
        ],
        preferences: user.memories
          .filter((memory) => memory.type === "preference")
          .map((memory) => memory.value),
        anchors: user.memories
          .filter((memory) => memory.type === "anchor")
          .map((memory) => memory.value),
      },
    };
  } catch (error) {
    console.error("Failed to load memory from DB:", error);
    return getFallbackMemory(userId);
  }
}

function getFallbackMemory(userId: string) {
  return {
    shortTerm: shortTermStore[userId] || [],
    longTerm: longTermStore[userId] || {
      goals: [],
      struggles: [],
      deadlines: [],
      preferences: [],
      anchors: [],
    },
  };
}

// ✅ ADD SHORT TERM MEMORY
export async function addToShortTerm(
  userId: string,
  message: string,
  metadata?: {
    role?: "user" | "assistant";
    intent?: string;
    emotion?: string;
  }
) {
  if (!shortTermStore[userId]) {
    shortTermStore[userId] = [];
  }

  const role = metadata?.role || "user";
  shortTermStore[userId].push(`${role}: ${message}`);

  if (shortTermStore[userId].length > MAX_SHORT) {
    shortTermStore[userId].shift();
  }

  try {
    const user = await ensureMessengerUser(userId);

    await prisma.companionMessage.create({
      data: {
        userId: user.id,
        role,
        text: message,
        intent: metadata?.intent,
        emotion: metadata?.emotion,
      },
    });
  } catch (error) {
    console.error("Failed to save short-term memory:", error);
  }
}

// ✅ ADD LONG TERM MEMORY (basic)
export async function addToLongTerm(userId: string, key: string, value: any) {
  if (!longTermStore[userId]) {
    longTermStore[userId] = {};
  }

  if (!longTermStore[userId][key]) {
    longTermStore[userId][key] = [];
  }

  longTermStore[userId][key].push(value);

  try {
    const user = await ensureMessengerUser(userId);
    const textValue = String(value);
    const type = normalizeMemoryType(key);

    await prisma.memoryFact.create({
      data: {
        userId: user.id,
        type,
        key,
        value: textValue,
      },
    });

    if (type === "goal") {
      await prisma.goal.create({
        data: {
          userId: user.id,
          title: textValue,
        },
      });
    }
  } catch (error) {
    console.error("Failed to save long-term memory:", error);
  }
}

async function ensureMessengerUser(platformChatId: string) {
  return prisma.messengerUser.upsert({
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
}

function normalizeMemoryType(key: string) {
  if (key === "goals") return "goal";
  if (key === "deadlines") return "deadline";
  if (key === "preferences") return "preference";
  if (key === "struggles") return "struggle";
  return "anchor";
}
