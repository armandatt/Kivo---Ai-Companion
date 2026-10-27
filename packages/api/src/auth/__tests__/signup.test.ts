import {
  CODE_REJECTED_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  OTP_MAX_ATTEMPTS,
  SIGNUP_SENDS_PER_DAY,
  SIGNUP_SENDS_PER_HOUR,
  resendSignupCode,
  startSignup,
  verifySignup,
} from "../signup.service";
import { loginWithPassword } from "../login.service";
import { isGmailAddress, isValidSignupEmail, normalizeEmail, passwordProblem } from "../email-rules";
import { OTP_LENGTH, generateOtp, generateToken, hashOtp, hashToken } from "../secrets";
import { fakeAuth, minutesAfter, type FakeAuth } from "./fake-auth";
import { PRIVACY_VERSION, TERMS_VERSION } from "../legal";

// The agreement every new account gives (auth/legal.ts).
const CONSENT = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION };

const EMAIL = "asha@gmail.com";
const PASSWORD = "correct horse 42";
const ATTACKER_PASSWORD = "the attacker's pass 1";

function setup(seed?: Parameters<typeof fakeAuth>[0]) {
  const auth = fakeAuth(seed);
  const at = (now: Date) => {
    auth.clock.now = now;
    return { deps: auth.deps, now };
  };
  return { auth, at, t0: auth.clock.now };
}

async function begin(ctx: ReturnType<typeof setup>, when: Date, password = PASSWORD, email = EMAIL) {
  const result = await startSignup({ legal: CONSENT, email, password, name: "Asha" }, ctx.at(when));
  if (!result.ok) throw new Error(`signup did not start: ${result.error}`);
  return { signupToken: result.signupToken, code: ctx.auth.lastCode() };
}

async function started() {
  const ctx = setup();
  const attempt = await begin(ctx, ctx.t0);
  return { ...ctx, ...attempt };
}

const wrongCodeFor = (right: string) => (right === "00000000" ? "00000001" : "00000000");
const pendingFor = (auth: FakeAuth, signupToken: string) =>
  auth.pending.find((row) => row.tokenHash === hashToken(signupToken))!;

describe("email rules", () => {
  it("normalizes case and surrounding space", () => {
    expect(normalizeEmail("  Asha.Rao@GMAIL.com ")).toBe("asha.rao@gmail.com");
  });

  it.each(["", "   ", "asha", "asha@", "@gmail.com", "asha@gmail", "a b@gmail.com", 42, null, undefined])(
    "rejects %p as an email address",
    (input) => expect(normalizeEmail(input)).toBeNull(),
  );

  it.each(["asha@gmail.com", "asha.rao@gmail.com", "asha+kivo@gmail.com", "a1@gmail.com"])(
    "accepts %s as a Gmail address",
    (email) => expect(isGmailAddress(email)).toBe(true),
  );

  it.each([
    "asha@yahoo.com",
    "asha@googlemail.com",
    "asha@gmail.com.evil.com",
    "asha@gmail.co",
    "asha@notgmail.com",
    "asha@mail.gmail.com",
    ".asha@gmail.com",
    "asha.@gmail.com",
    "as..ha@gmail.com",
  ])("does not accept %s as a Gmail address", (email) => expect(isGmailAddress(email)).toBe(false));

  it.each([
    "asha@gmail.com",
    "asha@yahoo.com",
    "asha.rao@outlook.com",
    "asha+kivo@school.edu.in",
    "a1@thekivo.in",
    "o'brien@example.co.uk",
    "asha_rao-2@sub.mail-host.example",
    "asha@xn--mnchen-3ya.de",
  ])("lets %s sign up", (email) => expect(isValidSignupEmail(email)).toBe(true));

  it.each([
    "asha@localhost",
    "asha@gmail",
    "asha@gmail.c",
    "asha@gmail.123",
    "asha@-gmail.com",
    "asha@gmail-.com",
    "asha@gmail..com",
    ".asha@gmail.com",
    "asha.@gmail.com",
    "as..ha@gmail.com",
    "asha@@gmail.com",
    "as@ha@gmail.com",
    "asha@[127.0.0.1]",
    "\"asha\"@gmail.com",
    "asha<b>@gmail.com",
    `${"a".repeat(65)}@gmail.com`,
    `asha@${"a".repeat(64)}.com`,
  ])("does not let %s sign up", (email) => expect(isValidSignupEmail(email)).toBe(false));

  it("requires 8 to 72 bytes of password", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("a".repeat(73))).toMatch(/at most 72/);
    expect(passwordProblem("a".repeat(72))).toBeNull();
    expect(passwordProblem(undefined)).toMatch(/at least 8/);
  });
});

describe("verification codes and tokens", () => {
  it("codes are eight digits, leading zeros kept", () => {
    expect(OTP_LENGTH).toBe(8);
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{8}$/);
  });

  it("codes hash differently for another address or another code", () => {
    const hash = hashOtp(EMAIL, "12345678");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp(EMAIL, "12345678")).toBe(hash);
    expect(hashOtp("other@gmail.com", "12345678")).not.toBe(hash);
    expect(hashOtp(EMAIL, "12345679")).not.toBe(hash);
  });

  it("signup tokens are 256 random bits and never repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("starting a signup", () => {
  it("emails a code, returns a token, and creates no account yet", async () => {
    const { auth, signupToken, code } = await started();

    expect(signupToken).toMatch(/^[0-9a-f]{64}$/);
    expect(code).toMatch(/^\d{8}$/);
    expect(auth.users).toHaveLength(0);
    expect(auth.pending).toHaveLength(1);
    expect(auth.sent).toHaveLength(1);
    expect(auth.sent[0]!.to).toBe(EMAIL);
  });

  it("stores the password, the code and the token only as hashes", async () => {
    const { auth, signupToken, code } = await started();
    const stored = JSON.stringify(auth.pending);

    expect(auth.pending[0]!.passwordHash).toBe(`hashed(${PASSWORD})`);
    expect(auth.pending[0]!.tokenHash).toBe(hashToken(signupToken));
    expect(stored).not.toContain(`"${PASSWORD}"`);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(signupToken);
  });

  it("never emails the token", async () => {
    const { auth, signupToken } = await started();
    expect(JSON.stringify(auth.sent)).not.toContain(signupToken);
  });

  it("normalizes the address before storing it", async () => {
    const ctx = setup();
    const result = await startSignup({ legal: CONSENT, email: "  Asha@Gmail.COM ", password: PASSWORD }, ctx.at(ctx.t0));

    expect(result).toMatchObject({ ok: true, email: EMAIL });
    expect(ctx.auth.pending[0]!.email).toBe(EMAIL);
  });

  it.each(["not-an-email", "asha@", "", null])("refuses the malformed address %p", async (email) => {
    const { auth, at, t0 } = setup();
    const result = await startSignup({ legal: CONSENT, email, password: PASSWORD }, at(t0));

    expect(result).toMatchObject({ ok: false, status: 400, error: "Enter a valid email address" });
    expect(auth.pending).toHaveLength(0);
    expect(auth.sent).toHaveLength(0);
  });

  it.each(["asha@localhost", "asha@gmail..com", "asha@[127.0.0.1]"])(
    "refuses the undeliverable address %s without sending anything",
    async (email) => {
      const { auth, at, t0 } = setup();
      const result = await startSignup({ legal: CONSENT, email, password: PASSWORD }, at(t0));

      expect(result).toMatchObject({ ok: false, status: 400, error: INVALID_EMAIL_MESSAGE });
      expect(auth.pending).toHaveLength(0);
      expect(auth.sent).toHaveLength(0);
    },
  );

  it.each(["asha@yahoo.com", "Asha.Rao@Outlook.com", "asha+kivo@school.edu.in"])(
    "signs up %s, which is not Gmail, the same way: a code, then a verified account",
    async (typed) => {
      const ctx = setup();
      const email = typed.toLowerCase();
      const { signupToken, code } = await begin(ctx, ctx.t0, PASSWORD, typed);

      expect(ctx.auth.sent[0]).toMatchObject({ to: email, subject: "Your Kivo verification code" });
      expect(ctx.auth.users).toHaveLength(0);

      const verified = await verifySignup({ email, code, signupToken }, ctx.at(ctx.t0));
      expect(verified).toMatchObject({ ok: true, user: { email } });
      expect(ctx.auth.users[0]).toMatchObject({ email, emailVerified: ctx.t0 });
      expect(await loginWithPassword({ email, password: PASSWORD }, ctx.at(ctx.t0))).toMatchObject({ ok: true });
    },
  );

  it("refuses a password that is too short", async () => {
    const { auth, at, t0 } = setup();
    const result = await startSignup({ legal: CONSENT, email: EMAIL, password: "short" }, at(t0));

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(auth.pending).toHaveLength(0);
  });

  it("reports a failed delivery and still creates no account", async () => {
    const { auth, at, t0 } = setup();
    auth.mail.working = false;
    const result = await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, at(t0));

    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(auth.users).toHaveLength(0);
  });

  it("leaves no attempt behind when the code cannot be sent, and a later try works normally", async () => {
    const ctx = setup();
    ctx.auth.mail.working = false;
    const failed = await startSignup({ legal: CONSENT, email: "asha.rao@outlook.com", password: PASSWORD }, ctx.at(ctx.t0));

    expect(failed).toMatchObject({ ok: false, status: 503 });
    expect(failed).not.toHaveProperty("signupToken");
    expect(ctx.auth.pending).toHaveLength(0);

    ctx.auth.mail.working = true;
    const { signupToken, code } = await begin(ctx, minutesAfter(ctx.t0, 2), PASSWORD, "asha.rao@outlook.com");
    expect(ctx.auth.pending).toHaveLength(1);
    const verified = await verifySignup({ email: "asha.rao@outlook.com", code, signupToken }, ctx.at(minutesAfter(ctx.t0, 3)));
    expect(verified).toMatchObject({ ok: true, user: { email: "asha.rao@outlook.com" } });
  });

  it("drops attempts that are past their life when another signup starts", async () => {
    const ctx = await started();
    await begin(ctx, minutesAfter(ctx.t0, 61), PASSWORD, "someone.else@gmail.com");

    expect(ctx.auth.pending.map((row) => row.email)).toEqual(["someone.else@gmail.com"]);
  });
});

describe("a signup belongs to the browser that started it", () => {
  it("a second start for the same address does not change the first attempt", async () => {
    const ctx = await started();
    const before = structuredClone(pendingFor(ctx.auth, ctx.signupToken));

    await begin(ctx, minutesAfter(ctx.t0, 2), ATTACKER_PASSWORD);

    expect(ctx.auth.pending).toHaveLength(2);
    expect(pendingFor(ctx.auth, ctx.signupToken)).toEqual(before);
  });

  it("the takeover fails: the victim finishes with their own password, not the attacker's", async () => {
    const ctx = await started();
    const attacker = await begin(ctx, minutesAfter(ctx.t0, 2), ATTACKER_PASSWORD);

    // The victim enters the code from the newest email, which is the attacker's.
    const mixed = await verifySignup(
      { email: EMAIL, code: attacker.code, signupToken: ctx.signupToken },
      ctx.at(minutesAfter(ctx.t0, 3)),
    );
    expect(mixed).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
    expect(ctx.auth.users).toHaveLength(0);

    // Their own code, with their own token, works.
    const own = await verifySignup(
      { email: EMAIL, code: ctx.code, signupToken: ctx.signupToken },
      ctx.at(minutesAfter(ctx.t0, 4)),
    );
    expect(own.ok).toBe(true);
    expect(ctx.auth.users[0]!.password).toBe(`hashed(${PASSWORD})`);

    const victim = await loginWithPassword({ email: EMAIL, password: PASSWORD }, { deps: ctx.auth.deps });
    const intruder = await loginWithPassword({ email: EMAIL, password: ATTACKER_PASSWORD }, { deps: ctx.auth.deps });
    expect(victim.ok).toBe(true);
    expect(intruder.ok).toBe(false);
  });

  it("the attacker cannot verify: they hold a token but the code went to the owner", async () => {
    const ctx = await started();
    const attacker = await begin(ctx, minutesAfter(ctx.t0, 2), ATTACKER_PASSWORD);

    // Even with the victim's code (which they cannot see), their token does not fit it.
    const crossed = await verifySignup(
      { email: EMAIL, code: ctx.code, signupToken: attacker.signupToken },
      ctx.at(minutesAfter(ctx.t0, 3)),
    );

    expect(crossed.ok).toBe(false);
    expect(ctx.auth.users).toHaveLength(0);
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a malformed token", "not-a-token"],
    ["a well-formed token that was never issued", "ab".repeat(32)],
  ])("the right code is refused with %s", async (_label, signupToken) => {
    const { auth, at, t0, code } = await started();
    const result = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

    expect(result).toMatchObject({ ok: false, status: 400, error: CODE_REJECTED_MESSAGE });
    expect(auth.users).toHaveLength(0);
    expect(auth.pending[0]!.attempts).toBe(0);
  });

  it("a token for one address does not verify another address", async () => {
    const ctx = await started();
    const other = await begin(ctx, ctx.t0, PASSWORD, "other@gmail.com");

    const result = await verifySignup({ email: EMAIL, code: other.code, signupToken: other.signupToken }, ctx.at(ctx.t0));

    expect(result.ok).toBe(false);
    expect(ctx.auth.users).toHaveLength(0);
  });

  it("once the owner finishes, every other attempt for the address is gone", async () => {
    const ctx = await started();
    const attacker = await begin(ctx, minutesAfter(ctx.t0, 2), ATTACKER_PASSWORD);

    await verifySignup({ email: EMAIL, code: ctx.code, signupToken: ctx.signupToken }, ctx.at(minutesAfter(ctx.t0, 3)));
    const late = await verifySignup(
      { email: EMAIL, code: attacker.code, signupToken: attacker.signupToken },
      ctx.at(minutesAfter(ctx.t0, 4)),
    );

    expect(ctx.auth.pending).toHaveLength(0);
    expect(late.ok).toBe(false);
    expect(ctx.auth.users).toHaveLength(1);
    expect(ctx.auth.users[0]!.password).toBe(`hashed(${PASSWORD})`);
  });
});

describe("an address that already has an account", () => {
  const existing = { id: "u-existing", email: EMAIL, password: "hashed(original)", name: "Asha" };

  it("gets the same shape of reply as a new address, token included", async () => {
    const fresh = setup();
    const taken = setup({ users: [existing] });

    const freshResult = await startSignup({ legal: CONSENT, email: "new@gmail.com", password: PASSWORD }, fresh.at(fresh.t0));
    const takenResult = await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, taken.at(taken.t0));

    expect(takenResult.ok).toBe(true);
    expect(Object.keys(takenResult).sort()).toEqual(Object.keys(freshResult).sort());
    expect(takenResult.ok && takenResult.signupToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is told by email, without a code", async () => {
    const { auth, at, t0 } = setup({ users: [existing] });
    await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, at(t0));

    expect(auth.sent).toHaveLength(1);
    expect(auth.sent[0]!.subject).toMatch(/already have/i);
    expect(auth.sent[0]!.text).not.toMatch(/\b\d{8}\b/);
  });

  it("is left exactly as it was, whatever is tried with the token", async () => {
    const { auth, at, t0 } = setup({ users: [existing] });
    const start = await startSignup({ legal: CONSENT, email: "ASHA@gmail.com", password: PASSWORD }, at(t0));
    const signupToken = start.ok ? start.signupToken : "";

    for (const code of ["12345678", "00000000", "99999999"]) {
      const verify = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));
      expect(verify).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
    }
    await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 2)));

    expect(auth.users).toHaveLength(1);
    expect(auth.users[0]).toMatchObject({ id: "u-existing", password: "hashed(original)", name: "Asha" });
    expect(auth.sent.every((email) => !/\b\d{8}\b/.test(email.text))).toBe(true);
  });

  it("is limited the same way as a new address", async () => {
    const { at, t0 } = setup({ users: [existing] });
    await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, at(t0));
    const second = await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, at(minutesAfter(t0, 0.5)));

    expect(second).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 30 });
  });
});

describe("verifying the code", () => {
  it("creates a verified account from the caller's own attempt", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    const result = await verifySignup({ email: EMAIL, code, signupToken }, at(minutesAfter(t0, 1)));

    expect(result).toMatchObject({ ok: true, user: { email: EMAIL, name: "Asha", image: null } });
    expect(auth.users).toHaveLength(1);
    expect(auth.users[0]).toMatchObject({
      email: EMAIL,
      password: `hashed(${PASSWORD})`,
      emailVerified: minutesAfter(t0, 1),
    });
    expect(auth.pending).toHaveLength(0);
  });

  it("never returns the password hash", async () => {
    const { at, t0, code, signupToken } = await started();
    const result = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

    expect(result.ok && Object.keys(result.user).sort()).toEqual(["email", "id", "image", "name"]);
  });

  it("writes only the account: no profile, no onboarding answers", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

    expect(Object.keys(auth.users[0]!).sort()).toEqual(
      ["email", "emailVerified", "id", "image", "name", "password", "userProfile"].sort(),
    );
    expect(auth.users[0]!.userProfile).toBeNull();
  });

  it("refuses a wrong code, counts it, and creates nothing", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    const result = await verifySignup({ email: EMAIL, code: wrongCodeFor(code), signupToken }, at(t0));

    expect(result).toMatchObject({ ok: false, status: 400, error: CODE_REJECTED_MESSAGE });
    expect(auth.users).toHaveLength(0);
    expect(auth.pending[0]!.attempts).toBe(1);
  });

  it.each(["1234567", "123456789", "1234567a", "123456", "", null, 12345678])(
    "refuses the malformed code %p without spending a try",
    async (code) => {
      const { auth, at, t0, signupToken } = await started();
      const result = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

      expect(result).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
      expect(auth.pending[0]!.attempts).toBe(0);
    },
  );

  it("refuses the right code once it has expired", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    const result = await verifySignup({ email: EMAIL, code, signupToken }, at(minutesAfter(t0, 11)));

    expect(result).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
    expect(auth.users).toHaveLength(0);
  });

  it("refuses a code that has already been used", async () => {
    const { auth, at, t0, code, signupToken } = await started();

    expect((await verifySignup({ email: EMAIL, code, signupToken }, at(t0))).ok).toBe(true);
    const reused = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

    expect(reused).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
    expect(auth.users).toHaveLength(1);
  });

  it("creates one account when the same right code arrives twice at once", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    const when = at(t0);

    const results = await Promise.all([
      verifySignup({ email: EMAIL, code, signupToken }, when),
      verifySignup({ email: EMAIL, code, signupToken }, when),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(auth.users).toHaveLength(1);
  });

  it("gives every refusal the same status and message", async () => {
    const { at, t0, code, signupToken } = await started();
    const noSignup = await verifySignup({ email: "nobody@gmail.com", code, signupToken: "ab".repeat(32) }, at(t0));
    const wrongToken = await verifySignup({ email: EMAIL, code, signupToken: "cd".repeat(32) }, at(t0));
    const wrongCode = await verifySignup({ email: EMAIL, code: wrongCodeFor(code), signupToken }, at(t0));
    const expired = await verifySignup({ email: EMAIL, code, signupToken }, at(minutesAfter(t0, 30)));

    expect(wrongToken).toEqual(noSignup);
    expect(wrongCode).toEqual(noSignup);
    expect(expired).toEqual(noSignup);
  });

  it("refuses when the address gained an account while the code was pending", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    auth.users.push({ id: "u-google", email: EMAIL, password: null, emailVerified: t0 });

    const result = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

    expect(result).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
    expect(auth.users).toHaveLength(1);
    expect(auth.users[0]!.password).toBeNull();
  });
});

describe("the budget of wrong codes", () => {
  it(`ends after ${OTP_MAX_ATTEMPTS} wrong tries, after which even the right code is refused`, async () => {
    const { auth, at, t0, code, signupToken } = await started();

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verifySignup({ email: EMAIL, code: wrongCodeFor(code), signupToken }, at(t0));
    }
    const result = await verifySignup({ email: EMAIL, code, signupToken }, at(t0));

    expect(result).toMatchObject({ ok: false, error: CODE_REJECTED_MESSAGE });
    expect(auth.users).toHaveLength(0);
    expect(auth.pending[0]!.attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("is not refilled by resending: wrong tries add up across codes", async () => {
    const { auth, at, t0, signupToken } = await started();
    let minute = 0;
    let spent = 0;

    // Four wrong tries on each code, then a resend, until the budget is gone.
    while (spent < OTP_MAX_ATTEMPTS) {
      const code = auth.lastCode();
      for (let i = 0; i < 4 && spent < OTP_MAX_ATTEMPTS; i++, spent++) {
        await verifySignup({ email: EMAIL, code: wrongCodeFor(code), signupToken }, at(minutesAfter(t0, minute)));
      }
      expect(auth.pending[0]!.attempts).toBe(spent);
      minute += 2;
      await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, minute)));
    }

    const result = await verifySignup({ email: EMAIL, code: auth.lastCode(), signupToken }, at(minutesAfter(t0, minute)));
    expect(result.ok).toBe(false);
    expect(auth.pending[0]!.attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(auth.users).toHaveLength(0);
  });

  it("stops sending codes for an attempt that has run out of tries", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verifySignup({ email: EMAIL, code: wrongCodeFor(code), signupToken }, at(t0));
    }

    const resent = await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 2)));

    expect(resent).toEqual({ ok: true });
    expect(auth.sent).toHaveLength(1);
  });

  it("is held at the limit when many wrong tries arrive at once", async () => {
    const { auth, at, t0, code, signupToken } = await started();
    const when = at(t0);

    await Promise.all(
      Array.from({ length: OTP_MAX_ATTEMPTS + 5 }, () =>
        verifySignup({ email: EMAIL, code: wrongCodeFor(code), signupToken }, when),
      ),
    );

    expect(auth.pending[0]!.attempts).toBe(OTP_MAX_ATTEMPTS);
  });
});

describe("resending the code", () => {
  it("sends a new code to the owner of the attempt and retires the old one", async () => {
    const { auth, at, t0, code: first, signupToken } = await started();

    const resent = await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 2)));
    const second = auth.lastCode();

    expect(resent).toEqual({ ok: true });
    expect(auth.sent).toHaveLength(2);

    if (first !== second) {
      const stale = await verifySignup({ email: EMAIL, code: first, signupToken }, at(minutesAfter(t0, 2)));
      expect(stale.ok).toBe(false);
    }
    const fresh = await verifySignup({ email: EMAIL, code: second, signupToken }, at(minutesAfter(t0, 3)));
    expect(fresh.ok).toBe(true);
  });

  it.each([
    ["no token", undefined],
    ["a malformed token", "nope"],
    ["a token that was never issued", "ab".repeat(32)],
  ])("does nothing for a caller with %s: no email, no code change, none of the address's sends used", async (_l, token) => {
    const { auth, at, t0, code, signupToken } = await started();
    const before = structuredClone(auth.pending[0]);
    const throttles = structuredClone(auth.throttles);

    const result = await resendSignupCode({ email: EMAIL, signupToken: token }, at(minutesAfter(t0, 2)));

    expect(result).toEqual({ ok: true });
    expect(auth.sent).toHaveLength(1);
    expect(auth.pending[0]).toEqual(before);
    expect(auth.throttles).toEqual(throttles);

    // The owner's code still works.
    expect((await verifySignup({ email: EMAIL, code, signupToken }, at(minutesAfter(t0, 3)))).ok).toBe(true);
  });

  it("does nothing with another attempt's token for the same address", async () => {
    const ctx = await started();
    const attacker = await begin(ctx, minutesAfter(ctx.t0, 2), ATTACKER_PASSWORD);
    const victimBefore = structuredClone(pendingFor(ctx.auth, ctx.signupToken));

    await resendSignupCode({ email: EMAIL, signupToken: attacker.signupToken }, ctx.at(minutesAfter(ctx.t0, 4)));

    expect(pendingFor(ctx.auth, ctx.signupToken)).toEqual(victimBefore);
  });

  it("keeps the code already sent working when the new one cannot be sent", async () => {
    const { auth, at, t0, code: first, signupToken } = await started();
    const before = structuredClone(pendingFor(auth, signupToken));

    auth.mail.working = false;
    const resent = await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 2)));

    expect(resent).toMatchObject({ ok: false, status: 503 });
    const after = pendingFor(auth, signupToken);
    expect(after.codeHash).toBe(before.codeHash);
    expect(after.codeExpiresAt).toEqual(before.codeExpiresAt);
    expect(after.attempts).toBe(before.attempts);

    // The first email may still arrive: its code is the one that works.
    const verified = await verifySignup({ email: EMAIL, code: first, signupToken }, at(minutesAfter(t0, 3)));
    expect(verified.ok).toBe(true);
  });

  it("a failed resend does not stretch the first code's life", async () => {
    const { auth, at, t0, code: first, signupToken } = await started();
    auth.mail.working = false;
    await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 2)));

    const late = await verifySignup({ email: EMAIL, code: first, signupToken }, at(minutesAfter(t0, 11)));
    expect(late).toMatchObject({ ok: false, status: 400, error: CODE_REJECTED_MESSAGE });
  });

  it("is refused inside the cooldown, with the wait", async () => {
    const { auth, at, t0, signupToken } = await started();
    const result = await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 0.5)));

    expect(result).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 30 });
    expect(auth.sent).toHaveLength(1);
  });

  it("does nothing once the attempt is past its life", async () => {
    const { auth, at, t0, signupToken } = await started();
    const result = await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 61)));

    expect(result).toEqual({ ok: true });
    expect(auth.sent).toHaveLength(1);
  });
});

describe("how many emails one address can be sent", () => {
  it(`is ${SIGNUP_SENDS_PER_HOUR} an hour`, async () => {
    const { auth, at, t0, signupToken } = await started();

    for (let i = 1; i < SIGNUP_SENDS_PER_HOUR; i++) {
      expect((await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, i * 2)))).ok).toBe(true);
    }
    const over = await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, 20)));

    expect(over).toMatchObject({ ok: false, status: 429 });
    expect(auth.sent).toHaveLength(SIGNUP_SENDS_PER_HOUR);
  });

  it(`is ${SIGNUP_SENDS_PER_DAY} a day, across new starts and resends alike`, async () => {
    const ctx = setup();
    let sends = 0;

    // A new signup every 13 minutes: under the hourly limit, over the daily one.
    for (let i = 0; i < SIGNUP_SENDS_PER_DAY + 4; i++) {
      const result = await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, ctx.at(minutesAfter(ctx.t0, i * 13)));
      if (result.ok) sends++;
      else expect(result).toMatchObject({ status: 429 });
    }

    expect(sends).toBe(SIGNUP_SENDS_PER_DAY);
    expect(ctx.auth.sent).toHaveLength(SIGNUP_SENDS_PER_DAY);

    const nextDay = await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, ctx.at(minutesAfter(ctx.t0, 24 * 60 + 1)));
    expect(nextDay.ok).toBe(true);
  });

  it("is counted in the database, so a restart does not reset it", async () => {
    const { auth, at, t0, signupToken } = await started();
    for (let i = 1; i < SIGNUP_SENDS_PER_HOUR; i++) {
      await resendSignupCode({ email: EMAIL, signupToken }, at(minutesAfter(t0, i * 2)));
    }

    // A new process has no memory of its own: only the same database.
    const afterRestart = { deps: { ...auth.deps }, now: minutesAfter(t0, 20) };
    const result = await startSignup({ legal: CONSENT, email: EMAIL, password: PASSWORD }, afterRestart);

    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(auth.throttles.length).toBeGreaterThan(0);
    expect(JSON.stringify(auth.throttles)).not.toContain(EMAIL);
  });

  it("bounds the codes that can ever be tried against one address in a day", async () => {
    // Each send is one code or one fresh attempt; each attempt allows a fixed
    // number of wrong tries however often it is resent.
    const worstCase = SIGNUP_SENDS_PER_DAY * OTP_MAX_ATTEMPTS;
    expect(worstCase).toBeLessThanOrEqual(100);
    expect(worstCase / 10 ** OTP_LENGTH).toBeLessThanOrEqual(1e-6);
  });
});
