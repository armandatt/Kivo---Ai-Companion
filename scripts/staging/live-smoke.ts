// Live smoke test of Nova on Telegram, against STAGING only.
//
//   npx tsx --tsconfig tsconfig.json scripts/staging/live-smoke.ts                 dry run: checks every target, lists the steps, sends nothing
//   … scripts/staging/live-smoke.ts --live                                         runs the steps
//   … --live --only=L01,L02,L05    --delay-ms=4000    --timeout-ms=45000    --continue-on-failure
//
// Environment (never printed): STAGING_API_URL, STAGING_DATABASE_URL,
// STAGING_TELEGRAM_BOT_TOKEN, STAGING_BOT_USERNAME, STAGING_TELEGRAM_WEBHOOK_SECRET,
// STAGING_TEST_CHAT_ID; optional STAGING_EXPECT_COMMIT (12 characters, as /api/health reports it).
//
// How a step runs. A bot cannot write to itself, and no personal Telegram
// session is used. So each step is posted to the staging webhook as the update
// Telegram would deliver for the test chat, signed with the staging webhook
// secret, with a negative update_id (Telegram's are positive, so they never
// collide). The staging API handles it exactly as a real one, and its reply
// goes out through the real Telegram API to the test chat. Each step is then
// checked in the staging database: the prompt it opened and the Telegram
// message id Telegram gave it, the delivery time on the channel, the reply in
// the conversation log, and the rows the step must or must not have changed.
//
// Before anything is sent: the bot is the staging bot and not production, its
// webhook points at the staging API, the API is not production and is up,
// the database is not production, and the chat belongs to the seeded staging
// learner (scripts/staging/seed-test-learner.ts) with no session open and no
// plan change today. Steps are at least 3 seconds apart. It stops at the
// first failure unless --continue-on-failure.

import { GuardError, TEST_LEARNER_MARK, assertStagingApi, assertStagingBot, assertStagingDatabase, assertWebhookTarget, botCall, loadStagingEnv, log, redact, stagingPrisma } from "./guard";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
const LIVE      = process.argv.includes("--live");
const STOP      = !process.argv.includes("--continue-on-failure");
const DELAY_MS  = Math.max(3_000, Number(arg("delay-ms") ?? 3_000));
const TIMEOUT   = Math.max(5_000, Number(arg("timeout-ms") ?? 45_000));
const VERIFY_MS = 10_000;
const ONLY      = arg("only")?.split(",").map(s => s.trim().toUpperCase()) ?? null;
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

type Prisma = Awaited<ReturnType<typeof stagingPrisma>>;
interface Ctx {
  prisma: Prisma; profileId: string; userId: string; chat: number; runStart: Date;
  saved: Record<string, string>;      // callback data kept for a repeat tap
  card: string | null;                // the start card a step expects to stay open
  outbox: number;                     // proactive rows when the run began
}
interface Step {
  id: string; what: string; model?: boolean;
  send: (c: Ctx) => Promise<{ kind: "message"; text: string } | { kind: "tap"; data: string; label: string }>;
  check: (c: Ctx, since: Date) => Promise<string | null>;   // null: passed; else why not
}

// ── Reading the staging record ────────────────────────────────────────────────

const openPrompt = (c: Ctx) => c.prisma.novaTelegramPrompt.findFirst({
  where: { profileId: c.profileId, openKey: { not: null }, expiresAt: { gt: new Date() } },
  select: { id: true, kind: true, options: true, telegramMessageId: true, createdAt: true },
});
const optionsOf = (p: { options: unknown } | null) => (Array.isArray(p?.options) ? p!.options : []) as Array<{ id: string; label: string }>;
const delivered = async (c: Ctx, since: Date) =>
  ((await c.prisma.novaTelegramChannel.findUnique({ where: { profileId: c.profileId }, select: { lastDeliveredAt: true } }))?.lastDeliveredAt ?? new Date(0)) >= since;
const lastReply = async (c: Ctx, since: Date) =>
  (await c.prisma.companionMessage.findFirst({ where: { userId: c.userId, role: "assistant", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { text: true } }))?.text ?? null;
const changesToday = (c: Ctx) => c.prisma.novaPlanOverride.count({ where: { profileId: c.profileId, createdAt: { gte: c.runStart } } });
const sessionsSince = (c: Ctx) => c.prisma.novaStudySession.findMany({ where: { profileId: c.profileId, createdAt: { gte: c.runStart } }, select: { status: true } });
const outboxCount = (c: Ctx) => c.prisma.novaProactiveMessage.count({ where: { profileId: c.profileId } });

async function tapOption(c: Ctx, pick: (label: string) => boolean, keep?: string) {
  const prompt = await openPrompt(c);
  const option = optionsOf(prompt).find(o => pick(o.label));
  if (!prompt || !option) throw new GuardError(`no open option to tap (${optionsOf(prompt).map(o => o.label).join(", ") || "no prompt"})`);
  const data = `p:${prompt.id}:${option.id}`;
  if (keep) c.saved[keep] = data;
  return { kind: "tap" as const, data, label: option.label };
}
const msg = (text: string) => async () => ({ kind: "message" as const, text });
const all = (...reasons: Array<string | null>) => reasons.find(r => r !== null) ?? null;
const must = (ok: boolean, why: string) => ok ? null : why;

// ── The steps ────────────────────────────────────────────────────────────────

const STEPS: Step[] = [
  { id: "L01", what: "/help is delivered and resets this chat's menu to include /week and /progress", send: msg("/help"),
    check: async (c, since) => {
      const menu = await botCall(process.env.STAGING_TELEGRAM_BOT_TOKEN!.trim(), "getMyCommands", { scope: { type: "chat", chat_id: c.chat } }) as Array<{ command: string }>;
      return all(must(await delivered(c, since), "not delivered"), must(menu.some(m => m.command === "week") && menu.some(m => m.command === "progress"), `menu is ${menu.map(m => m.command).join(",")}`));
    } },
  { id: "L02", what: "/today opens a start card that Telegram accepted", send: msg("/today"),
    check: async (c, since) => {
      const p = await openPrompt(c);
      c.card = p?.id ?? null;
      return all(must(p?.kind === "start" && p.createdAt >= since, `open prompt is ${p?.kind ?? "none"}`), must(p?.telegramMessageId != null, "no Telegram message id"));
    } },
  { id: "L03", what: "/week is delivered and leaves the card open", send: msg("/week"),
    check: async (c, since) => all(must(await delivered(c, since), "not delivered"), must((await openPrompt(c))?.id === c.card, "the card was replaced")) },
  { id: "L04", what: "/progress is delivered and leaves the card open", send: msg("/progress"),
    check: async (c, since) => all(must(await delivered(c, since), "not delivered"), must((await openPrompt(c))?.id === c.card, "the card was replaced")) },
  { id: "L05", model: true, what: "\"What is my next one-week plan?\" gets the week, not the card", send: msg("What is my next one-week plan?"),
    check: async (c, since) => {
      const reply = await lastReply(c, since);
      return all(must(reply?.startsWith("Next 7 days") ?? false, "the reply is not the week"), must((await openPrompt(c))?.id === c.card, "the card was replaced"), must((await sessionsSince(c)).length === 0, "a session started"));
    } },
  { id: "L06", model: true, what: "\"Aaj ke plans update karne hain\" opens the change flow and changes nothing", send: msg("Aaj ke plans update karne hain"),
    check: async c => {
      const p = await openPrompt(c);
      return all(must(p?.kind === "change_plan" && p.telegramMessageId != null, `open prompt is ${p?.kind ?? "none"}`), must(await changesToday(c) === 0, "a change was written"));
    } },
  { id: "L07", what: "tapping Skip writes one skip for today", send: c => tapOption(c, l => l.startsWith("Skip: ")),
    check: async c => must(await changesToday(c) === 1, "not exactly one plan change") },
  { id: "L08", what: "Undo takes it back", send: c => tapOption(c, l => l === "Undo", "undo"),
    check: async c => must(await changesToday(c) === 0, "the skip is still there") },
  { id: "L09", what: "the same Undo again changes nothing", send: async c => ({ kind: "tap" as const, data: c.saved["undo"]!, label: "Undo (again)" }),
    check: async c => must(await changesToday(c) === 0, "something changed") },
  { id: "L10", model: true, what: "\"skip krde aaj deadlocks\" asks to confirm leaving Deadlocks out, and does not quiet Nova for the day", send: msg("skip krde aaj deadlocks"),
    check: async c => {
      const p = await openPrompt(c);
      const paused = (await c.prisma.novaTelegramChannel.findUnique({ where: { profileId: c.profileId }, select: { proactivePausedUntil: true } }))?.proactivePausedUntil;
      return all(must(optionsOf(p).map(o => o.label).join("|") === "Skip it today|Keep it", `options are ${optionsOf(p).map(o => o.label).join(", ")}`), must(!paused || paused < c.runStart, "nudges were paused"));
    } },
  { id: "L11", what: "Keep it changes nothing", send: c => tapOption(c, l => l === "Keep it"),
    check: async c => must(await changesToday(c) === 0, "a change was written") },
  { id: "L12", model: true, what: "\"kuch Deep Learning se related bata\" offers their Deep Learning topics", send: msg("Ye hi padhna hai, kuch Deep Learning se related bata"),
    check: async c => {
      const labels = optionsOf(await openPrompt(c)).map(o => o.label);
      return must(labels.some(l => l.startsWith("Backpropagation") || l.startsWith("CNNs")), `offered ${labels.join(", ")}`);
    } },
  { id: "L13", model: true, what: "\"How is my progress going?\" gets progress from the record", send: msg("How is my progress going?"),
    check: async (c, since) => {
      const reply = await lastReply(c, since);
      return must(Boolean(reply && (reply.startsWith("No counted study sessions") || reply.startsWith("Your progress"))), "the reply is not progress");
    } },
  { id: "L14", model: true, what: "a reminder request says nothing was scheduled and stores nothing", send: msg("remind me at 8 pm to study"),
    check: async (c, since) => {
      const reply = await lastReply(c, since);
      return all(must(reply?.startsWith("I can't set a reminder") ?? false, "the reply does not say so"), must(await outboxCount(c) === c.outbox, "the outbox changed"));
    } },
  { id: "L15", what: "/focus opens a start card", send: msg("/focus"),
    check: async c => must((await openPrompt(c))?.kind === "start", "no start card") },
  { id: "L16", what: "Start 25 min opens one session", send: c => tapOption(c, l => l === "Start 25 min"),
    check: async c => { const s = await sessionsSince(c); return must(s.length === 1 && s[0]!.status === "in_progress", `sessions: ${s.map(x => x.status).join(",")}`); } },
  { id: "L17", what: "/done asks how it went", send: msg("/done"),
    check: async c => must((await openPrompt(c))?.kind === "session_outcome", "no outcome question") },
  { id: "L18", what: "Good ends the session", send: c => tapOption(c, l => l === "Good", "good"),
    check: async c => { const s = await sessionsSince(c); return must(s.length === 1 && s[0]!.status === "completed", `sessions: ${s.map(x => x.status).join(",")}`); } },
  { id: "L19", what: "the same Good again changes nothing", send: async c => ({ kind: "tap" as const, data: c.saved["good"]!, label: "Good (again)" }),
    check: async c => { const s = await sessionsSince(c); return must(s.length === 1 && s[0]!.status === "completed", `sessions: ${s.map(x => x.status).join(",")}`); } },
  // Reply language follows the message (staging, 18 October: L13 and L14 were
  // answered in Hinglish after a Hinglish message). Strict both ways.
  { id: "L20", model: true, what: "a Hinglish reminder request gets the Hinglish refusal, and stores nothing", send: msg("mujhe raat 8 baje padhai ke liye yaad dila dena"),
    check: async (c, since) => {
      const reply = await lastReply(c, since);
      return all(must(reply?.startsWith("Abhi kisi fixed time ka reminder set nahi ho sakta") ?? false, "the reply is not the Hinglish refusal"), must(await outboxCount(c) === c.outbox, "the outbox changed"));
    } },
  { id: "L21", model: true, what: "straight after it, \"How is my progress going?\" is answered in English", send: msg("How is my progress going?"),
    check: async (c, since) => {
      const reply = await lastReply(c, since);
      return must(Boolean(reply && (reply.startsWith("No counted study sessions") || reply.startsWith("Your progress"))), "the reply is not English progress");
    } },
];

// ── Sending ──────────────────────────────────────────────────────────────────

let seq = 0;
const baseId = -Math.floor(Date.now() / 1000) * 100;   // negative: never a real Telegram update_id
function update(c: Ctx, body: { kind: "message"; text: string } | { kind: "tap"; data: string }) {
  const from = { id: c.chat, is_bot: false, first_name: "Nova staging tester" };
  const chat = { id: c.chat, type: "private" };
  const update_id = baseId - (++seq);
  return body.kind === "message"
    ? { update_id, message: { message_id: seq, date: Math.floor(Date.now() / 1000), chat, from, text: body.text } }
    : { update_id, callback_query: { id: `smoke-${-update_id}`, data: body.data, from, chat_instance: "staging-smoke", message: { message_id: seq, date: Math.floor(Date.now() / 1000), chat } } };
}
async function post(apiUrl: string, secret: string, payload: unknown): Promise<number> {
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/telegram`, {
    method: "POST", headers: { "Content-Type": "application/json", [SECRET_HEADER]: secret }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT),
  });
  return res.status;
}
async function eventually(check: () => Promise<string | null>): Promise<string | null> {
  const until = Date.now() + VERIFY_MS;
  let why: string | null = "not checked";
  while (Date.now() < until) {
    why = await check();
    if (why === null) return null;
    await new Promise(r => setTimeout(r, 500));
  }
  return why;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const env = loadStagingEnv(["apiUrl", "databaseUrl", "botToken", "botUsername", "webhookSecret", "chatId"]);
  assertStagingApi(env.apiUrl);
  assertStagingDatabase(env.databaseUrl);
  const bot = await assertStagingBot(env.botToken, env.botUsername);
  await assertWebhookTarget(env.botToken, env.apiUrl);
  const health = await fetch(`${env.apiUrl.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(90_000) }).then(r => r.json()) as { ok?: boolean; commit?: string | null };
  if (!health.ok) throw new GuardError("the staging API is not healthy");
  const expect = process.env.STAGING_EXPECT_COMMIT?.trim();
  if (expect && health.commit !== expect) throw new GuardError(`staging runs ${health.commit}, not ${expect}`);
  log({ preflight: "targets", bot: `@${bot.username}`, apiCommit: health.commit, live: LIVE });

  const prisma = await stagingPrisma(env.databaseUrl);
  try {
    const user = await prisma.messengerUser.findUnique({
      where: { platform_platformChatId: { platform: "telegram", platformChatId: env.chatId } },
      select: { id: true, persona: true, novaAcademicProfile: { select: { id: true, goals: true, timezone: true } } },
    });
    const profile = user?.novaAcademicProfile;
    if (!user || !profile || user.persona !== "nova" || !profile.goals.includes(TEST_LEARNER_MARK)) {
      throw new GuardError("the chat is not the seeded staging test learner (run seed-test-learner.ts)");
    }
    const runStart = new Date();
    const ctx: Ctx = { prisma, profileId: profile.id, userId: user.id, chat: Number(env.chatId), runStart, saved: {}, card: null, outbox: 0 };
    const open = await prisma.novaStudySession.count({ where: { profileId: profile.id, status: { in: ["in_progress", "paused"] } } });
    if (open > 0) throw new GuardError("the test learner has a session open; end it or reseed with --reset");
    const steps = STEPS.filter(s => !ONLY || ONLY.includes(s.id));
    log({ preflight: "learner", ok: true, steps: steps.map(s => s.id), delayMs: DELAY_MS, timeoutMs: TIMEOUT, stopOnFailure: STOP });
    if (!LIVE) {
      for (const s of steps) log({ id: s.id, plan: s.what, modelDependent: Boolean(s.model) });
      log({ done: "dry_run", sent: 0 });
      return;
    }

    ctx.outbox = await outboxCount(ctx);
    let failed = 0;
    for (const step of steps) {
      const since = new Date();
      const started = Date.now();
      let outcome: "pass" | "fail" = "pass";
      let reason: string | null = null;
      let input = "";
      try {
        const body = await step.send(ctx);
        input = body.kind === "message" ? body.text : `tap "${body.label}"`;
        const status = await post(env.apiUrl, env.webhookSecret, update(ctx, body));
        if (status !== 200) throw new GuardError(`webhook answered ${status}`);
        reason = await eventually(() => step.check(ctx, since));
      } catch (err) {
        reason = err instanceof Error ? err.message : String(err);
      }
      if (reason !== null) { outcome = "fail"; failed++; }
      log({ id: step.id, what: step.what, input, outcome, ms: Date.now() - started, modelDependent: Boolean(step.model), ...(reason ? { reason: redact(reason) } : {}) });
      if (outcome === "fail" && STOP) { log({ done: "stopped", at: step.id }); process.exitCode = 1; return; }
      await sleep(DELAY_MS);
    }
    log({ done: failed === 0 ? "passed" : "failed", steps: steps.length, failed });
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  log({ done: "refused", reason: err instanceof GuardError ? err.message : redact((err as Error).message) });
  process.exit(1);
});
