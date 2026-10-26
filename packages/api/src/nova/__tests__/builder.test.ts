// Build with Nova: what a turn may do (builder-state.ts), what the model is
// given and how its replies are read (builder-conversation.ts, the plan
// writer), the plan's task order, and who may write what. No database and no
// model: the model is a stub. The flow against a real database is
// nova-builder.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILD_OFFER_AFTER, PLAN_QUESTION, planningTurns, pressed, OPENING_QUESTION, PENDING_STALE_MS, TRANSITIONS, canMove, decideStep, describeChanges, emptyBrief,
  isPendingLive, needsReply, nextBrief, normalized, planChanges, readTurn, withMessages, changedNothing, message, MESSAGES_KEPT, replyWithQuestion, MIN_FACTS_TO_DRAFT, STARTING_QUESTION, holdsLine,
} from "../product/builder-state";
import { languageRule, readBuilderTurn, turnPrompt, type TurnInput } from "../product/builder-conversation";
import { builderPlanPrompt, writeBuilderPlan, NO_RESEARCH, type BuilderPlanRequest } from "../product/workspace-generation";
import { checkWorkspacePlan, planWrites, type WorkspacePlan } from "../product/workspace-plan";
import type { BuilderBrief, BuilderMessage } from "../product/builder.types";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const repo = (path: string) => readFileSync(join(__dirname, "../../../../..", path), "utf8");
const TODAY = "2026-10-21";
const NOW = new Date("2026-10-21T10:00:00Z");

const reply = (over: Record<string, unknown>) => ({ reply: "Got it.", next: "ask", facts: [], assumptions: [], suggestions: [], question: null, ...over });
const said = (...lines: string[]) => lines.join("\n");

// Raw plan parts, as a model would send them; checked into a WorkspacePlan.
function plan(over: Record<string, unknown> = {}): WorkspacePlan {
  const r = checkWorkspacePlan({
    title: "TrackerX", summary: "Ship TrackerX",
    subjects: [{ name: "TrackerX", topics: ["Dashboard", "API integration"] }],
    phases: [{ name: "Finish the dashboard", subject: "TrackerX" }, { name: "Integrate the APIs", subject: "TrackerX" }],
    tasks: [
      { key: "dash", title: "Finish dashboard widgets", topic: "Finish the dashboard" },
      { key: "api", title: "Wire the tasks API", topic: "Integrate the APIs", after: "dash" },
    ],
    ...over,
  }, { today: TODAY });
  if (!r.ok) throw new Error(r.message);
  return r.plan;
}

describe("a fact is the learner's only when they said it", () => {
  const words = said("I'm building TrackerX.", "It's a project tracking app for small teams.");
  it("keeps a fact whose quote is in what they wrote, however it is spaced or cased", () => {
    const r = readTurn(reply({ facts: [{ label: "Project", value: "TrackerX, a project tracker", quote: "building   trackerx" }, { label: "Audience", value: "small teams", quote: "for small teams" }] }), words)!;
    expect(r.facts).toEqual([{ label: "Project", value: "TrackerX, a project tracker" }, { label: "Audience", value: "small teams" }]);
  });
  it("shows anything else the model calls a fact as an assumption, never as theirs", () => {
    const r = readTurn(reply({ facts: [{ label: "Deadline", value: "in three weeks", quote: "due in three weeks" }, { label: "Stack", value: "React", quote: "" }] }), words)!;
    expect(r.facts).toEqual([]);
    expect(r.assumptions).toEqual(["Deadline: in three weeks", "Stack: React"]);
  });
  it("refuses a reply that is not the shape asked for", () => {
    expect(readTurn({ reply: "hi" }, words)).toBeNull();
    expect(readTurn({ next: "draft" }, words)).toBeNull();
    expect(readTurn("draft", words)).toBeNull();
    expect(readTurn(reply({ next: "build_it_now" }), words)).toBeNull();
  });
  it("normalises curly quotes and spaces for the comparison only", () => {
    expect(normalized("It’s  a   TEST")).toBe("it's a test");
  });
});

describe("what a turn may do (code decides, not the model)", () => {
  const brief = (over: Partial<BuilderBrief> = {}): BuilderBrief => ({ ...emptyBrief(), ...over });
  const r = (over: Record<string, unknown>, words = "I'm building TrackerX") => readTurn(reply(over), words)!;

  it("a vague first message is answered with one question, not a workspace", () => {
    // The model wants to draft from nothing: code asks what it is for.
    expect(decideStep({ plan: null, brief: brief() }, r({ next: "draft", facts: [] }, "help"))).toEqual({ type: "ask", question: OPENING_QUESTION });
    const ask = decideStep({ plan: null, brief: brief() }, r({ next: "ask", question: "What does TrackerX help people do, and who is it for?", facts: [{ label: "Project", value: "TrackerX", quote: "building TrackerX" }] }));
    expect(ask).toEqual({ type: "ask", question: "What does TrackerX help people do, and who is it for?" });
  });

  it("a clear request is not consent: Nova asks whether to build, and builds only when asked (Scenario A)", () => {
    const facts = [{ label: "Goal", value: "learn FastAPI", quote: "learn FastAPI" }, { label: "Time available", value: "5 hours a week", quote: "5 hours a week" }];
    const words = "I want to learn FastAPI, 5 hours a week";
    // The model thinks it knows enough: code asks whether they have a plan or want one, with the choices.
    expect(decideStep({ plan: null, brief: brief() }, r({ next: "draft", facts }, words))).toEqual({ type: "ask", question: PLAN_QUESTION, overruled: true, offer: "plan" });
    // Asked in their latest words (quoted from it): built at once.
    const asked = readTurn(reply({ next: "draft", facts, build: { quote: "build me the roadmap now" } }), `${words}\nOK, build me the roadmap now`, [], "OK, build me the roadmap now")!;
    expect(asked.build).toBe(true);
    expect(decideStep({ plan: null, brief: brief() }, asked)).toEqual({ type: "draft", reason: "consented" });
    // Consent given before (a button, or earlier words) holds for the next turn.
    expect(decideStep({ plan: null, brief: brief({ facts, consent: true }) }, r({ next: "ask", question: "Which framework?" }, words))).toEqual({ type: "draft", reason: "consented" });
  });

  it("consent is quoted from the latest message only: a goal, an answer or an earlier message is not consent", () => {
    // The quote is not in the latest message: no consent, whatever the model says.
    const old = readTurn(reply({ next: "draft", build: { quote: "build it" } }), "build it\nI know Python already", [], "I know Python already")!;
    expect(old.build).toBe(false);
    // Too short to be a quote of anything.
    expect(readTurn(reply({ next: "draft", build: { quote: "ok" } }), "ok", [], "ok")!.build).toBe(false);
    expect(readTurn(reply({ next: "draft", build: null }), "I want to learn FastAPI")!.build).toBe(false);
  });

  it("an explicit build with enough context is not held back by questions (Scenario F)", () => {
    const facts = [{ label: "Goal", value: "learn FastAPI", quote: "learn FastAPI" }];
    const now = readTurn(reply({ next: "draft", facts, build: { quote: "Build the roadmap now using this PDF" } }), "Build the roadmap now using this PDF to learn FastAPI", ["roadmap.pdf"], "Build the roadmap now using this PDF to learn FastAPI")!;
    // First message, one fact, a file: built, no question first.
    expect(decideStep({ plan: null, brief: brief(), files: true, turns: 1 }, now)).toEqual({ type: "draft", reason: "consented" });
    // Nothing at all to build from: still one question.
    const empty = readTurn(reply({ next: "draft", facts: [], build: { quote: "build it now" } }), "build it now")!;
    expect(decideStep({ plan: null, brief: brief() }, empty)).toEqual({ type: "ask", question: OPENING_QUESTION });
  });

  it("a shared roadmap is material, not consent: Nova asks about it first (Scenario B)", () => {
    const shared = r({ next: "draft", facts: [{ label: "Roadmap", value: "the PDF", file: "fastapi.pdf" }] }, "");
    const step = decideStep({ plan: null, brief: brief({ questionsAsked: 1 }), files: true, turns: 1 }, shared);
    expect(step).toEqual({ type: "ask", question: PLAN_QUESTION, overruled: true, offer: "plan" });
  });

  it("a first message that only names the thing gets a question, not a generic proposal", () => {
    // "I'm building TrackerX": the model wants to draft; code asks where they are first, in its own words.
    const named = r({ next: "draft", reply: "Great, I'll put together a plan for TrackerX.", facts: [{ label: "Project", value: "TrackerX", quote: "building TrackerX" }] });
    expect(decideStep({ plan: null, brief: brief() }, named)).toEqual({ type: "ask", question: STARTING_QUESTION, overruled: true });
    // Once a question has been asked, a "draft" reading asks whether to build, never builds.
    const later = brief({ facts: [{ label: "Project", value: "TrackerX" }], questionsAsked: 1 });
    expect(decideStep({ plan: null, brief: later }, r({ next: "draft" }))).toEqual({ type: "ask", question: PLAN_QUESTION, overruled: true, offer: "plan" });
    expect(MIN_FACTS_TO_DRAFT).toBe(2);
    // Adding to a workspace they have: the workspace is the context, so one specific ask is enough.
    const add = r({ next: "draft", facts: [{ label: "Add", value: "a beta programme", quote: "beta programme" }] }, "Add a beta programme");
    expect(decideStep({ plan: null, brief: brief(), improving: true }, add)).toEqual({ type: "draft", reason: "improving" });
    // Opened something of theirs, then "Add graphs to it": no fact needed (seen 22 Oct: asked what they were working on).
    expect(decideStep({ plan: null, brief: brief(), improving: true }, r({ next: "draft", facts: [] }))).toEqual({ type: "draft", reason: "improving" });
  });

  it("there is no question count after which Nova builds; the build shortcut appears from the third message", () => {
    const facts = [{ label: "Project", value: "TrackerX" }];
    const ask = r({ next: "ask", question: "Anything else?" });
    // However many questions: still a question, never a draft.
    expect(decideStep({ plan: null, brief: brief({ facts, questionsAsked: 12 }), turns: 1 }, ask)).toEqual({ type: "ask", question: "Anything else?" });
    expect(BUILD_OFFER_AFTER).toBe(3);
    expect(decideStep({ plan: null, brief: brief({ facts, questionsAsked: 2 }), turns: 2 }, ask)).toEqual({ type: "ask", question: "Anything else?" });
    expect(decideStep({ plan: null, brief: brief({ facts, questionsAsked: 2 }), turns: 3 }, ask)).toEqual({ type: "ask", question: "Anything else?", offer: "build" });
    // Never under a proposal's questions, or when working on something of theirs.
    expect(decideStep({ plan: plan(), brief: brief({ facts }), turns: 9 }, ask)).toEqual({ type: "ask", question: "Anything else?" });
    expect(decideStep({ plan: null, brief: brief({ facts }), improving: true, turns: 9 }, ask)).toEqual({ type: "ask", question: "Anything else?" });
  });

  it("learner messages are counted from what is stored, in this planning conversation only", () => {
    const at = (role: "user" | "nova", text: string, extra: Partial<BuilderMessage> = {}): BuilderMessage => ({ ...message(role, text, NOW), ...extra });
    const list = [at("user", "I want to learn FastAPI"), at("nova", "What do you know?", { kind: "question" }), at("nova", "Kivo couldn't answer", { kind: "error" }), at("user", "Python"), at("nova", "A notice", { kind: "notice" })];
    expect(planningTurns(list)).toBe(2);
    // A built conversation going on is a new plan: counted from what it built.
    expect(planningTurns([...list, at("nova", "Built", { kind: "built" }), at("user", "Now add Phase 5")])).toBe(1);
  });

  it("a pressed choice counts only under the message that offered it", () => {
    const at = (role: "user" | "nova", text: string, extra: Partial<BuilderMessage> = {}): BuilderMessage => ({ ...message(role, text, NOW), ...extra });
    expect(pressed([at("nova", "Which framework?", { kind: "question", offer: "build" }), at("user", "Build a draft with what we have.", { action: "build" })])).toBe("build");
    expect(pressed([at("nova", "Plan?", { kind: "question", offer: "plan" }), at("user", "I already have a plan.", { action: "own_plan" })])).toBe("own_plan");
    // Not offered there (a stale button, or a forged request): only words.
    expect(pressed([at("nova", "Which framework?", { kind: "question" }), at("user", "Build a draft with what we have.", { action: "build" })])).toBeNull();
    expect(pressed([at("nova", "Here's a proposal", { kind: "proposal", offer: "tasks" }), at("user", "Build", { action: "build" })])).toBeNull();
  });

  it("consent and the tasks asked for are kept in the brief across turns", () => {
    const first = readTurn(reply({ next: "ask", tasks: { want: "some", scope: ["Phase 1"], quote: "tasks only for Phase 1" } }), "Make tasks only for Phase 1", [], "Make tasks only for Phase 1")!;
    const b1 = nextBrief(emptyBrief(), first, { type: "chat" });
    expect(b1.tasks).toEqual({ mode: "scoped", scope: ["Phase 1"] });
    // A later turn that says nothing about tasks keeps what was asked.
    const b2 = nextBrief({ ...b1, consent: true }, readTurn(reply({ next: "chat" }), "thanks")!, { type: "chat" });
    expect(b2.tasks).toEqual({ mode: "scoped", scope: ["Phase 1"] });
    expect(b2.consent).toBe(true);
    // A tasks request not quoted from the latest message is not taken.
    expect(readTurn(reply({ next: "ask", tasks: { want: "all", quote: "make tasks" } }), "make tasks\nno wait", [], "no wait")!.tasks).toBeNull();
  });

  it("talk is talk: a chat reading changes nothing, with or without a proposal", () => {
    expect(decideStep({ plan: null, brief: brief() }, r({ next: "chat" }))).toEqual({ type: "chat" });
    expect(decideStep({ plan: plan(), brief: brief() }, r({ next: "chat" }))).toEqual({ type: "chat" });
  });

  it("with a proposal, a correction is a new version (revise), with the change in words", () => {
    expect(decideStep({ plan: plan(), brief: brief() }, r({ next: "revise", change: "Make it four weeks, not three" }))).toEqual({ type: "revise", change: "Make it four weeks, not three" });
    // A model that says "draft" again is a revision too: there is one proposal.
    expect(decideStep({ plan: plan(), brief: brief() }, r({ next: "draft" })).type).toBe("revise");
  });

  it("what a proposal holds is said in its kind's words: a project has parts and milestones, not subjects (seen 22 Oct)", () => {
    // Milestones are counted apart from topics (planCounts): once each.
    const c = { subjects: 1, topics: 3, milestones: 3, tasks: 8, notes: 9, dates: 1 };
    expect(holdsLine("project", c)).toBe("3 parts, 3 milestones, 8 tasks, 9 notes, 1 date");
    // Seen 25 Oct: "4 parts, 4 milestones" for a project whose parts are its milestones.
    expect(holdsLine("project", { ...c, topics: 0 })).toBe("3 milestones, 8 tasks, 9 notes, 1 date");
    // A project with several workstreams says so.
    expect(holdsLine("project", { ...c, subjects: 3, topics: 0 })).toBe("3 workstreams, 3 milestones, 8 tasks, 9 notes, 1 date");
    expect(holdsLine("semester", { ...c, subjects: 4, topics: 3, milestones: 0 })).toBe("4 subjects, 3 topics, 8 tasks, 9 notes, 1 date");
    expect(holdsLine("skill", c)).toBe("1 area, 3 concepts, 3 stages, 8 tasks, 9 notes, 1 date");
    expect(holdsLine(null, { subjects: 0, topics: 0, milestones: 0, tasks: 0, notes: 0, dates: 0 })).toBe("");
  });
  it("a question is asked once: the model's own wording, or code's when the reply asks nothing", () => {
    // Seen with the real model (21 Oct): the reply asked it, and code asked it again in other words.
    const reply = "Building TrackerX sounds exciting. Is this for a course or an independent venture?";
    expect(replyWithQuestion(reply, "Is this project for a specific course or an independent venture?")).toBe(reply);
    expect(replyWithQuestion("Got it.", "Who is it for?")).toBe("Got it.\n\nWho is it for?");
  });

  it("the understanding keeps what the learner said and counts questions asked", () => {
    const before = brief({ facts: [{ label: "Project", value: "TrackerX" }], questionsAsked: 1 });
    const reading = r({ next: "ask", question: "Deadline?", facts: [{ label: "Done so far", value: "auth", quote: "TrackerX" }] });
    const after = nextBrief(before, reading, { type: "ask", question: "Deadline?" });
    expect(after.facts.map(f => f.label)).toEqual(["Done so far", "Project"]);
    expect(after.questionsAsked).toBe(2);
    expect(after.question).toBe("Deadline?");
  });
});

describe("statuses and jobs", () => {
  it("only the listed transitions exist; cancelled is final, and a built conversation only goes on talking", () => {
    // Built: the conversation goes on about what it built; nothing of it changes without a new approval.
    expect(TRANSITIONS.ready).toEqual(["discovery"]);
    expect(TRANSITIONS.cancelled).toEqual([]);
    expect(canMove("discovery", "building")).toBe(false);   // nothing is built without a proposal
    expect(canMove("awaiting_approval", "building")).toBe(true);
    expect(canMove("building", "ready")).toBe(true);
    expect(canMove("building", "cancelled")).toBe(false);   // a build in progress is not cancelled
  });
  it("a job that has gone quiet for too long is stale, so the learner can try again", () => {
    const job = { kind: "draft" as const, stage: "writing" as const, startedAt: NOW.toISOString(), baseVersion: 1 };
    expect(isPendingLive(job, new Date(NOW.getTime() + 10_000))).toBe(true);
    expect(isPendingLive(job, new Date(NOW.getTime() + PENDING_STALE_MS + 1))).toBe(false);
  });
  it("the last thing said being theirs means Nova still owes an answer (notices and errors aside)", () => {
    const u = message("user", "I'm building TrackerX", NOW);
    const err = message("nova", "Nova couldn't answer just now.", NOW, { kind: "error" });
    expect(needsReply([u], null, NOW)).toBe(true);
    expect(needsReply([u, err], null, NOW)).toBe(true);
    expect(needsReply([u, message("nova", "What is it for?", NOW, { kind: "question" })], null, NOW)).toBe(false);
  });
  it("the conversation is capped, keeping how it began", () => {
    const list: BuilderMessage[] = Array.from({ length: MESSAGES_KEPT + 5 }, (_, i) => message("user", `m${i}`, NOW));
    const kept = withMessages(list.slice(0, MESSAGES_KEPT), ...list.slice(MESSAGES_KEPT));
    expect(kept.length).toBe(MESSAGES_KEPT);
    expect(kept[0]!.text).toBe("m0");
    expect(kept[kept.length - 1]!.text).toBe(`m${MESSAGES_KEPT + 4}`);
  });
});

describe("a new version says what changed", () => {
  it("names what was added and removed", () => {
    const before = plan();
    const after = plan({ tasks: [{ key: "dash", title: "Finish dashboard widgets", topic: "Finish the dashboard" }, { key: "test", title: "Test the full flow" }] });
    const c = planChanges(before, after);
    expect(c.added).toEqual(["task Test the full flow"]);
    expect(c.removed).toEqual(["task Wire the tasks API"]);
    expect(describeChanges(c)).toBe("Added task Test the full flow. Removed task Wire the tasks API.");
    expect(describeChanges(planChanges(before, before))).toBe("Nothing in it changed.");
    expect(changedNothing(planChanges(before, before))).toBe(true);
  });
  it("counts what changed in place: a task's priority or date is a change, not nothing", () => {
    const before = plan();
    const after = { ...before, tasks: before.tasks.map((t, i) => (i === 0 ? { ...t, priority: "high" as const, dueDay: "2026-10-30" } : t)) };
    const c = planChanges(before, after);
    expect(changedNothing(c)).toBe(false);
    expect(describeChanges(c)).toBe("Changed 1 task.");
  });
  it("a subject renamed is said once, not as every topic added and removed", () => {
    const before = plan();
    const after = { ...before, subjects: before.subjects.map(s => ({ ...s, name: "Kivo" })) };
    const c = planChanges(before, after);
    expect(describeChanges(c)).toBe(`Renamed ${before.subjects[0]!.name} to Kivo.`);
    expect(changedNothing(c)).toBe(false);
  });
});

describe("task waits in a plan", () => {
  it("keeps waits that name other tasks, several each, and says what it drops (nothing name, itself, a circle)", () => {
    const r = checkWorkspacePlan({ title: "X", subjects: [{ name: "X", topics: ["Y"] }], tasks: [
      { key: "a", title: "A", after: ["c"] }, { key: "b", title: "B", after: "a" }, { key: "c", title: "C", after: ["b"] },
      { key: "d", title: "D", after: ["ghost"] }, { key: "e", title: "E", after: ["e"] }, { key: "f", title: "F", after: ["a", "b"] },
    ] }, { today: TODAY });
    if (!r.ok) throw new Error(r.message);
    const after = Object.fromEntries(r.plan.tasks.map(t => [t.key, t.after]));
    expect(after.d).toEqual([]);
    expect(after.e).toEqual([]);
    expect(after.f).toEqual(["a", "b"]);
    // The loop a → c → b → a is broken once, and said.
    expect([after.a, after.b, after.c].filter(x => x!.length === 0)).toHaveLength(1);
    expect(r.dropped.some(d => d.includes("round in a circle"))).toBe(true);
    expect(r.dropped.filter(d => d.startsWith("a wait in"))).toHaveLength(2);
  });
  it("are data, not a note: the plan writes no note of its own", () => {
    const w = planWrites(plan());
    expect(w.notes).toEqual([]);
    expect(w.tasks.find(t => t.key === "api")!.after).toEqual(["dash"]);
  });
  it("milestones are topics of kind milestone, first in their subject, and their tasks stay under them", () => {
    const w = planWrites(plan());
    expect(w.subjects[0]!.topics.map(t => [t.name, t.kind])).toEqual([["Finish the dashboard", "milestone"], ["Integrate the APIs", "milestone"], ["Dashboard", null], ["API integration", null]]);
    expect(w.tasks.find(t => t.key === "api")!.topic).toBe("Integrate the APIs");
  });
  it("a revision that only nests a task, or reorders steps, is a change (26 Oct)", () => {
    const before = plan();
    const nested = { ...before, tasks: before.tasks.map(t => (t.key === "api" ? { ...t, parent: "dash" } : t)) };
    expect(changedNothing(planChanges(before, nested))).toBe(false);
    const moved = { ...before, subjects: before.subjects.map(s => ({ ...s, topics: s.topics.map(t => (t.name === "API integration" ? { ...t, parent: "Dashboard" } : t)) })) };
    expect(changedNothing(planChanges(before, moved))).toBe(false);
  });
});

describe("what the model is given", () => {
  const input = (over: Partial<TurnInput> = {}): TurnInput => ({
    today: TODAY, messages: [message("user", "I'm building TrackerX", NOW)], brief: emptyBrief(),
    known: [{ label: "Working on (said at sign-up)", value: "a side project" }, { label: "Time a week (their sign-up estimate)", value: "5–10 hours" }],
    proposal: null, existing: null, ...over,
  });
  it("tells it what Kivo already knows, so it is not asked again", () => {
    const p = turnPrompt(input());
    expect(p).toContain("KNOWN FROM KIVO (do not ask again):\n- Working on (said at sign-up): a side project\n- Time a week (their sign-up estimate): 5–10 hours");
    expect(p).toContain("LEARNER: I'm building TrackerX");
  });
  it("is told the language: English by default, Hinglish only when written or chosen (seen 21 Oct: English about GATE got Hinglish)", () => {
    expect(turnPrompt(input())).toContain("LANGUAGE: English, unless their latest message is clearly written in Hinglish");
    expect(languageRule("hinglish")).toContain("LANGUAGE: Hinglish in Roman letters (their choice at sign-up)");
  });
  it("shows the proposal and the workspace being improved, in short", () => {
    const p = turnPrompt(input({ proposal: { version: 3, title: "TrackerX", milestones: ["Finish the dashboard"], tasks: ["Wire the API"], topics: [], dates: [] }, existing: { title: "TrackerX", subjects: ["TrackerX"], tasks: ["Auth"] } }));
    expect(p).toContain("CURRENT PROPOSAL (version 3): TrackerX. Milestones: Finish the dashboard.");
    expect(p).toContain("WORKING ON: TrackerX (it exists in Kivo).");
  });
  it("reads a stub reply, and a failing or garbled model is null (the learner sees the honest error)", async () => {
    const ok = await readBuilderTurn(input(), (async () => JSON.stringify(reply({ next: "ask", question: "Who is it for?", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }] }))) as never);
    expect(ok?.question).toBe("Who is it for?");
    expect(ok?.facts).toEqual([{ label: "Project", value: "TrackerX" }]);
    expect(await readBuilderTurn(input(), (async () => { throw new Error("quota"); }) as never)).toBeNull();
    expect(await readBuilderTurn(input(), (async () => "not json") as never)).toBeNull();
  });
  it("is told each kind of work's own words, and that a project is not a syllabus", async () => {
    let system = "";
    await readBuilderTurn(input(), (async (req: { systemInstruction: string }) => { system = req.systemInstruction; return "{}"; }) as never);
    expect(system).toContain("- project (software or otherwise): milestones, tasks, subtasks, dependencies");
    expect(system).toContain("Never speak of subjects, syllabus, revision or exams for a project.");
    expect(system).toContain("- exam or semester (academic): subjects, units, topics, revision");
    expect(system).toContain("is never enough");
    // Consent is the learner's: never assumed from a goal, a file or an answer.
    expect(system).toContain("Never assume they want a plan built");
    expect(system).toContain("is not a request for tasks");
  });
  it("a first version gets the facts and assumptions; a proposal is never sent back to be rewritten (revisions are operations)", () => {
    const req: BuilderPlanRequest = {
      today: TODAY, kind: "project", facts: [{ label: "Project", value: "TrackerX" }], known: [], assumptions: ["Solo developer"], suggestions: [],
      conversation: [{ role: "user", text: "make it four weeks" }], learnerText: "make it four weeks", existing: null,
    };
    const p = builderPlanPrompt(req);
    expect(p).not.toContain("CURRENT PROPOSAL");
    expect(p).toContain("FACTS (the learner's own):\n- Project: TrackerX");
    expect(p).toContain("ASSUMPTIONS (Nova's):\n- Solo developer");
  });
  it("the plan it writes is checked: Nova's links dropped, the learner's kept, no web search said by code", async () => {
    const req: BuilderPlanRequest = {
      today: TODAY, kind: "skill", facts: [], known: [], assumptions: [], suggestions: [], conversation: [],
      learnerText: "I want to learn FastAPI from https://fastapi.tiangolo.com", existing: null,
    };
    const out = await writeBuilderPlan(req, (async () => JSON.stringify({
      title: "Learn FastAPI", subjects: [{ name: "FastAPI", topics: ["Routing"] }],
      resources: [{ title: "Docs", kind: "docs", url: "https://fastapi.tiangolo.com", origin: "user" }, { title: "A blog", kind: "article", url: "https://made-up.example", origin: "user" }],
      dates: [{ title: "Past", day: "2020-01-01", kind: "other" }],
    })) as never);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.resources.map(r => [r.title, r.url, r.origin])).toEqual([["Docs", "https://fastapi.tiangolo.com/", "user"], ["A blog", null, "nova"]]);
    expect(out.plan.dates).toEqual([]);
    expect(out.dropped[0]).toContain("Past");
    expect(out.plan.assumptions).toContain(NO_RESEARCH);
    expect(out.plan.kind).toBe("custom");
  });
  it("a model that is down is an honest 'unavailable', not an empty plan", async () => {
    const out = await writeBuilderPlan({ today: TODAY, kind: null, facts: [], known: [], assumptions: [], suggestions: [], conversation: [], learnerText: "", existing: null }, (async () => { throw new Error("down"); }) as never);
    expect(out.ok).toBe(false);
    expect("unavailable" in out && out.unavailable).toBe(true);
  });
});

describe("PDFs and photos in the conversation", () => {
  const PDF = { name: "syllabus.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 x").toString("base64") };
  const input = (): TurnInput => ({
    today: TODAY, messages: [message("user", "Here's my syllabus", NOW, { files: [{ name: "syllabus.pdf", pages: 12 }] })], brief: emptyBrief(), known: [],
    proposal: null, existing: null, files: [PDF], pages: { "syllabus.pdf": 12 },
  });
  it("a fact from a shared file is kept with its file; one naming a file nobody shared is an assumption", () => {
    const r = readTurn(reply({ facts: [
      { label: "Exam date", value: "12 December", file: "Syllabus.PDF" },
      { label: "Units", value: "five", file: "notes.pdf" },
    ] }), "Here's my syllabus", ["syllabus.pdf"])!;
    expect(r.facts).toEqual([{ label: "Exam date", value: "12 December", file: "syllabus.pdf" }]);
    expect(r.assumptions).toEqual(["Units: five"]);
  });
  it("the model is told which files it has and which message shared them, and gets the files to read", async () => {
    const p = turnPrompt(input());
    expect(p).toContain("FILES (attached; the learner's material): syllabus.pdf (PDF, 12 pages)");
    expect(p).toContain("LEARNER: [shared syllabus.pdf] Here's my syllabus");
    const calls: Array<Record<string, unknown>> = [];
    await readBuilderTurn(input(), (async (req: Record<string, unknown>) => { calls.push(req); return JSON.stringify(reply({ next: "chat", reply: "Unit 3 covers deadlocks (page 4)." })); }) as never);
    expect(calls[0]!.attachments).toEqual([PDF]);
    // Reading a file takes longer: the job's deadline is longer, not the request's.
    expect(calls[0]!.deadlineMs).toBe(75_000);
    const plain = { ...input(), files: [] };
    await readBuilderTurn(plain, (async (req: Record<string, unknown>) => { calls.push(req); return "{}"; }) as never);
    expect(calls[1]!.attachments).toBeUndefined();
    expect(calls[1]!.deadlineMs).toBe(25_000);
  });
  it("the proposal is written with the files attached, and page references to them are kept", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const out = await writeBuilderPlan({
      today: TODAY, kind: "exam", facts: [], known: [], assumptions: [], suggestions: [], conversation: [], learnerText: "",
      existing: null, files: [PDF],
    }, (async (req: Record<string, unknown>) => { calls.push(req); return JSON.stringify({
      title: "OS exam", subjects: [{ name: "OS", topics: [{ name: "Deadlocks", sources: [{ file: "syllabus.pdf", page: 4 }, { file: "made-up.pdf", page: 1 }] }] }],
      sources: [{ file: "syllabus.pdf", read: true, pages: 12 }],
    }); }) as never);
    expect(calls[0]!.attachments).toEqual([PDF]);
    expect(String(calls[0]!.prompt)).toContain("FILES: syllabus.pdf (application/pdf)");
    expect(out.ok && out.plan.subjects[0]!.topics[0]!.sources).toEqual([{ file: "syllabus.pdf", page: 4 }]);
    expect(out.ok && out.plan.sources).toEqual([{ file: "syllabus.pdf", read: true, pages: 12, note: null }]);
  });
});

describe("who writes what (read from source)", () => {
  const files = (dir: string): string[] => require("node:fs").readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) =>
    e.isDirectory() ? (e.name.startsWith("__") ? [] : files(join(dir, e.name))) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);
  const nova = join(__dirname, "..");

  it("builder.ts is the only code that touches NovaWorkspaceDraft, and creates through workspaces.ts", () => {
    const touching = files(nova).filter(f => readFileSync(f, "utf8").includes("novaWorkspaceDraft.") || readFileSync(f, "utf8").includes("novaWorkspaceDraftFile.")).map(f => f.slice(nova.length + 1));
    expect(touching).toEqual(["product/builder.ts"]);
    // The versions a conversation keeps: builder-history.ts alone.
    expect(files(nova).filter(f => readFileSync(f, "utf8").includes("novaWorkspaceDraftVersion.")).map(f => f.slice(nova.length + 1))).toEqual(["product/builder-history.ts"]);
    const b = read("product/builder.ts");
    for (const table of ["novaSubject.", "novaTask.", "novaNote.", "novaExam.", "novaTopicMastery", "novaWorkspace."]) expect([table, b.includes(table)]).toEqual([table, false]);
    expect(b).toContain("await createWorkspace(platformChatId, {");
    // Approval builds the server's stored copy under a key from the draft and the version.
    expect(b).toContain("plan: plan!, clientKey: `d-${row.id}-v${row.version}`");
    // Changes to what they have are applied by workspaces.ts too, never written here.
    expect(b).toContain("changeResource(platformChatId, { ref, set, key:");
    expect(b).toContain("if (input.version !== row.version) return { ok: false, error: \"stale\"");
  });

  it("a job's result is applied only while the job is current and the plan is the version it started from", () => {
    const b = read("product/builder.ts");
    expect(b).toContain("where: { id, jobId, version: change.plan.baseVersion }");
    expect(b).toContain("You changed the proposal while I was writing, so I kept your version.");
  });

  it("the routes take the learner from the session, pay for model calls up front and run them after answering", () => {
    const access = repo("apps/api/lib/nova/builder-access.ts");
    expect(access).toContain("const spend = await spendAiRequest(ent)");
    expect(access).toContain("after(async () => {");
    expect(access).toContain("meterTokensForLearner(platformChatId, () => runJob(platformChatId, job))");
    for (const route of ["builder/route.ts", "builder/[id]/route.ts", "builder/[id]/messages/route.ts", "builder/[id]/approve/route.ts", "builder/[id]/cancel/route.ts", "builder/[id]/retry/route.ts"]) {
      const src = repo(`apps/api/app/api/nova/${route}`);
      expect([route, src.includes("requireWorkspaceLearner()")]).toEqual([route, true]);
      expect([route, src.includes("platformChatId:")]).toEqual([route, false]);
    }
    expect(repo("apps/api/app/api/nova/builder/[id]/messages/route.ts")).toContain("const refused = await spendForTurn(access.platformChatId)");
    expect(repo("apps/api/app/api/nova/builder/[id]/retry/route.ts")).toContain("const refused = await spendForTurn(access.platformChatId)");
    // Approving and editing call no model and spend no allowance.
    for (const route of ["builder/[id]/approve/route.ts", "builder/[id]/route.ts", "builder/[id]/cancel/route.ts"]) expect([route, repo(`apps/api/app/api/nova/${route}`).includes("spendForTurn")]).toEqual([route, false]);
  });

  it("the conversation module and the state rules write nothing and use no regex", () => {
    for (const f of ["product/builder-state.ts", "product/builder-conversation.ts"]) {
      const src = read(f);
      expect([f, src.includes("prisma")]).toEqual([f, false]);
    }
    expect(read("product/builder-state.ts")).not.toContain("openai");
  });

  it("chat on either surface opens a draft and links to it; it never builds", () => {
    expect(read("telegram/telegram-turn.ts")).not.toContain("approveDraft");
    expect(read("interaction/web-sentence.ts")).not.toContain("approveDraft");
    expect(read("context/context-builder.ts")).toContain("changes to it are proposed and approved in Build with Nova on the web, never made from chat");
  });
});
