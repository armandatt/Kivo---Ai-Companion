# AI usage telemetry: implementation (roadmap Phase 1)

Status: **built and tested locally on `feature/ai-usage-telemetry`. Not merged, not deployed.** It adds one table, `AiUsageEvent`, which must be created in production and verified **before** this code is merged (§8).

This is measurement only:
- No limit, allowance, credit or deduction changed.
- `AiUsageDay` (the daily meter) counts exactly what it counted before, and integration tests check that.
- Nothing reads `AiUsageEvent` to allow or refuse anything.

---

## 1. Design

Every model call in Kivo goes through one function, `generateOpenAIText` (`packages/api/src/services/openai.service.ts`). The record is made there, so a call can't escape it. The client knows what happened; the entry points know who and why.

| Part | File | Job |
|---|---|---|
| Context | `services/llm-usage.ts` (`startInteraction`, `withUsageContext`, `annotateUsage`) | AsyncLocalStorage holding feature, surface, learner or account, interaction id, request or job id, background flag and allowance flag. `startInteraction` begins a new learner action or job with a fresh id. `withUsageContext` narrows it, for example a different feature for one call, and keeps the id. |
| Observation | `services/openai.service.ts` | Per call: the provider, the **model that answered** (`msg.model` / the Gemini attempt's model / OpenAI's `model`), the usage reported, attempts (Gemini), outcome, failure category and latency. One `emitLlmCall` per call, answered or not. |
| Normalisation | `services/llmProviders.ts` (`claudeUsageOf`, `geminiUsageOf`, `openaiUsageOf`, `llmFailureOf`) | One shape for every provider (below) |
| Pricing | `billing/pricing.ts` | Versioned price table, the long-context tier, cost states |
| Writer | `billing/usage-events.ts` | The only code that touches `AiUsageEvent`. Resolves who the call was for and writes one row. |

**Normalised usage.**
- **Counts:** `inputTokens` (uncached input), `outputTokens` (thinking included where it is billed as output), `cacheCreationInputTokens`, `cacheReadInputTokens`. Each is what the provider reported, or **null** when it reported nothing, never 0.
- **Claude extras:** the 5-minute / 1-hour cache-write split, plus `inference_geo`, `service_tier` and `speed` (they change the price list that applies).
- **Gemini and OpenAI** include cached tokens in their prompt count, so those are subtracted.
- **Aborted streams:** the counts the stream had seen are kept and marked `partial`. Claude reports input at `message_start` and output at each `message_delta`.

**Outcomes:** `success` · `failed` · `not_sent`. The last means the request never left: either over the 100K price tier (counted with the free `count_tokens`), or no key.

**Failure categories:** `rate_limited`, `overloaded` (529), `provider_error` (5xx), `request_error` (4xx), `auth`, `timeout`, `aborted`, `network`, `invalid_response` (cut off, or no text), `refusal`, `over_price_tier`, `config`, `unknown`.
- Claude errors are told apart by `instanceof` against the SDK's classes. They set no `name`, and a bundler may rename them.
- A reply that was billed but couldn't be used keeps its usage.

**Who a call was for** (`usageKeysFor`):
1. the meter key the entry point had (`user:<id>`);
2. else the learner, mapped to their account the way the meter maps them;
3. else their profile's learner;
4. else `system:<surface>`.

`attributedKey` is the learner (`platformChatId`) when known.

**Writing never touches the call.**
- `emitLlmCall` hands the event to the writer and does not wait.
- A failure to write is logged by kind only, at most once a minute, and dropped.
- `AI_USAGE_EVENTS_DISABLED=true` stops all writes.
- Prompts, replies, attachments and keys are never part of an event; a source test checks this.

## 2. Feature taxonomy

`USAGE_FEATURES` in `llm-usage.ts` is the only list. Every name used in code is checked against it by a test.

`nova_chat`, `nova_setup`, `build_with_nova`, `create_with_nova`, `subject_studio`, `today_copilot`, `notes_tutor`, `notes_editor`, `notes_assist`, `notes_proposal`, `notes_import`, `paper_import`, `telegram_understanding`, `telegram_reply`, `telegram_rewording`, `telegram_onboarding`, `telegram_first_use`, `extension_ask_nova`, `saved_page_processing`, `saved_page_retry`, `scheduled_nova_message`, `rex`, `other`.

Changes from the roadmap's starting list, from tracing the code:
- `knowledge_map` is **not** a feature: the map, its edits, delete and trash call no model.
- `telegram_understanding` and `telegram_first_use` are added. These are the reading call and the first message after linking.
- `nova_setup` is added (web setup sentences), plus `create_with_nova`, `notes_assist`, `notes_proposal` and `paper_import`.
- `other` is what a call made under no entry point records. It is visible, not hidden.

Surfaces: `web`, `telegram`, `extension`, `background`, `script`, `unknown`.

## 3. Every invocation path

Traced from the call graph, not route names. A source test (`usage-telemetry.test.ts`) fails if a module that calls the client appears and isn't in this list.

| Feature | Entry point (where attributed) | Model module | Surface | Background | Counts against allowance |
|---|---|---|---|---|---|
| `nova_chat` | `POST /api/nova/message` → `metered` | understanding-brain, response-brain (2 calls; older slash-command turn: disambiguation-pass) | web | no | yes |
| `nova_setup` | same route, setup not finished → `entry.ts` | understanding-brain (setup reading) | web | no | yes |
| `today_copilot` | `POST /api/nova/day/copilot` → `metered` | day-copilot | web | no | yes |
| `build_with_nova` | builder start, message and retry routes → `spendForTurn` + `startJob` (job after the response) | builder-conversation, workspace-generation (1–2 calls) | web | no (the learner is waiting) | yes; the job says whether the spend was counted |
| `create_with_nova` | `POST /api/nova/workspaces/propose` → `metered` | workspace-proposal / workspace-generation (1–2) | web | no | yes |
| `subject_studio` | `POST /api/nova/subjects/propose` → `metered` | study-proposal | web | no | yes |
| `notes_tutor` | `POST /api/nova/notes/[id]/tutor` → `metered` | note-tutor | web | no | yes |
| `notes_editor` | `POST /api/nova/notes/[id]/edit` → `metered` | note-edit | web | no | yes |
| `notes_assist` | `POST /api/nova/notes/[id]/assist` → `metered` (the page no longer calls it) | note-assist | web | no | yes |
| `notes_proposal` | `POST /api/nova/notes/propose` → `metered` | note-proposal | web | no | yes |
| `notes_import` | `POST /api/nova/notes/import` → `metered` | note-import (`transcribeForNote`) | web | no | yes |
| `paper_import` | `POST /api/nova/notes/papers` with `transcribe` → `metered` | note-import | web | no | yes. Without transcription there is no model call. |
| `extension_ask_nova` | `POST /api/nova/extension/ask` → `metered` | page-question | extension | no | yes |
| `telegram_understanding` | webhook → `telegram-turn.ts` (the reading) | understanding-brain | telegram | no | **yes**, when the account's meter took it |
| `telegram_onboarding` | same, setup not finished | understanding-brain (setup turn) | telegram | no | yes, as above |
| `telegram_reply` | same, the Response Brain's wording | response-brain | telegram | no | **no** (the chat's own budget) |
| `telegram_rewording` | same, a code-written reply in Hinglish | language-wording | telegram | no | no |
| `telegram_first_use` | `/start <token>` link → first message | first-use-wording | telegram | no | no |
| `saved_page_processing` | save route (first look), 5-minute sweep | resource-processing | background | **yes** | no |
| `saved_page_retry` | `POST /api/nova/learning-events/[id]/process` | resource-processing | web | no | no |
| `scheduled_nova_message` | scheduler → `nova-proactive-cron.ts` | nova-proactive-response | telegram | **yes** | no |
| `rex` | webhook (default for every update) and scheduler tick (default) | Rex engines and services (18 modules) | telegram / background | scheduler: yes | no (Rex's own limiter) |

**Unreachable:** `nova/onboarding/nova-onboarding-extractor.ts` and `-response.ts` call the client, but their orchestrator is imported by nothing.

**Not recorded, by design:** `count_tokens` (free, and not a generation).

## 4. Database

An additive model, `AiUsageEvent` (`packages/db/prisma/schema.prisma`):
- **Columns:** id, `subjectKey`, `attributedKey?`, `interactionId`, `requestId?`, `feature`, `surface`, `provider`, `model`, the four token counts (nullable), `attempts?`, `outcome`, `failureCategory?`, `latencyMs`, `isBackground`, `isAllowanceCounted`, `estimatedCostMicros?`, `costState`, `pricingVersion?`, `day` (UTC, as `AiUsageDay`), `createdAt`.
- **Indexes:** `(day, feature)`, `(subjectKey, day)`, `(interactionId)`, `(createdAt)`.

There are no foreign keys, so deleting an account leaves its usage rows. They hold ids, never content. `AiUsageDay` is unchanged.

**Volume:** one row per model call. At the measured rate (454 metered requests in 15 days, about 1.5 calls each), that is roughly 50 rows a day today.

## 5. Cost accounting

`billing/pricing.ts` is a versioned table: provider, model, effective date, source, standard and long-context rates for input, output, 5-minute and 1-hour cache writes and cache reads, plus verified region multipliers.

**The only entry is Claude Haiku 5.5**, as checked on Anthropic's pricing page on 2026-11-03:

| Per million tokens | Up to 100K-token prompts | Over 100K |
|---|---:|---:|
| Input | $0.10 | $0.50 |
| Output | $0.50 | $2.50 |
| 5-minute cache write | $0.125 | $0.625 |
| 1-hour cache write | $0.20 | $1.00 |
| Cache read | $0.01 | $0.05 |

Also verified: US-only inference costs 1.1×.

How cost is worked out:
- **Tier:** chosen per call on input + cache writes + cache reads.
- **Snapshots:** a dated snapshot of a listed model (`claude-haiku-5-5-2026…`) takes its price.
- **Unlisted models:** any other model is priced `unknown`, with no cost stored. That covers Sonnet or Opus through an override, Gemini and OpenAI. Their prices weren't verified, so none are invented.
- **Cost states:**

  | State | Meaning |
  |---|---|
  | `measured` | Reported usage × listed price |
  | `estimated` | Part of the price assumed: an unsplit cache write treated as 5-minute; a region, tier or speed with no listed price, at the base rate |
  | `incomplete` | Partial usage: a lower bound |
  | `unknown` | No price, or no usage at all |

- **`not_sent`:** costs 0, `measured`.
- **Credits:** not implemented. 1 credit = $0.0001 remains a proposal.

## 6. Test evidence (2026-11-03)

| Suite | Result |
|---|---|
| `services/__tests__/llm-usage-context.test.ts`: interactions, nesting, concurrency isolation, late attribution, sink failure, kill switch, meter unchanged | 7/7 |
| `services/__tests__/llm-usage-normalize.test.ts`: Claude, Gemini and OpenAI usage; nulls; failure classes | 7/7 |
| `billing/__tests__/pricing.test.ts`: rates, the 100K boundary (cache counted), lifetime split, snapshots, unknown models, partial, not sent, region and tier | 7/7 |
| `billing/__tests__/usage-telemetry.test.ts`: the model-calling modules are exactly the known 37; all 11 metered routes name a listed feature; every feature named in code is listed; the Telegram call sites; background flags; only the writer touches the table; no prompt or key in an event | 7/7 |
| `services/__integration__/llm-usage-client.itest.ts`: the real `generateOpenAIText` and **real Anthropic SDK**, network stood in (fake SSE) | **14/14**: success with the answering model; cache split; billed-but-unusable; refusal; 429 with null usage; 529 vs 500; a stream cut off at its deadline (`timeout`, partial 3000/15); over-tier never sent; no key; two calls in one interaction; Gemini retry (2 attempts, thinking counted as output); Gemini 400; OpenAI model and cached input; a failing recorder never fails the call |
| `billing/__integration__/usage-events.itest.ts` (real Postgres 16) | **5/5**: key resolution (account, linked chat, unlinked chat, profile, system); row contents with nulls kept and cost; a metered request (AiUsageDay still `requests: 1` and summed tokens; 2 events, one interaction, `isAllowanceCounted`); background work (no AiUsageDay row); a refused request records nothing |
| Full integration suite (`npm run test:integration`, real Postgres) | **551/551** |
| Jest: `src/nova`, `src/auth`, `src/billing`, `src/services` | 2,451 passed, 2 failed (pre-existing: `home-today.test.ts:147`, `knowledge-map.test.ts:153`), 1 suite not compiling (pre-existing Rex `bodyweight-service.test.ts`) |
| Type checks: `packages/api`, `apps/api`, `apps/web` | 0 errors |
| API production build | Compiled |
| One real Claude call (local key, test database) | `model: claude-haiku-5-5`, 18 in / 4 out, cache 0 / 0, `success`, 4 micros `measured`, latency 1,156 ms |

Four existing source tests were updated because the code text they check changed on purpose; each still holds the same rule. `builder.test.ts`, `telegram-hardening.test.ts`, `semantic-interaction.test.ts` and `templates-v2.test.ts`.

## 7. Missing telemetry and limits (known)

- **Caller-level unusable replies:** a reply the client returned but the caller couldn't use, such as JSON a feature couldn't parse, is recorded as `success`. The client can't see the caller's judgement.
- **Claude SDK retries:** they're internal, so `attempts` is null for Claude.
- **Not verified:** whether a failed attempt with no tokens is billed. It is recorded with null usage.
- **Not verified:** whether Anthropic bills tokens generated before an aborted stream. These are recorded as `incomplete`, a lower bound.
- **Thinking tokens** are taken as part of Claude's `output_tokens`, as Anthropic documents. That wasn't re-checked in this phase.
- **Gemini and OpenAI cost is `unknown`** until their prices are verified and added to the table.
- **Rex calls** from the scheduler are recorded as `system:background`, because the tick doesn't know the learner. From the webhook they are the chat's.
- **Process crash:** writing is fire-and-forget, so a crash between the answer and the insert loses that one event. `AiUsageDay` is unaffected.
- **Scripts:** a script run against a database records its calls as `other` / `unknown` unless it opens a context. Set `AI_USAGE_EVENTS_DISABLED=true` for scripts run against production.
- **Extra database load:** one insert per call. When the entry point gave only a learner, also one account lookup.

## 8. Deployment order (each step needs owner approval)

1. **Review and approve** this branch.
2. **Production schema, before anything is merged:** from `packages/db`, run `npx prisma db push`. It only adds the `AiUsageEvent` table and its four indexes. Then verify, read-only:
   - `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` shows an empty migration;
   - `SELECT to_regclass('public."AiUsageEvent"')` returns the table.
3. **Merge to `main`.** Vercel deploys the web app, which has no change in this phase.
4. **Deploy the API on Render by hand** (Render doesn't auto-deploy: `render.yaml` `autoDeploy: false`). `/api/health` `commit` should show the new commit.
5. **Verify, read-only:** after a few real AI actions, `SELECT feature, outcome, count(*), sum("inputTokens"), sum("outputTokens") FROM "AiUsageEvent" GROUP BY 1, 2`. For metered features, today's token sums should match `AiUsageDay`'s.

**Why the schema goes first:** if the API were deployed without the table, nothing would break for learners, because events would fail to write, logged once a minute. Applying the schema first keeps every event.

**Rollback:**
- Set `AI_USAGE_EVENTS_DISABLED=true` on Render, which restarts the service with writes off.
- Or revert the merge and redeploy.
- The table can stay; nothing reads it.
