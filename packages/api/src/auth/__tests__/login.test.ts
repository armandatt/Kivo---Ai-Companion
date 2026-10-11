import { defaultAuthDeps } from "../auth-deps";
import {
  LOGIN_ATTEMPTS_PER_WINDOW,
  LOGIN_PAUSED_MESSAGE,
  LOGIN_REJECTED_MESSAGE,
  LOGIN_WINDOW_MS,
  loginWithPassword,
} from "../login.service";
import { completePasswordReset, requestPasswordReset } from "../password-reset.service";
import { createRateLimiter } from "../rate-limiter";
import { clearThrottle, consumeThrottle, type ThrottleRule } from "../throttle";
import { fakeAuth, minutesAfter } from "./fake-auth";

const verified = {
  id: "u1",
  email: "asha@gmail.com",
  name: "Asha",
  password: "hashed(correct horse 42)",
  emailVerified: new Date("2026-10-01T00:00:00Z"),
  userProfile: { onboardingComplete: true },
};

describe("email and password login", () => {
  it("signs in with the right password", async () => {
    const { deps } = fakeAuth({ users: [verified] });
    const result = await loginWithPassword({ email: "asha@gmail.com", password: "correct horse 42" }, { deps });

    expect(result).toEqual({
      ok: true,
      user: { id: "u1", email: "asha@gmail.com", name: "Asha", image: null, onboardingComplete: true },
    });
  });

  it("matches the address whatever its case or padding", async () => {
    const { deps } = fakeAuth({ users: [verified] });
    const result = await loginWithPassword({ email: " ASHA@Gmail.com ", password: "correct horse 42" }, { deps });

    expect(result.ok).toBe(true);
  });

  it("reports onboarding as not complete when there is no profile", async () => {
    const { deps } = fakeAuth({ users: [{ ...verified, userProfile: null }] });
    const result = await loginWithPassword({ email: "asha@gmail.com", password: "correct horse 42" }, { deps });

    expect(result.ok && result.user.onboardingComplete).toBe(false);
  });

  it("still signs in an account from before email verification existed", async () => {
    const legacy = { ...verified, email: "old@yahoo.com", emailVerified: null };
    const { deps } = fakeAuth({ users: [legacy] });
    const result = await loginWithPassword({ email: "old@yahoo.com", password: "correct horse 42" }, { deps });

    expect(result.ok).toBe(true);
  });

  it("gives a wrong password, an unknown address and a Google-only account the same refusal", async () => {
    const googleOnly = { id: "u2", email: "google@gmail.com", password: null };
    const { deps } = fakeAuth({ users: [verified, googleOnly] });

    const wrongPassword = await loginWithPassword({ email: "asha@gmail.com", password: "wrong password" }, { deps });
    const unknown = await loginWithPassword({ email: "nobody@gmail.com", password: "correct horse 42" }, { deps });
    const noPassword = await loginWithPassword({ email: "google@gmail.com", password: "anything at all" }, { deps });
    const malformed = await loginWithPassword({ email: "not an email", password: "anything at all" }, { deps });

    expect(wrongPassword).toEqual({ ok: false, status: 401, error: LOGIN_REJECTED_MESSAGE });
    expect(unknown).toEqual(wrongPassword);
    expect(noPassword).toEqual(wrongPassword);
    expect(malformed).toEqual(wrongPassword);
  });

  it("compares a hash even when there is no account, so the reply takes as long", async () => {
    const { deps } = fakeAuth({ users: [verified] });
    const verifyPassword = jest.fn(deps.verifyPassword);

    await loginWithPassword({ email: "nobody@gmail.com", password: "x" }, { deps: { ...deps, verifyPassword } });

    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("asks for both fields", async () => {
    const { deps } = fakeAuth();
    expect(await loginWithPassword({ email: "asha@gmail.com" }, { deps })).toMatchObject({ ok: false, status: 400 });
    expect(await loginWithPassword({ password: "x" }, { deps })).toMatchObject({ ok: false, status: 400 });
  });

  it("uses bcrypt for real, and the decoy is a hash bcrypt can compare", async () => {
    const hash = await defaultAuthDeps.hashPassword("correct horse 42");

    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await defaultAuthDeps.verifyPassword("correct horse 42", hash)).toBe(true);
    expect(await defaultAuthDeps.verifyPassword("wrong", hash)).toBe(false);

    const { deps } = fakeAuth();
    const result = await loginWithPassword(
      { email: "nobody@gmail.com", password: "x" },
      { deps: { ...deps, verifyPassword: defaultAuthDeps.verifyPassword } },
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});

describe("failed sign-ins are limited per address", () => {
  const RIGHT = "correct horse 42";
  const windowMinutes = LOGIN_WINDOW_MS / 60_000;

  async function exhaust(auth: ReturnType<typeof fakeAuth>, email: string, from: Date) {
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; i++) {
      const result = await loginWithPassword({ email, password: `wrong guess ${i}` }, { deps: auth.deps, now: from });
      expect(result).toMatchObject({ ok: false, status: 401 });
    }
  }

  it(`pauses the address after ${LOGIN_ATTEMPTS_PER_WINDOW} tries, even for the right password`, async () => {
    const auth = fakeAuth({ users: [verified] });
    const t0 = auth.clock.now;
    await exhaust(auth, "asha@gmail.com", t0);

    const guess = await loginWithPassword({ email: "asha@gmail.com", password: "one more guess" }, { deps: auth.deps, now: t0 });
    const right = await loginWithPassword({ email: "asha@gmail.com", password: RIGHT }, { deps: auth.deps, now: minutesAfter(t0, 1) });

    expect(guess).toMatchObject({ ok: false, status: 429, error: LOGIN_PAUSED_MESSAGE });
    expect(right).toMatchObject({ ok: false, status: 429 });
    expect(right.ok === false && right.retryAfterSeconds).toBe((windowMinutes - 1) * 60);
  });

  it("does not look at the password while paused", async () => {
    const auth = fakeAuth({ users: [verified] });
    await exhaust(auth, "asha@gmail.com", auth.clock.now);
    const verifyPassword = jest.fn(auth.deps.verifyPassword);

    await loginWithPassword({ email: "asha@gmail.com", password: RIGHT }, { deps: { ...auth.deps, verifyPassword }, now: auth.clock.now });

    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("is a pause, not a lock: it ends by itself when the window does", async () => {
    const auth = fakeAuth({ users: [verified] });
    const t0 = auth.clock.now;
    await exhaust(auth, "asha@gmail.com", t0);

    const later = await loginWithPassword(
      { email: "asha@gmail.com", password: RIGHT },
      { deps: auth.deps, now: minutesAfter(t0, windowMinutes) },
    );

    expect(later.ok).toBe(true);
  });

  it("a successful sign-in gives the tries back", async () => {
    const auth = fakeAuth({ users: [verified] });
    const now = auth.clock.now;

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW - 1; i++) {
        await loginWithPassword({ email: "asha@gmail.com", password: "typo" }, { deps: auth.deps, now });
      }
      expect((await loginWithPassword({ email: "asha@gmail.com", password: RIGHT }, { deps: auth.deps, now })).ok).toBe(true);
    }
    expect(auth.throttles).toHaveLength(0);
  });

  it("a completed password reset ends the pause at once", async () => {
    const auth = fakeAuth({ users: [verified] });
    const t0 = auth.clock.now;
    await exhaust(auth, "asha@gmail.com", t0);

    await requestPasswordReset({ email: "asha@gmail.com" }, { deps: auth.deps, now: t0 });
    await completePasswordReset({ token: auth.lastResetToken(), password: "a brand new pass 7" }, { deps: auth.deps, now: t0 });
    const result = await loginWithPassword({ email: "asha@gmail.com", password: "a brand new pass 7" }, { deps: auth.deps, now: t0 });

    expect(result.ok).toBe(true);
  });

  it("counts the address however it is written", async () => {
    const auth = fakeAuth({ users: [verified] });
    const now = auth.clock.now;
    const spellings = ["asha@gmail.com", "ASHA@GMAIL.COM", "  Asha@Gmail.com  "];

    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; i++) {
      await loginWithPassword({ email: spellings[i % 3], password: "wrong" }, { deps: auth.deps, now });
    }
    const result = await loginWithPassword({ email: "aSHa@gmail.com", password: RIGHT }, { deps: auth.deps, now });

    expect(result).toMatchObject({ ok: false, status: 429 });
  });

  it("limits each address on its own, and an unknown address exactly like a real one", async () => {
    const auth = fakeAuth({ users: [verified] });
    const now = auth.clock.now;
    await exhaust(auth, "nobody@gmail.com", now);

    const unknown = await loginWithPassword({ email: "nobody@gmail.com", password: "x" }, { deps: auth.deps, now });
    const real = await loginWithPassword({ email: "asha@gmail.com", password: RIGHT }, { deps: auth.deps, now });

    expect(unknown).toMatchObject({ ok: false, status: 429, error: LOGIN_PAUSED_MESSAGE });
    expect(real.ok).toBe(true);
  });

  it("holds at the limit when many guesses arrive at once", async () => {
    const auth = fakeAuth({ users: [verified] });
    const now = auth.clock.now;

    const results = await Promise.all(
      Array.from({ length: LOGIN_ATTEMPTS_PER_WINDOW * 3 }, (_, i) =>
        loginWithPassword({ email: "asha@gmail.com", password: `guess ${i}` }, { deps: auth.deps, now }),
      ),
    );

    expect(results.filter((result) => !result.ok && result.status === 401)).toHaveLength(LOGIN_ATTEMPTS_PER_WINDOW);
    expect(results.filter((result) => !result.ok && result.status === 429)).toHaveLength(LOGIN_ATTEMPTS_PER_WINDOW * 2);
  });

  it("lives in the database, not in the process, and stores no address", async () => {
    const auth = fakeAuth({ users: [verified] });
    const now = auth.clock.now;
    await exhaust(auth, "asha@gmail.com", now);

    // What a restarted or second instance has: the same tables, nothing else.
    const elsewhere = { ...auth.deps };
    const result = await loginWithPassword({ email: "asha@gmail.com", password: RIGHT }, { deps: elsewhere, now });

    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(auth.throttles).toHaveLength(1);
    expect(JSON.stringify(auth.throttles)).not.toContain("asha");
  });
});

describe("persisted throttle", () => {
  const rule: ThrottleRule = { scope: "test", limit: 3, windowMs: 60_000 };

  it("allows up to the limit, then refuses with the wait until the window ends", async () => {
    const { deps, clock } = fakeAuth();
    const at = (seconds: number) => new Date(clock.now.getTime() + seconds * 1000);

    expect((await consumeThrottle(deps.db, rule, "a", at(0))).allowed).toBe(true);
    expect((await consumeThrottle(deps.db, rule, "a", at(1))).allowed).toBe(true);
    expect((await consumeThrottle(deps.db, rule, "a", at(2))).allowed).toBe(true);
    expect(await consumeThrottle(deps.db, rule, "a", at(30))).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect((await consumeThrottle(deps.db, rule, "a", at(60))).allowed).toBe(true);
  });

  it("keeps subjects and rules apart", async () => {
    const { deps, clock } = fakeAuth();
    const one: ThrottleRule = { scope: "one", limit: 1, windowMs: 60_000 };
    const two: ThrottleRule = { scope: "two", limit: 1, windowMs: 60_000 };

    expect((await consumeThrottle(deps.db, one, "a", clock.now)).allowed).toBe(true);
    expect((await consumeThrottle(deps.db, one, "a", clock.now)).allowed).toBe(false);
    expect((await consumeThrottle(deps.db, one, "b", clock.now)).allowed).toBe(true);
    expect((await consumeThrottle(deps.db, two, "a", clock.now)).allowed).toBe(true);
  });

  it("enforces a gap between hits when given a cooldown", async () => {
    const { deps, clock } = fakeAuth();
    const spaced: ThrottleRule = { scope: "spaced", limit: 5, windowMs: 3_600_000, cooldownMs: 60_000 };
    const at = (seconds: number) => new Date(clock.now.getTime() + seconds * 1000);

    expect((await consumeThrottle(deps.db, spaced, "a", at(0))).allowed).toBe(true);
    expect(await consumeThrottle(deps.db, spaced, "a", at(20))).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect((await consumeThrottle(deps.db, spaced, "a", at(60))).allowed).toBe(true);
  });

  it("starts again once cleared", async () => {
    const { deps, clock } = fakeAuth();
    const once: ThrottleRule = { scope: "once", limit: 1, windowMs: 60_000 };
    await consumeThrottle(deps.db, once, "a", clock.now);
    await clearThrottle(deps.db, once, "a");

    expect((await consumeThrottle(deps.db, once, "a", clock.now)).allowed).toBe(true);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit, then refuses with the wait until the window ends", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });

    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 1_000).allowed).toBe(true);
    expect(limiter.hit("a", 2_000).allowed).toBe(true);
    expect(limiter.hit("a", 30_000)).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it("counts each key on its own and starts again after the window", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 1).allowed).toBe(false);
    expect(limiter.hit("b", 1).allowed).toBe(true);
    expect(limiter.hit("a", 60_000).allowed).toBe(true);
  });

  it("enforces a gap between hits when given a cooldown", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 3_600_000, cooldownMs: 60_000 });

    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 20_000)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(limiter.hit("a", 60_000).allowed).toBe(true);
  });

  it("forgets a key that is reset", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.hit("a", 0);
    limiter.reset("a");

    expect(limiter.hit("a", 1).allowed).toBe(true);
  });
});
