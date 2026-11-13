# Capture first: drafts, notes, the extension's Nova, Quick Focus

Branch `feature/capture-first`. Written 13 Nov 2026, before implementation, from the code as it stands on `main` (5852900).

## What exists today (traced to the code)

**Notes have one store:** `NovaNote`, written only by `product/notes.ts`. Every path below ends there.

| Way in | Entry | Path underneath | Organising asked for |
|---|---|---|---|
| New note | Notes header, sidebar tree, ⌘K, the New menu, the Map ("New note here"), Knowledge, the saved-page card ("Write a note") | `/notes/new?…` → `NoteCreate` screen (Start writing / Draft with Nova) → editor → `POST /api/nova/notes` | A choice screen before the editor opens |
| Capture or import | Notes header, the extension's "Add to notes", the Send to Kivo Notes bookmarklet | `/notes/capture#…` → review → `createNote` or `appendToBody` | Destination at capture time |
| Save selection → note | Extension popup: Save selection → existing or new note | `POST /api/nova/extension/notes` → `note-append.ts` (`selectionSection`) | Note picker, subject and topic, in the popup |
| Save selection → Saved pages | Extension popup | `selection_saved` learning event | Subject and topic fields in the popup |
| Passage from the PDF reader | Reader → Add to note | `reader-send.ts` callout | A note, at capture time |
| Nova's text into a note | Tutor → Add to note (`InsertPreview`), Editor → apply | Guarded `PATCH` | None (already in a note) |

**Problems**

1. **Organising before capturing.** Each passage from the extension asks where it goes: a note, a subject and a topic. Nothing collects passages over a reading session.
2. **Source lines repeat and show raw addresses.**
   - `selectionSection` writes `*Source:* <title> <full URL>` under every passage.
   - `captureBody` writes `Source: <title> <full URL>`.
   - The reader draws every address in full: there is no `[label](url)` link.
3. **Three ways to add a passage to a note,** each with its own picker: the capture page, the popup's note picker, and the saved-pages row.
4. **New note opens a choice screen,** not the editor.
5. **The extension's Ask Nova is one question, one answer:**
   - nothing earlier goes with a follow-up;
   - plain text only, 160 words, cut at 1,800 characters;
   - the reply's spaces are collapsed, which breaks code;
   - no maths, tables or code are drawn;
   - it lives in a 420×600 popup.
6. **Focus starts from a plan or a task.**
   - The session route already accepts a session with only a label (no topic, no task, untimed). Nothing on Home offers it.
   - No page lists past sessions.

## After

### Capture → Drafts → a note

- **A draft** is a capture inbox: `NovaCaptureDraft`, one row per reading session. Each passage is an item in `items` (Json), and keeps its own:
  - source address, title and site;
  - captured time;
  - text;
  - the learner's own observation.

  Status is `open`, `merged` or `discarded`, and `version` guards every write. **Additive schema: `prisma db push` before the API deploy.**
- **The grouping rule:**
  - A capture joins the learner's most recent open draft if that draft's last capture was within **3 hours** and it holds fewer than 100 passages.
  - Otherwise it starts a new draft.
  - "New draft" in the popup or the inbox always starts a fresh one.

  So one sitting is one draft, and tomorrow's reading is a new one.
- **Idempotent:**
  - Each capture carries a client key, and a retry with that key adds nothing.
  - The same text from the same address already in the draft is reported as "already in this draft".
  - Writes are conditional on `version` and retried on a race.
- **Review (`/notes/drafts`):**
  - Passages are grouped by source, each with Open source.
  - Each passage can be edited, removed or moved up and down, and given an observation.
  - The draft can be renamed or discarded, and a discard can be undone.
- **Merge:**
  - **Create note:** one note, filed where the learner chooses now.
  - **Add to note:** appended to an existing note, never replacing anything.
  - Both show a preview first, then write through the existing guarded writes (`createNote` with `once`, `replaceBodyIn` against the version read). The draft becomes `merged` with the note's id.
- **Source attribution:** once per source group, as a heading and one compact line:

  ```
  ### Attention Is All You Need
  [View source](https://arxiv.org/abs/1706.03762) · arxiv.org

  > first passage

  > second passage
  ```

  Adding to a note that already cites that address adds the passages to that group and repeats no heading.
- **Reading view:**
  - The reader learns `[label](https://…)` links, drawn as compact links.
  - Bare addresses are drawn shortened (site and path, with the full address on hover), so older notes stop showing long raw URLs.
  - The note's text is not changed.

### Notes: create, add, capture

- **Create note:** `/notes/new` opens the editor at once. Draft with Nova stays, as a button in the empty editor, not as a screen in front of it.
- **Add to note:** one destination picker is shared by Drafts and the capture page.
- **Capture for later:**
  - The extension's Capture puts passages in Drafts.
  - The capture page gets "Keep in drafts".
  - The Notes header shows Drafts with a count.
- **Notes header:** New note · Drafts · More (Import paper, Capture or import), instead of three equal buttons.

### Extension

- **The popup is for capture:**
  - Capture selection (to the current draft), Save page and Study this;
  - the draft's state ("3 passages from 2 pages") with Review in Kivo;
  - Ask Nova, which opens the side panel.
- **Moved off the popup:**
  - the subject and topic fields: filing now happens in Kivo, and Nova suggests a topic for a saved page as before;
  - the in-popup note picker: Drafts → Add to note covers it.

  The routes stay for older versions of the extension.
- **The Nova side panel** (`chrome.sidePanel`, adds the `sidePanel` permission, which Chrome installs without a new warning):
  - the conversation fills the panel, the input stays pinned, and the page is shown as one compact line;
  - New conversation starts afresh;
  - the conversation is kept in `chrome.storage.local` per page, so it survives closing the panel or restarting the browser.
- **Follow-ups:** each question sends the last turns (`history`) to `POST /api/nova/extension/ask`, which puts them in the prompt. It stays stateless: nothing is stored server-side, as before.
- **Concise by default:** the extension asks for `detail: "brief"`, and More detail asks again with `"detailed"`. This applies to the extension route only; nothing else in Kivo changes.
- **Rendering:**
  - answers are Markdown;
  - the side panel draws headings, lists, tables (scrolling sideways), code blocks (scrolling), links, and maths through KaTeX;
  - KaTeX is the same package the web app uses, copied into the package at build time, with no remote code;
  - nothing is set as HTML except KaTeX's own output.
- **Safari** has no side panel, so the same conversation view opens in the popup there.

### Quick Focus

- **Home:** a Quick focus button starts an untimed session at once, with the label "Quick focus", no task and no topic, through the existing `start` command and `openStudySession`.
- **Optional details while it runs:** a title, a category and a description. They go through a new `set_details` session command:
  - the title goes to `currentFocus`, where the label already lives;
  - the category and description go to a new nullable `NovaStudySession.focusDetails` (Json, additive).
- **Finishing is the existing End:**
  - it is idempotent through guarded writes;
  - it counts in Progress like any timed session (finished, timed by Nova, at least 10 minutes);
  - it moves no mastery, because there is no topic, and completes no task, because there is no task.
- **History:** Progress gets "Recent sessions", the last finished sessions with their title, category and minutes, and whether each counted.

## Not done here

These are left for later:

- Server-side conversation storage for the extension.
- Purging discarded drafts.
- A draft's captures do not also appear in Saved pages.
