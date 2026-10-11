/**
 * Auth — real Postgres integration test.
 *
 * The unit tests run the auth services against an in-memory fake. This file
 * runs the same services against real tables, which is the only way to show:
 *   - every query the services send is one Prisma and Postgres accept
 *   - a signup belongs to the browser that started it: nobody else can
 *     change, resend or verify it, and a takeover attempt fails
 *   - a verification code creates one account when it arrives many times at once
 *   - wrong codes are counted across resends, and the count holds under load
 *   - failed sign-ins and sent emails are limited per address in the database,
 *     under concurrency and without a process's memory
 *   - a reset link changes the password once when it is used many times at once
 *   - an existing account, its profile and its id survive every auth path
 *
 * Passwords are hashed with bcrypt for real. Email is captured, not sent.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { prisma } = await import("@repo/db/client");
const { defaultAuthDeps } = await import("../auth-deps.js");
const {
  startSignup, resendSignupCode, verifySignup,
  OTP_MAX_ATTEMPTS, SIGNUP_SENDS_PER_DAY, SIGNUP_SENDS_PER_HOUR,
} = await import("../signup.service.js");
const { loginWithPassword, LOGIN_ATTEMPTS_PER_WINDOW, LOGIN_WINDOW_MS } = await import("../login.service.js");
const { requestPasswordReset, completePasswordReset } = await import("../password-reset.service.js");
const { readGoogleClaims, resolveGoogleSignIn } = await import("../google-signin.service.js");
const { handleAuthRequest, createCallerLimits } = await import("../http.js");
const { hashToken, throttleKey } = await import("../secrets.js");

type AuthEmail = import("../auth-email.js").AuthEmail;

const STAMP = Date.now();
const address = (name: string) => `auth_itest_${name}_${STAMP}@gmail.com`;
const PASSWORD = "correct horse 42";
const ATTACKER_PASSWORD = "the attacker's pass 1";

const sent: AuthEmail[] = [];
const deps = {
  ...defaultAuthDeps,
  sendEmail: async (email: AuthEmail) => { sent.push(email); return true; },
  appUrl: () => "https://kivo.test",
};

const base = Date.now();
const at = (minutes: number) => ({ deps, now: new Date(base + minutes * 60_000) });
const used: string[] = [];
const fresh = (name: string) => { const email = address(name); used.push(email); return email; };

function lastTo(to: string, pattern: RegExp): string {
  const match = [...sent].reverse().filter(email => email.to === to).map(email => email.text.match(pattern)).find(Boolean);
  assert.ok(match, `nothing matching ${pattern} was emailed to ${to}`);
  return match[1]!;
}
const codeFor = (to: string) => lastTo(to, /\b(\d{8})\b/);
const tokenFor = (to: string) => lastTo(to, /token=([0-9a-f]{64})/);
const wrongCode = (right: string) => (right === "00000000" ? "00000001" : "00000000");
const sentTo = (to: string) => sent.filter(email => email.to === to).length;

async function begin(email: string, minute: number, password = PASSWORD) {
  const result = await startSignup({ email, password, name: "Asha" }, at(minute));
  assert.ok(result.ok, result.ok ? "" : result.error);
  return { signupToken: result.signupToken, code: codeFor(email) };
}

after(async () => {
  const mine = { email: { startsWith: "auth_itest_", endsWith: `_${STAMP}@gmail.com` } };
  await prisma.pendingSignup.deleteMany({ where: mine });
  await prisma.user.deleteMany({ where: mine });
  await prisma.user.deleteMany({ where: { email: { startsWith: "auth_itest_", endsWith: `_${STAMP}@school.edu` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "auth_itest_", endsWith: `_${STAMP}@yahoo.com` } } });
  const scopes = ["signup-send-hour", "signup-send-day", "login-attempt", "reset-request"];
  await prisma.authThrottle.deleteMany({
    where: { key: { in: used.flatMap(email => scopes.map(scope => throttleKey(scope, email))) } },
  });
  await prisma.$disconnect();
});

test("a legitimate signup: nothing exists until the owner's token and code arrive together", async () => {
  const email = fresh("signup");
  const { signupToken, code } = await begin(email, 0);

  assert.equal(await prisma.user.count({ where: { email } }), 0);
  const pending = await prisma.pendingSignup.findUniqueOrThrow({ where: { tokenHash: hashToken(signupToken) } });
  assert.match(pending.passwordHash, /^\$2[aby]\$10\$/);
  const stored = JSON.stringify(pending);
  assert.ok(!stored.includes(code), "the code is stored only as a hash");
  assert.ok(!stored.includes(signupToken), "the token is stored only as a hash");

  const wrong = await verifySignup({ email, code: wrongCode(code), signupToken }, at(1));
  assert.equal(wrong.ok, false);
  assert.equal((await prisma.pendingSignup.findUniqueOrThrow({ where: { id: pending.id } })).attempts, 1);

  const verified = await verifySignup({ email, code, signupToken }, at(1));
  assert.ok(verified.ok);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userProfile: true, accounts: true } });
  assert.equal(user.id, verified.user.id);
  assert.equal(user.name, "Asha");
  assert.ok(user.emailVerified instanceof Date);
  assert.equal(user.userProfile, null, "signup writes no profile; onboarding still does that");
  assert.equal(user.accounts.length, 0);
  assert.equal(await prisma.pendingSignup.count({ where: { email } }), 0);

  // The code and the token are both spent.
  assert.equal((await verifySignup({ email, code, signupToken }, at(1))).ok, false);
  assert.equal(await prisma.user.count({ where: { email } }), 1);

  const login = await loginWithPassword({ email, password: PASSWORD }, at(2));
  assert.ok(login.ok);
  assert.equal(login.user.id, user.id);
  assert.equal(login.user.onboardingComplete, false);
});

test("a signup takeover fails: a second start cannot change, verify or resend the first", async () => {
  const email = fresh("takeover");
  const victim = await begin(email, 0);
  const victimRow = await prisma.pendingSignup.findUniqueOrThrow({ where: { tokenHash: hashToken(victim.signupToken) } });

  // Someone else starts a signup for the same address with their own password.
  const attacker = await begin(email, 2, ATTACKER_PASSWORD);
  assert.notEqual(attacker.signupToken, victim.signupToken);
  assert.equal(await prisma.pendingSignup.count({ where: { email } }), 2);
  assert.deepEqual(
    await prisma.pendingSignup.findUniqueOrThrow({ where: { id: victimRow.id } }),
    victimRow,
    "the first attempt is byte for byte what it was",
  );

  // The attacker has a token, but the codes went to the owner's inbox.
  // Even if they somehow had the victim's code, their token does not fit it.
  assert.equal((await verifySignup({ email, code: victim.code, signupToken: attacker.signupToken }, at(3))).ok, false);
  // The victim types the newest code (the attacker's) into their own page.
  assert.equal((await verifySignup({ email, code: attacker.code, signupToken: victim.signupToken }, at(3))).ok, false);
  assert.equal(await prisma.user.count({ where: { email } }), 0);

  // The attacker cannot resend for the victim's attempt, with no token or with their own.
  const sentBefore = sentTo(email);
  await resendSignupCode({ email }, at(4));
  await resendSignupCode({ email, signupToken: "ab".repeat(32) }, at(4));
  assert.equal(sentTo(email), sentBefore, "a resend without the attempt's token sends nothing");
  const unchanged = await prisma.pendingSignup.findUniqueOrThrow({ where: { id: victimRow.id } });
  assert.equal(unchanged.codeHash, victimRow.codeHash);

  // The victim finishes with their own code, and it is their password on the account.
  const done = await verifySignup({ email, code: victim.code, signupToken: victim.signupToken }, at(5));
  assert.ok(done.ok);
  assert.ok((await loginWithPassword({ email, password: PASSWORD }, at(6))).ok);
  assert.equal((await loginWithPassword({ email, password: ATTACKER_PASSWORD }, at(6))).ok, false);

  // The attacker's attempt went with it.
  assert.equal(await prisma.pendingSignup.count({ where: { email } }), 0);
  assert.equal((await verifySignup({ email, code: attacker.code, signupToken: attacker.signupToken }, at(7))).ok, false);
  assert.equal(await prisma.user.count({ where: { email } }), 1);
});

test("verification without the right token never succeeds", async () => {
  const email = fresh("notoken");
  const { signupToken, code } = await begin(email, 0);

  for (const token of [undefined, "", "not-a-token", "ab".repeat(32), signupToken.slice(0, 63) + (signupToken.endsWith("0") ? "1" : "0")]) {
    assert.equal((await verifySignup({ email, code, signupToken: token }, at(1))).ok, false);
  }
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  const row = await prisma.pendingSignup.findUniqueOrThrow({ where: { tokenHash: hashToken(signupToken) } });
  assert.equal(row.attempts, 0, "a request without the token does not spend the owner's tries");

  assert.ok((await verifySignup({ email, code, signupToken }, at(1))).ok);
});

test("the same right code arriving many times at once creates one account", async () => {
  const email = fresh("race");
  const { signupToken, code } = await begin(email, 0);

  const results = await Promise.all(
    Array.from({ length: OTP_MAX_ATTEMPTS }, () => verifySignup({ email, code, signupToken }, at(1))),
  );

  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(await prisma.user.count({ where: { email } }), 1);
  assert.equal(await prisma.pendingSignup.count({ where: { email } }), 0);
});

test("two browsers finishing signups for one address at once make one account", async () => {
  const email = fresh("tworace");
  const first = await begin(email, 0);
  const second = await begin(email, 2, "the second pass 22");

  const results = await Promise.all([
    verifySignup({ email, code: first.code, signupToken: first.signupToken }, at(3)),
    verifySignup({ email, code: second.code, signupToken: second.signupToken }, at(3)),
  ]);

  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(await prisma.user.count({ where: { email } }), 1);
  assert.equal(await prisma.pendingSignup.count({ where: { email } }), 0);
});

test("wrong tries are counted in the database, across resends and under load", async () => {
  const email = fresh("attempts");
  const { signupToken, code } = await begin(email, 0);
  const tokenHash = hashToken(signupToken);

  for (let i = 0; i < 4; i++) await verifySignup({ email, code: wrongCode(code), signupToken }, at(1));
  assert.ok((await resendSignupCode({ email, signupToken }, at(2))).ok);
  assert.equal((await prisma.pendingSignup.findUniqueOrThrow({ where: { tokenHash } })).attempts, 4, "a resend does not refill the tries");

  const next = codeFor(email);
  await Promise.all(
    Array.from({ length: OTP_MAX_ATTEMPTS + 6 }, () => verifySignup({ email, code: wrongCode(next), signupToken }, at(3))),
  );
  assert.equal((await prisma.pendingSignup.findUniqueOrThrow({ where: { tokenHash } })).attempts, OTP_MAX_ATTEMPTS);

  assert.equal((await verifySignup({ email, code: next, signupToken }, at(3))).ok, false, "the right code is refused once tries run out");
  const before = sentTo(email);
  await resendSignupCode({ email, signupToken }, at(5));
  assert.equal(sentTo(email), before, "no more codes for an attempt out of tries");
  assert.equal(await prisma.user.count({ where: { email } }), 0);
});

test("emails to one address are limited per hour and per day in the database", async () => {
  const email = fresh("sends");
  const { signupToken } = await begin(email, 0);

  assert.equal((await resendSignupCode({ email, signupToken }, at(0.5))).ok, false, "cooldown");
  for (let i = 1; i < SIGNUP_SENDS_PER_HOUR; i++) {
    assert.ok((await resendSignupCode({ email, signupToken }, at(i * 2))).ok);
  }
  const overHour = await startSignup({ email, password: PASSWORD }, at(20));
  assert.equal(overHour.ok, false);
  assert.equal(!overHour.ok && overHour.status, 429);
  assert.equal(sentTo(email), SIGNUP_SENDS_PER_HOUR);

  // Later hours: spaced so the hourly limit never trips, until the day's does.
  let minute = 61;
  while (sentTo(email) < SIGNUP_SENDS_PER_DAY) {
    assert.ok((await startSignup({ email, password: PASSWORD }, at(minute))).ok);
    minute += 13;
  }
  const overDay = await startSignup({ email, password: PASSWORD }, at(minute));
  assert.equal(overDay.ok, false);
  assert.equal(sentTo(email), SIGNUP_SENDS_PER_DAY);

  const row = await prisma.authThrottle.findUniqueOrThrow({ where: { key: throttleKey("signup-send-day", email) } });
  assert.equal(row.count, SIGNUP_SENDS_PER_DAY);
  assert.ok(!JSON.stringify(row).includes(email), "the limit's key is a hash, not the address");

  assert.ok((await startSignup({ email, password: PASSWORD }, at(24 * 60 + 5))).ok, "the next day it works again");
});

test("an existing account, with its profile, is untouched by a second signup", async () => {
  const email = fresh("existing");
  const original = await prisma.user.create({
    data: {
      email,
      name: "Original",
      password: await deps.hashPassword("the original pass 1"),
      userProfile: { create: { onboardingComplete: true } },
    },
    include: { userProfile: true },
  });
  const before = sent.length;

  const start = await startSignup({ email, password: PASSWORD }, at(0));
  assert.ok(start.ok, "the reply is the same as for a new address");
  assert.match(start.signupToken, /^[0-9a-f]{64}$/);
  assert.match(sent[before]!.subject, /already have/i);
  assert.ok(!/\b\d{8}\b/.test(sent[before]!.text), "no code is sent for an address with an account");

  for (const code of ["12345678", "00000000"]) {
    assert.equal((await verifySignup({ email, code, signupToken: start.signupToken }, at(1))).ok, false);
  }
  await resendSignupCode({ email, signupToken: start.signupToken }, at(2));
  assert.ok(sent.filter(m => m.to === email).every(m => !/\b\d{8}\b/.test(m.text)));

  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { email }, include: { userProfile: true } }), original);

  const login = await loginWithPassword({ email, password: "the original pass 1" }, at(3));
  assert.ok(login.ok, "an account from before verification still signs in");
  assert.equal(login.user.onboardingComplete, true);
});

test("failed sign-ins pause an address, under concurrency, and the pause ends", async () => {
  const email = fresh("login");
  await prisma.user.create({ data: { email, password: await deps.hashPassword(PASSWORD), emailVerified: new Date() } });
  const windowMinutes = LOGIN_WINDOW_MS / 60_000;

  // Three times the limit, all at once: exactly the limit get to try a password.
  const burst = await Promise.all(
    Array.from({ length: LOGIN_ATTEMPTS_PER_WINDOW * 3 }, (_, i) =>
      loginWithPassword({ email, password: `guess number ${i}` }, at(0)),
    ),
  );
  assert.equal(burst.filter(r => !r.ok && r.status === 401).length, LOGIN_ATTEMPTS_PER_WINDOW);
  assert.equal(burst.filter(r => !r.ok && r.status === 429).length, LOGIN_ATTEMPTS_PER_WINDOW * 2);

  const paused = await loginWithPassword({ email, password: PASSWORD }, at(1));
  assert.equal(paused.ok, false, "the right password is refused while paused");
  assert.equal(!paused.ok && paused.status, 429);

  const row = await prisma.authThrottle.findUniqueOrThrow({ where: { key: throttleKey("login-attempt", email) } });
  assert.equal(row.count, LOGIN_ATTEMPTS_PER_WINDOW);

  assert.ok((await loginWithPassword({ email, password: PASSWORD }, at(windowMinutes))).ok, "the pause ends by itself");
  assert.equal(await prisma.authThrottle.count({ where: { key: row.key } }), 0, "a success gives the tries back");

  // And a completed reset ends a pause at once.
  await Promise.all(Array.from({ length: LOGIN_ATTEMPTS_PER_WINDOW }, () => loginWithPassword({ email, password: "wrong again" }, at(windowMinutes + 1))));
  assert.equal((await loginWithPassword({ email, password: PASSWORD }, at(windowMinutes + 1))).ok, false);
  await requestPasswordReset({ email }, at(windowMinutes + 2));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok((await completePasswordReset({ token: tokenFor(email), password: "a recovered pass 9" }, at(windowMinutes + 2))).ok);
  assert.ok((await loginWithPassword({ email, password: "a recovered pass 9" }, at(windowMinutes + 2))).ok);
});

test("through the route: forged headers do not get a caller more password guesses", async () => {
  const email = fresh("route");
  await prisma.user.create({ data: { email, password: await deps.hashPassword(PASSWORD), emailVerified: new Date() } });
  const callerLimits = createCallerLimits();
  const post = (body: unknown, headers: Record<string, string>) =>
    handleAuthRequest(
      "login",
      new Request("https://api.internal.test/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      { deps, callerLimits, now: at(0).now },
    );

  const statuses: number[] = [];
  for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW + 2; i++) {
    const result = await post({ email, password: `guess number ${i}` }, { "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `198.51.100.${i}` });
    statuses.push(result.status);
  }
  assert.deepEqual(statuses.slice(0, LOGIN_ATTEMPTS_PER_WINDOW), Array(LOGIN_ATTEMPTS_PER_WINDOW).fill(401));
  assert.deepEqual(statuses.slice(LOGIN_ATTEMPTS_PER_WINDOW), [429, 429]);

  assert.equal((await post({ email, password: PASSWORD }, { origin: "https://evil.test" })).status, 403);
  assert.equal((await post({ email, password: PASSWORD }, { "content-type": "text/plain" })).status, 415);
});

test("a reset link is stored hashed and changes the password once", async () => {
  const email = fresh("reset");
  const user = await prisma.user.create({ data: { email, password: await deps.hashPassword(PASSWORD) } });

  await requestPasswordReset({ email }, at(0));
  await new Promise(resolve => setImmediate(resolve));
  const token = tokenFor(email);

  const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.token, hashToken(token));

  const passwords = ["first racer pw 1", "second racer pw 2", "third racer pw 3"];
  const results = await Promise.all(passwords.map(password => completePasswordReset({ token, password }, at(1))));
  assert.equal(results.filter(result => result.ok).length, 1);

  const afterReset = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(afterReset.id, user.id);
  assert.ok(afterReset.emailVerified instanceof Date, "a completed reset verifies the email");

  const matches = await Promise.all(passwords.map(password => deps.verifyPassword(password, afterReset.password!)));
  assert.equal(matches.filter(Boolean).length, 1);
  assert.equal(await deps.verifyPassword(PASSWORD, afterReset.password!), false);

  assert.equal((await completePasswordReset({ token, password: "fourth password 4" }, at(2))).ok, false);
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id, used: false } }), 0);
});

test("reset requests are limited per address in the database, silently", async () => {
  const email = fresh("resetlimit");
  const user = await prisma.user.create({ data: { email, password: await deps.hashPassword(PASSWORD) } });

  for (let i = 0; i < 6; i++) {
    const result = await requestPasswordReset({ email }, at(i));
    assert.ok(result.ok, "the reply never changes");
  }
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 3);
  assert.equal(sentTo(email), 3);
});

test("Google sign-in creates, recognises and links accounts by the rules", async () => {
  const claims = (payload: Record<string, unknown>) => {
    const result = readGoogleClaims({ email_verified: true, nonce: "n", ...payload }, "n");
    assert.ok(result.ok);
    return result.identity;
  };

  // A new person with a Gmail address.
  const gmail = fresh("google_new");
  const identity = claims({ sub: `sub_new_${STAMP}`, email: gmail, name: "Asha Rao", picture: "https://example.test/a.png" });
  const created = await resolveGoogleSignIn(identity, { deps });
  assert.ok(created.ok);
  assert.equal(created.outcome, "created");

  const account = await prisma.account.findFirstOrThrow({ where: { userId: created.user.id } });
  assert.equal(account.providerAccountId, identity.sub);
  assert.equal(account.access_token, null);
  assert.equal(account.refresh_token, null);
  assert.equal(account.id_token, null);

  // The same person again.
  const again = await resolveGoogleSignIn(identity, { deps });
  assert.ok(again.ok);
  assert.equal(again.outcome, "existing");
  assert.equal(again.user.id, created.user.id);
  assert.equal(await prisma.user.count({ where: { email: gmail } }), 1);

  // A password account whose email was never verified is not linked.
  const unverified = fresh("google_unverified");
  const legacy = await prisma.user.create({
    data: { email: unverified, password: await deps.hashPassword(PASSWORD), userProfile: { create: { onboardingComplete: true } } },
    include: { userProfile: true },
  });
  const legacyIdentity = claims({ sub: `sub_legacy_${STAMP}`, email: unverified });
  assert.deepEqual(await resolveGoogleSignIn(legacyIdentity, { deps }), { ok: false, reason: "password_reset_required" });
  assert.equal(await prisma.account.count({ where: { userId: legacy.id } }), 0);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { email: unverified }, include: { userProfile: true } }), legacy);

  // After the owner resets the password, the same Google identity links.
  await requestPasswordReset({ email: unverified }, at(0));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok((await completePasswordReset({ token: tokenFor(unverified), password: "the owner's pass 1" }, at(1))).ok);

  const linked = await resolveGoogleSignIn(legacyIdentity, { deps });
  assert.ok(linked.ok);
  assert.equal(linked.outcome, "linked");
  assert.equal(linked.user.id, legacy.id);
  const kept = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id }, include: { userProfile: true } });
  assert.deepEqual(kept.userProfile, legacy.userProfile);
  assert.ok(await deps.verifyPassword("the owner's pass 1", kept.password!), "linking keeps the password");

  // A Workspace identity links to a verified account on its own domain.
  const school = `auth_itest_ws_${STAMP}@school.edu`;
  const student = await prisma.user.create({ data: { email: school, password: await deps.hashPassword(PASSWORD), emailVerified: new Date() } });
  const workspace = await resolveGoogleSignIn(claims({ sub: `sub_ws_${STAMP}`, email: school, hd: "school.edu" }), { deps });
  assert.ok(workspace.ok);
  assert.equal(workspace.outcome, "linked");
  assert.equal(workspace.user.id, student.id);

  // An address Google does not host never links by email, even to a verified account.
  const yahoo = `auth_itest_y_${STAMP}@yahoo.com`;
  const outsider = await prisma.user.create({ data: { email: yahoo, password: await deps.hashPassword(PASSWORD), emailVerified: new Date() } });
  const refused = await resolveGoogleSignIn(claims({ sub: `sub_y_${STAMP}`, email: yahoo }), { deps });
  assert.deepEqual(refused, { ok: false, reason: "email_not_authoritative" });
  assert.equal(await prisma.account.count({ where: { userId: outsider.id } }), 0);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: outsider.id } }), outsider);

  // An email Google has not verified never links or creates.
  const never = await resolveGoogleSignIn(claims({ sub: `sub_other_${STAMP}`, email: gmail, email_verified: false }), { deps });
  assert.deepEqual(never, { ok: false, reason: "email_unverified" });
});
