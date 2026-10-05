// ─── Signal corroboration ─────────────────────────────────────────────────────
// A regex match says a phrase appeared. Whether the student actually reported
// studying, made an excuse, or is burning out is a question of meaning, and
// the Understanding Brain owns meaning (SKILL.md §16.1).
//
// So a signal counts as established only when the Understanding Brain's
// classification of the same message independently agrees with it.
// Pure. No DB, no LLM.

import type { SignalEngineOutput, SignalType } from "../types/engine.types";
import type { AcademicUnderstanding, AcademicEmotion, AcademicIntent } from "../types/understanding.types";

const CORROBORATING_INTENTS: Partial<Record<SignalType, AcademicIntent[]>> = {
  study_report:       ["study_report"],
  study_skip:         ["study_skip_report"],
  commitment:         ["commitment_made", "accountability_request"],
  excuse:             ["excuse"],
  mastery_claim:      ["mastery_claim"],
  achievement:        ["study_report", "mastery_claim"],
  avoidance:          ["excuse"],
  burnout_behavioral: ["emotional_vent"],
  comeback:           ["commitment_made", "study_report"],
  consistency:        ["study_report", "progress_check"],
};

const CORROBORATING_EMOTIONS: Partial<Record<SignalType, AcademicEmotion[]>> = {
  achievement:        ["proud", "relieved", "motivated"],
  avoidance:          ["avoidant"],
  burnout_behavioral: ["overwhelmed", "discouraged", "distressed"],
  comeback:           ["motivated", "determined", "hopeful"],
  consistency:        ["proud", "motivated"],
  distraction:        ["frustrated", "confused", "avoidant", "overwhelmed"],
};

export function isCorroborated(signalType: SignalType, understanding: AcademicUnderstanding): boolean {
  // Asking for a break is something the student says, not a mood: it is the
  // Understanding Brain's sessionIntent, with no emotional proxy.
  if (signalType === "break_request") return understanding.sessionIntent === "break";
  return (
    statedIntents(understanding).some(i => CORROBORATING_INTENTS[signalType]?.includes(i) ?? false) ||
    (CORROBORATING_EMOTIONS[signalType]?.includes(understanding.emotion) ?? false)
  );
}

// Everything the Understanding Brain says the message states: the dominant
// intent and any secondary ones.
export function statedIntents(understanding: AcademicUnderstanding): AcademicIntent[] {
  return [understanding.intent, ...(understanding.secondaryIntents ?? [])];
}

// Intents that ARE a behavioral event.
//
// The DOMINANT intent establishes its event on the Understanding Brain's
// reading alone: no regex has to match the wording.
//
// A SECONDARY intent does not. Live testing showed the model sometimes adds a
// secondary intent the message never stated ("finals start tomorrow" read as
// also a study report). So a secondary intent only corroborates: its event
// exists when the signal engine's regex independently matched the wording too.
// Two weak sources that agree, or one strong one.
export const INTENT_SIGNALS: Partial<Record<AcademicIntent, SignalType>> = {
  study_report:      "study_report",
  study_skip_report: "study_skip",
  commitment_made:   "commitment",
  mastery_claim:     "mastery_claim",
  excuse:            "excuse",
};

export function signalsStatedByUnderstanding(understanding: AcademicUnderstanding): SignalType[] {
  const signal = INTENT_SIGNALS[understanding.intent];
  return signal ? [signal] : [];
}

// The signal engine proposes; the Understanding Brain disposes.
//
// A regex match is only a candidate. A signal is ESTABLISHED when the
// Understanding Brain's classification of the same message independently
// agrees with it, or when it was never read off the text in the first place
// (an explicit command, or the Understanding Brain's own sessionIntent).
//
// Everything downstream — the decision graph, the session engine, academic
// state scores, pattern history, consolidation evidence — sees established
// signals only. An uncorroborated regex match influences nothing.
export function establishedSignals(
  signals:       SignalEngineOutput,
  understanding: AcademicUnderstanding,
): SignalEngineOutput {
  const detectedSignals = signals.detectedSignals.filter(s =>
    s.evidence === "command" || s.evidence === "understanding" || isCorroborated(s.type, understanding),
  );
  const established = new Set<SignalType>(detectedSignals.map(s => s.type));
  return {
    detectedSignals,
    stateUpdates: signals.stateUpdates.filter(u => established.has(u.triggerSignal)),
  };
}
