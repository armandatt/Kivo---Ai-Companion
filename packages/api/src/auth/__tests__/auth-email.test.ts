// The one place auth mail leaves the server: what it sends to the provider,
// what it does when the provider refuses or cannot be reached, and what it
// writes to the log. The provider is a stubbed fetch; nothing is sent.

import { EMAIL_SEND_TIMEOUT_MS, passwordResetEmail, sendAuthEmail, signupCodeEmail } from "../auth-email";
import { publicAppUrl } from "../auth-deps";

const CODE = "48213977";
const TO = "asha.rao@example.com";
const message = signupCodeEmail(TO, CODE, 10);
const env = { ...process.env };

let logged: string[];
let calls: Array<{ url: string; init: RequestInit }>;

function stubFetch(reply: (init: RequestInit) => Promise<Response> | Response) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return reply(init ?? {});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  logged = [];
  calls = [];
  jest.spyOn(console, "error").mockImplementation((...args) => { logged.push(args.join(" ")); });
  jest.spyOn(console, "warn").mockImplementation((...args) => { logged.push(args.join(" ")); });
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "no-reply@thekivo.in";
  delete process.env.RESEND_API_BASE;
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...env };
});

const nothingSecretLogged = () => {
  const log = logged.join("\n");
  expect(log).not.toContain(CODE);
  expect(log).not.toContain(TO);
  expect(log).not.toContain("re_test_key");
};

describe("sending an auth email", () => {
  it("posts the message to Resend from the configured sender, with the key as a bearer token", async () => {
    stubFetch(() => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));

    expect(await sendAuthEmail(message)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: "Kivo <no-reply@thekivo.in>", to: TO, subject: "Your Kivo verification code" });
    expect(calls[0]!.init.signal).toBeDefined();
    expect(logged).toEqual([]);
  });

  it("reports a refusal as not sent, and logs the status and the kind of error the provider named", async () => {
    stubFetch(() => new Response(JSON.stringify({ statusCode: 403, name: "validation_error", message: `The ${TO} domain is not verified` }), { status: 403 }));

    expect(await sendAuthEmail(message)).toBe(false);
    expect(logged.join("\n")).toContain("status 403, validation_error");
    nothingSecretLogged();
  });

  it("keeps only an identifier from the provider's reply, never its message", async () => {
    stubFetch(() => new Response(JSON.stringify({ name: `bad ${TO}` }), { status: 422 }));

    expect(await sendAuthEmail(message)).toBe(false);
    expect(logged.join("\n")).toContain("status 422, unknown");
    nothingSecretLogged();
  });

  it("reports a provider that cannot be reached as not sent, naming only the kind of failure", async () => {
    stubFetch(() => { throw Object.assign(new TypeError(`fetch failed for ${TO}`), { code: "ECONNRESET" }); });

    expect(await sendAuthEmail(message)).toBe(false);
    expect(logged.join("\n")).toContain("could not be reached (TypeError ECONNRESET)");
    nothingSecretLogged();
  });

  it("gives up on a provider that does not answer in time", async () => {
    // The send's own deadline, handed over so the test can let it run out.
    const deadline = new AbortController();
    const timeout = jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    stubFetch((init) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    }));

    const sending = sendAuthEmail(message);
    expect(timeout).toHaveBeenCalledWith(EMAIL_SEND_TIMEOUT_MS);
    deadline.abort();

    expect(await sending).toBe(false);
    expect(logged.join("\n")).toContain("could not be reached (TimeoutError)");
    nothingSecretLogged();
  });

  it("sends nothing without a key, and says why", async () => {
    delete process.env.RESEND_API_KEY;
    stubFetch(() => new Response("{}", { status: 200 }));

    expect(await sendAuthEmail(message)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(logged.join("\n")).toContain("RESEND_API_KEY is not set");
  });

  it("warns in production when the sender is still Resend's shared address", async () => {
    delete process.env.RESEND_FROM_EMAIL;
    (process.env as Record<string, string>).NODE_ENV = "production";
    stubFetch(() => new Response("{}", { status: 200 }));

    expect(await sendAuthEmail(message)).toBe(true);
    expect(JSON.parse(String(calls[0]!.init.body)).from).toBe("Kivo <onboarding@resend.dev>");
    expect(logged.join("\n")).toContain("RESEND_FROM_EMAIL is not set");
  });
});

describe("links in auth emails", () => {
  it("are built on NEXT_PUBLIC_APP_URL, without a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.thekivo.in/";
    expect(publicAppUrl()).toBe("https://www.thekivo.in");
    const reset = passwordResetEmail(TO, "Asha", `${publicAppUrl()}/reset-password?token=abc`, 60);
    expect(reset.text).toContain("https://www.thekivo.in/reset-password?token=abc");
    expect(logged).toEqual([]);
  });

  it("fall back to localhost only outside production; in production a missing value is logged", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(publicAppUrl()).toBe("http://localhost:3000");
    expect(logged).toEqual([]);

    (process.env as Record<string, string>).NODE_ENV = "production";
    publicAppUrl();
    expect(logged.join("\n")).toContain("NEXT_PUBLIC_APP_URL is not set");
  });

  it("escape the person's name in the reset email", () => {
    const reset = passwordResetEmail(TO, `<img src=x onerror=alert(1)>`, "https://www.thekivo.in/reset-password?token=abc", 60);
    expect(reset.html).not.toContain("<img");
    expect(reset.html).toContain("&lt;img");
  });
});
