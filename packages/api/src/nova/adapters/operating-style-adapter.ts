// ─── Operating Style Adapter ──────────────────────────────────────────────────
// Reads the onboarding personality signal for this student as a few behavioural
// lines for the dynamic layer. Read-only. No LLM calls.
//
// The signal is a self-reported starting hypothesis owned by the shared
// personality module. Nova does not store it, consolidate it or treat it as
// established fact (SKILL.md §11.7: evidence is not memory).
// Returns [] unless PERSONALITY_SIGNAL_ENABLED=true and the student has one.

import { getOperatingStyleForChat } from "../../personality/personality.service";

export async function loadOperatingStyle(platformChatId: string): Promise<string[]> {
  return getOperatingStyleForChat(platformChatId);
}
