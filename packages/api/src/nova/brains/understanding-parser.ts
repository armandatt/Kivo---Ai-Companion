// ─── Understanding Brain output parser ────────────────────────────────────────
// Structural validation of the model's JSON. Pure: no LLM, no DB.
// It checks shape and vocabulary only. It never reads the user's message to
// decide what it means; that is the Understanding Brain's job.

import type {
  AcademicUnderstanding, AcademicIntent, AcademicEmotion, DisclosureClass, RoutingSignal, RealityObservation,
  LearnerRequest, RequestedAction, StatedOutcome,
} from "../types/understanding.types";
import { REQUESTED_ACTIONS } from "../types/understanding.types";
import { isNovaRealityCategory, normalizeSubtype } from "../types/reality.types";

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

const MAX_REALITY_OBSERVATIONS = 3;

// Structural validation only. Anything malformed is dropped: a bad reality
// item must never take the whole classification down with it.
export function parseRealityObservations(raw: unknown): RealityObservation[] {
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, MAX_REALITY_OBSERVATIONS).flatMap((item): RealityObservation[] => {
    if (typeof item !== "object" || item === null) return [];
    const r = item as Record<string, unknown>;

    const category = String(r["category"] ?? "");
    const claim    = typeof r["claim"] === "string" ? r["claim"].trim().slice(0, 300) : "";
    if (!isNovaRealityCategory(category) || claim.length < 4) return [];
    // Someone else's circumstance is not the student's reality.
    if (r["about"] === "other") return [];
    if (typeof r["confidence"] !== "number") return [];

    const hours = r["expectedDurationHours"];
    return [{
      category,
      subtype:     normalizeSubtype(category, typeof r["subtype"] === "string" ? r["subtype"] : null),
      claim,
      status:      r["status"] === "resolved" ? "resolved" : "active",
      persistence: r["persistence"] === "standing" ? "standing" : "temporary",
      expectedDurationHours: typeof hours === "number" && hours > 0 ? hours : null,
      confidence:  Math.max(0, Math.min(1, r["confidence"])),
    }];
  });
}

// ── The request ───────────────────────────────────────────────────────────────
// Shape and vocabulary only. Whether the request is carried out is decided
// later, against real state; here an unknown action simply becomes "none".

const OUTCOMES: readonly StatedOutcome[] = ["struggled", "okay", "good", "crushed_it"];
const MAX_STATED_MINUTES = 600;

const shortText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max && t !== "null" ? t : null;
};

// A calendar date written YYYY-MM-DD that is a real day.
export function isIsoDay(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== 10 || v[4] !== "-" || v[7] !== "-") return false;
  const [y, m, d] = [Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10))];
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const NO_REQUEST: LearnerRequest = {
  action: "none", confidence: 0, promptAnswer: null, availableMinutes: null,
  sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null,
};

export function parseLearnerRequest(raw: unknown): LearnerRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...NO_REQUEST };
  const r = raw as Record<string, unknown>;

  const action = REQUESTED_ACTIONS.find(a => a === r["action"]) as RequestedAction | undefined;
  const minutes = r["availableMinutes"];
  const exam = typeof r["exam"] === "object" && r["exam"] !== null ? r["exam"] as Record<string, unknown> : null;
  const examTitle = exam ? shortText(exam["title"], 80) : null;

  return {
    action:       action ?? "none",
    confidence:   typeof r["confidence"] === "number" && action ? Math.max(0, Math.min(1, r["confidence"])) : 0,
    promptAnswer: shortText(r["promptAnswer"], 8),
    availableMinutes: typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_STATED_MINUTES
      ? Math.round(minutes) : null,
    sessionOutcome: OUTCOMES.find(o => o === r["sessionOutcome"]) ?? null,
    deferUntil:     r["deferUntil"] === "later" || r["deferUntil"] === "tomorrow" ? r["deferUntil"] : null,
    struggleTopic:  shortText(r["struggleTopic"], 80),
    exam:           exam && examTitle && isIsoDay(exam["date"]) ? { title: examTitle, date: exam["date"] } : null,
  };
}

const MAX_SECONDARY_INTENTS = 2;

function parseSecondaryIntents(raw: unknown, primary: string): AcademicIntent[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw
    .map(v => String(v))
    .filter(v => VALID_INTENTS.has(v) && v !== primary && v !== "general_chat");
  return [...new Set(valid)].slice(0, MAX_SECONDARY_INTENTS) as AcademicIntent[];
}

export function parseUnderstandingResponse(
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
    secondaryIntents:    parseSecondaryIntents(parsed["secondaryIntents"], intent),
    sessionIntent:       parsed["sessionIntent"] === "start" ? "start"
                       : parsed["sessionIntent"] === "break" ? "break" : "none",
    realityObservations: parseRealityObservations(parsed["reality"]),
    request:             parseLearnerRequest(parsed["request"]),
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
    malformed:       true,
  };
}
