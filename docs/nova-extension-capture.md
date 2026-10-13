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

**Deploying:** apply the schema first (`cd packages/db && npx prisma db push`), then the API. The API reads every column of the model, so new code on an old database fails.

## Processing (`product/resource-processing.ts`)

Two readers. Code decides what either may do.

- **Names.** The learner's own topic or subject name appears, as whole words, in the title or the selected passage. No model. Confidence `high`. If exactly one such place exists and the learner filed the page nowhere, Nova files it there with `filedBy: "nova"`, and Saved shows Keep and Undo. Names under three characters are ignored.
- **Model.** One `gpt-4o-mini` call through `generateOpenAIText` with an 8 second deadline. It gets the title, the site, the selected passage and a numbered list of the learner's subjects and topics, and returns concepts and labels from that list. A label not in the list is dropped. Its picks are `possible` and are only ever suggestions. It is not given the address, and the server never fetches the page. `NOVA_RESOURCE_MODEL_DISABLED=true` runs names only.

Every write is one conditional update keyed on the attempt, so one worker looks at a page at a time and a late answer from a superseded attempt changes nothing. A failed attempt is retried by the scheduler tick after ten minutes, three attempts in all; the learner's Try again works at any time.

## What it is not

A connection says a page is about a topic. It is never evidence that the learner knows it. Processing writes no mastery, session, Learning DNA, fact, pattern or note, stays out of the chat pipeline and consolidation, and reaches the table only through `learning-events.ts`. `resource-processing.test.ts` and `learning-events.test.ts` read the source to hold this.

The Knowledge Map is unchanged: it still draws a saved page under the subject and topic it is filed under and infers nothing. A suggestion reaches the map when the learner files the page there, or when Nova files the single outright name match (marked, and undoable).

## Both browsers

`apps/extension/src/lib/browser.js` is the only file that calls the browser API: `chrome.storage.local`, `chrome.tabs.query`, `chrome.tabs.create`, `chrome.scripting.executeScript`. All five browsers expose these under `chrome`. Permissions are `activeTab`, `scripting`, `storage`; there are still no host permissions, no content script and no background script. The Safari app wraps the same `dist/`, and its Xcode project includes `dist/lib` as a folder, so the new file needs no project change.

## Learning actions from a saved page

- **Study this** (already there): opens Focus with the page; the learner's click starts the session.
- **Add task**: creates a `NovaTask` through the existing task route with `clientKey: resource:<id>`, so pressing twice makes one task. A task is only a task.

## Not built

- Asking Nova a question about the page. It needs a decision on how much page text may leave the browser.
- Processing of page content beyond the title and a selected passage.
- A dashed "suggested" edge on the Knowledge Map.
