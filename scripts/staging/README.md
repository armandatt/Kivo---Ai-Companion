# Nova Telegram staging

A second API with its own bot and its own database, for testing Nova on real Telegram without touching production. Every external step below needs the owner's go-ahead.

## Isolation

What makes staging unable to reach production:

- **Database.** Every job and every request reads `DATABASE_URL`. Staging gets its own Neon project, so it only ever sees staging learners.
  - The scheduler's jobs all read that database: Rex check-ins, custom reminders, gym cues, Nova's proactive tick and outbox, and saved-page processing.
  - No production host is hard-coded anywhere in `apps/api` or `packages/api`.
- **Bot.** Every Telegram call uses `TELEGRAM_BOT_TOKEN`, or `BOT_TOKEN` as a fallback.
  - The staging token belongs to a bot that only test accounts have started.
  - Telegram does not let a bot message a chat that never started it, so even a production chat id could not be reached.
- **Webhook.** Each bot has one webhook. `setWebhook` is called with the staging token only, so the production bot's webhook is untouched.
- **The scripts here refuse production** before they connect or send anything. `guard.ts` checks:
  - the database host against `packages/db/.env` and `apps/api/.env`;
  - the API host against the production API;
  - the bot's username and id against the production bot;
  - that the staging bot's webhook points at the staging API.

## 1. Telegram test bot (manual, BotFather)

`/newbot`, for example `kivo_staging_bot`.

- Store the token in a password manager or the Render dashboard only, never in chat, a file in the repo, or a log.
- Do not set a webhook until step 4.

## 2. Staging database (manual, Neon)

1. Create a **new, empty project**, for example `kivo-staging`, in AWS us-east-1.
   - Not a branch of production: a branch copies learners' data.
2. Copy its pooled and direct connection strings into your shell. Don't print them.
3. Push the schema, using the repository's Prisma workflow (`prisma db push` from `packages/db`; never `migrate dev`):

   ```sh
   STAGING_DATABASE_URL=<pooled> STAGING_DIRECT_URL=<direct> scripts/staging/db-push.sh          # checks both URLs, prints the command, runs nothing
   STAGING_DATABASE_URL=<pooled> STAGING_DIRECT_URL=<direct> scripts/staging/db-push.sh --yes    # runs it
   ```

   The command it runs:

   ```sh
   (cd packages/db && DATABASE_URL="$STAGING_DATABASE_URL" DIRECT_URL="$STAGING_DIRECT_URL" npx prisma db push)
   ```

## 3. Staging API (manual, Render dashboard)

Create a **New → Web Service**, not a Blueprint. `render.yaml` describes production; adding staging to it could change production on a Blueprint sync.

| Setting | Value |
|---|---|
| Name | `kivo-api-staging` |
| Repository | `armandatt/Kivo---Ai-Companion`, branch `main` |
| Root directory | (blank: the repo root) |
| Runtime | Node |
| Region | Virginia (US East), the same region as the Neon project |
| Instance type | Free, which sleeps after about 15 minutes idle (the first message waits for a cold start). Starter for longer sessions. |
| Instances | 1. The scheduler and turn leases assume one process. |
| Build command | `npm install --include=dev && npx prisma generate --schema packages/db/prisma/schema.prisma && npm run build --workspace api` |
| Start command | `npm run start --workspace api` (`next start --port ${PORT:-3001}`) |
| Health check path | `/api/health` |
| Auto-Deploy | Off |
| First deploy | Manual Deploy → "Deploy a specific commit" → `392a1d5` (the commit production runs) |

### Environment variables

These are taken from the code. Values are staging's own, never production's.

**Secrets** (new values, set in the dashboard):

| Name | Value |
|---|---|
| `DATABASE_URL` | Staging pooled URL. Needed at build and at runtime. |
| `DIRECT_URL` | Staging direct URL |
| `TELEGRAM_BOT_TOKEN` | The staging bot's token |
| `TELEGRAM_WEBHOOK_SECRET` | A new random string, at least 32 characters. In production builds Nova ignores updates without it. |
| `GEMINI_API_KEY` | A development key with its own quota, not production's |
| `JWT_SECRET` | A new random string. Needed only if a staging web app is used. |
| `CRON_SECRET` | A new random string, so a proactive tick can be run on demand (`GET /api/checkin` with `Authorization: Bearer …`) |

**Staging-only settings:**

| Name | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22.14.0` | As production |
| `DISABLE_INTERNAL_CHECKIN_CRON` | `true` | No timer ticks while the smoke test runs, so a nudge can't replace a card mid-test. Ticks are run on demand with `CRON_SECRET`; set `false` later to test timing. |
| `NOVA_TELEGRAM_DAILY_UNDERSTANDING` | `60` | Model readings per learner per day (default 150) |
| `NOVA_TELEGRAM_DAILY_RESPONSES` | `20` | Worded replies per learner per day (default 40) |
| `NOVA_RESOURCE_MODEL_DISABLED` | `true` | No model calls on saved pages in staging |
| `MENTOR_V3_ENABLED`, `ONBOARDING_V3_ENABLED` | Copy from production | Rex paths only; keeps behaviour the same |

**Public configuration:**

| Name | Value |
|---|---|
| `BOT_USERNAME` | The staging bot's username, without `@`. `TELEGRAM_BOT_USERNAME` is read first if set. |
| `NEXT_PUBLIC_APP_URL` | Leave unset unless a staging web app exists. Unset, replies carry no "Open Nova" link, so nothing points testers at production. |

**Do not set:**

| Name | Why |
|---|---|
| `BOT_TOKEN` | Production's name for the token; one token variable avoids confusion |
| `TELEGRAM_API_BASE`, `RESEND_API_BASE` | Local test stand-ins only |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | No email or Google sign-in on staging |
| `PERSONALITY_SIGNAL_ENABLED` | Off, as production |
| `OPENAI_API_KEY`, `LLM_PROVIDER` | Gemini is used when its key is set |

`RENDER_GIT_COMMIT` is set by Render; `/api/health` reports it.

After the deploy, `GET https://<staging-api>/api/health` should report `"commit":"392a1d54b0e3"` and `"scheduler":{"state":"disabled"…}`.

## 4. The test learner and the webhook (manual)

1. From a **dedicated test Telegram account** (not a personal one), send `/start` to the staging bot.
2. Before any webhook is set, read that chat's id once with the staging token, without echoing the token:

   ```sh
   curl -s "https://api.telegram.org/bot$STAGING_TELEGRAM_BOT_TOKEN/getUpdates" | jq '.result[].message.chat | {id, type}'
   ```

3. Seed the learner in the staging database. It runs as a dry run without `--apply`, and refuses production and any chat it did not seed:

   ```sh
   STAGING_DATABASE_URL=<pooled> STAGING_TEST_CHAT_ID=<id> npx tsx --tsconfig tsconfig.json scripts/staging/seed-test-learner.ts --apply
   ```

4. Set the webhook for the **staging bot only**:

   ```sh
   curl -s "https://api.telegram.org/bot$STAGING_TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://<staging-api>/api/telegram" -d "secret_token=$STAGING_TELEGRAM_WEBHOOK_SECRET" | jq .ok
   curl -s "https://api.telegram.org/bot$STAGING_TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq '{url, last_error_message}'
   ```

## 5. Tests

### The 72 scenarios (local, stand-ins)

```sh
NOVA_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest scripts/staging/run-acceptance.sh        # the 72
NOVA_TEST_DATABASE_URL=… scripts/staging/run-acceptance.sh all                                                         # the whole integration suite
```

They need a throwaway database. The runner refuses the staging database and any non-local host: a proactive tick in the scenarios visits every learner.

### Live smoke test (staging, real Telegram)

```sh
export STAGING_API_URL=https://<staging-api> STAGING_DATABASE_URL=<pooled> STAGING_TELEGRAM_BOT_TOKEN=… \
       STAGING_BOT_USERNAME=kivo_staging_bot STAGING_TELEGRAM_WEBHOOK_SECRET=… STAGING_TEST_CHAT_ID=… \
       STAGING_EXPECT_COMMIT=392a1d54b0e3
npx tsx --tsconfig tsconfig.json scripts/staging/live-smoke.ts           # dry run: checks every target, lists the steps
npx tsx --tsconfig tsconfig.json scripts/staging/live-smoke.ts --live    # 21 steps, at least 3 s apart, stops at the first failure
```

Options: `--only=L01,L05`, `--delay-ms=4000` (minimum 3000), `--timeout-ms=45000`, `--continue-on-failure`.

What it checks before sending:

- the bot is the staging bot, and not production by username or id;
- its webhook points at the staging API;
- the API is https, not production, healthy, and on the expected commit;
- the database is not production;
- the chat is the seeded staging learner, with no session open.

How it sends: each step is the update Telegram would deliver for the test chat, posted to the staging webhook with the staging secret, with a negative `update_id` (real ones are positive). Nova's reply goes to the test chat through the real Telegram API.

How it checks, in the staging database:

- the prompt the step opened and its Telegram message id (Telegram accepted it);
- the channel's delivery time;
- the reply in the conversation log;
- plan changes, sessions, the outbox and nudge pauses;
- and, for L01, the chat's command menu through `getMyCommands`.

Logs are one JSON line per step with an id, a time, the outcome and a reason. Tokens, secrets and connection strings are redacted. Bot replies aren't logged.

Steps marked model-dependent (L05, L06, L10, L12, L13, L14, L20, L21) rely on the staging model's reading. A failure there is a reading to look at, not necessarily a code defect.

## 6. Teardown

- `deleteWebhook` on the staging bot.
- Suspend the Render service.
- Keep the Neon project or delete it.
