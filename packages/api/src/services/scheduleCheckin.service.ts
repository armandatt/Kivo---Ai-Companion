import { prisma } from "@repo/db/client";

const MIN_INTERVAL_MIN = 15;

export async function scheduleCheckIn(platformChatId: string, text: string) {
  const parsed = parseCheckInRequest(text);

  if (!parsed) {
    return {
      scheduled: false,
      reply: "I can't schedule that — I didn't catch a time. Try: 'check me in 30 minutes' or 'check every hour'.",
    };
  }

  const { intervalMin, isRepeating } = parsed;

  if (intervalMin < MIN_INTERVAL_MIN) {
    return {
      scheduled: false,
      reply: `I won't check in more than once every ${MIN_INTERVAL_MIN} minutes. Set a longer interval.`,
    };
  }

  const nextCheckInAt = new Date(Date.now() + intervalMin * 60 * 1000);

  await prisma.messengerUser.updateMany({
    where: {
      platform: "telegram",
      platformChatId,
    },
    data: {
      nextCheckInAt,
      checkInIntervalMin: isRepeating ? intervalMin : null,
    },
  });

  const timeDesc = formatDuration(intervalMin);

  const reply = isRepeating
    ? `Scheduled. I'll check in every ${timeDesc}. Say "stop checking in" to cancel.`
    : `Got it. I'll check in ${timeDesc} from now.`;

  console.log(
    `[SCHEDULE] ${platformChatId}: nextCheckInAt=${nextCheckInAt.toISOString()}, interval=${isRepeating ? intervalMin + "min repeating" : "one-shot"}`
  );

  return { scheduled: true, reply };
}

export async function cancelCheckIn(platformChatId: string) {
  await prisma.messengerUser.updateMany({
    where: {
      platform: "telegram",
      platformChatId,
    },
    data: {
      nextCheckInAt: null,
      checkInIntervalMin: null,
    },
  });

  console.log(`[SCHEDULE] ${platformChatId}: check-in schedule cleared`);
  return { reply: "Done. No more scheduled check-ins." };
}

function parseCheckInRequest(text: string): { intervalMin: number; isRepeating: boolean } | null {
  const lower = text.toLowerCase();

  const isRepeating =
    /\b(every|each|keep checking|repeatedly)\b/.test(lower) ||
    /check(?: in| on me| me)?\s+every\b/.test(lower);

  const hourMatch = lower.match(/\b(\d{1,2})\s*(?:hour|hours?|hr|hrs?)\b/);
  if (hourMatch) {
    return { intervalMin: Number(hourMatch[1]) * 60, isRepeating };
  }

  const minuteMatch = lower.match(/\b(\d{1,3})\s*(?:min|mins?|minutes?)\b/);
  if (minuteMatch) {
    return { intervalMin: Number(minuteMatch[1]), isRepeating };
  }

  if (/every\s+hour\b/.test(lower) || /\bin\s+an?\s+hour\b/.test(lower)) {
    return { intervalMin: 60, isRepeating: /every/.test(lower) };
  }

  if (/half\s+an?\s+hour/.test(lower)) {
    return { intervalMin: 30, isRepeating: false };
  }

  return null;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}
