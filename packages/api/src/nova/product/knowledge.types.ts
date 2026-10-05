// ─── Knowledge view: the contract between Nova and the Knowledge page ─────────
// A read model of what Nova has on record about each topic. Every field is a
// stored value or is computed by an existing engine. No imports, so the web
// app can import the types directly.
//
// What "mastery" is here: the Topic Mastery Engine's running estimate, moved
// by the learner's own end-of-session answers. It is a self-report-driven
// heuristic, not a tested result, and this contract carries no measure of
// how certain it is. `reviewCount` (how many finished sessions fed it) is
// the only honest indication of how much stands behind the number.

export type KnowledgeLevel =
  | "unverified"   // mentioned in conversation only: no session has fed it
  | "weak" | "developing" | "solid";

export type KnowledgeReviewState =
  | "unscheduled"  // no review date yet
  | "scheduled"    // next review is in the future
  | "due";         // due for review now (one definition: retention-engine.ts)

export type KnowledgeOutcome = "struggled" | "okay" | "good" | "crushed_it";

// A finished study session Nova has on record for a topic.
export interface KnowledgeSession {
  id:        string;
  topicName: string | null;
  subjectName: string | null;
  date:      string;
  // false: the learner told Nova in conversation that they studied. There
  // was no timer, so there is no duration: `minutes` is null and must not be
  // shown as study time.
  measured:  boolean;
  minutes:   number | null;
  // The learner's answer to "How did it go?". null: not asked or not answered.
  outcome:   KnowledgeOutcome | null;
  confusionPoints: string[];
}

export interface KnowledgeTopic {
  id:               string;
  topicName:        string;
  subjectName:      string;
  masteryPercent:   number;             // 0–100, see the note above
  level:            KnowledgeLevel;
  reviewCount:      number;             // finished sessions that fed this topic
  lastStudiedAt:    string | null;
  retentionPercent: number;             // estimated from time since last studied
  reviewState:      KnowledgeReviewState;
  nextReviewAt:     string | null;      // when it becomes (or became) due
  daysOverdue:      number;             // 0 unless due
  recentSessions:   KnowledgeSession[]; // newest first, at most three
}

export interface KnowledgeDueReview extends KnowledgeTopic {
  // Why it is due, as short facts: "2 days overdue", "retention about 61%".
  reasons:        string[];
  // The length the Planning Engine gives a review block.
  reviewMinutes:  number;
}

export interface KnowledgeSubject {
  subjectName: string;
  topics:      KnowledgeTopic[];        // due first, then weakest first
  summary:     { topicCount: number; dueCount: number };
}

export interface NovaKnowledgeReady {
  status:      "ready";
  generatedAt: string;
  // Every subject the learner has, including those with no topics yet.
  subjects:    KnowledgeSubject[];
  dueReviews:  KnowledgeDueReview[];    // least retained first
  recentLearning: KnowledgeSession[];   // newest first
  // A session is running: one at a time, so a review cannot be started.
  activeSession: { topicName: string | null; subjectName: string | null } | null;
  totals:      { subjectCount: number; topicCount: number; dueCount: number };
}

export type NovaKnowledgeView =
  | NovaKnowledgeReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };
