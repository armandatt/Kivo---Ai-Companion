import { prisma } from "@repo/db/client";

// Minimum interval enforced to prevent spam
const MIN_INTERVAL_MIN = 10;
// Maximum interval (24 hours — beyond that, use the companion visit schedule instead)
const MAX_INTERVAL_MIN = 24 * 60;

export async function scheduleCheckIn(platformChatId: string, text: string) {
  const parsed = parseCheckInRequest(text);

  if (!parsed) {
    return {
      scheduled: false,
      reply: "I didn't catch a time. Try: 'check me in 30 minutes', 'text me after 1 hour', or 'remind me every 2 hours'.",
    };
  }

  const { intervalMin, isRepeating } = parsed;

  if (intervalMin < MIN_INTERVAL_MIN) {
    return {
      scheduled: false,
      reply: `Minimum interval is ${MIN_INTERVAL_MIN} minutes. Set a longer time.`,
    };
  }

  if (intervalMin > MAX_INTERVAL_MIN) {
    return {
      scheduled: false,
      reply: `That's over 24 hours. Use a check-in interval of up to 24 hours.`,
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
    ? `Scheduled. I'll check in every ${timeDesc}. Say "stop check-ins" to cancel.`
    : `Got it. I'll follow up ${timeDesc} from now.`;

  console.log(
    `[SCHEDULE] ${platformChatId}: nextCheckInAt=${nextCheckInAt.toISOString()}, ` +
    `interval=${isRepeating ? `${intervalMin}min repeating` : "one-shot"}`
  );

  return { scheduled: true, reply };
}

export async function cancelCheckIn(platformChatId: string) {
  await prisma.messengerUser.updateMany({
    where: { platform: "telegram", platformChatId },
    data: { nextCheckInAt: null, checkInIntervalMin: null },
  });

  console.log(`[SCHEDULE] ${platformChatId}: check-in schedule cleared`);
  return { reply: "Done. No more scheduled check-ins." };
}

// ── Parser ────────────────────────────────────────────────────────────────────
// Handles: "in X min", "after X min", "every X min", "every hour",
//          "in an hour", "half an hour", bare "30 min", etc.

function parseCheckInRequest(text: string): { intervalMin: number; isRepeating: boolean } | null {
  const lower = text.toLowerCase();

  const isRepeating =
    /\b(every|each|keep checking|repeatedly|keep reminding|always)\b/.test(lower) ||
    /\b(check|remind|text|message|ping|update)\b.{0,20}\bevery\b/.test(lower);

  // Hours — e.g. "2 hours", "1 hr", "in 1 hour", "every 2h"
  const hourMatch = lower.match(/\b(\d{1,2})\s*(?:hours?|hrs?|h)\b/);
  if (hourMatch) {
    return { intervalMin: Number(hourMatch[1]) * 60, isRepeating };
  }

  // "every hour" / "in an hour" / "after an hour"
  if (/\b(in|after|every)\s+an?\s+hour\b/.test(lower)) {
    return { intervalMin: 60, isRepeating: /\bevery\b/.test(lower) };
  }

  // Half an hour
  if (/\bhalf\s+an?\s+hour\b/.test(lower)) {
    return { intervalMin: 30, isRepeating: false };
  }

  // Minutes — e.g. "30 min", "20 minutes", "after 15 mins"
  const minuteMatch = lower.match(/\b(\d{1,3})\s*(?:mins?|minutes?|m)\b/);
  if (minuteMatch) {
    return { intervalMin: Number(minuteMatch[1]), isRepeating };
  }

  // Bare number with no unit at sentence boundary, e.g. "after 30"
  const bareMatch = lower.match(/\b(?:in|after|every)\s+(\d{1,3})\b(?!\s*(?:hours?|hrs?|h|mins?|minutes?|m))/);
  if (bareMatch) {
    const n = Number(bareMatch[1]);
    // Treat numbers ≤ 90 as minutes, larger as minutes too (ambiguous, but reasonable)
    return { intervalMin: n, isRepeating };
  }

  return null;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}
