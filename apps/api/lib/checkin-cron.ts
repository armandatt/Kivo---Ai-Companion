//@ts-ignore
import { generateDynamicCheckIn } from "@repo/api/services/checkin.service";
//@ts-ignore
import { getUsersDueForDynamicCheckIn, advanceDynamicCheckIn, clearStaleCheckIns } from "@repo/api/services/user.service";
//@ts-ignore
import { addToShortTerm } from "@repo/api/services/memory.service";
//@ts-ignore
import { formatMessengerText } from "@repo/api/services/formatter.service";
//@ts-ignore
import { runGymCronJobs } from "@repo/api/services/gymCron.service";
//@ts-ignore
import { fireCustomReminders } from "@repo/api/services/customReminder.service";
//@ts-ignore
import { runNovaProactiveCron } from "@repo/api/nova/proactive/nova-proactive-cron";
//@ts-ignore
import { purgeProcessedTelegramUpdates } from "@repo/api/services/telegramTransport.service";

export type CheckinCronResult = {
  ok: boolean;
  sent: number;
  error?: string;
};

export async function runCheckinCron(now = new Date()): Promise<CheckinCronResult> {
  console.log(`[CHECKIN] Cron fired at ${now.toISOString()}`);

  // Housekeeping: drop webhook dedup rows past their retention window.
  await purgeProcessedTelegramUpdates(now).catch((err: unknown) => console.error("[CHECKIN] update purge failed", err));

  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) {
    console.error("[CHECKIN] TELEGRAM_BOT_TOKEN or BOT_TOKEN not set");
    return { ok: false, sent: 0, error: "Telegram bot token missing" };
  }

  let sent = 0;

  // ── Dynamic user-requested check-ins ("check me in 30 min") ──────────────
  // Its own try: a failure here must not stop the jobs after it.
  try {
    await clearStaleCheckIns(now).catch(() => {});

    const dynamicUsers = await getUsersDueForDynamicCheckIn(now);
    console.log(`[CHECKIN] Dynamic users due: ${dynamicUsers.length}`);

    for (const user of dynamicUsers) {
      const userId = user.platformChatId;
      await advanceDynamicCheckIn(userId, user.checkInIntervalMin ?? null, now);
      const message = await generateDynamicCheckIn(userId);
      await sendTelegramMessage(userId, message);
      await addToShortTerm(userId, message, { role: "assistant", intent: "dynamic_checkin", emotion: "neutral" });
      sent += 1;
      console.log(`[CHECKIN] Dynamic message sent to ${userId}`);
    }
  } catch (err) {
    console.error("[CHECKIN] dynamic check-ins failed:", err);
  }

  // ── Custom user-set reminders ("remind me at 8am to...") ─────────────────
  // Its own try: a failure here must not stop the jobs after it.
  try {
    const reminderMessages = await fireCustomReminders(now);
    for (const msg of reminderMessages) {
      await sendTelegramMessage(msg.chatId, msg.text);
      await addToShortTerm(msg.chatId, msg.text, { role: "assistant", intent: "custom_reminder", emotion: "neutral" });
      sent += 1;
    }
  } catch (err) {
    console.error("[CHECKIN] custom reminders failed:", err);
  }

  // ── Gym cron jobs (Rex pre-session + evening accountability) ─────────────
  // Its own try: a failure here must not stop the jobs after it.
  try {
    const gymMessages = await runGymCronJobs(now);
    for (const message of gymMessages) {
      await sendTelegramMessage(message.chatId, message.text);
      await addToShortTerm(message.chatId, message.text, { role: "assistant", intent: message.intent, emotion: "neutral" });
      sent += 1;
    }
  } catch (err) {
    console.error("[CHECKIN] gym jobs failed:", err);
  }

  // ── Nova proactive mentor (academic coaching) ─────────────────────────────
  const novaResult = await runNovaProactiveCron(now).catch((err: unknown) => {
    console.error("[CHECKIN] Nova proactive cron failed:", err);
    return { ok: false, sent: 0, checked: 0, errors: 1 };
  });
  sent += novaResult.sent;
  console.log(`[CHECKIN] Nova proactive: ${novaResult.sent}/${novaResult.checked} sent, ${novaResult.errors} errors`);

  return { ok: true, sent };
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) {
    console.error("[CHECKIN] TELEGRAM_BOT_TOKEN or BOT_TOKEN not set - skipping send");
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: formatMessengerText(text) }),
  });

  if (!res.ok) {
    console.error(`[CHECKIN] Telegram send failed for ${chatId}: ${res.status}`);
  }
}
