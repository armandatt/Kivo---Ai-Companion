// Rate limits: policies, windows, identity, the engine's decisions, refusals
// and switches, with an in-memory store and a fixed clock. The same engine on
// real Postgres (atomic counters, concurrent admission, leases, deletion) is
// src/rate-limits/__integration__/rate-limits.itest.ts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { POLICIES, DIMENSIONS, effectivePolicy, scaledLimit, scaledConcurrency, AGENT_TASK_STEPS as POLICY_STEPS, AGENT_TASK_TTL_MS as POLICY_TTL } from "../policies";
import { rateLimitMode, enforces, disabled, refusedByReadOnly } from "../controls";
import { clientAddress, normaliseIp, ipSubject, safeSubject, accountSubject, credentialSubject, UNKNOWN_IP } from "../identity";
import { bucketOf, slidingEstimate, retryAfter, memoryStore } from "../store";
import { memoryLeases } from "../leases";
import { checkRate, acquireSlot, counterKey } from "../engine";
import { httpRefusal, mcpError, refusalMessage } from "../respond";
import { classify, baselinePolicy, ROUTES } from "../endpoints";
import { observe, flushObservations, pendingObservations, resetObservations, obsKey } from "../observe";
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "../../auth/proxy-headers";
import { proxyProof } from "../../auth/secrets";
import { AGENT_TASK_STEPS, AGENT_TASK_TTL_MS } from "../../nova/product/agent-ticket";

const T0 = new Date("2026-11-24T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const headers = (h: Record<string, string>) => new Headers(h);
const SHADOW = { RATE_LIMITS_MODE: "shadow" } as NodeJS.ProcessEnv;
const ENFORCE = { RATE_LIMITS_MODE: "enforce" } as NodeJS.ProcessEnv;
const U1 = "user:alice", U2 = "user:bob";

beforeAll(() => { jest.spyOn(console, "warn").mockImplementation(() => {}); jest.spyOn(console, "error").mockImplementation(() => {}); });
beforeEach(() => resetObservations());
// What was observed: still pending in this process, or already flushed to the store.
const observed = (...stores: Array<ReturnType<typeof memoryStore>>) =>
  new Set([...pendingObservations().keys(), ...stores.flatMap(s => [...s.rows.keys()].map(k => k.replace(/@\d+$/, "")))]);

describe("the policy table", () => {
  it("every policy is well formed: a reason, positive windows, ids a key can carry", () => {
    for (const p of Object.values(POLICIES)) {
      expect(p.id).toMatch(/^[a-z][a-z0-9.-]+$/);   // no colon: the subject follows the first one
      expect(p.why.length).toBeGreaterThan(25);
      for (const d of DIMENSIONS) for (const w of p[d] ?? []) {
        expect(Number.isInteger(w.limit) && w.limit > 0).toBe(true);
        expect(Number.isInteger(w.windowMs) && w.windowMs >= 1000).toBe(true);
      }
      if (p.concurrency) expect(p.concurrency.ttlMs).toBeGreaterThan(0);
      expect(["open", "closed"]).toContain(p.failure);
    }
  });

  it("the agent's bounds match the ticket's", () => {
    expect(POLICY_STEPS).toBe(AGENT_TASK_STEPS);
    expect(POLICY_TTL).toBe(AGENT_TASK_TTL_MS);
    expect(POLICIES["agent.task-steps"]!.task![0]).toEqual({ limit: AGENT_TASK_STEPS, windowMs: AGENT_TASK_TTL_MS, legacy: undefined });
  });

  it("limits that were enforced before keep their numbers (now per account, in Postgres)", () => {
    const perMinute = (id: string) => POLICIES[id]!.user![0]!.limit;
    expect(perMinute("notes.tutor")).toBe(10);
    expect(perMinute("notes.edit")).toBe(10);
    expect(perMinute("notes.assist")).toBe(6);
    expect(perMinute("extension.ask")).toBe(8);
    expect(perMinute("day.copilot")).toBe(10);
    expect(perMinute("captures")).toBe(30);
    expect(POLICIES["mcp.grant"]!.client![0]!.limit).toBe(120);
    expect(POLICIES["oauth.register"]!.global![0]).toMatchObject({ limit: 30, legacy: true });
    expect(POLICIES["extension.connect"]!.ip![0]).toMatchObject({ limit: 10, legacy: true });
  });

  it("monthly allowances are not here: no policy names credits, tasks a month or storage", () => {
    const text = readFileSync(join(__dirname, "..", "policies.ts"), "utf8");
    expect(text).not.toMatch(/from "\.\.\/billing/);
    expect(text).not.toMatch(/novaCredits|browserTasks|storageBytes/);
  });

  it("plans scale only the policies marked so, and only the account's own limits", () => {
    const ai = POLICIES["ai.account"]!;
    expect(scaledLimit(ai, "user", ai.user![0]!, "free")).toBe(30);
    expect(scaledLimit(ai, "user", ai.user![0]!, "plus")).toBe(45);
    expect(scaledLimit(ai, "user", ai.user![0]!, "pro")).toBe(60);
    expect(scaledLimit(ai, "global", ai.global![0]!, "pro")).toBe(600);
    expect(scaledConcurrency(ai, "user", "pro")).toBe(6);
    const tutor = POLICIES["notes.tutor"]!;
    expect(scaledLimit(tutor, "user", tutor.user![0]!, "pro")).toBe(10);
  });

  it("overrides replace a dimension or a concurrency without a deploy, and bad ones are ignored", () => {
    const env = { RATE_LIMITS_OVERRIDES: JSON.stringify({ "ai.account": { user: [40, 60_000], concurrency: { user: 5 } } }) } as NodeJS.ProcessEnv;
    const p = effectivePolicy("ai.account", env)!;
    expect(p.user).toEqual([{ limit: 40, windowMs: 60_000 }]);
    expect(p.concurrency!.user).toBe(5);
    expect(p.global).toEqual(POLICIES["ai.account"]!.global);
    expect(effectivePolicy("ai.account", { RATE_LIMITS_OVERRIDES: "{nope" } as NodeJS.ProcessEnv)).toBe(POLICIES["ai.account"]);
    expect(effectivePolicy("ai.account", { RATE_LIMITS_OVERRIDES: JSON.stringify({ "ai.account": { user: [0, 1] } }) } as NodeJS.ProcessEnv)!.user).toEqual(POLICIES["ai.account"]!.user);
  });
});

describe("windows", () => {
  it("buckets align to the window, and a request on the boundary starts the next one", () => {
    expect(bucketOf(60_000, at(0)).start).toBe(T0.getTime());
    expect(bucketOf(60_000, at(59_999)).start).toBe(T0.getTime());
    expect(bucketOf(60_000, at(60_000)).start).toBe(T0.getTime() + 60_000);
  });

  it("the sliding estimate counts the part of the previous window still inside it", () => {
    expect(slidingEstimate(0, 10, 60_000, at(0))).toBe(10);
    expect(slidingEstimate(2, 10, 60_000, at(30_000))).toBe(7);
    expect(slidingEstimate(5, 10, 60_000, at(59_999))).toBeCloseTo(5, 2);
  });

  it("a full window does not allow a double burst at its edge", async () => {
    const store = memoryStore();
    const env = ENFORCE;
    // ai.account: 30 a minute. 30 in the last second of one minute…
    for (let i = 0; i < 30; i++) expect((await checkRate("ai.account", { user: U1 }, { store, env, now: at(59_000) })).allowed).toBe(true);
    // …and the first of the next minute is still refused.
    const next = await checkRate("ai.account", { user: U1 }, { store, env, now: at(61_000) });
    expect(next.allowed).toBe(false);
    if (!next.allowed) expect(next.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("Retry-After is when one more request would really fit, never zero", () => {
    // 11 this minute against 10: the minute ends in 45 s, and its count then
    // slides out until a request fits (11 × (1 − 9/11) of a minute = 10 s more).
    expect(retryAfter(10, 11, 0, 60_000, at(15_000))).toBe(56);
    // 5 now, 10 last minute: fits once 4 of last minute's 10 remain (36 s in).
    expect(retryAfter(10, 5, 10, 60_000, at(0))).toBe(36);
    expect(retryAfter(10, 5, 10, 60_000, at(59_999))).toBe(1);
    // A full minute with nothing before it: not until the next minute has begun to slide.
    expect(retryAfter(4, 6, 0, 60_000, at(55_000))).toBe(5 + 30); // 6 × (1 − 3/6) of a minute
  });

  it("a request made when Retry-After says is admitted, and one a second earlier is not", async () => {
    const store = memoryStore();
    let d;
    for (let i = 0; i < 6; i++) d = await checkRate("subjects.propose", { user: U1 }, { store, env: ENFORCE, now: at(55_000) });
    expect(d).toMatchObject({ allowed: false });
    const wait = (d as { retryAfterSeconds: number }).retryAfterSeconds;
    expect((await checkRate("subjects.propose", { user: U2 }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
    const early = memoryStore(); const ok = memoryStore();
    for (const s of [early, ok]) for (let i = 0; i < 6; i++) await checkRate("subjects.propose", { user: U1 }, { store: s, env: ENFORCE, now: at(55_000) });
    expect((await checkRate("subjects.propose", { user: U1 }, { store: early, env: ENFORCE, now: at(55_000 + (wait - 1) * 1000) })).allowed).toBe(false);
    expect((await checkRate("subjects.propose", { user: U1 }, { store: ok, env: ENFORCE, now: at(55_000 + wait * 1000) })).allowed).toBe(true);
  });
});

describe("modes and switches", () => {
  it("shadow is the default; off and enforce are explicit", () => {
    expect(rateLimitMode({} as NodeJS.ProcessEnv)).toBe("shadow");
    expect(rateLimitMode({ RATE_LIMITS_MODE: "ENFORCE" } as NodeJS.ProcessEnv)).toBe("enforce");
    expect(rateLimitMode({ RATE_LIMITS_MODE: "nonsense" } as NodeJS.ProcessEnv)).toBe("shadow");
  });

  it("a staged rollout enforces just the categories or policies named", () => {
    const env = { RATE_LIMITS_ENFORCE: "agent, mcp.account" } as NodeJS.ProcessEnv;
    expect(enforces(POLICIES["agent.tasks"]!, env)).toBe(true);
    expect(enforces(POLICIES["mcp.account"]!, env)).toBe(true);
    expect(enforces(POLICIES["mcp.items"]!, env)).toBe(false);
    expect(enforces(POLICIES["ai.account"]!, env)).toBe(false);
  });

  it("an incident switch never closes sign-in or the webhooks", () => {
    const env = { KIVO_DISABLE: "auth,webhook,exempt,ai" } as NodeJS.ProcessEnv;
    expect(disabled(POLICIES["base.auth"]!, env)).toBe(false);
    expect(disabled(POLICIES["base.webhook"]!, env)).toBe(false);
    expect(disabled(POLICIES["ai.account"]!, env)).toBe(true);
    expect(disabled(POLICIES["notes.tutor"]!, env)).toBe(true);
  });

  it("read-only refuses changes, not reads, sign-in, OAuth, webhooks or MCP (refused per tool there)", () => {
    const env = { KIVO_READ_ONLY: "true" } as NodeJS.ProcessEnv;
    expect(refusedByReadOnly("write", "PATCH", env)).toBe(true);
    expect(refusedByReadOnly("ai", "POST", env)).toBe(true);
    expect(refusedByReadOnly("read", "GET", env)).toBe(false);
    for (const c of ["auth", "oauth", "webhook", "exempt", "mcp"] as const) expect(refusedByReadOnly(c, "POST", env)).toBe(false);
    expect(refusedByReadOnly("write", "POST", {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("who is asking", () => {
  const prev = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = "rate-limit-test-secret"; });
  afterAll(() => { process.env.JWT_SECRET = prev; });

  it("X-Forwarded-For is never believed: a spoofed one gives no fresh allowance", () => {
    const a = clientAddress(headers({ "x-forwarded-for": "1.2.3.4" }), {} as NodeJS.ProcessEnv);
    const b = clientAddress(headers({ "x-forwarded-for": "5.6.7.8" }), {} as NodeJS.ProcessEnv);
    expect(a).toEqual({ subject: UNKNOWN_IP, source: "unknown" });
    expect(b.subject).toBe(a.subject);
  });

  it("Cloudflare's address is used; the web app's is used only with its proof", () => {
    expect(clientAddress(headers({ "cf-connecting-ip": "203.0.113.5" }), {} as NodeJS.ProcessEnv)).toEqual({ subject: ipSubject("203.0.113.5"), source: "edge" });
    const proxied = headers({ [PROXY_PROOF_HEADER]: proxyProof(), [PROXY_CLIENT_IP_HEADER]: "198.51.100.7", "cf-connecting-ip": "76.76.21.21" });
    expect(clientAddress(proxied, {} as NodeJS.ProcessEnv)).toEqual({ subject: ipSubject("198.51.100.7"), source: "proxy" });
    const forged = headers({ [PROXY_PROOF_HEADER]: "0".repeat(64), [PROXY_CLIENT_IP_HEADER]: "198.51.100.7", "cf-connecting-ip": "76.76.21.21" });
    expect(clientAddress(forged, {} as NodeJS.ProcessEnv)).toEqual({ subject: ipSubject("76.76.21.21"), source: "edge" });
  });

  it("the trusted edge header can be renamed or turned off", () => {
    expect(clientAddress(headers({ "cf-connecting-ip": "203.0.113.5" }), { RATE_LIMITS_TRUSTED_IP_HEADER: "none" } as NodeJS.ProcessEnv).source).toBe("unknown");
    expect(clientAddress(headers({ "true-client-ip": "203.0.113.5" }), { RATE_LIMITS_TRUSTED_IP_HEADER: "true-client-ip" } as NodeJS.ProcessEnv).source).toBe("edge");
  });

  it("addresses are normalised (IPv6 to its /64) and stored only as a keyed hash", () => {
    expect(normaliseIp("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(normaliseIp("2001:db8:1:2:bbbb::9")).toBe("2001:db8:1:2::/64");
    expect(normaliseIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(normaliseIp("not an ip")).toBeNull();
    expect(normaliseIp("1.2.3.4, 5.6.7.8")).toBeNull();
    expect(ipSubject("203.0.113.5")).toMatch(/^ip:[0-9a-f]{20}$/);
    expect(ipSubject("203.0.113.5")).not.toContain("203");
  });

  it("malformed identities are refused rather than used as keys", () => {
    expect(safeSubject("user", "abc123")).toBe("user:abc123");
    expect(safeSubject("user", "a b")).toBeNull();
    expect(safeSubject("client", "x".repeat(300))).toBeNull();
    expect(safeSubject("task", "id\nwith newline")).toBeNull();
    expect(accountSubject("user:cm1")).toBe("user:cm1");
    expect(accountSubject("system:web")).toBeNull();
    expect(credentialSubject("secret-token")).toMatch(/^cred:[0-9a-f]{24}$/);
    expect(credentialSubject("secret-token")).not.toContain("secret");
  });
});

describe("the engine", () => {
  it("in shadow, a new limit only observes; a limit enforced before Phase 5 still refuses", async () => {
    const store = memoryStore();
    for (let i = 0; i < 31; i++) await checkRate("ai.account", { user: U1 }, { store, env: SHADOW, now: at(1_000) });
    const shadow = await checkRate("ai.account", { user: U1 }, { store, env: SHADOW, now: at(1_000) });
    expect(shadow).toMatchObject({ allowed: true, observedOnly: expect.any(Array) });
    expect(observed(store).has(obsKey("would_refuse", "ai.account", "user"))).toBe(true);
    for (let i = 0; i < 10; i++) expect((await checkRate("notes.tutor", { user: U1 }, { store, env: SHADOW, now: at(1_000) })).allowed).toBe(true);
    expect(await checkRate("notes.tutor", { user: U1 }, { store, env: SHADOW, now: at(1_000) })).toMatchObject({ allowed: false, status: 429, dimension: "user" });
  });

  it("off counts nothing new, but keeps the limits that were enforced before", async () => {
    const store = memoryStore();
    const env = { RATE_LIMITS_MODE: "off" } as NodeJS.ProcessEnv;
    for (let i = 0; i < 100; i++) await checkRate("ai.account", { user: U1 }, { store, env, now: at(0) });
    expect([...store.rows.keys()].filter(k => !k.startsWith("rl.obs."))).toEqual([]);
    for (let i = 0; i < 10; i++) await checkRate("notes.tutor", { user: U1 }, { store, env, now: at(0) });
    expect((await checkRate("notes.tutor", { user: U1 }, { store, env, now: at(0) })).allowed).toBe(false);
  });

  it("one account is one count across every surface; another account is untouched", async () => {
    const store = memoryStore();
    // The web, the extension and Telegram all resolve to the same account subject.
    for (let i = 0; i < 10; i++) await checkRate("ai.account", { user: U1, ip: i % 2 ? "ip:web" : "ip:ext" }, { store, env: ENFORCE, now: at(0) });
    for (let i = 0; i < 20; i++) await checkRate("ai.account", { user: U1 }, { store, env: ENFORCE, now: at(0) });
    expect((await checkRate("ai.account", { user: U1 }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(false);
    expect((await checkRate("ai.account", { user: U2 }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
  });

  it("many accounts behind one address are not limited by each other's account limits", async () => {
    const store = memoryStore();
    const ip = "ip:shared-campus";
    for (let u = 0; u < 40; u++) for (let i = 0; i < 10; i++) {
      expect((await checkRate("notes.tutor", { user: `user:s${u}`, ip }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
    }
  });

  it("an anonymous caller is counted by address, and a busy address is refused", async () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i++) expect((await checkRate("oauth.register", { ip: "ip:a" }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
    expect(await checkRate("oauth.register", { ip: "ip:a" }, { store, env: ENFORCE, now: at(0) })).toMatchObject({ allowed: false, dimension: "ip" });
    expect((await checkRate("oauth.register", { ip: "ip:b" }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
  });

  it("the global ceiling holds whoever is asking", async () => {
    const store = memoryStore();
    // oauth.register: 30 a minute for everyone (legacy, enforced in any mode).
    for (let i = 0; i < 30; i++) expect((await checkRate("oauth.register", { ip: `ip:n${i}` }, { store, env: SHADOW, now: at(0) })).allowed).toBe(true);
    expect(await checkRate("oauth.register", { ip: "ip:fresh" }, { store, env: SHADOW, now: at(0) })).toMatchObject({ allowed: false, dimension: "global" });
  });

  it("a batch counts its items: one call of 600 changes uses the window", async () => {
    const store = memoryStore();
    expect((await checkRate("mcp.items", { user: U1 }, { store, env: ENFORCE, now: at(0), weight: 600 })).allowed).toBe(true);
    expect((await checkRate("mcp.items", { user: U1 }, { store, env: ENFORCE, now: at(0), weight: 1 })).allowed).toBe(false);
  });

  it("a retry storm stays refused: refused attempts are counted too", async () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i++) await checkRate("notes.tutor", { user: U1 }, { store, env: ENFORCE, now: at(0) });
    for (let i = 0; i < 50; i++) expect((await checkRate("notes.tutor", { user: U1 }, { store, env: ENFORCE, now: at(30_000) })).allowed).toBe(false);
    // Even a minute later the storm's tail keeps it refused…
    expect((await checkRate("notes.tutor", { user: U1 }, { store, env: ENFORCE, now: at(61_000) })).allowed).toBe(false);
    // …until the window has passed with no requests.
    expect((await checkRate("notes.tutor", { user: U1 }, { store, env: ENFORCE, now: at(181_000) })).allowed).toBe(true);
  });

  it("plan scaling: Pro gets more room than Free on the same policy", async () => {
    const store = memoryStore();
    for (let i = 0; i < 45; i++) await checkRate("ai.account", { user: U1, tier: "pro" }, { store, env: ENFORCE, now: at(0) });
    expect((await checkRate("ai.account", { user: U1, tier: "pro" }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
    for (let i = 0; i < 30; i++) await checkRate("ai.account", { user: U2, tier: "free" }, { store, env: ENFORCE, now: at(0) });
    expect((await checkRate("ai.account", { user: U2, tier: "free" }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(false);
  });

  it("an incident switch refuses with 503 and counts nothing", async () => {
    const store = memoryStore();
    const d = await checkRate("agent.step", { user: U1 }, { store, env: { KIVO_DISABLE: "agent" } as NodeJS.ProcessEnv, now: at(0) });
    expect(d).toMatchObject({ allowed: false, kind: "disabled", status: 503 });
    expect([...store.rows.keys()].filter(k => !k.startsWith("rl.obs."))).toEqual([]);
  });

  it("a limiter outage: closed policies refuse with 503 when enforced; open ones and shadow admit", async () => {
    const store = memoryStore(); store.fail = true;
    expect(await checkRate("notes.tutor", { user: U1 }, { store, env: SHADOW, now: at(0) })).toMatchObject({ allowed: false, kind: "unavailable", status: 503 });
    expect((await checkRate("ai.account", { user: U1 }, { store, env: SHADOW, now: at(0) })).allowed).toBe(true);
    expect(await checkRate("ai.account", { user: U1 }, { store, env: ENFORCE, now: at(0) })).toMatchObject({ allowed: false, kind: "unavailable" });
    expect((await checkRate("base.read", { user: U1 }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
    expect((await checkRate("billing.checkout", { user: U1 }, { store, env: ENFORCE, now: at(0) })).allowed).toBe(true);
  });

  it("a dimension the caller has no subject for is skipped, never keyed on nothing", async () => {
    const store = memoryStore();
    await checkRate("ai.account", {}, { store, env: ENFORCE, now: at(0) });
    expect([...store.rows.keys()].filter(k => !k.startsWith("rl.obs.")).every(k => k.startsWith(counterKey("ai.account", "global", 60_000, "global:all")))).toBe(true);
  });

  it("an unknown policy is a programming error", async () => {
    await expect(checkRate("no.such", { user: U1 }, { store: memoryStore() })).rejects.toThrow(/Unknown rate-limit policy/);
  });
});

describe("concurrency", () => {
  it("admits up to the limit per account, refuses the next, and frees on release (twice is harmless)", async () => {
    const leases = memoryLeases(), store = memoryStore();
    const opts = { leases, store, env: ENFORCE, now: at(0) };
    const a = await acquireSlot("ai.account", { user: U1 }, "r1", opts);
    const b = await acquireSlot("ai.account", { user: U1 }, "r2", opts);
    const c = await acquireSlot("ai.account", { user: U1 }, "r3", opts);
    expect([a, b, c].every(s => s.decision.allowed)).toBe(true);
    const d = await acquireSlot("ai.account", { user: U1 }, "r4", opts);
    expect(d.decision).toMatchObject({ allowed: false, status: 429, dimension: "concurrency" });
    await a.release(); await a.release();
    expect((await acquireSlot("ai.account", { user: U1 }, "r5", opts)).decision.allowed).toBe(true);
    expect((await acquireSlot("ai.account", { user: U2 }, "x1", opts)).decision.allowed).toBe(true);
  });

  it("the same operation retried reuses its slot instead of taking a second", async () => {
    const leases = memoryLeases();
    const opts = { leases, store: memoryStore(), env: ENFORCE, now: at(0) };
    await acquireSlot("portable.import", { user: U1 }, "job:1", opts);
    expect((await acquireSlot("portable.import", { user: U1 }, "job:1", opts)).decision.allowed).toBe(true);
    expect((await acquireSlot("portable.import", { user: U1 }, "job:2", opts)).decision.allowed).toBe(false);
  });

  it("a crashed holder's slot expires; the next admission clears it", async () => {
    const leases = memoryLeases(), store = memoryStore();
    const ttl = POLICIES["portable.import"]!.concurrency!.ttlMs;
    await acquireSlot("portable.import", { user: U1 }, "job:dead", { leases, store, env: ENFORCE, now: at(0) });
    expect((await acquireSlot("portable.import", { user: U1 }, "job:new", { leases, store, env: ENFORCE, now: at(ttl - 1) })).decision.allowed).toBe(false);
    expect((await acquireSlot("portable.import", { user: U1 }, "job:new", { leases, store, env: ENFORCE, now: at(ttl) })).decision.allowed).toBe(true);
    expect(observed(store).has(obsKey("expired", "portable.import", "concurrency"))).toBe(true);
  });

  it("a full global limit gives back the account slot it took", async () => {
    const leases = memoryLeases();
    const opts = { leases, store: memoryStore(), env: ENFORCE, now: at(0) };
    for (let i = 0; i < 3; i++) await acquireSlot("portable.import", { user: `user:g${i}` }, `job:g${i}`, opts);
    const refused = await acquireSlot("portable.import", { user: U1 }, "job:x", opts);
    expect(refused.decision).toMatchObject({ allowed: false });
    expect(leases.rows.get("rl.portable.import.conc-user:user:alice")?.size ?? 0).toBe(0);
  });

  it("in shadow a full limit is observed and admitted", async () => {
    const leases = memoryLeases(), store = memoryStore();
    const opts = { leases, store, env: SHADOW, now: at(0) };
    await acquireSlot("agent.tasks", { user: U1 }, "t1", opts);
    await acquireSlot("agent.tasks", { user: U1 }, "t2", opts);
    expect((await acquireSlot("agent.tasks", { user: U1 }, "t3", opts)).decision.allowed).toBe(true);
    expect(observed(store).has(obsKey("would_saturate", "agent.tasks", "concurrency"))).toBe(true);
  });

  it("a lease store outage refuses closed policies only when enforced", async () => {
    const leases = memoryLeases(); leases.fail = true;
    expect((await acquireSlot("ai.account", { user: U1 }, "r", { leases, store: memoryStore(), env: ENFORCE })).decision).toMatchObject({ allowed: false, kind: "unavailable" });
    expect((await acquireSlot("ai.account", { user: U1 }, "r", { leases, store: memoryStore(), env: SHADOW })).decision.allowed).toBe(true);
  });
});

describe("how a refusal is said", () => {
  it("429 rate_limited with Retry-After and no threshold disclosed", () => {
    const h = httpRefusal({ allowed: false, kind: "rate_limited", status: 429, policy: "ai.account", dimension: "user", retryAfterSeconds: 42 });
    expect(h.status).toBe(429);
    expect(h.headers["Retry-After"]).toBe("42");
    expect(h.body).toMatchObject({ ok: false, error: "rate_limited", scope: "account", temporary: true, retryAfterSeconds: 42 });
    expect(JSON.stringify(h.body)).not.toMatch(/\b30\b|300|"limit|per minute|ai\.account/);
    expect(h.body.message).toMatch(/what you typed is still here/);
  });

  it("an outage and a pause are 503s that blame no one, never 'allowance_used'", () => {
    for (const kind of ["unavailable", "disabled"] as const) {
      const h = httpRefusal({ allowed: false, kind, status: 503, policy: "notes.tutor", retryAfterSeconds: 5 });
      expect(h.status).toBe(503);
      expect(h.body.error).toBe("temporarily_unavailable");
      expect(h.body.error).not.toBe("allowance_used");
      expect(String(h.body.message)).toMatch(/Nothing was changed|nothing was changed/i);
    }
  });

  it("MCP gets a JSON-RPC error with the same facts", () => {
    const m = mcpError({ allowed: false, kind: "rate_limited", status: 429, policy: "mcp.account", dimension: "user", retryAfterSeconds: 7 }, 3);
    expect(m.body).toMatchObject({ jsonrpc: "2.0", id: 3, error: { code: -32000, data: { error: "rate_limited", retryAfterSeconds: 7, temporary: true } } });
  });

  it("a full concurrency limit says to wait for one to finish", () => {
    expect(refusalMessage({ allowed: false, kind: "rate_limited", status: 429, policy: "agent.tasks", dimension: "concurrency", retryAfterSeconds: 15 })).toMatch(/browser tasks/);
    expect(refusalMessage({ allowed: false, kind: "rate_limited", status: 429, policy: "portable.import", dimension: "concurrency", retryAfterSeconds: 15 })).toMatch(/imported/);
  });
});

describe("observations", () => {
  it("are aggregated and written at most once per flush, as a bounded set of hourly rows", async () => {
    const store = memoryStore();
    for (let i = 0; i < 1000; i++) observe({ event: "refused", policy: POLICIES["notes.tutor"]!, dimension: "user", subject: `user:x${i % 3}` }, null, at(0));
    expect(pendingObservations().size).toBe(1);
    await flushObservations(store, at(0));
    expect(store.rows.size).toBe(1);
    expect([...store.rows.values()][0]).toBe(1000);
  });
});

describe("every API route has a policy", () => {
  const appDir = join(__dirname, "..", "..", "..", "..", "..", "apps", "api", "app");
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "route.ts") files.push(p); } };
  walk(appDir);
  const routes = files.map(f => {
    const src = readFileSync(f, "utf8");
    const path = "/" + relative(appDir, f).replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, "x$1");
    const methods = [...src.matchAll(/export (?:async )?(?:function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map(m => m[1]!);
    const viaHelper = /export const (?:POST|GET) = |export \{[^}]*\b(?:POST|GET)\b/.test(src);
    return { f, path, src, methods: methods.length ? methods : viaHelper || /authRoute|handleAuth/.test(src) ? ["POST", "GET"] : ["GET", "POST"] };
  });

  it("finds the routes", () => { expect(routes.length).toBeGreaterThan(140); });

  it("each route and method is classified by an entry, not by the fallback", () => {
    const missing = routes.flatMap(r => r.methods.map(m => ({ r: `${m} ${r.path}`, c: classify(m, r.path) }))).filter(x => !x.c.explicit).map(x => x.r);
    expect(missing).toEqual([]);
  });

  it("a route that calls a model, takes a file, runs MCP or an agent is never an ordinary read or write", () => {
    const costly = /\bmetered\(|withinCountedTask|startInteraction\(|spendForTurn|readUpload\(|serveMcp\(|transcribeForNote|aiAdmission|admitBuilderTurn/;
    const wrong = routes.filter(r => costly.test(r.src)).flatMap(r => r.methods.filter(m => m === "POST").map(m => ({ r: `${m} ${r.path}`, c: classify(m, r.path).category })))
      .filter(x => x.c === "read" || x.c === "write").map(x => x.r);
    expect(wrong).toEqual([]);
  });

  it("every policy a route names exists", () => {
    const used = new Set<string>();
    const srcs = [...routes.map(r => r.src), ...["lib/rate-limits.ts", "lib/nova/portable-access.ts", "lib/nova/builder-access.ts", "lib/connect/mcp.ts", "lib/billing/metered.ts"].map(f => readFileSync(join(appDir, "..", f), "utf8"))];
    for (const s of srcs) for (const m of s.matchAll(/(?:rateGate|concurrencyGate|renewGate|releaseGate|checkRate|acquireSlot)\(\s*(\[[^\]]*\]|"[^"]+")/g)) {
      for (const id of m[1]!.matchAll(/"([^"]+)"/g)) used.add(id[1]!);
    }
    expect(used.size).toBeGreaterThan(25);
    for (const id of used) expect(POLICIES[id]).toBeDefined();
  });

  it("no route keeps a per-process limiter", () => {
    for (const r of routes) expect(r.src).not.toMatch(/allowAttempt|new Map<string, number\[\]>/);
  });

  it("the baseline: sign-in is by address, the rest by account, and nobody unauthenticated gets an account's room", () => {
    expect(baselinePolicy("auth", false)).toBe("base.auth");
    expect(baselinePolicy("ai", true)).toBe("base.ai");
    expect(baselinePolicy("ai", false)).toBe("base.anonymous");
    expect(baselinePolicy("exempt", false)).toBeNull();
    expect(classify("POST", "/api/billing/webhook").category).toBe("exempt");
    expect(classify("POST", "/api/nova/notes/abc/tutor").category).toBe("ai");
    expect(classify("GET", "/api/nova/notes/abc").category).toBe("read");
    expect(classify("PATCH", "/api/nova/notes/abc").category).toBe("write");
    expect(classify("POST", "/api/nova/extension/agent/step").category).toBe("agent");
    expect(classify("POST", "/api/mcp").category).toBe("mcp");
    expect(classify("GET", "/api/nova/portable/import").category).toBe("read");
    expect(classify("POST", "/api/nova/portable/import").category).toBe("import");
    expect(ROUTES.every(r => r.note.length > 3)).toBe(true);
  });
});
