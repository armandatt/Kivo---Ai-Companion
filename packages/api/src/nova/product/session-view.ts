// ─── Session view and command rules ───────────────────────────────────────────
// Pure: no DB, no LLM. What a running session looks like to the page, and
// which session commands are valid in which state.

import type { ActiveSessionInfo } from "../engines/study-snapshot";
import type { NovaSessionCommand, NovaSessionError, NovaSessionView } from "./today.types";

export const MIN_PLANNED_MINUTES = 5;
export const MAX_PLANNED_MINUTES = 240;
const MAX_TOPIC_LENGTH = 120;

type Clocked = Pick<ActiveSessionInfo, "startedAt" | "totalPausedMinutes" | "pausedAt" | "status">;

// Study time so far. While paused the clock stands at the moment of the pause.
export function sessionElapsedSeconds(session: Clocked, now: Date): number {
  const until = session.status === "paused" && session.pausedAt ? session.pausedAt : now;
  const wall  = Math.floor((until.getTime() - session.startedAt.getTime()) / 1000);
  return Math.max(0, wall - session.totalPausedMinutes * 60);
}

export function toSessionView(session: ActiveSessionInfo, now: Date): NovaSessionView {
  return {
    id:                     session.id,
    topicName:              session.topicName,
    subjectName:            session.subjectName,
    status:                 session.status === "paused" ? "paused" : "in_progress",
    startedAt:              session.startedAt.toISOString(),
    pausedAt:               session.pausedAt?.toISOString() ?? null,
    plannedDurationMinutes: session.plannedDurationMinutes,
    elapsedSeconds:         sessionElapsedSeconds(session, now),
    serverNow:              now.toISOString(),
    pauseCount:             session.pauseCount,
    confusionPoints:        session.confusionPoints,
  };
}

// Reads an untrusted request body. Returns null when it is not a command.
export function parseSessionCommand(body: unknown): NovaSessionCommand | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (b.action === "pause" || b.action === "resume" || b.action === "end") return { action: b.action };
  if (b.action !== "start") return null;

  const topicName = typeof b.topicName === "string" ? b.topicName.trim().slice(0, MAX_TOPIC_LENGTH) : "";
  if (!topicName) return null;

  const subject = typeof b.subjectName === "string" ? b.subjectName.trim().slice(0, MAX_TOPIC_LENGTH) : "";
  const minutes = typeof b.plannedMinutes === "number" && Number.isFinite(b.plannedMinutes)
    ? Math.min(MAX_PLANNED_MINUTES, Math.max(MIN_PLANNED_MINUTES, Math.round(b.plannedMinutes)))
    : null;

  return { action: "start", topicName, subjectName: subject || null, plannedMinutes: minutes };
}

export type SessionCommandCheck =
  | { verdict: "apply" }
  // The command asks for the state the session is already in: answer with
  // the current session and write nothing.
  | { verdict: "noop" }
  | { verdict: "reject"; error: NovaSessionError; message: string };

export function checkSessionCommand(
  command: NovaSessionCommand,
  active:  Pick<ActiveSessionInfo, "status"> | null,
): SessionCommandCheck {
  if (command.action === "start") {
    // One session at a time. A second Start resumes the page on the first.
    return active ? { verdict: "noop" } : { verdict: "apply" };
  }
  if (!active) {
    return { verdict: "reject", error: "no_active_session", message: "There is no session running." };
  }
  const paused = active.status === "paused";
  if (command.action === "pause")  return paused ? { verdict: "noop" } : { verdict: "apply" };
  if (command.action === "resume") return paused ? { verdict: "apply" } : { verdict: "noop" };
  return { verdict: "apply" };   // end: valid whether running or paused
}
