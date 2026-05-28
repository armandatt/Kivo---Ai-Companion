# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
