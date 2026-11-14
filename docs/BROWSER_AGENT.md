# Nova's browser agent, and automatic filing

Two features that share one workspace intelligence: Kivo files every captured passage under the learner's own subject and topic, and Nova's browser agent, in the extension's side panel, answers questions about the page the learner is on and carries out tasks on it and across sites (forms, quizzes, settings, applications they are signed in to, research), using their Kivo workspace as context. Both write to Kivo only through Capture and Drafts.

## 1. Where a passage belongs (`knowledge-placement`)

| File | Role |
|---|---|
| `packages/api/src/nova/product/knowledge-placement-rules.ts` | Pure. Places (every existing subject and live topic, with ids and paths), keyword ranking, the decision, the model's prompt and reply reader. Imported by the web page through the draft rules, so it stays pure. |
| `packages/api/src/nova/product/word-match.ts` | Pure word splitting, exact name matching and plural folding, shared with the saved-page reader. |
| `packages/api/src/nova/product/knowledge-placement.ts` | The service: workspace places (cached 30 s per learner), related notes (`searchNoteBodies` + Connect's `similarity.compare`), `suggestPlacement`. |
| `packages/api/src/nova/product/capture-drafts.ts` | Stores the answer on the passage: `placeDraftItem` (Kivo's, once), `setDraftItemPlacement` (the learner's). |

**Decision.** Existing subjects and topics are the only possible answers.
1. Rank all places by keyword evidence: the words of each name found in the passage, title, surrounding text and site, rarer words weighted more (log idf over names), plurals folded. Notes the learner filed under a place that share the passage's key terms add evidence.
2. Exactly one place named outright (word for word), ranking first: filed, **high**, no model call.
3. Otherwise one small-model call (`gpt-4o-mini` tier, 80 output tokens, 4 s deadline) chooses one label from the top 12 candidates, or none. A label that is not on the list points at nothing. Code caps its confidence: a "high" with no evidence is held to **medium**.
4. **high / medium**: filed (medium is shown as "Kivo's guess"). **low** or no pick: not filed, kept in the draft, with a suggestion only when there is evidence for one. Nothing is ever created.

**The learner's choice** (`placedBy: "learner"`) is never overwritten, including "leave unfiled". A choice is checked against the workspace (a subject's own topic only; by id, or by name from the Drafts page).

**Stored** on each draft passage (JSON, no schema change): `placement`, `suggestion`, `placedBy`. Older passages read exactly as before.

**Routes.** Extension: `POST|PUT /api/nova/extension/captures/place`, `GET /api/nova/extension/places`. Web: `POST|PUT /api/nova/drafts/[id]/place`, `GET /api/nova/places`.

**Surfaces.**
- Extension popup: Capture saves at once, then a quiet line says where it was filed with Change (`apps/extension/src/lib/places.js`): a searchable subject field, then a topic field filtered to that subject (nested topics with their path), arrow keys, Enter, Escape; 50 rows at most, then "keep typing".
- Drafts page: each passage shows its placement with Change (the same `DestinationPicker` notes use) or File here for a suggestion; passages captured before this are filed when the draft is opened (once each); Create note starts from where most passages were filed.

## 2. The browser agent (extension side panel)

### Where it runs, and how it is reached

| File | Role |
|---|---|
| `apps/extension/src/sidepanel.js` | The one conversation. What the learner types starts a task; a question sent with a screenshot goes to Ask Nova (`/extension/ask`) as before. |
| `apps/extension/src/lib/agent-view.js` | A task inside the conversation: what Nova is doing, its plan, the card for whatever waits for the learner, Pause/Resume/Stop, what it did; the finished answer with sources, findings and Save to Drafts. |
| `apps/extension/src/lib/agent-runtime.js` | The background worker's side: one task at a time, its state in `chrome.storage.session`, messages only from Kivo's own pages, site access given back at the end, a waiting mark on the icon. Running in the worker means a task goes on when the learner switches tabs or closes the panel (a side panel belongs to one tab). |
| `apps/extension/src/lib/agent.js` | The loop (UNDERSTAND → PLAN → OBSERVE → DECIDE → ACT → VERIFY → CONTINUE), limits, repeated-action refusal, pending states. |
| `apps/extension/src/lib/agent-tools.js` | The browser-control layer: every action checked before (allowed? consequential? never?) and verified after. |
| `apps/extension/src/lib/agent-page.js` | Functions run inside a page: observe (text; elements by role, accessible name, question group and state; open dialog; alerts; sign-in and human-check detection), act (click, fill, select, check, press), settle, scroll, read search results. |
| `packages/api/src/nova/product/browser-agent-rules.ts` | Pure: the tool list, the step input read defensively, the system prompt, the reply parser. |
| `packages/api/src/nova/product/browser-agent.ts` | Context at the start (placement service), one step (one model call), workspace search and note reading. |
| `packages/api/src/nova/product/agent-ticket.ts` | A task's HMAC ticket (connection-bound, 45 minutes, 40 steps). |
| Routes | `POST /api/nova/extension/agent/start` (counted once), `/agent/step` (inside the task), `/agent/workspace` (read-only). |

### Tools (code-validated; the model proposes, code decides)

Navigation: `search`, `open {url, new_tab}`, `back`, `forward`, `switch_tab`, `close_tab`. Reading: `read {part}`, `scroll`, `wait {seconds, text}`. Interaction: `click`, `fill {text, submit}`, `select {option}`, `check {checked}`, `press {key}` (Enter, Escape, Tab, arrows, PageUp/Down, Home, End, Space, Backspace; no shortcuts). Knowledge: `extract {quote}` (checked word for word), `workspace_search`, `read_note`, `save_to_drafts`. The learner: `ask_user {question, choices}`, `hand_over {reason}`. End: `finish {status: done|partial|blocked, answer, completed, remaining, concepts, gaps}`. No tool runs arbitrary JavaScript.

Elements carry stable numbers while they stay on the page; one that was re-drawn is found again by role, name and group once ("stale-element recovery"). After every action the page is re-observed (load, or DOM quiet) and the result says what changed.

### Permissions and safety (code, not the model)

- **Site access**: none at install. The page Nova was opened on is read through `activeTab`; any other site waits for the learner (a card names it: Allow this site, Any site for this task, Don't allow). Everything allowed is removed when the task ends.
- **Never**: local or private-network addresses, browser or extension pages, typing into password, payment or one-time-code fields, reading what the learner typed, cookies or storage, passing a CAPTCHA, signing in.
- **Waits for the learner's OK** (`needsConfirmation`): submitting a form (a navigational Next/Continue that is not risky is routine), signing in, payment forms, buy/pay/order/book/post/send/delete/publish/subscribe/follow/finish-quiz buttons, deleting/buying/sign-out links, downloads, security or privacy settings, and any text or address carrying 60+ characters of the learner's Kivo material into a site (`carriesPrivate`).
- **Hand-over**: sign-in pages, human checks, pages stuck on a browser dialog (script timeout).
- **Untrusted content**: page text and elements reach the model inside `<untrusted_page>`, the learner's notes inside `<workspace_data>`, after the rule that neither is an instruction.
- **Limits**: 30 steps, 12 minutes, 36 model calls by default (extension), 40 steps per ticket (server); one last write-up step at a limit; the same action repeated is refused, three refusals end the task. Pause takes effect after the step in flight; Stop at once, closing the tabs Nova opened.

### Workspace intelligence

At the start: subjects, the places most relevant to the objective and the page's title (with Kivo's mastery estimate and session count for each topic, or "not studied yet"), and related notes by id. Mid-task: `workspace_search` (notes with a snippet around the words, places, saved pages via the library) and `read_note` (one note and its related notes), all through the owning modules (`notes.ts`, `learning-events.ts`, the knowledge engine), the credential's learner only. Writes go through Capture into Drafts and are filed by the placement service; notes and the map change only when the learner merges the draft.

### Usage

One task is one request on the learner's daily allowance (counted by `/agent/start`, feature `extension_agent`), the same as one Ask Nova question, however many clicks it takes. Every step's tokens are metered on the account (`withinCountedTask`). A step costs roughly 3–6k input tokens and 100–400 output tokens; a page question takes 1–2 steps, a form or quiz 8–15, research 15–30.

## Cost

| | Model calls | Tokens (rough) | Allowance |
|---|---|---|---|
| Capture, a name matched outright | 0 | 0 | none |
| Capture, otherwise | 1 small-tier call | ~500 in, ~20 out | not counted (`capture_placement`, like saved-page filing) |
| Agent task | 1 per step (1–2 for a question, 8–15 for a form or quiz, 15–30 for research) | ~3–6k in, ~100–400 out per step | one request per task (`extension_agent`); tokens metered per step |

Production routes every tier to the configured provider (Claude Haiku 5.5 at the time of writing); actual cost per feature appears in the AI usage analytics under these feature names.

## Known limits

- Ranking is keyword evidence (with plural folding); meaning comes only from the model's pick among the shortlist. There is no semantic index.
- PDFs cannot be read in the browser's viewer (arXiv PDFs are opened as their abstract page).
- Pages that need a sign-in are skipped; the agent never signs in.
- Pause takes effect after the step in flight (one model call and one action).
- Same-origin iframes, canvas-drawn apps (Google Docs' editor, Figma) and pages inside closed shadow roots are not observed; synthetic events are not trusted input, so a site that checks `isTrusted` ignores them.
- `activeTab` and Chrome's own permission prompt are exercised by hand, not by the automated run (a script cannot answer the prompt).

## Testing

- `packages/api`: `knowledge-placement.test.ts`, `research-agent.test.ts` (jest); `nova-placement.itest.ts` (real Postgres).
- `apps/extension`: `npm test` runs the permission and code audits plus `agent.test.mjs` (safety rules, picker search, the loop against a scripted model and fake browser).
- Acceptance in real Chrome (Chrome for Testing, the built extension, the local API on a test database, the real model, synthetic fixture sites): see the PR description for the scenario list and results.
