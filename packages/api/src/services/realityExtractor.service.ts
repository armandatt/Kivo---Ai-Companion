// ═══════════════════════════════════════════════════════════════════════════════
// REALITY EXTRACTOR — Phase 2 of the Dynamic Reality Layer
//
// Extends Phase 1 (deterministic V2 signals) to cover life events that the
// parser cannot detect without context: burnout, travel, grief, exam pressure,
// work crises, schedule disruption.
//
// Architecture contract:
//   • async, fire-and-forget only — never blocks a user response
//   • no new categories, no new signals, no new enums
//   • writes via writeRealityFact() → same DB table, same TTL semantics
//   • only runs when UL classifies the message as a life/emotional disclosure
//   • dedup guard in writeRealityFact() prevents repeated writes within 4h
//
// Trigger: call extractAndWriteReality() after UL result is available.
// Use shouldRunExtractor() to gate — only disclosure-class messages trigger extraction.
// ═══════════════════════════════════════════════════════════════════════════════

import { generateOpenAIText } from "./openai.service";
import { writeRealityFact } from "./realityLayer.service";
import type { RealityCategory } from "./realityLayer.service";

// ── Extraction types ──────────────────────────────────────────────────────────

export interface ExtractedReality {
  category: RealityCategory;
  fact: string;
  confidence: number;
  relevanceScore: number;
  ttlHours: number;
}

// ── TTL clamps per category — LLM suggestions are clamped to these ceilings ──
const TTL_MAX: Record<RealityCategory, number> = {
  health:           72,
  injury:           336,
  emotional:        120,  // grief/burnout can persist up to 5 days
  life_constraint:  240,  // up to 10 days (travel)
  training_context: 48,
};
const TTL_MIN: Record<RealityCategory, number> = {
  health:           6,
  injury:           12,
  emotional:        12,
  life_constraint:  12,
  training_context: 4,
};

const VALID_CATEGORIES = new Set<string>(["health", "injury", "emotional", "life_constraint", "training_context"]);

// ── Trigger gate ──────────────────────────────────────────────────────────────
// Returns true when the UL result indicates a life/emotional/contextual disclosure
// that warrants LLM extraction. Must be fast — called in the synchronous path.

export function shouldRunExtractor(
  ulIntent:        string,
  ulTopic:         string,
  ulIntervention?: string | null,
  ulEmotion?:      string | null,
): boolean {
  // Intent: sharing personal/emotional state
  if (ulIntent === "emotional_expression") return true;

  // Topic: life stress is always disclosure-class
  if (ulTopic === "life_stress") return true;

  // Topic: schedule disruption (travel, exam) — not when it's just "log my session at 6am" or a motivated plan question
  if (ulTopic === "schedule" && ulIntent !== "log_activity" && ulIntent !== "log_data" && ulEmotion !== "motivated") return true;

  // Intervention: emotional distress signals from the coach model
  if (ulIntervention === "emotional_support" || ulIntervention === "burnout_support") return true;

  // Making excuses that reference life context (not purely gym laziness)
  if (ulIntent === "making_excuse" && (ulTopic === "life_stress" || ulTopic === "schedule")) return true;

  // Overwhelmed emotion on non-data messages
  if (ulEmotion === "overwhelmed" && ulIntent !== "log_activity" && ulIntent !== "log_data") return true;

  return false;
}

// ── Extraction prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract current personal realities from messages sent to a fitness accountability coach.

A "reality" is a fact about the user's current life situation that:
1. Is TRUE RIGHT NOW (not hypothetical, not past, not a plan)
2. Will likely remain true for HOURS TO DAYS (not minutes)
3. Is RELEVANT TO COACHING DECISIONS (changes what advice is appropriate)

Return ONLY valid compact JSON — a JSON array. No preamble, no markdown, no commentary.

Schema:
[
  {
    "category": "health" | "injury" | "emotional" | "life_constraint" | "training_context",
    "fact": string,
    "confidence": number,
    "relevanceScore": number,
    "ttlHours": number
  }
]

Return [] if nothing qualifies.
Maximum 3 facts. Quality over quantity — 1 precise fact beats 3 vague ones.

CATEGORIES:
  health           — current illness (fever, flu, food poisoning). NOT psychological states.
  injury           — physical injury severe enough to limit training.
  emotional        — persistent emotional state (grief, burnout, anxiety disorder, crisis). NOT brief frustration.
  life_constraint  — real-world constraint on time/access/energy (travel, exam period, work crisis, family emergency).
  training_context — training-specific state (active deload, returning from break, rest day by plan).

CONFIDENCE (0.0–1.0):
  0.95+: explicitly stated, unambiguous
  0.80–0.95: strongly implied, very likely
  0.65–0.80: probable but uncertain
  <0.65: do not include

RELEVANCE SCORE (0.0–1.0):
  0.9+: completely overrides normal training advice (grief, illness, no gym access)
  0.7–0.9: significantly constrains advice (exam week, injury, burnout)
  0.5–0.7: worth knowing but doesn't block coaching
  <0.5: do not include

TTL HOURS:
  emotional — grief/burnout: 72–120h; acute stress: 24–48h
  life_constraint — travel: 48–240h; exam week: 72–168h; work deadline: 24–96h; family emergency: 72–168h
  health — match expected illness duration: 24–72h
  injury — match expected recovery: 48–336h
  training_context — 4–48h

FACT FORMAT: concise, third-person, present tense, specific.
  GOOD: "User is grieving the death of a grandparent and experiencing disrupted sleep."
  GOOD: "User is travelling for 10 days with no access to a gym."
  GOOD: "User is in exam week with severe time pressure and poor sleep."
  BAD: "User seems stressed." (too vague — what kind, how severe, impact?)
  BAD: "User had a hard session today." (temporary, not hours-to-days)
  BAD: "User might be tired." (speculation without evidence)

MUST NOT EXTRACT:
  • Gym complaints ("that set killed me", "weights felt heavy today")
  • Temporary emotions lasting minutes ("I'm a bit annoyed", "slightly tired after work")
  • Normal training difficulty ("I struggled on squats today")
  • Jokes, sarcasm, or venting without lasting real-world impact
  • Hypothetical scenarios ("what if I had to travel for work")
  • Future plans more than 1 week out ("I might go travelling next month")
  • Rationalizations for single missed sessions without ongoing constraint
  • Anything that is not currently and persistently true`;

// ── Core extraction ───────────────────────────────────────────────────────────

export async function extractRealityFacts(text: string, _debug = false): Promise<ExtractedReality[]> {
  const dbg = (msg: string, ...args: unknown[]) => {
    if (_debug) console.error(`[extractRealityFacts] ${msg}`, ...args);
  };

  let raw: string;
  try {
    raw = await generateOpenAIText({
      systemInstruction: SYSTEM_PROMPT,
      prompt:            text,
      maxOutputTokens:   600,
      model:             "gpt-4o-mini",
    });
    dbg("raw length=%d, preview=%s", raw.length, JSON.stringify(raw.slice(0, 120)));
  } catch (err) {
    dbg("generateOpenAIText threw:", err);
    return [];
  }

  let parsed: unknown;
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    dbg("cleaned preview=%s", JSON.stringify(cleaned.slice(0, 120)));
    parsed = JSON.parse(cleaned);
  } catch (err) {
    dbg("JSON.parse failed:", err);
    return [];
  }

  if (!Array.isArray(parsed)) {
    dbg("parsed is not array, type=%s", typeof parsed);
    return [];
  }

  dbg("parsed array length=%d", parsed.length);
  const results: ExtractedReality[] = [];
  for (const item of parsed.slice(0, 3)) {
    if (typeof item !== "object" || item === null) { dbg("item not object: %s", JSON.stringify(item)); continue; }
    const { category, fact, confidence, relevanceScore, ttlHours } = item as Record<string, unknown>;

    if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) { dbg("bad category: %s", category); continue; }
    if (typeof fact !== "string" || fact.trim().length < 10) { dbg("bad fact: %s", fact); continue; }
    if (typeof confidence !== "number" || confidence < 0.65) { dbg("bad confidence: %s", confidence); continue; }
    if (typeof relevanceScore !== "number" || relevanceScore < 0.5) { dbg("bad relevanceScore: %s", relevanceScore); continue; }
    if (typeof ttlHours !== "number" || ttlHours <= 0) { dbg("bad ttlHours: %s", ttlHours); continue; }

    const cat = category as RealityCategory;
    const clampedTTL = Math.max(TTL_MIN[cat], Math.min(TTL_MAX[cat], Math.round(ttlHours)));

    results.push({
      category:       cat,
      fact:           fact.trim().slice(0, 300),
      confidence:     Math.min(1, Math.max(0, confidence)),
      relevanceScore: Math.min(1, Math.max(0, relevanceScore)),
      ttlHours:       clampedTTL,
    });
  }

  dbg("returning %d results", results.length);
  return results;
}

// ── Fire-and-forget entry point ───────────────────────────────────────────────
// Call this from the route after UL result is available. Never await.

export function extractAndWriteReality(platformChatId: string, text: string): void {
  void (async () => {
    try {
      const facts = await extractRealityFacts(text);
      for (const f of facts) {
        await writeRealityFact(platformChatId, f.category, f.fact, f.confidence, f.relevanceScore, f.ttlHours, text);
      }
      if (facts.length > 0) {
        console.log(JSON.stringify({
          ts:      new Date().toISOString(),
          layer:   "reality_extractor",
          chatId:  platformChatId,
          wrote:   facts.length,
          facts:   facts.map(f => `${f.category}(${f.confidence.toFixed(2)})`),
        }));
      }
    } catch (err) {
      console.error("[realityExtractor] extractAndWriteReality error:", err);
    }
  })();
}
