# AI usage: next-phase implementation plan

Status: **plan, not started.** It builds on `AI_USAGE_AND_RATE_LIMITING.md` (the design) and `AI_USAGE_ANALYTICS_REPORT.md` (the measured baseline).

Ground rules for every phase:
- No phase changes the Free or Pro allowance, a price or a subscription until Phase 5, and Phase 5 needs explicit owner approval.
- Every schema change is additive and goes in with `prisma db push` **before the merge to `main`**: Render auto-deploys `main` (see the production readiness report, R1).
- One phase per branch.

| Phase | What it gives | Changes what learners can do? |
|---|---|---|
| 1 | Every model call recorded, background work included | No |
| 2 | A durable per-call ledger with reservations and idempotency | No: `requests` still gates |
| 3 | Exact cost and credits per call, computed in shadow | No |
| 4 | Learners and the owner can see usage | No (display only) |
| 5 | Evaluate cost-based limits, and switch only on approval | Yes, approval needed |

---

## Phase 1: complete telemetry

**Scope:**
- Record every model call with its feature, model, provider, tokens (`input`, `output`, `cache_creation_input_tokens`, `cache_read_input_tokens`), outcome and latency.
- Cover the calls no meter sees today:
  - saved-page processing;
  - proactive wording;
  - first-use wording;
  - Telegram response and language calls;
  - calls made while the meter is failing open.
- Nothing is counted against any allowance that isn't counted today.

**Files likely to change:**
- `packages/api/src/services/llm-usage.ts`: add `cacheWriteTokens`, `cacheReadTokens`, `feature` and `outcome` to `LlmUsage`. A `withFeature(name, work)` puts the feature in AsyncLocalStorage.
- `packages/api/src/services/openai.service.ts`:
  - read `msg.usage.cache_*`;
  - report `outcome: "error"` with partial usage where the SDK exposes it;
  - report a Gemini reply that can't be parsed.
- `packages/api/src/billing/usage.ts`: write one event per call. `recordTokens` makes the day row when it is missing.
- Feature tags at each entry point:
  - `apps/api/lib/billing/metered.ts` (a `feature` argument);
  - `apps/api/lib/nova/builder-access.ts`;
  - `apps/api/app/api/telegram/route.ts`;
  - `packages/api/src/nova/product/resource-processing.ts`;
  - `packages/api/src/nova/proactive/nova-proactive-cron.ts`;
  - the route files listed in the analytics report §2.
- Background work is metered under `system:<feature>` and attributed to the learner's key in a separate column, so it never touches their allowance.

**Database:** a new additive table `AiUsageEvent`:
- id, `subjectKey`, `attributedKey`, feature, provider, model, tier;
- the four token counts;
- outcome, `latencyMs`, `day`, `createdAt`;
- indexed on `(day, feature)` and `(subjectKey, day)`.

No change to `AiUsageDay` semantics.

**API:** no response changes. Optional: an internal `GET /api/admin/usage` behind an owner-only check, or no route at all, with SQL instead.

**Frontend:** none.

**Tests:**
- unit: every `LlmUsage` field reaches the listener; a feature is attached through nested calls; a background job is attributed and doesn't spend `requests`;
- integration: a web message writes 2 events, a builder proposal 2, a saved-page attempt 1, a failed Claude call 1 event with `outcome: "error"`;
- a source test that each route in the inventory names a feature.

**Rollback:** `AI_USAGE_EVENTS_DISABLED=true` stops the writes. The table stays and nothing reads it.

**Acceptance criteria:**
- For 7 days in production, the events' token totals per account and day equal `AiUsageDay`'s for metered work.
- Every model call in the inventory produces an event.
- The analytics report's feature split can be answered from SQL with no unexplained remainder.

## Phase 2: durable per-call usage ledger

**Scope:**
- Turn the event into a ledger entry with a lifecycle (`reserved → settled | released | failed`) and an idempotency key per learner action, so a double click, a network retry or a Telegram redelivery is recorded once.
- Reserve before the call and settle from the provider's usage after.
- `requests` still decides access.

**Files likely to change:**
- `packages/api/src/billing/usage.ts`: `reserve`, `settle`, `release`, each a conditional write in one transaction.
- `apps/api/lib/billing/metered.ts` and `builder-access.ts`: pass an idempotency key. Builder: the draft id and message id. Extension: `clientEventId`. Telegram: `update_id`. Tutor and copilot: a client key sent with each message.
- The web clients that send those keys: `components/nova/notes/nova-tutor.tsx`, `today/copilot-panel.tsx`.

**Database:**
- `AiUsageEvent` gains `idempotencyKey`, `status`, `reserved` and `settledAt`, with `@@unique([subjectKey, idempotencyKey])`.
- `AiUsageDay` gains `costMicros`, `cacheWriteTokens` and `cacheReadTokens` (additive).

**API:** additive. A request may carry `clientKey`; a repeat with the same key returns the first result's status.

**Frontend:** the tutor and copilot send a key per message, and the same key on Retry.

**Tests:**
- 50 concurrent reserves never exceed a limit;
- a retry with the same key reserves once;
- release on a provider error with no usage;
- a stream settles from `finalMessage().usage`;
- a refused builder claim releases its reservation. This is shadow only: whether `requests` is refunded is the R3 decision.

**Rollback:** `AI_LEDGER_DISABLED=true` falls back to Phase 1 events. Unique keys are additive.

**Acceptance criteria:**
- No duplicate events for a repeated key in production for 7 days.
- Reserved-but-unsettled rows older than 10 minutes: 0 (a sweep releases them).

## Phase 3: cost-based shadow accounting

**Scope:**
- Compute the exact provider cost and credits per call from a versioned price table (model, tier, effective date).
- Start in shadow: credits are computed and stored, never enforced.
- Add a daily spend summary and alerts.

**Files likely to change:**
- new `packages/api/src/billing/pricing.ts`: the verified Haiku 5.5 table from `AI_USAGE_ANALYTICS_REPORT.md` §6.2, keyed by model and effective date. The tier is decided per call on input, cache write and cache read together;
- new `packages/api/src/billing/credits.ts`: `credits = ceil(costMicros / 100)`, the 1 credit = $0.0001 proposal, still a proposal;
- `apps/api/lib/checkin-cron.ts`: a once-a-day job that writes a summary row and logs alerts.

**Database:** `AiUsageEvent.costMicros` and `credits`; `AiUsageDay.creditsShadow`. Optional: an `AiCostDay` summary (day, feature, plan, cost).

**API:** none user-facing.

**Frontend:** none.

**Tests:**
- price-table unit tests: 99,999 and 100,001 input tokens; cache tokens counted toward the threshold; ×5 on every category; an unknown model falls back loudly;
- credits rise with tokens;
- the daily summary equals the sum of events.

**Rollback:** the computation is pure, so remove the call. The columns stay.

**Acceptance criteria:**
- The daily cost in Kivo matches the Anthropic Console's usage export within 2% for 14 days. The owner downloads the export; no admin key is stored.
- Alerts fire in a test on: the meter failing open, daily spend over a set amount, and an account over 5× its plan's median.

## Phase 4: user usage dashboard

**Scope:**
- **For learners:** in Settings → Plan and usage, "Today: N of M requests · resets at <local time>", a small meter in Nova's panels near the limit, and messages that tell apart allowance used, provider failure and file too large.
- **For the owner:** an internal cost page by day, feature and plan.

Phase 4 shows today's request count; credits stay hidden until Phase 5.

**Files likely to change:**
- `apps/web/components/settings/*` (plan and usage);
- `components/nova/chat-ui.tsx` (meter chip);
- `GET /api/usage`, which exists: extend it with per-feature today and the reset time;
- an owner-only page behind a server-side check of the account, never a client flag.

**Database:** none (it reads Phase 1–3 tables).

**API:** `GET /api/usage` gains fields (additive).

**Frontend:** as above; typed input is never dropped on a refusal (the current behaviour).

**Tests:**
- web unit: formatting and the local reset time;
- browser check of the near-limit meter;
- access test: a non-owner gets 404 on the admin page.

**Rollback:** a flag hides the meter and the page.

**Acceptance criteria:**
- A learner can see how much is left and when it resets, from every Nova surface on the web.
- The owner's page matches the Phase 3 summary.

## Phase 5: evaluate and introduce cost-based limits

**Scope:**
- With at least 4 weeks of Phase 3 data, 50+ active accounts and some paid Pro accounts, compare the Free and Pro cost distributions with the current request caps.
- Propose credit allowances, plus a background budget per account.
- **Owner approval is required** before anything is enforced.

**Then:**
1. Dual gate for a week: refuse only when both the request count and the credits are over, and log which would have refused.
2. Switch to credits.
3. Keep `requests` for reporting.

**Files likely to change:**
- `packages/api/src/billing/limits.ts`: new `BILLING_FREE_DAILY_CREDITS` and `BILLING_PRO_DAILY_CREDITS` beside the existing variables;
- `usage.ts`: the gate reads credits when `BILLING_GATE=credits`;
- `entitlements.ts`.

**Database:** `AiUsageDay.creditsUsed` and `creditsReserved` (additive).

**API:** the 429 body keeps `error: "allowance_used"` and adds `credits` fields (additive), so older clients still work.

**Frontend:** the Phase 4 meter switches to credits, and pricing copy is updated only to what the plan really does.

**Tests:**
- a plan switch mid-day;
- the Telegram factor;
- a background budget exhausted stops background work, not the learner's own;
- the dual-gate logs.

**Rollback:** `BILLING_GATE=requests` brings back the request gate at once, with no deploy.

**Acceptance criteria:**
- In the dual-gate week, fewer than an agreed share of learners would be refused by credits who weren't by requests.
- No Pro account's AI cost exceeds the approved share of its price.
- The owner signs off on the numbers.

---

## Decisions needed from the owner

1. **R3:** when Kivo fails, does the learner keep the request? This covers a refused builder claim, a provider error, and the work failing before the model replies.
2. Whether Telegram's response and wording calls should count against the account's allowance. Today only the per-chat budget bounds them.
3. Whether background work (saved pages, proactive messages) should have a per-account daily budget, and how large.
4. At Phase 5, the credit allowances themselves.
