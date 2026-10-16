// ─── Archiving a topic: the contract with the web app ─────────────────────────
// No imports, so the web app imports it directly. Rules: product/topic-archive.ts.

export interface ArchivedTopic { topicId: string; topicName: string; subjectName: string; archivedAt: string; studied: boolean }

export type ArchivedTopicsView =
  | { status: "ready"; topics: ArchivedTopic[] }
  | { status: "not_nova" } | { status: "not_connected" } | { status: "onboarding_incomplete" };

export type TopicArchiveResponse =
  | { ok: true; archived: boolean; changed: boolean }
  | { ok: false; error: "invalid" | "not_found" | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "failed"; message: string };
