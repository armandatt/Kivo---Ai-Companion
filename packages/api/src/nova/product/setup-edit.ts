// ─── Editing subjects and topics ──────────────────────────────────────────────
// The editing half of study setup: the learner renames, moves, adds and
// removes their own subjects and topics. Adding goes through setup's own
// writer (declareSubjectsIn, declareTopics); a topic's row is changed only by
// the topic engine; the notes, tasks and saved pages filed under a topic
// follow it through their owners' re-filing helpers. All in one transaction.
//
// What holds, each by a test (setup-edit.test.ts, nova-setup-edit.itest.ts):
//   - A batch applies whole or not at all, and only against the version of
//     the structure it was made from: a stale page is refused with the
//     structure as it now stands.
//   - Every id must be the learner's own. Nothing from the request names a
//     learner or profile.
//   - A topic with recorded learning (sessions, reviews, mastery history) can
//     be renamed or moved but not removed. A subject can be removed only once
//     it has no topics and no dates; its notes, tasks and saved pages stay,
//     unfiled.
//   - A subject can sit inside another (Semester Five › Automata), up to
//     SUBJECT_DEPTH_MAX levels, never inside itself or what is inside it.
//     Removing one leaves the subjects inside it on their own.
//   - Renaming keeps a topic's mastery, review schedule and history: they
//     belong to its row. Past sessions keep the name they were recorded with.
//   - No model is called here, and nothing is counted as study.

import { createHash } from "node:crypto";
import { prisma } from "@repo/db/client";
import { declareTopics, moveTopicIn, normalizeTopicName, removeTopicIn, renameTopicIn } from "../engines/topic-mastery-engine";
import { topicsWithMasteryHistory } from "./progress";
import { declareSubjectsIn, placeSubjectIn, removeSubjectIn, renameSubjectIn } from "./setup";
import { canPlace } from "./task-tree";
import { refileNotesForTopic } from "./notes";
import { refileTasksForTopic } from "./tasks";
import { refileResourcesForTopic } from "./learning-events";
import {
  STUDY_EDITS_MAX, SUBJECT_DEPTH_MAX, SUBJECT_NAME_MAX, TOPIC_NAME_MAX,
  type StudyEdit, type StudyEditIssue, type StudyEditResponse, type StudyStructure,
} from "./setup-edit.types";

const MAX_TOPICS_PER_ADD = 40;

export const subjectName = (raw: string): string => normalizeTopicName(raw).slice(0, SUBJECT_NAME_MAX);
const topicName = (raw: string): string => normalizeTopicName(raw).slice(0, TOPIC_NAME_MAX);
const key = (name: string) => name.toLowerCase();
// Tidied names, each once whatever its case, empty ones dropped.
const uniqueNames = (raw: string[], tidy: (s: string) => string): string[] => {
  const seen = new Set<string>();
  return raw.map(tidy).filter(n => n && !seen.has(key(n)) && (seen.add(key(n)), true));
};

// ── Reading ───────────────────────────────────────────────────────────────────

export function structureVersion(subjects: Array<{ id: string; name: string; parentId?: string | null; topics: Array<{ id: string; name: string; archived?: boolean }> }>): string {
  // Archiving or restoring is a change too: a batch made before it is stale.
  // So is moving a subject into another (a subject on its own reads as before).
  const text = [...subjects].sort((a, b) => a.id.localeCompare(b.id))
    .map(s => `${s.id}=${s.name}${s.parentId ? `^${s.parentId}` : ""}:${[...s.topics].sort((a, b) => a.id.localeCompare(b.id)).map(t => `${t.id}=${t.name}${t.archived ? "~archived" : ""}`).join(",")}`)
    .join("|");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export async function loadStudyStructure(profileId: string): Promise<StudyStructure> {
  const subjects = await prisma.novaSubject.findMany({
    where:   { profileId },
    select:  { id: true, name: true, parentId: true, _count: { select: { exams: true } }, topics: { select: { id: true, name: true, reviewCount: true, lastStudiedAt: true, archivedAt: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  const topicIds = subjects.flatMap(s => s.topics.map(t => t.id));
  const [withHistory, sessions] = topicIds.length === 0 ? [new Set<string>(), []] : await Promise.all([
    topicsWithMasteryHistory(prisma, topicIds),
    prisma.novaStudySession.groupBy({ by: ["topicId"], where: { profileId, topicId: { in: topicIds } }, _count: { _all: true } }),
  ]);
  const recorded = new Set([...withHistory, ...sessions.map(s => s.topicId).filter((id): id is string => id !== null)]);
  const shaped = subjects.map(s => ({
    id: s.id, name: s.name, parentId: s.parentId, dates: s._count.exams,
    topics: s.topics.map(t => ({ id: t.id, name: t.name, hasHistory: recorded.has(t.id) || t.reviewCount > 0 || t.lastStudiedAt !== null, archived: t.archivedAt !== null })),
  }));
  return { version: structureVersion(shaped), subjects: shaped };
}

// ── Checking (pure) ───────────────────────────────────────────────────────────

const str = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);

// Where a subject goes: parentName (a subject by name) wins over parentId; neither is on its own.
const parentOk = (x: Record<string, unknown>) =>
  (x.parentId === undefined || x.parentId === null || str(x.parentId)) && (x.parentName === undefined || str(x.parentName));
const parentOf = (x: Record<string, unknown>): { parentId: string | null; parentName?: string } =>
  str(x.parentName) && x.parentName.trim() ? { parentId: null, parentName: x.parentName } : { parentId: str(x.parentId) ? x.parentId : null };

// Reads an untrusted request body. Only the fields of StudyEdit are read.
export function parseStudyEdits(raw: unknown): { ok: true; version: string; edits: StudyEdit[] } | { ok: false } {
  if (!raw || typeof raw !== "object") return { ok: false };
  const { version, edits } = raw as { version?: unknown; edits?: unknown };
  if (!str(version) || version.length > 64 || !Array.isArray(edits) || edits.length === 0 || edits.length > STUDY_EDITS_MAX) return { ok: false };
  const out: StudyEdit[] = [];
  for (const e of edits) {
    if (!e || typeof e !== "object") return { ok: false };
    const x = e as Record<string, unknown>;
    switch (x.op) {
      case "add_subject":    if (!str(x.name) || !strs(x.topics ?? []) || !parentOk(x)) return { ok: false }; out.push({ op: "add_subject", name: x.name, topics: (x.topics as string[] | undefined) ?? [], ...parentOf(x) }); break;
      case "move_subject":   if (!str(x.subjectId) || !parentOk(x)) return { ok: false }; out.push({ op: "move_subject", subjectId: x.subjectId, ...parentOf(x) }); break;
      case "add_topics":     if (!str(x.subjectId) || !strs(x.names)) return { ok: false }; out.push({ op: "add_topics", subjectId: x.subjectId, names: x.names }); break;
      case "rename_subject": if (!str(x.subjectId) || !str(x.name)) return { ok: false }; out.push({ op: "rename_subject", subjectId: x.subjectId, name: x.name }); break;
      case "rename_topic":   if (!str(x.topicId) || !str(x.name)) return { ok: false }; out.push({ op: "rename_topic", topicId: x.topicId, name: x.name }); break;
      case "move_topic":     if (!str(x.topicId) || !str(x.toSubjectId)) return { ok: false }; out.push({ op: "move_topic", topicId: x.topicId, toSubjectId: x.toSubjectId }); break;
      case "remove_topic":   if (!str(x.topicId)) return { ok: false }; out.push({ op: "remove_topic", topicId: x.topicId }); break;
      case "remove_subject": if (!str(x.subjectId)) return { ok: false }; out.push({ op: "remove_subject", subjectId: x.subjectId }); break;
      default: return { ok: false };
    }
  }
  return { ok: true, version, edits: out };
}

// Plays the edits, in order, on a copy of the structure: every id must exist
// at its turn, every name must be free where it lands. Returns what each one
// would do as a sentence, or the issues that stop the whole batch.
export function checkStudyEdits(structure: StudyStructure, edits: StudyEdit[]): { issues: StudyEditIssue[]; sentences: string[] } {
  type T = { id: string; name: string; hasHistory: boolean; archived?: boolean };
  type S = { id: string; name: string; parentId: string | null; dates: number; topics: T[] };
  const subjects: S[] = structure.subjects.map(s => ({ ...s, parentId: s.parentId ?? null, topics: s.topics.map(t => ({ ...t })) }));
  const issues: StudyEditIssue[] = [];
  const sentences: string[] = [];
  const subjectById = (id: string) => subjects.find(s => s.id === id);
  const topicById = (id: string) => { for (const s of subjects) { const t = s.topics.find(x => x.id === id); if (t) return { s, t }; } return null; };
  const takenIn = (s: S, name: string, except?: string) => s.topics.some(t => t.id !== except && key(t.name) === key(name));
  let fresh = 0;
  // The subject a parent names (undefined: none of theirs), and whether one may go there.
  const parentFor = (e: { parentId?: string | null; parentName?: string }): S | null | undefined =>
    e.parentName !== undefined && e.parentName.trim() ? subjects.find(s => key(s.name) === key(subjectName(e.parentName!)))
    : e.parentId ? subjectById(e.parentId) : null;
  const placing = (s: S, parent: S | null): string | null => {
    const placed = canPlace(subjects.map(x => ({ id: x.id, parent: x.parentId })), s.id, parent?.id ?? null, SUBJECT_DEPTH_MAX);
    return placed.ok ? null
      : placed.reason === "too_deep" ? `Subjects go at most ${SUBJECT_DEPTH_MAX} levels deep, so ${s.name} can't go inside ${parent!.name}.`
      : `${s.name} can't go inside itself or a subject inside it.`;
  };

  edits.forEach((e, index) => {
    const bad = (message: string) => issues.push({ index, message });
    switch (e.op) {
      case "add_subject": {
        const name = subjectName(e.name);
        if (!name) return bad("A subject needs a name.");
        if (subjects.some(s => key(s.name) === key(name))) return bad(`You already have a subject called "${name}".`);
        const parent = parentFor(e);
        if (parent === undefined) return bad("The subject to put it inside isn't one of yours.");
        const topics = uniqueNames(e.topics, topicName).slice(0, MAX_TOPICS_PER_ADD);
        const added: S = { id: `new:${fresh++}`, name, parentId: null, dates: 0, topics: topics.map((t, i) => ({ id: `new:${fresh}:${i}`, name: t, hasHistory: false })) };
        subjects.push(added);
        if (parent) { const why = placing(added, parent); if (why) return bad(why); added.parentId = parent.id; }
        const inside = parent ? ` inside ${parent.name}` : "";
        sentences.push(topics.length ? `Add the subject ${name}${inside} with ${topics.length} topic${topics.length === 1 ? "" : "s"}.` : `Add the subject ${name}${inside}.`);
        return;
      }
      case "move_subject": {
        const s = subjectById(e.subjectId);
        if (!s) return bad("That subject isn't one of yours.");
        const parent = parentFor(e);
        if (parent === undefined) return bad("The subject to put it inside isn't one of yours.");
        if ((parent?.id ?? null) === s.parentId) return bad(parent ? `${s.name} is already inside ${parent.name}.` : `${s.name} is already a subject of its own.`);
        const why = placing(s, parent);
        if (why) return bad(why);
        const from = subjects.find(x => x.id === s.parentId);
        sentences.push(parent ? `Put ${s.name} inside ${parent.name}${from ? ` (out of ${from.name})` : ""}.` : `Take ${s.name} out of ${from?.name ?? "its subject"}, as a subject of its own.`);
        s.parentId = parent?.id ?? null;
        return;
      }
      case "add_topics": {
        const s = subjectById(e.subjectId);
        if (!s) return bad("That subject isn't one of yours.");
        // A name of an archived topic brings that topic back (declareTopics).
        const wanted = uniqueNames(e.names, topicName).slice(0, MAX_TOPICS_PER_ADD);
        const archivedOf = (n: string) => s.topics.find(t => t.archived && key(t.name) === key(n));
        const restored = wanted.map(archivedOf).filter((t): t is T => t !== undefined);
        const names = wanted.filter(n => !takenIn(s, n));
        if (names.length === 0 && restored.length === 0) return bad(`Nothing new to add to ${s.name}.`);
        s.topics.push(...names.map((n, i) => ({ id: `new:${fresh++}:${i}`, name: n, hasHistory: false })));
        for (const t of restored) t.archived = false;
        if (names.length) sentences.push(`Add to ${s.name}: ${names.join(", ")}.`);
        if (restored.length) sentences.push(`Restore in ${s.name}: ${restored.map(t => t.name).join(", ")} (archived, with ${restored.length === 1 ? "its" : "their"} history).`);
        return;
      }
      case "rename_subject": {
        const s = subjectById(e.subjectId);
        if (!s) return bad("That subject isn't one of yours.");
        const name = subjectName(e.name);
        if (!name) return bad("A subject needs a name.");
        if (subjects.some(x => x.id !== s.id && key(x.name) === key(name))) return bad(`You already have a subject called "${name}".`);
        if (name === s.name) return bad(`${s.name} already has that name.`);
        sentences.push(`Rename the subject ${s.name} to ${name}.`);
        s.name = name;
        return;
      }
      case "rename_topic": {
        const hit = topicById(e.topicId);
        if (!hit) return bad("That topic isn't one of yours.");
        const name = topicName(e.name);
        if (!name) return bad("A topic needs a name.");
        if (takenIn(hit.s, name, hit.t.id)) {
          const other = hit.s.topics.find(t => t.id !== hit.t.id && key(t.name) === key(name));
          return bad(other?.archived
            ? `${hit.s.name} has an archived topic called "${name}". Restore it instead, or pick another name.`
            : `${hit.s.name} already has a topic called "${name}".`);
        }
        if (name === hit.t.name) return bad(`${hit.t.name} already has that name.`);
        sentences.push(`Rename ${hit.t.name} to ${name} (its notes, tasks, saved pages and history go with it).`);
        hit.t.name = name;
        return;
      }
      case "move_topic": {
        const hit = topicById(e.topicId);
        const to = subjectById(e.toSubjectId);
        if (!hit) return bad("That topic isn't one of yours.");
        if (!to) return bad("That subject isn't one of yours.");
        if (to.id === hit.s.id) return bad(`${hit.t.name} is already under ${to.name}.`);
        if (takenIn(to, hit.t.name)) return bad(`${to.name} already has a topic called "${hit.t.name}".`);
        hit.s.topics = hit.s.topics.filter(t => t.id !== hit.t.id);
        to.topics.push(hit.t);
        sentences.push(`Move ${hit.t.name} from ${hit.s.name} to ${to.name} (with its notes, tasks, saved pages and history).`);
        return;
      }
      case "remove_topic": {
        const hit = topicById(e.topicId);
        if (!hit) return bad("That topic isn't one of yours.");
        if (hit.t.hasHistory) return bad(`${hit.t.name} has recorded study, so removing it would delete that record. Rename or move it instead.`);
        hit.s.topics = hit.s.topics.filter(t => t.id !== hit.t.id);
        sentences.push(`Remove ${hit.t.name} from ${hit.s.name} (its notes, tasks and saved pages stay under ${hit.s.name}).`);
        return;
      }
      case "remove_subject": {
        const s = subjectById(e.subjectId);
        if (!s) return bad("That subject isn't one of yours.");
        if (s.topics.length > 0) {
          const archived = s.topics.filter(t => t.archived).length;
          return bad(archived
            ? `${s.name} still has topics (${archived} archived). Move or remove them first.`
            : `${s.name} still has topics. Move or remove them first.`);
        }
        if (s.dates > 0) return bad(`${s.name} has dates on record. Move or remove them in study settings first.`);
        subjects.splice(subjects.indexOf(s), 1);
        const inside = subjects.filter(x => x.parentId === s.id);
        for (const x of inside) x.parentId = null;
        sentences.push(`Remove the subject ${s.name} (its notes, tasks and saved pages stay, unfiled${inside.length ? `; ${inside.map(x => x.name).join(", ")} stay${inside.length === 1 ? "s" : ""}, on ${inside.length === 1 ? "its" : "their"} own` : ""}).`);
        return;
      }
    }
  });
  return { issues, sentences };
}

// ── Applying ──────────────────────────────────────────────────────────────────

// Whether any learning is recorded against a topic: a session, a review, a
// study date or mastery history. A topic with any is never removed, because
// removing it would delete that record (an archive needs a column: see the
// schema request in audit/phase2-tracker.md).
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function topicHasHistory(
  tx: Tx,
  profileId: string,
  topicId: string,
): Promise<boolean> {
  const [topic, history, sessions] = await Promise.all([
    tx.novaTopicMastery.findUnique({ where: { id: topicId }, select: { reviewCount: true, lastStudiedAt: true } }),
    topicsWithMasteryHistory(tx, [topicId]),
    tx.novaStudySession.count({ where: { profileId, topicId } }),
  ]);
  return !topic || topic.reviewCount > 0 || topic.lastStudiedAt !== null || history.size > 0 || sessions > 0;
}

export async function applyStudyEdits(profileId: string, raw: unknown): Promise<StudyEditResponse> {
  const parsed = parseStudyEdits(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", message: "That isn't a change Nova can make." };
  const current = await loadStudyStructure(profileId);
  if (parsed.version !== current.version) {
    return { ok: false, error: "stale", message: "Your subjects changed since this page loaded. Here they are as they are now; nothing was changed.", structure: current };
  }
  const { issues, sentences } = checkStudyEdits(current, parsed.edits);
  if (issues.length > 0) return { ok: false, error: "invalid", message: "Nothing was changed.", issues, structure: current };

  try {
    await prisma.$transaction(tx => playStudyEditsIn(tx, profileId, parsed.edits, current.version));
  } catch (err) {
    // Another change got there first (a second tab, a unique name taken).
    if (err instanceof StaleStructure || (err as { code?: string } | null)?.code === "P2002" || (err as { code?: string } | null)?.code === "P2025") {
      return { ok: false, error: "stale", message: "Your subjects changed while this was being saved. Nothing was changed.", structure: await loadStudyStructure(profileId) };
    }
    throw err;
  }
  console.log(JSON.stringify({ layer: "nova_setup_edit", event: "applied", profileId, edits: parsed.edits.length }));
  return { ok: true, structure: await loadStudyStructure(profileId), applied: sentences };
}

// Plays checked edits inside the caller's transaction (Subject Studio's own,
// or Build with Nova's when it applies an approved change set with other
// records): one batch at a time per learner, and only on the structure
// version the edits were checked against. Throws StaleStructure otherwise.
export class StaleStructure extends Error {}
export async function playStudyEditsIn(tx: Tx, profileId: string, edits: StudyEdit[], version: string): Promise<void> {
  // One batch at a time per learner (the same lock a session start takes),
  // so two batches made from one version cannot both pass the check below.
  await tx.$queryRaw`SELECT id FROM "NovaAcademicProfile" WHERE id = ${profileId} FOR UPDATE`;
  // Checked again inside the transaction: the version as read here must be
  // the one the batch was made from.
  const now = await tx.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true, parentId: true, topics: { select: { id: true, name: true, archivedAt: true } } } });
  if (structureVersion(now.map(s => ({ ...s, topics: s.topics.map(t => ({ id: t.id, name: t.name, archived: t.archivedAt !== null })) }))) !== version) throw new StaleStructure();
  const subjectOf = (id: string) => now.find(s => s.id === id);
  // A parent by name may be one this batch added, so it is looked up as the batch goes.
  const parentIdOf = async (e: { parentId?: string | null; parentName?: string }): Promise<string | null> => {
    if (e.parentName !== undefined && e.parentName.trim()) {
      const found = await tx.novaSubject.findFirst({ where: { profileId, name: { equals: subjectName(e.parentName), mode: "insensitive" } }, select: { id: true } });
      if (!found) throw new StaleStructure();
      return found.id;
    }
    if (e.parentId && !subjectOf(e.parentId)) throw new StaleStructure();
    return e.parentId ?? null;
  };
  for (const e of edits) {
    switch (e.op) {
      case "add_subject": {
        const report = { ids: new Map<string, string>(), subjectsAdded: 0, topicsAdded: 0 };
        await declareSubjectsIn(tx, profileId, await tx.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true } }),
          [{ name: subjectName(e.name), topics: uniqueNames(e.topics, topicName).slice(0, MAX_TOPICS_PER_ADD) }], report);
        const parentId = await parentIdOf(e);
        const id = report.ids.get(subjectName(e.name).toLowerCase());
        if (parentId && id) await placeSubjectIn(tx, id, parentId);
        break;
      }
      case "move_subject":
        if (!subjectOf(e.subjectId)) throw new StaleStructure();
        await placeSubjectIn(tx, e.subjectId, await parentIdOf(e));
        break;
      case "add_topics":
        await declareTopics(tx, e.subjectId, uniqueNames(e.names, topicName).slice(0, MAX_TOPICS_PER_ADD));
        break;
      case "rename_subject":
        await renameSubjectIn(tx, e.subjectId, subjectName(e.name));
        break;
      case "rename_topic": {
        const t = await tx.novaTopicMastery.findUniqueOrThrow({ where: { id: e.topicId }, select: { name: true, subjectId: true } });
        const to = { subjectId: t.subjectId, topicName: topicName(e.name) };
        await renameTopicIn(tx, e.topicId, to.topicName);
        await refile(tx, profileId, { subjectId: t.subjectId, topicName: t.name }, to);
        break;
      }
      case "move_topic": {
        const t = await tx.novaTopicMastery.findUniqueOrThrow({ where: { id: e.topicId }, select: { name: true, subjectId: true } });
        if (!subjectOf(e.toSubjectId)) throw new StaleStructure();
        await moveTopicIn(tx, e.topicId, e.toSubjectId);
        await refile(tx, profileId, { subjectId: t.subjectId, topicName: t.name }, { subjectId: e.toSubjectId, topicName: t.name });
        break;
      }
      case "remove_topic": {
        const t = await tx.novaTopicMastery.findUniqueOrThrow({ where: { id: e.topicId }, select: { name: true, subjectId: true } });
        // History recorded since the page loaded stops the batch.
        if (await topicHasHistory(tx, profileId, e.topicId)) throw new StaleStructure();
        await refile(tx, profileId, { subjectId: t.subjectId, topicName: t.name }, { subjectId: t.subjectId, topicName: null });
        await removeTopicIn(tx, e.topicId);
        break;
      }
      case "remove_subject": {
        const left = await tx.novaSubject.findUniqueOrThrow({ where: { id: e.subjectId }, select: { _count: { select: { topics: true, exams: true } } } });
        if (left._count.topics > 0 || left._count.exams > 0) throw new StaleStructure();
        await removeSubjectIn(tx, e.subjectId);
        break;
      }
    }
  }
}

async function refile(
  tx: Tx,
  profileId: string,
  from: { subjectId: string; topicName: string },
  to: { subjectId: string; topicName: string | null },
): Promise<void> {
  await refileNotesForTopic(tx, profileId, from, to);
  await refileTasksForTopic(tx, profileId, from, to);
  await refileResourcesForTopic(tx, profileId, from, to);
}
