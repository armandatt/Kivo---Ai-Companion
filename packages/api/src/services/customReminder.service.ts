import { prisma } from "@repo/db/client";
import { generateOpenAIText } from "./openai.service";
import { buildGymTimeContext } from "./gymTimeContext.service";
import { getUser } from "./user.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderMessage = {
  chatId: string;
  text:   string;
};

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createCustomReminder(
  platformChatId: string,
  messageContext: string,
  triggerTime:    Date,
  repeat:         boolean,
  repeatTime:     string | null,
): Promise<{ created: boolean; reply: string }> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, timezone: true },
  });

  if (!user) return { created: false, reply: "I couldn't save that reminder. Try again." };

  await prisma.customReminder.create({
    data: {
      userId:         user.id,
      messageContext,
      triggerTime,
      repeat,
      repeatTime:     repeat ? repeatTime : null,
      fired:          false,
    },
  });

  const timeDesc = formatReminderTime(triggerTime, user.timezone ?? "Asia/Kolkata");
  const repeatNote = repeat ? " (daily)" : "";
  return {
    created: true,
    reply:   `Set. I'll remind you ${timeDesc}${repeatNote}.`,
  };
}

// ─── Parse and create from natural language ───────────────────────────────────

export async function parseAndCreateReminder(
  platformChatId: string,
  text:           string,
): Promise<{ created: boolean; reply: string } | null> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { timezone: true },
  });
  const timezone = user?.timezone ?? "Asia/Kolkata";
  const nowLocal = new Date().toLocaleString("en-US", { timeZone: timezone });

  try {
    const raw = await generateOpenAIText({
      model:           "gpt-4o-mini",
      maxOutputTokens: 80,
      systemInstruction: [
        `Extract a reminder from the user's message. Current local time: ${nowLocal} (${timezone}).`,
        `Reply ONLY with JSON:`,
        `{"triggerISO":"<ISO 8601 datetime>","context":"<what to remind about>","repeat":<bool>,"repeatTime":"<HH:MM or null>"}`,
        `- triggerISO: exact datetime to fire the reminder`,
        `- context: the subject/purpose of the reminder (e.g. "eat protein before gym")`,
        `- repeat: true only if user says "every day", "daily", "every morning" etc.`,
        `- repeatTime: "HH:MM" in user's timezone if repeat=true, else null`,
        `- If you cannot extract a clear time, reply with null`,
        `Named times: breakfast=08:00, lunch=13:00, evening=18:00, dinner=20:00, night=22:00`,
      ].join("\n"),
      prompt: text,
    });

    if (!raw || raw.trim().toLowerCase() === "null") return null;

    const obj = JSON.parse(raw.trim()) as {
      triggerISO?: string;
      context?:    string;
      repeat?:     boolean;
      repeatTime?: string | null;
    };

    if (!obj.triggerISO || !obj.context) return null;

    const triggerTime = new Date(obj.triggerISO);
    if (isNaN(triggerTime.getTime())) return null;

    return createCustomReminder(
      platformChatId,
      obj.context,
      triggerTime,
      !!obj.repeat,
      obj.repeatTime ?? null,
    );
  } catch {
    return null;
  }
}

// ─── Fire due reminders ───────────────────────────────────────────────────────

export async function fireCustomReminders(now: Date): Promise<ReminderMessage[]> {
  const staleThreshold = new Date(now.getTime() - 12 * 60 * 1000);

  const due = await prisma.customReminder.findMany({
    where: {
      fired:       false,
      triggerTime: { lte: now, gte: staleThreshold },
    },
    include: {
      user: {
        select: { platformChatId: true, persona: true, timezone: true, intakeAnswers: true },
      },
    },
  });

  const messages: ReminderMessage[] = [];

  for (const reminder of due) {
    const chatId = reminder.user.platformChatId;

    const text = await generateReminderMessage(
      chatId,
      reminder.messageContext,
      reminder.user.persona,
    );

    // Advance repeating reminder or mark fired
    if (reminder.repeat && reminder.repeatTime) {
      const next = nextDailyTrigger(reminder.repeatTime, reminder.user.timezone ?? "Asia/Kolkata", now);
      await prisma.customReminder.update({
        where: { id: reminder.id },
        data:  { triggerTime: next },
      });
    } else {
      await prisma.customReminder.update({
        where: { id: reminder.id },
        data:  { fired: true },
      });
    }

    messages.push({ chatId, text });
    console.log(`[REMINDER] Fired for ${chatId}: "${reminder.messageContext}"`);
  }

  // Also clean up stale one-shot reminders that missed the window
  await prisma.customReminder.updateMany({
    where: {
      fired:       false,
      repeat:      false,
      triggerTime: { lt: staleThreshold },
    },
    data: { fired: true },
  });

  return messages;
}

// ─── List reminders ───────────────────────────────────────────────────────────

export async function listReminders(platformChatId: string): Promise<string> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id:       true,
      timezone: true,
      customReminders: {
        where:   { fired: false },
        orderBy: { triggerTime: "asc" },
        select:  { id: true, messageContext: true, triggerTime: true, repeat: true, repeatTime: true },
      },
    },
  });

  if (!user || !user.customReminders.length) {
    return "No active reminders. Set one by telling me: \"remind me at 8am to eat protein before gym\".";
  }

  const tz = user.timezone ?? "Asia/Kolkata";
  const lines = user.customReminders.map((r, i) => {
    const timeStr = formatReminderTime(r.triggerTime, tz);
    const tag     = r.repeat ? " [daily]" : " [one-time]";
    return `${i + 1}. ${timeStr} — ${r.messageContext}${tag}`;
  });

  return [
    "Active reminders:",
    ...lines,
    "",
    'Type /cancel [number] to remove one.',
  ].join("\n");
}

// ─── Cancel by index ──────────────────────────────────────────────────────────

export async function cancelReminderByIndex(
  platformChatId: string,
  index:          number,
): Promise<string> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id: true,
      customReminders: {
        where:   { fired: false },
        orderBy: { triggerTime: "asc" },
        select:  { id: true, messageContext: true },
      },
    },
  });

  const reminder = user?.customReminders[index - 1];
  if (!reminder) return `No reminder at position ${index}. Use /reminders to see the list.`;

  await prisma.customReminder.update({
    where: { id: reminder.id },
    data:  { fired: true },
  });

  return `Removed: "${reminder.messageContext}".`;
}

// ─── LLM-generated reminder message ──────────────────────────────────────────

async function generateReminderMessage(
  platformChatId: string,
  context:        string,
  persona:        string,
): Promise<string> {
  const gymCtx = await buildGymTimeContext(platformChatId, new Date()).catch(() => null);

  const dataLines = [
    gymCtx?.todayMuscles && gymCtx.isTrainingDay
      ? `Training today: ${gymCtx.todayMuscles}`
      : gymCtx?.isTrainingDay === false
        ? "Rest day today"
        : null,
    gymCtx?.gymTimeStr ? `Gym time: ${gymCtx.gymTimeStr}` : null,
    gymCtx?.lastLiftSummary ? `Last lifts: ${gymCtx.lastLiftSummary}` : null,
  ].filter(Boolean);

  const isRex = persona === "rex";
  const systemPrompt = isRex
    ? "You are Rex, a blunt gym coach. Give a short reminder (2–4 lines, no greeting). Be direct, practical, no fluff. Pull in the user's data where relevant."
    : "You are Nova, an accountability companion. Give a short, warm but direct reminder (2–4 lines, no greeting). Pull in relevant context where available.";

  const prompt = [
    `Reminder context: "${context}"`,
    dataLines.length ? `User data:\n${dataLines.join("\n")}` : null,
  ].filter(Boolean).join("\n");

  try {
    return await generateOpenAIText({
      model:           "gpt-4o-mini",
      maxOutputTokens: 120,
      systemInstruction: systemPrompt,
      prompt,
    });
  } catch {
    return context;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatReminderTime(date: Date, timezone: string): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    hour:    "numeric",
    minute:  "2-digit",
    hour12:  true,
    timeZone: timezone,
  });
}

function nextDailyTrigger(repeatTime: string, timezone: string, now: Date): Date {
  const [hStr = "8", mStr = "0"] = repeatTime.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  // Get tomorrow's date in user timezone at the specified time
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const localMidnight = new Date(
    tomorrow.toLocaleDateString("en-CA", { timeZone: timezone }) + "T00:00:00"
  );
  // Build absolute UTC time for repeatTime in user's timezone
  const nextLocal = new Date(
    new Date(localMidnight).toLocaleString("en-US", { timeZone: "UTC" })
  );
  nextLocal.setUTCHours(h, m, 0, 0);

  // Adjust for timezone offset
  const offsetMs = new Date(
    new Date(tomorrow).toLocaleString("en-US", { timeZone: timezone })
  ).getTime() - new Date(
    new Date(tomorrow).toLocaleString("en-US", { timeZone: "UTC" })
  ).getTime();

  return new Date(nextLocal.getTime() - offsetMs);
}
