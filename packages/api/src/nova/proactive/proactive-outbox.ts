// ─── Proactive outbox ─────────────────────────────────────────────────────────
// The only code that writes NovaProactiveMessage.
//
// A row is one logical occurrence ("nudge:2026-10-06") moving through:
//
//   claimed → ready → sending → sent
//                        ├──→ failed → (retry) → sending … → abandoned
//                        └──→ unknown
//
//   claim     creating the row. (profileId, occurrenceKey) is unique, so of
//             any number of ticks or instances exactly one creates it.
//   ready     the message has been worded and stored. A retry sends the
//             stored text; the model is not asked twice.
//   sending   set just before the request to Telegram. If the process dies
//             here the outcome is not knowable, so the row becomes "unknown"
//             and is never sent again: a missed nudge is cheaper than a
//             duplicate.
//   sent      Telegram returned a message id.
//
// Only sent and unknown rows count toward the daily cap and the gap between
// messages. A decision not to send is not stored at all.

import { prisma } from "@repo/db/client";
import type { ProactiveCandidate } from "../decision/proactive-decision";

export const MAX_SEND_ATTEMPTS  = 3;
export const SENDING_STALE_MS   = 2 * 60_000;
export const RETRY_WINDOW_HOURS = 3;

const COUNTS_AS_DELIVERED = ["sent", "unknown", "sending"];
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

export interface OutboxRow {
  id:            string;
  profileId:     string;
  type:          string;
  occurrenceKey: string;
  status:        string;
  text:          string | null;
  attempts:      number;
  firedAt:       Date;
}

const SELECT = { id: true, profileId: true, eventType: true, occurrenceKey: true, status: true, text: true, attempts: true, firedAt: true } as const;
const toRow = (r: { id: string; profileId: string; eventType: string; occurrenceKey: string | null; status: string | null; text: string | null; attempts: number; firedAt: Date }): OutboxRow =>
  ({ id: r.id, profileId: r.profileId, type: r.eventType, occurrenceKey: r.occurrenceKey ?? "", status: r.status ?? "", text: r.text, attempts: r.attempts, firedAt: r.firedAt });

// What already went out today, for the gates.
export async function loadDelivered(profileId: string, localDay: string): Promise<{ today: Array<{ type: string; at: Date }>; lastSentAt: Date | null }> {
  const [today, last] = await Promise.all([
    prisma.novaProactiveMessage.findMany({
      where:  { profileId, localDay, status: { in: COUNTS_AS_DELIVERED } },
      select: { eventType: true, sentAt: true, firedAt: true },
    }),
    prisma.novaProactiveMessage.findFirst({
      where:   { profileId, status: { in: COUNTS_AS_DELIVERED } },
      orderBy: { firedAt: "desc" },
      select:  { sentAt: true, firedAt: true },
    }),
  ]);
  return {
    today:      today.map(r => ({ type: r.eventType, at: r.sentAt ?? r.firedAt })),
    lastSentAt: last ? (last.sentAt ?? last.firedAt) : null,
  };
}

// Claims the occurrence. null: it was already claimed (now or earlier), so
// this tick has nothing to do with it.
export async function claimOccurrence(
  profileId: string,
  candidate: ProactiveCandidate,
  localDay:  string,
  priority:  number,
  now:       Date,
): Promise<OutboxRow | null> {
  try {
    const row = await prisma.novaProactiveMessage.create({
      data: {
        profileId, eventType: candidate.type, occurrenceKey: candidate.occurrenceKey, localDay,
        status: "claimed", firedAt: now, cooldownUntil: now, priority, confidence: 1, approved: true,
      },
      select: SELECT,
    });
    return toRow(row);
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function markReady(id: string, text: string): Promise<void> {
  await prisma.novaProactiveMessage.updateMany({ where: { id, status: "claimed" }, data: { status: "ready", text } });
}

// Takes the row for one send attempt. false: someone else has it, or it is
// already finished.
export async function beginSend(id: string, now: Date): Promise<boolean> {
  const taken = await prisma.novaProactiveMessage.updateMany({
    where: { id, status: { in: ["ready", "failed"] }, attempts: { lt: MAX_SEND_ATTEMPTS } },
    data:  { status: "sending", attempts: { increment: 1 }, sentAt: now },
  });
  return taken.count === 1;
}

export async function markSent(id: string, messageId: number, now: Date): Promise<void> {
  await prisma.novaProactiveMessage.updateMany({
    where: { id, status: "sending" },
    data:  { status: "sent", telegramMessageId: messageId, sentAt: now, lastError: null },
  });
}

// retryable: try again on a later tick, up to MAX_SEND_ATTEMPTS.
// permanent: the chat cannot be reached or the message was refused.
// unknown:   no answer came back; it may have arrived.
export async function markSendFailed(id: string, outcome: "retryable" | "permanent" | "unknown", error: string): Promise<void> {
  if (outcome === "unknown") {
    await prisma.novaProactiveMessage.updateMany({ where: { id, status: "sending" }, data: { status: "unknown", lastError: error.slice(0, 200) } });
    return;
  }
  const row = await prisma.novaProactiveMessage.findUnique({ where: { id }, select: { attempts: true } });
  const exhausted = outcome === "permanent" || (row?.attempts ?? MAX_SEND_ATTEMPTS) >= MAX_SEND_ATTEMPTS;
  await prisma.novaProactiveMessage.updateMany({
    where: { id, status: "sending" },
    data:  { status: exhausted ? "abandoned" : "failed", sentAt: null, lastError: error.slice(0, 200) },
  });
}

// Work a restart or a failed send left behind, for one learner:
//   stale "sending"  → unknown (never resent)
//   stale "claimed"  → abandoned if too old to matter, else returned to be worded
//   "ready"/"failed" → returned to be sent, while still inside the retry window
export async function recoverPending(profileId: string, now: Date): Promise<OutboxRow[]> {
  const stale  = new Date(now.getTime() - SENDING_STALE_MS);
  const oldest = new Date(now.getTime() - RETRY_WINDOW_HOURS * 3_600_000);

  await prisma.novaProactiveMessage.updateMany({
    where: { profileId, status: "sending", sentAt: { lt: stale } },
    data:  { status: "unknown", lastError: "process ended during send" },
  });
  await prisma.novaProactiveMessage.updateMany({
    where: { profileId, status: { in: ["claimed", "ready", "failed"] }, firedAt: { lt: oldest } },
    data:  { status: "abandoned", lastError: "retry window passed" },
  });
  const rows = await prisma.novaProactiveMessage.findMany({
    where: {
      profileId, firedAt: { gte: oldest },
      OR: [{ status: { in: ["ready", "failed"] } }, { status: "claimed", firedAt: { lt: stale } }],
    },
    orderBy: { firedAt: "asc" },
    select:  SELECT,
  });
  return rows.map(toRow);
}

// Rows from before the outbox recorded every tick's decision, sent or not.
// They carry no status; nothing reads them. Dropped a week after they were
// written.
export async function purgeLegacyDecisions(now = new Date()): Promise<number> {
  const gone = await prisma.novaProactiveMessage.deleteMany({
    where: { status: null, createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
  });
  return gone.count;
}
