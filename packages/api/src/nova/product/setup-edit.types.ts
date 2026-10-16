// ─── Editing subjects and topics: the contract with the web app ───────────────
// No imports, so the web app imports it directly. Rules: product/setup-edit.ts.

export const SUBJECT_NAME_MAX = 80;
export const TOPIC_NAME_MAX   = 120;
export const STUDY_EDITS_MAX  = 60;

// One change to the learner's subjects and topics. Ids are the learner's own
// (checked on the server); names are what they typed.
export type StudyEdit =
  | { op: "add_subject";    name: string; topics: string[] }
  | { op: "add_topics";     subjectId: string; names: string[] }
  | { op: "rename_subject"; subjectId: string; name: string }
  | { op: "rename_topic";   topicId: string; name: string }
  | { op: "move_topic";     topicId: string; toSubjectId: string }
  | { op: "remove_topic";   topicId: string }
  | { op: "remove_subject"; subjectId: string };

export interface StudyTopic {
  id:         string;
  name:       string;
  // Learning is recorded against it (a session, a review, mastery history).
  // It can be renamed or moved, never removed: that would delete the record.
  hasHistory: boolean;
  // Archived (topic-archive.ts): out of the active lists, row and history kept.
  // Its name is still taken in its subject; adding it again restores it.
  archived?:  boolean;
}

export interface StudySubject {
  id:     string;
  name:   string;
  topics: StudyTopic[];
  // Dated items (exams, interviews, …) filed under it.
  dates:  number;
}

export interface StudyStructure {
  // Names the structure as it stands. An edit made against another version
  // is refused, so a stale page cannot overwrite a newer change.
  version:  string;
  subjects: StudySubject[];
}

export type StudyStructureView =
  | ({ status: "ready" } & StudyStructure)
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

export interface StudyEditIssue { index: number; message: string }

export type StudyEditResponse =
  | { ok: true; structure: StudyStructure; applied: string[] }
  | { ok: false; error: "invalid" | "stale" | "failed" | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete"; message: string; issues?: StudyEditIssue[]; structure?: StudyStructure };
