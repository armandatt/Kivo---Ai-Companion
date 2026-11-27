// ─── Session commands ─────────────────────────────────────────────────────────
// Start / Pause / Resume / End from the web app. The rows are written by the
// same functions a chat turn uses (persistence/nova-persistence.ts), so a
// session started on the web is the session Nova sees on Telegram, and one
// ended on the web leaves the same evidence as /done.
// Deterministic: no LLM call.

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { loadStudySnapshot } from "../engines/study-snapshot";
import {
  openStudySession,
  pauseStudySession,
  persistSessionEnd,
  resumeStudySession,
  setSessionLength,
  setSessionDetails,
  setSessionTopic,
  fileEndedSession,
  closeUnconfirmed,
  confirmSessionTime,
  abandonIfStale,
  saveSessionNote,
} from "../persistence/nova-persistence";
import { parseReflection } from "./focus-context";
import { setTopicStatus } from "./topic-status";
import type { ReflectionResponse } from "./focus-context.types";
import { checkSessionCommand, sessionElapsedSeconds, toSessionView } from "./session-view";
import { COUNTED_SESSION_MINUTES, SELF_REPORTED_ACTIVITY } from "../engines/study-session-engine";
import { ABANDONED_STATUS, AUTO_SAVED_PAUSED, AUTO_SAVED_RUNNING, UNCONFIRMED_STATUS, abandonmentPlanMinutes, needsTimeConfirm } from "../engines/session-clock";
import type { NovaAutoSavedSession, NovaSessionCommand, NovaSessionResponse, NovaSessionView } from "./today.types";

export async function loadNovaSession(platformChatId: string, now = new Date()): Promise<NovaSessionView | null> {
  const snapshot = await loadStudySnapshot(platformChatId);
  if (!snapshot.activeSession) return null;
  return { ...toSessionView(snapshot.activeSession, now), details: await detailsOf(snapshot.activeSession.id) };
}

// The running session, and when nothing runs, the last session if it was a
// paused one saved for the learner (GET /api/nova/session), so the page can
// say so instead of the session silently going away.
export async function loadNovaSessionState(platformChatId: string, now = new Date()): Promise<{ session: NovaSessionView | null; autoSaved: NovaAutoSavedSession | null }> {
  const snapshot = await loadStudySnapshot(platformChatId);
  if (snapshot.activeSession) return { session: { ...toSessionView(snapshot.activeSession, now), details: await detailsOf(snapshot.activeSession.id) }, autoSaved: null };
  if (!snapshot.profileId) return { session: null, autoSaved: null };
  const how = await lastClosure(snapshot.profileId);
  return { session: null, autoSaved: how?.kind === "saved" ? how.saved : null };
}

// A session's Quick Focus details, read only for the page.
export function readFocusDetails(raw: unknown): { category: string | null; description: string | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const category = typeof r.category === "string" && r.category ? r.category : null;
  const description = typeof r.description === "string" && r.description ? r.description : null;
  return category || description ? { category, description } : null;
}
async function detailsOf(sessionId: string) {
  const row = await prisma.novaStudySession.findUnique({ where: { id: sessionId }, select: { focusDetails: true } });
  return readFocusDetails(row?.focusDetails);
}

const SESSION_ABANDONED = {
  ok: false as const, error: "session_abandoned" as const,
  message: "That session was left open past its time, so it was closed and not counted. Start a new one when you're ready.",
};

// Whether the learner's most recent session is one that was closed as
// abandoned. False again as soon as they start another.
export async function lastSessionWasAbandoned(profileId: string): Promise<boolean> {
  return (await lastClosure(profileId))?.kind === "abandoned";
}

// The words for a paused session that was saved for the learner.
export function autoSavedMessage(minutes: number, counted: boolean): string {
  const time = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return counted
    ? `Your paused session was left paused for over two hours, so it was saved with the ${time} you studied before the pause.`
    : `Your paused session was left paused for over two hours, so it was saved with the ${time} you studied before the pause. Under ten minutes isn't counted in Progress.`;
}

// How the learner's most recent session (not one they reported afterwards)
// was closed for them, if it was: abandoned, or saved after a long pause.
// null once they start another, or when they closed it themselves.
export async function lastClosure(profileId: string): Promise<{ kind: "abandoned" } | { kind: "saved"; saved: NovaAutoSavedSession } | null> {
  const last = await prisma.novaStudySession.findFirst({
    where:   { profileId, activityType: { not: SELF_REPORTED_ACTIVITY } },
    orderBy: { createdAt: "desc" },
    select:  { id: true, status: true, durationMinutes: true, topicName: true, currentFocus: true, executionReport: true },
  });
  if (!last) return null;
  if (last.status === ABANDONED_STATUS) return { kind: "abandoned" };
  const report = last.executionReport as { autoClosed?: unknown; pausedAt?: unknown; backfilled?: unknown; endedBy?: unknown } | null;
  // Its time waits for the learner's word (B.1): said on their return.
  if (last.status === UNCONFIRMED_STATUS) {
    return { kind: "saved", saved: {
      sessionId: last.id, label: last.topicName ?? last.currentFocus ?? null, topicName: last.topicName, minutes: last.durationMinutes, counted: false,
      pausedAt: null, needsConfirm: true,
      message: `This session ran ${last.durationMinutes} minutes, well past its plan, so it isn't counted yet. Confirm how long you studied, or trim it.`,
    } };
  }
  // Saved later by the backfill (persistence/session-backfill.ts): old news, not announced.
  if (last.status !== "completed" || (report?.autoClosed !== AUTO_SAVED_PAUSED && report?.autoClosed !== AUTO_SAVED_RUNNING) || report?.endedBy || report.backfilled) return null;
  const counted = last.durationMinutes >= COUNTED_SESSION_MINUTES;
  return { kind: "saved", saved: {
    sessionId: last.id, label: last.topicName ?? last.currentFocus ?? null, topicName: last.topicName,
    minutes: last.durationMinutes, counted,
    pausedAt: typeof report.pausedAt === "string" ? report.pausedAt : null,
    message: report?.autoClosed === AUTO_SAVED_RUNNING
      ? `Your session was left running past its plan, so it was saved with the ${last.durationMinutes} minutes on its clock.${counted ? "" : " Under ten minutes isn't counted in Progress."}`
      : autoSavedMessage(last.durationMinutes, counted),
  } };
}

export async function runNovaSessionCommand(
  platformChatId: string,
  command:        NovaSessionCommand,
  now = new Date(),
  // Where the command came from. It is recorded with the session's closing
  // entry in the conversation log; it changes nothing about what is written.
  surface: "web" | "telegram" = "web",
): Promise<NovaSessionResponse> {
  const snapshot = await loadStudySnapshot(platformChatId);
  const profileId = snapshot.profileId;
  if (!profileId) {
    return { ok: false, error: "onboarding_incomplete", message: "Finish setting up with Nova first." };
  }

  // Confirming or trimming an unconfirmed session's time (B.1).
  if (command.action === "confirm_time") {
    const done = await confirmSessionTime(profileId, command.sessionId, command.minutes);
    if (!done) return { ok: false, error: "invalid", message: "That session has nothing to confirm." };
    return { ok: true, session: await loadNovaSession(platformChatId, now), ended: null };
  }

  // Filing a finished session touches no open session and no clock.
  if (command.action === "file") {
    const named = await fileEndedSession(profileId, command.sessionId, command.subjectId, command.topicName);
    if (!named) return { ok: false, error: "invalid", message: "That session can't be filed there. It may already be on a topic." };
    // Where the topic stands, when the learner said so while filing (item 7).
    const st = command.topicStatus ? await setTopicStatus(profileId, { subjectId: command.subjectId, topicName: named }, command.topicStatus, now) : null;
    return { ok: true, session: await loadNovaSession(platformChatId, now), ended: null, filed: { sessionId: command.sessionId, subjectId: command.subjectId, topicName: named, ...(st?.ok ? { topicStatus: st.status } : {}) } };
  }

  // An End is taken as it comes: a session that is still open is ended as a
  // session, however long it ran (persistence/nova-persistence.ts,
  // endStudySession). Any other command first closes a session that is past
  // its limit, so a Start starts afresh and a Pause or Resume has nothing
  // left to act on.
  const left   = command.action !== "end" && snapshot.activeSession !== null
    && await abandonIfStale(snapshot.activeSession.id, now).catch(() => false);
  const active = left ? null : snapshot.activeSession;
  // A Pause or Resume that finds its session already closed for the learner
  // says how: saved (paused too long), or abandoned (left running).
  const closedForThem = async (): Promise<NovaSessionResponse | null> => {
    const how = await lastClosure(profileId);
    if (how?.kind === "abandoned") return SESSION_ABANDONED;
    if (how?.kind === "saved") return { ok: true, session: null, ended: null, autoSaved: how.saved };
    return null;
  };
  if (left && command.action !== "start") return (await closedForThem()) ?? SESSION_ABANDONED;
  const check  = checkSessionCommand(command, active);
  if (check.verdict === "reject") {
    // "Nothing is running" has a reason worth giving when the reason is that
    // the last session was closed for them.
    if (check.error === "no_active_session") { const why = await closedForThem(); if (why) return why; }
    return { ok: false, error: check.error, message: check.message };
  }
  if (check.verdict === "noop") {
    return { ok: true, session: active ? toSessionView(active, now) : null, ended: null };
  }

  let ended: Extract<NovaSessionResponse, { ok: true }>["ended"] = null;

  if (command.action === "start") {
    const subject = command.subjectName
      ? snapshot.subjects.find(s => s.name.toLowerCase() === command.subjectName!.toLowerCase())
      : undefined;
    await openStudySession(profileId, command.topicName, snapshot.subjects, now, {
      subjectId:       subject?.id ?? null,
      durationMinutes: command.plannedMinutes,
      label:           command.label ?? null,
    });
  } else if (active && command.action === "set_details") {
    await setSessionDetails(active.id, command, { topicName: active.topicName, details: await detailsOf(active.id) });
  } else if (active && command.action === "set_topic") {
    if (active.topicName) return { ok: false, error: "invalid", message: "This session is already on a topic." };
    const named = await setSessionTopic(profileId, active.id, command.subjectId, command.topicName);
    if (!named) return { ok: false, error: "invalid", message: "That isn't one of your topics." };
  } else if (active && command.action === "set_length") {
    await setSessionLength(active.id, command.minutes);
  } else if (active && command.action === "pause") {
    await pauseStudySession(active.id, now);
  } else if (active && command.action === "resume") {
    await resumeStudySession(active.id, now);
  } else if (active && command.action === "end") {
    // The End button is /done without a chat turn: same report, same evidence.
    const user = await prisma.messengerUser.findUnique({
      where:  learnerKey(platformChatId),
      select: { id: true },
    });
    if (!user) return { ok: false, error: "not_connected", message: "Connect Telegram to start with Nova." };
    // More than two hours past its plan (B.1): closed, its time waiting for the learner's word.
    const studied = Math.floor(sessionElapsedSeconds(active, now) / 60);
    if (needsTimeConfirm(studied, abandonmentPlanMinutes(active.plannedDurationMinutes))) {
      if (await closeUnconfirmed(active.id, studied, command.outcome)) {
        ended = { sessionId: active.id, topicName: active.topicName, minutes: Math.max(1, studied), outcome: command.outcome, topicRecorded: false, counted: false, needsConfirm: true };
      } else { const why = await closedForThem(); if (why) return why; }
    }
    const closed = ended ? false : await persistSessionEnd({
      userId: user.id, profileId, activeSession: active, subjects: snapshot.subjects, surface,
      outcome: command.outcome, now,
    });
    // Not closed by this call. Either it was ended elsewhere a moment ago
    // (nothing was written twice, and there is nothing new to report), or
    // the sweep abandoned it first, which the learner is told.
    if (!closed && !ended) { const why = await closedForThem(); if (why) return why; }
    if (closed) {
      ended = {
        sessionId: active.id,
        topicName: active.topicName,
        minutes:   Math.max(1, Math.floor(sessionElapsedSeconds(active, now) / 60)),
        outcome:   command.outcome,
        topicRecorded: active.subjectId !== null && Boolean(active.topicName),
        counted:       sessionElapsedSeconds(active, now) >= COUNTED_SESSION_MINUTES * 60,
      };
    }
  }

  // The writers swallow their own errors, so the result is read back rather
  // than assumed.
  const session = await loadNovaSession(platformChatId, now);
  const applied =
    command.action === "start"  ? session !== null
    : command.action === "pause"  ? session?.status === "paused"
    : command.action === "resume" ? session?.status === "in_progress"
    : command.action === "set_length" ? session !== null && session.plannedDurationMinutes === command.minutes
    : command.action === "set_topic" ? session !== null && session.id === active?.id && session.topicName !== null
    : command.action === "set_details" ? session !== null && session.id === active?.id
      && (command.category === undefined || (session.details?.category ?? null) === command.category)
      && (command.description === undefined || (session.details?.description ?? null) === command.description)
    : session === null || session.id !== active?.id;

  if (!applied) return { ok: false, error: "failed", message: "That didn't save. Try again." };
  return { ok: true, session, ended };
}

// The optional note after a session: what got done, what got in the way, the
// next step. Kept on that session, once, as the learner wrote it. It is not
// part of ending a session and changes nothing the ending recorded.
export async function saveReflection(platformChatId: string, sessionId: unknown, raw: unknown): Promise<ReflectionResponse> {
  const parsed = parseReflection(raw);
  if (!parsed.ok) {
    return parsed.reason === "empty"
      ? { ok: false, error: "empty", message: "There is nothing to save yet." }
      : { ok: false, error: "invalid", message: "That isn't a note Nova can keep. Keep each answer short." };
  }
  if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "not_found", message: "That session isn't on your record." };
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true } } },
  });
  const profileId = user?.novaAcademicProfile?.id;
  if (!profileId) return { ok: false, error: "not_connected", message: "Nova isn't set up for this account yet." };
  const result = await saveSessionNote(profileId, sessionId, JSON.stringify(parsed.reflection));
  if (result === "not_found") return { ok: false, error: "not_found", message: "That session isn't on your record." };
  return { ok: true, saved: result === "saved" };
}
