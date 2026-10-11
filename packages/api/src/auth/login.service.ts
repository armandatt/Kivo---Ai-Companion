// ─── Auth: email and password login ───────────────────────────────────────────
// One refusal for every failure: unknown address, an account with no password
// (it signs in with Google), or a wrong password. A hash is compared in all
// three, so the reply takes as long for an address with no account.
//
// Guessing is limited per address, in Postgres, whoever is asking and from
// wherever: each try takes one of LOGIN_ATTEMPTS_PER_WINDOW before the
// password is looked at, and a success gives them all back. When they run out
// the address is refused until the window ends, even with the right password.
// It is a pause, not a lock: it ends by itself, a completed password reset
// ends it at once, and Google sign-in is never affected. The same limit
// applies to addresses with no account, so it reveals nothing.
//
// Accounts created before email verification existed have emailVerified null
// and still sign in here: login is not gated on it.

import {
  defaultAuthDeps,
  fail,
  toSessionUser,
  type AuthDeps,
  type AuthFailure,
  type SessionUser,
} from "./auth-deps";
import { normalizeEmail } from "./email-rules";
import { clearThrottle, consumeThrottle, type ThrottleRule } from "./throttle";

export const LOGIN_REJECTED_MESSAGE = "Invalid email or password";
export const LOGIN_PAUSED_MESSAGE =
  "Too many sign-in attempts for this email. Wait a few minutes and try again, or reset your password.";

export const LOGIN_ATTEMPTS_PER_WINDOW = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const LOGIN_ATTEMPTS: ThrottleRule = {
  scope: "login-attempt",
  limit: LOGIN_ATTEMPTS_PER_WINDOW,
  windowMs: LOGIN_WINDOW_MS,
};

// A valid bcrypt hash of a discarded random value, compared when there is no
// real hash to compare.
const DECOY_HASH = "$2b$10$clnP0MfAr9xRurlglL7.yOgA9eGcjtYCXNG47U/E1lm6Sv/Yu9PPS";

export type LoginResult =
  | { ok: true; user: SessionUser & { onboardingComplete: boolean } }
  | AuthFailure;

export async function loginWithPassword(
  input: { email?: unknown; password?: unknown },
  options: { deps?: AuthDeps; now?: Date } = {},
): Promise<LoginResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;
  if (!input.email || !input.password) return fail(400, "Email and password are required");

  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  if (email) {
    const attempt = await consumeThrottle(deps.db, LOGIN_ATTEMPTS, email, now);
    if (!attempt.allowed) return fail(429, LOGIN_PAUSED_MESSAGE, attempt.retryAfterSeconds);
  }

  const user = email
    ? await deps.db.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          password: true,
          userProfile: { select: { onboardingComplete: true } },
        },
      })
    : null;

  const matches = await deps.verifyPassword(password, user?.password ?? DECOY_HASH);
  if (!user || !user.password || !matches) return fail(401, LOGIN_REJECTED_MESSAGE);

  await clearThrottle(deps.db, LOGIN_ATTEMPTS, user.email);

  return {
    ok: true,
    user: {
      ...toSessionUser(user),
      onboardingComplete: user.userProfile?.onboardingComplete ?? false,
    },
  };
}
