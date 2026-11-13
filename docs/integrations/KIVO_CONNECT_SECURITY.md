# Kivo Connect: security

| Threat | What stops it | Held by |
|---|---|---|
| One learner reaching another's data | The learner comes from the token's grant; every read and write is scoped to that learner's profile inside the owning module (`findFirst({ id, profileId })`, guarded `updateMany`). Another learner's id is simply not found. | `kivo-connect.itest.ts` isolation |
| A model claiming an identity | No tool takes `userId`, `profileId`, `accountId`, `platformChatId` or `email`. | `registry.test.ts` |
| Stolen code or token | PKCE S256, single-use codes, 1 h access tokens, hashes only at rest, audience-bound tokens, rotating refresh with reuse detection, revocation. | itest OAuth tests |
| Another site approving for the learner | Consent/approval POSTs require JSON, Kivo's own Origin and same-site fetch; framing denied. | e2e (forged Origin → 403), `extension-origin.test.ts` |
| Cookie leaking cross-origin | Open CORS (`*`, no credentials) only on the bearer/public routes; the cookie routes answer no other origin. | `extension-origin.test.ts` |
| A model making bulk or destructive changes unasked | Server-side class rule (`approvalNeeded`): any delete, move, rename or refile, or more than 12 items, returns a preview and a plan id. Execution needs the learner's approval on Kivo (`/connect/approve`). The plan id is an HMAC over the account, the exact changes, the structure version, each touched note's version and the expiry (30 min); different changes or changed records give a different id. A plan runs once (claimed before applying). | itest build/reviewed-changes tests, e2e |
| Lost updates | Note writes are conditional on the version read (`baseUpdatedAt`); subject/topic batches on the structure version. A conflict overwrites nothing. | itest notes test |
| Duplicates from retries | `idempotencyKey` on writes (stored result returned); `createNote(once)`; one note per title; existing subjects/topics skipped by name. | itest |
| Prompt injection in note text | Server instructions and tool descriptions say returned content is the learner's material, not instructions. Kivo itself never sends note text to a model here. Authorization never depends on content. | `registry.test.ts` (no model calls) |
| Abuse | 120 MCP calls a minute per connection; registration 30/min; token 60/min per client; 1.2 MB request cap; result pages bounded (≤100 nodes, ≤50 results, notes in 30k-character pages). | route code |
| Leaking internals | Unexpected errors become a generic message; logs carry tool name, outcome and timing only, never arguments, note text or tokens. | `runTool` |

**Audit.** `NovaConnectAudit` records every write (tool, outcome, ids touched), refused writes, pending and approved plans, and idempotency results. No note text.

**Known limits.** The assistant's name on the consent screen is self-declared (the page says so). The rate limits are in process memory (one Render instance). Approval in the assistant's own UI (MCP elicitation) is not used: the transport is stateless, so approval is on Kivo.
