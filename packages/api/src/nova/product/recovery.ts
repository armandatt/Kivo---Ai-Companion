// ─── Getting back on track ────────────────────────────────────────────────────
// Reads the record, asks the Recovery Engine where the learner is and what
// it proposes, and applies a proposal only when the learner accepts it.
//
//   - Nothing here runs on a timer or from a sentence. Reading writes
//     nothing: the proposal is recomputed from the record on every read, so
//     a repeated trigger (a reload, a second tab, Telegram and the web at
//     once) finds the same proposal and creates nothing.
//   - The active plan is untouched while the learner decides: the proposal
//     lives only in the answer to a read.
//   - Accept names a proposal id. It is applied only if the record still
//     gives that id, and then the server applies its own moves, not the
//     request's, each re-checked by the plan change policy, in one guarded
//     transaction (tasks.ts moveTaskDueDays). A retry finds them done and
//     says so; a record that changed in between is answered with the
//     proposal as it now stands, and nothing is written.
//   - Undo puts back exactly what an accept moved, under the same guard.
//   - Rejecting writes nothing (there is no store for a decision yet: see
//     the schema request in audit/phase2-tracker.md). Not accepting is
//     enough for nothing to change.
//   - Tasks are read and written only through tasks.ts. No session, mastery,
//     exam, stated time or plan is written; no model is called.

import { prisma } from "@repo/db/client";
import { dateDayKey, dayKey, dayKeyOfNumber, dayNumber, resolveTimezone } from "../engines/learner-calendar";
import { assessRecovery, countedStudyDays, type RecoveryAssessment, type RecoveryDeadline } from "../engines/recovery-engine";
import { classifyChange } from "../decision/plan-change-policy";
import { DEADLINE_RULES, deadlineType } from "./deadline-types";
import { isDay, listTasks, moveTaskDueDays, mostTasksDoneInADay, taskDueDays } from "./tasks";
import { RECOVERY_MOVES_MAX, type NovaRecoveryReady, type RecoveryActionResponse, type RecoveryMoveInput } from "./recovery.types";

const PROPOSAL_ID_MAX = 40;
const TASK_ID_MAX = 64;

function audit(event: string, profileId: string, extra: Record<string, unknown>): void {
  console.log(JSON.stringify({ layer: "nova_recovery", event, profileId, ...extra }));
}

// ── Reading ───────────────────────────────────────────────────────────────────

async function loadAssessment(profileId: string, now: Date): Promise<{ assessment: RecoveryAssessment; deadlines: RecoveryDeadline[]; subjectOf: Map<string, string | null> }> {
  const profile = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
  const timezone = profile?.timezone ?? null;
  const today = dayKey(now, resolveTimezone(timezone));
  const [tasks, sessions, exams, mostDone] = await Promise.all([
    listTasks(profileId, { now }),
    prisma.novaStudySession.findMany({
      where:  { profileId, status: "completed", sessionDate: { gte: new Date(now.getTime() - 90 * 86_400_000) } },
      select: { sessionDate: true, status: true, durationMinutes: true, activityType: true },
    }),
    // A day or two back covers a date-only instant in any zone; filtered by day below.
    prisma.novaExam.findMany({
      where:  { profileId, scheduledAt: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
      select: { id: true, title: true, examType: true, scheduledAt: true, subject: { select: { name: true } } },
    }),
    mostTasksDoneInADay(profileId, timezone, now),
  ]);
  const deadlines: RecoveryDeadline[] = exams
    .map(e => ({
      id: e.id, title: e.title, subjectName: e.subject?.name ?? null,
      day: dateDayKey(e.scheduledAt, timezone),
      takesOverTheDay: DEADLINE_RULES[deadlineType(e.examType)].takesOverTheDay,
    }))
    .filter(d => d.day >= today);
  const assessment = assessRecovery({
    today,
    studyDays: countedStudyDays(sessions, timezone),
    tasks: tasks.tasks.map(t => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, dueDay: t.dueDay,
      subjectName: t.subjectName, createdAt: t.createdAt,
    })),
    deadlines,
    mostTasksDoneInADay: mostDone,
  });
  return { assessment, deadlines, subjectOf: new Map(tasks.tasks.map(t => [t.id, t.subjectName])) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function recoveryHeadline(a: Pick<RecoveryAssessment, "situation" | "daysSinceStudy" | "missedDays" | "overdueTaskCount">): string {
  const tasks = a.overdueTaskCount > 0 ? ` ${plural(a.overdueTaskCount, "task")} ${a.overdueTaskCount === 1 ? "is" : "are"} past ${a.overdueTaskCount === 1 ? "its" : "their"} due day.` : "";
  switch (a.situation) {
    case "returning":      return `Welcome back. Your last session was ${a.daysSinceStudy} days ago, so today is a shorter first day back.${tasks}`;
    case "missed_several": return `${plural(a.missedDays, "day")} without a session. Today is planned as usual, with overdue reviews first.${tasks}`;
    case "missed_one":     return `You missed a day. Today is planned as usual: nothing has to be caught up at once.${tasks}`;
    case "on_track":       return tasks ? tasks.trim() : "You're on track.";
    // Only the last 90 days are read: no session in them is not "never".
    case "no_history":     return tasks ? tasks.trim() : "No session in the last 90 days, so there is nothing to catch up.";
  }
}

function toView(a: RecoveryAssessment): NovaRecoveryReady {
  return {
    status: "ready", today: a.today, situation: a.situation, lastStudyDay: a.lastStudyDay,
    daysSinceStudy: a.daysSinceStudy, missedDays: a.missedDays, overdueTaskCount: a.overdueTaskCount,
    reentryDay: a.reentryDay, headline: recoveryHeadline(a),
    proposal: a.proposal && {
      id: a.proposal.id, assumptions: a.proposal.assumptions,
      moves: a.proposal.moves.map(m => ({ taskId: m.taskId, title: m.title, from: m.from, to: m.to, reason: m.reason })),
      unplaced: a.proposal.unplaced.map(u => ({ taskId: u.taskId, title: u.title, from: u.from, why: u.why, reason: u.reason })),
    },
  };
}

export async function getRecovery(profileId: string, now = new Date()): Promise<NovaRecoveryReady> {
  return toView((await loadAssessment(profileId, now)).assessment);
}

// ── Accept and undo ───────────────────────────────────────────────────────────

function parseMoves(raw: unknown): RecoveryMoveInput[] | null {
  if (!Array.isArray(raw) || raw.length > RECOVERY_MOVES_MAX) return null;
  const out: RecoveryMoveInput[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { taskId, from, to } = m as Record<string, unknown>;
    if (typeof taskId !== "string" || taskId.length === 0 || taskId.length > TASK_ID_MAX || !isDay(from) || !isDay(to)) return null;
    out.push({ taskId, from, to });
  }
  return out;
}

export function parseRecoveryAction(raw: unknown):
  | { ok: true; action: "accept"; proposalId: string; moves: RecoveryMoveInput[] }
  | { ok: true; action: "undo"; moves: RecoveryMoveInput[] }
  | { ok: false } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const input = raw as Record<string, unknown>;
  const moves = parseMoves(input.moves);
  if (!moves) return { ok: false };
  if (input.action === "undo") return moves.length > 0 ? { ok: true, action: "undo", moves } : { ok: false };
  if (input.action !== "accept") return { ok: false };
  const id = input.proposalId;
  if (typeof id !== "string" || id.length === 0 || id.length > PROPOSAL_ID_MAX) return { ok: false };
  return { ok: true, action: "accept", proposalId: id, moves };
}

const refuse = (error: Extract<RecoveryActionResponse, { ok: false }>["error"], message: string, view?: NovaRecoveryReady): RecoveryActionResponse =>
  ({ ok: false, error, message, ...(view ? { view } : {}) });

// Whether each task is already due where these moves would put it.
async function alreadyAt(profileId: string, moves: RecoveryMoveInput[], side: "to" | "from"): Promise<boolean> {
  if (moves.length === 0) return false;
  const now = await taskDueDays(profileId, moves.map(m => m.taskId));
  return moves.every(m => now.get(m.taskId)?.dueDay === m[side]);
}

export async function actOnRecovery(profileId: string, raw: unknown, now = new Date()): Promise<RecoveryActionResponse> {
  const parsed = parseRecoveryAction(raw);
  if (!parsed.ok) return refuse("invalid", "That isn't a change Nova can make.");

  if (parsed.action === "undo") {
    // Back to exactly where the accept found them, guarded on where it put them.
    const back = parsed.moves.map(m => ({ taskId: m.taskId, from: m.to, to: m.from }));
    const result = await moveTaskDueDays(profileId, back);
    const view = await getRecovery(profileId, now);
    if (result.ok) { audit("undone", profileId, { moved: result.moved }); return { ok: true, outcome: "undone", undo: [], view }; }
    if (await alreadyAt(profileId, parsed.moves, "from")) return { ok: true, outcome: "already_undone", undo: [], view };
    audit("undo_refused_changed", profileId, { moves: parsed.moves.length });
    return refuse("changed", "Some of these tasks have changed since, so nothing was put back. Check them on the board.", view);
  }

  const { assessment, deadlines, subjectOf } = await loadAssessment(profileId, now);
  const current = assessment.proposal;
  if (!current || current.id !== parsed.proposalId) {
    // A retry, or another tab that accepted first: what was asked is done.
    if (await alreadyAt(profileId, parsed.moves, "to")) {
      return { ok: true, outcome: "already_applied", undo: parsed.moves, view: toView(assessment) };
    }
    audit("accept_refused_changed", profileId, { proposalId: parsed.proposalId, current: current?.id ?? null });
    return refuse("changed", "Your tasks or dates changed since this was worked out. Here is how it looks now; nothing was moved.", toView(assessment));
  }

  // The server's own moves, each checked again before anything is written.
  const taken = deadlines.filter(d => d.takesOverTheDay).map(d => d.day);
  const due = await taskDueDays(profileId, current.moves.map(m => m.taskId));
  for (const m of current.moves) {
    // Not past the next date of the task's own subject.
    const subject = subjectOf.get(m.taskId) ?? null;
    const next = subject === null ? undefined : deadlines
      .filter(d => d.subjectName === subject)
      .sort((a, b) => a.day.localeCompare(b.day))[0];
    const verdict = classifyChange({
      kind: "move_task", from: m.from, to: m.to, today: assessment.today, takenDays: taken,
      latestDay: next ? dayKeyOfNumber(dayNumber(next.day) - 1) : null, taskOpen: due.get(m.taskId)?.open ?? false,
    });
    if (verdict.class !== "needs_approval") {
      audit("accept_refused_policy", profileId, { proposalId: current.id, why: verdict.why });
      return refuse("refused", "Nova can't make this change.", toView(assessment));
    }
  }

  const moves = current.moves.map(m => ({ taskId: m.taskId, from: m.from, to: m.to }));
  const result = await moveTaskDueDays(profileId, moves);
  if (!result.ok) {
    // Two accepts at once: the other one went through.
    if (await alreadyAt(profileId, moves, "to")) {
      return { ok: true, outcome: "already_applied", undo: moves, view: await getRecovery(profileId, now) };
    }
    audit("accept_refused_changed", profileId, { proposalId: current.id });
    return refuse("changed", "Your tasks changed while this was being saved, so nothing was moved. Here is how it looks now.", await getRecovery(profileId, now));
  }
  audit("accepted", profileId, { proposalId: current.id, moved: result.moved });
  return { ok: true, outcome: "applied", undo: moves, view: await getRecovery(profileId, now) };
}
