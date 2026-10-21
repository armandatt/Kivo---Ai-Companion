// ─── Tone: how the learner asked Nova to talk to them ─────────────────────────
// Six answers to "How should Nova talk to you?". Each is one manner of
// speaking, worded by one fixed register line (decision/register.ts). Tone
// changes wording only: the same facts, plan, decisions and safety rules
// reach every tone, and a message asking for something else wins.
//
// Stored at UserProfile.onboardingAnswers.tone. The older two-way answer
// (UserProfile.accountabilityStyle: "soft" / "hard") is kept in step for
// the readers that still use it (Rex, mentor matching), and read as a tone
// for accounts that never chose one.
//
// Pure, no imports, so the web app renders from it.

export const TONES = ["gentle", "calm", "friendly", "direct", "firm", "no_mercy"] as const;
export type Tone = (typeof TONES)[number];

export const TONE_OPTIONS: ReadonlyArray<{ value: Tone; label: string; hint: string }> = [
  { value: "gentle",   label: "Gentle and supportive", hint: "Kind and patient. Small steps, and no pressure after a missed day." },
  { value: "calm",     label: "Calm and practical",    hint: "Even and matter-of-fact. What to do next, without fuss." },
  { value: "friendly", label: "Friendly and casual",   hint: "Relaxed and warm, like talking to a friend who gets it." },
  { value: "direct",   label: "Direct and honest",     hint: "Straight to the point. Says plainly what isn't working." },
  { value: "firm",     label: "Firm and accountable",  hint: "Holds you to what you said you'd do, and asks about it." },
  { value: "no_mercy", label: "No-mercy coach",        hint: "Blunt, intense and challenging. Never insulting." },
];

export const isTone = (value: unknown): value is Tone => typeof value === "string" && (TONES as readonly string[]).includes(value);

// The older two-way answer this tone keeps in step. null: neither.
export function accountabilityOfTone(tone: Tone): "soft" | "hard" | null {
  return tone === "gentle" ? "soft" : tone === "firm" || tone === "no_mercy" ? "hard" : null;
}

// An account that chose before tones existed: Gentle Nudges is gentle, No
// Mercy is the no-mercy coach, as their register always was.
export function toneOfAccountability(style: "soft" | "hard" | null): Tone | null {
  return style === "soft" ? "gentle" : style === "hard" ? "no_mercy" : null;
}
