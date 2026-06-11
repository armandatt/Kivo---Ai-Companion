import { generateOpenAIText } from "../services/openai.service";

// ═══════════════════════════════════════════════════════════════════════════════
// UNDERSTANDING LAYER V1
//
// Runs in parallel with Parser V2. Pure analysis — no DB writes, no state
// mutations, no side effects. Returns structured understanding of a message
// for comparison logging and eventual migration to primary routing.
//
// V1 goal: run on every message, log output alongside Parser V2, build a
// dataset of divergence cases to inform the migration plan.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Input / Output types ──────────────────────────────────────────────────────

export interface ULMessage {
  role: "user" | "assistant";
  text: string;
}

export interface UnderstandingInput {
  message:        string;
  recentMessages: ULMessage[];  // last N turns (most recent last)
  profileSummary?: string;      // compact string from buildProfileSummary()
}

export interface UnderstandingResult {
  intent:                 string;
  emotion:                string;
  topic:                  string;
  confidence:             number;
  extractedFacts:         Record<string, unknown>;
  needsAdvice:            boolean;
  needsAction:            boolean;
  reasoning:              string;
  suggestedIntervention?: string;  // coaching intervention type for the semantic router
  durationMs:             number;  // wall-clock time for the LLM call
}

// ── Intent / emotion / topic vocabularies ────────────────────────────────────

export const UL_INTENTS = [
  "log_activity",       // user reporting a completed workout, session, or task
  "log_missed",         // user reporting they skipped or failed to train
  "log_data",           // providing body measurement, lift number, or nutrition data
  "seeking_guidance",   // asking for advice, a plan, or recommendations
  "asking_question",    // specific factual question about training or nutrition
  "emotional_expression", // sharing feelings, stress, anxiety, excitement
  "making_commitment",  // declaring an intention or plan for the future
  "requesting_check_in", // asking to be followed up later
  "seeking_validation", // wanting confirmation their approach is right
  "making_excuse",      // rationalizing a miss with a reason
  "requesting_help",    // needs immediate assistance or has a problem
  "general_chat",       // casual conversation, no fitness-specific intent
] as const;

export const UL_EMOTIONS = [
  "motivated", "frustrated", "anxious", "proud", "defeated",
  "tired", "energized", "neutral", "overwhelmed", "resilient", "uncertain",
] as const;

export const UL_TOPICS = [
  "training", "nutrition", "recovery", "life_stress", "progress",
  "injury", "motivation", "schedule", "goals", "other",
] as const;

export const INTERVENTION_TYPES = [
  "address_excuse",      // challenge a rationalized miss
  "validate_effort",     // affirm effort and redirect forward
  "anchor_commitment",   // make a declared intention concrete
  "emotional_support",   // acknowledge difficult emotions first
  "burnout_support",     // zero pressure, give permission to rest
  "self_doubt_reframe",  // surface a specific past win as counter-evidence
  "challenge_avoidance", // surface the avoidance pattern, ask the real obstacle
  "coach_engagement",    // standard coaching response
] as const;

export type ULIntent       = (typeof UL_INTENTS)[number];
export type ULEmotion      = (typeof UL_EMOTIONS)[number];
export type ULTopic        = (typeof UL_TOPICS)[number];
export type ULIntervention = (typeof INTERVENTION_TYPES)[number];

// ── LLM prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You analyze messages from users of a fitness accountability coaching app.
The AI coach is Rex — a direct, no-nonsense strength coach.
Users are working on fitness goals: muscle, strength, fat loss, general fitness.

Return ONLY valid compact JSON. No preamble, no markdown.

Schema:
{
  "intent": string,
  "emotion": string,
  "topic": string,
  "confidence": number,
  "extractedFacts": {},
  "needsAdvice": boolean,
  "needsAction": boolean,
  "reasoning": string,
  "suggestedIntervention": string | null
}

INTENT — pick exactly one:
  log_activity       user reporting a completed workout, session, or task
  log_missed         user reporting they skipped or failed to train
  log_data           user providing a number (body weight, lift, protein intake, energy)
  seeking_guidance   asking for advice, a plan, or what they should do
  asking_question    specific factual question about training or nutrition
  emotional_expression sharing feelings, stress, anxiety, excitement, frustration
  making_commitment  declaring an intention or plan for the future
  requesting_check_in asking to be followed up later
  seeking_validation wanting confirmation their approach is right
  making_excuse      rationalizing a miss with a reason (genuine or not)
  requesting_help    needs immediate assistance or has a specific problem
  general_chat       casual conversation, no fitness-specific intent

EMOTION — pick exactly one:
  motivated, frustrated, anxious, proud, defeated, tired, energized,
  neutral, overwhelmed, resilient, uncertain

TOPIC — pick exactly one:
  training, nutrition, recovery, life_stress, progress,
  injury, motivation, schedule, goals, other

confidence: 0.0–1.0 reflecting certainty in the intent classification.

extractedFacts: only include keys with actual evidence in the message.
  Examples:
  { "workoutCompleted": true, "exercise": "bench press", "setsReps": "4x8", "weightKg": 80 }
  { "sessionMissed": true, "reason": "work stress" }
  { "bodyweightKg": 82.5 }
  { "proteinGrams": 160 }
  { "goalMentioned": "run a 5k", "timeline": "next month" }
  { "injuryArea": "lower back", "severity": "mild" }
  { "prSet": true, "exercise": "squat", "weightKg": 140 }
  { "emotionalTrigger": "relationship stress", "impactOnTraining": true }

needsAdvice: true when the user is asking for guidance or recommendations.
needsAction: true when the message should trigger a system action (log data, schedule something).

reasoning: one brief sentence explaining your classification.

suggestedIntervention: pick the most relevant coaching response type, or null if none applies.
  address_excuse      — user is rationalizing a miss; the excuse needs to be challenged
  validate_effort     — user wants approval; affirm briefly then redirect to action
  anchor_commitment   — user declared intent; make it concrete with a specific question
  emotional_support   — user is sharing difficult emotions; acknowledge before anything else
  burnout_support     — fatigue or burnout signals; zero pressure, give permission to rest
  self_doubt_reframe  — user doubts their ability; surface one specific past win
  challenge_avoidance — user is softening around a hard thing; name the pattern
  coach_engagement    — standard coaching conversation; none of the above apply
  null                — no coaching intervention needed (data log, question, etc.)`;

// ── Main function ─────────────────────────────────────────────────────────────

const VALID_INTENTS        = new Set<string>(UL_INTENTS);
const VALID_EMOTIONS       = new Set<string>(UL_EMOTIONS);
const VALID_TOPICS         = new Set<string>(UL_TOPICS);
const VALID_INTERVENTIONS  = new Set<string>(INTERVENTION_TYPES);

export async function runUnderstandingLayer(
  input: UnderstandingInput,
): Promise<UnderstandingResult> {
  const start = Date.now();

  const contextLines: string[] = [];

  if (input.profileSummary) {
    contextLines.push(`User profile: ${input.profileSummary}`);
  }

  if (input.recentMessages.length > 0) {
    contextLines.push("Recent conversation:");
    for (const m of input.recentMessages.slice(-10)) {
      contextLines.push(`  ${m.role === "user" ? "User" : "Coach"}: ${m.text.slice(0, 120)}`);
    }
  }

  contextLines.push(`Current message: "${input.message}"`);

  const prompt = contextLines.join("\n");

  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   200,
      systemInstruction: SYSTEM_PROMPT,
      prompt,
    });

    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return fallback(input.message, Date.now() - start);

    const p = JSON.parse(jsonMatch[0]) as Partial<UnderstandingResult & {
      intent:                 string;
      emotion:                string;
      topic:                  string;
      suggestedIntervention:  string | null;
    }>;

    return {
      intent:         VALID_INTENTS.has(p.intent  ?? "") ? p.intent!  : "general_chat",
      emotion:        VALID_EMOTIONS.has(p.emotion ?? "") ? p.emotion! : "neutral",
      topic:          VALID_TOPICS.has(p.topic   ?? "") ? p.topic!   : "other",
      confidence:     typeof p.confidence === "number"
                        ? Math.min(1, Math.max(0, p.confidence))
                        : 0.5,
      extractedFacts: p.extractedFacts && typeof p.extractedFacts === "object"
                        ? p.extractedFacts as Record<string, unknown>
                        : {},
      needsAdvice:    Boolean(p.needsAdvice),
      needsAction:    Boolean(p.needsAction),
      reasoning:      typeof p.reasoning === "string" ? p.reasoning.slice(0, 200) : "",
      suggestedIntervention: VALID_INTERVENTIONS.has(p.suggestedIntervention ?? "")
                        ? (p.suggestedIntervention as string)
                        : undefined,
      durationMs:     Date.now() - start,
    };
  } catch {
    return fallback(input.message, Date.now() - start);
  }
}

function fallback(message: string, durationMs: number): UnderstandingResult {
  return {
    intent:         "general_chat",
    emotion:        "neutral",
    topic:          "other",
    confidence:     0,
    extractedFacts: {},
    needsAdvice:    false,
    needsAction:    false,
    reasoning:      "classifier error — fallback",
    suggestedIntervention: undefined,
    durationMs,
  };
}

// ── Profile summary builder ───────────────────────────────────────────────────
// Converts intake answers into a compact one-line string for LLM context.
// Pass the result as UnderstandingInput.profileSummary.

export function buildProfileSummary(answers: Record<string, string>): string {
  const parts: string[] = [];

  if (answers.name)                   parts.push(`Name: ${answers.name}`);
  if (answers.gym_goal)               parts.push(`Goal: ${answers.gym_goal}`);
  if (answers.training_experience)    parts.push(`Experience: ${answers.training_experience}`);
  if (answers.available_training_days) parts.push(`${answers.available_training_days}d/wk`);
  if (answers.current_split)          parts.push(`Split: ${answers.current_split}`);
  if (answers.gym_session_time)       parts.push(`Trains: ${answers.gym_session_time}`);
  if (answers.current_bodyweight_kg)  parts.push(`BW: ${answers.current_bodyweight_kg}kg`);

  const liftParts: string[] = [];
  if (answers.squat_kg)    liftParts.push(`SQ ${answers.squat_kg}kg`);
  if (answers.bench_kg)    liftParts.push(`BP ${answers.bench_kg}kg`);
  if (answers.deadlift_kg) liftParts.push(`DL ${answers.deadlift_kg}kg`);
  if (liftParts.length)    parts.push(`Lifts: ${liftParts.join(" ")}`);

  if (answers.daily_protein_g)                 parts.push(`Protein: ${answers.daily_protein_g}g`);
  if (answers.injury_notes && answers.injury_notes !== "none") parts.push(`Injury: ${answers.injury_notes}`);

  return parts.join(" | ");
}
