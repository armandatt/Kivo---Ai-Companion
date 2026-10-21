// Build with Nova: what a turn may do (builder-state.ts), what the model is
// given and how its replies are read (builder-conversation.ts, the plan
// writer), the plan's task order, and who may write what. No database and no
// model: the model is a stub. The flow against a real database is
// nova-builder.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_QUESTIONS, OPENING_QUESTION, PENDING_STALE_MS, TRANSITIONS, canMove, decideStep, describeChanges, emptyBrief,
  isPendingLive, needsReply, nextBrief, normalized, planChanges, readTurn, withMessages, message, MESSAGES_KEPT, replyWithQuestion,
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

  it("a clear request moves to a proposal without more questions", () => {
    const step = decideStep({ plan: null, brief: brief() }, r({ next: "draft", facts: [{ label: "Goal", value: "learn FastAPI", quote: "learn FastAPI" }] }, "I need a roadmap to learn FastAPI"));
    expect(step).toEqual({ type: "draft", reason: "ready" });
  });

  it(`proposes after ${MAX_QUESTIONS} questions rather than asking forever`, () => {
    const facts = [{ label: "Project", value: "TrackerX" }];
    expect(decideStep({ plan: null, brief: brief({ facts, questionsAsked: MAX_QUESTIONS - 1 }) }, r({ next: "ask", question: "Anything else?" })).type).toBe("ask");
    expect(decideStep({ plan: null, brief: brief({ facts, questionsAsked: MAX_QUESTIONS }) }, r({ next: "ask", question: "Anything else?" }))).toEqual({ type: "draft", reason: "enough_questions" });
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
  it("only the listed transitions exist; built and cancelled are final", () => {
    expect(TRANSITIONS.ready).toEqual([]);
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
    expect(describeChanges(planChanges(before, before))).toBe("Nothing was added or removed.");
  });
});

describe("task order in a plan", () => {
  it("keeps an order that names another task, and drops one that loops or names nothing", () => {
    const p = plan({ tasks: [
      { key: "a", title: "A", after: "c" }, { key: "b", title: "B", after: "a" }, { key: "c", title: "C", after: "b" },
      { key: "d", title: "D", after: "ghost" }, { key: "e", title: "E", after: "e" }, { key: "f", title: "F", after: "a" },
    ] });
    const after = Object.fromEntries(p.tasks.map(t => [t.key, t.after]));
    expect(after.d).toBeNull();
    expect(after.e).toBeNull();
    expect(after.f).toBe("a");
    // The loop a → c → b → a is broken somewhere; no task waits on itself through it.
    const loops = (k: string) => { let at = p.tasks.find(t => t.key === k)?.after; for (let i = 0; at && i < 10; i++) { if (at === k) return true; at = p.tasks.find(t => t.key === at)?.after; } return false; };
    for (const k of ["a", "b", "c"]) expect([k, loops(k)]).toEqual([k, false]);
  });
  it("is written into the workspace as an order note (tasks have no dependency column)", () => {
    const order = planWrites(plan()).notes.find(n => n.key === "order")!;
    expect(order.title).toBe("Order of work: TrackerX");
    expect(order.body).toContain("- Wire the tasks API: after Finish dashboard widgets");
  });
  it("milestone tasks stay under their milestone (a topic of the subject)", () => {
    const w = planWrites(plan());
    expect(w.subjects[0]!.topics).toEqual(["Dashboard", "API integration", "Finish the dashboard", "Integrate the APIs"]);
    expect(w.tasks.find(t => t.key === "api")!.topic).toBe("Integrate the APIs");
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
    expect(p).toContain("EXISTING WORKSPACE THEY WANT TO IMPROVE: TrackerX.");
  });
  it("reads a stub reply, and a failing or garbled model is null (the learner sees the honest error)", async () => {
    const ok = await readBuilderTurn(input(), (async () => JSON.stringify(reply({ next: "ask", question: "Who is it for?", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }] }))) as never);
    expect(ok?.question).toBe("Who is it for?");
    expect(ok?.facts).toEqual([{ label: "Project", value: "TrackerX" }]);
    expect(await readBuilderTurn(input(), (async () => { throw new Error("quota"); }) as never)).toBeNull();
    expect(await readBuilderTurn(input(), (async () => "not json") as never)).toBeNull();
  });
  it("a revision gets the proposal as it stands and the change asked for", () => {
    const req: BuilderPlanRequest = {
      today: TODAY, kind: "project", facts: [{ label: "Project", value: "TrackerX" }], known: [], assumptions: ["Solo developer"], suggestions: [],
      conversation: [{ role: "user", text: "make it four weeks" }], learnerText: "make it four weeks", current: plan(), change: "Make it four weeks", existing: null,
    };
    const p = builderPlanPrompt(req);
    expect(p).toContain("CURRENT PROPOSAL (JSON):\n{");
    expect(p).toContain("CHANGE ASKED: Make it four weeks");
    expect(p).toContain("FACTS (the learner's own):\n- Project: TrackerX");
    expect(p).toContain("ASSUMPTIONS (Nova's):\n- Solo developer");
  });
  it("the plan it writes is checked: Nova's links dropped, the learner's kept, no web search said by code", async () => {
    const req: BuilderPlanRequest = {
      today: TODAY, kind: "skill", facts: [], known: [], assumptions: [], suggestions: [], conversation: [],
      learnerText: "I want to learn FastAPI from https://fastapi.tiangolo.com", current: null, change: null, existing: null,
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
    const out = await writeBuilderPlan({ today: TODAY, kind: null, facts: [], known: [], assumptions: [], suggestions: [], conversation: [], learnerText: "", current: null, change: null, existing: null }, (async () => { throw new Error("down"); }) as never);
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
      current: null, change: null, existing: null, files: [PDF],
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
    const b = read("product/builder.ts");
    for (const table of ["novaSubject.", "novaTask.", "novaNote.", "novaExam.", "novaTopicMastery", "novaWorkspace."]) expect([table, b.includes(table)]).toEqual([table, false]);
    expect(b).toContain("await createWorkspace(platformChatId, {");
    // Approval builds the server's stored copy under a key from the draft and the version.
    expect(b).toContain("plan, clientKey: `d-${row.id}-v${row.version}`");
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
