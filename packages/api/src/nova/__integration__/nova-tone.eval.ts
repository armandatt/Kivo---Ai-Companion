// What Nova actually says. Runs real turns against a throwaway database with
// the real Response Brain and the real proactive wording, and prints each
// reply next to what was decided and what the reply was told.
//
//   cd packages/api
//   NOVA_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest \
//     GEMINI_API_KEY=... npx tsx src/nova/__integration__/nova-tone.eval.ts        tone scenarios
//   ... npx tsx src/nova/__integration__/nova-tone.eval.ts web                    the web chat box, ten phrases
//
// Not part of `npm run test:integration`: it calls a model.
//
// It refuses the app's database (the same guard the integration tests use)
// and sends nothing to Telegram. The Understanding Brain is stood in for the
// tone scenarios, with the readings the real model gave in the evaluation
// run, so the model budget goes to the replies; the web phrases use the real
// Understanding Brain, because how it reads them is the question there.
// Each reply is checked mechanically for length, emoji, figures that were not
// in what it was told, and claims of an action. Tone itself is for a person
// to read.

import "./test-database.js";

const { prisma }                  = await import("@repo/db/client");
const { handleNovaTelegramEvent } = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate } = await import("../telegram/telegram-event.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { runResponseBrain }        = await import("../brains/response-brain.js");
const { runNovaOrchestrator }     = await import("../nova-orchestrator.js");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
const { runNovaProactiveCron }    = await import("../proactive/nova-proactive-cron.js");
const { wordProactiveMessage }    = await import("../proactive/nova-proactive-response.js");
const { localHour }               = await import("../engines/learner-calendar.js");

const STAMP = Date.now();
const now   = new Date();
const chats: string[] = []; const accounts: string[] = [];
const zoneWhereHourIs = (hour: number) => {
  for (let o = -11; o <= 12; o++) { const z = `Etc/GMT${o <= 0 ? "+" : "-"}${Math.abs(o)}`; if (localHour(now, z) === hour) return z; }
  throw new Error("no zone");
};

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null };

interface Seed { accountability: "hard" | "soft"; examInDays?: number; hour?: number; reality?: { category: string; subtype: string; fact: string } }
async function learner(name: string, seed: Seed) {
  const chat = `${STAMP}${chats.length + 10}`; chats.push(chat);
  const account = await prisma.user.create({ data: { email: `tone_${STAMP}_${chats.length}@test.local`, name }, select: { id: true } });
  accounts.push(account.id);
  await prisma.userProfile.create({ data: { userId: account.id, primaryPersona: "nova", onboardingComplete: true, telegramChatId: chat, accountabilityStyle: seed.accountability, secondaryDomains: [], aspirationWords: [] } });
  const user = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: name, novaAcademicProfile: { create: {
      onboardingComplete: true, timezone: zoneWhereHourIs(seed.hour ?? 18), preferredStudyTime: "evening", goals: ["Get an A in Operating Systems"],
      subjects: { create: { name: "Operating Systems", code: "OS" } },
    } } },
    select: { id: true, novaAcademicProfile: { select: { id: true, subjects: { select: { id: true } } } } },
  });
  const profileId = user.novaAcademicProfile!.id, subjectId = user.novaAcademicProfile!.subjects[0]!.id;
  const ago = new Date(now.getTime() - 3 * 86_400_000);
  await prisma.novaTopicMastery.create({ data: { subjectId, name: "Deadlocks", masteryProbability: 0.38, confidenceReported: 0.4, reviewCount: 3, lastStudiedAt: ago, nextReviewAt: new Date(now.getTime() - 86_400_000) } });
  await prisma.novaTopicMastery.create({ data: { subjectId, name: "Paging", masteryProbability: 0.72, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: ago, nextReviewAt: new Date(now.getTime() + 6 * 86_400_000) } });
  await prisma.novaStudySession.create({ data: { profileId, subjectId, topicName: "Deadlocks", sessionDate: ago, status: "completed", durationMinutes: 30, plannedDurationMinutes: 30, activityType: "practice" } });
  if (seed.examInDays !== undefined) await prisma.novaExam.create({ data: { profileId, subjectId, title: "Operating Systems final", examType: "final", scheduledAt: new Date(now.getTime() + seed.examInDays * 86_400_000) } });
  if (seed.reality) await prisma.userReality.create({ data: { userId: user.id, ...seed.reality, confidence: 0.9, expiresAt: new Date(now.getTime() + 3 * 86_400_000) } });
  return { chat, userId: user.id, profileId };
}

// ── What a reply is checked for, mechanically ─────────────────────────────────
const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "twenty-five", "thirty", "forty", "forty-five", "fifty", "sixty", "ninety"];
function check(reply: string, told: string, sessionOpen: boolean): string[] {
  const flags: string[] = [];
  if (reply.length > 420) flags.push(`LONG(${reply.length})`);
  if (/\p{Extended_Pictographic}/u.test(reply)) flags.push("EMOJI");
  const toldLower = told.toLowerCase();
  for (const figure of reply.match(/\d+/g) ?? []) if (!told.includes(figure)) flags.push(`FIGURE_NOT_GIVEN(${figure})`);
  for (const word of NUMBER_WORDS) {
    if (new RegExp(`\\b${word}\\b (days?|minutes?|mins?|hours?|weeks?|sessions?|topics?)`, "i").test(reply) && !toldLower.includes(word)) {
      const digits: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", fifteen: "15", twenty: "20", "twenty-five": "25", thirty: "30", forty: "40", "forty-five": "45", sixty: "60", ninety: "90" };
      if (!digits[word] || !told.includes(digits[word]!)) flags.push(`FIGURE_NOT_GIVEN(${word})`);
    }
  }
  if (!sessionOpen && /\b(i('ve| have)? (just )?(started|added|saved|scheduled|logged|set (up )?a reminder)|your session (is|has) (started|running)|timer is running)\b/i.test(reply)) flags.push("CLAIMS_AN_ACTION");
  return flags;
}

const rows: Array<Record<string, unknown>> = [];
let update = 1;

async function telegramTurn(label: string, expect: string, l: Awaited<ReturnType<typeof learner>>, text: string, reading: Record<string, unknown>) {
  const sent: string[] = []; let told = ""; let register = "template (no model)";
  const client = {
    async sendMessage(_c: string, t: string) { sent.push(t); return { ok: true as const, messageId: ++update }; },
    async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
  };
  const trace = await handleNovaTelegramEvent(
    normalizeTelegramUpdate({ update_id: ++update, message: { message_id: update, chat: { id: Number(l.chat), type: "private" }, from: { id: Number(l.chat) }, text } }) as never,
    {
      client, now: () => now, webUrl: "https://nova.test",
      understand: (async (t: string) => parseUnderstandingResponse(JSON.stringify(reading), t)) as never,
      respond: async (dynamic: string, prompt: string) => { told = `${dynamic}\n${prompt}`; register = /Register: (\w+)/.exec(prompt)?.[1] ?? "?"; return runResponseBrain(dynamic, prompt); },
    },
  );
  const reply = sent.at(-1) ?? "";
  const open  = (await loadNovaSession(l.chat, now)) !== null;
  rows.push({ label, expect, said: text, decision: trace.decision, operation: trace.operation, register, modelAnswered: trace.response.generated ? trace.response.ok : "n/a", flags: told ? check(reply, `${told}\n${text}`, open) : [], reply });
  console.log(JSON.stringify(rows.at(-1)));
}

async function tone() {
  // A / K / F1: results stated by template. No model call; shown for completeness.
  const a = await learner("Asha", { accountability: "soft", examInDays: 9 });
  await telegramTurn("A1 normal study request", "plain template", a, "what should I study?", { ...BASE, intent: "plan_request", request: { ...REQ, action: "what_now" } });
  await telegramTurn("A2 normal: asks for a steadier week", "steady", a, "can you help me keep this week steady, I don't want to cram OS again", { ...BASE, intent: "plan_request", routingSignal: "planning_engine", topic: "Operating Systems", topicConfidence: 0.8, request: { ...REQ } });
  await telegramTurn("K change of mind", "offer, nothing started (template)", a, "start deadlocks for 30... actually wait, not yet", { ...BASE, topic: "deadlocks", topicConfidence: 1, sessionIntent: "start", request: { ...REQ, changeOfMind: true, action: "start_session", confidence: 0.9, availableMinutes: 30 } });

  // B / J: the same avoidance, two accountability choices.
  const skip = { ...BASE, intent: "study_skip_report", emotion: "avoidant", request: { ...REQ } };
  await telegramTurn("B repeated avoidance, gentle", "steady, no shame", a, "skipped again today, third day in a row. watched a whole season instead", skip);
  const j = await learner("Jay", { accountability: "hard", examInDays: 9 });
  await telegramTurn("J repeated avoidance, asked to be pushed hard", "playful, about the habit not the person", j, "skipped again today, third day in a row. watched a whole season instead", skip);
  await telegramTurn("G help with a weak topic", "steady, grounded in the weak topic", j, "can you help me with deadlocks, the banker's algorithm part keeps losing me", { ...BASE, intent: "topic_question", emotion: "confused", topic: "Deadlocks", topicConfidence: 0.95, routingSignal: "knowledge_engine", request: { ...REQ } });

  // C: exam tomorrow, panic, thirty minutes. Hard accountability, to see it is not used.
  const c = await learner("Cam", { accountability: "hard", examInDays: 1 });
  await telegramTurn("C exam pressure", "serious; states the plan Nova fitted to 30 min", c, "bro I'm fucked, exam is tomorrow and I've only got 30 mins", { ...BASE, intent: "exam_anxiety", emotion: "anxious_exam", routingSignal: "exam_engine", request: { ...REQ, action: "what_now", availableMinutes: 30 } });

  // D: frustrated after a session that went badly.
  const d = await learner("Dee", { accountability: "hard", examInDays: 9 });
  await runNovaSessionCommand(d.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, new Date(now.getTime() - 26 * 60_000), "telegram");
  await runNovaSessionCommand(d.chat, { action: "end", outcome: "struggled" }, new Date(now.getTime() - 60_000), "telegram");
  await telegramTurn("D frustrated after struggling", "serious, no teasing", d, "did a whole session on deadlocks and I still keep fucking it up", { ...BASE, intent: "emotional_vent", emotion: "frustrated", topic: "Deadlocks", topicConfidence: 0.95, secondaryIntents: ["study_report"], request: { ...REQ, struggleTopic: "Deadlocks" } });
  await telegramTurn("F success", "encouraging without hype", d, "ok wait it finally clicked, deadlocks make sense now", { ...BASE, intent: "mastery_claim", emotion: "proud", topic: "Deadlocks", topicConfidence: 0.95, request: { ...REQ } });

  // E: distress, with hard accountability on file.
  const e = await learner("Eli", { accountability: "hard", examInDays: 9 });
  await telegramTurn("E emotionally distressed", "serious, supportive, no push, no teasing", e, "i can't do this anymore, i'm so behind and i feel like i'm drowning", {
    ...BASE, intent: "emotional_vent", emotion: "distressed", disclosureClass: "emotional_disclosure",
    reality: [{ about: "self", category: "emotional", subtype: "burnout", claim: "Student feels overwhelmed and burnt out", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.85 }],
    request: { ...REQ },
  });

  // L: nothing was done, and no figure may be invented.
  const l = await learner("Lou", { accountability: "soft", examInDays: 9 });
  await telegramTurn("L1 no action, no invented figures", "says nothing was added; no date or day count", l, "my networks exam got moved, not sure when yet", { ...BASE, intent: "exam_anxiety", emotion: "neutral", topic: "Computer Networks", topicConfidence: 0.8, routingSignal: "exam_engine", request: { ...REQ } });
  await telegramTurn("L2 an exam Nova cannot file", "no day count invented, no claim it was added", l, "I have a chemistry exam on Friday", { ...BASE, intent: "exam_anxiety", emotion: "neutral", topic: "Chemistry", topicConfidence: 0.9, routingSignal: "exam_engine", request: { ...REQ } });

  // H / I: Nova speaks first. Real wording, recorded through the outbox.
  const proactive = async (label: string, expect: string, seed: Seed) => {
    const p = await learner(label.split(" ")[0]!, seed);
    const sent: Array<{ text: string; buttons: string[] }> = []; let told = ""; let register = "";
    const client = {
      async sendMessage(c: string, t: string, b?: Array<Array<{ text: string }>>) { if (c === p.chat) sent.push({ text: t, buttons: (b ?? []).flat().map(x => x.text) }); return { ok: true as const, messageId: ++update }; },
      async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
    };
    await runNovaProactiveCron(now, { client, word: (async (input: Parameters<typeof wordProactiveMessage>[0]) => {
      // Other learners in the database are passed over without a model call.
      if (input.studentName !== label.split(" ")[0]) return { text: "(not this scenario)", generated: false };
      told = input.facts.join("\n"); register = `${input.register}${input.informOnly ? ", inform only" : ""}`;
      return wordProactiveMessage(input);
    }) as never });
    const row = await prisma.novaProactiveMessage.findFirst({ where: { profileId: p.profileId }, orderBy: { createdAt: "desc" }, select: { eventType: true, status: true } });
    rows.push({ label, expect, decision: row ? `${row.eventType}:${row.status}` : "nothing sent", register, told, buttons: sent.at(-1)?.buttons ?? [], flags: sent.length ? check(sent.at(-1)!.text, told, false) : [], reply: sent.at(-1)?.text ?? "" });
    console.log(JSON.stringify(rows.at(-1)));
  };
  await proactive("Hana H1 proactive exam reminder", "serious, exam and the one thing to do", { accountability: "hard", examInDays: 2, hour: 18 });
  await proactive("Ines I proactive review or recovery reminder", "steady, names the recommended topic, no guilt", { accountability: "soft", hour: 18 });
  await proactive("Faye H2 exam near with a family matter", "the date only; no ask to study; no Start button", { accountability: "hard", examInDays: 2, hour: 18, reality: { category: "life_constraint", subtype: "family", fact: "Student has a family matter this week" } });
  await proactive("Gus H3 exam near while burnt out", "nothing sent", { accountability: "hard", examInDays: 2, hour: 18, reality: { category: "emotional", subtype: "burnout", fact: "Student is burnt out" } });
}

// ── The web chat box: what ten unclear phrases do ─────────────────────────────
async function web() {
  const SENTENCE = "This message did not start, pause, resume or end a study session, and nothing was added or scheduled. Do not say or imply otherwise. If the student wants to start or end a session, point them to the Start button on this page or to Focus.";
  const phrases = ["maybe I should study deadlocks", "should probably study", "do it", "yeah", "20 minutes", "actually no", "never mind", "help me with OS", "start deadlocks", "done"];
  const state = async (l: { userId: string; profileId: string }) => JSON.stringify({
    sessions: (await prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, orderBy: { createdAt: "asc" }, select: { status: true, pausedAt: true, executionReport: true } })).map(s => [s.status, s.pausedAt !== null, s.executionReport !== null]),
    mastery:  (await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, orderBy: { name: "asc" }, select: { name: true, masteryProbability: true, reviewCount: true } })),
    history:  await prisma.novaTopicMasterySnapshot.count({ where: { topic: { subject: { profileId: l.profileId } } } }),
    exams:    await prisma.novaExam.count({ where: { profileId: l.profileId } }),
    reality:  await prisma.userReality.count({ where: { userId: l.userId } }),
    facts:    await prisma.userFact.count({ where: { userId: l.userId } }),
    patterns: await prisma.behavioralPattern.count({ where: { userId: l.userId } }),
  });
  for (const withSession of [false, true]) {
    const l = await learner(withSession ? "Wren" : "Will", { accountability: "soft", examInDays: 9 });
    if (withSession) await runNovaSessionCommand(l.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, new Date(now.getTime() - 10 * 60_000), "web");
    for (const text of phrases) {
      const before = await state(l);
      // What nova/entry.ts does for a message with no typed command: the
      // orchestrator reads it itself (first pass, then the second pass when
      // it is unclear), with the reply stood in so the model budget goes to
      // the reading.
      const turn = await runNovaOrchestrator({
        platformChatId: l.chat, text, timestamp: now, awaitPersistence: true, sessionCommands: "surface", directive: SENTENCE,
        respond: async () => ({ reply: "(reply stood in)", reasoningMode: "direct" as const, confidence: 1, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null }),
      });
      const after = await state(l);
      const row = { web: text, session: withSession ? "running" : "none", intervention: turn.intervention, evidence: turn.trace?.evidenceKinds ?? [], stateChanged: before !== after, ...(before !== after ? { before, after } : {}) };
      rows.push(row); console.log(JSON.stringify(row));
    }
  }
}

try {
  if (process.argv[2] === "web") await web(); else await tone();
} finally {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
}
