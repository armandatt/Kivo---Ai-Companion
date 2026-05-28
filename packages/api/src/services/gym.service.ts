import { prisma } from "@repo/db/client";
import {
  check48HourRestRule,
  runInjuryEscalation,
  runLowEnergyIntensityReduction,
  runProgressiveOverloadCheck,
} from "./gymDetections.service";

type GymResult = {
  handled: boolean;
  reply?: string;
};

type GymMemory = {
  gymOnboardingStep?: "goal" | "bodyweight" | "diet" | "session_time";
  currentBodyweight?: number;
  proteinTargetG?: number;
};

const GYM_GOAL_QUESTION = "What's the goal — building, cutting, or just building the habit?";
const BODYWEIGHT_QUESTION = "What do you weigh right now?";
const DIET_QUESTION = "Veg or non-veg?";
const SESSION_TIME_QUESTION = "What time do you usually train?";

export async function handleGymMessage(input: {
  userId: string;
  text: string;
  intent: string;
}): Promise<GymResult> {
  const onboarding = await handleGymOnboarding(input.userId, input.text);
  if (onboarding.handled) return onboarding;

  switch (input.intent) {
    case "gym_checkin":
      return logGymCheckin(input.userId, input.text);
    case "lift_log":
      return logLift(input.userId, input.text, false);
    case "pr_log":
      return logLift(input.userId, input.text, true);
    case "soreness_log":
      return logSoreness(input.userId, input.text);
    case "missed_session":
      return logMissedSession(input.userId, input.text);
    case "weight_log":
      return logWeight(input.userId, input.text);
    case "energy_checkin":
      return logEnergy(input.userId, input.text);
    case "recovery_query":
      return answerRecovery(input.userId);
    case "nutrition_query":
      return answerNutrition(input.userId);
    case "pain_report":
      return logPain(input.userId, input.text);
    default:
      return { handled: false };
  }
}

export async function handleGymOnboarding(userId: string, text: string): Promise<GymResult> {
  const profile = await getOrCreateProfile(userId);
  if (!profile) return { handled: false };

  const memory = getGymMemory(profile.onboardingAnswers);
  const activeStep = memory.gymOnboardingStep;

  if (!profile.gymMode && !profile.gymOnboardingComplete && !activeStep && mentionsGymGoal(text)) {
    await updateGymMemory(userId, { ...memory, gymOnboardingStep: "goal" });
    return { handled: true, reply: GYM_GOAL_QUESTION };
  }

  if (!activeStep) return { handled: false };

  if (activeStep === "goal") {
    const gymGoal = normalizeGymGoal(text);
    if (!gymGoal) {
      return {
        handled: true,
        reply: "Pick the closest one: building, cutting, recomp, or habit.",
      };
    }

    await (prisma as any).userProfile.update({
      where: { userId },
      data: {
        gymGoal,
        onboardingAnswers: mergeGymMemory(profile.onboardingAnswers, {
          ...memory,
          gymOnboardingStep: "bodyweight",
        }),
      },
    });

    return { handled: true, reply: BODYWEIGHT_QUESTION };
  }

  if (activeStep === "bodyweight") {
    const weightKg = extractWeightKg(text);
    if (!weightKg) return { handled: true, reply: "Send it like `72kg` or `72`." };

    await (prisma as any).bodyweightLog.create({
      data: { userId, date: new Date(), weightKg },
    });

    await updateGymMemory(userId, {
      ...memory,
      currentBodyweight: weightKg,
      gymOnboardingStep: "diet",
    });

    return { handled: true, reply: DIET_QUESTION };
  }

  if (activeStep === "diet") {
    const dietType = normalizeDietType(text);
    if (!dietType) return { handled: true, reply: "Veg or non-veg?" };

    await (prisma as any).userProfile.update({
      where: { userId },
      data: {
        dietType,
        onboardingAnswers: mergeGymMemory(profile.onboardingAnswers, {
          ...memory,
          gymOnboardingStep: "session_time",
        }),
      },
    });

    return { handled: true, reply: SESSION_TIME_QUESTION };
  }

  const sessionTime = normalizeSessionTime(text);
  if (!sessionTime) return { handled: true, reply: "Send the time like `07:30` or `7pm`." };

  const latestMemory = getGymMemory(
    (await (prisma as any).userProfile.findUnique({ where: { userId } }))?.onboardingAnswers
  );
  const bodyweight = latestMemory.currentBodyweight;
  const proteinTargetG = bodyweight ? Math.round(bodyweight * 1.8) : null;

  await (prisma as any).userProfile.update({
    where: { userId },
    data: {
      sessionTime,
      gymOnboardingComplete: true,
      gymMode: true,
      phaseWeek: 1,
      onboardingAnswers: mergeGymMemory(profile.onboardingAnswers, {
        ...latestMemory,
        gymOnboardingStep: undefined,
        proteinTargetG: proteinTargetG || undefined,
      }),
    },
  });

  return {
    handled: true,
    reply: `Done. Gym mode is on. Week 1 starts now.${proteinTargetG ? ` Protein target: ${proteinTargetG}g/day.` : ""}`,
  };
}

async function logGymCheckin(userId: string, text: string): Promise<GymResult> {
  const musclesWorked = extractMuscles(text);
  const restWarning = await check48HourRestRule(userId, musclesWorked);

  await (prisma as any).workoutLog.create({
    data: {
      userId,
      date: new Date(),
      completed: true,
      musclesWorked,
    },
  });

  return {
    handled: true,
    reply: [
      restWarning,
      "Training logged. Quick debrief: energy 1-5, intensity 1-5, and any lift worth remembering?",
    ].filter(Boolean).join("\n"),
  };
}

async function logLift(userId: string, text: string, isPR: boolean): Promise<GymResult> {
  const lift = extractLift(text);
  if (!lift) {
    return {
      handled: true,
      reply: "Send the lift like `bench 80kg 4x8` or `squats 3 sets of 10 at 90kg`.",
    };
  }

  const workoutLog = await (prisma as any).workoutLog.create({
    data: {
      userId,
      date: new Date(),
      completed: true,
      musclesWorked: extractMuscles(text),
    },
  });

  const previous = await findPreviousLift(userId, lift.exercise);

  const createdLift = await (prisma as any).liftLog.create({
    data: {
      userId,
      workoutLogId: workoutLog.id,
      exercise: lift.exercise,
      weightKg: lift.weightKg,
      reps: lift.reps,
      sets: lift.sets,
      isPR,
      prPrevious: isPR ? previous?.weightKg || null : null,
    },
  });

  const overloadNote = await runProgressiveOverloadCheck(userId, createdLift);

  if (isPR) {
    return {
      handled: true,
      reply: `PR logged: ${lift.exercise} ${lift.weightKg}kg. Previous best: ${previous?.weightKg ? `${previous.weightKg}kg` : "not recorded"}. Big signal. Keep the next session clean.`,
    };
  }

  const currentVolume = lift.weightKg * lift.reps * lift.sets;
  const previousVolume = previous ? previous.weightKg * previous.reps * previous.sets : null;
  const overloadLine =
    previousVolume && currentVolume > previousVolume
      ? "Progressive overload: up from last time."
      : previousVolume
        ? "No overload jump yet. Hold form and add a small step next time."
        : "First logged set for this lift.";

  return {
    handled: true,
    reply: [
      `Lift logged: ${lift.exercise} ${lift.weightKg}kg ${lift.sets}x${lift.reps}. ${overloadLine}`,
      overloadNote ? overloadNote.replace("Point that out positively.", "Nice jump.") : null,
    ].filter(Boolean).join("\n"),
  };
}

async function logSoreness(userId: string, text: string): Promise<GymResult> {
  const muscleGroup = extractMuscleGroup(text);
  const score = /\b(killing|dead|very|bad)\b/.test(text) ? 4 : 2;

  await (prisma as any).sorenessLog.create({
    data: { userId, date: new Date(), muscleGroup, score },
  });

  return {
    handled: true,
    reply:
      score >= 4
        ? `${muscleGroup} soreness logged high. Apply the 48-hour rule: avoid hard loading that area today.`
        : `${muscleGroup} soreness logged. Keep an eye on it and warm up properly.`,
  };
}

async function logMissedSession(userId: string, text: string): Promise<GymResult> {
  const skipReason = extractSkipReason(text);

  await (prisma as any).workoutLog.create({
    data: {
      userId,
      date: new Date(),
      completed: false,
      skipReason,
      musclesWorked: [],
    },
  });

  const recentSkips = await (prisma as any).workoutLog.count({
    where: {
      userId,
      completed: false,
      date: { gte: daysAgo(14) },
    },
  });

  return {
    handled: true,
    reply:
      recentSkips >= 3
        ? `Missed session logged: ${skipReason}. Pattern check: 3+ skips in 14 days. We should shrink the next session, not abandon it.`
        : `Missed session logged: ${skipReason}. Reset cleanly next session.`,
  };
}

async function logWeight(userId: string, text: string): Promise<GymResult> {
  const weightKg = extractWeightKg(text);
  if (!weightKg) return { handled: true, reply: "Send it like `I weigh 72kg`." };

  const previous = await (prisma as any).bodyweightLog.findFirst({
    where: { userId, date: { lte: daysAgo(14) } },
    orderBy: { date: "desc" },
  });

  await (prisma as any).bodyweightLog.create({
    data: {
      userId,
      date: new Date(),
      weightKg,
      trend: previous ? getWeightTrend(weightKg, previous.weightKg) : null,
    },
  });

  await updateGymMemory(userId, {
    ...getGymMemory((await getOrCreateProfile(userId))?.onboardingAnswers),
    currentBodyweight: weightKg,
    proteinTargetG: Math.round(weightKg * 1.8),
  });

  const trend = previous ? getWeightTrend(weightKg, previous.weightKg) : "baseline";
  return { handled: true, reply: `Weight logged: ${weightKg}kg. Two-week trend: ${trend}.` };
}

async function logEnergy(userId: string, text: string): Promise<GymResult> {
  const score = extractEnergyScore(text);
  const isPreSession = /\b(pre|before|about to|session|train|training|workout|gym)\b/.test(text);

  await (prisma as any).energyLog.create({
    data: {
      userId,
      date: new Date(),
      morningScore: isPreSession ? null : score,
      preSessionScore: isPreSession ? score : null,
    },
  });

  const reduction = await runLowEnergyIntensityReduction(userId, isPreSession ? score : null);

  return {
    handled: true,
    reply: reduction || `Energy logged: ${score}/5.`,
  };
}

async function answerRecovery(userId: string): Promise<GymResult> {
  const [workouts, soreness, energy] = await Promise.all([
    (prisma as any).workoutLog.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 3 }),
    (prisma as any).sorenessLog.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 3 }),
    (prisma as any).energyLog.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 3 }),
  ]);

  const highSoreness = soreness.some((entry: any) => entry.score >= 4);
  const lowEnergy = energy.some((entry: any) => (entry.morningScore || 5) <= 2);
  const trainedRecently = workouts.filter((entry: any) => entry.completed).length >= 3;

  const reply =
    highSoreness || lowEnergy || trainedRecently
      ? "Recovery read: keep today lighter. If pain is sharp or joint-based, skip the movement and get proper help."
      : "Recovery read: you look clear to train. Warm up, start conservative, then earn the load.";

  return { handled: true, reply };
}

async function answerNutrition(userId: string): Promise<GymResult> {
  const profile = await getOrCreateProfile(userId);
  const memory = getGymMemory(profile?.onboardingAnswers);
  const protein = memory.proteinTargetG ? `${memory.proteinTargetG}g/day` : "about bodyweight x 1.8g/day";
  const dietType = profile?.dietType;
  const sources =
    dietType === "veg"
      ? "paneer, soya chunks, curd, dal, eggs"
      : "chicken breast, eggs, fish";

  return {
    handled: true,
    reply: `Protein target: ${protein}. Good sources for you: ${sources}.`,
  };
}

async function logPain(userId: string, text: string): Promise<GymResult> {
  const bodyPart = extractBodyPart(text);
  const exercise = extractExercise(text);

  return {
    handled: true,
    reply: await runInjuryEscalation(userId, bodyPart, exercise),
  };
}

async function getOrCreateProfile(userId: string) {
  const user = await (prisma as any).user.findUnique({ where: { id: userId } });
  if (!user) return null;

  return (prisma as any).userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      secondaryDomains: [],
      aspirationWords: [],
    },
  });
}

function getGymMemory(onboardingAnswers: unknown): GymMemory {
  if (!onboardingAnswers || typeof onboardingAnswers !== "object" || Array.isArray(onboardingAnswers)) return {};
  const answers = onboardingAnswers as Record<string, unknown>;

  return {
    gymOnboardingStep: answers.gymOnboardingStep as GymMemory["gymOnboardingStep"],
    currentBodyweight: typeof answers.currentBodyweight === "number" ? answers.currentBodyweight : undefined,
    proteinTargetG: typeof answers.proteinTargetG === "number" ? answers.proteinTargetG : undefined,
  };
}

function mergeGymMemory(onboardingAnswers: unknown, memory: GymMemory) {
  const base =
    onboardingAnswers && typeof onboardingAnswers === "object" && !Array.isArray(onboardingAnswers)
      ? { ...(onboardingAnswers as Record<string, unknown>) }
      : {};

  if (memory.gymOnboardingStep) base.gymOnboardingStep = memory.gymOnboardingStep;
  else delete base.gymOnboardingStep;

  if (memory.currentBodyweight) base.currentBodyweight = memory.currentBodyweight;
  if (memory.proteinTargetG) base.proteinTargetG = memory.proteinTargetG;

  return base;
}

async function updateGymMemory(userId: string, memory: GymMemory) {
  const profile = await (prisma as any).userProfile.findUnique({ where: { userId } });

  await (prisma as any).userProfile.update({
    where: { userId },
    data: {
      onboardingAnswers: mergeGymMemory(profile?.onboardingAnswers, memory),
    },
  });
}

async function findPreviousLift(userId: string, exercise: string) {
  return (prisma as any).liftLog.findFirst({
    where: { userId, exercise },
    orderBy: { id: "desc" },
  });
}

function mentionsGymGoal(text: string) {
  return /\b(gym|fitness|workout|lift|lifting|muscle|bulk|cut|recomp|get fit|build habit)\b/.test(text);
}

function normalizeGymGoal(text: string) {
  if (/\b(bulk|build|building|muscle|gain)\b/.test(text)) return "bulk";
  if (/\b(cut|cutting|fat loss|lose weight|lean)\b/.test(text)) return "cut";
  if (/\b(recomp|recomposition)\b/.test(text)) return "recomp";
  if (/\b(habit|consistent|consistency|routine)\b/.test(text)) return "habit";
  return null;
}

function normalizeDietType(text: string) {
  if (/\b(non veg|non-veg|nonveg|chicken|fish|meat)\b/.test(text)) return "non-veg";
  if (/\b(veg|vegetarian|paneer|soya|dal)\b/.test(text)) return "veg";
  return null;
}

function normalizeSessionTime(text: string) {
  const hourMinute = text.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/);
  if (hourMinute) return `${hourMinute[1].padStart(2, "0")}:${hourMinute[2]}`;

  const meridiem = text.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (!meridiem) return null;

  let hour = Number(meridiem[1]);
  if (meridiem[2] === "pm" && hour < 12) hour += 12;
  if (meridiem[2] === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:00`;
}

function extractWeightKg(text: string) {
  const match = text.match(/\b(\d{2,3}(?:\.\d+)?)\s*(kg|kilos?)?\b/);
  return match ? Number(match[1]) : null;
}

function extractLift(text: string) {
  const exercise = extractExercise(text);
  if (!exercise) return null;

  const weightMatch = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*kg\b/);
  const compact = text.match(/\b(\d{1,2})\s*x\s*(\d{1,2})\b/);
  const setsReps = text.match(/\b(\d{1,2})\s*sets?\s*(of)?\s*(\d{1,2})\b/);
  const repsMatch = text.match(/\b(\d{1,2})\s*reps?\b/);

  if (!weightMatch) return null;

  return {
    exercise,
    weightKg: Number(weightMatch[1]),
    sets: compact ? Number(compact[1]) : setsReps ? Number(setsReps[1]) : 1,
    reps: compact ? Number(compact[2]) : setsReps ? Number(setsReps[3]) : repsMatch ? Number(repsMatch[1]) : 1,
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

function extractMuscles(text: string) {
  const muscles = ["chest", "legs", "back", "shoulders", "arms"].filter((muscle) => text.includes(muscle));
  if (muscles.length) return muscles;
  const exercise = extractExercise(text);
  if (exercise === "bench") return ["chest"];
  if (exercise === "squat") return ["legs"];
  if (exercise === "deadlift") return ["back", "legs"];
  return [];
}

function extractMuscleGroup(text: string) {
  return extractMuscles(text)[0] || extractBodyPart(text) || "general";
}

function extractBodyPart(text: string) {
  if (/\bknee\b/.test(text)) return "knee";
  if (/\bshoulder\b/.test(text)) return "shoulder";
  if (/\blower back\b|\bback\b/.test(text)) return "lower back";
  if (/\belbow\b/.test(text)) return "elbow";
  if (/\bwrist\b/.test(text)) return "wrist";
  return "unknown";
}

function extractSkipReason(text: string) {
  if (/\btired|exhausted|fatigue\b/.test(text)) return "tired";
  if (/\bbusy|work|meeting|class\b/.test(text)) return "busy";
  if (/\bunmotivated|lazy|not feeling\b/.test(text)) return "unmotivated";
  if (/\bsick|ill|fever\b/.test(text)) return "sick";
  if (/\bforgot\b/.test(text)) return "forgot";
  return "unmotivated";
}

function extractEnergyScore(text: string) {
  const explicit = text.match(/\b([1-5])\s*\/\s*5\b/);
  if (explicit) return Number(explicit[1]);
  if (/\b(feeling great|energized|high energy)\b/.test(text)) return 5;
  if (/\b(feeling flat|no energy|low energy|exhausted)\b/.test(text)) return 1;
  if (/\btired\b/.test(text)) return 2;
  return 3;
}

function getWeightTrend(current: number, previous: number) {
  const delta = current - previous;
  if (Math.abs(delta) < 0.3) return "stable";
  return delta > 0 ? "up" : "down";
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
