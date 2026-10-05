# Nova Consolidation Architecture

This document describes how Nova turns what happens in a conversation into durable state. It implements SKILL.md §11.7 ("Evidence is not memory"), §9 (Reality Layer) and §16.4 (state ownership). Code lives in `packages/api/src/nova/consolidation/`.

## The rule

A conversation turn, a regex signal, an LLM classification, an engine output: each of these is **evidence**. None of them is a fact about the user, a reality constraint, a behavioral pattern, or companion state.

```
message → understanding → evidence → decision → response        (synchronous)

evidence → consolidation → durable state                         (after the reply)
```

Every durable state **derived from conversational evidence** goes through consolidation. This is not "every database write goes through consolidation": state that a domain owns and operates transactionally is written directly by its owner (see "Direct-write ownership rules").

## Final evidence boundary

Three rules decide who may read a message and who may act on it.

1. **Protocol is deterministic.** A slash command (`/study`, `/done`) is an instruction. `commands.ts` parses it with one regex for the command grammar, and it may establish a signal directly.
2. **Meaning belongs to the Understanding Brain.** Intent, emotion, disclosed circumstances (`reality`), and whether the student is starting or pausing a session (`sessionIntent`) all come from its one call.
3. **The signal engine proposes; the Understanding Brain disposes.** The signal engine's regexes produce candidates. `establishedSignals()` drops every candidate the Understanding Brain's classification does not corroborate, before any consumer runs. The decision graph, the session engine, academic-state scores, pattern history and consolidation evidence see established signals only.

A signal is established when it came from a command, from the Understanding Brain's own output, or from a regex match the Understanding Brain independently agrees with (`engines/signal-corroboration.ts`).

**One message, several signals.** The Understanding Brain reports a dominant `intent` plus up to two `secondaryIntents`, alongside `emotion`, `topic`, `reality` (up to three) and `sessionIntent`, all in its one call. The dominant intent drives the reply. Every stated intent that is a behavioral event (studied, skipped, committed, claimed mastery, made an excuse) is established as a signal by that reading alone; no regex has to match the wording. So "I finished chapter 3 but I'm exhausted" keeps both the study report and the emotion. The assembly lives in one pure function, `engines/turn-signals.ts`.

What one message still cannot carry: a second topic (one `topic` per message), and focus quality reported after the fact ("I couldn't focus"), which is measured by an interactive session rather than inferred from a sentence.

## Pieces

| Piece | File | Nature |
|---|---|---|
| Command grammar | `commands.ts` | Deterministic protocol |
| Signal corroboration | `engines/signal-corroboration.ts` | Pure |
| Evidence contract | `types/consolidation.types.ts` | Types |
| Evidence builder | `consolidation/evidence-builder.ts` | Pure |
| Consolidator | `consolidation/consolidator.ts` | Pure: no DB, no LLM, clock is an input |
| Policies | `consolidation/policies/*.ts` | Pure numbers and formulas |
| Runner | `consolidation/run-consolidation.ts` | Loads state, calls the consolidator, applies decisions in one transaction |
| Stores | `consolidation/stores/*.ts` | One per table. Persistence only, no rules |
| Shared reality vocabulary | `src/types/reality.types.ts` | Used by Rex and Nova |

Each decision is `CREATE`, `UPDATE`, `IGNORE`, `RESOLVE` or `EXPIRE`, with a machine-readable `reason` and the provenance of the evidence behind it. Each run logs its decisions as one JSON line (`layer: "nova:consolidation"`).

Policy, decision structure and persistence are separate on purpose. Changing how much evidence activates a pattern is an edit to `pattern-policy.ts`; it needs no schema or store change.

## 1. Canonical Reality vocabulary

`UserReality` is shared by all companions and has one category vocabulary, defined once in `packages/api/src/types/reality.types.ts`. Rex's reality service and Nova both import it; neither defines its own.

| Category | Covers |
|---|---|
| `health` | illness, sleep, a chronic condition |
| `injury` | physical injury |
| `emotional` | grief, burnout, sustained stress or anxiety |
| `life_constraint` | travel, work, family, schedule, money |
| `academic_constraint` | exam week, deadline cluster, heavy course load |
| `training_context` | gym domain. Rex writes it; Nova reads it and never writes it |

Detail lives in `subtype`, a closed list per category: for example `life_constraint` has `travel | work | family | schedule | financial | other`. The list is closed so that `(category, subtype)` can serve as the identity of a constraint.

**Both companions write the same shape.** Rex's two write paths now set `subtype` (the parser path writes `health/illness` and `injury/injury`; the extractor path uses the category default) and `provenance` in the shared format. Rex's categories, facts, confidences, TTLs and dedup are unchanged.

**Old rows are normalized on read, never rewritten.** `normalizeStoredReality` is the single read boundary:

| Stored | Read as |
|---|---|
| `health`, no subtype (old Rex row) | `health` / `illness` |
| other canonical category, no subtype | that category / its default subtype |
| `health_constraint` (old Nova name) | `health` / `other` |
| `time_constraint` | `life_constraint` / `schedule` |
| `work_constraint` | `life_constraint` / `work` |
| `other` or anything unknown | `life_constraint` / `other` |

So a Nova illness claim lands on an existing Rex `health` row, old or new, and reinforces it. It does not create a second record.

## 2. Reality lifecycle

Status is derived from existing columns; no status column was added.

| Status | Meaning |
|---|---|
| ACTIVE | `isActive` and `expiresAt` in the future |
| RESOLVED | `resolvedAt` set: the student said it ended |
| EXPIRED | not active, never resolved: the TTL elapsed |

Rules, all in the consolidator:

- **Explicit resolution wins over expiry.** A resolution applies to any record still flagged active, including one already past its TTL. The expiry sweep runs last and skips what was resolved.
- **Repetition reinforces.** The same condition mentioned again restarts its clock and never shortens a horizon already granted.
- **Contradiction is not silent.** A different description for the same identity replaces the old one only if it is not weaker by more than 0.1; the old description is kept in `provenance.history`. A weaker one is ignored.
- **Expired is not active.** Every run flags records past `expiresAt` as inactive. A new mention after expiry is a new episode and creates a new record.
- **Ambiguity resolves nothing.** A resolution that could mean two active records resolves neither.

TTL is evidence-aware (`policies/reality-policy.ts`), not one hardcoded number:

- **Temporary:** the student's stated duration if there is one, bounded per category (health 4–72h, injury 12–336h, emotional 12–120h, life_constraint 12–240h, academic_constraint 4–168h); otherwise the category default.
- **Standing** (a job, a commute, a chronic condition): 180 days, renewed by every re-mention. A short category TTL never removes it.

## 3. Evidence → reality flow

```
user message
  → Understanding Brain (one call; also reports disclosed circumstances)
  → understanding-parser.ts (shape validation only)
  → evidence-builder.ts (reality_claim / reality_resolution evidence)
  → consolidator.ts (CREATE / UPDATE / IGNORE / RESOLVE / EXPIRE)
  → reality-store.ts → UserReality
```

The Understanding Brain is the only thing that reads what the message means. There is no regex over the message text anywhere on this path, and no separate extractor call. The model reports; it never decides that a row is created.

Reality evidence carries: category, subtype, claim, confidence, persistence (`temporary` or `standing`), expected duration if the student gave one, active or resolved, source, timestamp and source message id.

A claim on a message the model itself classed as `disclosureClass: none` is inconsistent output; its confidence is multiplied by 0.8. The write threshold is 0.65.

Onboarding feeds the same path: its extracted constraints become `standing` claims.

## 4. Behavioral pattern lifecycle

A pattern has a **strength** (`confidence`, 0–1) and a **status** that follows from it.

| Status | When |
|---|---|
| `emerging` | strength below 0.55, never established |
| `active` | strength at or above 0.55 |
| `weakening` | was active; strength has dropped, or no supporting observation for 7 days |
| `resolved` | was established; strength below 0.2, or unobserved for 14 days |
| `expired` | never established and faded |

A resolved pattern that is detected again starts over from that observation.

## 5. Evidence → pattern flow

```
CompanionMessage (intent, emotion, metadata.signals of past user turns)
  + stored patterns (loadPriorPatterns)
  + study sessions and topic mastery
  → pattern detector (pure)
  → pattern_detection evidence
  → consolidator + pattern-policy.ts
  → behavioral-pattern-store.ts → BehavioralPattern
```

The detector receives real history: the last 30 Nova user turns from the conversation log plus the current turn, and the patterns already on record. Nothing is fabricated.

The policy (`policies/pattern-policy.ts`) is strength-based, not a fixed count:

- **Supporting evidence** raises strength by noisy-OR: `1 − (1 − strength)(1 − 0.6 × detection confidence)`. One detection at 0.95 reaches active on its own; two at 0.5 do not.
- **Temporal separation:** detections within 12 hours of the last one are one observation.
- **Contradicting evidence:** a corroborated study report or consistency signal, on a turn where the detector did not find the pattern, multiplies strength by 0.75.
- **Time:** quiet for 7 days weakens; 14 days resolves.
- **History is required at the source.** The detector does not report `ghosting` unless a completed session is on record: stopping presupposes having started. A new student with no sessions produces no ghosting evidence, so there is nothing downstream to suppress.

Each row keeps its latest supporting observations and its last 10 sources, each with the id of the message it came from.

`I didn't study today` produces a skipped-session record and nothing else. It cannot become a pattern, and no pattern type describes character.

## 6. Session and domain ownership rule

Two questions are kept apart: who decides that something happened, and who owns the record of it.

- **Deciding** that a session starts or pauses is either protocol (`/study`) or meaning (the Understanding Brain's `sessionIntent: "start" | "break"`). No regex decides it.
- **Owning** the session record is the academic domain. Once a start is established, the session's start, pause, resume, end and execution report are transactional state written directly by `nova-persistence.ts`. They do not go through the consolidator.

Academic-state scores follow the same split. The signals that move them are human meaning, so only established signals carry deltas. The calculation from those signals to scores is the Academic State Engine's own deterministic work, and its score snapshot is written directly.

Self-reported study with no session behind it ("I finished chapter 3") is different: it is an inference from a message, so it goes through consolidation.

## 7. Idempotency and failure handling

**Turn-level job.** Each Nova turn's consolidation is one row in `NovaConsolidationJob`, keyed by the user message id:

```
pending ──claim──▶ processing ──commit──▶ completed
                       │
                       └─ error or crash ─▶ failed, or a lease that runs out
                                            (both claimable again)
```

- **One job per turn.** The primary key is the message id. A second enqueue for the same turn fails, so a replayed turn is not consolidated again.
- **Atomic claim.** A claim is a single conditional `UPDATE`. It succeeds for a pending or failed job, or a processing job whose 5-minute lease has run out. Two workers cannot hold the same job.
- **All or nothing.** Every state write for the turn and the job's `completed` mark commit in one database transaction. If anything fails, everything rolls back: there is no half-consolidated turn.
- **Retry.** A failed attempt records the error and stays retryable. `retryPendingConsolidations()` runs from the existing 5-minute cron and picks up failed jobs, jobs abandoned mid-attempt, and jobs enqueued but never started.
- **Bounded.** After 5 attempts a job stays `failed` and visible. It is not retried again and not deleted.
- **Evidence is not kept.** The job's payload holds the turn's evidence only until the job completes, then it is emptied. Completed jobs are deleted after 30 days.

**Row-level provenance.** Each consolidated row records the message ids it has absorbed. The consolidator ignores evidence from a message the row already absorbed, including the same evidence twice in one batch.

**No provenance, no state.** If the user message fails to save, nothing from that turn is consolidated.

One step sits outside the transaction: a conversational mastery observation is applied through the Knowledge Engine after commit. It is a soft nudge and is applied once per completed job; if it fails it is logged and not retried.

## Telegram dedup

`services/telegramTransport.service.ts`, called first in `POST /api/telegram`, for every persona:

- **Secret token.** The `X-Telegram-Bot-Api-Secret-Token` header must equal `TELEGRAM_WEBHOOK_SECRET` (constant-time comparison). Mismatch returns 401. If the variable is unset the check is skipped with a warning, so an existing webhook keeps working until it is re-registered with a secret.
- **`update_id` dedup.** The id is inserted into `ProcessedTelegramUpdate`, whose primary key is the dedup. A repeat fails the insert, the handler returns 200 so Telegram stops retrying, and no pipeline runs.
- **Retention.** Rows older than 7 days are deleted on each cron tick. Telegram retries for about a day and `update_id`s only increase, so an id that old cannot return. Rows inside the window are never touched, so cleanup cannot weaken dedup.
- **Failure mode.** If the insert fails for any other reason, the message is processed and the error is logged. Dedup must not take the bot down.

This applies to Rex as well: a replayed update no longer runs Rex's pipeline twice.

## 8. State ownership: every durable write

Classification: **evidence** (the record of what happened), **derived** (inferred from conversation), **domain** (owned and operated transactionally by a domain), **infrastructure** (bookkeeping).

| Write | Owner | Source | Classification | Direct / consolidated | Justification |
|---|---|---|---|---|---|
| `CompanionMessage` | conversation-adapter | the turn itself | Evidence | Direct | The log is the evidence; it is not derived from anything |
| `UserFact` | user-fact-store | established signals | Derived | Consolidated | A claim about the user |
| `UserReality` | reality-store | Understanding Brain; onboarding extraction | Derived | Consolidated | A claim about the user's circumstances |
| `BehavioralPattern` | behavioral-pattern-store | pattern detector over history | Derived | Consolidated | An inference from repeated evidence |
| `NovaCognitiveState` investigation fields | cognitive-state-store | Response Brain output | Derived | Consolidated | LLM output about the user |
| `NovaStudySession` self-reported / skipped | academic-observation-store | established `study_report` / `study_skip` | Derived | Consolidated | Inferred from a message, no session behind it |
| `NovaTopicMastery` conversational observation | academic-observation-store → Knowledge Engine | established `study_report` + topic | Derived | Consolidated (decision), applied after commit | Inferred from a message; the table belongs to the Knowledge Engine |
| `NovaStudySession` start / pause / resume / end | nova-persistence | command or Understanding Brain `sessionIntent`; Session Engine action | Domain | Direct | The student is operating a session |
| `NovaLearningDNA` | nova-persistence | session execution report | Domain | Direct | Computed from a completed session's metrics |
| `NovaCognitiveState.stateHistory` | nova-persistence | Academic State Engine | Domain | Direct | The engine's own score series, fed by established signals only |
| `NovaTopicMastery` FSRS update | Knowledge / Topic Mastery Engine | session execution report | Domain | Direct | The Knowledge Engine owns its table |
| `NovaAcademicProfile`, `NovaSubject`, `NovaExam` | nova-onboarding-persistence | onboarding extraction + validator | Domain | Direct | Onboarding owns the profile it is building |
| `NovaProactiveMessage` | nova-proactive-cron | cron decision | Infrastructure | Direct | A log of what Nova sent, used for cooldowns |
| `NovaConsolidationJob` | consolidation-job-store | the runner | Infrastructure | Direct | The retry record |
| `ProcessedTelegramUpdate` | telegramTransport.service | the webhook | Infrastructure | Direct | Transport dedup |

There are no other writes in `packages/api/src/nova`. `consolidation-boundary.test.ts` enforces this: it fails if `UserFact`, `UserReality` or `BehavioralPattern` is written outside its store, if a store is called from anywhere but the runner, if an upstream module imports persistence, if a regex appears in an unexpected file, if the orchestrator uses signals before filtering them, or if Nova references `MemoryFact`.

One row deserves a note. Onboarding profile, subjects and exams come from an LLM extraction and are written directly. Onboarding is a guided, validated intake of exactly that data, so it is treated as domain-owned; its reality claims go through consolidation.

## 9. Integration-test strategy

Three levels:

- **Rules:** `consolidator.test.ts` and `understanding-reality.test.ts` run the pure path with fixtures, including the Understanding Brain's JSON for illness, injury, travel, exams, work, grief, schedule and resolution, and messages that must create nothing.
- **Wiring:** `conversation-storage.test.ts` runs the adapters, stores and runner against an in-memory stand-in for Prisma.
- **Real database:** `src/nova/__integration__/nova-persist-turn.itest.ts` runs `persistTurn` against real Postgres and reads the rows back: conversation, fact, reality, a pattern built from real history across days, resolution, the job lifecycle, a failed job retried from Postgres and applied exactly once, rate limiting, and the `update_id` unique key.

The real-database test runs with `tsx` and `node:test`, not Jest, because the Prisma client is ESM and Jest here runs CommonJS with the client mocked. It follows the repo's existing practice of `tsx` scripts with a disposable user.

```
# from packages/db: push the schema to the disposable database
cd packages/db
DATABASE_URL=$NOVA_TEST_DATABASE_URL DIRECT_URL=$NOVA_TEST_DATABASE_URL npx prisma db push

# from packages/api: run the test
cd ../api
NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
```

It refuses to run without `NOVA_TEST_DATABASE_URL`, and refuses a URL on the same host as `packages/db/.env`. **It has not been run yet:** the development machine had no local Postgres and no running Docker daemon, and the only reachable database was production.

The two LLM calls are not covered by any automated test. `scripts/novaRealityProbe.mts` runs the real Understanding Brain on sample messages (disclosures, negatives, session starts and breaks) for a manual check: `OPENAI_API_KEY=... npx tsx scripts/novaRealityProbe.mts`. It has not been run: the keys in the local env files are rejected by OpenAI.

## Credential requirements

No credential may appear in source. All are read from the environment.

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | apps, scripts | Postgres connection (pooled) |
| `DIRECT_URL` | Prisma CLI | Postgres direct connection |
| `OPENAI_API_KEY` | api | Model calls |
| `TELEGRAM_BOT_TOKEN` | api | Telegram Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | api | Must equal the `secret_token` given to `setWebhook` |
| `JWT_SECRET` | api, web | Session signing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | Google sign-in |
| `NOVA_TEST_DATABASE_URL` | integration test only | A disposable Postgres. Never the app database |

The audit scripts `scripts/beta-audit.mjs` and `scripts/dump-msgs.mjs` read `DATABASE_URL` and are run with `node --env-file=packages/db/.env scripts/<name>.mjs`.

## Schema and deployment

All changes are additive. Nothing was dropped, altered in place, or migrated.

| Change | Keys and indexes | Nullability and defaults |
|---|---|---|
| `UserFact` (new) | unique `(userId, type, key)`; index `(userId, status)`; FK to `MessengerUser`, cascade | `status` defaults `active`; `sourceMessageId`, `provenance` nullable |
| `BehavioralPattern` (new) | unique `(userId, companion, patternType)`; index `(userId, status)`; FK cascade | `status` defaults `emerging`; `evidence`, `resolvedAt` nullable |
| `NovaConsolidationJob` (new) | primary key `messageId`; index `(status, updatedAt)`; FK to `CompanionMessage`, cascade | `status` defaults `pending`; `attempts` defaults 0; `payload`, `claimedAt`, `completedAt`, `lastError` nullable |
| `ProcessedTelegramUpdate` (new) | primary key `updateId` (bigint); index `(receivedAt)` | none nullable |
| `UserReality.subtype`, `.provenance` | none | both nullable, so existing rows and any old writer stay valid |

Deployment order:

1. **Rotate the database password first** if it has not been done (see Known limitations).
2. **Schema:** `cd packages/db && npx prisma db push` (from `packages/db`, where the Prisma config and `.env` are). Additive, so the running old code is unaffected.
3. **Application:** deploy `apps/api`, then `apps/web`. The new code needs the new tables on every Nova turn. Rex's reality writes need the two new `UserReality` columns.
4. **Environment:** set `TELEGRAM_WEBHOOK_SECRET` on Railway.
5. **Webhook:** re-register it with the same value: `setWebhook?url=https://<railway-domain>/api/telegram&secret_token=<value>`. Until both are done the secret check is skipped with a warning.
6. **Verify:** run the integration test against a disposable database, and the live probe with a valid key.

The order matters in one direction only: schema before code. Code before schema breaks Nova turns and Rex reality writes; the webhook dedup alone degrades safely if its table is missing.

Rollback: redeploy the previous build. The new tables and nullable columns can stay; old code ignores them. Rows written by the new code remain valid for old code, except that old Nova code does not read `UserFact` or `BehavioralPattern`, so facts and patterns learned in between would not be used. Nothing needs to be dropped to roll back.

## 10. Known limitations

- **The database password in git history must be rotated.** It was hardcoded in two scripts, pushed to `origin/main` in two commits, and is the password currently in use. It has been removed from the working tree; removing it from the tree does not un-expose it.
- **The real-database test has not been run** and **the Understanding Brain prompt has not been run against the real model.** See section 9. Session start, breaks and reality all depend on that prompt.
- **One topic per message.** A message that is clearer on one topic and confused on another carries only one of them.
- **Legacy `MemoryFact` rows** written by Nova are left in place and never read.
- **Rex's reality logic is otherwise unchanged.** It still caps a user at 8 active records and deactivates the oldest, which for a user who switched companion can include a Nova standing constraint. It still resolves health and injury records by regex.
- **Jobs out of attempts** stay `failed` and need a person to look at them; nothing alerts on them.
- **Mastery observation** is applied after the transaction and is not retried on failure.
- **Pattern detector cadence.** It runs every turn; SKILL.md §8.7 says every 10 messages. The observation window makes this harmless.
- **Ghosting window.** The detector sees 90 days of sessions. A student whose last completed session is older than that reads as having none.
