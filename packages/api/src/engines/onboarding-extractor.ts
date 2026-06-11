// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING EXTRACTOR — OpenAI-powered conversation understanding for V3
//
// Pure function: no DB, no state mutations, no side effects.
// Takes conversation context, returns structured extraction + Rex's next reply.
// ═══════════════════════════════════════════════════════════════════════════════

import { generateOpenAIText } from "../services/openai.service";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractionField {
  value:      string;
  confidence: number;   // 0.0–1.0
}

export interface OnboardingExtraction {
  extracted:                Record<string, ExtractionField>;
  intent:                   "answer" | "question" | "request" | "frustration" | "offtopic";
  conflictDetected:         boolean;
  conflictField:            string | null;
  previousValue:            string | null;
  newValue:                 string | null;
  logicalInconsistency:     string | null;
  reply:                    string;
  nextField:                string | null;
  splitGenerationRequested: boolean;
  communicationStyle:       "fast" | "conversational" | "resistant";
  emotionalTone:            "neutral" | "frustrated" | "engaged";
  done:                     boolean;
}

const FALLBACK: OnboardingExtraction = {
  extracted:                {},
  intent:                   "answer",
  conflictDetected:         false,
  conflictField:            null,
  previousValue:            null,
  newValue:                 null,
  logicalInconsistency:     null,
  reply:                    "What's your primary training goal?",
  nextField:                "gym_goal",
  splitGenerationRequested: false,
  communicationStyle:       "conversational",
  emotionalTone:            "neutral",
  done:                     false,
};

// ── System prompt (dynamic — profile context baked in each call) ───────────────

function buildSystemPrompt(
  profile:           Record<string, string>,
  missingFields:     string[],
  stallCounts:       Record<string, number>,
  emotionalTone:     string,
  communicationStyle: string,
): string {
  const profileLines = Object.entries(profile)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n") || "  (nothing captured yet)";

  const stallLines = Object.entries(stallCounts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `  ${k}: asked ${n}x`)
    .join("\n");

  return `You are the onboarding intelligence for Rex — a direct, no-nonsense AI fitness coach.

TASK: Analyze the user message. Extract training facts. Generate Rex's next reply.
Return ONLY valid compact JSON. No markdown. No explanation outside the JSON.

CURRENT PROFILE:
${profileLines}

MISSING REQUIRED FIELDS: ${missingFields.join(", ") || "none — all required fields collected"}

COMMUNICATION STYLE: ${communicationStyle}
EMOTIONAL TONE: ${emotionalTone}
${stallLines ? `STALL COUNTS (times asked for field without answer):\n${stallLines}` : ""}

─── JSON SCHEMA (return exactly this) ────────────────────────────────────────
{
  "extracted": {
    "<fieldName>": { "value": "<normalized value>", "confidence": 0.0-1.0 }
  },
  "intent": "answer" | "question" | "request" | "frustration" | "offtopic",
  "conflictDetected": false,
  "conflictField": null,
  "previousValue": null,
  "newValue": null,
  "logicalInconsistency": null,
  "reply": "<Rex reply — 1-3 sentences>",
  "nextField": "<single most important still-missing required field, or null>",
  "splitGenerationRequested": false,
  "communicationStyle": "fast" | "conversational" | "resistant",
  "emotionalTone": "neutral" | "frustrated" | "engaged",
  "done": false
}

─── FIELD NORMALIZATION ──────────────────────────────────────────────────────
gym_goal → one of: muscle | strength | fat_loss | general_fitness | athletic_performance
  "lean bulk", "build", "get bigger", "hypertrophy", "mass", "gains" → muscle
  "lose weight", "cut", "shred", "tone", "fat loss" → fat_loss
  "get stronger", "powerlifting", "1rm", "move more weight" → strength
  "stay fit", "active", "general health", "maintenance" → general_fitness
  "sport", "athletic", "endurance", "performance" → athletic_performance

training_experience → one of: beginner | intermediate | advanced
  under 6 months, just started, new to lifting → beginner
  6 months–3 years, "1 year approx but not consistent", "about a year" → intermediate
  3+ years, "been lifting for years" → advanced
  Duration matters more than consistency level

available_training_days → number "1"–"7" as string
  "four days", "4 times a week", "train 4 days" → "4"
  "twice a week" → "2"

gym_session_time → HH:MM 24-hour
  "6pm" → "18:00" | "7:30am" → "07:30" | "morning" → "08:00"
  "noon" / "lunchtime" → "12:00" | "evening" / "after work" → "18:30"
  "night" → "20:00"

current_bodyweight_kg → kg as string (convert lbs: × 0.453592)
  "72kg" → "72" | "165lbs" → "75" | "80 kilos" → "80"

height_cm → cm as string (convert ft/in: feet×30.48 + inches×2.54)
  "178cm" → "178" | "5'11" → "180" | "5 foot 10" → "178" | "6'1" → "185"

squat_kg / bench_kg / deadlift_kg → kg as string (convert lbs if needed)

daily_protein_g → grams as string OR "not_tracking"
  "150g", "150 grams" → "150" | "not tracking", "no idea" → "not_tracking"

injury_notes → description or "none"
  "lower back pain", "bad knee" → preserve description
  "none", "all good", "no injuries", "healthy" → "none"

current_split → canonical name or user description
  "PPL", "push pull legs" → "PPL"
  "upper lower" → "Upper Lower"
  "full body" → "Full Body"
  "bro split", "body part split" → "Bro Split"
  "chest and back", "back and bis" → Custom (preserve user's description)

─── SPLIT GENERATION RULES ──────────────────────────────────────────────────
Set splitGenerationRequested=true (do NOT set current_split) for:
  "build one", "make me a split", "generate", "you pick", "you choose"
  "train two body parts per day" ← preference + generation request
  "more chest", "less legs", "more upper body" ← preference → generation
  "6 day split", "5 day split" ← also extract available_training_days

Do NOT set splitGenerationRequested for named splits the user already knows:
  "PPL", "upper lower", "full body", "bro split" → extract current_split instead

─── CONFLICT DETECTION ──────────────────────────────────────────────────────
Only flag conflict for: gym_goal, training_experience, available_training_days, current_split
→ Set conflictDetected=true, conflictField, previousValue (stored), newValue (extracted)
→ Do NOT include the conflicted field in extracted{} — ask for confirmation in reply
For name, weight, height, protein, injuries: update silently, no conflict flag

─── LOGICAL INCONSISTENCY (surface once, never block) ───────────────────────
beginner + days >= 5 → "Beginners recover better with 3–4 days. 5+ is doable but injury risk is higher."
fat_loss + protein=not_tracking → "Fat loss without protein targets usually stalls. Worth setting a number."
injury + 6-day split → note this once when split is generated

─── STALL BEHAVIOR ──────────────────────────────────────────────────────────
stall 1: normal ask
stall 2: explain why in one clause ("gym time sets when I check in on you")
stall 3: offer smart default ("I'll default to 18:00 — change it any time")

─── INTENT TYPES ────────────────────────────────────────────────────────────
answer: providing information, including approximate or hedged answers
question: asking something ("why do you need my weight?")
request: asking for something to be done ("build me a split")
frustration: "what?", "i already said", profanity + frustration, "this again?"
offtopic: unrelated to onboarding

─── COMMUNICATION STYLE ─────────────────────────────────────────────────────
fast: one-word answers, impatient phrasing, "k", "sure", "next"
resistant: explicit pushback, refuses to answer, "why does this matter"
conversational: normal sentences, engaged

─── REPLY RULES (Rex voice) ─────────────────────────────────────────────────
- 1–3 sentences for conversational, 1–2 for fast, 1 for resistant
- Acknowledge what was just captured in one brief clause ("4 days — solid.")
- Ask exactly ONE question for the next missing required field
- If frustrated: show progress ("Name and goal done. Need: experience, split, gym time.") + ONE ask
- If question: answer briefly then redirect to missing field
- If request (split gen): acknowledge + ask one more missing required field if any remain
- If offtopic: one-line redirect, no lecture
- NEVER: "Great!", "Awesome!", "Perfect!", "That's exactly right!", "Of course!", "Certainly!"
- NEVER: expose field names ("I need your training_experience")
- NEVER: ask about already-captured fields

REQUIRED FIELDS: name, gym_goal, training_experience, available_training_days, current_split, gym_session_time
OPTIONAL FIELDS: current_bodyweight_kg, height_cm, squat_kg, bench_kg, deadlift_kg, daily_protein_g, injury_notes

When ALL required fields are captured: set done=true. The handler will show the review card.`.trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractOnboardingFacts(input: {
  message:           string;
  profile:           Record<string, string>;
  missingFields:     string[];
  stallCounts:       Record<string, number>;
  history:           Array<{ role: "user" | "assistant"; text: string }>;
  emotionalTone:     string;
  communicationStyle: string;
}): Promise<OnboardingExtraction> {
  const { message, profile, missingFields, stallCounts, history, emotionalTone, communicationStyle } = input;

  const systemPrompt = buildSystemPrompt(profile, missingFields, stallCounts, emotionalTone, communicationStyle);

  const historyLines: string[] = [];
  if (history.length > 0) {
    historyLines.push("Recent conversation:");
    for (const m of history.slice(-10)) {
      historyLines.push(`  ${m.role === "user" ? "User" : "Rex"}: ${m.text.slice(0, 180)}`);
    }
    historyLines.push("");
  }
  historyLines.push(`User: ${message}`);

  const prompt = historyLines.join("\n");

  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o",
      maxOutputTokens:   600,
      systemInstruction: systemPrompt,
      prompt,
    });

    // Extract outermost JSON object from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...FALLBACK };

    const p = JSON.parse(jsonMatch[0]) as Partial<OnboardingExtraction>;

    return {
      extracted:                typeof p.extracted === "object" && p.extracted !== null ? p.extracted as Record<string, ExtractionField> : {},
      intent:                   (["answer","question","request","frustration","offtopic"] as const).includes(p.intent as never) ? p.intent! : "answer",
      conflictDetected:         p.conflictDetected     === true,
      conflictField:            typeof p.conflictField  === "string" ? p.conflictField : null,
      previousValue:            typeof p.previousValue  === "string" ? p.previousValue : null,
      newValue:                 typeof p.newValue       === "string" ? p.newValue : null,
      logicalInconsistency:     typeof p.logicalInconsistency === "string" ? p.logicalInconsistency : null,
      reply:                    typeof p.reply === "string" && p.reply.length > 0 ? p.reply : FALLBACK.reply,
      nextField:                typeof p.nextField === "string" ? p.nextField : null,
      splitGenerationRequested: p.splitGenerationRequested === true,
      communicationStyle:       (["fast","conversational","resistant"] as const).includes(p.communicationStyle as never) ? p.communicationStyle! : "conversational",
      emotionalTone:            (["neutral","frustrated","engaged"] as const).includes(p.emotionalTone as never) ? p.emotionalTone! : "neutral",
      done:                     p.done === true,
    };
  } catch {
    return { ...FALLBACK };
  }
}
