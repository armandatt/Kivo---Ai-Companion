# Production release checklist: audit fixes (roadmap Phase 0)

Date: 2026-11-03. Base: `main` = `origin/main` = `ab2099a`. Branch in the working tree: `feature/production-readiness`, with no commits beyond `main`.

**Status: waiting for owner approval.** Nothing is committed, pushed or deployed. No production database write or environment change was made.

---

## 1. Reviewed changes

### In this release

| File | Change | Reviewed |
|---|---|---|
| `packages/api/src/nova/product/setup.ts` | `ensureSetupProfile`: when two first requests both try to create the learner's `NovaAcademicProfile`, the second's unique-key failure (P2002) now reads the row the first made, where it used to return a 500 | Same pattern as `saveSetup` in this file. The retried `create` calls `seedGoalFromSignup` and `seedDailyMinutesFromSignup` again; both only read (`findMany`, `findUnique`), so a retry writes nothing extra. Any other error is still thrown. |
| `apps/api/app/api/nova/learning-events/[id]/process/route.ts` | Saved-page Retry: 6 per minute per learner (`allowAttempt('resource-retry:<profileId>')`), checked after sign-in and before the page is claimed. Over the limit: `429 { ok:false, error:"rate_limited", message }`, which `saved-api.ts` already shows. | Not metered, so billing is unchanged. The constant is not exported (a route file may only export handlers and config). Process-memory limiter, like the others; Phase 2 moves all of them. No `Retry-After` header yet (Phase 2). |
| `packages/api/src/nova/__tests__/resource-processing.test.ts` | Source test: the limit sits after sign-in and before `processSavedResource`, and answers 429 | |
| `packages/api/src/services/llmProviders.ts` | New pure `describeLlmSelection(env)`: provider, whether its key is set, each tier's model, Claude's effort and prompt cap | Reads only names, never a key value |
| `apps/api/app/api/health/route.ts` | `GET /api/health` adds `llm: describeLlmSelection(process.env)` | Public endpoint. It reveals the provider and model names, which aren't secret. Key values are never included (a test checks). **Optional, your call:** it is the only way to see the provider in use without dashboard access (§4). |
| `packages/api/src/services/__tests__/llm-providers.test.ts` | 2 tests: names only, no key in the output, overrides followed, missing key reported | |
| `docs/PRODUCTION_READINESS_REPORT.md` (new), `docs/architecture/AI_USAGE_ANALYTICS_REPORT.md` (new), `docs/architecture/AI_USAGE_NEXT_PHASE_PLAN.md` (new), `docs/architecture/AI_USAGE_AND_RATE_LIMITING.md` (status line) | Audit reports | Figures re-read against the query output |
| `docs/PRODUCTION_RELEASE_CHECKLIST.md` (new) | This file | |

### Left out of this release: the owner's own work, not reviewed here

| Path | What it is |
|---|---|
| `package.json` | Four `seed:*` scripts for `scripts/demo-workspaces/` |
| `scripts/demo-workspaces/`, `PROJECT_CONTEXT.md`, `audit/` | Owner's local work. `audit/` is never committed. |
| `apps/web/components/{bento-card,bento-grid,creature-reveal,hero-dual-chat,how-it-works}.tsx` | Untracked landing components |
| `apps/api/AGENTS.md`, `apps/web/AGENTS.md` | Created by dev servers |
| `… 2.ts`, `KivoLogo 2.tsx`, `.gitignore 2` | Cloud-sync duplicates. Delete them, don't commit them. |

Stage the release by listing files explicitly, never with `git add -A`.

## 2. Test results (run 2026-11-03 with all of the above in place)

| Check | Result |
|---|---|
| Jest: `src/nova`, `src/auth`, `src/billing`, `src/services` | **2,423 passed, 2 failed, 1 suite didn't compile**, out of 2,425 tests in 107 suites |
| Those 2 failures | **Existing before this work, not caused by it.** They are source checks of web pages this diff doesn't touch: `home-today.test.ts:147` expects `can't be moved`, `knowledge-map.test.ts:153` expects a `linkedId('topic')` line. |
| The suite that didn't compile | **Existing, not caused by this work.** `services/__tests__/bodyweight-service.test.ts` has TS2345 on `jest.Mock` typing. It is a Rex test last changed in `5e6fa87` and imports nothing changed here. |
| Integration, real Postgres 16 (isolated Docker, `127.0.0.1:54329`) | `nova-workspaces` 7/7 (it failed 3 of 3 runs before the fix), `nova-setup` 10/10, `nova-builder` 13/13, `nova-knowledge-trash` 6/6, `nova-learning-events` 24/24, `billing` 14/14 |
| Type checks | `packages/api`, `apps/api` and `apps/web`: 0 errors |
| API production build (`turbo build --filter=api`) | Compiled successfully |
| Local runtime | Built API started on port 3901 with the scheduler off and the database pointed at the isolated Postgres. `/api/health` returned `llm: {provider: "anthropic", keyPresent: true, fast/main: "claude-haiku-5-5", effort low/low, promptTokensMax: 100000}`, with no key in the output. |

## 3. Deployment state (observed 2026-11-02 23:13 UTC)

| | Commit | Source |
|---|---|---|
| API on Render | `ab2099a5a970`. Scheduler `running`, last tick ok, process started 22:31:55. | `/api/health` |
| Web, `kivo-ai-companion-web-kar8` and `kivo-ai-companion-web` | `ab2099a` | GitHub deployment records |
| `origin/main` | `ab2099a` | `git fetch` |

**Render auto-deploys `main`.** The last push was live on the API about six minutes later, and on the web two to four minutes later. Merging is deploying.

**Production database:** equals the repository's schema (`prisma migrate diff`: empty, 2026-11-02). **This release has no schema change.**

## 4. Environment configuration

How each value was checked:
- **Read-only probes:** `GET <host>/api/auth/google/callback?error=access_denied` returns before any database or Google call, by redirecting to `${NEXT_PUBLIC_APP_URL}/signin?error=google_denied`. The Google start route shows `redirect_uri`.
- **No dashboard access:** there is no Render API key or CLI on this machine, so other values can't be read.

| Variable (Render API) | Required value | Status |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://www.thekivo.in` | **Verified.** All three hosts redirect to `https://www.thekivo.in/signin?error=google_denied`. |
| `GOOGLE_REDIRECT_URI` | `https://www.thekivo.in/api/auth/google/callback` | **Verified** (Google start redirect) |
| `ANTHROPIC_API_KEY` | Set, so Claude Haiku 5.5 is used. Leave `LLM_PROVIDER` unset or `anthropic`. | **Not verified.** No production table records the provider or model, and every route that calls a model needs a signed-in user and writes usage. Two ways to confirm: (a) after this release, `/api/health` shows `llm.provider` and `llm.keyPresent`; (b) now, Render dashboard → kivo-api → Environment, or the Anthropic Console's usage for 25–27 Oct (Kivo's busiest days: 80, 91 and 100 requests). |
| `JWT_SECRET` | The same value as on Vercel | Indirectly consistent: signed-out calls through the web proxy get the API's normal 401s, and reset POSTs pass the proxy-proof path. Not verified by value. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Set, with a verified sender domain | Not verified: it would need a real email sent |
| `BILLING_FREE_DAILY_AI`, `BILLING_PRO_DAILY_AI` | Unset (150 / 600) or as you decided | Not verified. Production never had a day of 150 or more requests, so nothing shows whether a different limit is set. |

### Canonical URL for password reset links

| Flow | Where the link points | Status |
|---|---|---|
| Forgot password (`/api/reset-password`, via the web proxy) | The origin the person asked from, as vouched for by the proxy (`x-kivo-app-origin`), so `www.thekivo.in` or `kivo-ai-companion-web-kar8.vercel.app` | Works on both |
| Profile → Reset password | `NEXT_PUBLIC_APP_URL`, which is `https://www.thekivo.in` | Correct |

- **Canonical:** `https://www.thekivo.in`. The kar8 address also serves the whole app with no redirect (`/` answers 200), so a reset asked for on kar8 is completed on kar8. That works, but the session cookie then belongs to kar8.
- **Recommendation, not done:** redirect `kivo-ai-companion-web-kar8.vercel.app` to `www.thekivo.in` in Vercel's domain settings. This is your call.
- **Earlier reset failures:** a wrong `NEXT_PUBLIC_APP_URL` was the leading hypothesis, and that is now **refuted** for the current settings. The cause remains unconfirmed. Next steps:
  1. Check Resend's log for the failed attempts: delivered or not, and the link host.
  2. Check whether the email was opened on a different host from the one it was asked for on. Before `30ca1cf`, every link used `NEXT_PUBLIC_APP_URL`.

## 5. Remaining risks

- The per-minute limiters, including the new Retry limit, live in process memory: they reset on every deploy and don't hold across instances. Phase 2 (Redis) addresses this.
- AI usage paths that are not metered or recorded. Phase 1 addresses this.
- Learners lose a request when Kivo fails (Build with Nova spends before claiming the job; `metered()` doesn't refund). This needs your decision, and nothing changes until then.
- The health endpoint is public. With this release it names the provider and models. Leave out the two `llm` files if you'd rather not expose that, and confirm the provider in the dashboard instead.
- Version skew of 2–8 minutes on every release, from the web deploying before the API. Harmless for this release: it adds no route the web calls.
- The three failures in §2 are pre-existing. They should be fixed or removed so that new failures stand out.

## 6. Recommended release order

There is no schema change, so no database step is needed. Each step needs your go-ahead:

1. **Approve the file list** in §1, including or excluding the optional `/api/health` change.
2. **Commit** those files only, on `feature/production-readiness`, in two commits:
   - `fix(api)`: the race and the Retry limit;
   - `docs` + `feat(health)`: the reports, the provider names and the tests.
3. **Push the branch** and review the compare view on GitHub.
4. **Merge to `main`.** This deploys: web in about 2–4 minutes, API in about 6.
5. **Verify after the deploy:**
   - `curl https://kivo-api-6jh4.onrender.com/api/health`: `commit` shows the new commit, and `llm.provider` is `anthropic` with `keyPresent: true`.
   - Re-run the signed-out smoke checks from the readiness report §3.
6. **If anything regresses:** revert the merge commit on `main`. Render redeploys the previous build by itself, and no data migration needs undoing.

Then stop. Phase 1 (telemetry) starts only after you approve it; it adds an `AiUsageEvent` table, which must be pushed to production and verified **before** its code is merged.
