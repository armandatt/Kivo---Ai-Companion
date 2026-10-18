#!/bin/zsh
# Runs the 64 Telegram acceptance scenarios (S01–S64) and, with "all", the
# whole real-Postgres integration suite.
#
#   NOVA_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest scripts/staging/run-acceptance.sh
#   … scripts/staging/run-acceptance.sh all
#
# The scenarios stand in for Telegram and both models, and a proactive tick
# in them visits EVERY learner in the database. So they run against a
# throwaway database only: never production (test-database.ts refuses its
# host) and never the staging database (refused here, because a tick would
# write outbox rows for the staging test learner). A local one:
#
#   docker run -d --rm --name nova-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=novatest -p 127.0.0.1:54329:5432 postgres:16-alpine
#   (cd packages/db && DATABASE_URL=$NOVA_TEST_DATABASE_URL DIRECT_URL=$NOVA_TEST_DATABASE_URL npx prisma db push)
set -euo pipefail
ROOT="${0:A:h}/../.."
: "${NOVA_TEST_DATABASE_URL:?set NOVA_TEST_DATABASE_URL to a throwaway database}"

host_of() { node -e 'try { console.log(new URL(process.argv[1]).hostname) } catch { console.log("") }' "$1"; }
test_host=$(host_of "$NOVA_TEST_DATABASE_URL")
if [[ -n "${STAGING_DATABASE_URL:-}" && "$(host_of "$STAGING_DATABASE_URL")" == "$test_host" ]]; then
  echo "refused: NOVA_TEST_DATABASE_URL is the staging database; use a throwaway one" >&2; exit 1
fi
case "$test_host" in
  127.0.0.1|localhost|::1) ;;
  *) [[ "${ALLOW_REMOTE_TEST_DATABASE:-}" == "yes" ]] || { echo "refused: $test_host is not local; set ALLOW_REMOTE_TEST_DATABASE=yes for a remote throwaway database" >&2; exit 1; } ;;
esac

cd "$ROOT/packages/api"
if [[ "${1:-}" == "all" ]]; then
  npm run test:integration
else
  npx tsx --test --test-concurrency=1 src/nova/__integration__/nova-telegram-acceptance.itest.ts
fi
