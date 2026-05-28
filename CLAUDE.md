# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<<<<<<< HEAD
## Commands

All commands run from the repo root (`my-turborepo/`).

```bash
# Development (all apps)
npm run dev

# Development (single app)
npx turbo dev --filter=web
npx turbo dev --filter=api

# Build
npm run build

# Type checking
npm run check-types

# Lint
npm run lint

# Format
npm run format

# Prisma — generate client after schema changes
npx prisma generate --schema packages/db/prisma/schema.prisma

# Prisma — run migrations (dev)
npx prisma migrate dev --schema packages/db/prisma/schema.prisma

# Prisma — push schema without migration (quick local iteration)
npx prisma db push --schema packages/db/prisma/schema.prisma
```

`apps/api` runs on port 3001; `apps/web` runs on port 3000.

## Architecture

This is a Turborepo monorepo for **Kevo**, an AI accountability companion delivered via Telegram and a web onboarding flow.

### Apps

- **`apps/api`** — Next.js API-only server deployed to Railway. All routes live under `app/api/`. The Telegram webhook (`/api/telegram`) is the core runtime loop.
- **`apps/web`** — Next.js marketing site + web onboarding, deployed to Vercel. Contains the landing page, auth flows, and personality quiz. Protected routes (`/dashboard`, `/onboarding`, `/settings`) are guarded by `middleware.ts` using a JWT cookie named `kevo_session`.

### Shared Packages

- **`packages/api`** — All core business logic. Imported by both apps as `@repo/api`. Nothing in here knows about HTTP.
- **`packages/db`** — Prisma client wrapper (`@prisma/adapter-pg` for serverless-compatible pooling). Exported as `@repo/db/client`. Schema lives at `packages/db/prisma/schema.prisma`.
- **`packages/ui`** — Minimal shared React component stubs.

### Message Processing Pipeline (Telegram)

Every inbound Telegram message goes through this chain in `apps/api/app/api/telegram/route.ts`:

1. **`messageProcessor`** (`packages/api/src/processor/messageProcessor.ts`) — NLP: detects intent, emotion, and entities (goals, deadlines, focus duration).
2. **Gym short-circuit** — If `gymUserId` is present and intent is gym-related, `gym.service` handles it and returns early.
3. **`contextBuilder`** (`packages/api/src/context/contextBuilder.ts`) — Fetches the `MessengerUser`, assembles short-term + long-term memory, detects conversation mode, and resolves the active persona.
4. **`decision.engine`** (`packages/api/src/services/decision.engine.ts`) — Routes to a handler type (`focus_start`, `planner_ai`, `deadline`, `progress`, `weekly_review`, `emotional`, or `llm`).
5. **Handler** — Executes the appropriate service (focus timer, AI planner, etc.) or falls through to OpenAI via `generateResponse` in `packages/api/src/services/llm.ts`.
6. **`memory.service`** — Persists the conversation turn and any extracted entities to the DB.

### Data Model — Two User Identities

The schema has two separate user types that are deliberately not joined:

- **`User`** — NextAuth/web users. Has `UserProfile` (one-to-one) which stores onboarding quiz results and gym settings.
- **`MessengerUser`** — Telegram users, keyed by `(platform, platformChatId)`. Has its own `CompanionMessage`, `MemoryFact`, `Goal`, `Deadline`, and `FocusSession` relations.

Gym tracking tables (`WorkoutLog`, `LiftLog`, `SorenessLog`, `BodyweightLog`, `EnergyLog`, `InjuryFlag`) belong to `User`, not `MessengerUser`.

### Personas

Eight companion personas are defined in `packages/api/src/services/personna.service.ts`: Rex (hard/direct), Nova (warm/calm), Vera (structured), Zen (philosophical), Spark (high-energy), Compass (strategic), Anchor (stable), Lingua (adaptive). Default fallback is Nova. The active persona is stored per `MessengerUser.persona`.

### Auth

- Web app uses JWT cookies (`kevo_session`) validated with `jose`. Email/password and Google OAuth are both supported.
- `apps/web/middleware.ts` enforces auth on protected routes.
- `apps/api/lib/auth/session.ts` handles session creation/verification for the API app.

### Environment Variables

Each app has its own `.env`. Required variables for `apps/api` (and Railway):
- `DATABASE_URL` — PostgreSQL connection string (same value used in `packages/db/.env`)
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`, `OPENAI_MODEL` (e.g. `gpt-4.1-mini`)
- `JWT_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### Deployment

- **Railway** builds with `npx prisma generate --schema packages/db/prisma/schema.prisma && npm run build --workspace api`, then starts `npm run start --workspace api`. Health check endpoint: `/api/health`.
- After Railway deploys, set the Telegram webhook URL to `https://<railway-domain>/api/telegram`.
- **Vercel** deploys `apps/web` directly.
=======
## Overview

Kivo is a Telegram/WhatsApp AI companion that tracks fitness, goals, and deadlines — no app required. It runs as a Turborepo monorepo with a Next.js frontend (Vercel), a Next.js API backend (Railway), and a shared Prisma/PostgreSQL data layer (Neon).

## Development Commands

From the root (runs all workspaces via Turbo):

```bash
pnpm dev          # Start all apps (web on :3000, api on :3001)
pnpm build        # Build all workspaces
pnpm lint         # Lint all workspaces
pnpm check-types  # TypeScript type check all workspaces
pnpm format       # Prettier format all .ts/.tsx/.md files
```

Run a single workspace:

```bash
pnpm --filter web dev         # Frontend only
pnpm --filter api dev         # Backend only
pnpm --filter @repo/db ...    # DB package commands
```

Database migrations (run from `packages/db`):

```bash
pnpm --filter @repo/db exec prisma migrate dev
pnpm --filter @repo/db exec prisma generate
pnpm --filter @repo/db exec prisma studio
```

There are no test scripts configured.

## Monorepo Structure

```
apps/
  web/   — Next.js 16 frontend (marketing site + auth + onboarding dashboard)
  api/   — Next.js 16 backend (all /api/* routes, Telegram webhook, cron endpoints)
packages/
  api/   — Shared business logic: services/, processor/, context/
  db/    — Prisma client + schema (PostgreSQL via Neon)
  ui/    — Shared shadcn/ui component library
  eslint-config/ & typescript-config/ — Shared tooling configs
```

## Architecture

### Request Flow

**Telegram messages:**
`POST /api/telegram` (apps/api) → `packages/api/processor/messageProcessor` (intent extraction) → `packages/api/services/decision.engine` (routing) → specific service (gym, planner, deadline, focus, etc.) → OpenAI gpt-4o via `packages/api/services/llm.ts` → reply via Telegram Bot API → persist to DB.

**Web frontend:**
`apps/web` calls `/api/*` which Next.js rewrites to the Railway backend (`apps/api`) on port 3001 in development. Auth is handled with JWT (jose) and Google OAuth (next-auth).

**Scheduled check-ins:**
Vercel cron (`*/5 * * * *`) hits `POST /api/checkin` → `checkin.service.generateCompanionVisit()` → sends proactive Telegram messages.

### Key Packages

- **`packages/api/services/`** — all business logic: `llm.ts`, `memory.service`, `checkin.service`, `gym.service`, `gymCron.service`, `decision.engine`, `planner.service`, `deadline.service`, `focus.service`, `review.service`, `formatter.service`, `rateLimit.service`, `user.service`
- **`packages/api/processor/`** — message parsing and intent classification
- **`packages/api/context/`** — builds LLM context from user memory, history, and profile
- **`packages/db/prisma/schema.prisma`** — single source of truth for all data models

### Database Models (Prisma / PostgreSQL)

Core domains in the schema:
- **Auth:** `User`, `Account`, `Session` (NextAuth tables)
- **Companion:** `MessengerUser` (Telegram/WhatsApp state, persona, tier), `CompanionMessage`, `MemoryFact`
- **Goals & Productivity:** `Goal`, `Plan`, `Deadline`, `FocusSession`
- **Fitness:** `WorkoutLog`, `LiftLog`, `SorenessLog`, `EnergyLog`, `InjuryFlag`, `BodyweightLog`
- **Compliance:** `Product`, `ScanJob`

### Authentication

Two methods are supported:
1. Email + password — bcrypt hashing, JWT (jose) session tokens
2. Google OAuth — next-auth with Google strategy

The `apps/web/next.config.js` rewrites `/api/**` to `http://localhost:3001` in development so the frontend and backend remain separate deployments.

## Environment Variables

Required in `.env` at the root (see the existing `.env` for actual values):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string (pooled) |
| `DIRECT_URL` | Neon direct connection (used by Prisma migrations) |
| `OPENAI_API_KEY` | OpenAI API key (gpt-4o) |
| `JWT_SECRET` | Signing secret for session JWTs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `NEXT_PUBLIC_APP_URL` | Public URL of the web app |

## Deployment

- **Frontend:** `apps/web` → Vercel. Cron jobs defined in `vercel.json`.
- **Backend:** `apps/api` → Railway. Config in `railway.json`. Listens on `$PORT` (defaults to 3001).
- **Database:** Neon PostgreSQL. `prisma generate` runs as part of `postinstall`.
>>>>>>> a51671498b1a78c2f5881a550a4f39addaaf076e
