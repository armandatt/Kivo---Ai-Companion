// ─── Topics as a tree: the rules, pure ────────────────────────────────────────
// A topic can sit inside another topic of the same subject (a unit, its
// topics, their subtopics), as deep as TOPIC_DEPTH_MAX, in the order its
// position gives among the topics beside it. The tree rules themselves are
// task-tree.ts's (canPlace, untangle, treeOrder), with this cap.
//
// What is studied (product decision, 26 Oct): only a leaf. A topic with
// active topics inside it organises them and is never queued, reviewed or
// counted on its own, so one concept is never counted twice; a milestone (a
// stage of work in a project or roadmap) is never studied at all. A leaf
// that gets topics inside it stops being queued and keeps its mastery and
// history on its row; if those topics go again, it is a leaf again and comes
// back with what it had.
//
// No imports beyond types and the tree rules, so the web app imports it.

import { treeOrder } from "./task-tree";

export const TOPIC_DEPTH_MAX = 6;
export const TOPIC_KINDS = ["milestone"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

export const topicKindOf = (v: unknown): TopicKind | null => (v === "milestone" ? "milestone" : null);

// What a plan said about a topic, kept on its row (NovaTopicMastery.details).
export interface TopicSource { file: string; page: number | null }
export interface TopicResource { title: string; kind: string; url: string | null; origin: "source" | "user" | "nova" }
export interface TopicDetails {
  explanation?: string | null;
  sources?:     TopicSource[];
  // A milestone's: an estimate of the effort, what it achieves, how it is practised, and when it is done.
  weeks?:        number | null;
  hoursPerWeek?: number | null;
  goals?:        string[];
  exercises?:    string[];
  project?:      string | null;
  completion?:   string | null;
  resources?:    TopicResource[];
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const texts = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.map(x => text(x, max)).filter((x): x is string => x !== null).slice(0, n) : []);
const amount = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : null);

// A stored details value, read back: only the fields above, each checked. null: nothing to keep.
export function readTopicDetails(raw: unknown): TopicDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: TopicDetails = {};
  const explanation = text(r.explanation, 600);
  if (explanation) out.explanation = explanation;
  const sources = (Array.isArray(r.sources) ? r.sources : []).flatMap(s => {
    const file = text((s as { file?: unknown } | null)?.file, 120);
    const page = (s as { page?: unknown } | null)?.page;
    return file ? [{ file, page: typeof page === "number" && Number.isInteger(page) && page > 0 ? page : null }] : [];
  }).slice(0, 5);
  if (sources.length) out.sources = sources;
  const weeks = amount(r.weeks, 104), hours = amount(r.hoursPerWeek, 80);
  if (weeks) out.weeks = weeks;
  if (hours) out.hoursPerWeek = hours;
  const goals = texts(r.goals, 10, 240), exercises = texts(r.exercises, 10, 240);
  if (goals.length) out.goals = goals;
  if (exercises.length) out.exercises = exercises;
  const project = text(r.project, 240), completion = text(r.completion, 240);
  if (project) out.project = project;
  if (completion) out.completion = completion;
  const resources = (Array.isArray(r.resources) ? r.resources : []).flatMap(x => {
    const v = x as Record<string, unknown> | null;
    const title = text(v?.title, 160);
    if (!title) return [];
    const origin = v?.origin === "source" || v?.origin === "user" ? v.origin : "nova";
    return [{ title, kind: text(v?.kind, 20) ?? "other", url: origin === "nova" ? null : text(v?.url, 500), origin } as TopicResource];
  }).slice(0, 12);
  if (resources.length) out.resources = resources;
  return Object.keys(out).length ? out : null;
}

export interface TopicNode {
  id:        string;
  parentId?: string | null;
  position?: number | null;
  kind?:     string | null;   // a TopicKind; anything else is read as a topic
  archived?: boolean;
  // A tie-break for rows with no position: the order they were added in.
  createdAt?: string | Date | null;
}

// Siblings in their saved order: by position, then (an older row with none)
// in the order they were added, after the placed ones. Never by name.
export function compareTopics(a: TopicNode, b: TopicNode): number {
  const pa = a.position ?? null, pb = b.position ?? null;
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  if (pa === null && pb !== null) return 1;
  if (pa !== null && pb === null) return -1;
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0, tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return ta - tb;
}

// The topics of one subject as an outline: parents before what is inside
// them, siblings in their saved order. A parent that is not among them (a
// topic moved away, or archived and left out) leaves its topics at the top.
export function topicOutline<T extends TopicNode>(topics: readonly T[]): Array<{ item: T; depth: number }> {
  const sorted = [...topics].sort(compareTopics);
  return treeOrder(sorted.map(t => ({ ...t, parent: t.parentId ?? null }))).map(({ item, depth }) => ({ item: item as unknown as T, depth }));
}

// The topics that are studied on their own: active leaves that are not milestones.
export function studyTopicIds(topics: readonly TopicNode[]): Set<string> {
  const parents = new Set(topics.filter(t => !t.archived && t.parentId).map(t => t.parentId!));
  return new Set(topics.filter(t => !t.archived && topicKindOf(t.kind) === null && !parents.has(t.id)).map(t => t.id));
}

export const isStudyTopic = (t: TopicNode, all: readonly TopicNode[]): boolean => studyTopicIds(all).has(t.id);
