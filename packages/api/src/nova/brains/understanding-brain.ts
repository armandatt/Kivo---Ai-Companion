// ─── Understanding Brain ──────────────────────────────────────────────────────
// SKILL.md §5.2 — gpt-4o-mini, classification only.
// Produces AcademicUnderstanding. Does NOT produce any reply text.
// Called once per orchestrator turn BEFORE any state computation.
// The Disambiguation Pass (if confidence < 0.80) can refine the output.
// Owner: Understanding Brain.

import { generateOpenAIText } from "../../services/openai.service.js";
import type { AcademicUnderstanding, AcademicIntent, AcademicEmotion, DisclosureClass, RoutingSignal } from "../types/understanding.types.js";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "./prompts/understanding-brain.prompt.js";

// ── Output parser ──────────────────────────────────────────────────────────────

const VALID_INTENTS = new Set<string>([
  "study_report", "study_skip_report", "topic_question",
  "plan_request", "exam_anxiety", "progress_check", "mastery_claim",
  "commitment_made", "reflection", "accountability_request", "identity_doubt",
  "excuse", "life_disclosure", "emotional_vent", "schedule_query", "general_chat",
]);

const VALID_EMOTIONS = new Set<string>([
  "anxious_exam", "anxious_general", "overwhelmed", "discouraged",
  "self_doubt", "identity_threat", "frustrated", "confused",
  "avoidant", "proud", "motivated", "determined", "hopeful",
  "relieved", "neutral", "distressed",
]);

const VALID_ROUTING_SIGNALS = new Set<string>([
  "knowledge_engine", "planning_engine", "exam_engine",
  "retention_engine", "coaching_only", "reality_extraction",
]);

const VALID_DISCLOSURE_CLASSES = new Set<string>([
  "emotional_disclosure", "life_event", "study_context", "none",
]);

function parseUnderstandingResponse(
  json: string,
  rawText: string,
): AcademicUnderstanding {
  let parsed: Record<string, unknown>;
  try {
    // Strip markdown code fences if present
    const cleaned = json.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return fallbackUnderstanding(rawText);
  }

  const intent  = String(parsed["intent"] ?? "general_chat");
  const emotion = String(parsed["emotion"] ?? "neutral");
  const topic   = parsed["topic"] ? String(parsed["topic"]) : null;
  const routing = String(parsed["routingSignal"] ?? "coaching_only");
  const disc    = String(parsed["disclosureClass"] ?? "none");
  const ambig   = typeof parsed["ambiguityScore"] === "number"
    ? Math.max(0, Math.min(1, parsed["ambiguityScore"]))
    : 0.3;
  const topicConf = typeof parsed["topicConfidence"] === "number"
    ? Math.max(0, Math.min(1, parsed["topicConfidence"]))
    : topic ? 0.7 : 0;

  return {
    intent:          VALID_INTENTS.has(intent)           ? (intent as AcademicIntent)         : "general_chat",
    emotion:         VALID_EMOTIONS.has(emotion)         ? (emotion as AcademicEmotion)        : "neutral",
    topic:           topic && topic !== "null" ? topic : null,
    topicConfidence: topicConf,
    disclosureClass: VALID_DISCLOSURE_CLASSES.has(disc)  ? (disc as DisclosureClass)          : "none",
    ambiguityScore:  ambig,
    routingSignal:   VALID_ROUTING_SIGNALS.has(routing)  ? (routing as RoutingSignal)         : "coaching_only",
    rawText,
  };
}

function fallbackUnderstanding(rawText: string): AcademicUnderstanding {
  return {
    intent:          "general_chat",
    emotion:         "neutral",
    topic:           null,
    topicConfidence: 0,
    disclosureClass: "none",
    ambiguityScore:  0.5,
    routingSignal:   "coaching_only",
    rawText,
  };
}

// ── Understanding Brain call ───────────────────────────────────────────────────

export async function runUnderstandingBrain(
  userText:            string,
  conversationHistory: Array<{ role: "user" | "nova"; text: string }>,
): Promise<AcademicUnderstanding> {
  // Inject recent history (last 3 turns) for context
  const historySnippet = conversationHistory
    .slice(-3)
    .map(t => `${t.role === "user" ? "Student" : "Nova"}: ${t.text}`)
    .join("\n");

  const prompt = historySnippet
    ? `Recent conversation:\n${historySnippet}\n\nNow classify this new message:\n"${userText}"`
    : `Classify this message:\n"${userText}"`;

  const raw = await generateOpenAIText({
    model:            "gpt-4o-mini",
    systemInstruction: UNDERSTANDING_BRAIN_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens:  250,
  });

  return parseUnderstandingResponse(raw, userText);
}
