// ─── Kivo Connect: changes an assistant may make, and how they are applied ────
// A closed vocabulary over Kivo's own records. Nothing here writes a table:
//   subjects and topics   → Subject Studio's versioned batch (setup-edit.ts
//                           applyStudyEdits: all or nothing, against the
//                           structure version read)
//   notes                 → notes.ts createNote / updateNote (guarded on the
//                           version read) / deleteNote
// Kivo's map has no free-form relationship types: an item is inside another
// (subject in subject, topic in topic or subject), a note is filed under a
// subject and topic, or a note links to a note or topic by writing [[its
// name]]. Those are the only connections offered here.
//
// Every applied change is read back afterwards (verify) and the report says
// what was created, updated, skipped and failed, item by item.

import { z } from "zod";
import { applyStudyEdits, checkStudyEdits, loadStudyStructure } from "../nova/product/setup-edit";
import type { StudyEdit, StudyStructure } from "../nova/product/setup-edit.types";
import { createNote, deleteNote, getNote, searchNoteBodies, updateNote } from "../nova/product/notes";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from "../nova/product/notes.types";
import { linkedTitles, linkKey } from "../nova/product/note-links";
import { appendToBody } from "../nova/product/note-capture";
import { flat } from "./similarity";

export const CHANGES_MAX = 60;
// More than this many items changed in one request is a bulk change: preview
// and approval first. Counted in items (a subject, a topic, a note), so a
// tree of forty topics sent as one add_topics is still forty.
export const ORDINARY_MAX = 12;
export const unitsOf = (c: { op: string; names?: string[]; topics?: string[] }) =>
  c.op === "add_topics" ? (c.names?.length ?? 1) : c.op === "add_subject" ? 1 + (c.topics?.length ?? 0) : 1;

const id = z.string().min(1).max(40);
const name = z.string().trim().min(1).max(120);

export const ChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_subject"), name: name.max(80), parentSubjectId: id.optional(), parentSubjectName: name.optional(), topics: z.array(name).max(40).optional() }),
  z.object({ op: z.literal("add_topics"), subjectId: id.optional(), subjectName: name.optional(), names: z.array(name).min(1).max(40), parentTopicId: id.optional(), parentTopicName: name.optional() }),
  z.object({ op: z.literal("describe_topic"), topicId: id, explanation: z.string().trim().min(1).max(2_000) }),
  z.object({ op: z.literal("rename_subject"), subjectId: id, name: name.max(80) }),
  z.object({ op: z.literal("rename_topic"), topicId: id, name }),
  z.object({ op: z.literal("move_subject"), subjectId: id, parentSubjectId: id.nullable().optional(), parentSubjectName: name.optional() }),
  z.object({ op: z.literal("move_topic"), topicId: id, toSubjectId: id.optional(), parentTopicId: id.nullable().optional(), parentTopicName: name.optional() }),
  z.object({ op: z.literal("remove_topic"), topicId: id }),
  z.object({ op: z.literal("remove_subject"), subjectId: id }),
  z.object({ op: z.literal("create_note"), title: z.string().trim().min(1).max(NOTE_TITLE_MAX), body: z.string().max(NOTE_BODY_MAX), subjectId: id.optional(), subjectName: name.optional(), topicName: z.string().trim().max(NOTE_TOPIC_MAX).optional() }),
  z.object({ op: z.literal("append_to_note"), noteId: id, text: z.string().min(1).max(200_000), baseUpdatedAt: z.string().max(40).optional() }),
  z.object({ op: z.literal("file_note"), noteId: id, subjectId: id.nullable().optional(), subjectName: name.optional(), topicName: z.string().trim().max(NOTE_TOPIC_MAX).nullable().optional(), baseUpdatedAt: z.string().max(40).optional() }),
  z.object({ op: z.literal("link_notes"), fromNoteId: id, toNoteTitle: z.string().trim().min(1).max(NOTE_TITLE_MAX).optional(), toTopicName: name.optional() }),
  z.object({ op: z.literal("delete_note"), noteId: id }),
]);
export type Change = z.infer<typeof ChangeSchema>;

export const DESTRUCTIVE = new Set<Change["op"]>(["remove_topic", "remove_subject", "delete_note"]);
export const RESTRUCTURE = new Set<Change["op"]>(["rename_subject", "rename_topic", "move_subject", "move_topic", "file_note"]);
const STRUCTURE = new Set<Change["op"]>(["add_subject", "add_topics", "describe_topic", "rename_subject", "rename_topic", "move_subject", "move_topic", "remove_topic", "remove_subject"]);

// Server-side rule for when a human must approve first (Class 3).
export function approvalNeeded(changes: Change[]): { needed: boolean; why: string[] } {
  const why: string[] = [];
  if (changes.some(c => DESTRUCTIVE.has(c.op))) why.push("it deletes something");
  if (changes.some(c => RESTRUCTURE.has(c.op))) why.push("it moves, renames or refiles existing items");
  const units = changes.reduce((n, c) => n + unitsOf(c), 0);
  if (units > ORDINARY_MAX) why.push(`it changes ${units} items at once (more than ${ORDINARY_MAX})`);
  return { needed: why.length > 0, why };
}

// ── Reading the learner's structure ──────────────────────────────────────────

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function subjectByName(st: StudyStructure, n: string) { return st.subjects.find(s => key(s.name) === key(n)) ?? null; }
export function subjectById(st: StudyStructure, sid: string) { return st.subjects.find(s => s.id === sid) ?? null; }
export function topicById(st: StudyStructure, tid: string) {
  for (const s of st.subjects) { const t = s.topics.find(x => x.id === tid); if (t) return { subject: s, topic: t }; }
  return null;
}

// ── Outcome ──────────────────────────────────────────────────────────────────

export type ItemStatus = "created" | "updated" | "deleted" | "skipped" | "failed" | "planned";
export interface ItemResult { index: number; op: Change["op"]; status: ItemStatus; message: string; resource?: { type: "subject" | "topic" | "note"; id: string; title: string } }

export interface ChangeReport {
  status: "completed" | "completed_with_warnings" | "failed" | "conflict" | "preview";
  items: ItemResult[];
  counts: { created: number; updated: number; deleted: number; skipped: number; failed: number };
  verification: { ran: boolean; passed: boolean; checks: Array<{ what: string; ok: boolean }> };
  structureVersion: string;
}

function countOf(items: ItemResult[]) {
  const c = { created: 0, updated: 0, deleted: 0, skipped: 0, failed: 0 };
  for (const i of items) if (i.status !== "planned") c[i.status]++;
  return c;
}

// ── Planning structure edits ─────────────────────────────────────────────────

interface StructurePlan {
  first:   Array<{ index: number; edit: StudyEdit }>;
  // add_topics into a subject this plan creates: played after the first batch.
  second:  Array<{ index: number; subjectName: string; names: string[]; parentTopicName?: string }>;
  skipped: ItemResult[];
  refused: ItemResult[];
}

function planStructure(st: StudyStructure, changes: Change[]): StructurePlan {
  const plan: StructurePlan = { first: [], second: [], skipped: [], refused: [] };
  const newSubjects = new Set<string>();
  changes.forEach((c, index) => {
    const refuse = (message: string) => plan.refused.push({ index, op: c.op, status: "failed", message });
    switch (c.op) {
      case "add_subject": {
        const there = subjectByName(st, c.name);
        if (there || newSubjects.has(key(c.name))) { plan.skipped.push({ index, op: c.op, status: "skipped", message: `"${c.name}" already exists; nothing added.`, ...(there ? { resource: { type: "subject" as const, id: there.id, title: there.name } } : {}) }); return; }
        if (c.parentSubjectId && !subjectById(st, c.parentSubjectId)) return refuse("parentSubjectId is not one of the learner's subjects.");
        newSubjects.add(key(c.name));
        plan.first.push({ index, edit: { op: "add_subject", name: c.name, topics: c.topics ?? [], ...(c.parentSubjectName ? { parentName: c.parentSubjectName } : { parentId: c.parentSubjectId ?? null }) } });
        return;
      }
      case "add_topics": {
        const subject = c.subjectId ? subjectById(st, c.subjectId) : c.subjectName ? subjectByName(st, c.subjectName) : null;
        if (!subject) {
          if (c.subjectName && newSubjects.has(key(c.subjectName))) { plan.second.push({ index, subjectName: c.subjectName, names: c.names, parentTopicName: c.parentTopicName }); return; }
          return refuse("That subject is not one of the learner's (name it by subjectId or exact subjectName, or add it first in the same request).");
        }
        const have = new Set(subject.topics.filter(t => !t.archived).map(t => key(t.name)));
        const fresh = [...new Map(c.names.filter(n => !have.has(key(n))).map(n => [key(n), n])).values()];
        if (fresh.length === 0) { plan.skipped.push({ index, op: c.op, status: "skipped", message: `Every topic named is already in ${subject.name}.` }); return; }
        let parent: { parentId?: string | null; parentName?: string } = {};
        if (c.parentTopicId) {
          if (!subject.topics.some(t => t.id === c.parentTopicId)) return refuse("parentTopicId is not a topic of that subject.");
          parent = { parentId: c.parentTopicId };
        } else if (c.parentTopicName) {
          const p = subject.topics.find(t => key(t.name) === key(c.parentTopicName!));
          parent = p ? { parentId: p.id } : { parentName: c.parentTopicName };
        }
        plan.first.push({ index, edit: { op: "add_topics", subjectId: subject.id, names: fresh, ...parent } });
        return;
      }
      case "describe_topic":  if (!topicById(st, c.topicId)) return refuse("That topic is not one of the learner's."); plan.first.push({ index, edit: { op: "update_topic", topicId: c.topicId, details: { explanation: c.explanation } } }); return;
      case "rename_subject":  plan.first.push({ index, edit: { op: "rename_subject", subjectId: c.subjectId, name: c.name } }); return;
      case "rename_topic":    plan.first.push({ index, edit: { op: "rename_topic", topicId: c.topicId, name: c.name } }); return;
      case "move_subject":    plan.first.push({ index, edit: { op: "move_subject", subjectId: c.subjectId, parentId: c.parentSubjectId ?? null, ...(c.parentSubjectName ? { parentName: c.parentSubjectName } : {}) } }); return;
      case "move_topic": {
        const parentName = c.parentTopicName;
        plan.first.push({ index, edit: { op: "move_topic", topicId: c.topicId, ...(c.toSubjectId ? { toSubjectId: c.toSubjectId } : {}), ...(parentName ? { parentName } : { parentId: c.parentTopicId ?? null }) } });
        return;
      }
      case "remove_topic":    plan.first.push({ index, edit: { op: "remove_topic", topicId: c.topicId } }); return;
      case "remove_subject":  plan.first.push({ index, edit: { op: "remove_subject", subjectId: c.subjectId } }); return;
      default: return;
    }
  });
  return plan;
}

// ── Note changes (checked against the notes as they are) ─────────────────────

type NoteVersion = { id: string; updatedAt: string };

async function noteVersions(profileId: string, changes: Change[]): Promise<{ versions: NoteVersion[]; missing: Set<string> }> {
  const ids = [...new Set(changes.flatMap(c => "noteId" in c ? [c.noteId] : c.op === "link_notes" ? [c.fromNoteId] : []))];
  const versions: NoteVersion[] = [];
  const missing = new Set<string>();
  for (const nid of ids) {
    const n = await getNote(profileId, nid);
    if (n) versions.push({ id: nid, updatedAt: n.updatedAt }); else missing.add(nid);
  }
  return { versions, missing };
}

// What identifies the state a plan was made against: the structure version
// and the version of every note it touches. Part of a plan's id (plans.ts).
export async function stateOf(profileId: string, changes: Change[]): Promise<{ structure: StudyStructure; notes: NoteVersion[]; missing: Set<string> }> {
  const [structure, nv] = await Promise.all([loadStudyStructure(profileId), noteVersions(profileId, changes)]);
  return { structure, notes: nv.versions, missing: nv.missing };
}

export function describe(c: Change, st: StudyStructure): string {
  const sub = (sid?: string | null, sname?: string) => (sid ? subjectById(st, sid)?.name ?? sid : sname ?? "(none)");
  const top = (tid: string) => topicById(st, tid)?.topic.name ?? tid;
  switch (c.op) {
    case "add_subject":    return `Add subject "${c.name}"${c.parentSubjectId || c.parentSubjectName ? ` inside ${sub(c.parentSubjectId, c.parentSubjectName)}` : ""}${c.topics?.length ? ` with ${c.topics.length} topic(s)` : ""}`;
    case "add_topics":     return `Add ${c.names.length} topic(s) to ${sub(c.subjectId, c.subjectName)}${c.parentTopicId || c.parentTopicName ? ` under ${c.parentTopicId ? top(c.parentTopicId) : c.parentTopicName}` : ""}: ${c.names.join(", ")}`;
    case "describe_topic": return `Describe topic "${top(c.topicId)}"`;
    case "rename_subject": return `Rename subject "${sub(c.subjectId)}" to "${c.name}"`;
    case "rename_topic":   return `Rename topic "${top(c.topicId)}" to "${c.name}"`;
    case "move_subject":   return `Move subject "${sub(c.subjectId)}" ${c.parentSubjectId || c.parentSubjectName ? `inside ${sub(c.parentSubjectId, c.parentSubjectName)}` : "to the top level"}`;
    case "move_topic":     return `Move topic "${top(c.topicId)}"${c.toSubjectId ? ` to ${sub(c.toSubjectId)}` : ""}${c.parentTopicId || c.parentTopicName ? ` under ${c.parentTopicId ? top(c.parentTopicId) : c.parentTopicName}` : ""}`;
    case "remove_topic":   return `DELETE topic "${top(c.topicId)}"`;
    case "remove_subject": return `DELETE subject "${sub(c.subjectId)}"`;
    case "create_note":    return `Create note "${c.title}"${c.subjectId || c.subjectName ? ` in ${sub(c.subjectId, c.subjectName)}` : ""}${c.topicName ? ` › ${c.topicName}` : ""}`;
    case "append_to_note": return `Add ${c.text.length.toLocaleString("en-US")} characters to note ${c.noteId}`;
    case "file_note":      return `File note ${c.noteId} under ${c.subjectId === null ? "nothing" : sub(c.subjectId, c.subjectName)}${c.topicName ? ` › ${c.topicName}` : ""}`;
    case "link_notes":     return `Link note ${c.fromNoteId} to [[${c.toNoteTitle ?? c.toTopicName}]]`;
    case "delete_note":    return `DELETE note ${c.noteId}`;
  }
}

// ── Preview: everything checked, nothing written ─────────────────────────────

export async function previewChanges(profileId: string, changes: Change[]): Promise<{ report: ChangeReport; summary: string[]; state: Awaited<ReturnType<typeof stateOf>> }> {
  const state = await stateOf(profileId, changes);
  const st = state.structure;
  const plan = planStructure(st, changes);
  const items: ItemResult[] = [...plan.skipped, ...plan.refused];
  const { issues } = checkStudyEdits(st, plan.first.map(p => p.edit));
  for (const issue of issues) {
    const at = plan.first[issue.index];
    if (at) items.push({ index: at.index, op: changes[at.index]!.op, status: "failed", message: issue.message });
  }
  for (const p of plan.first) if (!items.some(i => i.index === p.index)) items.push({ index: p.index, op: changes[p.index]!.op, status: "planned", message: describe(changes[p.index]!, st) });
  for (const p of plan.second) items.push({ index: p.index, op: "add_topics", status: "planned", message: describe(changes[p.index]!, st) });
  changes.forEach((c, index) => {
    if (STRUCTURE.has(c.op)) return;
    const nid = "noteId" in c ? c.noteId : c.op === "link_notes" ? c.fromNoteId : null;
    if (nid && state.missing.has(nid)) { items.push({ index, op: c.op, status: "failed", message: `Note ${nid} is not one of the learner's notes.` }); return; }
    items.push({ index, op: c.op, status: "planned", message: describe(c, st) });
  });
  items.sort((a, b) => a.index - b.index);
  const failed = items.filter(i => i.status === "failed").length;
  return {
    report: { status: failed ? "failed" : "preview", items, counts: countOf(items), verification: { ran: false, passed: false, checks: [] }, structureVersion: st.version },
    summary: changes.map(c => describe(c, st)),
    state,
  };
}

// ── Apply ────────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

function withRelatedLink(body: string, target: string): string {
  const line = `- [[${target}]]`;
  const m = /^## Related\s*$/m.exec(body);
  if (!m) return `${body.trimEnd()}\n\n## Related\n\n${line}\n`;
  // After the list that follows the heading.
  const after = body.slice(m.index + m[0].length);
  const listEnd = /^(?:\s*\n)*((?:[-*] .*\n?)*)/.exec(after);
  const at = m.index + m[0].length + (listEnd ? listEnd[0].length : 0);
  const head = body.slice(0, at).replace(/\n*$/, "\n");
  return `${head}${line}\n${body.slice(at)}`;
}

export async function applyChanges(profileId: string, changes: Change[], options: { expectVersion?: string } = {}): Promise<ChangeReport> {
  const items: ItemResult[] = [];
  let st = await loadStudyStructure(profileId);
  if (options.expectVersion && options.expectVersion !== st.version) {
    return { status: "conflict", items: [], counts: countOf([]), verification: { ran: false, passed: false, checks: [] }, structureVersion: st.version };
  }

  // 1. Subjects and topics: one batch, all or nothing.
  const plan = planStructure(st, changes);
  items.push(...plan.skipped, ...plan.refused);
  let firstFailed = false;
  if (plan.first.length) {
    const res = await applyStudyEdits(profileId, { version: st.version, edits: plan.first.map(p => p.edit) });
    firstFailed = !res.ok;
    if (!res.ok) {
      if (res.error === "stale") return { status: "conflict", items, counts: countOf(items), verification: { ran: false, passed: false, checks: [] }, structureVersion: res.structure?.version ?? st.version };
      const byIssue = new Map((res.issues ?? []).map(i => [plan.first[i.index]?.index, i.message]));
      for (const p of plan.first) items.push({ index: p.index, op: changes[p.index]!.op, status: "failed", message: byIssue.get(p.index) ?? `Not applied: ${res.message}` });
      for (const p of plan.second) items.push({ index: p.index, op: "add_topics", status: "failed", message: "Not applied: the subject it goes in was not added." });
    } else {
      const before = st;
      st = res.structure;
      for (const p of plan.first) items.push(structureResult(p.index, changes[p.index]!, before, st));
    }
  }
  // 1b. Topics inside subjects added just now.
  if (plan.second.length && !firstFailed) {
    const edits: Array<{ index: number; edit: StudyEdit }> = [];
    for (const p of plan.second) {
      const s = subjectByName(st, p.subjectName);
      if (!s) { items.push({ index: p.index, op: "add_topics", status: "failed", message: `Subject "${p.subjectName}" was not found after it was added.` }); continue; }
      const parent = p.parentTopicName ? s.topics.find(t => key(t.name) === key(p.parentTopicName!)) : null;
      edits.push({ index: p.index, edit: { op: "add_topics", subjectId: s.id, names: p.names, ...(parent ? { parentId: parent.id } : p.parentTopicName ? { parentName: p.parentTopicName } : {}) } });
    }
    if (edits.length) {
      const res = await applyStudyEdits(profileId, { version: st.version, edits: edits.map(e => e.edit) });
      if (res.ok) { const before = st; st = res.structure; for (const e of edits) items.push(structureResult(e.index, changes[e.index]!, before, st)); }
      else for (const e of edits) items.push({ index: e.index, op: "add_topics", status: "failed", message: `Not applied: ${res.message}` });
    }
  }

  // 2. Notes, one at a time, each guarded on the version it was read at.
  for (const [index, c] of changes.entries()) {
    if (STRUCTURE.has(c.op)) continue;
    try { items.push(await applyNoteChange(profileId, index, c, st)); }
    catch (err) { items.push({ index, op: c.op, status: "failed", message: "Kivo could not save this change." }); console.error(JSON.stringify({ layer: "kivo_connect", event: "note_change_failed", op: c.op, error: err instanceof Error ? err.name : "unknown" })); }
  }
  items.sort((a, b) => a.index - b.index);

  // 3. Read it all back.
  const verification = await verify(profileId, changes, items);
  const counts = countOf(items);
  const done = counts.created + counts.updated + counts.deleted;
  const status = counts.failed === 0 && verification.passed ? "completed" : done > 0 || counts.skipped > 0 ? "completed_with_warnings" : "failed";
  return { status, items, counts, verification, structureVersion: (await loadStudyStructure(profileId)).version };
}

function structureResult(index: number, c: Change, before: StudyStructure, after: StudyStructure): ItemResult {
  switch (c.op) {
    case "add_subject": { const s = subjectByName(after, c.name); return { index, op: c.op, status: s ? "created" : "failed", message: s ? `Added subject "${s.name}".` : "Not found after saving.", ...(s ? { resource: { type: "subject" as const, id: s.id, title: s.name } } : {}) }; }
    case "add_topics": {
      const s = c.subjectId ? subjectById(after, c.subjectId) : subjectByName(after, c.subjectName ?? "");
      const found = s ? c.names.filter(n => s.topics.some(t => key(t.name) === key(n))) : [];
      return { index, op: c.op, status: found.length ? "created" : "failed", message: `Topics now in ${s?.name ?? "the subject"}: ${found.join(", ") || "none"}.`, ...(s ? { resource: { type: "subject" as const, id: s.id, title: s.name } } : {}) };
    }
    case "remove_topic":   return { index, op: c.op, status: topicById(after, c.topicId) ? "failed" : "deleted", message: `Deleted topic "${topicById(before, c.topicId)?.topic.name ?? c.topicId}".` };
    case "remove_subject": return { index, op: c.op, status: subjectById(after, c.subjectId) ? "failed" : "deleted", message: `Deleted subject "${subjectById(before, c.subjectId)?.name ?? c.subjectId}".` };
    default:               return { index, op: c.op, status: "updated", message: describe(c, before) };
  }
}

function subjectFor(st: StudyStructure, c: { subjectId?: string | null; subjectName?: string }): { ok: true; id: string | null | undefined } | { ok: false } {
  if (c.subjectId === null) return { ok: true, id: null };
  if (c.subjectId) return subjectById(st, c.subjectId) ? { ok: true, id: c.subjectId } : { ok: false };
  if (c.subjectName) { const s = subjectByName(st, c.subjectName); return s ? { ok: true, id: s.id } : { ok: false }; }
  return { ok: true, id: undefined };
}

async function applyNoteChange(profileId: string, index: number, c: Change, st: StudyStructure): Promise<ItemResult> {
  const fail = (message: string): ItemResult => ({ index, op: c.op, status: "failed", message });
  switch (c.op) {
    case "create_note": {
      const sub = subjectFor(st, c);
      if (!sub.ok) return fail("That subject is not one of the learner's.");
      // Kivo resolves [[links]] by title, so one title is one note: an
      // existing note of this title is enriched (append_to_note), not doubled.
      const same = (await searchNoteBodies(profileId, [c.title], { take: 20, bodyMax: NOTE_BODY_MAX })).find(n => key(n.title) === key(c.title));
      if (same) {
        if (flat(same.body).includes(flat(c.body))) return { index, op: c.op, status: "skipped", message: `"${same.title}" already holds this text.`, resource: { type: "note", id: same.id, title: same.title } };
        return { index, op: c.op, status: "skipped", message: `A note titled "${same.title}" exists (${same.id}). Use append_to_note to add to it, or choose another title.`, resource: { type: "note", id: same.id, title: same.title } };
      }
      const res = await createNote(profileId, { title: c.title, body: c.body, ...(sub.id !== undefined ? { subjectId: sub.id } : {}), ...(c.topicName ? { topicName: c.topicName } : {}), once: true });
      if (!res.ok) return fail(res.message);
      return { index, op: c.op, status: "created", message: `Created note "${res.note.title}".`, resource: { type: "note", id: res.note.id, title: res.note.title } };
    }
    case "append_to_note": {
      const note = await getNote(profileId, c.noteId);
      if (!note) return fail("That note is not one of the learner's.");
      if (c.baseUpdatedAt && new Date(c.baseUpdatedAt).getTime() !== new Date(note.updatedAt).getTime()) return { index, op: c.op, status: "failed", message: `The note changed since it was read (now ${note.updatedAt}). Read it again; nothing was overwritten.`, resource: { type: "note", id: note.id, title: note.title } };
      if (flat(note.body).includes(flat(c.text))) return { index, op: c.op, status: "skipped", message: "That text is already in the note.", resource: { type: "note", id: note.id, title: note.title } };
      const body = appendToBody(note.body, c.text, today());
      if (body === null) return fail("The note would be longer than a note can hold.");
      const res = await updateNote(profileId, note.id, { body, baseUpdatedAt: note.updatedAt });
      if (!res.ok) return { index, op: c.op, status: "failed", message: res.error === "conflict" ? "The note changed while this was being saved. Nothing was overwritten." : res.message };
      return { index, op: c.op, status: "updated", message: `Added to "${res.note.title}".`, resource: { type: "note", id: res.note.id, title: res.note.title } };
    }
    case "file_note": {
      const note = await getNote(profileId, c.noteId);
      if (!note) return fail("That note is not one of the learner's.");
      const sub = subjectFor(st, c);
      if (!sub.ok) return fail("That subject is not one of the learner's.");
      const base = c.baseUpdatedAt ?? note.updatedAt;
      const res = await updateNote(profileId, note.id, { ...(sub.id !== undefined ? { subjectId: sub.id } : {}), ...(c.topicName !== undefined ? { topicName: c.topicName } : {}), baseUpdatedAt: base });
      if (!res.ok) return fail(res.error === "conflict" ? "The note changed since it was read. Nothing was overwritten." : res.message);
      return { index, op: c.op, status: "updated", message: `Filed "${res.note.title}" under ${res.note.subjectName ?? "nothing"}${res.note.topicName ? ` › ${res.note.topicName}` : ""}.`, resource: { type: "note", id: res.note.id, title: res.note.title } };
    }
    case "link_notes": {
      const note = await getNote(profileId, c.fromNoteId);
      if (!note) return fail("That note is not one of the learner's.");
      const target = c.toNoteTitle ?? c.toTopicName;
      if (!target) return fail("Name the note (toNoteTitle) or topic (toTopicName) to link to.");
      if (c.toNoteTitle) {
        const there = (await searchNoteBodies(profileId, [c.toNoteTitle], { take: 20, bodyMax: 0 })).some(n => key(n.title) === key(c.toNoteTitle!));
        if (!there) return fail(`The learner has no note titled "${c.toNoteTitle}".`);
      } else if (!st.subjects.some(s => s.topics.some(t => !t.archived && key(t.name) === key(target)))) {
        return fail(`The learner has no topic named "${target}".`);
      }
      if (linkedTitles(note.body).some(t => linkKey(t) === linkKey(target))) return { index, op: c.op, status: "skipped", message: `"${note.title}" already links to [[${target}]].`, resource: { type: "note", id: note.id, title: note.title } };
      const res = await updateNote(profileId, note.id, { body: withRelatedLink(note.body, target), baseUpdatedAt: note.updatedAt });
      if (!res.ok) return fail(res.error === "conflict" ? "The note changed while this was being saved. Nothing was overwritten." : res.message);
      return { index, op: c.op, status: "updated", message: `"${note.title}" now links to [[${target}]].`, resource: { type: "note", id: note.id, title: note.title } };
    }
    case "delete_note": {
      const note = await getNote(profileId, c.noteId);
      if (!note) return { index, op: c.op, status: "skipped", message: "That note was already gone." };
      return (await deleteNote(profileId, c.noteId))
        ? { index, op: c.op, status: "deleted", message: `Deleted note "${note.title}".`, resource: { type: "note", id: note.id, title: note.title } }
        : fail("The note could not be deleted.");
    }
    default: return fail("Not a note change.");
  }
}

// Reads back every created, changed or deleted item.
async function verify(profileId: string, changes: Change[], items: ItemResult[]): Promise<ChangeReport["verification"]> {
  const checks: Array<{ what: string; ok: boolean }> = [];
  const st = await loadStudyStructure(profileId);
  for (const it of items) {
    const c = changes[it.index]!;
    if (it.status === "failed" || it.status === "skipped") continue;
    if (it.resource?.type === "note") {
      const n = await getNote(profileId, it.resource.id);
      if (c.op === "delete_note") { checks.push({ what: `note ${it.resource.id} is gone`, ok: !n }); continue; }
      let ok = !!n;
      if (n && c.op === "append_to_note") ok = flat(n.body).includes(flat(c.text));
      if (n && c.op === "create_note") ok = n.title === c.title.trim().replace(/\s+/g, " ");
      if (n && c.op === "link_notes") ok = linkedTitles(n.body).some(t => linkKey(t) === linkKey(c.toNoteTitle ?? c.toTopicName ?? ""));
      checks.push({ what: `note "${it.resource.title}" ${c.op === "create_note" ? "exists" : "has the change"}`, ok });
    } else if (c.op === "add_subject") {
      checks.push({ what: `subject "${c.name}" exists`, ok: !!subjectByName(st, c.name) });
    } else if (c.op === "add_topics") {
      const s = c.subjectId ? subjectById(st, c.subjectId) : subjectByName(st, c.subjectName ?? "");
      checks.push({ what: `topics in ${s?.name ?? c.subjectName}`, ok: !!s && c.names.every(n => s.topics.some(t => key(t.name) === key(n))) });
    } else if (c.op === "rename_subject") checks.push({ what: `subject renamed to "${c.name}"`, ok: subjectById(st, c.subjectId)?.name === c.name.trim().replace(/\s+/g, " ") });
    else if (c.op === "rename_topic") checks.push({ what: `topic renamed to "${c.name}"`, ok: key(topicById(st, c.topicId)?.topic.name ?? "") === key(c.name) });
    else if (c.op === "remove_topic") checks.push({ what: `topic ${c.topicId} is gone`, ok: !topicById(st, c.topicId) });
    else if (c.op === "remove_subject") checks.push({ what: `subject ${c.subjectId} is gone`, ok: !subjectById(st, c.subjectId) });
    else if (c.op === "move_subject") checks.push({ what: "subject moved", ok: !!subjectById(st, c.subjectId) });
    else if (c.op === "move_topic") checks.push({ what: "topic moved", ok: !!topicById(st, c.topicId) && (!c.toSubjectId || topicById(st, c.topicId)!.subject.id === c.toSubjectId) });
  }
  for (const ch of checks) if (!ch.ok) { const it = items.find(i => ch.what.includes(i.resource?.title ?? "\u0000")); if (it && it.status !== "failed") it.message += " (could not be confirmed on read-back)"; }
  return { ran: true, passed: checks.every(c => c.ok), checks };
}
