// ─── Workspaces ───────────────────────────────────────────────────────────────
// The only reader and writer of NovaWorkspace. Creating a workspace writes
// its subjects, topics, dates, tasks and notes through their own owners
// (setup.ts, exams.ts, tasks.ts, notes.ts), all in one transaction with the
// workspace row: it is made whole or not at all.
//
//   - The plan is checked again here (checkWorkspacePlan): the page's copy is
//     the learner's edit, never trusted as it comes.
//   - One creation per clientKey (unique per learner): a double click, a
//     retry or a second tab gets the workspace that exists.
//   - A new workspace like one the learner has (same template, or same name)
//     is not made until they say so (confirmAnother); they may instead add
//     to the one they have.
//   - Adding to a workspace merges: subjects by name, topics once, tasks by
//     key, notes only where no note of theirs has that title. Nothing the
//     learner has is changed or removed.
//   - The learner is the one behind the session; a workspace id from the
//     request is used only together with their profile.
//
// The workspace row owns no learning data. Its subjects keep living in
// Knowledge, the Map and the Planner whatever happens to it.

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { checkWorkspacePlan, planWrites, type WorkspacePlan } from "./workspace-plan";
import { templateById } from "./templates";
import { declareWorkspaceSubjectsIn, ensureSetupProfile } from "./setup";
import { addDatesIn } from "./exams";
import { createTasksIn } from "./tasks";
import { createNotesIn, listNoteTitlesIn, removeNotesIn } from "./notes";
import { subjectsForMatching, subjectsWithTopics } from "./setup";
import { TaskChanged, listTasksInSubjects, listTasksWithKeyPrefix, placeTasksIn, removeOpenTasksIn, updateTasksIn } from "./tasks";
import { DateChanged, listExams, removeDatesIn, unfileDatesIn, updateDatesIn } from "./exams";
import { StaleStructure, checkStudyEdits, loadStudyStructure, playStudyEditsIn } from "./setup-edit";
import type { StudyEdit } from "./setup-edit.types";
import { bareOps, checkChanges, type ResourceCandidates } from "./builder-changes";
import type { CreateWorkspaceResponse, WorkspaceSummary, WorkspacesView } from "./workspaces.types";
import type { ChangeOp, ChangeSet, ResourceRef, WorkspaceDetail } from "./builder.types";

export const WORKSPACES_MAX = 100;
const KEY_MIN = 8, KEY_MAX = 64;

const SUMMARY_SELECT = { id: true, kind: true, templateId: true, title: true, summary: true, createdAt: true, subjectIds: true } as const;
type Row = { id: string; kind: string; templateId: string | null; title: string; summary: string | null; createdAt: Date; subjectIds: string[] };

async function summaries(profileId: string, rows: Row[]): Promise<WorkspaceSummary[]> {
  const ids = [...new Set(rows.flatMap(r => r.subjectIds))];
  const subjects = ids.length ? await prisma.novaSubject.findMany({ where: { profileId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  return rows.map(r => ({
    id: r.id, kind: r.kind === "template" ? "template" : "custom", templateId: r.templateId,
    templateName: r.templateId ? templateById(r.templateId)?.name ?? null : null,
    title: r.title, summary: r.summary, createdAt: r.createdAt.toISOString(),
    subjects: r.subjectIds.flatMap(id => subjects.filter(s => s.id === id)),
  }));
}

export async function listWorkspaces(profileId: string): Promise<WorkspacesView> {
  const rows = await prisma.novaWorkspace.findMany({ where: { profileId }, select: SUMMARY_SELECT, orderBy: { createdAt: "desc" }, take: WORKSPACES_MAX });
  return { status: "ready", workspaces: await summaries(profileId, rows) };
}

// Workspaces of theirs a plan would repeat: made from the same template, or
// with the same name.
export async function similarWorkspaces(profileId: string, plan: Pick<WorkspacePlan, "templateId" | "title">): Promise<WorkspaceSummary[]> {
  const rows = await prisma.novaWorkspace.findMany({
    where: { profileId, OR: [...(plan.templateId ? [{ templateId: plan.templateId }] : []), { title: { equals: plan.title, mode: "insensitive" as const } }] },
    select: SUMMARY_SELECT, orderBy: { createdAt: "desc" }, take: 5,
  });
  return summaries(profileId, rows);
}

export interface CreateInput {
  plan:            unknown;
  clientKey:       unknown;
  // Add to this workspace of theirs instead of making a new one.
  addTo?:          unknown;
  // They have seen the similar ones and want another.
  confirmAnother?: unknown;
}

const validKey = (v: unknown): v is string =>
  typeof v === "string" && v.length >= KEY_MIN && v.length <= KEY_MAX && [...v].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_");

export async function createWorkspace(platformChatId: string, input: CreateInput, now = new Date()): Promise<CreateWorkspaceResponse> {
  if (!validKey(input.clientKey)) return { ok: false, error: "invalid", message: "That request is missing its key. Reload and try again." };
  const ensured = await ensureSetupProfile(platformChatId);
  if (!ensured) return { ok: false, error: "not_ready", message: "Finish setting up with Nova first." };
  const { profileId } = ensured;
  const clientKey = input.clientKey;

  // The same request again: what it made.
  const before = await prisma.novaWorkspace.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select: SUMMARY_SELECT });
  if (before) return { ok: true, status: "exists", workspace: (await summaries(profileId, [before]))[0]! };

  const today = dayKey(now, resolveTimezone(ensured.timezone));
  const raw = input.plan as Record<string, unknown> | null;
  // Sources and links the learner's own plan names are theirs to keep: the
  // files were read when the plan was proposed, and are not sent again.
  const files = Array.isArray(raw?.sources) ? (raw!.sources as Array<{ file?: unknown }>).map(s => (typeof s?.file === "string" ? s.file : "")).filter(Boolean) : [];
  const resources = [
    ...(Array.isArray(raw?.resources) ? raw!.resources : []),
    ...(Array.isArray(raw?.phases) ? (raw!.phases as Array<{ resources?: unknown }>).flatMap(p => (Array.isArray(p?.resources) ? p.resources : [])) : []),
  ] as Array<{ origin?: unknown; url?: unknown }>;
  const userText = resources.filter(r => r?.origin === "user" && typeof r.url === "string").map(r => r.url as string).join(" ");
  const checked = checkWorkspacePlan(input.plan, { today, files, userText });
  if (!checked.ok) return { ok: false, error: "invalid", message: checked.message };
  const plan = checked.plan;
  // A template id must name a template; otherwise it is the learner's own.
  if (plan.kind === "template" && (!plan.templateId || !templateById(plan.templateId))) { plan.kind = "custom"; plan.templateId = null; plan.templateVersion = null; }

  let target: { id: string; clientKey: string; subjectIds: string[] } | null = null;
  if (input.addTo !== undefined && input.addTo !== null) {
    if (typeof input.addTo !== "string") return { ok: false, error: "invalid", message: "That isn't one of your workspaces." };
    target = await prisma.novaWorkspace.findFirst({ where: { id: input.addTo, profileId }, select: { id: true, clientKey: true, subjectIds: true } });
    if (!target) return { ok: false, error: "not_found", message: "That workspace isn't one of yours." };
  } else if (input.confirmAnother !== true) {
    const similar = await similarWorkspaces(profileId, plan);
    if (similar.length > 0) return { ok: true, status: "similar", similar };
    if (await prisma.novaWorkspace.count({ where: { profileId } }) >= WORKSPACES_MAX) {
      return { ok: false, error: "too_many", message: `You have ${WORKSPACES_MAX} workspaces. Remove one before making another.` };
    }
  }

  const writes = planWrites(plan);
  // Tasks are keyed by the workspace they belong to, so adding the same plan
  // to it again makes nothing twice.
  const keyBase = target?.clientKey ?? clientKey;

  try {
    const result = await prisma.$transaction(async tx => {
      const subjects = await declareWorkspaceSubjectsIn(tx, profileId, writes.subjects);
      const idOf = (name: string | null) => (name ? subjects.ids.get(name.toLowerCase()) ?? null : null);
      const dates = await addDatesIn(tx, profileId, writes.dates.map(d => ({ title: d.title, subjectId: idOf(d.subject), kind: d.kind, day: d.day })), today, now);
      const tasks = await createTasksIn(tx, profileId, writes.tasks.map(t => ({
        title: t.title, priority: t.priority, subjectId: idOf(t.subject), topicName: t.topic, dueDay: t.dueDay,
        estimatedMinutes: t.estimatedMinutes, clientKey: `ws:${keyBase}:${t.key}`.slice(0, 120),
        // A step is made under its task (createTasksIn writes parents first).
        ...(t.parent ? { parentKey: `ws:${keyBase}:${t.parent}`.slice(0, 120) } : {}),
      })));
      if (!tasks.ok) throw new RefusedError("too_many", tasks.message);
      const notes = await createNotesIn(tx, profileId, writes.notes.map(n => ({ title: n.title, body: n.body, subjectId: idOf(n.subject), topicName: n.topic })));
      if (!notes.ok) throw new RefusedError("invalid", notes.message);
      const subjectIds = [...new Set([...(target?.subjectIds ?? []), ...subjects.ids.values()])];
      const row = target
        ? await tx.novaWorkspace.update({ where: { id: target.id }, data: { subjectIds }, select: SUMMARY_SELECT })
        : await tx.novaWorkspace.create({
            data: {
              profileId, kind: plan.kind, templateId: plan.templateId, templateVersion: plan.templateVersion, title: plan.title,
              summary: plan.summary || null, plan: plan as unknown as object, clientKey, subjectIds,
              sources: plan.sources.length ? (plan.sources as unknown as object) : undefined,
            },
            select: SUMMARY_SELECT,
          });
      return {
        row,
        counts: {
          subjectsAdded: subjects.subjectsAdded, topicsAdded: subjects.topicsAdded, datesAdded: dates.added, tasksAdded: tasks.added,
          notesAdded: notes.added, notesSkipped: notes.skipped, datesSkipped: dates.skipped.map(d => d.title),
        },
      };
    }, { timeout: 30_000, maxWait: 10_000 });
    return { ok: true, status: target ? "updated" : "created", workspace: (await summaries(profileId, [result.row]))[0]!, counts: result.counts };
  } catch (err) {
    if (err instanceof RefusedError) return { ok: false, error: err.code, message: err.message };
    // Two requests with one key at once: the other made it.
    if ((err as { code?: string } | null)?.code === "P2002") {
      const made = await prisma.novaWorkspace.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select: SUMMARY_SELECT });
      if (made) return { ok: true, status: "exists", workspace: (await summaries(profileId, [made]))[0]! };
    }
    throw err;
  }
}

class RefusedError extends Error {
  constructor(readonly code: "too_many" | "invalid", message: string) { super(message); }
}
// A note a change set removes had already gone.
class NoteChanged extends Error {}

// Their newest workspaces' titles and summaries, for what Nova is told
// (builder.ts): a record of what exists.
export async function recentWorkspaceTitles(profileId: string, take: number): Promise<Array<{ title: string; summary: string | null }>> {
  return prisma.novaWorkspace.findMany({ where: { profileId }, select: { title: true, summary: true }, orderBy: { createdAt: "desc" }, take });
}

// These workspaces of theirs, as summaries, in the order asked.
export async function workspaceSummaries(profileId: string, ids: string[]): Promise<WorkspaceSummary[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.novaWorkspace.findMany({ where: { profileId, id: { in: ids } }, select: SUMMARY_SELECT });
  const list = await summaries(profileId, rows);
  return ids.flatMap(id => list.filter(w => w.id === id));
}

// A workspace as it now is: the real records it made, read through their
// owners. Its tasks are the ones keyed under it (renamed or moved ones as
// they stand, deleted ones gone) and those filed under its subjects; its
// notes and dates are those filed under its subjects. null: not theirs.
export async function workspaceDetail(platformChatId: string, profileId: string, id: string, now = new Date()): Promise<WorkspaceDetail | null> {
  return resourceDetail(platformChatId, profileId, { workspaceId: id, subjectIds: [] }, now);
}

// What a Build with Nova conversation works on, as it is now: a workspace of
// theirs, or subjects that belong to none (their tasks, notes and dates are
// those filed under them). Read through each record's owner, every time, so
// the page shows what is stored and nothing else. null: not theirs.
export async function resourceDetail(platformChatId: string, profileId: string, ref: Pick<ResourceRef, "workspaceId" | "subjectIds">, now = new Date()): Promise<WorkspaceDetail | null> {
  const row = ref.workspaceId ? await prisma.novaWorkspace.findFirst({ where: { id: ref.workspaceId, profileId }, select: { ...SUMMARY_SELECT, clientKey: true, plan: true } }) : null;
  if (ref.workspaceId && !row) return null;
  // What the plan it was built from says about its topics and milestones;
  // the records themselves are read live below. A subject asked for alone
  // takes the outline of a workspace that holds it.
  const built = (row?.plan ?? (ref.subjectIds.length ? (await prisma.novaWorkspace.findFirst({ where: { profileId, subjectIds: { hasSome: ref.subjectIds } }, select: { plan: true }, orderBy: { createdAt: "desc" } }))?.plan : null)) as Partial<WorkspacePlan> | null;
  const subjectIds = row ? row.subjectIds : ref.subjectIds;
  const [summary, subjects, keyed, filed, notes, exams] = await Promise.all([
    row ? summaries(profileId, [row]) : Promise.resolve([]),
    subjectsWithTopics(profileId, subjectIds),
    row ? listTasksWithKeyPrefix(profileId, `ws:${row.clientKey}:`, { now }) : Promise.resolve([]),
    listTasksInSubjects(profileId, subjectIds, { now }),
    listNoteTitlesIn(profileId, subjectIds),
    listExams(platformChatId, now),
  ]);
  if (!row && subjects.length === 0) return null;
  const tasks = [...keyed, ...filed.filter(t => !keyed.some(k => k.id === t.id))];
  const names = new Set(subjects.map(s => s.name.toLowerCase()));
  const planned = new Map<string, { unit: string | null; subtopics: string[] }>();
  for (const s of Array.isArray(built?.subjects) ? built!.subjects : []) {
    for (const t of Array.isArray(s?.topics) ? s.topics : []) if (t && typeof t.name === "string") planned.set(`${s.name.toLowerCase()}\n${t.name.toLowerCase()}`, { unit: t.unit ?? null, subtopics: Array.isArray(t.subtopics) ? t.subtopics : [] });
  }
  const live = new Set(subjects.flatMap(s => s.topics.map(t => t.name.toLowerCase())));
  const phases = (Array.isArray(built?.phases) ? built!.phases : [])
    .filter(p => p && typeof p.name === "string" && (live.has(p.name.toLowerCase()) || tasks.some(t => t.topicName?.toLowerCase() === p.name.toLowerCase())))
    .map(p => ({ name: p.name, weeks: p.weeks ?? null, goals: Array.isArray(p.goals) ? p.goals : [], completion: p.completion ?? null }));
  return {
    workspace: summary[0] ?? null,
    title: row?.title ?? subjects.map(s => s.name).join(", "),
    subjects: subjects.map(s => ({ ...s, topics: s.topics.map(t => {
      const p = planned.get(`${s.name.toLowerCase()}\n${t.name.toLowerCase()}`);
      return p ? { ...t, unit: p.unit, ...(p.subtopics.length ? { subtopics: p.subtopics } : {}) } : t;
    }) })),
    ...(phases.length ? { phases } : {}),
    tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDay: t.dueDay, subjectId: t.subjectId, topicName: t.topicName, estimatedMinutes: t.estimatedMinutes, parentId: t.parentId })),
    notes: notes.map(n => ({ id: n.id, title: n.title, subjectId: n.subjectId, updatedAt: n.updatedAt.toISOString() })),
    dates: (exams ?? []).filter(e => e.subjectName && names.has(e.subjectName.toLowerCase()))
      .map(e => ({ id: e.id, title: e.title, day: e.date, kind: e.type, subjectId: subjects.find(s => s.name.toLowerCase() === e.subjectName!.toLowerCase())?.id ?? null })),
  };
}

// Their workspaces and subjects, for finding the one a name refers to.
export async function resourceCandidates(profileId: string): Promise<ResourceCandidates> {
  const [workspaces, subjects] = await Promise.all([
    prisma.novaWorkspace.findMany({ where: { profileId }, select: { id: true, title: true, subjectIds: true }, orderBy: { createdAt: "desc" }, take: WORKSPACES_MAX }),
    subjectsForMatching(profileId),
  ]);
  return { workspaces, subjects };
}

// Topics of theirs with recorded study: renamed, never removed.
export async function studiedTopicIds(profileId: string): Promise<Set<string>> {
  const s = await loadStudyStructure(profileId);
  return new Set(s.subjects.flatMap(x => x.topics.filter(t => t.hasHistory).map(t => t.id)));
}

// ── Changing what they have (Build with Nova, after approval) ─────────────────
// An approved change set, applied in one transaction through each record's
// own writer: topics through study setup's edit batch (playStudyEditsIn, the
// same rules and lock as Subject Studio), tasks, dates and notes through
// theirs. Checked again first against the records as they are now: a record
// a change names that has gone, or a change the rules now refuse, stops the
// whole set and nothing is written. Additions that are already there are
// left out, so applying a set again adds nothing twice (tasks are keyed by
// the change set, notes and dates are never added twice).

export type ChangeResult =
  // deleted: the workspace itself is gone (detail null).
  | { ok: true; detail: WorkspaceDetail | null; title: string; deleted: boolean; counts: { added: number; changed: number; removed: number }; subjectIds: string[] }
  | { ok: false; error: "not_found" | "changed" | "too_many" | "invalid"; message: string };

const target = (o: ChangeOp): string | null =>
  o.op === "rename_topic" || o.op === "remove_topic" ? `topic:${o.topicId}`
  : o.op === "update_task" || o.op === "remove_task" ? `task:${o.taskId}`
  : o.op === "update_date" ? `date:${o.dateId}` : o.op === "order_tasks" ? `order:${o.taskIds.join(",")}`
  : o.op === "remove_subject" ? `subject:${o.subjectId}` : o.op === "remove_date" ? `date:${o.dateId}`
  : o.op === "remove_note" ? `note:${o.noteId}` : o.op === "remove_workspace" ? `workspace:${o.workspaceId}` : null;

export async function changeResource(
  platformChatId: string,
  input: { ref: Pick<ResourceRef, "workspaceId" | "subjectIds">; set: ChangeSet; key: string },
  now = new Date(),
): Promise<ChangeResult> {
  const ensured = await ensureSetupProfile(platformChatId);
  if (!ensured) return { ok: false, error: "not_found", message: "Finish setting up with Nova first." };
  const { profileId } = ensured;
  const today = dayKey(now, resolveTimezone(ensured.timezone));
  const row = input.ref.workspaceId ? await prisma.novaWorkspace.findFirst({ where: { id: input.ref.workspaceId, profileId }, select: { id: true, clientKey: true, subjectIds: true } }) : null;
  if (input.ref.workspaceId && !row) return { ok: false, error: "not_found", message: "That workspace isn't one of yours any more." };
  const current = await resourceDetail(platformChatId, profileId, input.ref, now);
  if (!current) return { ok: false, error: "not_found", message: "Those subjects aren't yours any more." };
  const structure = await loadStudyStructure(profileId);
  const studied = new Set(structure.subjects.flatMap(x => x.topics.filter(t => t.hasHistory).map(t => t.id)));
  const again = checkChanges(bareOps(input.set), current, { today, studied });
  // A change or removal that no longer holds stops everything.
  const lost = input.set.ops.filter(o => target(o) !== null && !again.ops.some(a => target(a) === target(o)));
  if (lost.length > 0) {
    return { ok: false, error: "changed", message: `Since Nova proposed this, ${lost.map(o => o.says.charAt(0).toLowerCase() + o.says.slice(1)).slice(0, 2).join("; ")} no longer fits what's there. Nothing was changed; ask Nova again.` };
  }
  const ops = again.ops;
  const edits: StudyEdit[] = ops.flatMap((o): StudyEdit[] => (
    o.op === "add_topics" ? [{ op: "add_topics", subjectId: o.subjectId, names: o.names }]
    : o.op === "add_subject" ? [{ op: "add_subject", name: o.name, topics: o.topics }]
    : o.op === "rename_topic" ? [{ op: "rename_topic", topicId: o.topicId, name: o.name }]
    : o.op === "remove_topic" ? [{ op: "remove_topic", topicId: o.topicId }] : []))
    // A subject is removed once its topics are gone.
    .concat(ops.flatMap((o): StudyEdit[] => (o.op === "remove_subject" ? [{ op: "remove_subject", subjectId: o.subjectId }] : [])));
  // Dates go before the subjects they belong to: past ones, never listed, are kept unfiled.
  const goingSubjects = ops.flatMap(o => (o.op === "remove_subject" ? [o.subjectId] : []));
  const checkable = { ...structure, subjects: structure.subjects.map(x => (goingSubjects.includes(x.id) ? { ...x, dates: 0 } : x)) };
  if (checkStudyEdits(checkable, edits).issues.length > 0) {
    return { ok: false, error: "changed", message: "Your subjects changed since Nova proposed this. Nothing was changed; ask Nova again." };
  }
  const prefix = row ? `ws:${row.clientKey}:${input.key}-` : `nb:${input.key}-`;
  const pick = <K extends ChangeOp["op"]>(k: K) => ops.filter((o): o is Extract<typeof o, { op: K }> => o.op === k);
  try {
    const subjectIds = await prisma.$transaction(async tx => {
      await removeDatesIn(tx, profileId, pick("remove_date").map(o => o.dateId));
      await unfileDatesIn(tx, profileId, goingSubjects);
      await playStudyEditsIn(tx, profileId, edits, structure.version);
      // A subject added here belongs to the workspace from now on.
      const added = pick("add_subject").length
        ? await tx.novaSubject.findMany({ where: { profileId, name: { in: pick("add_subject").map(o => o.name), mode: "insensitive" } }, select: { id: true } })
        : [];
      const gone = new Set(pick("remove_subject").map(o => o.subjectId));
      const ids = [...new Set([...(row?.subjectIds ?? input.ref.subjectIds), ...added.map(a => a.id)])].filter(id => !gone.has(id));
      const made = await createTasksIn(tx, profileId, pick("add_task").map(o => ({
        title: o.title, priority: o.priority, subjectId: o.subjectId, topicName: o.topicName, dueDay: o.dueDay, clientKey: `${prefix}${o.key}`.slice(0, 120),
        ...(o.parentId ? { parentId: o.parentId } : o.parentKey ? { parentKey: `${prefix}${o.parentKey}`.slice(0, 120) } : {}),
      })));
      if (!made.ok) throw new RefusedError("too_many", made.message);
      await updateTasksIn(tx, profileId, pick("update_task").map(({ taskId, title, dueDay, priority, parentId }) => ({ taskId, title, dueDay, priority, parentId })));
      await removeOpenTasksIn(tx, profileId, pick("remove_task").map(o => o.taskId));
      for (const o of pick("order_tasks")) await placeTasksIn(tx, profileId, o.taskIds);
      await addDatesIn(tx, profileId, pick("add_date").map(o => ({ title: o.title, subjectId: o.subjectId, kind: o.kind, day: o.day })), today, now);
      await updateDatesIn(tx, profileId, pick("update_date").map(({ dateId, title, day }) => ({ dateId, title, day })), today, now);
      const notes = await createNotesIn(tx, profileId, pick("add_note").map(o => ({ title: o.title, body: o.body, subjectId: o.subjectId, topicName: o.topicName })));
      if (!notes.ok) throw new RefusedError("invalid", notes.message);
      if (!(await removeNotesIn(tx, profileId, pick("remove_note").map(o => o.noteId)))) throw new NoteChanged();
      // The workspace record last, once everything in it has gone.
      if (row && pick("remove_workspace").length) await tx.novaWorkspace.delete({ where: { id: row.id } });
      else if (row && (ids.length !== row.subjectIds.length || gone.size > 0)) await tx.novaWorkspace.update({ where: { id: row.id }, data: { subjectIds: ids } });
      return ids;
    }, { timeout: 30_000, maxWait: 10_000 });
    const deleted = pick("remove_workspace").length > 0;
    const detail = deleted ? null : await resourceDetail(platformChatId, profileId, row ? { workspaceId: row.id, subjectIds: [] } : { workspaceId: null, subjectIds }, now);
    // Items, not operations: two topics added in one go are two added.
    const count = (e: string) => ops.filter(o => o.effect === e).reduce((n, o) => n + (o.op === "add_topics" ? o.names.length : 1), 0);
    return { ok: true, detail, title: current.title, deleted, subjectIds, counts: { added: count("add"), changed: count("change"), removed: count("remove") } };
  } catch (err) {
    if (err instanceof RefusedError) return { ok: false, error: err.code, message: err.message };
    if (err instanceof StaleStructure || err instanceof TaskChanged || err instanceof DateChanged || err instanceof NoteChanged || (err as { code?: string } | null)?.code === "P2002" || (err as { code?: string } | null)?.code === "P2025") {
      return { ok: false, error: "changed", message: "Something here changed while this was being saved. Nothing was changed; ask Nova again." };
    }
    throw err;
  }
}

// Removing a workspace removes its record only. Its subjects, topics, notes
// and tasks are the learner's and stay; they are edited where they live.
export async function removeWorkspace(profileId: string, id: string): Promise<boolean> {
  return (await prisma.novaWorkspace.deleteMany({ where: { id, profileId } })).count === 1;
}
