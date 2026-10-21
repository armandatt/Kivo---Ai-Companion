// ─── Operating Style Adapter ──────────────────────────────────────────────────
// Reads how this learner wants to be helped as a few behavioural lines for the
// dynamic layer. Read-only. No LLM calls.
//
// Two sources, both owned by the shared personality module:
//   • stated preferences (kivo-style-v2): the learner's own answers to the
//     onboarding questions, changeable in Settings. Always used when present.
//   • the v1 personality signal: a self-reported starting hypothesis, used
//     only while PERSONALITY_SIGNAL_ENABLED=true.
// Nova does not store, consolidate or treat either as established fact
// (SKILL.md §11.7: evidence is not memory). Both shape wording only.

import { getCoachingStyleForChat, getAccountabilityForChat } from "../../personality/personality.service";
import { loadVoicePreferences } from "./account-preferences-adapter";
import type { Tone } from "../product/tone";

// How hard the student asked to be pushed, in their own onboarding answer.
// null: they did not say.
export async function loadAccountabilityStyle(platformChatId: string): Promise<"hard" | "soft" | null> {
  return getAccountabilityForChat(platformChatId).catch(() => null);
}

// The tone they chose (product/tone.ts), or the one their older soft/hard
// answer stands for. null: neither. It is a manner of speaking only.
export async function loadTone(platformChatId: string): Promise<Tone | null> {
  return (await loadVoicePreferences(platformChatId).catch(() => ({ tone: null }))).tone;
}

// The lines, and whether they are the learner's stated preferences (true) or
// the v1 signal's hypothesis (false). Empty: nothing to say.
export async function loadCoachingStyle(platformChatId: string): Promise<{ lines: string[]; stated: boolean }> {
  return getCoachingStyleForChat(platformChatId);
}

export async function loadOperatingStyle(platformChatId: string): Promise<string[]> {
  return (await loadCoachingStyle(platformChatId)).lines;
}
