// ─── Telegram channel state ───────────────────────────────────────────────────
// The only code that touches NovaTelegramChannel. One row per learner, about
// the Telegram surface and nothing else: may Nova message first, can the
// chat be reached, and the counters that bound one chat's load.
//
// Every guard here is a conditional write in Postgres, so it holds across
// instances and restarts. Nothing is kept in process memory.

import { prisma } from "@repo/db/client";

export const TURN_LEASE_SECONDS   = 60;
export const ACTIONS_PER_MINUTE   = 30;
export const DAILY_UNDERSTANDING  = Number(process.env.NOVA_TELEGRAM_DAILY_UNDERSTANDING ?? 150);
export const DAILY_RESPONSES      = Number(process.env.NOVA_TELEGRAM_DAILY_RESPONSES ?? 40);

export interface ChannelState {
  proactiveEnabled:     boolean;
  proactivePausedUntil: Date | null;
  undeliverableSince:   Date | null;
  // Telegram launch (28 Nov): plan notifications, and the two pauses.
  planNotifications?:   boolean;
  planPausedUntil?:     Date | null;
  allPausedUntil?:      Date | null;
}

export async function ensureChannel(profileId: string): Promise<void> {
  await prisma.novaTelegramChannel.upsert({ where: { profileId }, update: {}, create: { profileId } })
    // Two first contacts at once: the other one created the row.
    .catch(err => { if ((err as { code?: string } | null)?.code !== "P2002") throw err; });
}

export const CHANNEL_DEFAULTS: Readonly<ChannelState> = { proactiveEnabled: true, proactivePausedUntil: null, undeliverableSince: null, planNotifications: false, planPausedUntil: null, allPausedUntil: null };

// The stored row, or null when this learner has none yet.
export async function loadChannelRow(profileId: string): Promise<ChannelState | null> {
  return prisma.novaTelegramChannel.findUnique({
    where:  { profileId },
    select: { proactiveEnabled: true, proactivePausedUntil: true, undeliverableSince: true, planNotifications: true, planPausedUntil: true, allPausedUntil: true },
  });
}

export async function loadChannel(profileId: string): Promise<ChannelState> {
  // No row yet: the defaults.
  return (await loadChannelRow(profileId)) ?? { ...CHANNEL_DEFAULTS };
}

// The learner wrote or tapped, so the chat is reachable again.
export async function noteInbound(profileId: string): Promise<void> {
  await prisma.novaTelegramChannel.updateMany({
    where: { profileId, undeliverableSince: { not: null } },
    data:  { undeliverableSince: null },
  });
}

// The first message Nova sends in a chat is a different message from every
// later one. A chat Nova has never delivered to has no delivery time, and
// taking that slot is one conditional write: of two attempts at the same
// moment, one gets it. `release` gives it back when the message did not go.
export async function claimFirstUse(profileId: string, now: Date): Promise<boolean> {
  await ensureChannel(profileId);
  const claimed = await prisma.novaTelegramChannel.updateMany({ where: { profileId, lastDeliveredAt: null }, data: { lastDeliveredAt: now } });
  return claimed.count === 1;
}

export async function releaseFirstUse(profileId: string, claimedAt: Date): Promise<void> {
  await prisma.novaTelegramChannel.updateMany({ where: { profileId, lastDeliveredAt: claimedAt }, data: { lastDeliveredAt: null } });
}

export async function markDelivered(profileId: string, now: Date): Promise<void> {
  await prisma.novaTelegramChannel.updateMany({ where: { profileId }, data: { lastDeliveredAt: now, undeliverableSince: null } });
}

export async function markUndeliverable(profileId: string, now: Date): Promise<void> {
  await prisma.novaTelegramChannel.updateMany({
    where: { profileId, undeliverableSince: null },
    data:  { undeliverableSince: now },
  });
}

export async function setProactiveEnabled(profileId: string, enabled: boolean): Promise<void> {
  await ensureChannel(profileId);
  await prisma.novaTelegramChannel.update({
    where: { profileId },
    data:  { proactiveEnabled: enabled, ...(enabled ? { proactivePausedUntil: null } : {}) },
  });
}

export async function pauseProactiveUntil(profileId: string, until: Date): Promise<void> {
  await ensureChannel(profileId);
  await prisma.novaTelegramChannel.update({ where: { profileId }, data: { proactivePausedUntil: until } });
}

// ── Plan notifications and pauses (Telegram launch, 28 Nov) ──────────────────

export async function setPlanNotifications(profileId: string, enabled: boolean): Promise<void> {
  await ensureChannel(profileId);
  await prisma.novaTelegramChannel.update({ where: { profileId }, data: { planNotifications: enabled } });
}

// "Pause plan nudges today": plan prompts and Nova's own nudges hold until
// `until` (local midnight); reminders the learner set still go.
export async function pausePlanUntil(profileId: string, until: Date): Promise<void> {
  await ensureChannel(profileId);
  await prisma.novaTelegramChannel.update({ where: { profileId }, data: { planPausedUntil: until, proactivePausedUntil: until } });
}

// "Pause all": every automatic message holds until `until`.
export async function pauseAllUntil(profileId: string, until: Date): Promise<void> {
  await ensureChannel(profileId);
  await prisma.novaTelegramChannel.update({ where: { profileId }, data: { allPausedUntil: until, planPausedUntil: until, proactivePausedUntil: until } });
}

// Resume: both pauses and "Not today" end now.
export async function resumeSends(profileId: string): Promise<void> {
  await ensureChannel(profileId);
  await prisma.novaTelegramChannel.update({ where: { profileId }, data: { allPausedUntil: null, planPausedUntil: null, proactivePausedUntil: null } });
}

// Learners with plan notifications on whose chat can be reached, with what
// the plan job needs. Read-only.
export async function planNotificationLearners(take = 2000): Promise<Array<{ profileId: string; chatId: string; timezone: string | null; planPausedUntil: Date | null; allPausedUntil: Date | null }>> {
  const rows = await prisma.novaTelegramChannel.findMany({
    where: { planNotifications: true, undeliverableSince: null, profile: { user: { platform: "telegram", persona: "nova" } } },
    take, select: { profileId: true, planPausedUntil: true, allPausedUntil: true, profile: { select: { timezone: true, user: { select: { platformChatId: true } } } } },
  });
  return rows.map(r => ({ profileId: r.profileId, chatId: r.profile.user.platformChatId, timezone: r.profile.timezone, planPausedUntil: r.planPausedUntil, allPausedUntil: r.allPausedUntil }));
}

// One learner's chat and channel, for a reminder about to be sent.
export async function reminderTarget(profileId: string): Promise<{ chatId: string; persona: string | null; platform: string; timezone: string | null; channel: ChannelState | null } | null> {
  const p = await prisma.novaAcademicProfile.findUnique({
    where: { id: profileId },
    select: { timezone: true, user: { select: { platform: true, platformChatId: true, persona: true } },
      telegramChannel: { select: { proactiveEnabled: true, proactivePausedUntil: true, undeliverableSince: true, planNotifications: true, planPausedUntil: true, allPausedUntil: true } } },
  });
  if (!p) return null;
  return { chatId: p.user.platformChatId, persona: p.user.persona, platform: p.user.platform, timezone: p.timezone, channel: p.telegramChannel };
}

// ── Commands and taps per minute ──────────────────────────────────────────────
// Free text is limited by the shared message limiter; this bounds the inputs
// that create no message. Two conditional writes: start a new window, or take
// a slot in the current one. If neither matched, the chat is over the limit.

export async function allowAction(profileId: string, now: Date): Promise<boolean> {
  const windowStart = new Date(now.getTime() - 60_000);
  const fresh = await prisma.novaTelegramChannel.updateMany({
    where: { profileId, OR: [{ actionWindowStart: null }, { actionWindowStart: { lt: windowStart } }] },
    data:  { actionWindowStart: now, actionCount: 1 },
  });
  if (fresh.count === 1) return true;
  const slot = await prisma.novaTelegramChannel.updateMany({
    where: { profileId, actionCount: { lt: ACTIONS_PER_MINUTE } },
    data:  { actionCount: { increment: 1 } },
  });
  return slot.count === 1;
}

// ── One free-text turn at a time ──────────────────────────────────────────────
// A lease: taken by a conditional write, released when the turn ends, and
// expired by the clock if the process dies holding it.

export async function acquireTurn(profileId: string, now: Date): Promise<boolean> {
  const taken = await prisma.novaTelegramChannel.updateMany({
    where: { profileId, OR: [{ turnLockedUntil: null }, { turnLockedUntil: { lt: now } }] },
    data:  { turnLockedUntil: new Date(now.getTime() + TURN_LEASE_SECONDS * 1000) },
  });
  return taken.count === 1;
}

export async function releaseTurn(profileId: string): Promise<void> {
  await prisma.novaTelegramChannel.updateMany({ where: { profileId }, data: { turnLockedUntil: null } })
    .catch(err => console.error("[nova:telegram] turn release failed", err));
}

// ── Model calls per learner per day ───────────────────────────────────────────
// Takes one call from today's budget. false: the budget is spent, and the
// caller answers without the model instead of guessing with less of it.

export async function spendModelCall(
  profileId: string,
  kind:      "understanding" | "response",
  day:       string,              // the learner's local day
  // The plan's multiplier on these caps (billing/limits.ts): 1 on Free.
  factor     = 1,
): Promise<boolean> {
  const column = kind === "understanding" ? "understandingCalls" : "responseCalls";
  const limit  = (kind === "understanding" ? DAILY_UNDERSTANDING : DAILY_RESPONSES) * Math.max(1, Math.floor(factor));

  // A new day resets both counters, then the call below takes its slot.
  await prisma.novaTelegramChannel.updateMany({
    where: { profileId, OR: [{ usageDay: null }, { usageDay: { not: day } }] },
    data:  { usageDay: day, understandingCalls: 0, responseCalls: 0 },
  });
  const spent = await prisma.novaTelegramChannel.updateMany({
    where: { profileId, usageDay: day, [column]: { lt: limit } },
    data:  { [column]: { increment: 1 } },
  });
  return spent.count === 1;
}
