// ─── Session view and command rules ───────────────────────────────────────────
// Pure: no DB, no LLM. What a running session looks like to the page, and
// which session commands are valid in which state.

import type { ActiveSessionInfo } from "../engines/study-snapshot";
import { sessionElapsedSeconds } from "../engines/session-clock";
import { SESSION_OUTCOMES } from "../engines/study-session-engine";
import type { NovaSessionCommand, NovaSessionError, NovaSessionView } from "./today.types";

export { sessionElapsedSeconds };

export const MIN_PLANNED_MINUTES = 5;
export const MAX_PLANNED_MINUTES = 240;
const MAX_TOPIC_LENGTH = 120;
const MAX_LABEL_LENGTH = 160;

export function toSessionView(session: ActiveSessionInfo, now: Date): NovaSessionView {
  return {
    id:                     session.id,
    topicName:              session.topicName,
    subjectName:            session.subjectName,
    status:                 session.status === "paused" ? "paused" : "in_progress",
    startedAt:              session.startedAt.toISOString(),
    pausedAt:               session.pausedAt?.toISOString() ?? null,
    plannedDurationMinutes: session.plannedDurationMinutes,
    untimed:                session.untimed === true,
    label:                  session.currentFocus ?? null,
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

  if (b.action === "pause" || b.action === "resume") return { action: b.action };
  if (b.action === "set_length") {
    const m = b.minutes;
    if (m === 0) return { action: "set_length", minutes: 0 };
    return typeof m === "number" && Number.isInteger(m) && m >= MIN_PLANNED_MINUTES && m <= MAX_PLANNED_MINUTES ? { action: "set_length", minutes: m } : null;
  }
  if (b.action === "end") {
    // Anything that is not one of the four answers is "no answer".
    const outcome = SESSION_OUTCOMES.find(o => o === b.outcome) ?? null;
    return { action: "end", outcome };
  }
  if (b.action !== "start") return null;

  const topicName = typeof b.topicName === "string" ? b.topicName.trim().slice(0, MAX_TOPIC_LENGTH) : "";
  // A session on something that is not a topic carries its words as a label.
  const label = typeof b.label === "string" ? b.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
  if (!topicName && !label) return null;

  const subject = typeof b.subjectName === "string" ? b.subjectName.trim().slice(0, MAX_TOPIC_LENGTH) : "";
  // No time limit, chosen: 0. A length given: within the bounds.
  const minutes = b.untimed === true || b.plannedMinutes === 0 ? 0
    : typeof b.plannedMinutes === "number" && Number.isFinite(b.plannedMinutes)
    ? Math.min(MAX_PLANNED_MINUTES, Math.max(MIN_PLANNED_MINUTES, Math.round(b.plannedMinutes)))
    : null;

  return { action: "start", topicName: topicName || null, subjectName: topicName && subject ? subject : null, plannedMinutes: minutes, label: label || null };
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
  if (command.action === "set_length") return { verdict: "apply" };
  return { verdict: "apply" };   // end: valid whether running or paused
}
