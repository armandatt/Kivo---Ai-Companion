import { prisma } from "@repo/db/client";
import {
  detectDeloadTriggerForWeeklyReport,
  runProgressiveOverloadCheck,
} from "./gymDetections.service";
import { generateWeeklyReview } from "./review.service";
import { buildGymTimeContext } from "./gymTimeContext.service";
import { setPendingLog, getNextSplitDayInfo, incrementReactivationCount } from "./workoutTracking.service";
import {
  resolveNextCycleDay,
  deriveTrainingWindow,
  deriveVirtualGymTime,
  isTrainingDayByFrequency,
  computeConsecutiveMissesV2,
  getEffectiveChaseTime,
  parseSplitStateMinimal,
  getLocalDateISO,
  daysBetween,
  TrainingWindow,
  type SchedulerContextV2,
} from "../engines/scheduler-intelligence-v2";
import {
  checkGlobalFireRules,
  mergeSchedulerMessages,
  type GlobalFireRulesInput,
  type SchedulerJobContext,
  type WeeklySummaryStats,
  type PreSessionExtras,
  type ChaseExtras,
  type RestDayExtras,
  type DailyCheckInExtras,
  type ReactivationExtras,
  type CommitmentExtras,
} from "./schedulerEngine.service";
import { rexMessageProvider } from "./rexSchedulerMessages.service";
import { computePatternReport } from "./gymPatternDetector.service";
import {
  writeMomentStruggle,
  retrieveRelevantMoments,
} from "./momentMemory.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GymCronMessage = {
  userId: string;
  chatId: string;
  text:   string;
  intent: string;
};

const REX_SELECT = {
  id:                   true,
  platformChatId:       true,
  preferredCheckInTime: true,
  timezone:             true,
  intakeAnswers:        true,
  intakeComplete:       true,
  splitState:           true,
  gymStreak:            true,
  displayName:          true,
} as const;

type RexUserRow = {
  id:                   string;
  platformChatId:       string;
  preferredCheckInTime: string | null;
  timezone:             string | null;
  intakeAnswers:        unknown;
  intakeComplete:       boolean;
  splitState:           unknown;
  gymStreak:            number;
  displayName:          string | null;
};

type JobExtras = Partial<Pick<SchedulerJobContext,
  "preSessionExtras" | "chaseExtras" | "restDayExtras" |
  "dailyCheckInExtras" | "reactivationExtras" | "commitmentExtras"
>>

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function runGymCronJobs(now = new Date()) {
  const [
    preSessionForm, postSessionDebrief, reengagement, sundayReports,
    rexDailyCheckIn,
    rexPre, rexAutoPrompt, rexAutoPromptChase, rexChase1, rexChase2,
    rexRestDay, rexBackdate,
    rexSilence, rexWeeklySummary, rexCommitments,
  ] = await Promise.all([
    runPreSessionFormCueCron(now),
    runPostSessionDebriefCron(now),
    runReengagementCron(now),
    runSundayPlateauAndDeloadCron(now),
    runRexDailyCheckInCron(now),
    runRexPreSessionCron(now),
    runRexAutoPromptCron(now),
    runRexAutoPromptChase1Cron(now),
    runRexMissedSessionChase1Cron(now),
    runRexMissedSessionChase2Cron(now),
    runRexRestDayCron(now),
    runRexBackdatePromptCron(now),
    runRexSilenceCheckCron(now),
    runRexWeeklySummaryCron(now),
    runRexCommitmentFollowUpCron(now),
  ]);

  const all = [
    ...preSessionForm, ...postSessionDebrief, ...reengagement, ...sundayReports,
    ...rexDailyCheckIn,
    ...rexPre, ...rexAutoPrompt, ...rexAutoPromptChase, ...rexChase1, ...rexChase2,
    ...rexRestDay, ...rexBackdate,
    ...rexSilence, ...rexWeeklySummary, ...rexCommitments,
  ];

  return mergeSchedulerMessages(all);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 1 — CHECK-IN SCHEDULERS
// ═══════════════════════════════════════════════════════════════════════════════

// 1.0 — Daily Check-In: load pattern report + active commitments
async function runRexDailyCheckInCron(now: Date): Promise<GymCronMessage[]> {
  const users    = await getRexUsersAtLocalHour(now, 9);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_daily_checkin", now)) continue;

    const ctx = await buildGymTimeContext(user.platformChatId, now);
    if (!ctx) continue;

    // V2: patch ctx with cycle-based muscles and correct training-day flag
    const checkIn        = resolveTrainingObligationToday(user, now);
    const patchedCheckInCtx = checkIn.nextDay
      ? { ...ctx, todayMuscles: checkIn.nextDay.muscles, isTrainingDay: checkIn.isTrainingDay }
      : ctx;

    // Pattern report — don't let a failure block the check-in
    const patternReport = await computePatternReport(user.id, now).catch(() => null);

    // Commitments due in next 3 days
    const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const deadlines = await prisma.deadline.findMany({
      where:  { userId: user.id, status: "active", dueAt: { gte: now, lte: threeDaysOut } },
      select: { title: true, dueAt: true },
    }).catch(() => []);

    const dailyCheckInExtras: DailyCheckInExtras = {
      patternFlags:        patternReport?.flags ?? [],
      interventionMessage: patternReport?.interventionMessage ?? null,
      activeCommitments:   deadlines.map(d => ({
        title:    d.title,
        daysLeft: Math.ceil((d.dueAt.getTime() - now.getTime()) / 86_400_000),
      })),
    };

    const jCtx = buildJobContext(user, patchedCheckInCtx, { dailyCheckInExtras });
    const text  = await rexMessageProvider.dailyCheckIn(jCtx, now);
    messages.push(msg(user, text, "rex_daily_checkin"));
  }

  return messages;
}

// 1.1 — Pre-Session Fire-Up: inject feel rating + sessions-at-weight
async function runRexPreSessionCron(now: Date): Promise<GymCronMessage[]> {
  const fixedUsers = await getRexUsersDueAtLocalTime(now, -30);
  const flexUsers  = await getRexFlexibleUsersDueWithOffset(now, -30);
  const messages: GymCronMessage[] = [];

  for (const user of mergeUserLists(fixedUsers, flexUsers)) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    // V2: cycle-based training day check — never uses weekday
    const trainingCheck = resolveTrainingObligationToday(user, now);
    if (!trainingCheck.isTrainingDay || !trainingCheck.nextDay) continue;

    if (await wasRexCronSentToday(user.platformChatId, "rex_pre_session", now)) continue;
    if (await hadRexCompletedSessionToday(user.platformChatId, now)) continue;

    const { nextDay } = trainingCheck;
    const stallInfo        = await detectRexStalledLift(user.id, nextDay.muscles);
    const isDeloadWeek     = isDeloadCycle(user.splitState);
    const lastFeelRating   = getFeelRatingFromState(user.splitState);
    const sessionsAtWeight = await getSessionsAtCurrentWeight(user.id, nextDay.muscles);

    const preSessionExtras: PreSessionExtras = {
      stallInfo,
      isDeloadWeek,
      lastFeelRating,
      sessionsAtWeight,
    };

    // Patch gymCtx: override calendar muscles with cycle muscles for message generator
    const ctx        = await buildGymTimeContext(user.platformChatId, now);
    const patchedCtx = ctx
      ? { ...ctx, todayMuscles: nextDay.muscles, isTrainingDay: true }
      : null;

    const jCtx = buildJobContext(user, patchedCtx, { preSessionExtras });
    const text  = await rexMessageProvider.preSessionFireUp(jCtx);
    messages.push(msg(user, text, "rex_pre_session"));
  }

  return messages;
}

// 1.2 — Post Session Log Prompt (gym_time + avg session duration)
async function runRexAutoPromptCron(now: Date): Promise<GymCronMessage[]> {
  const fixedUsers = await prisma.messengerUser.findMany({
    where:  { persona: "rex", intakeComplete: true, preferredCheckInTime: { not: null }, timezone: { not: null } },
    select: REX_SELECT,
  });
  const flexUsers  = await getRexFlexibleUsersDueWithOffset(now, 60);
  const messages: GymCronMessage[] = [];

  for (const user of mergeUserLists(fixedUsers, flexUsers)) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    // Timing check: fixed users use preferredCheckInTime; flexible use virtual gym time
    if (user.preferredCheckInTime) {
      const avgMin = getAvgDurationFromState(user.splitState) ?? 60;
      const local  = getLocalTime(now, user.timezone!);
      const target = addMinutes(user.preferredCheckInTime, avgMin);
      if (!withinTolerance(local, target)) continue;
    }

    // V2: cycle-based training day check
    const trainingCheck = resolveTrainingObligationToday(user, now);
    if (!trainingCheck.isTrainingDay) continue;

    if (await wasRexCronSentToday(user.platformChatId, "rex_auto_prompt", now)) continue;
    if (await hadRexCompletedSessionToday(user.platformChatId, now)) continue;

    const dayInfo = await getNextSplitDayInfo(user.platformChatId);
    if (!dayInfo) continue;

    await setPendingLog(user.platformChatId, {
      muscles:       dayInfo.muscles,
      splitDayIndex: dayInfo.splitDayIndex,
      promptedAt:    now.toISOString(),
      chaseCount:    0,
    });

    messages.push(msg(user, rexMessageProvider.postSessionLogPrompt(dayInfo.muscles), "rex_auto_prompt"));
  }

  return messages;
}

// 1.2b — Log Prompt Chase (gym_time + avgDuration + 90 min, if original prompt was sent but no log)
async function runRexAutoPromptChase1Cron(now: Date): Promise<GymCronMessage[]> {
  const fixedUsers = await prisma.messengerUser.findMany({
    where:  { persona: "rex", intakeComplete: true, preferredCheckInTime: { not: null }, timezone: { not: null } },
    select: REX_SELECT,
  });
  const flexUsers  = await getRexFlexibleUsersDueWithOffset(now, 150);
  const messages: GymCronMessage[] = [];

  for (const user of mergeUserLists(fixedUsers, flexUsers)) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    if (user.preferredCheckInTime) {
      const avgMin = getAvgDurationFromState(user.splitState) ?? 60;
      const local  = getLocalTime(now, user.timezone!);
      const target = addMinutes(user.preferredCheckInTime, avgMin + 90);
      if (!withinTolerance(local, target)) continue;
    }

    // V2: cycle-based training day check
    const trainingCheck = resolveTrainingObligationToday(user, now);
    if (!trainingCheck.isTrainingDay) continue;

    // Only chase if original prompt was already sent today
    if (!(await wasRexCronSentToday(user.platformChatId, "rex_auto_prompt", now))) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_auto_prompt_chase", now)) continue;
    if (await hadRexCompletedSessionToday(user.platformChatId, now)) continue;

    const dayInfo = await getNextSplitDayInfo(user.platformChatId);
    // V2: muscles from cycle next day, not calendar
    const muscles = dayInfo?.muscles ?? trainingCheck.nextDay?.muscles ?? "today's session";
    const text    = `${muscles} was scheduled.\n\nDid today's session happen?`;
    messages.push(msg(user, text, "rex_auto_prompt_chase"));
  }

  return messages;
}

// 1.3 — Missed Session Chase 1 (gym_time + 3 hrs)
async function runRexMissedSessionChase1Cron(now: Date): Promise<GymCronMessage[]> {
  const fixedUsers = await getRexUsersDueAtLocalTime(now, 180);
  const flexUsers  = await getRexFlexibleUsersDueWithOffset(now, 180);
  const messages: GymCronMessage[] = [];

  for (const user of mergeUserLists(fixedUsers, flexUsers)) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    // V2: cycle-based training day check
    const trainingCheck = resolveTrainingObligationToday(user, now);
    if (!trainingCheck.isTrainingDay) continue;

    if (await wasRexCronSentToday(user.platformChatId, "rex_chase_1", now)) continue;
    if (await hadRexCompletedSessionToday(user.platformChatId, now)) continue;

    const chaseExtras = await buildChaseExtras(user, now);
    // Patch gymCtx with cycle muscles
    const ctx        = await buildGymTimeContext(user.platformChatId, now);
    const patchedCtx = ctx && trainingCheck.nextDay
      ? { ...ctx, todayMuscles: trainingCheck.nextDay.muscles, isTrainingDay: true }
      : ctx;
    const jCtx = buildJobContext(user, patchedCtx ?? null, { chaseExtras });
    const text = await rexMessageProvider.missedSessionChase(1, jCtx);
    messages.push(msg(user, text, "rex_chase_1"));
  }

  return messages;
}

// 1.3 — Missed Session Chase 2 (gym_time + 5 hrs)
// V2 fix: evening users whose chase fires in quiet hours are served at their wake time instead
// of being silently dropped.
async function runRexMissedSessionChase2Cron(now: Date): Promise<GymCronMessage[]> {
  // Standard users: gym_time + 5h
  const standardUsers  = await getRexUsersDueAtLocalTime(now, 300);
  // Quiet-hour-adjusted: users whose gym_time + 5h fell in quiet hours → deliver at wake time
  const adjustedUsers  = await getRexUsersAtAdjustedChaseTime(now, 300);
  // Flexible users: virtual gym time + 5h
  const flexUsers      = await getRexFlexibleUsersDueWithOffset(now, 300);
  const messages: GymCronMessage[] = [];

  for (const user of mergeUserLists(mergeUserLists(standardUsers, adjustedUsers), flexUsers)) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    // V2: cycle-based training day check
    const trainingCheck = resolveTrainingObligationToday(user, now);
    if (!trainingCheck.isTrainingDay) continue;

    if (await wasRexCronSentToday(user.platformChatId, "rex_chase_2", now)) continue;
    if (await hadRexCompletedSessionToday(user.platformChatId, now)) continue;

    const chaseExtras = await buildChaseExtras(user, now);

    // Write struggle memory when a clear miss pattern emerges (fire-and-forget)
    if (chaseExtras.consecutiveMisses >= 3) {
      const detail = `${chaseExtras.consecutiveMisses} consecutive training days missed (${chaseExtras.todayMuscles})`
      writeMomentStruggle(user.id, "consecutive_miss_pattern", detail).catch(() => {})
    }

    const ctx        = await buildGymTimeContext(user.platformChatId, now);
    const patchedCtx = ctx && trainingCheck.nextDay
      ? { ...ctx, todayMuscles: trainingCheck.nextDay.muscles, isTrainingDay: true }
      : ctx;
    const jCtx = buildJobContext(user, patchedCtx ?? null, { chaseExtras });
    const text = await rexMessageProvider.missedSessionChase(2, jCtx);
    messages.push(msg(user, text, "rex_chase_2"));
  }

  return messages;
}

// 1.4 — Rest Day Morning: inject feel, next session info, stall
async function runRexRestDayCron(now: Date): Promise<GymCronMessage[]> {
  const users    = await getRexUsersAtLocalHour(now, 9);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    // V2: rest day = user is NOT due for training today (still inside rest window)
    const intake      = parseAnswers(user.intakeAnswers);
    const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3;
    const tz          = user.timezone ?? "Asia/Kolkata";
    const stateMin    = parseSplitStateMinimal(user.splitState);
    const todayISO    = getLocalDateISO(now, tz);
    const daysSinceLast = stateMin.lastSessionDate
      ? daysBetween(stateMin.lastSessionDate, todayISO)
      : 999;
    // If user is due for training → this is not a rest day
    if (isTrainingDayByFrequency(daysPerWeek, daysSinceLast)) continue;

    if (await wasRexCronSentToday(user.platformChatId, "rex_rest_day", now)) continue;
    // Suppress daily check-in on rest days — rest day message covers it
    if (await wasRexCronSentToday(user.platformChatId, "rex_daily_checkin", now)) continue;

    // V2: next session muscles from cycle index, not weekday calendar
    const { nextMuscles, daysUntil } = getNextSessionInfoV2(user.splitState, user.intakeAnswers, daysPerWeek);

    const lastFeelRating = getFeelRatingFromState(user.splitState);
    const lastSession    = await getLastCompletedSessionInfo(user.id);
    const stallInfo      = lastSession
      ? await detectRexStalledLift(user.id, lastSession.muscles)
      : null;

    const restDayExtras: RestDayExtras = {
      lastFeelRating,
      nextSessionMuscles:   nextMuscles,
      daysUntilNextSession: daysUntil,
      stallInfo,
    };

    // Pass null for gymCtx — restDayMorning message uses restDayExtras, not gymCtx
    const jCtx = buildJobContext(user, null, { restDayExtras });
    const text = await rexMessageProvider.restDayMorning(jCtx);
    if (!text) continue;  // silence is valid
    messages.push(msg(user, text, "rex_rest_day"));
  }

  return messages;
}

// 1.5 — Backdate Prompt (9am, if yesterday was a training day but nothing was logged)
async function runRexBackdatePromptCron(now: Date): Promise<GymCronMessage[]> {
  const users    = await getRexUsersAtLocalHour(now, 9);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_backdate", now)) continue;
    // Don't send backdate if daily check-in already fired (daily check-in context
    // includes the unlogged-yesterday signal when relevant)
    if (await wasRexCronSentToday(user.platformChatId, "rex_daily_checkin", now)) continue;

    const tz          = user.timezone ?? "Asia/Kolkata";
    const intake      = parseAnswers(user.intakeAnswers);
    const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3;

    // V2: backdate fires when user has a pending cycle day AND yesterday was an
    // expected training day based on frequency (not weekday calendar).
    const nextDay = resolveNextCycleDay(user.splitState, user.intakeAnswers);
    if (!nextDay) continue;
    const stateMin      = parseSplitStateMinimal(user.splitState);
    if (!stateMin.lastSessionDate) continue;  // no history → backdate doesn't apply
    const yesterdayISO  = getLocalDateISO(new Date(now.getTime() - 86_400_000), tz);
    const daysSinceForYesterday = daysBetween(stateMin.lastSessionDate, yesterdayISO);
    if (!isTrainingDayByFrequency(daysPerWeek, daysSinceForYesterday)) continue;

    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);

    const logged = await hadRexSessionOnDateRange(user.id, yesterdayStart, yesterdayEnd);
    if (logged) continue;

    messages.push(msg(user, rexMessageProvider.backdatePrompt(), "rex_backdate"));
  }

  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 3 — PRESET / EVENT SCHEDULERS
// ═══════════════════════════════════════════════════════════════════════════════

// 3.4 — Silence Reactivation: inject last 3 user messages + last workout
async function runRexSilenceCheckCron(now: Date): Promise<GymCronMessage[]> {
  const users    = await getRexUsersAtLocalHour(now, 10);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (await wasRexCronSentToday(user.platformChatId, "rex_silence_check", now)) continue;
    if (!(await hasBeenSilentForDays(user.platformChatId, now, 5))) continue;

    const reactivationCount = getReactivationCountFromState(user.splitState);
    if (reactivationCount >= 2) continue;

    if (!await checkGlobalFireRules({ ...fireRulesInput(user, now), intakeComplete: true })) continue;

    // Pull last 3 user messages that predated the silence gap
    const silenceStart = new Date(now.getTime() - 5 * 86_400_000);
    const lastMsgRows  = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: user.platformChatId } },
      select: {
        messages: {
          where:   { role: "user", createdAt: { lt: silenceStart } },
          orderBy: { createdAt: "desc" },
          take:    3,
          select:  { text: true },
        },
      },
    }).catch(() => null);

    const lastSession = await getLastCompletedSessionInfo(user.id);

    const momentHistory = await retrieveRelevantMoments(user.id, { surface: "reactivation" }).catch(() => [] as string[]);

    const reactivationExtras: ReactivationExtras = {
      lastUserMessages:   [
        ...(lastMsgRows?.messages ?? []).map(m => m.text.slice(0, 80)),
        ...momentHistory,
      ],
      lastWorkoutMuscles: lastSession?.muscles ?? null,
      lastWorkoutDaysAgo: lastSession?.daysAgo ?? 5,
    };

    const hasSessions = await hasAnyCompletedSession(user.platformChatId);
    const ctx         = await buildGymTimeContext(user.platformChatId, now);
    const jCtx        = buildJobContext(user, ctx ?? null, { reactivationExtras });

    const text = await rexMessageProvider.silenceReactivation(hasSessions, jCtx);
    messages.push(msg(user, text, "rex_silence_check"));
    await incrementReactivationCount(user.platformChatId);
  }

  return messages;
}

// 3.6 — Weekly Summary: add feel trend + commitment progress + correct sessionsPlanned
async function runRexWeeklySummaryCron(now: Date): Promise<GymCronMessage[]> {
  const users    = await getRexUsersAtLocalHour(now, 20);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (!isLocalSunday(now, user.timezone ?? "Asia/Kolkata")) continue;
    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_weekly_summary", now)) continue;

    const baseStats = await getRexWeeklyStats(user.id, now);
    if (!baseStats) continue;

    // Feel trend: use most recent feel rating from SplitState
    const feelRaw = (user.splitState as Record<string, unknown> | null)?.lastFeelRating;
    const feelRatingTrend = feelRaw ? [String(feelRaw)] : undefined;

    // Commitment progress summary
    const intake  = parseAnswers(user.intakeAnswers);
    const activeDeadlines = await prisma.deadline.findMany({
      where:  { userId: user.id, status: "active" },
      select: { title: true, dueAt: true },
      take:   1,
    }).catch(() => []);
    let commitmentProgress: string | null = null;
    if (activeDeadlines[0]) {
      commitmentProgress = await getCommitmentProgressSummary(user.id, activeDeadlines[0].title);
    }

    const daysPerWeek   = parseInt(intake.available_training_days ?? "3") || 3;
    const momentContext = await retrieveRelevantMoments(user.id, { surface: "weekly_summary" }).catch(() => [] as string[]);

    const stats: WeeklySummaryStats = {
      ...baseStats,
      sessionsPlanned: daysPerWeek,
      feelRatingTrend,
      commitmentProgress,
      momentContext: momentContext.length ? momentContext : undefined,
    };

    const ctx  = await buildGymTimeContext(user.platformChatId, now);
    const jCtx = buildJobContext(user, ctx ?? null);
    const text = await rexMessageProvider.weeklySummary(stats, jCtx);
    messages.push(msg(user, text, "rex_weekly_summary"));
  }

  return messages;
}

// 3.7 — Commitment Follow-Ups: inject progress for known exercise/consistency goals
// Milestone days at which Rex proactively checks in on a commitment.
const COMMITMENT_MILESTONES = [30, 14, 7, 3, 2, 1];

async function runRexCommitmentFollowUpCron(now: Date): Promise<GymCronMessage[]> {
  const users    = await getRexUsersAtLocalHour(now, 10);
  const messages: GymCronMessage[] = [];
  if (!users.length) return messages;

  const userIds      = users.map(u => u.id);
  // Look 30 days ahead to catch all milestones
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const oneDayAgo     = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const upcoming = await prisma.deadline.findMany({
    where:  { userId: { in: userIds }, status: "active", dueAt: { gte: now, lte: thirtyDaysOut } },
    select: { id: true, userId: true, title: true, dueAt: true },
  });

  const expired = await prisma.deadline.findMany({
    where:  { userId: { in: userIds }, status: "active", dueAt: { lt: now, gte: oneDayAgo } },
    select: { id: true, userId: true, title: true },
  });

  const userById = new Map(users.map(u => [u.id, u]));

  for (const dl of upcoming) {
    const user = userById.get(dl.userId);
    if (!user) continue;

    const daysLeft = Math.ceil((dl.dueAt.getTime() - now.getTime()) / 86_400_000);

    // Only fire at defined milestone days — skip everything else
    if (!COMMITMENT_MILESTONES.includes(daysLeft)) continue;

    if (!await checkGlobalFireRules(fireRulesInput(user, now))) continue;

    // Each milestone has its own dedup key so 30d and 7d can both fire
    const intent = `rex_commitment_followup_${daysLeft}d`;
    if (await wasRexCronSentToday(user.platformChatId, intent, now)) continue;

    const [progressSummary, momentHistory] = await Promise.all([
      getCommitmentProgressSummary(user.id, dl.title),
      retrieveRelevantMoments(user.id, { surface: "commitment", commitmentTitle: dl.title }).catch(() => [] as string[]),
    ]);

    const fullProgress = [progressSummary, ...momentHistory].filter(Boolean).join(" | ") || null;
    const commitmentExtras: CommitmentExtras = { progressSummary: fullProgress };

    const ctx  = await buildGymTimeContext(user.platformChatId, now).catch(() => null);
    const jCtx = buildJobContext(user, ctx ?? null, { commitmentExtras });
    const text = await rexMessageProvider.commitmentFollowUp(dl.title, daysLeft, jCtx);
    messages.push(msg(user, text, intent));
  }

  for (const dl of expired) {
    const user = userById.get(dl.userId);
    if (!user) continue;
    await prisma.deadline.update({ where: { id: dl.id }, data: { status: "missed" } });
    messages.push(msg(user, rexMessageProvider.commitmentMissed(dl.title), "rex_commitment_missed"));
  }

  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 SCHEDULER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determines whether today is a training day using cycle state + frequency.
 * Never uses weekday calendar. Replaces all ctx.isTrainingDay checks in crons.
 */
function resolveTrainingObligationToday(
  user: RexUserRow,
  now:  Date,
): { isTrainingDay: boolean; nextDay: { muscles: string; splitDayIndex: number } | null } {
  const nextDay     = resolveNextCycleDay(user.splitState, user.intakeAnswers);
  if (!nextDay) return { isTrainingDay: false, nextDay: null };

  const intake      = parseAnswers(user.intakeAnswers);
  const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3;
  const tz          = user.timezone ?? "Asia/Kolkata";
  const todayISO    = getLocalDateISO(now, tz);
  const stateMin    = parseSplitStateMinimal(user.splitState);
  const daysSinceLast = stateMin.lastSessionDate
    ? daysBetween(stateMin.lastSessionDate, todayISO)
    : 999;

  return {
    isTrainingDay: isTrainingDayByFrequency(daysPerWeek, daysSinceLast),
    nextDay,
  };
}

/**
 * Returns flexible users (no preferredCheckInTime) due for a prompt at the
 * given gym-time offset, based on their observed training window.
 */
async function getRexFlexibleUsersDueWithOffset(
  now:       Date,
  offsetMin: number,
): Promise<RexUserRow[]> {
  const candidates = await prisma.messengerUser.findMany({
    where:  { persona: "rex", intakeComplete: true, preferredCheckInTime: null, timezone: { not: null } },
    select: REX_SELECT,
  });
  if (!candidates.length) return [];

  const results: RexUserRow[] = [];
  for (const user of candidates) {
    const recentSessions = await prisma.telegramWorkoutSession.findMany({
      where:   { messengerUserId: user.id, completed: true },
      orderBy: { date: "desc" },
      take:    10,
      select:  { date: true },
    });
    const { window } = deriveTrainingWindow(
      recentSessions.map(s => ({ date: new Date(s.date) })),
      user.timezone!,
    );
    const virtualTime = deriveVirtualGymTime(window);
    const target      = addMinutes(virtualTime, offsetMin);
    const local       = getLocalTime(now, user.timezone!);
    if (withinTolerance(local, target)) results.push(user);
  }
  return results;
}

/**
 * Returns users whose gym_time + offsetMin falls inside quiet hours and whose
 * adjusted delivery time (wake_time) matches now.
 * Fixes: evening-user chase prompts that were silently dropped.
 */
async function getRexUsersAtAdjustedChaseTime(
  now:       Date,
  offsetMin: number,
): Promise<RexUserRow[]> {
  const allUsers = await prisma.messengerUser.findMany({
    where:  { persona: "rex", intakeComplete: true, preferredCheckInTime: { not: null }, timezone: { not: null } },
    select: REX_SELECT,
  });
  return allUsers.filter(u => {
    const rawTarget      = addMinutes(u.preferredCheckInTime!, offsetMin);
    const effectiveTarget = getEffectiveChaseTime(u.preferredCheckInTime!, offsetMin, u.intakeAnswers);
    if (rawTarget === effectiveTarget) return false;  // no quiet-hour adjustment
    return withinTolerance(getLocalTime(now, u.timezone!), effectiveTarget);
  });
}

/**
 * Merges two RexUserRow arrays, deduplicating by platformChatId.
 */
function mergeUserLists(primary: RexUserRow[], additional: RexUserRow[]): RexUserRow[] {
  const seen = new Set(primary.map(u => u.platformChatId));
  return [...primary, ...additional.filter(u => !seen.has(u.platformChatId))];
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED — event-driven helpers called from other services
// ═══════════════════════════════════════════════════════════════════════════════

function getReactivationCountFromState(splitState: unknown): number {
  if (!splitState || typeof splitState !== "object" || Array.isArray(splitState)) return 0;
  const s = splitState as Record<string, unknown>;
  return typeof s.reactivationCount === "number" ? s.reactivationCount : 0;
}

async function hasAnyCompletedSession(platformChatId: string): Promise<boolean> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { workoutSessions: { where: { completed: true }, select: { id: true }, take: 1 } },
  });
  return Boolean(user?.workoutSessions.length);
}

// ═══════════════════════════════════════════════════════════════════════════════
// OLD UserProfile-based CRON JOBS (web users — kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

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
  const lifts          = extractLiftEntries(text);

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
        exercise:     lift.exercise,
        weightKg:     lift.weightKg,
        reps:         lift.reps,
        sets:         lift.sets,
      },
    });
    await runProgressiveOverloadCheck(userId, createdLift);
  }

  if (!intensityScore && !lifts.length) return null;

  return [
    intensityScore ? `Intensity logged: ${intensityScore}/5.` : null,
    lifts.length   ? `Logged ${lifts.length} lift${lifts.length === 1 ? "" : "s"}.` : null,
  ].filter(Boolean).join(" ");
}

export async function runReengagementCron(now = new Date()): Promise<GymCronMessage[]> {
  const profiles = await (prisma as any).userProfile.findMany({
    where:  { gymMode: true },
    select: { userId: true, primaryPersona: true, onboardingAnswers: true },
  });
  const messages: GymCronMessage[] = [];

  for (const profile of profiles) {
    const memory = getGymCronMemory(profile.onboardingAnswers);
    if (memory.reengagementSent)                               continue;
    if (!(await wasStreakPreviouslyActive(profile.userId, now))) continue;
    if (!(await hasBeenQuietFor72Hours(profile.userId, now)))   continue;

    await updateGymCronMemory(profile.userId, { ...memory, reengagementSent: true });
    messages.push(toCronMessage(profile.userId, reengagementMessage(profile.primaryPersona), "gym_reengagement"));
  }

  return messages;
}

export async function resetReengagementFlag(userId: string) {
  const profile = await (prisma as any).userProfile.findUnique({
    where:  { userId },
    select: { onboardingAnswers: true },
  });
  if (!profile) return;
  const memory = getGymCronMemory(profile.onboardingAnswers);
  if (!memory.reengagementSent) return;
  await updateGymCronMemory(userId, { ...memory, reengagementSent: false });
}

export async function runSundayPlateauAndDeloadCron(now = new Date()): Promise<GymCronMessage[]> {
  const profiles = await (prisma as any).userProfile.findMany({
    where:  { gymMode: true },
    select: { userId: true, timezone: true },
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

// ═══════════════════════════════════════════════════════════════════════════════
// REX DB HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function getRexUsersDueAtLocalTime(now: Date, gymOffsetMin: number): Promise<RexUserRow[]> {
  const users = await prisma.messengerUser.findMany({
    where:  { persona: "rex", intakeComplete: true, preferredCheckInTime: { not: null }, timezone: { not: null } },
    select: REX_SELECT,
  });
  return users.filter(u => {
    const local  = getLocalTime(now, u.timezone!);
    const target = addMinutes(u.preferredCheckInTime!, gymOffsetMin);
    return withinTolerance(local, target);
  });
}

async function getRexUsersAtLocalHour(now: Date, hour: number): Promise<RexUserRow[]> {
  const users = await prisma.messengerUser.findMany({
    where:  { persona: "rex", intakeComplete: true, timezone: { not: null } },
    select: REX_SELECT,
  });
  const target = `${String(hour).padStart(2, "0")}:00`;
  return users.filter(u => getLocalTime(now, u.timezone!) === target);
}

async function wasRexCronSentToday(platformChatId: string, intent: string, now: Date): Promise<boolean> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      messages: {
        where:  { role: "assistant", intent, createdAt: { gte: start } },
        select: { id: true },
        take:   1,
      },
    },
  });
  return Boolean(user?.messages.length);
}

async function hadRexCompletedSessionToday(platformChatId: string, now: Date): Promise<boolean> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      workoutSessions: {
        where:  { completed: true, date: { gte: start } },
        select: { id: true },
        take:   1,
      },
    },
  });
  return Boolean(user?.workoutSessions.length);
}

async function hadRexSessionOnDateRange(messengerUserId: string, start: Date, end: Date): Promise<boolean> {
  const count = await prisma.telegramWorkoutSession.count({
    where: { messengerUserId, completed: true, date: { gte: start, lt: end } },
  });
  return count > 0;
}

async function hasBeenSilentForDays(platformChatId: string, now: Date, days: number): Promise<boolean> {
  const since = new Date(now);
  since.setDate(since.getDate() - days);

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      messages: {
        where:  { role: "user", createdAt: { gte: since } },
        select: { id: true },
        take:   1,
      },
    },
  });
  return !user?.messages.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

function fireRulesInput(user: RexUserRow, now: Date): GlobalFireRulesInput {
  return {
    platformChatId: user.platformChatId,
    timezone:       user.timezone ?? "Asia/Kolkata",
    now,
    intakeAnswers:  user.intakeAnswers,
    intakeComplete: user.intakeComplete,
    splitState:     user.splitState,
  };
}

function buildJobContext(
  user:   RexUserRow,
  gymCtx: Awaited<ReturnType<typeof buildGymTimeContext>>,
  extras?: JobExtras,
): SchedulerJobContext {
  return {
    platformChatId: user.platformChatId,
    gymCtx:         gymCtx ?? null,
    user: {
      displayName:   user.displayName,
      gymStreak:     user.gymStreak,
      intakeAnswers: user.intakeAnswers,
      splitState:    user.splitState,
    },
    ...extras,
  };
}

function msg(user: RexUserRow, text: string, intent: string): GymCronMessage {
  return { userId: user.platformChatId, chatId: user.platformChatId, text, intent };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STALL / DELOAD / FEEL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function detectRexStalledLift(
  messengerUserId: string,
  muscles:         string,
): Promise<{ exercise: string; weightKg: number; sessions: number } | null> {
  const muscleFilter = muscles.toLowerCase().split(/[\s/+,]+/).filter(Boolean);

  const sessions = await prisma.telegramWorkoutSession.findMany({
    where: {
      messengerUserId,
      completed: true,
      musclesTrained: { hasSome: muscleFilter },
    },
    orderBy: { date: "desc" },
    take:    3,
    select:  {
      id:   true,
      sets: { where: { completed: true }, select: { exerciseName: true, weightKg: true } },
    },
  });

  if (sessions.length < 3) return null;

  const maxByEx: Record<string, number[]> = {};
  for (const session of sessions) {
    const sessionMax: Record<string, number> = {};
    for (const s of session.sets) {
      sessionMax[s.exerciseName] = Math.max(sessionMax[s.exerciseName] ?? 0, s.weightKg);
    }
    for (const [ex, w] of Object.entries(sessionMax)) {
      maxByEx[ex] ??= [];
      maxByEx[ex]!.push(w);
    }
  }

  for (const [exercise, weights] of Object.entries(maxByEx)) {
    if (weights.length >= 3 && weights.every(w => w === weights[0])) {
      return { exercise, weightKg: weights[0]!, sessions: weights.length };
    }
  }

  return null;
}

// Returns how many consecutive sessions the primary lift has stayed at its current weight.
// Returns null if no sessions found.
async function getSessionsAtCurrentWeight(
  messengerUserId: string,
  muscles:         string,
): Promise<{ exercise: string; weightKg: number; count: number } | null> {
  const muscleFilter = muscles.toLowerCase().split(/[\s/+,]+/).filter(Boolean);

  const sessions = await prisma.telegramWorkoutSession.findMany({
    where: {
      messengerUserId,
      completed: true,
      musclesTrained: { hasSome: muscleFilter },
    },
    orderBy: { date: "desc" },
    take:    6,
    select:  {
      id:   true,
      sets: { where: { completed: true }, select: { exerciseName: true, weightKg: true } },
    },
  });

  if (!sessions.length) return null;

  // Find the heaviest exercise in the most recent session
  const latestSets = sessions[0]?.sets ?? [];
  if (!latestSets.length) return null;

  const exMaxes: Record<string, number> = {};
  for (const s of latestSets) {
    exMaxes[s.exerciseName] = Math.max(exMaxes[s.exerciseName] ?? 0, s.weightKg);
  }
  const [primaryEx, currentKg] = Object.entries(exMaxes).sort(([, a], [, b]) => b - a)[0] ?? [];
  if (!primaryEx || !currentKg) return null;

  // Count consecutive sessions at this weight
  let count = 0;
  for (const session of sessions) {
    const sessionMax = Math.max(
      0, ...session.sets
        .filter(s => s.exerciseName === primaryEx)
        .map(s => s.weightKg)
    );
    if (sessionMax >= currentKg) count++;
    else break;
  }

  return { exercise: primaryEx, weightKg: currentKg, count };
}

function isDeloadCycle(splitState: unknown): boolean {
  if (!splitState || typeof splitState !== "object" || Array.isArray(splitState)) return false;
  const s     = splitState as Record<string, unknown>;
  const cycle = typeof s.cycleNumber === "number" ? s.cycleNumber : 0;
  return cycle > 0 && cycle % 4 === 0;
}

function getFeelRatingFromState(splitState: unknown): import("./workoutTracking.service").FeelRating | null {
  if (!splitState || typeof splitState !== "object" || Array.isArray(splitState)) return null;
  const s   = splitState as Record<string, unknown>;
  const raw = s.lastFeelRating;
  const valid = new Set(["easy", "moderate", "hard", "failed"]);
  return (typeof raw === "string" && valid.has(raw)) ? raw as import("./workoutTracking.service").FeelRating : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHASE CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

async function buildChaseExtras(user: RexUserRow, now: Date): Promise<ChaseExtras> {
  // V2: cycle-based pending muscles — not weekday calendar
  const nextDay      = resolveNextCycleDay(user.splitState, user.intakeAnswers);
  const todayMuscles = nextDay?.muscles ?? "Full Body";

  const consecutiveMisses = await getConsecutiveMissedDaysV2(user.id, user.intakeAnswers, user.timezone, now);
  const lastSession       = await getLastCompletedSessionInfo(user.id);

  return {
    todayMuscles,
    consecutiveMisses,
    lastSessionMuscles: lastSession?.muscles ?? null,
    lastSessionDaysAgo: lastSession?.daysAgo ?? null,
  };
}

// V2: frequency-based miss counter — no weekday calendar
async function getConsecutiveMissedDaysV2(
  messengerUserId: string,
  intakeAnswers:   unknown,
  timezone:        string | null,
  now:             Date,
): Promise<number> {
  const intake       = parseAnswers(intakeAnswers);
  const daysPerWeek  = parseInt(intake.available_training_days ?? "3") || 3;
  const tz           = timezone ?? "Asia/Kolkata";
  const eightDaysAgo = new Date(now.getTime() - 8 * 86_400_000);

  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:  { messengerUserId, completed: true, date: { gte: eightDaysAgo } },
    select: { date: true },
  });

  const todayISO         = getLocalDateISO(now, tz);
  const completedDateISOs = sessions.map(s => getLocalDateISO(new Date(s.date), tz));

  return computeConsecutiveMissesV2(completedDateISOs, daysPerWeek, todayISO);
}

async function getLastCompletedSessionInfo(
  messengerUserId: string,
): Promise<{ muscles: string; daysAgo: number } | null> {
  const session = await prisma.telegramWorkoutSession.findFirst({
    where:   { messengerUserId, completed: true },
    orderBy: { date: "desc" },
    select:  { date: true, musclesTrained: true },
  });
  if (!session) return null;
  const daysAgo = Math.floor((Date.now() - new Date(session.date).getTime()) / 86_400_000);
  return { muscles: session.musclesTrained.join(", "), daysAgo };
}

// V2: cycle-based next session info — no weekday calendar
function getNextSessionInfoV2(
  splitStateRaw: unknown,
  intakeAnswers: unknown,
  daysPerWeek:   number,
): { nextMuscles: string; daysUntil: number } {
  const nextDay = resolveNextCycleDay(splitStateRaw, intakeAnswers);
  // daysUntil is an estimate from frequency; exact date is unknowable without a calendar anchor
  const daysUntil = daysPerWeek >= 5 ? 1 : daysPerWeek >= 4 ? 1 : 2;
  return { nextMuscles: nextDay?.muscles ?? "Full Body", daysUntil };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMITMENT PROGRESS
// ═══════════════════════════════════════════════════════════════════════════════

async function getCommitmentProgressSummary(
  messengerUserId: string,
  title:           string,
): Promise<string | null> {
  const lower = title.toLowerCase();

  const exerciseMap: Record<string, string> = {
    squat: "squat", bench: "bench", deadlift: "deadlift", press: "press", row: "row",
  };
  let targetExercise: string | null = null;
  for (const [keyword, exercise] of Object.entries(exerciseMap)) {
    if (lower.includes(keyword)) { targetExercise = exercise; break; }
  }

  if (targetExercise) {
    const recentSessions = await prisma.telegramWorkoutSession.findMany({
      where:   { messengerUserId, completed: true },
      orderBy: { date: "desc" },
      take:    5,
      select:  { id: true },
    });
    if (recentSessions.length) {
      const recentSet = await prisma.telegramSetLog.findFirst({
        where: {
          sessionId:    { in: recentSessions.map(s => s.id) },
          exerciseName: { contains: targetExercise, mode: "insensitive" },
          completed:    true,
        },
        orderBy: { id: "desc" },
        select:  { weightKg: true, reps: true, exerciseName: true },
      });
      if (recentSet) {
        return `last ${recentSet.exerciseName}: ${recentSet.weightKg}kg × ${recentSet.reps}`;
      }
    }
  }

  if (lower.includes("session") || lower.includes("consistency") || lower.includes("week")) {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const count   = await prisma.telegramWorkoutSession.count({
      where: { messengerUserId, completed: true, date: { gte: weekAgo } },
    });
    return `${count} session${count !== 1 ? "s" : ""} this week`;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEKLY STATS FOR REX WEEKLY SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

async function getRexWeeklyStats(messengerUserId: string, now: Date): Promise<WeeklySummaryStats | null> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId, completed: true, date: { gte: weekAgo } },
    orderBy: { date: "desc" },
    select:  { id: true, musclesTrained: true },
  });

  if (!sessions.length) return null;

  const sessionIds = sessions.map(s => s.id);

  const allSets = await prisma.telegramSetLog.findMany({
    where:   { sessionId: { in: sessionIds }, completed: true },
    select:  { exerciseName: true, weightKg: true, reps: true, sessionId: true },
  });

  const goodSets = allSets.filter(s => s.reps >= 3).sort((a, b) => b.weightKg - a.weightKg);
  const bestSet  = goodSets[0] ?? null;
  const bestLift = bestSet
    ? { exercise: bestSet.exerciseName, weightKg: bestSet.weightKg, reps: bestSet.reps }
    : null;

  const musclesCovered = new Set(sessions.flatMap(s => s.musclesTrained));
  const commonGroups   = ["chest", "back", "legs", "shoulders"];
  const gapArea        = commonGroups.find(g =>
    ![...musclesCovered].some(m => m.toLowerCase().includes(g))
  ) ?? null;

  const user = await prisma.messengerUser.findUnique({
    where:  { id: messengerUserId },
    select: { splitState: true, intakeAnswers: true },
  });
  const splitState  = user?.splitState as Record<string, unknown> | null;
  const cycleNumber = typeof splitState?.cycleNumber === "number" ? splitState.cycleNumber : 0;
  const intake      = parseAnswers(user?.intakeAnswers);
  const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3;

  return {
    sessionsCompleted: sessions.length,
    sessionsPlanned:   daysPerWeek,
    bestLift,
    gapArea,
    cycleNumber,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIME / GENERAL UTILITIES (private)
// ═══════════════════════════════════════════════════════════════════════════════

function getLocalTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
  }).format(now);
}

function getLocalWeekdayNum(date: Date, timezone: string): number {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone })
    .format(date)
    .toLowerCase();
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[day] ?? 1;
}

function addMinutes(time: string, minutesToAdd: number): string {
  const [hours = "0", minutes = "0"] = time.split(":");
  const total      = (Number(hours) * 60 + Number(minutes) + minutesToAdd) % (24 * 60);
  const normalized = total < 0 ? total + 24 * 60 : total;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function timeToMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

// Returns true if local time is within ±toleranceMin of target.
// Handles midnight wrap (e.g. 23:58 vs 00:01).
function withinTolerance(local: string, target: string, toleranceMin = 4): boolean {
  const diff = Math.abs(timeToMinutes(local) - timeToMinutes(target));
  return diff <= toleranceMin || diff >= (24 * 60 - toleranceMin);
}

function isLocalSunday(now: Date, timezone: string): boolean {
  return getLocalWeekdayNum(now, timezone) === 0;
}

function isSundayEightPm(now: Date, timezone = "Asia/Kolkata"): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
  }).formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value.toLowerCase();
  const hour    = parts.find(p => p.type === "hour")?.value;
  const minute  = parts.find(p => p.type === "minute")?.value;
  return weekday === "sunday" && hour === "20" && minute === "00";
}

function getAvgDurationFromState(splitState: unknown): number {
  if (!splitState || typeof splitState !== "object" || Array.isArray(splitState)) return 60;
  const s = splitState as Record<string, unknown>;
  return typeof s.avgSessionDurationMin === "number" ? s.avgSessionDurationMin : 60;
}

function parseAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OLD UserProfile HELPERS (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

async function getGymUsersDueAt(now: Date, offsetMinutes: number) {
  const profiles = await (prisma as any).userProfile.findMany({
    where:  { gymMode: true, sessionTime: { not: null } },
    select: { userId: true, currentSplit: true, sessionTime: true, timezone: true },
  });
  return profiles.filter((p: any) => {
    const localTime = getLocalTime(now, p.timezone || "Asia/Kolkata");
    return localTime === addMinutes(p.sessionTime, offsetMinutes);
  });
}

async function hasWorkoutToday(userId: string, now: Date) {
  const { start, end } = dayBounds(now);
  const workout = await (prisma as any).workoutLog.findFirst({
    where:  { userId, date: { gte: start, lt: end } },
    select: { id: true },
  });
  return Boolean(workout);
}

async function getTodayWorkoutNeedingDebrief(userId: string, now: Date) {
  const { start, end } = dayBounds(now);
  return (prisma as any).workoutLog.findFirst({
    where:   { userId, completed: true, intensityScore: null, date: { gte: start, lt: end } },
    orderBy: { date: "desc" },
    select:  { id: true, musclesWorked: true },
  });
}

async function wasStreakPreviouslyActive(userId: string, now: Date) {
  const workouts = await (prisma as any).workoutLog.count({
    where: { userId, completed: true, date: { gte: daysAgoFrom(now, 14) } },
  });
  return workouts >= 2;
}

async function hasBeenQuietFor72Hours(userId: string, now: Date) {
  const since = daysAgoFrom(now, 3);
  const [workout, message] = await Promise.all([
    (prisma as any).workoutLog.findFirst({ where: { userId, date: { gte: since } }, select: { id: true } }),
    (prisma as any).companionMessage.findFirst({
      where: {
        user: { platform: "telegram", platformChatId: userId },
        createdAt: { gte: since },
        OR: [
          { intent: { startsWith: "gym" } },
          { intent: { in: ["lift_log", "pr_log", "soreness_log", "missed_session", "weight_log", "energy_checkin"] } },
        ],
      },
      select: { id: true },
    }),
  ]);
  return !workout && !message;
}

async function flagPlateausForWeeklyReport(userId: string) {
  const lifts = await (prisma as any).liftLog.findMany({
    where:   { userId },
    orderBy: { id: "desc" },
    select:  { exercise: true, weightKg: true, reps: true },
  });
  const grouped = groupByExercise(lifts);
  for (const [exercise, entries] of Object.entries(grouped)) {
    const last = (entries as any[]).slice(0, 3);
    if (
      last.length === 3 &&
      last.every((e: any) => e.weightKg === last[0].weightKg && e.reps === last[0].reps)
    ) {
      await writeMemoryFact(userId, "gym_signal", "plateau_flag",
        `${formatExercise(exercise)} has stayed at ${last[0].weightKg}kg × ${last[0].reps} for 3 consecutive sessions.`);
    }
  }
}

async function wasCronSentToday(userId: string, key: string, now: Date) {
  const { start, end } = dayBounds(now);
  const fact = await (prisma as any).memoryFact.findFirst({
    where:  { key, value: userId, createdAt: { gte: start, lt: end } },
    select: { id: true },
  });
  return Boolean(fact);
}

async function markCronSent(userId: string, key: string, _now: Date) {
  await writeMemoryFact(userId, "gym_cron", key, userId);
}

async function writeMemoryFact(userId: string, type: string, key: string, value: string) {
  const user = await (prisma as any).messengerUser.upsert({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: userId } },
    update: {},
    create: { platform: "telegram", platformChatId: userId },
  });
  await (prisma as any).memoryFact.create({ data: { userId: user.id, type, key, value } });
}

function toCronMessage(userId: string, text: string, intent: string): GymCronMessage {
  return { userId, chatId: userId, text, intent };
}

function getPrimaryCompoundLift(currentSplit: string | null, now: Date) {
  const day = now.getDay();
  if (currentSplit === "upper-lower") return day % 2 === 0 ? "squat" : "bench";
  if (currentSplit === "full-body")   return ["squat", "bench", "deadlift"][day % 3];
  if (currentSplit === "bro-split")   return ["bench", "row", "squat", "press", "curl", "deadlift", "bench"][day];
  return ["bench", "squat", "row", "press", "deadlift", "bench", "squat"][day];
}

function getFormCue(lift: string) {
  if (lift === "bench")    return "Bench: shoulder blades back, feet planted, controlled touch.";
  if (lift === "squat")    return "Squat: brace before descent, knees track toes, depth you can own.";
  if (lift === "deadlift") return "Deadlift: wedge in, lats tight, push the floor away.";
  if (lift === "press")    return "Press: ribs down, glutes tight, bar path close.";
  if (lift === "row")      return "Row: chest fixed, pull elbows back, no swinging.";
  return "Compound: warm up slowly, keep reps clean, stop before form breaks.";
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
  const exercise    = extractExercise(text);
  if (!exercise)    return null;
  const weightMatch = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*kg\b/);
  const compact     = text.match(/\b(\d{1,2})\s*x\s*(\d{1,2})\b/);
  const setsReps    = text.match(/\b(\d{1,2})\s*sets?\s*(of)?\s*(\d{1,2})\b/);
  if (!weightMatch) return null;
  return {
    exercise,
    weightKg: Number(weightMatch[1]),
    sets:     compact ? Number(compact[1]) : setsReps ? Number(setsReps[1]) : 1,
    reps:     compact ? Number(compact[2]) : setsReps ? Number(setsReps[3]) : 1,
  };
}

function extractExercise(text: string) {
  if (/\bbench\b/.test(text))      return "bench";
  if (/\bsquats?\b/.test(text))    return "squat";
  if (/\bdeadlifts?\b/.test(text)) return "deadlift";
  if (/\bpress(ing)?\b/.test(text)) return "press";
  if (/\brows?\b/.test(text))      return "row";
  if (/\bcurls?\b/.test(text))     return "curl";
  return null;
}

function musclesForExercise(exercise: string) {
  if (exercise === "bench")    return ["chest"];
  if (exercise === "squat")    return ["legs"];
  if (exercise === "deadlift") return ["back", "legs"];
  if (exercise === "press")    return ["shoulders"];
  if (exercise === "row")      return ["back"];
  if (exercise === "curl")     return ["arms"];
  return [];
}

function mergeUnique(a: string[], b: string[]) {
  return Array.from(new Set([...a, ...b]));
}

function groupByExercise(lifts: any[]) {
  return lifts.reduce<Record<string, any[]>>((g, l) => {
    g[l.exercise] ||= [];
    g[l.exercise].push(l);
    return g;
  }, {});
}

function getGymCronMemory(onboardingAnswers: unknown) {
  if (!onboardingAnswers || typeof onboardingAnswers !== "object" || Array.isArray(onboardingAnswers)) return {};
  return onboardingAnswers as { reengagementSent?: boolean };
}

async function updateGymCronMemory(userId: string, memory: { reengagementSent?: boolean }) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId }, select: { onboardingAnswers: true },
  });
  const current = (profile?.onboardingAnswers && typeof profile.onboardingAnswers === "object" && !Array.isArray(profile.onboardingAnswers))
    ? profile.onboardingAnswers : {};
  await (prisma as any).userProfile.update({
    where: { userId },
    data:  { onboardingAnswers: { ...current, ...memory } },
  });
}

function reengagementMessage(persona?: string | null) {
  if (persona === "nova") {
    return "Your streak was starting to take shape. Come back gently today: even a small session counts.";
  }
  return "Your streak was alive. Do not let 72 hours become a new identity. Show me one set today.";
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
  return exercise.charAt(0).toUpperCase() + exercise.slice(1).replace(/_/g, " ");
}
