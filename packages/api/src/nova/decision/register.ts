// ─── Register ─────────────────────────────────────────────────────────────────
// HOW Nova speaks this turn. Chosen by code from facts, then handed to the
// Response Brain as one line. It never changes WHAT was decided: the
// intervention, the recommendation and the action are fixed before this runs.
// Pure. No DB, no LLM.
//
//   serious  the student is in distress, something real is constraining
//            them, or an exam is close. No jokes.
//   steady   the default. Warm and direct.
//   playful  only for a student who asked to be pushed hard, and only when
//            nothing above applies.
//
// There are no joke templates. The Response Brain owns the wording.

import type { AcademicEmotion } from "../types/understanding.types";

export type Register = "serious" | "steady" | "playful";

const HEAVY_EMOTIONS: ReadonlySet<AcademicEmotion> = new Set<AcademicEmotion>([
  "distressed", "overwhelmed", "discouraged", "self_doubt", "identity_threat",
  "anxious_exam", "anxious_general",
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
  return input.accountability === "hard" ? "playful" : "steady";
}

const LINES: Record<Register, string> = {
  serious: "Register: serious. No jokes and no teasing. Calm, plain, specific. One clear next step.",
  steady:  "Register: steady. Warm and direct. No teasing.",
  playful: "Register: playful. This student asked to be pushed hard. Light teasing about a habit the evidence above shows is welcome; never about them, their ability or their worth. Still end on one clear next step.",
};

export const registerLine = (register: Register): string => LINES[register];
