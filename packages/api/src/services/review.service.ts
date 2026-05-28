import { getMemory } from "./memory.service";
import { getUpcomingDeadlines } from "./deadline.service";
import { prisma } from "@repo/db/client";
import {
  detectDeloadTriggerForWeeklyReport,
  detectSkipPatternForWeeklyReport,
} from "./gymDetections.service";

export async function generateProgressSummary(userId: string) {
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const goals = memory.longTerm.goals || [];

  if (!goals.length && !deadlines.length) {
    return "I do not have enough signal yet. Tell me one goal, one deadline, or what you showed up for today.";
  }

  return [
    "Here is the honest read:",
    goals[0] ? `Goal in focus: ${goals[0]}` : null,
    deadlines[0] ? `Nearest deadline: ${deadlines[0].title}` : null,
    "Next move: choose one action you can finish today.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateWeeklyReview(userId: string) {
  const memory = await getMemory(userId);
  const goals = memory.longTerm.goals || [];
  const deadlines = memory.longTerm.deadlines || [];
  const skipPatternMessages = await detectSkipPatternForWeeklyReport(userId);
  const deloadMessage = await detectDeloadTriggerForWeeklyReport(userId);
  const gymReport = await buildGymWeeklyReportExtension(userId);

  return [
    "Weekly review:",
    goals.length ? `What stayed alive: ${goals.slice(0, 3).join(", ")}` : "No clear goal tracked yet.",
    deadlines.length ? `Pressure points: ${deadlines.slice(0, 2).join(", ")}` : "No active deadlines tracked.",
    ...skipPatternMessages,
    deloadMessage,
    gymReport,
    "One insight: consistency comes from making the next step smaller, then actually doing it.",
  ].filter(Boolean).join("\n");
}

async function buildGymWeeklyReportExtension(userId: string) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId },
    select: {
      gymMode: true,
      gymGoal: true,
      currentSplit: true,
      phaseWeek: true,
      primaryPersona: true,
    },
  });

  if (!profile?.gymMode) return null;

  const now = new Date();
  const weekStart = daysAgoFrom(now, 7);
  const previousWeekStart = daysAgoFrom(now, 14);

  const [
    completedSessions,
    allSessions,
    liftLogs,
    previousLiftLogs,
    plateauFlags,
    nutritionMessages,
    energyLogs,
    latestWeight,
    previousWeight,
  ] = await Promise.all([
    (prisma as any).workoutLog.count({
      where: { userId, completed: true, date: { gte: weekStart } },
    }),
    (prisma as any).workoutLog.count({
      where: { userId, date: { gte: weekStart } },
    }),
    (prisma as any).liftLog.findMany({
      where: { userId, workoutLog: { date: { gte: weekStart } } },
      orderBy: { id: "desc" },
      select: {
        exercise: true,
        weightKg: true,
        reps: true,
        workoutLog: { select: { date: true } },
      },
    }),
    (prisma as any).liftLog.findMany({
      where: {
        userId,
        workoutLog: {
          date: { gte: previousWeekStart, lt: weekStart },
        },
      },
      orderBy: { id: "desc" },
      select: {
        exercise: true,
        weightKg: true,
        reps: true,
      },
    }),
    (prisma as any).memoryFact.findMany({
      where: {
        user: {
          platform: "telegram",
          platformChatId: userId,
        },
        key: "plateau_flag",
        createdAt: { gte: weekStart },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { value: true },
    }),
    (prisma as any).companionMessage.findMany({
      where: {
        user: {
          platform: "telegram",
          platformChatId: userId,
        },
        createdAt: { gte: weekStart },
        OR: [
          { intent: "nutrition_query" },
          { text: { contains: "protein", mode: "insensitive" } },
        ],
      },
      select: { text: true },
    }),
    (prisma as any).energyLog.findMany({
      where: { userId, date: { gte: weekStart } },
      select: {
        morningScore: true,
        sleepHours: true,
      },
    }),
    (prisma as any).bodyweightLog.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      select: { weightKg: true },
    }),
    (prisma as any).bodyweightLog.findFirst({
      where: { userId, date: { lt: weekStart } },
      orderBy: { date: "desc" },
      select: { weightKg: true },
    }),
  ]);

  const plannedSessions = Math.max(allSessions, plannedSessionsForSplit(profile.currentSplit));
  const overloadWins = getTopOverloadWins(liftLogs, previousLiftLogs);
  const proteinHitRate = getProteinHitRate(nutritionMessages);
  const avgEnergy = average(energyLogs.map((log: any) => log.morningScore));
  const avgSleep = average(energyLogs.map((log: any) => log.sleepHours));
  const goalPace = getGoalPace(profile.gymGoal, latestWeight?.weightKg, previousWeight?.weightKg, completedSessions, plannedSessions);
  const focusPoint = getNextWeekFocusPoint({
    completedSessions,
    plannedSessions,
    overloadWins,
    plateauFlags,
    avgEnergy,
    avgSleep,
    proteinHitRate,
  });
  const deloadFlag =
    profile.phaseWeek >= 9
      ? "Deload flag: take one full week at 50-60% working weight with 40% less volume."
      : null;

  return renderGymWeeklyReport(profile.primaryPersona, [
    `Sessions this week: ${completedSessions} of ${plannedSessions} planned completed.`,
    overloadWins.length
      ? `Top 3 overload wins: ${overloadWins.slice(0, 3).join(", ")}.`
      : "Top 3 overload wins: none logged this week.",
    plateauFlags.length
      ? `Plateau flags: ${plateauFlags.map((flag: any) => flag.value).join(" ")}`
      : "Plateau flags: none.",
    proteinHitRate === null ? null : `Protein hit rate: ${proteinHitRate} of 7 days target met.`,
    avgEnergy === null ? null : `Avg morning energy score: ${avgEnergy.toFixed(1)}/5.`,
    avgSleep === null ? null : `Avg sleep hours: ${avgSleep.toFixed(1)}.`,
    `Goal pace: ${goalPace}.`,
    deloadFlag,
    `Focus point next week: ${focusPoint}.`,
  ]);
}

function renderGymWeeklyReport(persona: string | null, lines: Array<string | null>) {
  const body = lines.filter(Boolean);

  if (persona === "nova") {
    return ["Gym review:", ...body.map((line) => `- ${line}`), "Tone: steady progress, not punishment."].join("\n");
  }

  return ["Gym review:", ...body.map((line) => `- ${line}`), "Tone: no hiding, just better execution next week."].join("\n");
}

function getTopOverloadWins(currentWeek: any[], previousWeek: any[]): string[] {
  const previousBest = previousWeek.reduce<Record<string, any>>((best, lift) => {
    const existing = best[lift.exercise];
    if (!existing || lift.weightKg > existing.weightKg || lift.reps > existing.reps) {
      best[lift.exercise] = lift;
    }
    return best;
  }, {});

  return currentWeek
    .map((lift) => {
      const previous = previousBest[lift.exercise];
      if (!previous) return null;
      if (lift.weightKg > previous.weightKg) {
        return `${formatExercise(lift.exercise)}: ${previous.weightKg}kg→${lift.weightKg}kg`;
      }
      if (lift.reps > previous.reps) {
        return `${formatExercise(lift.exercise)}: ${previous.reps}→${lift.reps} reps`;
      }
      return null;
    })
    .filter((v): v is string => v !== null)
    .slice(0, 3);
}

function getProteinHitRate(messages: Array<{ text: string }>) {
  if (!messages.length) return null;

  return messages.filter((message) =>
    /\b(hit|met|done|completed|got|reached)\b.*\bprotein\b|\bprotein\b.*\b(hit|met|done|completed|got|reached)\b/i.test(message.text)
  ).length;
}

function getGoalPace(
  gymGoal: string | null,
  latestWeight?: number,
  previousWeight?: number,
  completedSessions = 0,
  plannedSessions = 0
) {
  const sessionPace =
    plannedSessions && completedSessions / plannedSessions >= 0.85
      ? "ahead"
      : plannedSessions && completedSessions / plannedSessions < 0.6
        ? "behind"
        : "on track";

  if (!latestWeight || !previousWeight || !gymGoal) return sessionPace;

  const delta = latestWeight - previousWeight;
  if (gymGoal === "bulk") return delta > 0.2 ? "ahead" : delta < -0.2 ? "behind" : "on track";
  if (gymGoal === "cut") return delta < -0.2 ? "ahead" : delta > 0.2 ? "behind" : "on track";

  return sessionPace;
}

function getNextWeekFocusPoint(input: {
  completedSessions: number;
  plannedSessions: number;
  overloadWins: string[];
  plateauFlags: any[];
  avgEnergy: number | null;
  avgSleep: number | null;
  proteinHitRate: number | null;
}) {
  if (input.plannedSessions && input.completedSessions / input.plannedSessions < 0.6) return "protect session timing before adding ambition";
  if (input.avgSleep !== null && input.avgSleep < 6.5) return "sleep recovery";
  if (input.avgEnergy !== null && input.avgEnergy < 3) return "lower intensity and rebuild energy";
  if (input.proteinHitRate !== null && input.proteinHitRate < 4) return "hit protein earlier in the day";
  if (input.plateauFlags.length) return "change progression on the stuck lift";
  if (!input.overloadWins.length) return "log lifts clearly so progression has data";
  return "repeat the working pattern";
}

function plannedSessionsForSplit(split: string | null) {
  if (split === "PPL") return 6;
  if (split === "upper-lower") return 4;
  if (split === "full-body") return 3;
  if (split === "bro-split") return 5;
  return 3;
}

function average(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === "number");
  if (!present.length) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function daysAgoFrom(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}

function formatExercise(exercise: string) {
  if (exercise === "bench") return "Bench";
  return exercise.charAt(0).toUpperCase() + exercise.slice(1);
}
