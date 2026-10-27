// ─── Build with Nova: what a turn may do ──────────────────────────────────────
// Pure. The model reads the conversation (builder-conversation.ts) and says
// what it understood and what it would do next; this file decides what
// actually happens, and holds the rules the model is not trusted with:
//
//   - A fact is the learner's only when its quote is in what they wrote.
//     Anything else the model calls a fact is shown as an assumption.
//   - Nova asks one question at a time, as many as the plan needs (there is
//     no count after which it drafts), and never drafts from nothing: it
//     needs at least one thing the learner said they are working on. A first
//     message that says one thing ("I'm building TrackerX") gets a question
//     before any proposal, whatever the model wanted.
//   - A new plan is drafted only with the learner's consent: a button they
//     pressed, or words of theirs the model quotes from their latest message
//     ("build it now"). A goal, a file, an answer or brainstorming is not
//     consent. When the model thinks it knows enough without it, Nova asks
//     whether they have a plan of their own or want one built.
//   - After BUILD_OFFER_AFTER learner messages, a question offers to build a
//     draft with what Nova has; the offer is not consent, pressing it is.
//   - Tasks are written only when asked for (TaskConsent; task-consent.ts).
//   - Talk is talk. A reading of "chat" changes nothing.
//   - A proposal is changed only by a new version. Approval names a version
//     (builder.ts checks it); every change, Nova's or the learner's, makes a
//     new one.
//   - Which status may follow which is TRANSITIONS, and nothing else.
//
// No regex: text is compared by characters (SKILL.md; the no-regex guard).

import { oneLine, type WorkspacePlan } from "./workspace-plan";
import { BUILDER_ACTIONS, CHANGE_KINDS, WORK_KINDS, type BuilderAction, type BuilderOffer, type ChangeKind, type BriefFact, type BuilderBrief, type BuilderMessage, type DraftStatus, type PendingJob, type PlanChangeSummary, type TaskConsent, type WorkKind } from "./builder.types";

export const MESSAGE_MAX = 2000;
// Nova's reply may explain what a shared file says, so it may run longer.
export const REPLY_MAX = 2400;
export const MESSAGES_KEPT = 60;
// The learner messages in a planning conversation after which a question
// offers to build a draft with what Nova has (builder.types.ts BuilderOffer).
export const BUILD_OFFER_AFTER = 3;
// A job that has said nothing for this long is taken to have died with its
// process; the learner may try again.
export const PENDING_STALE_MS = 180_000;
// One suggestion at most: Nova proposes what was asked, not a menu of extras.
const FACTS_MAX = 12, KNOWN_MAX = 8, ASSUMPTIONS_MAX = 8, SUGGESTIONS_MAX = 1, LINE_MAX = 200;

export const OPENING_QUESTION = "What are you working on, and what would you like to end up with?";
// Asked when code holds back a proposal the model wanted to write from one
// fact: where they are and where it is going, which every kind of plan needs.
export const STARTING_QUESTION = "Before I propose anything: where are you with it right now, and is there a date you're working towards?";
// What a first proposal needs, unless a question has already been asked.
export const MIN_FACTS_TO_DRAFT = 2;

// Asked by code when the model would draft without the learner's consent
// (greetings.ts planQuestion has it in their language).
export const PLAN_QUESTION = "I think I have enough to go on. Do you already have a plan you want to follow, or should I build one with you?";
// What the page sends for a choice, as the learner's words in the conversation.
export const ACTION_WORDS: Record<BuilderAction, string> = {
  build: "Build a draft with what we have.",
  own_plan: "I already have a plan.",
  explore: "I'm just exploring for now.",
  tasks: "Create tasks for the whole plan.",
};
// Which offer a choice answers: pressed under any other, it is only words.
const ANSWERS: Record<BuilderAction, readonly BuilderOffer[]> = { build: ["build", "plan"], own_plan: ["plan"], explore: ["plan"], tasks: ["tasks"] };
export const NO_TASKS: TaskConsent = { mode: "none", scope: [] };

export function emptyBrief(): BuilderBrief {
  return { kind: null, title: null, facts: [], known: [], assumptions: [], suggestions: [], question: null, questionsAsked: 0, dropped: [] };
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export const TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  discovery:         ["discovery", "drafting", "cancelled"],
  drafting:          ["awaiting_approval", "discovery", "failed", "cancelled"],
  awaiting_approval: ["awaiting_approval", "drafting", "building", "cancelled"],
  // discovery: what it changed was deleted, and the conversation can build anew.
  building:          ["ready", "failed", "awaiting_approval", "discovery"],
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

// decline: the message asks for something Build with Nova does not do
// (write an essay, set a reminder, change settings, answer something
// unrelated to what they are building). Code answers it with DECLINE_REPLY.
export type NextStep = "ask" | "chat" | "draft" | "revise" | "decline";

// Said by code, never worded by the model: what this page is for.
export const DECLINE_REPLY = "That's outside what I do here. In Build with Nova I shape and change your workspaces: their subjects, topics, tasks, dates and notes, and I can talk through files you share for them. For anything else, ask Nova from Today.";

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
  // For a change: the kinds of record it is about (only those may change).
  touches:     ChangeKind[];
  // For a change: whether it asks for anything to be removed. null: not said.
  removes?:    boolean | null;
  // Something of theirs already in Kivo the learner referred to, by the name
  // they used, and what they want with it: see it, change it, or a new one
  // (builder-changes.ts finds it among their own records; the model never
  // names an id).
  resource:    { name: string; intent: "open" | "change" | "new" } | null;
  // They ask to take back what this conversation last applied ("revert
  // that", "bring version 6 back"). Code builds the undo (builder-changes.ts).
  undo?:       boolean;
  // They want all of what this conversation works on deleted. Code builds
  // the removal (builder.ts), listed and approved like any change.
  deleteAll?:  boolean;
  // Their latest message asks for the plan to be built now: true only when
  // the model's quote of it is in that message.
  build?:      boolean;
  // Their latest message asks for tasks (all, or for named parts) or for
  // none, quoted from it as build is. null: it says nothing about tasks.
  tasks?:      TaskConsent | null;
  // What they said about a plan of their own. null: nothing.
  stance?:     BuilderBrief["stance"];
  // The existing subject, topic or milestone they ask to put things inside.
  under?:      string | null;
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
// `latest` is their latest message: consent to build and to tasks counts
// only when quoted from it, never from something said earlier.
export function readTurn(raw: unknown, learnerText: string, fileNames: readonly string[] = [], latest: string = learnerText): TurnReading | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const reply = typeof r.reply === "string" ? r.reply.split("\r").join("").trim().slice(0, REPLY_MAX) : "";
  const next: NextStep | null = r.next === "ask" || r.next === "chat" || r.next === "draft" || r.next === "revise" || r.next === "decline" ? r.next : null;
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
    touches: Array.isArray(r.touches) ? CHANGE_KINDS.filter(k => (r.touches as unknown[]).includes(k)) : [],
    removes: typeof r.removes === "boolean" ? r.removes : null,
    undo: r.undo === true,
    deleteAll: r.deleteAll === true,
    build: quoted(r.build, latest),
    tasks: taskConsentOf(r.tasks, latest),
    stance: r.stance === "own_plan" || r.stance === "help" || r.stance === "explore" ? r.stance : null,
    under: oneLine(r.under, 120) || null,
  };
}

// {"quote": "..."}: true when the quote is in `said`, a few words at least.
function quoted(raw: unknown, said: string): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const quote = normalized(oneLine((raw as { quote?: unknown }).quote, LINE_MAX));
  return quote.length >= 3 && normalized(said).includes(quote);
}

function taskConsentOf(raw: unknown, said: string): TaskConsent | null {
  if (!quoted(raw, said)) return null;
  const r = raw as { want?: unknown; scope?: unknown };
  if (r.want === "none") return NO_TASKS;
  if (r.want === "all") return { mode: "all", scope: [] };
  const scope = listOf(r.scope, 12);
  return r.want === "some" && scope.length ? { mode: "scoped", scope } : null;
}

// The consent they gave for tasks so far, read from the brief.
export const taskConsent = (brief: Pick<BuilderBrief, "tasks">): TaskConsent => brief.tasks ?? NO_TASKS;

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
  // reply (which says it will propose) is not used. offer: the choices the
  // page shows under the question.
  | { type: "ask"; question: string; overruled?: true; offer?: BuilderOffer }
  | { type: "chat" }
  // Not what this page does: answered by code, nothing changes.
  | { type: "decline" }
  // consented: the learner asked for it (a button or their words); improving:
  // a change to something of theirs, proposed for their approval.
  | { type: "draft"; reason: "consented" | "improving" }
  | { type: "revise"; change: string };

// improving: the conversation is about a workspace they already have, which
// is context enough for a specific addition ("add a beta programme"), and
// what is proposed there is a change they approve, not a new plan.
// changes: a change set to an existing resource is proposed (it is the
// proposal there, as the plan is for a new workspace).
// consent: they asked for a plan before this turn. turns: their messages in
// this planning conversation (planningTurns), this one included.
// files: they shared material, which is something to build from.
export function decideStep(state: { plan: WorkspacePlan | null; brief: BuilderBrief; improving?: boolean; changes?: boolean; turns?: number; files?: boolean }, reading: TurnReading): Step {
  const facts = reading.facts.length > 0 ? reading.facts : state.brief.facts;
  if (reading.next === "decline") return { type: "decline" };

  // A proposal exists: a change to it is a new version; anything else is talk.
  if (state.plan || state.changes) {
    if (reading.next === "chat") return { type: "chat" };
    if (reading.next === "revise" || reading.next === "draft") return { type: "revise", change: reading.change ?? reading.reply };
    return reading.question ? { type: "ask", question: reading.question } : { type: "chat" };
  }

  // Something of theirs: what is drafted is a change, shown and approved before anything happens.
  if (state.improving) {
    if (reading.next === "chat") return { type: "chat" };
    return reading.next === "draft" || reading.next === "revise" ? { type: "draft", reason: "improving" } : { type: "ask", question: reading.question ?? OPENING_QUESTION };
  }

  const consented = state.brief.consent === true || reading.build === true;
  const offer = (state.turns ?? 0) >= BUILD_OFFER_AFTER ? { offer: "build" as const } : {};
  // Talk stays talk, consent or not, unless this very message asks to build.
  if (reading.next === "chat" && !reading.build) return { type: "chat" };
  // Nothing to draft from: ask what it is for, whatever the model wanted.
  if (facts.length === 0 && !state.files) return { type: "ask", question: reading.question ?? OPENING_QUESTION };
  if (consented) {
    // Asked to build from one detail with nothing asked yet: the one question every plan needs, then it is built.
    if (facts.length < MIN_FACTS_TO_DRAFT && state.brief.questionsAsked === 0 && !state.files && !reading.build) return { type: "ask", question: STARTING_QUESTION, overruled: true };
    return { type: "draft", reason: "consented" };
  }
  const wantsDraft = reading.next === "draft" || reading.next === "revise";
  // One thing said and nothing asked yet: even a question about a plan would be early.
  if (facts.length < MIN_FACTS_TO_DRAFT && state.brief.questionsAsked === 0 && !state.files) {
    return wantsDraft ? { type: "ask", question: STARTING_QUESTION, overruled: true, ...offer } : { type: "ask", question: reading.question ?? STARTING_QUESTION, ...offer };
  }
  // Ready, by the model's reading, but not asked to build: ask, never assume.
  if (wantsDraft) return { type: "ask", question: PLAN_QUESTION, overruled: true, offer: "plan" };
  return { type: "ask", question: reading.question ?? OPENING_QUESTION, ...offer };
}

// The learner's messages in this planning conversation: since the last
// thing it built (a built conversation going on is a new plan), Kivo's own
// notices aside. Stored messages, so a refresh keeps the count; a message
// sent twice is refused while the first is answered (builder.ts claim).
export function planningTurns(messages: BuilderMessage[]): number {
  const said = spoken(messages);
  const from = said.map(m => m.kind).lastIndexOf("built") + 1;
  return said.slice(from).filter(m => m.role === "user").length;
}

// The choice the learner pressed, when the message before theirs offered it.
export function pressed(messages: BuilderMessage[]): BuilderAction | null {
  const said = spoken(messages);
  const last = said.at(-1), before = said.at(-2);
  if (!last || last.role !== "user" || !last.action || !before || before.role !== "nova" || !before.offer) return null;
  return ANSWERS[last.action].includes(before.offer) ? last.action : null;
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
    consent: before.consent === true || reading.build === true,
    stance: reading.stance ?? before.stance ?? null,
    tasks: reading.tasks ?? taskConsent(before),
    under: reading.under ?? null,
  };
}

// What a plan holds, in the words of its kind of work (the page uses the
// same words, components/nova/builder/builder-view.ts). A project or work
// plan with one subject is the project itself, so it is not counted; with
// more, each is a workstream. Topics are counted apart from milestones.
export interface HeldCounts { subjects: number; topics: number; milestones: number; tasks: number; notes: number; dates: number }
export function holdsLine(kind: WorkKind | null, c: HeldCounts): string {
  const n = (count: number, one: string, many = `${one}s`) => (count ? `${count} ${count === 1 ? one : many}` : null);
  const academic = kind === "exam" || kind === "semester";
  const project = kind === "project", work = kind === "work" || kind === "career", skill = kind === "skill";
  return [
    project || work ? (c.subjects > 1 ? n(c.subjects, "workstream") : null) : n(c.subjects, academic ? "subject" : "area"),
    n(c.topics, project ? "part" : work ? "area" : skill ? "concept" : "topic"),
    n(c.milestones, academic ? "phase" : skill ? "stage" : "milestone"),
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
    ...(Array.isArray(r.touches) ? { touches: CHANGE_KINDS.filter(k => (r.touches as unknown[]).includes(k)) } : {}),
    ...(typeof r.removes === "boolean" ? { removes: r.removes } : {}),
    ...(r.deletion && typeof r.deletion === "object" && typeof (r.deletion as { fingerprint?: unknown }).fingerprint === "string" ? { deletion: r.deletion as BuilderBrief["deletion"] } : {}),
    ...(r.consent === true ? { consent: true } : {}),
    ...(r.stance === "own_plan" || r.stance === "help" || r.stance === "explore" ? { stance: r.stance } : {}),
    ...(readTaskConsent(r.tasks) ? { tasks: readTaskConsent(r.tasks)! } : {}),
    ...(oneLine(r.under, 120) ? { under: oneLine(r.under, 120) } : {}),
    question: oneLine(r.question, 300) || null,
    questionsAsked: typeof r.questionsAsked === "number" && Number.isInteger(r.questionsAsked) && r.questionsAsked >= 0 ? r.questionsAsked : 0,
    dropped: listOf(r.dropped, 12),
  };
}

function readTaskConsent(raw: unknown): TaskConsent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { mode?: unknown; scope?: unknown };
  const scope = listOf(r.scope, 12);
  return r.mode === "none" || r.mode === "all" ? { mode: r.mode, scope: [] } : r.mode === "scoped" && scope.length ? { mode: "scoped", scope } : null;
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
    const offer = x.offer === "build" || x.offer === "plan" || x.offer === "tasks" ? x.offer : null;
    const action = BUILDER_ACTIONS.find(a => a === x.action) ?? null;
    return [{
      id: x.id, role: x.role, text: x.text, at: x.at, ...(typeof x.kind === "string" ? { kind: x.kind as BuilderMessage["kind"] } : {}), ...(typeof x.version === "number" ? { version: x.version } : {}), ...(files.length ? { files } : {}),
      ...(offer ? { offer } : {}), ...(action ? { action } : {}),
    }];
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
export function message(role: BuilderMessage["role"], text: string, now: Date, extra: Pick<BuilderMessage, "kind" | "version" | "files" | "offer" | "action"> = {}): BuilderMessage {
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
  type Seen = { label: string; kind: "tasks" | "milestones" | "topics" | "notes" | null; sig: string };
  const names = (p: WorkspacePlan | null): Map<string, Seen> => {
    const out = new Map<string, Seen>();
    if (!p) return out;
    // A topic by its name and its subject's place: renaming the subject is
    // not every topic changing. What it sits inside and its place among
    // those beside it are part of it: a move alone is a change.
    for (const [i, s] of p.subjects.entries()) {
      out.set(`subject:${normalized(s.name)}`, { label: `subject ${s.name}`, kind: null, sig: "" });
      const place = (t: { name: string; parent?: string | null }) => s.topics.filter(x => normalized(x.parent ?? "") === normalized(t.parent ?? "")).findIndex(x => x.name === t.name);
      for (const t of s.topics) {
        const milestone = t.kind === "milestone";
        out.set(`topic:${i}:${normalized(t.name)}`, { label: `${milestone ? "milestone" : "topic"} ${t.name}`, kind: milestone ? "milestones" : "topics", sig: JSON.stringify([normalized(t.parent ?? ""), place(t), t.kind ?? null, t.explanation, t.milestone ?? null]) });
      }
    }
    // By key: a task renamed is the same task, changed; so is one moved under
    // another, to another place among its steps, or waiting on others.
    const step = (t: { key: string; parent?: string | null }) => p.tasks.filter(x => (x.parent ?? null) === (t.parent ?? null)).findIndex(x => x.key === t.key);
    for (const t of p.tasks) out.set(`task:${t.key}`, { label: `task ${t.title}`, kind: "tasks", sig: JSON.stringify([t.title, t.priority, t.dueDay, t.topic, [...(t.after ?? [])].sort(), t.estimatedMinutes, t.parent ?? null, step(t)]) });
    for (const n of p.notes) out.set(`note:${normalized(n.title)}`, { label: `note ${n.title}`, kind: "notes", sig: n.body });
    for (const d of p.dates) out.set(`date:${normalized(d.title)}:${d.day}`, { label: `date ${d.title} (${d.day})`, kind: null, sig: "" });
    return out;
  };
  const a = names(before), b = names(after);
  // One subject for another in the same place: a rename, said once.
  const renamedSubject = before && before.subjects.length === after.subjects.length
    ? before.subjects.flatMap((s, i) => (normalized(s.name) !== normalized(after.subjects[i]!.name) && !after.subjects.some(x => normalized(x.name) === normalized(s.name)) ? [`${s.name} to ${after.subjects[i]!.name}`] : []))
    : [];
  const isRename = (label: string) => label.startsWith("subject ") && renamedSubject.some(r => r.startsWith(`${label.slice(8)} to `) || r.endsWith(` to ${label.slice(8)}`));
  const added = [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k)!.label).filter(l => !isRename(l));
  const removed = [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k)!.label).filter(l => !isRename(l));
  const changed = { tasks: 0, milestones: 0, topics: 0, notes: 0 };
  for (const [k, v] of b) { const was = a.get(k); if (was && v.kind && was.sig !== v.sig) changed[v.kind]++; }
  // A subject kept, now inside another (or out on its own).
  const moved = before ? after.subjects.flatMap(s => {
    const was = before.subjects.find(x => normalized(x.name) === normalized(s.name));
    if (!was || normalized(was.parent ?? "") === normalized(s.parent ?? "")) return [];
    return [s.parent ? `${s.name} inside ${s.parent}` : `${s.name} on its own`];
  }) : [];
  return {
    added, removed, renamed: before && normalized(before.title) !== normalized(after.title) ? 1 : 0, changed,
    ...(renamedSubject.length ? { renamedSubjects: renamedSubject } : {}), ...(moved.length ? { movedSubjects: moved } : {}),
  };
}

export function changedNothing(c: PlanChangeSummary): boolean {
  const ch = c.changed ?? { tasks: 0, milestones: 0, topics: 0, notes: 0 };
  return c.added.length === 0 && c.removed.length === 0 && c.renamed === 0 && !c.renamedSubjects?.length && !c.movedSubjects?.length && ch.tasks + ch.milestones + ch.topics + ch.notes === 0;
}

export function describeChanges(c: PlanChangeSummary): string {
  const part = (label: string, list: string[]) => (list.length === 0 ? null : `${label} ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`);
  const n = (count: number, one: string, many = `${one}s`) => (count ? `${count} ${count === 1 ? one : many}` : null);
  const ch = c.changed ?? { tasks: 0, milestones: 0, topics: 0, notes: 0 };
  const changed = [n(ch.tasks, "task"), n(ch.milestones, "milestone"), n(ch.topics, "topic"), n(ch.notes, "note")].filter(Boolean);
  const parts = [c.renamedSubjects?.length ? `Renamed ${c.renamedSubjects.join(", ")}` : null, part("Added", c.added), part("Put", c.movedSubjects ?? []), part("Removed", c.removed), changed.length ? `Changed ${changed.join(", ")}` : null, c.renamed ? "Renamed the workspace" : null].filter(Boolean);
  return parts.length ? `${parts.join(". ")}.` : "Nothing in it changed.";
}
