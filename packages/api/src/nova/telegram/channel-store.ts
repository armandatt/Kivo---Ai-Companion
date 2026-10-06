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
}

export async function ensureChannel(profileId: string): Promise<void> {
  await prisma.novaTelegramChannel.upsert({ where: { profileId }, update: {}, create: { profileId } })
    // Two first contacts at once: the other one created the row.
    .catch(err => { if ((err as { code?: string } | null)?.code !== "P2002") throw err; });
}

export async function loadChannel(profileId: string): Promise<ChannelState> {
  const row = await prisma.novaTelegramChannel.findUnique({
    where:  { profileId },
    select: { proactiveEnabled: true, proactivePausedUntil: true, undeliverableSince: true },
  });
  // No row yet: the defaults.
  return row ?? { proactiveEnabled: true, proactivePausedUntil: null, undeliverableSince: null };
}

// The learner wrote or tapped, so the chat is reachable again.
export async function noteInbound(profileId: string): Promise<void> {
  await prisma.novaTelegramChannel.updateMany({
    where: { profileId, undeliverableSince: { not: null } },
    data:  { undeliverableSince: null },
  });
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
): Promise<boolean> {
  const column = kind === "understanding" ? "understandingCalls" : "responseCalls";
  const limit  = kind === "understanding" ? DAILY_UNDERSTANDING : DAILY_RESPONSES;

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
