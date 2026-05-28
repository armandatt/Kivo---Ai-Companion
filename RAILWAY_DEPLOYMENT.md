# Railway API Deployment

Deploy the repository root to Railway, but run only the `apps/api` workspace.

Railway uses `railway.json`:

- Build: `npx prisma generate --schema packages/db/prisma/schema.prisma && npm run build --workspace api`
- Start: `npm run start --workspace api`
- Health check: `/api/health`

## Required Railway environment variables

Set these in the Railway service:

```env
DATABASE_URL=postgresql://...
TELEGRAM_BOT_TOKEN=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
JWT_SECRET=...
NEXT_PUBLIC_APP_URL=https://your-vercel-frontend-domain
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Use the same `DATABASE_URL` as `packages/db/.env`.

Never commit real `.env` files or API keys. If a key is exposed in chat, logs, or Git, rotate it before deploying.

## Telegram webhook

After Railway deploys, set the Telegram webhook to the Railway API URL:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/telegram"
```

Check it:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

## Frontend

Deploy `apps/web` to Vercel. The bot backend stays on Railway at:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/telegram
```

The scheduled check-in endpoint is:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/checkin
```
