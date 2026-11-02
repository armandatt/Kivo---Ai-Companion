# AI usage analytics report

Date: 2026-11-03. Code is `main` at `ab2099a`. The production data was read on 2026-11-02 at 22:3x UTC, in a read-only session (method in §7).

**Reading this report:** *Measured* means read from production rows. *Derived* means arithmetic on measured values and verified prices. *Assumption* means a stated guess. No limit, allowance, credit or subscription was changed.

## 0. Summary

- **Scale:** usage records start on **2026-10-19**, the day billing shipped. So the 30, 60 and 90-day windows contain the same 15 days. In that time 19 accounts used AI, and the most on any one day was 6.
- **Measured volume:** 454 metered requests, 2,421,884 input tokens and 492,274 output tokens.
- **Derived cost** at Claude Haiku 5.5 standard-tier prices: **$0.49 in total**, which works out as:
  - **$0.026** per active account for the period (median **$0.007**, P95 **$0.119**);
  - **$0.0125** per active account-day;
  - **$0.00108** per metered request.
- **Not counted in that cost:** saved-page processing (40 attempts) and proactive messages (19 sent) are unmetered. Their cost is estimated at about $0.02 (§6).
- **No paying subscribers exist.** Two accounts had a Pro trial, and both trials have ended. Gross margin can't be measured, only estimated (§6.4).
- **Build with Nova accounts for about 57% of metered requests** (257 learner messages). Nothing else can be split by feature from the stored data.
- **The data is too thin to set limits from.** Three accounts make up 68% of the cost, and one of them is the owner's. The recommendation (§9) is: **stay request-based, add shadow cost tracking now, and decide on cost-based limits once real per-call data covers more learners.**

---

## 1. Existing usage architecture (read from the code)

| Layer | Code | Counts | Storage |
|---|---|---|---|
| Daily AI allowance | `packages/api/src/billing/usage.ts` (`spendAiRequest`, `withAiAllowance`, `meterTokensForLearner`), `apps/api/lib/billing/metered.ts`, `apps/api/lib/nova/builder-access.ts` | 1 per metered request, whatever it costs. Free 150/day, Pro 600/day (`billing/limits.ts`, `BILLING_FREE_DAILY_AI` / `BILLING_PRO_DAILY_AI`) | `AiUsageDay (subjectKey, day)`: `requests`, `inputTokens`, `outputTokens`. UTC day. |
| Token collection | `services/llm-usage.ts` (AsyncLocalStorage), `openai.service.ts` | `input_tokens` and `output_tokens` of each call made inside a meter | Added to the same `AiUsageDay` row |
| Telegram per-chat budget | `nova/telegram/channel-store.ts` `spendModelCall` | Understanding calls 150/day, response calls 40/day, × the plan's `telegramFactor` (Pro: 4) | `NovaTelegramChannel` (today's counters only) |
| Per-minute limiters | `allowAttempt` in `apps/api/lib/nova/extension-access.ts` | Requests per minute per route and learner | Process memory |
| Plan | `billing/entitlements.ts` | Current subscription or trial → `free` / `pro` | `BillingSubscription`, `BillingTrial` |

**Who the meter counts under.** It counts per account (`user:<id>`) across web, Telegram and the extension. A Telegram chat that no account has linked counts as `learner:<chatId>`. Production has no `learner:` rows.

**Order and atomicity:**
- The request is spent **before** the work. `spendAiRequest` upserts the day's row, then runs `UPDATE … SET requests = requests + 1 WHERE requests < limit`. Postgres re-checks the condition on the locked row, so concurrent requests cannot both take the last slot.
- Tokens are added afterwards, with `updateMany` increments.
- If the meter or the entitlement can't be read, the work runs anyway and is not counted. This fail-open path is logged only.

**Provider and model** (`services/llmProviders.ts`, `openai.service.ts`):
- Claude is used when `ANTHROPIC_API_KEY` is set, then Gemini, then OpenAI.
- On Claude, both tiers are **`claude-haiku-5-5`** at effort `low`, with adaptive thinking.
- `max_tokens` is the caller's cap plus 4,096 of thinking headroom.
- A prompt over **100,000 input tokens is never sent** (`CLAUDE_PROMPT_TOKENS_MAX`). Requests with files, or with text over 150,000 characters, are counted exactly with `count_tokens` first; any other text is estimated at 3 characters a token.
- **No `cache_control` is sent anywhere**, so cache creation and cache read tokens are zero by construction. Their fields are not read either.
- The SDK retries up to twice (`maxRetries: 2`) within the caller's deadline.

**Model per environment:**

| Environment | Selected model | Status |
|---|---|---|
| Local `apps/api/.env` | Claude Haiku 5.5 (`ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are both set, and Claude comes first) | Verified |
| Local `packages/api/.env` | Gemini (only `GEMINI_API_KEY` is set) | Verified. Scripts run from `packages/api` use this. |
| Production (Render) | Claude Haiku 5.5 if `ANTHROPIC_API_KEY` is set there | **Not verified.** Render values aren't visible, and the usage rows don't record a model. If Render ran Gemini for part of 19–26 October (Claude reached `main` on 26 October), those days' real cost differs from the Haiku estimate below. |

## 2. AI entry-point inventory

Columns:
- **Calls:** model calls per learner action.
- **Counted:** against the daily allowance.
- **Recorded:** tokens added to `AiUsageDay`.

| Feature | Surface | Route | Calls | Counted | Recorded |
|---|---|---|---|---|---|
| Nova chat, typed sentence | Web | `POST /api/nova/message` | 2 (Understanding, Response). A setup sentence takes 1. | Yes, 1 | Yes |
| Today copilot | Web | `POST /api/nova/day/copilot` | 1 | Yes, 1 | Yes |
| Build with Nova (start, message, retry) | Web | `/api/nova/builder`, `…/[id]/messages`, `…/[id]/retry` | 1 reading, plus 1 plan or change writer when proposing or revising. Runs after the response. | Yes, 1, **spent before the job is claimed** | Yes (the job runs inside `meterTokensForLearner`) |
| Create with Nova | Web | `POST /api/nova/workspaces/propose` | 1 intent, plus 0–1 plan | Yes, 1 | Yes |
| Subject Studio proposal | Web | `POST /api/nova/subjects/propose` | 1 | Yes, 1 | Yes |
| Knowledge Map | Web | `/api/nova/knowledge-map*` | **0.** The map, its edits, delete and trash call no model. | n/a | n/a |
| Notes tutor | Web | `POST /api/nova/notes/[id]/tutor` | 1 | Yes, 1 | Yes |
| Nova editor | Web | `POST /api/nova/notes/[id]/edit` | 1 | Yes, 1 | Yes |
| Note assist (the page no longer calls it) | Web | `POST /api/nova/notes/[id]/assist` | 1 | Yes, 1 | Yes |
| Draft a note with Nova | Web | `POST /api/nova/notes/propose` | 1 | Yes, 1 | Yes |
| PDF or image transcription | Web | `POST /api/nova/notes/import` | 1 (`count_tokens` first, which is free) | Yes, 1 | Yes |
| Paper import | Web | `POST /api/nova/notes/papers` | 0, or 1 when `transcribe: true` | Only with transcription | Yes |
| Telegram mentor, typed text | Telegram | `POST /api/telegram` → `handleNovaTelegramEvent` | 1 understanding, plus 0–1 response, plus 0–1 language wording | 1 per understanding call. **Response and wording calls are not counted**; only the per-chat budget bounds them. | Yes (the webhook wraps the turn in `meterTokensForLearner`) |
| Telegram button taps and commands | Telegram | same | 0 | n/a | n/a |
| First message after linking Telegram | Telegram | `/start <token>` | 1 (`first-use-wording`) | Per-chat budget only | **No** (outside the meter) |
| Browser extension Ask | Extension | `POST /api/nova/extension/ask` | 1 | Yes, 1 | Yes |
| Saved-page processing | Background (on save, the 5-minute sweep) and the Retry button | `learning-events` routes, `checkin-cron.ts` | 1 per attempt. The queue stops after 3 attempts; Retry had no cap until this pass (now 6/min). | **No** | **No** |
| Scheduled Nova messages | Background (5-minute scheduler) | `nova-proactive-cron.ts` → `wordProactiveMessage` | 1 per message sent (at most 2 a day per learner; 200 output tokens) | **No** (only the per-chat response budget) | **No** |
| Rex (legacy companion) | Telegram and scheduler | `runOrchestrator`, Rex services | Several | **No** (Rex's own rate limiter only) | **No.** Production shows no Rex conversation in 30 days. |

## 3. Findings

**AI requests that bypass the daily allowance:**
- saved-page processing, including Retry;
- proactive messages;
- first-use wording;
- Telegram response and language-wording calls (bounded per chat, 40/day × factor);
- Rex;
- any request made while the meter or entitlement can't be read (fail-open).

**Unmetered background jobs:** saved-page processing and Nova's proactive wording, both driven by the in-process scheduler. Rex check-ins and reminders are also unmetered.

**One action, several model calls** (counted as one request):

| Action | Calls |
|---|---|
| Web Nova message | 2 |
| Telegram text turn | 2–3 |
| Build with Nova message that proposes or revises | 2. Production: 118 of Nova's replies since 19 October were a proposal or revision. |
| Create with Nova | 2 |

**Provider retries:**
- The Claude SDK makes up to 3 attempts per call on 429, 5xx or connection errors. An attempt that fails before generating is not expected to be billed.
- **Not verified:** whether Anthropic bills tokens already generated when Kivo's deadline aborts a stream. Telegram allows 6 s for reading and 8 s for wording. If it does, those tokens are billed and never recorded, because `finalMessage()` never resolves.
- Gemini makes up to 3 attempts, and a reply it can't parse is not recorded.

**Token usage that is not recorded:**
- everything in the bypass list above;
- cache tokens (zero today, since caching is off, but the fields are ignored);
- aborted streams;
- tokens from a call whose day row is missing. `recordTokens` updates only an existing row, which matters on the fail-open path.

**Allowance spent without a successful provider call:**
- Build with Nova spends before `postMessage` claims the job, so `busy`, `stale`, `invalid`, `not_found` and closed drafts still cost a request.
- `metered()` spends before the work. Nothing is refunded when the work fails without a model reply: provider down, the price-tier refusal, a note that isn't found, invalid input checked inside the work.
- Production can't show how often either happens: failures aren't recorded per request.

**Concurrency in the accounting:**

| Path | Assessment |
|---|---|
| The allowance gate and the token increments | Atomic |
| Telegram budget counters | Two conditional writes, safe |
| Per-minute limits | In process memory: they reset on deploy and don't hold across instances |
| Retries of an HTTP request (double click, network retry) | No idempotency key, so each spends again |

## 4. Production analytics: A. consumption per account

All measured from `AiUsageDay`, 2026-10-19 to 2026-11-02.

| | Value |
|---|---|
| Accounts with AI use (unique keys) | 19, all `user:` (no unlinked learners) |
| Accounts / Nova learners in total | 23 / 18 |
| Active account-days | 39 (2.1 active days per account on average) |
| Daily active AI accounts | 1–6 (6 on 26 Oct and 2 Nov) |
| Requests per active account-day | mean 11.6, median 8, P75 15.5, P90 27, P95 34.8, P99 45.7, max 48 |
| Input tokens per active account-day | mean 62,100, median 26,965, P95 213,008 |
| Output tokens per active account-day | mean 12,622, median 7,390, P95 50,560 |
| Requests per account, whole period | median 9, P95 94 |
| Input tokens per account, whole period | median 32,775, P95 593,703 |
| Output tokens per account, whole period | median 8,797, P95 109,159 |
| Tokens per metered request | 5,335 in, 1,084 out |
| Days at or over 150 requests (the Free cap) | 0 |
| Days with requests but no tokens, or tokens but no requests | 0 and 0 |

Daily totals:

| UTC day | Accounts | Requests | Input | Output |
|---|---:|---:|---:|---:|
| 10-19 | 2 | 5 | 1,735 | 405 |
| 10-20 | 1 | 1 | 1,181 | 113 |
| 10-21 | 2 | 4 | 8,066 | 4,679 |
| 10-24 | 1 | 12 | 22,338 | 5,679 |
| 10-25 | 5 | 80 | 461,636 | 97,528 |
| 10-26 | 6 | 91 | 488,226 | 120,185 |
| 10-27 | 5 | 100 | 535,746 | 99,310 |
| 10-28 | 3 | 22 | 161,295 | 20,840 |
| 10-29 | 1 | 14 | 36,101 | 13,952 |
| 10-30 | 1 | 26 | 142,308 | 24,286 |
| 10-31 | 3 | 28 | 195,052 | 25,980 |
| 11-01 | 3 | 47 | 265,350 | 57,556 |
| 11-02 | 6 | 24 | 102,850 | 21,761 |

**Concentration:**
- The two largest accounts hold 53% of the cost. The owner's account is third, with 14%.
- Without the owner's account: 18 accounts, $0.42, median $0.0070, P95 $0.119.
- Some of the other heavy accounts may be testers or team members. That can't be told without naming accounts, and this report names none.

## 5. B. Consumption by plan

**What can be known:**
- Only the **current** subscription is stored, and production has **no subscription rows at all**.
- Trials record their own `startedAt` and `endsAt`, so days inside a trial are known. This is the only plan history available.

| Plan on that day | Account-days | Accounts | Requests | Cost (Haiku, derived) | Requests/day |
|---|---:|---:|---:|---:|---:|
| Pro trial (inside the trial dates) | 6 | 2 | 68 | $0.0631 | 11.3 |
| Free, after a trial ended | 3 | 1 | 5 | $0.0021 | 1.7 |
| Free, never had a trial | 30 | 17 | 381 | $0.4232 | 12.7 |
| Pro monthly, paid | 0 | 0 | | | |
| Pro yearly | none (not on sale) | | | | |
| Unlinked learner keys | 0 | 0 | | | |

## 6. C and D. Feature-level consumption and cost

### 6.1 By feature

**What is missing.** `AiUsageDay` has no feature, route, model or call column, so tokens can't be split by feature. These record counts are the only signal (measured, since 19 October unless stated):

| Feature | Evidence | Share of metered requests |
|---|---|---|
| Build with Nova | 257 learner messages in `NovaWorkspaceDraft.messages`, each spending one request. Nova's replies: 163 chat, 109 questions, 65 revisions, 53 proposals, 46 built. | **≈ 57%** (257 of 454). A lower bound, because starts and retries also spend. |
| Web Nova chat | 21 learner messages (`CompanionMessage`, Nova, web) | ≈ 5% |
| Telegram | 1 learner message since 19 Oct (24 in 30 days). 2 chats have a channel row. | ≈ 0–5% |
| Copilot, tutor, editor, extension Ask, imports, Subject Studio | Nothing stored per request (the conversations live in the browser) | The remaining ~38%, which can't be split |
| Saved-page processing (unmetered) | 40 model attempts in 30 days (all saved types); 22 for `resource_saved` overall | Not in the meter |
| Proactive messages (unmetered) | 16 sent since 19 Oct (19 in 30 days): 8 daily check-ins, 3 exam countdowns, 2 recovery, 2 task due, 1 nudge | Not in the meter |

### 6.2 Pricing used

Source: Anthropic's official pricing page (`platform.claude.com/docs/en/about-claude/pricing`), verified on 2026-11-03 for `claude-haiku-5-5`.

| Per million tokens | Prompt ≤ 100,000 tokens | Prompt > 100,000 tokens |
|---|---:|---:|
| Input | $0.10 | $0.50 |
| 5-minute cache write | $0.125 | $0.625 |
| 1-hour cache write | $0.20 | $1.00 |
| Cache read | $0.01 | $0.05 |
| Output (thinking is billed as output) | $0.50 | $2.50 |

How the tiers apply:
- The threshold is per request and counts all input tokens, cache reads and writes included.
- Above it, every category costs 5×.
- **Cache tokens:** caching isn't used, so cache cost is $0. That is a fact from the code, not an omission in the data.
- **Long-context tier:** Kivo refuses to send any prompt over 100,000 tokens, so every call should be standard tier. The data can't confirm this, because the rows are daily sums: the heaviest account-day was 346,260 input tokens over 48 requests, an average of 7,214 a request.

As an upper bound only, if every token had been billed at the long-context price, the total would be **$2.44**.

### 6.3 Cost (derived)

| Measure | Value |
|---|---:|
| Total, 19 Oct–2 Nov (input $0.2422 + output $0.2461) | **$0.4883** |
| Per active account for the period: mean / median / P95 / max | $0.0257 / $0.0071 / $0.1188 / $0.1229 |
| Per active account-day | $0.0125 |
| Per metered request | $0.00108 |
| Free accounts (never trialled): per account / per active day | $0.0249 / $0.0141 |
| Pro trial days: per active day | $0.0105 |
| Unmetered saved-page processing, 40 attempts (*assumption:* ~1,500 in and 200 out each) | ≈ $0.01 |
| Unmetered proactive messages, 19 (*assumption:* ~5,000 in and 150 out each) | ≈ $0.01 |

### 6.4 Gross margin (estimates)

- **Measured:** revenue $0 (no subscriptions), AI cost $0.49 plus about $0.02 unmetered. There is no margin to measure yet.
- **Illustrative Pro user** at $10/month, from the only measured Pro days: $0.0105 per active day × 30 active days ≈ **$0.32/month of AI**, about 97% gross margin before payment fees. The fees are not verified. **This rests on 6 account-days from 2 accounts and is not representative.**
- **Exposure at the cap**, at the measured $0.00108 a request:

  | Account at its cap every day | Cost per month |
  |---|---:|
  | Free, 150/day | ≈ $4.86 |
  | Pro, 600/day | ≈ $19.44, against $10 of revenue |

  Nobody has come close: the highest day was 48 requests. For comparison, the earlier proposal's worst case of $0.02 per request (a prompt near 100K tokens) would make those caps $90 and $360 a month.

## 7. Query methodology

How the queries were run:
- **Runner:** a small Node script with `pg`. The connection string came from `packages/db/.env` and was never printed.
- **Read-only, twice over:** the session was opened with `options=-c default_transaction_read_only=on -c statement_timeout=60000`, and every query also ran inside `BEGIN READ ONLY … ROLLBACK`. A deliberate `CREATE TEMP TABLE` was refused with `25006`, which proves the session was read-only.
- **No identities in the output:** results are aggregates only. No email address, id or message text was printed. The owner's account was identified inside SQL, by its address, only to exclude it from one query.

**For future runs**, create a read-only role (`CREATE ROLE kivo_readonly LOGIN …; GRANT SELECT ON ALL TABLES IN SCHEMA public TO kivo_readonly;`). This report didn't create one, because creating a role is a write. Then run the queries with `psql "$READONLY_URL" -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' -f queries.sql -c ROLLBACK`.

The core queries (windows of 30/60/90 days work unchanged; `day` is a `YYYY-MM-DD` string in UTC):

```sql
-- Distribution per active account-day
SELECT count(*) AS active_user_days, count(DISTINCT "subjectKey") AS keys,
       avg(requests), percentile_cont(ARRAY[0.5,0.75,0.9,0.95,0.99]) WITHIN GROUP (ORDER BY requests) AS req_pcts,
       percentile_cont(ARRAY[0.5,0.95]) WITHIN GROUP (ORDER BY "inputTokens")  AS in_pcts,
       percentile_cont(ARRAY[0.5,0.95]) WITHIN GROUP (ORDER BY "outputTokens") AS out_pcts
FROM "AiUsageDay"
WHERE day >= to_char((now() AT TIME ZONE 'UTC') - interval '30 days', 'YYYY-MM-DD') AND (requests > 0 OR "inputTokens" > 0);

-- Cost per account (Haiku 5.5, standard tier, no cache)
WITH k AS (SELECT "subjectKey", (sum("inputTokens") * 0.10 + sum("outputTokens") * 0.50) / 1e6 AS usd
           FROM "AiUsageDay" WHERE day >= to_char((now() AT TIME ZONE 'UTC') - interval '30 days', 'YYYY-MM-DD') GROUP BY 1)
SELECT count(*), sum(usd), avg(usd), percentile_cont(0.5) WITHIN GROUP (ORDER BY usd), percentile_cont(0.95) WITHIN GROUP (ORDER BY usd) FROM k;

-- Plan on the day, from trial dates (the only plan history stored)
SELECT CASE WHEN t."userId" IS NULL THEN 'no trial'
            WHEN u.day::date BETWEEN t."startedAt"::date AND t."endsAt"::date THEN 'during Pro trial'
            ELSE 'outside trial' END AS plan_that_day,
       count(*), sum(u.requests), (sum(u."inputTokens") * 0.10 + sum(u."outputTokens") * 0.50) / 1e6 AS usd
FROM "AiUsageDay" u LEFT JOIN "BillingTrial" t ON u."subjectKey" = 'user:' || t."userId" GROUP BY 1;

-- Build with Nova learner messages (one request each)
SELECT count(*) FROM "NovaWorkspaceDraft" d, jsonb_array_elements(d.messages::jsonb) m
WHERE m->>'role' = 'user' AND (m->>'at')::timestamptz >= now() - interval '30 days';

-- Unmetered work: saved-page attempts and proactive messages sent
SELECT sum("processingAttempts") FROM "NovaLearningEvent" WHERE "createdAt" >= now() - interval '30 days';
SELECT "eventType", count(*) FROM "NovaProactiveMessage" WHERE "sentAt" >= now() - interval '30 days' GROUP BY 1;
```

Once `BillingSubscription` has rows, join it on `'user:' || "userId"` using `currentPeriodStart` and `currentPeriodEnd` to label paid days. It has no history before its current period.

## 8. Missing telemetry

| Missing | Effect | Where to fix |
|---|---|---|
| Per-call record (time, feature, model, provider, tokens) | Cost can't be split by feature, P95 per call is unknown, and the tier can't be confirmed per request | Phase 1 ledger (`AI_USAGE_NEXT_PHASE_PLAN.md`) |
| Model and provider | The cost estimate assumes Haiku for every day | `LlmUsage.model` is already reported; store it |
| Cache creation and read tokens | Zero today; wrong as soon as caching starts | Read `msg.usage.cache_*` in `generateWithClaude` |
| Background usage (saved pages, proactive, first use) | Real cost recorded against nobody | Meter it under a system key with a feature name |
| Failures (refused, provider error, aborted, unreadable reply) | Can't say how often allowance is spent for nothing (R3) | An outcome field on the per-call record |
| Plan per day | Paid and Free can't be told apart historically | Store the plan on each usage row |
| Telegram response calls in the account meter | Not counted against the allowance | Record them; counting is an owner decision |

## 9. Recommendations

1. **Stay request-based for now.** Measured cost is about $0.001 a request and $0.013 per active account-day. No account came near the Free cap, so the current allowances aren't a cost problem at this scale. Changing them now would be a decision without data.
2. **Add shadow cost tracking first** (Phases 1 and 3). Record every call with its feature, model, tokens (cache included), outcome and exact cost, background work included. Credits are computed in shadow and decide nothing.
3. **Decide on cost-based limits later**, once the data covers roughly 4+ weeks of per-call records, 50+ active accounts and some paying Pro accounts. Then compare the Free and Pro distributions against the caps. The proposal of 1 credit = $0.0001 is workable: the measured mean request is about 11 credits.
4. **Fix the ways a learner pays for Kivo's own failures** (R3) before any limit gets tighter. This needs the owner's decision.
5. **Cheapest wins once measured:** prompt caching of the stable system prompts, and a per-feature budget on background work. Neither changes what learners get.
