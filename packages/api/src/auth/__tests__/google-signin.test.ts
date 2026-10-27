import { readGoogleClaims, resolveGoogleSignIn, type GoogleIdentity } from "../google-signin.service";
import { completePasswordReset, requestPasswordReset } from "../password-reset.service";
import { fakeAuth } from "./fake-auth";
import { PRIVACY_VERSION, TERMS_VERSION } from "../legal";

// The agreement a sign-up sends with a new Google account (auth/legal.ts).
const CONSENT = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };

const NONCE = "nonce-from-the-cookie";

// What jose hands back once the signature, issuer, audience and expiry hold.
const payload = {
  iss: "https://accounts.google.com",
  aud: "client-id",
  sub: "google-sub-1",
  email: "Asha@Gmail.com",
  email_verified: true,
  name: "Asha Rao",
  picture: "https://lh3.googleusercontent.com/a/photo",
  nonce: NONCE,
};

const identity: GoogleIdentity = {
  sub: "google-sub-1",
  email: "asha@gmail.com",
  emailVerified: true,
  emailAuthoritative: true,
  name: "Asha Rao",
  picture: "https://lh3.googleusercontent.com/a/photo",
};

describe("reading a verified Google ID token", () => {
  it("takes the identity, with the email normalized", () => {
    expect(readGoogleClaims(payload, NONCE)).toEqual({ ok: true, identity });
  });

  it("refuses a token minted for a different sign-in attempt", () => {
    expect(readGoogleClaims(payload, "another-nonce")).toEqual({ ok: false, reason: "nonce_mismatch" });
    expect(readGoogleClaims({ ...payload, nonce: undefined }, NONCE)).toEqual({ ok: false, reason: "nonce_mismatch" });
    expect(readGoogleClaims(payload, "")).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("refuses a token without a subject or an email", () => {
    expect(readGoogleClaims({ ...payload, sub: undefined }, NONCE)).toEqual({ ok: false, reason: "missing_claims" });
    expect(readGoogleClaims({ ...payload, email: undefined }, NONCE)).toEqual({ ok: false, reason: "missing_claims" });
  });

  it("treats the email as verified only when Google says exactly true", () => {
    const read = (email_verified: unknown) => {
      const result = readGoogleClaims({ ...payload, email_verified }, NONCE);
      return result.ok && result.identity.emailVerified;
    };

    expect(read(true)).toBe(true);
    expect(read("true")).toBe(false);
    expect(read(undefined)).toBe(false);
    expect(read(false)).toBe(false);
  });
});

describe("Google sign-in", () => {
  it("creates a verified account, with no password, for a new person", async () => {
    const auth = fakeAuth();
    const result = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT, now: auth.clock.now });

    expect(result).toMatchObject({ ok: true, outcome: "created", user: { email: "asha@gmail.com", name: "Asha Rao" } });
    expect(auth.users).toHaveLength(1);
    expect(auth.users[0]).toMatchObject({ password: null, emailVerified: auth.clock.now });
    expect(auth.accounts).toEqual([
      expect.objectContaining({ userId: auth.users[0]!.id, provider: "google", providerAccountId: "google-sub-1" }),
    ]);
  });

  it("stores the link only, never Google's tokens", async () => {
    const auth = fakeAuth();
    await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT });

    expect(Object.keys(auth.accounts[0]!).sort()).toEqual(["id", "provider", "providerAccountId", "type", "userId"]);
  });

  it("signs the same person in again without creating anything", async () => {
    const auth = fakeAuth();
    const first = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT });
    const second = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT });

    expect(second).toMatchObject({ ok: true, outcome: "existing" });
    expect(second.ok && first.ok && second.user.id).toBe(first.ok && first.user.id);
    expect(auth.users).toHaveLength(1);
    expect(auth.accounts).toHaveLength(1);
  });

  it("recognises a linked account by Google's id even after the Google email changed", async () => {
    const auth = fakeAuth({
      users: [{ id: "u1", email: "asha@gmail.com", emailVerified: new Date() }],
      accounts: [{ id: "acc1", userId: "u1", provider: "google", providerAccountId: "google-sub-1" }],
    });

    const result = await resolveGoogleSignIn({ ...identity, email: "asha.new@gmail.com" }, { deps: auth.deps, consent: CONSENT });

    expect(result).toMatchObject({ ok: true, outcome: "existing", user: { id: "u1", email: "asha@gmail.com" } });
    expect(auth.users).toHaveLength(1);
  });
});

describe("linking Google to an existing account", () => {
  const profile = { onboardingComplete: true };

  it("links to an account whose email is verified, keeping its id, password and data", async () => {
    const verifiedAt = new Date("2026-09-01T00:00:00Z");
    const auth = fakeAuth({
      users: [{ id: "u1", email: "asha@gmail.com", name: "Asha", password: "hashed(pw)", emailVerified: verifiedAt, userProfile: profile }],
    });

    const result = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT, now: auth.clock.now });

    expect(result).toMatchObject({ ok: true, outcome: "linked", user: { id: "u1" } });
    expect(auth.users).toHaveLength(1);
    expect(auth.users[0]).toMatchObject({
      id: "u1",
      name: "Asha",
      password: "hashed(pw)",
      emailVerified: verifiedAt,
      userProfile: profile,
      image: identity.picture,
    });
    expect(auth.accounts).toEqual([expect.objectContaining({ userId: "u1", providerAccountId: "google-sub-1" })]);
  });

  it("links to an account that has no password", async () => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@gmail.com", password: null, emailVerified: null }] });
    const result = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT, now: auth.clock.now });

    expect(result).toMatchObject({ ok: true, outcome: "linked", user: { id: "u1" } });
    expect(auth.users[0]!.emailVerified).toEqual(auth.clock.now);
  });

  it("does not link to a password account whose email was never verified", async () => {
    // Anyone could have registered this address with a password of their own.
    const auth = fakeAuth({
      users: [{ id: "u1", email: "asha@gmail.com", password: "hashed(someone's)", emailVerified: null, userProfile: profile }],
    });
    const before = structuredClone(auth.users[0]);

    const result = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT });

    expect(result).toEqual({ ok: false, reason: "password_reset_required" });
    expect(auth.accounts).toHaveLength(0);
    expect(auth.users).toEqual([before]);
  });

  it("links that account once the owner has reset the password", async () => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@gmail.com", password: "hashed(someone's)", emailVerified: null }] });
    const options = { deps: auth.deps, consent: CONSENT, now: auth.clock.now };

    await requestPasswordReset({ email: "asha@gmail.com" }, options);
    await completePasswordReset({ token: auth.lastResetToken(), password: "the owner's pass 1" }, options);
    const result = await resolveGoogleSignIn(identity, { deps: auth.deps, consent: CONSENT });

    expect(result).toMatchObject({ ok: true, outcome: "linked", user: { id: "u1" } });
    expect(auth.users[0]!.password).toBe("hashed(the owner's pass 1)");
  });

  it("never links or creates on an email Google has not verified", async () => {
    const linkable = fakeAuth({ users: [{ id: "u1", email: "asha@gmail.com", password: null }] });
    const empty = fakeAuth();
    const unverified = { ...identity, emailVerified: false, emailAuthoritative: false };

    expect(await resolveGoogleSignIn(unverified, { deps: linkable.deps })).toEqual({ ok: false, reason: "email_unverified" });
    expect(await resolveGoogleSignIn(unverified, { deps: empty.deps })).toEqual({ ok: false, reason: "email_unverified" });
    expect(linkable.accounts).toHaveLength(0);
    expect(empty.users).toHaveLength(0);
  });

  it("does not make a second account for an address that differs only by case", async () => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@gmail.com", password: null }] });
    const claims = readGoogleClaims({ ...payload, email: "ASHA@GMAIL.COM" }, NONCE);

    const result = claims.ok ? await resolveGoogleSignIn(claims.identity, { deps: auth.deps, consent: CONSENT }) : null;

    expect(result).toMatchObject({ ok: true, outcome: "linked", user: { id: "u1" } });
    expect(auth.users).toHaveLength(1);
  });
});

describe("when Google's word on an address is final", () => {
  const authoritative = (claims: Record<string, unknown>) => {
    const result = readGoogleClaims({ ...payload, ...claims }, NONCE);
    return result.ok && result.identity.emailAuthoritative;
  };

  it("is for a verified @gmail.com address", () => {
    expect(authoritative({ email: "asha@gmail.com" })).toBe(true);
  });

  it("is for a verified Workspace address, whose hd claim names its own domain", () => {
    expect(authoritative({ email: "asha@school.edu", hd: "school.edu" })).toBe(true);
    expect(authoritative({ email: "asha@School.EDU", hd: "SCHOOL.edu" })).toBe(true);
  });

  it("is not for any other domain, even when Google marks the email verified", () => {
    expect(authoritative({ email: "asha@yahoo.com" })).toBe(false);
    expect(authoritative({ email: "asha@outlook.com", hd: undefined })).toBe(false);
    expect(authoritative({ email: "asha@yahoo.com", hd: "" })).toBe(false);
  });

  it("is not when the hd claim names a different domain from the address", () => {
    expect(authoritative({ email: "asha@yahoo.com", hd: "school.edu" })).toBe(false);
    expect(authoritative({ email: "asha@evil-school.edu", hd: "school.edu" })).toBe(false);
  });

  it("is never for an unverified email, Gmail or Workspace", () => {
    expect(authoritative({ email: "asha@gmail.com", email_verified: false })).toBe(false);
    expect(authoritative({ email: "asha@school.edu", hd: "school.edu", email_verified: false })).toBe(false);
  });
});

describe("linking by email depends on who Google is authoritative for", () => {
  const read = (claims: Record<string, unknown>) => {
    const result = readGoogleClaims({ ...payload, ...claims }, NONCE);
    if (!result.ok) throw new Error("claims should be readable");
    return result.identity;
  };
  const gmail = read({ email: "asha@gmail.com" });
  const workspace = read({ email: "asha@school.edu", hd: "school.edu", sub: "sub-workspace" });
  const elsewhere = read({ email: "asha@yahoo.com", sub: "sub-yahoo" });
  const verifiedAt = new Date("2026-09-01T00:00:00Z");

  it("links a Gmail identity to a verified account with the same address", async () => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@gmail.com", password: "hashed(pw)", emailVerified: verifiedAt }] });
    expect(await resolveGoogleSignIn(gmail, { deps: auth.deps, consent: CONSENT })).toMatchObject({ ok: true, outcome: "linked", user: { id: "u1" } });
  });

  it("links a Workspace identity to a verified account with the same address", async () => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@school.edu", password: "hashed(pw)", emailVerified: verifiedAt }] });
    expect(await resolveGoogleSignIn(workspace, { deps: auth.deps, consent: CONSENT })).toMatchObject({ ok: true, outcome: "linked", user: { id: "u1" } });
  });

  it.each([
    ["a verified password account", { password: "hashed(pw)", emailVerified: verifiedAt }],
    ["an unverified password account", { password: "hashed(pw)", emailVerified: null }],
    ["an account with no password", { password: null, emailVerified: null }],
  ])("never links an address Google does not host to %s", async (_label, fields) => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@yahoo.com", name: "Asha", userProfile: { onboardingComplete: true }, ...fields }] });
    const before = structuredClone(auth.users[0]);

    const result = await resolveGoogleSignIn(elsewhere, { deps: auth.deps, consent: CONSENT });

    expect(result).toEqual({ ok: false, reason: "email_not_authoritative" });
    expect(auth.accounts).toHaveLength(0);
    expect(auth.users).toEqual([before]);
  });

  it("still refuses an unverified password account for a Gmail or Workspace identity", async () => {
    for (const [who, email] of [[gmail, "asha@gmail.com"], [workspace, "asha@school.edu"]] as const) {
      const auth = fakeAuth({ users: [{ id: "u1", email, password: "hashed(someone's)", emailVerified: null }] });
      const before = structuredClone(auth.users[0]);

      expect(await resolveGoogleSignIn(who, { deps: auth.deps, consent: CONSENT })).toEqual({ ok: false, reason: "password_reset_required" });
      expect(auth.accounts).toHaveLength(0);
      expect(auth.users).toEqual([before]);
    }
  });

  it("creates a new account for an address Google does not host, without calling its email verified", async () => {
    const auth = fakeAuth();
    const result = await resolveGoogleSignIn(elsewhere, { deps: auth.deps, consent: CONSENT, now: auth.clock.now });

    expect(result).toMatchObject({ ok: true, outcome: "created" });
    expect(auth.users[0]).toMatchObject({ email: "asha@yahoo.com", emailVerified: null, password: null });
  });

  it("recognises that account by Google's id next time, without the email mattering", async () => {
    const auth = fakeAuth();
    const first = await resolveGoogleSignIn(elsewhere, { deps: auth.deps, consent: CONSENT });
    const second = await resolveGoogleSignIn(elsewhere, { deps: auth.deps, consent: CONSENT });

    expect(second).toMatchObject({ ok: true, outcome: "existing" });
    expect(second.ok && first.ok && second.user.id === first.user.id).toBe(true);
    expect(auth.users).toHaveLength(1);
  });
});
