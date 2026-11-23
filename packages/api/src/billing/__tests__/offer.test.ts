import { nextOffer, planCatalog, sellablePlans, upgradeLine } from "../offer";
import { DEFAULT_ALLOWANCES } from "../accounting/rules";

// A provider configured for production with Pro's product; Plus's product and
// switch are added per test.
const base = {
  POLAR_SERVER: "production", POLAR_ACCESS_TOKEN: "t", POLAR_WEBHOOK_SECRET: "s", NEXT_PUBLIC_APP_URL: "https://app.test",
  POLAR_PRODUCT_PRO_MONTHLY: "pro-id",
};
const withPlus = { ...base, POLAR_PRODUCT_PLUS_MONTHLY: "plus-id", BILLING_PLUS_ENABLED: "true" };

describe("what upgrading offers (billing/offer.ts)", () => {
  it("sells only what is configured and switched on: Plus needs both its product and its switch", () => {
    expect(sellablePlans(base)).toEqual(["pro_monthly"]);
    expect(sellablePlans({ ...base, POLAR_PRODUCT_PLUS_MONTHLY: "plus-id" })).toEqual(["pro_monthly"]);
    expect(sellablePlans(withPlus)).toEqual(["plus_monthly", "pro_monthly"]);
    expect(sellablePlans({})).toEqual([]);
  });

  it("Free is offered Pro while Plus is not on sale, and Plus once it is", () => {
    expect(nextOffer("free", base)?.plan).toBe("pro_monthly");
    expect(nextOffer("free", withPlus)?.plan).toBe("plus_monthly");
    expect(nextOffer("plus", withPlus)?.plan).toBe("pro_monthly");
  });

  it("Pro, or nothing on sale, is offered nothing", () => {
    expect(nextOffer("pro", withPlus)).toBeNull();
    expect(nextOffer("free", {})).toBeNull();
  });

  it("the offer carries the plan's own price and the accounting table's allowances", () => {
    const o = nextOffer("free", base)!;
    expect(o).toMatchObject({ name: "Pro", price: "$10", interval: "month" });
    expect(o.allowance).toEqual(DEFAULT_ALLOWANCES.pro);
    const plus = nextOffer("free", withPlus)!;
    expect(plus.price).toBe("₹299");
    expect(plus.allowance).toEqual(DEFAULT_ALLOWANCES.plus);
  });

  it("refusal lines never name a plan that cannot be bought", () => {
    expect(upgradeLine("free", "nova", base)).toBe(" Pro has 3,500 a month.");
    expect(upgradeLine("free", "nova", withPlus)).toBe(" Plus has 1,000 a month.");
    expect(upgradeLine("free", "browser", base)).toBe(" Pro has 120 a month.");
    expect(upgradeLine("free", "storage", base)).toBe(" Pro has 15 GB.");
    expect(upgradeLine("free", "mcp", base)).toBe(" Pro has no fixed limit (fair use).");
    expect(upgradeLine("free", "nova", {})).toBe("");
    expect(upgradeLine("pro", "nova", withPlus)).toBe("");
    for (const what of ["nova", "browser", "storage", "mcp"] as const) expect(upgradeLine("free", what, base)).not.toMatch(/Plus/);
  });

  it("an approved allowance override reaches the offer and the catalogue alike", () => {
    const env = { ...base, USAGE_ALLOWANCES: JSON.stringify({ pro: { novaCredits: 4000 } }) };
    expect(planCatalog(env).pro.novaCredits).toBe(4000);
    expect(nextOffer("free", env)?.allowance.novaCredits).toBe(4000);
    expect(upgradeLine("free", "nova", env)).toBe(" Pro has 4,000 a month.");
    expect(planCatalog(base)).toEqual(DEFAULT_ALLOWANCES);
  });
});
