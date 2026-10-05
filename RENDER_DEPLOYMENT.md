# Render API Deployment

```
Vercel (apps/web)  →  Render (apps/api)  →  Neon PostgreSQL
```

Render replaces Railway as the host of `apps/api`. Neon stays the database; nothing is migrated. Render reads `render.yaml` at the repository root.

## What runs where

| Piece | Host | Notes |
|---|---|---|
| `apps/web` | Vercel | Unchanged. Proxies `/api/*` to `API_URL` |
| `apps/api` | Render web service `kivo-api` | Long-running Next.js server, one instance |
| Database | Neon | Unchanged |
| Scheduled jobs | Inside the `kivo-api` process | No Render Cron Job, no worker |

- Build: `npm install --include=dev && npx prisma generate --schema packages/db/prisma/schema.prisma && npm run build --workspace api`
- Start: `npm run start --workspace api` (listens on Render's `$PORT`)
- Health check: `/api/health`

Two constraints come from the application itself:

- **Always-on plan for real use.** The scheduler is a timer inside the API process. `render.yaml` starts on the free plan, which is enough to verify the deploy, but a free instance sleeps after about 15 minutes without traffic: scheduled jobs stop and Telegram waits through a cold start. Switch `plan` to `starter` before cutover.
- **Exactly one instance.** Per-chat locks and the scheduler's "already running" guard live in process memory. Two instances would send every scheduled message twice.

## Scheduled jobs: who runs what

All jobs run from one 5-minute tick (`apps/api/lib/internal-checkin-scheduler.ts` → `runCheckinCron`).

| Job | Runs in |
|---|---|
| Telegram dedup cleanup (`ProcessedTelegramUpdate`, 7 days) | `kivo-api` process |
| Dynamic check-ins ("check me in 30 min") | `kivo-api` process |
| Custom reminders | `kivo-api` process |
| Rex gym cues | `kivo-api` process |
| Nova consolidation retries | `kivo-api` process |
| Nova proactive mentor | `kivo-api` process |

Only one backend may run the scheduler at a time. `DISABLE_INTERNAL_CHECKIN_CRON=true` turns it off. During the migration it is `true` on Render until cutover, and set to `true` on Railway at cutover.

Do not create a Render Cron Job for `/api/checkin`. That endpoint runs the same jobs, so a cron job plus the in-process scheduler would double every message. The root `vercel.json` also declares a cron for `/api/checkin`; the web app has no such route, so it does nothing.

## Environment variables

Set in the Render dashboard. None are in `render.yaml`.

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes, at build and runtime | Neon pooled connection string |
| `DIRECT_URL` | for Prisma CLI only | Neon direct connection string |
| `GEMINI_API_KEY` | yes (or `OPENAI_API_KEY`) | When set, every model call goes to Gemini. Free keys come from Google AI Studio |
| `OPENAI_API_KEY` | only without Gemini | Used when `GEMINI_API_KEY` is empty, or when `LLM_PROVIDER=openai` |
| `GEMINI_MODEL_FAST`, `GEMINI_MODEL_MAIN` | no | Override the default Gemini models (both `gemini-3.5-flash-lite`; on a paid key set `GEMINI_MODEL_MAIN=gemini-flash-latest`) |
| `TELEGRAM_BOT_TOKEN` | yes | |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Any long random string; reused in `setWebhook` below |
| `JWT_SECRET` | yes | Same value as on Vercel |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | |
| `GOOGLE_REDIRECT_URI` | for Google sign-in | `https://<web-domain>/api/auth/google/callback`. It points at the web domain, so it does not change with this migration |
| `NEXT_PUBLIC_APP_URL` | yes | `https://<web-domain>` |
| `BOT_USERNAME` | yes | Bot username without `@` |
| `OPENAI_MODEL` | no | OpenAI only. Ignored when Gemini is the provider |
| `MENTOR_V3_ENABLED`, `ONBOARDING_V3_ENABLED` | copy from Railway | Off unless set to `true` |
| `DISABLE_INTERNAL_CHECKIN_CRON` | set by `render.yaml` | `true` until cutover |
| `NODE_VERSION` | set by `render.yaml` | `22.14.0` |

Copy every other variable that is set on Railway (for example `COGNITIVE_LAYER_V5_ENABLED`, `PHASE3_CONTEXT_ENABLED`). A flag that differs between the two hosts changes behaviour.

## Before the first deploy

1. **Rotate the Neon password** and use the new connection strings everywhere. The old one is in git history.
2. **Push the Prisma schema** to Neon: `cd packages/db && npx prisma db push`. It must be run from `packages/db`: the Prisma config there loads `.env` from the current directory. The changes are additive, so the code running on Railway is unaffected. The new code fails on Nova turns without them.
3. **Commit and push** the working tree. Render builds from GitHub, and the commit currently on `main` does not build.

## Deploy

1. Render dashboard → New → Blueprint → connect the GitHub repository → select `render.yaml`.
2. Fill in the environment variables above. Leave `DISABLE_INTERNAL_CHECKIN_CRON` as `true`.
3. Deploy. Auto-deploy is off, so later deploys are manual until you turn it on.
4. Check health: `curl https://<render-domain>/api/health` → `{"ok":true}`.
5. Check the logs for `Internal scheduler disabled by DISABLE_INTERNAL_CHECKIN_CRON=true`. That confirms Render is not yet sending anything.

At this point Render is running but takes no traffic. Railway is still live.

## Cutover

Do these in order, in one sitting.

1. **Stop Railway's scheduler:** set `DISABLE_INTERNAL_CHECKIN_CRON=true` on Railway and let it restart.
2. **Start Render's scheduler:** set `DISABLE_INTERNAL_CHECKIN_CRON=false` on Render and let it restart. The log shows `Internal scheduler started; interval=5m`.
3. **Point Telegram at Render:**

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://<render-domain>/api/telegram" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
   ```

   `getWebhookInfo` should show the Render URL and no `last_error_message`.
4. **Point Vercel at Render:** set `API_URL=https://<render-domain>` in the Vercel project, then **redeploy** the web app. The proxy rules are baked in at build time, so changing the variable alone does nothing.

## Smoke test

- Send the bot a message; it replies once.
- Render logs show the turn and, for a Nova user, a `nova:consolidation` line.
- Sign in on the web app and load the dashboard (exercises the Vercel → Render proxy and the JWT secret).
- Wait for one scheduler tick (`[CHECKIN] Cron fired at ...`) in the Render logs, and confirm Railway's logs show none.

## Rollback

Railway stays deployed until Render has been verified for a few days. To go back:

1. `DISABLE_INTERNAL_CHECKIN_CRON=true` on Render, then `false` on Railway.
2. `setWebhook` back to `https://<railway-domain>/api/telegram`.
3. `API_URL` on Vercel back to the Railway URL, and redeploy the web app.

Both backends use the same Neon database and the schema changes are additive, so no data moves in either direction. State held only in process memory (per-chat locks, a pending "want a check-in?" offer) is lost on any switch; it rebuilds on the next message.

## Retire Railway

Only after Render has run cleanly: delete the Railway service, then remove `railway.json` and `RAILWAY_DEPLOYMENT.md` from the repository.
