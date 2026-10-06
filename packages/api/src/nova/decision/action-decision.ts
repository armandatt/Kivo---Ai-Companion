// ─── Action decision ──────────────────────────────────────────────────────────
// The Understanding Brain says what the student meant. This says what Nova
// does about it. Pure: no DB, no LLM, no message text.
//
// A reading is a proposal. It becomes an action only when the state it
// refers to exists (a session to pause, an open question to answer) and the
// action is safe to take on the reading's confidence:
//
//   reversible, low-risk   start, pause, resume, show today, show status
//                          run when the reading is confident
//   consequential          ending a session (it writes mastery), adding an
//                          exam (it reshapes the plan)
//                          never run from a sentence: Nova asks, and the
//                          answer to that question is the confirmation
//
// It does not choose what to study or how to say it. The Planning Engine
// picks the topic; the Decision Graph picks the intervention; the Response
// Brain words it.

import type { AcademicEmotion, AcademicUnderstanding, StatedOutcome } from "../types/understanding.types";

export const EXECUTE_CONFIDENCE = 0.75;   // act on a reversible request
export const PROPOSE_CONFIDENCE = 0.5;    // offer it as buttons instead
export const AMBIGUOUS_SCORE    = 0.7;

export type TurnAction =
  | { type: "answer_prompt"; optionId: string }
  | { type: "show_today"; minutes: number | null }
  | { type: "start_session"; topic: string | null; minutes: number | null }
  | { type: "pause_session" }
  | { type: "resume_session" }
  // "How did it go?" The four answers are the only way a session ends.
  | { type: "ask_outcome"; stated: StatedOutcome | null }
  | { type: "show_status" }
  | { type: "defer"; until: "later" | "tomorrow" }
  | { type: "something_else" }
  // The student reported studying with no timer running. Nothing to end;
  // consolidation decides what the report becomes.
  | { type: "acknowledge_report" }
  | { type: "clarify" }
  // No product action. The turn is a conversation: Decision Graph, then the
  // Response Brain.
  | { type: "converse" };

export interface ActionDecision {
  action: TurnAction;
  // An exam the student named with a date. Offered for confirmation next to
  // whatever else the turn does; never added on the reading alone.
  proposeExam: { title: string; date: string } | null;
  // Whether the reply should be worded by the Response Brain. Product
  // results are stated plainly; feelings and circumstances are answered.
  generate: boolean;
  reason:   string;
}

export interface ActionContext {
  session: "running" | "paused" | "none";
  // The open question, as the model was shown it. null: none.
  prompt:  { kind: string; optionIds: string[] } | null;
}

const NEEDS_A_HUMAN_ANSWER: ReadonlySet<AcademicEmotion> = new Set<AcademicEmotion>([
  "distressed", "overwhelmed", "discouraged", "self_doubt", "identity_threat",
  "anxious_exam", "anxious_general", "frustrated",
]);

export function decideAction(understanding: AcademicUnderstanding, ctx: ActionContext): ActionDecision {
  const req = understanding.request;
  const none = (reason: string): ActionDecision =>
    ({ action: { type: "converse" }, proposeExam: null, generate: true, reason });

  // An unreadable reading proposes nothing.
  if (!req || understanding.malformed) return none("no_request_read");

  const feeling = NEEDS_A_HUMAN_ANSWER.has(understanding.emotion)
    || (understanding.realityObservations ?? []).length > 0;
  const decided = (action: TurnAction, reason: string, generate = feeling): ActionDecision =>
    ({ action, proposeExam: req.exam, generate, reason });

  const confident = req.confidence >= EXECUTE_CONFIDENCE;
  const plausible = req.confidence >= PROPOSE_CONFIDENCE;

  // ── 1. An answer to the question Nova asked ────────────────────────────────
  // Only an option that exists on the open prompt counts. The prompt is the
  // confirmation context, so a consequential option (an outcome) may run.
  if (ctx.prompt && req.promptAnswer && ctx.prompt.optionIds.includes(req.promptAnswer)) {
    return decided({ type: "answer_prompt", optionId: req.promptAnswer }, "answered_open_prompt", false);
  }
  // "make it 20" against an offer to start: the same offer, refitted. A
  // message that asks for something itself ("ok starting now, 20 mins") is
  // handled as that request below.
  if (ctx.prompt?.kind === "start" && req.availableMinutes !== null && (req.action === "none" || req.action === "what_now")) {
    return decided({ type: "show_today", minutes: req.availableMinutes }, "refit_open_offer");
  }

  // ── 2. Finishing ───────────────────────────────────────────────────────────
  const saysFinished = req.action === "finish_session" && plausible;
  if (saysFinished || (req.sessionOutcome !== null && ctx.session !== "none")) {
    return ctx.session === "none"
      ? decided({ type: "acknowledge_report" }, "report_without_session")
      : decided({ type: "ask_outcome", stated: req.sessionOutcome }, "finish_needs_outcome", false);
  }

  // ── 3. Reversible session requests ─────────────────────────────────────────
  if (req.action === "start_session" || req.action === "resume_session") {
    if (ctx.session === "paused") {
      return confident ? decided({ type: "resume_session" }, "resume_paused")
                       : decided({ type: "show_status" }, "resume_unsure");
    }
    if (ctx.session === "running") return decided({ type: "show_status" }, "already_running");
    if (req.action === "resume_session") return decided({ type: "show_today", minutes: req.availableMinutes }, "nothing_to_resume");
    return confident
      ? decided({ type: "start_session", topic: understanding.topic, minutes: req.availableMinutes }, "start_requested")
      // Not sure enough to start a timer: offer it instead.
      : decided({ type: "show_today", minutes: req.availableMinutes }, "start_unsure");
  }
  if (req.action === "pause_session") {
    return ctx.session === "running" && confident
      ? decided({ type: "pause_session" }, "pause_requested")
      : decided({ type: "show_status" }, "pause_not_applicable");
  }

  // ── 4. Questions with a plain answer ───────────────────────────────────────
  if (req.action === "what_now" && plausible) return decided({ type: "show_today", minutes: req.availableMinutes }, "asked_what_now");
  if (req.action === "status" && plausible)   return decided({ type: "show_status" }, "asked_status");
  if (req.action === "something_else" && plausible) return decided({ type: "something_else" }, "asked_for_alternative");
  if (req.action === "not_now" && plausible) {
    return decided({ type: "defer", until: req.deferUntil ?? "later" }, "declined");
  }

  // A stated amount of time with nothing else asked is a request to be told
  // what fits in it.
  if (req.availableMinutes !== null && ctx.session === "none") {
    return decided({ type: "show_today", minutes: req.availableMinutes }, "stated_time");
  }

  // ── 5. Nothing actionable ──────────────────────────────────────────────────
  if (req.exam) return decided({ type: "converse" }, "exam_mentioned", true);
  // A short reply with nothing to attach it to, or a message the model could
  // not place: ask, with buttons. Never guess.
  if (understanding.ambiguityScore >= AMBIGUOUS_SCORE && !feeling && !req.struggleTopic) {
    return decided({ type: "clarify" }, "ambiguous", false);
  }
  return decided({ type: "converse" }, "conversation", true);
}
