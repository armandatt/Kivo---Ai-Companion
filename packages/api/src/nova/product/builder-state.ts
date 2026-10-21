// ─── Build with Nova: what a turn may do ──────────────────────────────────────
// Pure. The model reads the conversation (builder-conversation.ts) and says
// what it understood and what it would do next; this file decides what
// actually happens, and holds the rules the model is not trusted with:
//
//   - A fact is the learner's only when its quote is in what they wrote.
//     Anything else the model calls a fact is shown as an assumption.
//   - Nova asks one question at a time, at most MAX_QUESTIONS before it
//     proposes something, and never drafts from nothing: it needs at least
//     one thing the learner said they are working on. A first message that
//     says one thing ("I'm building TrackerX") gets a question before any
//     proposal, whatever the model wanted.
//   - Talk is talk. A reading of "chat" changes nothing.
//   - A proposal is changed only by a new version. Approval names a version
//     (builder.ts checks it); every change, Nova's or the learner's, makes a
//     new one.
//   - Which status may follow which is TRANSITIONS, and nothing else.
//
// No regex: text is compared by characters (SKILL.md; the no-regex guard).

import { oneLine, type WorkspacePlan } from "./workspace-plan";
import { WORK_KINDS, type BriefFact, type BuilderBrief, type BuilderMessage, type DraftStatus, type PendingJob, type PlanChangeSummary, type WorkKind } from "./builder.types";

export const MESSAGE_MAX = 2000;
// Nova's reply may explain what a shared file says, so it may run longer.
export const REPLY_MAX = 2400;
export const MESSAGES_KEPT = 60;
export const MAX_QUESTIONS = 4;
// A job that has said nothing for this long is taken to have died with its
// process; the learner may try again.
export const PENDING_STALE_MS = 180_000;
const FACTS_MAX = 12, KNOWN_MAX = 8, ASSUMPTIONS_MAX = 8, SUGGESTIONS_MAX = 6, LINE_MAX = 200;

export const OPENING_QUESTION = "What are you working on, and what would you like to end up with?";
// Asked when code holds back a proposal the model wanted to write from one
// fact: where they are and where it is going, which every kind of plan needs.
export const STARTING_QUESTION = "Before I propose anything: where are you with it right now, and is there a date you're working towards?";
// What a first proposal needs, unless a question has already been asked.
export const MIN_FACTS_TO_DRAFT = 2;

export function emptyBrief(): BuilderBrief {
  return { kind: null, title: null, facts: [], known: [], assumptions: [], suggestions: [], question: null, questionsAsked: 0, dropped: [] };
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export const TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  discovery:         ["discovery", "drafting", "cancelled"],
  drafting:          ["awaiting_approval", "discovery", "failed", "cancelled"],
  awaiting_approval: ["awaiting_approval", "drafting", "building", "cancelled"],
  building:          ["ready", "failed", "awaiting_approval"],
  // A built conversation goes on: the learner asks for more changes to what
  // it built, which is then proposed and approved like any other.
  ready:             ["discovery"],
  failed:            ["drafting", "building", "awaiting_approval", "discovery", "cancelled"],
  cancelled:         [],
};

export const canMove = (from: DraftStatus, to: DraftStatus) => TRANSITIONS[from].includes(to);

// Statuses a learner's message may arrive in.
export const TALKING: readonly DraftStatus[] = ["discovery", "awaiting_approval", "failed"];

export function isPendingLive(pending: PendingJob | null, now: Date): boolean {
  if (!pending) return false;
  const started = Date.parse(pending.startedAt);
  return Number.isFinite(started) && now.getTime() - started < PENDING_STALE_MS;
}

// ── Reading the model's reply ─────────────────────────────────────────────────

export type NextStep = "ask" | "chat" | "draft" | "revise";

export interface TurnReading {
  reply:       string;
  next:        NextStep;
  kind:        WorkKind | null;
  title:       string | null;
  facts:       BriefFact[];
  assumptions: string[];
  suggestions: string[];
  question:    string | null;
  // For a revision: the change asked for, in words.
  change:      string | null;
  // Something of theirs already in Kivo the learner referred to, by the name
  // they used, and what they want with it: see it, change it, or a new one
  // (builder-changes.ts finds it among their own records; the model never
  // names an id).
  resource:    { name: string; intent: "open" | "change" | "new" } | null;
}

// Lower case, single spaces, curly quotes straightened: so a quote matches
// what was typed however the model spaced or quoted it.
export function normalized(text: string): string {
  let out = "";
  let gap = false;
  for (const raw of text.toLocaleLowerCase()) {
    const ch = raw === "’" || raw === "‘" ? "'" : raw === "“" || raw === "”" ? "\"" : raw;
    if (ch.trim() === "") { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += ch;
    gap = false;
  }
  return out;
}

const listOf = (v: unknown, max: number): string[] => {
  const out: string[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    const line = oneLine(item, LINE_MAX);
    if (line && !out.some(o => normalized(o) === normalized(line))) out.push(line);
    if (out.length >= max) break;
  }
  return out;
};

// The model's reply, read into a TurnReading. Facts are kept as the
// learner's only when their quote is in `learnerText` (what they wrote in
// this conversation), or when they name a file the learner shared
// (`fileNames`); the rest become assumptions, said as such.
export function readTurn(raw: unknown, learnerText: string, fileNames: readonly string[] = []): TurnReading | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const reply = typeof r.reply === "string" ? r.reply.split("\r").join("").trim().slice(0, REPLY_MAX) : "";
  const next: NextStep | null = r.next === "ask" || r.next === "chat" || r.next === "draft" || r.next === "revise" ? r.next : null;
  if (!reply || !next) return null;

  const said = normalized(learnerText);
  const facts: BriefFact[] = [];
  const assumptions = listOf(r.assumptions, ASSUMPTIONS_MAX);
  for (const f of Array.isArray(r.facts) ? r.facts : []) {
    if (!f || typeof f !== "object") continue;
    const label = oneLine((f as { label?: unknown }).label, 60);
    const value = oneLine((f as { value?: unknown }).value, LINE_MAX);
    const quote = normalized(oneLine((f as { quote?: unknown }).quote, LINE_MAX));
    const named = oneLine((f as { file?: unknown }).file, 120);
    const file = named ? fileNames.find(n => normalized(n) === normalized(named)) ?? null : null;
    if (!label || !value) continue;
    if (file || (quote.length >= 2 && said.includes(quote))) {
      if (facts.length < FACTS_MAX && !facts.some(x => normalized(x.label) === normalized(label))) facts.push(file ? { label, value, file } : { label, value });
    } else if (assumptions.length < ASSUMPTIONS_MAX) {
      const line = oneLine(`${label}: ${value}`, LINE_MAX);
      if (!assumptions.some(a => normalized(a) === normalized(line))) assumptions.push(line);
    }
  }

  return {
    reply, next,
    kind: WORK_KINDS.find(k => k === r.kind) ?? null,
    title: oneLine(r.title, 80) || null,
    facts, assumptions,
    suggestions: listOf(r.suggestions, SUGGESTIONS_MAX),
    question: oneLine(r.question, 300) || null,
    change: oneLine(r.change, 600) || null,
    resource: resourceOf(r.resource),
  };
}

function resourceOf(raw: unknown): TurnReading["resource"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = oneLine(r.name, 120);
  const intent = r.intent === "open" || r.intent === "change" || r.intent === "new" ? r.intent : null;
  return name && intent ? { name, intent } : null;
}

// ── Deciding the step ─────────────────────────────────────────────────────────

export type Step =
  // overruled: the model wanted to propose and code asked instead, so its
  // reply (which says it will propose) is not used.
  | { type: "ask"; question: string; overruled?: true }
  | { type: "chat" }
  | { type: "draft"; reason: "ready" | "enough_questions" }
  | { type: "revise"; change: string };

// improving: the conversation is about a workspace they already have, which
// is context enough for a specific addition ("add a beta programme").
// changes: a change set to an existing resource is proposed (it is the
// proposal there, as the plan is for a new workspace).
export function decideStep(state: { plan: WorkspacePlan | null; brief: BuilderBrief; improving?: boolean; changes?: boolean }, reading: TurnReading): Step {
  const facts = reading.facts.length > 0 ? reading.facts : state.brief.facts;
  if (reading.next === "chat") return { type: "chat" };

  // A proposal exists: a change to it is a new version; anything else is talk.
  if (state.plan || state.changes) {
    if (reading.next === "revise" || reading.next === "draft") return { type: "revise", change: reading.change ?? reading.reply };
    return reading.question ? { type: "ask", question: reading.question } : { type: "chat" };
  }

  // Nothing to draft from: ask what it is for, whatever the model wanted.
  // Working on something of theirs, it is the context: "add graphs to it" needs no facts.
  if (facts.length === 0 && !state.improving) return { type: "ask", question: reading.question ?? OPENING_QUESTION };
  const wantsDraft = reading.next === "draft" || reading.next === "revise";
  // One thing said and nothing asked yet: a proposal now would be generic.
  if (facts.length < MIN_FACTS_TO_DRAFT && state.brief.questionsAsked === 0 && !state.improving) {
    return wantsDraft ? { type: "ask", question: STARTING_QUESTION, overruled: true } : { type: "ask", question: reading.question ?? STARTING_QUESTION };
  }
  if (wantsDraft) return { type: "draft", reason: "ready" };
  // Enough questions: propose something and let the learner correct it.
  if (state.brief.questionsAsked >= MAX_QUESTIONS) return { type: "draft", reason: "enough_questions" };
  return { type: "ask", question: reading.question ?? OPENING_QUESTION };
}

// Nova's words for an "ask" step. The model usually ends its reply with the
// question in its own words; the question is added only when the reply asks
// none, so it is never asked twice.
export function replyWithQuestion(reply: string, question: string): string {
  return reply.includes("?") ? reply : `${reply}\n\n${question}`;
}

// The understanding after a turn: the model's newest view, with the
// learner's facts never lost (a fact once said stays until they correct it
// with another under the same label).
export function nextBrief(before: BuilderBrief, reading: TurnReading, step: Step): BuilderBrief {
  const facts = [...reading.facts];
  for (const f of before.facts) if (facts.length < FACTS_MAX && !facts.some(x => normalized(x.label) === normalized(f.label))) facts.push(f);
  return {
    ...before,
    kind: reading.kind ?? before.kind,
    title: reading.title ?? before.title,
    facts,
    assumptions: reading.assumptions.length > 0 ? reading.assumptions : before.assumptions,
    suggestions: reading.suggestions.length > 0 ? reading.suggestions : before.suggestions,
    question: step.type === "ask" ? step.question : null,
    questionsAsked: before.questionsAsked + (step.type === "ask" ? 1 : 0),
  };
}

// What a plan holds, in the words of its kind of work (the page uses the
// same words, components/nova/builder/builder-view.ts). A project or work
// plan's one subject is the project itself, so it is not counted as one.
export interface HeldCounts { subjects: number; topics: number; phases: number; tasks: number; notes: number; dates: number }
export function holdsLine(kind: WorkKind | null, c: HeldCounts): string {
  const n = (count: number, one: string, many = `${one}s`) => (count ? `${count} ${count === 1 ? one : many}` : null);
  const academic = kind === "exam" || kind === "semester";
  const project = kind === "project", work = kind === "work" || kind === "career", skill = kind === "skill";
  return [
    project || work ? null : n(c.subjects, academic ? "subject" : "area"),
    n(c.topics, project ? "part" : work ? "area" : skill ? "concept" : "topic"),
    n(c.phases, academic ? "phase" : skill ? "stage" : "milestone"),
    n(c.tasks, "task"), n(c.notes, "note"), n(c.dates, "date"),
  ].filter(Boolean).join(", ");
}

// ── What is stored ────────────────────────────────────────────────────────────

export function readBrief(raw: unknown): BuilderBrief {
  const b = emptyBrief();
  if (!raw || typeof raw !== "object") return b;
  const r = raw as Record<string, unknown>;
  const facts = (v: unknown, max: number): BriefFact[] => (Array.isArray(v) ? v : []).flatMap(f => {
    const label = oneLine((f as { label?: unknown })?.label, 60), value = oneLine((f as { value?: unknown })?.value, LINE_MAX);
    const file = oneLine((f as { file?: unknown })?.file, 120);
    return label && value ? [file ? { label, value, file } : { label, value }] : [];
  }).slice(0, max);
  return {
    kind: WORK_KINDS.find(k => k === r.kind) ?? null,
    title: oneLine(r.title, 80) || null,
    facts: facts(r.facts, FACTS_MAX),
    known: facts(r.known, KNOWN_MAX),
    assumptions: listOf(r.assumptions, ASSUMPTIONS_MAX),
    suggestions: listOf(r.suggestions, SUGGESTIONS_MAX),
    ...(Array.isArray(r.choices) ? { choices: listOf(r.choices, 6) } : {}),
    question: oneLine(r.question, 300) || null,
    questionsAsked: typeof r.questionsAsked === "number" && Number.isInteger(r.questionsAsked) && r.questionsAsked >= 0 ? r.questionsAsked : 0,
    dropped: listOf(r.dropped, 12),
  };
}

export function readMessages(raw: unknown): BuilderMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m): BuilderMessage[] => {
    if (!m || typeof m !== "object") return [];
    const x = m as Record<string, unknown>;
    if ((x.role !== "user" && x.role !== "nova") || typeof x.text !== "string" || typeof x.id !== "string" || typeof x.at !== "string") return [];
    const files = Array.isArray(x.files)
      ? x.files.flatMap(f => (f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string" ? [{ name: (f as { name: string }).name, pages: typeof (f as { pages?: unknown }).pages === "number" ? (f as { pages: number }).pages : null }] : []))
      : [];
    return [{ id: x.id, role: x.role, text: x.text, at: x.at, ...(typeof x.kind === "string" ? { kind: x.kind as BuilderMessage["kind"] } : {}), ...(typeof x.version === "number" ? { version: x.version } : {}), ...(files.length ? { files } : {}) }];
  });
}

export function readPending(raw: unknown): PendingJob | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const kind = x.kind === "reply" || x.kind === "draft" || x.kind === "revise" ? x.kind : null;
  const stage = x.stage === "reading" || x.stage === "writing" || x.stage === "checking" ? x.stage : null;
  if (!kind || !stage || typeof x.startedAt !== "string" || typeof x.baseVersion !== "number") return null;
  return { kind, stage, startedAt: x.startedAt, baseVersion: x.baseVersion };
}

// The conversation, capped: the opening message stays, then the latest.
export function withMessages(list: BuilderMessage[], ...added: BuilderMessage[]): BuilderMessage[] {
  const all = [...list, ...added];
  return all.length <= MESSAGES_KEPT ? all : [all[0]!, ...all.slice(all.length - MESSAGES_KEPT + 1)];
}

let counter = 0;
export function message(role: BuilderMessage["role"], text: string, now: Date, extra: Pick<BuilderMessage, "kind" | "version" | "files"> = {}): BuilderMessage {
  counter = (counter + 1) % 1_000_000;
  return { id: `${now.getTime().toString(36)}-${counter.toString(36)}-${role[0]}`, role, text: text.slice(0, MESSAGE_MAX), at: now.toISOString(), ...extra };
}

// Everything the learner wrote here: the only source of their facts and of
// any web address a plan may keep.
export const learnerWords = (messages: BuilderMessage[]) => messages.filter(m => m.role === "user").map(m => m.text).join("\n");

// The conversation as said: Kivo's own notices and error lines are left out
// of what the model reads and of what counts as answered.
export const spoken = (messages: BuilderMessage[]) => messages.filter(m => m.kind !== "error" && m.kind !== "notice");

// The last thing said is theirs and nothing answers it yet.
export function needsReply(messages: BuilderMessage[], pending: PendingJob | null, now: Date): boolean {
  const said = spoken(messages);
  return said.length > 0 && said[said.length - 1]!.role === "user" && !isPendingLive(pending, now);
}

// ── Versions ──────────────────────────────────────────────────────────────────

// What a new version adds and takes away, by name: shown with it, so a
// revision never changes the proposal unseen.
export function planChanges(before: WorkspacePlan | null, after: WorkspacePlan): PlanChangeSummary {
  const names = (p: WorkspacePlan | null): Map<string, string> => {
    const out = new Map<string, string>();
    if (!p) return out;
    for (const s of p.subjects) { out.set(`subject:${normalized(s.name)}`, `subject ${s.name}`); for (const t of s.topics) out.set(`topic:${normalized(s.name)}:${normalized(t.name)}`, `topic ${t.name}`); }
    for (const ph of p.phases) out.set(`phase:${normalized(ph.name)}`, `milestone ${ph.name}`);
    for (const t of p.tasks) out.set(`task:${normalized(t.title)}`, `task ${t.title}`);
    for (const n of p.notes) out.set(`note:${normalized(n.title)}`, `note ${n.title}`);
    for (const d of p.dates) out.set(`date:${normalized(d.title)}:${d.day}`, `date ${d.title} (${d.day})`);
    return out;
  };
  const a = names(before), b = names(after);
  const added = [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k)!);
  const removed = [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k)!);
  return { added, removed, renamed: before && normalized(before.title) !== normalized(after.title) ? 1 : 0 };
}

export function describeChanges(c: PlanChangeSummary): string {
  const part = (label: string, list: string[]) => (list.length === 0 ? null : `${label} ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}`);
  const parts = [part("Added", c.added), part("Removed", c.removed), c.renamed ? "Renamed the workspace" : null].filter(Boolean);
  return parts.length ? `${parts.join(". ")}.` : "Nothing was added or removed.";
}
