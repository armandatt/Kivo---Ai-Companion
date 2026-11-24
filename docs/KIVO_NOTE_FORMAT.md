# One note as a file: format proposal (founder review #11)

Status: **extension decided by the owner (25 Nov 2026): `.kio` for a single note, for later. Maps stay `.kivo`.** The package core is built and tested (`packages/api/src/portable/note-package.ts`, `__tests__/note-package.test.ts`); no route, page or button uses it yet.

## The extension: `.kio`

- The review first proposed `.qvo`. That is already QlikView's (Qlik's "QlikView Table" / output files), so it was not used.
- **`.kio`** (owner's choice). No registered file type uses it; "KIO" is also the name of a KDE library (not a file format), so there is no clash on any system.
- MIME type: `application/vnd.kivo.note+zip`.
- The format is named inside the file (`kivo.note/1` in `manifest.json`), as `.kivo` maps are (`kivo.map/1`, `kivo.map/2`).

## What is in a file

A ZIP, like `.kivo`:

| Path | What |
|---|---|
| `manifest.json` | `format: "kivo.note/1"`, package id, and every other file with its size and SHA-256 |
| `note.md` | The note's Markdown exactly as written (colour spans, callouts, maths, checklists and `[[links]]` are all Markdown), with images named `kivo-image:i1`, `i2`… |
| `note.json` | Title, the subject and topic **names** it was filed under (a hint: the importer chooses where it goes), source (title and http(s) address), creator credit, export time, and a count of images that could not be carried |
| `images/i<n>.png\|jpg\|webp` | The note's images, each up to 2.5 MB, at most 20 |

Not included: the note's id, the owner's ids, mastery, sessions, Learning DNA, PDF highlights, Nova conversations.

## Checks on every file (built)

- Same as `.kivo`: size limits read before anything is inflated, compression ratio, only the paths above, no `..` or absolute paths, every file checksummed and listed, nothing unlisted.
- Each image's bytes must be the type it claims (PNG, JPEG or WebP).
- The text may name only images the file carries.
- The source must be an http(s) address.

## Import (to build after the extension is confirmed)

1. **Preview:** title, the first lines rendered by the ordinary note reader, image count, source and credit. Nothing is stored.
2. **Create:** always a **new** note through `notes.ts createNote`. It never overwrites, and is never matched to an existing note by id; an import carries no id.
   - **Duplicates are explicit.** If the learner has a note with the same title, or the same source line, the preview says so and offers "Import as a new note" or "Open mine". Nothing merges by itself.
   - **Images** are stored as the importer's own through `note-images.ts saveNoteImageBytes`, after `admitStorage` (the storage allowance). Their new ids are written into the body before the note is saved.
   - **Filing:** the subject and topic names are offered as a choice among the importer's own subjects (a missing one is offered, never created silently).
   - **Provenance:** a `> [!source]` line saying who shared it and when, kept at the top of the note.
3. **Guards:** the same as map import. Session-only learner, upload content type, Origin check, `portableLimit` and `portableSlot` (rate limits), 30 MB at most.
4. **Export:** "Share this note" on a note → the file, named after the note's title (the `kivoFileName` rules).

The creator's note can never be changed by an import: the file carries no reference to it, and every write uses the importer's session.
