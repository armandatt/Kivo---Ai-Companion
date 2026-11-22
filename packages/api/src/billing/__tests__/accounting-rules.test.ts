// Usage accounting's pure rules (billing/accounting/rules.ts): allowances,
// periods, credits from cost, the shadow tier, feature classes and the MCP
// read-only fallback.

import {
  ALLOWANCES, creditRateVersion, creditsFor, featureClass, limitFor, mcpDecision, monthlyPeriod, periodFor,
  reserveEstimate, shadowTier,
} from "../accounting/rules";
import { USAGE_FEATURES } from "../../services/llm-usage";

describe("allowances", () => {
  it("are the approved initial targets, independent per product", () => {
    expect(ALLOWANCES.free).toEqual({ novaCredits: 150, browserTasks: 10, mcpLifetime: 2_000, mcpReadOnly: 100, storageBytes: 500_000_000 });
    expect(ALLOWANCES.plus).toEqual({ novaCredits: 1_000, browserTasks: 40, mcpLifetime: null, mcpReadOnly: null, storageBytes: 2_000_000_000 });
    expect(ALLOWANCES.pro).toEqual({ novaCredits: 3_500, browserTasks: 200, mcpLifetime: null, mcpReadOnly: null, storageBytes: 15_000_000_000 });
  });
  it("give no allowance to Kivo-funded or system cost", () => {
    for (const tier of ["free", "plus", "pro"] as const) {
      expect(limitFor(tier, "kivo_funded")).toBeNull();
      expect(limitFor(tier, "system")).toBeNull();
    }
  });
});

describe("shadow tier", () => {
  it("is Plus during Kivo's trial, Pro for a paid or grace subscription, else Free", () => {
    expect(shadowTier({ plan: "pro", source: "trial" })).toBe("plus");
    expect(shadowTier({ plan: "pro", source: "subscription" })).toBe("pro");
    expect(shadowTier({ plan: "pro", source: "grace" })).toBe("pro");
    expect(shadowTier({ plan: "free", source: "free" })).toBe("free");
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
