# Billing

Kivo sells two paid plans, Plus and Pro, through Polar (merchant of record). Everyone starts on Free. This page is how billing works, how to run it, and what to do when something looks wrong.

## Plans and access

| | Free | Plus (₹299/month) | Pro ($10/month) | Pro yearly |
|---|---|---|---|---|
| Everything you make (notes, Knowledge, Saved, history) | Yours | Yours | Yours | Yours |
| Monthly allowances (Nova credits, browser tasks, storage, MCP) | see `docs/USAGE_ACCOUNTING.md` | 〃 | 〃 | Pro's, renewed monthly |
| Before enforcement (`USAGE_ACCOUNTING` off/shadow): AI requests a day | 150 | 600 | 600 | 600 |
| Sold | — | only with `BILLING_PLUS_ENABLED=true` and its product | yes | only with `BILLING_ANNUAL_ENABLED=true` (price not set) |

- **Plans** are defined once, in `packages/api/src/billing/plans.ts`: names, tiers, prices, currencies, features. The landing page, the handbook and the billing page all read it.
- **Access** is decided in one place, `billing/access.ts`, from the account's `BillingSubscription` row only (updated 2026-11-23: **everyone is Free unless a verified payment says otherwise**):

| State | Access |
|---|---|
| `active` subscription | its plan's tier (Plus or Pro) until the period ends; a period that ended with no renewal event keeps it for the grace, unless it was set to cancel |
| Cancelled at period end | the tier until the period ends, then Free |
| `past_due` or `unpaid` | the tier for `BILLING_GRACE_DAYS` (3) counted from the failure (`pastDueAt`, else the earlier of the period end and the provider's modified time), then Free |
| `trialing` (the provider's own trial) | Free |
| `revoked`, `incomplete`, `paused`, unknown, or ended | Free |
| No subscription, or only a Kivo trial row | Free |

- **Losing a tier changes allowances only.** No user data is deleted on cancellation, expiry, refund or revocation.

## The trial (retired 2026-11-23)

There is no free trial of a paid plan. The old 7-day no-card Pro trial is retired: `startTrial` always refuses, `trialDays()` is 0, trial rows grant nothing, and Polar's trial stays off (checkout sends `allow_trial: false`). What remains of it, and how to remove it later, is under "The retired trial" below.

## Who pays: one account, every surface

The account is the web `User`. A learner reached from any surface is mapped to it (`billing/entitlements.ts`):

- `web:<userId>` is that user.
- A Telegram chat id maps to the user whose profile links that chat.
- A chat no account has linked is Free, metered on its own.

Polar knows the account as the **external customer id** (set at checkout), plus `kivo_user_id` in the metadata. No email is used to decide who someone is.

## AI metering

`AiUsageDay` counts requests and tokens per account per UTC day.

- **Gate and count are one step.** A request is counted before the model is called by one conditional `UPDATE`, so concurrent requests cannot pass the allowance together.
- **Tokens are added afterwards**, from Gemini's `usageMetadata` or OpenAI's `usage`, reported by the shared model client through `services/llm-usage.ts`. Calls outside a meter report to no one, so Rex is unaffected.
- **Metered entry points:**
  - Telegram message readings (`telegram-turn.ts`), with tokens metered at the webhook;
  - web Nova messages (`/api/nova/message`);
  - note assist;
  - the extension's page questions;
  - subject proposals.
- **Not metered yet:** saved-page processing and proactive nudges are background work, governed by `NOVA_RESOURCE_MODEL_DISABLED` and Telegram's response cap.
- **Faults fail open.** If billing or the meter can't be read, the request runs and the fault is logged. A learner is never refused for Kivo's fault.
- **Cost per active user:** `usageSummary(fromDay, toDay)` in `billing/usage.ts` returns active users and request and token totals.

## Webhooks

`POST /api/billing/webhook` on the **API's own address**, not through the web app.

1. **Verified** by Polar's SDK (`webhooks.validateEvent`) against the raw body, using Standard Webhooks headers. A forged, tampered or replayed delivery gets 403.
2. **Recorded** by `webhook-id` in `BillingWebhookEvent`:
   - an id already processed or ignored gets 200 and isn't applied again;
   - a delivery being handled right now (received in the last two minutes) gets 409, and Polar retries it;
   - a failed one, or one whose handler stopped without finishing, is applied on Polar's next attempt (up to 10, with backoff).
3. **Applied** under a row lock per account. Polar's `modified_at` decides between versions of the same subscription, so late deliveries can't undo newer state. A late event about an old, ended subscription never replaces one that is paying for Pro now.
4. **Orders and refunds** (`order.*`, `refund.*`): the subscription is read from Polar (`subscriptions.get`) instead of guessed. A refund changes access only through what it does to the subscription: refunding with the subscription revoked ends Pro at once; a refund that leaves the subscription running leaves Pro until the subscription ends.

A visit to `/settings/billing?checkout=success` grants nothing. The page waits for the webhook.

## Routes

| Route | What it does |
|---|---|
| `GET /api/billing` | Plan, tier, source, until, subscription, today's usage, the four allowances, purchasable plans |
| `POST /api/billing/trial` | Retired: always `not_eligible` (kept for older pages) |
| `POST /api/billing/checkout` `{ plan }` | Polar checkout URL for `pro_monthly` / `pro_annual` |
| `POST /api/billing/portal` | Polar customer portal URL (cancel, card, invoices) |
| `POST /api/billing/webhook` | Polar events |

- The account always comes from the session cookie.
- The POST routes accept only `application/json`.
- The web app rewrites the first four to the API.

## Setting it up

1. **Polar sandbox** (`sandbox.polar.sh`):
   1. Create the organization.
   2. Create a product **Kivo Pro (monthly)**, recurring monthly at **$10** (the price in `plans.ts`), plus optionally the yearly one. Leave Polar's own trial off. For **Plus**, see `docs/USAGE_ACCOUNTING.md` step L (₹299/month, `POLAR_PRODUCT_PLUS_MONTHLY`, `BILLING_PLUS_ENABLED`).
   3. Create an organization access token.
2. **Webhook:** add an endpoint `https://<api-host>/api/billing/webhook` with format **Raw**, subscribed to all `subscription.*`, `order.refunded`, `refund.*` and `order.paid` events. Copy its secret.
3. **API environment** (Render): set `POLAR_SERVER=sandbox`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_PRO_MONTHLY` (and `_ANNUAL`), and `NEXT_PUBLIC_APP_URL`.
4. **Database:** from `packages/db`, run `prisma db push` against the target database. The change is four new tables plus relations on `User`, and nothing existing changes.
5. **Test in the sandbox** with Polar's test card. Check:
   - the billing page shows "Confirming…" and then Pro;
   - Manage subscription opens the portal;
   - cancelling shows "ending";
   - a refund that revokes the subscription ends Pro.
6. **Production:** repeat steps 1–3 in Polar production, with separate token, secret and product ids, and `POLAR_SERVER=production`.

## Checks

- `npx jest src/billing`: access rules, event ordering, plan allowlist, allowances, prices.
- `NOVA_TEST_DATABASE_URL=… npx tsx --test src/billing/__integration__/billing.itest.ts`:
  - no trial can start and a trial row grants nothing; allowance under concurrency, token metering;
  - forged, tampered and replayed webhooks;
  - duplicates and out-of-order deliveries;
  - cancel, past-due, refund and revoke;
  - checkout allowlist, the portal, cross-surface entitlement, data kept after a downgrade.

## Plans, tiers and allowances (Phase 2, updated 2026-11-23)

- **Everyone starts on Free.** A paid tier comes only from a verified, active Polar subscription, applied by a verified webhook (`billing/access.ts`, `service.ts handleWebhook`). Never from a success page, a trial, or anything a browser says.
- Plans map to tiers (`plans.ts`):
  - `free` → Free;
  - `plus_monthly` (₹299/month, Polar product `POLAR_PRODUCT_PLUS_MONTHLY`) → Plus;
  - `pro_monthly` ($10/month, `POLAR_PRODUCT_PRO_MONTHLY`) and `pro_annual` (not sold) → Pro.

  Each plan is sold in its own currency; nothing is converted or shown in another.
- **Lifecycle:**

  | Event | Tier |
  |---|---|
  | `subscription.active` | the product's tier |
  | an upgrade or downgrade in Polar's portal | the new product's tier (`subscription.updated`) |
  | cancellation | kept to the period end, then Free |
  | `subscription.revoked`, or a refund whose subscription has ended | Free at once |
  | a failed renewal (`past_due`/`unpaid`) | kept for `BILLING_GRACE_DAYS` (3) **counted from the failure**, then Free |
  | a failed first payment (`incomplete`) | Free |
  | the provider's `trialing` | Free |

  A delivery seen before is acknowledged and changes nothing. A delivery older than the one applied changes nothing.
- **One subscription per account.** Changing between Plus and Pro is done in Polar's portal (Manage subscription), which changes the paying subscription's product. Checkout refuses a second subscription.
- **Plus is sold only when** `BILLING_PLUS_ENABLED=true` and `POLAR_PRODUCT_PLUS_MONTHLY` are both set on the API. The web pages show it as on sale only with `NEXT_PUBLIC_BILLING_PLUS_ENABLED=true` (Vercel, build time). Set both after the INR route is verified in the sandbox.
- **Allowances** per tier and their enforcement: `docs/USAGE_ACCOUNTING.md`.
- **Disputes.** Polar charges $15 per dispute and revokes the subscription when it is lost; the `subscription.revoked` event ends the tier. Dispute events themselves are not handled (none in the SDK version used).

### The retired trial (for future removal)

Until 2026-11-23 Kivo offered a 7-day no-card Pro trial (`BillingTrial`, `POST /api/billing/trial`, `startTrial`). It now grants nothing:
- `deriveAccess` ignores trial rows;
- `trialDays()` is 0;
- `startTrial` always answers `not_eligible`;
- `trialEligible` is false;
- the pages no longer offer it.

`BILLING_TRIAL_DAYS` and `BILLING_TRIAL_TIER` are no longer read. Production has 3 trial rows, all ended; they are kept as history.

To remove the trial fully later, in one change:
- delete the route `apps/api/app/api/billing/trial`, `startTrial`, `trialEligible` and the `trial*` fields of `billingView`;
- drop the trial parts of the web billing page's `View` type;
- then drop `BillingTrial` with a reviewed migration (data loss of the 3 historical rows), or keep the table.
