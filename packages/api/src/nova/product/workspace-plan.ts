// ─── Workspace plan: what a template or Nova proposes to create ───────────────
// One shape for both: a template applied to the learner's inputs
// (planFromTemplate) and a plan Nova wrote (workspace-generation.ts) are the
// same WorkspacePlan, checked by the same checkWorkspacePlan before it is
// shown and again, on the server, before anything is created. The page may
// edit a plan; the server never trusts the copy it gets back.
//
// A plan creates only records Kivo already has (workspaces.ts makes them,
// each through its own writer, in one transaction):
//   subjects and topics → Knowledge, the Map, the Planner's new material
//   dates               → Today, the Planner, the calendar (exams.ts)
//   tasks               → the Planner's board and the calendar (tasks.ts)
//   notes               → Notes and the Map (notes.ts); phases, explanations,
//                         prerequisites and resources are written as notes
//
// Honesty rules, held here and not left to the model:
//   - a source reference names a file the learner gave and a page or none;
//   - a resource keeps a web address only when it came from the learner's
//     own words or files: an address Nova suggested is dropped, never shown
//     as checked;
//   - what came from the learner's files and what Nova added are labelled
//     apart in every note this writes.
//
// Pure, no imports beyond types, so the web app renders and edits with it.

import type { StudyTemplate, TemplateCategory } from "./templates";
import { TEMPLATE_CATEGORIES } from "./templates";
import type { DeadlineType } from "./deadline-types";
import { TASK_DEPTH_MAX, checkTree, parentsFirst, rootOf } from "./task-tree";

export const PLAN_VERSION = 1;

export const PLAN_LIMITS = {
  title: 80, summary: 400, subjects: 12, topicsPerSubject: 40, name: 80, explanation: 600, subtopics: 12,
  tasks: 120, taskTitle: 160, taskDescription: 600, priorityReason: 200, notes: 20, noteTitle: 120, noteBody: 8000, dates: 10,
  phases: 12, listItems: 10, item: 240, resources: 12, prerequisites: 10, assumptions: 6, sources: 5,
} as const;

const DATE_KINDS: readonly DeadlineType[] = ["exam", "assignment", "project", "interview", "certification", "other"];
const RESOURCE_KINDS = ["book", "course", "docs", "video", "practice", "article", "tool", "other"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface SourceRef { file: string; page: number | null }
// A topic, in the order it is learnt (prerequisites first). unit: the part
// of the course or syllabus it belongs to; subtopics: what it covers, named
// specifically. Both live in the subject's topic guide note: Kivo's topics
// have no columns for them.
export interface PlanTopic { name: string; explanation: string | null; sources: SourceRef[]; unit?: string | null; subtopics?: string[] }
export interface PlanSubject { name: string; topics: PlanTopic[] }
export type PlanPriority = "low" | "medium" | "high";
export interface PlanTask {
  key: string; title: string;
  // The learner's own priority: set by them on the page, never by Nova.
  priority: PlanPriority | null;
  subject: string | null; topic: string | null; dueDay: string | null; estimatedMinutes: number | null;
  // The key of a task in the same plan that comes first. Kivo's tasks have
  // no dependency column, so this is written into the workspace's order note.
  after?: string | null;
  // The key of the task this one is a step of (task-tree.ts holds the
  // rules: no loops, at most TASK_DEPTH_MAX levels). null: a task of its own.
  parent?: string | null;
  description?: string | null;
  // Nova's suggestion, with its reason, shown as a suggestion. It becomes the
  // task's priority only when the learner accepts it.
  suggestedPriority?: PlanPriority | null;
  priorityReason?: string | null;
}
export interface PlanNote {
  key: string; title: string; subject: string | null; topic: string | null; body: string;
  // template: a template's empty headings. source: drawn from the learner's
  // files (with sources). nova: Nova's own writing.
  origin: "template" | "source" | "nova"; sources: SourceRef[];
}
export interface PlanDate { title: string; subject: string | null; kind: DeadlineType; day: string }
export interface PlanResource {
  title: string; kind: ResourceKind; url: string | null;
  // source: named in the learner's files. user: in their own request. nova:
  // Nova's suggestion from general knowledge, not checked.
  origin: "source" | "user" | "nova";
}
export interface PlanPhase {
  name: string; subject: string | null; weeks: number | null; hoursPerWeek: number | null;
  goals: string[]; exercises: string[]; project: string | null; completion: string | null; resources: PlanResource[];
}
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
  phases:          PlanPhase[];
  dates:           PlanDate[];
  tasks:           PlanTask[];
  notes:           PlanNote[];
  resources:       PlanResource[];
  // The files it was made from, and whether each could be read.
  sources:         PlanSourceFile[];
  // What the plan takes as given (time a week, no web search, …).
  assumptions:     string[];
}

export type PlanCheck =
  // fixed: what code repaired rather than dropped (a task inside itself, a
  // task filed under a milestone by another name), in words.
  | { ok: true; plan: WorkspacePlan; dropped: string[]; fixed: string[] }
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

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

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
  // Who wrote this plan. "nova": a priority it gives is a suggestion (it may
  // not decide what matters most to the learner). "template": the same, from
  // a template. "learner" (the default): the page's copy, whose priorities
  // the learner set or accepted.
  author?:  "nova" | "template" | "learner";
  // The kind of work, when known: a project's milestones are matched to the
  // tasks filed under them by another name (alignMilestones).
  kind?:    string | null;
}

const PRIORITIES: readonly PlanPriority[] = ["low", "medium", "high"];
const priorityOf = (v: unknown): PlanPriority | null => PRIORITIES.find(p => p === v) ?? null;

// Steps given inside a task ("steps": [...]) are the same tasks with a
// parent: flattened here, so one list is checked. Keys are given where a
// step has none.
function flattenSteps(list: unknown[], parent: string | null, out: Array<Record<string, unknown>>, depth = 0) {
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = { ...(item as Record<string, unknown>) };
    const nested = Array.isArray(x.steps) ? x.steps : Array.isArray(x.subtasks) ? x.subtasks : null;
    delete x.steps; delete x.subtasks;
    if (parent !== null && (x.parent === undefined || x.parent === null)) x.parent = parent;
    if (nested && (typeof x.key !== "string" || !x.key)) x.key = `t${out.length + 1}`;
    out.push(x);
    // A reply nested past any sense is cut by the tree check; this only stops a runaway walk.
    if (nested && depth < TASK_DEPTH_MAX * 2) flattenSteps(nested, x.key as string, out, depth + 1);
  }
}

// Everything a plan may say, checked and normalized. What does not fit is
// dropped and counted, never cut silently: `dropped` says what went.
export function checkWorkspacePlan(raw: unknown, ctx: PlanContext): PlanCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "That isn't a workspace plan." };
  const r = raw as Record<string, unknown>;
  const files = ctx.files ?? [];
  const rctx = { files, userText: ctx.userText ?? "" };
  const dropped: string[] = [];

  const title = oneLine(r.title, PLAN_LIMITS.title);
  if (!title) return { ok: false, message: "The workspace needs a name." };

  // Subjects, once each by name; topics once each within a subject.
  const subjects: PlanSubject[] = [];
  for (const s of Array.isArray(r.subjects) ? r.subjects : []) {
    if (!s || typeof s !== "object") continue;
    const name = oneLine((s as { name?: unknown }).name, PLAN_LIMITS.name);
    if (!name) { dropped.push("a subject with no name"); continue; }
    if (subjects.length >= PLAN_LIMITS.subjects) { dropped.push(`subject "${name}" (more than ${PLAN_LIMITS.subjects})`); continue; }
    const into = subjects.find(x => same(x.name, name)) ?? (subjects.push({ name, topics: [] }), subjects[subjects.length - 1]!);
    for (const t of Array.isArray((s as { topics?: unknown }).topics) ? (s as { topics: unknown[] }).topics : []) {
      const topicRaw = typeof t === "string" ? { name: t } : t;
      if (!topicRaw || typeof topicRaw !== "object") continue;
      const tname = oneLine((topicRaw as { name?: unknown }).name, PLAN_LIMITS.name);
      if (!tname || into.topics.some(x => same(x.name, tname))) continue;
      if (into.topics.length >= PLAN_LIMITS.topicsPerSubject) { dropped.push(`topic "${tname}" (more than ${PLAN_LIMITS.topicsPerSubject} in ${name})`); continue; }
      if (isPlaceholderTopic(tname, name)) { dropped.push(`topic "${tname}" in ${name} (too general to study from: name what it covers)`); continue; }
      const explanation = block((topicRaw as { explanation?: unknown }).explanation, PLAN_LIMITS.explanation) || null;
      const unit = oneLine((topicRaw as { unit?: unknown }).unit, PLAN_LIMITS.name) || null;
      const subtopics: string[] = [];
      for (const st of Array.isArray((topicRaw as { subtopics?: unknown }).subtopics) ? (topicRaw as { subtopics: unknown[] }).subtopics : []) {
        const sn = oneLine(st, PLAN_LIMITS.name);
        if (!sn || same(sn, tname) || subtopics.some(x => same(x, sn)) || isPlaceholderTopic(sn, tname) || subtopics.length >= PLAN_LIMITS.subtopics) continue;
        subtopics.push(sn);
      }
      into.topics.push({ name: tname, explanation, sources: sourcesOf((topicRaw as { sources?: unknown }).sources, files), ...(unit ? { unit } : {}), ...(subtopics.length ? { subtopics } : {}) });
    }
  }
  const subjectName = (v: unknown): string | null => {
    const n = oneLine(v, PLAN_LIMITS.name);
    return n ? subjects.find(s => same(s.name, n))?.name ?? null : null;
  };

  const phases: PlanPhase[] = [];
  for (const p of Array.isArray(r.phases) ? r.phases.slice(0, PLAN_LIMITS.phases) : []) {
    if (!p || typeof p !== "object") continue;
    const x = p as Record<string, unknown>;
    const name = oneLine(x.name, PLAN_LIMITS.name);
    if (!name) continue;
    phases.push({
      name, subject: subjectName(x.subject) ?? subjects[0]?.name ?? null,
      weeks: positive(x.weeks, 104), hoursPerWeek: positive(x.hoursPerWeek, 80),
      goals: list(x.goals, PLAN_LIMITS.listItems, PLAN_LIMITS.item),
      exercises: list(x.exercises, PLAN_LIMITS.listItems, PLAN_LIMITS.item),
      project: oneLine(x.project, PLAN_LIMITS.item) || null,
      completion: oneLine(x.completion, PLAN_LIMITS.item) || null,
      resources: resourcesOf(x.resources, rctx, 6),
    });
  }

  const dates: PlanDate[] = [];
  for (const d of Array.isArray(r.dates) ? r.dates : []) {
    if (!d || typeof d !== "object") continue;
    const x = d as Record<string, unknown>;
    const dtitle = oneLine(x.title, PLAN_LIMITS.name);
    if (!dtitle) continue;
    if (!isIsoDay(x.day) || x.day < ctx.today) { dropped.push(`date "${dtitle}" (not a day from today on)`); continue; }
    if (dates.length >= PLAN_LIMITS.dates) { dropped.push(`date "${dtitle}" (more than ${PLAN_LIMITS.dates})`); continue; }
    dates.push({ title: dtitle, subject: subjectName(x.subject), kind: DATE_KINDS.find(k => k === x.kind) ?? "other", day: x.day });
  }

  const fixed: string[] = [];
  const author = ctx.author ?? "learner";
  const rawTasks: Array<Record<string, unknown>> = [];
  flattenSteps(Array.isArray(r.tasks) ? r.tasks : [], null, rawTasks);
  const tasks: PlanTask[] = [];
  // A key as the reply gave it → the key it has here (a repeated key is renamed).
  const keyOf = new Map<string, string>();
  for (const [i, x] of rawTasks.entries()) {
    const ttitle = oneLine(x.title, PLAN_LIMITS.taskTitle);
    if (!ttitle) continue;
    const given = oneLine(x.key, 60);
    const parentGiven = oneLine(x.parent, 60) || null;
    // The same task twice under the same parent is one task; under two parents it is two.
    const parentHere = parentGiven ? keyOf.get(parentGiven) ?? parentGiven : null;
    if (tasks.some(k => same(k.title, ttitle) && (k.parent ?? null) === parentHere)) {
      if (given && !keyOf.has(given)) keyOf.set(given, tasks.find(k => same(k.title, ttitle) && (k.parent ?? null) === parentHere)!.key);
      continue;
    }
    if (tasks.length >= PLAN_LIMITS.tasks) { dropped.push(`task "${ttitle}" (more than ${PLAN_LIMITS.tasks})`); continue; }
    let key = given || slug(ttitle, i);
    if (tasks.some(k => k.key === key)) key = `${key}-${i}`;
    if (given && !keyOf.has(given)) keyOf.set(given, key);
    const due = isIsoDay(x.dueDay) && x.dueDay >= ctx.today ? x.dueDay : null;
    const minutes = typeof x.estimatedMinutes === "number" && Number.isInteger(x.estimatedMinutes) && x.estimatedMinutes >= 5 && x.estimatedMinutes <= 600 ? x.estimatedMinutes : null;
    // Nova (or a template) suggests; only the learner sets.
    const stated = priorityOf(x.priority);
    const suggested = priorityOf(x.suggestedPriority) ?? (author === "learner" ? null : stated);
    const reason = oneLine(x.priorityReason, PLAN_LIMITS.priorityReason) || (suggested && author === "template" ? "The template suggests it." : null);
    tasks.push({
      key, title: ttitle, priority: author === "learner" ? stated : null,
      subject: subjectName(x.subject), topic: oneLine(x.topic, PLAN_LIMITS.name) || null, dueDay: due, estimatedMinutes: minutes,
      after: oneLine(x.after, 60) || null,
      parent: parentHere,
      ...(block(x.description, PLAN_LIMITS.taskDescription) ? { description: block(x.description, PLAN_LIMITS.taskDescription) } : {}),
      ...(suggested ? { suggestedPriority: suggested, priorityReason: reason } : {}),
    });
  }
  // Parents and orders name the task as it is keyed here.
  for (const t of tasks) {
    if (t.parent) t.parent = keyOf.get(t.parent) ?? t.parent;
    if (t.after) t.after = keyOf.get(t.after) ?? t.after;
  }
  // The tree: no loops, no step under a task that isn't here, not too deep.
  const tree = checkTree(tasks.map(t => ({ ...t, parent: t.parent ?? null })), t => t.title);
  fixed.push(...tree.fixes);
  tasks.splice(0, tasks.length, ...parentsFirst(tree.items));

  // An order names another task of this plan, and never loops back.
  for (const t of tasks) {
    if (!t.after) { t.after = null; continue; }
    const before = tasks.find(k => k.key === t.after && k !== t);
    if (!before) { t.after = null; continue; }
    let at: PlanTask | undefined = before;
    for (let hops = 0; at && hops <= tasks.length; hops++) {
      if (at === t) { t.after = null; break; }
      at = at.after ? tasks.find(k => k.key === at!.after) : undefined;
    }
  }

  const notes: PlanNote[] = [];
  for (const [i, n] of (Array.isArray(r.notes) ? r.notes : []).entries()) {
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
  for (const f of Array.isArray(r.sources) ? r.sources : []) {
    if (!f || typeof f !== "object") continue;
    const file = files.find(x => same(x, oneLine((f as { file?: unknown }).file, 120)));
    if (!file || sources.some(s => s.file === file)) continue;
    const pages = (f as { pages?: unknown }).pages;
    sources.push({ file, read: (f as { read?: unknown }).read === true, pages: typeof pages === "number" && Number.isInteger(pages) && pages > 0 ? pages : null, note: oneLine((f as { note?: unknown }).note, 200) || null });
  }
  // A file the reply did not account for was not read, as far as anyone knows.
  for (const file of files) if (!sources.some(s => s.file === file)) sources.push({ file, read: false, pages: null, note: "Nova did not report reading this file." });

  if (subjects.length === 0 && tasks.length === 0 && notes.length === 0 && phases.length === 0) {
    return { ok: false, message: "That plan had nothing in it to create." };
  }
  if (ctx.kind === "project" || ctx.kind === "work" || ctx.kind === "career") fixed.push(...alignMilestones(subjects, phases, tasks));
  // A step belongs where its task belongs: the same subject and milestone.
  const asTree = tasks.map(x => ({ key: x.key, parent: x.parent ?? null }));
  for (const t of tasks) {
    if (!t.parent) continue;
    const root = tasks.find(k => k.key === rootOf(asTree, t.key));
    if (root && root !== t) { t.subject = root.subject; t.topic = root.topic; }
  }
  fixed.push(...fitEstimates(phases, tasks, ctx.today));

  const category = TEMPLATE_CATEGORIES.find(c => c === r.category) ?? null;
  return {
    ok: true,
    dropped, fixed: fixed.slice(0, 12),
    plan: {
      version: PLAN_VERSION,
      kind: r.kind === "template" ? "template" : "custom",
      templateId: r.kind === "template" ? oneLine(r.templateId, 60) || null : null,
      templateVersion: r.kind === "template" && typeof r.templateVersion === "number" && Number.isInteger(r.templateVersion) ? r.templateVersion : null,
      category, title,
      summary: oneLine(r.summary, PLAN_LIMITS.summary),
      prerequisites: list(r.prerequisites, PLAN_LIMITS.prerequisites, PLAN_LIMITS.item),
      subjects, phases, dates, tasks, notes,
      resources: resourcesOf(r.resources, rctx, PLAN_LIMITS.resources),
      sources: sources.slice(0, PLAN_LIMITS.sources),
      assumptions: list(r.assumptions, PLAN_LIMITS.assumptions, PLAN_LIMITS.item),
    },
  };
}

// ── Structure repairs (said in `fixed`) ───────────────────────────────────────

const MINOR = new Set(["and", "the", "of", "for", "to", "a", "an", "in", "on", "with", "phase", "milestone", "sprint", "stage", "part", "complete", "final", "development", "build", "module", "modules"]);
const significant = (text: string): string[] => wordsOf(text).split(" ").filter(w => w && !MINOR.has(w));

// The milestone a name means: one of the milestones by that name, else the
// one milestone sharing the most words with it (at least one, and no tie).
function milestoneFor(name: string, phases: PlanPhase[]): PlanPhase | null {
  const exact = phases.find(p => same(p.name, name));
  if (exact) return exact;
  const words = significant(name);
  if (words.length === 0) return null;
  const scored = phases.map(p => ({ p, n: significant(p.name).filter(w => words.includes(w)).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  return scored.length === 1 || (scored.length > 1 && scored[0]!.n > scored[1]!.n) ? scored[0]!.p : null;
}

// A project's milestones are its phases, and Kivo makes each one a topic of
// the project's subject. A reply that also lists the same milestones as
// topics under other names ("Home Page Development" beside the milestone
// "Home Page Sprint") would show every milestone twice and file its tasks
// under neither (found 25 Oct: every milestone said "0 tasks"). Each task is
// filed under the milestone its topic means, and a topic that is only another
// name for a milestone is listed once, as the milestone (its subtopics kept
// as the milestone's goals when it has none).
function alignMilestones(subjects: PlanSubject[], phases: PlanPhase[], tasks: PlanTask[]): string[] {
  if (phases.length === 0) return [];
  const fixes: string[] = [];
  for (const t of tasks) {
    const topic = t.topic;
    if (t.parent || !topic || phases.some(p => same(p.name, topic))) continue;
    const m = milestoneFor(topic, phases);
    if (m) t.topic = m.name;
  }
  for (const s of subjects) {
    s.topics = s.topics.filter(topic => {
      if (phases.some(p => same(p.name, topic.name))) return true;
      const m = milestoneFor(topic.name, phases.filter(p => p.subject === null || same(p.subject, s.name)));
      if (!m) return true;
      if (m.goals.length === 0 && topic.subtopics?.length) m.goals = topic.subtopics.slice(0, PLAN_LIMITS.listItems);
      fixes.push(`"${topic.name}" is the milestone "${m.name}", so it is listed once`);
      return false;
    });
  }
  return fixes;
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000);

// An effort estimate in weeks is dropped where the plan's own due days say
// the work is done in less than a week (found 25 Oct: a four-day sprint
// showed "≈ 1 week · 30 h a week" on every milestone). Only a milestone whose
// tasks all have due days is judged; the estimate stays otherwise.
function fitEstimates(phases: PlanPhase[], tasks: PlanTask[], today: string): string[] {
  const fixes: string[] = [];
  for (const p of phases) {
    if (!p.weeks && !p.hoursPerWeek) continue;
    const under = tasks.filter(t => t.topic !== null && same(t.topic, p.name));
    if (under.length === 0 || under.some(t => !t.dueDay)) continue;
    const span = Math.max(...under.map(t => dayNumber(t.dueDay!))) - dayNumber(today) + 1;
    if (span >= 7) continue;
    p.weeks = null; p.hoursPerWeek = null;
    fixes.push(`the estimate on "${p.name}" (its tasks are all due within ${span} day${span === 1 ? "" : "s"})`);
  }
  return fixes.length ? [`Took a weekly estimate off ${fixes.length === 1 ? fixes[0] : `${fixes.length} milestones whose tasks are all due within a week`}`] : [];
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
  }, { today: ctx.today, author: "template" });
  return checked.ok ? { ok: true, plan: checked.plan } : { ok: false, field: "name", message: checked.message };
}

// ── What the plan becomes ─────────────────────────────────────────────────────
// The records, in the shape each writer takes. Notes carry their sources in
// words, with what came from the learner's files kept apart from Nova's own.

export interface PlanWrites {
  subjects: Array<{ name: string; topics: string[] }>;
  dates:    PlanDate[];
  tasks:    PlanTask[];
  notes:    Array<{ key: string; title: string; subject: string | null; topic: string | null; body: string }>;
}

const cite = (refs: SourceRef[]) => refs.map(r => (r.page ? `${r.file}, page ${r.page}` : r.file)).join("; ");
const resourceLine = (r: PlanResource) =>
  `- ${r.title} (${r.kind})${r.url ? ` ${r.url}` : ""}${r.origin === "nova" ? " — suggested by Nova, not checked" : r.origin === "source" ? " — named in your files" : ""}`;

export function planWrites(plan: WorkspacePlan): PlanWrites {
  const subjects = plan.subjects.map(s => ({ name: s.name, topics: s.topics.map(t => t.name) }));
  // Each phase is a topic of its subject, in order, so the Planner offers them in that order.
  for (const p of plan.phases) {
    const into = subjects.find(s => p.subject !== null && same(s.name, p.subject)) ?? subjects[0];
    if (into) { if (!into.topics.some(t => same(t, p.name))) into.topics.push(p.name); }
    else subjects.push({ name: plan.title, topics: [p.name] });
  }

  const notes: PlanWrites["notes"] = [];
  // Topic explanations and sources, one note per subject that has any.
  for (const s of plan.subjects) {
    const explained = s.topics.filter(t => t.explanation || t.sources.length > 0 || (t.subtopics?.length ?? 0) > 0);
    if (explained.length === 0) continue;
    const fromFiles = explained.some(t => t.sources.length > 0);
    // In learning order, under their units: a unit's heading once, where it starts.
    let unit: string | null = null;
    const body = explained.map(t => {
      const heading = t.unit && t.unit !== unit ? [`# ${t.unit}`] : [];
      if (t.unit) unit = t.unit;
      return [
        ...heading,
        `${t.unit ? "##" : "#"} ${t.name}`,
        ...((t.subtopics?.length ?? 0) > 0 ? t.subtopics!.map(x => `- ${x}`) : []),
        ...(t.sources.length > 0 ? [`From your files: ${cite(t.sources)}`] : []),
        ...(t.explanation ? [t.sources.length > 0 ? `Nova's explanation: ${t.explanation}` : `Nova's explanation (not from your files): ${t.explanation}`] : []),
      ].join("\n");
    }).join("\n\n");
    notes.push({ key: `topics:${s.name.toLowerCase()}`, title: `${s.name}: topic guide${fromFiles ? "" : " (Nova)"}`, subject: s.name, topic: null, body });
  }
  for (const [i, p] of plan.phases.entries()) {
    const effort = [p.weeks ? `${p.weeks} week${p.weeks === 1 ? "" : "s"}` : null, p.hoursPerWeek ? `about ${p.hoursPerWeek} hours a week` : null].filter(Boolean).join(", ");
    const body = [
      effort ? `Effort (an estimate): ${effort}` : null,
      p.goals.length ? `# Goals\n${p.goals.map(g => `- ${g}`).join("\n")}` : null,
      p.exercises.length ? `# Exercises\n${p.exercises.map(g => `- ${g}`).join("\n")}` : null,
      p.project ? `# Project\n${p.project}` : null,
      p.completion ? `# Done when\n${p.completion}` : null,
      p.resources.length ? `# Resources\n${p.resources.map(resourceLine).join("\n")}` : null,
    ].filter(Boolean).join("\n\n");
    if (body) notes.push({ key: `phase:${i}`, title: `Phase ${i + 1}: ${p.name}`, subject: p.subject ?? subjects[0]?.name ?? null, topic: p.name, body });
  }
  if (plan.prerequisites.length > 0) {
    notes.push({ key: "prerequisites", title: `Before you start: ${plan.title}`, subject: subjects[0]?.name ?? null, topic: null, body: `# Prerequisites\n${plan.prerequisites.map(p => `- ${p}`).join("\n")}` });
  }
  const ordered = plan.tasks.filter(t => t.after);
  if (ordered.length > 0) {
    const titleOf = (key: string) => plan.tasks.find(t => t.key === key)?.title ?? key;
    notes.push({ key: "order", title: `Order of work: ${plan.title}`, subject: subjects[0]?.name ?? null, topic: null, body: `# What comes first\n${ordered.map(t => `- ${t.title}: after ${titleOf(t.after!)}`).join("\n")}` });
  }
  if (plan.resources.length > 0) {
    notes.push({ key: "resources", title: `Resources: ${plan.title}`, subject: subjects[0]?.name ?? null, topic: null, body: `# Resources\n${plan.resources.map(resourceLine).join("\n")}` });
  }
  for (const n of plan.notes) {
    const attribution = n.origin === "source" ? `From your files: ${cite(n.sources)}\n\n` : n.origin === "nova" ? "Written by Nova (not from your files).\n\n" : "";
    notes.push({ key: n.key, title: n.title, subject: n.subject, topic: n.topic, body: `${attribution}${n.body}` });
  }

  // Each phase's project is a task, so it shows on the board.
  const tasks = [...plan.tasks];
  for (const [i, p] of plan.phases.entries()) {
    if (!p.project) continue;
    const title = oneLine(`Build: ${p.project}`, PLAN_LIMITS.taskTitle);
    if (!tasks.some(t => same(t.title, title))) tasks.push({ key: `phase-project-${i}`, title, priority: null, subject: p.subject, topic: p.name, dueDay: null, estimatedMinutes: null, parent: null });
  }
  return { subjects, dates: plan.dates, tasks: tasks.slice(0, PLAN_LIMITS.tasks + PLAN_LIMITS.phases), notes: notes.slice(0, PLAN_LIMITS.notes + PLAN_LIMITS.phases + 4) };
}

// What creating it would add, in words, for the preview.
export function planCounts(plan: WorkspacePlan): { subjects: number; topics: number; tasks: number; notes: number; dates: number } {
  const w = planWrites(plan);
  return { subjects: w.subjects.length, topics: w.subjects.reduce((n, s) => n + s.topics.length, 0), tasks: w.tasks.length, notes: w.notes.length, dates: w.dates.length };
}
