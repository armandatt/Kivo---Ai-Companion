# Proposed revision: Terms of Service "Plans and payment" (and one Privacy Policy addition)

Status: **proposal, not published.** The owner approves the wording, any legal review, and the date. Nothing in `apps/web/app/(legal)/` has been changed.

## Versions

| | Now | Proposed |
|---|---|---|
| `TERMS_VERSION` (`packages/api/src/auth/legal.ts`) | `2026-11-14` | the publication date, e.g. `2026-11-24` |
| `PREVIOUS_TERMS_VERSION` | `2026-10-27` | `2026-11-14`, so sign-ups during the web/API deploy window still record a valid pair |
| `PRIVACY_VERSION` | `2026-11-14` | the same publication date, only if the Privacy addition below is adopted; else unchanged |
| `PREVIOUS_PRIVACY_VERSION` | `2026-10-27` | `2026-11-14` |

**What changes for users:**
- The "Last updated" date on `/terms` (and `/privacy`) follows the version.
- New sign-ups agree to the new pair.
- Existing accounts are not asked again (the current flow; see `auth/legal.ts`). Whether a notice by email is owed for this change is a legal decision. The change is material: the paid plans and what they include.

**Deploy order** (same as earlier versions):
1. Deploy the API with the new constants (both pairs accepted).
2. Deploy the web app with the new text.
3. Once both are live, set the `PREVIOUS_*` pair back to empty.

## What changes and why

The current section says Pro "raises how much you can ask Nova each day" and mentions a trial. Since 2026-11-23:
- **Allowances are monthly** (Nova credits, browser tasks, storage, and an MCP allowance on Free).
- **There are three plans**: Free, Plus (₹299/month) and Pro ($10/month).
- **There is no free trial** of a paid plan.

Everything else in the section stays as it is: renewal, cancelling, refunds, taxes and the seller, price changes. No other section of the Terms changes.

## Proposed text: Terms › Plans and payment

Replace the `<Section id="plans" …>` body in `apps/web/app/(legal)/terms/page.tsx` with:

```tsx
<Section id="plans" title="Plans and payment">
  <p>Kivo has three plans. Free costs nothing. Plus costs {formatPrice(PLANS.plus_monthly)} a month and Pro {formatPrice(PLANS.pro_monthly)} a month. Every account starts on Free; there is no free trial of Plus or Pro, and a paid plan starts only once its payment has been confirmed. Payment is taken by Polar. Whatever plan you are on, what you have written and recorded stays yours, and nothing is deleted when a subscription ends.</p>
  <ul>
    <li><strong>What each plan includes.</strong> Each plan includes monthly allowances, shown on the pricing page and in Settings › Plan and billing: Nova credits (Free 150, Plus 1,000, Pro 3,500 a month); browser-agent tasks (Free 10, Plus 40, Pro 120 a month); space for images and attachments (Free 500 MB, Plus 2 GB, Pro 15 GB); and use of Kivo from ChatGPT and Claude (on Free, 2,000 calls in total and then 100 read-only calls a month; on Plus and Pro, no fixed number, subject to fair use).</li>
    <li><strong>Nova credits.</strong> A usual request to Nova uses about one credit; longer documents and larger jobs use more, in proportion to the work they take. A request that fails because of Kivo or its AI provider uses no credits.</li>
    <li><strong>When an allowance runs out.</strong> Kivo tells you which one, and that part of Kivo pauses until the allowance renews (each month, or on your billing date on a paid plan) or you upgrade. Everything else keeps working, and nothing you have made is deleted, hidden or changed. A browser task that has started is never stopped because an allowance runs out.</li>
    <li><strong>Fair use.</strong> To keep Kivo working for everyone, we limit unusually heavy or automated use on every plan, for example many requests in a short time.</li>
    <li><strong>Renewal.</strong> Plus and Pro renew automatically at the end of each billing period until you cancel.</li>
    <li><strong>Cancelling.</strong> You can cancel at any time. You keep your plan until the end of the period you have paid for, and you are not charged again; then your account is on Free.</li>
    <li><strong>A payment that fails.</strong> If a renewal payment fails, your plan stays on for a short grace period while you update your payment method; then your account is on Free until a payment succeeds.</li>
    <li><strong>Refunds.</strong> Payments are not refunded, including for part of a period, except where the law that applies to you requires a refund.</li>
    <li><strong>Taxes and the seller.</strong> Polar sells Plus and Pro as the merchant of record: it takes the payment, charges any tax that applies and issues the receipt. Its own terms apply to the purchase. Plus is charged in Indian rupees and Pro in US dollars.</li>
    <li><strong>Changes to prices and allowances.</strong> If the price of a paid plan changes, we will tell you before your next renewal at the new price, and you can cancel before then. If we reduce an allowance of a plan you pay for, we will tell you first; the change applies from your next billing period.</li>
  </ul>
</Section>
```

Notes for review:
- "A request that fails … uses no credits" matches the code: failures are refunded.
- "never stopped" matches the browser policy.
- "short grace period" is 3 days today (`BILLING_GRACE_DAYS`); the number is left out so it can change.
- The allowance figures are written out. If they change (`USAGE_ALLOWANCES`), this text must change with a new version. Alternatively, the figures can be referred to the pricing page only.
- "on your billing date on a paid plan" matches the period anchor: the subscription's day of the month, capped at the 28th.
- **"If we reduce an allowance … from your next billing period" is a promise the code does not make by itself.** A change to `USAGE_ALLOWANCES` applies at once. Keep this sentence only if lowering a paid allowance will be done after notice and timed to billing periods; otherwise drop it.

## Proposed addition: Privacy Policy › What we keep

Add one paragraph after "Sign-in safety":

```tsx
<p><strong>Usage of your plan.</strong> To apply your plan's allowances and to understand Kivo's costs, we record how much you use: for each AI request, which part of Kivo asked, the amount of text the AI provider processed and what it cost; your browser-agent tasks and their steps; calls from ChatGPT or Claude (which tool, whether it read or changed something, never the content); and how much space your images and attachments take. These records are kept with your account and deleted with it.</p>
```

This matches the code: account deletion removes the usage ledger, the rate-limit windows, `AiUsageDay` and `AiUsageEvent` (commit on `feature/usage-enforcement`, 2026-11-23). Before that change, `AiUsageDay` and `AiUsageEvent` rows outlived a deleted account, which the current policy's "until you delete it" did not allow.
