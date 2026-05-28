import { prisma } from "@repo/db/client";

type LiftSnapshot = {
  id: string;
  exercise: string;
  weightKg: number;
  reps: number;
  sets: number;
};

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export async function runProgressiveOverloadCheck(userId: string, lift: LiftSnapshot) {
  const lastThree = await (prisma as any).liftLog.findMany({
    where: {
      userId,
      exercise: lift.exercise,
    },
    orderBy: { id: "desc" },
    take: 3,
    select: {
      id: true,
      exercise: true,
      weightKg: true,
      reps: true,
      sets: true,
      workoutLog: {
        select: { date: true },
      },
    },
  });

  const current = lastThree.find((entry: any) => entry.id === lift.id) || lastThree[0];
  const previous = lastThree.find((entry: any) => entry.id !== current?.id);
  if (!current || !previous) return null;

  const liftName = formatExerciseName(lift.exercise);

  if (current.weightKg > previous.weightKg || current.reps > previous.reps) {
    const note = `${liftName} moved up: ${current.weightKg}kg for ${current.sets}x${current.reps}. Point that out positively.`;
    await writeMemoryFact(userId, "gym_signal", "next_companion_note", note);
    return note;
  }

  const plateau =
    lastThree.length === 3 &&
    lastThree.every(
      (entry: any) =>
        entry.weightKg === current.weightKg &&
        entry.reps === current.reps
    );

  if (plateau) {
    await writeMemoryFact(
      userId,
      "gym_signal",
      "plateau_flag",
      `${liftName} has stayed at ${current.weightKg}kg x ${current.reps} for 3 consecutive sessions. Surface in weekly report.`
    );
  }

  if (current.weightKg < previous.weightKg) {
    await writeMemoryFact(
      userId,
      "gym_signal",
      "lift_decrease_silent",
      `${liftName} decreased from ${previous.weightKg}kg to ${current.weightKg}kg. Store silently.`
    );
  }

  return null;
}

export async function check48HourRestRule(userId: string, todaysMuscles: string[]) {
  if (!todaysMuscles.length) return null;

  const lastWorkout = await (prisma as any).workoutLog.findFirst({
    where: {
      userId,
      completed: true,
      musclesWorked: { hasSome: todaysMuscles },
    },
    orderBy: { date: "desc" },
    select: {
      date: true,
      musclesWorked: true,
    },
  });

  if (!lastWorkout) return null;

  const hoursSinceLastSession = (Date.now() - lastWorkout.date.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastSession >= 48) return null;

  const repeatedMuscles = todaysMuscles.filter((muscle) =>
    lastWorkout.musclesWorked.includes(muscle)
  );

  const soreness = await (prisma as any).sorenessLog.findFirst({
    where: {
      userId,
      muscleGroup: { in: repeatedMuscles },
      score: { gte: 3 },
      date: { gte: lastWorkout.date },
    },
    orderBy: { date: "desc" },
    select: {
      muscleGroup: true,
      score: true,
    },
  });

  if (!soreness) return null;

  return `48-hour flag: ${soreness.muscleGroup} was trained under 48 hours ago and soreness is ${soreness.score}/5. You can train, but reduce load or swap the movement.`;
}

export async function runLowEnergyIntensityReduction(
  userId: string,
  preSessionScore: number | null | undefined,
  persona?: string | null
) {
  if (!preSessionScore || preSessionScore > 2) return null;

  const activePersona = persona || (await getActivePersona(userId));
  await writeMemoryFact(
    userId,
    "gym_signal",
    "low_energy_pre_session",
    `Pre-session energy was ${preSessionScore}/5. Recommend lower intensity.`
  );

  if (activePersona === "nova") {
    return "Your body's asking for less today. Listen to it.";
  }

  if (activePersona === "rex") {
    return "You're running on empty. Active recovery today, not a PR attempt.";
  }

  return "Energy is low today. Reduce intensity, keep the session controlled, and do not chase a max.";
}

export async function detectSkipPatternForWeeklyReport(userId: string) {
  const skippedWorkouts = await (prisma as any).workoutLog.findMany({
    where: {
      userId,
      completed: false,
      date: { gte: daysAgo(30) },
    },
    select: { date: true },
  });

  const grouped = skippedWorkouts.reduce((pattern: Record<string, number>, workout: any) => {
    const day = DAY_NAMES[workout.date.getDay()];
    pattern[day] = (pattern[day] || 0) + 1;
    return pattern;
  }, {} as Record<string, number>);

  const messages = (Object.entries(grouped) as [string, number][])
    .filter(([, count]) => count >= 2)
    .map(
      ([day, count]) =>
        `You've missed ${day} ${count} times this month. Either we move that session or we figure out why.`
    );

  if (messages.length) {
    await writeMemoryFact(userId, "gym_signal", "skip_pattern_weekly", messages.join("\n"));
  }

  return messages;
}

export async function detectDeloadTriggerForWeeklyReport(userId: string) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId },
    select: { phaseWeek: true, gymMode: true },
  });

  if (!profile?.gymMode || profile.phaseWeek < 9) return null;

  const skippedDeload = await (prisma as any).memoryFact.findFirst({
    where: {
      key: "deload_skipped",
      value: userId,
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (skippedDeload && profile.phaseWeek < 12) return null;

  return "Deload recommendation: take one full week at 50-60% working weight with 40% less volume.";
}

export async function confirmDeloadWeek(userId: string) {
  await (prisma as any).userProfile.update({
    where: { userId },
    data: { phaseWeek: 1 },
  });

  await writeMemoryFact(userId, "gym_signal", "deload_confirmed", "Deload completed. Phase week reset to 1.");
}

export async function recordDeloadSkipped(userId: string) {
  await writeMemoryFact(userId, "gym_signal", "deload_skipped", userId);
}

export async function runInjuryEscalation(userId: string, bodyPart: string, exercise?: string | null) {
  const existing = await (prisma as any).injuryFlag.findFirst({
    where: {
      userId,
      bodyPart,
      active: true,
    },
  });

  const flag = existing
    ? await (prisma as any).injuryFlag.update({
        where: { id: existing.id },
        data: {
          exercise: exercise || existing.exercise,
          reportCount: { increment: 1 },
          lastReported: new Date(),
        },
      })
    : await (prisma as any).injuryFlag.create({
        data: {
          userId,
          bodyPart,
          exercise,
          reportCount: 1,
          active: true,
          firstReported: new Date(),
          lastReported: new Date(),
        },
      });

  if (flag.reportCount >= 3) {
    return `${bodyPart} pain has shown up ${flag.reportCount} times. I can't diagnose it; please see a physiotherapist or doctor. For now, substitute with ${getExerciseSubstitution(bodyPart)} and avoid anything that triggers it.`;
  }

  return `${bodyPart} pain noted. I won't diagnose it. Substitute with ${getExerciseSubstitution(bodyPart)} and track if it repeats.`;
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

async function getActivePersona(userId: string) {
  const user = await (prisma as any).messengerUser.findUnique({
    where: {
      platform_platformChatId: {
        platform: "telegram",
        platformChatId: userId,
      },
    },
    select: { persona: true },
  });

  return user?.persona || "rex";
}

function getExerciseSubstitution(bodyPart: string) {
  if (bodyPart === "knee") return "upper-body work, hip hinges that do not hurt, or controlled cycling";
  if (bodyPart === "shoulder") return "neutral-grip pressing, rows, or lower-body work";
  if (bodyPart === "lower back") return "chest-supported rows, machine work, or single-leg work";
  if (bodyPart === "elbow") return "neutral-grip pulls and lighter cable work";
  if (bodyPart === "wrist") return "neutral-grip handles and machine work";
  return "a pain-free variation for that area";
}

function formatExerciseName(exercise: string) {
  if (exercise === "bench") return "bench press";
  return exercise.replace(/_/g, " ");
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
