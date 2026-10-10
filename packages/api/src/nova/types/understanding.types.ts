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
  // What the student is asking Nova to do, if anything. Absent: nothing was
  // read (an older caller, or a command that never reached the model).
  request?: LearnerRequest;
  // True when the model's output could not be read at all and every field
  // here is a neutral default. A caller that would act on the reading must
  // not act on this one.
  malformed?: boolean;
}

// ── The request part of the envelope ──────────────────────────────────────────
// A proposal, never an instruction: decision/action-decision.ts decides what
// (if anything) runs, against the session and prompt that actually exist.
// Closed vocabulary; anything else the model returns is dropped by the parser.

export const UNDERSTANDING_ENVELOPE_VERSION = 5;

export const REQUESTED_ACTIONS = [
  "what_now", "start_session", "pause_session", "resume_session",
  "finish_session", "status", "not_now", "something_else",
  // Asks Nova to remind or message them at a later time. Read so that it is
  // never mistaken for anything else; Nova has no reminder to create, so the
  // decision answers that plainly and nothing is scheduled.
  "set_reminder",
  "none",
] as const;
export type RequestedAction = typeof REQUESTED_ACTIONS[number];

export type StatedOutcome = "struggled" | "okay" | "good" | "crushed_it";

// How well the message could be read at all. Only a "clear" reading can lead
// to an action or to evidence; the others are answered without acting.
//   ambiguous       real words, but what they refer to cannot be told
//   unintelligible  no meaning to read (random characters, noise)
//   unsupported     a clear request for something Nova does not do here
export const READING_CLARITY = ["clear", "ambiguous", "unintelligible", "unsupported"] as const;
export type ReadingClarity = typeof READING_CLARITY[number];

// The languages Nova replies in. Hinglish is Hindi in Roman letters mixed
// with English, the way Indian students text.
export const REPLY_LANGUAGES = ["english", "hinglish"] as const;
export type ReplyLanguage = typeof REPLY_LANGUAGES[number];

export interface LearnerRequest {
  clarity:          ReadingClarity;
  // The message takes back, holds or reverses something it (or the student's
  // previous message) asked for: "start OS but not yet", "wait, don't".
  // Nothing that changes state runs on such a message.
  changeOfMind:     boolean;
  action:           RequestedAction;
  confidence:       number;                 // 0–1, in the action reading
  // The option of Nova's open question this message picks, by id. null when
  // there is no open question or the message does not answer it.
  promptAnswer:     string | null;
  availableMinutes: number | null;          // "I have 30 mins", "make it 20"
  sessionOutcome:   StatedOutcome | null;   // only when they say how it went
  deferUntil:       "later" | "tomorrow" | null;
  // A topic the student says they are failing at, do not understand or have
  // forgotten. A statement about themselves, not a question.
  struggleTopic:    string | null;
  exam:             { title: string; date: string } | null;   // date: YYYY-MM-DD
  // Whether the message is a question, and whose answer it is.
  //   knowledge  about the subject matter; the answer is the same for anyone
  //   about_me   about this student's own plan, progress, exams or time
  // It decides how much of the learner's record a reply needs, never what
  // Nova does.
  asks:             AskScope;
  // The larger number when the student gave a range of time ("20-30 mins");
  // availableMinutes then holds the smaller. null: one number, or none.
  availableMinutesMax: number | null;
  // Something the student states about how they study this term: what a
  // subject covers, how long they usually have, when they usually study.
  // Offered back for confirmation; never saved on the reading alone.
  setup:            SetupStatement | null;
  // The language the message itself is written in. null: too short or too
  // mixed to say ("ok", "30", a topic name). It chooses the language of the
  // reply and nothing else. Absent on a reading made before this field.
  language?:        ReplyLanguage | null;
}

export const ASK_SCOPES = ["knowledge", "about_me", "none"] as const;
export type AskScope = typeof ASK_SCOPES[number];

export const STUDY_TIMES = ["morning", "afternoon", "evening", "night"] as const;
export type StudyTime = typeof STUDY_TIMES[number];

export interface SetupStatement {
  // Subjects or courses they say they are taking this term. Absent: none.
  subjects?:    string[];
  subject:      string | null;     // the subject the topics belong to, as named
  topics:       string[];          // topics, chapters or units of that subject
  dailyMinutes: number | null;     // what they usually have on a normal day
  studyTime:    StudyTime | null;  // when they usually study
}

// What the model is told about the conversation before it reads the message.
// Facts from Nova's own records, so "yeah" and "done" can be read in context.
export interface UnderstandingContext {
  today:      string;            // "Tuesday 2026-10-06"
  session:    "running" | "paused" | "none";
  sessionTopic: string | null;
  openPrompt: { question: string; options: Array<{ id: string; label: string }> } | null;
}
