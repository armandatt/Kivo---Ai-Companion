// Seeds the one learner the live smoke test acts on, in the STAGING database.
//
//   STAGING_DATABASE_URL=… STAGING_TEST_CHAT_ID=… \
//     npx tsx --tsconfig tsconfig.json scripts/staging/seed-test-learner.ts            dry run: says what it would do
//   … scripts/staging/seed-test-learner.ts --apply                                     creates it
//   … scripts/staging/seed-test-learner.ts --apply --reset                             deletes that learner first, then creates it
//
// The chat id is the test account's private chat with the STAGING bot. It is
// read once from the staging bot's getUpdates, before its webhook is set.
// Nothing here touches Telegram. --reset deletes only a learner carrying the
// staging mark; any other row on that chat id is refused.

import { GuardError, TEST_LEARNER_MARK, loadStagingEnv, log, stagingPrisma } from "./guard";

const apply = process.argv.includes("--apply");
const reset = process.argv.includes("--reset");
const zone  = process.env.STAGING_TEST_TIMEZONE ?? "Asia/Kolkata";
const DAY   = 86_400_000;

async function main() {
  const env = loadStagingEnv(["databaseUrl", "chatId"]);
  if (!/^\d{3,20}$/.test(env.chatId)) throw new GuardError("STAGING_TEST_CHAT_ID must be a numeric private chat id");
  const prisma = await stagingPrisma(env.databaseUrl);
  try {
    const existing = await prisma.messengerUser.findUnique({
      where: { platform_platformChatId: { platform: "telegram", platformChatId: env.chatId } },
      select: { id: true, persona: true, novaAcademicProfile: { select: { goals: true } } },
    });
    const marked = existing?.novaAcademicProfile?.goals.includes(TEST_LEARNER_MARK) ?? false;
    if (existing && !marked) throw new GuardError("that chat id already has a learner that was not seeded for staging; refusing to touch it");
    if (existing && !reset) { log({ step: "seed", outcome: "exists", note: "pass --reset to recreate it" }); return; }

    const plan = {
      platform: "telegram", persona: "nova", timezone: zone,
      subjects: { "Operating Systems": ["Deadlocks (review due)", "Paging"], "Deep Learning": ["Backpropagation", "CNNs"] },
      channel: "lastDeliveredAt set, so /start is not a first message",
      deletesFirst: Boolean(existing && reset),
    };
    if (!apply) { log({ step: "seed", outcome: "dry_run", plan }); return; }

    if (existing && reset) await prisma.messengerUser.delete({ where: { id: existing.id } });
    const now = new Date();
    const user = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: env.chatId, persona: "nova", displayName: "Nova staging tester",
        novaAcademicProfile: { create: {
          onboardingComplete: true, timezone: zone, goals: [TEST_LEARNER_MARK], preferredStudyTime: "evening",
          subjects: { create: [{ name: "Operating Systems", code: "OS" }, { name: "Deep Learning" }] },
        } },
      },
      select: { novaAcademicProfile: { select: { id: true, subjects: { select: { id: true, name: true } } } } },
    });
    const profile = user.novaAcademicProfile!;
    const os = profile.subjects.find(s => s.name === "Operating Systems")!.id;
    const dl = profile.subjects.find(s => s.name === "Deep Learning")!.id;
    const ago = new Date(now.getTime() - 5 * DAY);
    await prisma.novaTopicMastery.createMany({ data: [
      { subjectId: os, name: "Deadlocks", masteryProbability: 0.45, confidenceReported: 0.5, reviewCount: 2, lastStudiedAt: ago, nextReviewAt: new Date(now.getTime() - DAY) },
      { subjectId: os, name: "Paging", masteryProbability: 0.7, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: ago, nextReviewAt: new Date(now.getTime() + 3 * DAY) },
      { subjectId: dl, name: "Backpropagation", masteryProbability: 0.9, confidenceReported: 0.9, reviewCount: 4, lastStudiedAt: ago, nextReviewAt: new Date(now.getTime() + 9 * DAY) },
      { subjectId: dl, name: "CNNs", masteryProbability: 0.9, confidenceReported: 0.9, reviewCount: 4, lastStudiedAt: ago, nextReviewAt: new Date(now.getTime() + 9 * DAY) },
    ] });
    await prisma.novaTelegramChannel.create({ data: { profileId: profile.id, lastDeliveredAt: now } });
    log({ step: "seed", outcome: "created", profileId: profile.id });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  log({ step: "seed", outcome: "refused", reason: err instanceof GuardError ? err.message : (err as Error).message });
  process.exit(1);
});
