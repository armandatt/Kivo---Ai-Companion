// ─── Kivo Connect: curating a conversation, building a map (pure planners) ────
// The assistant (ChatGPT, Claude) reads the conversation and extracts the
// knowledge: it is the language model here, and Kivo adds none. Kivo's part
// is what only Kivo can do: compare each piece with what the learner already
// has, decide create / enrich / link / skip by explicit rules, keep the
// provenance it was given (and only that), and turn the result into changes
// (changes.ts) that are applied, read back and reported.
//
// No database and no model in this file: given the learner's structure and
// the notes found for each item, the plan is a function of its inputs.

import type { StudyStructure } from "../nova/product/setup-edit.types";
import { closest, type Overlap } from "./similarity";
import { subjectById, subjectByName, type Change } from "./changes";

export const CAPTURE_ITEMS_MAX   = 40;
export const CAPTURE_ITEM_MAX    = 60_000;
export const CAPTURE_EXCERPT_MAX = 100_000;
export const OUTLINE_NODES_MAX   = 150;
export const OUTLINE_DEPTH_MAX   = 4;

export const ITEM_KINDS = ["concept", "explanation", "example", "implementation", "decision", "open_question", "reference"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface CaptureItem {
  title: string;
  kind: ItemKind;
  body: string;                // Markdown, as detailed as the conversation was
  concepts?: string[];         // names of concepts it is about
  relatedTo?: string[];        // titles of other items in this capture, or of the learner's notes
}

export interface Provenance {
  client: string;              // the assistant, as it registered itself (not verified)
  conversationTitle?: string;
  conversationId?: string;
  sourceUrl?: string;
  capturedAt: string;          // the server's clock
}

export interface ExistingNote { id: string; title: string; body: string; subjectId: string | null; subjectName: string | null; topicName: string | null; updatedAt: Date }

export interface ItemDecision {
  index: number;
  title: string;
  kind: ItemKind;
  overlap: Overlap;
  action: "create" | "enrich" | "skip";
  why: string;
  matches: Array<{ noteId: string; title: string; overlap: Overlap; titleSimilarity: number; textSimilarity: number }>;
  topicName: string | null;
  links: string[];
}

const KIND_LABEL: Record<ItemKind, string> = {
  concept: "Concept", explanation: "Explanation", example: "Example", implementation: "Implementation detail",
  decision: "Decision", open_question: "Open question", reference: "Reference",
};

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// The provenance line, from known fields only. Nothing is filled in.
export function provenanceLine(p: Provenance): string {
  const parts = [`Captured from a conversation with ${p.client}`];
  if (p.conversationTitle) parts.push(`"${p.conversationTitle.replace(/["\n]/g, " ").slice(0, 160)}"`);
  if (p.sourceUrl) parts.push(`[source](${p.sourceUrl.replace(/[()\s]/g, encodeURIComponent)})`);
  if (p.conversationId) parts.push(`conversation ${p.conversationId.replace(/[^\w.:-]/g, "").slice(0, 80)}`);
  parts.push(p.capturedAt.slice(0, 10));
  return `*${parts.join(" · ")}*`;
}

export function noteText(item: CaptureItem, p: Provenance): string {
  const head = item.kind === "concept" ? "" : `> [!${item.kind === "open_question" ? "question" : item.kind === "example" ? "example" : "note"}] ${KIND_LABEL[item.kind]}\n\n`;
  return `${head}${item.body.trim()}\n\n${provenanceLine(p)}`;
}

export function addition(item: CaptureItem, p: Provenance): string {
  return `### ${KIND_LABEL[item.kind]}: ${item.title.trim()}\n\n${item.body.trim()}\n\n${provenanceLine(p)}`;
}

// The topic a captured item belongs to: one named for it, else a concept it
// names that is a topic of the target subject. Never a topic that does not exist,
// unless the assistant named it as the item's topic explicitly.
function topicFor(item: CaptureItem, explicit: string | null, subject: StudyStructure["subjects"][number] | null): string | null {
  if (explicit) return explicit;
  if (!subject) return null;
  const names = new Map(subject.topics.filter(t => !t.archived).map(t => [key(t.name), t.name]));
  for (const c of [item.title, ...(item.concepts ?? [])]) { const hit = names.get(key(c)); if (hit) return hit; }
  return null;
}

export interface CapturePlan { decisions: ItemDecision[]; changes: Change[]; target: { subjectId: string | null; subjectName: string | null; topicName: string | null; createSubject: boolean } }

export function planCapture(input: {
  items: CaptureItem[];
  provenance: Provenance;
  structure: StudyStructure;
  found: ExistingNote[][];           // per item: the learner's notes found for it
  subjectId?: string | null;
  subjectName?: string | null;
  topicName?: string | null;
  createSubject?: boolean;
}): CapturePlan {
  const st = input.structure;
  const named = input.subjectId ? subjectById(st, input.subjectId) : input.subjectName ? subjectByName(st, input.subjectName) : null;
  const createSubject = !named && !!input.subjectName && !!input.createSubject;
  const target = { subjectId: named?.id ?? null, subjectName: named?.name ?? (createSubject ? input.subjectName!.trim() : null), topicName: input.topicName?.trim() || null, createSubject };
  const changes: Change[] = [];
  if (createSubject) changes.push({ op: "add_subject", name: target.subjectName!, topics: target.topicName ? [target.topicName] : [] });
  else if (named && target.topicName && !named.topics.some(t => !t.archived && key(t.name) === key(target.topicName!))) {
    changes.push({ op: "add_topics", subjectId: named.id, names: [target.topicName] });
  }

  const decisions: ItemDecision[] = [];
  const createdTitles = new Map<string, string>();     // key → title, within this capture
  input.items.forEach((item, index) => {
    const near = closest({ title: item.title, body: item.body }, input.found[index] ?? [], 5);
    const top = near[0];
    const matches = near.map(c => ({ noteId: c.note.id, title: c.note.title, overlap: c.overlap, titleSimilarity: Math.round(c.titleScore * 100) / 100, textSimilarity: Math.round(c.textScore * 100) / 100 }));
    const topicName = topicFor(item, target.topicName, named);
    const base = { index, title: item.title, kind: item.kind, matches, topicName };
    const sameTitleInCapture = createdTitles.get(key(item.title));

    if (top?.overlap === "exact_duplicate") {
      decisions.push({ ...base, overlap: "exact_duplicate", action: "skip", why: `"${top.note.title}" already holds this text.`, links: [] });
      return;
    }
    if (top?.overlap === "same_concept") {
      // Same concept: a new explanation enriches the note; it is not dropped.
      changes.push({ op: "append_to_note", noteId: top.note.id, text: addition(item, input.provenance), baseUpdatedAt: top.note.updatedAt.toISOString() });
      decisions.push({ ...base, overlap: "same_concept", action: "enrich", why: `Adds to "${top.note.title}", which is about the same concept.`, links: [] });
      return;
    }
    if (sameTitleInCapture) {
      decisions.push({ ...base, overlap: "same_concept", action: "skip", why: `Another item in this capture is already titled "${sameTitleInCapture}"; merge them before sending.`, links: [] });
      return;
    }
    createdTitles.set(key(item.title), item.title);
    const links = [...new Set([
      ...near.filter(c => c.overlap === "related").slice(0, 3).map(c => c.note.title),
      ...(item.relatedTo ?? []).filter(t => key(t) !== key(item.title)),
    ])].slice(0, 6);
    const related = links.length ? `\n\n## Related\n\n${links.map(t => `- [[${t}]]`).join("\n")}` : "";
    changes.push({
      op: "create_note", title: item.title.trim(), body: noteText(item, input.provenance) + related,
      ...(target.subjectId ? { subjectId: target.subjectId } : target.subjectName ? { subjectName: target.subjectName } : {}),
      ...(topicName ? { topicName } : {}),
    });
    decisions.push({ ...base, overlap: top?.overlap ?? "new", action: "create", why: top ? `Related to "${top.note.title}" but a distinct concept: a new note linked to it.` : "Nothing in the learner's notes is close.", links });
  });
  return { decisions, changes, target };
}

// ── Building or extending a map ──────────────────────────────────────────────

export interface OutlineNode { name: string; explanation?: string; children?: OutlineNode[] }

export interface MapBuildPlan {
  subject: { id: string | null; name: string; exists: boolean };
  reused: Array<{ name: string; topicId: string; under: string | null }>;
  added: Array<{ name: string; under: string | null }>;
  refused: string[];
  changes: Change[];
}

// Each outline node is a topic: matched to one the subject already has by
// name (anywhere in it: it is reused where it is, never moved), else added
// under its parent. Siblings go in one add_topics; explanations only for
// topics that have none... or for new ones, via describe_topic after the add.
// updateExplanations: write the outline's explanation over a topic that
// already exists (it may have its own). Off: only new topics get one.
export function planMapBuild(st: StudyStructure, input: { subjectId?: string; subjectName?: string; parentSubjectName?: string; outline: OutlineNode[]; updateExplanations?: boolean }): MapBuildPlan {
  const existing = input.subjectId ? subjectById(st, input.subjectId) : input.subjectName ? subjectByName(st, input.subjectName) : null;
  const name = existing?.name ?? input.subjectName?.trim() ?? "";
  const plan: MapBuildPlan = { subject: { id: existing?.id ?? null, name, exists: !!existing }, reused: [], added: [], refused: [], changes: [] };
  if (!name) { plan.refused.push("Name the subject the map is for (subjectId or subjectName)."); return plan; }
  const have = new Map((existing?.topics ?? []).filter(t => !t.archived).map(t => [key(t.name), t] as const));
  const seen = new Set<string>();
  const groups = new Map<string, { parent: string | null; names: string[] }>();
  const describe: Array<{ name: string; explanation: string }> = [];
  let count = 0;

  const walk = (nodes: OutlineNode[], parent: string | null, depth: number) => {
    for (const n of nodes) {
      const nm = n.name.trim().replace(/\s+/g, " ");
      if (!nm) continue;
      if (++count > OUTLINE_NODES_MAX) { if (count === OUTLINE_NODES_MAX + 1) plan.refused.push(`Only the first ${OUTLINE_NODES_MAX} topics are used.`); return; }
      if (depth > OUTLINE_DEPTH_MAX) { plan.refused.push(`"${nm}" is deeper than ${OUTLINE_DEPTH_MAX} levels; left out.`); continue; }
      if (seen.has(key(nm))) { plan.refused.push(`"${nm}" appears twice in the outline; used once.`); continue; }
      seen.add(key(nm));
      const there = have.get(key(nm));
      if (there) {
        plan.reused.push({ name: there.name, topicId: there.id, under: there.parentId ? existing!.topics.find(t => t.id === there.parentId)?.name ?? null : null });
        if (n.explanation?.trim() && input.updateExplanations) describe.push({ name: there.name, explanation: n.explanation.trim() });
      } else {
        const g = groups.get(parent ?? "\u0000") ?? { parent, names: [] };
        g.names.push(nm);
        groups.set(parent ?? "\u0000", g);
        plan.added.push({ name: nm, under: parent });
        if (n.explanation?.trim()) describe.push({ name: nm, explanation: n.explanation.trim() });
      }
      if (n.children?.length) walk(n.children, there?.name ?? nm, depth + 1);
    }
  };
  walk(input.outline, null, 1);

  if (!existing) plan.changes.push({ op: "add_subject", name, ...(input.parentSubjectName ? { parentSubjectName: input.parentSubjectName } : {}), topics: groups.get("\u0000")?.names ?? [] });
  for (const [k, g] of groups) {
    if (!existing && k === "\u0000") continue;
    for (let i = 0; i < g.names.length; i += 40) {
      plan.changes.push({ op: "add_topics", ...(existing ? { subjectId: existing.id } : { subjectName: name }), names: g.names.slice(i, i + 40), ...(g.parent ? { parentTopicName: g.parent } : {}) });
    }
  }
  // Explanations are written only for topics that already exist now; a new
  // topic's explanation is returned for a second call once it has an id.
  for (const d of describe) {
    const t = have.get(key(d.name));
    if (t) plan.changes.push({ op: "describe_topic", topicId: t.id, explanation: d.explanation });
  }
  return plan;
}
