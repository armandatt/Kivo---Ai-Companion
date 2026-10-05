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

### Web to API

`apps/web` owns only `/api/login`, `/api/signup` and a few local handlers. Every other `/api/*` call is proxied to `apps/api` by the `rewrites()` list in `apps/web/next.config.js` (target `API_URL`, default `http://localhost:3001`). **A new API route that the web app calls needs a rewrite entry there**, or it returns 404 from the web origin.

Auth is a JWT cookie named `kevo_session`, verified with `jose`. `apps/web/middleware.ts` guards the protected routes; `apps/api/lib/auth/session.ts` creates and verifies sessions. Email/password and Google OAuth are both supported.

### Telegram webhook: an ordered chain of gates

`POST /api/telegram` is a long sequence of early returns. Order is the behaviour, so read the surrounding gates before inserting one.

0. **Transport safety** (`services/telegramTransport.service.ts`): secret-token check, then `update_id` dedup in Postgres (`ProcessedTelegramUpdate`). A replayed update returns 200 and reaches no pipeline. Applies to every persona.
1. Profile update, then `/start <token>` handling (links a web account to a chat).
2. **Persona branch.** If `MessengerUser.persona === "nova"`, the message goes to the Nova pipeline and nothing below runs. Everything below is Rex.
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

### Proactive messaging

`runCheckinCron` in `apps/api/lib/checkin-cron.ts` sends dynamic check-ins, custom reminders, gym cues and Nova proactive messages. It is driven by an in-process 5-minute `setInterval` started from `apps/api/instrumentation.ts` (disable with `DISABLE_INTERNAL_CHECKIN_CRON=true`), and is also exposed as `GET /api/checkin` on the API app. The root `vercel.json` still declares a cron for `/api/checkin`, but the web app has neither that route nor a rewrite for it.

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

`BODYWEIGHT_INTELLIGENCE_ENABLED`, `RECOVERY_INTELLIGENCE_ENABLED`, `NUTRITION_INTELLIGENCE_ENABLED` and `GOAL_PROGRESS_ENABLED` gate individual Rex evidence blocks.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | both | Neon PostgreSQL pooled connection |
| `DIRECT_URL` | api | Neon direct connection, used by the Prisma CLI |
| `TELEGRAM_BOT_TOKEN` (or `BOT_TOKEN`) | api | Telegram Bot API token |
| `GEMINI_API_KEY` | api | When set, every model call goes to Gemini. `GEMINI_MODEL_FAST` / `GEMINI_MODEL_MAIN` override the defaults |
| `OPENAI_API_KEY` | api | Used only when `GEMINI_API_KEY` is empty or `LLM_PROVIDER=openai`. `OPENAI_MODEL` overrides the default OpenAI model |
| `TELEGRAM_WEBHOOK_SECRET` | api | Must equal the `secret_token` given to Telegram's `setWebhook`. Unset: webhook requests are not authenticated |
| `JWT_SECRET` | both | Signs session JWTs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | api | Google OAuth |
| `API_URL` | web | Base URL of `apps/api` for the rewrites |
| `NEXT_PUBLIC_APP_URL` | web | Public URL of the web app |
| `NEXT_PUBLIC_BOT_USERNAME` / `BOT_USERNAME` | web / api | Bot username without `@`, for "open chat" links and the `?start=TOKEN` deeplink |

## Deployment

- **Render** (`render.yaml`, steps in `RENDER_DEPLOYMENT.md`) is the target host for `apps/api`: one always-on web service, one instance, health check `/api/health`. The 5-minute scheduler runs inside that process, so there is no Render Cron Job or worker; adding one would run every job twice. `DISABLE_INTERNAL_CHECKIN_CRON=true` turns the scheduler off on a host.
- **Railway** (`railway.json`, `RAILWAY_DEPLOYMENT.md`) is the previous host, kept until Render is verified. Only one of the two may run the scheduler or receive the Telegram webhook at a time.
- **Vercel**: Root Directory `apps/web`; `apps/web/vercel.json` runs `prisma generate` before the build.
- `prisma generate` is not a `postinstall` step. Run it by hand after a fresh install or a schema change.

## Nova on the web (Home → Start session)

The web app renders Nova's decisions; it does not make them. Three routes, all resolving the signed-in account to its Nova learner through `apps/api/lib/nova/resolve-learner.ts`:

- `GET /api/nova/today?minutes=` returns `NovaTodayView`, built by `packages/api/src/nova/product/today.ts` from the existing engines. No LLM call.
- `POST /api/nova/session` (`start` / `pause` / `resume` / `end`) and `GET /api/nova/session`: deterministic session commands. They call the same session writers a chat turn uses (`persistence/nova-persistence.ts`), so do not add a second place that writes `NovaStudySession`.
- `POST /api/nova/message` runs a normal Nova turn (used for onboarding and "tell Nova" boxes).

Contracts live in `packages/api/src/nova/product/today.types.ts` (no imports, so the web app imports the types directly). UI is in `apps/web/components/nova/`; `app/(dashboard)/home/page.tsx` renders the Rex home (`components/home/rex-home.tsx`) when the status is `not_nova`. Never add ranking or recommendation logic to React: add a field to the contract instead. The focus timer is derived from the server's `elapsedSeconds`; the page keeps no session state of its own.

**Planner** (`GET /api/nova/planner?minutes=`, `product/planner.ts`, UI in `apps/web/components/nova/planner/`). Home and Planner both start from `product/planning-inputs.ts`, so they show the same plan. Things to know before changing it:

- Plans are not stored. The Planning Engine (`generateStudyPlan`) is run on every request and only plans **today**; its `thisWeek` is always empty. The week view shows recorded sessions, today's blocks, reviews the retention schedule has falling due, and exams. Do not fill later days with invented blocks.
- `minutes` goes to the engine as `availableMinutes`, which refits the whole day. It can shorten a wellbeing cap or exam ramp but never lift one. `StudyPlan.budgetBasis` says which rule set the day's length; the "Why this plan" adjustments are worded from it.
- `engines/adaptive-planning-engine.ts` is not called by anything. Its output is not applied to any plan, so the Planner does not show it.
- There is no per-block skip or reschedule: nothing stores a block to move.

Session rules that must hold:

- **One meaning of "session ended".** The web End button is `/done` without a chat turn: `persistSessionEnd` builds the same command-established `study_report` signal, routes it through `computeSessionAction` and the shared `sessionLifecycle` (the function `persistTurn` uses), and hands the same evidence to `consolidateTurn`. Do not write a second end path.
- **One clock.** `engines/session-clock.ts` defines study time (`sessionElapsedSeconds`). Paused time is kept in `NovaStudySession.totalPausedSeconds`; `totalPausedMinutes` is only its floor. Pause and resume are written only by `pauseStudySession` / `resumeStudySession`.
- **Conditional writes.** Pause, resume and end use `updateMany` guarded on the expected state, so a repeated or concurrent command writes nothing and an execution report is consumed once.
