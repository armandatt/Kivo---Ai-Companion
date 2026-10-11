// ─── Register ─────────────────────────────────────────────────────────────────
// HOW Nova speaks this turn. Chosen by code from facts, then handed to the
// Response Brain as one line. It never changes WHAT was decided: the
// intervention, the recommendation and the action are fixed before this runs.
// Pure. No DB, no LLM.
//
//   serious  the student is in distress, something real is constraining
//            them, or an exam is close. No jokes. This overrides what they
//            asked for: nobody is pushed hard while they are struggling.
//   gentle   they chose Gentle Nudges in onboarding, and nothing above applies.
//   steady   the default, for a student who never chose. Warm and direct.
//   playful  they chose No Mercy, and nothing above applies: firm, brief,
//            and allowed to tease a habit the evidence shows.
//
// The choice is the student's own (UserProfile.accountabilityStyle, set in
// onboarding and in Settings). It is a manner of speaking and nothing else:
// the same facts, the same plan and the same decisions reach every register.
//
// There are no joke templates. The Response Brain owns the wording.

import type { AcademicEmotion } from "../types/understanding.types";

export type Register = "serious" | "gentle" | "steady" | "playful";

const HEAVY_EMOTIONS: ReadonlySet<AcademicEmotion> = new Set<AcademicEmotion>([
  "distressed", "overwhelmed", "discouraged", "self_doubt", "identity_threat",
  "anxious_exam", "anxious_general",
  // Someone fed up with a topic is not in the mood to be teased about it.
  "frustrated",
]);

// Circumstances in which teasing is out of place whatever the student asked for.
const HEAVY_REALITY: ReadonlySet<string> = new Set(["health", "injury", "emotional", "life_constraint"]);

export const EXAM_SERIOUS_DAYS = 3;

export function chooseRegister(input: {
  emotion:           AcademicEmotion;
  daysUntilNextExam: number | null;
  activeReality:     string[];                 // categories of active reality facts
  accountability:    "hard" | "soft" | null;   // the student's explicit choice
}): Register {
  if (HEAVY_EMOTIONS.has(input.emotion)) return "serious";
  if (input.activeReality.some(c => HEAVY_REALITY.has(c))) return "serious";
  if (input.daysUntilNextExam !== null && input.daysUntilNextExam <= EXAM_SERIOUS_DAYS) return "serious";
  return input.accountability === "hard" ? "playful" : input.accountability === "soft" ? "gentle" : "steady";
}

const LINES: Record<Register, string> = {
  serious: "Register: serious. No jokes and no teasing. Calm, plain, specific. If they said they are stressed or overwhelmed, acknowledge that in a few words first, without analysing it or reassuring at length; then give exactly one small next step, not a plan or a list. Keep the topic and the time they chose.",
  gentle:  "Register: gentle. This student chose Gentle Nudges. Calm, supportive, never judging. Make the next step small enough to start now, and offer a realistic choice when there is one. After a missed day, make restarting easy and do not bring up the gap as a failure. No pep talk, no teasing. One clear next step.",
  steady:  "Register: steady. Warm and direct. No teasing.",
  playful: "Register: playful. This student chose No Mercy: be direct, firm and brief, and lead with the next action. If the evidence above shows an avoidable delay, name it plainly; light teasing about that habit is welcome, never about them, their ability or their worth. No shaming, no threats, no guessing at their motives, and respect the time, energy and limits they have stated. End on one clear next step.",
};

export const registerLine = (register: Register): string => LINES[register];
