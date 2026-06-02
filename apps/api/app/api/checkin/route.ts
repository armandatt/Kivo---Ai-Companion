//@ts-ignore
import { generateCompanionVisit, generateDynamicCheckIn } from "@repo/api/services/checkin.service";
//@ts-ignore
import { getUsersForCompanionVisitAt, getUsersDueForDynamicCheckIn, advanceDynamicCheckIn } from "@repo/api/services/user.service";
//@ts-ignore
import { addToShortTerm } from "@repo/api/services/memory.service";
//@ts-ignore
import { formatMessengerText } from "@repo/api/services/formatter.service";
//@ts-ignore
import { runGymCronJobs } from "@repo/api/services/gymCron.service";
import { prisma } from "@repo/db/client";

export const runtime = "nodejs";

type CompanionVisitKind =
  | "morning"
  | "basic_2h"
  | "major_4h"
  | "basic_6h"
  | "major_8h"
  | "basic_10h"
  | "evening";

export async function GET() {
  const now = new Date();
  console.log(`[CHECKIN] Cron fired at ${now.toISOString()}`);

  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) {
    console.error("[CHECKIN] TELEGRAM_BOT_TOKEN or BOT_TOKEN not set — cron will not send messages");
    return Response.json({ ok: false, error: "Telegram bot token missing" }, { status: 500 });
  }

  const users = await getUsersForCompanionVisitAt(now);
  console.log(`[CHECKIN] Fixed daily visits due: ${users.length}`);
  let sent = 0;

  for (const user of users) {
    const userId = user.platformChatId;

    if (!(await wasVisitSentToday(userId, user.visitKind, now))) {
      console.log(`[CHECKIN] Sending ${user.visitKind} to ${userId}`);
      const message = await generateCompanionVisit(userId, user.visitKind);

      await sendTelegramMessage(userId, message);
      await addToShortTerm(userId, message, {
        role: "assistant",
        intent: user.visitKind,
        emotion: "neutral",
      });
      sent += 1;
      console.log(`[CHECKIN] Sent ${user.visitKind} to ${userId}`);
    } else {
      console.log(`[CHECKIN] Skipping ${userId} (${user.visitKind}) — already sent today`);
    }
  }

  const dynamicUsers = await getUsersDueForDynamicCheckIn(now);
  console.log(`[CHECKIN] Dynamic users due: ${dynamicUsers.length}`);

  for (const user of dynamicUsers) {
    const userId = user.platformChatId;

    await advanceDynamicCheckIn(userId, user.checkInIntervalMin ?? null, now);
    console.log(`[CHECKIN] Dynamic check-in firing for ${userId} (interval: ${user.checkInIntervalMin ?? "one-shot"})`);

    const message = await generateDynamicCheckIn(userId);
    await sendTelegramMessage(userId, message);
    await addToShortTerm(userId, message, {
      role: "assistant",
      intent: "dynamic_checkin",
      emotion: "neutral",
    });

    sent += 1;
    console.log(`[CHECKIN] Dynamic message sent to ${userId}`);
  }

  const gymMessages = await runGymCronJobs(now);
  for (const message of gymMessages) {
    await sendTelegramMessage(message.chatId, message.text);
    await addToShortTerm(message.chatId, message.text, {
      role: "assistant",
      intent: message.intent,
      emotion: "neutral",
    });
    sent += 1;
  }

  return Response.json({ ok: true, sent });
}

async function wasVisitSentToday(
  platformChatId: string,
  visitKind: CompanionVisitKind,
  now: Date
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const user = await prisma.messengerUser.findUnique({
    where: {
      platform_platformChatId: {
        platform: "telegram",
        platformChatId,
      },
    },
    select: {
      messages: {
        where: {
          role: "assistant",
          intent: visitKind,
          createdAt: {
            gte: start,
          },
        },
        select: { id: true },
        take: 1,
      },
    },
  });

  return Boolean(user?.messages.length);
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) {
    console.error("[CHECKIN] TELEGRAM_BOT_TOKEN or BOT_TOKEN not set — skipping send");
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
