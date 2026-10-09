// ─── What kind of message this is ─────────────────────────────────────────────
// One name for a reading, and the parts of the learner's record a reply to it
// needs. Pure: no DB, no LLM, no message text. Every surface uses it, so a
// message means the same thing on Telegram and on the web.
//
// The Understanding Brain fills fields; this only names the combination. It
// is derived, never asked of the model as a second classification, so the two
// cannot disagree.
//
// A kind describes. It authorises nothing: what Nova does is decided in
// decision/action-decision.ts against the session and prompt that exist.

import type { AcademicEmotion, AcademicUnderstanding } from "../types/understanding.types";

export type InteractionKind =
  | "general_question"   // about the subject matter; the same answer for anyone
  | "learner_question"   // about this learner's own plan, progress, exams or time
  | "action_request"     // asks Nova to start, pause, resume or finish, or answers its question
  | "status_request"     // asks where they stand
  | "context_signal"     // tells Nova something that shapes the plan: time, an exam, a deferral
  | "reality_signal"     // a circumstance in their life
  | "emotional_signal"   // how they feel, with nothing asked
  | "onboarding_input"   // how their term is set up: topics, usual time
  | "conversation"       // anything else that was clear
  | "unsupported"        // a clear request for something Nova does not do
  | "unclear";           // could not be read, or could not be placed

// The parts of the learner's record a reply can draw on. The context builder
// includes a part only when it is named here.
export type ContextNeed =
  | "profile" | "state" | "session" | "plan" | "topic" | "exams" | "reviews"
  | "time" | "reality" | "memory" | "patterns" | "recent";

export interface Interaction {
  kind:                InteractionKind;
  // False: the reply is correct without knowing anything about this learner.
  needsLearnerContext: boolean;
  needs:               ContextNeed[];
}

const SESSION_ACTIONS: ReadonlySet<string> = new Set([
  "start_session", "pause_session", "resume_session", "finish_session", "something_else",
]);

const HEAVY: ReadonlySet<AcademicEmotion> = new Set<AcademicEmotion>([
  "distressed", "overwhelmed", "discouraged", "self_doubt", "identity_threat",
  "anxious_exam", "anxious_general", "frustrated",
]);

export function kindOf(u: AcademicUnderstanding): InteractionKind {
  const req = u.request;
  if (!req || u.malformed) return "unclear";
  if (req.clarity === "unsupported" || req.action === "set_reminder") return "unsupported";
  const circumstance = (u.realityObservations ?? []).some(o => o.status === "active");
  // An unclear message keeps its feeling and its circumstance, and nothing else.
  if (req.clarity !== "clear") {
    if (req.clarity === "ambiguous" && circumstance) return "reality_signal";
    if (req.clarity === "ambiguous" && HEAVY.has(u.emotion)) return "emotional_signal";
    return "unclear";
  }
  if (!req.changeOfMind && (SESSION_ACTIONS.has(req.action) || req.promptAnswer !== null)) return "action_request";
  if (circumstance) return "reality_signal";
  if (HEAVY.has(u.emotion) && req.asks === "none") return "emotional_signal";
  if (req.action === "status") return "status_request";
  if (req.asks === "about_me" || req.action === "what_now") return "learner_question";
  if (req.asks === "knowledge") return "general_question";
  if (req.setup !== null) return "onboarding_input";
  if (req.availableMinutes !== null || req.exam !== null || req.deferUntil !== null || req.action === "not_now" || req.struggleTopic !== null) {
    return "context_signal";
  }
  return "conversation";
}

// Which parts of the record each kind of message can use. A general question
// uses none of it: only the last few lines of the conversation, so a
// follow-up ("and starvation?") still makes sense.
export function contextNeeds(u: AcademicUnderstanding, kind: InteractionKind = kindOf(u)): ContextNeed[] {
  const needs = new Set<ContextNeed>(["recent"]);
  const add = (...n: ContextNeed[]) => n.forEach(x => needs.add(x));
  const examInPlay = u.request?.exam != null || u.intent === "exam_anxiety" || u.emotion === "anxious_exam" || u.routingSignal === "exam_engine";

  switch (kind) {
    case "general_question":
    case "unsupported":
    case "unclear":
      break;
    case "learner_question":
      add("session", "plan", "exams", "reviews", "time", "reality");
      if (u.topic) add("topic");
      if (u.intent === "progress_check") add("state");
      break;
    case "status_request":
      add("session", "state", "exams", "reviews");
      break;
    case "action_request":
      add("session", "plan", "time");
      if (u.topic) add("topic");
      break;
    case "context_signal":
      add("session", "plan", "time");
      if (u.request?.struggleTopic || u.topic) add("topic");
      break;
    case "reality_signal":
    case "emotional_signal":
      add("session", "reality", "state", "memory", "patterns");
      break;
    case "onboarding_input":
      add("profile");
      break;
    case "conversation":
      add("profile", "session", "memory", "patterns", "state");
      if (u.topic) add("topic");
      break;
  }
  if (examInPlay && kind !== "general_question" && kind !== "unclear" && kind !== "unsupported") add("exams");
  return [...needs];
}

export function interpret(u: AcademicUnderstanding): Interaction {
  const kind  = kindOf(u);
  const needs = contextNeeds(u, kind);
  return { kind, needs, needsLearnerContext: needs.some(n => n !== "recent") };
}
