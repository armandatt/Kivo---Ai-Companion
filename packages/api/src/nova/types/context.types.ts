// ─── NovaContext — the assembled context for one orchestrator turn ─────────────
// This is the single object that flows through the pipeline after all engines
// and state loaders have run. The Decision Graph consumes it. The Context
// Builder produces the dynamic layer from it for the Response Brain.

import type { AcademicUnderstanding } from "./understanding.types.js";
import type { AcademicState } from "./academic-state.types.js";
import type { SignalEngineOutput, TopicMasteryState, ExamContext, StudyPlan, PatternAnalysis } from "./engine.types.js";
import type { NovaUserFact, NovaCognitiveState } from "./memory.types.js";
import type { NovaRealityFact } from "./reality.types.js";
import type { DecisionGraphOutput } from "./response.types.js";
import type { ActiveSessionInfo } from "../engines/study-snapshot.js";
import type { SessionContext, SessionAction } from "./session.types.js";

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
}
