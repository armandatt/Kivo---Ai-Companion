# Plan and usage: what people see

How Kivo shows a person their plan, their four allowances and what upgrading changes. The rules behind the figures are in `docs/USAGE_ACCOUNTING.md` and `docs/BILLING.md`; this page is only about how they are shown and worded.

## One source for every figure

| What | Where it comes from |
|---|---|
| Plan, tier, subscription state, grace | `billing/access.ts` via `billingView` (`GET /api/billing`) |
| Used, left, renewal of each allowance | `billing/accounting/summary.ts` `usageViewFor` (in `billingView.allowances`) |
| Every tier's allowances | `billing/offer.ts` `planCatalog` = the accounting rules' table, overrides included (`billingView.catalog`) |
| The plan to offer | `billing/offer.ts` `nextOffer`: the nearest tier above that is on sale **now** (`billingView.nextOffer`) |
| How each row reads | `apps/web/components/billing/usage-model.ts` (pure, tested): formats only, computes no allowance |

The page never decides a plan, a balance or a period. After checkout it waits for Polar's webhook; a return to the success page grants nothing.

## The Plan and usage page (`/settings/billing`)

- **Four rows, never combined:** Nova credits, browser-agent tasks, images and attachments, ChatGPT and Claude. Each row has its figure, what is left, a bar where there is a fixed limit, and its renewal date in the viewer's own time zone. Under "What counts, and what happens at the limit", each row explains what uses it and what happens when it runs out.
- **States:**

  | State | When |
  |---|---|
  | Running low | 80% or more |
  | Used up | 100% |
  | Read-only | Free MCP after its lifetime calls |
  | Fair use | Plus/Pro MCP |

  A row whose limit is not enforced yet says so plainly ("Not applied yet … nothing pauses because of them"). Shadow mode never reads like a refusal.
- **Storage** is a gauge, not a monthly allowance: it never claims to reset. A full allowance pauses new uploads; what is stored stays, opens and can be exported. Nothing is deleted.
- **ChatGPT and Claude on Free** shows the lifetime calls ("lifetime: these calls don't reset"). After them, it shows this month's read calls and their renewal. Plus and Pro show fair use, and say that limits on very heavy or automated use still apply.
- **Layout** (25 Nov, founder review #05): the four allowances are cards in a grid (two across from 640px, one on a phone), each with its figure, what is left, a bar, its renewal and the explanation folded. A note under them says Nova credits follow cost, not messages or words.
- **A prompt where it helps:** a card that is running low, used up or read-only names what the next plan **on sale** gives for that allowance (`upgradeHint`), with a link to the plans; nothing when no plan is on sale or the next gives no more of it.
- **Reads and writes** are explained apart on the ChatGPT and Claude card.
- **Compare plans:** Free, Plus and Pro side by side from `planCatalog` (`planMatrix`), with prices from `plans.ts`, "Your plan" marked, a plan not on sale shown as coming soon, and Progress and Learning DNA "Included" on all three.
- **Freshness:** "Updated hh:mm · Refresh". The page reads again when the tab comes back into view.
- **Upgrade:** a comparison of "Now" against the next plan on sale, with a button only for a plan that can be bought now. Plus shows as coming soon while it is not on sale. A subscriber changes plan in Polar's portal (Manage subscription).
- **Progress and Learning DNA are included in full on every plan.** Nothing about a person's own learning history is behind a paid plan.

## Pricing page (`components/pricing.tsx`)

- **Taglines** come from `plans.ts`. **Prices** come from `formatPrice`. **The comparison table** comes from the accounting rules' `DEFAULT_ALLOWANCES`.
  - This is a static marketing page, so a `USAGE_ALLOWANCES` override does not reach it. Change the page with the table.
- **Plus** shows "Coming soon", with a disabled button and "Soon" for its price, until `NEXT_PUBLIC_BILLING_PLUS_ENABLED=true` at build time.
- **No "Most popular" badge:** nothing measures that.
- **Fair use is written as fair use;** no plan is called unlimited.

## When an allowance runs out

Each refusal names the allowance, what was used, when it renews and that nothing was lost. It names a plan only if that plan is on sale now (`upgradeLine` in `billing/offer.ts`), and carries `planUrl: "/settings/billing"`.

| Allowance | Response | Notes |
|---|---|---|
| Nova credits | 429 `allowance_used` (`lib/billing/metered.ts`) | Every web surface shows the server's message |
| Browser tasks | 429 `browser_allowance_exhausted` (`…/agent/start`) | A started task always finishes |
| Storage | 413 `storage_allowance_exhausted` (`/api/nova/notes/images`, MCP images) | |
| MCP | `mcp_lifetime_exhausted` / `mcp_read_only_allowance_exhausted` (`lib/connect/mcp.ts`) | Reads and writes are said apart, and reading is said to restart monthly |
| Telegram | `TEXT.creditsUsed` | Names no plan |

## Not done here, on purpose

- **Plus checkout** stays off until its product and payment path are verified: `BILLING_PLUS_ENABLED`, and on the web `NEXT_PUBLIC_BILLING_PLUS_ENABLED`.
- **No enforcement change:** `USAGE_ACCOUNTING` / `USAGE_ENFORCE` are untouched.
- **No Pro-only analytics:** Learning DNA and Progress have no capability beyond what every plan already gets, so nothing is labelled Pro-only. Packaging a deeper analysis for Pro needs that analysis to exist first; it would be a separate, approved piece of work.
