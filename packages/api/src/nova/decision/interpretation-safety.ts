// ─── Interpretation safety ────────────────────────────────────────────────────
// The Understanding Brain can be wrong, and can be confidently wrong. This is
// the one place a reading is checked before anything is allowed to rest on
// it: the action decision, and the evidence the canonical turn builds.
// Pure: no DB, no LLM, no message text.
//
// It answers one question: which parts of this reading may be used at all?
//
//   unintelligible   nothing. The reading is replaced by a neutral one, so no
//                    signal, circumstance, topic, struggle or exam can come
//                    out of noise.
//   ambiguous        the feeling and any stated circumstance (those have
//   unsupported      their own rules downstream); nothing that names an
//                    action, a time, an outcome, a struggle or an exam, and
//                    no claim that the student studied, skipped, mastered
//                    or promised anything.
//   clear            everything, after each value is checked against what is
//                    possible: an exam is in the future and inside a year.
//
// It never adds anything to a reading and never reads the message itself.

import { NO_REQUEST } from "../brains/understanding-parser";
import type { AcademicUnderstanding, LearnerRequest } from "../types/understanding.types";

// Intents that say the student did, skipped, knows or promised something.
// Each becomes evidence downstream, so each needs a message that was clear.
const STATEMENT_INTENTS: ReadonlySet<string> = new Set(["study_report", "study_skip_report", "mastery_claim", "commitment_made"]);

export const EXAM_HORIZON_DAYS = 366;
const DAY_MS = 86_400_000;

// today: the learner's local day, YYYY-MM-DD.
function examIsPlausible(exam: NonNullable<LearnerRequest["exam"]>, today: string): boolean {
  if (exam.date < today) return false;
  const span = Date.parse(`${exam.date}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`);
  return Number.isFinite(span) && span <= EXAM_HORIZON_DAYS * DAY_MS;
}

export function safeReading(reading: AcademicUnderstanding, context: { today: string }): AcademicUnderstanding {
  // Unreadable model output is handled by the caller; there is nothing here
  // to check.
  const req = reading.request;
  if (reading.malformed || !req) return reading;

  if (req.clarity === "unintelligible") {
    return {
      intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
      disclosureClass: "none", ambiguityScore: 1, routingSignal: "coaching_only",
      rawText: reading.rawText, secondaryIntents: [], sessionIntent: "none",
      realityObservations: [],
      request: { ...NO_REQUEST, clarity: "unintelligible" },
    };
  }

  if (req.clarity !== "clear") {
    // A message the model could not place is not a statement that the
    // student studied, skipped, mastered or promised something.
    const states = (intent: string) => STATEMENT_INTENTS.has(intent);
    return {
      ...reading,
      intent:           states(reading.intent) ? "general_chat" : reading.intent,
      secondaryIntents: (reading.secondaryIntents ?? []).filter(i => !states(i)),
      sessionIntent: "none",
      request: { ...NO_REQUEST, clarity: req.clarity, changeOfMind: req.changeOfMind, promptAnswer: req.promptAnswer },
    };
  }

  return {
    ...reading,
    request: { ...req, exam: req.exam && examIsPlausible(req.exam, context.today) ? req.exam : null },
  };
}
