// ─── Build with Nova: versions to look back at and return to ──────────────────
// The only reader and writer of NovaWorkspaceDraftVersion. As a conversation
// goes, each version is kept:
//
//   proposal  a plan (or a change set to something of theirs), Nova's, the
//             learner's own edit, or a restored one
//   built     the records as they stood right after a version was built or
//             applied (a Snapshot, by name)
//
// Restoring never removes a version: it makes a new one from an old one
// (builder.ts restoreVersion), and every version after it stays listed.
// Returning records that exist to an earlier state is never a write here:
// changesToReach works out, by code, the change set that would bring them
// there, which is proposed, checked and approved like any other.
//
// No regex: text is compared by characters (SKILL.md; the no-regex guard).

import { prisma } from "@repo/db/client";
import { planWrites, type WorkspacePlan } from "./workspace-plan";
import { treeOrder } from "./task-tree";
import type { ChangeSet, WorkspaceDetail } from "./builder.types";

import type { Snapshot, VersionAuthor, VersionItem, VersionKind } from "./builder.types";
export type { Snapshot, SnapshotTask, VersionAuthor, VersionItem, VersionKind } from "./builder.types";

// A learner's edits a short while apart are one version, not one per keystroke.
export const EDITS_MERGE_MS = 90_000;
export const VERSIONS_KEPT = 80;

// ── Recording ─────────────────────────────────────────────────────────────────

export async function recordVersion(input: { draftId: string; profileId: string; version: number; kind: VersionKind; author: VersionAuthor; summary: string; content: unknown }): Promise<void> {
  try {
    const content = input.content as object;
    const summary = input.summary.slice(0, 600);
    // The learner's own edits, saved as they type: one version while they keep going.
    if (input.author === "you" && input.kind === "proposal") {
      const last = await prisma.novaWorkspaceDraftVersion.findFirst({ where: { draftId: input.draftId }, orderBy: { createdAt: "desc" }, select: { id: true, author: true, kind: true, updatedAt: true } });
      if (last && last.author === "you" && last.kind === "proposal" && Date.now() - last.updatedAt.getTime() < EDITS_MERGE_MS) {
        await prisma.novaWorkspaceDraftVersion.update({ where: { id: last.id }, data: { version: input.version, content, summary } });
        return;
      }
    }
    await prisma.novaWorkspaceDraftVersion.createMany({ data: [{ draftId: input.draftId, profileId: input.profileId, version: input.version, kind: input.kind, author: input.author, summary, content }], skipDuplicates: true });
    const old = await prisma.novaWorkspaceDraftVersion.findMany({ where: { draftId: input.draftId }, orderBy: { createdAt: "desc" }, skip: VERSIONS_KEPT, select: { id: true } });
    if (old.length) await prisma.novaWorkspaceDraftVersion.deleteMany({ where: { id: { in: old.map(o => o.id) } } });
  } catch (err) {
    // A version that could not be kept loses history, never the work.
    console.error(JSON.stringify({ layer: "nova_builder", event: "version_not_recorded", reason: (err as Error)?.name ?? "error" }));
  }
}

const KINDS: readonly VersionKind[] = ["proposal", "built"];
const AUTHORS: readonly VersionAuthor[] = ["nova", "you", "restored"];
const itemOf = (r: { id: string; version: number; kind: string; author: string; summary: string; createdAt: Date }): VersionItem => ({
  id: r.id, version: r.version, kind: KINDS.find(k => k === r.kind) ?? "proposal", author: AUTHORS.find(a => a === r.author) ?? "nova",
  summary: r.summary, createdAt: r.createdAt.toISOString(),
});

export async function listVersions(profileId: string, draftId: string): Promise<VersionItem[]> {
  const rows = await prisma.novaWorkspaceDraftVersion.findMany({
    where: { draftId, profileId }, orderBy: [{ createdAt: "desc" }], take: VERSIONS_KEPT,
    select: { id: true, version: true, kind: true, author: true, summary: true, createdAt: true },
  });
  return rows.map(itemOf);
}

export async function versionById(profileId: string, draftId: string, id: unknown): Promise<{ item: VersionItem; content: unknown } | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  const row = await prisma.novaWorkspaceDraftVersion.findFirst({ where: { id, draftId, profileId } });
  return row ? { item: itemOf(row), content: row.content } : null;
}

// What a stored proposal holds.
export function readProposal(content: unknown): { plan: WorkspacePlan } | { changes: ChangeSet; title: string } | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const c = content as Record<string, unknown>;
  if (c.changes && typeof c.changes === "object" && Array.isArray((c.changes as ChangeSet).ops)) return { changes: c.changes as ChangeSet, title: typeof c.title === "string" ? c.title : "" };
  if (typeof c.title === "string" && Array.isArray(c.tasks) && Array.isArray(c.subjects)) return { plan: c as unknown as WorkspacePlan };
  return null;
}

export function readSnapshot(content: unknown): Snapshot | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const c = content as Partial<Snapshot>;
  if (typeof c.title !== "string" || !Array.isArray(c.subjects) || !Array.isArray(c.tasks)) return null;
  return { title: c.title, subjects: c.subjects, tasks: c.tasks, dates: Array.isArray(c.dates) ? c.dates : [], notes: Array.isArray(c.notes) ? c.notes : [] };
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// The records as they are now (read through their owners by the caller).
// A note's text comes from the plan that wrote it, when there is one.
export function snapshotOf(d: WorkspaceDetail, plan: WorkspacePlan | null = null): Snapshot {
  const subjectName = (id: string | null) => (id ? d.subjects.find(s => s.id === id)?.name ?? null : null);
  const written = plan ? planWrites(plan).notes : [];
  return {
    title: d.title,
    // Where each subject sat; one inside a subject that isn't part of this is left unsaid (not moved back).
    subjects: d.subjects.map(s => {
      const parent = s.parentId ? d.subjects.find(x => x.id === s.parentId)?.name : null;
      return { name: s.name, topics: s.topics.map(t => t.name), ...(parent !== undefined ? { parent } : {}) };
    }),
    tasks: d.tasks.map(t => ({
      key: t.id, title: t.title, status: t.status, priority: t.priority, dueDay: t.dueDay, subject: subjectName(t.subjectId), topic: t.topicName,
      parent: t.parentId && d.tasks.some(x => x.id === t.parentId) ? t.parentId : null,
    })),
    dates: d.dates.map(x => ({ title: x.title, day: x.day, kind: x.kind, subject: subjectName(x.subjectId) })),
    notes: d.notes.map(n => ({ title: n.title, subject: subjectName(n.subjectId), body: written.find(w => low(w.title) === low(n.title))?.body ?? null })),
  };
}

// What building a plan makes, by name.
export function snapshotOfPlan(plan: WorkspacePlan): Snapshot {
  const w = planWrites(plan);
  return {
    title: plan.title,
    subjects: w.subjects.map(s => ({ name: s.name, topics: [...s.topics], parent: s.parent ?? null })),
    tasks: w.tasks.map(t => ({ key: t.key, title: t.title, status: "todo", priority: t.priority, dueDay: t.dueDay, subject: t.subject, topic: t.topic, parent: t.parent ?? null })),
    dates: w.dates.map(d => ({ title: d.title, day: d.day, kind: d.kind, subject: d.subject })),
    notes: w.notes.map(n => ({ title: n.title, subject: n.subject, body: n.body })),
  };
}

// ── The change set that brings the records back to a state ────────────────────
// Raw operations for checkChanges (builder-changes.ts), which keeps only what
// the rules allow and says what it leaves out (a studied topic is never
// removed, a finished task never deleted, no day in the past). Matching is
// by name: a subject by its name, a topic by its name in its subject, a task
// by its title and the titles of the tasks above it (two "Write tests" under
// two features stay two), a date by its title. What can't be brought back
// is said in `notes`.

export interface Reach { ops: Array<Record<string, unknown>>; notes: string[] }

export function changesToReach(current: WorkspaceDetail, target: Snapshot, today: string): Reach {
  const ops: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const subjectByName = (name: string | null) => (name ? current.subjects.find(s => low(s.name) === low(name)) ?? null : null);

  // Subjects, a group before the subjects inside it, so one added can be gone into.
  const subjectKey = new Map<string, string>();
  const placeOf = (parent: string | null | undefined): Record<string, unknown> | undefined => {
    if (parent === undefined) return undefined;
    if (parent === null) return { parentId: null };
    const liveParent = subjectByName(parent);
    if (liveParent) return { parentId: liveParent.id };
    const key = subjectKey.get(low(parent));
    return key ? { parentKey: key } : undefined;
  };
  for (const { item: s } of treeOrder(target.subjects.map(x => ({ ...x, id: low(x.name), parent: x.parent ? low(x.parent) : null })))) {
    const live = subjectByName(s.name);
    const place = placeOf(target.subjects.find(x => low(x.name) === s.id)?.parent);
    if (!live) {
      const key = `rs${subjectKey.size + 1}`;
      subjectKey.set(s.id, key);
      ops.push({ op: "add_subject", key, name: s.name, topics: s.topics, ...(place && (place.parentId || place.parentKey) ? place : {}) });
      continue;
    }
    if (place && ("parentKey" in place || (place.parentId ?? null) !== (live.parentId ?? null))) ops.push({ op: "move_subject", subjectId: live.id, ...place });
    const missing = s.topics.filter(t => !live.topics.some(x => low(x.name) === low(t)));
    if (missing.length) ops.push({ op: "add_topics", subjectId: live.id, names: missing });
    for (const t of live.topics) if (!s.topics.some(x => low(x) === low(t.name))) ops.push({ op: "remove_topic", topicId: t.id });
  }

  // Tasks, by the path of titles from the top.
  const pathOf = (key: string, all: Array<{ key: string; title: string; parent: string | null }>): string => {
    const names: string[] = [];
    let at: string | null = key;
    for (let hops = 0; at && hops < 12; hops++) { const t = all.find(x => x.key === at); if (!t) break; names.unshift(low(t.title)); at = t.parent; }
    return names.join(" / ");
  };
  const live = current.tasks.map(t => ({ key: t.id, title: t.title, parent: t.parentId ?? null }));
  const livePath = new Map(live.map(t => [t.key, pathOf(t.key, live)]));
  const matched = new Map<string, string>();
  const used = new Set<string>();
  for (const t of target.tasks) {
    const p = pathOf(t.key, target.tasks);
    const hit = current.tasks.find(x => !used.has(x.id) && livePath.get(x.id) === p) ?? current.tasks.find(x => !used.has(x.id) && low(x.title) === low(t.title));
    if (hit) { matched.set(t.key, hit.id); used.add(hit.id); }
  }
  const addedKey = new Map<string, string>();
  for (const { item: t } of treeOrder(target.tasks.map(x => ({ ...x, id: x.key })))) {
    const liveId = matched.get(t.key);
    const parentLive = t.parent ? matched.get(t.parent) ?? null : null;
    const parentAdded = t.parent && !parentLive ? addedKey.get(t.parent) ?? null : null;
    if (liveId) {
      const x = current.tasks.find(k => k.id === liveId)!;
      if (x.status === "done") continue;
      const change: Record<string, unknown> = {};
      const due = t.dueDay === null ? null : t.dueDay >= today ? t.dueDay : x.dueDay;
      if (x.dueDay !== due) change.dueDay = due;
      if (x.priority !== t.priority) change.priority = t.priority;
      if (!parentAdded && (x.parentId ?? null) !== parentLive) change.parentId = parentLive;
      if (Object.keys(change).length) ops.push({ op: "update_task", taskId: liveId, ...change });
      continue;
    }
    if (t.status === "done") { notes.push(`"${t.title}" was finished then; it isn't made again`); continue; }
    const key = `r${addedKey.size + 1}`;
    addedKey.set(t.key, key);
    ops.push({
      op: "add_task", key, title: t.title, subjectId: subjectByName(t.subject)?.id ?? null, topicName: t.topic,
      dueDay: t.dueDay && t.dueDay >= today ? t.dueDay : null, priority: t.priority,
      ...(parentLive ? { parentId: parentLive } : parentAdded ? { parentKey: parentAdded } : {}),
    });
  }
  const kept = new Set(matched.values());
  // Only tops of what goes: a task's steps go with it.
  const going = current.tasks.filter(t => t.status !== "done" && !kept.has(t.id));
  for (const t of going) if (!t.parentId || !going.some(g => g.id === t.parentId)) ops.push({ op: "remove_task", taskId: t.id });

  for (const d of target.dates) {
    const x = current.dates.find(k => low(k.title) === low(d.title));
    if (!x) { if (d.day >= today) ops.push({ op: "add_date", title: d.title, day: d.day, subjectId: subjectByName(d.subject)?.id ?? null, kind: d.kind }); else notes.push(`the date "${d.title}" has passed`); }
    else if (x.day !== d.day) { if (d.day >= today) ops.push({ op: "update_date", dateId: x.id, day: d.day }); else notes.push(`"${d.title}" can't move back to ${d.day}, which has passed`); }
  }
  for (const d of current.dates) if (!target.dates.some(x => low(x.title) === low(d.title))) ops.push({ op: "remove_date", dateId: d.id });

  // Notes are never removed by going back; one that is gone comes back when its text is known.
  for (const n of target.notes) {
    if (current.notes.some(x => low(x.title) === low(n.title))) continue;
    if (n.body) ops.push({ op: "add_note", title: n.title, body: n.body, subjectId: subjectByName(n.subject)?.id ?? null, topicName: null });
    else notes.push(`the note "${n.title}" can't be brought back (its text isn't kept)`);
  }

  // Subjects that are not in that state go last, after their topics.
  for (const s of current.subjects) if (!target.subjects.some(x => low(x.name) === low(s.name))) ops.push({ op: "remove_subject", subjectId: s.id });
  return { ops, notes: notes.slice(0, 8) };
}
