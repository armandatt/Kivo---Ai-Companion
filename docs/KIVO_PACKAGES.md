# Portable Knowledge Maps: `.kivo` packages

Kivo curates a map, exports it as a `.kivo` file, the file is passed around (WhatsApp, Telegram, a website), and a signed-in learner imports it. The import is an independent copy they own. There is no online sharing, public viewer or fork in this design; the package format is built so those can reuse it later.

Status (2026-11-25, branch `feature/review-a-map-sharing`, **not merged or deployed**): every export is now full-fidelity `kivo.map/2` (topic explanations, every note in scope with its images and files, saved pages with their metadata and tags, task definitions), inside one envelope shared with single-note packages (`docs/KIVO_NOTE_FORMAT.md`). Files from before 25 Nov (`kivo.map/1`, and the first `kivo.map/2`) still import unchanged. The Bennett third-year CSE package waits for the approved map from the Kivo team (see "Bennett package").

## Milestone 0: what was removed, what the map really is

**The earlier online-sharing Phase 4** (publications, public viewer, forks) got as far as one local commit with one file: a pure package module. It was never pushed, had no schema change, routes or UI, and nothing of it reached a database or production. The branch is kept locally as `backup/phase4-online-sharing-wip` (not pushed). Its one file was generic and is reused here, with its "publication" fields replaced by provenance. **Nothing else needed removing.**

**The Knowledge Map has no node or edge tables.** It is drawn (`nova/product/knowledge-map.ts`, `buildKnowledgeMap`, pure) from the learner's own records. A package carries exactly these:

| Map element | Stored as | Writer an import must use |
|---|---|---|
| Nested maps | `NovaSubject.parentId` (subjects inside subjects, depth ≤ 4) | `applyStudyEdits` `add_subject` with `parentName` |
| Topics and topics inside topics | `NovaTopicMastery.parentId`, `position`, `kind` | `applyStudyEdits` `add_topics` with `parentName` |
| Notes filed under a subject/topic | `NovaNote.subjectId` + `topicName` | `notes.ts createNote` |
| Saved pages (links) | `NovaLearningEvent` | `learning-events.ts` (save) |
| Note images | `NovaNoteImage` | `note-images.ts saveNoteImageBytes` (format 2) |
| Files kept with notes (PDFs) | `NovaNoteAttachment` (new, 25 Nov) | `note-attachments.ts saveNoteAttachmentBytes` (format 2) |
| What a topic's plan says | `NovaTopicMastery.details` | `applyStudyEdits` `update_topic` (format 2) |
| Tasks and their steps | `NovaTask` (+ `NovaTaskDependency`) | `tasks.ts createTasksIn` (format 2) |

Other facts:
- **Ownership** is per learner profile (`NovaAcademicProfile`). `NovaWorkspace` is a record of a plan Nova made, not a shared container, so "destination workspace" means the learner's own account: the import becomes a new top-level subject tree there.
- **One batch is atomic.** `applyStudyEdits` is versioned and all-or-nothing per batch of up to 60 edits. A larger map takes several batches, so the import is a recorded, resumable job: one per package and learner, with its status kept.
- **Subject names are unique per learner** (`@@unique([profileId, name])`), so an import renames a clash, for example "Compiler Design (imported)".

## Milestone 1: the `.kivo` format (`kivo.archive/1`, map format `kivo.map/1`)

A ZIP file, extension `.kivo`, media type `application/vnd.kivo.map+zip`:

```
manifest.json            format, mapFormat, packageId (uuid), createdAt, title,
                         counts {subjects, topics, notes, resources, edges, nestedSubjects},
                         files[] {path, bytes, type, sha256}
graph.json               title, description, license, attribution, excluded,
                         subjects[{ref, name, parentRef}], topics[{ref, subjectRef, parentRef, name, kind, position}],
                         resources[{ref, title, url, domain, subjectRef, topicName}],
                         notes[{ref, title, subjectRef, topicName, path}]
content/notes/<ref>.md   one approved note each
provenance.json          creator, source, license, exportedAt, packageId, importedFrom
```

- **References are local to the package** (`s1`, `t3`, `n2`, `r1`). No database id, account, email or learning state (mastery, reviews, sessions, Learning DNA) is ever written.
- **What goes in.** Exactly one root subject and its nested subjects; their non-archived topics; only the notes the exporter selects; saved pages as links only (plain `http(s)`, no credentials).
- **What is left out, and counted** in `excluded`: note images (each replaced in the note by a line saying so), private notes that were not selected, and all learning state.
- **Licences:** `all-rights-reserved`, `cc-by-4.0`, `cc-by-sa-4.0`, `cc-by-nc-4.0`, `cc0-1.0`.

### Checks on every upload (`unpackArchive`), before anything is stored

1. At most 50 MB as uploaded (10 MB before 25 Nov), and it starts with a ZIP header.
2. **Before inflating:**
   - at most `notes + assets + 8` entries;
   - every path is safe: no `..`, absolute paths, backslashes or control characters (ZIP Slip);
   - every path is one of the allowed names, nothing else;
   - each entry's declared size is capped, and so is the compression ratio (zip bombs), and the total.
3. **After inflating**, the real sizes are checked again, because a header can lie.
4. **The manifest:**
   - the format and map format are known, otherwise `unsupported_version`;
   - every listed file is present with a matching size and sha256;
   - no file is present that it doesn't list.
5. **The graph is rebuilt and validated whole** (`validatePackage`):
   - one root; parents come before children;
   - no duplicate names where Kivo requires unique ones;
   - length limits;
   - format 1: no `kivo-image:` references; format 2: a note names only its own assets, of the right kind;
   - safe URLs;
   - a known licence.

**Compatibility:** a newer format is refused with `unsupported_version`, never half-read. Attachments arrived in `kivo.map/2` (25 Nov) inside the same `kivo.archive/1` envelope, under `assets/`, with the same inventory and checks (see "Full fidelity").

## How export and import work (Milestones 2–5)

- **Export** (`portable/export.ts`):
  - `POST /api/nova/portable/export { action: "preview" | "export", … }`.
  - Reads only the session learner's subject tree (`loadStudyStructure`), the notes they ticked (`notes.ts notesForExport`) and the links filed under the tree (`learning-events.ts`).
  - Packs the file, then unpacks it again before returning it. Writes nothing.
- **Import preview:** `POST /api/nova/portable/import/preview`, with the file as the body.
  - Runs every archive check, then `checkImportable`: subject depth ≤ 4, topic depth ≤ 6, Kivo's name lengths.
  - Plans clash-free subject names. Subject names are unique per learner, so a clash becomes "Name (imported)".
  - Stores nothing.
- **Import** (`portable/import.ts`): `POST /api/nova/portable/import` with the file, and `POST /api/nova/portable/import/:id` to continue.
  - One `NovaImportJob` per (learner, packageId). The same file again returns the import already made. A different file with the same id is refused.
  - **Stages:**
    1. **structure:** `missingEdits` → `applyStudyEdits`, in batches of up to 60, re-reading the structure each pass, so maps larger than one batch work and a resumed import adds only what is missing.
    2. **notes:** `createNote` once per note, with each done note recorded on the job.
    3. **links** (25 Nov, founder review #15): each link becomes a saved page of the importer's, filed under the same subject and topic, through `learning-events.ts importSavedLink`. `source: "kivo_import"`; its note says which map it came from; `clientEventId` is `linkClientId(packageId, ref)`, so a resumed or repeated import makes each once. A page the importer already saved is not duplicated and keeps their filing (one they had filed nowhere is filed here). No processing is queued (no model calls). Each link's outcome is recorded on the job (`progress.links`).
    4. **about:** one "About this map" note at the root (filed nowhere for a whole map with several roots), holding the title, creator, source, licence, dates, package id, what was left out, and the links as a list.
    5. **verify:** every subject under its parent, every topic under its subject and parent, every note made, every link a saved page under its subject and topic (`verifyLinks`). A job from before the links stage (no `progress.links`) is sent back through it.
  - Only after `verify` passes is the job `complete`. The stored package is then cleared.
  - **One run at a time.** A run claims the job; a stopped run can be taken over after 2 minutes, or at once if it failed.
  - **What it touches:** only the importer's account. No model call. No storage use: format 1 has no images.
- **Guards** (`apps/api/lib/nova/portable-access.ts`):
  - The learner comes from the session only.
  - Uploads must use a content type HTML forms cannot send (`application/vnd.kivo.map+zip` / `octet-stream` / `zip`). An Origin header must be Kivo's; `Sec-Fetch-Site` must not name another site.
  - 10 MB at most.
  - Rate limits per account (docs/RATE_LIMITS.md): export 10/min, preview 20/min, import 6/min; one export and one import at a time per account (3–4 for everyone); uploads count their size against an hourly budget.
- **Pages** (25 Nov, founder review #10 and #14): two buttons on the Knowledge Map, **Share** (`/map/share`) and **Import** (`/map/import`); `/map/portable` redirects to Share.
  - **Import:** choose a file → checked → preview (counts, outline, renames, what is excluded) → Import → open the map (`arrive=import`: the map's opening plays, fitted at a readable zoom; founder review #16). A repeat says it was already imported, and a failure offers Try again, which resumes.
  - **Export:** Whole map (default) or One subject → file name → Download. Under "More options": notes (none ticked by default), links (on), who may pass it on (three choices: All rights reserved, CC BY 4.0, CC0; files carrying BY-SA or BY-NC still open and are named), credit.
- **Tests:**
  - `portable/__tests__/kivo-archive.test.ts` (9): format, ZIP Slip, zip bombs, tampering, inventory, versions.
  - `portable/__integration__/kivo-portable.itest.ts` (9, real Postgres; the four added 25 Nov cover links and whole maps):
    - export reads only and leaks no ids or private text; another learner can't export;
    - the import makes new ids with nesting and filing intact, keeps provenance, and leaves the source untouched;
    - importing again makes nothing; editing or deleting the copy leaves the source alone;
    - a tampered file makes nothing;
    - resume after a stop creates nothing twice, and a stranger can't resume someone else's job;
    - 70 units and 210 topics import over several batches;
    - links filed under different topics (and a subject inside a subject) arrive as saved pages in exactly those places, with provenance; the source is unchanged; importing again makes nothing;
    - an import stopped among the links resumes and makes each once; a job from before the links stage gets its links;
    - a page the importer already saved is neither duplicated nor moved;
    - a whole map with two top-level subjects, one clashing with the importer's own, imports as independent copies.

## Production rollout

1. `prisma db push`, from a checkout of the merged commit: adds the `NovaImportJob` table, its unique and created-at indexes, and its foreign key to the profile. Nothing else.
2. Deploy the API (Render).
3. The web app deploys from `main` (Vercel).

**Rollback:** redeploy the previous API and web commits. The table can stay; nothing else reads it.

## Bennett package (content-dependent)

The platform is ready. The package itself needs the approved third-year B.Tech CSE map built in a Kivo account by the Kivo team; Kivo does not make up course content. Then:

1. On `/map/portable`, choose the map's root subject.
2. Tick the approved notes.
3. Pick the licence and credit "Kivo".
4. Download the file.
5. Import it into a fresh test account and compare the counts.
6. Share the `.kivo` file with the student guide below.

### Student guide (short)

1. Sign up or sign in at thekivo.in.
2. Open Knowledge Map → Import / export.
3. Choose the `.kivo` file you were sent.
4. Check what it holds, then choose **Import into my Kivo**.
5. Choose **Open the map**. It's your own copy: rename, add, delete; nothing you do changes anyone else's.

## Format 2: the whole map (`kivo.map/2`, 25 Nov, founder review #12)

- **Why a new version.** Format 1 holds exactly one root subject, and a learner's map usually has several top-level subjects. Wrapping them in an invented root would put a subject in the importer's map that the creator never made, so format 2 instead allows **one or more** subjects with no parent.
- **Reading.** `validatePackage` and `unpackArchive` accept both; the manifest's `mapFormat` (and `contentFormat`) must equal the graph's `format`. Format 1 still refuses a second root, and refuses assets or tasks.
- **Import.** Every root is planned for a clash-free name, made, and read back; the job's `rootSubjectId` is the first root and `progress.rootSubjectIds` lists all of them. A whole map opens on the map's top level.

## Full fidelity (`kivo.map/2` from 25 Nov; cofounder review §2, §13)

Every export (the whole map, or one subject and everything inside it) writes format 2 and carries **everything in scope automatically**. The learner can untick notes, or leave saved pages or tasks out, under "More options". What is not carried is counted in `excluded` and shown before the download and before the import: nothing is dropped silently, and nothing claims to be complete when it isn't.

### The shared envelope (`kivo.archive/1`)

Maps and single notes use one envelope (`portable/kivo-archive.ts`: `packEnvelope`, `unpackEnvelope`). `manifest.json` says what the file is:

| Field | Map | Note |
|---|---|---|
| `format` | `kivo.archive/1` | `kivo.archive/1` |
| `packageType` | `map` | `note` |
| `contentFormat` | `kivo.map/2` (or `kivo.map/1`) | `kivo.note/1` |
| `mapFormat` | same as `contentFormat` (how files before 25 Nov say it) | — |
| `files[]` | every other file: path, bytes, type, sha256 | same |

A manifest without `packageType` is a map (every file made before 25 Nov). **The map importer refuses a note, and the note importer a map, before anything else about the file is trusted** (`wrong_package_type`, with `found`), and the message says where it goes instead. Both extensions are `.kivo`; `.kio` is kept for later and `.qvo` is not used.

### Layout of a map

```
manifest.json                envelope identity, counts {subjects, topics, notes, resources, edges,
                             nestedSubjects, images, files, tasks, assetBytes}, files[]
graph.json                   title, description, license, attribution, excluded,
                             subjects[], topics[{…, details?}], resources[{…, metadata, tags}],
                             notes[{ref, title, subjectRef, topicName, path}],
                             assets[{ref, noteRef, kind, mimeType, fileName, bytes, sha256, width?, height?, source?, path}],
                             tasks[{ref, title, subjectRef, topicName, parentRef, priority, estimatedMinutes, waitsOn[]}]
content/notes/n<k>.md        each note's Markdown, assets named by package ref:
                             ![caption](kivo-image:a1), [file.pdf](kivo-file:a2)
assets/images/a<k>.png|jpg|webp
assets/documents/a<k>.pdf
provenance.json              creator, source, license, exportedAt, packageId, importedFrom
```

### Coverage matrix (each canonical model)

| Model and field | In a map file | Imported through | Notes |
|---|---|---|---|
| `NovaSubject` name, nesting | Every subject in scope | `applyStudyEdits add_subject` | Renamed on a clash ("(imported)") |
| `NovaSubject` code, credits, type, weak/strong | **No** | — | No import writer sets them; weak/strong is the learner's own judgement |
| `NovaTopicMastery` name, nesting, order, milestone | Every non-archived topic | `add_topics` | |
| `NovaTopicMastery.details` (explanation, sources, a milestone's effort, goals, exercises, project, done-when, resources) | Yes, sanitised by `readTopicDetails` | `update_topic` | Read back and compared |
| Archived topics | **No**, counted (`archivedTopics`) | — | They left the creator's own lists |
| Mastery, reviews, snapshots, plan overrides | **Never** | — | Learning state |
| `NovaNote` title, body, subject, topic | Every note filed in scope (or the ones chosen) | `notes.ts createNoteIn` | Body exact (line endings unified, as the writer keeps them) |
| Notes filed under no subject | **No**, counted for a whole map (`unfiledNotes`) | — | Not on the map |
| Private notes | **Gap**: Kivo has no private-note flag | — | Every note in scope is included unless unticked; the preview says so (`privateNotes: "no_private_flag"`) |
| `NovaNoteImage` (bytes, size, source) | Yes, byte for byte | `saveNoteImageBytes` | PNG, JPEG, WebP; checked by magic bytes |
| `NovaNoteAttachment` (PDF bytes, name) | Yes, byte for byte | `saveNoteAttachmentBytes` | A file kept but not named in the text is added to it |
| `NovaPdfHighlight` | **No** | — | Keyed to a web address and personal |
| `NovaLearningEvent` saved page filed in scope: url, title, description, type, site, canonical URL, image URL, author, published, duration, tags | Yes | `importSavedLink` | Never queued for processing (no model call) |
| Saved page reading status, collection, personal note, processing results | **No** | — | Personal (`pagePersonalState`) or derived |
| Saved passages (selection saves) | **No**, counted (`passages`) | — | |
| Saved pages filed under no subject | **No**, counted for a whole map (`unfiledPages`) | — | Workspace-level |
| `NovaTask` filed in scope: title, priority, estimate, topic, steps, waits | Yes | `createTasksIn` (keys from the package) | |
| Task status, due day, completion, position, calendar events | **Never** | — | `taskProgress` |
| Tasks filed under no subject | **No** | — | In Tasks and Today, not on the map |
| `NovaResourceCollection`, Drafts (`NovaCaptureDraft`), exams, calendar, workspaces | **No** | — | Workspace-level or personal schedule |
| Learning DNA, sessions, credits, subscriptions | **Never** | — | |

### Import lifecycle

1. **Session only**: the learner comes from the session cookie; nothing in the file names an owner, and nothing it says can change the destination owner.
2. **Validate before any write**: envelope, inventory and checksums, the whole graph, every asset's size, sha256 and real type (`readAssets`), nesting depth, room for the tasks (`openTaskRoom`).
3. **Type and version**: `wrong_package_type` and `unsupported_version` before anything is written.
4. **Preview** (`previewImport`): counts including images, files, tasks and topic explanations, `storageBytes`, renames, provenance, `excluded`, and whether it was imported before (`job`, `copies`). Stores nothing.
5. **Reserve storage**: the route passes the learner's storage admission (`importStorage` → `admitStorage`); the bytes of every image and file are reserved before the first write, and released after.
6. **Canonical writers only**, in stages: structure → details → notes (each note made and recorded in one transaction; then its images and files under keys made from the package; then its text rewritten to the new ids) → links → tasks → about → verify.
7. **New ids** for everything; package refs never become ids.
8. **Read back**: structure, details, every note's text, every image and file by size and sha256, every link's filing, every task's parent, waits and status. Only then `complete`.
9. **Idempotent**: the same file again returns the import already made; `?copy=1` makes another, independent copy (`<packageId>#2`).
10. **Resumable**: a stopped import continues when the same file is sent again; resuming by job id works for maps without assets, and for a map with images or files whose notes aren't finished it answers `file_needed` (409), because bytes are never kept on the server.
11. **Ownership**: a job id from another account is "not found".
12. **No AI, any plan**: no model is called, no credit is spent, and import is not a paid feature. Only storage counts against the learner's allowance.

### Limits

| Limit | Value |
|---|---|
| Upload | 50 MB (a map or note); 10 MB for a PDF on its own |
| Notes per map | 1,000 (more: the export says so and asks for one subject) |
| Saved pages per map | 2,000 (more: counted as `pagesOverLimit` and shown) |
| Tasks per map | 300 (the open-task limit) |
| Images and files | 400 per map, 40 MB together; one image 2.5 MB, one PDF 10 MB. Past the total, the export refuses and says why |
| Note text | 1,000,000 characters (the note limit) |

The files a whole map can hold are bounded by one request's memory on the API server (Render). A larger map is shared one subject at a time.

### Tests

- `portable/__tests__/full-map.test.ts` (6): format 2 contents and sanitising, byte-identical round trip, a file from before 25 Nov, refusals, a swapped asset, the import helpers.
- `portable/__tests__/note-package.test.ts` (6), `note-pdf.test.ts` (4), plus the earlier archive and whole-map tests.
- `portable/__integration__/kivo-sharing.itest.ts` (7, real Postgres, two accounts): the full round trip (§13.1), storage refused before writes, resume without duplicates and cross-account denial, the note round trip, cross-type refusal, PDF import, PDF export read back with PDF.js.
