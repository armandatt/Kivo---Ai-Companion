// ─── Kivo Connect: reading the learner's knowledge ────────────────────────────
// Workspaces, search, the Knowledge Map and what can be said about it. Reads
// only, through the modules that own each record: the map's read model
// (knowledge-map.ts), Subject Studio's structure (setup-edit.ts), notes
// (notes.ts) and saved pages (learning-events.ts). Nothing here writes.
//
// What is on record and what is inferred are kept apart in every answer:
//   verified   a row or a stored link (an edge on the map, a [[link]] in a note)
//   inferred   keyword overlap computed here (similarity.ts), labelled so
// Search is case-insensitive keyword matching: Kivo has no semantic index.

import { prisma } from "@repo/db/client";
import { loadNovaKnowledgeMap } from "../nova/product/knowledge-map";
import type { MapEdge, MapNode, NovaKnowledgeMapReady } from "../nova/product/knowledge-map.types";
import { loadStudyStructure } from "../nova/product/setup-edit";
import type { StudyStructure, StudySubject } from "../nova/product/setup-edit.types";
import { listNoteLinks, searchNoteBodies } from "../nova/product/notes";
import { listResourceLinks } from "../nova/product/learning-events";
import { workspaceScopes, workspaceSummaries } from "../nova/product/workspaces";
import { closest, jaccard, keyTerms, searchScore, snippet, words } from "./similarity";
import type { ConnectLearner } from "./learner";

export const PAGE_MAX = 100;

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ── Links into Kivo ──────────────────────────────────────────────────────────

export function linkTo(origin: string, type: string, rowId: string): string {
  switch (type) {
    case "note":     return `${origin}/notes/${rowId}`;
    case "topic":    return `${origin}/knowledge?topic=${rowId}`;
    case "subject":  return `${origin}/knowledge?subject=${rowId}`;
    case "resource": return `${origin}/saved?page=${rowId}`;
    case "task":     return `${origin}/home?board=open&task=${rowId}`;
    default:         return `${origin}/map`;
  }
}
export const mapLink = (origin: string, nodeId: string) => `${origin}/map?focus=${encodeURIComponent(nodeId)}`;

// ── Workspaces ───────────────────────────────────────────────────────────────
// In Kivo a workspace is a map made from a template or by Build with Nova
// (NovaWorkspace): its subjects and everything inside them. The learner's
// top-level subjects are listed too, since much is organised by subject alone.

export interface WorkspaceRef { id: string; kind: "workspace" | "subject"; title: string; subjectIds: string[] }

export async function workspacesOf(l: ConnectLearner, st?: StudyStructure): Promise<WorkspaceRef[]> {
  const [scopes, structure] = await Promise.all([workspaceScopes(l.profileId), st ? Promise.resolve(st) : loadStudyStructure(l.profileId)]);
  return [
    ...scopes.map(w => ({ id: `workspace:${w.id}`, kind: "workspace" as const, title: w.title, subjectIds: w.subjectIds })),
    ...structure.subjects.filter(s => !s.parentId).map(s => ({ id: `subject:${s.id}`, kind: "subject" as const, title: s.name, subjectIds: [s.id] })),
  ];
}

// A workspace named by id ("workspace:…", "subject:…") or by its title. The
// assistant is given the list to choose from; nothing is guessed.
export async function resolveWorkspace(l: ConnectLearner, ref: string | undefined | null, st: StudyStructure): Promise<{ ok: true; ws: WorkspaceRef | null } | { ok: false; message: string; choices: Array<{ id: string; title: string }> }> {
  if (!ref || ref === "all") return { ok: true, ws: null };
  const all = await workspacesOf(l, st);
  const byId = all.find(w => w.id === ref);
  if (byId) return { ok: true, ws: byId };
  const byTitle = all.filter(w => key(w.title) === key(ref));
  if (byTitle.length === 1) return { ok: true, ws: byTitle[0]! };
  return { ok: false, message: byTitle.length > 1 ? `More than one workspace is called "${ref}"; give its id.` : `No workspace or top-level subject is called "${ref}".`, choices: all.slice(0, 40).map(w => ({ id: w.id, title: w.title })) };
}

// The subjects a workspace covers, with every subject inside them.
export function subjectsIn(st: StudyStructure, ws: WorkspaceRef | null): StudySubject[] {
  if (!ws) return st.subjects;
  const ids = new Set(ws.subjectIds);
  for (let grew = true; grew;) { grew = false; for (const s of st.subjects) if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); grew = true; } }
  return st.subjects.filter(s => ids.has(s.id));
}

export function outline(subjects: StudySubject[]) {
  const byParent = new Map<string | null, StudySubject[]>();
  for (const s of subjects) { const p = s.parentId && subjects.some(x => x.id === s.parentId) ? s.parentId : null; byParent.set(p, [...(byParent.get(p) ?? []), s]); }
  type TopicTree = { id: string; name: string; studied: boolean; kind: string | null; children: TopicTree[] };
  const topicTree = (s: StudySubject): TopicTree[] => {
    const live = s.topics.filter(t => !t.archived);
    const kids = (pid: string | null): TopicTree[] => live.filter(t => (t.parentId ?? null) === pid).map(t => ({ id: t.id, name: t.name, studied: t.hasHistory, kind: t.kind ?? null, children: kids(t.id) }));
    return kids(null);
  };
  type SubjectTree = { id: string; name: string; topics: TopicTree[]; subjects: SubjectTree[] };
  const tree = (pid: string | null): SubjectTree[] => (byParent.get(pid) ?? []).map(s => ({ id: s.id, name: s.name, topics: topicTree(s), subjects: tree(s.id) }));
  return tree(null);
}

// ── Map ──────────────────────────────────────────────────────────────────────

export async function mapOf(l: ConnectLearner, ws: WorkspaceRef | null): Promise<NovaKnowledgeMapReady | null> {
  // The map scopes by NovaWorkspace; a subject-as-workspace is everything,
  // filtered to that subject's tree here.
  const view = await loadNovaKnowledgeMap(l.platformChatId, { workspace: ws?.kind === "workspace" ? ws.id.slice("workspace:".length) : "all" });
  if (view.status !== "ready") return null;
  if (!ws || ws.kind === "workspace") return view;
  const subjects = new Set(ws.subjectIds);
  for (let grew = true; grew;) { grew = false; for (const n of view.nodes) if (n.type === "subject" && n.parentId && subjects.has(n.parentId) && !subjects.has(n.id.slice(8))) { subjects.add(n.id.slice(8)); grew = true; } }
  const keep = new Set(view.nodes.filter(n => n.type === "subject" ? subjects.has(n.id.slice(8)) : n.subjectId !== null && subjects.has(n.subjectId)).map(n => n.id));
  const nodes = view.nodes.filter(n => keep.has(n.id));
  const edges = view.edges.filter(e => keep.has(e.from) && keep.has(e.to));
  const connected = new Set(edges.flatMap(e => [e.from, e.to]));
  return { ...view, nodes, edges, unconnected: nodes.filter(n => !connected.has(n.id)).length };
}

export function nodeOut(n: MapNode, origin: string) {
  const [type, rowId] = [n.type, n.id.slice(n.id.indexOf(":") + 1)];
  const base = { id: n.id, type, label: n.label, url: n.href ? `${origin}${n.href}` : linkTo(origin, type, rowId), subjectId: n.subjectId };
  switch (n.type) {
    case "subject":  return { ...base, parentSubjectId: n.parentId ?? null, counts: { topics: n.topics, notes: n.notes, savedPages: n.resources } };
    case "topic":    return { ...base, subject: n.subjectName, parentTopicId: n.parentId ? `topic:${n.parentId}` : null, sessions: n.sessions, level: n.level, masteryPercentEstimate: n.masteryPercent, notes: n.notes, savedPages: n.resources, explanation: n.details?.explanation ?? null };
    case "note":     return { ...base, subject: n.subjectName, topicName: n.topicName, filedUnderTopic: n.topicLinked, updatedAt: n.updatedAt };
    case "resource": return { ...base, subject: n.subjectName, topicName: n.topicName, pageUrl: n.url, site: n.domain };
    case "task":     return { ...base, status: n.status, dueDay: n.dueDay };
  }
}

export const EDGE_MEANING: Record<MapEdge["kind"], string> = {
  contains: "subject inside subject", has_topic: "topic at the top of a subject", subtopic: "topic inside topic",
  has_task: "task filed under it", step: "step of a task", depends_on: "task waits for task",
  about_topic: "note or saved page filed under this topic", filed_under: "note or saved page filed under this subject", links_to: "note links to it with [[…]]",
};

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchHit { type: "note" | "subject" | "topic" | "resource"; id: string; title: string; url: string; score: number; snippet?: string; subject?: string | null; topicName?: string | null; updatedAt?: string }

export async function searchAll(l: ConnectLearner, origin: string, q: string, opts: { types?: Array<SearchHit["type"]>; subjectIds?: string[] | null; limit?: number } = {}): Promise<{ hits: SearchHit[]; basis: "keyword" }> {
  const want = (t: SearchHit["type"]) => !opts.types || opts.types.includes(t);
  const terms = [q.trim(), ...keyTerms(q, 5)].filter(Boolean);
  const [notes, st, saved] = await Promise.all([
    want("note") ? searchNoteBodies(l.profileId, terms, { take: 60, bodyMax: 20_000, subjectIds: opts.subjectIds ?? null }) : Promise.resolve([]),
    want("subject") || want("topic") ? loadStudyStructure(l.profileId) : Promise.resolve(null),
    want("resource") ? listResourceLinks(l.profileId, 300) : Promise.resolve({ resources: [], total: 0 }),
  ]);
  const hits: SearchHit[] = [];
  const allowed = opts.subjectIds ? new Set(opts.subjectIds) : null;
  for (const n of notes) hits.push({ type: "note", id: `note:${n.id}`, title: n.title, url: linkTo(origin, "note", n.id), score: searchScore(q, { title: n.title, text: n.body }), snippet: snippet(n.body, words(q)), subject: n.subjectName, topicName: n.topicName, updatedAt: n.updatedAt.toISOString() });
  for (const s of st?.subjects ?? []) {
    if (allowed && !allowed.has(s.id)) continue;
    if (want("subject")) hits.push({ type: "subject", id: `subject:${s.id}`, title: s.name, url: linkTo(origin, "subject", s.id), score: searchScore(q, { title: s.name }) });
    if (want("topic")) for (const t of s.topics) if (!t.archived) hits.push({ type: "topic", id: `topic:${t.id}`, title: t.name, url: linkTo(origin, "topic", t.id), score: searchScore(q, { title: t.name }), subject: s.name });
  }
  for (const r of saved.resources) {
    if (allowed && (!r.subjectId || !allowed.has(r.subjectId))) continue;
    hits.push({ type: "resource", id: `resource:${r.id}`, title: r.title, url: linkTo(origin, "resource", r.id), score: searchScore(q, { title: r.title, text: `${r.domain} ${r.topicName ?? ""}` }), topicName: r.topicName });
  }
  return { hits: hits.filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(opts.limit ?? 20, PAGE_MAX)).map(h => ({ ...h, score: Math.round(h.score * 100) / 100 })), basis: "keyword" };
}

// Notes, topics and saved pages close to a text or a note (keyword overlap).
export async function relatedTo(l: ConnectLearner, origin: string, subject: { title: string; body: string; excludeNoteId?: string }, limit = 10) {
  const terms = keyTerms(`${subject.title} ${subject.title} ${subject.body}`, 6);
  const [notes, st] = await Promise.all([searchNoteBodies(l.profileId, terms, { take: 60, bodyMax: 20_000 }), loadStudyStructure(l.profileId)]);
  const near = closest(subject, notes.filter(n => n.id !== subject.excludeNoteId), limit);
  const textWords = new Set(words(`${subject.title} ${subject.body}`));
  const topics = st.subjects.flatMap(s => s.topics.filter(t => !t.archived).map(t => ({ s, t })))
    .map(({ s, t }) => ({ s, t, score: jaccard(words(t.name), textWords) * words(t.name).length }))
    .filter(x => words(x.t.name).length > 0 && words(x.t.name).every(w => textWords.has(w)))
    .slice(0, limit);
  return {
    basis: "keyword" as const,
    notes: near.map(c => ({ id: `note:${c.note.id}`, title: c.note.title, url: linkTo(origin, "note", c.note.id), overlap: c.overlap, titleSimilarity: round(c.titleScore), textSimilarity: round(c.textScore), subject: c.note.subjectName, topicName: c.note.topicName, updatedAt: c.note.updatedAt.toISOString() })),
    topics: topics.map(x => ({ id: `topic:${x.t.id}`, name: x.t.name, subject: x.s.name, subjectId: x.s.id, url: linkTo(origin, "topic", x.t.id), why: "every word of the topic's name appears in the text" })),
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

// ── Analysis ─────────────────────────────────────────────────────────────────

export async function analyse(l: ConnectLearner, origin: string, ws: WorkspaceRef | null, st: StudyStructure, focus?: string | null) {
  const map = await mapOf(l, ws);
  if (!map) return null;
  // focus: only items whose name, or subject's name, shares a word with it.
  const fw = focus ? new Set(words(focus)) : null;
  const nodes = map.nodes.filter(n => !fw || [n.label, "subjectName" in n ? n.subjectName ?? "" : ""].some(x => words(x).some(w => fw.has(w))));
  const degree = new Map<string, number>();
  for (const e of map.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const topics = nodes.filter((n): n is Extract<MapNode, { type: "topic" }> => n.type === "topic");
  const notes = nodes.filter((n): n is Extract<MapNode, { type: "note" }> => n.type === "note");

  // Verified: straight from the records.
  const unfiledNotes = notes.filter(n => !n.subjectId).map(n => ({ id: n.id, title: n.label, url: `${origin}${n.href ?? ""}` }));
  const disconnected = nodes.filter(n => !degree.get(n.id)).map(n => ({ id: n.id, type: n.type, label: n.label }));
  const topicsWithoutNotes = topics.filter(t => t.notes === 0 && t.resources === 0 && t.studied !== false).map(t => ({ id: t.id, name: t.label, subject: t.subjectName }));
  const neverStudied = topics.filter(t => t.sessions === 0 && t.studied !== false && t.kind !== "milestone").map(t => ({ id: t.id, name: t.label, subject: t.subjectName }));
  const notesNamingMissingTopics = notes.filter(n => n.topicName && !n.topicLinked).map(n => ({ id: n.id, title: n.label, topicName: n.topicName, subject: n.subjectName }));

  // [[links]] to nothing on record: concrete gaps the learner themselves named.
  const allNotes = await listNoteLinks(l.profileId, 400);
  const titles = new Set(allNotes.notes.map(n => key(n.title)));
  const topicNames = new Set(st.subjects.flatMap(s => s.topics.filter(t => !t.archived).map(t => key(t.name))));
  const inScope = new Set(notes.map(n => n.id.slice(5)));
  const unwrittenLinks = new Map<string, string[]>();
  for (const n of allNotes.notes) {
    if (ws && !inScope.has(n.id)) continue;
    for (const t of n.linksTo) if (!titles.has(key(t)) && !topicNames.has(key(t))) unwrittenLinks.set(t, [...(unwrittenLinks.get(t) ?? []), n.title]);
  }

  const levels = { weak: 0, developing: 0, solid: 0, none: 0 };
  for (const t of topics) levels[t.level ?? "none"]++;

  return {
    scope: ws ? { id: ws.id, title: ws.title } : { id: "all", title: "Everything" },
    verified: {
      counts: map.counts, notShownOnMap: map.notShown,
      topicLevels: { ...levels, note: "Levels are Kivo's self-report-driven estimate from finished sessions, not a test result. 'none' = never studied." },
      unfiledNotes: unfiledNotes.slice(0, 50), disconnectedItems: disconnected.slice(0, 50), disconnectedTotal: disconnected.length,
      topicsWithNoNotesOrPages: topicsWithoutNotes.slice(0, 50), topicsNeverStudied: neverStudied.slice(0, 50),
      notesNamingATopicNotOnTheMap: notesNamingMissingTopics.slice(0, 50),
      linksToNotesNotWrittenYet: [...unwrittenLinks.entries()].slice(0, 50).map(([title, from]) => ({ title, linkedFrom: from.slice(0, 5) })),
    },
  };
}

// Inferred connections, from keyword overlap only. Each one is a change the
// assistant may propose (preview_knowledge_changes), never applied here.
export async function recommend(l: ConnectLearner, origin: string, ws: WorkspaceRef | null, st: StudyStructure, limit = 20) {
  const subjects = subjectsIn(st, ws);
  const ids = ws ? subjects.map(s => s.id) : null;
  const notes = await searchNoteBodies(l.profileId, [], { take: 200, bodyMax: 6_000, subjectIds: null });
  const scoped = notes.filter(n => !ids || !n.subjectId || ids.includes(n.subjectId));
  const out: Array<{ kind: "file_note" | "link_notes"; confidence: "inferred"; why: string; change: Record<string, unknown>; items: Array<{ id: string; title: string; url: string }> }> = [];

  // Unfiled notes whose title holds a topic's whole name.
  for (const n of scoped.filter(x => !x.subjectId)) {
    const tw = new Set(words(n.title));
    for (const s of subjects) for (const t of s.topics) {
      const w = words(t.name);
      if (!t.archived && w.length && w.every(x => tw.has(x))) {
        out.push({ kind: "file_note", confidence: "inferred", why: `The note's title contains the topic name "${t.name}" (${s.name}).`, change: { op: "file_note", noteId: n.id, subjectId: s.id, topicName: t.name, baseUpdatedAt: n.updatedAt.toISOString() }, items: [{ id: `note:${n.id}`, title: n.title, url: linkTo(origin, "note", n.id) }] });
      }
    }
  }
  // Pairs of notes that share much of their wording and do not link.
  for (let i = 0; i < scoped.length && out.length < limit * 2; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i]!, b = scoped[j]!;
      const sim = jaccard(words(`${a.title} ${a.body}`), words(`${b.title} ${b.body}`));
      if (sim < 0.2) continue;
      const linked = a.body.includes(`[[${b.title}`) || b.body.includes(`[[${a.title}`);
      if (linked) continue;
      out.push({ kind: "link_notes", confidence: "inferred", why: `They share ${Math.round(sim * 100)}% of their key words and neither links to the other.`, change: { op: "link_notes", fromNoteId: a.id, toNoteTitle: b.title }, items: [a, b].map(x => ({ id: `note:${x.id}`, title: x.title, url: linkTo(origin, "note", x.id) })) });
    }
  }
  return { basis: "keyword overlap (inferred, not verified)", recommendations: out.slice(0, limit), note: "Pass the chosen 'change' objects to preview_knowledge_changes; nothing has been changed." };
}

// Coverage of concepts the assistant expects for an objective (its own
// knowledge of the field), against what the learner has. "Not found" means
// not on record in Kivo, never that the learner does not know it.
export async function coverage(l: ConnectLearner, origin: string, ws: WorkspaceRef | null, st: StudyStructure, concepts: string[]) {
  const subjects = subjectsIn(st, ws);
  const ids = ws ? subjects.map(s => s.id) : null;
  const results = [];
  for (const c of concepts.slice(0, 60)) {
    const cw = words(c);
    const topic = subjects.flatMap(s => s.topics.filter(t => !t.archived).map(t => ({ s, t }))).find(x => key(x.t.name) === key(c) || (cw.length > 0 && cw.every(w => words(x.t.name).includes(w))));
    const notes = cw.length ? (await searchNoteBodies(l.profileId, [c], { take: 5, bodyMax: 0, subjectIds: ids })) : [];
    results.push({
      concept: c,
      status: topic ? "on_map" : notes.length ? "mentioned_in_notes" : "not_found_in_kivo",
      topic: topic ? { id: `topic:${topic.t.id}`, name: topic.t.name, subject: topic.s.name, studied: topic.t.hasHistory, url: linkTo(origin, "topic", topic.t.id) } : null,
      notes: notes.map(n => ({ id: `note:${n.id}`, title: n.title, url: linkTo(origin, "note", n.id) })),
    });
  }
  return results;
}

export async function profileOf(l: ConnectLearner) {
  const user = await prisma.user.findUnique({ where: { id: l.userId }, select: { name: true, email: true } });
  return { name: user?.name ?? null, email: user?.email ?? null };
}
