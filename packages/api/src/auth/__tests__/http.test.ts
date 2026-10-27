// The auth routes, driven with real Request objects. apps/api's route files
// only wrap handleAuthRequest in a response and set the cookie, so this is the
// whole of what a request meets on its way to a service.

import { errorLabel } from "../error-label";
import { PRIVACY_VERSION, TERMS_VERSION } from "../legal";
import { callerOf, createCallerLimits, handleAuthRequest, type AuthRoute } from "../http";
import { LOGIN_ATTEMPTS_PER_WINDOW } from "../login.service";
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "../proxy-headers";
import { crossSiteProblem, originOf, requestOrigin } from "../request-origin";
import { proxyProof, serverSecret } from "../secrets";
import { fakeAuth, minutesAfter } from "./fake-auth";

const APP = "https://kio.test"; // fakeAuth's appUrl
const PASSWORD = "correct horse 42";
const user = { id: "u1", email: "asha@gmail.com", name: "Asha", password: `hashed(${PASSWORD})`, emailVerified: new Date() };

const PATHS: Record<AuthRoute, string> = {
  login: "/api/login",
  signup: "/api/signup",
  "signup-verify": "/api/signup/verify",
  "signup-resend": "/api/signup/resend",
  "forgot-password": "/api/forgot-password",
  "reset-password": "/api/reset-password",
};

function setup() {
  const auth = fakeAuth({ users: [user] });
  const callerLimits = createCallerLimits();
  const send = (
    route: AuthRoute,
    body: unknown,
    headers: Record<string, string> = {},
    now: Date = auth.clock.now,
  ) => {
    auth.clock.now = now;
    const request = new Request(`https://api.internal.test${PATHS[route]}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return handleAuthRequest(route, request, { deps: auth.deps, callerLimits, now });
  };
  return { auth, send };
}

const fromProxy = (ip: string) => ({ [PROXY_PROOF_HEADER]: proxyProof(), [PROXY_CLIENT_IP_HEADER]: ip });
const login = { email: "asha@gmail.com", password: PASSWORD };

describe("a request from our own pages", () => {
  it("is accepted with a JSON body and no Origin (the web app's server calling the API)", async () => {
    const { send } = setup();
    expect((await send("login", login)).status).toBe(200);
  });

  it("is accepted from the app's own origin", async () => {
    const { send } = setup();
    const result = await send("login", login, { origin: APP, "sec-fetch-site": "same-origin" });
    expect(result.status).toBe(200);
  });

  it("accepts a charset on the content type", async () => {
    const { send } = setup();
    expect((await send("login", login, { "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });
});

describe("a request from another site", () => {
  it.each([
    ["another site", "https://evil.test"],
    ["a lookalike host", "https://kio.test.evil.test"],
    ["the same host over http", "http://kio.test"],
    ["the same host on another port", "https://kio.test:8443"],
    ["a sandboxed page", "null"],
  ])("is refused when the Origin is %s", async (_label, origin) => {
    const { auth, send } = setup();
    const result = await send("login", login, { origin });

    expect(result.status).toBe(403);
    expect(result.sessionUser).toBeUndefined();
    expect(auth.throttles).toHaveLength(0);
  });

  it.each(["cross-site", "same-site"])("is refused when the browser says the request is %s", async (site) => {
    const { send } = setup();
    expect((await send("login", login, { "sec-fetch-site": site })).status).toBe(403);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""])(
    "is refused with the content type %p, which is all an HTML form can send",
    async (contentType) => {
      const { send } = setup();
      const result = await send("login", JSON.stringify(login), { "content-type": contentType });

      expect(result.status).toBe(415);
      expect(result.sessionUser).toBeUndefined();
    },
  );

  it.each(Object.keys(PATHS) as AuthRoute[])("is refused on %s before anything is read or sent", async (route) => {
    const { auth, send } = setup();
    const result = await send(route, { email: "asha@gmail.com", password: PASSWORD }, { origin: "https://evil.test" });

    expect(result.status).toBe(403);
    expect(auth.sent).toHaveLength(0);
    expect(auth.pending).toHaveLength(0);
    expect(auth.resetTokens).toHaveLength(0);
  });
});

describe("the origin check itself", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  const json = { "content-type": "application/json" };

  it("allows any of the origins it is given, and ignores ones that are not set", () => {
    const allowed = [originOf("https://kio.test/some/path"), originOf(undefined), "https://preview.kio.test"];

    expect(crossSiteProblem(headers({ ...json, origin: "https://kio.test" }), allowed)).toBeNull();
    expect(crossSiteProblem(headers({ ...json, origin: "https://preview.kio.test" }), allowed)).toBeNull();
    expect(crossSiteProblem(headers({ ...json, origin: "https://evil.test" }), allowed)).toMatchObject({ status: 403 });
  });

  it("refuses every Origin when it has none to allow", () => {
    expect(crossSiteProblem(headers({ ...json, origin: "https://kio.test" }), [null])).toMatchObject({ status: 403 });
  });

  it("names the origin a request was addressed to from the host the browser used", () => {
    expect(requestOrigin(headers({ host: "kio.test", "x-forwarded-proto": "https" }), "http://127.0.0.1:3000/api/login")).toBe("https://kio.test");
    expect(requestOrigin(headers({ "x-forwarded-host": "www.kio.test", host: "internal", "x-forwarded-proto": "https" }), "http://internal/api/login")).toBe("https://www.kio.test");
    expect(requestOrigin(headers({ host: "localhost:3000" }), "http://localhost:3000/api/login")).toBe("http://localhost:3000");
  });
});

describe("who is calling", () => {
  it("believes the browser address only with the web app's proof", () => {
    expect(callerOf(new Headers(fromProxy("203.0.113.7")))).toBe("ip:203.0.113.7");
  });

  it("never reads X-Forwarded-For or any other header a caller can write", () => {
    const spoofed = new Headers({
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "198.51.100.2",
      forwarded: "for=198.51.100.3",
      [PROXY_CLIENT_IP_HEADER]: "198.51.100.4",
    });
    expect(callerOf(spoofed)).toBe("direct");
  });

  it.each(["", "wrong", "0".repeat(64), serverSecret()])("does not accept %p as the proof", (proof) => {
    expect(callerOf(new Headers({ [PROXY_PROOF_HEADER]: proof, [PROXY_CLIENT_IP_HEADER]: "198.51.100.4" }))).toBe("direct");
  });

  it("derives the proof from the shared secret without being the secret", () => {
    expect(proxyProof()).toMatch(/^[0-9a-f]{64}$/);
    expect(proxyProof()).not.toContain(serverSecret());
  });
});

describe("limits per caller", () => {
  const forgot = { email: "nobody@gmail.com" };

  it("cannot be reset by changing X-Forwarded-For", async () => {
    const { send } = setup();
    const statuses: number[] = [];

    for (let i = 0; i < 8; i++) {
      const result = await send("forgot-password", forgot, { "x-forwarded-for": `198.51.100.${i}` });
      statuses.push(result.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
  });

  it("puts every direct caller in one allowance, apart from browsers behind the web app", async () => {
    const { send } = setup();
    for (let i = 0; i < 6; i++) await send("forgot-password", forgot);

    expect((await send("forgot-password", forgot)).status).toBe(429);
    expect((await send("forgot-password", forgot, fromProxy("203.0.113.7"))).status).toBe(200);
  });

  it("counts each browser on its own when the web app vouches for it", async () => {
    const { send } = setup();
    for (let i = 0; i < 5; i++) await send("forgot-password", forgot, fromProxy("203.0.113.7"));

    const sameBrowser = await send("forgot-password", forgot, fromProxy("203.0.113.7"));
    const anotherBrowser = await send("forgot-password", forgot, fromProxy("203.0.113.8"));

    expect(sameBrowser.status).toBe(429);
    expect(sameBrowser.headers["Retry-After"]).toBeDefined();
    expect(anotherBrowser.status).toBe(200);
  });
});

describe("guessing a password through the route", () => {
  it("is stopped per address even when every request claims a new address and is vouched for", async () => {
    const { send } = setup();
    const statuses: number[] = [];

    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW + 3; i++) {
      const result = await send(
        "login",
        { email: "asha@gmail.com", password: `guess ${i}` },
        { ...fromProxy(`203.0.113.${i}`), "x-forwarded-for": `198.51.100.${i}` },
      );
      statuses.push(result.status);
    }

    expect(statuses.slice(0, LOGIN_ATTEMPTS_PER_WINDOW).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(LOGIN_ATTEMPTS_PER_WINDOW)).toEqual([429, 429, 429]);
  });

  it("then refuses the right password too, says when to retry, and recovers when the window ends", async () => {
    const { auth, send } = setup();
    const t0 = auth.clock.now;
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; i++) {
      await send("login", { email: "asha@gmail.com", password: `guess ${i}` }, fromProxy(`203.0.113.${i}`));
    }

    const paused = await send("login", login, fromProxy("203.0.113.200"));
    const later = await send("login", login, fromProxy("203.0.113.200"), minutesAfter(t0, 15));

    expect(paused.status).toBe(429);
    expect(Number(paused.headers["Retry-After"])).toBeGreaterThan(0);
    expect(paused.sessionUser).toBeUndefined();
    expect(later.status).toBe(200);
    expect(later.sessionUser).toMatchObject({ id: "u1" });
  });
});

describe("what the routes return", () => {
  it("login hands back the user for the session, without the password hash", async () => {
    const { send } = setup();
    const result = await send("login", login);

    expect(result.sessionUser).toEqual({ id: "u1", email: "asha@gmail.com", name: "Asha", image: null });
    expect(result.body).toEqual({
      success: true,
      user: { id: "u1", email: "asha@gmail.com", name: "Asha", image: null, onboardingComplete: false },
    });
    expect(JSON.stringify(result)).not.toContain("hashed(");
  });

  it("starting a signup grants no session; verifying it with the token does", async () => {
    const { auth, send } = setup();
    const started = await send("signup", { legal: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION }, email: "new@gmail.com", password: PASSWORD });

    expect(started.status).toBe(200);
    expect(started.sessionUser).toBeUndefined();
    expect(started.body).toMatchObject({ verificationRequired: true, email: "new@gmail.com" });

    const signupToken = started.body.signupToken as string;
    const withoutToken = await send("signup-verify", { email: "new@gmail.com", code: auth.lastCode() });
    const verified = await send("signup-verify", { email: "new@gmail.com", code: auth.lastCode(), signupToken });

    expect(withoutToken.status).toBe(400);
    expect(withoutToken.sessionUser).toBeUndefined();
    expect(verified.status).toBe(201);
    expect(verified.sessionUser).toMatchObject({ email: "new@gmail.com" });
  });

  it("a wrong password grants no session", async () => {
    const { send } = setup();
    const result = await send("login", { email: "asha@gmail.com", password: "wrong" });

    expect(result.status).toBe(401);
    expect(result.sessionUser).toBeUndefined();
  });

  it.each(["not json", "[1,2]", '"text"', "null"])("refuses the body %p", async (body) => {
    const { send } = setup();
    expect((await send("login", body)).status).toBe(400);
  });

  it("answers forgot-password the same for an account and for none", async () => {
    const { send } = setup();
    const known = await send("forgot-password", { email: "asha@gmail.com" });
    const unknown = await send("forgot-password", { email: "nobody@gmail.com" });

    expect(known.status).toBe(200);
    expect(unknown).toEqual(known);
  });

  it("keeps the details of an unexpected failure out of the log", async () => {
    const { auth, send } = setup();
    const logged: string[] = [];
    const spy = jest.spyOn(console, "error").mockImplementation((...args) => { logged.push(args.join(" ")); });
    auth.deps.db.user.findUnique = async () => {
      throw Object.assign(new Error("Invalid `prisma.user.findUnique()` invocation: where: { email: 'asha@gmail.com' }"), {
        name: "PrismaClientValidationError",
      });
    };

    const result = await send("login", login);
    spy.mockRestore();

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Something went wrong. Please try again." });
    expect(logged.join("\n")).toContain("PrismaClientValidationError");
    expect(logged.join("\n")).not.toContain("asha@gmail.com");
  });
});

describe("what an unexpected error may put in the log", () => {
  const EMAIL = "asha@gmail.com";
  const prismaError = Object.assign(
    new Error(`Invalid \`prisma.user.findUnique()\` invocation: where: { email: '${EMAIL}' } token=abc123`),
    { name: "PrismaClientKnownRequestError", code: "P2002", meta: { target: ["email"], value: EMAIL } },
  );

  it("is the error's class and short code, nothing else", () => {
    expect(errorLabel(prismaError)).toBe("PrismaClientKnownRequestError P2002");
    expect(errorLabel(new TypeError("fetch failed for asha@gmail.com"))).toBe("TypeError");
    expect(errorLabel(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("Error ECONNRESET");
  });

  it("never carries the message, the stack or any field of the error", () => {
    const label = errorLabel(prismaError);
    expect(label).not.toContain(EMAIL);
    expect(label).not.toContain("token");
    expect(label).not.toContain("prisma.user");
    expect(label).not.toMatch(/\n|\bat\b/);
  });

  it("drops a name or code that is not a plain identifier", () => {
    expect(errorLabel(Object.assign(new Error("x"), { name: `Oops ${EMAIL}` }))).toBe("Error");
    expect(errorLabel(Object.assign(new Error("x"), { code: `user ${EMAIL} exists` }))).toBe("Error");
    expect(errorLabel(Object.assign(new Error("x"), { name: "N".repeat(200) }))).toBe("Error");
    expect(errorLabel(Object.assign(new Error("x"), { code: 42 }))).toBe("Error");
  });

  it("says nothing about a thrown value that is not an object", () => {
    expect(errorLabel(`secret for ${EMAIL}`)).toBe("unknown");
    expect(errorLabel(null)).toBe("unknown");
    expect(errorLabel(undefined)).toBe("unknown");
  });
});

describe("the server secret", () => {
  const original = { secret: process.env.JWT_SECRET, env: process.env.NODE_ENV };
  const setEnv = (secret: string | undefined, env: string) => {
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
    (process.env as Record<string, string>).NODE_ENV = env;
  };
  afterEach(() => setEnv(original.secret, original.env ?? "test"));

  it("is JWT_SECRET when it is set", () => {
    setEnv("a-real-secret", "production");
    expect(serverSecret()).toBe("a-real-secret");
  });

  it("is an error in production when it is missing, never a default", () => {
    setEnv(undefined, "production");
    expect(() => serverSecret()).toThrow("JWT_SECRET is not set");
    expect(() => proxyProof()).toThrow("JWT_SECRET is not set");
  });

  it("refuses requests rather than run without it in production", async () => {
    const { send } = setup();
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv(undefined, "production");

    const result = await send("login", login, fromProxyUnchecked("203.0.113.7"));
    spy.mockRestore();

    expect(result.status).toBe(500);
    expect(result.sessionUser).toBeUndefined();
  });

  it("falls back only outside production, for local development", () => {
    setEnv(undefined, "development");
    expect(serverSecret()).toBe("fallback-dev-secret-change-in-production");
  });
});

// A proof header without computing it (computing it needs the secret).
function fromProxyUnchecked(ip: string) {
  return { [PROXY_PROOF_HEADER]: "0".repeat(64), [PROXY_CLIENT_IP_HEADER]: ip };
}
