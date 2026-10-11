// ─── Auth: in-memory rate limiter ─────────────────────────────────────────────
// A fixed window per key, held in this process. Like the Telegram processing
// lock, it is correct only because the API runs as one persistent instance.
// The count that guards a code against guessing is not here: it lives in
// Postgres with the code (PendingSignup.attempts).

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, now?: number): RateLimitResult;
  reset(key: string): void;
}

const MAX_KEYS = 20_000;

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** Minimum gap between two hits on the same key. */
  cooldownMs?: number;
}): RateLimiter {
  const { limit, windowMs, cooldownMs = 0 } = options;
  const windows = new Map<string, { startedAt: number; count: number; lastAt: number }>();

  function prune(now: number) {
    if (windows.size < MAX_KEYS) return;
    for (const [key, entry] of windows) {
      if (now - entry.startedAt >= windowMs) windows.delete(key);
    }
  }

  return {
    hit(key, now = Date.now()) {
      const entry = windows.get(key);
      if (!entry || now - entry.startedAt >= windowMs) {
        prune(now);
        windows.set(key, { startedAt: now, count: 1, lastAt: now });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (entry.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((entry.startedAt + windowMs - now) / 1000) };
      }
      if (now - entry.lastAt < cooldownMs) {
        return { allowed: false, retryAfterSeconds: Math.ceil((entry.lastAt + cooldownMs - now) / 1000) };
      }
      entry.count += 1;
      entry.lastAt = now;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset(key) {
      windows.delete(key);
    },
  };
}
