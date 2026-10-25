/**
 * Web onboarding v3 — real Postgres integration test.
 *
 * What it proves: the v3 answers are stored on the right account, each where
 * Nova reads it, and reach every reader; onboarding completes once, and an
 * account that finished an older onboarding is left as it was; the weekly
 * time becomes the usual day of the learner's first Nova profile and of no
 * other; saying Yes to Telegram links nothing; one account's answers never
 * reach another learner; and a real web turn (both models stood in) words
 * its reply in the chosen language and tone, with the support lines.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { checkOnboardingV2, checkOnboardingV3 } = await import("../product/onboarding-answers.js");
const { completeOnboardingOnce, profileFromAnswers, profileFromAnswersV3 } = await import("../product/onboarding-completion.js");
const { loadLearningContexts, loadSignupAnswers, loadVoicePreferences } = await import("../adapters/account-preferences-adapter.js");
const { loadAccountabilityStyle, loadTone } = await import("../adapters/operating-style-adapter.js");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");
const { loadSetup, saveSetup } = await import("../product/setup.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { handleNovaTurn } = await import("../entry.js");

const STAMP = Date.now();
const users: string[] = [];

async function account(): Promise<string> {
  const u = await prisma.user.create({ data: { email: `onb3_${STAMP}_${users.length}@example.test`, name: "Asha" }, select: { id: true } });
  users.push(u.id);
  return u.id;
}

const ANSWERS = {
  version: 3,
  audience: "college",
  workingOn: { selected: ["semester_exams", "project_portfolio"], custom: ["Final-year thesis"] },
  weeklyHours: { preset: "3_5" },
  obstacles: { selected: ["procrastination", "deadlines"], custom: ["My phone"] },
  language: "hinglish",
  tone: "direct",
  telegram: "yes",
  creatureName: "Pip",
};

// What the onboarding route does with a valid v3 body.
async function finish(userId: string, body: unknown = ANSWERS) {
  const checked = checkOnboardingV3(body);
  assert.ok(checked.ok, checked.ok ? "" : checked.message);
  const { profileData } = profileFromAnswersV3(checked.answers, "Asia/Kolkata");
  return completeOnboardingOnce(userId, profileData);
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: users.map(u => `web:${u}`) } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("the answers are stored on the account, each where Nova reads it", async () => {
  const userId = await account();
  assert.equal(await finish(userId), "completed");
  const learner = `web:${userId}`;

  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId } });
  assert.equal(profile.onboardingComplete, true);
  assert.equal(profile.primaryPersona, "nova");
  assert.equal(profile.personaName, "NOVA", "Nova stays Nova");
  assert.equal(profile.creatureName, "Pip");
  assert.equal(profile.creatureColor, null);
  assert.equal(profile.primaryGoal30d, null, "what they work on is context, not a goal");
  assert.equal(profile.accountabilityStyle, null, "Direct and honest is neither soft nor hard");
  assert.equal(profile.preferredCheckInTime, null, "no check-in time is chosen for them");

  assert.deepEqual(await loadLearningContexts(learner), ["college"]);
  const signup = await loadSignupAnswers(learner);
  assert.deepEqual(signup.workingOn, ANSWERS.workingOn);
  assert.deepEqual(signup.weeklyHours, { hours: 4, preset: "3_5" });
  assert.deepEqual(signup.obstacles, ANSWERS.obstacles);
  assert.deepEqual(await loadVoicePreferences(learner), { language: "hinglish", tone: "direct" });
  assert.equal(await loadTone(learner), "direct");
  assert.equal(await loadAccountabilityStyle(learner), null);

  // The account is a Nova learner, and naming the creature named nothing else.
  const resolved = await resolveLearnerForAccount(userId);
  assert.equal((resolved as { kind?: string }).kind, "learner");
  assert.equal(await prisma.messengerUser.count({ where: { OR: [{ platformChatId: { contains: "Pip" } }, { displayName: "Pip" }] } }), 0);
});

test("saying Yes to Telegram links nothing", async () => {
  const userId = await account();
  await finish(userId);
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId } });
  assert.equal(profile.telegramConnected, false);
  assert.equal(profile.telegramChatId, null);
  assert.equal(profile.telegramConnectToken, null, "no link is made until the learner asks for one");
  assert.equal((profile.onboardingAnswers as { telegram?: string }).telegram, "yes");
});

test("the weekly time is the usual day of their first Nova profile, and only that one", async () => {
  const userId = await account();
  await finish(userId);
  const learner = `web:${userId}`;
  await resolveLearnerForAccount(userId);

  // The setup page shows that day before the profile exists, so saving the page keeps it.
  const before = await loadSetup(learner);
  assert.equal(before!.dailyMinutes, 35, "3–5 hours a week is about 35 minutes a day");
  // The templates follow the first thing they are working on (semester exams).
  assert.equal(before!.templateIds[0], "exam-preparation");

  // A sentence in chat makes the profile and says nothing about the routine.
  const saved = await saveSetup(learner, { subjects: [{ name: "DSA", topics: ["Arrays"] }], exams: [], dailyMinutes: null, studyTime: null }, new Date(), "merge");
  assert.equal(saved.status, "saved");
  const made = await prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: learner } } });
  assert.equal(made.dailyStudyMinutes, 35);
  assert.deepEqual(made.goals, [], "no goal is seeded from what they work on");

  // Once the profile exists, a changed weekly answer does not move it.
  await prisma.userProfile.update({ where: { userId }, data: { onboardingAnswers: { ...(ANSWERS as object), version: 3, learningContexts: ["college"], weeklyHours: { hours: 35, preset: "over_30" } } } });
  await saveSetup(learner, { subjects: [{ name: "DSA", topics: ["Stacks"] }], exams: [], dailyMinutes: null, studyTime: null }, new Date(), "merge");
  const after = await prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: learner } } });
  assert.equal(after.dailyStudyMinutes, 35);
});

test("onboarding completes once, and an account that finished before is left as it was", async () => {
  const userId = await account();
  assert.equal(await finish(userId), "completed");
  assert.equal(await finish(userId, { ...ANSWERS, creatureName: "Someone else", language: "english" }), "already_complete");
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId } });
  assert.equal(profile.creatureName, "Pip");
  assert.equal((profile.onboardingAnswers as { language?: string }).language, "hinglish");

  const racer = await account();
  const outcomes = await Promise.all([finish(racer), finish(racer), finish(racer)]);
  assert.equal(outcomes.filter(o => o === "completed").length, 1);
  assert.equal(await prisma.userProfile.count({ where: { userId: racer } }), 1, "one profile, not three");

  // An account onboarded with v2 is not asked again and not rewritten.
  const older = await account();
  const v2 = checkOnboardingV2({ version: 2, audience: "working", firstFocus: { id: "skill", detail: null }, accountabilityStyle: "hard", style: { explanation: "example_first", feedback: "direct", pacing: "one_thing" }, companionName: "Kivi" });
  assert.ok(v2.ok);
  await completeOnboardingOnce(older, profileFromAnswers(v2.answers, "Asia/Kolkata").profileData);
  assert.equal(await finish(older), "already_complete");
  const kept = await prisma.userProfile.findUniqueOrThrow({ where: { userId: older } });
  assert.equal((kept.onboardingAnswers as { version?: number }).version, 2);
  assert.equal(kept.creatureName, "Kivi");
  // Its soft/hard answer still reads as a tone.
  assert.equal(await loadTone(`web:${older}`), "no_mercy");
});

test("one account's answers never reach another learner", async () => {
  const a = await account();
  const b = await account();
  await finish(a);
  await prisma.userProfile.create({ data: { userId: b, secondaryDomains: [], aspirationWords: [], primaryPersona: "nova", onboardingComplete: true } });
  const other = await loadSignupAnswers(`web:${b}`);
  assert.deepEqual(other, { workingOn: null, weeklyHours: null, obstacles: null, language: null, tone: null, preferredName: null });
  assert.equal(await loadTone(`web:${b}`), null);
});

// ── A real web turn, both models stood in ─────────────────────────────────────

const worded: Array<{ layer: string; prompt: string }> = [];
const respond = async (layer: string, prompt: string) => {
  worded.push({ layer, prompt });
  return { reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
};
const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, availableMinutesMax: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null };
const understandAs = (output: Record<string, unknown>) => (async (text: string) => parseUnderstandingResponse(JSON.stringify(output), text)) as never;

async function readyLearner(): Promise<string> {
  const userId = await account();
  await finish(userId);
  await resolveLearnerForAccount(userId);
  const learner = `web:${userId}`;
  const saved = await saveSetup(learner, { subjects: [{ name: "DSA", topics: ["Arrays", "Stacks"] }], exams: [], dailyMinutes: 60, studyTime: null });
  assert.equal(saved.status, "saved");
  return learner;
}

test("a web reply is worded in their language and tone, with the support lines", async () => {
  const learner = await readyLearner();
  worded.length = 0;
  // A sentence the reading could not place in a language: their choice answers it.
  await handleNovaTurn({
    platformChatId: learner, text: "I keep putting things off and I want to talk about it", onboardingDone: true, surface: "web",
    awaitPersistence: true, timestamp: new Date(), respond, understand: understandAs({ ...BASE, request: { ...REQ, language: null } }),
  });
  const turn = worded.at(-1);
  assert.ok(turn, "the Response Brain was asked to word the reply");
  assert.match(turn!.prompt, /Language: Hinglish\./);
  assert.match(turn!.prompt, /Register: direct\./);
  assert.match(turn!.layer, /## How to help \(their own answer\)/);
  assert.match(turn!.layer, /Procrastination or getting started: make the first step small enough to start now/);
  assert.match(turn!.layer, /Working on \(their own answer at sign-up/);
});

test("what they write in wins over their choice", async () => {
  const learner = await readyLearner();
  worded.length = 0;
  await handleNovaTurn({
    platformChatId: learner, text: "Can we just chat for a minute about my week", onboardingDone: true, surface: "web",
    awaitPersistence: true, timestamp: new Date(), respond, understand: understandAs({ ...BASE, request: { ...REQ, language: "english" } }),
  });
  const turn = worded.at(-1);
  assert.ok(turn);
  assert.doesNotMatch(turn!.prompt, /Language: Hinglish/);
});
