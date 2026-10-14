# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root (`my-turborepo/`) unless noted.

```bash
# Development: all apps, or one
npm run dev
npx turbo dev --filter=web        # port 3000
npx turbo dev --filter=api        # port 3001

npm run build
npm run check-types               # use --force to bypass the turbo cache
npm run lint                      # only apps/web and packages/ui define a lint script
npm run format

# Tests (Jest, packages/api only; not wired into turbo)
npm test --workspace @repo/api
cd packages/api && npx jest --config jest.config.ts src/nova/__tests__/decision-graph.test.ts
cd packages/api && npx jest --config jest.config.ts -t "name of test"

# Prisma
npx prisma generate --schema packages/db/prisma/schema.prisma
(cd packages/db && npx prisma db push)   # must run from packages/db: its prisma.config.ts loads .env from the cwd

# Nova real-Postgres integration test (never point it at the app database)
cd packages/api && NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration

# One-off audit scripts
npx tsx --tsconfig tsconfig.json scripts/realityAudit.ts
```

- **Schema changes: always `prisma db push`, never `prisma migrate dev`.** The production database has drifted from `packages/db/prisma/migrations/`.
- Relative imports inside `packages/api/src/nova` are written without a `.js` suffix. Turbopack does not resolve `./x.js` to `x.ts`, and the API build fails if one is added.
- `apps/web/next.config.js` sets `typescript.ignoreBuildErrors: true`, so a passing `build` says nothing about types. `check-types` is the only type gate.
- Tests match `**/__tests__/**/*.test.ts`. `jest.config.ts` maps `@repo/db/client`, `../services/memory.service` and `../services/openai.service` to `packages/api/__mocks__/`, so tests never touch the database or OpenAI. The service mocks only apply to that exact relative specifier.
- Scripts in `scripts/` run against the real database from `DATABASE_URL`.

## Architecture

Turborepo monorepo (npm workspaces) for **Kivo**, an AI accountability companion delivered over Telegram, with a web app for onboarding and a dashboard.

- **`apps/api`**: Next.js used as an API-only server, deployed to Railway. Routes are under `app/api/`. `app/api/telegram/route.ts` is the core runtime loop.
- **`apps/web`**: Next.js marketing site, onboarding quiz and dashboard, deployed to Vercel.
- **`packages/api`** (`@repo/api`): all business logic, with no HTTP knowledge. Consumed through subpath exports (`@repo/api/services/*`, `@repo/api/engines/*`, `@repo/api/nova`, ...). A new top-level folder under `src/` needs an entry in the `exports` map of `packages/api/package.json`.
- **LLM calls** all go through one function, `generateOpenAIText` in `packages/api/src/services/openai.service.ts`. The name is historical: it calls Gemini or OpenAI depending on configuration (`services/llmProviders.ts`). Call sites pass OpenAI model names, which are treated as a tier (`*-mini` = fast, anything else = main), so never add a second client or call a provider directly.
- **`packages/db`** (`@repo/db/client`): Prisma client using `@prisma/adapter-pg`. Schema at `packages/db/prisma/schema.prisma`; `prisma.config.ts` prefers `DIRECT_URL` over `DATABASE_URL`.
- **`packages/ui`**: minimal shared React stubs.
- **`apps/extension`**: the Nova browser extension (Manifest V3, plain ES modules, no dependencies). `npm run build --workspace nova-extension` writes `dist/`; `npm test --workspace nova-extension` runs its tests. See its `README.md`.

### Web to API

`apps/web` owns only the auth POSTs (`/api/login`, `/api/signup`, `/api/signup/verify`, `/api/signup/resend`, `/api/forgot-password`, `/api/reset-password`, all through `app/api/auth-proxy.ts`, which also signs the session cookie on the web side) and a few local handlers. Every other `/api/*` call is proxied to `apps/api` by the `rewrites()` list in `apps/web/next.config.js` (target `API_URL`, default `http://localhost:3001`). **A new API route that the web app calls needs a rewrite entry there**, or it returns 404 from the web origin.

Auth is a JWT cookie named `kevo_session`, verified with `jose`. `apps/web/middleware.ts` guards the protected routes; `apps/api/lib/auth/session.ts` creates and verifies sessions. Email/password and Google OAuth are both supported.

### Authentication

The rules live in `packages/api/src/auth/` and are tested there: unit tests against an in-memory fake, and `__integration__/auth.itest.ts` against real Postgres (the only proof of the concurrency guarantees). The route files in `apps/api` are one line each: `lib/auth/auth-route.ts` calls `handleAuthRequest` (`auth/http.ts`) and sets the cookie. Each service takes its database, hasher and mailer as `AuthDeps`.

- **Every auth POST from the browser goes through `apps/web/app/api/auth-proxy.ts`**, as a local route handler, never a rewrite. The proxy refuses cross-site requests and tells the API which browser is asking. A new auth POST needs a handler there.
- **Cross-site requests are refused** (`request-origin.ts`, applied by the proxy and again by the API): `Content-Type` must be `application/json`, an `Origin` header must be the app's own, and `Sec-Fetch-Site` must not say another site. A request with no `Origin` is not from a browser page and is let through to the limits.
- **Email signup is two requests.** `POST /api/signup` stores a `PendingSignup` (password already hashed, the eight-digit code as an HMAC keyed with `JWT_SECRET`), emails the code and returns a random `signupToken`. `POST /api/signup/verify` needs the token and the code, and only then creates the `User` and grants the session. No `User` row exists before that. Manual signup accepts `@gmail.com` only; login, reset and Google do not have that restriction.
- **A signup belongs to the browser that started it.** Each start is its own row, reached only by its token (stored as SHA-256). A second start for the same address makes a second row and cannot change, resend or verify the first. Never go back to one row per address updated in place: that let a second caller put their password on someone else's signup.
- **Wrong codes are counted per attempt, across resends** (`PendingSignup.attempts`, never reset), and the count is taken with a guarded write before the code is compared. A resend without the attempt's token sends nothing and uses none of the address's sends.
- **Single use comes from guarded writes**, not from reading first: the code is consumed by a `deleteMany` on `(id, codeHash)`, a reset token by an `updateMany` on `used: false`.
- **Limits that protect an account are per address and in Postgres** (`throttle.ts`, table `AuthThrottle`, keys hashed): sign-in tries (10 per 15 minutes, taken before the password is checked, given back on success or a completed reset), signup emails (one a minute, 5 an hour, 10 a day) and reset requests (3 an hour). They are pauses that end by themselves, never locks.
- **Limits per caller are in memory and secondary** (`rate-limiter.ts`, `createCallerLimits`). The API believes a browser address only when the request carries the web proxy's proof (`proxyProof`, derived from `JWT_SECRET`). `X-Forwarded-For` is never read. Callers without the proof share one allowance per route.
- **Nothing says whether an address has an account.** Signup, resend and forgot-password give the same reply either way and tell the owner by email instead (including "this account signs in with Google"); an address with an account goes through the same steps as a new one. Login has one refusal and always compares a hash. Keep it that way when adding a branch.
- **Login is not gated on `emailVerified`.** Accounts created before verification existed have it null and still sign in.
- **Google** uses the authorization-code flow with `state` and a nonce in the `kevo_oauth` cookie. `lib/auth/google-oidc.ts` verifies the ID token with `jose` (signature, issuer, audience, expiry); `google-signin.service.ts` then decides the account. An account is recognised by Google's `sub` first. A matching email links only when Google is authoritative for the address (`email_verified` and either `@gmail.com` or an `hd` claim naming the address's own domain) and the Kivo account has no password or a verified email. Otherwise nothing is linked: `/signin?error=google_link` (reset the password first, which sets `emailVerified`) or `google_manual` (sign in with the password). Google's tokens are not stored.
- **Reset tokens are stored as SHA-256** in `PasswordResetToken.token`. The link carries the only copy.
- **`JWT_SECRET` has no default in production.** The session code (`apps/api/lib/auth/session.ts`, `apps/web/lib/auth/session-secret.ts`) and `serverSecret()` throw when it is missing; the development fallback applies only outside production.
- **Sessions cannot be revoked.** A password reset does not end sessions issued before it; they last until the 30-day JWT expires.
- Auth mail goes through `auth-email.ts` (Resend). Codes, tokens, passwords and recipient addresses are never logged, and an unexpected error is logged by name only.
- `RESEND_API_BASE` points mail at another host. It is for an end-to-end harness's local stand-in (like `TELEGRAM_API_BASE`), so a test reads the real code from the captured message. Never set it in a deployed environment.
- `scripts/e2e/fresh-user.mjs` signs up the real way: its stand-in on port 3999 serves as the email provider too (`servers.sh` sets `RESEND_API_BASE`), and the script reads the code from the captured message and verifies it with its `signupToken`. Its `sql` helper calls `docker exec nova-test-pg psql`.

### Telegram webhook: an ordered chain of gates

`POST /api/telegram` is a long sequence of early returns. Order is the behaviour, so read the surrounding gates before inserting one.

0. **Transport safety** (`services/telegramTransport.service.ts`): secret-token check, then `update_id` dedup in Postgres (`ProcessedTelegramUpdate`). A replayed update returns 200 and reaches no pipeline. Applies to every persona.
1. Profile update, then `/start <token>` handling (links a web account to a chat).
2. **Persona branch.** If `MessengerUser.persona === "nova"`, the update goes to `handleNovaTelegramEvent` (`packages/api/src/nova/telegram/telegram-turn.ts`) and nothing below runs. Button taps (`callback_query`) are routed to the same handler before step 1, because only Nova has buttons. Everything below is Rex. `/start <token>` linking for both companions is `nova/telegram/telegram-link.ts`.
3. **Intake / onboarding.** `needsIntake()` routes to onboarding V3 (`ONBOARDING_V3_ENABLED=true`), else V2 (`isV2Active()`), else the V1 `intake.service` for legacy users. Then the post-onboarding activation flow.
4. **Slash commands**: `/log`, `/pr`, `/progress`, `/history`, `/overload`, `/streak`, `/split` (`workoutTracking.service`), `/reminders`, `/cancel N`. `/log` is first checked against the Reality Layer for an active illness or injury.
5. **Parsing Engine V2** (`engines/parsing-engine-v2.ts`) does structured extraction, while the **Understanding Layer** (`engines/understanding-layer.ts`, an LLM call) runs concurrently for semantic intent.
6. Rate limit, then a per-chat in-memory processing lock (45 s TTL).
7. Deterministic handlers: reminders, active workout logging, gym short-circuit, health events, entity extraction, focus sessions, deadlines, check-in scheduling, progress and weekly review, acknowledgements, off-topic, nutrition logging.
8. **Semantic Router** (`engines/semantic-router.ts`) arbitrates between the parser and the Understanding Layer. A conflict on a state-changing action asks the user for clarification instead of executing.
9. **Default path**: `runOrchestrator` in `engines/mentor-orchestrator.ts`.

The lock, the closure-reply dedup and the daily-warning set are process-level `Map`s. They are correct only because Railway runs a single persistent instance.

### Rex: the mentor orchestrator

`runOrchestrator` dispatches to `runOrchestratorV3` when `MENTOR_V3_ENABLED=true`; otherwise it runs the legacy V1 pipeline in the same file. V3 with the V5 cognitive layer is the live system. It loads memory, mentor state and patterns, builds one large system prompt (`buildRexSystemPrompt`), calls OpenAI for a JSON reply, validates it and persists state.

**Rule for Rex: OpenAI is the understanding and coaching brain.** It classifies intent, emotion and goals and picks the coaching approach. Deterministic code only verifies, calculates, constrains and persists. Improve Rex by giving the prompt better evidence or instructions, not by adding regex or keyword classifiers or new decision engines.

`processor/messageProcessor.ts`, `services/decision.engine.ts` and the `intent`/`emotion` services are the legacy V1 NLP layer. Do not extend them.

### Nova: the study companion

`packages/api/src/nova/` is a separate pipeline with the opposite rule: **code decides, the LLM expresses.** It is governed by `../SKILL.md` ("Nova's Constitution", one level above this repo), which the code cites by section. If code and that document disagree, the code is wrong.

`nova-orchestrator.ts` is the single entry point: study snapshot → Understanding Brain (`gpt-4o-mini`, classification only) → deterministic engines (signal, academic state, knowledge, pattern, exam, planning) → Decision Graph (`decision/`, selects the intervention) → context builder → Response Brain (`gpt-4o`, wording only) → fire-and-forget persistence. Nova has its own onboarding (`nova/onboarding/`), proactive messaging (`nova/proactive/`) and `Nova*` tables. It reaches shared Rex services only through `nova/adapters/`.

**Evidence is not memory (SKILL.md §11.7).** Signals, classifications and LLM output are evidence. Only `nova/consolidation/` may turn evidence into durable state: `consolidator.ts` holds the rules (pure, no DB, no LLM), `run-consolidation.ts` applies them, and each table has one store under `consolidation/stores/`. Nova never touches `MemoryFact`; its conversation log is `CompanionMessage`, via `adapters/conversation-adapter.ts`. A turn's consolidation is a retryable job in Postgres (`NovaConsolidationJob`) applied in one transaction. Regex signals are candidates only: `establishedSignals()` drops any the Understanding Brain does not corroborate, and session start comes from `/study` or the Understanding Brain's `sessionIntent`, never from a regex. The reality vocabulary is shared with Rex in `src/types/reality.types.ts`. `consolidation-boundary.test.ts` fails if a write bypasses this. See `docs/NOVA_CONSOLIDATION_ARCHITECTURE.md`.

### Personality signal and mentor matching

`packages/api/src/personality/` is deterministic and never calls the LLM. Web onboarding ends with four statements (questions 7 to 10, verbatim public-domain IPIP items). They produce a **personality signal** (`kivo-signal-v1`), not a Big Five assessment: one item per dimension is not a validated scale, so never present it as a measured trait, to the user or to the model.

- `signal-items.ts` / `signal-scoring.ts`: the statements, validation, reverse-scoring, 0 to 100 scores, low/mid/high bands, and the behavioural lines that are the only form the signal takes in a prompt.
- `mentor-registry.ts`: matching metadata for the personas in `personna.service.ts` (assignable, domains, characteristics). The numbers are a product hypothesis. Only `rex`, `nova` and `zen` are assignable.
- `mentor-compatibility.ts`: `matchMentor`. Domain filtering decides eligibility and is a hard constraint, because a persona selects a whole pipeline; compatibility scoring only ranks eligible mentors. The accountability answer sets intensity outright and the signal may only nudge other dimensions. Each domain has one eligible mentor today (gym → rex, study → nova, general → zen), so the score is recorded but does not yet change the outcome.
- `personality.service.ts`: persistence. Raw answers and the derived signal live in `PersonalityAssessment` (one row per run); how the mentor was chosen lives in `UserProfile.mentorMatch`; the assignment stays in `UserProfile.primaryPersona`. A re-run (`POST /api/personality`) never changes the assigned mentor.

`UserProfile.mentorMatch.resolution` says how the assignment came about, and `match` is only ever stored when it names the mentor actually assigned:

| `resolution` | Meaning | `match` |
|---|---|---|
| `engine` | The user gave a domain and the engine chose | The engine's match |
| `domain_missing_default` | No domain was given, so the general default (`zen`) was assigned | The engine's match |
| `legacy_client_persona` | An older client sent no domain but named the persona itself, which is still honoured | `null` |
| `predates_matching` | The user was assigned before this feature; set the first time they re-run the statements | `null` |

`mentorMatch.reassessment` holds the newest re-run. Its `match` is `null` when the profile has no domain to match against. `mentorMatch` is internal: `POST /api/onboarding` strips it from the profile it returns.

`POST /api/onboarding` runs the engine server-side; the browser's `PostQuizSequence` calls the same function only for the reveal. The signal reaches prompts as at most three behavioural lines, in Rex's profile block (`buildRexSystemPrompt`) and Nova's dynamic layer (via `nova/adapters/operating-style-adapter.ts`), and only when `PERSONALITY_SIGNAL_ENABLED=true`. The lines say how to deliver coaching (structure, sequencing, reasoning, kind of question) and never how hard or gently to push: intensity is the user's explicit accountability choice.

**Deployment order.** Prisma reads every column of a model unless a query has its own `select`, so the new code fails on a database that lacks `UserProfile.mentorMatch` (onboarding, the Telegram `/start` link and settings updates all break).

1. Apply the schema to the target database first: `(cd packages/db && npx prisma db push)`. The change is additive, so the code already running keeps working.
2. Then deploy the application code.
3. Leave `PERSONALITY_SIGNAL_ENABLED` unset until the deployed application and database are verified and real replies have been checked with it on.

Known gaps, deliberately not fixed here: `UserProfile.primaryPersona` is never copied to `MessengerUser.persona` (nothing writes that field, so web-onboarded users stay on the default `rex` on Telegram), and the Rex V3 prompt is hard-coded to Rex's voice whatever the persona.

### Proactive messaging

`runCheckinCron` in `apps/api/lib/checkin-cron.ts` sends dynamic check-ins, custom reminders, gym cues and Nova proactive messages; each job has its own `try`, so one failing does not stop the others. It is driven by an in-process 5-minute `setInterval` started from `apps/api/instrumentation.ts` (disable with `DISABLE_INTERNAL_CHECKIN_CRON=true`). `render.yaml` sets that flag to `false`: Render is the one host that runs it. `GET /api/health` reports `scheduler.state` (`running` / `disabled`) with the time and result of the last tick. `GET /api/checkin` runs one tick by hand; nothing deployed calls it, and it requires `Authorization: Bearer $CRON_SECRET` (closed in production when `CRON_SECRET` is unset). The root `vercel.json` still declares a cron for `/api/checkin`, but the web app has neither that route nor a rewrite for it. Nova's part is described under "Nova on Telegram".

### Data model

Two user identities, deliberately not merged:

- **`User`**: web account, with `UserProfile` (quiz results, gym settings) and the gym tables (`WorkoutLog`, `LiftLog`, `SorenessLog`, `BodyweightLog`, `EnergyLog`, `InjuryFlag`).
- **`MessengerUser`**: Telegram identity keyed by `(platform, platformChatId)`. Owns conversation memory (`CompanionMessage`, `MemoryFact`), goals, deadlines, focus sessions, Telegram workout logging, `UserReality` and all `Nova*` tables.

`MemoryFact` is also Rex's generic state store: onboarding V2 state, active investigations and mentor state history are rows distinguished by `type`/`key`. `UserReality` (the Reality Layer: current illness, injury, travel and similar temporary facts) is kept separate from memory.

Personas are defined in `services/personna.service.ts` (the misspelling is the real filename). The active one is `MessengerUser.persona`.

## Feature flags

All are read from `process.env` at call time, so flipping one on Railway needs no deploy.

| Flag | Default | Effect |
|---|---|---|
| `MENTOR_V3_ENABLED` | off (must be `"true"`) | Rex V3 orchestrator; off falls back to V1 |
| `COGNITIVE_LAYER_V5_ENABLED` | on (`"false"` disables) | V5 investigate-then-diagnose layer inside V3 |
| `PHASE3_CONTEXT_ENABLED` | on (`"false"` disables) | Mentor state context in the Rex prompt |
| `ONBOARDING_V3_ENABLED` | off (must be `"true"`) | Conversation-first onboarding; off falls back to V2 |
| `DISABLE_INTERNAL_CHECKIN_CRON` | off | Stops the in-process check-in scheduler |
| `PERSONALITY_SIGNAL_ENABLED` | off (must be `"true"`) | Adds the onboarding personality signal to the Rex and Nova prompts as behavioural lines |
| `NOVA_PROACTIVE_DISABLED` | off | Stops Nova's proactive Telegram messages; replies, commands and buttons still work |
| `CRON_SECRET` | unset | Required as a bearer token by `GET /api/checkin`. Unset: that endpoint is closed in production. The in-process scheduler is unaffected |

`BODYWEIGHT_INTELLIGENCE_ENABLED`, `RECOVERY_INTELLIGENCE_ENABLED`, `NUTRITION_INTELLIGENCE_ENABLED` and `GOAL_PROGRESS_ENABLED` gate individual Rex evidence blocks.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | both | Neon PostgreSQL pooled connection |
| `DIRECT_URL` | api | Neon direct connection, used by the Prisma CLI |
| `TELEGRAM_BOT_TOKEN` (or `BOT_TOKEN`) | api | Telegram Bot API token |
| `GEMINI_API_KEY` | api | When set, every model call goes to Gemini. `GEMINI_MODEL_FAST` / `GEMINI_MODEL_MAIN` override the defaults |
| `OPENAI_API_KEY` | api | Used only when `GEMINI_API_KEY` is empty or `LLM_PROVIDER=openai`. `OPENAI_MODEL` overrides the default OpenAI model |
| `TELEGRAM_WEBHOOK_SECRET` | api | Must equal the `secret_token` given to Telegram's `setWebhook`. Unset: Rex requests are not authenticated, and in production Nova ignores every update |
| `JWT_SECRET` | both | Signs session JWTs, keys signup codes, and proves the web proxy to the API. Must be the same on both. Required in production: there is no default |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | api | Google OAuth |
| `GOOGLE_REDIRECT_URI` | api | `https://<web-domain>/api/auth/google/callback`. Must be on the web domain: the state cookie is set there |
| `RESEND_API_KEY` | api | Sends signup codes and reset links. Unset: email signup returns 503 and no reset mail is sent |
| `RESEND_FROM_EMAIL` | api | Sender on a domain verified with Resend. The default `onboarding@resend.dev` only reaches the Resend account's own address |
| `API_URL` | web | Base URL of `apps/api` for the rewrites |
| `NEXT_PUBLIC_APP_URL` | web | Public URL of the web app |
| `NEXT_PUBLIC_BOT_USERNAME` / `BOT_USERNAME` | web / api | Bot username without `@`, for "open chat" links and the `?start=TOKEN` deeplink |

## Deployment

- **Render** (`render.yaml`, steps in `RENDER_DEPLOYMENT.md`) is the target host for `apps/api`: one always-on web service, one instance, health check `/api/health`. The 5-minute scheduler runs inside that process, so there is no Render Cron Job or worker; adding one would run every job twice. `DISABLE_INTERNAL_CHECKIN_CRON=true` turns the scheduler off on a host.
- **Railway** (`railway.json`, `RAILWAY_DEPLOYMENT.md`) is the previous host, kept until Render is verified. Only one of the two may run the scheduler or receive the Telegram webhook at a time.
- **Vercel**: Root Directory `apps/web`; `apps/web/vercel.json` runs `prisma generate` before the build.
- `prisma generate` is not a `postinstall` step. Run it by hand after a fresh install or a schema change.

## Who a Nova learner is

One learner per person, with or without Telegram. `nova/product/learner-identity.ts` (`resolveLearnerForAccount`) is the only place an account becomes a learner; `apps/api/lib/nova/resolve-learner.ts` supplies the account from the session cookie and nothing from the request.

- A learner is a `NovaAcademicProfile` on a `MessengerUser` row, named by one string that every product function takes as `platformChatId`: a Telegram chat id, or `web:<userId>` for a Nova account with no chat (`nova/product/learner-key.ts`, pure). Look a learner up with `learnerKey(id)`; never write `platform: "telegram"` into a Nova lookup (`lifecycle-hardening.test.ts` reads the source to hold this).
- The web row is made on the account's first request, only when `primaryPersona` is `nova`, and the unique key makes that idempotent.
- **Connecting Telegram re-keys the row** (`nova/telegram/telegram-link.ts`, one transaction): the same row id, profile and history, now found by the chat id. The placeholder row the webhook made for that chat is set aside (`platform: "telegram_replaced"`), not deleted. A chat that already has a Nova learner (`chat_has_learner`) or a finished Rex setup (`chat_is_rex`) is refused when the account has its own learner. There is no unlink.
- Nova messages first only on Telegram: the proactive tick selects `platform: "telegram"`.
- Account deletion removes a web-keyed learner row outright (it belongs to the account alone); a chat-keyed `MessengerUser` is still left, because Rex shares it.
- A learner with subjects and no topics is started by the learner: Home's first-session form sends the ordinary `start` with a subject they chose; on Telegram `/focus <topic>` asks which subject. Nova never guesses a subject.

## Nova on the web (Home → Start session)

The web app renders Nova's decisions; it does not make them. Three routes, all resolving the signed-in account to its Nova learner through `apps/api/lib/nova/resolve-learner.ts`:

- `GET /api/nova/today?minutes=` returns `NovaTodayView`, built by `packages/api/src/nova/product/today.ts` from the existing engines. No LLM call.
- `POST /api/nova/session` (`start` / `pause` / `resume` / `end`) and `GET /api/nova/session`: deterministic session commands. They call the same session writers a chat turn uses (`persistence/nova-persistence.ts`), so do not add a second place that writes `NovaStudySession`.
- `POST /api/nova/message` runs a normal Nova turn (used for onboarding and "tell Nova" boxes). **A sentence typed there never starts, pauses or ends a session**: `nova/entry.ts` passes `sessionCommands: "surface"` unless the text is a typed command (`/study`, `/done`), and tells the Response Brain so. The page has buttons for those; the model's reading of a sentence is not one. What the sentence says is still logged and consolidated.
- **The web path's second pass** (`brains/disambiguation-pass.ts`, one extra model call on a very unclear message) may point the reply at a topic or a kind of question. It may not turn the message into a study report, a skip, a mastery claim or a commitment: those intents are evidence and come only from the first reading. The first reading itself goes through `safeReading` on the web too.
- **"In N days" is the learner's calendar** (`calendarDaysUntil` in `engines/learner-calendar.ts`) on Today, the Planner, Telegram and proactive messages. The engines' own pressure thresholds still use elapsed time.

Contracts live in `packages/api/src/nova/product/today.types.ts` (no imports, so the web app imports the types directly). UI is in `apps/web/components/nova/`; `app/(dashboard)/home/page.tsx` renders the Rex home (`components/home/rex-home.tsx`) when the status is `not_nova`. Never add ranking or recommendation logic to React: add a field to the contract instead. The focus timer is derived from the server's `elapsedSeconds`; the page keeps no session state of its own.

**Planner** (`GET /api/nova/planner?minutes=`, `product/planner.ts`, UI in `apps/web/components/nova/planner/`). Home and Planner both start from `product/planning-inputs.ts`, so they show the same plan. Things to know before changing it:

- Plans are not stored. The Planning Engine (`generateStudyPlan`) is run on every request and only plans **today**; its `thisWeek` is always empty. The week view shows recorded sessions, today's blocks, reviews the retention schedule has falling due, and exams. Do not fill later days with invented blocks.
- `minutes` goes to the engine as `availableMinutes`, which refits the whole day. It can shorten a wellbeing cap but never lift one. `StudyPlan.budgetBasis` says which rule set the day's length; the "Why this plan" adjustments are worded from it.
- **The learner's time is a hard limit.** No rule raises a day above it: an exam changes what the day holds (`examCrisisMode` makes every block exam prep), never how long it is. `budgetBasis` is `preferred`, `stated_time`, `recovery` or `no_pressure`; there is no raised basis, and `hard-availability.test.ts` fails if one returns. Only the learner lengthens a day, by saying how long they have today (which may be more than usual) or by changing their usual time in setup.
- **When exam work does not fit, the plan says so.** `examShortfall` (Planning Engine, pure) counts the exam's topics not yet solid at `EXAM_TOPIC_MINUTES` each against today's budget plus the usual daily time for each day before the exam, inside `EXAM_WINDOW_DAYS`. `product/shortfall.ts` words it once for Today and the Planner (`PlanShortfallView`: a sentence, what it assumes, three choices) and `components/nova/shortfall-note.tsx` shows it. It is not stated on a day held short for wellbeing. The per-topic figure is an assumption and is shown as one. Telegram does not state it yet.
- Nova's context no longer carries a "recommended hours a day" figure for an exam: it ignored the learner's time.
- `engines/adaptive-planning-engine.ts` is not called by anything. Its output is not applied to any plan, so the Planner does not show it.
- There is no per-block skip or reschedule: nothing stores a block to move.

**One meaning of "I have N minutes".** `loadPlanningInputs(chat, { availableMinutes })` is the only place a stated time enters planning. Home and Planner both call it with the number from `?minutes=`, so the same number gives the same plan: Home's recommendation is the Planner's first block and its "after that" list is the next two. Neither page, and no builder, changes a block's length. `planEmptyReason` (same file) is the one answer to "why are there no blocks", including `too_little_time`.

**Which companion, which pages.** `product/companion.ts` (pure, no imports) holds `companionOf` and `routeAccess`. The API's `resolve-learner.ts` and the web dashboard layout both use `companionOf`; `components/dashboard-shell.tsx` applies `routeAccess` before rendering children. Nova's pages are listed in `NOVA_ROUTES` and everything else in the dashboard is Rex's, so a new Rex page is closed to Nova learners by default (they get `components/nova/nova-unavailable.tsx`). To give Nova a page, add it to `NOVA_ROUTES`; the sidebar reads the same list.

**Knowledge** (`GET /api/nova/knowledge`, `product/knowledge.ts`, UI in `apps/web/components/nova/knowledge/`). Read-only. What it shows and what it must not claim:

- **Topic identity is (subject, name).** A session's subject is the authority: a web start carries it, and `updateTopicMastery` finds the topic case-insensitively within that subject. Only a start with no subject (a chat turn) goes through `resolveTopicSubject`: the text names a subject (whole name, code, acronym, or the name as a phrase; whole words only), or the learner already has that topic under exactly one subject. Otherwise no subject and no mastery write. Never guess one.
- **How a session went** comes from the learner: the focus screen asks "How did it go?" and the answer travels as `outcome` on the `end` command to `sessionEvidence` (`study-session-engine.ts`), which maps it to the mastery engine's 0–1 input. The report records `outcome` and `evidenceBasis` (`learner_outcome` / `mastery_claim` / `unreported`). `/done` in chat has no answer and is `unreported` unless the message made a mastery claim.
- **"Mastery" is a self-report-driven heuristic**, not a tested result, and there is no measure of how certain it is. Do not add UI copy that implies one. `reviewCount` (finished sessions that fed the topic) is the only indication of how much stands behind a number. A topic with `reviewCount` 0 has no level ("unverified").
- **One definition of "due for review"**, in `retention-engine.ts`: the schedule is the authority. A topic is due when its scheduled date has arrived (`reviewDueAt <= now`, where `TopicMasteryState.reviewDueAt` is the stored `nextReviewAt`) and overdue once it has passed. Estimated retention is not part of the rule: it only orders the due topics and appears as a reason. So "Struggled" (interval reset to one day) is due tomorrow. `isDueForReview` / `getOverdueTopics` are the only way to ask; Home, Planner, Knowledge and the proactive cron all use them, and `review-due.test.ts` fails if one grows its own comparison or retention creeps back into the rule. Callers that judge "due" at a moment other than the present pass the same `now` to `getAllTopicMasteries` and `generateStudyPlan`.
- **Self-reported sessions** (`activityType: "self_reported"`, created by consolidation from "I studied X") carry a placeholder duration. Knowledge returns `measured: false, minutes: null` for them. Home and Planner still sum that placeholder into "minutes this week".
- **Mastery history** is `NovaTopicMasterySnapshot`: one row per change `updateTopicMastery` makes (value before, value after, source, session), written in the same transaction as the change. It is that engine's record, not an input: nothing reads it back into mastery, and Progress is its only reader. `@@unique([topicId, sessionId])` means one session's report moves a topic once; a replay fails there and the mastery write rolls back with it. Topics changed before the table existed have no rows until their next write.

**Notes** (`/api/nova/notes`, `/api/nova/notes/[id]`, `product/notes.ts`, UI in `apps/web/components/nova/notes/`). A note is the learner's own content (`NovaNote`: profile, optional subject, optional topic name, title, body). The rules, each held by a test:

- **A note is not cognitive state.** Writing or editing one never touches mastery, the review schedule, `UserFact`, `UserReality`, `BehavioralPattern`, cognitive state or Learning DNA. `product/notes.ts` is the only code that reads or writes `NovaNote`, it writes no other table, and it imports no brain, orchestrator, consolidation module or LLM client (`notes.test.ts` reads the source to enforce this).
- **Note text never enters the chat pipeline.** Do not pass it to `/api/nova/message`, `handleNovaTurn`, the Understanding Brain or consolidation. Any future AI action on a note needs its own route that calls the LLM client directly and stores nothing in the note.
- **Only the learner's save writes `title` or `body`.** The body is stored as typed (line endings unified, nothing else).
- **Ownership comes from the session cookie.** Every note query includes the learner's `profileId`; a note id alone never reaches a note (another learner's note is a 404). No id from the request is read as authority.
- **Study this** is the ordinary `start` command with the note's subject and topic. The session and its "How did it go?" answer are the evidence; the note is not. There is no note-to-session link in the schema.
- Search is a case-insensitive substring match. `likeLiteral` (in `topic-mastery-engine.ts`) escapes `%`, `_` and `\` wherever a name or query is compared with `mode: "insensitive"`, which Postgres runs as ILIKE.
- **Account deletion** goes through `services/accountDeletion.service.ts`, which removes the Nova academic profile linked by `telegramChatId` (cascading to notes, sessions, topics) before the `User`. It leaves the `MessengerUser` row, which is shared with Rex.

**Progress** (`GET /api/nova/progress`, `product/progress.ts`, UI in `apps/web/components/nova/progress/`). A read model answering "have I actually changed?" from records that already exist. It writes nothing, calls no LLM and takes no parameters. `/progress` is one route with two pages, like Home and Planner: a Rex account gets `components/progress/rex-progress.tsx`. The definitions, all in `progress.ts` and held by `progress-view.test.ts`:

- **Counted session**: finished, timed by Nova (`activityType` not `self_reported`) and at least `MIN_BLOCK_MINUTES` (10) long. Every number on the page uses this; the response says how many finished sessions it left out (`overview.notCounted`).
- **Active day**: a calendar day in the learner's timezone (`NovaAcademicProfile.timezone`, else UTC, via the Planner's `dayKey`) with a counted session. A chat message is never one. Weeks run Monday to Sunday.
- **Comeback**: a counted session on an active day 4 or more calendar days after the previous one (the Academic State Engine's "returning" threshold). A first session is not a comeback.
- **Consistency trend**: average active days a week over the last four finished weeks against the four before, and only when the learner had started by the first of those eight. Otherwise `not_enough_history`.
- **Topic growth**: a topic has moved when its mastery number is 10 points from the earliest recorded value that already had a session behind it. With no recorded history, direction comes from the learner's own "How did it go?" answers, and no movement is drawn. Mastery numbers and levels are the Knowledge Engine's (`masteryLevel`); Progress has no bands of its own.
- **Journey events** are derived at read time, never stored: first session, the 5th/10th/25th/… counted session, comebacks, a session that moved a topic into a higher level, and "Good" or "Crushed it" after "Struggled". Each carries the id of the session or mastery record it rests on.
- **Not shown, because nothing on record supports it**: a daily streak (the Academic State Engine owns the only one, in server time, and Home shows it), focus quality and energy (derived from pause counts; `energyTrend` is a constant), reflections (`reflectionText` is never written), goal completion (`goals` is free text with no state), behavioural patterns and reality. Learning DNA contributes only the usual session length, and only once its own `confidence` is above `low` (ten sessions).
- Sessions and mastery records are read 365 days back; older counted sessions arrive as totals from one aggregate, so the query count is fixed and the response does not grow with history.

**Learning DNA** (`GET /api/nova/learning-dna`, UI in `apps/web/components/nova/learning-dna/`). How this learner studies, as beliefs that carry their own support and can change. One owner, three files:

- `engines/learning-dna-engine.ts` (pure) computes every signal. Nothing else may: Progress shows the stored session length, it does not work one out (`learning-dna.test.ts` reads the source to hold this).
- `persistence/learning-dna-store.ts` is the only reader of DNA evidence and the only writer of `NovaLearningDNA`. `refreshLearningDna` runs when a session ends (`consumeExecutionReport`); reading writes nothing.
- `product/learning-dna.ts` lays the signals out for the page and holds the timezone write.

The rules that keep one unusual day from becoming a belief, each with a test:

- **Evidence** is counted sessions (`isCountedSession` in `study-session-engine.ts`, shared with Progress) from the last 90 days, at most 60. Older sessions leave the window, so a belief nobody renews fades.
- **Levels**: `unknown` below 5 pieces of evidence, `emerging` from 5, `supported` from 10, `strong` from 20. A signal at `unknown` has no value; it says what it would need.
- **Typical values** are a median with its middle half, never an average.
- **Comparisons** ("this length goes better") use only the learner's "How did it go?" answers, need 4 answered sessions on each of two sides and a 20-point lead, and are as confident as their smaller side (4 / 8 / 15). Otherwise there is no conclusion.
- **Weakening**: every conclusion is rechecked against the latest sessions (the last 8, or the latest half for comparisons). Disagreement marks it `weakening` before it changes.
- **Time of day** is claimed only when `NovaAcademicProfile.timezone` holds a real zone. The setup conversation never asks, so the learner's device reports it once through `PUT /api/nova/timezone`; it is stored only while none is stored and cannot be moved by a later request.
- `NovaLearningDNA.signals` is bookkeeping (since when a conclusion has held, what it replaced), not the conclusions: those are recomputed from sessions on every read. The older columns (`optimalSessionMinutes`, `planAdherenceProfile`, `dataPointCount`, `confidence`) are filled by `legacyDnaColumns` from the same signals.
- **Not computed, because nothing on record supports it**: distraction, burnout, preferred formats, focus, energy. The page lists them under "What Nova doesn't know". Do not derive them from pauses, short sessions or gaps.
- `preferredStudyTime` is what the learner said in setup. It is shown as their statement and feeds no signal.
- Learning DNA is not memory: it writes no `UserFact`, `UserReality`, `BehavioralPattern` or mastery, and a future source of evidence (a browser extension's learning events) should arrive as sessions or as a new evidence type in the store, not as a second calculation.

`engines/learner-calendar.ts` holds the day, week and clock-hour helpers Planner, Progress and Learning DNA share.

**Browser extension and learning events** (`apps/extension`, `product/learning-events.ts`, `product/extension-connection.ts`, web UI in `apps/web/components/nova/saved/`). The extension is a context bridge: it sends what the learner explicitly asked for and decides nothing.

- **A learning event is a record of an action, not evidence of learning.** `resource_saved` and `study_requested` are the only types. `learning-events.ts` is the only code that touches `NovaLearningEvent` and writes no other table: no mastery, session, Learning DNA, fact, reality, pattern or note, and no engine reads events (`learning-events.test.ts` reads the source to hold this). Do not add a `page_viewed` type or derive anything from event counts.
- **Study this starts nothing by itself.** The extension posts `study_requested` and opens `/focus?study=<eventId>`; the Focus screen shows the page and its subject and topic, and the learner's click sends the ordinary `start` command. There is still one place that opens a session.
- **Only this is stored about a page**: its address (http/https only, with login, fragment and credential parameters removed by `normalizeResourceUrl`), its title, the site (derived from the address), and the subject and topic the learner chose. The request body is capped at 8 KB and every field not in `LearningEventInput` is ignored. The server never fetches a saved address.
- **Idempotency**: `clientEventId` is unique per learner. A retry returns the stored event and writes nothing; it cannot rewrite it. Saving an address that is already saved re-files that one entry.
- **Rate limit**: 20 events a minute per learner, counted in the table.
- **The extension has its own credential, not the web session.** The signed-in web app makes a one-time pairing code (`POST /api/nova/extension/pair`), the learner types it into the extension, and `POST /api/nova/extension/connect` exchanges it for a bearer token. `NovaExtensionConnection` stores SHA-256 hashes only. The token opens `GET /api/nova/extension/context`, `POST /api/nova/extension/disconnect` and `POST /api/nova/learning-events`, and nothing else; it dies on disconnect or after 30 idle days. `apps/api/lib/nova/extension-access.ts` resolves it to a learner through the same `companionOf` rule as the cookie. Do not accept it on any other route.
- **Those three routes and `connect` answer cross-origin requests from `chrome-extension://` origins only**, because the extension asks for no host permission. They never take the session cookie. Do not add these headers to a cookie-authenticated route.
- **Extension permissions are `activeTab` and `storage`.** No host permissions, content scripts or background script; `apps/extension/test/extension.test.mjs` fails if one is added or if the code reaches for another browser API. Its Nova address is fixed at build time (`NOVA_URL`).
- Site-specific behaviour (a video's progress, a solved problem) belongs in a new adapter in `apps/extension/src/lib/page.js` plus a new event type handled in `learning-events.ts`, not in special cases.

Session rules that must hold:

- **One meaning of "session ended".** The web End button is `/done` without a chat turn: `persistSessionEnd` builds the same command-established `study_report` signal, routes it through `computeSessionAction` and the shared `sessionLifecycle` (the function `persistTurn` uses), and hands the same evidence to `consolidateTurn`. Do not write a second end path.
- **One clock.** `engines/session-clock.ts` defines study time (`sessionElapsedSeconds`). Paused time is kept in `NovaStudySession.totalPausedSeconds`; `totalPausedMinutes` is only its floor. Pause and resume are written only by `pauseStudySession` / `resumeStudySession`.
- **One open session per learner.** `openStudySession` checks and inserts inside a transaction that first takes `SELECT … FOR UPDATE` on the learner's `NovaAcademicProfile` row. Every start (web or `/study`) goes through it. Do not create a `NovaStudySession` anywhere else.
- **Conditional writes.** Pause, resume and end use `updateMany` guarded on the expected state, so a repeated or concurrent command writes nothing and an execution report is consumed once.

## Nova on Telegram

Full description: `docs/NOVA_TELEGRAM_MENTOR.md`. Telegram is a surface: it owns no session, plan, mastery, memory or timer, and every state change goes through a function the web app also calls. The rules, each held by `telegram-mentor.test.ts` or `nova-telegram.itest.ts`:

- **Three inputs, one path each.** A command and a button tap are protocol and call no model. Anything else is text: one Understanding Brain call with a context block (date, running session, open question), then `decision/action-decision.ts` (pure), then the same actions the buttons run, then the canonical turn (`runNovaOrchestrator` with the reading passed in as `understanding`). Do not add a regex, keyword list, yes/no check or second classifier anywhere on this path.
- **A reading is a proposal, and the model's confidence is not permission.** The request envelope (`LearnerRequest` in `types/understanding.types.ts`) is a closed vocabulary validated by `parseLearnerRequest`, and it says how readable the message was (`clarity`) and whether it takes itself back (`changeOfMind`). `decision/interpretation-safety.ts` (pure) decides what of a reading may be used: an `unintelligible` one is replaced by a neutral reading and never reaches the canonical turn. `decision/action-decision.ts` then checks each action's preconditions against the reading and the real state: a start needs an explicit request naming a topic on today's plan (or the answer to a Start option), time alone never starts anything, minutes against an open offer re-offer it, and ending a session or adding an exam never runs from a sentence. To change behaviour, change a precondition there; do not add a rule for a phrase.
- **Ending needs an outcome.** `/done`, End and "I finished" ask "How did it go?"; the answer calls the ordinary `end` command with that outcome. There is no unreported end from Telegram.
- **One open prompt per learner** (`NovaTelegramPrompt`, `telegram/prompt-store.ts`). A button carries `p:<promptId>:<optionId>` and nothing else; what it does is read from the row. Resolving is one conditional write.
- **No process memory.** The turn lease, action limiter, model budget and delivery state are `NovaTelegramChannel` (`telegram/channel-store.ts`).
- **`sessionCommands: "surface"`** tells the turn that the surface runs session commands, so `sessionLifecycle` starts and ends nothing. Use it for any surface that calls `runNovaSessionCommand` itself.
- **`scriptedReply` / `directive` / `responseFallback`** on the orchestrator input: a product result is stated without the Response Brain; a decided action is handed to it to word; a model failure falls back to the plain statement. The Response Brain never chooses the action.
- **Register** (`decision/register.ts`) is chosen by code and applies to every Nova reply, web included. Playful needs the learner's explicit "push me hard" and nothing serious going on.
- **`topic_struggle`** is a signal with no wording pattern: only the Understanding Brain's `struggleTopic` establishes it. Consolidation turns it into a soft mastery observation, at most once per topic per 20 hours, never a `UserFact`.
- **Stated time** ("I've only got 30 minutes") is `NovaAcademicProfile.statedMinutes` for that local day, read and written only by `product/planning-inputs.ts`; a `minutes` parameter still wins.
- **An exam date is moved, renamed or removed** on `/settings/study#exams` (`components/nova/exams-editor.tsx` → `GET /api/nova/exams`, `PATCH`/`DELETE /api/nova/exams/[id]` → `listExams`, `updateExam`, `removeExam` in `product/exams.ts`, the only code that changes a `NovaExam`). The id selects among the learner's own exams (`where: { id, profileId }`, guarded `updateMany`/`deleteMany`), `checkExamChange` (pure) decides what a change may be, and each write answers with the list as it now stands. Removal deletes the row: nothing hangs off an exam, and there is no archive column. Nothing about a plan or reminder is stored, so nothing is undone: every page and the proactive tick read exams afresh, and an unworded countdown claim whose exam is gone is dropped. Held by `exam-editing.test.ts` and `nova-exams.itest.ts`. Telegram cannot move or remove an exam.
- **Exams after onboarding** are added by `product/exams.ts`, only on the learner's confirmation, always under one of their subjects. `examToOffer`: a label naming one subject is offered under it; a label naming none is offered with their subjects to choose from, unless an exam is already on that day (then that one is meant and nothing is offered). So "exam is tomorrow" can never create a second or subject-less exam.
- **The Response Brain is told what happened.** It words a result only when the operation succeeded; a turn with no action carries a directive saying nothing was done.
- **Proactive and what is going on in the learner's life**: only circumstances that will pass (expiring within 15 days) gate messages; a standing one (a job) shapes the plan and does not silence Nova. Illness, injury or an emotional constraint: nothing is sent, an exam countdown included. A life constraint (a family matter): study nudges are held, and an exam countdown goes out as the date only (`informOnly`: no recommendation, no Start button). Instructions for the model go in the prompt, never among `facts`, which the no-model fallback sends as they are.
- **Proactive**: a message approved earlier and not yet delivered is re-checked with `holdReason` before every retry. `decision/proactive-decision.ts` (pure) generates every candidate, gates, then ranks. `proactive/proactive-outbox.ts` is the only writer of `NovaProactiveMessage`: claim by unique occurrence key, word, store, send. Only delivered rows count toward the cap of two a day. No timezone means no proactive message. Do not add a type without a fact on record behind it, and do not compare clock minutes for equality.
- **In production Nova ignores updates without a valid `TELEGRAM_WEBHOOK_SECRET`.** `NOVA_PROACTIVE_DISABLED=true` stops Nova messaging first.
- `scripts/novaTelegramEval.ts [repeats] [group] [raw]` runs real phrases through the configured model, the parser, `safeReading` and `decideAction`, and prints the decision and what it would write. Each case names the decisions that would corrupt state; the run exits 1 on any. It is the only check of what the model actually reads: run it after changing the Understanding prompt or the action decision.

## Talking to Nova: one reading, one decision, both surfaces

A sentence typed to Nova takes the same path on Telegram (`telegram/telegram-turn.ts`) and on the web (`interaction/web-sentence.ts`): one Understanding call with context, `safeReading`, `interpret`, `decideAction`, the shared action functions, then the canonical turn. The rules, each held by `semantic-interaction.test.ts` or `nova-semantic.itest.ts`:

- **The kind of a message is derived, not classified twice.** `interaction/semantics.ts` (pure) names a reading (`general_question`, `learner_question`, `action_request`, `context_signal`, `reality_signal`, `emotional_signal`, `onboarding_input`, `status_request`, `conversation`, `unsupported`, `unclear`) from fields the Understanding Brain already filled. The model adds three fields to the request envelope (v4): `asks` (`knowledge` / `about_me` / `none`), `availableMinutesMax` (a range) and `setup`. (v5 adds `language`; see "Reply language".) A kind describes; it authorises nothing.
- **Focused context.** `contextNeeds` says which parts of the learner's record a reply may use, and `buildFocusedLayer` in the context builder includes only those. A general question gets the last few lines of the conversation and nothing else. The orchestrator takes this as `focus: { needs, facts, mode }`; without it, it builds the whole layer as before.
- **A general question** ("what is deadlock?") decides `explain`: no product action, `mode: "explain"`, and the Response Brain answers the question. It reads and writes nothing of the learner's.
- **A learner question about a topic** ("should I study deadlocks tonight?") decides `advise`. `interaction/advice.ts` (pure) finds the topic in the Today view and returns the verdict, its sentence and the facts behind it; the Response Brain may reword the sentence, with those facts as the only figures it may state.
- **A range of time** ("20-30 mins") decides `ask_minutes`: both ends are offered and neither is recorded until one is picked. A single stated time is offered as its own Start length next to the standard ones.
- **Study setup is offered, never saved from a sentence.** `product/setup.ts` is its one reader and writer: `proposeSetup` (pure) turns a `setup` statement into a proposal under a subject of the learner's own, the `confirm_setup` prompt shows it back, and `applySetup` runs on confirmation, in one transaction, idempotently. Topics are created by `declareTopics` in the topic mastery engine with no mastery, no review and no snapshot.
- **What is still missing** is `interaction/initialization.ts` (pure): of subjects, topics, exams and usual study time, what is not on record and which one thing to ask for next. An empty plan asks that question. Nothing on record is asked for again.
- **The Planning Engine schedules syllabus topics that were never studied** (`new_material`): two when the plan is otherwise empty, one otherwise, in the order they were given.
- **The web page's contract.** A sentence typed on the web runs no session action (`PAGE_BUTTONS_ONLY`): it is answered in words and pointed at the page's buttons. The web answers in words only questions it asked there (`WEB_PROMPTS`: saving setup, adding an exam, picking a length), so a typed "yes" cannot accept a Start offer made on Telegram.
- **Two model calls per turn at most**: the reading, and the wording. The web path no longer runs the second-pass disambiguation; only a typed slash command still takes the older turn.
- The action functions both surfaces call live in `telegram/telegram-actions.ts` and the prompt store in `telegram/prompt-store.ts`. They are channel-neutral in behaviour; the directory name is historical.

## The first message in a linked Telegram chat

Held by `first-use.test.ts` and `nova-first-use.itest.ts`.

- **Where it comes from.** After `linkTelegramChat` commits, the webhook hands a `start` command to `handleNovaTelegramEvent`. There is no fixed greeting.
- **What it is about** is decided by `interaction/first-use.ts` (pure) from the Today view: a running session, a circumstance that means no push (health, injury, emotional), the plan's first block, the one missing piece of setup, or nothing pressing. It carries the buttons the plan or session already has.
- **Wording** is `brains/first-use-wording.ts`: one model call given only those facts and the register, with the plain sentence as fallback. A reply that mentions a command is discarded for the fallback.
- **Once per chat.** `claimFirstUse` in the channel store takes `NovaTelegramChannel.lastDeliveredAt` while it is null, in one conditional write, and gives it back if the send failed. After that `/start` is the Today reply. A replayed update never gets this far: `admitTelegramUpdate` drops it.
- **Setup not finished:** the setup question, as for any other command.

## Reply language (English and Hinglish)

Held by `reply-language.test.ts` and `nova-language.itest.ts`. Nova answers in the language the learner writes in. Language is wording: the decision, every name and every figure are the same in both.

- **Who says which language a message is in:** the Understanding Brain, as `request.language` (`english` / `hinglish` / null when a message is too short to tell, such as a number, "ok" or a bare topic name). Envelope v5. There is no keyword list and no script check on the learner's words.
- **Where it is kept:** nowhere new. The canonical turn stores it with the user message in the conversation log (`metadata.language`), and `loadReplyLanguage` in the conversation adapter reads the latest one. No column, no table, no setting. Writing in the other language switches at once.
- **A reply the Response Brain words** (a conversation turn, the first message, a proactive message) gets one extra line, `languageLine` from `interaction/language.ts`. English adds nothing.
- **A reply code wrote, to a typed message** (the plan, an advice sentence, a setup question) is said in Hinglish by `brains/language-wording.ts`: one `gpt-4o-mini` call given only that text. `faithful` throws the rendering away unless it carries exactly the same figures, is in Roman letters and has not grown; then the English text goes out. It spends from the daily wording budget and never runs on a turn the Response Brain worded, so a turn is still two model calls at most.
- **Commands and buttons call no model**, in either language. Their fixed lines (`TEXT_HINGLISH` in `telegram-replies.ts`, one for every line of `TEXT`) are in the learner's language; the plan, status and session lines go out as code wrote them.
- **Button labels, topic names, numbers and dates are never translated.** The web chat's fixed lines stay English.

## The Creature page for a Nova learner

Held by `creature-view.test.ts` and `nova-language.itest.ts`. `/creature` is one page with two sources, like Home and Progress.

- `GET /api/nova/creature` returns `NovaCreatureView` (`product/creature.ts`, contract in `creature.types.ts`). It is a read model over two views that already exist: the streak is Today's (`progress.streakDays`, the one Home shows) and active days are Progress's. It runs no query of its own, writes nothing and calls no model.
- **Level** is 1 plus one for every 5 active days. **World health** is 70 plus 5 for each active day in this week and the last, capped at 100. 70 is where the world is drawn clear, so a week off, or a week ill, never brings fog.
- The page asks that route first. A Nova learner's world is drawn from the answer; `not_nova` gets Rex's world, which still runs on the page's fixed figures; a failed request shows an error and no numbers. Nothing mounts before the answer, because the engine is built once from the seed.
- The seed is a hash of the learner key, so each learner has their own terrain and it names nobody.
- Nova does not mention the creature in chat, and no message is sent about it.
## Telegram hardening: what real use showed

Held by `telegram-hardening.test.ts` and `nova-hardening.itest.ts`.

- **Nova has no reminder for a set time.** Rex's `CustomReminder` is not used: it parses times with regexes and a second model call, falls back to `Asia/Kolkata`, and is sent with no outbox or retry. So a request for one is read (`request.action = "set_reminder"`), decided (`reminder_unavailable`, before every other rule, so it is never a "not today") and answered by code with `TEXT.reminderUnavailable`: nothing was scheduled. It is never worded by the model. Do not add a reminder writer on the Telegram path; a real one belongs in `proactive/proactive-outbox.ts` with its own type.
- **The Response Brain may not claim or promise an action** (static layer rules 11 and 12): nothing was done unless the prompt says so, and nothing is said about the student that is not on record.
- **One update, one reply.** `deliver` in `telegram-turn.ts` drops and logs a second reply to the same update, and the last-resort "that didn't go through" line is sent only when nothing has been.
- **Noise and a model that is down are different replies.** Noise (`clarity: unintelligible`) is "I didn't catch that", with the fixed choices once and no second set while those are open. A reading that failed is `TEXT.notUnderstood`, which says the commands still work. In production, repeated `understanding_failed` in the log means the model provider is refusing calls (a quota or rate limit), not that the messages were unreadable.
- **A model call has a deadline** (`deadlineMs` on the one LLM client; 6 s for a reading, 8 s for wording, `NOVA_UNDERSTANDING_DEADLINE_MS` / `NOVA_RESPONSE_DEADLINE_MS`). Every attempt and every wait between attempts fits inside it, so a rate-limited provider fails in time for the turn to answer. Callers that pass none (Rex) are unchanged.
- **A session stopped before ten minutes** is ended and rated like any other and is kept, with the learner's answer, on the session. It moves no mastery, reschedules no review and writes no mastery history (`countedAsStudy` on the execution report, decided in `study-session-engine.ts` with the same `COUNTED_SESSION_MINUTES` Progress and Learning DNA use). Both surfaces say so (`ended.counted`).
- **The reply is sent before the turn is recorded.** A reply code wrote goes out before `runNovaOrchestrator`; a worded one goes out from the orchestrator's `hooks.reply`, before `persistTurn`. Recording still runs and is still awaited inside the same request: nothing is left running after the webhook returns.
- **Typing** is the webhook's existing indicator. It stops when the reply is sent (`onReplied`), not when the turn has been recorded.
- **Where the time went** is on the one `nova_telegram` log line: `timings` (`webhookMs`, `learnerMs`, `contextMs`, `understandingMs`, `decisionMs`, `actionMs`, `responseMs`, `telegramSendMs`, `replyMs`, `persistMs`, `totalMs`), `modelCalls` and `slowStage`. `replyMs` is what the learner waits. `scripts/novaTelegramLatency.ts` turns a log download into P50/P95 per kind of update.
- **A second message sent while the first is still being recorded** gets "Still on your last message". The turn lease is unchanged; waiting for it needs a timer, which `telegram-mentor.test.ts` forbids in these files.

## Tasks and the Planner's board

Held by `tasks.test.ts` and `nova-workspace.itest.ts`. The Planner has two tabs: the study plan the engine works out, and the learner's own task board (`/planner?view=board`).

- **`NovaTask` is the learner's to-do list** (title, status `todo` / `in_progress` / `done`, priority, subject, topic name, due day). `product/tasks.ts` is its only reader and writer; routes are `/api/nova/tasks` and `/api/nova/tasks/[id]`.
- **A task is only a task.** Making, moving or finishing one writes that row and nothing else: no session, no mastery, no exam, no stated time. The Planning Engine does not read tasks, so moving a card never changes the plan. Do not feed tasks into planning or evidence without a decision to; a finished task about a topic is not a session on it.
- **A due day is a calendar day** (`dueDay`, `YYYY-MM-DD`), counted from the learner's own today (`dueInDays`).
- **`clientKey` makes a create idempotent** (`@@unique([profileId, clientKey])`): a double click, a retry or a template applied twice returns the task that exists, as it now is.
- The board (`components/nova/tasks/`) moves a card by drag and drop or by the arrows on it; both are the same `PATCH { status }`. Home's "Your tasks" is the same rows.

## Focus context and the session note

Held by `focus-context.test.ts`. `product/focus-context.ts`, `GET /api/nova/focus-context`, `POST /api/nova/session/reflection`, UI in `components/nova/focus-context.tsx` and `session-note.tsx`.

- **Focus context is a read model of what the learner filed under a topic**: their open tasks, their saved pages, the subject's next exam, and their note from the last session on it. It is shown under Today's recommendation and on the Focus screen. Something belongs when it is filed under the same subject and either that topic or no topic; with no subject nothing is shown. It reads tasks, saved pages and exams only through `listTasks`, `listResourceLinks` and `listExams`, writes nothing and calls no model.
- **Showing a record is not evidence.** A task finished or a page opened moves no mastery. The page says so.
- **A task can start a session** when it names both a subject and a topic (the Focus button on Today's task list). It sends the ordinary `start`; ticking the task is still only a task.
- **The session note** is three optional short answers after ending a session (what got done, what got in the way, the next step), stored as JSON text in `NovaStudySession.reflectionText` by `saveSessionNote` in `persistence/nova-persistence.ts`. Written once, by a guarded write on the learner's own finished session without a note, so a retry or a double submit changes nothing. `ended.sessionId` on the session response is what the page attaches it to.
- **The note is the learner's, for the learner.** No engine, brain, context builder, Learning DNA store or consolidation reads it, and a test holds that. Whether Nova's model may read it is an open owner decision; until then it does not.
- **Not connected yet:** a task has no link to a goal or to a specific exam (both would need a column), and Telegram shows none of this.

## Knowledge Map

Held by `knowledge-map.test.ts` and `nova-workspace.itest.ts`. `/map`, `GET /api/nova/knowledge-map`, `product/knowledge-map.ts`.

- **A read model of links that are stored.** Nodes are subjects, topics, notes and saved pages. Edges are: a topic's subject; a note or saved page filed under a subject; and under a topic when it names one of that subject's topics (compared trimmed, single-spaced, any case). Nothing is inferred and no edge is added for looks. What is filed under nothing is drawn unconnected, and the view says how many such items there are.
- It writes nothing, calls no model, and reads notes and saved pages only through `listNoteLinks` and `listResourceLinks` in their owning modules. A note's body is never read for the map.
- A topic has a level only when a session stands behind it; one with none is drawn as a dashed ring.
- **A node opens its own record**, never a list to search again: a note at `/notes/<id>`, a topic at `/knowledge?topic=<id>` (the row opens and scrolls into view), a subject at `/knowledge?subject=<id>`, a saved page at `/saved?page=<id>` (its row is marked). The pages read those ids from the address in an effect.
- **From a topic node** the learner can start a 25-minute session (the ordinary `start`, through `useStartSession`) or write a note filed there; from a subject node, a note. Nothing can be linked, unlinked or scoped to a goal from the map: goals are free text with no id, and re-filing is done on the note or saved page itself.
- **Keyboard.** Each node is a focusable button. With the map itself focused, arrow keys pan (Shift for bigger steps), `+`/`-` zoom and `0` fits. The drawing is `role="group"`, not an image.
- The layout (`components/nova/knowledge-map/layout.ts`) is deterministic and has no dependency: the same data draws the same map. Do not add a physics library or generate edges with a model.

## Themes

`components/theme/kivo-theme.tsx` and the light block in `app/globals.css`.

- Light, Dark and Match device, chosen in Settings or the sidebar, kept in `localStorage` (`kivo-theme`) and written to `<html data-kivo-theme>` by an inline script in the dashboard layout before first paint.
- **The light theme is one block of tokens** scoped to `.kivo-app`. The app is written against a dark surface with translucent white (`border-white/8`, `bg-white/5`); in light, `--color-white` becomes ink and the surface tokens become paper, so components need no light-specific classes. Write new UI with the same tokens (`text-foreground/60`, `bg-card`, `border-white/8`) and it works in both. Avoid hard-coded hex colours and `text-white` on a coloured fill.
- `.kivo-dark` puts the dark tokens back for a region that is always dark (the Creature world). The landing page is outside `.kivo-app` and stays dark.
- A custom property that points at another (`--x: var(--background)`) is resolved where it is declared, so it does not follow the theme: use `var(--background)` directly.

## Templates and editing setup

Held by `templates.test.ts` and `nova-workspace.itest.ts`.

- `product/templates.ts` is eight fixed starting points as pure data, each naming who it was written for (`audiences`): Computer science semester, Exam preparation, Learn a skill, School subjects, Semester subjects, Project sprint, Interview preparation, Certification. The setup form shows the first three of `templatesFor(contexts)` and the rest behind "More templates". Choosing one fills the setup form; the learner edits, reviews and confirms; `saveSetup` saves it. Its tasks are then created through the task route under `template:<id>:<key>`, so applying one twice makes each task once.
- A template states no progress: topics are declared unstudied and tasks start as to do.
- `/settings/study` is the setup form for a learner who has finished onboarding. Saving merges; nothing is removed.
- **Onboarding has no domain question.** Kivo is study and productivity, so the quiz sends `mentorDomain: "study"` and a new account is always a Nova learner. Rex accounts that already exist are unchanged.

## Study setup: one setup, three ways in

`product/setup.ts` is the only reader and writer of a learner's study setup: subjects, topics, exam dates, normal daily minutes and usual study time. The rules, each held by `study-setup.test.ts` or `nova-setup.itest.ts`:

- **Three ways in, one writer.** The setup page (`apps/web/components/nova/setup-form.tsx` → `POST /api/nova/setup`), the web chat and Telegram all end at `saveSetup`. A sentence goes Understanding → `safeReading` → `decideAction` (`offer_setup`) → `proposeSetup` → the `confirm_setup` prompt → `applySetup` → `saveSetup`.
- **Nothing is saved before it is confirmed.** `POST /api/nova/setup { draft }` returns what saving would change and writes nothing; `{ draft, confirm: true }` saves. In chat the confirmation is a button, or a typed "yes" on the web.
- **Saving merges and never duplicates.** Subjects and topics are matched case-insensitively; exams go through `addExam`, which already refuses a duplicate. A draft with any problem is refused whole.
- **Unknown stays unknown.** `NovaAcademicProfile.dailyStudyMinutes` is null until the learner says. `statedDailyMinutes` (study snapshot) is the one reader; planning then uses `ASSUMED_DAILY_HOURS` and adds an assumption line to the plan. The older `preferredStudyHoursPerDay` default (3.0) is never read as a stated value.
- **The setup page replaces a routine value** (leaving it empty means "not sure" and clears it); **a sentence merges** (it says nothing about the rest).
- **Setup is complete when one subject has one topic.** That sets `onboardingComplete`; year, goals and the rest are not asked. The Planning Engine then has `new_material` blocks to offer at once.
- **Before setup is complete** a message on either surface runs `interaction/setup-turn.ts`: one reading, the decision, and either a setup offer, a confirmation, or the one thing Nova still needs. No Response Brain, no canonical turn. The older conversation in `nova/onboarding/` is no longer called by any surface.
- **The personality quiz is separate** and unchanged: it sets the companion and the tone, and nothing here reads it.

## Learning context: school, college, work

Held by `learning-context.test.ts`. One product for every learner; what they are learning for changes words and order, never a decision.

- **The answer** is any of `school`, `college`, `working`, `other`, alone or together (`product/learning-context.ts`, pure). The quiz asks it after the goal ("What are you learning for?", skippable); the setup form shows it as chips and saves a change at once through `PATCH /api/settings { learningContexts }`.
- **Where it is kept.** With the other onboarding answers, at `UserProfile.onboardingAnswers.learningContexts`. There is no column for it: this was chosen to avoid a schema change, and a `learningContexts String[]` column would be the clean home if one is ever approved. `adapters/account-preferences-adapter.ts` is the only reader in Nova (`loadLearningContexts`, `learningContextsIn`); onboarding and Settings are the only writers. A stored value that is not a list of known contexts reads as "not said".
- **What it changes.** `setupVocabulary` picks one of four vocabularies (`general`, `school`, `college`, `outcome`; someone both studying and working gets `general`): the setup form's labels, and the one question setup asks next (`nextSetupQuestion` reads `SetupFacts.learningContexts`). `templatesFor` orders the starting points with the fitting ones first; nobody loses a template. A date saved without a name is called "… exam" or, for `outcome`, "… target date". `learningContextLine` adds one line to Nova's context, as the learner's own answer.
- **The `outcome` vocabulary names no school, term, syllabus, exam, subject or chapter.** A test reads every word of it. Keep it that way when adding a label.
- **What it does not change.** The gaps setup looks for and their order, the Planning Engine, every decision, and what is saved. A test reads the engines and decisions to hold that none of them imports it.
- **A learner who has not said** keeps the chat questions setup always asked (the integration tests assert those strings) and gets the neutral form labels.
- **Not adapted yet:** the static prompts still say "student", the Understanding Brain's setup reading is still worded around subjects, and Today's reasons still say "exam". None was run against a real model with a professional's messages.

## Goals: what the learner is working toward

Held by `goals.test.ts` and `nova-goals.itest.ts`. `product/goals.ts`, `GET`/`PUT /api/nova/goals`, editor in `apps/web/components/nova/goals-editor.tsx` (on `/settings/study`).

- **One store.** `NovaAcademicProfile.goals`: up to three lines of the learner's own text (`GOALS_MAX`, `GOAL_TEXT_MAX` in `goals.types.ts`). Today, the Planner, Progress and Nova's context read that field. Do not add a second goal field or read `UserProfile.primaryGoal30d` anywhere else in Nova.
- **The sign-up answer is copied once.** The quiz stores it on the web account (`primaryGoal30d`). `seedGoalFromSignup` supplies it to the `create` half of the upserts that make a Nova profile (`saveSetup`, `ensureSetupProfile`) and to nothing else. Those upserts keep `update: {}`, so a profile that exists is never reseeded.
- **A saved list replaces the list; an empty one clears it**, and a cleared goal stays cleared through later setup saves. Goals saved before setup make the profile with exactly that list. A list that is too long, or holds a goal that is, is refused whole: nothing is cut to fit. Validation is bounded: `normalizeGoals` stops at the fourth distinct goal and never processes an entry far over the limit, and the route reads the body through `readSmallJson` (`GOALS_BODY_MAX_BYTES`), refusing a larger one unread.
- **A goal is a statement of intent.** It is not evidence, mastery or memory, feeds no engine and does not change the plan. Nova does not track completion.
- **In Nova's context** the goals are their own short section (`buildGoalsSection`), included in the full layer and, in a focused layer, only when `contextNeeds` names `goals`: ordinary conversation, and a question about the learner that names no topic and asks for no action ("what am I working toward?", "am I on track?"). Starting a session, saying how long they have, "what now", a question about a topic and a question about the subject matter get none of it. Having the plan in context is not a reason to include the goal. With no goal the section is absent.
- **Who the learner is, in the prompt, is only what is on record**: `MessengerUser.displayName` when there is one (flattened to one line, at most 60 characters), and year, major and institution only when set. No placeholder stands in for a missing value.

## Integration tests (real Postgres)

`npm run test:integration` in `packages/api` runs the `__integration__/*.itest.ts` files against the database in `NOVA_TEST_DATABASE_URL`. They refuse to run without it and refuse the host in `packages/db/.env`. A local throwaway works:

```sh
docker run -d --rm --name nova-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=novatest -p 127.0.0.1:54329:5432 postgres:16-alpine
export NOVA_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest
(cd packages/db && DATABASE_URL=$NOVA_TEST_DATABASE_URL DIRECT_URL=$NOVA_TEST_DATABASE_URL npx prisma db push)   # set BOTH: prisma.config.ts prefers DIRECT_URL
(cd packages/api && npm run test:integration)
```

The files run one at a time (`--test-concurrency=1`): a proactive tick visits every learner in the database, so two files ticking at once would act on each other's learners.

`nova-lifecycle.itest.ts` follows a new account: a learner with no Telegram, the whole study loop on the web alone, a first session with no topics on record, connecting Telegram (same row, refusals, a spent token), web and Telegram as two views of one learner, a web sentence that runs no session command, and one learner's evenings of proactive ticks (rank, spacing, session, a failed send held and retried, a blocked bot). `nova-telegram.itest.ts` covers Telegram end to end with Telegram and both models stood in: sessions shared with the web app, prompts answered once, linking, limits, model failure, and the proactive outbox. `nova-learning-dna.itest.ts` covers the refresh on session end and the timezone write. `nova-progress.itest.ts` is the only proof that a replayed or concurrent session report moves a topic once (the unique key and the rollback need a real database). `nova-session-start.itest.ts` is the only proof of the session-start lock: concurrency cannot be shown against a mock. Two tests in `nova-persist-turn.itest.ts` fail because of the fixture's own timeline (its turns span four days, but an illness expires after 72 hours); they are not product failures.
`nova-learning-dna.itest.ts` covers the refresh on session end and the timezone write. `nova-learning-events.itest.ts` covers pairing, the extension credential's lifetime, idempotent events and the save → study → session path. `nova-progress.itest.ts` is the only proof that a replayed or concurrent session report moves a topic once (the unique key and the rollback need a real database). `nova-session-start.itest.ts` is the only proof of the session-start lock: concurrency cannot be shown against a mock. Two tests in `nova-persist-turn.itest.ts` fail because of the fixture's own timeline (its turns span four days, but an illness expires after 72 hours); they are not product failures.

## Guide

`/guide` is one address with two guides: `app/(dashboard)/guide/page.tsx` reads the companion from `useDashboardCompanion()` (a context the dashboard shell provides) and renders `components/guide/nova-guide.tsx` or `components/guide/rex-guide.tsx`. Nova's guide is static copy describing behaviour that exists: when a Telegram command, the extension's permissions or popup labels, the ten-minute session rule or a nav page changes, change the guide with it.

## Saving a link (web app and bookmarklet)

A saved page has one way in: `POST /api/nova/learning-events` → `recordLearningEvent` (`product/learning-events.ts`). It has two callers. A request with `Authorization: Bearer` is the extension's; one without is the signed-in web app's (`handleWebSave`: session cookie, JSON content type, `resource_saved` only, `source: "web"`). Do not add another save endpoint or table.

- `product/resource-link.ts` is pure and shared with the browser: `normalizeResourceUrl` (the one definition of an address Nova keeps), `checkLink` for typed input, `titleFromUrl`, and the bookmarklet (`bookmarkletCode`, `readCapture`). It has no regex and no imports beyond the types file; tests hold both.
- Nova never fetches a saved address, so a pasted link's title is read off the address and the learner edits it.
- The bookmarklet opens `/saved#save=<address>&title=<title>`. The capture is in the fragment (not sent to a server) and carries no credential. `components/nova/saved/pending-capture.ts` takes it once; the sign-in page parks it in `sessionStorage` for ten minutes when the learner was signed out.
- Nothing is saved until the learner presses Save: a capture only opens the review.
- The release ZIP for the store comes from `npm run package --workspace nova-extension`; listing and privacy drafts are in `apps/extension/store/`.

## Daily check-in and proactive timing

Nova has one scheduler path for speaking first: the five-minute tick (`apps/api/lib/internal-checkin-scheduler.ts` → `checkin-cron.ts` → `nova/proactive/nova-proactive-cron.ts`) → `decideProactive` → the outbox (`proactive-outbox.ts`). The daily check-in is a fifth reason in that decision (`daily_checkin`), not a second job. Do not add another timer, queue or outbox for it.

- **What the onboarding time means.** `UserProfile.preferredCheckInTime` ("HH:MM", written by web onboarding and by Settings → Check-ins via `PATCH /api/settings`) is the start of a window of `CHECKIN_WINDOW_MINUTES` (180) in the learner's local day. A tick anywhere inside the window delivers; after it the check-in has expired and is not sent late. It replaces the study-window `daily_nudge` for that learner, needs no plan (with nothing to recommend it asks one question), counts as the day's one push to study, and is skipped when they have studied today or have already written to Nova since the time came round. A time inside quiet hours is honoured because the learner chose it. `UserProfile.nextMessageTime` and `messageSchedule` are legacy fields nothing reads.
- **Where Nova reads account preferences.** `adapters/account-preferences-adapter.ts` only: the check-in time and the browser-reported timezone. `ensureLearnerTimezone` copies a valid account timezone onto `NovaAcademicProfile.timezone` while that is unset; the tick and the Telegram turn both call it, and the dashboard shell reports the device timezone once per visit. A learner with no timezone anywhere is not messaged first and is counted as `no_timezone`.
- **Observability.** Each tick logs one `{"layer":"nova_proactive","tick":"done", checked, sent, errors, outcomes}` line; `outcomes` counts how each learner ended (`sent`, `send_failed`, `held`, `no_timezone`, `quiet_hours`, `proactive_off`, `undeliverable`, `not_ready`, `nothing_due`, `suppressed`). `GET /api/health` returns the same counts for the last tick plus `startedAt` and `stale`.
- **Hosting.** The tick only runs while the API process is awake. On Render's free plan it sleeps; `.github/workflows/keep-api-awake.yml` is a stopgap, not a guarantee.
- **Tone.** `UserProfile.accountabilityStyle` ("soft" = Gentle Nudges, "hard" = No Mercy) reaches wording only, through `chooseRegister` (`decision/register.ts`): `gentle`, `playful` (firm), `steady` when unset, and `serious` overriding all three on distress, a hard stretch or an exam within three days. No decision reads it.
- **Language.** A reply follows the message it answers. Devanagari is decided from the script (`scriptLanguage`, `interaction/language.ts`) with no model; English versus Hinglish is the reading's. Fixed lines have no Devanagari table: Hindi uses the Roman-script Hindi ones.
- **Exam attribution.** Exam prep blocks and the "exam in N days" reason belong to the exam's own subject (`examCoversSubject`, `engines/exam-engine.ts`); an exam with no subject on record covers the syllabus.

## What the record changes in the plan

Learning DNA (`engines/learning-dna-engine.ts`) already grades each conclusion `unknown` / `emerging` / `supported` / `strong` and flags one its latest evidence is pulling away from (`weakening`). A conclusion may change a decision only at `supported` or stronger and not weakening, and only through the engines, never through a prompt. Two do today:

- `usual_study_window` times the study-window nudge (`nova-proactive-cron.ts`), unless the learner chose a check-in time.
- `typical_session` caps block length (`usualSessionMinutes` in `product/planning-inputs.ts` → `PlanOptions.usualSessionMinutes` → `sessionCap` in `engines/planning-engine.ts`). It only shortens, never under `MIN_BLOCK_MINUTES`, and not when the learner said how long they have today.

The other signals (`plan_follow_through`, `days_per_week`, `best_session_size`, `best_study_window`, `revision_spacing`, `needs_more_retrieval`) are shown on the Learning DNA page and reach no decision. Wiring one in means a new `PlanOptions` field or decision fact with the same evidence gate, and a test in `__tests__/learner-adaptation.test.ts`.

## Web and API deploy separately

Vercel deploys `apps/web` on every merge to `main`; Render deploys `apps/api` only on Manual Deploy. A web change that needs a new API behaviour will reach users before the API does. `GET /api/health` reports the API's `commit`. The web app must not treat an unexpected API answer as "signed out": `saveLink` (`components/nova/saved/saved-api.ts`) checks `/api/me` before believing a 401.
