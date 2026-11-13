# Kivo Connect: conversation curation (`capture_knowledge`)

**Who does what.** An MCP server cannot read a ChatGPT or Claude conversation. The assistant, which can, extracts the items and sends them; Kivo compares, decides, writes and verifies. Kivo adds no model of its own.

## Input

- `items` (1–40): `{ title, kind, body, concepts?, relatedTo? }`. `kind` is one of `concept`, `explanation`, `example`, `implementation`, `decision`, `open_question`, `reference`. `body` is Markdown (formulas, code, tables kept), up to 60,000 characters. The tool description tells the assistant to keep technical depth (assumptions, steps, trade-offs, examples) and drop chit-chat and repetition.
- Where: `subjectId` / `subjectName` (an existing subject; `createSubject: true` only when the learner asked), optional `topicName`.
- `source`: `conversationTitle`, `conversationId`, `url`, only when known.
- `mode`: `preview` (writes nothing) or `apply`; `idempotencyKey`.

## Decision per item (`curation.ts planCapture`, pure)

The learner's notes are searched by the item's title and key terms, then compared (`similarity.ts`, keyword overlap):

| Overlap with the closest note | Action |
|---|---|
| `exact_duplicate`: the item's text is already in it | skip, naming the note |
| `same_concept`: same title, or most title words shared | **enrich**: a section appended to that note (`### Explanation: …`), guarded on the version read. A new explanation is never dropped because the concept exists. |
| `related`: some shared title words or text | new note, with a `## Related` list of `[[links]]` to the related notes (and `relatedTo`) |
| `new` | new note |

Two items with one title in a capture make one note. A note is filed under the subject given, and under a topic when one was named or the item's title or `concepts` name one of that subject's topics. No topic is invented.

## Provenance

Each note or section ends with `*Captured from a conversation with <assistant> · "<title>" · [source](url) · conversation <id> · <date>*`, with only the parts that are known. The assistant's name is the one it registered (self-declared). The date is the server's.

## Output

`decisions` (per item: action, why, matches with similarity scores), counts, and on apply each change's result (created / updated / skipped / failed with links), plus the read-back `verification`. More than 12 items returns a plan for the learner to approve (see the tool reference).
