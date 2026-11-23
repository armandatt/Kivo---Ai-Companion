# Portable Knowledge Maps: `.kivo` packages

Kivo curates a map, exports it as a `.kivo` file, the file is passed around (WhatsApp, Telegram, a website), and a signed-in learner imports it. The import is an independent copy they own. There is no online sharing, public viewer or fork in this design; the package format is built so those can reuse it later.

Status (2026-11-24): export, import preview, import (resumable, verified), the import/export page and tests are done. The Bennett third-year CSE package waits for the approved map from the Kivo team (see "Bennett package").

## Milestone 0: what was removed, what the map really is

**The earlier online-sharing Phase 4** (publications, public viewer, forks) got as far as one local commit with one file: a pure package module. It was never pushed, had no schema change, routes or UI, and nothing of it reached a database or production. The branch is kept locally as `backup/phase4-online-sharing-wip` (not pushed). Its one file was generic and is reused here, with its "publication" fields replaced by provenance. **Nothing else needed removing.**

**The Knowledge Map has no node or edge tables.** It is drawn (`nova/product/knowledge-map.ts`, `buildKnowledgeMap`, pure) from the learner's own records. A package carries exactly these:

| Map element | Stored as | Writer an import must use |
|---|---|---|
| Nested maps | `NovaSubject.parentId` (subjects inside subjects, depth ≤ 4) | `applyStudyEdits` `add_subject` with `parentName` |
| Topics and topics inside topics | `NovaTopicMastery.parentId`, `position`, `kind` | `applyStudyEdits` `add_topics` with `parentName` |
| Notes filed under a subject/topic | `NovaNote.subjectId` + `topicName` | `notes.ts createNote` |
| Saved pages (links) | `NovaLearningEvent` | `learning-events.ts` (save) |
| Note images | `NovaNoteImage` | not in format 1 |

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

1. At most 10 MB as uploaded, and it starts with a ZIP header.
2. **Before inflating:**
   - at most `notes + 8` entries;
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
   - no `kivo-image:` references;
   - safe URLs;
   - a known licence.

**Compatibility:** a newer format is refused with `unsupported_version`, never half-read. Adding attachments later (`resources/` with the same inventory and checks) is `kivo.archive/2`.

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
    3. **about:** one "About this map" note at the root, holding the title, creator, source, licence, dates, package id, what was left out, and the links as a list.
    4. **verify:** every subject under its parent, every topic under its subject and parent, every note made.
  - Only after `verify` passes is the job `complete`. The stored package is then cleared.
  - **One run at a time.** A run claims the job; a stopped run can be taken over after 2 minutes, or at once if it failed.
  - **What it touches:** only the importer's account. No model call. No storage use: format 1 has no images.
- **Guards** (`apps/api/lib/nova/portable-access.ts`):
  - The learner comes from the session only.
  - Uploads must use a content type HTML forms cannot send (`application/vnd.kivo.map+zip` / `octet-stream` / `zip`). An Origin header must be Kivo's; `Sec-Fetch-Site` must not name another site.
  - 10 MB at most.
  - Postgres rate limits per learner: export 10/min, preview 20/min, import 6/min.
- **Page:** `/map/portable` ("Import / export" on the Knowledge Map).
  - **Import:** choose a file → checked → preview (counts, outline, renames, what is excluded) → Import → open the map. A repeat says it was already imported, and a failure offers Try again, which resumes.
  - **Export:** choose a subject → tick notes → links on or off → licence → credit → download.
- **Tests:**
  - `portable/__tests__/kivo-archive.test.ts` (9): format, ZIP Slip, zip bombs, tampering, inventory, versions.
  - `portable/__integration__/kivo-portable.itest.ts` (5, real Postgres):
    - export reads only and leaks no ids or private text; another learner can't export;
    - the import makes new ids with nesting and filing intact, keeps provenance, and leaves the source untouched;
    - importing again makes nothing; editing or deleting the copy leaves the source alone;
    - a tampered file makes nothing;
    - resume after a stop creates nothing twice, and a stranger can't resume someone else's job;
    - 70 units and 210 topics import over several batches.

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

## Limits of format 1

- Note images and PDFs are not carried. Each image is replaced in the note by a line saying so.
- Saved pages travel as links in the source note, not as saved-page entries.
- Topic explanations (details) are not carried.

`kivo.archive/2` adds `resources/` with the same inventory and checks.
