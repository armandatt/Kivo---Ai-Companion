// ─── Workspace plan: what a template or Nova proposes to create ───────────────
// One shape for both: a template applied to the learner's inputs
// (planFromTemplate) and a plan Nova wrote (workspace-generation.ts) are the
// same WorkspacePlan, checked by the same checkWorkspacePlan before it is
// shown and again, on the server, before anything is created. The page may
// edit a plan; the server never trusts the copy it gets back.
//
// The plan is the records it creates, nothing beside them (workspaces.ts
// makes them, each through its own writer, in one transaction):
//   subjects            → Knowledge, the Map, the Planner's new material;
//                         one may sit inside another (Semester Five › DSA)
//   topics              → a tree in each subject, in order: units, their
//                         topics, their subtopics (topic-tree.ts). Only a
//                         leaf is studied. A milestone is a topic of kind
//                         "milestone": a stage of a project or roadmap, with
//                         its effort, goals and done-when on its row.
//   dates               → Today, the Planner, the calendar (exams.ts)
//   tasks               → the Planner's board and the calendar (tasks.ts),
//                         nested in steps, each waiting on any others it
//                         needs (NovaTaskDependency)
//   notes               → Notes and the Map (notes.ts): only notes the plan
//                         means as notes; what a topic covers stays on it.
// What applies to the whole workspace (prerequisites, resources,
// assumptions) is kept with the workspace row.
//
// What the check changes or leaves out it says, in `dropped`: nothing goes
// silently.
//
// Honesty rules, held here and not left to the model:
//   - a source reference names a file the learner gave and a page or none;
//   - a resource keeps a web address only when it came from the learner's
//     own words or files: an address Nova suggested is dropped, never shown
//     as checked;
//   - what came from the learner's files and what Nova added are labelled
//     apart in every note this writes.
//
// Pure, no imports beyond types and the tree rules, so the web app renders
// and edits with it.

import { TASK_DEPTH_MAX, treeOrder, untangle } from "./task-tree";
import { SUBJECT_DEPTH_MAX } from "./setup-edit.types";
import { TOPIC_DEPTH_MAX, readTopicDetails, topicKindOf, type TopicDetails, type TopicKind } from "./topic-tree";
import type { StudyTemplate, TemplateCategory } from "./templates";
import { TEMPLATE_CATEGORIES } from "./templates";
import type { DeadlineType } from "./deadline-types";

// 2: topics nest and milestones are topics; tasks wait on a list. A stored
// version-1 plan is read into this shape by checkWorkspacePlan.
export const PLAN_VERSION = 2;

// The same limits the prompts state (workspace-generation.ts) and the
// writers hold (MAX_TOPICS_PER_SUBJECT, TASK_OPEN_MAX).
export const PLAN_LIMITS = {
  title: 80, summary: 400, subjects: 12, topicsPerSubject: 200, name: 80, explanation: 600,
  tasks: 80, taskTitle: 160, priorityReason: 160, notes: 20, noteTitle: 120, noteBody: 8000, dates: 10,
  milestones: 12, listItems: 10, item: 240, resources: 12, prerequisites: 10, assumptions: 6, sources: 5, after: 5,
} as const;

const DATE_KINDS: readonly DeadlineType[] = ["exam", "assignment", "project", "interview", "certification", "other"];
const RESOURCE_KINDS = ["book", "course", "docs", "video", "practice", "article", "tool", "other"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface SourceRef { file: string; page: number | null }
export interface PlanResource {
  title: string; kind: ResourceKind; url: string | null;
  // source: named in the learner's files. user: in their own request. nova:
  // Nova's suggestion from general knowledge, not checked.
  origin: "source" | "user" | "nova";
}
// A milestone's own fields: effort is an estimate, never a promise.
export interface MilestoneDetails {
  weeks: number | null; hoursPerWeek: number | null;
  goals: string[]; exercises: string[]; project: string | null; completion: string | null; resources: PlanResource[];
}
// A topic, in the order it is learnt among the topics beside it
// (prerequisites first). parent: the topic of the same subject it sits
// inside, by name (a subject holds a name once); absent or null: at the top
// of its subject. kind "milestone": a stage of work (milestone holds its
// fields), never studied.
export interface PlanTopic {
  name: string; explanation: string | null; sources: SourceRef[];
  parent?: string | null;
  kind?: TopicKind;
  milestone?: MilestoneDetails;
}
// parent: another subject of the plan it sits inside ("Semester Five"), by name.
export interface PlanSubject { name: string; topics: PlanTopic[]; parent?: string | null }
export interface PlanTask {
  // priority is the learner's own, never Nova's: a plan Nova writes carries
  // its view as suggestedPriority, with the reason, for them to accept.
  key: string; title: string; priority: "low" | "medium" | "high" | null;
  suggestedPriority?: "low" | "medium" | "high" | null;
  priorityReason?: string | null;
  // The key of the task in this plan it is a step of (product/task-tree.ts).
  parent?: string | null;
  subject: string | null; topic: string | null; dueDay: string | null; estimatedMinutes: number | null;
  // The keys of tasks in the same plan that must be finished first, because
  // this one needs what they produce (NovaTaskDependency once built).
  after?: string[];
}
export interface PlanNote {
  key: string; title: string; subject: string | null; topic: string | null; body: string;
  // template: a template's empty headings. source: drawn from the learner's
  // files (with sources). nova: Nova's own writing.
  origin: "template" | "source" | "nova"; sources: SourceRef[];
}
export interface PlanDate { title: string; subject: string | null; kind: DeadlineType; day: string }
export interface PlanSourceFile { file: string; read: boolean; pages: number | null; note: string | null }

export interface WorkspacePlan {
  version:         typeof PLAN_VERSION;
  kind:            "template" | "custom";
  templateId:      string | null;
  templateVersion: number | null;
  category:        TemplateCategory | null;
  title:           string;
  summary:         string;
  prerequisites:   string[];
  subjects:        PlanSubject[];
  dates:           PlanDate[];
  tasks:           PlanTask[];
  notes:           PlanNote[];
  resources:       PlanResource[];
  // The files it was made from, and whether each could be read.
  sources:         PlanSourceFile[];
  // What the plan takes as given (time a week, no web search, …).
  assumptions:     string[];
}

// ── Reading a plan's tree (the page and the server alike) ─────────────────────

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

// A subject's topics as an outline: each after the topic it sits inside,
// siblings in the plan's order. index: its place in subject.topics.
export function topicRows(subject: Pick<PlanSubject, "topics">): Array<{ topic: PlanTopic; index: number; depth: number }> {
  const rows = subject.topics.map((t, index) => ({ id: t.name.toLowerCase(), parent: t.parent ? t.parent.toLowerCase() : null, topic: t, index }));
  return treeOrder(rows).map(({ item, depth }) => ({ topic: item.topic, index: item.index, depth }));
}

// The milestones of a plan, in order: each subject's, in its outline order.
export function milestonesOf(plan: Pick<WorkspacePlan, "subjects">): Array<{ subject: string; subjectIndex: number; topic: PlanTopic; index: number }> {
  return plan.subjects.flatMap((s, subjectIndex) => topicRows(s).filter(r => r.topic.kind === "milestone").map(r => ({ subject: s.name, subjectIndex, topic: r.topic, index: r.index })));
}

// Topics with topics inside them: they organise, and only the others are studied.
export function parentTopicNames(subject: Pick<PlanSubject, "topics">): Set<string> {
  return new Set(subject.topics.filter(t => t.parent).map(t => t.parent!.toLowerCase()));
}

export type PlanCheck =
  | { ok: true; plan: WorkspacePlan; dropped: string[] }
  | { ok: false; message: string };

// ── Small readers ─────────────────────────────────────────────────────────────

// A topic name that says nothing about what to study: "Introduction",
// "Advanced concepts", "Practice questions", or the subject's own name with
// such a word ("Basics of DSA"). Practice and revision belong in tasks; a
// topic names its content. Compared by words, any case.
const PLACEHOLDER_NAMES = new Set([
  "introduction", "intro", "basics", "basic concepts", "fundamentals", "overview", "getting started", "advanced", "advanced concepts",
  "advanced topics", "miscellaneous", "misc", "other topics", "others", "practice", "practice questions", "practice problems",
  "exercises", "revision", "review", "summary", "conclusion", "exam preparation", "exam prep", "mock tests", "mock test", "important topics",
  "core concepts", "key concepts", "theory", "concepts", "topics",
]);
const PLACEHOLDER_AROUND = ["introduction to", "intro to", "basics of", "fundamentals of", "overview of", "advanced", "basic"];
const wordsOf = (text: string): string => {
  let out = "", space = true;
  for (const c of text.toLowerCase()) {
    const keep = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c > "\u007f";
    if (keep) { out += c; space = false; } else if (!space) { out += " "; space = true; }
  }
  return out.trim();
};
export function isPlaceholderTopic(name: string, within: string): boolean {
  const n = wordsOf(name), w = wordsOf(within);
  if (!n) return true;
  if (PLACEHOLDER_NAMES.has(n) || (w && n === w)) return true;
  // The general word wrapped around the subject's own name: "Basics of DSA", "DSA fundamentals".
  for (const p of PLACEHOLDER_AROUND) if (w && (n === `${p} ${w}`)) return true;
  for (const p of ["basics", "fundamentals", "overview", "introduction", "concepts", "advanced concepts"]) if (w && n === `${w} ${p}`) return true;
  return false;
}

export function oneLine(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  let out = "";
  let gap = false;
  for (const ch of text) {
    const blank = ch.trim() === "" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127;
    if (blank) { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += ch;
    gap = false;
  }
  return [...out].slice(0, max).join("").trim();
}

// Paragraphs kept, carriage returns and control characters out.
function block(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const lines = text.split("\r").join("").split("\n").map(l => [...l].filter(ch => ch === "\t" || ch.charCodeAt(0) >= 32).join("").trimEnd());
  return lines.join("\n").trim().slice(0, max);
}

const list = (value: unknown, maxItems: number, maxLen: number): string[] =>
  (Array.isArray(value) ? value : []).map(v => oneLine(v, maxLen)).filter(Boolean).slice(0, maxItems);

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  const digits = value.slice(0, 4) + value.slice(5, 7) + value.slice(8);
  if ([...digits].some(c => c < "0" || c > "9")) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const positive = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : null;

// Only an http(s) address, without credentials.
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const u = new URL(value.trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function sourcesOf(value: unknown, files: readonly string[]): SourceRef[] {
  if (!Array.isArray(value)) return [];
  const out: SourceRef[] = [];
  for (const v of value.slice(0, 5)) {
    if (!v || typeof v !== "object") continue;
    const file = oneLine((v as { file?: unknown }).file, 120);
    // A reference to a file the learner did not give is not a reference.
    const known = files.find(f => same(f, file));
    if (!known) continue;
    const page = (v as { page?: unknown }).page;
    out.push({ file: known, page: typeof page === "number" && Number.isInteger(page) && page > 0 && page < 5000 ? page : null });
  }
  return out;
}

function resourcesOf(value: unknown, ctx: { files: readonly string[]; userText: string }, max: number): PlanResource[] {
  if (!Array.isArray(value)) return [];
  const out: PlanResource[] = [];
  for (const v of value) {
    if (out.length >= max || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const title = oneLine(r.title, 160);
    if (!title) continue;
    const kind = RESOURCE_KINDS.find(k => k === r.kind) ?? "other";
    const claimed = r.origin === "source" || r.origin === "user" ? r.origin : "nova";
    const url = cleanUrl(r.url);
    // An address counts only when the learner wrote it: in their request.
    // (A file's addresses cannot be checked here, so those are kept off too.)
    const fromUser = url !== null && ctx.userText.includes(url.endsWith("/") ? url.slice(0, -1) : url);
    const origin: PlanResource["origin"] = fromUser ? "user" : claimed === "source" && ctx.files.length > 0 ? "source" : "nova";
    out.push({ title, kind, url: fromUser ? url : null, origin });
  }
  return out;
}

const slug = (text: string, i: number) => {
  let s = "";
  for (const ch of text.toLowerCase()) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) s += ch;
    else if (s && !s.endsWith("-")) s += "-";
    if (s.length >= 40) break;
  }
  if (s.endsWith("-")) s = s.slice(0, -1);
  return `${s || "item"}-${i}`;
};

// ── The check ─────────────────────────────────────────────────────────────────

export interface PlanContext {
  // The learner's calendar day: no date before it.
  today:    string;
  // Names of the files the learner gave, as uploaded.
  files?:   readonly string[];
  // Their request, in their words: the only place a web address is taken from.
  userText?: string;
  // Nova wrote it: a priority it gives is a suggestion (kept only with a
  // reason), never the learner's own priority.
  nova?: boolean;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function milestoneOf(x: Record<string, unknown>, rctx: { files: readonly string[]; userText: string }): MilestoneDetails {
  return {
    weeks: positive(x.weeks, 104), hoursPerWeek: positive(x.hoursPerWeek, 80),
    goals: list(x.goals, PLAN_LIMITS.listItems, PLAN_LIMITS.item),
    exercises: list(x.exercises, PLAN_LIMITS.listItems, PLAN_LIMITS.item),
    project: oneLine(x.project, PLAN_LIMITS.item) || null,
    completion: oneLine(x.completion, PLAN_LIMITS.item) || null,
    resources: resourcesOf(x.resources, rctx, 6),
  };
}

// Everything a plan may say, checked and normalized. What does not fit is
// dropped or moved, and said in `dropped`; nothing is cut silently.
//
// Topics are read as a tree in any of the shapes a plan comes in: nested
// (a topic's own "topics"), flat with "parent" (the shape stored and edited),
// or as an older plan said it ("unit" and "subtopics"; milestones in
// "phases"). Each becomes a topic of its subject, under its parent, in order.
export function checkWorkspacePlan(raw: unknown, ctx: PlanContext): PlanCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "That isn't a workspace plan." };
  const r = raw as Record<string, unknown>;
  const files = ctx.files ?? [];
  const rctx = { files, userText: ctx.userText ?? "" };
  const dropped: string[] = [];

  const title = oneLine(r.title, PLAN_LIMITS.title);
  if (!title) return { ok: false, message: "The workspace needs a name." };

  // ── Subjects and their topics ──
  const subjects: PlanSubject[] = [];
  // A topic's parent given by name in the flat shape, settled once every topic is read.
  const named = new Map<PlanTopic, string>();
  const findTopic = (s: PlanSubject, name: string) => s.topics.find(t => same(t.name, name));
  // Adds a topic under `parent` (a name in this subject, or null). A name
  // already taken elsewhere in the subject is told apart by its parent's
  // name; the same topic listed twice in one place is kept once. Returns the
  // topic's name in the plan, or null when it is left out.
  const addTopic = (s: PlanSubject, t: PlanTopic): string | null => {
    const there = findTopic(s, t.name);
    if (there) {
      if ((there.parent ?? null)?.toLowerCase() === (t.parent ?? null)?.toLowerCase()) {
        if (t.kind === "milestone" && there.kind !== "milestone") { there.kind = "milestone"; there.milestone = t.milestone; }
        return there.name;
      }
      const apart = oneLine(`${t.name} (${t.parent ?? s.name})`, PLAN_LIMITS.name);
      if (findTopic(s, apart)) { dropped.push(`topic "${t.name}" in ${s.name} (listed twice)`); return null; }
      dropped.push(`topic "${t.name}" under ${t.parent ?? s.name} renamed "${apart}" (a subject holds a name once)`);
      t = { ...t, name: apart };
    }
    if (s.topics.length >= PLAN_LIMITS.topicsPerSubject) { dropped.push(`topic "${t.name}" (more than ${PLAN_LIMITS.topicsPerSubject} in ${s.name})`); return null; }
    s.topics.push(t);
    return t.name;
  };
  const readTopics = (s: PlanSubject, items: unknown[], parent: string | null) => {
    for (const item of items) {
      const x = (typeof item === "string" ? { name: item } : item) as Record<string, unknown> | null;
      if (!x || typeof x !== "object" || Array.isArray(x)) continue;
      const name = oneLine(x.name, PLAN_LIMITS.name);
      if (!name) continue;
      // An older plan's unit is a topic this one sits inside.
      let under = parent;
      const unit = parent === null ? oneLine(x.unit, PLAN_LIMITS.name) : "";
      if (unit && !same(unit, name)) under = addTopic(s, { name: unit, explanation: null, sources: [] }) ?? null;
      if (isPlaceholderTopic(name, under ?? s.name)) { dropped.push(`topic "${name}" in ${s.name} (too general to study from: name what it covers)`); continue; }
      const kind = topicKindOf(x.kind);
      const topic: PlanTopic = {
        name, explanation: block(x.explanation, PLAN_LIMITS.explanation) || null, sources: sourcesOf(x.sources, files),
        ...(under ? { parent: under } : {}),
        ...(kind ? { kind, milestone: milestoneOf((x.milestone && typeof x.milestone === "object" ? x.milestone : x) as Record<string, unknown>, rctx) } : {}),
      };
      const at = addTopic(s, topic);
      if (at === null) continue;
      const flatParent = under === null ? oneLine(x.parent, PLAN_LIMITS.name) : "";
      const placed = findTopic(s, at);
      if (flatParent && placed && !same(flatParent, at)) named.set(placed, flatParent);
      readTopics(s, [...arr(x.topics), ...arr(x.children), ...arr(x.subtopics)], at);
    }
  };
  for (const raw of arr(r.subjects)) {
    if (!raw || typeof raw !== "object") continue;
    const x = raw as Record<string, unknown>;
    const name = oneLine(x.name, PLAN_LIMITS.name);
    if (!name) { dropped.push("a subject with no name"); continue; }
    let into = subjects.find(v => same(v.name, name));
    if (!into) {
      if (subjects.length >= PLAN_LIMITS.subjects) { dropped.push(`subject "${name}" (more than ${PLAN_LIMITS.subjects})`); continue; }
      into = { name, topics: [] };
      subjects.push(into);
    }
    readTopics(into, arr(x.topics), null);
  }
  const subjectName = (v: unknown): string | null => {
    const n = oneLine(v, PLAN_LIMITS.name);
    return n ? subjects.find(s => same(s.name, n))?.name ?? null : null;
  };

  // Milestones given apart ("phases": an older plan, or a reply that lists
  // them so): topics of kind milestone, at the top of the subject each
  // names, before its other topics, in their order.
  const phases = arr(r.phases);
  const firstOf = new Map<PlanSubject, PlanTopic[]>();
  for (const [i, p] of phases.entries()) {
    if (!p || typeof p !== "object") continue;
    const x = p as Record<string, unknown>;
    const name = oneLine(x.name, PLAN_LIMITS.name);
    if (!name) continue;
    if (i >= PLAN_LIMITS.milestones) { dropped.push(`milestone "${name}" (more than ${PLAN_LIMITS.milestones})`); continue; }
    let into = subjects.find(s => s.name === subjectName(x.subject));
    if (!into) {
      if (subjects.length === 0) { into = { name: title, topics: [] }; subjects.push(into); }
      else {
        into = subjects[0]!;
        if (subjects.length > 1) dropped.push(`milestone "${name}" filed under ${into.name} (it named no subject of the plan)`);
      }
    }
    // A topic of that name already there is that milestone, kept once.
    let topic = findTopic(into, name);
    if (topic) {
      if (topic.kind !== "milestone") dropped.push(`topic "${name}" in ${into.name} kept once, as the milestone of that name`);
      topic.kind = "milestone";
      topic.milestone = milestoneOf(x, rctx);
      delete topic.parent;
    } else {
      const at = addTopic(into, { name, explanation: null, sources: [], kind: "milestone", milestone: milestoneOf(x, rctx) });
      topic = at ? findTopic(into, at) : undefined;
    }
    if (!topic) continue;
    firstOf.set(into, [...(firstOf.get(into) ?? []), topic]);
    readTopics(into, [...arr(x.topics), ...arr(x.concepts)], topic.name);
  }
  for (const [s, first] of firstOf) s.topics = [...first, ...s.topics.filter(t => !first.includes(t))];

  // Parents named by name (the flat shape), then the tree made sound: under
  // a topic of the same subject, never in a loop, never too deep.
  for (const s of subjects) {
    for (const t of s.topics) {
      const given = named.get(t);
      if (!given) continue;
      const parent = findTopic(s, given);
      if (parent && parent !== t) t.parent = parent.name;
      else dropped.push(`the place of topic "${t.name}" (inside "${given}", which isn't a topic of ${s.name}): at the top of ${s.name}`);
    }
    const before = new Map(s.topics.map(t => [t.name.toLowerCase(), t.parent ? t.parent.toLowerCase() : null]));
    const tree = untangle(s.topics.map(t => ({ id: t.name.toLowerCase(), parent: t.parent ? t.parent.toLowerCase() : null })), TOPIC_DEPTH_MAX);
    for (const t of s.topics) {
      const p = tree.find(n => n.id === t.name.toLowerCase())?.parent ?? null;
      if (p !== before.get(t.name.toLowerCase())) dropped.push(`the place of topic "${t.name}" (${p === null ? "it went round in a circle" : `topics go at most ${TOPIC_DEPTH_MAX} levels deep`}): moved up`);
      if (p) t.parent = s.topics.find(x => x.name.toLowerCase() === p)!.name;
      else delete t.parent;
    }
  }

  // A subject inside another of the plan's: never itself, no loop, not too deep.
  const parents = untangle(subjects.map(s => {
    const given = arr(r.subjects).find(x => x && typeof x === "object" && same(oneLine((x as { name?: unknown }).name, PLAN_LIMITS.name), s.name)) as { parent?: unknown } | undefined;
    return { id: s.name, parent: subjectName(given?.parent) };
  }), SUBJECT_DEPTH_MAX);
  for (const s of subjects) { const p = parents.find(x => x.id === s.name)?.parent ?? null; if (p) s.parent = p; }

  // ── Dates ──
  const dates: PlanDate[] = [];
  for (const d of arr(r.dates)) {
    if (!d || typeof d !== "object") continue;
    const x = d as Record<string, unknown>;
    const dtitle = oneLine(x.title, PLAN_LIMITS.name);
    if (!dtitle) continue;
    if (!isIsoDay(x.day) || x.day < ctx.today) { dropped.push(`date "${dtitle}" (not a day from today on)`); continue; }
    if (dates.length >= PLAN_LIMITS.dates) { dropped.push(`date "${dtitle}" (more than ${PLAN_LIMITS.dates})`); continue; }
    dates.push({ title: dtitle, subject: subjectName(x.subject), kind: DATE_KINDS.find(k => k === x.kind) ?? "other", day: x.day });
  }

  // ── Tasks ──
  // The topic a task is filed under, by name: one of its subject's, or of
  // any subject when it names none (it then goes under that subject).
  const topicFor = (subject: string | null, topic: string): { subject: string; topic: string } | null => {
    const within = subject ? subjects.filter(s => s.name === subject) : subjects;
    for (const s of within) { const t = findTopic(s, topic); if (t) return { subject: s.name, topic: t.name }; }
    return null;
  };
  const tasks: PlanTask[] = [];
  for (const [i, t] of arr(r.tasks).entries()) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    const ttitle = oneLine(x.title, PLAN_LIMITS.taskTitle);
    if (!ttitle) continue;
    const tparent = oneLine(x.parent, 60) || null;
    // One title once among a task's steps: two "Write tests" under two features are two tasks.
    if (tasks.some(k => same(k.title, ttitle) && (k.parent ?? null) === tparent)) { dropped.push(`task "${ttitle}" (listed twice)`); continue; }
    if (tasks.length >= PLAN_LIMITS.tasks) { dropped.push(`task "${ttitle}" (more than ${PLAN_LIMITS.tasks})`); continue; }
    let key = oneLine(x.key, 60) || slug(ttitle, i);
    if (tasks.some(k => k.key === key)) key = `${key}-${i}`;
    if (x.dueDay != null && x.dueDay !== "" && !(isIsoDay(x.dueDay) && x.dueDay >= ctx.today)) dropped.push(`the due day of "${ttitle}" (not a day from today on)`);
    const due = isIsoDay(x.dueDay) && x.dueDay >= ctx.today ? x.dueDay : null;
    const minutes = typeof x.estimatedMinutes === "number" && Number.isInteger(x.estimatedMinutes) && x.estimatedMinutes >= 5 && x.estimatedMinutes <= 600 ? x.estimatedMinutes : null;
    const level = (v: unknown) => (v === "low" || v === "medium" || v === "high" ? v : null);
    const reason = oneLine(x.priorityReason, PLAN_LIMITS.priorityReason) || null;
    // Nova's priority is a suggestion, and only with a reason it can give.
    const suggested = ctx.nova ? (level(x.suggestedPriority) ?? level(x.priority)) : level(x.suggestedPriority);
    let subject = subjectName(x.subject);
    if (x.subject && !subject && oneLine(x.subject, PLAN_LIMITS.name)) dropped.push(`the subject of "${ttitle}" ("${oneLine(x.subject, PLAN_LIMITS.name)}" isn't one of the plan's)`);
    const asked = oneLine(x.topic, PLAN_LIMITS.name);
    const found = asked ? topicFor(subject, asked) : null;
    if (asked && !found) dropped.push(`the topic of "${ttitle}" ("${asked}" isn't in the plan${subject ? `'s ${subject}` : ""}; it stays under ${subject ?? "no topic"})`);
    if (found) subject = found.subject;
    const after = [...new Set((Array.isArray(x.after) ? x.after : x.after ? [x.after] : []).map(a => oneLine(a, 60)).filter(Boolean))];
    tasks.push({
      key, title: ttitle, priority: ctx.nova ? null : level(x.priority),
      ...(suggested && reason ? { suggestedPriority: suggested, priorityReason: reason } : {}),
      subject, topic: found?.topic ?? null, dueDay: due, estimatedMinutes: minutes,
      after, parent: tparent,
    });
  }
  // Steps: under a task of this plan, never in a loop, within the depth. A
  // step is filed where the task it belongs to is.
  const tree = untangle(tasks.map(t => ({ id: t.key, parent: t.parent ?? null })));
  for (const [i, t] of tasks.entries()) {
    const p = tree[i]!.parent;
    if ((t.parent ?? null) !== p) dropped.push(`the place of "${t.title}" (${t.parent && !tasks.some(k => k.key === t.parent) ? "a step of a task that isn't in the plan" : `steps go at most ${TASK_DEPTH_MAX} levels deep, never in a circle`}): ${p ? "moved up" : "a task of its own"}`);
    t.parent = p;
  }
  const keyed = new Map(tasks.map(t => [t.key, t]));
  const ancestors = (t: PlanTask): string[] => {
    const out: string[] = [];
    for (let at = t.parent ?? null, hops = 0; at && hops <= TASK_DEPTH_MAX; hops++) { out.push(at); at = keyed.get(at)?.parent ?? null; }
    return out;
  };
  for (const t of tasks) {
    const top = ancestors(t).at(-1);
    const root = top ? keyed.get(top) : undefined;
    if (root) { t.subject = root.subject ?? t.subject; t.topic = root.topic ?? t.topic; }
  }
  // Waits: on other tasks of this plan, a few each, never round in a circle.
  // A step waiting on one beside it, or a task on what it is part of or
  // holds, says nothing the outline doesn't: left out, and said once.
  let inOrder = 0;
  for (const t of tasks) {
    const kept: string[] = [];
    for (const k of t.after ?? []) {
      const on = keyed.get(k);
      if (!on || on === t) { dropped.push(`a wait in "${t.title}" (on a task that isn't in the plan)`); continue; }
      if ((on.parent ?? null) === (t.parent ?? null) && t.parent) { inOrder++; continue; }
      if (ancestors(t).includes(on.key) || ancestors(on).includes(t.key)) { inOrder++; continue; }
      if (kept.length >= PLAN_LIMITS.after) { dropped.push(`"${t.title}" waiting on "${on.title}" (more than ${PLAN_LIMITS.after} waits)`); continue; }
      kept.push(on.key);
    }
    t.after = kept;
  }
  if (inOrder) dropped.push(`${inOrder} wait${inOrder === 1 ? "" : "s"} between steps of one task (steps already go in order)`);
  // A wait that would close a circle is the one left out.
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const walk = (at: string): boolean => {
      if (at === to) return true;
      if (seen.has(at)) return false;
      seen.add(at);
      return (keyed.get(at)?.after ?? []).some(walk);
    };
    return walk(from);
  };
  for (const t of tasks) {
    const kept: string[] = [];
    for (const k of t.after ?? []) {
      t.after = kept;
      if (reaches(k, t.key)) { dropped.push(`"${t.title}" waiting on "${keyed.get(k)!.title}" (it would go round in a circle)`); continue; }
      kept.push(k);
    }
    t.after = kept;
  }

  // ── Notes, sources ──
  const notes: PlanNote[] = [];
  for (const [i, n] of arr(r.notes).entries()) {
    if (!n || typeof n !== "object") continue;
    const x = n as Record<string, unknown>;
    const ntitle = oneLine(x.title, PLAN_LIMITS.noteTitle);
    const body = block(x.body, PLAN_LIMITS.noteBody);
    if (!ntitle || !body) continue;
    if (notes.length >= PLAN_LIMITS.notes) { dropped.push(`note "${ntitle}" (more than ${PLAN_LIMITS.notes})`); continue; }
    const sources = sourcesOf(x.sources, files);
    // "source" is earned by naming a file the learner gave; otherwise it is Nova's.
    const origin: PlanNote["origin"] = x.origin === "template" ? "template" : x.origin === "source" && sources.length > 0 ? "source" : "nova";
    notes.push({ key: oneLine(x.key, 60) || slug(ntitle, i), title: ntitle, subject: subjectName(x.subject), topic: oneLine(x.topic, PLAN_LIMITS.name) || null, body, origin, sources });
  }

  const sources: PlanSourceFile[] = [];
  for (const f of arr(r.sources)) {
    if (!f || typeof f !== "object") continue;
    const file = files.find(x => same(x, oneLine((f as { file?: unknown }).file, 120)));
    if (!file || sources.some(s => s.file === file)) continue;
    const pages = (f as { pages?: unknown }).pages;
    sources.push({ file, read: (f as { read?: unknown }).read === true, pages: typeof pages === "number" && Number.isInteger(pages) && pages > 0 ? pages : null, note: oneLine((f as { note?: unknown }).note, 200) || null });
  }
  // A file the reply did not account for was not read, as far as anyone knows.
  for (const file of files) if (!sources.some(s => s.file === file)) sources.push({ file, read: false, pages: null, note: "Nova did not report reading this file." });

  if (subjects.length === 0 && tasks.length === 0 && notes.length === 0) {
    return { ok: false, message: "That plan had nothing in it to create." };
  }

  const category = TEMPLATE_CATEGORIES.find(c => c === r.category) ?? null;
  return {
    ok: true,
    dropped,
    plan: {
      version: PLAN_VERSION,
      kind: r.kind === "template" ? "template" : "custom",
      templateId: r.kind === "template" ? oneLine(r.templateId, 60) || null : null,
      templateVersion: r.kind === "template" && typeof r.templateVersion === "number" && Number.isInteger(r.templateVersion) ? r.templateVersion : null,
      category, title,
      summary: oneLine(r.summary, PLAN_LIMITS.summary),
      prerequisites: list(r.prerequisites, PLAN_LIMITS.prerequisites, PLAN_LIMITS.item),
      subjects, dates, tasks, notes,
      resources: resourcesOf(r.resources, rctx, PLAN_LIMITS.resources),
      sources: sources.slice(0, PLAN_LIMITS.sources),
      assumptions: list(r.assumptions, PLAN_LIMITS.assumptions, PLAN_LIMITS.item),
    },
  };
}

// ── A template, applied to the learner's inputs ───────────────────────────────

export interface TemplateInputs {
  // The one name the template asks for (namePrompt).
  name?:     string;
  // Topics pasted for the first subject, one per line.
  topics?:   string;
  // Sections or projects, one per line (asksSubjectList).
  subjectList?: string;
  // The template's date (asksExamDate), YYYY-MM-DD.
  date?:     string;
}

export type TemplateInputCheck = { ok: true; plan: WorkspacePlan } | { ok: false; field: keyof TemplateInputs; message: string };

// "- Arrays", "• Arrays", "1. Arrays" and "12) Arrays" are all "Arrays".
function withoutMarker(item: string): string {
  if (item && "-*•·".includes(item[0]!)) return item.slice(1).trim();
  let digits = 0;
  while (digits < item.length && item[digits]! >= "0" && item[digits]! <= "9") digits++;
  if (digits > 0 && digits <= 3 && (item[digits] === "." || item[digits] === ")")) return item.slice(digits + 1).trim();
  return item;
}

const lines = (text: unknown, max: number, maxLen: number): string[] => {
  if (typeof text !== "string") return [];
  const out: string[] = [];
  for (const part of text.split("\n")) {
    const name = oneLine(withoutMarker(part.trim()), maxLen);
    if (name && !out.some(o => same(o, name))) out.push(name);
    if (out.length >= max) break;
  }
  return out;
};

// What the learner must and may give for a template, derived from it.
export function templateInputs(t: StudyTemplate): Array<{ key: keyof TemplateInputs; label: string; required: boolean; kind: "text" | "lines" | "date" }> {
  const named = t.subjects[0]?.name === "";
  return [
    ...(named ? [{ key: "name" as const, label: t.namePrompt ?? "Name", required: true, kind: "text" as const }] : []),
    ...(t.asksSubjectList ? [{ key: "subjectList" as const, label: t.asksSubjectList.label, required: t.asksSubjectList.required, kind: "lines" as const }] : []),
    ...(named && !t.asksSubjectList && t.subjects.length === 1 && t.subjects[0]!.topics.length === 0
      ? [{ key: "topics" as const, label: "Topics, one per line (optional)", required: false, kind: "lines" as const }] : []),
    ...(t.asksExamDate ? [{ key: "date" as const, label: `${t.dateType === "interview" ? "Interview" : t.dateType === "project" ? "Due" : t.dateType === "other" ? "Review" : t.dateType === "certification" ? "Test" : "Exam"} date (optional)`, required: false, kind: "date" as const }] : []),
  ];
}

export function planFromTemplate(t: StudyTemplate, inputs: TemplateInputs, ctx: { today: string; category?: TemplateCategory }): TemplateInputCheck {
  const name = oneLine(inputs.name, PLAN_LIMITS.name);
  const needsName = t.subjects[0]?.name === "";
  if (needsName && !name) return { ok: false, field: "name", message: `${t.namePrompt ?? "A name"} is needed.` };
  const listed = lines(inputs.subjectList, PLAN_LIMITS.subjects, PLAN_LIMITS.name);
  if (t.asksSubjectList?.required && listed.length === 0) return { ok: false, field: "subjectList", message: "List at least one." };
  const pasted = lines(inputs.topics, PLAN_LIMITS.topicsPerSubject, PLAN_LIMITS.name);
  if (inputs.date !== undefined && inputs.date !== "" && (!isIsoDay(inputs.date) || inputs.date < ctx.today)) {
    return { ok: false, field: "date", message: "Pick a day from today on." };
  }

  // The subjects: the learner's list when the template asks for one (each
  // with the template's stages), else the template's own, the blank one
  // named by them.
  const stages = t.subjects[0]?.topics ?? [];
  const subjects = listed.length > 0
    ? listed.map(s => ({ name: s, topics: stages }))
    : t.subjects.filter((s, i) => s.name !== "" || i === 0).map(s => ({ name: s.name || name, topics: s.name === "" && pasted.length > 0 ? pasted : s.topics }));
  const first = subjects[0]?.name ?? null;
  const date = inputs.date && isIsoDay(inputs.date) ? inputs.date : null;
  const title = oneLine(needsName ? `${t.name}: ${name}` : t.name, PLAN_LIMITS.title);

  const checked = checkWorkspacePlan({
    kind: "template", templateId: t.id, templateVersion: t.version,
    category: ctx.category ?? t.placements[0]?.category ?? null,
    title, summary: t.purpose,
    subjects: subjects.map(s => ({ name: s.name, topics: s.topics })),
    dates: date ? [{ title: name ? `${name}` : t.name, subject: first, kind: t.dateType ?? "exam", day: date }] : [],
    tasks: t.tasks.map(k => ({ key: k.key, title: k.title, priority: k.priority ?? null, subject: k.subject ?? first })),
    notes: (t.notes ?? []).map(n => ({ key: n.key, title: name ? `${n.title}: ${name}` : n.title, subject: first, body: n.body, origin: "template" })),
  }, { today: ctx.today });
  return checked.ok ? { ok: true, plan: checked.plan } : { ok: false, field: "name", message: checked.message };
}

// ── What the plan becomes ─────────────────────────────────────────────────────
// The records, in the shape each writer takes, nothing left out: every
// topic with its place, kind and what the plan said about it (its details);
// every task with its steps and waits; the plan's own notes, with what came
// from the learner's files kept apart from Nova's own.

export interface PlanTopicWrite { name: string; parent: string | null; kind: TopicKind | null; details: TopicDetails | null }
export interface PlanWrites {
  // Topics in outline order: a parent before what is inside it, siblings in order.
  subjects: Array<{ name: string; topics: PlanTopicWrite[]; parent?: string | null }>;
  dates:    PlanDate[];
  tasks:    PlanTask[];
  notes:    Array<{ key: string; title: string; subject: string | null; topic: string | null; body: string }>;
}

const cite = (refs: SourceRef[]) => refs.map(r => (r.page ? `${r.file}, page ${r.page}` : r.file)).join("; ");

export function topicDetailsOf(t: PlanTopic): TopicDetails | null {
  return readTopicDetails({ explanation: t.explanation, sources: t.sources, ...(t.kind === "milestone" && t.milestone ? t.milestone : {}) });
}

export function planWrites(plan: WorkspacePlan): PlanWrites {
  const subjects: PlanWrites["subjects"] = plan.subjects.map(s => ({
    name: s.name,
    topics: topicRows(s).map(({ topic: t }) => ({ name: t.name, parent: t.parent ?? null, kind: t.kind ?? null, details: topicDetailsOf(t) })),
    ...(s.parent ? { parent: s.parent } : {}),
  }));
  const notes: PlanWrites["notes"] = plan.notes.map(n => {
    const attribution = n.origin === "source" ? `From your files: ${cite(n.sources)}\n\n` : n.origin === "nova" ? "Written by Nova (not from your files).\n\n" : "";
    return { key: n.key, title: n.title, subject: n.subject, topic: n.topic, body: `${attribution}${n.body}` };
  });
  return { subjects, dates: plan.dates, tasks: plan.tasks.slice(0, PLAN_LIMITS.tasks), notes: notes.slice(0, PLAN_LIMITS.notes) };
}

// What creating it would add, in words, for the preview. Topics are what is
// studied (leaves) and what organises them; milestones are counted apart.
export function planCounts(plan: WorkspacePlan): { subjects: number; topics: number; milestones: number; tasks: number; notes: number; dates: number; waits: number } {
  const all = plan.subjects.flatMap(s => s.topics);
  const milestones = all.filter(t => t.kind === "milestone").length;
  return {
    subjects: plan.subjects.length, topics: all.length - milestones, milestones, tasks: plan.tasks.length, notes: plan.notes.length, dates: plan.dates.length,
    waits: plan.tasks.reduce((n, t) => n + (t.after?.length ?? 0), 0),
  };
}

// A plan as stored (a draft, a version in its history, a workspace's
// record), read back in this shape. One of this version was checked when it
// was stored and is taken as it is; an older one (units and subtopics as
// labels, milestones apart in "phases", a single wait) is read through the
// check, with its own days, files and links, so nothing it held is lost.
export function readStoredPlan(raw: unknown): WorkspacePlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Partial<WorkspacePlan> & { version?: unknown };
  if (r.version === PLAN_VERSION && Array.isArray(r.subjects) && Array.isArray(r.tasks)) return r as WorkspacePlan;
  const files = (Array.isArray(r.sources) ? r.sources : []).map(s => (typeof s?.file === "string" ? s.file : "")).filter(Boolean);
  const links = [...(Array.isArray(r.resources) ? r.resources : []), ...arr((raw as { phases?: unknown }).phases).flatMap(p => arr((p as { resources?: unknown } | null)?.resources))]
    .map(x => x as { origin?: unknown; url?: unknown }).filter(x => x?.origin === "user" && typeof x.url === "string").map(x => x.url as string).join(" ");
  const checked = checkWorkspacePlan(raw, { today: "0000-01-01", files, userText: links });
  if (!checked.ok) return null;
  return { ...checked.plan, kind: r.kind === "template" ? "template" : "custom", templateId: r.templateId ?? null, templateVersion: r.templateVersion ?? null };
}
