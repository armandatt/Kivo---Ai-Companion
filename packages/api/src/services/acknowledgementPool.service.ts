// ═══════════════════════════════════════════════════════════════════════════════
// ACKNOWLEDGEMENT RESPONSE POOLS — deterministic, zero LLM, zero latency.
//
// When CONVERSATION_CLOSURE fires, the route calls selectClosureContext() to
// determine which pool to draw from, then pickClosureReply() for the response.
//
// Context is derived from:
//   1. Current V2 signals (HEALTH_EVENT / INJURY_CONTEXT already on the parse)
//   2. Stored intent fields on the last 4 messages already loaded into ParseContext
//
// No DB reads. No OpenAI calls. No regex on raw assistant text.
// ═══════════════════════════════════════════════════════════════════════════════

export const CLOSURE_POOLS = {
  HEALTH:      ["Rest up.", "Recovery first.", "Take care of yourself.", "Get well soon.", "Focus on getting healthy."],
  INJURY:      ["Heal up first.", "Recovery comes first.", "Take care of that.", "Don't rush it."],
  EMOTIONAL:   ["One step at a time.", "I'm here.", "Take your time.", "You've got this.", "We'll handle it."],
  ACHIEVEMENT: ["Good work.", "Earned it.", "That's progress.", "Keep building.", "Nice work."],
  GENERAL:     ["Sounds good.", "Anytime.", "Good.", "Got it.", "Keep me posted."],
} as const

export type ClosureContext = keyof typeof CLOSURE_POOLS

// Intent values stored by the route when specific paths complete.
// Assistant messages use the same intent as the path that handled them.
const HEALTH_INTENTS  = new Set(["health_event"])
const INJURY_INTENTS  = new Set(["log_pain", "pain_report", "injury_context"])
const EMOTIONAL_INTENTS = new Set(["emotional_trigger", "mood_context", "burnout"])
const ACHIEVEMENT_INTENTS = new Set(["gym_checkin", "log_workout", "lift_log", "pr_log", "session_done"])

export function selectClosureContext(
  v2Signals:      string[],
  recentMessages: Array<{ role: string; intent?: string | null }>,
): ClosureContext {
  // Current-message signals take priority — e.g. an ack sent in the same turn as a
  // health mention ("I have a fever — thanks for the info") is extremely rare but handled.
  if (v2Signals.includes("HEALTH_EVENT"))   return "HEALTH"
  if (v2Signals.includes("INJURY_CONTEXT")) return "INJURY"

  // Fall back to stored intents from the recent exchange (last 4 messages = ~2 turns).
  // The assistant message from the previous path is always stored with its intent,
  // so health_event / gym_checkin / etc. are reliably present here.
  const recentIntents = recentMessages.slice(-4).map(m => m.intent ?? "")
  if (recentIntents.some(i => HEALTH_INTENTS.has(i)))      return "HEALTH"
  if (recentIntents.some(i => INJURY_INTENTS.has(i)))      return "INJURY"
  if (recentIntents.some(i => EMOTIONAL_INTENTS.has(i)))   return "EMOTIONAL"
  if (recentIntents.some(i => ACHIEVEMENT_INTENTS.has(i))) return "ACHIEVEMENT"

  return "GENERAL"
}

// Picks a response from the appropriate pool.
// lastReply is passed in from the per-chat dedup map in the route so consecutive
// calls for the same chat never repeat the same string.
export function pickClosureReply(context: ClosureContext, lastReply?: string): string {
  const pool = CLOSURE_POOLS[context] as readonly string[]
  const candidates = lastReply ? pool.filter(r => r !== lastReply) : [...pool]
  const source = candidates.length > 0 ? candidates : [...pool]
  return source[Math.floor(Math.random() * source.length)]!
}
