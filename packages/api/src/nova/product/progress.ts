// ─── Progress view builder ────────────────────────────────────────────────────
// "Have I actually changed?" from what is already on record. A read model:
// it composes finished sessions, the learner's "How did it go?" answers, the
// Topic Mastery Engine's own record of its changes, exam dates and Learning
// DNA. Read-only. No LLM call, no writes, and no estimate of its own: every
// mastery number and level here is the Knowledge Engine's.
//
// The definitions this page rests on are the constants and the three
// functions directly below. They are documented in progress.types.ts.

import { prisma } from "@repo/db/client";
import { getAllTopicMasteries, masteryLevel } from "../engines/knowledge-engine";
import { COUNTED_SESSION_MINUTES, SELF_REPORTED_ACTIVITY, SESSION_OUTCOMES, isCountedSession, isTimedSession } from "../engines/study-session-engine";
import { normalizeTopicName } from "../engines/topic-mastery-engine";
import type { TopicMasteryState } from "../types/engine.types";
import { dayKey, dayKeyOfNumber, dayNumber, mondayOf, resolveTimezone } from "../engines/learner-calendar";
import type {
  ConsistencyTrend,
  JourneyEvent,
  NovaProgressReady,
  NovaProgressView,
  ProgressChange,
  ProgressComeback,
  ProgressLevel,
  ProgressMasteryChange,
  ProgressOutcome,
  ProgressTopic,
  ProgressWeek,
} from "./progress.types";

// ── Definitions ───────────────────────────────────────────────────────────────

export { COUNTED_SESSION_MINUTES };
// The Academic State Engine calls a learner "returning" after more than
// three days without a session. A comeback is the session that ends such a
// gap: the fourth calendar day after the previous active day, or later.
export const COMEBACK_GAP_DAYS       = 4;
export const SESSION_MILESTONES      = [5, 10, 25, 50, 100, 250, 500];
// A topic has moved when its mastery number is ten points from where it was.
export const MASTERY_MOVE_POINTS     = 10;
// Sessions and mastery records are read this far back. Totals reach further
// (see ProgressInputs.before).
export const PROGRESS_WINDOW_DAYS    = 365;
export const FINISHED_WEEKS          = 8;
export const RECENT_DAYS             = 30;

const OUTCOMES_PER_TOPIC     = 6;
const JOURNEY_LIMIT          = 40;
const CHANGES_LIMIT          = 5;
const DAY_MS                 = 86_400_000;

// A finished session row, as stored.
export interface ProgressSessionRecord {
  id:              string;
  subjectId:       string | null;
  topicName:       string | null;
  sessionDate:     Date;
  durationMinutes: number;
  activityType:    string;
  executionReport: unknown;
}

export { isCountedSession, isTimedSession };

// A row of the Topic Mastery Engine's record of its changes.
export interface MasteryRecord {
  id:            string;
  topicId:       string;
  source:        string;
  sessionId:     string | null;
  masteryBefore: number | null;
  masteryAfter:  number;
  reviewCount:   number;            // after the change
  recordedAt:    Date;
}

export interface ProgressInputs {
  timezone: string | null;
  subjects: Array<{ id: string; name: string }>;
  topics:   TopicMasteryState[];
  sessions: ProgressSessionRecord[];   // completed, within the window
  masteryRecords: MasteryRecord[];     // within the window
  // Finished sessions older than the window, as totals.
  before: {
    counted: number; minutes: number;
    firstAt: Date | null; lastAt: Date | null;
    selfReported: number; underTenMinutes: number;
  };
  goals:    string[];
  nextExam: { title: string; subjectId: string | null; scheduledAt: Date } | null;
  learningDna: { optimalSessionMinutes: number | null; dataPointCount: number; confidence: string } | null;
  now:      Date;
}

export const NO_EARLIER_SESSIONS: ProgressInputs["before"] = {
  counted: 0, minutes: 0, firstAt: null, lastAt: null, selfReported: 0, underTenMinutes: 0,
};

// ── Calendar days ─────────────────────────────────────────────────────────────
// A day is a YYYY-MM-DD key in the learner's timezone (planner.ts dayKey),
// held as a whole number of days so that gaps and weeks are subtraction
// (engines/learner-calendar.ts).

const keyOf = dayKeyOfNumber;

// ── Wording ───────────────────────────────────────────────────────────────────

const OUTCOME_WORD: Record<ProgressOutcome, string> = {
  struggled: "Struggled", okay: "Okay", good: "Good", crushed_it: "Crushed it",
};
const outcomeRank = (o: ProgressOutcome) => SESSION_OUTCOMES.indexOf(o);
const LEVEL_RANK: Record<ProgressLevel, number> = { weak: 0, developing: 1, solid: 2 };

const plural  = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const percent = (p: number) => Math.round(p * 100);
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

// The level of a mastery number that has at least one session behind it.
const levelOf = (masteryProbability: number): ProgressLevel =>
  masteryLevel({ masteryProbability, reviewCount: 1 }) as ProgressLevel;

const outcomeOf = (row: ProgressSessionRecord): ProgressOutcome | null => {
  const outcome = (row.executionReport as { outcome?: unknown } | null)?.outcome;
  return SESSION_OUTCOMES.find(o => o === outcome) ?? null;
};

const topicKey = (subjectId: string | null, name: string | null) =>
  subjectId && name ? `${subjectId}|${normalizeTopicName(name).toLowerCase()}` : null;

// ── Pure builder ──────────────────────────────────────────────────────────────

export function buildProgressView(input: ProgressInputs): NovaProgressReady {
  const { now, before } = input;
  const timezone    = resolveTimezone(input.timezone);
  const dayOf       = (date: Date) => dayNumber(dayKey(date, timezone));
  const today       = dayOf(now);
  const subjectName = new Map(input.subjects.map(s => [s.id, s.name]));
  const subjectId   = new Map(input.subjects.map(s => [s.name, s.id]));
  const nameOf      = (id: string | null) => (id ? subjectName.get(id) ?? null : null);

  const finished = [...input.sessions].sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
  const timed    = finished.filter(isTimedSession);
  const counted  = timed.filter(isCountedSession).map(s => ({ ...s, day: dayOf(s.sessionDate) }));

  // ── Active days, gaps and comebacks ─────────────────────────────────────────
  const activeDays     = [...new Set(counted.map(s => s.day))].sort((a, b) => a - b);
  const firstActiveDay = before.firstAt ? dayOf(before.firstAt) : activeDays[0] ?? null;
  const lastActiveDay  = activeDays[activeDays.length - 1] ?? (before.lastAt ? dayOf(before.lastAt) : null);

  const comebacks: Array<ProgressComeback & { session: typeof counted[number] }> = [];
  let previousDay = before.lastAt ? dayOf(before.lastAt) : null;
  for (const day of activeDays) {
    if (previousDay !== null && day - previousDay >= COMEBACK_GAP_DAYS) {
      const session = counted.find(s => s.day === day)!;
      comebacks.push({ date: session.sessionDate.toISOString(), gapDays: day - previousDay, topicName: session.topicName, session });
    }
    previousDay = day;
  }

  // ── Weeks ───────────────────────────────────────────────────────────────────
  const thisMonday = mondayOf(today);
  const weeks: ProgressWeek[] = [];
  for (let back = FINISHED_WEEKS; back >= 0; back--) {
    const start = thisMonday - 7 * back;
    const own   = counted.filter(s => s.day >= start && s.day < start + 7);
    weeks.push({
      weekStart:   keyOf(start),
      sessions:    own.length,
      minutes:     own.reduce((sum, s) => sum + s.durationMinutes, 0),
      activeDays:  new Set(own.map(s => s.day)).size,
      current:     back === 0,
      beforeStart: firstActiveDay === null || start + 6 < firstActiveDay,
    });
  }

  // The last four finished weeks against the four before them, and only when
  // the learner had already started by the first of those eight.
  const finishedWeeks = weeks.slice(0, FINISHED_WEEKS);
  const average = (list: ProgressWeek[]) => Math.round(list.reduce((sum, w) => sum + w.activeDays, 0) / list.length * 10) / 10;
  let trend: ConsistencyTrend = "not_enough_history";
  let trendBasis: { recent: number; earlier: number } | null = null;
  if (finishedWeeks.length === FINISHED_WEEKS && !finishedWeeks[0]!.beforeStart) {
    trendBasis = { earlier: average(finishedWeeks.slice(0, 4)), recent: average(finishedWeeks.slice(4)) };
    const diff = trendBasis.recent - trendBasis.earlier;
    trend = diff >= 1 ? "more_consistent" : diff <= -1 ? "less_consistent" : "steady";
  }

  // ── Topic growth ────────────────────────────────────────────────────────────
  const recordsOf = new Map<string, MasteryRecord[]>();
  for (const r of [...input.masteryRecords].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    recordsOf.set(r.topicId, [...(recordsOf.get(r.topicId) ?? []), r]);
  }
  const outcomesOf = new Map<string, ProgressOutcome[]>();
  for (const s of timed) {
    const key = topicKey(s.subjectId, s.topicName);
    const outcome = outcomeOf(s);
    if (key && outcome) outcomesOf.set(key, [...(outcomesOf.get(key) ?? []), outcome]);
  }

  // Where a topic's number stood at the earliest moment on record at which
  // it already had a session behind it.
  const baselineOf = (records: MasteryRecord[]): { value: number; at: Date } | null => {
    for (const [i, r] of records.entries()) {
      const sessionsBefore = r.source === "session_report" ? r.reviewCount - 1 : r.reviewCount;
      if (r.masteryBefore !== null && sessionsBefore >= 1) return { value: r.masteryBefore, at: r.recordedAt };
      // The topic's first session: a starting point only once something follows it.
      if (r.reviewCount >= 1) return i < records.length - 1 ? { value: r.masteryAfter, at: r.recordedAt } : null;
    }
    return null;
  };

  const growth: NovaProgressReady["growth"] = { improving: [], steady: [], needsAttention: [], justStarted: [] };
  const gainOf = new Map<string, number>();

  for (const t of input.topics) {
    if (t.reviewCount < 1) continue;   // no session behind it: Knowledge's "unverified"
    const masteryPercent = percent(t.masteryProbability);
    const level          = levelOf(t.masteryProbability);
    const baseline       = baselineOf(recordsOf.get(t.topicId) ?? []);
    const change: ProgressMasteryChange | null = baseline ? {
      fromPercent: percent(baseline.value),
      toPercent:   masteryPercent,
      fromLevel:   levelOf(baseline.value),
      toLevel:     level,
      since:       baseline.at.toISOString(),
    } : null;
    const all      = outcomesOf.get(topicKey(subjectId.get(t.subjectName) ?? null, t.topicName) ?? "") ?? [];
    const first    = all[0];
    const last     = all[all.length - 1];
    const delta    = change ? change.toPercent - change.fromPercent : 0;
    const answered = all.length >= 2 && first !== undefined && last !== undefined;
    const sessions = plural(t.reviewCount, "session");

    const topic = (direction: ProgressTopic["direction"], reason: string): ProgressTopic => ({
      topicId: t.topicId, topicName: t.topicName, subjectName: t.subjectName,
      masteryPercent, level, sessions: t.reviewCount, direction, change,
      outcomes: all.slice(-OUTCOMES_PER_TOPIC), reason,
    });

    if (!change && t.reviewCount === 1) {
      growth.justStarted.push(topic("just_started", last ? `One session so far: ${OUTCOME_WORD[last]}` : "One session so far"));
    } else if (change && delta <= -MASTERY_MOVE_POINTS) {
      growth.needsAttention.push(topic("needs_attention", `Down from ${change.fromPercent}% to ${change.toPercent}%`));
    } else if (last === "struggled") {
      growth.needsAttention.push(topic("needs_attention", "Your last session on it: Struggled"));
    } else if (change && delta >= MASTERY_MOVE_POINTS) {
      gainOf.set(t.topicId, delta);
      growth.improving.push(topic("improving", `Up from ${change.fromPercent}% to ${change.toPercent}%`));
    } else if (!change && answered && outcomeRank(last) > outcomeRank(first)) {
      growth.improving.push(topic("improving", `From ${OUTCOME_WORD[first]} to ${OUTCOME_WORD[last]} over ${plural(all.length, "session")}`));
    } else if (!change && answered && outcomeRank(last) < outcomeRank(first)) {
      growth.needsAttention.push(topic("needs_attention", `From ${OUTCOME_WORD[first]} to ${OUTCOME_WORD[last]} over ${plural(all.length, "session")}`));
    } else if (level === "weak") {
      growth.needsAttention.push(topic("needs_attention", `Still weak after ${sessions}`));
    } else {
      growth.steady.push(topic("steady", `Holding at ${masteryPercent}% over ${sessions}`));
    }
  }
  const byName = (a: ProgressTopic, b: ProgressTopic) => a.topicName.localeCompare(b.topicName);
  growth.improving.sort((a, b) => (gainOf.get(b.topicId) ?? 0) - (gainOf.get(a.topicId) ?? 0) || byName(a, b));
  growth.needsAttention.sort((a, b) => a.masteryPercent - b.masteryPercent || byName(a, b));
  growth.steady.sort((a, b) => b.masteryPercent - a.masteryPercent || byName(a, b));
  growth.justStarted.sort(byName);

  // ── Journey ─────────────────────────────────────────────────────────────────
  const journey: JourneyEvent[] = [];
  const sessionEvidence = (s: ProgressSessionRecord) => `A ${s.durationMinutes}-minute session${s.topicName ? ` on ${s.topicName}` : ""}`;

  counted.forEach((s, i) => {
    const n = before.counted + i + 1;
    if (n === 1) {
      journey.push({
        id: `first:${s.id}`, type: "first_session", date: s.sessionDate.toISOString(),
        title: "Your first session",
        description: s.topicName ? `${s.durationMinutes} minutes on ${s.topicName}.` : `${s.durationMinutes} minutes of study.`,
        evidence: sessionEvidence(s), source: { kind: "session", id: s.id },
        subjectName: nameOf(s.subjectId), topicName: s.topicName, importance: "major",
      });
    } else if (SESSION_MILESTONES.includes(n)) {
      journey.push({
        id: `sessions:${n}`, type: "session_milestone", date: s.sessionDate.toISOString(),
        title: `${n} sessions`,
        description: `Your ${ordinal(n)} focused session${s.topicName ? `, on ${s.topicName}` : ""}.`,
        evidence: `${n} finished sessions of ${COUNTED_SESSION_MINUTES} minutes or more`, source: { kind: "session", id: s.id },
        subjectName: nameOf(s.subjectId), topicName: s.topicName, importance: n >= 25 ? "major" : "notable",
      });
    }
  });

  for (const c of comebacks) {
    journey.push({
      id: `comeback:${c.session.id}`, type: "comeback", date: c.date,
      title: `Back after ${c.gapDays} days away`,
      description: c.topicName ? `You picked up ${c.topicName} again.` : "You started studying again.",
      evidence: `Your previous study day was ${c.gapDays} days earlier`, source: { kind: "session", id: c.session.id },
      subjectName: nameOf(c.session.subjectId), topicName: c.topicName, importance: c.gapDays >= 7 ? "major" : "notable",
    });
  }

  // "Good" or "Crushed it" on a topic after "Struggled". One per struggle.
  const struggling = new Set<string>();
  for (const s of timed) {
    const key = topicKey(s.subjectId, s.topicName);
    const outcome = outcomeOf(s);
    if (!key || !outcome) continue;
    if (outcome === "struggled") { struggling.add(key); continue; }
    if (outcomeRank(outcome) >= outcomeRank("good") && struggling.delete(key)) {
      journey.push({
        id: `breakthrough:${s.id}`, type: "breakthrough", date: s.sessionDate.toISOString(),
        title: `${s.topicName}: from Struggled to ${OUTCOME_WORD[outcome]}`,
        description: `You said this session went "${OUTCOME_WORD[outcome]}", after an earlier one on it that you struggled with.`,
        evidence: "Your own answers to \"How did it go?\"", source: { kind: "session", id: s.id },
        subjectName: nameOf(s.subjectId), topicName: s.topicName, importance: "major",
      });
    }
  }

  // A session moved a topic's number into a higher level.
  const topicById = new Map(input.topics.map(t => [t.topicId, t]));
  for (const r of input.masteryRecords) {
    const t = topicById.get(r.topicId);
    if (!t || r.source !== "session_report" || r.masteryBefore === null || r.reviewCount < 2) continue;
    const from = levelOf(r.masteryBefore);
    const to   = levelOf(r.masteryAfter);
    if (LEVEL_RANK[to] <= LEVEL_RANK[from]) continue;
    journey.push({
      id: `level:${r.id}`, type: "topic_level_up", date: r.recordedAt.toISOString(),
      title: `${t.topicName}: ${from} to ${to}`,
      description: `Its mastery estimate went from ${percent(r.masteryBefore)}% to ${percent(r.masteryAfter)}% after this session.`,
      evidence: "The mastery estimate recorded when the session ended", source: { kind: "mastery_record", id: r.id },
      subjectName: t.subjectName, topicName: t.topicName, importance: to === "solid" ? "major" : "notable",
    });
  }
  journey.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  // ── What changed ────────────────────────────────────────────────────────────
  const changes: ProgressChange[] = [];
  for (const t of growth.improving.slice(0, 2)) {
    const first = t.outcomes[0], last = t.outcomes[t.outcomes.length - 1];
    changes.push({
      kind: "topic_improved",
      text: t.change
        ? `${t.topicName} moved from ${t.change.fromPercent}% to ${t.change.toPercent}%${t.change.fromLevel !== t.change.toLevel ? ` (${t.change.fromLevel} to ${t.change.toLevel})` : ""}.`
        : `${t.topicName} went from ${OUTCOME_WORD[first!]} to ${OUTCOME_WORD[last!]}.`,
    });
  }
  const slipped = growth.needsAttention.find(t => t.change && t.change.toPercent - t.change.fromPercent <= -MASTERY_MOVE_POINTS);
  if (slipped?.change) {
    changes.push({ kind: "topic_slipped", text: `${slipped.topicName} slipped from ${slipped.change.fromPercent}% to ${slipped.change.toPercent}%.` });
  }
  const latestComeback = comebacks[comebacks.length - 1];
  if (latestComeback && today - latestComeback.session.day < RECENT_DAYS) {
    changes.push({ kind: "comeback", text: `You came back after ${latestComeback.gapDays} days away.` });
  }
  const inLast  = counted.filter(s => s.day > today - RECENT_DAYS).length;
  const inPrior = counted.filter(s => s.day > today - 2 * RECENT_DAYS && s.day <= today - RECENT_DAYS).length;
  if (inLast > 0) {
    // The 30 days before are a comparison only if the learner had started by then.
    const comparable = firstActiveDay !== null && firstActiveDay <= today - 2 * RECENT_DAYS + 1;
    const versus = !comparable ? ""
      : inLast > inPrior ? `, up from ${inPrior} in the ${RECENT_DAYS} days before`
      : inLast < inPrior ? `, down from ${inPrior} in the ${RECENT_DAYS} days before`
      : `, the same as the ${RECENT_DAYS} days before`;
    changes.push({ kind: "sessions", text: `You've completed ${plural(inLast, "focused session")} in the last ${RECENT_DAYS} days${versus}.` });
  }
  if (trendBasis && trend === "more_consistent") {
    changes.push({ kind: "consistency", text: `You're studying on more days each week: about ${trendBasis.recent}, up from ${trendBasis.earlier}.` });
  } else if (trendBasis && trend === "less_consistent") {
    changes.push({ kind: "consistency", text: `You're studying on fewer days each week: about ${trendBasis.recent}, down from ${trendBasis.earlier}.` });
  }

  // ── Assemble ────────────────────────────────────────────────────────────────
  const sessions = before.counted + counted.length;
  const dna      = input.learningDna;

  return {
    status:      "ready",
    generatedAt: now.toISOString(),
    hasEvidence: sessions > 0,
    overview: {
      since:           (before.firstAt ?? counted[0]?.sessionDate ?? null)?.toISOString() ?? null,
      sessions,
      learningMinutes: before.minutes + counted.reduce((sum, s) => sum + s.durationMinutes, 0),
      activeDays:      activeDays.length,
      topicsImproved:  growth.improving.length,
      notCounted: {
        selfReported:    before.selfReported + finished.filter(s => !isTimedSession(s)).length,
        underTenMinutes: before.underTenMinutes + timed.filter(s => !isCountedSession(s)).length,
      },
    },
    changes: changes.slice(0, CHANGES_LIMIT),
    growth,
    consistency: {
      timezone, weeks, trend, trendBasis,
      lastActiveDay:       lastActiveDay === null ? null : keyOf(lastActiveDay),
      daysSinceLastActive: lastActiveDay === null ? null : Math.max(0, today - lastActiveDay),
      comebacks: comebacks.map(({ date, gapDays, topicName }) => ({ date, gapDays, topicName })).reverse(),
    },
    journey: journey.slice(0, JOURNEY_LIMIT),
    goals:   input.goals.map(g => g.trim()).filter(Boolean),
    nextExam: input.nextExam && input.nextExam.scheduledAt.getTime() >= now.getTime() ? {
      title:       input.nextExam.title,
      subjectName: nameOf(input.nextExam.subjectId),
      date:        input.nextExam.scheduledAt.toISOString(),
      daysUntil:   Math.max(0, dayOf(input.nextExam.scheduledAt) - today),
    } : null,
    // Learning DNA marks itself "low" until three sessions have fed it. One
    // session is not a pattern.
    usualSession: dna && dna.confidence !== "low" && dna.optimalSessionMinutes !== null
      ? { minutes: dna.optimalSessionMinutes, basedOnSessions: dna.dataPointCount }
      : null,
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────
// A fixed number of queries whatever the learner's history: one for the
// learner, then six together.

export async function loadNovaProgress(
  platformChatId: string,
  options: { now?: Date } = {},
): Promise<NovaProgressView> {
  const now = options.now ?? new Date();

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      novaAcademicProfile: {
        select: {
          id: true, onboardingComplete: true, timezone: true, goals: true,
          subjects:    { select: { id: true, name: true }, orderBy: { name: "asc" } },
          learningDNA: { select: { optimalSessionMinutes: true, dataPointCount: true, confidence: true } },
          exams: {
            where: { scheduledAt: { gte: now } }, orderBy: { scheduledAt: "asc" }, take: 1,
            select: { title: true, subjectId: true, scheduledAt: true },
          },
        },
      },
    },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };

  const since    = new Date(now.getTime() - PROGRESS_WINDOW_DAYS * DAY_MS);
  const earlier  = { profileId: profile.id, status: "completed", sessionDate: { lt: since } };
  const timedRow = { activityType: { not: SELF_REPORTED_ACTIVITY } };

  const [topics, sessions, masteryRecords, countedBefore, selfReportedBefore, shortBefore] = await Promise.all([
    getAllTopicMasteries(profile.id, now),
    prisma.novaStudySession.findMany({
      where:   { profileId: profile.id, status: "completed", sessionDate: { gte: since, lte: now } },
      orderBy: { sessionDate: "asc" },
      select:  {
        id: true, subjectId: true, topicName: true, sessionDate: true,
        durationMinutes: true, activityType: true, executionReport: true,
      },
    }),
    prisma.novaTopicMasterySnapshot.findMany({
      where:   { profileId: profile.id, recordedAt: { gte: since, lte: now } },
      orderBy: { recordedAt: "asc" },
      select:  {
        id: true, topicId: true, source: true, sessionId: true,
        masteryBefore: true, masteryAfter: true, reviewCount: true, recordedAt: true,
      },
    }),
    prisma.novaStudySession.aggregate({
      where:  { ...earlier, ...timedRow, durationMinutes: { gte: COUNTED_SESSION_MINUTES } },
      _count: { _all: true }, _sum: { durationMinutes: true }, _min: { sessionDate: true }, _max: { sessionDate: true },
    }),
    prisma.novaStudySession.count({ where: { ...earlier, activityType: SELF_REPORTED_ACTIVITY } }),
    prisma.novaStudySession.count({ where: { ...earlier, ...timedRow, durationMinutes: { lt: COUNTED_SESSION_MINUTES } } }),
  ]);

  return buildProgressView({
    timezone: profile.timezone,
    subjects: profile.subjects,
    topics,
    sessions,
    masteryRecords,
    before: {
      counted: countedBefore._count._all,
      minutes: countedBefore._sum.durationMinutes ?? 0,
      firstAt: countedBefore._min.sessionDate,
      lastAt:  countedBefore._max.sessionDate,
      selfReported:    selfReportedBefore,
      underTenMinutes: shortBefore,
    },
    goals:       profile.goals,
    nextExam:    profile.exams[0] ?? null,
    learningDna: profile.learningDNA,
    now,
  });
}
