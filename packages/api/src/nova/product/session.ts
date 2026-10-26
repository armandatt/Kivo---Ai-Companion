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
  abandonIfStale,
  saveSessionNote,
} from "../persistence/nova-persistence";
import { parseReflection } from "./focus-context";
import type { ReflectionResponse } from "./focus-context.types";
import { checkSessionCommand, sessionElapsedSeconds, toSessionView } from "./session-view";
import { COUNTED_SESSION_MINUTES, SELF_REPORTED_ACTIVITY } from "../engines/study-session-engine";
import { ABANDONED_STATUS } from "../engines/session-clock";
import type { NovaSessionCommand, NovaSessionResponse, NovaSessionView } from "./today.types";

export async function loadNovaSession(platformChatId: string, now = new Date()): Promise<NovaSessionView | null> {
  const snapshot = await loadStudySnapshot(platformChatId);
  return snapshot.activeSession ? toSessionView(snapshot.activeSession, now) : null;
}

const SESSION_ABANDONED = {
  ok: false as const, error: "session_abandoned" as const,
  message: "That session was left open past its time, so it was closed and not counted. Start a new one when you're ready.",
};

// Whether the learner's most recent session is one that was closed as
// abandoned. False again as soon as they start another.
export async function lastSessionWasAbandoned(profileId: string): Promise<boolean> {
  const last = await prisma.novaStudySession.findFirst({
    where:   { profileId, activityType: { not: SELF_REPORTED_ACTIVITY } },
    orderBy: { createdAt: "desc" },
    select:  { status: true },
  });
  return last?.status === ABANDONED_STATUS;
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

  // An End is taken as it comes: a session that is still open is ended as a
  // session, however long it ran (persistence/nova-persistence.ts,
  // endStudySession). Any other command first closes a session that is past
  // its limit, so a Start starts afresh and a Pause or Resume has nothing
  // left to act on.
  const left   = command.action !== "end" && snapshot.activeSession !== null
    && await abandonIfStale(snapshot.activeSession.id, now).catch(() => false);
  const active = left ? null : snapshot.activeSession;
  if (left && command.action !== "start") return SESSION_ABANDONED;
  const check  = checkSessionCommand(command, active);
  if (check.verdict === "reject") {
    // "Nothing is running" has a reason worth giving when the reason is that
    // the last session was closed for them.
    if (check.error === "no_active_session" && await lastSessionWasAbandoned(profileId)) return SESSION_ABANDONED;
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
    const closed = await persistSessionEnd({
      userId: user.id, profileId, activeSession: active, subjects: snapshot.subjects, surface,
      outcome: command.outcome, now,
    });
    // Not closed by this call. Either it was ended elsewhere a moment ago
    // (nothing was written twice, and there is nothing new to report), or
    // the sweep abandoned it first, which the learner is told.
    if (!closed && await lastSessionWasAbandoned(profileId)) return SESSION_ABANDONED;
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
