import { type ParseResult } from "./parsing-engine-v2";
import { type UnderstandingResult } from "./understanding-layer";

// ═══════════════════════════════════════════════════════════════════════════════
// SEMANTIC ROUTER
//
// Arbitrates between Parser V2 (structured extraction) and Understanding Layer
// (semantic intent) to produce a single routing decision per message.
//
// Routing rules (in priority order):
//   1. Parser >= 0.90 on a structured action → Parser wins unconditionally
//   2. Conflict on state-changing action (V2 medium-confidence, UL says no action)
//      → Ask for clarification; do not execute
//   3. UL >= 0.85 AND Parser < 0.55 → UL wins
//   4. UL primary domain, no conflicting Parser intent → UL wins
//   5. Default → V2 wins (or UL if V2 has no actionable intent)
//
// Parser V2 is NOT replaced. It remains the source of truth for structured
// extraction (entities, timestamps, repetitions, frequencies). This router
// only decides WHICH system's intent classification drives the response.
// ═══════════════════════════════════════════════════════════════════════════════

export type RouterSource = "ul" | "v2" | "clarification";

export interface RouterDecision {
  source:                RouterSource;
  intent:                string;
  confidence:            number;
  ulResult:              UnderstandingResult;
  v2Result:              ParseResult;
  suggestedIntervention?: string;
  requiresClarification: boolean;
  clarificationPrompt?:  string;
}

// Structured intents where Parser V2 is authoritative (numeric extraction required)
const PARSER_PRIMARY = new Set([
  "reminder_create",
  "reminder_edit",
  "reminder_delete",
  "log_workout",
  "log_weight",
  "log_skip",
  "log_soreness",
  "log_pain",
  "checkin_schedule",
]);

// Semantic intents where UL is authoritative (no numeric extraction needed)
const UL_PRIMARY = new Set([
  "making_excuse",
  "seeking_validation",
  "emotional_expression",
  "making_commitment",
  "seeking_guidance",     // plan requests, advice — no extraction required
  "asking_question",      // factual questions — semantic, not structural
  "general_chat",
  "requesting_check_in",
  "requesting_help",
]);

// State-changing actions — conflict between UL and V2 triggers clarification
const STATE_CHANGING = new Set([
  "reminder_create",
  "reminder_edit",
  "reminder_delete",
  "log_workout",
  "log_weight",
  "log_skip",
  "checkin_schedule",
]);

export function routeMessage(v2: ParseResult, ul: UnderstandingResult): RouterDecision {
  const v2Intent = v2.actionableIntent?.type ?? null;
  const v2Conf   = v2.confidence;
  const ulConf   = ul.confidence;

  // Rule 1: Parser >= 0.90 on structured action → Parser wins unconditionally.
  // High-confidence structured actions (reminder create, weight log, etc.) need
  // precise entity extraction — UL cannot reliably extract times and frequencies.
  if (v2Intent && PARSER_PRIMARY.has(v2Intent) && v2Conf >= 0.90) {
    return {
      source:                "v2",
      intent:                v2Intent,
      confidence:            v2Conf,
      ulResult:              ul,
      v2Result:              v2,
      suggestedIntervention: ul.suggestedIntervention,
      requiresClarification: false,
    };
  }

  // Rule 2: Conflict on a state-changing action.
  // V2 is moderately confident it's an action, but UL says this message isn't
  // requesting a system action. Ask before writing anything.
  if (
    v2Intent !== null &&
    STATE_CHANGING.has(v2Intent) &&
    v2Conf >= 0.55 &&
    v2Conf < 0.90 &&
    ulConf >= 0.85 &&
    !ul.needsAction
  ) {
    return {
      source:                "clarification",
      intent:                v2Intent,
      confidence:            Math.min(v2Conf, ulConf),
      ulResult:              ul,
      v2Result:              v2,
      suggestedIntervention: ul.suggestedIntervention,
      requiresClarification: true,
      clarificationPrompt:   "Just to make sure — did you want me to make a change, or are you just sharing?",
    };
  }

  // Rule 3: UL >= 0.85 AND Parser confidence < 0.55 → UL wins.
  // Parser is uncertain; UL has high confidence in a semantic classification.
  if (ulConf >= 0.85 && v2Conf < 0.55) {
    return {
      source:                "ul",
      intent:                ul.intent,
      confidence:            ulConf,
      ulResult:              ul,
      v2Result:              v2,
      suggestedIntervention: ul.suggestedIntervention,
      requiresClarification: false,
    };
  }

  // Rule 4: UL primary domain with no conflicting structured Parser intent.
  // Emotional, coaching, and conversational messages should route through UL
  // when V2 hasn't claimed ownership via a structured action intent.
  if (UL_PRIMARY.has(ul.intent) && (v2Intent === null || !PARSER_PRIMARY.has(v2Intent))) {
    return {
      source:                "ul",
      intent:                ul.intent,
      confidence:            ulConf,
      ulResult:              ul,
      v2Result:              v2,
      suggestedIntervention: ul.suggestedIntervention,
      requiresClarification: false,
    };
  }

  // Default: V2 wins, or fall back to UL if V2 has no actionable intent.
  return {
    source:                v2Intent !== null ? "v2" : "ul",
    intent:                v2Intent ?? ul.intent,
    confidence:            v2Intent !== null ? v2Conf : ulConf,
    ulResult:              ul,
    v2Result:              v2,
    suggestedIntervention: ul.suggestedIntervention,
    requiresClarification: false,
  };
}
