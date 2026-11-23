# Rate limits and abuse protection (Phase 5)

How fast, and how much at once, any account, address or client may use Kivo, with switches for an incident. Code: `packages/api/src/rate-limits/`. Tests: `rate-limits/__tests__/rate-limits.test.ts` (rules, with a fixed clock) and `rate-limits/__integration__/rate-limits.itest.ts` (real Postgres).

**Rate limits are not allowances.** The monthly allowances (Nova credits, browser tasks, MCP calls, storage; `docs/USAGE_ACCOUNTING.md`) decide how much a plan may use in a period. Rate limits decide how fast and how many at once. Neither reads nor changes the other. A request a limit admits still goes through its allowance, and a limit refusal is decided before anything is reserved. A rate refusal is `429 rate_limited`, and a used-up allowance stays `429 allowance_used`.

## Architecture

```
browser ─▶ Vercel (apps/web middleware: signs the browser's address) ─▶ Render ─▶ apps/api/proxy.ts ─▶ route ─▶ rateGate / concurrencyGate ─▶ work
extension, MCP clients, Telegram ───────────────────────────────────────▶ Render ─┘
```

There are two layers and one engine.

1. **Baseline: `apps/api/proxy.ts` (Next 16 Proxy, Node runtime).** It covers every `/api` request.
   - `endpoints.ts` classifies the request: exempt, auth, oauth, read, write, ai, agent, mcp, upload, import, export, billing or webhook.
   - The request is checked against its category's `base.*` policy.
   - Who is counted:
     - a session cookie counts as the account;
     - a bearer credential counts as a hash of that credential;
     - anything else counts by a trusted client address.
   - The incident switches apply here.
2. **Feature limits in the routes that cost something** (`apps/api/lib/rate-limits.ts`):
   - `rateGate(policy, { learner })` resolves the learner to its **account** (billing's `user:<id>`), so the web, the extension, Telegram and every MCP client share one count.
   - `concurrencyGate` holds a slot while the work runs.
   - `metered()` applies `ai.account` to every metered AI request. Telegram applies it in `telegram-turn.ts`. MCP applies `mcp.account`, `mcp.items` and `mcp.write` per tool call (`lib/connect/mcp.ts`).
3. **Engine** (`engine.ts`):
   - `checkRate` counts one request, or `weight` units, against every window the caller has a subject for, in **one SQL statement**. Each key gets an atomic upsert into `RateLimitWindow`.
   - The decision uses a **sliding-window estimate**: this bucket plus the overlapping part of the previous one. That removes the double burst a fixed window allows at its edge.
   - `acquireSlot` takes a concurrency lease, described below.

Module layout:

| File | Does |
|---|---|
| `policies.ts` | the one table: every limit, its reason, whether it scales with the plan, outage behaviour |
| `identity.ts` | subjects; the trusted client address |
| `store.ts` | counters (`CounterStore`; Postgres, and memory for tests) |
| `leases.ts` | concurrency leases (`LeaseStore`) |
| `controls.ts` | modes and incident switches |
| `engine.ts` | decisions |
| `respond.ts` | the 429/503 shape and the MCP error |
| `endpoints.ts` | the route table |
| `observe.ts` | logs and bounded counters |
| `report.ts` + `scripts/rateLimitReport.ts` | the operator's report |
| `cleanup.ts` | rows removed with an account |

`billing/accounting/limiter.ts` (`hitLimit`, used by usage accounting's fair use) now counts through the same store. There is one writer of `RateLimitWindow`, and there are no per-process limiters left (`allowAttempt` is gone; a test fails if one comes back).

### Who is asking

| Subject | Used for |
|---|---|
| `user:<id>` | The account, from billing's usage key (cached a minute with the plan tier). The same on every surface. |
| `cred:<sha256>` | A bearer token in the baseline, before its route resolves the account. |
| `client:<id>` | An OAuth client or MCP grant. |
| `task:<id>` | A browser-agent task. |
| `ip:<hmac>` | A client address, keyed with JWT_SECRET and truncated. A raw address is never stored. IPv6 is kept to its /64. |
| `global:all` | Everyone: the emergency ceiling. |

**Which client address is believed:**
1. The web app's signed header comes first. Dashboard traffic reaches Render from Vercel's address, so `apps/web/middleware.ts` sends the browser's address (Vercel's own `x-forwarded-for`) with the proof the auth proxy already uses. Without a valid proof it is ignored.
2. Otherwise Cloudflare's `CF-Connecting-IP`. Render serves through Cloudflare: checked 24 Nov 2026, every response has `server: cloudflare` and `cf-ray`. Cloudflare overwrites a client's own value. `RATE_LIMITS_TRUSTED_IP_HEADER` renames it, and `none` turns it off.
3. Otherwise `ip:unknown`, one shared subject, so no header earns a fresh allowance.

`X-Forwarded-For` is never read: Render passes a client's own value through.

**Addresses count only where there is no account:** anonymous requests, sign-in and OAuth. A signed-in request is the account's alone, so students behind one campus or carrier address never share a limit.

### Concurrency leases

`RateLimitLease (key, holder, expiresAt)`: one row per running operation.

- **Admission is atomic.** A short transaction takes `pg_advisory_xact_lock` on the key, drops expired leases, counts the rest and inserts only below the limit. The race test has 20 requests for 3 slots, and exactly 3 win.
- **Retries reuse a slot.** The same holder retried renews its lease instead of taking another.
- **Release is idempotent.** It deletes by (key, holder).
- **Crash recovery.** A crashed holder's lease expires at `expiresAt` and is cleared on the next admission, or by the hourly purge.
- **No transaction stays open** while the work runs.

What holds a slot:

| Work | Policy | Holder | Released |
|---|---|---|---|
| AI requests | `ai.account` | the request | when it ends |
| Browser-agent tasks | `agent.tasks` | the task id | each step renews it; an idle task (5 min) frees it, and the task itself is never stopped |
| `.kivo` export | `portable.export` | the request | when it ends |
| `.kivo` import | `portable.import` | the request | when it ends |
| `.kivo` resume | `portable.import` | `job:<id>` | when it ends |
| MCP writes | `mcp.write` | the request | when it ends |

## Policies

Generated from `policies.ts`.
- **†** marks a window that was enforced before Phase 5 (most of them per process, in memory). It stays enforced in every mode, now per account in Postgres.
- **(×plan)**: Free ×1, Plus ×1.5, Pro ×2.

**Evidence** (`AiUsageEvent`, 30 days to 24 Nov 2026, 33 accounts):
- AI requests per account peaked at 14 a minute and 91 an hour, from browser-agent steps.
- Every other AI feature peaked at 1–6 a minute.
- All AI calls together peaked at 17 a minute.
- `RateLimitWindow` was empty, because accounting is in shadow mode.

The limits sit at 2× or more of the busiest real account.

| Policy | Category | Limits | At once | On outage | Rollout | Why |
|---|---|---|---|---|---|---|
| `base.read` | read | user 600/1 min; ip 300/1 min; global 30000/1 min | – | open | shadow → staged | Ten reads a second per account covers a dashboard opening several panels in several tabs; it only stops scripts. |
| `base.write` | write | user 240/1 min; ip 60/1 min; global 12000/1 min | – | open | shadow → staged | Autosave, drag and drop and ticks are frequent but small; four a second per account is far above a person. |
| `base.ai` | ai | user 60/1 min; global 1200/1 min | – | open | shadow → staged | A first line in front of the AI routes; the cost limits are the ai.* policies in the routes. |
| `base.agent` | agent | user 90/1 min; global 1200/1 min | – | open | shadow → staged | Agent steps peak at 14 a minute for one account; the step and task limits are agent.* in the routes. |
| `base.mcp` | mcp | user 300/1 min; ip 600/1 min; global 3000/1 min | – | open | shadow → staged | Per credential here; the account-wide MCP limit is mcp.account in the MCP route. |
| `base.upload` | upload | user 60/1 min; global 600/1 min | – | open | shadow → staged | Images and files: one at a time from a person, bursts from a paste of several. |
| `base.import` | import | user 30/1 min; global 300/1 min | – | open | shadow → staged | A .kivo preview and import are two requests; thirty a minute is far above a person. |
| `base.export` | export | user 20/1 min; global 300/1 min | – | open | shadow → staged | An export reads a whole map; twenty a minute is far above a person. |
| `base.auth` | auth | ip 60/10 min; global 1200/1 min | – | closed | shadow → staged | Sign-in, sign-up and resets from one address. The per-address limits that protect an account stay in auth/throttle.ts. |
| `base.oauth` | oauth | ip 120/1 min; global 1200/1 min | – | closed | shadow → staged | OAuth discovery, registration and tokens for Kivo Connect clients. |
| `base.billing` | billing | user 60/1 min; global 1200/1 min | – | open | shadow → staged | Plan pages and checkout creation; never the provider's webhook, which is exempt. |
| `base.webhook` | webhook | global 6000/1 min | – | open | shadow → staged | Telegram's servers, one address for every chat: only a global ceiling. Each chat's own limits are in the Telegram channel store. |
| `base.anonymous` | read | ip 120/1 min; global 6000/1 min | – | open | shadow → staged | Requests with no session or credential that are not sign-in: discovery documents, public pages' data. |
| `ai.account` | ai | user 30/1 min; user 300/1 h; global 600/1 min (×plan) | account 3, all 40, slot 3 min (×plan) | closed | shadow → staged | Busiest real account: 14 AI requests a minute, 91 an hour. Three at once covers a tutor answer, a copilot reply and a capture filing together. |
| `notes.tutor` | ai | user 10/1 min | – | closed | enforced (was before) | Each request is one model call (TUTOR_REQUESTS_PER_MINUTE). |
| `notes.edit` | ai | user 10/1 min | – | closed | enforced (was before) | Each request is one model call (EDIT_REQUESTS_PER_MINUTE). |
| `notes.assist` | ai | user 6/1 min | – | closed | enforced (was before) | Each request is one model call (NOTE_ASSISTS_PER_MINUTE). |
| `notes.propose` | ai | user 6/1 min | – | closed | enforced (was before) | Draft with Nova: one model call with up to three files. |
| `notes.import` | ai | user 4/1 min | – | closed | enforced (was before) | A PDF or image transcribed by the model. |
| `papers.import` | ai | user 6/1 min | – | closed | enforced (was before) | Fetches from the paper's source and may transcribe a PDF. |
| `papers.preview` | ai | user 12/1 min | – | closed | enforced (was before) | Each preview asks the source's API. |
| `notes.source-frame` | read | user 20/1 min | – | closed | enforced (was before) | Each check fetches another site's headers. |
| `subjects.propose` | ai | user 4/1 min | – | closed | enforced (was before) | A study proposal is one main-tier call. |
| `workspaces.propose` | ai | user 4/1 min | – | closed | enforced (was before) | Create with Nova: one main-tier call. |
| `day.copilot` | ai | user 10/1 min | – | closed | enforced (was before) | Today's Nova: one call per message. |
| `builder.turn` | ai | user 8/1 min | – | closed | enforced (was before) | Build with Nova: one call per turn (fairUse().novaJobsPerMinute). |
| `extension.ask` | ai | user 8/1 min | – | closed | enforced (was before) | Ask Nova on a page: one call per question. |
| `extension.intent` | ai | user 20/1 min | – | closed | enforced (was before) | A small-model reading of what the learner typed in the side panel. |
| `captures.place` | ai | user 40/1 min | – | closed | enforced (was before) | Filing a passage: at most one small-model call. |
| `resources.retry` | ai | user 6/1 min | – | closed | enforced (was before) | Re-reading a saved page with the model. |
| `agent.start` | agent | user 20/1 min | – | closed | enforced (was before) | Starting a task (the route's former per-process limit). |
| `agent.tasks` | agent | user 8/10 min; global 300/1 min (×plan) | account 2, all 25, slot 5 min (×plan) | closed | shadow → staged | Task starts, and tasks running at once. Every step renews the task's slot; a task idle for five minutes (finished, closed, or waiting on the learner) frees it. A running task is never stopped by these: its steps go on. |
| `agent.step` | agent | user 30/1 min | – | closed | enforced (was before) | Each step is one model call; the busiest real task took 14 a minute. |
| `agent.task-steps` | agent | task 40/45 min | – | closed | enforced (was before) | The steps one ticket allows, counted here when the task's own record cannot say. |
| `agent.workspace` | agent | user 30/1 min | – | closed | enforced (was before) | Workspace reads during a task. |
| `mcp.grant` | mcp | client 120/1 min | – | closed | enforced (was before) | Per connected assistant (the route's former per-process limit). |
| `mcp.account` | mcp | user 240/1 min; user 5000/1 d; global 3000/1 min | – | closed | shadow → staged | Every assistant an account connects shares this, so adding clients adds nothing. The day figure is fairUse().mcpCallsPerDay. |
| `mcp.items` | mcp | user 600/10 min; user 5000/1 d | – | closed | shadow → staged | A batch call counts each item it changes; the day figure is fairUse().mcpItemsPerDay. |
| `mcp.write` | mcp | – | account 4, all 60, slot 1 min | closed | shadow → staged | Writes running at once for one account, across all its assistants. |
| `oauth.register` | oauth | ip 10/1 h; global 30/1 min† | – | closed | † enforced, rest shadow | Dynamic client registration. Thirty a minute for everyone was the former limit; ten an hour from one address is new. |
| `oauth.token` | oauth | ip 120/1 min; client 60/1 min† | – | closed | † enforced, rest shadow | Token exchange and refresh, per client (former limit) and per address. |
| `extension.connect` | auth | ip 10/1 min†; global 300/1 min | – | closed | † enforced, rest shadow | Guessing pairing codes. Was keyed on the first X-Forwarded-For value, which anyone can write; now on a trusted address. |
| `notes.images` | upload | user 20/1 min | – | closed | enforced (was before) | Image uploads into notes, each checked and stored. |
| `upload.bytes` | upload | user 200/1 h (×plan) | – | closed | shadow → staged | Megabytes uploaded an hour (weighted by size). Storage allowances still decide what may be kept. |
| `notes.highlights` | write | user 60/1 min | – | open | enforced (was before) | Highlights on a PDF, saved one by one as they are made. |
| `captures` | write | user 30/1 min | – | open | enforced (was before) | Passages into Drafts, from the web or the extension (one count). |
| `extension.notes` | write | user 120/1 min | – | open | enforced (was before) | The extension's note list and appends. |
| `portable.export` | export | user 10/1 min†; global 120/1 min | account 1, all 4, slot 2 min | closed | † enforced, rest shadow | An export reads a whole subject tree and builds a ZIP in memory: one at a time per account. |
| `portable.import-preview` | import | user 20/1 min†; global 240/1 min | – | closed | † enforced, rest shadow | Each preview unpacks and checks an upload of up to 10 MB. |
| `portable.import` | import | user 6/1 min†; global 60/1 min | account 1, all 3, slot 15 min | closed | † enforced, rest shadow | An import writes through the map's writers in stages. One per account at once; a stopped one resumes under the same job. |
| `day.flow` | write | user 60/1 min | – | open | enforced (was before) | Changes to Today's flow: drags, ticks, times. |
| `workspaces.create` | write | user 10/1 min | – | open | enforced (was before) | A workspace made from a template writes many rows. |
| `builder.edit` | write | user 60/1 min | – | open | enforced (was before) | Edits to a Build with Nova plan before it is applied. |
| `builder.approve` | write | user 10/1 min | – | open | enforced (was before) | Applying a plan writes many rows. |
| `billing.checkout` | billing | user 10/1 h | – | open | shadow → staged | Each checkout is a call to the payment provider. Open on an outage: never stop someone paying. |
| `billing.portal` | billing | user 30/1 h | – | open | shadow → staged | Each portal link is a call to the payment provider. |

## Refusals

| Case | Status | Body |
|---|---|---|
| Over a limit | 429 + `Retry-After` | `{ ok:false, error:"rate_limited", scope: account\|address\|connection\|task\|service, temporary:true, retryAfterSeconds, message }` |
| Incident switch or read-only | 503 + `Retry-After` | `{ error:"temporarily_unavailable", reason:"paused", … }` |
| Limiter unreachable, closed policy | 503 + `Retry-After: 5` | `{ error:"temporarily_unavailable", reason:"limiter_unavailable", … }` |
| MCP, per connection (HTTP) | 429 or 503 | JSON-RPC `-32000`, with `data.retryAfterSeconds` |
| MCP, per tool | tool result `isError` | `{ ok:false, error:"rate_limited", retryAfterSeconds, message }`; the assistant reads it, and nothing was changed |
| OAuth | 429 or 503 | `{ error:"temporarily_unavailable", error_description }` |

How refusals behave:
- **No threshold or count is disclosed.**
- **The extension can read them:** refusals from the extension's routes carry its CORS headers.
- **Retry-After is exact.** It is when one more request would fit, counting how the busy window slides out. A test checks that a request made at that moment is admitted and one a second earlier is not.
- **Messages are written for people.** They say whether the refusal is temporary and that what the learner typed is still there. Pages already read `error: "rate_limited"`.

## Outages

| Policy failure mode | Limiter unreachable |
|---|---|
| `closed`: AI, agent, MCP, uploads, imports and exports, sign-in, OAuth | 503 when any of its limits is enforced |
| `open`: baseline reads and writes, billing, ordinary feature writes | admitted, logged as `fault` |

A limit only in shadow never refuses on an outage. Nothing in the engine touches billing, reservations or learner data, so an outage cannot corrupt them.

## Switches (environment, read at call time; a change on Render needs a restart)

| Variable | Values | Effect |
|---|---|---|
| `RATE_LIMITS_MODE` | `shadow` (default), `enforce`, `off` | `shadow`: every limit is counted, and new limits only log `would_refuse`. `enforce`: every limit refuses. `off`: only † limits run. |
| `RATE_LIMITS_ENFORCE` | `ai,agent.tasks,mcp` … | While in shadow, enforce just these categories or policy ids (staged rollout). |
| `RATE_LIMITS_OVERRIDES` | JSON | Retune without a deploy: `{"ai.account":{"user":[40,60000]},"agent.tasks":{"concurrency":{"user":3}}}` |
| `KIVO_DISABLE` | `ai,agent,import,mcp,upload,export,billing` or policy ids | 503 at once for those, everywhere (the baseline catches every route of the category). Never `auth`, the webhooks or health. |
| `KIVO_READ_ONLY` | `true` | Every change is refused with 503. Reads, sign-in, OAuth and webhooks still work. MCP answers read tools and refuses write tools. |
| `RATE_LIMITS_TRUSTED_IP_HEADER` | `cf-connecting-ip` (default), `none` | Which edge header carries the client address. |

## Observability

- **Logs.** One JSON line, `{"layer":"rate_limit","event":…}`, per event: `refused`, `would_refuse`, `fault`, `unavailable`, `disabled`, `saturated`, `would_saturate`, `expired`, and `unclassified_route`. At most one a minute per policy, dimension, subject and event; the rest are summed into `repeats`.
- **Never logged:** tokens, cookies, prompts, notes, files or raw addresses.
- **Counters.** They are aggregated in memory and flushed at most every 10 s as hourly rows (`rl.obs.<event>.<policy>.<dimension>:obs:hour`), kept 14 days. Their number is bounded however much traffic arrives.
- **Retention.** Counter windows are kept one day after they end. Expired leases are purged hourly by the scheduler's housekeeping, whatever `USAGE_ACCOUNTING` says.
- **Account deletion** removes the account's counters and leases (`deleteRateLimitRows`, called from `deleteAccountUsage`).
- **Report:**

  ```
  npx tsx --tsconfig tsconfig.json scripts/rateLimitReport.ts --hours 24   # add --json for machine output
  ```

  It shows events by policy, subjects at 80% or more of a limit, and slots held now.

## Production rollout

Order:
1. `prisma db push` (one new table).
2. API deploy (Render).
3. Web deploy (Vercel).

Each step is safe on its own. The web's signed-address header is ignored by an API that does not read it, and the API in shadow refuses nothing new.

| Step | Do | Check |
|---|---|---|
| 0 | Dry diff against production. It must be exactly `CREATE TABLE "RateLimitLease"` plus `RateLimitLease_expiresAt_idx`. | `cd packages/db && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` |
| 1 | `cd packages/db && npx prisma db push` | The same diff prints `-- This is an empty migration.` |
| 2 | Merge, then deploy the API on Render (manual deploy) with **no new env vars**: the mode is `shadow`. | `/api/health` 200. `curl -X POST -H 'content-type: application/json' -d '{}' .../api/nova/extension/connect` ×11 from one machine: 400 ten times, then 429 with `Retry-After` (a † limit, now by trusted address). Logs show `refused` lines only for † limits. |
| 3 | Vercel deploys the web app from `main` (the middleware signs the browser's address). | A signed-in dashboard works; the report shows `ip:` subjects only for anonymous traffic. |
| 4 | Shadow for **at least 3–7 days**. Run the report daily. | Every `would_refuse` for a real account means that limit is too tight: raise it with `RATE_LIMITS_OVERRIDES` before enforcing. |
| 5 | Staged enforcement: `RATE_LIMITS_ENFORCE=mcp,agent.tasks,oauth.register`, then add `ai`, then the `base.*` categories. | Report: `refused` only for the subjects you expect. |
| 6 | `RATE_LIMITS_MODE=enforce` | |

What changes for users at step 2:
- **Only † limits refuse.** These existed before, but they are now persistent and per account instead of per process and per browser connection. For example, Ask Nova's 8 a minute is now shared by all of an account's browsers.
- **They are now "closed" on a database outage.** Before, they could not fail.

**Rollback**, fastest first:
1. `RATE_LIMITS_MODE=off`: only † limits run. Or set `RATE_LIMITS_OVERRIDES` to loosen one policy.
2. Redeploy the previous Render commit.

The `RateLimitLease` table can stay: the old code never reads it. No data needs reverting. Counters expire in a day, and `DELETE FROM "RateLimitWindow" WHERE key LIKE 'rl.%'` clears them if ever wanted. The rows billing's own `hitLimit` writes don't start with `rl.`.

### Costs to know

- **Database load.** Each API request now makes one more round trip (the baseline upsert); AI, agent, MCP and file requests make one or two more.
- **Hot rows.** The global ceilings are a handful of hot rows. At Kivo's traffic that is negligible. Measure it on Neon after step 2.
- **Vercel middleware.** It now runs for `/api/*` requests on the web origin (one HMAC each, cached).

## When Kivo runs more than one API instance

Counters and leases already live in Postgres, so several instances share them correctly. Two things would move to Redis/Valkey, through `CounterStore`/`LeaseStore`, only when the database round trip per request becomes the cost:
- the per-request counters, which need atomic increments shared by every instance;
- the leases, which need atomic admission.

These stay per process and are only hints:
- the account cache (one minute);
- the observation buffer;
- log de-duplication.

## Known gaps

- **"One address affecting many accounts"** is not reported. Signed-in requests are deliberately not counted per address, so no association is stored.
- **Telegram:**
  - Its message rate (`checkRateLimit`, by messages in the conversation log) and its per-chat budgets stay as they were.
  - Only the account-wide `ai.account` was added there.
  - Telegram's webhook has only a global ceiling, since every chat comes from Telegram's own addresses.
- **Running-task ceilings:** Build with Nova jobs have a rate (`builder.turn`, `ai.account`) but no running-job ceiling of their own.
- **Read-only mode** refuses every POST in a write category, including harmless POSTs that only read (for example the export preview).
