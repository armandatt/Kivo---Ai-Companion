// Rules that keep Nova one system from signup onward: who a learner is,
// what a web sentence may do, how days are counted, and when a delayed
// proactive message may still go out. Pure code only; the database side is
// in __integration__/nova-lifecycle.itest.ts.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isWebLearnerId, learnerKey, webAccountOf, webLearnerId } from "../product/learner-key";
import { calendarDaysUntil } from "../engines/learner-calendar";
import { holdReason, type ProactiveFacts, type ProactiveGates } from "../decision/proactive-decision";
import { subjectsNamedIn } from "../engines/topic-mastery-engine";
import { chooseRegister } from "../decision/register";

const NOVA = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(NOVA, path), "utf8");

describe("one name for a learner", () => {
  it("a Telegram chat id and a web account's id cannot be mistaken for each other", () => {
    expect(learnerKey("123456789")).toEqual({ platform_platformChatId: { platform: "telegram", platformChatId: "123456789" } });
    expect(learnerKey(webLearnerId("usr_1"))).toEqual({ platform_platformChatId: { platform: "web", platformChatId: "web:usr_1" } });
    expect([isWebLearnerId("123456789"), isWebLearnerId("-100123"), isWebLearnerId("web:usr_1")]).toEqual([false, false, true]);
    expect([webAccountOf("web:usr_1"), webAccountOf("123456789")]).toEqual(["usr_1", null]);
  });

  it("no Nova product function looks a learner up as a Telegram chat on its own", () => {
    for (const file of [
      "nova-orchestrator.ts", "engines/study-snapshot.ts", "onboarding/nova-onboarding-orchestrator.ts",
      "product/knowledge.ts", "product/planning-inputs.ts", "product/learning-dna.ts", "product/progress.ts",
      "product/session.ts", "product/exams.ts", "product/notes.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("learnerKey(");
      expect(source).not.toContain('platform: "telegram"');
    }
  });

  it("Nova only ever messages first on Telegram", () => {
    expect(read("proactive/nova-proactive-cron.ts")).toContain('user: { persona: "nova", platform: "telegram" }');
  });
});

describe("a sentence typed on the web is not a session command", () => {
  const entry = read("entry.ts");
  it("only a typed command lets the turn run session commands", () => {
    expect(entry).toContain('...(command ? {} : { sessionCommands: "surface" as const, directive: SENTENCE_RUNS_NO_SESSION })');
  });
  it("the reply is told nothing was started or ended", () => {
    expect(entry).toContain("did not start, pause, resume or end a study session");
  });
});

describe("days until an exam are the learner's calendar days", () => {
  const exam = new Date("2026-10-08T12:00:00.000Z");       // the 8th, wherever you are
  it.each([
    ["the morning before, 30 hours away", "2026-10-07T02:30:00.000Z", "Asia/Kolkata", 1],
    ["late the night before, 18 hours away", "2026-10-07T18:00:00.000Z", "Asia/Kolkata", 1],   // 23:30 on the 7th in Kolkata
    ["just past midnight on the day",     "2026-10-07T19:00:00.000Z", "Asia/Kolkata", 0],   // 00:30 on the 8th in Kolkata
    ["the same morning, 5 hours away",    "2026-10-08T07:00:00.000Z", "Europe/London", 0],
    ["two days before, late evening",     "2026-10-06T17:00:00.000Z", "Asia/Kolkata", 2],
    ["two days before, US evening",       "2026-10-07T03:00:00.000Z", "America/Los_Angeles", 2],
    ["after it",                          "2026-10-09T09:00:00.000Z", "Asia/Kolkata", 0],
  ])("%s", (_name, now, zone, days) => {
    expect(calendarDaysUntil(exam, new Date(now), zone)).toBe(days);
  });
  it("an unknown timezone counts in UTC, and never throws", () => {
    expect(calendarDaysUntil(exam, new Date("2026-10-07T02:30:00.000Z"), null)).toBe(1);
    expect(calendarDaysUntil(exam, new Date("2026-10-07T02:30:00.000Z"), "Not/AZone")).toBe(1);
  });
  it("Today and the Planner count that way", () => {
    for (const file of ["product/today.ts", "product/planner.ts"]) {
      expect(read(file)).toContain("calendarDaysUntil(e.scheduledAt, now");
      expect(read(file)).not.toContain("Math.ceil((e.scheduledAt.getTime() - now.getTime())");
    }
  });
});

describe("a proactive message approved earlier is checked again before it is sent", () => {
  const now = new Date("2026-10-06T12:30:00.000Z");
  const facts: ProactiveFacts = {
    localDay: "2026-10-06", localHour: 18, window: { from: 18, to: 21, basis: "stated" },
    studiedToday: false, daysSinceLastSession: 1, lastSessionDay: "2026-10-05",
    exams: [], reviewDueCount: 1, hasPlan: true,
  };
  const gates: ProactiveGates = {
    proactiveEnabled: true, paused: false, undeliverable: false, hasTimezone: true,
    activeSession: false, messagedRecently: false, sentToday: [], lastSentAt: null, realityCategories: [], now,
  };

  it("goes out when nothing has changed", () => {
    expect(holdReason("review_due", facts, gates)).toBeNull();
    expect(holdReason("exam_countdown", { ...facts, localHour: 10 }, gates)).toBeNull();
  });

  it.each([
    ["they started studying",      {}, { activeSession: true },                    "session_running"],
    ["they said not today",        {}, { paused: true },                           "paused_by_learner"],
    ["they fell ill",              {}, { realityCategories: ["health"] },          "health_constraint"],
    ["something came up",          {}, { realityCategories: ["life_constraint"] }, "reality_constraint"],
    ["they are typing to Nova",    {}, { messagedRecently: true },                 "learner_active_in_chat"],
    ["they switched nudges off",   {}, { proactiveEnabled: false },                "proactive_disabled"],
    ["it is now night for them",   { localHour: 23 }, {},                          "quiet_hours"],
    ["they have studied since",    { studiedToday: true }, {},                     "studied_today"],
    ["their window has closed",    { localHour: 22 }, {},                          "outside_window"],
  ] as Array<[string, Partial<ProactiveFacts>, Partial<ProactiveGates>, string]>)("held when %s", (_name, f, g, reason) => {
    expect(holdReason("review_due", { ...facts, ...f }, { ...gates, ...g })).toBe(reason);
  });

  it("the tick asks before every retry, and records why it held", () => {
    const cron = read("proactive/nova-proactive-cron.ts");
    expect(cron).toContain("holdReason(waiting.type as ProactiveType, facts, gates)");
    // …and before the stored message is handed to delivery.
    expect(cron.indexOf("holdReason(waiting.type")).toBeLessThan(cron.indexOf("return deliver(waiting"));
    expect(cron).toContain('outcome: "held"');
  });
});

describe("naming a subject", () => {
  const subjects = [{ id: "os", name: "Operating Systems", code: "CS301" }, { id: "db", name: "Databases", code: null }];
  it("finds a subject by name, code or acronym as whole words, and nothing in a label that names none", () => {
    expect(subjectsNamedIn("OS exam", subjects).map(s => s.id)).toEqual(["os"]);
    expect(subjectsNamedIn("cs301 midterm", subjects).map(s => s.id)).toEqual(["os"]);
    expect(subjectsNamedIn("databases final", subjects).map(s => s.id)).toEqual(["db"]);
    expect(subjectsNamedIn("exam", subjects)).toEqual([]);
    expect(subjectsNamedIn("cost accounting", subjects)).toEqual([]);     // "os" inside a word is not OS
    expect(subjectsNamedIn("", subjects)).toEqual([]);
  });
});

describe("register: a learner who asked to be pushed is still not teased when it would land badly", () => {
  const hard = { daysUntilNextExam: null, activeReality: [], accountability: "hard" as const };
  it("playful needs their explicit choice and nothing heavy", () => {
    expect(chooseRegister({ ...hard, emotion: "neutral" })).toBe("playful");
    expect(chooseRegister({ ...hard, emotion: "avoidant" })).toBe("playful");
    expect(chooseRegister({ ...hard, emotion: "neutral", accountability: "soft" })).toBe("steady");
    expect(chooseRegister({ ...hard, emotion: "neutral", accountability: null })).toBe("steady");
  });
  it.each(["frustrated", "distressed", "overwhelmed", "discouraged", "self_doubt", "identity_threat", "anxious_exam", "anxious_general"] as const)("never playful when they are %s", emotion => {
    expect(chooseRegister({ ...hard, emotion })).toBe("serious");
  });
  it("never playful with an exam within three days or a real constraint", () => {
    expect(chooseRegister({ ...hard, emotion: "neutral", daysUntilNextExam: 3 })).toBe("serious");
    for (const reality of ["health", "injury", "emotional", "life_constraint"]) {
      expect(chooseRegister({ ...hard, emotion: "neutral", activeReality: [reality] })).toBe("serious");
    }
  });
});
