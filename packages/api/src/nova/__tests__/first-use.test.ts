// The first message in a newly connected Telegram chat: what it is about is
// decided from the Today view, and only reworded by the model. No database.

const generateOpenAIText = jest.fn();
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: (...args: unknown[]) => generateOpenAIText(...args) }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wordFirstUse } from "../brains/first-use-wording";
import { decideFirstUse } from "../interaction/first-use";
import type { NovaTodayReady, TodayAction } from "../product/today.types";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

const block = (topicName: string, over: Partial<TodayAction> = {}): TodayAction =>
  ({ topicName, subjectName: "Operating Systems", activityType: "review", durationMinutes: 30, urgency: "high", reasons: ["exam in 8 days", "mastery 38%"], rationale: "", ...over });
const view = (over: Partial<NovaTodayReady> = {}): NovaTodayReady => ({
  status: "ready", generatedAt: "", learnerName: null, goals: [], subjects: ["Operating Systems"], availableMinutes: null,
  recommendation: block("Processes"), emptyReason: null, alternatives: [],
  activeSession: null, nextDeadline: null, upcoming: [], weakArea: null, reviewDue: { count: 0, topics: [] }, constraints: [],
  progress: { sessionsThisWeek: 0, minutesThisWeek: 0, streakDays: 0, daysSinceLastSession: null, lastSession: null },
  plan: { mode: "standard", blockCount: 1, totalMinutesToday: 30, budgetMinutes: 180, budgetBasis: "preferred", assumptions: [] },
  ...over,
});
const exam = { title: "OS exam", subjectName: "Operating Systems", examType: "exam", scheduledAt: "", daysUntil: 8 };
const word = (decision: ReturnType<typeof decideFirstUse>, register: "serious" | "steady" | "playful" = "steady") =>
  wordFirstUse({ decision, studentName: "Asha", register, operatingStyle: [], hasButtons: decision.block !== null });

beforeEach(() => generateOpenAIText.mockReset());

describe("what the first message is about", () => {
  it("the plan's first block, and why", () => {
    const d = decideFirstUse(view(), null);
    expect(d.kind).toBe("recommend");
    expect(d.block!.topicName).toBe("Processes");
    expect(d.fallback).toBe("You're set.\n\nProcesses is first on your plan: 30 min. Why: exam in 8 days, mastery 38%.\n\nOr just tell me what's going on.");
  });
  it("names an exam only when one is on record", () => {
    expect(decideFirstUse(view(), null).facts.join(" ")).not.toMatch(/exam:/i);
    const d = decideFirstUse(view({ nextDeadline: exam }), null);
    expect(d.facts).toContain("Next exam: OS exam, in 8 days.");
    expect(d.fallback).toContain("OS exam is in 8 days, and Processes is first on your plan: 30 min.");
  });
  it("mentions the time they have only when they have said it", () => {
    expect(decideFirstUse(view(), null).facts.join(" ")).not.toMatch(/Time they said/);
    expect(decideFirstUse(view({ availableMinutes: 40 }), null).facts).toContain("Time they said they have today: 40 min.");
  });
  it("a running session is the subject, not a new recommendation", () => {
    const d = decideFirstUse(view({ activeSession: { id: "s", topicName: "Paging", subjectName: "Operating Systems", status: "in_progress", startedAt: "", elapsedMinutes: 12, plannedDurationMinutes: 25 } }), null);
    expect([d.kind, d.block]).toEqual(["session", null]);
    expect(d.fallback).toBe("You're connected. You have a session running on Paging: 12 min so far.");
    expect(d.facts.join(" ")).not.toContain("Processes");
  });
  it.each(["health", "injury", "emotional"])("%s on record: no study is pushed", category => {
    const d = decideFirstUse(view({ nextDeadline: exam, constraints: [{ category, subtype: null, description: "Student has the flu", expiresAt: null }] }), null);
    expect([d.kind, d.block]).toEqual(["hold", null]);
    expect(d.fallback).toBe("You're connected. You told me: Student has the flu. Nothing from me to push today. I'm here when you want to talk.");
    expect(d.facts.join(" ")).not.toContain("Processes");
    expect(d.instruction).toContain("Do not suggest studying or a session.");
  });
  it("a standing arrangement such as a job does not silence the recommendation", () => {
    const d = decideFirstUse(view({ constraints: [{ category: "life_constraint", subtype: "work", description: "Student has a part-time job", expiresAt: null }] }), null);
    expect(d.kind).toBe("recommend");
    expect(d.facts).toContain("On record: Student has a part-time job");
  });
  it("nothing to plan from: the one missing thing, as it is written", async () => {
    const d = decideFirstUse(view({ recommendation: null, emptyReason: "no_topics" }), { gap: "topics", question: "What does Operating Systems cover this term?" });
    expect(d.kind).toBe("setup");
    expect(d.fallback).toBe("You're connected. I have nothing to plan from yet. What does Operating Systems cover this term?");
    expect(await word(d)).toEqual({ text: d.fallback, generated: false });
    expect(generateOpenAIText).not.toHaveBeenCalled();
  });
  it("nothing pressing: says so and invites them to talk", () => {
    const d = decideFirstUse(view({ recommendation: null, emptyReason: "nothing_due" }), null);
    expect(d.kind).toBe("open");
    expect(d.fallback).toBe("You're connected. Nothing is due today and no exam is close. Tell me what you want to work on, or what's going on.");
  });
  it("never teaches a command", () => {
    const views = [view(), view({ nextDeadline: exam }), view({ recommendation: null, emptyReason: "nothing_due" }), view({ recommendation: null, emptyReason: "recovery" })];
    for (const v of views) expect(decideFirstUse(v, null).fallback).not.toMatch(/\/[a-z]+/);
  });
});

describe("wording it", () => {
  it("gives the model the facts, the register and nothing else of the learner's", async () => {
    generateOpenAIText.mockResolvedValue("Yo, you're set.\n\nOS exam in 8 days; Processes is the move.");
    const d = decideFirstUse(view({ nextDeadline: exam }), null);
    const out = await word(d, "playful");
    expect(out).toEqual({ text: "Yo, you're set.\n\nOS exam in 8 days; Processes is the move.", generated: true });
    const request = generateOpenAIText.mock.calls[0]![0] as { systemInstruction: string; prompt: string };
    for (const fact of d.facts) expect(request.systemInstruction).toContain(fact);
    expect(request.prompt).toContain("Register: playful");
    expect(request.prompt).toContain("Do not mention commands");
    expect(request.prompt).toContain("Buttons for the next step are attached");
  });
  it("falls back to the plain message when the model fails, returns nothing, or teaches a command", async () => {
    const d = decideFirstUse(view(), null);
    generateOpenAIText.mockRejectedValueOnce(new Error("quota"));
    expect(await word(d)).toEqual({ text: d.fallback, generated: false });
    generateOpenAIText.mockResolvedValueOnce("   ");
    expect((await word(d)).generated).toBe(false);
    generateOpenAIText.mockResolvedValueOnce("Connected! Use /today to see your plan.");
    expect(await word(d)).toEqual({ text: d.fallback, generated: false });
    generateOpenAIText.mockResolvedValueOnce('{"reply":"You\'re set. Processes first."}');
    expect(await word(d)).toEqual({ text: "You're set. Processes first.", generated: true });
  });
  it("a hold is worded in the serious register and asked not to push", async () => {
    generateOpenAIText.mockResolvedValue("You're connected. Rest up.");
    const d = decideFirstUse(view({ constraints: [{ category: "health", subtype: "illness", description: "Student has the flu", expiresAt: null }] }), null);
    await word(d, "serious");
    const request = generateOpenAIText.mock.calls[0]![0] as { prompt: string };
    expect(request.prompt).toContain("Register: serious");
    expect(request.prompt).toContain("Do not suggest studying or a session.");
  });
});

describe("where it is sent from", () => {
  const route = readFileSync(join(__dirname, "../../../../../apps/api/app/api/telegram/route.ts"), "utf8");
  const turn  = read("telegram/telegram-turn.ts");
  it("the webhook greets a linked Nova chat through the Telegram turn, after the link is committed", () => {
    const linked = route.indexOf("const link = await linkTelegramChat(");
    const greet  = route.indexOf('{ kind: "command", command: "start", argument: ""');
    expect(linked).toBeGreaterThan(-1);
    expect(greet).toBeGreaterThan(linked);
    expect(route.slice(linked, greet)).toContain('if (link.status !== "linked") {');
    expect(route).not.toMatch(/NOVA_LINK_GREETING|tells you what to do now/);
  });
  it("a replayed update is dropped before linking or greeting", () => {
    expect(route.indexOf("admitTelegramUpdate(")).toBeLessThan(route.indexOf("handleTelegramConnectStart(text"));
  });
  it("the greeting is claimed once per chat, and given back if it was not delivered", () => {
    expect(turn).toContain("const first = await claimFirstUse(profile.id, now);");
    expect(turn).toContain('if (trace.send.status !== "sent") await releaseFirstUse(profile.id, now);');
    expect(read("telegram/channel-store.ts")).toContain("where: { profileId, lastDeliveredAt: null }, data: { lastDeliveredAt: now }");
  });
  it("it writes no session, plan or mastery of its own", () => {
    for (const file of ["interaction/first-use.ts", "brains/first-use-wording.ts"]) {
      expect(read(file)).not.toMatch(/@repo\/db|prisma|runNovaSessionCommand|updateTopicMastery/);
    }
  });
  it("no reply text in the Telegram surface opens with a command tutorial any more", () => {
    expect(read("telegram/telegram-replies.ts")).not.toMatch(/linked:/);
    expect(read("telegram/telegram-link.ts")).not.toMatch(/\/today|which year/);
  });
});
