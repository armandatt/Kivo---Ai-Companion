# Portable Knowledge Maps: `.kivo` packages

Kivo curates a map, exports it as a `.kivo` file, the file is passed around (WhatsApp, Telegram, a website), and a signed-in learner imports it. The import is an independent copy they own. There is no online sharing, public viewer or fork in this design; the package format is built so those can reuse it later.

Status (2026-11-24): Milestones 0–1 are done. The format, pack/unpack and validation live in `packages/api/src/portable/`, with tests. Export, import, UI and the Bennett package are still to come (below).

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

## Still to do (Milestones 2–7)

- **2. Export** (`portable/export.ts`, `POST /api/nova/portable/export`):
  - The owner chooses a root subject, the notes to include, whether to include saved-page links, a licence and a credit line.
  - The server reads only that learner's records through their owners (`setup-edit.loadStudyStructure`, a new `notes.ts` reader for selected note bodies, `learning-events.ts` for links), builds and packs the file, unpacks it again to check, and returns the download.
  - It writes nothing.
- **3. Preview** (`POST /api/nova/portable/preview`, multipart, rate-limited with `hitLimit`): unpack, validate, and report counts, name clashes and what is excluded. Nothing is stored.
- **4. Import** (`portable/import.ts`, schema `NovaImportJob`: additive, needs a `db push` before the API):
  - **Idempotency:** one job per (profile, packageId).
  - **Order:** first the subject tree in `applyStudyEdits` batches with clash-renamed names, then the notes through `createNote`, then the links.
  - **Verification:** the result is read back and compared with the manifest counts before it reports success.
  - **Resuming:** a stopped job continues from where it stopped and creates nothing twice. An abandoned partial import can be removed with the existing whole-map delete.
  - **Limits:** it calls no model; format 1 stores no images, so storage is unchanged.
- **5. UI:**
  - **Export:** "Export map" on the Knowledge Map's subject menu.
  - **Import:** "Import a .kivo file" on the Knowledge Map and on the Browser Extension page, with upload, validation, preview, confirm, progress, open the map, and every error state.
- **6. Bennett package:** needs the approved third-year CSE map built in a Kivo account by the Kivo team. Nothing is made up. Export it, test-import it into a clean account, then write the student guide.
- **7. Hardening:**
  - large-package and failure-recovery tests;
  - the full regression suites;
  - a rollout plan: schema push, then the API, then the web app.
