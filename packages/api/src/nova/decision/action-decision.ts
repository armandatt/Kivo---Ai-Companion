// ─── Action decision ──────────────────────────────────────────────────────────
// The Understanding Brain says what the student probably meant. This says
// what Nova is allowed to do about it. Pure: no DB, no LLM, no message text.
//
// A reading is a proposal, and the model's confidence in it is not
// permission. Every action that changes state has preconditions that the
// reading and the real state must BOTH satisfy; a confident reading that
// fails them becomes an offer or a question, never the action.
//
//   start a session     an explicit start request AND a named topic, with no
//                       session open; or the learner's answer to a Start
//                       option. Time alone, a topic alone and a bare "let's
//                       go" are offered, not started.
//   pause / resume      an explicit request AND a session in the matching
//                       state.
//   end a session       never from a sentence. A finishing statement while a
//                       session is open asks "How did it go?"; the answer to
//                       that question is what ends it.
//   add an exam         never from a sentence. It is offered; the Add option
//                       is what adds it.
//   pause nudges        an explicit "not today".
//   record stated time  minutes stated in a clear message, no session open.
//   change an offer     minutes stated while a Start offer is open re-offer
//                       it at that length. Changing a proposal is not
//                       accepting it.
//
// Nothing that changes state runs when the reading is not clear, or when the
// message takes back what it asks for (changeOfMind).
//
// It does not choose what to study or how to say it. The Planning Engine
// picks the topic; the Decision Graph picks the intervention; the Response
// Brain words it.

import type { AcademicEmotion, AcademicIntent, AcademicUnderstanding, StatedOutcome } from "../types/understanding.types";

// A floor under an explicit request, never a sufficient reason to act.
export const EXECUTE_CONFIDENCE = 0.75;
export const PROPOSE_CONFIDENCE = 0.5;
export const AMBIGUOUS_SCORE    = 0.7;

export type TurnAction =
  | { type: "answer_prompt"; optionId: string }
  | { type: "show_today"; minutes: number | null }
  // A start that was asked for but may not run on words alone: shown with
  // Start buttons instead.
  | { type: "offer_start"; topic: string | null; minutes: number | null }
  | { type: "start_session"; topic: string; minutes: number | null }
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
  // A clear request for something Nova does not do in this chat.
  | { type: "unsupported" }
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

export interface PromptOptionFact {
  id:      string;
  type:    string;          // the stored option's action type
  minutes: number | null;   // for a start option, its length
}

export interface ActionContext {
  session: "running" | "paused" | "none";
  // The open question, from Nova's own record of it. null: none.
  prompt:  { kind: string; options: PromptOptionFact[] } | null;
}

const NEEDS_A_HUMAN_ANSWER: ReadonlySet<AcademicEmotion> = new Set<AcademicEmotion>([
  "distressed", "overwhelmed", "discouraged", "self_doubt", "identity_threat",
  "anxious_exam", "anxious_general", "frustrated",
]);

const OFFERS_A_START: ReadonlySet<string> = new Set(["start", "nudge"]);

export function decideAction(understanding: AcademicUnderstanding, ctx: ActionContext): ActionDecision {
  const req = understanding.request;
  const none = (reason: string): ActionDecision =>
    ({ action: { type: "converse" }, proposeExam: null, generate: true, reason });

  // An unreadable reading proposes nothing.
  if (!req || understanding.malformed) return none("no_request_read");

  // Noise is answered with a question. Nothing in it is used.
  if (req.clarity === "unintelligible") {
    return { action: { type: "clarify" }, proposeExam: null, generate: false, reason: "unintelligible" };
  }

  // Only a clear reading carries values that anything may rest on.
  const clear    = req.clarity === "clear";
  const minutes  = clear ? req.availableMinutes : null;
  const outcome  = clear ? req.sessionOutcome : null;
  const struggle = clear ? req.struggleTopic : null;
  const asked    = clear ? req.action : "none";
  // A request that may change state: clear, not taken back, and the model at
  // least sure of it. Necessary for every state change below, sufficient for
  // none of them.
  const explicit = (action: typeof asked) =>
    asked === action && !req.changeOfMind && req.confidence >= EXECUTE_CONFIDENCE;
  const plausible = req.confidence >= PROPOSE_CONFIDENCE;
  const says = (intent: AcademicIntent) =>
    understanding.intent === intent || (understanding.secondaryIntents ?? []).includes(intent);

  const feeling = NEEDS_A_HUMAN_ANSWER.has(understanding.emotion)
    || (understanding.realityObservations ?? []).length > 0;
  const decided = (action: TurnAction, reason: string, generate = feeling): ActionDecision =>
    ({ action, proposeExam: clear ? req.exam : null, generate, reason });

  if (req.clarity === "unsupported") return decided({ type: "unsupported" }, "unsupported_request", false);

  const prompt     = ctx.prompt;
  const startOffer = prompt !== null && OFFERS_A_START.has(prompt.kind);
  const chosen     = prompt && req.promptAnswer ? prompt.options.find(o => o.id === req.promptAnswer) ?? null : null;
  // The one way words alone start a session.
  const startByName = explicit("start_session") && understanding.topic !== null && ctx.session === "none";

  // ── 1. An answer to the question Nova asked ────────────────────────────────
  // Only an option that exists on the open prompt counts, and only from a
  // clear message that does not take itself back. The prompt is the
  // confirmation context, so a consequential option (an outcome, an exam)
  // may run.
  if (chosen && clear && !req.changeOfMind) {
    // A length the chosen option does not carry changes the offer.
    if (startOffer && minutes !== null && !(chosen.type === "start" && chosen.minutes === minutes)) {
      return decided({ type: "show_today", minutes }, "offer_changed");
    }
    // "Not today" is more than "Later": it quiets Nova for the day.
    if (asked === "not_now" && req.deferUntil === "tomorrow" && chosen.type === "later") {
      return decided({ type: "defer", until: "tomorrow" }, "declined_for_today");
    }
    return decided({ type: "answer_prompt", optionId: chosen.id }, "answered_open_prompt", false);
  }

  // ── 2. A changed proposal ──────────────────────────────────────────────────
  // "make it 20" against an offer to start: the same offer at that length.
  // Nothing starts. Only a start that names its topic is a request of its own.
  if (startOffer && minutes !== null && !startByName) {
    return decided({ type: "show_today", minutes }, "offer_changed");
  }

  // ── 3. Finishing, said outright ────────────────────────────────────────────
  const openSession = ctx.session !== "none";
  if (openSession && !req.changeOfMind && asked === "finish_session") {
    return decided({ type: "ask_outcome", stated: outcome }, "finish_needs_outcome", false);
  }
  if (!openSession && asked === "finish_session" && plausible) {
    return decided({ type: "acknowledge_report" }, "report_without_session");
  }

  // ── 4. Session requests ────────────────────────────────────────────────────
  if (asked === "start_session" || asked === "resume_session") {
    if (ctx.session === "paused") {
      return explicit(asked) ? decided({ type: "resume_session" }, "resume_paused")
                             : decided({ type: "show_status" }, "resume_not_explicit");
    }
    if (ctx.session === "running") return decided({ type: "show_status" }, "already_running");
    if (asked === "resume_session") return decided({ type: "show_today", minutes }, "nothing_to_resume");
    return startByName
      ? decided({ type: "start_session", topic: understanding.topic!, minutes }, "start_named_topic")
      // Asked to start, but not with enough to start on: offer it.
      : decided({ type: "offer_start", topic: req.changeOfMind ? null : understanding.topic, minutes }, "start_needs_confirmation");
  }
  if (asked === "pause_session") {
    return ctx.session === "running" && explicit("pause_session")
      ? decided({ type: "pause_session" }, "pause_requested")
      : decided({ type: "show_status" }, "pause_not_applicable");
  }

  // ── 5. Finishing, reported ─────────────────────────────────────────────────
  // "I finished deadlocks" read as a study report with no request attached.
  // With a session open, that is the session: ask how it went. Asking writes
  // nothing, so it needs no more than the report. A feeling about the topic
  // with no report ("I keep messing this up") is not a finish.
  if (openSession && !req.changeOfMind && clear && says("study_report")) {
    return decided({ type: "ask_outcome", stated: outcome }, "report_during_session", false);
  }

  // ── 6. Requests that change nothing, or only Nova's own nudging ────────────
  if (asked === "what_now" && plausible) return decided({ type: "show_today", minutes }, "asked_what_now");
  if (asked === "status" && plausible)   return decided({ type: "show_status" }, "asked_status");
  if (asked === "something_else" && plausible) return decided({ type: "something_else" }, "asked_for_alternative");
  if (asked === "not_now" && plausible) {
    return decided({ type: "defer", until: req.deferUntil === "tomorrow" && !req.changeOfMind ? "tomorrow" : "later" }, "declined");
  }

  // A stated amount of time with nothing else asked is a request to be told
  // what fits in it. It is recorded for the day; it starts nothing.
  if (minutes !== null && !openSession) {
    return decided({ type: "show_today", minutes }, "stated_time");
  }

  // ── 7. Nothing actionable ──────────────────────────────────────────────────
  if (clear && req.exam) return decided({ type: "converse" }, "exam_mentioned", true);
  // A short reply with nothing to attach it to, or a message the model could
  // not place: ask, with buttons. Never guess.
  const unclear = req.clarity === "ambiguous" || understanding.ambiguityScore >= AMBIGUOUS_SCORE;
  if (unclear && !feeling && !struggle) return decided({ type: "clarify" }, "ambiguous", false);
  return decided({ type: "converse" }, "conversation", true);
}
