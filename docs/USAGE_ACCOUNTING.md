# Usage accounting (Phase 1: shadow)

Four independent allowances, recorded beside today's daily AI meter. **Nothing here refuses anyone yet**: `AiUsageDay` (`billing/usage.ts`) still decides what a learner may do. Phase 2 switches enforcement on, behind its own approval.

| Product | Unit | Period | Free / Plus / Pro (approved targets) |
|---|---|---|---|
| `nova_credits` | credit = $0.001 measured model cost, rounded up, min 1 | calendar month (UTC) | 150 / 1,000 / 3,500 |
| `browser_tasks` | one task per `agent/start`, however many steps | calendar month | 10 / 40 / 200 |
| `mcp_calls` | one `tools/call` | lifetime, never reset | 2,000 / none / none |
| `mcp_read_only` | one read call after the lifetime allowance | calendar month | 100 / none / none |
| `storage_bytes` | stored image/attachment bytes (a gauge) | current | 500 MB / 2 GB / 15 GB |
| `kivo_funded`, `system` | model cost Kivo pays / with no learner | calendar month | no allowance |

Tier in shadow (`rules.ts shadowTier`): Kivo's trial → Plus; paid or grace subscription → Pro; else Free. Access itself (`billing/access.ts`) is unchanged.

## Code

`packages/api/src/billing/accounting/` is the only reader and writer of `UsageBalance`, `UsageReservation`, `UsageLedger`.

- `rules.ts` (pure): allowances (`ALLOWANCE_VERSION`), periods, credits (`NOVA_CREDIT_MICROS`, `creditRateVersion`), feature classes, MCP read-only rule, reservation TTLs.
- `ledger.ts`: `reserve` → `commit` | `refund`, `record`, `addCost`, `gauge`, `reconcileStale`, `deleteAccountUsage`. Ledger entry first under a unique key per transition; balance changed by one guarded `UPDATE`; a reservation leaves `reserved` once. Writes run inside `runWithoutWriteSignal`, so they never wake the scheduler (Neon).
- `nova.ts`: settles every ended interaction (`services/llm-usage.ts startInteraction` hands over its calls; a call under no interaction is settled alone). `reserveForInteraction` at the entry points: `withAiAllowance` (every `metered` web/extension route), Build with Nova's job, the Telegram turn.
- `browser.ts`: `reserveBrowserTask` at `agent/start`; steps carry the task id (`withinCountedTask(…, taskId)`) and commit the task on the first completed step.
- `mcp.ts` + `connect/usage-class.ts`: every `tools/call` that reached a tool; read/write from the handler's behaviour; batch items; an unknown tool is a write.
- `storage.ts`: measured after an image upload (and by the report).
- `reconcile.ts`: hourly housekeeping (`apps/api/lib/checkin-cron.ts`).
- `report.ts` + `scripts/usageShadowReport.ts`: the comparison report.

Switch: `USAGE_ACCOUNTING=off` records nothing (no deploy needed to turn it off). Default: shadow.

## Policies

- **Nova:** reserved before the work (the feature's P95 estimate; settled at measured cost). Work succeeded with a successful call → commit `ceil(cost of successful calls / $0.001)`, at least 1, never below the reservation when the price is unknown. Work failed, no call succeeded, or no call made → refund (the provider's cost stays on the refund). Retries inside one call → one call. Telegram: one update = one interaction = one settlement. Same idempotency key (Build with Nova job, Telegram update) → nothing reserved or settled twice.
- **Kivo-funded** (not on Nova credits): `scheduled_nova_message`, `capture_placement`, `extension_intent`, `saved_page_processing`, `saved_page_retry`. `rex`/`other` are `system`. Any other feature, including one added later, is the learner's.
- **Browser:** reserved at start after the start succeeded; committed by the first step whose model call succeeded (a later cancellation keeps it); refunded when the ticket expires with none (`no_meaningful_work`); a start resent with the same `clientKey` returns the same task. Step cap (`AGENT_TASK_STEPS` 40) unchanged.
- **MCP:** counted server-side per `tools/call` after authentication; `initialize`, `tools/list` and calls refused before a tool runs are not counted. One call = 1 unit; batch items are abuse units beside it. Lifetime counts every call on any tier. `preview_knowledge_changes` and `capture_knowledge` (any mode) are writes.
- **Stale reservations:** Nova → committed from the interaction's usage events if a call succeeded (`reconciled_after_interruption`), else refunded; browser → refunded; others → refunded.
- **Privacy:** accounts are the existing meter keys (`user:<id>`, `learner:<chat>`); no new identity is derived. Rows are deleted with the account. The report shows accounts as hashed labels.

## Deploy order (needs approval)

1. `prisma db push` on production (three new tables, additive).
2. Deploy the API. Accounting starts in shadow; `USAGE_ACCOUNTING=off` is the kill switch.
3. Nothing in the web app or extension changes.

## Gate before Phase 2 (enforcement)

All of these, from `scripts/usageShadowReport.ts` over at least **14 days of production traffic**:

1. Coverage: ledger cost ≥ 99% of usage-event cost, and no `step_without_task` or unattributed Nova cost beyond the deploy day.
2. No reservation stale more than one reconciliation after its expiry; refund reasons understood (no unexplained `work_failed_*` spikes).
3. Nova credits per account compared with old daily requests: no account the old meter allowed would have been refused except where the owner accepts it (a list of `nova_allowance_exhausted` shadow refusals reviewed).
4. Browser task cost P50/P95/max measured with real task ids, and the per-task budget / Pro count decision taken (Phase 0 preflight §5.3).
5. MCP: calls per account and read/write mix measured; accounts near 2,000 lifetime known.
6. Owner approval of the final allowance table (a new `ALLOWANCE_VERSION`), the error copy and the upgrade path.
