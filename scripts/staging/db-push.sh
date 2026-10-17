#!/bin/zsh
# Pushes the repository's Prisma schema to the STAGING database, the way the
# repository does it (prisma db push from packages/db, never migrate dev).
#
#   STAGING_DATABASE_URL=<staging pooled> STAGING_DIRECT_URL=<staging direct> scripts/staging/db-push.sh          prints the command, runs nothing
#   … scripts/staging/db-push.sh --yes                                                                          runs it
#
# Both URLs are checked against the production hosts first (scripts/staging/guard.ts).
# prisma.config.ts prefers DIRECT_URL, so both are set; neither is printed.
set -euo pipefail
ROOT="${0:A:h}/../.."
: "${STAGING_DATABASE_URL:?set STAGING_DATABASE_URL}"
: "${STAGING_DIRECT_URL:?set STAGING_DIRECT_URL}"

cd "$ROOT"
cat > "${TMPDIR:-/tmp}/nova-staging-db-guard.ts" <<EOF
import { assertSameEndpoint, assertStagingDatabase } from "$ROOT/scripts/staging/guard.ts";
assertStagingDatabase(process.env.STAGING_DATABASE_URL!, "STAGING_DATABASE_URL");
assertStagingDatabase(process.env.STAGING_DIRECT_URL!, "STAGING_DIRECT_URL");
assertSameEndpoint(process.env.STAGING_DATABASE_URL!, process.env.STAGING_DIRECT_URL!);
console.log("guard: neither URL is a production database host, and both are the same endpoint");
EOF
npx tsx --tsconfig tsconfig.json "${TMPDIR:-/tmp}/nova-staging-db-guard.ts"

echo 'command: (cd packages/db && DATABASE_URL="$STAGING_DATABASE_URL" DIRECT_URL="$STAGING_DIRECT_URL" npx prisma db push)'
if [[ "${1:-}" != "--yes" ]]; then echo "not run: pass --yes to push the schema to staging"; exit 0; fi
(cd packages/db && DATABASE_URL="$STAGING_DATABASE_URL" DIRECT_URL="$STAGING_DIRECT_URL" npx prisma db push)
