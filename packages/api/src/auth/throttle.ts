// ─── Auth: persisted limits ───────────────────────────────────────────────────
// A fixed window per (rule, subject), kept in Postgres (AuthThrottle). These
// are the limits that have to hold whoever is asking: the subject is the
// account's address, never anything the caller supplies about itself, and the
// count survives a restart or a second instance.
//
// A hit is taken with one guarded UPDATE, so two requests cannot both take the
// last one. Every limit here is temporary: when the window ends the count
// starts again, and nothing is ever locked for good.

import type { AuthDb } from "./auth-deps";
import type { RateLimitResult } from "./rate-limiter";
import { throttleKey } from "./secrets";

export interface ThrottleRule {
  scope: string;
  limit: number;
  windowMs: number;
  /** Minimum gap between two hits on the same subject. */
  cooldownMs?: number;
}

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Takes one hit against the rule. Refused once the window is full or inside the cooldown. */
export async function consumeThrottle(
  db: AuthDb,
  rule: ThrottleRule,
  subject: string,
  now: Date,
): Promise<RateLimitResult> {
  const key = throttleKey(rule.scope, subject);
  const { limit, windowMs, cooldownMs = 0 } = rule;

  // A window that has ended starts again from zero.
  await db.authThrottle.updateMany({
    where: { key, windowStart: { lte: new Date(now.getTime() - windowMs) } },
    data: { count: 0, windowStart: now },
  });

  const take = () =>
    db.authThrottle.updateMany({
      where: {
        key,
        count: { lt: limit },
        ...(cooldownMs > 0 ? { lastAt: { lte: new Date(now.getTime() - cooldownMs) } } : {}),
      },
      data: { count: { increment: 1 }, lastAt: now },
    });

  if ((await take()).count === 1) return ALLOWED;

  // Either there is no row yet, or the row refused the hit.
  try {
    await db.authThrottle.create({ data: { key, count: 1, windowStart: now, lastAt: now } });
    // First hit for this subject: a cheap moment to drop rows nobody has touched.
    await db.authThrottle.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } } });
    return ALLOWED;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  // The row appeared between the two statements: it may still have room.
  if ((await take()).count === 1) return ALLOWED;

  const row = await db.authThrottle.findUnique({ where: { key } });
  if (!row) return ALLOWED;

  const untilMs =
    row.count >= limit
      ? row.windowStart.getTime() + windowMs
      : row.lastAt.getTime() + cooldownMs;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((untilMs - now.getTime()) / 1000)) };
}

/** Forgets the count for a subject, e.g. after a successful sign-in. */
export async function clearThrottle(db: AuthDb, rule: ThrottleRule, subject: string): Promise<void> {
  await db.authThrottle.deleteMany({ where: { key: throttleKey(rule.scope, subject) } });
}
