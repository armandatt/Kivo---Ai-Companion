// ─── Register ─────────────────────────────────────────────────────────────────
// HOW Nova speaks this turn. Chosen by code from facts, then handed to the
// Response Brain as one line. It never changes WHAT was decided: the
// intervention, the recommendation and the action are fixed before this runs.
// Pure. No DB, no LLM.
//
//   serious  the student is in distress, something real is constraining
//            them, or an exam is close. No jokes. This overrides what they
//            asked for: nobody is pushed hard while they are struggling.
//   then the tone they chose (product/tone.ts), when nothing above applies:
//   gentle   Gentle and supportive (or Gentle Nudges, before tones).
//   calm     Calm and practical.
//   friendly Friendly and casual.
//   direct   Direct and honest.
//   firm     Firm and accountable: holds them to what they said, no teasing.
//   playful  The no-mercy coach (or No Mercy, before tones): firm, brief, and
//            the only register allowed to tease a habit the evidence shows.
//   steady   the default, for a student who never chose. Warm and direct.
//
// The choice is the student's own (UserProfile.onboardingAnswers.tone, or
// the older UserProfile.accountabilityStyle; set in onboarding and in
// Settings). It is a manner of speaking and nothing else: the same facts,
// the same plan and the same decisions reach every register.
//
// There are no joke templates. The Response Brain owns the wording.

import type { AcademicEmotion } from "../types/understanding.types";
import type { Tone } from "../product/tone";

export type Register = "serious" | "gentle" | "calm" | "friendly" | "steady" | "direct" | "firm" | "playful";

const REGISTER_OF_TONE: Record<Tone, Register> = {
  gentle: "gentle", calm: "calm", friendly: "friendly", direct: "direct", firm: "firm", no_mercy: "playful",
};

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
  accountability:    "hard" | "soft" | null;   // the older two-way choice
  tone?:             Tone | null;              // the student's chosen tone; wins over accountability
}): Register {
  if (HEAVY_EMOTIONS.has(input.emotion)) return "serious";
  if (input.activeReality.some(c => HEAVY_REALITY.has(c))) return "serious";
  if (input.daysUntilNextExam !== null && input.daysUntilNextExam <= EXAM_SERIOUS_DAYS) return "serious";
  if (input.tone) return REGISTER_OF_TONE[input.tone];
  return input.accountability === "hard" ? "playful" : input.accountability === "soft" ? "gentle" : "steady";
}

// Every line keeps the same limits: it is a manner of speaking. None of them
// changes a fact, the plan, a safety rule or what the learner asked for.
const LINES: Record<Register, string> = {
  serious:  "Register: serious. No jokes and no teasing. Calm, plain, specific. If they said they are stressed or overwhelmed, acknowledge that in a few words first, without analysing it or reassuring at length; then give exactly one small next step, not a plan or a list. Keep the topic and the time they chose.",
  gentle:   "Register: gentle. This student asked for gentle, supportive help. Calm, supportive, never judging. Make the next step small enough to start now, and offer a realistic choice when there is one. After a missed day, make restarting easy and do not bring up the gap as a failure. No pep talk, no teasing. One clear next step.",
  calm:     "Register: calm. This student asked for calm, practical help. Even and matter-of-fact: what to do next and why, without fuss, praise or pep talk. No teasing. One clear next step.",
  friendly: "Register: friendly. This student asked for a friendly, casual manner. Relaxed and warm, plain everyday words, like a friend who knows the subject. Light humour is fine; no teasing about them or their habits. One clear next step.",
  steady:   "Register: steady. Warm and direct. No teasing.",
  direct:   "Register: direct. This student asked for direct, honest help. Get to the point in the first sentence. If something is not working, say so plainly and say what to change. No softening filler, no teasing, no harshness. One clear next step.",
  firm:     "Register: firm. This student asked to be held accountable. Firm and brief: lead with the next action, and when the evidence above shows they did not do what they said, name it plainly and ask what they will do now. No teasing, no shaming, no threats, and respect the time, energy and limits they have stated. End on one clear next step.",
  playful:  "Register: playful. This student chose the no-mercy coach: be blunt, intense and brief, and lead with the next action. If the evidence above shows an avoidable delay, name it plainly and challenge them on it; light teasing about that habit is welcome, never about them, their ability or their worth. No insults, no humiliation, no shaming, no threats, no guessing at their motives, and respect the time, energy and limits they have stated. End on one clear next step.",
};

export const registerLine = (register: Register): string => LINES[register];
