// The daily check-in: what the time chosen in onboarding means, when a
// check-in is due and when it has expired, what silences it, and that it is
// one more reason in the proactive decision, not a second scheduler.
// Also here, because the same audit found them: the tone the learner chose,
// replies in Devanagari Hindi, and an exam's reason staying with its subject.
// Pure functions and source checks; the database side is in
// __integration__/nova-checkin.itest.ts.

// No model is called from here: the wording tests pass their own stand-in.
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: async () => { throw new Error("no model in unit tests"); } }));
jest.mock("@repo/db/client", () => ({ prisma: {} }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHECKIN_WINDOW_MINUTES, MAX_PER_DAY, decideProactive, generateCandidates, holdReason, inCheckinWindow, isQuietFor,
  parseCheckinTime, type ProactiveFacts, type ProactiveGates,
} from "../decision/proactive-decision";
import { chooseRegister, registerLine } from "../decision/register";
import { localHour, localMinute } from "../engines/learner-calendar";
import { examCoversSubject, selectActiveExam } from "../engines/exam-engine";
import { generateStudyPlan } from "../engines/planning-engine";
import { computeAcademicState } from "../engines/academic-state-engine";
import { reasonsFor } from "../product/today";
import { languageLine, scriptLanguage } from "../interaction/language";
import { languageOf, parseUnderstandingResponse } from "../brains/understanding-parser";
import { faithful } from "../brains/language-wording";
import { proactiveFallback, wordProactiveMessage, type ProactiveWordingInput } from "../proactive/nova-proactive-response";
import { settingsReply, textFor, isFixedText } from "../telegram/telegram-replies";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const NOVA = join(__dirname, "..");
const REPO = join(NOVA, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(NOVA, path), "utf8");
const repo = (path: string) => readFileSync(join(REPO, path), "utf8");

const now = new Date("2026-10-06T06:00:00Z");
const at = (hour: number, minute = 0) => ({ localHour: hour, localMinute: minute });
const facts = (over: Partial<ProactiveFacts> = {}): ProactiveFacts => ({
  localDay: "2026-10-06", ...at(11), checkinMinute: 11 * 60,
  window: { from: 11, to: 14, basis: "chosen" },
  studiedToday: false, daysSinceLastSession: 1, lastSessionDay: "2026-10-05",
  exams: [], reviewDueCount: 0, hasPlan: true, ...over,
});
const gates = (over: Partial<ProactiveGates> = {}): ProactiveGates => ({
  proactiveEnabled: true, paused: false, undeliverable: false, hasTimezone: true, activeSession: false,
  messagedRecently: false, sentToday: [], lastSentAt: null, realityCategories: [], now, ...over,
});
const chosen = (f: Partial<ProactiveFacts> = {}, g: Partial<ProactiveGates> = {}) => decideProactive(facts(f), gates(g)).chosen?.type ?? null;
const why    = (f: Partial<ProactiveFacts> = {}, g: Partial<ProactiveGates> = {}) => decideProactive(facts(f), gates(g)).suppressed.map(s => `${s.type}:${s.reason}`);

describe("the time chosen in onboarding", () => {
  it("is read as a clock time, however the browser wrote it", () => {
    expect(parseCheckinTime("11:00")).toBe(660);
    expect(parseCheckinTime("08:05")).toBe(485);
    expect(parseCheckinTime("8:5")).toBe(485);
    expect(parseCheckinTime(" 23:59 ")).toBe(1439);
    expect(parseCheckinTime("00:00")).toBe(0);
    expect(parseCheckinTime("07:30:00")).toBe(450);
  });

  it("is nothing when it is not a time, so the scheduler never guesses one", () => {
    for (const raw of [null, undefined, "", "morning", "24:00", "11:60", "11", "11:", ":30", "1e1:00", "-1:00", "11:00pm", "११:००", "11.30", "111:00"]) {
      expect([raw, parseCheckinTime(raw as string)]).toEqual([raw, null]);
    }
  });
});

describe("when a check-in is due", () => {
  it("is due from the chosen minute, not before", () => {
    expect(chosen(at(10, 59))).toBeNull();
    expect(why(at(10, 59))).toEqual(["daily_checkin:outside_window"]);
    expect(chosen(at(11, 0))).toBe("daily_checkin");
    expect(decideProactive(facts(), gates()).chosen!.occurrenceKey).toBe("checkin:2026-10-06");
  });

  it("stays due for the whole window, so a late tick still delivers it", () => {
    expect(CHECKIN_WINDOW_MINUTES).toBe(180);
    for (const [h, m] of [[11, 5], [11, 55], [12, 30], [13, 59]] as const) expect([h, m, chosen(at(h, m))]).toEqual([h, m, "daily_checkin"]);
  });

  it("expires at the end of the window and is not sent late", () => {
    expect(chosen(at(14, 0))).toBeNull();
    expect(chosen(at(19, 0))).toBeNull();
    // A check-in claimed earlier and never delivered is held, not sent, once expired.
    expect(holdReason("daily_checkin", facts(at(14, 0)), gates())).toBe("outside_window");
    expect(holdReason("daily_checkin", facts(at(13, 30)), gates())).toBeNull();
  });

  it("honours a time to the minute, including half-hour times", () => {
    const f = { checkinMinute: 18 * 60 + 30, window: { from: 18, to: 21, basis: "chosen" as const } };
    expect(chosen({ ...f, ...at(18, 29) })).toBeNull();
    expect(chosen({ ...f, ...at(18, 30) })).toBe("daily_checkin");
    expect(chosen({ ...f, ...at(21, 29) })).toBe("daily_checkin");
    expect(chosen({ ...f, ...at(21, 30) })).toBeNull();
  });

  it("never runs past midnight: one local day holds one check-in", () => {
    const f = { checkinMinute: 22 * 60 + 30 };
    expect(inCheckinWindow(facts({ ...f, ...at(23, 59) }))).toBe(true);
    expect(inCheckinWindow(facts({ ...f, ...at(0, 10), localDay: "2026-10-07" }))).toBe(false);
  });

  it("does not need a plan: a learner with nothing planned is still checked in on", () => {
    expect(chosen({ hasPlan: false })).toBe("daily_checkin");
    // Without a chosen time there is no check-in, and the nudge still needs a plan.
    expect(chosen({ hasPlan: false, checkinMinute: null, window: { from: 9, to: 12, basis: "stated" } })).toBeNull();
  });

  it("takes the place of the study-window nudge instead of adding to it", () => {
    const types = generateCandidates(facts()).map(c => c.type);
    expect(types).toEqual(["daily_checkin"]);
    // Their stated study window no longer times anything once they chose a time.
    expect(chosen({ ...at(19), reviewDueCount: 2 })).toBeNull();
    expect(chosen({ ...at(11, 20), reviewDueCount: 2 })).toBe("review_due");
  });

  it("is used whatever the server's clock is: only the learner's local time is asked", () => {
    // 05:30 UTC is 11:00 in Kolkata and 11:15 in Kathmandu.
    const instant = new Date("2026-10-06T05:30:00Z");
    expect([localHour(instant, "Asia/Kolkata"), localMinute(instant, "Asia/Kolkata")]).toEqual([11, 0]);
    expect([localHour(instant, "Asia/Kathmandu"), localMinute(instant, "Asia/Kathmandu")]).toEqual([11, 15]);
    expect([localHour(instant, "America/New_York"), localMinute(instant, "America/New_York")]).toEqual([1, 30]);
    const cron = read("proactive/nova-proactive-cron.ts");
    expect(cron).not.toMatch(/getHours\(\)|getMinutes\(\)|getUTCHours\(\)|toLocaleTimeString/);
    expect(cron).toContain("localMinute(now, zone)");
  });
});

describe("what silences a check-in, and only for as long as it should", () => {
  it("is not sent to a learner who has already studied today", () => {
    expect(generateCandidates(facts({ studiedToday: true }))).toEqual([]);
  });

  it("is not sent on top of a conversation the learner already started", () => {
    expect(chosen({}, { messagedSinceCheckin: true })).toBeNull();
    expect(why({}, { messagedSinceCheckin: true })).toEqual(["daily_checkin:learner_already_here"]);
    // Writing before the check-in time does not count against it.
    expect(chosen({}, { messagedSinceCheckin: false })).toBe("daily_checkin");
  });

  it("waits while they are mid-conversation or mid-session, and goes out later in the window", () => {
    expect(why({}, { messagedRecently: true })).toEqual(["all:learner_active_in_chat"]);
    expect(why({}, { activeSession: true })).toEqual(["all:session_running"]);
    expect(chosen(at(12, 10))).toBe("daily_checkin");
  });

  it("is sent once a day, and counts as the day's one push to study", () => {
    const sent = [{ type: "daily_checkin", at: new Date(now.getTime() - 5 * 3_600_000) }];
    expect(chosen(at(13, 0), { sentToday: sent, lastSentAt: sent[0]!.at })).toBeNull();
    // A nudge sent earlier the same day means no check-in on top of it.
    const nudged = [{ type: "review_due", at: new Date(now.getTime() - 5 * 3_600_000) }];
    expect(why({}, { sentToday: nudged, lastSentAt: nudged[0]!.at })).toEqual(["daily_checkin:already_nudged_today"]);
    expect(MAX_PER_DAY).toBe(2);
  });

  it("respects off, paused, an unreachable chat, and illness", () => {
    expect(why({}, { proactiveEnabled: false })).toEqual(["all:proactive_disabled"]);
    expect(why({}, { paused: true })).toEqual(["all:paused_by_learner"]);
    expect(why({}, { undeliverable: true })).toEqual(["all:chat_undeliverable"]);
    expect(why({}, { realityCategories: ["health"] })).toEqual(["all:health_constraint"]);
    expect(why({}, { realityCategories: ["life_constraint"] })).toEqual(["daily_checkin:reality_constraint"]);
  });

  it("is sent at an early or late time the learner picked, though Nova never picks one", () => {
    const early = { checkinMinute: 6 * 60 + 30, window: { from: 6, to: 9, basis: "chosen" as const } };
    expect(isQuietFor(facts({ ...early, ...at(6, 0) }))).toBe(true);
    expect(chosen({ ...early, ...at(6, 30) })).toBe("daily_checkin");
    // The same hour for a learner who chose no time is still quiet.
    expect(why({ checkinMinute: null, ...at(6, 30), window: { from: 6, to: 9, basis: "stated" } })).toEqual(["all:quiet_hours"]);
    expect(chosen({ checkinMinute: 23 * 60 + 15, ...at(23, 20) })).toBe("daily_checkin");
  });

  it("yields to an exam countdown, which is information, in the same window", () => {
    expect(chosen({ exams: [{ id: "e1", title: "OS final", daysUntil: 1 }] })).toBe("exam_countdown");
  });
});

describe("a learner who chose no time is nudged as before", () => {
  const none = { checkinMinute: null, window: { from: 18, to: 21, basis: "stated" as const } };
  it("in their study window, when there is a plan", () => {
    expect(chosen({ ...none, ...at(18) })).toBe("daily_nudge");
    expect(chosen({ ...none, ...at(11) })).toBeNull();
    expect(generateCandidates(facts({ ...none, ...at(18) })).map(c => c.occurrenceKey)).toEqual(["nudge:2026-10-06"]);
  });
  it("and facts written before the check-in existed still decide the same way", () => {
    const old: ProactiveFacts = { localDay: "2026-10-06", localHour: 18, window: { from: 18, to: 21, basis: "default" }, studiedToday: false, daysSinceLastSession: 1, lastSessionDay: "2026-10-05", exams: [], reviewDueCount: 0, hasPlan: true };
    expect(decideProactive(old, gates()).chosen?.type).toBe("daily_nudge");
  });
});

describe("the check-in message", () => {
  const input = (over: Partial<ProactiveWordingInput> = {}): ProactiveWordingInput => ({
    type: "daily_checkin", studentName: "Asha", facts: ["Recommended now: Deadlocks (Operating Systems), 25 min, because exam in 12 days"],
    register: "steady", operatingStyle: [], hasStartButton: true, ...over,
  });

  it("goes out as a plain line when the model is unavailable, with only what is on record", () => {
    expect(proactiveFallback(input())).toBe("Checking in. Recommended now: Deadlocks (Operating Systems), 25 min, because exam in 12 days.");
  });

  it("asks one question when nothing is planned, and invents no topic", () => {
    const text = proactiveFallback(input({ facts: ["Nothing is planned for today yet"], hasStartButton: false, asksWhatToday: true }));
    expect(text).toBe("Checking in. What are you working on today? Tell me how much time you have and I'll fit a session to it.");
  });

  it("tells the model what kind of message it is, the tone, and never that they failed to study", async () => {
    let prompt = "", system = "";
    const generate = (async (r: { prompt: string; systemInstruction: string }) => { prompt = r.prompt; system = r.systemInstruction; return "Deadlocks, 25 minutes."; }) as never;
    await wordProactiveMessage(input({ register: "gentle" }), generate);
    expect(prompt).toContain("Reason for the message: daily_checkin");
    expect(prompt).toContain("the daily check-in they asked for");
    expect(prompt).toContain("nothing recorded today is not a failure");
    expect(prompt).toContain("Register: gentle.");
    expect(system).toContain("Recommended now: Deadlocks");
    expect(`${prompt}${system}`).not.toContain("nothing done yet today");

    await wordProactiveMessage(input({ facts: ["Nothing is planned for today yet"], hasStartButton: false, asksWhatToday: true, register: "playful" }), generate);
    expect(prompt).toContain("Exactly one question.");
    expect(prompt).toContain("Recommend nothing and name no topic.");
    expect(prompt).toContain("Register: playful.");
  });

  it("falls back to the plain line when the model fails", async () => {
    const down = (async () => { throw new Error("429"); }) as never;
    expect(await wordProactiveMessage(input(), down)).toEqual({ text: proactiveFallback(input()), generated: false });
  });
});

describe("one scheduler, one outbox", () => {
  const cron = read("proactive/nova-proactive-cron.ts");

  it("the check-in is a reason in the existing decision, claimed and sent through the existing outbox", () => {
    expect(cron).toContain("decideProactive(facts, gates)");
    expect(cron).toContain("claimOccurrence(profile.id, decision.chosen");
    expect(cron).not.toMatch(/setInterval|setTimeout|cron\.schedule|node-cron/);
    expect(read("adapters/account-preferences-adapter.ts")).not.toMatch(/setInterval|setTimeout|novaProactiveMessage/);
  });

  it("no longer drops a learner silently for want of a timezone: it looks, adopts the account's, and counts the rest", () => {
    expect(cron).not.toContain("timezone: { not: null }");
    expect(cron).toContain("ensureLearnerTimezone(profile, chatId, account)");
    expect(cron).toContain('return "no_timezone"');
    expect(cron).toContain('tick: "done"');
  });

  it("reads the chosen time from the account and never from the server's idea of a schedule", () => {
    const adapter = read("adapters/account-preferences-adapter.ts");
    expect(adapter).toContain("preferredCheckInTime: true, timezone: true");
    expect(adapter).toContain("parseCheckinTime(account.preferredCheckInTime)");
    // The legacy fields onboarding also writes are computed in UTC and are not a schedule.
    expect(`${cron}${adapter}`).not.toMatch(/nextMessageTime|messageSchedule/);
  });

  it("adopts a timezone only while the learner has none", () => {
    const adapter = read("adapters/account-preferences-adapter.ts");
    expect(adapter).toContain("if (profile.timezone && isValidTimezone(profile.timezone)) return profile.timezone;");
    expect(adapter).toContain("OR: [{ timezone: null }, { timezone: profile.timezone }]");
  });

  it("connecting or reconnecting Telegram does not touch the check-in time or the tone", () => {
    expect(read("telegram/telegram-link.ts")).not.toMatch(/preferredCheckInTime|accountabilityStyle/);
    expect(read("telegram/telegram-turn.ts")).not.toMatch(/preferredCheckInTime|accountabilityStyle\s*:/);
  });

  it("a failed send is never recorded as sent, and one learner's failure does not stop the tick", () => {
    const deliver = cron.slice(cron.indexOf("async function deliver("));
    expect(deliver.indexOf("if (result.ok) {")).toBeLessThan(deliver.indexOf("markSent("));
    expect(deliver.slice(deliver.indexOf("// Not delivered"))).not.toContain("markSent(");
    expect(cron).toMatch(/catch \(err\) \{\s*\/\/ One learner's failure never stops the rest of the tick\./);
  });

  it("the health check says whether the timer is ticking and what the last tick did", () => {
    const scheduler = repo("apps/api/lib/internal-checkin-scheduler.ts");
    expect(scheduler).toContain("stale:");
    expect(scheduler).toContain("startedAt:");
    expect(scheduler).toContain("nova:");
    expect(repo("apps/api/lib/checkin-cron.ts")).toContain("outcomes: novaResult.outcomes");
  });

  it("the settings API stores only a real time, and the tone the way onboarding stores it", () => {
    const route = repo("apps/api/settings/route.ts");
    expect(route).toContain("parseCheckinTime(String(checkInTime))");
    expect(route).toContain('"Check-in time must be HH:MM"');
    expect(route).toContain("normalizeAccountability(String(accountabilityStyle))");
  });
});

describe("what Nova tells the learner about their check-in", () => {
  const state = { proactiveEnabled: true, pausedUntil: null, timezone: "Asia/Kolkata" };
  it("says the time, what it does and where to change it", () => {
    const text = settingsReply({ ...state, checkinTime: "11:00" }, now).text;
    expect(text).toContain("Daily check-in: around 11:00, your time, on days you haven't studied yet.");
    expect(text).toContain("Change it in Settings on the web.");
  });
  it("says so when no time is chosen, and when it cannot message first at all", () => {
    expect(settingsReply({ ...state, checkinTime: null }, now).text).toContain("no time chosen, so I nudge around your usual study time");
    expect(settingsReply({ ...state, timezone: null, checkinTime: "11:00" }, now).text).toContain("Timezone: not set, so I won't message first.");
  });
  it("the onboarding screen no longer promises a message it cannot be sure of", () => {
    const screen = repo("apps/web/components/onboarding-flow.tsx");
    expect(screen).not.toMatch(/tomorrow at/);
    expect(screen).toContain("Connect Telegram from Today when you want reminders and check-ins there.");
  });
});

describe("Gentle Nudges and No Mercy", () => {
  const base = { emotion: "neutral" as const, daysUntilNextExam: null, activeReality: [] };
  it("each has its own manner, and a learner who never chose gets neither", () => {
    expect(chooseRegister({ ...base, accountability: "soft" })).toBe("gentle");
    expect(chooseRegister({ ...base, accountability: "hard" })).toBe("playful");
    expect(chooseRegister({ ...base, accountability: null })).toBe("steady");
    expect(new Set(["gentle", "steady", "playful", "serious"].map(r => registerLine(r as never))).size).toBe(4);
  });

  it("No Mercy is firm and brief, and still may not shame, threaten or guess at motives", () => {
    const line = registerLine("playful");
    expect(line).toContain("direct, firm and brief");
    expect(line).toContain("lead with the next action");
    expect(line).toContain("No shaming, no threats, no guessing at their motives");
    expect(line).toContain("respect the time, energy and limits they have stated");
    // Challenging a delay needs evidence of one.
    expect(line).toContain("If the evidence above shows an avoidable delay");
  });

  it("Gentle Nudges is supportive without a pep talk, and never makes a gap a failure", () => {
    const line = registerLine("gentle");
    expect(line).toContain("Calm, supportive, never judging");
    expect(line).toContain("do not bring up the gap as a failure");
    expect(line).toContain("No pep talk, no teasing");
  });

  it("distress, a hard stretch or a close exam overrides both", () => {
    for (const accountability of ["hard", "soft", null] as const) {
      expect(chooseRegister({ ...base, accountability, emotion: "overwhelmed" })).toBe("serious");
      expect(chooseRegister({ ...base, accountability, emotion: "anxious_exam" })).toBe("serious");
      expect(chooseRegister({ ...base, accountability, activeReality: ["health"] })).toBe("serious");
      expect(chooseRegister({ ...base, accountability, daysUntilNextExam: 2 })).toBe("serious");
    }
  });

  it("stress is acknowledged briefly and answered with one small step, not a plan", () => {
    const line = registerLine("serious");
    expect(line).toContain("acknowledge that in a few words first");
    expect(line).toContain("exactly one small next step, not a plan or a list");
    expect(line).toContain("Keep the topic and the time they chose");
  });

  it("tone is a line handed to the wording, and no decision reads it", () => {
    for (const file of ["decision/proactive-decision.ts", "engines/planning-engine.ts", "product/today.ts", "proactive/proactive-outbox.ts"]) {
      expect([file, /accountab|Register\b|chooseRegister/.test(read(file))]).toEqual([file, false]);
    }
  });
});

describe("the language of the message being answered", () => {
  it("reads Devanagari off the script, with no model and no word list", () => {
    expect(scriptLanguage("आज क्या पढ़ना है?")).toBe("hindi");
    expect(scriptLanguage("डेडलॉक क्या होता है OS में")).toBe("hindi");
    expect(scriptLanguage("Mealy और Moore machines समझाओ")).toBe("hindi");
    expect(scriptLanguage("नमस्ते")).toBe("hindi");
  });

  it("decides nothing for Roman script: English and Hinglish are the reading's to tell apart", () => {
    for (const text of ["I'm stressed about my exam.", "Bhai, kya padhna chahiye?", "Explain Mealy and Moore machines.", "Mealy aur Moore machines explain karo.", "ok", "25", "", "what does नमस्ते mean in English, exactly?", "what do धन्यवाद and नमस्ते mean in English"]) {
      expect([text, scriptLanguage(text)]).toEqual([text, null]);
    }
  });

  it("the script has the last word over the model, in both directions", () => {
    expect(languageOf("आज क्या पढ़ना है?", "english")).toBe("hindi");
    expect(languageOf("आज क्या पढ़ना है?", null)).toBe("hindi");
    expect(languageOf("aaj kya padhna hai", "hindi")).toBe("hinglish");
    expect(languageOf("aaj kya padhna hai", "hinglish")).toBe("hinglish");
    expect(languageOf("what should I study", "english")).toBe("english");
    expect(languageOf("ok", null)).toBeNull();
  });

  it("is on every reading, so the reply to this message is in this message's language", () => {
    const reading = (text: string, language: string | null) => parseUnderstandingResponse(JSON.stringify({
      intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only",
      request: { clarity: "clear", action: "what_now", confidence: 0.9, language },
    }), text).request?.language ?? null;
    expect(reading("I'm stressed about my exam.", "english")).toBe("english");
    expect(reading("Bhai, kya padhna chahiye?", "hinglish")).toBe("hinglish");
    expect(reading("Explain Mealy and Moore machines.", "english")).toBe("english");
    expect(reading("Mealy aur Moore machines explain karo.", "hinglish")).toBe("hinglish");
    expect(reading("आज क्या पढ़ना चाहिए?", "hinglish")).toBe("hindi");
    expect(reading("ok", null)).toBeNull();
  });

  it("asks for Hindi in Devanagari with names, commands and numbers left as they are", () => {
    const line = languageLine("hindi")!;
    expect(line).toContain("Devanagari");
    expect(line).toContain("exactly as given, in English letters and digits");
    expect(languageLine("english")).toBeNull();
    expect(languageLine("hinglish")).toContain("No Devanagari");
  });

  it("a rendering must be in the script of its language and carry the same figures", () => {
    const plain = "Logged: 25 min on Deadlocks.";
    expect(faithful(plain, "Deadlocks पर 25 min लॉग हो गया।", "hindi")).toBe(true);
    expect(faithful(plain, "Deadlocks pe 25 min log ho gaya.", "hindi")).toBe(false);
    expect(faithful(plain, "Deadlocks पर 25 min लॉग हो गया।", "hinglish")).toBe(false);
    expect(faithful(plain, "Deadlocks पर 30 min लॉग हो गया।", "hindi")).toBe(false);
    expect(faithful(plain, "Deadlocks pe 25 min log ho gaya.")).toBe(true);
  });

  it("fixed lines have a version for every language, so a command never waits on a model", () => {
    expect(textFor("hindi").help).toBe(textFor("hinglish").help);
    expect(isFixedText(textFor("hindi").nothingRunning, "hindi")).toBe(true);
    expect(textFor("english").help).not.toBe(textFor("hinglish").help);
  });

  it("the turn knows a Devanagari message before any model is asked, and keeps a name or profile out of it", () => {
    const turn = read("telegram/telegram-turn.ts");
    // The script first; only then the language of the conversation (chooseLanguage).
    expect(turn).toContain('event.kind === "text" ? (scriptLanguage(event.text) ?? chooseLanguage(null, lastLanguage, event.text)) : lastLanguage');
    expect(read("interaction/language.ts")).not.toMatch(/displayName|studentName|profile\./);
  });
});

describe("an exam's urgency stays with its own subject", () => {
  const NOW = new Date("2026-10-06T06:00:00Z");
  const days = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
  const topic = (over: Partial<TopicMasteryState>): TopicMasteryState => ({
    topicId: "t1", topicName: "Deadlocks", subjectName: "Operating Systems",
    masteryProbability: 0.3, lastStudied: days(-4), retentionEstimate: 0.9, confidenceReported: 0.4, calibrationGap: 0,
    reviewDueAt: days(9), masteryTrend: "stable", reviewCount: 2, ...over,
  });
  const NO_MESSAGE: AcademicUnderstanding = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "" };
  const exam = (subjectName: string | null, inDays: number) => selectActiveExam([{ id: "e1", title: "OS midterm", subjectName, scheduledAt: days(inDays), examType: "midterm" }], {}, NOW)!;
  const stateFor = (inDays: number) => computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 60, studySessions: [],
    upcomingExams: [{ scheduledAt: days(inDays) }],
    stateHistory: [], signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, NOW);
  // Data Structures is the weakest thing on record; the exam is in Operating Systems.
  const TOPICS = [
    topic({ topicId: "d1", topicName: "Linked lists", subjectName: "Data Structures", masteryProbability: 0.05 }),
    topic({ topicId: "d2", topicName: "Heaps", subjectName: "Data Structures", masteryProbability: 0.1 }),
    topic({ topicId: "o1", topicName: "Deadlocks", masteryProbability: 0.3 }),
    topic({ topicId: "o2", topicName: "Paging", masteryProbability: 0.35 }),
  ];

  it("an exam covers its own subject, and the whole syllabus only when it has none on record", () => {
    expect(examCoversSubject(exam("Operating Systems", 12), "Operating Systems")).toBe(true);
    expect(examCoversSubject(exam("Operating Systems", 12), " operating systems ")).toBe(true);
    expect(examCoversSubject(exam("Operating Systems", 12), "Data Structures")).toBe(false);
    expect(examCoversSubject(exam(null, 12), "Data Structures")).toBe(true);
  });

  it("exam prep is planned from the exam's subject, however weak another subject is", () => {
    const plan = generateStudyPlan(stateFor(12), TOPICS, 3, exam("Operating Systems", 12), { now: NOW });
    const prep = plan.today.filter(b => b.activityType === "exam_prep");
    expect(prep.length).toBeGreaterThan(0);
    expect([...new Set(prep.map(b => b.subjectName))]).toEqual(["Operating Systems"]);
  });

  it("in exam-crisis mode too", () => {
    const state = stateFor(2);
    const crisis = { ...state, hardDirectives: { ...state.hardDirectives, examCrisisMode: true } };
    const plan = generateStudyPlan(crisis, TOPICS, 3, exam("Operating Systems", 2), { now: NOW });
    expect(plan.today.length).toBeGreaterThan(0);
    expect([...new Set(plan.today.map(b => b.subjectName))]).toEqual(["Operating Systems"]);
    // No topic on record for the exam's subject: the day is planned the ordinary way, not left empty.
    const other = generateStudyPlan(crisis, TOPICS.filter(t => t.subjectName === "Data Structures"), 3, exam("Operating Systems", 2), { now: NOW });
    expect(other.today.every(b => b.activityType !== "exam_prep")).toBe(true);
  });

  it("\"exam in N days\" is never the reason for another subject's topic", () => {
    const os = exam("Operating Systems", 12);
    const block = (subjectName: string, activityType: "exam_prep" | "new_material") => ({ topicId: "x", topicName: "Linked lists", subjectName, durationMinutes: 25, activityType, rationale: "", urgency: "normal" as const });
    expect(reasonsFor(block("Data Structures", "new_material"), undefined, os, NOW, "UTC")).toEqual([]);
    expect(reasonsFor(block("Data Structures", "exam_prep"), undefined, os, NOW, "UTC")).toEqual([]);
    expect(reasonsFor(block("Operating Systems", "exam_prep"), undefined, os, NOW, "UTC")).toEqual(["exam in 12 days"]);
    expect(reasonsFor(block("Data Structures", "exam_prep"), undefined, exam(null, 12), NOW, "UTC")).toEqual(["exam in 12 days"]);
  });
});
