// ─── Telegram transport safety ────────────────────────────────────────────────
// Two checks that run before any message processing:
//   1. the request really came from Telegram (secret token header)
//   2. this update has not been processed before (update_id, in Postgres)
//
// Dedup is database-backed on purpose: an in-process Map is lost on restart
// and is wrong the moment there is a second instance.

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@repo/db/client";

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

export type SecretCheck = "ok" | "rejected" | "not_configured";

// Telegram sends the secret_token given to setWebhook in this header.
// Unset TELEGRAM_WEBHOOK_SECRET means the webhook was registered without one;
// requests are let through so an existing deployment keeps working until the
// webhook is re-registered with a secret.
export function verifyTelegramSecret(header: string | null): SecretCheck {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return "not_configured";
  if (!header) return "rejected";

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "rejected";
}

export type UpdateClaim = "claimed" | "duplicate" | "no_update_id" | "unavailable";

// Inserts the update_id. The primary key is the dedup: a second insert of the
// same id fails, atomically, regardless of timing or instance count.
export async function claimTelegramUpdate(updateId: unknown): Promise<UpdateClaim> {
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) return "no_update_id";

  try {
    await prisma.processedTelegramUpdate.create({ data: { updateId: BigInt(updateId) } });
    return "claimed";
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2002") return "duplicate";
    // Dedup must never take the bot down: if the claim itself fails, process
    // the message and say so.
    console.error("[telegram] update claim failed, processing without dedup:", err);
    return "unavailable";
  }
}

// ── Retention ─────────────────────────────────────────────────────────────────
// Telegram retries a failed delivery for a limited time (about a day) and
// update_ids only ever increase, so an id much older than that cannot come
// back. Seven days is a wide margin. Rows older than the window are deleted;
// rows inside it are never touched, so cleanup cannot weaken dedup.

export const UPDATE_RETENTION_DAYS = 7;

export async function purgeProcessedTelegramUpdates(now = new Date()): Promise<number> {
  const cutoff  = new Date(now.getTime() - UPDATE_RETENTION_DAYS * 86_400_000);
  const removed = await prisma.processedTelegramUpdate.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  return removed.count;
}

export interface Admission {
  admit:  boolean;
  status: 200 | 401;
  reason: "ok" | "bad_secret" | "duplicate_update";
}

let warnedNoSecret = false;

export async function admitTelegramUpdate(input: {
  secretHeader: string | null;
  updateId:     unknown;
}): Promise<Admission> {
  const secret = verifyTelegramSecret(input.secretHeader);
  if (secret === "rejected") return { admit: false, status: 401, reason: "bad_secret" };
  if (secret === "not_configured" && !warnedNoSecret) {
    warnedNoSecret = true;
    console.warn("[telegram] TELEGRAM_WEBHOOK_SECRET is not set: webhook requests are not authenticated");
  }

  const claim = await claimTelegramUpdate(input.updateId);
  if (claim === "duplicate") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), layer: "telegram", skipped: "duplicate_update", updateId: input.updateId }));
    // 200 so Telegram stops retrying an update that was already handled.
    return { admit: false, status: 200, reason: "duplicate_update" };
  }
  return { admit: true, status: 200, reason: "ok" };
}
