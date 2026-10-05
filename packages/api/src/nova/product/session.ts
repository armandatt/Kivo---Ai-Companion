// ─── Session commands ─────────────────────────────────────────────────────────
// Start / Pause / Resume / End from the web app. The rows are written by the
// same functions a chat turn uses (persistence/nova-persistence.ts), so a
// session started on the web is the session Nova sees on Telegram.
// Deterministic: no LLM call.

import { loadStudySnapshot } from "../engines/study-snapshot";
import { buildSessionContext } from "../engines/study-session-engine";
import {
  endStudySession,
  openStudySession,
  pauseStudySession,
  resumeStudySession,
} from "../persistence/nova-persistence";
import { checkSessionCommand, sessionElapsedSeconds, toSessionView } from "./session-view";
import type { NovaSessionCommand, NovaSessionResponse, NovaSessionView } from "./today.types";

// What a session-end counts for when the student has not said how it went.
// The same default a chat turn uses.
const DEFAULT_REPORTED_CONFIDENCE = 0.6;
const NEUTRAL_MASTERY_ESTIMATE    = 0.5;

export async function loadNovaSession(platformChatId: string, now = new Date()): Promise<NovaSessionView | null> {
  const snapshot = await loadStudySnapshot(platformChatId);
  return snapshot.activeSession ? toSessionView(snapshot.activeSession, now) : null;
}

export async function runNovaSessionCommand(
  platformChatId: string,
  command:        NovaSessionCommand,
  now = new Date(),
): Promise<NovaSessionResponse> {
  const snapshot = await loadStudySnapshot(platformChatId);
  const profileId = snapshot.profileId;
  if (!profileId) {
    return { ok: false, error: "onboarding_incomplete", message: "Finish setting up with Nova first." };
  }

  const active = snapshot.activeSession;
  const check  = checkSessionCommand(command, active);
  if (check.verdict === "reject") return { ok: false, error: check.error, message: check.message };
  if (check.verdict === "noop") {
    return { ok: true, session: active ? toSessionView(active, now) : null, ended: null };
  }

  let ended: { topicName: string | null; minutes: number } | null = null;

  if (command.action === "start") {
    const subject = command.subjectName
      ? snapshot.subjects.find(s => s.name.toLowerCase() === command.subjectName!.toLowerCase())
      : undefined;
    await openStudySession(profileId, command.topicName, snapshot.subjects, now, {
      subjectId:       subject?.id ?? null,
      durationMinutes: command.plannedMinutes,
    });
  } else if (active && command.action === "pause") {
    await pauseStudySession(active.id, now);
  } else if (active && command.action === "resume") {
    await resumeStudySession(active.id, now);
  } else if (active && command.action === "end") {
    // Time spent in a pause that is still open does not count as study time.
    const openPause = active.status === "paused" && active.pausedAt
      ? Math.max(0, Math.floor((now.getTime() - active.pausedAt.getTime()) / 60_000))
      : 0;
    const closing = { ...active, totalPausedMinutes: active.totalPausedMinutes + openPause };
    const context = buildSessionContext(closing, NEUTRAL_MASTERY_ESTIMATE, now, profileId);
    await endStudySession(active.id, context, DEFAULT_REPORTED_CONFIDENCE, snapshot.subjects, now);
    ended = {
      topicName: active.topicName,
      minutes:   Math.max(1, Math.floor(sessionElapsedSeconds(active, now) / 60)),
    };
  }

  // The writers swallow their own errors, so the result is read back rather
  // than assumed.
  const session = await loadNovaSession(platformChatId, now);
  const applied =
    command.action === "start"  ? session !== null
    : command.action === "pause"  ? session?.status === "paused"
    : command.action === "resume" ? session?.status === "in_progress"
    : session === null || session.id !== active?.id;

  if (!applied) return { ok: false, error: "failed", message: "That didn't save. Try again." };
  return { ok: true, session, ended };
}
