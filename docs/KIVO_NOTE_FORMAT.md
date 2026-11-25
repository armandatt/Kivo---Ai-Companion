# Sharing one note: `.kivo` note packages and PDFs

Status (2026-11-25, branch `feature/review-a-map-sharing`, **not merged or deployed**): built and tested. A note's **Share** menu offers two choices, and **Notes › More › Import a shared note or PDF** (`/notes/import`) brings either kind of file in.

| Choice | File | What it is for |
|---|---|---|
| **Download .kivo** | `<title>.kivo` (`packageType: "note"`, `contentFormat: "kivo.note/1"`) | Editable in Kivo: the note's text exactly, with its images and files |
| **Export PDF** | `<title>.pdf` | To read or print anywhere. A rendition, never a substitute for the `.kivo` |

## The extension

**`.kivo`, for notes as well as maps** (owner, 25 Nov 2026: "for now .kivo is perfectly fine"). The manifest says which kind a file is. `.kio` is kept for later and is not written or read today. `.qvo` (the first proposal) is not used: it is already QlikView's.

MIME type: `application/vnd.kivo.note+zip` (maps: `application/vnd.kivo.map+zip`).

## What is in a `.kivo` note

The same hardened envelope as a map (`kivo.archive/1`, `docs/KIVO_PACKAGES.md`):

| Path | What |
|---|---|
| `manifest.json` | `format: "kivo.archive/1"`, `packageType: "note"`, `contentFormat: "kivo.note/1"`, package id, created time, title, counts, and every other file with its size, type and SHA-256 |
| `note.json` | Title; the subject and topic **names** it was filed under (a suggestion: the importer chooses); source; the assets (ref, kind, type, file name, size, sha256, image size and where an image came from); what couldn't be carried |
| `content/note.md` | The note's Markdown exactly as written (colour spans, callouts, maths, checklists, tables, `[[links]]`), images as `![caption](kivo-image:a1)`, files as `[name.pdf](kivo-file:a2)` |
| `assets/images/a<k>.png\|jpg\|webp` | The note's images, each up to 2.5 MB, at most 40 |
| `assets/documents/a<k>.pdf` | Files kept with the note (PDFs), each up to 10 MB, at most 10 |
| `assets/other/` | Reserved; nothing writes it, and a file there is refused |
| `provenance.json` | Creator credit, licence, export time, package id |

All assets together are at most 40 MB. A file kept with the note but not named in its text is added to the text as a file line, so nothing the note holds is dropped. An image the text names that can't be carried becomes `kivo-image:missing` and is counted.

Not included: the note's id, any owner id, mastery, sessions, Learning DNA, PDF highlights, Nova conversations.

## Checks on every file

- The envelope's checks (as for maps): sizes before inflating, compression ratio, allowed paths only, no `..` or absolute paths, every file listed and checksummed, nothing unlisted.
- **A map is refused** by the note importer, before anything is written (`wrong_package_type`): "This .kivo file is a Knowledge Map, not a single note. Import it from Knowledge Map → Import a map." The map importer refuses a note the same way.
- Every asset's bytes are the type it claims (PNG, JPEG, WebP or PDF, by magic bytes), with the declared size and sha256.
- The text may name only assets the file carries, of the right kind.
- The source must be an http(s) address.

## Import (`portable/note-share.ts`)

1. **Preview** (`?action=preview`): title, creator, export date, licence, images and files, `storageBytes`, the creator's subject and topic (and the importer's subject of that name, if any), and whether this file was imported before. Stores nothing.
2. **Destination**: the learner chooses a subject (or none) and a topic; the title can be changed. The subject must be theirs.
3. **Storage** for every image and file is reserved before anything is written; refused, nothing is made.
4. **The note** is made through `notes.ts createNoteIn`, in one transaction with the job's record of it. Its images (`saveNoteImageBytes`) and files (`saveNoteAttachmentBytes`) are stored as the importer's own under keys made from the package. Then the text is rewritten to name their new ids (`updateNote`).
5. **Read back**: the text exactly, every image and file by sha256. Only then is it complete.
6. **Idempotent**: the same file again opens the note already made; "Import another copy" (`copy=1`) makes a new one. A stopped import continues when the same file is sent again.
7. No model is called, no credit is spent, and any plan may import.

The creator's note can never be changed by an import: the file carries no reference to it, and every write uses the importer's session.

## PDF export (`portable/note-pdf.ts`)

Made on the server with pdfkit 0.20.2 and the bundled Liberation Sans fonts (SIL Open Font License, `packages/api/assets/fonts/LICENSE_LIBERATION`):

- **Drawn**: headings, paragraphs with bold, italic, highlights and inline code; bullet, numbered and checklist items (nested by indentation); quotes and callouts (with their label); code blocks; maths as written (LaTeX source, not typeset); tables; dividing lines; the note's own PNG and JPEG images with their captions.
- **Links**: web links stay clickable. `[[note links]]` are text, because the other note isn't in the PDF.
- **Every page**: the note's title, "Kivo", the export date and "Page n of N". Under the title: subject › topic, "Exported from Kivo by …" and the last edit date.
- **Files** kept with the note are named where they appear and listed at the end under "Files kept with this note (not inside this PDF)", with their sizes.
- **Not drawn, and said so on the last page**: WebP images (named; the `.kivo` keeps them) and characters the font can't draw, such as Devanagari or emoji (shown as a stand-in, counted).
- **Safe**: only the note's text and its own image bytes are used. Nothing is fetched; an image address from another site stays a link; no HTML is read; nothing in the PDF runs.

## PDF import (cofounder review §4.4)

- **The original bytes are kept** as a file of a new note (`NovaNoteAttachment`), untouched and never flattened into text. The note says what it is, with a download link: `[name.pdf](kivo-file:<id>)`.
- **Text is optional and labelled.** On the import page, "Read the text inside" uses PDF.js in the learner's browser (nothing is sent anywhere). The learner sees a preview and may tick "Add this text below the PDF". It is added under "## Text from the PDF" with a warning that it can miss or misorder text, tables, formulas and images, and that the PDF is the record. It is never treated as lossless.
- **No OCR.** A scanned PDF imports as the file; the page says no text was found.
- **The same PDF again** (by sha256) opens the note already made, unless another copy is asked for.
- Up to 10 MB, counted on the storage allowance. `/api/nova/notes/files/:id` serves the file to its owner only, always as a download.

## Routes

| Route | What |
|---|---|
| `POST /api/nova/portable/notes/export` `{ noteId, format: "kivo" \| "pdf", credit?, license? }` | The file (`export` rate limits and one at a time) |
| `POST /api/nova/portable/notes/import?action=preview\|import&name=…&subjectId=…&topicName=…&title=…&copy=1` | Body: the `.kivo` or PDF bytes (`import` rate limits, upload budget, one at a time) |
| `GET /api/nova/notes/files/:id` | A file kept with a note, to its owner, as a download |
