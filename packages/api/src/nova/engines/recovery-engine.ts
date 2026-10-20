// ─── Recovery Engine ──────────────────────────────────────────────────────────
// Getting back on track after missed days, from what is on record. Pure: no
// database, no model, no clock (the caller passes the learner's today).
//
// It answers three things:
//   1. Where the learner is: studied today, missed a day, missed several, or
//      back after a gap. Counted from the calendar days that have a counted
//      session (isCountedSession), in the learner's own timezone.
//   2. What may change by itself (policy below): only the shape of today's
//      computed plan, which is never stored. A first day back is planned
//      shorter (a re-entry day). Nothing is written and nothing is undone:
//      the next counted session ends it.
//   3. What needs the learner's approval: anything that changes a record
//      they set. Today that is moving overdue tasks to new due days. The
//      moves are a proposal: computed from the record every time it is
//      asked for, identified by a fingerprint of exactly those moves, and
//      applied only when the learner accepts that fingerprint. While they
//      decide, nothing changes; asked again, the same record gives the same
//      proposal, so a repeated trigger makes nothing new.
//
// It never adds time to a day, never moves or removes a dated deadline, and
// never treats time, a saved page or a finished task as learning.

import { dayKey, dayKeyOfNumber, dayNumber, resolveTimezone } from "./learner-calendar";
import { isCountedSession } from "./study-session-engine";

// Back after a gap: the same threshold as a comeback on Progress (four or
// more calendar days after the previous active day).
export const RETURNING_AFTER_DAYS = 4;
// How far ahead an overdue task may be placed.
export const RESCHEDULE_HORIZON_DAYS = 14;
// A re-entry day is this share of the usual day, never under the shortest block.
export const REENTRY_SHARE = 0.5;

export type RecoverySituation =
  | "no_history"       // no counted session on record
  | "on_track"         // studied today or yesterday
  | "missed_one"       // one whole calendar day without study
  | "missed_several"   // two or three
  | "returning";       // four or more: back after a gap

export interface RecoveryTask {
  id:          string;
  title:       string;
  status:      "todo" | "in_progress" | "done";
  priority:    "low" | "medium" | "high" | null;
  dueDay:      string | null;      // YYYY-MM-DD, the learner's calendar
  subjectName: string | null;
  createdAt:   string;             // ISO, for a stable order
}

export interface RecoveryDeadline {
  id:              string;
  title:           string;
  subjectName:     string | null;
  day:             string;          // YYYY-MM-DD, the day the learner gave
  // An exam or certification: the day itself is taken by it.
  takesOverTheDay: boolean;
}

export interface RecoveryInput {
  today:        string;             // the learner's calendar day
  // Calendar days with a counted session, any order, duplicates allowed.
  studyDays:    string[];
  tasks:        RecoveryTask[];
  // Dated deadlines from today on.
  deadlines:    RecoveryDeadline[];
  // The most tasks the learner has finished on one calendar day, from their
  // own record; 0 when they have finished none.
  mostTasksDoneInADay: number;
}

export interface TaskMove {
  taskId: string;
  title:  string;
  from:   string;                   // the overdue due day it has now
  to:     string;                   // the day proposed
  reason: string;
}

export interface UnplacedTask {
  taskId: string;
  title:  string;
  from:   string;
  why:    "deadline_conflict" | "no_room";
  reason: string;
}

export interface RecoveryProposal {
  // A fingerprint of exactly these moves and where each task is now. The
  // same record gives the same id; any change to it gives another.
  id:        string;
  moves:     TaskMove[];
  unplaced:  UnplacedTask[];
  perDayCap: number;
  // What the placement assumed, said every time.
  assumptions: string[];
}

export interface RecoveryAssessment {
  today:            string;
  situation:        RecoverySituation;
  lastStudyDay:     string | null;
  daysSinceStudy:   number | null;  // calendar days; 0 = studied today
  missedDays:       number;         // whole calendar days without study since the last one
  overdueTaskCount: number;
  // Automatic, because it changes nothing stored (policy: plan-change-policy).
  reentryDay:       boolean;
  // Needs the learner's approval. null: nothing to propose.
  proposal:         RecoveryProposal | null;
}

// ── Where the learner is ──────────────────────────────────────────────────────

export function studyGap(today: string, studyDays: string[]): Pick<RecoveryAssessment, "situation" | "lastStudyDay" | "daysSinceStudy" | "missedDays"> {
  const t = dayNumber(today);
  const past = studyDays.map(dayNumber).filter(d => Number.isFinite(d) && d <= t);
  if (past.length === 0) return { situation: "no_history", lastStudyDay: null, daysSinceStudy: null, missedDays: 0 };
  const last = Math.max(...past);
  const since = t - last;
  const missed = Math.max(0, since - 1);
  const situation: RecoverySituation =
    since <= 1 ? "on_track"
    : since === 2 ? "missed_one"
    : since < RETURNING_AFTER_DAYS ? "missed_several"
    : "returning";
  return { situation, lastStudyDay: dayKeyOfNumber(last), daysSinceStudy: since, missedDays: missed };
}

// The learner's calendar days with a counted session: finished, timed by
// Nova, ten minutes or more (the definition Progress and Learning DNA use).
export function countedStudyDays(
  sessions: Array<{ sessionDate: Date; status: string; durationMinutes: number; activityType?: string }>,
  timezone: string | null,
): string[] {
  const zone = resolveTimezone(timezone);
  return sessions
    .filter(s => s.status === "completed" && isCountedSession({ activityType: s.activityType ?? "", durationMinutes: s.durationMinutes }))
    .map(s => dayKey(s.sessionDate, zone));
}

// What the learner has already done today: the topics of today's counted
// sessions (in their zone) and those sessions' minutes. The plan for the
// rest of the day starts from this (PlanOptions.doneToday): a topic done
// today is not handed back as the next block.
//
// A session names its topic as it was recorded: its subject and topic name
// (a topic's identity), or a topic id when it has one. With no subject on
// record, a name only one of the learner's topics has is that topic.
export interface DoneToday { topicIds: string[]; minutes: number }

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function studiedToday(
  sessions: Array<{ sessionDate: Date; status: string; durationMinutes: number; activityType?: string; topicId: string | null; topicName: string | null; subjectName?: string | null }>,
  timezone: string | null,
  now:      Date,
  topics:   Array<{ topicId: string; topicName: string; subjectName: string }>,
): DoneToday {
  const zone  = resolveTimezone(timezone);
  const today = dayKey(now, zone);
  const done  = sessions.filter(s => s.status === "completed"
    && isCountedSession({ activityType: s.activityType ?? "", durationMinutes: s.durationMinutes })
    && dayKey(s.sessionDate, zone) === today);
  const topicOf = (s: (typeof done)[number]): string | null => {
    if (s.topicId) return s.topicId;
    if (!s.topicName) return null;
    const named = topics.filter(t => sameName(t.topicName, s.topicName!));
    const match = s.subjectName ? named.filter(t => sameName(t.subjectName, s.subjectName!)) : named;
    return match.length === 1 ? match[0]!.topicId : null;
  };
  return {
    topicIds: [...new Set(done.flatMap(s => { const id = topicOf(s); return id ? [id] : []; }))],
    minutes:  done.reduce((sum, s) => sum + s.durationMinutes, 0),
  };
}

// A first day back after a gap: no counted session today and the last one
// four or more calendar days ago.
export const isReentryDay = (today: string, studyDays: string[]): boolean => studyGap(today, studyDays).situation === "returning";

// ── Re-entry day (automatic) ─────────────────────────────────────────────────

// How long a re-entry day is, from the usual day. Only ever shorter.
export function reentryMinutes(usualMinutes: number, shortestBlock: number): number {
  if (!(usualMinutes > 0)) return usualMinutes;
  const half = Math.round((usualMinutes * REENTRY_SHARE) / 5) * 5;
  return Math.min(usualMinutes, Math.max(shortestBlock, half));
}

// ── Moving overdue tasks (needs approval) ─────────────────────────────────────

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function overdueOpen(tasks: RecoveryTask[], today: number): Array<RecoveryTask & { dueDay: string }> {
  return tasks
    .filter((t): t is RecoveryTask & { dueDay: string } => t.status !== "done" && t.dueDay !== null && dayNumber(t.dueDay) < today)
    .sort((a, b) =>
      (a.priority ? PRIORITY_ORDER[a.priority] : 3) - (b.priority ? PRIORITY_ORDER[b.priority] : 3)
      || a.dueDay.localeCompare(b.dueDay)
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));
}

// FNV-1a over the text, twice with different seeds: a stable id, not a secret.
function fingerprint(text: string): string {
  const run = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, "0");
  };
  return `rp_${run(2166136261)}${run(0x9747b28c)}`;
}

export function proposalId(today: string, moves: Array<Pick<TaskMove, "taskId" | "from" | "to">>, unplaced: Array<Pick<UnplacedTask, "taskId" | "from" | "why">>): string {
  const m = [...moves].sort((a, b) => a.taskId.localeCompare(b.taskId)).map(x => `${x.taskId}:${x.from}>${x.to}`);
  const u = [...unplaced].sort((a, b) => a.taskId.localeCompare(b.taskId)).map(x => `${x.taskId}:${x.from}!${x.why}`);
  return fingerprint(`${today}|${m.join(",")}|${u.join(",")}`);
}

// "Today", "Tomorrow" or the day itself, to open a sentence.
const whenWord = (key: string, today: string) => {
  const d = dayNumber(key) - dayNumber(today);
  return d === 0 ? "Today" : d === 1 ? "Tomorrow" : key;
};

export function proposeTaskMoves(input: RecoveryInput): RecoveryProposal | null {
  const today = dayNumber(input.today);
  const overdue = overdueOpen(input.tasks, today);
  if (overdue.length === 0) return null;

  // Their own record says how many tasks a day they get through; never
  // fewer than one.
  const perDayCap = Math.max(1, input.mostTasksDoneInADay);
  const load = new Map<number, number>();
  for (const t of input.tasks) {
    if (t.status === "done" || t.dueDay === null) continue;
    const d = dayNumber(t.dueDay);
    if (d >= today) load.set(d, (load.get(d) ?? 0) + 1);
  }
  // The day of an exam or certification is that day's; nothing is moved onto it.
  const taken = new Set(input.deadlines.filter(d => d.takesOverTheDay).map(d => dayNumber(d.day)));

  const moves: TaskMove[] = [];
  const unplaced: UnplacedTask[] = [];
  for (const task of overdue) {
    // A task filed under a subject goes before that subject's next date.
    const next = input.deadlines
      .filter(d => task.subjectName !== null && d.subjectName === task.subjectName && dayNumber(d.day) >= today)
      .sort((a, b) => a.day.localeCompare(b.day))[0];
    const latest = next ? dayNumber(next.day) - 1 : today + RESCHEDULE_HORIZON_DAYS;
    if (latest < today) {
      unplaced.push({
        taskId: task.id, title: task.title, from: task.dueDay, why: "deadline_conflict",
        reason: `${next!.title} is today, so there is no day left before it. Decide whether this still matters for it.`,
      });
      continue;
    }
    let placed: number | null = null;
    for (let d = today; d <= latest; d++) {
      if (taken.has(d)) continue;
      if ((load.get(d) ?? 0) >= perDayCap) continue;
      placed = d;
      break;
    }
    if (placed === null) {
      unplaced.push({
        taskId: task.id, title: task.title, from: task.dueDay, why: "no_room",
        reason: next
          ? `Every day before ${next.title} already has as many tasks as you usually finish in a day.`
          : `Every day in the next ${RESCHEDULE_HORIZON_DAYS} already has as many tasks as you usually finish in a day.`,
      });
      continue;
    }
    load.set(placed, (load.get(placed) ?? 0) + 1);
    const to = dayKeyOfNumber(placed);
    moves.push({
      taskId: task.id, title: task.title, from: task.dueDay, to,
      reason: next
        ? `Was due ${task.dueDay}. ${whenWord(to, input.today)}, before ${next.title} (${next.day}).`
        : `Was due ${task.dueDay}. ${whenWord(to, input.today)} is the first day with room.`,
    });
  }

  const assumptions = [
    input.mostTasksDoneInADay > 0
      ? `At most ${perDayCap} task${perDayCap === 1 ? "" : "s"} due on a day: the most you have finished in one day.`
      : "At most 1 task due on a day: you have not finished any tasks yet, so Nova does not know how many a day suits you.",
    "A task filed under a subject is placed before that subject's next date. Exam and certification days are left free.",
  ];
  return { id: proposalId(input.today, moves, unplaced), moves, unplaced, perDayCap, assumptions };
}

// ── The whole assessment ──────────────────────────────────────────────────────

export function assessRecovery(input: RecoveryInput): RecoveryAssessment {
  const gap = studyGap(input.today, input.studyDays);
  const today = dayNumber(input.today);
  const proposal = proposeTaskMoves(input);
  return {
    today: input.today,
    ...gap,
    overdueTaskCount: overdueOpen(input.tasks, today).length,
    reentryDay: gap.situation === "returning",
    proposal,
  };
}
