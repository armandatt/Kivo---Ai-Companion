// ─── Build with Nova: versions to look back at and return to ──────────────────
// The only reader and writer of NovaWorkspaceDraftVersion. A conversation's
// work is recorded as it goes:
//
//   proposal  each version of the proposal, Nova's, the learner's or a
//             restored one: the plan, or the change set to something of theirs
//   applied   the workspace's records as they stood after a version was built
//             or applied
//   deleted   the records as they stood just before a confirmed deletion
//
// A snapshot is written only after what it records was stored (the caller
// passes what it just wrote), so it is never of something that did not
// exist. Restoring never removes a snapshot: it makes a new version from an
// old one (builder.ts restoreVersion), and the versions after it stay listed.
//
// Returning the workspace itself to an earlier state is never a write here:
// changesToReach works out, by code, the change set that would bring the
// records as they are now to that state, and it is proposed and approved
// like any other change set (checked against the records, applied through
// each record's owner, all or nothing).
//
// No regex: text is compared by characters (SKILL.md; the no-regex guard).

import { prisma } from "@repo/db/client";
import { oneLine, planWrites, type WorkspacePlan } from "./workspace-plan";
import { parentsFirst, treeOrder } from "./task-tree";
import type { ChangeSet, WorkspaceDetail } from "./builder.types";

export const LEARNER_VERSIONS_KEPT = 40;

export type VersionKind = "proposal" | "applied" | "deleted";
export type VersionAuthor = "nova" | "learner" | "restore" | "build" | "delete";

// The records of a workspace, by name: enough to compare with what is there
// later and to build it again.
export interface StateTask {
  key: string; title: string; status: "todo" | "in_progress" | "done"; priority: "low" | "medium" | "high" | null;
  dueDay: string | null; subject: string | null; topic: string | null; parent: string | null;
  description: string | null; estimatedMinutes: number | null;
}
export interface WorkspaceState {
  title:    string;
  subjects: Array<{ name: string; topics: string[] }>;
  tasks:    StateTask[];
  dates:    Array<{ title: string; day: string; kind: string; subject: string | null }>;
  // A note's text is kept only where it is known without reading the learner's
  // notes: the ones a plan wrote.
  notes:    Array<{ title: string; subject: string | null; body: string | null }>;
  // The plan the workspace was built from, when it had one: restoring a
  // deleted workspace builds it from this.
  plan?:    WorkspacePlan | null;
}

export interface VersionItem {
  id:        string;
  version:   number;
  kind:      VersionKind;
  author:    VersionAuthor;
  summary:   string;
  createdAt: string;
  // In words, what restoring it would do (builder.ts decides what it may do).
  title:     string;
}

// ── Recording ─────────────────────────────────────────────────────────────────

export async function recordVersion(input: {
  draftId: string; profileId: string; version: number; kind: VersionKind; author: VersionAuthor; summary: string; content: unknown;
}): Promise<void> {
  try {
    await prisma.novaWorkspaceDraftVersion.createMany({
      data: [{ draftId: input.draftId, profileId: input.profileId, version: input.version, kind: input.kind, author: input.author, summary: input.summary.slice(0, 600), content: input.content as object }],
      skipDuplicates: true,
    });
    // The learner's own edits save as they type: only the newest are kept.
    if (input.author === "learner") {
      const old = await prisma.novaWorkspaceDraftVersion.findMany({
        where: { draftId: input.draftId, author: "learner" }, orderBy: { createdAt: "desc" }, skip: LEARNER_VERSIONS_KEPT, select: { id: true },
      });
      if (old.length) await prisma.novaWorkspaceDraftVersion.deleteMany({ where: { id: { in: old.map(o => o.id) } } });
    }
  } catch (err) {
    // A snapshot that could not be written loses history, never the work.
    console.error(JSON.stringify({ layer: "nova_builder", event: "version_not_recorded", reason: (err as Error)?.name ?? "error" }));
  }
}

const VERSION_TITLE: Record<VersionKind, (v: number, author: VersionAuthor) => string> = {
  proposal: (v, a) => `Version ${v}${a === "learner" ? " · your edit" : a === "restore" ? " · restored" : ""}`,
  applied:  v => `Version ${v} · built into your workspace`,
  deleted:  () => "Before it was deleted",
};

export async function listVersions(profileId: string, draftId: string): Promise<VersionItem[]> {
  const rows = await prisma.novaWorkspaceDraftVersion.findMany({
    where: { draftId, profileId }, orderBy: [{ createdAt: "desc" }], take: 80,
    select: { id: true, version: true, kind: true, author: true, summary: true, createdAt: true },
  });
  return rows.map(r => {
    const kind = (["proposal", "applied", "deleted"] as const).find(k => k === r.kind) ?? "proposal";
    const author = (["nova", "learner", "restore", "build", "delete"] as const).find(a => a === r.author) ?? "nova";
    return { id: r.id, version: r.version, kind, author, summary: r.summary, createdAt: r.createdAt.toISOString(), title: VERSION_TITLE[kind](r.version, author) };
  });
}

// Every version's content, by id, for saying what restoring each would do.
export async function versionContents(profileId: string, draftId: string): Promise<Map<string, unknown>> {
  const rows = await prisma.novaWorkspaceDraftVersion.findMany({ where: { draftId, profileId }, select: { id: true, content: true }, orderBy: { createdAt: "desc" }, take: 80 });
  return new Map(rows.map(r => [r.id, r.content]));
}

export async function versionById(profileId: string, draftId: string, id: unknown): Promise<{ item: VersionItem; content: unknown } | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  const row = await prisma.novaWorkspaceDraftVersion.findFirst({ where: { id, draftId, profileId } });
  if (!row) return null;
  const item = (await listVersions(profileId, draftId)).find(v => v.id === row.id) ?? {
    id: row.id, version: row.version, kind: row.kind as VersionKind, author: row.author as VersionAuthor, summary: row.summary, createdAt: row.createdAt.toISOString(),
    title: VERSION_TITLE[(row.kind as VersionKind) ?? "proposal"]?.(row.version, row.author as VersionAuthor) ?? `Version ${row.version}`,
  };
  return { item, content: row.content };
}

// What a stored proposal snapshot holds.
export function readProposal(content: unknown): { plan: WorkspacePlan } | { changes: ChangeSet; title: string } | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const c = content as Record<string, unknown>;
  if (c.changes && typeof c.changes === "object" && Array.isArray((c.changes as ChangeSet).ops)) return { changes: c.changes as ChangeSet, title: typeof c.title === "string" ? c.title : "" };
  if (typeof c.title === "string" && Array.isArray(c.tasks) && Array.isArray(c.subjects)) return { plan: c as unknown as WorkspacePlan };
  return null;
}

export function readState(content: unknown): WorkspaceState | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const c = content as Partial<WorkspaceState>;
  if (typeof c.title !== "string" || !Array.isArray(c.subjects) || !Array.isArray(c.tasks)) return null;
  return { title: c.title, subjects: c.subjects, tasks: c.tasks, dates: Array.isArray(c.dates) ? c.dates : [], notes: Array.isArray(c.notes) ? c.notes : [], plan: c.plan ?? null };
}

// ── States ────────────────────────────────────────────────────────────────────

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// The records as they are now (read through their owners by the caller).
export function stateFromDetail(d: WorkspaceDetail, plan: WorkspacePlan | null = null): WorkspaceState {
  const subjectName = (id: string | null) => (id ? d.subjects.find(s => s.id === id)?.name ?? null : null);
  const planNotes = plan ? planWrites(plan).notes : [];
  return {
    title: d.title,
    subjects: d.subjects.map(s => ({ name: s.name, topics: s.topics.map(t => t.name) })),
    tasks: d.tasks.map(t => ({
      key: t.id, title: t.title, status: t.status, priority: t.priority, dueDay: t.dueDay, subject: subjectName(t.subjectId), topic: t.topicName,
      parent: t.parentId && d.tasks.some(x => x.id === t.parentId) ? t.parentId : null, description: t.description, estimatedMinutes: t.estimatedMinutes,
    })),
    dates: d.dates.map(x => ({ title: x.title, day: x.day, kind: x.kind, subject: subjectName(x.subjectId) })),
    notes: d.notes.map(n => ({ title: n.title, subject: subjectName(n.subjectId), body: planNotes.find(p => low(p.title) === low(n.title))?.body ?? null })),
    plan,
  };
}

// What building a plan makes, as records by name.
export function stateFromPlan(plan: WorkspacePlan): WorkspaceState {
  const w = planWrites(plan);
  return {
    title: plan.title,
    subjects: w.subjects.map(s => ({ name: s.name, topics: [...s.topics] })),
    tasks: w.tasks.map(t => ({
      key: t.key, title: t.title, status: "todo", priority: t.priority, dueDay: t.dueDay, subject: t.subject, topic: t.topic,
      parent: t.parent ?? null, description: t.description ?? null, estimatedMinutes: t.estimatedMinutes,
    })),
    dates: w.dates.map(d => ({ title: d.title, day: d.day, kind: d.kind, subject: d.subject })),
    notes: w.notes.map(n => ({ title: n.title, subject: n.subject, body: n.body })),
    plan,
  };
}

// A plan that builds a state again (a workspace that was deleted): its
// subjects, tasks with their steps, dates and the notes whose text is known.
export function planFromState(s: WorkspaceState, today: string): Record<string, unknown> {
  if (s.plan) return { ...s.plan };
  return {
    title: s.title, summary: "",
    subjects: s.subjects.map(x => ({ name: x.name, topics: x.topics.map(t => ({ name: t })) })),
    tasks: parentsFirst(s.tasks).filter(t => t.status !== "done").map(t => ({
      key: t.key, title: t.title, priority: t.priority, subject: t.subject, topic: t.topic, parent: t.parent,
      dueDay: t.dueDay && t.dueDay >= today ? t.dueDay : null, estimatedMinutes: t.estimatedMinutes, description: t.description,
    })),
    dates: s.dates.filter(d => d.day >= today),
    notes: s.notes.filter(n => n.body).map((n, i) => ({ key: `n${i + 1}`, title: n.title, subject: n.subject, body: n.body, origin: "nova" })),
  };
}

// ── The change set that brings the records back to a state ────────────────────
// Raw operations for checkChanges (builder-changes.ts), which keeps only what
// the rules allow and says what it leaves out (a topic with study is never
// removed, a finished task never deleted, no date in the past). Matching is
// by name: a subject by its name, a topic by its name in its subject, a task
// by its title (and the tasks it sits under), a date by its title. Steps are
// moved to where they belong before anything is removed, so a step the state
// keeps is never removed with a task it no longer belongs to.

export interface ReachResult { ops: Array<Record<string, unknown>>; notes: string[] }

export function changesToReach(current: WorkspaceDetail, target: WorkspaceState, today: string): ReachResult {
  const ops: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const subjectByName = (name: string | null) => (name ? current.subjects.find(s => low(s.name) === low(name)) ?? null : null);

  // Subjects and topics.
  for (const s of target.subjects) {
    const live = subjectByName(s.name);
    if (!live) { ops.push({ op: "add_subject", name: s.name, topics: s.topics }); continue; }
    const missing = s.topics.filter(t => !live.topics.some(x => low(x.name) === low(t)));
    if (missing.length) ops.push({ op: "add_topics", subjectId: live.id, names: missing });
    for (const t of live.topics) if (!s.topics.some(x => low(x) === low(t.name))) ops.push({ op: "remove_topic", topicId: t.id });
  }

  // Tasks, matched by title within the path of titles above them, so two
  // "Write tests" under different tasks stay two.
  const path = (title: string, parent: string | null, byKey: Map<string, { title: string; parent: string | null }>): string => {
    const names = [low(title)];
    let at = parent, hops = 0;
    while (at && hops++ < 20) { const p = byKey.get(at); if (!p) break; names.unshift(low(p.title)); at = p.parent; }
    return names.join(" / ");
  };
  const liveByKey = new Map(current.tasks.map(t => [t.id, { title: t.title, parent: t.parentId ?? null }]));
  const targetByKey = new Map(target.tasks.map(t => [t.key, { title: t.title, parent: t.parent }]));
  const livePath = new Map(current.tasks.map(t => [t.id, path(t.title, t.parentId ?? null, liveByKey)]));
  // Each target task → the live task it is (by path first, else by title alone, once each).
  const matched = new Map<string, string>();
  const used = new Set<string>();
  for (const t of target.tasks) {
    const p = path(t.title, t.parent, targetByKey);
    const hit = current.tasks.find(x => !used.has(x.id) && livePath.get(x.id) === p) ?? current.tasks.find(x => !used.has(x.id) && low(x.title) === low(t.title));
    if (hit) { matched.set(t.key, hit.id); used.add(hit.id); }
  }
  const updates: Array<Record<string, unknown>> = [];
  const adds: Array<Record<string, unknown>> = [];
  for (const { item: t } of treeOrder(target.tasks)) {
    const liveId = matched.get(t.key);
    const parentLive = t.parent ? matched.get(t.parent) ?? null : null;
    const parentAdded = t.parent && !parentLive ? t.parent : null;
    if (liveId) {
      const live = current.tasks.find(x => x.id === liveId)!;
      const change: Record<string, unknown> = {};
      if (live.status === "done") continue;
      // A day that has passed can't be gone back to; the task keeps the one it has.
      const due = t.dueDay === null ? null : t.dueDay >= today ? t.dueDay : live.dueDay;
      if ((live.dueDay ?? null) !== due) change.dueDay = due;
      if ((live.priority ?? null) !== (t.priority ?? null)) change.priority = t.priority ?? null;
      if (!parentAdded && (live.parentId ?? null) !== parentLive) change.parentId = parentLive;
      if (Object.keys(change).length) updates.push({ op: "update_task", taskId: liveId, ...change });
      continue;
    }
    if (t.status === "done") { notes.push(`"${t.title}" was finished then; it isn't made again`); continue; }
    adds.push({
      op: "add_task", key: `r${adds.length + 1}`, title: t.title, subjectId: subjectByName(t.subject)?.id ?? null, topicName: t.topic,
      dueDay: t.dueDay && t.dueDay >= today ? t.dueDay : null, priority: t.priority, description: t.description,
      ...(parentLive ? { parentId: parentLive } : parentAdded ? { parentKey: `__${parentAdded}` } : {}),
      _target: t.key,
    });
  }
  // A step of a task added here names it by the key it gets in this set.
  for (const a of adds) {
    if (typeof a.parentKey === "string") {
      const parent = adds.find(x => `__${x._target}` === a.parentKey);
      if (parent) a.parentKey = parent.key; else delete a.parentKey;
    }
  }
  for (const a of adds) delete a._target;
  const removals = current.tasks.filter(t => t.status !== "done" && ![...matched.values()].includes(t.id)).map(t => ({ op: "remove_task", taskId: t.id }));
  ops.push(...updates, ...adds, ...removals);

  // Dates.
  for (const d of target.dates) {
    const live = current.dates.find(x => low(x.title) === low(d.title));
    if (!live) { if (d.day >= today) ops.push({ op: "add_date", title: d.title, day: d.day, subjectId: subjectByName(d.subject)?.id ?? null, kind: d.kind }); else notes.push(`the date "${d.title}" has passed`); }
    else if (live.day !== d.day) { if (d.day >= today) ops.push({ op: "update_date", dateId: live.id, day: d.day }); else notes.push(`"${d.title}" can't move back to ${d.day}, which has passed`); }
  }
  for (const d of current.dates) if (!target.dates.some(x => low(x.title) === low(d.title))) ops.push({ op: "remove_date", dateId: d.id });

  // Notes are never removed by a change; one that is gone comes back only
  // when its text is known.
  for (const n of target.notes) {
    if (current.notes.some(x => low(x.title) === low(n.title))) continue;
    if (n.body) ops.push({ op: "add_note", title: n.title, body: n.body, subjectId: subjectByName(n.subject)?.id ?? null, topicName: null });
    else notes.push(`the note "${n.title}" can't be brought back (its text isn't kept)`);
  }
  for (const n of current.notes) if (!target.notes.some(x => low(x.title) === low(n.title))) notes.push(`your note "${n.title}" stays`);

  // Subjects that are not in that state go last, after their topics and dates.
  for (const s of current.subjects) if (!target.subjects.some(x => low(x.name) === low(s.name))) {
    for (const t of s.topics) ops.push({ op: "remove_topic", topicId: t.id });
    ops.push({ op: "remove_subject", subjectId: s.id });
  }
  return { ops, notes: notes.map(n => oneLine(n, 200)).slice(0, 8) };
}
