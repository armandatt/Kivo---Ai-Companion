/**
 * Web onboarding v2 — real Postgres integration test.
 *
 * What it proves: the answers are stored where Nova reads them, through the
 * same readers every surface uses (the account preferences adapter, the
 * personality module, the goal seed); onboarding completes once, whether the
 * second request comes after or alongside the first; the companion's name is
 * only a display name; and the learner can correct what they said.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
delete process.env.PERSONALITY_SIGNAL_ENABLED;

const { prisma } = await import("@repo/db/client");
const { checkOnboardingV2 } = await import("../product/onboarding-answers.js");
const { completeOnboardingOnce, profileFromAnswers } = await import("../product/onboarding-completion.js");
const { saveStyleAssessment, restateStyle, getCoachingStyleForChat } = await import("../../personality/personality.service.js");
const { loadFirstFocus, loadLearningContexts } = await import("../adapters/account-preferences-adapter.js");
const { loadAccountabilityStyle } = await import("../adapters/operating-style-adapter.js");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");
const { loadSetup } = await import("../product/setup.js");
const { companionOf } = await import("../product/companion.js");

const STAMP = Date.now();
const users: string[] = [];

async function account(): Promise<string> {
  const u = await prisma.user.create({ data: { email: `onb_${STAMP}_${users.length}@example.test`, name: "Asha" }, select: { id: true } });
  users.push(u.id);
  return u.id;
}

const ANSWERS = {
  version: 2, audience: "working", firstFocus: { id: "exam", detail: "AWS exam in December" },
  accountabilityStyle: "hard", style: { explanation: "example_first", feedback: "direct", pacing: "full_picture" }, companionName: "Kivi",
};

// What the onboarding route does with a valid v2 body.
async function finish(userId: string, body: unknown = ANSWERS) {
  const checked = checkOnboardingV2(body);
  assert.ok(checked.ok);
  if (!checked.ok) throw new Error("invalid");
  const { profileData } = profileFromAnswers(checked.answers, "Asia/Kolkata");
  const outcome = await completeOnboardingOnce(userId, profileData);
  if (outcome === "completed") await saveStyleAssessment(userId, checked.answers.style);
  return outcome;
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: users.map(u => `web:${u}`) } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("the answers are stored where Nova reads them, and reach every reader", async () => {
  const userId = await account();
  assert.equal(await finish(userId), "completed");
  const learner = `web:${userId}`;

  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId } });
  assert.equal(profile.onboardingComplete, true);
  assert.equal(profile.primaryPersona, "nova");
  assert.equal(profile.creatureName, "Kivi");
  assert.equal(profile.creatureColor, null);
  assert.equal(profile.creatureType, null);
  assert.equal(profile.primaryGoal30d, "Prepare for a certification or interview: AWS exam in December");
  assert.deepEqual(profile.aspirationWords, []);
  // Only the canonical answers are kept with the profile; the preference
  // answers live as an assessment.
  assert.deepEqual(profile.onboardingAnswers, { version: 2, learningContexts: ["working"], firstFocus: { id: "exam", detail: "AWS exam in December" } });

  assert.deepEqual(await loadLearningContexts(learner), ["working"]);
  assert.deepEqual(await loadFirstFocus(learner), { id: "exam", detail: "AWS exam in December" });
  assert.equal(await loadAccountabilityStyle(learner), "hard");
  const style = await getCoachingStyleForChat(learner);
  assert.equal(style.stated, true, "stated preferences need no flag");
  assert.deepEqual(style.lines, [
    "Asked for a worked example before the general idea.",
    "When they get something wrong, say plainly what is wrong and how to fix it.",
    "When there is a lot to do, lay out the whole list in order before the first step.",
  ]);

  // The account becomes a Nova learner as before; the name changes nothing about who it is.
  assert.equal(companionOf({ primaryPersona: profile.primaryPersona, hasLinkedChat: false, messengerPersona: undefined }), "nova");
  const resolved = await resolveLearnerForAccount(userId);
  assert.equal((resolved as { kind?: string }).kind, "learner");
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: { contains: "Kivi" } } }), 0);

  // The setup page leads with what they asked for first.
  const setup = await loadSetup(learner);
  assert.ok(setup, "the learner made above has a setup view");
  assert.deepEqual(setup!.firstFocus, { id: "exam", detail: "AWS exam in December" });
  assert.deepEqual(setup!.templateIds.slice(0, 2), ["certification", "interview-preparation"]);
});

test("onboarding completes once: a retry, and two requests at once, write nothing more", async () => {
  const userId = await account();
  assert.equal(await finish(userId), "completed");
  const changed = { ...ANSWERS, companionName: "Someone else", audience: "school" };
  assert.equal(await finish(userId, changed), "already_complete");
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId } });
  assert.equal(profile.creatureName, "Kivi", "the second request changed nothing");
  assert.equal(await prisma.personalityAssessment.count({ where: { userId } }), 1, "one assessment, not two");

  const racer = await account();
  const outcomes = await Promise.all([finish(racer), finish(racer), finish(racer)]);
  assert.deepEqual(outcomes.filter(o => o === "completed").length, 1);
  assert.equal(await prisma.personalityAssessment.count({ where: { userId: racer } }), 1);
});

test("an account part-way through (a profile, not complete) completes once too", async () => {
  const userId = await account();
  await prisma.userProfile.create({ data: { userId, secondaryDomains: [], aspirationWords: [], onboardingComplete: false } });
  assert.equal(await finish(userId), "completed");
  assert.equal(await finish(userId), "already_complete");
});

test("the learner can correct their preferences; the newest answer is the one used", async () => {
  const userId = await account();
  await finish(userId);
  const r = await restateStyle(userId, { explanation: "step_by_step", feedback: "hint", pacing: "one_thing" });
  assert.ok(r.ok);
  const style = await getCoachingStyleForChat(`web:${userId}`);
  assert.equal(style.lines[0], "Asked for explanations step by step: one small piece at a time, in order.");
  assert.ok(!(await restateStyle(userId, { explanation: "step_by_step" })).ok, "an incomplete set changes nothing");
  assert.equal((await getCoachingStyleForChat(`web:${userId}`)).lines[0], "Asked for explanations step by step: one small piece at a time, in order.");
});
