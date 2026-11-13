# Automatic filing and the research agent

Two features that share one workspace intelligence: Kivo files every captured passage under the learner's own subject and topic, and an autonomous research agent in the extension's side panel searches, reads and organises sources for an objective. Both write only through Capture and Drafts.

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

## 2. The research agent (extension side panel)

`research.html` / `research.js` (UI), `lib/agent.js` (loop), `lib/agent-tools.js` (browser tools), `lib/agent-page.js` (functions run inside pages). Server: `research-agent-rules.ts` (pure), `research-agent.ts`, routes `POST /api/nova/extension/research/context` and `/step`.

**Loop:** PLAN → OBSERVE → DECIDE → EXECUTE → VERIFY → CONTINUE. Context first (relevant places and notes from the same placement service, bounded to 2,400 characters). Then one model call per step returns one tool: `search`, `open`, `read`, `scroll`, `click`, `type`, `switch_tab`, `extract`, `ask_user`, `finish`. The server checks the shape; the extension checks the substance and verifies the result.

**Limits** (`DEFAULT_LIMITS`, configurable): 24 steps, 10 minutes, 30 model calls. At a limit the model gets one last step told no steps are left, and must finish. The same action again is refused; three refusals end the task. Pause takes effect after the current step; Stop at once. State is saved after every step in `chrome.storage.session`, so a closed panel can resume.

**Browser access.** `optional_host_permissions` (`http(s)://*/*`) requested when the learner presses Start, removed when the task ends. The agent opens its own background tabs (the side panel belongs to the learner's tab and would close if the agent switched tabs), plus the learner's page only if they ticked "Include this page". Search: DuckDuckGo's HTML page, then Bing's when it challenges or finds nothing.

**Security (code, not the model).**
- Only public `http(s)` addresses; local and private networks, logins in URLs, browser and extension pages are refused.
- Page content reaches the model inside `<untrusted_page>`, after a rule that nothing in it is an instruction. A real-model check ignored an injected "IGNORE ALL PREVIOUS INSTRUCTIONS".
- Typing only into search boxes, never password fields. Clicks that would submit a non-search form, download, or say buy/pay/sign in/post/send/delete/subscribe… wait for the learner's OK.
- A site's human check (CAPTCHA) is never attempted: the task waits for the learner.
- The page reader never reads field values, cookies or storage.
- A finding must be a word-for-word quote from the page it is credited to; the agent's own reading is stored separately as its note.

**Saving.** Nothing is written during the task. The result (summary citing sources by number, findings grouped by source, concepts, gaps, what Kivo already held) is reviewed in the panel; Save to Drafts captures the summary and each finding into one draft through the ordinary Capture route, and each is filed by the placement service like any capture. Notes and the Knowledge Map change only when the learner merges the draft.

## Cost

| | Model calls | Tokens (rough) | Allowance |
|---|---|---|---|
| Capture, a name matched outright | 0 | 0 | none |
| Capture, otherwise | 1 small-tier call | ~500 in, ~20 out | not counted (`capture_placement`, like saved-page filing) |
| Research task | 1 per step, up to 30 | ~2–4k in and ~300 out per step; a full task ~60–100k in | each step counted (`extension_research`, metered) |

Production routes every tier to the configured provider (Claude Haiku 5.5 at the time of writing); actual cost per feature appears in the AI usage analytics under these feature names.

## Known limits

- Ranking is keyword evidence (with plural folding); meaning comes only from the model's pick among the shortlist. There is no semantic index.
- PDFs cannot be read in the browser's viewer (arXiv PDFs are opened as their abstract page).
- Pages that need a sign-in are skipped; the agent never signs in.
- Pause takes effect after the current step (up to one model call and one page load).
- The research loop runs in the side panel; closing it pauses the task.

## Testing

- `packages/api`: `knowledge-placement.test.ts`, `research-agent.test.ts` (jest); `nova-placement.itest.ts` (real Postgres).
- `apps/extension`: `npm test` runs the permission and code audits plus `research.test.mjs` (tools rules, picker search, the loop against a scripted model and fake browser).
