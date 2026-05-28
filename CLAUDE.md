# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
