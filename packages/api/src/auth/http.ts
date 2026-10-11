// ─── Auth: the request layer ──────────────────────────────────────────────────
// Everything an auth POST goes through before and after its service, written
// against the standard Request so it can be tested without Next: refuse
// cross-site requests, work out who is calling, apply the per-caller limit,
// read the body, run the service, shape the reply. The route files in
// apps/api only turn the result into a response and set the session cookie.
//
// Who is calling. The API sits behind the web app, which is the only thing
// that knows the browser's address. The web app's auth proxy sends that
// address together with a proof derived from the secret the two apps share
// (proxyProof). Only with a valid proof is the address believed.
// X-Forwarded-For is never read: anyone can reach the API directly and write
// whatever they like in it. A request without the proof is "direct", and all
// direct callers share one allowance per route, so no header gets a caller a
// fresh one.
//
// These per-caller limits only slow a single source down. The limits that
// protect an account or a code are per address and live in Postgres
// (throttle.ts): they hold whoever is asking.

import { defaultAuthDeps, type AuthDeps, type AuthFailure, type SessionUser } from "./auth-deps";
import { errorLabel } from "./error-label";
import { loginWithPassword } from "./login.service";
import { completePasswordReset, requestPasswordReset } from "./password-reset.service";
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "./proxy-headers";
import { createRateLimiter, type RateLimiter } from "./rate-limiter";
import { crossSiteProblem, originOf } from "./request-origin";
import { proxyProof, safeEqual } from "./secrets";
import { resendSignupCode, startSignup, verifySignup } from "./signup.service";

export type AuthRoute =
  | "login"
  | "signup"
  | "signup-verify"
  | "signup-resend"
  | "forgot-password"
  | "reset-password";


export interface AuthHttpResult {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** Set when the request ends with someone signed in: the route grants the session. */
  sessionUser?: SessionUser;
}

export type CallerLimits = Record<AuthRoute, RateLimiter>;

const MINUTE = 60 * 1000;

export function createCallerLimits(): CallerLimits {
  return {
    login: createRateLimiter({ limit: 30, windowMs: 15 * MINUTE }),
    signup: createRateLimiter({ limit: 10, windowMs: 60 * MINUTE }),
    "signup-verify": createRateLimiter({ limit: 30, windowMs: 15 * MINUTE }),
    "signup-resend": createRateLimiter({ limit: 10, windowMs: 60 * MINUTE }),
    "forgot-password": createRateLimiter({ limit: 5, windowMs: 15 * MINUTE }),
    "reset-password": createRateLimiter({ limit: 10, windowMs: 15 * MINUTE }),
  };
}

const defaultCallerLimits = createCallerLimits();

export interface AuthHttpOptions {
  deps?: AuthDeps;
  callerLimits?: CallerLimits;
  now?: Date;
}

/** The limiter key for whoever sent this request. Never taken from X-Forwarded-For. */
export function callerOf(headers: Headers): string {
  const proof = headers.get(PROXY_PROOF_HEADER);
  if (!proof || !safeEqual(proof, proxyProof())) return "direct";

  const ip = headers.get(PROXY_CLIENT_IP_HEADER)?.trim();
  return ip ? `ip:${ip}` : "proxy:unknown";
}

function reply(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): AuthHttpResult {
  return { status, body, headers };
}

function failure(result: AuthFailure): AuthHttpResult {
  return result.retryAfterSeconds
    ? reply(
        result.status,
        { error: result.error, retryAfterSeconds: result.retryAfterSeconds },
        { "Retry-After": String(result.retryAfterSeconds) },
      )
    : reply(result.status, { error: result.error });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleAuthRequest(
  route: AuthRoute,
  req: Request,
  options: AuthHttpOptions = {},
): Promise<AuthHttpResult> {
  const { deps = defaultAuthDeps, callerLimits = defaultCallerLimits, now = new Date() } = options;

  try {
    const problem = crossSiteProblem(req.headers, [originOf(deps.appUrl())]);
    if (problem) return reply(problem.status, { error: problem.error });

    const limit = callerLimits[route].hit(callerOf(req.headers), now.getTime());
    if (!limit.allowed) {
      return reply(
        429,
        { error: "Too many attempts. Please try again later.", retryAfterSeconds: limit.retryAfterSeconds },
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    const body = await readJson(req);
    if (!body) return reply(400, { error: "The request body must be a JSON object." });

    const context = { deps, now };

    switch (route) {
      case "login": {
        const result = await loginWithPassword(body, context);
        if (!result.ok) return failure(result);
        const { onboardingComplete, ...sessionUser } = result.user;
        return { ...reply(200, { success: true, user: result.user }), sessionUser };
      }
      case "signup": {
        const result = await startSignup(body, context);
        if (!result.ok) return failure(result);
        return reply(200, {
          verificationRequired: true,
          email: result.email,
          signupToken: result.signupToken,
          message: "We sent a verification code to your email.",
        });
      }
      case "signup-verify": {
        const result = await verifySignup(body, context);
        if (!result.ok) return failure(result);
        return { ...reply(201, { message: "Account created", user: result.user }), sessionUser: result.user };
      }
      case "signup-resend": {
        const result = await resendSignupCode(body, context);
        if (!result.ok) return failure(result);
        return reply(200, { message: "If that signup is still open, we sent a new code." });
      }
      case "forgot-password": {
        if (!body.email) return reply(400, { error: "Email is required" });
        const result = await requestPasswordReset(body, context);
        if (!result.ok) return failure(result);
        return reply(200, { message: result.message });
      }
      case "reset-password": {
        const result = await completePasswordReset(body, context);
        if (!result.ok) return failure(result);
        return reply(200, { message: "Password reset successfully. You can now sign in." });
      }
    }
  } catch (error) {
    console.error(`[AUTH ${route}] failed: ${errorLabel(error)}`);
    return reply(500, { error: "Something went wrong. Please try again." });
  }
}
