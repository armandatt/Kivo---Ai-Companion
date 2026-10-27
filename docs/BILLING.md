# Billing

Kio sells one paid plan, Pro, through Polar (merchant of record). This page is how billing works, how to run it, and what to do when something looks wrong.

## Plans and access

| | Free | Pro (₹199/month) | Pro yearly (₹1,499) |
|---|---|---|---|
| Everything you make (notes, Knowledge, Saved, history) | Yours | Yours | Yours |
| AI requests a day, across every surface | 150 | 600 | 600 |
| Telegram per-chat caps | as today | ×4 | ×4 |
| Sold | — | yes | only with `BILLING_ANNUAL_ENABLED=true` |

- **Plans** are defined once, in `packages/api/src/billing/plans.ts`: names, prices, trial days, features. The landing page, the handbook and the billing page all read it.
- **Access** is decided in one place, `billing/access.ts`, from the account's `BillingSubscription` row and its `BillingTrial` row:

| State | Access |
|---|---|
| `active` or `trialing` subscription | Pro until the period ends; a period that ended with no renewal event keeps Pro for the grace, unless it was set to cancel |
| Cancelled at period end | Pro until the period ends, then Free |
| `past_due` or `unpaid` | Pro for `BILLING_GRACE_DAYS` (3) after the period end, then Free |
| `revoked`, `incomplete`, `paused`, unknown, or ended | Free |
| Kio trial running | Pro until it ends |

- **Losing Pro changes allowances only.** No user data is deleted on cancellation, expiry, refund or revocation.

## The trial

Kio's own trial: 7 days of Pro, no card, no automatic charge.

- **One per account, ever.** The `BillingTrial` row is keyed by the user id, so concurrent clicks, new sessions or a changed device clock can't start a second one.
- **New accounts only.** An account that has ever had a subscription isn't offered it.
- **Polar's trial is off.** Checkout sends `allow_trial: false`. Automatic conversion isn't implemented: turning it on needs Polar's trial lifecycle, clear disclosure, and cancellation and failed-payment handling.

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
- **Faults fail open.** If billing or the meter can't be read, the request runs and the fault is logged. A learner is never refused for Kio's fault.
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
| `GET /api/billing` | Plan, source, until, subscription, trial, today's usage, purchasable plans |
| `POST /api/billing/trial` | Start the trial; idempotent |
| `POST /api/billing/checkout` `{ plan }` | Polar checkout URL for `pro_monthly` / `pro_annual` |
| `POST /api/billing/portal` | Polar customer portal URL (cancel, card, invoices) |
| `POST /api/billing/webhook` | Polar events |

- The account always comes from the session cookie.
- The POST routes accept only `application/json`.
- The web app rewrites the first four to the API.

## Setting it up

1. **Polar sandbox** (`sandbox.polar.sh`):
   1. Create the organization.
   2. Create a product **Kio Pro (monthly)**, recurring monthly at ₹199, plus optionally the yearly one. Leave Polar's own trial off.
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
  - trial races, allowance under concurrency, token metering;
  - forged, tampered and replayed webhooks;
  - duplicates and out-of-order deliveries;
  - cancel, past-due, refund and revoke;
  - checkout allowlist, the portal, cross-surface entitlement, data kept after a downgrade.
