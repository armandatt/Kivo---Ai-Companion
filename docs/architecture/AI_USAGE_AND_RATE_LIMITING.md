# AI usage, rate limiting and token economics

Status: **proposal, for review.** Nothing in this document has changed any limit, deduction or entitlement. The audit is of `main` at `32ae05f` plus the branch `feature/production-readiness`. Production data was not read for this document; every usage figure below marked *assumption* must be replaced by real numbers before any limit is set.

Update 2026-11-03: production was read (read-only) in `AI_USAGE_ANALYTICS_REPORT.md`. Its measured averages replace §18–19's assumptions: 5,335 input and 1,084 output tokens per metered request ($0.00108), and $0.0125 per active account-day. The phased plan that supersedes the milestones below is `AI_USAGE_NEXT_PHASE_PLAN.md`.

---

## 1. Existing rate-limiting architecture

There are three independent layers today.

| Layer | Where | What it counts | Storage |
|---|---|---|---|
| Daily AI allowance (billing) | `packages/api/src/billing/usage.ts` `spendAiRequest`, wrapped by `withAiAllowance`; used through `apps/api/lib/billing/metered.ts` `metered()` and `apps/api/lib/nova/builder-access.ts` | **1 per metered request**, regardless of tokens | Postgres `AiUsageDay (subjectKey, day)` |
| Telegram per-chat caps | `packages/api/src/nova/telegram/channel-store.ts` | Understanding calls (150/day) and response calls (40/day) per chat, × the plan's `telegramFactor` | Postgres, per profile and day |
| Abuse limiters | `allowAttempt()` in `apps/api/lib/nova/extension-access.ts` (in-process sliding window per key) | Requests per minute per route (e.g. tutor 10/min, copilot, extension ask 8/min) | **Process memory** (single Render instance) |

Auth routes have their own limiters (`packages/api/src/auth/http.ts`, `throttle.ts`), not covered here.

## 2. Current request-count logic

`spendAiRequest` makes the day's row once (upsert), then runs one `UPDATE ... SET requests = requests + 1 WHERE requests < limit`. Postgres re-checks the condition on the locked row, so two concurrent requests cannot both pass the last slot. This part is sound and should be kept as the concurrency primitive.

After the work, `meterLlmUsage` (AsyncLocalStorage) collects every model call's reported usage inside the request and `recordTokens` adds input and output tokens to the same row. A fault in the meter never blocks the learner (fail-open, logged).

The day is the **UTC** day (`utcDay`), so a learner in India resets at 05:30 local time.

## 3. Existing Free and Pro allowances (verified in code)

`packages/api/src/billing/limits.ts`:

| Plan | Daily metered requests | Source | Telegram factor |
|---|---:|---|---:|
| Free | **150** | `BILLING_FREE_DAILY_AI`, default 150 | 1 |
| Pro | **600** | `BILLING_PRO_DAILY_AI`, default 600 | round(600/150) = 4 |

Pro costs **$10/month** (`billing/plans.ts`, `priceMinor: 1_000`, USD). The annual plan is disabled. The count is per account (`user:<id>`) across web, Telegram and the extension; a learner without a linked account counts as `learner:<platformChatId>` on Free.

## 4. Exact Anthropic model configuration (verified in code)

`packages/api/src/services/llmProviders.ts`, `openai.service.ts`:

- Provider: Anthropic when `ANTHROPIC_API_KEY` is set (else Gemini, else OpenAI).
- Model: **`claude-haiku-5-5`** for both tiers (`CLAUDE_DEFAULT_FAST`, `CLAUDE_DEFAULT_MAIN`); overridable by `ANTHROPIC_MODEL_FAST/MAIN`.
- Thinking: adaptive, **effort `low`** on both tiers (`ANTHROPIC_EFFORT_*` override).
- `max_tokens` = caller's `maxOutputTokens` (default 16,000) + 4,096 thinking headroom.
- One user message per call, system prompt as a plain string. **No `cache_control` anywhere**: prompt caching is not used.
- Calls go through `messages.stream(...).finalMessage()`; SDK retries `maxRetries: 2` within the caller's deadline.
- **Long-context guard already exists:** `CLAUDE_PROMPT_TOKENS_MAX = 100_000` (`ANTHROPIC_PROMPT_TOKENS_MAX`). Text is estimated at 3 characters per token; requests with files, or text over half the limit, are counted exactly with `countTokens` first. A request over the limit is **not sent** and fails with a plain error (nothing is truncated).

## 5. Verified Anthropic pricing for claude-haiku-5-5

Source: Anthropic's official pricing page, `https://platform.claude.com/docs/en/about-claude/pricing`, fetched 2026-11-03.

| Category (per million tokens) | Prompt ≤ 100,000 tokens | Prompt > 100,000 tokens |
|---|---:|---:|
| Base input | $0.10 | $0.50 |
| 5-minute cache write | $0.125 | $0.625 |
| 1-hour cache write | $0.20 | $1.00 |
| Cache hit / refresh | $0.01 | $0.05 |
| Output | $0.50 | $2.50 |
| Batch input / output | $0.05 / $0.25 | $0.25 / $1.25 |

Answers to the questions in the brief, from that page:

1. **Threshold:** 100,000 tokens of *prompt*.
2. **What counts:** "A request's prompt length counts all of its input tokens, including cache reads and cache writes" (tool definitions count as input too).
3. **Measure:** per request, on input only. Output length does not decide the tier.
4. **How usage is reported:** the Messages API `usage` object: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`. Kivo currently keeps only `input_tokens` and `output_tokens` (§6).
5. **What changes above it:** every category, output included, moves to the second column.
6. **Prompt caching:** does not avoid the tier. "A request over the threshold pays the higher prices even when part of its prompt is a cache hit."
7. **Multiplier:** exactly **5×** on every category (0.10→0.50, 0.125→0.625, 0.20→1.00, 0.01→0.05, 0.50→2.50). The owner's understanding was right.

Also on that page: US-only inference (`inference_geo`) adds 1.1× to every category, both tiers. Kivo does not set it. *Not verified here:* how thinking tokens are billed. Anthropic documents thinking as billed as output; treat that as true until checked on the extended-thinking page.

## 6. Current token collection mechanism and its gaps

`openai.service.ts generateWithClaude` calls `reportLlmUsage({ inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens })`. The listener adds both to `AiUsageDay`.

Gaps found:

| # | Gap | Effect |
|---|---|---|
| G1 | Cache tokens are not read | Harmless today (no caching), wrong as soon as caching is added. |
| G2 | No per-call record, only a daily sum | Usage can't be explained, reconciled or broken down by feature. |
| G3 | One "request" = one route call, whatever it costs | A 300-token question and a 3 MB PDF import cost the learner the same. |
| G4 | **Background AI is unmetered**: `product/resource-processing.ts` (looking at saved pages), `proactive/nova-proactive-response.ts` (scheduler messages) | Real cost with no record against anyone. |
| G5 | Multiple model calls per request are one count (a Telegram turn is understanding + response; the builder may call twice) | Undercounts cost by design. |
| G6 | Fail-open meter | Correct for the learner, but a long meter outage is unbounded spend. Needs an alert. |
| G7 | In-process per-minute limiters | Reset on deploy, and break with a second API instance. |
| G8 | UTC reset | Fine, but the UI must say the local time it resets. |

## 7. Current cost-accounting gaps, in money

A request count bounds how many calls are made, not what they cost. With the current caps, the worst a request can cost under the 100K guard is roughly 100,000 input + 20,000 output tokens = $0.010 + $0.010 = **$0.02**. So the allowance bounds a Free account at about 150 × $0.02 = **$3/day (~$90/month)** and a Pro account at 600 × $0.02 = **$12/day (~$360/month)** against $10 of revenue. Typical use is far below this (§18), but the exposure is set by the worst case, not the average.

## 8. Proposed token-aware usage model

**Recommendation: Option B, cost-based internal units ("credits").**

`credits = ceil(provider_cost_usd / 0.0001)`, so **1 credit = $0.0001 of provider cost.**

| | Option A: weighted tokens | Option B: cost units (recommended) |
|---|---|---|
| Model or price change | Every weight must be re-derived | Change the price table; credits stay meaning "cost" |
| Cache reads and writes | Needs four more weights | Priced exactly as billed |
| Long-context tier | Needs a second weight set | Falls out of the price table |
| Explainability | "1 credit ≈ 1,000 tokens" is easy until caching | "Credits measure the work Nova did"; breakdown shows tokens |
| Fairness | Good | Same, and exact |

At ≤100K prices, 1 credit is 1,000 input tokens, 200 output tokens, or 10,000 cache-read tokens.

## 9. Internal credit conversion methodology

Per model call, from the provider's own `usage` (never an estimate when it exists):

```
cost = input·p_in + cache_write_5m·p_w5 + cache_write_1h·p_w1 + cache_read·p_r + output·p_out
tier = (input + cache_write + cache_read) > 100,000 ? high : standard
credits(call) = ceil(cost / 0.0001)
credits(interaction) = Σ credits(call) for every call in the interaction (understanding + response, retries that returned usage, tool calls)
```

Price table: one constant module, keyed by model id and tier, with an `effectiveFrom` date, so a historical event keeps the price it was charged at.

Illustrative interactions (*assumed* token sizes, verified prices):

| Interaction | In / out tokens (assumed) | Cost | Credits |
|---|---|---:|---:|
| Extension Ask, text only | 2,500 / 400 | $0.00045 | 5 |
| Telegram or web chat turn (2 calls) | 7,000 / 700 | $0.00105 | 11 |
| Today copilot | 6,000 / 600 | $0.00090 | 9 |
| Note tutor | 12,000 / 1,200 | $0.00180 | 18 |
| Build with Nova turn | 10,000 / 1,500 | $0.00175 | 18 |
| Workspace plan generation | 20,000 / 6,000 | $0.00500 | 50 |
| PDF / paper import | 40,000 / 4,000 | $0.00600 | 60 |
| Same prompt at 150,000 in (over the tier) | 150,000 / 5,000 | $0.08750 | 875 |

The last row is why the guard matters: about 5× what the same work costs under 100K.

## 10. Prompt and context optimisation

What Kivo already does well (verified): the tutor sends a window of the note (`TUTOR_NOTE_WINDOW = 16,000` chars), not the whole 1M-character note; the editor and papers use `PAPER_NOTE_WINDOW`; history is bounded (`TUTOR_HISTORY_MAX = 8` turns of 1,500 chars; copilot `HISTORY_TURNS`); the map outline is capped (220 lines). Files are counted exactly before sending.

Proposed, in order of value:

1. **Cache the stable system prompts** (§12). The copilot and tutor system prompts are each a few thousand tokens and identical across every call.
2. **Measure before trimming:** per-feature p50/p95 input tokens from the ledger (§12) decide what to compress next; nothing is cut without that number.
3. **Older conversation:** keep the last N turns verbatim, and replace older ones with a one-line summary only once a conversation's prompt crosses a threshold (e.g. 30K tokens). Never silently.
4. **Knowledge Map context:** already outline-only; keep ids and names, not bodies.
5. **Large documents:** a file over ~60K tokens is transcribed or summarised once and the result kept with the note, so later questions send the summary and the relevant section, not the file.

Never: truncate a learner's input silently, or answer from half a document.

## 11. Long-context threshold avoidance

Keep the existing hard guard at 100,000 (it already counts files exactly), and change one thing: give a **near-limit path** instead of only a failure.

- At **≥ 80,000** estimated input tokens, the request is reshaped *before* sending: older history summarised, related notes dropped first, the note window shrunk. The reply says what was left out.
- Over 100,000 after reshaping: refused with a clear message, as today ("That's more than Nova reads at once: split the file, or ask about one part").
- Telemetry: count of requests between 80K and 100K, and refusals, per feature. If refusals matter, raise the limit deliberately, knowing the 5× cost.

## 12. Prompt caching strategy

- Put the stable system prompt in its own system block with `cache_control: { type: "ephemeral" }` (5-minute TTL). A cache write costs 1.25× input, a hit 0.1×. It pays off after the first reuse within 5 minutes, which a single active learner reaches easily (tutor and copilot are conversational).
- The learner-specific material goes after the cached block. It changes on every call, so it is not cached.
- Record `cache_creation_input_tokens` and `cache_read_input_tokens` (fixes G1) and charge them at their own prices.
- Do not use the 1-hour TTL until telemetry shows conversations with long gaps that still reuse the prompt.
- *To verify before building:* the minimum cacheable prompt length for Haiku 5.5. A system prompt shorter than that minimum is not cached, and costs nothing extra.

Expected saving on a cached 3,000-token system prompt reused 5 times: 3,000 × (1.25 + 4×0.1) = 4,950 token-equivalents instead of 15,000, about **two-thirds less on that part**.

## 13. Durable usage ledger

Stay on Postgres/Prisma. Kivo runs one API instance, and Postgres row locks already give atomic spending (§2). Redis adds nothing until request rates are far higher.

New, additive:

```prisma
model AiUsageEvent {
  id              String   @id @default(cuid())
  subjectKey      String              // same key as AiUsageDay
  idempotencyKey  String              // one per learner action (clientKey / clientEventId / turn id)
  feature         String              // "tutor" | "copilot" | "builder" | "telegram" | "extension_ask" | "import" | "resource_processing" | "proactive" | ...
  model           String
  tier            String              // "standard" | "long"
  inputTokens     Int @default(0)
  cacheWriteTokens Int @default(0)
  cacheReadTokens Int @default(0)
  outputTokens    Int @default(0)
  costMicros      Int @default(0)     // provider cost in 1e-6 USD
  credits         Int @default(0)
  reserved        Int @default(0)
  status          String              // "reserved" | "settled" | "released" | "failed"
  day             String              // UTC day, as AiUsageDay
  createdAt       DateTime @default(now())
  settledAt       DateTime?
  @@unique([subjectKey, idempotencyKey])
  @@index([subjectKey, day])
  @@index([day, feature])
}
```

And on `AiUsageDay`: `creditsUsed Int @default(0)`, `creditsReserved Int @default(0)`, `costMicros Int @default(0)`, plus cache token columns. `requests` stays during the transition (§21).

## 14. Atomic reservation and settlement

1. **Reserve** (before the model call): estimate = input estimate + the call's `max_tokens` priced as output, in credits. One `UPDATE AiUsageDay SET creditsReserved = creditsReserved + :est WHERE creditsUsed + creditsReserved + :est <= :limit`, plus an `AiUsageEvent` insert with the idempotency key, in one transaction. Zero rows means the allowance is used up, and the request is refused before any cost.
2. **Settle** (after): from the provider's `usage`, compute exact credits; move `est` out of reserved and `actual` into used; mark the event settled.
3. **Release** on failure with no usage (§16).

Because the estimate is an upper bound, a learner can't overspend, and settling only ever gives credits back.

## 15. Concurrency, idempotency, streaming

- **Concurrency:** the conditional UPDATE is the single gate for web tabs, Telegram and the extension alike (one `subjectKey`). Scheduler calls use the same path under their own feature name.
- **Idempotency:** the `(subjectKey, idempotencyKey)` unique key makes a retried submission (double click, network retry, Telegram redelivery) find its existing event and not reserve again. Keys exist already: builder `clientKey`, extension `clientEventId`, Telegram `update_id`; the tutor and copilot need one added per send.
- **Multiple API instances:** the ledger is safe as is. The per-minute `allowAttempt` limiters (G7) must move to Postgres (a small sliding-window table) or Redis before a second instance.
- **Streaming:** settle from `finalMessage().usage` (already awaited in `generateWithClaude`). A stream the learner abandons still runs to its deadline server-side and still settles. A dropped connection before `message_stop` with no usage is "failed" (§16). The words streamed don't decide the charge.

## 16. Failed requests and retries

| Case | Charge |
|---|---|
| Refused before sending (allowance, size, validation) | Nothing; reservation released |
| Provider error with no `usage` (5xx, timeout before any token) | Nothing; released. Counted toward an abuse counter |
| SDK-internal retry | Only the attempt that returned `usage` is settled |
| Reply returned, then Kivo's parsing fails ("didn't come back with anything usable") | **Charged**: the provider billed it. The learner sees "Nova couldn't use that answer; this used N credits". *Owner decision: charge, or absorb as Kivo's fault?* Recommended: **absorb** (release) for the first two per day, then charge |
| Stopped by the learner mid-stream | Charged for what the provider reports |
| Over-tier refusal | Nothing (never sent) |

## 17. User-facing usage dashboard

- **Default (Settings → Plan and usage, and a small meter in Nova panels near the limit):** "Today: 1,240 of 1,500 credits · resets at 5:30 am" (local time), and a progress bar.
- **Details (expandable):** by feature today and this month (Tutor, Today, Build, Telegram, Extension, Imports); per event optional: time, feature, credits, and tokens (in, cached, out) for those who want them.
- **Messages that distinguish the cases:** *quota* ("You've used today's credits; they reset at 5:30 am. Your message is kept.") vs *provider* ("Nova can't answer right now; this used nothing") vs *size* ("That's more than Nova reads at once…").
- **Never:** drop typed input (the composers already keep it on failure), or deduct without a line the learner can see.

## 18. Free vs Pro economics

All per-request costs use verified prices (§5) and the *assumed* token sizes of §9. Activity is *assumed*.

| Profile | Requests/active day | Avg cost/request | Active days/month | Cost/month |
|---|---:|---:|---:|---:|
| Light | 10 | $0.0012 | 8 | $0.10 |
| Average | 30 | $0.0012 | 15 | $0.54 |
| Heavy | 100 | $0.0015 | 25 | $3.75 |
| Power | 300 | $0.0018 | 28 | $15.12 |
| Context-heavy (imports, plans) | 60 | $0.0060 | 20 | $7.20 |
| Free at the cap, worst case | 150 | $0.0200 | 30 | $90.00 |
| Pro at the cap, worst case | 600 | $0.0200 | 30 | $360.00 |

*Assumed mix.* Free: 60% light, 30% average, 9% heavy, 1% power, about **$0.71 per Free user per month**. Pro: 20% average, 50% heavy, 20% power, 10% context-heavy, about **$5.73 per Pro user per month**.

Pro gross margin at $10: payment fees are *not verified* (Polar's published rate should be checked; assume ~5% + $0.40 ≈ $0.90). Net $9.10 − $5.73 = **$3.37, about 34%**, and negative for any Pro user above roughly 60 heavy-mix requests a day every day.

## 19. Cost simulations

*Assumption:* 90% Free, 10% Pro, mixes as above.

| Users | Free cost | Pro cost | Total AI cost/month | Pro revenue/month | Revenue − AI cost |
|---:|---:|---:|---:|---:|---:|
| 100 | $64 | $57 | **$121** | $100 | −$21 |
| 500 | $320 | $287 | **$606** | $500 | −$106 |
| 1,000 | $639 | $573 | **$1,212** | $1,000 | −$212 |

So at 10% conversion the Free tier is the cost centre. Each point of conversion is worth about $10 − $5.73 per converted user. **These numbers are assumptions until replaced with real ones.** The ledger isn't there yet, but `AiUsageDay` already holds real daily tokens. Run this read-only query on production:

```sql
SELECT left("subjectKey", 5) AS kind, count(*) AS user_days,
       avg("requests") AS req_per_day,
       avg("inputTokens")::int AS in_per_day, avg("outputTokens")::int AS out_per_day,
       (avg("inputTokens") * 0.10 + avg("outputTokens") * 0.50) / 1e6 AS usd_per_user_day
FROM "AiUsageDay" WHERE day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
GROUP BY 1;
```

## 20. Abuse prevention

- Credits bound **cost**, not calls (closes §7's exposure).
- A separate **burst limit** per account (already per-minute per route; move to Postgres for multi-instance).
- **Daily provider-error budget:** after N failed calls with no usage, slow down (protects against retry loops).
- **Background jobs budgeted:** resource processing and proactive messages get their own small daily credit budget per account (G4), and stop when it's spent, not when Kivo's bill grows.
- **Global circuit breaker:** if Kivo's provider spend for the day passes a set amount, new Free requests degrade (shorter context, no background jobs) and the owner is alerted.

## 21. Rollout and migration

1. **Shadow mode:** write `AiUsageEvent` with exact cost and credits for every call, including background ones, while `requests` still decides access. Two weeks of real data.
2. Set credit allowances from that data (§18 replaced with real numbers), owner-approved.
3. **Dual gate** for a week: refuse only when both the old count and the new credits are exceeded. Log which one would have refused.
4. Switch to credits only; keep `requests` as a column for reporting.
5. Show the dashboard (§17) before step 4, so no learner meets a credit limit they couldn't see.

## 22. Backward compatibility

- Additive tables and columns only; `prisma db push` on Neon before the API deploy.
- Existing env vars keep working: `BILLING_FREE_DAILY_AI` / `BILLING_PRO_DAILY_AI` stay authoritative until step 4. New `BILLING_FREE_DAILY_CREDITS` / `BILLING_PRO_DAILY_CREDITS` are added beside them.
- An older web app that doesn't know credits keeps working: refusals keep the same 429 and `allowance_used` shape.

## 23. Monitoring and alerting

- Daily: total cost, cost per active user, by feature and plan; share of requests in 80–100K; over-tier refusals.
- Alerts: meter failures (fail-open counts), daily spend over budget, any account over 5× the plan's median, background spend over budget.
- Reconciliation: Kivo's daily `costMicros` summed vs the Anthropic Console's usage export, flagged if they differ by more than 2%.

## 24. Risks and trade-offs

- **Estimates in reservation** can refuse a request that would have fit. Mitigation: reserve against `max_tokens` but settle actual; the near-limit message says "about".
- **Learners dislike visible meters.** Keep the default view to one line, and never show tokens unless asked.
- **Credit numbers will change** when prices change. Credits are cost-based, so the numbers stay consistent; the allowance is what gets revised.
- **Absorbing parse failures** (§16) is a cost Kivo chooses to carry; it's bounded per day.
- **Free-tier economics** are negative at 10% conversion under the assumptions. The decision is the owner's: lower the Free credit cap, accept it as acquisition cost, or limit background work on Free.

## 25. Recommended implementation sequence

See the milestone plan below. Order: telemetry first (nothing user-visible), then credits computed in shadow, then the ledger and reservation, then allowances (owner-approved numbers), then context optimisation, the dashboard, and monitoring.

---

# Implementation plan (not started; needs approval)

### Milestone 1: accurate token collection and provider cost telemetry
- **Files:** `services/llm-usage.ts` (add cache fields, feature, call id), `services/openai.service.ts` (read `cache_*` from `msg.usage`), `billing/usage.ts`; wrap `resource-processing.ts` and `nova-proactive-response.ts` in a meter.
- **DB:** `AiUsageEvent` (shadow), cache columns on `AiUsageDay`.
- **API:** none user-facing.
- **Tests:** unit for the price table and tier boundary (99,999 / 100,001, cache counted); integration for events written per call, including two calls in one interaction.
- **Migration:** additive db push. **Rollback:** stop writing events (env flag); the tables stay.

### Milestone 2: internal credit calculation
- **Files:** new `billing/pricing.ts` (verified table, effective dates), `billing/credits.ts`.
- **DB:** `credits`, `costMicros` on events (shadow only).
- **Tests:** property tests (credits monotonic in tokens, over-tier ×5).
- **Rollback:** pure functions; remove the call sites.

### Milestone 3: durable ledger and atomic settlement
- **Files:** `billing/usage.ts` (reserve, settle, release), `apps/api/lib/billing/metered.ts` (idempotency key per request), the tutor and copilot clients send a key per message.
- **DB:** `creditsUsed`, `creditsReserved` on `AiUsageDay`.
- **Tests:** concurrency (50 parallel reserves never exceed the limit), retry idempotency, release on failure, streaming settlement.
- **Rollback:** the dual gate (§21) means the old count still decides.

### Milestone 4: Free/Pro allowance integration
- **Files:** `billing/limits.ts` (credit allowances, owner-approved values), `entitlements.ts`.
- **API:** 429 body gains `credits` fields (additive).
- **Tests:** plan switch mid-day, Telegram factor, background budget.
- **Rollback:** env switch back to request counting.

### Milestone 5: context optimisation and long-context protection
- **Files:** `llmProviders.ts` (`cache_control` on the system block), per-feature prompt builders (copilot, tutor, builder), near-limit reshaping helper.
- **Tests:** prompt snapshots (stable prefix), the near-limit path, quality evals on a fixed set before and after.
- **Rollback:** a flag per feature.

### Milestone 6: user-facing usage dashboard
- **Files:** `apps/web/components/settings/*` (plan and usage), meter chip in Nova panels; `GET /api/usage` (exists, extend).
- **Tests:** web unit for formatting and reset time; browser check.
- **Rollback:** hide behind a flag.

### Milestone 7: monitoring, alerts and simulations
- **Files:** a daily job writing a cost summary (existing cron in `apps/api/lib/checkin-cron.ts`), alert hooks; a script that re-runs §19 from real data.
- **Rollback:** disable the job.
