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

Only one backend may run the scheduler at a time. `DISABLE_INTERNAL_CHECKIN_CRON=true` turns it off. Render is the backend that runs it: `render.yaml` sets the flag to `false`. Any other host that is still deployed (the old Railway service) must have it set to `true`.

`GET /api/health` says what this process is doing: `scheduler.state` is `running` or `disabled`, with `lastTickAt` and `lastTickOk`. A `running` scheduler whose `lastTickAt` is more than ten minutes old means the process was asleep (free plan) or the tick is failing.

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
| `JWT_SECRET` | yes | Same value as on Vercel. The API refuses to sign or check sessions without it, and uses it to recognise requests forwarded by the web app |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | |
| `RESEND_API_KEY` | for email sign-up and password reset | Resend API key. Without it no verification code or reset link can be sent, so nobody can sign up by email |
| `RESEND_FROM_EMAIL` | with `RESEND_API_KEY` | A sender on a domain verified with Resend. The default, `onboarding@resend.dev`, only delivers to the Resend account's own address |
| `GOOGLE_REDIRECT_URI` | for Google sign-in | `https://<web-domain>/api/auth/google/callback`. It points at the web domain, so it does not change with this migration |
| `NEXT_PUBLIC_APP_URL` | yes | `https://<web-domain>` |
| `BOT_USERNAME` | yes | Bot username without `@` |
| `OPENAI_MODEL` | no | OpenAI only. Ignored when Gemini is the provider |
| `MENTOR_V3_ENABLED`, `ONBOARDING_V3_ENABLED` | copy from Railway | Off unless set to `true` |
| `DISABLE_INTERNAL_CHECKIN_CRON` | set by `render.yaml` | `false`: Render runs the scheduler. Set `true` here only to hand it to another host |
| `CRON_SECRET` | recommended | When set, `GET /api/checkin` requires `Authorization: Bearer <value>`. The in-process scheduler does not use that endpoint and is unaffected |
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

## Keeping the scheduler running (read this before relying on check-ins)

Everything Nova and Rex send first (daily check-ins, nudges, exam countdowns, reminders) comes from one timer inside this API process. **While the process is asleep, nothing is sent.** Render's free plan puts the service to sleep after about 15 minutes without traffic.

What was measured on 2026-10-11: the `keep-api-awake` GitHub workflow was scheduled every 10 minutes and GitHub actually started it about every 6 hours (19 runs, median gap 354 minutes), so the scheduler was awake for roughly 25 minutes in every six hours. A check-in window is three hours long; most were missed.

Options, simplest first:

| Option | Cost | Reliability | What to do |
|---|---|---|---|
| **A non-sleeping instance (recommended)** | Render Starter, about US$7/month | The timer runs continuously. Restarts and deploys are covered by the delivery window and the outbox claim. | Render dashboard → kivo-api → Settings → Instance Type → Starter. Keep `numInstances: 1`. |
| An uptime monitor pinging `/api/health` every 5 minutes (**in use**: UptimeRobot) | Free (UptimeRobot, cron-job.org, Better Stack) | Good while the monitor runs; pings are on time, unlike GitHub schedules. Still a free-plan service that Render may restart or throttle. | Create an HTTP monitor for `https://<api-host>/api/health`, 5-minute interval. |
| The GitHub workflow (removed 12 Nov) | Free on a public repository, but it held a runner almost continuously | Best effort only. There was a gap between one run ending and GitHub starting the next. | `.github/workflows/keep-api-awake.yml` was deleted once UptimeRobot was pinging: two pingers did nothing one does not. Restore it from git history only if the monitor is turned off. |
| An external scheduler calling `GET /api/checkin` | Free to cheap | Not recommended alongside the in-process timer: both would tick. Nova's outbox prevents a second Nova message, but Rex's reminders have no such claim and could be sent twice. | Only if the in-process timer is turned off (`DISABLE_INTERNAL_CHECKIN_CRON=true`) and `CRON_SECRET` is set; the endpoint is closed in production without it. |

Do not run more than one of these that *ticks* the scheduler. Pinging `/api/health` is safe to do from several places: it starts the timer if it is not running and never runs a tick itself.

### Checking it

`GET /api/health/scheduler` is the one to point a second monitor at. `/api/health` answers 200 whenever the process is up, which is what Render's own health check needs, so a timer that has stopped ticking does not show there. `/api/health/scheduler` answers 200 while the scheduler is ticking (or was told not to), and 503 when it has not started or has gone three intervals without a tick. It only reports: it starts nothing and runs no tick. Do not use it as Render's health check path, or a stuck timer would make Render restart a process that is otherwise serving requests.

`GET /api/health` answers:

- `commit`: the commit this API was built from. The web app deploys on every merge and this API only on Manual Deploy, so compare this with `main` after merging anything that touches `apps/api` or `packages/api`. A web app ahead of the API is how "Save a link" came to tell signed-in learners to sign in.
- `scheduler.state`: `running`, or `disabled` (another host must be running it).
- `scheduler.startedAt`: when this process started its timer. A time a few minutes ago, every time you look, means the service keeps sleeping.
- `scheduler.stale`: `true` when no tick has run for over 16 minutes.
- `scheduler.nova`: what the last tick did for Nova learners (`checked`, `sent`, `errors`, and `outcomes` such as `no_timezone`, `nothing_due`, `suppressed`).
- `scheduler.idle`: skipping the database on idle ticks (`SCHEDULER_IDLE_SKIP`): `mode`, `fullRuns`, `skipped`, `lastReasons`, `nextDueAt`, `unpredictedWork`, `cacheReadFailed`. Read from memory; looking never wakes the database.

### Skipping the database on idle ticks (rollout)

The scheduler is Nova's only: no Rex job runs (dynamic check-ins, custom reminders and the gym jobs stopped with this release; Rex users get none of those messages). `SCHEDULER_IDLE_SKIP` is `shadow` when unset: nothing is skipped, and every tick logs one `{"layer":"scheduler","tick":"full","wouldSkip":…,"reasons":[…]}` line.

**Phase A: shadow, at least 7 days.** Deploy with the variable unset. Every day:
- `/api/health`: `scheduler.idle.mode` is `shadow`, `unpredictedWork` is 0, `cacheReadFailed` is near 0, `scheduler.stale` is `false`.
- Logs: no `"event":"unpredicted_work"` (a tick a skip would have taken that found Nova work; each names the job and count). Count `"wouldSkip":true` lines: about half the ticks is expected.
- Nova delivery as usual: `"layer":"nova_proactive"` `"outcome":"sent"` lines and calendar reminders.

**Phase B: on.** Only if Phase A had no `unpredicted_work` and no `cacheReadFailed` growth:
1. Render dashboard → kivo-api → Environment → add `SCHEDULER_IDLE_SKIP` = `on` → Save (Render restarts the service).
2. `/api/health`: `commit` unchanged, `scheduler.idle.mode` is `on`, `stale` `false`; within 15 minutes `skipped` > 0 and `fullRuns` keeps rising.
3. Logs: `"tick":"skipped"` lines with `nextDueAt`; full ticks at least every 10 minutes (`"reasons":["reconcile"]` or a due reason).
4. Verify a real check-in and a real calendar reminder on your own test account (below): each arrives at the first tick after its time.
5. For the first week, check `unpredictedWork` daily: in `on` it counts Nova work found only by a reconciliation tick (late by up to 10 minutes). It should stay 0.

**Phase C: validate.** Compare Neon's compute hours for the week before Phase B and the week after, and `fullRuns` / `skipped`. With full ticks at least every 10 minutes and Neon's default 5-minute suspend, expect roughly half the idle compute saved, not more.

Emergency: set `SCHEDULER_IDLE_SKIP=off` (Render restarts): every tick runs in full, nothing extra read.

### Verifying a real check-in (use your own test account)

1. Deploy, then confirm `commit` matches and `stale` is `false`.
2. In the web app: Settings → Check-ins, set the time three or four minutes ahead. Do not message the bot.
3. Within about five minutes of that time the Telegram message should arrive. In the Render log, look for `"layer":"nova_proactive"` lines with `"outcome":"due"` then `"outcome":"sent"` for the same `occurrence`.
4. Wait one more tick: no second message, and no new `"due"` line for that occurrence.
5. Set the time back to what you want.

If nothing arrives, the tick line's `outcomes` says why (`no_timezone`, `proactive_off`, `undeliverable`, `not_ready`, `suppressed`).
