// ─── Deleted knowledge, kept to bring back ────────────────────────────────────
// The only reader and writer of NovaKnowledgeTrash. When the learner deletes a
// subject or a whole map from the Knowledge Map (workspaces.ts deleteMap), the
// rows that go are deleted from the active tables as before, in the same
// transaction as a copy of them is written here: so active knowledge is only
// what is in the active tables, and nothing that reads it (Nova's context,
// the plan, the map, Telegram) has to know a trash exists.
//
// Three states, kept apart:
//   active      the subject, topic and date tables. All Nova ever reads.
//   deleted     a row here, not restored, not expired. Nova can't see it.
//   restored    the copy put back into the active tables (same ids), and
//               this row marked restoredAt. Nova sees it again because it is
//               active again, not because anything reads this table.
//
// What stayed when a subject went (notes, tasks, saved pages, past dates: the
// learner's own, unfiled by the delete) is remembered by id, and refiled on
// restore only if it is still filed under nothing: a later choice of theirs
// is never undone. Workspace records are kept by workspaces.ts and handed in.

import { prisma } from "@repo/db/client";
import { noteFilingIn, refileNotesIn } from "./notes";
import { taskFilingIn, refileTasksIn } from "./tasks";
import { resourceFilingIn, refileResourcesIn } from "./learning-events";
import { restoreDatesIn } from "./exams";

export const TRASH_KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type JsonInput = object;
export type Filing = { id: string; subjectId: string; topicName: string | null };

export interface TrashSnapshot {
  subjects:   Array<Record<string, unknown>>;
  topics:     Array<Record<string, unknown>>;
  dates:      Array<Record<string, unknown>>;
  // Dates kept by the delete, unfiled from a subject that went.
  unfiledDates: Filing[];
  notes:      Filing[];
  tasks:      Filing[];
  resources:  Filing[];
  // workspaces.ts's own record of the workspaces it deleted or changed.
  workspaces: Array<{ id: string; removed: boolean; row: Record<string, unknown> | null; subjectIds: string[] }>;
}

export interface TrashItem {
  id: string; kind: "subject" | "workspace"; title: string; deletedAt: string; expiresAt: string;
  holds: { subjects: number; topics: number; dates: number };
}

// What is about to go, read inside the delete's transaction before it goes.
export async function snapshotIn(tx: Tx, profileId: string, going: { subjectIds: string[]; topicIds: string[]; dateIds: string[] }): Promise<Omit<TrashSnapshot, "workspaces">> {
  const [subjects, topics, dates, unfiled, notes, tasks, resources] = await Promise.all([
    tx.novaSubject.findMany({ where: { profileId, id: { in: going.subjectIds } } }),
    tx.novaTopicMastery.findMany({ where: { id: { in: going.topicIds }, subject: { profileId } } }),
    tx.novaExam.findMany({ where: { profileId, id: { in: going.dateIds } } }),
    tx.novaExam.findMany({ where: { profileId, subjectId: { in: going.subjectIds }, id: { notIn: going.dateIds } }, select: { id: true, subjectId: true } }),
    noteFilingIn(tx, profileId, going.subjectIds),
    taskFilingIn(tx, profileId, going.subjectIds),
    resourceFilingIn(tx, profileId, going.subjectIds),
  ]);
  return {
    subjects: subjects as unknown as Array<Record<string, unknown>>,
    topics: topics as unknown as Array<Record<string, unknown>>,
    dates: dates as unknown as Array<Record<string, unknown>>,
    unfiledDates: unfiled.map((d: { id: string; subjectId: string | null }) => ({ id: d.id, subjectId: d.subjectId!, topicName: null })),
    notes, tasks, resources,
  };
}

export async function trashIn(tx: Tx, profileId: string, item: { kind: "subject" | "workspace"; title: string; snapshot: TrashSnapshot }, now = new Date()): Promise<void> {
  await tx.novaKnowledgeTrash.create({
    data: { profileId, kind: item.kind, title: item.title.slice(0, 200), snapshot: item.snapshot as unknown as JsonInput, deletedAt: now, expiresAt: new Date(now.getTime() + TRASH_KEEP_DAYS * DAY_MS) },
  });
}

const holds = (s: TrashSnapshot) => ({ subjects: s.subjects.length, topics: s.topics.length, dates: s.dates.length });

// What they can bring back: not restored, not expired, newest first.
export async function listTrash(profileId: string, now = new Date()): Promise<TrashItem[]> {
  const rows = await prisma.novaKnowledgeTrash.findMany({
    where: { profileId, restoredAt: null, expiresAt: { gt: now } }, orderBy: { deletedAt: "desc" }, take: 50,
  });
  return rows.map(r => ({
    id: r.id, kind: r.kind === "workspace" ? "workspace" : "subject", title: r.title,
    deletedAt: r.deletedAt.toISOString(), expiresAt: r.expiresAt.toISOString(), holds: holds(r.snapshot as unknown as TrashSnapshot),
  }));
}

export class TrashGone extends Error {}

// Taken for restoring, inside the caller's transaction: a second restore of the
// same item (a double click, two tabs) finds it taken and restores nothing.
export async function claimIn(tx: Tx, profileId: string, id: string, now = new Date()): Promise<{ title: string; snapshot: TrashSnapshot }> {
  const row = await tx.novaKnowledgeTrash.findFirst({ where: { id, profileId, restoredAt: null, expiresAt: { gt: now } } });
  if (!row) throw new TrashGone();
  const taken = await tx.novaKnowledgeTrash.updateMany({ where: { id, profileId, restoredAt: null }, data: { restoredAt: now } });
  if (taken.count !== 1) throw new TrashGone();
  return { title: row.title, snapshot: row.snapshot as unknown as TrashSnapshot };
}

const asDate = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

// The copy put back, with the same ids. A subject whose name is taken now (they
// made another one since) comes back as "Name (restored)". A subject inside one
// that is gone, and not coming back, comes back at the top.
export async function putBackIn(tx: Tx, profileId: string, s: TrashSnapshot): Promise<{ renamed: string[] }> {
  const renamed: string[] = [];
  const existing = new Set((await tx.novaSubject.findMany({ where: { profileId }, select: { name: true, id: true } })).map((x: { name: string }) => x.name.toLowerCase()));
  const liveIds = new Set((await tx.novaSubject.findMany({ where: { profileId }, select: { id: true } })).map((x: { id: string }) => x.id));
  const back = new Set(s.subjects.map(x => x.id as string));
  // Parents before children, so every parentId points at a row that exists.
  const order: Array<Record<string, unknown>> = [];
  const placed = new Set<string>();
  for (let guard = 0; order.length < s.subjects.length && guard < s.subjects.length + 1; guard++) {
    for (const x of s.subjects) {
      const id = x.id as string, parent = (x.parentId as string | null) ?? null;
      if (placed.has(id)) continue;
      if (!parent || placed.has(parent) || !back.has(parent)) { order.push(x); placed.add(id); }
    }
  }
  for (const x of order) {
    let name = x.name as string;
    if (existing.has(name.toLowerCase())) {
      let n = 1;
      const base = `${name} (restored)`;
      name = base;
      while (existing.has(name.toLowerCase())) name = `${base} ${++n}`;
      renamed.push(name);
    }
    existing.add(name.toLowerCase());
    const parent = (x.parentId as string | null) ?? null;
    await tx.novaSubject.create({ data: {
      id: x.id as string, profileId, name, code: (x.code as string | null) ?? null, credits: (x.credits as number | null) ?? null,
      subjectType: (x.subjectType as string | null) ?? null, isWeak: !!x.isWeak, isStrong: !!x.isStrong,
      parentId: parent && (back.has(parent) || liveIds.has(parent)) ? parent : null, createdAt: asDate(x.createdAt) ?? undefined,
    } });
  }
  // Topics: parents before children too, inside a subject that is there.
  const subjectsNow = new Set((await tx.novaSubject.findMany({ where: { profileId }, select: { id: true } })).map((x: { id: string }) => x.id));
  const topicsBack = new Set(s.topics.map(t => t.id as string));
  const done = new Set<string>();
  const pending = s.topics.filter(t => subjectsNow.has(t.subjectId as string));
  for (let guard = 0; pending.some(t => !done.has(t.id as string)) && guard < s.topics.length + 1; guard++) {
    for (const t of pending) {
      const id = t.id as string, parent = (t.parentId as string | null) ?? null;
      if (done.has(id) || (parent && topicsBack.has(parent) && !done.has(parent))) continue;
      await tx.novaTopicMastery.create({ data: {
        id, subjectId: t.subjectId as string, name: t.name as string,
        masteryProbability: (t.masteryProbability as number) ?? 0, confidenceReported: (t.confidenceReported as number) ?? 0,
        efFactor: (t.efFactor as number) ?? 2.5, intervalDays: (t.intervalDays as number) ?? 1, reviewCount: (t.reviewCount as number) ?? 0,
        lastStudiedAt: asDate(t.lastStudiedAt), nextReviewAt: asDate(t.nextReviewAt), archivedAt: asDate(t.archivedAt),
        parentId: parent && (topicsBack.has(parent) || done.has(parent)) ? parent : null, position: (t.position as number | null) ?? null,
        kind: (t.kind as string | null) ?? null, details: (t.details ?? undefined) as JsonInput | undefined, createdAt: asDate(t.createdAt) ?? undefined,
      } });
      done.add(id);
    }
  }
  // What stayed, filed back where it was, only if it is still filed nowhere.
  const live = (f: Filing[]) => f.filter(x => subjectsNow.has(x.subjectId));
  await restoreDatesIn(tx, profileId, s.dates, s.unfiledDates, subjectsNow);
  await refileNotesIn(tx, profileId, live(s.notes));
  await refileTasksIn(tx, profileId, live(s.tasks));
  await refileResourcesIn(tx, profileId, live(s.resources));
  return { renamed };
}
