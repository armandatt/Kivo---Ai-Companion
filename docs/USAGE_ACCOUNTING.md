# Usage allowances: accounting and enforcement

Four independent allowances, never one shared balance. `USAGE_ACCOUNTING` decides what they do:

| Mode | What happens |
|---|---|
| `off` | Nothing is recorded or refused. The daily meter (`AiUsageDay`, Free 150 / Pro 600 requests a day) alone decides, as before Phase 1. The emergency switch. |
| `shadow` (default) | Every allowance is recorded and what enforcement would refuse is noted; nothing is refused. The daily meter decides. |
| `enforce` | The allowances decide. Nova credits replace the daily meter's limit (it still counts every request, so its history continues). `USAGE_ENFORCE=nova_credits,browser_tasks,mcp_calls,storage_bytes` narrows enforcement to a list; the rest stay in shadow. |

Every variable is read at call time. Render needs a restart to pick up a change, not a deploy.

## Launch configuration (owner-approved 2026-11-22)

| | Free (₹0) | Plus (₹299/month) | Pro ($10/month) |
|---|---|---|---|
| Nova credits / month | 150 | 1,000 | 3,500 |
| Browser-agent tasks / month | 10 | 40 | 120 |
| Images and attachments | 500 MB | 2 GB | 15 GB |
| ChatGPT and Claude (MCP) | 2,000 lifetime calls, then 100 reads a month | no fixed quota (fair use) | no fixed quota (fair use) |

Further settings:

- **Browser task cost target:** $0.03 a task (`BROWSER_TASK_COST_TARGET_MICROS`). It is measured, logged and reported; it never stops a task.
- **Nova credit:** $0.001 of measured model cost (`NOVA_CREDIT_MICROS`), rounded up, at least 1 per request that reached the model.
- **Changing limits without code:** `USAGE_ALLOWANCES` (JSON, per tier) and `USAGE_FAIR_USE` (JSON). Every ledger entry carries the version of the table that priced it.
- **Kivo's 7-day trial:** keeps its existing **Pro** access (`BILLING_TRIAL_TIER=pro`). The monetisation brief proposed Plus; that is the owner's call, and `BILLING_TRIAL_TIER=plus` applies it.
- **Annual plans:** grant Pro's allowances month by month, on the subscription's day of the month (capped at the 28th), never a year at once. Monthly paid plans renew on the same day; Free and trial use calendar months (UTC).

## What each allowance counts

- **Nova credits.** Every model call a learner's request makes, at its measured cost. That covers:
  - web Nova, Today's copilot, the notes tutor and editor, note imports and proposals, paper import, Create with Nova, Subject Studio;
  - Build with Nova (reserved per turn, before the job is claimed);
  - Telegram (one update is one settlement, reading, wording and rewording together);
  - extension Ask Nova.

  Kivo-funded and not counted against the learner:
  - proactive Telegram messages;
  - auto-filing of captures;
  - side-panel intent routing;
  - saved-page processing.

  Rex and unattributed calls are `system`. All of these are still recorded.
- **Browser tasks.** One per `agent/start`, however many steps. Steps add their measured cost to the task, never a unit. The step cap (40) is counted on the task's reservation, so it holds across restarts.
- **MCP calls.** Every `tools/call` that reached a tool, counted before it runs. `initialize`, `tools/list` and calls refused by auth are not counted. Each tool is classed read or write from what its handler does (`connect/usage-class.ts`). `preview_knowledge_changes` and `capture_knowledge` are writes, and an unknown tool is a write.
- **Storage.** Stored bytes of note images and Build with Nova's waiting files. Note text, maps, tasks and saved-page metadata are not counted. Bytes still live in Postgres; the move to object storage is a separate task.

## Where enforcement happens

| Surface | Point | Refusal |
|---|---|---|
| Web and extension AI routes (`metered`) | `withAiAllowance` → `reserveForInteraction` before work | 429 `error: "allowance_used"`, `code: "nova_allowance_exhausted"`, `limit`, `used`, `resetsAt`, `tier` |
| Build with Nova (create, message, retry) | `spendForTurn` reserves before the claim; a job that never starts releases it | same 429 |
| Telegram | `accountAllows` in `telegram-turn.ts` | `TEXT.creditsUsed` (English and Hinglish); buttons and commands keep working |
| Browser agent | `agent/start` → `admitBrowserTask` (allowance, starts per 10 minutes, tasks open at once) | 429 `browser_allowance_exhausted` / `browser_rate_limited` / `browser_too_many_open` |
| Browser steps | `agent/step` → `stepOfTask` (step cap only; never the month's tasks) | 429 `task_limit` |
| MCP | `apps/api/lib/connect/mcp.ts` → `admitMcpCall` before `runTool` | tool error `mcp_lifetime_exhausted` / `mcp_read_only_allowance_exhausted` / `mcp_rate_limited`, with `mcpAllowance` |
| Note image upload (web) | `admitStorage` before `saveNoteImage` | 413 `storage_allowance_exhausted` |
| MCP note images (`create_note`, `update_note`) | `admitStorage` before the tool | tool error `storage_allowance_exhausted` |

**Seeing the allowance:**
- `GET /api/billing` returns `allowances` (`accounting/summary.ts`), shown on Settings → Plan and billing as four separate rows.
- MCP's `get_my_profile` returns `mcpAllowance`, as does every tool result once a Free account is on read-only.

## Policies

- **Reserve → run → commit or refund.** The reservation is one guarded `UPDATE`, so concurrent requests cannot pass a limit. Settlement leaves `reserved` once, guarded on state, so a retry changes nothing.
  - Work that failed, made no successful model call, or was refused before running is refunded.
  - Partial output charges only the calls that succeeded.
  - A crash leaves the reservation to the hourly reconciliation, which commits from the usage events or refunds.
- **Reservation estimate.** A reservation holds the feature's usual cost (`reserveEstimate`: 1 for most features, 8 for Build with Nova, 3 for the tutor and editor). Settlement charges the measured cost. Near the limit, a feature with a larger estimate is refused before a cheaper one would be.
- **Browser.**
  - A Kivo failure before the task began is refunded at once.
  - A task with no completed step when its ticket expires is refunded.
  - A task that did work keeps its charge, however it ended.
  - A start resent with the same `clientKey` returns the same task. The extension does not send one yet.
- **MCP.**
  - The 2,000th lifetime call is the last write.
  - A refused call counts nothing.
  - A call with an `idempotencyKey` counts once.
  - The lifetime counter never resets; read-only calls renew monthly.
  - Fair use for every tier: 120 calls a minute per connection, 5,000 a day and 5,000 batch items a day per account.
- **Storage.** An upload reserves its bytes against the measured total plus other uploads in flight. Over the allowance (a downgrade), everything stored stays readable and exportable and only new uploads wait. **Nothing is ever deleted, truncated or hidden.**
- **Persistent limits** (`RateLimitWindow`, `accounting/limiter.ts`) cover MCP fair use, browser starts and Build with Nova turns. They hold across restarts and instances. Ordinary route limits are still in memory (one Render instance); the Redis branch is the multi-instance answer.
- **Accounting never fails a request.** A fault in accounting or in the limiter admits the request and is logged.

## Existing users

- **No user, subscription or usage record is changed by the migration.**
- The schema changes are additive:
  - **Phase 1:** `UsageBalance`, `UsageReservation`, `UsageLedger`.
  - **Phase 2:** `RateLimitWindow`, plus the column `UsageReservation.steps`.
- Tiers are derived at read time from the existing subscription and trial rows (`billing/access.ts`): `pro_monthly`/`pro_annual` → Pro, `plus_monthly` → Plus, an active trial → Pro (configurable), anything else → Free. An existing Pro subscriber stays Pro, and a trial user keeps their access to its end.
- Allowances are limits per period, not grants, so nothing can be granted twice. An account's first enforced month starts from zero use; earlier daily-meter history stays in `AiUsageDay` and is not converted.
- Production had 0 subscriptions and 0 active trials on 2026-11-22.

## Rollout (each step needs the owner's approval)

1. `prisma db push` on production from `packages/db`. Check it reports `RateLimitWindow` and `UsageReservation.steps`, and that the three Phase 1 `Usage*` tables exist. **On 2026-11-22 they did not exist in the production database `packages/db/.env` points to**, so this push must include them.
2. Deploy the API (Render, manual) with `USAGE_ACCOUNTING=off` (as now), then switch to `shadow` and restart. Watch the shadow report (`scripts/usageShadowReport.ts`) for a few days:
   - coverage ≥ 99%;
   - no stale reservations;
   - which accounts would be refused.
3. Owner actions before enforcement:
   - approve the Terms page's plan text (it still describes a daily allowance) and its version;
   - deploy the web app (pricing, billing page, guide copy describe the monthly model);
   - for Plus: create the ₹299 Polar product, verify the INR/UPI route in the sandbox (checkout, webhook, payout), then set `POLAR_PRODUCT_PLUS_MONTHLY`.
4. `USAGE_ACCOUNTING=enforce`. Product by product with `USAGE_ENFORCE` if preferred (suggested order: `mcp_calls,storage_bytes` → `browser_tasks` → `nova_credits`).

**Rollback:**
- `USAGE_ACCOUNTING=shadow` (or `off`) and restart: the daily meter decides again at once, and no data is lost.
- Code rollback: redeploy the previous commit. The tables are additive and can stay.

## Code

`packages/api/src/billing/accounting/`:

| File | What it does |
|---|---|
| `rules.ts` | Pure: allowances, fair use, credits, periods, feature classes, MCP rule |
| `targets.ts` | Mode, tier and period anchor per account |
| `ledger.ts` | The only writer of the usage tables |
| `limiter.ts` | Persistent rate limits |
| `nova.ts` | Model work |
| `browser.ts` | Browser tasks |
| `mcp.ts` | MCP calls |
| `storage.ts` | Storage |
| `summary.ts` | The billing page's view |
| `reconcile.ts` | Stale reservations, rate-limit purge |
| `report.ts` | Shadow report |

**Tests:**
- Unit: `accounting-rules.test.ts`, `billing.test.ts`, `usage-class.test.ts`, `interaction-tally.test.ts`.
- Real Postgres: `usage-accounting.itest.ts` (shadow), `usage-enforcement.itest.ts` (enforce: tiers, concurrency, refunds, browser, MCP boundary and bypasses, storage, Polar lifecycle, annual months, existing Pro).
