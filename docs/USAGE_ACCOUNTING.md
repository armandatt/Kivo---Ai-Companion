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

## Production rollout

Verified 2026-11-22 (read-only):
- **The database.** `packages/db/.env` and the live Render API (commit `0b4888d`) use the same database: Neon endpoint `ep-late-band-a46…` (us-east-1), database `neondb`, timeline `85822520…`. Evidence: Render's MCP endpoint wrote `NovaConnectGrant.lastUsedAt` there at 16:18:59 UTC, 13 minutes after the deploy.
- **The schema.** Everything else in that database matches the repo: `prisma migrate diff` from it to the Phase 2 schema is only `CREATE TABLE` (4) and `CREATE INDEX` (9), with no `ALTER` and no `DROP`.
- **Why the tables are missing.** The Phase 1 push was run from a checkout on `feature/phase5-reliability`, whose schema has no `Usage*` models, so it was a no-op ("in sync").
- **Account deletion.** With the tables missing, `deleteAccount` fails in Phase 1 code (`42P01 UsageLedger`) and rolls back whole; Phase 2 code skips the missing tables. Both pass once the tables exist (local reproduction on a production-shaped database: 0/8 → 8/8).

Steps marked **[prod]** need the owner's approval and are run by the owner.

1. **[prod] Recovery point.** In the Neon console, create a branch from production *now* (for example `pre-usage-tables-2026-11-22`) and note the time (Neon's instant restore covers it too). The push only adds tables, so this is insurance.
2. **Verify the target**, from a checkout of the Phase 2 code (this branch, or `main` after it is merged), **never from a checkout on an older branch**:
   ```bash
   git -C my-turborepo log -1 --format=%h          # the Phase 2 commit (or main containing it)
   grep -c '^model Usage\|^model RateLimitWindow' my-turborepo/packages/db/prisma/schema.prisma   # must print 4
   node my-turborepo/scripts/db-target-check.mjs   # endpoint ep-late-band-a46…, neondb, timeline 85822520…, all five objects false
   ```
   In Render → Environment, read only the host part of `DATABASE_URL`: it must contain the same `ep-late-band-a46…` endpoint.
3. **Dry run (read-only):**
   ```bash
   cd my-turborepo/packages/db && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```
   Expected: exactly `CREATE TABLE` for `UsageBalance`, `UsageReservation` (with `steps`), `UsageLedger`, `RateLimitWindow`, and their 9 indexes. Stop if it shows any `ALTER`, `DROP` or another table.
4. **[prod] Push:** `cd my-turborepo/packages/db && npx prisma db push`. It must not ask about data loss; if it does, stop. Then run `node scripts/db-target-check.mjs` again: all five objects true.
5. **Verify account deletion:** the running Phase 1 API deletes accounts again as soon as the tables exist (no deploy needed). Delete a throwaway test account through Settings, or watch the next real deletion in the Render logs for no `42P01`.
6. **[prod] Deploy the API** (Render, manual) with `USAGE_ACCOUNTING=off` (as set now). Health must show the new commit; `/api/health` and the scheduler must be healthy.
7. **[prod] Switch to `shadow`** (Render env) and restart.
8. **Shadow verification**, for a few days: `npx tsx --tsconfig tsconfig.json scripts/usageShadowReport.ts --days 3`. Check:
   - coverage ≥ 99% of the usage events' cost;
   - no reservation stale beyond one hour past its expiry;
   - reconciliation logs present;
   - the accounts enforcement would refuse, reviewed;
   - MCP read/write mix and browser task cost against the $0.03 target.
9. **[prod] Web deploy** (Vercel, from `main`) with the pricing, billing page and guide copy, together with the Terms page wording the owner approves (it still describes a daily allowance). Until Plus can be bought, its card says so on Plan and billing ("Payments open soon" / "Not available yet").
10. **[prod] Plus in the Polar sandbox:**
    - create the ₹299/month product;
    - check that INR/UPI checkout works end to end with a sandbox subscription (`subscription.active` → Plus on Plan and billing);
    - check renewal, cancel and refund webhooks and the payout currency.

    Then create it in production and set `POLAR_PRODUCT_PLUS_MONTHLY`.
11. **[prod] Enforce:** `USAGE_ACCOUNTING=enforce` and restart. Suggested order with `USAGE_ENFORCE`: `mcp_calls,storage_bytes`, then add `browser_tasks`, then `nova_credits`.
12. **Extension:** release the version with the browser-task start key (`lib/api.js agentStart`) so a lost start is never two tasks. The server already accepts it; older versions still work.

**Rollback:**

| What went wrong | Do this |
|---|---|
| Enforcement causes trouble | `USAGE_ACCOUNTING=shadow` (or `off`) and restart: the daily meter decides again at once, and no data is lost |
| The deploy causes trouble | Redeploy `0b4888d` in Render. The new tables stay and are harmless; Phase 1 code needs them for deletion |
| The schema push itself | Not expected to need undoing (additive). If ever required, restore from the step 1 branch. Never drop the tables while Phase 1 or 2 code runs: account deletion would fail again under Phase 1 |

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
