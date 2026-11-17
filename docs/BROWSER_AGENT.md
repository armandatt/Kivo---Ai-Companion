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

## 2. Nova in the browser: Chat with Nova, and Do it for me (V1)

### One pipeline

RECEIVE → CLASSIFY → RESOLVE CONTEXT → AUTHORISE → PLAN → OBSERVE → DECIDE → ACT → VERIFY → CONTINUE OR FINISH → CLEAN UP.

| Stage | Where |
|---|---|
| Receive | Popup **Chat with Nova** (answers only, `sidepanel.html?inline=1&chat=1`) or the side panel (**Do it for me**, and questions). |
| Classify | `POST /extension/intent` → `product/browser-intent.ts`: one small-model call reads the request into a kind (conversation, explain/summarise page, explain selection, page question, page action, form, quiz, navigate, workflow, compare, research, unclear) and its **scope** (`limit` "first 3", `short`, `format` points/table). Code maps kind → route: **chat**, **task** (agent on the user's tab), **research** (agent with its own tabs), **clarify** (one question back with choices). A screenshot question is always chat. No model answer: the surface's own route (popup → chat, panel → task). Not counted on the allowance (it precedes the request that is); tokens recorded as `extension_intent`. |
| Resolve context | `apps/extension/src/lib/page-context.js`: the one source of "which page is the user on". The panel belongs to the window (opened with `sidePanel.open({ windowId })`), listens for tab switches and page changes, and resolves the tab in front to `ready`, `no_access`, `unknown` (Nova may not see the address: click Nova on that page, or turn on the optional **Follow my tabs** = `tabs` permission) or `unsupported`. An empty conversation moves with the user; one with turns offers "You moved to … Switch to this page / Stay". A message is always about the page in front when it is sent. The agent's own tabs are never treated as a move. |
| Authorise | Site access: the page Nova was opened on (`activeTab`), or a site the user allowed. The access card offers **Allow <site>** (kept until removed under **Sites** in the popup), **Any site, this task** (given back when the task ends) and **Don't allow** (remembered for the rest of the task: never asked again, the task carries on without it). Chrome shows its own prompt for every grant; the card says so. |
| Chat path | `POST /extension/ask` with the page's text (read by the extension with the same reader as the agent, ≤ 24,000 characters, `pageComplete` says whether that is all of it), the selection, a pasted or taken screenshot, the scope and the conversation. One model call. |
| Agent path | `lib/agent.js` (loop), `lib/agent-tools.js` (browser control), `lib/agent-page.js` (in-page functions), `lib/agent-runtime.js` (worker), `lib/agent-view.js` (panel UI); server `product/browser-agent-rules.ts` + `browser-agent.ts`. |

### The task state machine (`lib/agent.js` TRANSITIONS)

`planning → running → awaiting_permission | awaiting_user | paused → … → completed | failed | cancelled`. Finished states are final: nothing finished can act again. Every card the user answers carries its task id and its question id; an answer for an older task or question does nothing. A **no** to an approval is final for that action. **Cancel** stops at once and clears anything pending. A **new request is never blocked** by a task that is only waiting or paused: that task is cancelled and the new one starts ("Stopped the earlier task … to do this"). Only a task actively working asks "Stop that task and do this".

### Execution rules (code, not the model)

- **Progress-aware repetition**: an action is refused only when the same *target* (role, name, group of the element as the page showed it; a URL; a query) is tried again on the same *unchanged* page (address + fingerprint + part) after it failed or changed nothing. Opening five different emails, or Next on each quiz page, is allowed. Two refusals in a row → Nova asks the user ("Try another way" / "Stop and tell me what you have") instead of failing.
- **Current tab first**: in `page` mode, `search` is refused until the page has been read through or searched with `find`. `open` of a page already open in the task switches to it. Results pages load in a background tab and are never brought forward.
- **Scope**: on `finish`, an answer longer than asked ("short": > 130 words), not in points when points were asked, or with more points than the limit is sent back once to be written again.
- **Honest reading**: the reader takes the main writing *and* the rest of the page (sections outside `<article>`, sidebars), lists every heading (OUTLINE), tracks which parts were read (PAGE COVERAGE), and `find {query}` searches the whole page, returning numbered elements (including links beyond the 40 shown) and passages. The model may not say the page lacks something before all parts are read or a `find` came back empty. Sources are the pages actually read; the answer cites them `[n]`; the panel counts only those cited.
- **Interaction**: app rows (`role=row`, `onclick`) are clickable elements. A failure says why: hidden, disabled, covered by something (named), or gone (found again by role and name). A link whose click changed nothing is followed by its address.
- **Recovery**: an action is marked in flight (saved) before it runs; a worker that restarts pauses the task and records the in-flight action as *interrupted* (Resume looks at the page first; a consequential action needs the user again). Never replayed blindly.
- **Clean-up**: when a task ends, the tabs Nova opened are closed (never the user's, never the one in front of them) unless **Keep Nova's tabs** is on; task-only access is given back.
- **Limits** unchanged: 30 steps, 12 minutes, 36 model calls (extension); 40 steps per ticket (server).

### Measurement

Each step returns its own token usage (`usage` from the step route, measured with nested `meterLlmUsage`, which now passes every call to the outer meter too, so billing is unchanged). Each finished task's numbers (model calls, input/output tokens, actions, failed actions, refusals, recoveries, tabs opened/closed, pages read, seconds; no objective text) are kept on the device (`chrome.storage.local` `nova.agentMetrics`, last 50; `lib/metrics.js`).

### Tools

Navigation: `search`, `open {url, new_tab}`, `back`, `forward`, `switch_tab`, `close_tab`. Reading: `read {part}`, `find {query}`, `scroll`, `wait {seconds, text}`. Interaction: `click`, `fill {text, submit}`, `select {option}`, `check {checked}`, `press {key}`. Knowledge: `extract {quote}` (checked word for word), `workspace_search`, `read_note`, `save_to_drafts`. The user: `ask_user`, `hand_over`. End: `finish`. No tool runs arbitrary JavaScript.

### Safety (unchanged and still enforced by code)

Never: local or private-network addresses, browser or extension pages, typing into password/payment/one-time-code fields, reading what the user typed, cookies or storage, passing a CAPTCHA, signing in. Waits for the user's OK: submitting a form (navigational Next/Continue aside), signing in, payment, buy/pay/order/book/post/send/delete/publish/subscribe/follow/finish-quiz, risky links, downloads, security or privacy settings, and any text carrying 60+ characters of the user's Kivo material into a site. Page and workspace content reach the model inside `<untrusted_page>` / `<workspace_data>` after the rule that neither is an instruction.

### Search provider

DuckDuckGo's HTML results first, Bing when DuckDuckGo shows a human check or nothing. Google was not adopted: its results page changes structure often, shows consent interstitials in some regions and challenges automated-looking traffic, all of which make extraction less reliable; the provider is kept, but the results page is no longer shown to the user (background tab; the panel lists "Searched for …" and the sources found). A human check is handed to the user, never answered.

## Cost

| | Model calls | Tokens (rough) | Allowance |
|---|---|---|---|
| Capture, a name matched outright | 0 | 0 | none |
| Capture, otherwise | 1 small-tier call | ~500 in, ~20 out | not counted (`capture_placement`, like saved-page filing) |
| Routing a request | 1 small-tier call | ~600 in, ~40 out | not counted (`extension_intent`) |
| Question about the page (chat) | 1 call | ~1–7k in (page text), ~100–300 out | one request (`extension_ask_nova`) |
| Agent task | 1 per step (forms/quizzes ~5–12, research 10–25) | ~3–7k in, ~100–400 out per step | one request per task (`extension_agent`); tokens metered per step |

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
