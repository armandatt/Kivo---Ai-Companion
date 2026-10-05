// ─── Understanding Brain output types ──────────────────────────────────────────
// Single canonical classification for every conversational message.
// SKILL.md §5 — one source, everything downstream trusts it.

export type AcademicIntent =
  | "study_report"           // "I finished chapter 3"
  | "study_skip_report"      // "I didn't study today"
  | "topic_question"         // "I don't understand derivatives"
  | "plan_request"           // "what should I study this week"
  | "exam_anxiety"           // "I'm scared about the exam"
  | "progress_check"         // "am I on track"
  | "mastery_claim"          // "I think I know this topic well"
  | "commitment_made"        // "I'll do 2 hours tonight"
  | "reflection"             // "I've been struggling lately"
  | "accountability_request" // "hold me to this"
  | "identity_doubt"         // "I'm not smart enough for this"
  | "excuse"                 // "I was busy"
  | "life_disclosure"        // "my grandmother passed"
  | "emotional_vent"         // "I'm overwhelmed by everything"
  | "schedule_query"         // "what do I have this week"
  | "general_chat";

export type AcademicEmotion =
  | "anxious_exam"
  | "anxious_general"
  | "overwhelmed"
  | "discouraged"
  | "self_doubt"
  | "identity_threat"
  | "frustrated"
  | "confused"
  | "avoidant"
  | "proud"
  | "motivated"
  | "determined"
  | "hopeful"
  | "relieved"
  | "neutral"
  | "distressed";

export type DisclosureClass =
  | "emotional_disclosure"  // grief, anxiety, burnout expressed personally
  | "life_event"            // factual life constraint (travel, illness, family)
  | "study_context"         // academic disclosure (exam stress, overloaded week)
  | "none";

export type RoutingSignal =
  | "knowledge_engine"      // topic-specific mastery/review
  | "planning_engine"       // schedule or plan request
  | "exam_engine"           // exam-related within 14 days
  | "retention_engine"      // due-for-review signal
  | "coaching_only"         // no engine needed, pure coaching
  | "reality_extraction";   // disclosure that warrants reality extractor

// A real-world circumstance the student disclosed, as the Understanding Brain
// read it. This is an observation, not a stored fact: it becomes evidence,
// and only consolidation decides whether UserReality changes (SKILL.md §9).
export interface RealityObservation {
  category:    import("./reality.types").NovaRealityCategory;
  subtype:     string;
  claim:       string;                    // third person, present tense
  status:      "active" | "resolved";     // "resolved": the student says it has ended
  persistence: "temporary" | "standing";
  expectedDurationHours: number | null;
  confidence:  number;                    // 0–1
}

export interface AcademicUnderstanding {
  intent: AcademicIntent;
  emotion: AcademicEmotion;
  topic: string | null;              // academic topic mentioned, if any
  topicConfidence: number;           // 0–1
  disclosureClass: DisclosureClass;
  ambiguityScore: number;            // 0–1 — triggers disambiguation pass if > 0.6
  routingSignal: RoutingSignal;
  rawText: string;                   // original message, for downstream use
  // Other things the same message clearly says, beyond `intent`. One message
  // can report studying and vent in the same breath; `intent` is the dominant
  // one and drives the reply, and the rest are kept here so their evidence is
  // not lost. At most two. Absent is treated as none.
  secondaryIntents?: AcademicIntent[];
  // "start": the student says they are beginning or resuming studying right now.
  // "break": the student says they are stopping for a break.
  // Absent is treated as "none".
  sessionIntent?: "start" | "break" | "none";
  // Absent or empty: the message disclosed no real-world circumstance.
  realityObservations?: RealityObservation[];
}
