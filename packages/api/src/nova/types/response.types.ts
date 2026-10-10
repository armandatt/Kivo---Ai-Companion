// ─── Response Brain types ──────────────────────────────────────────────────────
// SKILL.md §6 — the Response Brain's sole job: turn a pre-made decision into
// words in Nova's voice. JSON always. Never prose.

import type { InterventionName } from "./intervention.types";
import type { ActiveInvestigation, FollowUpCheck } from "./memory.types";

export type ReasoningMode =
  | "reflective"
  | "direct"
  | "analytical"
  | "socratic"
  | "empathetic"
  | "celebratory"
  | "challenging"
  | "grounding";

export interface ResponseStateUpdates {
  sessionLogged:     boolean;
  sessionSkipped:    boolean;
  commitmentMade:    string | null;
  masteryClaimMade:  string | null;  // topic name, triggers calibration check
}

export interface ResponseBrainOutput {
  reply:              string;
  reasoningMode:      ReasoningMode;
  confidence:         number;
  // Optional structured updates the LLM can emit
  stateUpdates?:      Partial<ResponseStateUpdates>;
  investigationUpdate?: {
    topic?:       string;
    status?:      "open" | "resolved" | "abandoned";
    hypotheses?:  string[];
  } | null;
  followUpCheck?:    {
    topic:          string;
    checkAfterDays: number;
    context:        string;
  } | null;
}

// ── Decision Graph output ──────────────────────────────────────────────────────
// Produced by decision-graph.ts, consumed by context-builder and orchestrator.

export interface DecisionGraphOutput {
  selectedIntervention: InterventionName;  // the chosen intervention
  interventionFamily:   string;            // family/cluster name for audit
  graphNode:            string;            // N1–N7: which node fired
  reason:               string;            // evidence text for micro-prompt
  confidence:           number;            // 0–1
}

// ── Nova Orchestrator output ───────────────────────────────────────────────────
// Returned by runNovaOrchestrator(). Only what the Telegram handler needs.

export interface NovaOrchestratorResult {
  reply:         string;
  intervention:  InterventionName;
  reasoningMode: ReasoningMode;
  confidence:    number;
  // What the turn did besides replying. Absent on the early "not set up" return.
  trace?: {
    responseGenerated:   boolean;
    responseOk:          boolean;
    register:            string | null;
    persisted:           boolean;      // false when persistence was not awaited
    evidenceKinds:       string[];
    consolidationQueued: boolean;
    // Time until the reply was ready to be worded, and the wording itself.
    contextMs?:          number;
    responseMs?:         number;
  };
}
