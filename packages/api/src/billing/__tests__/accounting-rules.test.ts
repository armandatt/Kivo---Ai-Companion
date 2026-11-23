// Usage accounting's pure rules (billing/accounting/rules.ts): allowances,
// periods, credits from cost, the shadow tier, feature classes and the MCP
// read-only fallback.

import {
  ALLOWANCES, allowances, browserTaskCostTargetMicros, creditRateVersion, creditsFor, DEFAULT_FAIR_USE, fairUse, featureClass,
  limitFor, mcpDecision, monthlyPeriod, periodFor, reserveEstimate, tierFor,
} from "../accounting/rules";
import { accountingMode, enforcing } from "../accounting/targets";
import { deriveAccess } from "../access";
import { PLANS, formatPrice, tierOfPlan } from "../plans";
import { USAGE_FEATURES } from "../../services/llm-usage";

describe("allowances", () => {
  it("are the approved launch configuration, independent per product", () => {
    expect(ALLOWANCES.free).toEqual({ novaCredits: 150, browserTasks: 10, mcpLifetime: 2_000, mcpReadOnly: 100, storageBytes: 500_000_000 });
    expect(ALLOWANCES.plus).toEqual({ novaCredits: 1_000, browserTasks: 40, mcpLifetime: null, mcpReadOnly: null, storageBytes: 2_000_000_000 });
    expect(ALLOWANCES.pro).toEqual({ novaCredits: 3_500, browserTasks: 120, mcpLifetime: null, mcpReadOnly: null, storageBytes: 15_000_000_000 });
  });
  it("can be changed without code (USAGE_ALLOWANCES), with a new version; bad values are ignored", () => {
    const env = { USAGE_ALLOWANCES: JSON.stringify({ free: { novaCredits: 200, browserTasks: -3 }, pro: { browserTasks: 200 }, plus: { mcpLifetime: null } }) };
    const a = allowances(env);
    expect(a.table.free.novaCredits).toBe(200);
    expect(a.table.free.browserTasks).toBe(10);
    expect(a.table.pro.browserTasks).toBe(200);
    expect(a.version).not.toBe(allowances({}).version);
    expect(allowances({ USAGE_ALLOWANCES: "{not json" }).table).toEqual(allowances({}).table);
  });
  it("track a $0.03 browser-task cost target, configurable", () => {
    expect(browserTaskCostTargetMicros({})).toBe(30_000);
    expect(browserTaskCostTargetMicros({ BROWSER_TASK_COST_TARGET_MICROS: "25000" })).toBe(25_000);
  });
  it("have fair-use limits, configurable, never zero", () => {
    expect(fairUse({})).toEqual(DEFAULT_FAIR_USE);
    expect(fairUse({ USAGE_FAIR_USE: JSON.stringify({ mcpCallsPerMinute: 30, mcpCallsPerDay: 0 }) })).toMatchObject({ mcpCallsPerMinute: 30, mcpCallsPerDay: DEFAULT_FAIR_USE.mcpCallsPerDay });
  });
  it("give no allowance to Kivo-funded or system cost", () => {
    for (const tier of ["free", "plus", "pro"] as const) {
      expect(limitFor(tier, "kivo_funded")).toBeNull();
      expect(limitFor(tier, "system")).toBeNull();
    }
  });
});

describe("tiers", () => {
  const at = (d: number) => new Date(Date.UTC(2026, 10, d));
  const sub = (planKey: string, over: Record<string, unknown> = {}) => ({ planKey, status: "active", currentPeriodEnd: at(20), cancelAtPeriodEnd: false, endedAt: null, ...over });
  const trial = { startedAt: at(1), endsAt: at(8) };
  it("come from the plan behind the subscription", () => {
    expect(deriveAccess({ subscription: sub("plus_monthly"), trial: null, now: at(10), graceDays: 3 })).toMatchObject({ tier: "plus", plan: "pro", source: "subscription" });
    expect(deriveAccess({ subscription: sub("pro_monthly"), trial: null, now: at(10), graceDays: 3 })).toMatchObject({ tier: "pro", source: "subscription" });
    expect(deriveAccess({ subscription: sub("pro_annual"), trial: null, now: at(10), graceDays: 3 }).tier).toBe("pro");
    expect(tierFor({ tier: "plus" })).toBe("plus");
  });
  it("keep a paying tier through the past-due grace, then fall to Free", () => {
    const pastDue = sub("plus_monthly", { status: "past_due" });
    expect(deriveAccess({ subscription: pastDue, trial: null, now: at(22), graceDays: 3 })).toMatchObject({ tier: "plus", source: "grace" });
    expect(deriveAccess({ subscription: pastDue, trial: null, now: at(24), graceDays: 3 }).tier).toBe("free");
  });
  it("end at the period end when cancelled, and at once when revoked", () => {
    expect(deriveAccess({ subscription: sub("pro_monthly", { status: "canceled", cancelAtPeriodEnd: true }), trial: null, now: at(15), graceDays: 3 }).tier).toBe("pro");
    expect(deriveAccess({ subscription: sub("pro_monthly", { status: "canceled", cancelAtPeriodEnd: true }), trial: null, now: at(21), graceDays: 3 }).tier).toBe("free");
    expect(deriveAccess({ subscription: sub("pro_monthly", { status: "revoked", endedAt: at(12) }), trial: null, now: at(13), graceDays: 3 }).tier).toBe("free");
  });
  it("give a trial nothing: everyone is Free without a verified payment", () => {
    expect(deriveAccess({ subscription: null, trial, now: at(3), graceDays: 3 })).toMatchObject({ tier: "free", plan: "free", source: "free" });
    expect(deriveAccess({ subscription: null, trial, now: at(9), graceDays: 3 }).tier).toBe("free");
    expect(deriveAccess({ subscription: null, trial: null, now: at(3), graceDays: 3 }).tier).toBe("free");
  });
  it("map every plan, Plus in rupees and Pro in dollars, never converted", () => {
    expect(tierOfPlan("plus_monthly")).toBe("plus");
    expect(tierOfPlan("pro_monthly")).toBe("pro");
    expect(tierOfPlan("nonsense")).toBe("free");
    expect(formatPrice(PLANS.plus_monthly)).toBe("₹299");
    expect(formatPrice(PLANS.pro_monthly)).toBe("$10");
  });
});

describe("the switch", () => {
  it("is shadow by default, enforces only when told, product by product", () => {
    expect(accountingMode({})).toBe("shadow");
    expect(accountingMode({ USAGE_ACCOUNTING: "off" })).toBe("off");
    expect(enforcing("nova_credits", {})).toBe(false);
    expect(enforcing("nova_credits", { USAGE_ACCOUNTING: "enforce" })).toBe(true);
    expect(enforcing("mcp_read_only", { USAGE_ACCOUNTING: "enforce", USAGE_ENFORCE: "mcp_calls" })).toBe(true);
    expect(enforcing("browser_tasks", { USAGE_ACCOUNTING: "enforce", USAGE_ENFORCE: "mcp_calls,nova_credits" })).toBe(false);
    expect(enforcing("kivo_funded", { USAGE_ACCOUNTING: "enforce" })).toBe(false);
  });
});

describe("periods", () => {
  it("are calendar months in UTC, the boundary belonging to the new month", () => {
    expect(monthlyPeriod(new Date("2026-11-30T23:59:59.999Z")).key).toBe("2026-11");
    expect(monthlyPeriod(new Date("2026-12-01T00:00:00.000Z")).key).toBe("2026-12");
    const dec = monthlyPeriod(new Date("2026-12-31T12:00:00Z"));
    expect(dec.start!.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(dec.end!.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("run from an anniversary day when one is given, across a year end", () => {
    const p = monthlyPeriod(new Date("2027-01-10T00:00:00Z"), 15);
    expect(p.key).toBe("2026-12-15");
    expect(p.start!.toISOString()).toBe("2026-12-15T00:00:00.000Z");
    expect(p.end!.toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(monthlyPeriod(new Date("2027-01-15T00:00:00Z"), 15).key).toBe("2027-01-15");
    expect(monthlyPeriod(new Date("2027-03-01T00:00:00Z"), 31).key).toBe("2027-02-28");
  });
  it("are a lifetime for MCP calls and the present for storage", () => {
    const now = new Date("2026-11-22T00:00:00Z");
    expect(periodFor("mcp_calls", now).key).toBe("lifetime");
    expect(periodFor("storage_bytes", now).key).toBe("current");
    expect(periodFor("mcp_read_only", now).key).toBe("2026-11");
  });
});

describe("Nova credits from measured cost", () => {
  it("are one per $0.001, rounded up, at least one", () => {
    expect(creditsFor(718)).toBe(1);        // the P50 standard request
    expect(creditsFor(1_000)).toBe(1);
    expect(creditsFor(1_001)).toBe(2);
    expect(creditsFor(12_043)).toBe(13);    // the costliest Build with Nova turn
    expect(creditsFor(0)).toBe(1);
  });
  it("follow a configured rate, named in the version", () => {
    expect(creditsFor(2_500, 500)).toBe(5);
    expect(creditRateVersion(1_000)).toBe("credits@v1:1000micros:ceil:min1");
  });
  it("reserve more for features that cost more", () => {
    expect(reserveEstimate("build_with_nova")).toBeGreaterThan(reserveEstimate("today_copilot"));
    expect(reserveEstimate("today_copilot")).toBe(1);
  });
});

describe("feature classes", () => {
  it("class every usage feature, and only the named ones are not the learner's", () => {
    const notNova = USAGE_FEATURES.filter(f => featureClass(f) !== "nova");
    expect(notNova.sort()).toEqual(["capture_placement", "extension_agent", "extension_intent", "other", "rex", "saved_page_processing", "saved_page_retry", "scheduled_nova_message"].sort());
    expect(featureClass("extension_agent")).toBe("browser");
    expect(featureClass("scheduled_nova_message")).toBe("kivo");
    expect(featureClass("rex")).toBe("system");
  });
  it("count Telegram's reading, wording and rewording as the learner's", () => {
    for (const f of ["telegram_understanding", "telegram_reply", "telegram_rewording", "telegram_onboarding", "telegram_first_use"]) expect(featureClass(f)).toBe("nova");
  });
  it("count an unknown feature as the learner's, never as free", () => {
    expect(featureClass("a_feature_added_later")).toBe("nova");
  });
});

describe("MCP read-only fallback", () => {
  it("allows everything within Free's lifetime allowance", () => {
    expect(mcpDecision({ tier: "free", kind: "write", lifetimeBefore: 1_999, readOnlyBefore: 0 })).toEqual({ countReadOnly: false, refusal: null });
  });
  it("refuses writes once the lifetime allowance is used", () => {
    expect(mcpDecision({ tier: "free", kind: "write", lifetimeBefore: 2_000, readOnlyBefore: 0 }).refusal).toBe("mcp_lifetime_exhausted");
  });
  it("counts reads on the month's read-only allowance, then refuses them", () => {
    expect(mcpDecision({ tier: "free", kind: "read", lifetimeBefore: 2_000, readOnlyBefore: 99 })).toEqual({ countReadOnly: true, refusal: null });
    expect(mcpDecision({ tier: "free", kind: "read", lifetimeBefore: 5_000, readOnlyBefore: 100 })).toEqual({ countReadOnly: true, refusal: "mcp_read_only_allowance_exhausted" });
  });
  it("has no fixed quota on Plus or Pro", () => {
    for (const tier of ["plus", "pro"] as const) {
      expect(mcpDecision({ tier, kind: "write", lifetimeBefore: 1_000_000, readOnlyBefore: 0 })).toEqual({ countReadOnly: false, refusal: null });
    }
  });
});
