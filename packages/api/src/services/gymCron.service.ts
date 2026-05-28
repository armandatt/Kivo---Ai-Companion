import { prisma } from "@repo/db/client";
import {
  detectDeloadTriggerForWeeklyReport,
  runProgressiveOverloadCheck,
} from "./gymDetections.service";
import { generateWeeklyReview } from "./review.service";

export type GymCronMessage = {
  userId: string;
  chatId: string;
  text: string;
  intent: string;
};

export async function runGymCronJobs(now = new Date()) {
  const [preSession, postSession, reengagement, sundayReports] = await Promise.all([
    runPreSessionFormCueCron(now),
    runPostSessionDebriefCron(now),
    runReengagementCron(now),
    runSundayPlateauAndDeloadCron(now),
  ]);

  return [...preSession, ...postSession, ...reengagement, ...sundayReports];
}

export async function runPreSessionFormCueCron(now = new Date()): Promise<GymCronMessage[]> {
  const users = await getGymUsersDueAt(now, -30);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (await hasWorkoutToday(user.userId, now)) continue;
    if (await wasCronSentToday(user.userId, "pre_session_form_cue", now)) continue;

    const compoundLift = getPrimaryCompoundLift(user.currentSplit, now);
    const text = [
      "Any pain or tightness before we start?",
      getFormCue(compoundLift),
      "If you do not reply in 10 minutes, we proceed normally.",
    ].join("\n");

    await markCronSent(user.userId, "pre_session_form_cue", now);
    messages.push(toCronMessage(user.userId, text, "pre_session_form_cue"));
  }

  return messages;
}

export async function runPostSessionDebriefCron(now = new Date()): Promise<GymCronMessage[]> {
  const users = await getGymUsersDueAt(now, 45);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    const workout = await getTodayWorkoutNeedingDebrief(user.userId, now);
    if (!workout) continue;
    if (await wasCronSentToday(user.userId, "post_session_debrief", now)) continue;

    await markCronSent(user.userId, "post_session_debrief", now);
    messages.push(
      toCronMessage(
        user.userId,
        "Session rating 1-5? Send the lifts too, like `bench 80kg 4x8, squat 90kg 3x10`.",
        "post_session_debrief"
      )
    );
  }

  return messages;
}

export async function handlePostSessionDebriefResponse(userId: string, text: string) {
  const workout = await getTodayWorkoutNeedingDebrief(userId, new Date());
  if (!workout) return null;

  const intensityScore = extractIntensityScore(text);
  const lifts = extractLiftEntries(text);

  await (prisma as any).workoutLog.update({
    where: { id: workout.id },
    data: {
      intensityScore,
      musclesWorked: mergeUnique(workout.musclesWorked, lifts.flatMap((lift) => musclesForExercise(lift.exercise))),
    },
  });

  for (const lift of lifts) {
    const createdLift = await (prisma as any).liftLog.create({
      data: {
        userId,
        workoutLogId: workout.id,
        exercise: lift.exercise,
        weightKg: lift.weightKg,
        reps: lift.reps,
        sets: lift.sets,
      },
    });

    await runProgressiveOverloadCheck(userId, createdLift);
  }

  if (!intensityScore && !lifts.length) return null;

  return [
    intensityScore ? `Intensity logged: ${intensityScore}/5.` : null,
    lifts.length ? `Logged ${lifts.length} lift${lifts.length === 1 ? "" : "s"}.` : null,
  ].filter(Boolean).join(" ");
}

export async function runReengagementCron(now = new Date()): Promise<GymCronMessage[]> {
  const profiles = await (prisma as any).userProfile.findMany({
    where: { gymMode: true },
    select: {
      userId: true,
      primaryPersona: true,
      onboardingAnswers: true,
    },
  });
  const messages: GymCronMessage[] = [];

  for (const profile of profiles) {
    const memory = getGymCronMemory(profile.onboardingAnswers);
    if (memory.reengagementSent) continue;
    if (!(await wasStreakPreviouslyActive(profile.userId, now))) continue;
    if (!(await hasBeenQuietFor72Hours(profile.userId, now))) continue;

    await updateGymCronMemory(profile.userId, {
      ...memory,
      reengagementSent: true,
    });

    messages.push(
      toCronMessage(
        profile.userId,
        reengagementMessage(profile.primaryPersona),
        "gym_reengagement"
      )
    );
  }

  return messages;
}

export async function resetReengagementFlag(userId: string) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId },
    select: { onboardingAnswers: true },
  });

  if (!profile) return;
  const memory = getGymCronMemory(profile.onboardingAnswers);
  if (!memory.reengagementSent) return;

  await updateGymCronMemory(userId, {
    ...memory,
    reengagementSent: false,
  });
}

export async function runSundayPlateauAndDeloadCron(now = new Date()): Promise<GymCronMessage[]> {
  const profiles = await (prisma as any).userProfile.findMany({
    where: { gymMode: true },
    select: {
      userId: true,
      timezone: true,
    },
  });
  const messages: GymCronMessage[] = [];

  for (const profile of profiles) {
    if (!isSundayEightPm(now, profile.timezone || undefined)) continue;
    if (await wasCronSentToday(profile.userId, "sunday_gym_weekly_report", now)) continue;

    await flagPlateausForWeeklyReport(profile.userId);
    await detectDeloadTriggerForWeeklyReport(profile.userId);

    const report = await generateWeeklyReview(profile.userId);
    await markCronSent(profile.userId, "sunday_gym_weekly_report", now);
    messages.push(toCronMessage(profile.userId, report, "weekly_review"));
  }

  return messages;
}

async function getGymUsersDueAt(now: Date, offsetMinutes: number) {
  const profiles = await (prisma as any).userProfile.findMany({
    where: {
      gymMode: true,
      sessionTime: { not: null },
    },
    select: {
      userId: true,
      currentSplit: true,
      sessionTime: true,
      timezone: true,
    },
  });

  return profiles.filter((profile: any) => {
    const localTime = getLocalTime(now, profile.timezone || "Asia/Kolkata");
    return localTime === addMinutes(profile.sessionTime, offsetMinutes);
  });
}

async function hasWorkoutToday(userId: string, now: Date) {
  const { start, end } = dayBounds(now);
  const workout = await (prisma as any).workoutLog.findFirst({
    where: {
      userId,
      date: { gte: start, lt: end },
    },
    select: { id: true },
  });

  return Boolean(workout);
}

async function getTodayWorkoutNeedingDebrief(userId: string, now: Date) {
  const { start, end } = dayBounds(now);
  return (prisma as any).workoutLog.findFirst({
    where: {
      userId,
      completed: true,
      intensityScore: null,
      date: { gte: start, lt: end },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      musclesWorked: true,
    },
  });
}

async function wasStreakPreviouslyActive(userId: string, now: Date) {
  const workouts = await (prisma as any).workoutLog.count({
    where: {
      userId,
      completed: true,
      date: { gte: daysAgoFrom(now, 14) },
    },
  });

  return workouts >= 2;
}

async function hasBeenQuietFor72Hours(userId: string, now: Date) {
  const since = daysAgoFrom(now, 3);
  const [workout, message] = await Promise.all([
    (prisma as any).workoutLog.findFirst({
      where: {
        userId,
        date: { gte: since },
      },
      select: { id: true },
    }),
    (prisma as any).companionMessage.findFirst({
      where: {
        user: {
          platform: "telegram",
          platformChatId: userId,
        },
        createdAt: { gte: since },
        OR: [
          { intent: { startsWith: "gym" } },
          { intent: { in: ["lift_log", "pr_log", "soreness_log", "missed_session", "weight_log", "energy_checkin", "nutrition_query", "pain_report"] } },
        ],
      },
      select: { id: true },
    }),
  ]);

  return !workout && !message;
}

async function flagPlateausForWeeklyReport(userId: string) {
  const lifts = await (prisma as any).liftLog.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    select: {
      exercise: true,
      weightKg: true,
      reps: true,
    },
  });

  const grouped = groupByExercise(lifts);

  for (const [exercise, entries] of Object.entries(grouped)) {
    const lastThree = entries.slice(0, 3);
    if (
      lastThree.length === 3 &&
      lastThree.every((entry: any) => entry.weightKg === lastThree[0].weightKg && entry.reps === lastThree[0].reps)
    ) {
      await writeMemoryFact(
        userId,
        "gym_signal",
        "plateau_flag",
        `${formatExercise(exercise)} has stayed at ${lastThree[0].weightKg}kg x ${lastThree[0].reps} for 3 consecutive sessions.`
      );
    }
  }
}

async function wasCronSentToday(userId: string, key: string, now: Date) {
  const { start, end } = dayBounds(now);
  const fact = await (prisma as any).memoryFact.findFirst({
    where: {
      key,
      value: userId,
      createdAt: { gte: start, lt: end },
    },
    select: { id: true },
  });

  return Boolean(fact);
}

async function markCronSent(userId: string, key: string, now: Date) {
  await writeMemoryFact(userId, "gym_cron", key, userId);
}

async function writeMemoryFact(userId: string, type: string, key: string, value: string) {
  const user = await (prisma as any).messengerUser.upsert({
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

  await (prisma as any).memoryFact.create({
    data: {
      userId: user.id,
      type,
      key,
      value,
    },
  });
}

function toCronMessage(userId: string, text: string, intent: string): GymCronMessage {
  return {
    userId,
    chatId: userId,
    text,
    intent,
  };
}

function getPrimaryCompoundLift(currentSplit: string | null, now: Date) {
  const day = now.getDay();
  if (currentSplit === "upper-lower") return day % 2 === 0 ? "squat" : "bench";
  if (currentSplit === "full-body") return ["squat", "bench", "deadlift"][day % 3];
  if (currentSplit === "bro-split") return ["bench", "row", "squat", "press", "curl", "deadlift", "bench"][day];
  return ["bench", "squat", "row", "press", "deadlift", "bench", "squat"][day];
}

function getFormCue(lift: string) {
  if (lift === "bench") return "Bench cue: shoulder blades back, feet planted, controlled touch, no ego bounce.";
  if (lift === "squat") return "Squat cue: brace before descent, knees track toes, depth you can own.";
  if (lift === "deadlift") return "Deadlift cue: wedge in, lats tight, push the floor away.";
  if (lift === "press") return "Press cue: ribs down, glutes tight, bar path close.";
  if (lift === "row") return "Row cue: chest fixed, pull elbows back, no swinging.";
  return "Compound cue: warm up slowly, keep reps clean, stop before form breaks.";
}

function extractIntensityScore(text: string) {
  const match = text.match(/\b([1-5])\s*(\/\s*5|out of 5)?\b/);
  return match ? Number(match[1]) : null;
}

function extractLiftEntries(text: string) {
  return text
    .split(/[,;\n]/)
    .map((line) => extractLift(line.trim()))
    .filter((lift): lift is { exercise: string; weightKg: number; reps: number; sets: number } => Boolean(lift));
}

function extractLift(text: string) {
  const exercise = extractExercise(text);
  if (!exercise) return null;

  const weightMatch = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*kg\b/);
  const compact = text.match(/\b(\d{1,2})\s*x\s*(\d{1,2})\b/);
  const setsReps = text.match(/\b(\d{1,2})\s*sets?\s*(of)?\s*(\d{1,2})\b/);
  if (!weightMatch) return null;

  return {
    exercise,
    weightKg: Number(weightMatch[1]),
    sets: compact ? Number(compact[1]) : setsReps ? Number(setsReps[1]) : 1,
    reps: compact ? Number(compact[2]) : setsReps ? Number(setsReps[3]) : 1,
  };
}

function extractExercise(text: string) {
  if (/\bbench\b/.test(text)) return "bench";
  if (/\bsquats?\b/.test(text)) return "squat";
  if (/\bdeadlifts?\b/.test(text)) return "deadlift";
  if (/\bpress(ing)?\b/.test(text)) return "press";
  if (/\brows?\b/.test(text)) return "row";
  if (/\bcurls?\b/.test(text)) return "curl";
  return null;
}

function musclesForExercise(exercise: string) {
  if (exercise === "bench") return ["chest"];
  if (exercise === "squat") return ["legs"];
  if (exercise === "deadlift") return ["back", "legs"];
  if (exercise === "press") return ["shoulders"];
  if (exercise === "row") return ["back"];
  if (exercise === "curl") return ["arms"];
  return [];
}

function mergeUnique(a: string[], b: string[]) {
  return Array.from(new Set([...a, ...b]));
}

function groupByExercise(lifts: any[]) {
  return lifts.reduce<Record<string, any[]>>((groups, lift) => {
    groups[lift.exercise] ||= [];
    groups[lift.exercise].push(lift);
    return groups;
  }, {});
}

function getGymCronMemory(onboardingAnswers: unknown) {
  if (!onboardingAnswers || typeof onboardingAnswers !== "object" || Array.isArray(onboardingAnswers)) {
    return {};
  }

  return onboardingAnswers as { reengagementSent?: boolean };
}

async function updateGymCronMemory(userId: string, memory: { reengagementSent?: boolean }) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId },
    select: { onboardingAnswers: true },
  });
  const current =
    profile?.onboardingAnswers && typeof profile.onboardingAnswers === "object" && !Array.isArray(profile.onboardingAnswers)
      ? profile.onboardingAnswers
      : {};

  await (prisma as any).userProfile.update({
    where: { userId },
    data: {
      onboardingAnswers: {
        ...current,
        ...memory,
      },
    },
  });
}

function reengagementMessage(persona?: string | null) {
  if (persona === "nova") {
    return "Your streak was starting to take shape. Come back gently today: even a small session counts.";
  }

  return "Your streak was alive. Do not let 72 hours become a new identity. Show me one set today.";
}

function getLocalTime(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(now);
}

function addMinutes(time: string, minutesToAdd: number) {
  const [hours = "0", minutes = "0"] = time.split(":");
  const total = (Number(hours) * 60 + Number(minutes) + minutesToAdd) % (24 * 60);
  const normalized = total < 0 ? total + 24 * 60 : total;
  const nextHours = Math.floor(normalized / 60);
  const nextMinutes = normalized % 60;

  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function isSundayEightPm(now: Date, timezone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value.toLowerCase();
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  return weekday === "sunday" && hour === "20" && minute === "00";
}

function dayBounds(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
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
