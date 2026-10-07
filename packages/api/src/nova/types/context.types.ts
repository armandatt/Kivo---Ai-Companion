// ─── NovaContext — the assembled context for one orchestrator turn ─────────────
// This is the single object that flows through the pipeline after all engines
// and state loaders have run. The Decision Graph consumes it. The Context
// Builder produces the dynamic layer from it for the Response Brain.

import type { AcademicUnderstanding } from "./understanding.types";
import type { AcademicState } from "./academic-state.types";
import type { SignalEngineOutput, TopicMasteryState, ExamContext, StudyPlan, PatternAnalysis } from "./engine.types";
import type { NovaUserFact, NovaCognitiveState } from "./memory.types";
import type { NovaRealityFact } from "./reality.types";
import type { DecisionGraphOutput } from "./response.types";
import type { ActiveSessionInfo } from "../engines/study-snapshot";
import type { SessionContext, SessionAction } from "./session.types";

export interface NovaUserProfile {
  displayName:              string;
  yearOfStudy:              number | null;
  major:                    string | null;
  institution:              string | null;
  preferredStudyHoursPerDay: number;
  subjects:                 string[];   // subject names
  daysSinceJoined:          number;
}

export interface ConversationTurn {
  role:      "user" | "nova";
  text:      string;
  createdAt: Date;
}

export interface NovaContext {
  // Message
  platformChatId: string;
  rawMessage:     string;
  timestamp:      Date;

  // Understanding (Understanding Brain output)
  understanding: AcademicUnderstanding;

  // State (Academic State Engine output)
  academicState: AcademicState;

  // Signals (Signal Engine output)
  signals: SignalEngineOutput;

  // Profile
  userProfile: NovaUserProfile;

  // Knowledge (relevant to mentioned topic, if any)
  topicMastery: TopicMasteryState | null;

  // Exam (if within 14 days)
  examContext: ExamContext | null;

  // Plan (if loaded)
  studyPlan: StudyPlan | null;

  // Active study session (if student is currently studying)
  activeSession: ActiveSessionInfo | null;

  // Session Engine output (if in-session)
  sessionContext: SessionContext | null;
  sessionAction:  SessionAction | null;

  // Patterns
  patterns: PatternAnalysis;

  // Memory
  topRelevantMemories:   NovaUserFact[];
  contrastiveMemories:   NovaUserFact[];
  cognitiveState:        NovaCognitiveState;

  // Reality (from prior turns)
  activeRealityFacts: NovaRealityFact[];

  // Onboarding personality signal, already phrased as behavioural lines.
  // Context only: it is evidence about the student, never durable Nova state.
  operatingStyle?: string[];

  // Conversation history
  conversationHistory: ConversationTurn[];

  // Decision (Decision Graph output — filled after graph runs)
  decision: DecisionGraphOutput | null;
}

// ── Orchestrator input ─────────────────────────────────────────────────────────

export interface NovaOrchestratorInput {
  platformChatId: string;
  text:           string;
  timestamp?:     Date;
  // Set when the message was an explicit slash command (see commands.ts).
  // Commands are protocol and may trigger deterministic effects.
  command?:       import("../commands").NovaCommand | null;
  // Wait for the turn to be persisted before returning. Used by the web app,
  // which reads state immediately after the reply. Telegram leaves it off.
  awaitPersistence?: boolean;

  // ── Set by a surface that has already done part of the turn ────────────────
  // The message's reading, when the caller already asked the Understanding
  // Brain (with conversation context). The brain is then not called again.
  understanding?: import("./understanding.types").AcademicUnderstanding;
  // The reply, when the turn's outcome is a product action whose result is
  // stated plainly ("Started: 25 min on Deadlocks"). The Response Brain is
  // not called. Everything else about the turn still happens: the engines
  // run, the message is logged, evidence is built and consolidated.
  scriptedReply?: string;
  // What was decided, for the Response Brain to word. It never chooses it.
  directive?: string;
  // Used instead of failing the turn when the Response Brain cannot answer.
  responseFallback?: string;
  // Which parts of the learner's record this reply can draw on
  // (interaction/semantics.ts), and any lines the surface read from the
  // product views. Without it the Response Brain is given the whole layer.
  // mode "explain": the message is a question about the subject matter and
  // is answered as one; no intervention is worded.
  focus?: { needs: readonly import("../interaction/semantics").ContextNeed[]; facts?: readonly string[]; mode?: "explain" };
  // "surface": the caller runs start / pause / resume / end itself through
  // the session commands, so the turn must not run them a second time.
  sessionCommands?: "turn" | "surface";
  // Test seam: stands in for the Response Brain.
  respond?: (dynamicLayer: string, microPrompt: string) => Promise<import("./response.types").ResponseBrainOutput>;
}
