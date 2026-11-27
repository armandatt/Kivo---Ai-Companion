// ─── Where a topic stands: not started, in progress, completed ───────────────
// Bug batch 28 Nov, item 7. The learner's own word, set on the map, when
// filing a session, through Nova or through an assistant (Kivo Connect).
//
// Rules:
//   - Stored null means "not said". Shown as in_progress once the topic has a
//     finished session (or a mastery review), otherwise not_started.
//   - Starting or filing a session moves a topic that is not said or
//     not_started to in_progress (markTopicStarted). Nothing else moves it.
//   - Recording time NEVER marks a topic completed; only the learner does.
//   - A completed topic stays completed when studied again (a revision).

import { prisma } from "@repo/db/client";

export const TOPIC_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type TopicStatus = typeof TOPIC_STATUSES[number];

export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = {
  not_started: "Not started", in_progress: "In progress", completed: "Completed",
};

export function parseTopicStatus(v: unknown): TopicStatus | null {
  return typeof v === "string" && (TOPIC_STATUSES as readonly string[]).includes(v) ? (v as TopicStatus) : null;
}

// What is shown: the learner's word, or what the record implies.
export function effectiveTopicStatus(stored: string | null | undefined, studied: boolean): TopicStatus {
  return parseTopicStatus(stored) ?? (studied ? "in_progress" : "not_started");
}

const likeLiteral = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

export type SetTopicStatusResult =
  | { ok: true; topicId: string; topicName: string; subjectId: string; status: TopicStatus; changed: boolean }
  | { ok: false; error: "invalid" | "not_found"; message: string };

// Sets it, for one of the learner's own live topics, by id or by subject and name.
export async function setTopicStatus(
  profileId: string,
  at: { topicId: string } | { subjectId: string; topicName: string },
  raw: unknown,
  now = new Date(),
): Promise<SetTopicStatusResult> {
  const status = parseTopicStatus(raw);
  if (!status) return { ok: false, error: "invalid", message: "A topic's status is not_started, in_progress or completed." };
  const topic = await prisma.novaTopicMastery.findFirst({
    where: "topicId" in at
      ? { id: at.topicId, subject: { profileId }, archivedAt: null }
      : { subjectId: at.subjectId, subject: { profileId }, archivedAt: null, name: { equals: likeLiteral(at.topicName.trim()), mode: "insensitive" } },
    select: { id: true, name: true, subjectId: true, status: true },
  });
  if (!topic) return { ok: false, error: "not_found", message: "That isn't one of your topics." };
  if (topic.status === status) return { ok: true, topicId: topic.id, topicName: topic.name, subjectId: topic.subjectId, status, changed: false };
  await prisma.novaTopicMastery.update({ where: { id: topic.id }, data: { status, statusChangedAt: now } });
  console.log(JSON.stringify({ layer: "nova:topic_status", profileId, topicId: topic.id, from: topic.status, to: status }));
  return { ok: true, topicId: topic.id, topicName: topic.name, subjectId: topic.subjectId, status, changed: true };
}

// A session was started or filed on the topic: not said / not_started become
// in_progress. Completed stays completed. Returns true when it moved.
export async function markTopicStarted(subjectId: string, topicName: string, now = new Date()): Promise<boolean> {
  const moved = await prisma.novaTopicMastery.updateMany({
    where: { subjectId, archivedAt: null, name: { equals: likeLiteral(topicName.trim()), mode: "insensitive" }, OR: [{ status: null }, { status: "not_started" }] },
    data:  { status: "in_progress", statusChangedAt: now },
  });
  return moved.count > 0;
}
