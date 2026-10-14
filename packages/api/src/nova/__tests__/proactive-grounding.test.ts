// What Nova says first, and why. Every message rests on a fact on record and
// carries something the learner can act on; a reason that has gone takes its
// message with it. The decision is pure and is run here. Delivery to a real
// Telegram chat is not shown by any of this.

// The wording module imports the one model client. Nothing here calls a
// model: the wording test passes its own stand-in.
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: async () => { throw new Error("no model in tests"); } }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideProactive, generateCandidates, holdReason, TASK_TITLE_IN_MESSAGE,
  type ProactiveFacts, type ProactiveGates,
} from "../decision/proactive-decision";
import { proactiveFallback, wordProactiveMessage, type ProactiveWordingInput } from "../proactive/nova-proactive-response";
import type { ProactiveType } from "../types/proactive.types";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

const DAY = "2026-10-14";
const NOW = new Date("2026-10-14T12:30:00.000Z");   // 18:00 in Asia/Kolkata

const facts = (over: Partial<ProactiveFacts> = {}): ProactiveFacts => ({
  localDay: DAY, localHour: 18, localMinute: 0, window: { from: 17, to: 20, basis: "default" },
  studiedToday: false, daysSinceLastSession: 1, lastSessionDay: "2026-10-13",
  exams: [], reviewDueCount: 0, hasPlan: true, tasksDueToday: [], ...over,
});
const gates = (over: Partial<ProactiveGates> = {}): ProactiveGates => ({
  proactiveEnabled: true, paused: false, undeliverable: false, hasTimezone: true, activeSession: false,
  messagedRecently: false, sentToday: [], lastSentAt: null, realityCategories: [], now: NOW, ...over,
});
const ALL: ProactiveType[] = ["exam_countdown", "missed_plan_recovery", "task_due", "review_due", "daily_checkin", "daily_nudge"];

// ── A task the learner set, due today ─────────────────────────────────────────

describe("a task due today is a reason to speak", () => {
  const due = [{ id: "t1", title: "Finish OS assignment 3" }];

  it("names the task, in the learner's words, once for that task and day", () => {
    const [c] = generateCandidates(facts({ tasksDueToday: due, hasPlan: false, studiedToday: true }));
    expect(c).toEqual({ type: "task_due", occurrenceKey: `task:t1:${DAY}`, reason: 'your task "Finish OS assignment 3" is due today' });
  });

  it("counts the others without listing them", () => {
    const two   = generateCandidates(facts({ tasksDueToday: [...due, { id: "t2", title: "B" }], hasPlan: false }))[0]!;
    const three = generateCandidates(facts({ tasksDueToday: [...due, { id: "t2", title: "B" }, { id: "t3", title: "C" }], hasPlan: false }))[0]!;
    expect(two.reason).toBe('your task "Finish OS assignment 3" is due today, and 1 more of your tasks is');
    expect(three.reason).toBe('your task "Finish OS assignment 3" is due today, and 2 more of your tasks are');
  });

  it("says a long or many-line title as one short line", () => {
    const c = generateCandidates(facts({ tasksDueToday: [{ id: "t1", title: `Read\n\tchapter   4\r\n${"x".repeat(200)}` }], hasPlan: false }))[0]!;
    const said = c.reason.slice(c.reason.indexOf('"') + 1, c.reason.lastIndexOf('"'));
    expect(said.startsWith("Read chapter 4 x")).toBe(true);
    expect(said.length).toBe(TASK_TITLE_IN_MESSAGE);
    expect(said).not.toContain("\n");
  });

  it("is chosen over a review and the usual-time nudge, and under an exam and a lapse", () => {
    const busy = facts({ tasksDueToday: due, reviewDueCount: 3 });
    expect(decideProactive(busy, gates()).chosen?.type).toBe("task_due");
    expect(decideProactive({ ...busy, localHour: 18, exams: [{ id: "e1", title: "OS exam", daysUntil: 1 }] }, gates()).chosen?.type).toBe("exam_countdown");
    expect(decideProactive({ ...busy, daysSinceLastSession: 3 }, gates()).chosen?.type).toBe("missed_plan_recovery");
  });

  it("is one of the day's pushes: it waits for their window, and is not sent after another push or once they have studied", () => {
    const f = facts({ tasksDueToday: due, hasPlan: false });
    expect(decideProactive({ ...f, localHour: 11 }, gates()).suppressed).toEqual([{ type: "task_due", reason: "outside_window" }]);
    expect(decideProactive(f, gates({ sentToday: [{ type: "review_due", at: new Date("2026-10-14T06:00:00Z") }], lastSentAt: new Date("2026-10-14T06:00:00Z") })).chosen).toBeNull();
    expect(decideProactive({ ...f, studiedToday: true }, gates()).chosen).toBeNull();
    expect(decideProactive(f, gates({ realityCategories: ["life_constraint"] })).chosen).toBeNull();
  });

  it("no task due today, an absent list, or nothing but overdue ones: no such reason", () => {
    for (const tasksDueToday of [[], undefined]) {
      expect(generateCandidates(facts({ tasksDueToday })).some(c => c.type === "task_due")).toBe(false);
    }
    // Overdue tasks never reach the facts: the tick passes only dueInDays === 0.
    expect(read("proactive/nova-proactive-cron.ts")).toContain('filter(t => t.status !== "done" && t.dueInDays === 0)');
  });

  it("the message names the task and carries no recommended topic and no Start button", () => {
    const cron = read("proactive/nova-proactive-cron.ts");
    expect(cron).toContain('const rec    = quiet || type === "task_due" ? null : view.recommendation;');
    expect(cron).toContain("listTasks(profile.id, { now }).catch(() => null),");
    expect(cron).not.toContain("prisma.novaTask");
    const input: ProactiveWordingInput = { type: "task_due", studentName: "Asha", facts: ['Your task "Finish OS assignment 3" is due today'], register: "steady", operatingStyle: [], hasStartButton: false };
    expect(proactiveFallback(input)).toBe('Due today. Your task "Finish OS assignment 3" is due today.');
  });

  it("the model is told it is their task and to recommend nothing", async () => {
    let prompt = "";
    await wordProactiveMessage(
      { type: "task_due", studentName: null, facts: ['Your task "A" is due today'], register: "steady", operatingStyle: [], hasStartButton: false },
      async req => { prompt = req.prompt; return "Your task A is due today."; },
    );
    expect(prompt).toContain("Reason for the message: task_due");
    expect(prompt).toContain("do not recommend a topic");
    expect(prompt).not.toContain("A Start button is attached");
  });

  it("finishing it, or moving its date, removes the reason", () => {
    const key = `task:t1:${DAY}`;
    expect(generateCandidates(facts({ tasksDueToday: due })).some(c => c.occurrenceKey === key)).toBe(true);
    expect(generateCandidates(facts({ tasksDueToday: [] })).some(c => c.occurrenceKey === key)).toBe(false);
  });
});

// ── Every message has a reason on record and something to act on ──────────────

describe("no message without a current reason", () => {
  it("with nothing on record, nothing is a candidate", () => {
    expect(generateCandidates(facts({ hasPlan: false, studiedToday: true }))).toEqual([]);
    expect(decideProactive(facts({ hasPlan: false, studiedToday: true }), gates())).toEqual({ chosen: null, informOnly: false, suppressed: [] });
  });

  it("the usual-time nudge exists only with a planned block to point at, and never once they have studied", () => {
    // The decision on daily_nudge: kept. It is not a generic nudge, because it
    // is sent only when the plan has a block for today, names that block and
    // carries its Start button, at most once a day.
    expect(generateCandidates(facts({ hasPlan: false })).some(c => c.type === "daily_nudge")).toBe(false);
    expect(generateCandidates(facts({ hasPlan: true, studiedToday: true })).some(c => c.type === "daily_nudge")).toBe(false);
    expect(generateCandidates(facts({ hasPlan: true })).map(c => c.type)).toEqual(["daily_nudge"]);
    const cron = read("proactive/nova-proactive-cron.ts");
    expect(cron).toContain("if (rec)   lines.push(`Recommended now: ${rec.topicName} (${rec.subjectName}), ${rec.durationMinutes} min");
    expect(cron).toContain("const spec: PromptSpec | null = rec ? recommendationReply(view, rec, { kind: \"nudge\" }).prompt ?? null : null;");
  });

  it("every reason has an instruction and a plain line of its own", () => {
    const response = read("proactive/nova-proactive-response.ts");
    for (const type of ALL) {
      expect([type, response.split(`${type}:`).length - 1]).toEqual([type, 2]);
      const line = proactiveFallback({ type, studentName: null, facts: ["A fact"], register: "steady", operatingStyle: [], hasStartButton: false });
      expect(line.endsWith("A fact.")).toBe(true);
    }
  });

  it("every occurrence key names the thing and the day (or the lapse), so a second tick cannot repeat it", () => {
    const all = generateCandidates(facts({
      exams: [{ id: "e1", title: "OS exam", daysUntil: 2 }], daysSinceLastSession: 3, reviewDueCount: 2,
      tasksDueToday: [{ id: "t1", title: "A" }],
    }));
    expect(all.map(c => c.occurrenceKey)).toEqual([`exam:e1:${DAY}`, "recovery:2026-10-13", `task:t1:${DAY}`, `review:${DAY}`, `nudge:${DAY}`]);
    expect(new Set(all.map(c => c.occurrenceKey)).size).toBe(all.length);
    expect(generateCandidates(facts({ exams: [{ id: "e1", title: "OS exam", daysUntil: 2 }], daysSinceLastSession: 3, reviewDueCount: 2, tasksDueToday: [{ id: "t1", title: "A" }] })))
      .toEqual(all);
  });

  it("the gates silence every reason alike: quiet hours, a running session, a pause, the daily cap", () => {
    const f = facts({ tasksDueToday: [{ id: "t1", title: "A" }], reviewDueCount: 1, exams: [{ id: "e1", title: "OS exam", daysUntil: 1 }] });
    const blocked = (g: Partial<ProactiveGates>, over: Partial<ProactiveFacts> = {}) => decideProactive({ ...f, ...over }, gates(g)).suppressed;
    expect(blocked({}, { localHour: 23, localMinute: 30 })).toEqual([{ type: "all", reason: "quiet_hours" }]);
    expect(blocked({ activeSession: true })).toEqual([{ type: "all", reason: "session_running" }]);
    expect(blocked({ paused: true })).toEqual([{ type: "all", reason: "paused_by_learner" }]);
    expect(blocked({ proactiveEnabled: false })).toEqual([{ type: "all", reason: "proactive_disabled" }]);
    expect(blocked({ sentToday: [{ type: "exam_countdown", at: NOW }, { type: "review_due", at: NOW }] })).toEqual([{ type: "all", reason: "daily_cap" }]);
    for (const type of ALL) expect(holdReason(type, { ...f, localHour: 2, localMinute: 0 }, gates())).toBe("quiet_hours");
  });
});

// ── A reason that has gone takes its message with it ──────────────────────────

describe("a message whose reason is gone is not sent, worded or not", () => {
  const cron   = read("proactive/nova-proactive-cron.ts");
  const outbox = read("proactive/proactive-outbox.ts");
  const recover = cron.slice(cron.indexOf("const pending = await recoverPending"), cron.indexOf("const decision = decideProactive"));

  it("the waiting message's reason is looked for again before anything is sent", () => {
    const check = recover.indexOf("generateCandidates(facts).find(c => c.occurrenceKey === waiting.occurrenceKey)");
    expect(check).toBeGreaterThan(recover.indexOf("holdReason(waiting.type as ProactiveType, facts, gates)"));
    expect(check).toBeLessThan(recover.indexOf("return await deliver("));
    expect(recover).toContain("if (waiting.text) await dropStale(waiting.id); else await dropUnworded(waiting.id);");
  });

  it("a worded one is closed by a guarded write, and only while it has not gone out", () => {
    const drop = outbox.slice(outbox.indexOf("export async function dropStale"), outbox.indexOf("// Work a restart or a failed send left behind"));
    expect(drop).toContain('where: { id, status: { in: ["ready", "failed"] } },');
    expect(drop).toContain('data:  { status: "abandoned", lastError: "reason no longer holds" },');
    expect(drop).not.toContain("delete");
  });

  it("the outbox is still the only writer of proactive messages", () => {
    expect(cron).not.toContain("prisma.novaProactiveMessage");
  });
});
