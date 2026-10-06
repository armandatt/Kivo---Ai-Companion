#!/bin/zsh
# Starts the built API (3001) and web app (3000) for scripts/e2e/fresh-user.mjs,
# against the throwaway test database and a local Telegram stand-in.
#   servers.sh        both apps
#   servers.sh api    the API only (the journey restarts it part-way through)
# Every value here is a test value. The model key is read from
# packages/api/.env and is not printed. DATABASE_URL is set explicitly, so the
# apps cannot fall back to the database named in an .env file.
ROOT="${0:A:h}/../.."
export DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest
export DIRECT_URL=$DATABASE_URL
export JWT_SECRET=e2e-secret-e2e-secret-e2e-secret
export TELEGRAM_BOT_TOKEN=test-token BOT_TOKEN=test-token
export TELEGRAM_API_BASE=http://127.0.0.1:3999
export TELEGRAM_WEBHOOK_SECRET=e2e-hook-secret
export DISABLE_INTERNAL_CHECKIN_CRON=true
export NEXT_PUBLIC_APP_URL=https://nova.test
export BOT_USERNAME=nova_e2e_bot NEXT_PUBLIC_BOT_USERNAME=nova_e2e_bot
export API_URL=http://127.0.0.1:3001
export GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' "$ROOT/packages/api/.env" | cut -d= -f2-)
(cd "$ROOT/apps/api" && npx next start -p 3001 > /tmp/nova-e2e-api.log 2>&1 &)
[ "$1" = "api" ] || (cd "$ROOT/apps/web" && npx next start -p 3000 > /tmp/nova-e2e-web.log 2>&1 &)
