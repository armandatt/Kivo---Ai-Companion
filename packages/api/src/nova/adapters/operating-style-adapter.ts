// ─── Operating Style Adapter ──────────────────────────────────────────────────
// Reads the onboarding personality signal for this student as a few behavioural
// lines for the dynamic layer. Read-only. No LLM calls.
//
// The signal is a self-reported starting hypothesis owned by the shared
// personality module. Nova does not store it, consolidate it or treat it as
// established fact (SKILL.md §11.7: evidence is not memory).
// Returns [] unless PERSONALITY_SIGNAL_ENABLED=true and the student has one.

import { getOperatingStyleForChat, getAccountabilityForChat } from "../../personality/personality.service";

// How hard the student asked to be pushed, in their own onboarding answer.
// null: they did not say.
export async function loadAccountabilityStyle(platformChatId: string): Promise<"hard" | "soft" | null> {
  return getAccountabilityForChat(platformChatId).catch(() => null);
}

export async function loadOperatingStyle(platformChatId: string): Promise<string[]> {
  return getOperatingStyleForChat(platformChatId);
}
