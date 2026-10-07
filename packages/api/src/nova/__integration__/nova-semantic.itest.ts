/**
 * Talking to Nova — real Postgres integration test.
 *
 * What it proves: a message is read once and then means the same thing on
 * Telegram and on the web; a question about the subject matter, an unclear
 * word and a feeling change nothing; a question about the learner's own
 * evening is answered from the record; and what a learner says about their
 * term is saved only when they confirm it, once, for the learner who said it.
 *
 * Telegram and both models are stood in. Everything between is the real code
 * against a real database.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                     = await import("@repo/db/client");
const { handleNovaTelegramEvent }    = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate }    = await import("../telegram/telegram-event.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { handleNovaTurn }             = await import("../entry.js");
const { applySetup }                 = await import("../product/setup.js");
const { loadNovaSession }            = await import("../product/session.js");
const { loadNovaToday }              = await import("../product/today.js");

import type { InlineButton, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
let clock = new Date();
const tick = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); return clock; };

// ── Telegram and the models, stood in ─────────────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][] }
const sent: Sent[] = [];
let messageId = 7000;
const client: TelegramClient = {
  async sendMessage(chatId, text, buttons) { sent.push({ chatId, text, buttons: buttons ?? [] }); return { ok: true as const, messageId: ++messageId }; },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const lastTo = (chat: string) => sent.filter(s => s.chatId === chat).at(-1)!;
const labels = (chat: string) => lastTo(chat).buttons.flat().map(b => b.text);

// What the Response Brain was shown, so a test can check what it was not.
const worded: Array<{ layer: string; prompt: string }> = [];
const respond = async (layer: string, prompt: string) => {
  worded.push({ layer, prompt });
  return { reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
};

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, availableMinutesMax: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null };
const model = (over: Record<string, unknown> = {}, req: Record<string, unknown> = {}) => ({ ...BASE, ...over, request: { ...REQ, ...req } });
const understandAs = (output: Record<string, unknown> | undefined) => (async (text: string) => {
  assert.ok(output, `no model output given for "${text}"`);
  return parseUnderstandingResponse(JSON.stringify(output), text);
}) as never;

let updateId = 700_000;
function telegram(chat: string) {
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>, output?: Record<string, unknown>) => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, { client, now: () => clock, webUrl: "https://nova.test", respond, understand: understandAs(output) });
  };
  const callback = (data: string) =>
    run(normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data, from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } } } }));
  const dataOf = (label: string) => {
    const button = lastTo(chat).buttons.flat().find(b => b.text === label);
    assert.ok(button?.callback_data, `no button "${label}" (${labels(chat).join(", ")}) under: ${lastTo(chat).text}`);
    return button.callback_data;
  };
  return {
    say: (text: string, output?: Record<string, unknown>) =>
      run(normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } }), output),
    tap: (label: string) => callback(dataOf(label)),
    dataOf, callback,
  };
}
const web = (id: string, text: string, output: Record<string, unknown>) =>
  handleNovaTurn({ platformChatId: id, text, onboardingDone: true, surface: "web", awaitPersistence: true, timestamp: clock, understand: understandAs(output), respond });

// ── Learners ──────────────────────────────────────────────────────────────────

const ids: string[] = [];
let n = 0;

// A learner who has finished Nova's setup conversation. With `topics`, the
// first subject has two studied topics, one of them due for review.
async function learner(options: { platform?: "telegram" | "web"; topics?: boolean; subjects?: string[] } = {}) {
  const platform = options.platform ?? "telegram";
  const id = platform === "telegram" ? `${STAMP}${10 + ++n}` : `web:itest_${STAMP}_${++n}`;
  ids.push(id);
  const user = await prisma.messengerUser.create({ data: { platform, platformChatId: id, persona: "nova", displayName: "Asha" }, select: { id: true } });
  const names = options.subjects ?? ["Operating Systems"];
  const profile = await prisma.novaAcademicProfile.create({
    data: {
      userId: user.id, onboardingComplete: true, timezone: "Asia/Kolkata", preferredStudyTime: "evening",
      subjects: { create: names.map(name => ({ name, code: name === "Operating Systems" ? "OS" : null })) },
    },
    select: { id: true, subjects: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } },
  });
  if (options.topics !== false) {
    const subjectId = profile.subjects[0]!.id;
    const longAgo = new Date(clock.getTime() - 5 * 86_400_000);
    await prisma.novaTopicMastery.create({ data: { subjectId, name: "Deadlocks", masteryProbability: 0.45, confidenceReported: 0.5, reviewCount: 2, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() - 86_400_000) } });
    await prisma.novaTopicMastery.create({ data: { subjectId, name: "Paging", masteryProbability: 0.7, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() + 6 * 86_400_000) } });
  }
  return { id, userId: user.id, profileId: profile.id, subjects: profile.subjects };
}

// Everything a message could wrongly change, in one comparable value.
async function stateOf(l: { userId: string; profileId: string }) {
  const [sessions, topics, snapshots, reality, exams, profile] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, select: { id: true, status: true }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, select: { name: true, masteryProbability: true, reviewCount: true, nextReviewAt: true }, orderBy: { name: "asc" } }),
    prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }),
    prisma.userReality.count({ where: { userId: l.userId } }),
    prisma.novaExam.count({ where: { profileId: l.profileId } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: l.profileId }, select: { statedMinutes: true, preferredStudyTime: true, preferredStudyHoursPerDay: true } }),
  ]);
  return { sessions, topics, snapshots, reality, exams, profile };
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

const GENERAL = model({ intent: "topic_question", topic: "deadlock", topicConfidence: 0.9, routingSignal: "knowledge_engine" }, { asks: "knowledge" });

// ══════════════════════════════════════════════════════════════════════════════

test("a general question is answered on both surfaces, from none of the learner's record, and changes nothing", async () => {
  const l = await learner();
  await prisma.userReality.create({ data: { userId: l.userId, category: "life_constraint", subtype: "work", fact: "Student has a part-time job", confidence: 0.9, isActive: true, expiresAt: new Date(clock.getTime() + 30 * 86_400_000) } });
  const before = await stateOf(l);

  worded.length = 0;
  const trace = await telegram(l.id).say("what is deadlock?", GENERAL);
  assert.equal(trace.understanding.kind, "general_question");
  assert.equal(trace.decision, "explain:general_question");
  assert.equal(lastTo(l.id).text, "WORDED");
  assert.deepEqual(labels(l.id), [], "an explanation carries no buttons");

  const reply = await web(l.id, "difference between BFS and DFS?", GENERAL);
  assert.deepEqual([reply.ok, reply.reply], [true, "WORDED"]);

  assert.equal(worded.length, 2, "one wording call per turn, and one reading: two model calls");
  for (const { layer, prompt } of worded) {
    assert.match(prompt, /question about the subject itself/);
    for (const leak of ["Operating Systems", "Paging", "Mastery", "part-time job", "Streak", "Asia/Kolkata"]) {
      assert.ok(!layer.includes(leak), `the explanation was shown "${leak}"`);
    }
  }
  assert.deepEqual(await stateOf(l), before, "no session, mastery, review date, reality, exam or stated time changed");
});

test("\"should I study deadlocks tonight?\" is answered from the plan; asking starts nothing; the button starts once", async () => {
  const l = await learner();
  const tg = telegram(l.id);
  const before = await stateOf(l);

  worded.length = 0;
  const trace = await tg.say("should I study deadlocks tonight?", model({ intent: "plan_request", topic: "deadlocks", topicConfidence: 0.9 }, { asks: "about_me" }));
  assert.equal(trace.understanding.kind, "learner_question");
  assert.equal(trace.decision, "advise:question_about_topic");
  assert.equal(trace.operation.name, "advise:top_pick");
  assert.match(worded[0]!.prompt, /Yes\. Deadlocks is the first thing on today's plan/, "the verdict was decided before it was worded");
  assert.match(worded[0]!.layer, /On today's plan: Deadlocks \(Operating Systems\)/);
  assert.match(worded[0]!.layer, /Time they have today: not stated\./, "nothing is claimed about time that was not said");
  assert.ok(labels(l.id).includes("Start 25 min"));
  assert.deepEqual(await stateOf(l), before, "a question started nothing");

  const start = tg.dataOf("Start 25 min");
  await tg.callback(start);
  assert.equal((await loadNovaSession(l.id, clock))?.topicName, "Deadlocks");
  // The same tap delivered again, and a second request to start in words.
  await tg.callback(start);
  await tg.say("start deadlocks for 25 minutes", model({ topic: "deadlocks", topicConfidence: 0.9 }, { action: "start_session", availableMinutes: 25 }));
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: l.profileId } }), 1, "one session, however many times it was asked for");
});

test("time said in passing refits the offer; the corrected number wins; \"start it\" runs the offer that is open", async () => {
  const l = await learner();
  const tg = telegram(l.id);

  await tg.say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  assert.match(lastTo(l.id).text, /^Deadlocks \(Operating Systems\)/);

  await tg.say("bro I've only got 30 mins", model({}, { availableMinutes: 30 }));
  assert.deepEqual(labels(l.id).filter(t => t.startsWith("Start")), ["Start 15 min", "Start 25 min", "Start 30 min"]);
  assert.equal((await stateOf(l)).profile.statedMinutes, 30);
  assert.equal(await loadNovaSession(l.id, clock), null, "saying how long they have started nothing");

  await tg.say("actually 20 mins", model({}, { availableMinutes: 20 }));
  assert.deepEqual(labels(l.id).filter(t => t.startsWith("Start")), ["Start 15 min", "Start 20 min"], "the 30-minute offer is gone");
  assert.equal((await stateOf(l)).profile.statedMinutes, 20);

  const option = lastTo(l.id).buttons.flat().findIndex(b => b.text === "Start 20 min");
  await tg.say("start it", model({}, { action: "start_session", promptAnswer: "abcdef"[option] }));
  const session = await loadNovaSession(l.id, clock);
  assert.deepEqual([session?.topicName, session?.plannedDurationMinutes], ["Deadlocks", 20]);
});

test("\"start it\" with nothing on offer starts nothing, on either surface", async () => {
  const l = await learner();
  const before = await stateOf(l);
  const reading = model({}, { action: "start_session", confidence: 0.99 });
  const trace = await telegram(l.id).say("start it", reading);
  assert.equal(trace.decision, "offer_start:start_needs_confirmation");
  await web(l.id, "do it", reading);
  await web(l.id, "start deadlocks for 25 minutes", model({ topic: "deadlocks", topicConfidence: 0.9 }, { action: "start_session", availableMinutes: 25 }));
  assert.match(worded.at(-1)!.prompt, /did not start, pause, resume or end a study session/);
  assert.deepEqual((await stateOf(l)).sessions, before.sessions);
});

test("a typed \"yes\" on the web cannot accept a Start offer made on Telegram", async () => {
  const l = await learner();
  await telegram(l.id).say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  assert.ok(labels(l.id).includes("Start 25 min"));
  await web(l.id, "yes", model({}, { action: "start_session", promptAnswer: "a", confidence: 0.99 }));
  assert.equal(await loadNovaSession(l.id, clock), null);
  // The offer is still the learner's to accept where it was made.
  await telegram(l.id).tap("Start 25 min");
  assert.equal((await loadNovaSession(l.id, clock))?.topicName, "Deadlocks");
});

test("exhaustion with a Start offer open is a circumstance, not an answer: nothing starts", async () => {
  const l = await learner();
  const tg = telegram(l.id);
  await tg.say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  const sessions = (await stateOf(l)).sessions;

  worded.length = 0;
  const trace = await tg.say("I'm exhausted today, I can't study", model(
    { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure", reality: [{ about: "self", category: "health", subtype: "sleep", claim: "Student is exhausted", status: "active", persistence: "temporary", expectedDurationHours: 24, confidence: 0.85 }] },
    { action: "not_now", deferUntil: "tomorrow" },
  ));
  assert.equal(trace.understanding.kind, "reality_signal");
  assert.match(trace.decision!, /^defer:/);
  assert.equal(worded.length, 1, "it is answered by Nova, not by a template");
  assert.match(worded[0]!.prompt, /Register: serious/);
  assert.deepEqual((await stateOf(l)).sessions, sessions);
  assert.ok(trace.evidence.kinds.includes("reality_claim"), "the circumstance went to consolidation as evidence");
});

test("unclear words change nothing on either surface, however confidently they are misread", async () => {
  const l = await learner();
  const tg = telegram(l.id);
  await tg.say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  const before = await stateOf(l);
  const worst = model(
    { intent: "mastery_claim", topic: "Deadlocks", topicConfidence: 0.95, ambiguityScore: 0.9, secondaryIntents: ["study_report"] },
    { clarity: "ambiguous", action: "start_session", confidence: 0.99, availableMinutes: 45, exam: { title: "OS", date: "2099-01-01" }, setup: { subject: "OS", topics: ["Threads"], dailyMinutes: 240, studyTime: "night" } },
  );
  for (const word of ["yeah", "do it", "Friday", "maybe", "okay"]) {
    tick(1);
    const trace = await tg.say(word, worst);
    assert.equal(trace.understanding.kind, "unclear", word);
    assert.equal(trace.decision, "clarify:ambiguous", word);
    await web(l.id, word, worst);
  }
  assert.deepEqual(await stateOf(l), before);
});

test("a range of time is asked back; neither end is recorded until one is picked", async () => {
  const l = await learner();
  const tg = telegram(l.id);
  await tg.say("maybe 20-30 mins", model({}, { availableMinutes: 20, availableMinutesMax: 30 }));
  assert.equal(lastTo(l.id).text, "20 or 30 minutes?");
  assert.deepEqual(labels(l.id), ["20 min", "30 min"]);
  assert.equal((await stateOf(l)).profile.statedMinutes, null);
  await tg.tap("30 min");
  assert.equal((await stateOf(l)).profile.statedMinutes, 30);
  assert.equal(await loadNovaSession(l.id, clock), null);
});

test("a learner with no topics is asked for the one missing thing, and what they say is saved only on confirmation, once", async () => {
  const l = await learner({ topics: false });
  const tg = telegram(l.id);

  await tg.say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  assert.equal(lastTo(l.id).text, "Nothing to plan from yet. What does Operating Systems cover this term? List the topics or chapters, in any order.");
  assert.doesNotMatch(lastTo(l.id).text, /\/\w+/, "no command is taught");

  const stated = model({}, { setup: { subject: null, topics: ["Deadlocks", "Paging", "Scheduling"], dailyMinutes: null, studyTime: null } });
  const trace = await tg.say("deadlocks, paging and scheduling", stated);
  assert.equal(trace.understanding.kind, "onboarding_input");
  assert.equal(lastTo(l.id).text, "Add to Operating Systems: Deadlocks, Paging, Scheduling?");
  assert.deepEqual(labels(l.id), ["Add them", "No"]);
  assert.equal((await stateOf(l)).topics.length, 0, "saying it saved nothing");

  const confirm = tg.dataOf("Add them");
  await tg.callback(confirm);
  const after = await stateOf(l);
  assert.deepEqual(after.topics.map(t => [t.name, t.masteryProbability, t.reviewCount]), [["Deadlocks", 0, 0], ["Paging", 0, 0], ["Scheduling", 0, 0]]);
  assert.equal(after.snapshots, 0, "naming a topic says nothing about how well it is known");
  assert.match(lastTo(l.id).text, /^Added to Operating Systems: Deadlocks, Paging, Scheduling\./);
  assert.ok(labels(l.id).some(t => t.startsWith("Start")), "and the plan it made possible follows");

  // The same tap again, and the same thing said and confirmed again.
  await tg.callback(confirm);
  await tg.say("deadlocks, paging and scheduling", stated);
  await tg.tap("Add them");
  assert.match(lastTo(l.id).text, /^Operating Systems already had those\./);
  assert.equal((await stateOf(l)).topics.length, 3);

  // And Nova does not ask for it again.
  await tg.say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  assert.doesNotMatch(lastTo(l.id).text, /What does Operating Systems cover/);
});

test("with several subjects the learner picks which one the topics are for; \"No\" saves nothing", async () => {
  const l = await learner({ topics: false, subjects: ["Operating Systems", "Databases"] });
  const tg = telegram(l.id);
  const stated = model({}, { setup: { subject: null, topics: ["Normalisation", "Indexing"], dailyMinutes: 120, studyTime: "night" } });

  await tg.say("normalisation and indexing, and I usually get 2 hours at night", stated);
  assert.deepEqual(labels(l.id), ["Operating Systems", "Databases", "No"]);
  await tg.tap("No");
  const untouched = await stateOf(l);
  assert.deepEqual([untouched.topics.length, untouched.profile.preferredStudyTime, untouched.profile.preferredStudyHoursPerDay], [0, "evening", 3]);

  await tg.say("normalisation and indexing, and I usually get 2 hours at night", stated);
  await tg.tap("Databases");
  const saved = await stateOf(l);
  assert.deepEqual(saved.topics.map(t => t.name), ["Indexing", "Normalisation"]);
  assert.deepEqual([saved.profile.preferredStudyTime, saved.profile.preferredStudyHoursPerDay], ["night", 2]);
  const databases = l.subjects.find(s => s.name === "Databases")!;
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: databases.id } }), 2, "filed under the subject they picked");
  // One subject still has nothing: that is what is asked next, and only that.
  assert.match(lastTo(l.id).text, /What does Operating Systems cover this term\?/);
});

test("on the web the same statement is offered and saved by a typed yes: one setup, read by both surfaces", async () => {
  const l = await learner({ platform: "web", topics: false });
  const stated = model({}, { setup: { subject: "OS", topics: ["Deadlocks", "Paging"], dailyMinutes: null, studyTime: null } });

  const offer = await web(l.id, "for OS we have deadlocks and paging", stated);
  assert.equal(offer.reply, "Add to Operating Systems: Deadlocks, Paging?\n(Add them / No)");
  assert.equal((await stateOf(l)).topics.length, 0);

  const saved = await web(l.id, "yes", model({}, { promptAnswer: "a" }));
  assert.match(saved.reply, /^Added to Operating Systems: Deadlocks, Paging\./);
  assert.deepEqual((await stateOf(l)).topics.map(t => t.name), ["Deadlocks", "Paging"]);

  // A second yes has nothing open to answer.
  await web(l.id, "yes", model({}, { promptAnswer: "a" }));
  assert.equal((await stateOf(l)).topics.length, 2);
  const today = await loadNovaToday(l.id, { now: clock });
  assert.equal(today.status === "ready" && today.recommendation !== null, true, "the plan now has something in it");
});

test("time stated on the web is the time Telegram plans with", async () => {
  const l = await learner();
  await web(l.id, "I have 40 minutes", model({}, { availableMinutes: 40 }));
  assert.equal((await stateOf(l)).profile.statedMinutes, 40);
  assert.equal(await loadNovaSession(l.id, clock), null);
  await telegram(l.id).say("what should I study?", model({ intent: "plan_request" }, { asks: "about_me", action: "what_now" }));
  assert.deepEqual(labels(l.id).filter(t => t.startsWith("Start")), ["Start 15 min", "Start 25 min", "Start 40 min"]);
});

test("setup is saved only under a subject of the learner's own", async () => {
  const mine   = await learner({ topics: false });
  const theirs = await learner({ topics: false, subjects: ["Thermodynamics"] });
  const result = await applySetup(mine.id, { subjectName: "Thermodynamics", topics: ["Entropy"], dailyMinutes: null, studyTime: null });
  assert.deepEqual(result, { status: "unknown_subject" });
  assert.equal((await stateOf(theirs)).topics.length, 0);
  assert.equal((await stateOf(mine)).topics.length, 0);
  assert.deepEqual(await applySetup("999000111", { subjectName: null, topics: [], dailyMinutes: 60, studyTime: null }), { status: "not_ready" });

  // A button from one learner's chat does nothing in another's.
  const tg = telegram(mine.id);
  await tg.say("deadlocks and paging", model({}, { setup: { subject: null, topics: ["Deadlocks", "Paging"], dailyMinutes: null, studyTime: null } }));
  await telegram(theirs.id).callback(tg.dataOf("Add them"));
  assert.equal((await stateOf(mine)).topics.length, 0);
  assert.equal((await stateOf(theirs)).topics.length, 0);
});

test("a chat that has just been linked is told what to do now, not handed a list of commands", async () => {
  const ready = await learner();
  await telegram(ready.id).say("/start");
  assert.match(lastTo(ready.id).text, /^Connected\. I'm Nova\./);
  assert.match(lastTo(ready.id).text, /Deadlocks \(Operating Systems\)/);
  assert.ok(labels(ready.id).includes("Start 25 min"));
  assert.doesNotMatch(lastTo(ready.id).text, /\/today|\/focus|\/status/);

  const empty = await learner({ topics: false });
  await telegram(empty.id).say("/start");
  assert.match(lastTo(empty.id).text, /What does Operating Systems cover this term\?/);
});
