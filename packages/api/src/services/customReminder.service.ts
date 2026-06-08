import { prisma } from "@repo/db/client";
import { generateOpenAIText } from "./openai.service";
import { buildGymTimeContext } from "./gymTimeContext.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderMessage = {
  chatId: string;
  text:   string;
};

// Canonical normalized schedule — single source of truth for all reminder creation.
export type ReminderSchedule =
  | { type: "once";     task: string; fireAt: Date }
  | { type: "interval"; task: string; intervalMin: number; firstFireAt: Date }
  | { type: "daily";    task: string; timeHHMM: string;   firstFireAt: Date }

// ─── SchedulerNormalizer ──────────────────────────────────────────────────────
// Converts raw user text → canonical ReminderSchedule.
// Regex-first (deterministic), LLM fallback for ambiguous cases.
// All bug-class 1/4/5/11/13 fixes live here.

export async function normalizeReminderRequest(
  text:     string,
  timezone: string,
  now:      Date,
): Promise<ReminderSchedule | null> {
  const lower = text.toLowerCase();

  // ── Task extraction: strip "remind me to", "remember to", etc. ───────────
  const task = extractTask(lower)
  if (!task) return null

  // ── Interval detection (regex, deterministic) ────────────────────────────
  // Bug class 1/5/11: all these must produce interval type

  // "every X minutes / mins / min"
  const minMatch = lower.match(/every\s+(\d+)\s*(?:minutes?|mins?)\b/)
  if (minMatch) {
    const n = Number(minMatch[1])
    if (n >= 1) return { type: "interval", task, intervalMin: n, firstFireAt: new Date(now.getTime() + n * 60_000) }
  }

  // "every 60 mins" already caught above; also "every sixty minutes" via LLM
  // "every X hours / hrs / hr / h"
  const hrMatch = lower.match(/every\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/)
  if (hrMatch) {
    const n = Math.round(Number(hrMatch[1]) * 60)
    if (n >= 1) return { type: "interval", task, intervalMin: n, firstFireAt: new Date(now.getTime() + n * 60_000) }
  }

  // "every hour" / "hourly" / "each hour" / "once an hour" / "once every hour"
  if (/\b(hourly|every\s+hour|each\s+hour|once\s+(an?|per|every)\s+hour|per\s+hour)\b/.test(lower)) {
    return { type: "interval", task, intervalMin: 60, firstFireAt: new Date(now.getTime() + 3_600_000) }
  }

  // "every half hour" / "every 30 min"
  if (/every\s+half\s+(an?\s+)?hour/.test(lower)) {
    return { type: "interval", task, intervalMin: 30, firstFireAt: new Date(now.getTime() + 1_800_000) }
  }

  // "every X days" (interval, not daily-at-time)
  const dayMatch = lower.match(/every\s+(\d+)\s*days?\b/)
  if (dayMatch) {
    const n = Number(dayMatch[1]) * 24 * 60
    return { type: "interval", task, intervalMin: n, firstFireAt: new Date(now.getTime() + n * 60_000) }
  }

  // "every week" / "weekly"
  if (/\b(every\s+week|weekly)\b/.test(lower) && !/at\s+\d/.test(lower)) {
    return { type: "interval", task, intervalMin: 7 * 24 * 60, firstFireAt: new Date(now.getTime() + 7 * 24 * 3_600_000) }
  }

  // ── Daily-at-time detection (regex) ──────────────────────────────────────
  const isDailyPattern = /\b(every\s+day|daily|each\s+day|every\s+morning|every\s+evening|every\s+night)\b/.test(lower)
  const timeMatch = extractTimeHHMM(lower, timezone, now)

  if (isDailyPattern && timeMatch) {
    const first = nextOccurrenceOfTime(timeMatch, timezone, now)
    return { type: "daily", task, timeHHMM: timeMatch, firstFireAt: first }
  }

  // ── One-time detection (regex) ────────────────────────────────────────────
  const hasOneTimeSignal =
    /\b(tomorrow|today|tonight|this\s+(morning|evening|afternoon|night)|in\s+\d|after\s+\d)\b/.test(lower) &&
    !isDailyPattern

  if (hasOneTimeSignal && timeMatch) {
    const fireAt = resolveOneTimeDate(lower, timeMatch, timezone, now)
    if (fireAt) return { type: "once", task, fireAt }
  }

  // ── LLM fallback for unmatched patterns ──────────────────────────────────
  return llmNormalize(text, task, timezone, now)
}

// ─── SchedulerPreviewGenerator ───────────────────────────────────────────────
// Bug class 12/13: must match ACTUAL schedule, never say "daily" for hourly.

export function generateReminderPreview(schedule: ReminderSchedule, timezone: string): string {
  switch (schedule.type) {
    case "once":
      return `Set. I'll remind you ${formatLocalDate(schedule.fireAt, timezone)}.`
    case "interval":
      return `Set. I'll remind you every ${formatInterval(schedule.intervalMin)}.`
    case "daily":
      return `Set. I'll remind you daily at ${formatTime12h(schedule.timeHHMM)}.`
  }
}

// ─── SchedulerConflictDetector ────────────────────────────────────────────────
// Bug class 7: detect contradictory signals before scheduling.

export function detectScheduleConflict(text: string, schedule: ReminderSchedule): string | null {
  const lower = text.toLowerCase()

  if (schedule.type === "once") {
    const hour = schedule.fireAt.getHours()
    if (/\bmorning\b/.test(lower) && hour >= 12)
      return `"Morning" and ${formatTime12h(toHHMM(hour, schedule.fireAt.getMinutes()))} don't match. AM or PM?`
    if (/\bafternoon\b/.test(lower) && hour < 12)
      return `"Afternoon" and the time you gave don't match. Which one should I use?`
    if (/\bevening\b/.test(lower) && hour < 17)
      return `"Evening" and ${formatTime12h(toHHMM(hour, schedule.fireAt.getMinutes()))} don't match. Did you mean PM?`
    if (/\bnight\b/.test(lower) && (hour >= 6 && hour < 18))
      return `"Night" and ${formatTime12h(toHHMM(hour, schedule.fireAt.getMinutes()))} don't match.`
    if (/\bam\b/.test(lower) && /\bpm\b/.test(lower))
      return `Both AM and PM in the same message — which one?`
  }

  // "every hour at 3am" — interval with a specific time is contradictory
  if (schedule.type === "interval") {
    const hasSpecificTime = /\b(at\s+\d|\d\s*am|\d\s*pm)\b/.test(lower)
    const hasInterval = /\bevery\s+\d|\bhourly\b|\beach\s+hour\b/.test(lower)
    if (hasSpecificTime && hasInterval)
      return `"Every ${formatInterval(schedule.intervalMin)}" and a specific time is ambiguous. Should I remind you every ${formatInterval(schedule.intervalMin)}, or just once?`
  }

  // "every Monday tomorrow" — weekly recurring + one-time signal
  if (/\b(every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(lower) && /\btomorrow\b/.test(lower))
    return `"Every ${lower.match(/every\s+(\w+day)/)?.[1] ?? "weekday"}" and "tomorrow" are contradictory. Which do you mean?`

  return null
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createCustomReminder(
  platformChatId:   string,
  schedule:         ReminderSchedule,
): Promise<{ created: boolean; reply: string }> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, timezone: true },
  });

  if (!user) return { created: false, reply: "I couldn't save that reminder. Try again." };

  const tz = user.timezone ?? "Asia/Kolkata"

  const data = scheduleToDbRow(schedule)
  await prisma.customReminder.create({
    data: { userId: user.id, fired: false, ...data },
  });

  return {
    created: true,
    reply:   generateReminderPreview(schedule, tz),
  };
}

// ─── Parse and create from natural language (main entry point) ────────────────

export async function parseAndCreateReminder(
  platformChatId: string,
  text:           string,
): Promise<{ created: boolean; reply: string } | null> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { timezone: true },
  });
  const timezone = user?.timezone ?? "Asia/Kolkata";
  const now      = new Date();

  const schedule = await normalizeReminderRequest(text, timezone, now);
  if (!schedule) return null;

  // Conflict check before saving
  const conflict = detectScheduleConflict(text, schedule);
  if (conflict) return { created: false, reply: conflict };

  return createCustomReminder(platformChatId, schedule);
}

// ─── Natural-language cancel ──────────────────────────────────────────────────
// Bug class 9: "stop reminding me to drink water" → finds and cancels it.

export async function cancelReminderByKeyword(
  platformChatId: string,
  keyword:        string,
): Promise<string> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id: true,
      customReminders: {
        where:  { fired: false },
        select: { id: true, messageContext: true },
      },
    },
  });

  if (!user || !user.customReminders.length)
    return "No active reminders to remove. Use /reminders to check.";

  const kw      = keyword.toLowerCase().trim();
  const matches = user.customReminders.filter(r =>
    r.messageContext.toLowerCase().includes(kw)
  );

  if (!matches.length)
    return `No reminder matching "${keyword}" found. Use /reminders to see what's active.`;

  await prisma.customReminder.updateMany({
    where: { id: { in: matches.map(r => r.id) } },
    data:  { fired: true },
  });

  return matches.length === 1
    ? `Stopped: "${matches[0]!.messageContext}".`
    : `Stopped ${matches.length} reminders matching "${keyword}".`;
}

// ─── Natural-language edit ────────────────────────────────────────────────────
// Bug class 8: "change my water reminder to every 2 hours" → updates interval.

export async function updateReminderByKeyword(
  platformChatId: string,
  keyword:        string,
  newText:        string,
): Promise<string> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id: true, timezone: true,
      customReminders: {
        where:  { fired: false },
        select: { id: true, messageContext: true },
      },
    },
  });

  if (!user || !user.customReminders.length)
    return "No active reminders to update.";

  const kw      = keyword.toLowerCase().trim();
  const matched = user.customReminders.find(r =>
    r.messageContext.toLowerCase().includes(kw)
  );

  if (!matched)
    return `No reminder matching "${keyword}" found. Use /reminders to check.`;

  const tz  = user.timezone ?? "Asia/Kolkata";
  const now = new Date();

  // Parse the new schedule from the update instruction
  const newSchedule = await normalizeReminderRequest(
    `remind me to ${matched.messageContext} ${newText}`,
    tz,
    now,
  );

  if (!newSchedule)
    return `Couldn't parse the new schedule. Try: "change ${keyword} reminder to every 2 hours".`;

  await prisma.customReminder.update({
    where: { id: matched.id },
    data:  scheduleToDbRow(newSchedule),
  });

  return generateReminderPreview(newSchedule, tz);
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

    // Bug class 1 fix: advance by actual interval, not always 24h
    if (reminder.repeatIntervalMin) {
      // Interval-based: next fire = now + interval
      await prisma.customReminder.update({
        where: { id: reminder.id },
        data:  { triggerTime: new Date(now.getTime() + reminder.repeatIntervalMin * 60_000) },
      });
    } else if (reminder.repeat && reminder.repeatTime) {
      // Daily-at-time: next fire = tomorrow at same time
      const next = nextDailyTrigger(reminder.repeatTime, reminder.user.timezone ?? "Asia/Kolkata", now);
      await prisma.customReminder.update({
        where: { id: reminder.id },
        data:  { triggerTime: next },
      });
    } else {
      // One-time: mark fired
      await prisma.customReminder.update({
        where: { id: reminder.id },
        data:  { fired: true },
      });
    }

    messages.push({ chatId, text });
    console.log(`[REMINDER] Fired for ${chatId}: "${reminder.messageContext}"`);
  }

  // Clean up stale one-shot reminders that missed the window
  await prisma.customReminder.updateMany({
    where: {
      fired:       false,
      repeat:      false,
      repeatIntervalMin: null,
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
        select:  { id: true, messageContext: true, triggerTime: true, repeat: true, repeatTime: true, repeatIntervalMin: true },
      },
    },
  });

  if (!user || !user.customReminders.length) {
    return "No active reminders. Set one: \"remind me to eat protein every 2 hours\".";
  }

  const tz    = user.timezone ?? "Asia/Kolkata";
  const lines = user.customReminders.map((r, i) => {
    // Bug class 5 fix: accurate frequency label
    const tag = r.repeatIntervalMin
      ? ` [every ${formatInterval(r.repeatIntervalMin)}]`
      : r.repeat && r.repeatTime
        ? ` [daily at ${formatTime12h(r.repeatTime)}]`
        : " [one-time]";
    const nextStr = formatLocalDate(r.triggerTime, tz);
    return `${i + 1}. ${r.messageContext}${tag} — next: ${nextStr}`;
  });

  return ["Active reminders:", ...lines, "", "Type /cancel [number] to remove one."].join("\n");
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
    gymCtx?.todayMuscles && gymCtx.isTrainingDay ? `Training today: ${gymCtx.todayMuscles}` : null,
    gymCtx?.isTrainingDay === false               ? "Rest day today"                          : null,
    gymCtx?.gymTimeStr                            ? `Gym time: ${gymCtx.gymTimeStr}`          : null,
    gymCtx?.lastLiftSummary                       ? `Last lifts: ${gymCtx.lastLiftSummary}`   : null,
  ].filter(Boolean);

  const isRex      = persona === "rex";
  const systemPrompt = isRex
    ? "You are Rex, a blunt gym coach. Give a short reminder (2–4 lines, no greeting). Be direct, practical, no fluff. Pull in the user's data where relevant."
    : "You are Nova, an accountability companion. Give a short, warm but direct reminder (2–4 lines, no greeting). Pull in relevant context where available.";

  const prompt = [
    `Reminder context: "${context}"`,
    dataLines.length ? `User data:\n${dataLines.join("\n")}` : null,
  ].filter(Boolean).join("\n");

  try {
    return await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   120,
      systemInstruction: systemPrompt,
      prompt,
    });
  } catch {
    return context;
  }
}

// ─── LLM fallback normalizer ──────────────────────────────────────────────────

async function llmNormalize(
  rawText:  string,
  task:     string,
  timezone: string,
  now:      Date,
): Promise<ReminderSchedule | null> {
  const nowLocal = now.toLocaleString("en-US", { timeZone: timezone });

  try {
    const raw = await generateOpenAIText({
      model:           "gpt-4o-mini",
      maxOutputTokens: 80,
      systemInstruction: [
        `Parse a reminder request. Current local time: ${nowLocal} (${timezone}).`,
        `Reply ONLY with JSON — no markdown, no extra text:`,
        `{"scheduleType":"once"|"interval"|"daily","fireAtISO":"<ISO>","intervalMin":<number>|null,"dailyTimeHHMM":"<HH:MM>"|null}`,
        `Rules:`,
        `- "once": one-time. Set fireAtISO to the exact datetime.`,
        `- "interval": repeating every N minutes. Set intervalMin. fireAtISO = first fire.`,
        `  Examples: every 30 min → 30. every 2 hours → 120. every hour/hourly → 60.`,
        `  "every sixty minutes" → 60. "every 45 mins" → 45.`,
        `- "daily": every day at a fixed time. Set dailyTimeHHMM as "HH:MM". fireAtISO = next occurrence.`,
        `- Named times: breakfast=08:00, lunch=13:00, evening=18:00, dinner=20:00, night=22:00.`,
        `- If time already passed today, schedule for tomorrow.`,
        `- If unclear, reply with null.`,
      ].join("\n"),
      prompt: rawText,
    });

    if (!raw || raw.trim().toLowerCase() === "null") return null;

    const obj = JSON.parse(raw.trim()) as {
      scheduleType?: string;
      fireAtISO?:    string;
      intervalMin?:  number | null;
      dailyTimeHHMM?: string | null;
    };

    const fireAt = obj.fireAtISO ? new Date(obj.fireAtISO) : null;
    if (!obj.scheduleType) return null;

    if (obj.scheduleType === "interval" && obj.intervalMin && obj.intervalMin >= 1) {
      const first = fireAt && !isNaN(fireAt.getTime()) ? fireAt : new Date(now.getTime() + obj.intervalMin * 60_000);
      return { type: "interval", task, intervalMin: obj.intervalMin, firstFireAt: first };
    }

    if (obj.scheduleType === "daily" && obj.dailyTimeHHMM) {
      const first = fireAt && !isNaN(fireAt.getTime()) ? fireAt : nextOccurrenceOfTime(obj.dailyTimeHHMM, timezone, now);
      return { type: "daily", task, timeHHMM: obj.dailyTimeHHMM, firstFireAt: first };
    }

    if (obj.scheduleType === "once" && fireAt && !isNaN(fireAt.getTime())) {
      return { type: "once", task, fireAt };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── DB serialization ─────────────────────────────────────────────────────────

function scheduleToDbRow(schedule: ReminderSchedule) {
  switch (schedule.type) {
    case "once":
      return {
        messageContext:   schedule.task,
        triggerTime:      schedule.fireAt,
        repeat:           false,
        repeatTime:       null,
        repeatIntervalMin: null,
      };
    case "interval":
      return {
        messageContext:    schedule.task,
        triggerTime:       schedule.firstFireAt,
        repeat:            true,
        repeatTime:        null,
        repeatIntervalMin: schedule.intervalMin,
      };
    case "daily":
      return {
        messageContext:    schedule.task,
        triggerTime:       schedule.firstFireAt,
        repeat:            true,
        repeatTime:        schedule.timeHHMM,
        repeatIntervalMin: null,
      };
  }
}

// ─── Task extraction ──────────────────────────────────────────────────────────
// Strips scheduling language to extract the actual task.
// Bug class 2/3: preserves full multi-action content.

function extractTask(lower: string): string | null {
  // Remove "remind me to/about", "remember to", etc.
  let task = lower
    .replace(/^(remind\s+me\s+(to|about|of)|remember\s+to|ping\s+me\s+(to|about)|alert\s+me\s+(to|about))\s*/i, "")
    // Remove trailing frequency expressions
    .replace(/\s*(every\s+\d+\s*(minutes?|mins?|hours?|hrs?|h|days?|weeks?|months?)|every\s+(hour|day|week|month)|hourly|daily|weekly|monthly|every\s+\w+day)\s*$/i, "")
    // Remove trailing "at HH:MM" or "at Xam/pm"
    .replace(/\s+at\s+\d+(?::\d+)?\s*(?:am|pm)?\s*$/i, "")
    .trim();

  if (!task || task.length < 2) return null;

  // Capitalize first letter
  return task.charAt(0).toUpperCase() + task.slice(1);
}

// ─── Time parsing helpers ─────────────────────────────────────────────────────

function extractTimeHHMM(lower: string, _timezone: string, _now: Date): string | null {
  // HH:MM format
  const hhmmM = lower.match(/\b(\d{1,2}):(\d{2})\b/)
  if (hhmmM) {
    const h = parseInt(hhmmM[1]!), m = parseInt(hhmmM[2]!)
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  // "Xam" / "Xpm" / "X am" / "X pm"
  const ampmM = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (ampmM) {
    let h = parseInt(ampmM[1]!), m = ampmM[2] ? parseInt(ampmM[2]) : 0
    const p = ampmM[3]!
    if (p === "pm" && h !== 12) h += 12
    if (p === "am" && h === 12) h = 0
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  // Named times
  const named: Record<string, string> = {
    breakfast: "08:00", morning: "08:00", lunch: "13:00",
    afternoon: "15:00", evening: "18:00", dinner: "20:00",
    night: "22:00",
  }
  for (const [word, hhmm] of Object.entries(named)) {
    if (lower.includes(word)) return hhmm
  }

  return null
}

function nextOccurrenceOfTime(timeHHMM: string, timezone: string, now: Date): Date {
  const [hStr, mStr] = timeHHMM.split(":")
  const h = parseInt(hStr ?? "0"), m = parseInt(mStr ?? "0")

  const localStr  = now.toLocaleDateString("en-CA", { timeZone: timezone })
  const candidate = new Date(`${localStr}T${timeHHMM}:00`)

  // Rough UTC adjustment: if candidate is in the past, use tomorrow
  // (The cron fires in UTC, so this is an approximation — close enough for reminder scheduling)
  const offsetMs  = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime() +
                    new Date(now.toLocaleString("en-US", { timeZone: timezone })).getTime() - now.getTime()
  const local     = new Date(candidate.getTime() - offsetMs)

  if (local.getTime() <= now.getTime()) {
    return new Date(local.getTime() + 24 * 3_600_000)
  }
  return local
}

function resolveOneTimeDate(lower: string, timeHHMM: string, timezone: string, now: Date): Date | null {
  const base = nextOccurrenceOfTime(timeHHMM, timezone, now)

  if (/\btomorrow\b/.test(lower)) {
    // Force to tomorrow even if base is today
    const today = now.toLocaleDateString("en-CA", { timeZone: timezone })
    const candidateStr = `${today}T${timeHHMM}:00`
    const candidate    = new Date(candidateStr)
    const offsetMs     = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime() +
                         new Date(now.toLocaleString("en-US", { timeZone: timezone })).getTime() - now.getTime()
    const local        = new Date(candidate.getTime() - offsetMs)
    return new Date(local.getTime() + 24 * 3_600_000)
  }

  return base
}

// ─── nextDailyTrigger (legacy — kept for daily-at-time reminders) ─────────────

function nextDailyTrigger(repeatTime: string, timezone: string, now: Date): Date {
  const [hStr = "8", mStr = "0"] = repeatTime.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  const tomorrow    = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const localMidnight = new Date(
    tomorrow.toLocaleDateString("en-CA", { timeZone: timezone }) + "T00:00:00"
  );
  const nextLocal   = new Date(new Date(localMidnight).toLocaleString("en-US", { timeZone: "UTC" }));
  nextLocal.setUTCHours(h, m, 0, 0);

  const offsetMs =
    new Date(new Date(tomorrow).toLocaleString("en-US", { timeZone: timezone })).getTime() -
    new Date(new Date(tomorrow).toLocaleString("en-US", { timeZone: "UTC" })).getTime();

  return new Date(nextLocal.getTime() - offsetMs);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatInterval(minutes: number): string {
  if (minutes < 60)  return `${minutes} minute${minutes !== 1 ? "s" : ""}`
  if (minutes === 60) return "hour"
  if (minutes % 60 === 0) return `${minutes / 60} hours`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return `${h}h ${m}min`
}

function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":")
  const h = parseInt(hStr ?? "0"), m = parseInt(mStr ?? "0")
  const period = h >= 12 ? "PM" : "AM"
  const dh     = h === 0 ? 12 : h > 12 ? h - 12 : h
  const dm     = m === 0 ? "" : `:${String(m).padStart(2, "0")}`
  return `${dh}${dm} ${period}`
}

function toHHMM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function formatLocalDate(date: Date, timezone: string): string {
  return date.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone,
  });
}
