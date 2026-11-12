//@ts-ignore
import { runNovaProactiveCron } from "@repo/api/nova/proactive/nova-proactive-cron";
//@ts-ignore
import { runEventReminders } from "@repo/api/nova/proactive/event-reminders";
//@ts-ignore
import { purgeProcessedTelegramUpdates } from "@repo/api/services/telegramTransport.service";
//@ts-ignore
import { processWaitingResources } from "@repo/api/nova/product/resource-processing";
//@ts-ignore
import { startInteraction } from "@repo/api/services/llm-usage";
//@ts-ignore
import { createHousekeepingGate } from "@repo/api/services/schedulerGate";
//@ts-ignore
import type { ProactiveOutlook } from "@repo/api/nova/proactive/proactive-outlook";

// The scheduled jobs, one tick. Nova only: Nova's proactive messages, the
// calendar reminders learners set, saved pages still waiting, and Nova's
// housekeeping (abandoned sessions, consolidation retries, purges).
//
// Rex is not part of Kivo and none of its jobs run here (dynamic check-ins,
// custom reminders, the gym and web-gym jobs). Their code stays in
// packages/api/src/services for the Rex Telegram path until Rex is removed;
// do not call it from here. Held by scheduler-nova-only.test.ts.

export type CheckinCronResult = {
  ok: boolean;
  sent: number;
  error?: string;
  // What Nova's proactive job did this tick: how many learners it looked at
  // and how each ended. Counts only, for the health check.
  nova?: { checked: number; sent: number; errors: number; outcomes: Record<string, number> };
  // What each job did, as counts (sent, found due, looked at, closed). Any
  // non-zero count is work. For the scheduler's shadow check: a tick it would
  // have skipped must have none (services/schedulerIdle.ts).
  work: Record<string, number>;
  // What Nova's job learned about each learner, kept by the scheduler to
  // decide later ticks without the database. null: not read.
  novaOutlooks: Array<ProactiveOutlook | null> | null;
};

// Nova outcomes that mean a message was, or may have been, on its way.
const NOVA_WORK = new Set(["sent", "send_failed", "held", "claimed_elsewhere", "error"]);

// One tick, one background interaction for its usage events. Nova's
// proactive messages and saved pages each open their own.
export async function runCheckinCron(now = new Date()): Promise<CheckinCronResult> {
  return startInteraction({ feature: "other", surface: "background", isBackground: true, requestId: `tick:${now.toISOString()}` }, () => runTick(now));
}

// Retention purges run once an hour, not every tick (services/schedulerGate.ts).
const housekeepingDue: (now: Date) => boolean = createHousekeepingGate();

async function runTick(now: Date): Promise<CheckinCronResult> {
  console.log(`[CHECKIN] Cron fired at ${now.toISOString()}`);

  const housekeeping = housekeepingDue(now);
  // Housekeeping: drop webhook dedup rows past their retention window.
  if (housekeeping) {
    await purgeProcessedTelegramUpdates(now).catch((err: unknown) => console.error("[CHECKIN] update purge failed", err));
  }

  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) {
    console.error("[CHECKIN] TELEGRAM_BOT_TOKEN or BOT_TOKEN not set");
    return { ok: false, sent: 0, error: "Telegram bot token missing", work: {}, novaOutlooks: null };
  }

  let sent = 0;
  const work: Record<string, number> = {};
  const add = (job: string, n: number) => { if (n > 0) work[job] = (work[job] ?? 0) + n; };

  // ── Nova proactive mentor (academic coaching) ─────────────────────────────
  const novaResult = await runNovaProactiveCron(now, { housekeeping }).catch((err: unknown) => {
    console.error("[CHECKIN] Nova proactive cron failed:", err);
    return { ok: false, sent: 0, checked: 0, errors: 1, outcomes: {} as Record<string, number>, outlooks: undefined, abandoned: 0, consolidationRetried: 0 };
  });
  sent += novaResult.sent;
  for (const [outcome, n] of Object.entries(novaResult.outcomes ?? {})) if (NOVA_WORK.has(outcome)) add(`nova_${outcome}`, n as number);
  add("nova_session_abandoned", novaResult.abandoned ?? 0);
  add("nova_consolidation_retry", novaResult.consolidationRetried ?? 0);
  console.log(`[CHECKIN] Nova proactive: ${novaResult.sent}/${novaResult.checked} sent, ${novaResult.errors} errors`);

  // ── Calendar reminders the learner set (same outbox, own type) ────────────
  try {
    const reminders = await runEventReminders(now);
    sent += reminders.sent;
    add("calendar_reminder", reminders.checked);
    for (const [outcome, n] of Object.entries(reminders.outcomes ?? {})) {
      if (outcome.startsWith("retry_") || outcome === "missed_moved_on") add(`calendar_${outcome}`, n as number);
    }
    if (reminders.checked > 0 || reminders.errors > 0) {
      console.log(`[CHECKIN] Calendar reminders: ${reminders.sent}/${reminders.checked} sent, ${reminders.errors} errors`);
    }
  } catch (err) {
    console.error("[CHECKIN] calendar reminders failed:", err);
  }

  // ── Saved pages still waiting to be looked at ─────────────────────────────
  // The save route starts this itself; the tick finishes what a restart or a
  // failed model call left behind. It sends nothing.
  try {
    const pages = await processWaitingResources(new Date(), 5);
    add("saved_page", pages.checked);
    if (pages.checked > 0) console.log(`[CHECKIN] Nova saved pages: ${pages.done}/${pages.checked} looked at, ${pages.failed} failed`);
  } catch (err) {
    console.error("[CHECKIN] Nova saved pages failed:", err);
  }

  return {
    ok: true, sent, nova: { checked: novaResult.checked, sent: novaResult.sent, errors: novaResult.errors, outcomes: novaResult.outcomes ?? {} },
    work,
    // Nova's view of each learner; null when its job failed or was switched
    // off before looking (NOVA_PROACTIVE_DISABLED: then nothing is sent, and
    // an empty list says so).
    novaOutlooks: novaResult.outlooks ?? null,
  };
}
