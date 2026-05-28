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

    const gymMemory = await buildGymLongTermMemory(userId);
    const longTerm = {
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
      ...(gymMemory ? { gym: gymMemory } : {}),
    };

    return {
      shortTerm: user.messages
        .reverse()
        .map((message) => `${message.role}: ${message.text}`),
      longTerm,
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

async function buildGymLongTermMemory(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      gymMode: true,
      gymGoal: true,
      dietType: true,
      currentSplit: true,
      phaseWeek: true,
    },
  });

  if (!profile?.gymMode) return null;

  const thirtyDaysAgo = daysAgo(30);
  const [latestBodyweight, liftLogs, injuryFlags, energyLogs, completed30d, total30d, skipped30d] =
    await Promise.all([
      prisma.bodyweightLog.findFirst({
        where: { userId },
        orderBy: { date: "desc" },
        select: { weightKg: true },
      }),
      prisma.liftLog.findMany({
        where: { userId },
        orderBy: { id: "desc" },
        select: {
          exercise: true,
          weightKg: true,
          reps: true,
          sets: true,
          workoutLog: {
            select: { date: true },
          },
        },
      }),
      prisma.injuryFlag.findMany({
        where: { userId, active: true },
        select: {
          id: true,
          bodyPart: true,
          exercise: true,
          reportCount: true,
          firstReported: true,
          lastReported: true,
        },
      }),
      prisma.energyLog.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 7,
        select: {
          morningScore: true,
          sleepHours: true,
        },
      }),
      prisma.workoutLog.count({
        where: {
          userId,
          completed: true,
          date: { gte: thirtyDaysAgo },
        },
      }),
      prisma.workoutLog.count({
        where: {
          userId,
          date: { gte: thirtyDaysAgo },
        },
      }),
      prisma.workoutLog.findMany({
        where: {
          userId,
          completed: false,
          date: { gte: thirtyDaysAgo },
        },
        select: { date: true },
      }),
    ]);

  const currentBodyweight = latestBodyweight?.weightKg ?? null;

  return {
    gymGoal: profile.gymGoal,
    currentBodyweight,
    proteinTargetG: currentBodyweight ? Math.round(currentBodyweight * 1.8) : null,
    dietType: profile.dietType,
    currentSplit: profile.currentSplit,
    phaseWeek: profile.phaseWeek,
    lifts: groupLastThreeLiftsByExercise(liftLogs),
    injuryFlags,
    last7DaysEnergy: energyLogs.map((entry) => entry.morningScore),
    last7DaysSleep: energyLogs.map((entry) => entry.sleepHours),
    consistencyScore30d: total30d ? completed30d / total30d : 0,
    skipPattern: groupSkipsByDayOfWeek(skipped30d),
  };
}

function groupLastThreeLiftsByExercise(
  liftLogs: Array<{
    exercise: string;
    weightKg: number;
    reps: number;
    sets: number;
    workoutLog: { date: Date };
  }>
) {
  return liftLogs.reduce<Record<string, Array<{ weightKg: number; reps: number; sets: number; date: Date }>>>(
    (groups, lift) => {
      const key = normalizeExerciseKey(lift.exercise);
      const entries = groups[key] || [];

      if (entries.length < 3) {
        entries.push({
          weightKg: lift.weightKg,
          reps: lift.reps,
          sets: lift.sets,
          date: lift.workoutLog.date,
        });
      }

      groups[key] = entries;
      return groups;
    },
    {}
  );
}

function groupSkipsByDayOfWeek(skippedWorkouts: Array<{ date: Date }>) {
  return skippedWorkouts.reduce<Record<string, number>>((pattern, workout) => {
    const day = workout.date
      .toLocaleDateString("en-US", { weekday: "long" })
      .toLowerCase();

    pattern[day] = (pattern[day] || 0) + 1;
    return pattern;
  }, {});
}

function normalizeExerciseKey(exercise: string) {
  if (exercise === "bench") return "bench_press";
  return exercise.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
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
