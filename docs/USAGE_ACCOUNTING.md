# Usage allowances: accounting, enforcement and rollout

Four independent allowances, never one shared balance. `USAGE_ACCOUNTING` decides what they do:

| Mode | What happens |
|---|---|
| `off` | Nothing is recorded or refused. The daily meter (`AiUsageDay`, Free 150 / paid 600 requests a day) alone decides, as before Phase 1. The emergency switch. |
| `shadow` (default) | Every allowance is recorded and what enforcement would refuse is noted; nothing is refused. The daily meter decides. |
| `enforce` | The allowances decide. Nova credits replace the daily meter's limit (it still counts every request, never refuses). `USAGE_ENFORCE=nova_credits,browser_tasks,mcp_calls,storage_bytes` narrows enforcement to a list; the rest stay in shadow. |

Variables are read at call time; Render needs a restart, not a deploy, after changing one.

## Configuration (owner-approved)

| | Free (₹0) | Plus (₹299/month) | Pro ($10/month) |
|---|---|---|---|
| Nova credits / month | 150 | 1,000 | 3,500 |
| Browser-agent tasks / month | 10 | 40 | 120 |
| Images and attachments | 500 MB | 2 GB | 15 GB |
| ChatGPT and Claude (MCP) | 2,000 lifetime calls (reads and writes), then 100 read-only calls a month | no fixed quota (fair use) | no fixed quota (fair use) |

**Who is on which plan.**
- **Everyone starts on Free** (2026-11-23). Plus or Pro only from a verified, active Polar subscription.
- There is no free trial of a paid plan; Kivo's old trial rows grant nothing (`docs/BILLING.md`).

**Units and targets.**
- **Nova credit:** $0.001 of measured model cost (`NOVA_CREDIT_MICROS`), rounded up, at least 1 per request that reached the model.
- **Browser task cost target:** $0.03 (`BROWSER_TASK_COST_TARGET_MICROS`). It is measured, logged (`browser_task_over_cost_target`) and reported; it never stops a task.

**Changing limits without code:** `USAGE_ALLOWANCES` (JSON per tier), `USAGE_FAIR_USE` (JSON). Every ledger entry carries the version of the table that priced it.

**Periods.**
- **Paid plans** renew allowances on the subscription's day of the month, capped at the 28th. Annual plans renew them monthly, never a year at once.
- **Free** uses calendar months (UTC).
- **MCP's lifetime counter** never resets; its read-only allowance renews monthly.

**Fair use** (every tier, persistent in Postgres):

| Limit | Default |
|---|---|
| MCP calls per connection | 120 a minute |
| MCP calls per account | 5,000 a day |
| MCP batch items per account | 5,000 a day |
| Browser-task starts | 8 per 10 minutes |
| Browser tasks running at once | 3 |
| Build with Nova turns | 8 a minute |

## What each allowance counts, and where it is enforced

| Allowance | Counts | Enforced at | Refusal |
|---|---|---|---|
| Nova credits | Every learner-initiated model call, at measured cost: web Nova, Today, notes tutor/editor, imports, paper import, Create with Nova, Subject Studio, extension Ask, Telegram (one update = one settlement), Build with Nova (reserved per turn before the claim) | `withAiAllowance` (all `metered` routes), `spendForTurn`, Telegram `accountAllows` | 429 `allowance_used`, `code: nova_allowance_exhausted`, `limit`, `used`, `resetsAt`; Telegram `TEXT.creditsUsed` |
| Browser tasks | One per `agent/start`; steps add cost, never units; step cap 40 counted on the task | `admitBrowserTask` (start), `stepOfTask` (cap only) | 429 `browser_allowance_exhausted` / `browser_rate_limited` / `browser_too_many_open`; `task_limit` |
| MCP | Every `tools/call` that reaches a tool, before it runs; read/write from the handler (`connect/usage-class.ts`); `preview_knowledge_changes`, `capture_knowledge` and unknown tools are writes | `admitMcpCall` in `apps/api/lib/connect/mcp.ts` | tool error `mcp_lifetime_exhausted` / `mcp_read_only_allowance_exhausted` / `mcp_rate_limited`, with `mcpAllowance` |
| Storage | Stored bytes of note images and Build with Nova's waiting files (not text) | `admitStorage` before the web image upload and MCP `create_note`/`update_note` images | 413 / tool error `storage_allowance_exhausted` |

**Not on Nova credits** (Kivo-funded, recorded as `kivo_funded`):
- proactive Telegram messages;
- auto-filing;
- side-panel intent routing;
- saved-page processing.

Rex and the scheduler's own calls are `system`. Every model call reaches the ledger: `startInteraction` hands its calls over when it ends, and a call made under no interaction is settled alone.

**Seeing the allowance.** Settings → Plan and billing shows four rows (`GET /api/billing` `allowances`). MCP `get_my_profile` returns `mcpAllowance`.

## Policies

- **Reserve → run → commit or refund.** The reservation is one guarded `UPDATE`, so concurrency cannot overspend. Settlement happens once (guarded on state), and the same idempotency key reserves once.
- **Nova.**
  - Refunds when the work fails, no call succeeds, or the work is refused before running.
  - Partial output charges only the calls that succeeded.
  - A crash is settled by the hourly reconciliation from the usage events.
  - A reservation holds the feature's usual cost (1; 8 for Build with Nova; 3 for the tutor and editor), so near the limit a larger feature is refused first.
- **Browser.**
  - A Kivo failure before the task began is refunded at once.
  - A task with no completed step is refunded when its ticket expires.
  - A task that did work keeps its charge.
  - A start resent with the same key (extension 1.5.3+) is one task.
  - A running task is never stopped by the month's allowance.
- **MCP.**
  - The 2,000th lifetime call is the last write.
  - A refused call counts nothing.
  - A call with an `idempotencyKey` counts once.
  - The transition is decided under a row lock.
- **Storage.**
  - Concurrent uploads reserve against the measured total.
  - Over the allowance (a downgrade), everything stays readable and exportable; only new uploads wait. **Nothing is ever deleted, truncated or hidden.**
- **Accounting never fails a request.** A fault admits the request and is logged.
- **Account deletion** removes the account's usage ledger, rate-limit windows, `AiUsageDay` and `AiUsageEvent` rows, each ledger table checked to exist first. The deletion transaction is all or nothing.

## Existing users

- **No production record is changed by this rollout.**
- **The schema change is additive:** four new tables, nothing altered.
- **Tiers are worked out on read** from existing rows: a verified active `pro_*` subscription → Pro, `plus_monthly` → Plus, everything else → Free (including the 3 historical trial rows, all ended).
- **Allowances are limits per period, not grants**, so nothing can be granted twice. The first enforced month starts from zero use; daily-meter history stays in `AiUsageDay`.
- **At the time of writing:** production had 0 subscriptions and 0 active trials (read-only check, 2026-11-22).

## The schema change (verified 2026-11-22 against production, 2026-11-23 against a production-shaped copy)

**Why it is missing.** The earlier push was run from a checkout on `feature/phase5-reliability`, whose schema has no `Usage*` models: a no-op.

**Production → this schema** is exactly:

| Object | Kind |
|---|---|
| `UsageBalance` (16 columns, PK `id`) | table |
| `UsageReservation` (17 columns incl. `steps INTEGER NOT NULL DEFAULT 0`, PK `id`) | table |
| `UsageLedger` (20 columns, PK `id`) | table |
| `RateLimitWindow` (4 columns, PK `(key, windowStart)`) | table |
| `UsageBalance_accountKey_product_periodKey_key`, `UsageReservation_accountKey_product_idempotencyKey_key`, `UsageLedger_idempotencyKey_key` | 3 unique indexes |
| `UsageBalance_product_periodKey_idx`, `UsageReservation_state_expiresAt_idx`, `UsageReservation_product_ref_idx`, `UsageLedger_accountKey_product_periodKey_idx`, `UsageLedger_product_createdAt_idx`, `RateLimitWindow_expiresAt_idx` | 6 indexes |

That is 4 `CREATE TABLE` and 9 `CREATE INDEX`, with **no `ALTER`, no `DROP`, no foreign keys**, and no other table touched.

## Production rollout

Every step says who does it, where, the command or screen, the expected result, what failure looks like, and whether it changes production. **Run every command from a checkout of this code** (the `feature/usage-enforcement` branch, or `main` after it is merged), never from a checkout on another branch. Never paste a full database URL anywhere.

### A. Pre-deployment checklist (you; no production change)

- [ ] The branch is reviewed and merged (or you run from the branch checkout).
- [ ] In the checkout you will use, `git log -1 --oneline` shows the merged commit.
- [ ] `grep -c '^model Usage\|^model RateLimitWindow' packages/db/prisma/schema.prisma` prints **4**.
- [ ] `ls packages/db/.env` exists in that checkout (copy it from your main checkout if needed; it is git-ignored).
- [ ] Render: `USAGE_ACCOUNTING=off` (as now). Nothing else changed yet.

### B. Neon recovery point (you; Neon console; creates a branch, does not change production data)

1. Neon console → your project → **Branches** → **Create branch**.
2. Parent: the production branch. Name: `pre-usage-tables-YYYY-MM-DD`. "From": now (head). Create.
3. Note the time.

- **Expected:** a new branch listed; production unchanged.
- **Failure:** creation errors. Do not continue without a recovery point; Neon's instant restore to a time before the push is the fallback.

### C. Database target verification (you; terminal; read-only)

```bash
node scripts/db-target-check.mjs
```

**Expected before the push:**
```
variable                 DIRECT_URL
endpoint                 ep-late-band-a46…
pooled                   false
region                   us-east-1
database                 neondb
databaseReported         neondb
timeline                 85822520788960fbd593c81a08be8707
UsageBalance             false
UsageReservation         false
UsageLedger              false
RateLimitWindow          false
UsageReservation.steps   false
subscriptions            0          (or the real count; never fewer than you know exist)
```

Then, in **Render → the API service → Environment → `DATABASE_URL`**, reveal the value and read **only the host**: it must contain `ep-late-band-a46`. Optionally, in Neon → production branch → its id/timeline must match `timeline`.

**STOP if:**
- the endpoint is not `ep-late-band-a46…`;
- the database is not `neondb`;
- the timeline differs from the production branch;
- Render's host has another endpoint;
- any of the five objects is already `true` (then someone pushed: run D and compare before doing anything).

### D. Read-only Prisma diff (you; terminal; read-only)

```bash
cd packages/db && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/usage-tables.sql
grep -cE '^CREATE TABLE' /tmp/usage-tables.sql          # 4
grep -cE '^CREATE (UNIQUE )?INDEX' /tmp/usage-tables.sql # 9
grep -ciE '^(ALTER|DROP)' /tmp/usage-tables.sql         # 0
grep -E '^CREATE TABLE' /tmp/usage-tables.sql           # UsageBalance, UsageReservation, UsageLedger, RateLimitWindow
```

**Expected:** exactly the objects in "The schema change" above.

**STOP if:**
- there is any `ALTER` or `DROP`;
- there is any other table or index;
- the counts differ;
- the file is empty (then the target already has them, or the checkout's schema is old: recheck A).

### E. Production schema push (you; terminal; **changes production**: adds 4 empty tables)

```bash
cd packages/db && npx prisma db push
```

- **Expected:** "Your database is now in sync with your Prisma schema", with no prompt.
- **STOP** (answer **no**) if Prisma warns about data loss, asks to reset, or lists anything other than the four tables.

### F. Post-push verification (you; terminal; read-only)

```bash
node scripts/db-target-check.mjs
cd packages/db && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

- **Expected:** all five objects `true`; the diff prints `-- This is an empty migration.`
- **Failure:** any `false`, or a non-empty diff. Do not continue; the deployed API still runs, and account deletion stays broken until the tables exist.

### G. Account-deletion smoke test (you; web app; **changes production**: deletes one throwaway account you create)

1. In a private window, sign up a new account with an address you control and that holds nothing (for example `you+deltest-YYYYMMDD@…`). Finish setup.
2. Settings → Delete account → confirm.

- **Expected:** you are signed out, and signing in again with that address and password fails.
- **Failure:** an error on delete; Render logs show `42P01` or `relation … does not exist`. Recheck F.

Never use a real account for this.

### H. API deployment with `USAGE_ACCOUNTING=off` (you; Render; **changes production**: new code, behaviour unchanged)

1. Render → API service → **Manual Deploy** → the merged commit.
2. Check that **Environment** still has `USAGE_ACCOUNTING=off`.

- **Expected:** `https://<api>/api/health` shows the new `commit` and `scheduler.state: running`. Pages, Telegram and MCP behave as before.
- **Failure:** health errors, or 5xx in the logs. Roll back (O).

### I. Switch to `shadow` (you; Render; **changes production**: records usage, refuses nothing)

Render → Environment → set `USAGE_ACCOUNTING=shadow` → Save (Render restarts).

- **Expected:** Settings → Plan and billing shows four usage rows with "Shown for your information"; nothing is refused.
- **Failure:** `usage_accounting … fault` lines in the logs repeatedly. Set `off` again and investigate.

### J. Shadow report (you; terminal; read-only)

After a few days, run:
```bash
npx tsx --tsconfig tsconfig.json scripts/usageShadowReport.ts --days 3 > /tmp/shadow.json
```
Read `checks` first:

| Check | Pass |
|---|---|
| `coverageAtLeast99pct` | `true`: the ledger holds ≥ 99% of the model cost the usage events recorded |
| `interactionsWithoutSettlement` | `0` (else `missingSettlements.byFeature` names the path) |
| `duplicateSettlements` | `0` |
| `staleReservations` | `0` (reconciliation runs hourly) |
| `browserTasksOverCostTarget` | expected to be low; `browser.committedCostUsd` shows P50/P95/max against `costTargetUsd` 0.03 |

Then review the rest of the report:
- `shadowRefusals`: who enforcement would have refused, and for what;
- `nova.byAccount`: old requests against new credits;
- `novaCostBySurface`;
- `mcp.lifetime` / `mcpReadOnlyThisMonth`;
- `storage.over`.

The report only reads; it shows accounts as hashed labels.

### K. Web deployment (you; Vercel; **changes production**: pricing, billing page, guide copy)

1. Approve and apply the Terms text (`docs/legal/TERMS_PLANS_PROPOSAL.md`) and its version first.
2. Leave `NEXT_PUBLIC_BILLING_PLUS_ENABLED` **unset** until L is done.
3. Deploy `main` to production on Vercel.

- **Expected:**
  - the pricing page shows Free, Plus ("Soon" while Plus is not on sale) and Pro ("Choose Pro"), with no mention of a trial;
  - Plan and billing has no "Start free trial";
  - the Terms show the new "Last updated".
- **Failure:** a trial offer still shown means an old build. Redeploy.

### L. Polar: Pro check and Plus (you; Polar dashboard; sandbox first; production **changes billing**)

**Pro (exists today).** Polar → Products: the $10/month Pro product's id must equal Render's `POLAR_PRODUCT_PRO_MONTHLY`.
- The webhook endpoint is `https://<api>/api/billing/webhook` (the API's own host, not the web app's), format **Raw**, subscribed to all `subscription.*`, `order.refunded`, `refund.*` and `order.paid` events (as `docs/BILLING.md` sets it up).
- Its secret must equal `POLAR_WEBHOOK_SECRET`.

**Plus, sandbox** (`POLAR_SERVER=sandbox` on a staging API, or local):
1. Polar sandbox → Products → **New product**: name "Plus", recurring monthly, price **₹299** in INR (no trial).
2. Copy its id into the staging API as `POLAR_PRODUCT_PLUS_MONTHLY`, set `BILLING_PLUS_ENABLED=true`, and set the staging web's `NEXT_PUBLIC_BILLING_PLUS_ENABLED=true`.
3. On staging, Plan and billing → Upgrade to Plus → pay with Polar's sandbox method (and UPI if offered).

- **Expected:**
  - the webhook delivery is `200` in Polar's webhook log;
  - Plan and billing shows **Plus** and Nova credits `0 of 1,000`;
  - the browser-task row says 40.
- **Then:** in Polar, cancel the subscription and check that the page says "Plus, ending"; then revoke or refund it and check it returns to **Free**.
- **Also check:** the payout currency and fee in Polar's settings for INR.
- **Failure:** no webhook (check the URL and secret); the tier stays Free (check the product id); a currency error (INR is not available for that method).

**Plus, production** (only after the sandbox passes):
1. Create the same product in production Polar.
2. Render: `POLAR_PRODUCT_PLUS_MONTHLY=<id>`, `BILLING_PLUS_ENABLED=true`.
3. Vercel: `NEXT_PUBLIC_BILLING_PLUS_ENABLED=true`, then redeploy the web.

**Never paste a product id you have not copied from Polar.**

### M. Extension release (you; Chrome Web Store; **changes the public extension**)

See `apps/extension/store/RELEASE-1.5.3.md` and `apps/extension/store/SUBMISSION.md`.
1. `npm test --workspace nova-extension`
2. `NOVA_URL=https://www.thekivo.in npm run package --workspace nova-extension` (prints the ZIP path and SHA-256)
3. Load it unpacked in Chrome and run one agent task.
4. Chrome Web Store Developer Dashboard → the "Nova" item → **Package** → Upload new package → the ZIP → "What's new" from the release notes → Submit for review.

- **Expected:** version 1.5.3 in review, then published.
- **Not a blocker for enforcement:** older versions still work.

### N. Progressive enforcement (you; Render; **changes production**: refusals begin)

Only after J passes, K is live and the Terms are published:
1. `USAGE_ACCOUNTING=enforce`, `USAGE_ENFORCE=mcp_calls,storage_bytes` → Save. Watch for a day: refusals in the logs, support messages.
2. `USAGE_ENFORCE=mcp_calls,storage_bytes,browser_tasks` → a day.
3. Remove `USAGE_ENFORCE` (all four) → Nova credits enforced; the daily meter now only counts.

- **Expected:** refusals name the exact allowance, and pages show the monthly figures.
- **Failure:** unexpected refusals. Step back one stage, or set `shadow`.

### O. Rollback

| Problem | Action (Render) | Effect |
|---|---|---|
| Enforcement refuses wrongly | `USAGE_ACCOUNTING=shadow` (or `USAGE_ENFORCE` without that product) → Save | the daily meter decides again within a restart; no data lost |
| Accounting faults | `USAGE_ACCOUNTING=off` | nothing recorded |
| The new API misbehaves | Manual Deploy of the previous commit (`0b4888d`) | keep the new tables: the old code needs them for account deletion |
| The schema push | not expected (additive); if ever needed, restore from the branch made in B | never drop the tables while Phase 1 or later code runs |
| Plus checkout trouble | `BILLING_PLUS_ENABLED=false` (Render) and unset `NEXT_PUBLIC_BILLING_PLUS_ENABLED` (Vercel, redeploy) | Plus stops being sold; existing Plus subscribers keep Plus |

## Code

`packages/api/src/billing/accounting/`:

| File | What it does |
|---|---|
| `rules.ts` | Pure: allowances, fair use, credits, periods, feature classes, MCP rule |
| `targets.ts` | Mode, tier and period anchor per account |
| `ledger.ts` | The only writer of the usage tables; account cleanup |
| `limiter.ts` | Persistent rate limits |
| `nova.ts` | Model work |
| `browser.ts` | Browser tasks |
| `mcp.ts` | MCP calls |
| `storage.ts` | Storage |
| `summary.ts` | The billing page's usage view |
| `reconcile.ts` | Stale reservations, rate-limit purge |
| `report.ts` | Shadow report, with `checks` |

**Tests:**
- Unit: `accounting-rules.test.ts`, `billing.test.ts`, `usage-class.test.ts`, `interaction-tally.test.ts`.
- Real Postgres: `usage-accounting.itest.ts` (shadow, deletion cleanup), `usage-enforcement.itest.ts` (enforce, the Free-unless-paid lifecycle, the report), `billing.itest.ts`.
- Extension: `extension.test.mjs` (start key).
