// ─── Editing subjects and topics: the contract with the web app ───────────────
// No imports, so the web app imports it directly. Rules: product/setup-edit.ts.

export const SUBJECT_NAME_MAX = 80;
export const TOPIC_NAME_MAX   = 120;
export const STUDY_EDITS_MAX  = 60;
// Levels of subjects inside subjects: "Semester Five" › "Automata" is two.
export const SUBJECT_DEPTH_MAX = 4;

// One change to the learner's subjects and topics. Ids are the learner's own
// (checked on the server); names are what they typed.
// A subject can sit inside another: parentId names one of theirs, parentName
// one by its name (also one added earlier in the same batch); null or
// neither, a subject of its own.
export type StudyEdit =
  | { op: "add_subject";    name: string; topics: string[]; parentId?: string | null; parentName?: string }
  | { op: "move_subject";   subjectId: string; parentId: string | null; parentName?: string }
  // Topics nest inside a subject (a unit › its topics › their subtopics, up
  // to TOPIC_DEPTH_MAX levels) and keep an order. parentId names a topic of
  // that subject, parentName one by its name (also one added earlier in the
  // same batch); neither: at the top.
  | { op: "add_topics";     subjectId: string; names: string[]; parentId?: string | null; parentName?: string; kind?: "milestone" | null }
  | { op: "rename_subject"; subjectId: string; name: string }
  | { op: "rename_topic";   topicId: string; name: string }
  // To another subject (toSubjectId, at its top, with everything inside it),
  // or inside another topic of its own subject (parentId / parentName; null:
  // its top), at `index` among the topics there (absent: after them).
  | { op: "move_topic";     topicId: string; toSubjectId?: string; parentId?: string | null; parentName?: string; index?: number | null }
  // These topics, all beside one another, in this order.
  | { op: "order_topics";   topicIds: string[] }
  // What is said about a topic (its explanation, a milestone's effort and goals).
  | { op: "update_topic";   topicId: string; details: Record<string, unknown> }
  | { op: "remove_topic";   topicId: string }
  | { op: "remove_subject"; subjectId: string };

export interface StudyTopic {
  id:         string;
  name:       string;
  // The topic of the same subject it sits inside. null or absent: at its top.
  parentId?:  string | null;
  // "milestone": a stage of work, never studied. null or absent: a topic.
  kind?:      "milestone" | null;
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
  // The subject it sits inside. null or absent: one of its own.
  parentId?: string | null;
  // In outline order: a topic before the topics inside it, siblings in their saved order.
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
