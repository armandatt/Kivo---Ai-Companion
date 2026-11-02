# Production readiness report

Date: 2026-11-03 (UTC 2026-11-02 22:30). Audit of `main` at `ab2099a`, plus two small fixes that are not yet committed (§4).

Everything here was either observed directly or read in the code; anything not verified says so. Every production check was read-only. Nothing was written to the production database, and no limit, credit, subscription, DNS record or piece of infrastructure was changed.

---

## 1. Verified deployment state

| Component | What was checked | Result |
|---|---|---|
| API (Render, `kivo-api-6jh4.onrender.com`) | `GET /api/health` | `ok: true`, `commit: ab2099a5a970`, scheduler `running`, last tick ok, not stale |
| API deploy | GitHub deployment record "main - kivo-api" | Created 22:27:59 UTC, about two minutes after `main` moved; `success` at 22:32:03. **Corrected 2026-11-03:** this report first said Render auto-deploys `main`. It doesn't: `render.yaml` sets `autoDeploy: false`, and the next push (`101655c`, 23:24 UTC) had not deployed 26 minutes later. This deploy was most likely started by hand. |
| Web (Vercel, both projects) | GitHub deployment records | `kivo-ai-companion-web-kar8` deployed `ab2099a` at 22:24:18 and `kivo-ai-companion-web` at 22:26:07 |
| Public sites | `www.thekivo.in`, `kivo-ai-companion-web-kar8.vercel.app` | Both answer 200 |

**Version skew window.** Vercel went live 4–8 minutes before Render did. For those minutes the new web app was calling the previous API. This release copes with that: the reset page falls back to the ordinary form, and the "Recently deleted" panel shows its error state. A future release whose web app needs a new API route would show errors for those minutes too.

**Not verified:** which provider key is set on Render, and `BILLING_*`. They aren't visible from here. `NEXT_PUBLIC_APP_URL` was verified later (`PRODUCTION_RELEASE_CHECKLIST.md` §4).

## 2. Database compatibility

| Check | Method | Result |
|---|---|---|
| Read-only session | Connection opened with `default_transaction_read_only=on`, every query in `BEGIN READ ONLY`, then rolled back; a `CREATE TEMP TABLE` probe was refused (`25006 cannot execute CREATE TABLE in a read-only transaction`) | Confirmed read-only |
| Full schema comparison | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, which introspects and writes nothing | **"This is an empty migration."** Production equals the repository's schema. |
| Tables from recent releases | `to_regclass` | `NovaKnowledgeTrash`, `NovaDayFlow`, `LegalConsent`, `NovaPdfHighlight`, `NovaNoteImage`, `NovaWorkspace*`, `NovaMapLayout`, `NovaTaskDependency`, `AiUsageDay` and the billing tables are all present |

No schema push is pending. The earlier pending pushes (LegalConsent, NovaPdfHighlight, NovaNoteImage, NovaDayFlow, NovaKnowledgeTrash) are all applied.

## 3. Smoke-test results (production, signed out, nothing written)

Run against both web origins and the API directly, with `curl` and no credentials.

| Check | Result |
|---|---|
| `/`, `/signin`, `/signup`, `/reset-password`, `/terms`, `/privacy` | 200 on both origins |
| `/home`, `/map`, `/build`, `/notes` signed out | 307 to `/signin?from=…` |
| 7 Nova/settings API reads through the web origin, signed out | 401 JSON on all of them, no 500s |
| Reset link check with a fake token | 400, `usable: false`, with the new message |
| Reset with no password | 400 "Token and password are required" |
| Reset from a foreign `Origin` | 403 "This request did not come from Kivo." |
| Trash list, trash restore and map delete, signed out | 401 |
| Nova message, signed out | 401 |
| Extension Ask with a bogus bearer token | 401 |
| Telegram webhook without the secret | 401 |
| `GET /api/checkin` with no bearer | 401 |
| Billing webhook, unsigned | 403 `invalid_signature` |

**Not covered:** signed-in flows in production. That needs a real session, and every action there writes data. They were covered locally instead: browser harness 28/28 and reset flow 7/7 in the earlier pass.

## 4. Bugs found in this pass

| # | Bug | Evidence | Status |
|---|---|---|---|
| B1 | **Two first requests for a new learner fail with a 500.** `ensureSetupProfile` (`packages/api/src/nova/product/setup.ts`) used Prisma `upsert`, which this setup runs as a read followed by an insert. Two requests at once both insert, and the second fails on the unique `userId`. | `nova-workspaces.itest.ts` "one key, one workspace" failed 3 of 3 runs with `Unique constraint failed on the fields: ("userId")` at `setup.ts:488` | **Fixed (uncommitted):** on P2002 it reads the row the other request made. This is the same pattern `saveSetup` already uses in that file. Now 7/7 passing, 3 runs in a row. |
| B2 | **Saved-page Retry was an unbounded, unmetered model call.** `POST /api/nova/learning-events/[id]/process` has no AI allowance (resource processing is not metered), no attempt cap for the learner path and no rate limit. | Code read: `claimForProcessing(…, "learner")` accepts any page that isn't being looked at right now | **Fixed (uncommitted):** 6 retries per minute per learner (`allowAttempt`) before anything is claimed. The answer is the usual `429 rate_limited` JSON, which the page already shows. It is not metered, so billing is unchanged. Covered by a new test in `resource-processing.test.ts`. |
| B3 | The trash route says "Sign in to open your notes." when signed out (it reuses the notes guard) | Smoke test | Cosmetic, open |
| B4 | Two Jest source checks fail because they expect text the pages no longer contain (`home-today.test.ts:147` expects `can't be moved`, `knowledge-map.test.ts:153` expects a `linkedId` line) | Present before this pass. These files weren't touched. | Open: the tests need updating to the current pages, or the pages restoring. Owner to decide which. |

## 5. Security and reliability findings

How far the review went: every route under `apps/api/app/api` was scanned for missing `try` and unguarded body parsing. Read in full: the routes changed recently (reset, trash, map delete), every AI entry point, the billing meter, the Telegram channel store and the extension guard.

- **Unexpected 500s:** every route has a catch-all that answers with a generic JSON message. The four routes without a `try` either can't throw or delegate to a handler that returns a status: health, scheduler health, `checkin`, and the billing webhook (`handleWebhook` returns 400/403/409/503). The Telegram webhook parses its body inside its `try`. The one real 500 found is B1.
- **Validation:** bodies are read with `readSmallJson` (size checked before parsing) on the Nova routes reviewed. Ids are type- and length-checked (trash restore: string ≤ 64). No arbitrary character limits were added.
- **Authentication:** no bypass found on the routes checked. The learner always comes from the session cookie (`resolve-learner.ts`) or the extension token (`extension-access.ts`), never from the request. The extension token opens only its own routes. Telegram, cron and the billing webhook are each closed to unauthenticated callers, as the smoke tests confirm.
- **Error responses:** consistent `{ ok:false, error, message }` with a status. The metered routes answer `429 allowance_used` with the plan.
- **Transactions:** deletes, restores, workspace creation and change sets each run in one transaction (proven by integration tests). Restore claims the trash row conditionally, so it happens once.
- **Concurrency:** the AI allowance is one conditional `UPDATE` (sound). Telegram budgets are conditional writes (sound). The per-minute limiters live in process memory: they reset on every deploy (one happened today) and would not hold with two instances. B1 was the only race found.

## 6. The five most important reliability issues

### R1. The web and the API deploy separately, and the order matters
- **Severity:** High.
- **User impact:**
  - The web app goes live on Vercel a few minutes after a merge. The API goes live only when someone deploys it on Render, so the web app calls an older API until then.
  - A release that needs a schema change breaks the features that read it if the API is deployed before `prisma db push` runs.
- **Root cause:** Vercel deploys `main` by itself. Render does not (`render.yaml`: `autoDeploy: false`). So "merged" and "live" mean different things for the two halves.
- **Evidence:**
  - `ab2099a`: web 22:24 and 22:26, API 22:28–22:32, the API deployed by hand.
  - `101655c`: web 23:25 and 23:27, API still on `ab2099a` at 23:50.
  - (This finding first said Render auto-deploys, which was wrong; corrected 2026-11-03.)
- **Fix:**
  - Run any schema push and verify it **before** merging, so either deploy order is safe.
  - Deploy Render straight after Vercel and check `/api/health` `commit`.
  - Keep web changes tolerant of a one-version-older API, as this release was.
- **Database change:** no.
- **Deployment or environment change:** a release checklist. Turning on Render auto-deploy is an option, but not needed.

### R2. AI work that is unmetered or not recorded
- **Severity:** Medium today, High as usage grows.
- **User impact:** none directly. Kivo pays for work no meter sees and can't tell which feature costs what.
- **Root cause:** none of these is on any account's meter:
  - saved-page processing (automatic, the 5-minute sweep, and Retry);
  - Nova's proactive messages;
  - the first message after linking Telegram;
  - Rex.

  Telegram's Response Brain and language-wording calls are not counted against the account's allowance; only the per-chat budget bounds them. `AiUsageDay` keeps a daily sum with no feature or model.
- **Evidence:** the code paths in `AI_USAGE_ANALYTICS_REPORT.md` §2. In production over 30 days, saved pages took 40 model attempts and proactive messages 19 sends, with no usage rows for either.
- **Fix:** Phase 1 of `AI_USAGE_NEXT_PHASE_PLAN.md`: a per-call record with a feature tag, cache-token fields, and background jobs metered under a system key. Retry is now rate limited (B2).
- **Database change:** yes, an additive table, in Phase 1.
- **Deployment or environment change:** API deploy.

### R3. Allowance spent when nothing useful came back
- **Severity:** Medium.
- **User impact:** a learner loses allowance to Kivo's own failures. At 150 a day nobody notices. Under tighter or credit-based limits they would.
- **Root cause:**
  - Build with Nova spends the request before the job is claimed, so a message refused as `busy`, `stale`, `invalid` or `not_found` still costs one (`builder/[id]/messages/route.ts`).
  - `metered()` spends first and doesn't refund when the work fails before or without a model reply: provider down, the price-tier refusal, a note that isn't found.
- **Evidence:** code read. The order is `spendForTurn` → `postMessage`, and the refund path doesn't exist.
- **Fix:** reserve-then-settle (Phase 2), or at minimum release the request when the claim is refused or no provider usage came back.
- **This changes how usage is deducted, so it needs your approval before it is built.**
- **Database change:** none for the minimal version; Phase 2 adds the ledger.
- **Deployment or environment change:** API deploy.

### R4. Concurrent first use of a new account fails (B1)
- **Severity:** Medium, but rare: it needs a brand-new learner and two requests at once.
- **User impact:** "That didn't work" on the very first action, such as approving a first plan while another tab loads.
- **Root cause:** a non-atomic `upsert` on `NovaAcademicProfile.userId`.
- **Evidence:** reproduced 3 of 3 times in the integration test.
- **Fix:** done, uncommitted.
- **Database change:** no.
- **Deployment or environment change:** API deploy once merged.

### R5. Safety limits that reset on deploy, and a meter that fails open in silence
- **Severity:** Medium-Low.
- **User impact:** none normally. During a database fault the AI allowance stops applying, so spending is unbounded, and nothing alerts. After every deploy the per-minute limits start again from zero.
- **Root cause:** `allowAttempt` is a `Map` in process memory. `withAiAllowance` and `metered` run the work when the meter can't be read. That is correct for the learner, but only a `console.error` records it.
- **Evidence:** `extension-access.ts:65`, `usage.ts:57-63`, `metered.ts:22-27`.
- **Fix:**
  - an alert on `[billing] meter unavailable` and `entitlement unavailable` log lines (Render log alerts or a log drain);
  - per-minute limits moved to Postgres, like `AuthThrottle`, before any second instance;
  - a daily spend ceiling (Phase 3).
- **Database change:** an additive limiter table, later.
- **Deployment or environment change:** an alert setup.

## 7. Remaining risks (known, not fixed here)

- Sessions can't be revoked: a password reset doesn't sign out older sessions.
- The signed-in Profile → "Reset password" still builds its link from Render's `NEXT_PUBLIC_APP_URL`. Verified on 2026-11-03 as `https://www.thekivo.in` (see `PRODUCTION_RELEASE_CHECKLIST.md` §4), so that link is right.
- Topic-only deletes are permanent (not in Recently deleted). Expired trash rows are hidden but never purged.
- One Render instance carries the API, the 5-minute scheduler and Telegram. A restart pauses all three.
- Which model production uses is not verified: Render's provider keys aren't visible, and `AiUsageDay` doesn't record a model.
- Rex code paths call models with no meter. Production shows no Rex conversation in 30 days.

## 8. Launch recommendation

**Fit for the current closed launch.** The sample is small (23 accounts, 19 of them used AI), but the evidence so far is good:
- production matches the schema;
- signed-out access is closed everywhere tested;
- the scheduler is healthy;
- measured AI cost is very low: $0.49 at Haiku 5.5 prices across all accounts since metering began on 19 October (see the analytics report).

**Before scaling paid acquisition:**
1. Adopt the R1 release order (schema push before merging to `main`).
2. Commit and deploy the two fixes in §4.
3. Build Phase 1 telemetry, so AI cost is measured per feature before any limit changes.
4. Decide R3: whether Kivo absorbs or charges allowance for failed AI work.
5. Add the R5 alert.

None of these needs a change to plans, prices or limits.
