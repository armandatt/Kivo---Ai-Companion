// ─── Session commands ─────────────────────────────────────────────────────────
// Start / Pause / Resume / End from the web app. The rows are written by the
// same functions a chat turn uses (persistence/nova-persistence.ts), so a
// session started on the web is the session Nova sees on Telegram, and one
// ended on the web leaves the same evidence as /done.
// Deterministic: no LLM call.

import { prisma } from "@repo/db/client";
import { loadStudySnapshot } from "../engines/study-snapshot";
import {
  openStudySession,
  pauseStudySession,
  persistSessionEnd,
  resumeStudySession,
} from "../persistence/nova-persistence";
import { checkSessionCommand, sessionElapsedSeconds, toSessionView } from "./session-view";
import type { NovaSessionCommand, NovaSessionResponse, NovaSessionView } from "./today.types";

export async function loadNovaSession(platformChatId: string, now = new Date()): Promise<NovaSessionView | null> {
  const snapshot = await loadStudySnapshot(platformChatId);
  return snapshot.activeSession ? toSessionView(snapshot.activeSession, now) : null;
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

  const active = snapshot.activeSession;
  const check  = checkSessionCommand(command, active);
  if (check.verdict === "reject") return { ok: false, error: check.error, message: check.message };
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
    });
  } else if (active && command.action === "pause") {
    await pauseStudySession(active.id, now);
  } else if (active && command.action === "resume") {
    await resumeStudySession(active.id, now);
  } else if (active && command.action === "end") {
    // The End button is /done without a chat turn: same report, same evidence.
    const user = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "not_connected", message: "Connect Telegram to start with Nova." };
    const closed = await persistSessionEnd({
      userId: user.id, profileId, activeSession: active, subjects: snapshot.subjects, surface,
      outcome: command.outcome, now,
    });
    // Not closed by this call: it was ended elsewhere a moment ago. Nothing
    // was written twice, and there is nothing new to report.
    if (closed) {
      ended = {
        topicName: active.topicName,
        minutes:   Math.max(1, Math.floor(sessionElapsedSeconds(active, now) / 60)),
        outcome:   command.outcome,
        topicRecorded: active.subjectId !== null && Boolean(active.topicName),
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
    : session === null || session.id !== active?.id;

  if (!applied) return { ok: false, error: "failed", message: "That didn't save. Try again." };
  return { ok: true, session, ended };
}
