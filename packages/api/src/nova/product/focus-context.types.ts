// ─── Focus context: what belongs with the topic being studied ─────────────────
// The learner's own records that are filed under a topic, shown beside it on
// Today and on the Focus screen: open tasks, saved pages, the next exam for
// the subject, and what they wrote after their last session on it. Nothing
// here is worked out about the learner, and none of it is evidence of
// anything studied. No imports, so the web app imports the types directly.

export const REFLECTION_FIELD_MAX = 280;
// The whole request that saves a session note: three short answers.
export const REFLECTION_BODY_MAX_BYTES = 4 * 1024;

// The optional note after a session, in the learner's own words. It is kept
// with the session and shown back to them. It is not a rating, moves no
// mastery and schedules no review.
export interface SessionReflection {
  did:     string;   // what got done
  blocked: string;   // what got in the way
  next:    string;   // the next step
}

export type ReflectionResponse =
  | { ok: true; saved: boolean }   // saved: false when this session already has a note
  | { ok: false; error: "invalid" | "empty" | "too_large" | "not_found" | "unauthenticated" | "not_nova" | "not_connected" | "failed"; message: string };

export interface FocusContextTask {
  id:        string;
  title:     string;
  status:    "todo" | "in_progress";
  dueInDays: number | null;
  // True when the task names this topic; false when it is filed under the
  // subject only.
  onTopic:   boolean;
}

export interface FocusContextResource {
  id:      string;
  title:   string;
  url:     string;
  domain:  string;
  onTopic: boolean;
}

export interface NovaFocusContextReady {
  status:      "ready";
  subjectName: string | null;
  topicName:   string | null;
  tasks:       FocusContextTask[];
  resources:   FocusContextResource[];
  // The subject's next exam, when one is on record.
  deadline:    { title: string; daysUntil: number } | null;
  // What they wrote after their last session on this topic, and when.
  lastNote:    (SessionReflection & { date: string }) | null;
}

export type NovaFocusContextView =
  | NovaFocusContextReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };
