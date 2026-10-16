// ─── Archiving and restoring a topic ──────────────────────────────────────────
// The learner takes a topic out of their active lists, or brings it back.
// Archiving is a mark on the topic's row (setTopicArchived, the topic engine):
// its mastery, review schedule, mastery history, sessions, notes, tasks and
// saved pages all stay. While archived it is left out of the plan, Today,
// the Planner, Knowledge, the map, reminders, chat, the extension's topic list
// and filing; Progress still counts what was studied. Restoring clears the
// mark, and naming the topic again in setup restores it too (declareTopics).
//
// Ownership comes from the profile, never from the request: a topic id that
// is not the learner's is "not found". A repeat changes nothing.

import { prisma } from "@repo/db/client";
import { setTopicArchived } from "../engines/topic-mastery-engine";
import type { ArchivedTopic, TopicArchiveResponse } from "./topic-archive.types";

export async function listArchivedTopics(profileId: string): Promise<ArchivedTopic[]> {
  const rows = await prisma.novaTopicMastery.findMany({
    where:   { subject: { profileId }, archivedAt: { not: null } },
    select:  { id: true, name: true, archivedAt: true, reviewCount: true, lastStudiedAt: true, subject: { select: { name: true } } },
    orderBy: { archivedAt: "desc" },
  });
  return rows.map(r => ({
    topicId: r.id, topicName: r.name, subjectName: r.subject.name, archivedAt: r.archivedAt!.toISOString(),
    studied: r.reviewCount > 0 || r.lastStudiedAt !== null,
  }));
}

export async function archiveTopic(profileId: string, raw: unknown, now = new Date()): Promise<TopicArchiveResponse> {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (typeof input.topicId !== "string" || !input.topicId || input.topicId.length > 64 || typeof input.archived !== "boolean") {
    return { ok: false, error: "invalid", message: "That isn't a change Nova can make." };
  }
  const owned = await prisma.novaTopicMastery.findFirst({ where: { id: input.topicId, subject: { profileId } }, select: { archivedAt: true } });
  if (!owned) return { ok: false, error: "not_found", message: "That topic isn't one of yours." };
  const changed = await setTopicArchived(profileId, input.topicId, input.archived, now);
  return { ok: true, archived: input.archived, changed };
}
