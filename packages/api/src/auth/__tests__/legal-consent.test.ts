// Agreement to the Terms and the Privacy Policy at sign-up (auth/legal.ts), and
// a signed-in learner's own password-reset link (password-reset.service.ts).

import { checkLegalConsent, consentFromToken, consentToken, LEGAL_OUTDATED_MESSAGE, LEGAL_REQUIRED_MESSAGE, PRIVACY_VERSION, TERMS_VERSION } from "../legal";
import { resolveGoogleSignIn, type GoogleIdentity } from "../google-signin.service";
import { requestOwnPasswordReset, completePasswordReset, RESET_MAX_REQUESTS_PER_HOUR } from "../password-reset.service";
import { startSignup, verifySignup } from "../signup.service";
import { fakeAuth } from "./fake-auth";

const CONSENT = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };
const PASSWORD = "correct horse 42";
const identity: GoogleIdentity = { sub: "google-sub-9", email: "new@gmail.com", emailVerified: true, emailAuthoritative: true, name: "New", picture: null };

describe("what counts as agreement", () => {
  it("only the current versions, named exactly", () => {
    expect(checkLegalConsent(CONSENT)).toEqual({ ok: true, consent: CONSENT });
    for (const missing of [undefined, null, true, "yes", {}, { terms: TERMS_VERSION }]) {
      expect(checkLegalConsent(missing)).toEqual({ ok: false, message: LEGAL_REQUIRED_MESSAGE });
    }
    expect(checkLegalConsent({ terms: "2020-01-01", privacy: PRIVACY_VERSION })).toEqual({ ok: false, message: LEGAL_OUTDATED_MESSAGE });
  });

  it("survives Google's round trip as a token, and an old or altered one is no agreement", () => {
    expect(consentFromToken(consentToken(CONSENT))).toEqual(CONSENT);
    expect(consentFromToken(null)).toBeNull();
    expect(consentFromToken("2020-01-01|2020-01-01")).toBeNull();
    expect(consentFromToken("anything")).toBeNull();
  });
});

describe("email sign-up asks for it on the server", () => {
  it("refuses to start without it: no code sent, no attempt stored", async () => {
    const auth = fakeAuth();
    const result = await startSignup({ email: "new@gmail.com", password: PASSWORD }, { deps: auth.deps });
    expect(result).toMatchObject({ ok: false, status: 400, error: LEGAL_REQUIRED_MESSAGE });
    expect(auth.sent).toHaveLength(0);
    expect(auth.pending).toHaveLength(0);
  });

  it("records the versions agreed to, when, and how, with the new account and nothing about the device", async () => {
    const auth = fakeAuth();
    const started = await startSignup({ email: "new@gmail.com", password: PASSWORD, legal: CONSENT }, { deps: auth.deps, now: auth.clock.now });
    if (!started.ok) throw new Error("start failed");
    const verified = await verifySignup({ email: "new@gmail.com", code: auth.lastCode(), signupToken: started.signupToken }, { deps: auth.deps, now: auth.clock.now });
    expect(verified.ok).toBe(true);
    expect(auth.consents).toHaveLength(1);
    const { id: _id, createdAt: _created, ...record } = auth.consents[0]!;
    expect(record).toEqual({ userId: auth.users[0]!.id, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: auth.clock.now, method: "email_signup" });
  });

  it("an attempt started without agreement (before it was asked for) cannot become an account", async () => {
    const auth = fakeAuth();
    const started = await startSignup({ email: "new@gmail.com", password: PASSWORD, legal: CONSENT }, { deps: auth.deps, now: auth.clock.now });
    if (!started.ok) throw new Error("start failed");
    for (const row of auth.pending) { row.termsVersion = null; row.privacyVersion = null; row.consentedAt = null; }
    const verified = await verifySignup({ email: "new@gmail.com", code: auth.lastCode(), signupToken: started.signupToken }, { deps: auth.deps, now: auth.clock.now });
    expect(verified.ok).toBe(false);
    expect(verified).toMatchObject({ error: expect.stringContaining("Start your sign-up again") });
    expect(auth.users).toHaveLength(0);
    expect(auth.consents).toHaveLength(0);
  });
});

describe("Google sign-up asks for it too", () => {
  it("creates no account without it", async () => {
    const auth = fakeAuth();
    expect(await resolveGoogleSignIn(identity, { deps: auth.deps })).toEqual({ ok: false, reason: "consent_required" });
    expect(auth.users).toHaveLength(0);
    expect(auth.accounts).toHaveLength(0);
  });

  it("records it with the account it creates", async () => {
    const auth = fakeAuth();
    const result = await resolveGoogleSignIn(identity, { deps: auth.deps, now: auth.clock.now, consent: CONSENT });
    expect(result).toMatchObject({ ok: true, outcome: "created" });
    expect(auth.consents).toEqual([expect.objectContaining({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method: "google_signup", acceptedAt: auth.clock.now })]);
  });

  it("asks nothing new of an existing account, signing in or linking", async () => {
    const auth = fakeAuth({
      users: [{ id: "u1", email: "old@gmail.com", emailVerified: new Date() }, { id: "u2", email: "new@gmail.com", emailVerified: new Date() }],
      accounts: [{ id: "a1", userId: "u1", provider: "google", providerAccountId: "sub-old" }],
    });
    expect(await resolveGoogleSignIn({ ...identity, sub: "sub-old", email: "old@gmail.com" }, { deps: auth.deps })).toMatchObject({ ok: true, outcome: "existing" });
    expect(await resolveGoogleSignIn(identity, { deps: auth.deps })).toMatchObject({ ok: true, outcome: "linked" });
    expect(auth.consents).toHaveLength(0);
  });
});

describe("a signed-in learner's own reset link", () => {
  const withPassword = { id: "u1", email: "asha@gmail.com", name: "Asha", password: "hashed(old pass 42)" };
  const googleOnly = { id: "u2", email: "gita@gmail.com", name: "Gita", password: null };

  it("goes to the account's own address, works once, and says whether the email service accepted it", async () => {
    const auth = fakeAuth({ users: [withPassword] });
    expect(await requestOwnPasswordReset("u1", { deps: auth.deps })).toEqual({ ok: true, email: "asha@gmail.com", accepted: true });
    expect(auth.sent.map(m => m.to)).toEqual(["asha@gmail.com"]);
    const token = auth.lastResetToken();
    expect(await completePasswordReset({ token, password: "a brand new pass 7" }, { deps: auth.deps })).toEqual({ ok: true });
    expect((await completePasswordReset({ token, password: "another new pass 8" }, { deps: auth.deps })).ok).toBe(false);
  });

  it("says plainly when the email service refused it", async () => {
    const auth = fakeAuth({ users: [withPassword] });
    auth.mail.working = false;
    expect(await requestOwnPasswordReset("u1", { deps: auth.deps })).toEqual({ ok: true, email: "asha@gmail.com", accepted: false });
  });

  it("has nothing to reset for a Google-only account, and sends nothing", async () => {
    const auth = fakeAuth({ users: [googleOnly], accounts: [{ id: "g", userId: "u2", provider: "google", providerAccountId: "s" }] });
    expect(await requestOwnPasswordReset("u2", { deps: auth.deps })).toEqual({ ok: false, reason: "no_password", google: true });
    expect(auth.sent).toHaveLength(0);
  });

  it("shares the public request's hourly limit, and says so", async () => {
    const auth = fakeAuth({ users: [withPassword] });
    for (let i = 0; i < RESET_MAX_REQUESTS_PER_HOUR; i++) expect((await requestOwnPasswordReset("u1", { deps: auth.deps })).ok).toBe(true);
    expect(await requestOwnPasswordReset("u1", { deps: auth.deps })).toMatchObject({ ok: false, reason: "limited" });
    expect(auth.sent).toHaveLength(RESET_MAX_REQUESTS_PER_HOUR);
  });
});
