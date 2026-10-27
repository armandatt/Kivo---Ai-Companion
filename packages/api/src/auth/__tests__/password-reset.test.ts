import { loginWithPassword } from "../login.service";
import {
  RESET_MAX_REQUESTS_PER_HOUR,
  RESET_REJECTED_MESSAGE,
  RESET_REQUESTED_MESSAGE,
  completePasswordReset,
  requestPasswordReset,
} from "../password-reset.service";
import { hashToken } from "../secrets";
import { fakeAuth, minutesAfter } from "./fake-auth";

const OLD = "correct horse 42";
const NEW = "a brand new pass 7";

const withPassword = { id: "u1", email: "asha@gmail.com", name: "Asha", password: `hashed(${OLD})` };
const googleOnly = { id: "u2", email: "google@gmail.com", name: "Gita", password: null };
const googleLink = { id: "acc-g", userId: "u2", provider: "google", providerAccountId: "sub-2" };

function setup() {
  const auth = fakeAuth({ users: [withPassword, googleOnly], accounts: [googleLink] });
  const at = (now: Date) => {
    auth.clock.now = now;
    return { deps: auth.deps, now };
  };
  return { auth, at, t0: auth.clock.now };
}

async function requested() {
  const ctx = setup();
  await requestPasswordReset({ email: "asha@gmail.com" }, ctx.at(ctx.t0));
  return { ...ctx, token: ctx.auth.lastResetToken() };
}

describe("asking for a reset", () => {
  it("emails a link to an account that has a password", async () => {
    const { auth } = await requested();

    expect(auth.sent).toHaveLength(1);
    expect(auth.sent[0]!.to).toBe("asha@gmail.com");
    expect(auth.sent[0]!.text).toContain("https://kio.test/reset-password?token=");
  });

  it("stores only a hash of the token", async () => {
    const { auth, token } = await requested();

    expect(auth.resetTokens).toHaveLength(1);
    expect(auth.resetTokens[0]!.token).toBe(hashToken(token));
    expect(JSON.stringify(auth.resetTokens)).not.toContain(token);
  });

  it("answers the same for an account, a Google-only account and no account", async () => {
    const { at, t0 } = setup();

    const known = await requestPasswordReset({ email: "asha@gmail.com" }, at(t0));
    const google = await requestPasswordReset({ email: "google@gmail.com" }, at(t0));
    const unknown = await requestPasswordReset({ email: "nobody@gmail.com" }, at(t0));

    expect(known).toEqual({ ok: true, message: RESET_REQUESTED_MESSAGE });
    expect(google).toEqual(known);
    expect(unknown).toEqual(known);
  });

  it("sends nothing for an address with no account", async () => {
    const { auth, at, t0 } = setup();
    await requestPasswordReset({ email: "nobody@gmail.com" }, at(t0));

    expect(auth.sent).toHaveLength(0);
    expect(auth.resetTokens).toHaveLength(0);
  });

  it("tells a Google-only account, by email, to use Google, and issues no token", async () => {
    const { auth, at, t0 } = setup();
    await requestPasswordReset({ email: "google@gmail.com" }, at(t0));

    expect(auth.sent).toHaveLength(1);
    expect(auth.sent[0]!.subject).toMatch(/google/i);
    expect(auth.sent[0]!.text).toMatch(/Continue with Google/);
    expect(auth.sent[0]!.text).not.toContain("token=");
    expect(auth.resetTokens).toHaveLength(0);
  });

  it("answers the same even when the email cannot be delivered", async () => {
    const { auth, at, t0 } = setup();
    auth.mail.working = false;

    const result = await requestPasswordReset({ email: "asha@gmail.com" }, at(t0));
    expect(result).toEqual({ ok: true, message: RESET_REQUESTED_MESSAGE });
  });

  it("logs a refused email without the address or the link, and still answers the same", async () => {
    const { auth, at, t0 } = setup();
    auth.mail.working = false;
    const logged: string[] = [];
    const spy = jest.spyOn(console, "error").mockImplementation((...args) => { logged.push(args.join(" ")); });
    try {
      const result = await requestPasswordReset({ email: "asha@gmail.com" }, at(t0));
      await new Promise((resolve) => setImmediate(resolve));

      expect(result).toEqual({ ok: true, message: RESET_REQUESTED_MESSAGE });
      expect(logged).toEqual(["[PASSWORD RESET] The email was not accepted by the provider."]);
      expect(logged.join("\n")).not.toContain("asha@gmail.com");
      expect(logged.join("\n")).not.toMatch(/token=|reset-password/);
    } finally {
      spy.mockRestore();
    }
  });

  it("links to the reset page on the configured site, with the token as the only parameter", async () => {
    const { auth, at, t0 } = setup();
    await requestPasswordReset({ email: "asha@gmail.com" }, { ...at(t0), deps: { ...auth.deps, appUrl: () => "https://www.thekio.in" } });

    expect(auth.sent[0]!.text).toContain(`https://www.thekio.in/reset-password?token=${auth.lastResetToken()}`);
    expect(auth.lastResetToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects something that is not an email address", async () => {
    const { at, t0 } = setup();
    expect(await requestPasswordReset({ email: "nope" }, at(t0))).toMatchObject({ ok: false, status: 400 });
  });

  it(`sends at most ${RESET_MAX_REQUESTS_PER_HOUR} links an hour, without saying so`, async () => {
    const { auth, at, t0 } = setup();

    for (let i = 0; i <= RESET_MAX_REQUESTS_PER_HOUR + 1; i++) {
      const result = await requestPasswordReset({ email: "asha@gmail.com" }, at(minutesAfter(t0, i)));
      expect(result).toEqual({ ok: true, message: RESET_REQUESTED_MESSAGE });
    }

    expect(auth.sent).toHaveLength(RESET_MAX_REQUESTS_PER_HOUR);
    expect(auth.resetTokens).toHaveLength(RESET_MAX_REQUESTS_PER_HOUR);
  });

  it("keeps that limit across a restart, because it is counted in the database", async () => {
    const { auth, at, t0 } = setup();
    for (let i = 0; i < RESET_MAX_REQUESTS_PER_HOUR; i++) {
      await requestPasswordReset({ email: "asha@gmail.com" }, at(minutesAfter(t0, i)));
    }

    // A new process has no memory of its own: only the same database.
    const afterRestart = { deps: { ...auth.deps }, now: minutesAfter(t0, 10) };
    await requestPasswordReset({ email: "asha@gmail.com" }, afterRestart);

    expect(auth.sent).toHaveLength(RESET_MAX_REQUESTS_PER_HOUR);
  });

  it("limits the Google-only notice the same way", async () => {
    const { auth, at, t0 } = setup();
    for (let i = 0; i <= RESET_MAX_REQUESTS_PER_HOUR + 1; i++) {
      await requestPasswordReset({ email: "google@gmail.com" }, at(minutesAfter(t0, i)));
    }

    expect(auth.sent).toHaveLength(RESET_MAX_REQUESTS_PER_HOUR);
  });

  it("retires the earlier link when a new one is requested", async () => {
    const { auth, at, t0, token: first } = await requested();
    await requestPasswordReset({ email: "asha@gmail.com" }, at(minutesAfter(t0, 5)));

    const stale = await completePasswordReset({ token: first, password: NEW }, at(minutesAfter(t0, 6)));
    expect(stale).toMatchObject({ ok: false, error: RESET_REJECTED_MESSAGE });

    const fresh = await completePasswordReset({ token: auth.lastResetToken(), password: NEW }, at(minutesAfter(t0, 6)));
    expect(fresh).toEqual({ ok: true });
  });
});

describe("completing a reset", () => {
  it("replaces the password: the new one signs in and the old one does not", async () => {
    const { auth, at, t0, token } = await requested();
    const result = await completePasswordReset({ token, password: NEW }, at(minutesAfter(t0, 5)));

    expect(result).toEqual({ ok: true });
    expect(auth.users[0]!.password).toBe(`hashed(${NEW})`);
    expect((await loginWithPassword({ email: "asha@gmail.com", password: NEW }, { deps: auth.deps })).ok).toBe(true);
    expect((await loginWithPassword({ email: "asha@gmail.com", password: OLD }, { deps: auth.deps })).ok).toBe(false);
  });

  it("marks the email verified, since the link proves the address is the owner's", async () => {
    const { auth, at, t0, token } = await requested();
    expect(auth.users[0]!.emailVerified).toBeNull();

    await completePasswordReset({ token, password: NEW }, at(minutesAfter(t0, 5)));
    expect(auth.users[0]!.emailVerified).toEqual(minutesAfter(t0, 5));
  });

  it("leaves an earlier verification date alone", async () => {
    const { auth, at, t0, token } = await requested();
    const earlier = new Date("2026-01-01T00:00:00Z");
    auth.users[0]!.emailVerified = earlier;

    await completePasswordReset({ token, password: NEW }, at(minutesAfter(t0, 5)));
    expect(auth.users[0]!.emailVerified).toEqual(earlier);
  });

  it("changes nothing else about the account, and no other account", async () => {
    const { auth, at, t0, token } = await requested();
    await completePasswordReset({ token, password: NEW }, at(minutesAfter(t0, 5)));

    expect(auth.users[0]).toMatchObject({ id: "u1", email: "asha@gmail.com", name: "Asha" });
    expect(auth.users[1]).toMatchObject({ id: "u2", email: "google@gmail.com", password: null });
    expect(auth.users).toHaveLength(2);
  });

  it("refuses a link that has expired", async () => {
    const { auth, at, t0, token } = await requested();
    const result = await completePasswordReset({ token, password: NEW }, at(minutesAfter(t0, 61)));

    expect(result).toMatchObject({ ok: false, status: 400, error: RESET_REJECTED_MESSAGE });
    expect(auth.users[0]!.password).toBe(`hashed(${OLD})`);
  });

  it("refuses a link that has already been used", async () => {
    const { auth, at, t0, token } = await requested();
    await completePasswordReset({ token, password: NEW }, at(minutesAfter(t0, 5)));

    const reused = await completePasswordReset({ token, password: "third password 1" }, at(minutesAfter(t0, 6)));

    expect(reused).toMatchObject({ ok: false, error: RESET_REJECTED_MESSAGE });
    expect(auth.users[0]!.password).toBe(`hashed(${NEW})`);
  });

  it("applies one of two resets that use the same link at once", async () => {
    const { auth, at, t0, token } = await requested();
    const when = at(minutesAfter(t0, 5));

    const results = await Promise.all([
      completePasswordReset({ token, password: "first racer pw 1" }, when),
      completePasswordReset({ token, password: "second racer pw 2" }, when),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(auth.resetTokens.every((row) => row.used)).toBe(true);
  });

  it.each(["", "not-a-token", "a".repeat(63), "g".repeat(64)])("refuses the malformed token %p", async (token) => {
    const { auth, at, t0 } = await requested();
    const result = await completePasswordReset({ token, password: NEW }, at(t0));

    expect(result.ok).toBe(false);
    expect(auth.users[0]!.password).toBe(`hashed(${OLD})`);
  });

  it("refuses a well-formed token that was never issued", async () => {
    const { at, t0 } = await requested();
    const result = await completePasswordReset({ token: "ab".repeat(32), password: NEW }, at(t0));

    expect(result).toMatchObject({ ok: false, error: RESET_REJECTED_MESSAGE });
  });

  it("refuses a weak password and leaves the link usable", async () => {
    const { at, t0, token } = await requested();

    expect(await completePasswordReset({ token, password: "short" }, at(t0))).toMatchObject({ ok: false, status: 400 });
    expect(await completePasswordReset({ token, password: NEW }, at(t0))).toEqual({ ok: true });
  });
});
