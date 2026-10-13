# Nova extension: saving pages and passages, and what Nova does with them

How a click in the browser becomes a row on Saved with suggestions under it. One extension source for Chrome and Safari, one endpoint, one table.

## The flow

```
popup (Chrome or Safari)                    API                                   Saved page (web)
────────────────────────                    ───                                   ────────────────
click the Nova icon
  lib/browser.js: active tab,
  selection + canonical link
press Save to Nova / Save selection
  POST /api/nova/learning-events ─────────► recordLearningEvent
                                              row written, status "pending"
  "Saved." ◄───────────────────────────────  201 (the row exists)
                                            processSavedResource (not awaited)
                                              names → model → conditional write
                                              status "done" | "failed"            GET /api/nova/learning-events
                                            scheduler tick: anything left waiting   row + processing + suggestions
                                                                                  File here / Keep / Undo / Try again
                                                                                    PATCH …/[id], POST …/[id]/process
```

Save immediately, process in the background, record what was found. The popup says "Saved." only for a 2xx answer with `success: true`, and the server answers that only after the row is written. Nothing in the background step can remove or change the saved page except to file it where the learner filed nothing.

## What is stored

`NovaLearningEvent` gains nullable or defaulted columns, so the change is additive:

| Column | Meaning |
|---|---|
| `canonicalUrl` | The page's own canonical link, when the extension could read one. Kept beside `url`; never used to decide what is a duplicate. |
| `excerpt` | The passage the learner selected (`selection_saved` only), up to 2,000 characters, as text. |
| `filedBy` | `learner`, or `nova` for a link Nova made from a name match that the learner has not kept or undone. |
| `processingStatus` | `none` (rows from before this change, and study requests), `pending`, `processing`, `done`, `failed`. |
| `processingAttempts`, `processingStartedAt`, `processedAt`, `processingError` | The attempt bookkeeping. |
| `connections` | What was found: concepts and suggested places (`ResourceConnections`). |

Event types are `resource_saved`, `selection_saved` and `study_requested`. A page is one entry per address. A passage is one entry per address and text: the same passage sent again is the same entry, a different one is its own.

### Deploying, in this order

This repository applies schema changes with `prisma db push`, never `prisma migrate dev` (the production database has drifted from `prisma/migrations/`), so there is no migration file. The change is additive: nine new columns, each nullable or with a default, and one index. Nothing is renamed, dropped or rewritten, and no existing row changes except to take the defaults.

1. **Database first.** `(cd packages/db && npx prisma db push)` against the target database. The API that is already running ignores the new columns and keeps working.
2. **Then the API** (Render, Manual Deploy). New code on a database without the columns fails on every read of a learning event, because Prisma reads every column of the model.
3. **The web app** goes out on merge, before the API. Saved and the Knowledge Map are written to work against the older API: a row with no `processing` shows nothing under it, and a map with no `suggestions` draws none. The new buttons do nothing useful until the API is deployed.
4. **The extension** last. An older API answers a passage save or a question with a plain error, which the popup shows.

What `db push` will run, as printed by `prisma migrate diff` from the two schema files (no database was contacted):

```sql
ALTER TABLE "NovaLearningEvent" ADD COLUMN "canonicalUrl" TEXT,
ADD COLUMN "connections" JSONB,
ADD COLUMN "excerpt" TEXT,
ADD COLUMN "filedBy" TEXT,
ADD COLUMN "processedAt" TIMESTAMP(3),
ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processingError" TEXT,
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'none';
CREATE INDEX "NovaLearningEvent_processingStatus_processingStartedAt_idx" ON "NovaLearningEvent"("processingStatus", "processingStartedAt");
```

Rolling back the API needs nothing undone in the database: the older code does not read the new columns.

## Processing (`product/resource-processing.ts`)

Two readers. Code decides what either may do.

- **Names.** The learner's own topic or subject name appears, as whole words, in the title or the selected passage. No model. Confidence `high`. If exactly one such place exists and the learner filed the page nowhere, Nova files it there with `filedBy: "nova"`, and Saved shows Keep and Undo. Names under three characters are ignored.
- **Model.** One `gpt-4o-mini` call through `generateOpenAIText` with an 8 second deadline. It gets the title, the site, the selected passage and a numbered list of the learner's subjects and topics, and returns concepts and labels from that list. A label not in the list is dropped. Its picks are `possible` and are only ever suggestions. It is not given the address, and the server never fetches the page. `NOVA_RESOURCE_MODEL_DISABLED=true` runs names only.

Every write is one conditional update keyed on the attempt, so one worker looks at a page at a time and a late answer from a superseded attempt changes nothing. A failed attempt is retried by the scheduler tick after ten minutes, three attempts in all; the learner's Try again works at any time.

## What it is not

A connection says a page is about a topic. It is never evidence that the learner knows it. Processing writes no mastery, session, Learning DNA, fact, pattern or note, stays out of the chat pipeline and consolidation, and reaches the table only through `learning-events.ts`. `resource-processing.test.ts` and `learning-events.test.ts` read the source to hold this.

On the Knowledge Map a saved page is still an edge only where it is filed. Suggestions are sent beside the edges (`suggestions`), passed through as stored, and drawn as dotted lines; they take no part in the layout or in what counts as connected. A suggestion becomes an edge when the learner files the page there on Saved, or when Nova files the single outright name match (marked, and undoable). On Saved a suggestion can also be dismissed (**Not this**).

## Both browsers

`apps/extension/src/lib/browser.js` is the only file that calls the browser API: `chrome.storage.local`, `chrome.tabs.query`, `chrome.tabs.create`, `chrome.scripting.executeScript`. All five browsers expose these under `chrome`. Permissions are `activeTab`, `scripting`, `storage`; there are still no host permissions, no content script and no background script. The Safari app wraps the same `dist/`, and its Xcode project includes `dist/lib` as a folder, so the new file needs no project change.

## Learning actions from a saved page

- **Study this** (already there): opens Focus with the page; the learner's click starts the session.
- **Add task**: creates a `NovaTask` through the existing task route with `clientKey: resource:<id>`, so pressing twice makes one task. A task is only a task.

## Ask Nova about this page

`POST /api/nova/extension/ask` with the extension's credential, eight questions a minute per connected browser. `product/page-question.ts` makes one `gpt-4o` call given the page's title, its site, the selected passage if there is one, and the question. The popup shows the answer and says what it rested on: the selection, or the title only.

- Nova has not read the page. The extension does not send page text, and the server does not fetch the address.
- Nothing is stored and the question does not enter the chat pipeline: no Understanding call, no consolidation, no conversation log. This is the pattern the notes rules prescribe for an AI action on the learner's own text.

**Open decisions, deliberately not made here:**

- Whether a page question should be a turn in Nova's conversation (logged, consolidated, answered with the learner's record in view). That would send a selected passage through the chat pipeline, which the notes rules forbid for note text, so it needs a product decision.
- Whether the extension may ever send more of a page than the selection. Today it cannot read it.

## Not built

- Processing of page content beyond the title and a selected passage.
