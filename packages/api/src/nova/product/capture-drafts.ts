// ─── Drafts: the capture inbox ────────────────────────────────────────────────
// The only reader and writer of NovaCaptureDraft (docs/CAPTURE_FIRST.md). The
// rules are in capture-draft-rules.ts (pure, shared with the page).
//
//   capture    a passage (or a page) goes into the current draft at once, with
//              no subject, topic or note asked for. A retry adds nothing.
//   review     the learner edits, removes, reorders and annotates passages.
//   merge      into a new note or one they have, after a preview. Through the
//              notes module's own writes (createNote once, replaceBodyIn on the
//              version read), so there is still one notes system.
//
//   place      where each passage belongs in the learner's workspace: asked of
//              knowledge-placement.ts (the one placement service) after the
//              capture is saved, so a capture never waits on it. The
//              learner's own choice is stored as theirs and never replaced.
//
// Not evidence: a draft is the learner's material. It writes no mastery,
// session, Learning DNA, fact, reality or pattern. The only model call is the
// placement service's. Every query names the learner's profile; an id alone
// reaches nothing.

import { prisma } from "@repo/db/client";
import { randomUUID } from "node:crypto";
import {
  alreadyIn, applyEdits, draftMarkdown, draftTitle, joinsDraft, mergeIntoBody, parseCapture, parseEdits, readItems, summarise,
  DRAFT_ITEMS_MAX, type CaptureItem, type DraftDetail, type DraftSummary,
} from "./capture-draft-rules";
import { createNote, noteRowIn, noteRowWithBody, replaceBodyIn } from "./notes";
import { forgetStructure, suggestPlacement, workspacePlaces, type PlacementAnswer, type RelatedNote } from "./knowledge-placement";
import { chosenPlace, placementOf, type Placement } from "./knowledge-placement-rules";
import { NOTE_TITLE_MAX } from "./notes.types";

const ROW = { id: true, title: true, status: true, items: true, version: true, lastCaptureAt: true, createdAt: true, mergedNoteId: true } as const;
type Row = { id: string; title: string | null; status: string; items: unknown; version: number; lastCaptureAt: Date; createdAt: Date; mergedNoteId: string | null };

const WRITE_ATTEMPTS = 4;
export const DRAFTS_LISTED = 50;
// Captures a learner may make in a minute, across browsers.
export const CAPTURES_PER_MINUTE = 30;

const detailOf = (row: Row): DraftDetail => {
  const items = readItems(row.items);
  return { ...summarise({ ...row, items }), items, version: row.version };
};

export type CaptureResult =
  | { ok: true; action: "added" | "already_in_draft"; draft: DraftSummary; itemId: string }
  | { ok: false; error: "invalid" | "too_long" | "empty" | "busy"; message: string };

// A capture into the current draft, or a new one when the session has moved
// on, the current one is full, or the learner asked for a fresh draft.
export async function captureToDraft(profileId: string, raw: unknown, now = new Date()): Promise<CaptureResult> {
  const parsed = parseCapture(raw);
  if (!parsed.ok) return { ok: false, ...parsed.refusal };
  const c = parsed.input;

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    // A retry of a capture already made (same key), in any recent open draft.
    const recent = (await prisma.novaCaptureDraft.findMany({
      where: { profileId, status: "open" }, orderBy: { lastCaptureAt: "desc" }, take: 3, select: ROW,
    })) as Row[];
    if (c.key) {
      for (const r of recent) {
        const hit = readItems(r.items).find(i => i.key === c.key);
        if (hit) return { ok: true, action: "already_in_draft", draft: detailOf(r), itemId: hit.id };
      }
    }

    const latest = recent[0];
    const latestItems = latest ? readItems(latest.items) : [];
    const joins = latest && !c.fresh && joinsDraft({ lastCaptureAt: latest.lastCaptureAt, passages: latestItems.length }, now);
    const item: CaptureItem = {
      id: randomUUID(), key: c.key, url: c.url, title: c.title, site: c.site,
      text: c.text, context: c.context, note: c.note, capturedAt: now.toISOString(),
    };

    if (!joins || !latest) {
      const made = (await prisma.novaCaptureDraft.create({
        data: { profileId, items: [item] as unknown as object, lastCaptureAt: now }, select: ROW,
      })) as Row;
      return { ok: true, action: "added", draft: detailOf(made), itemId: item.id };
    }

    const same = alreadyIn(latestItems, c);
    if (same) return { ok: true, action: "already_in_draft", draft: detailOf(latest), itemId: same.id };

    const next = [...latestItems, item];
    const written = await prisma.novaCaptureDraft.updateMany({
      where: { id: latest.id, profileId, status: "open", version: latest.version },
      data:  { items: next as unknown as object, version: { increment: 1 }, lastCaptureAt: now },
    });
    if (written.count === 1) {
      return { ok: true, action: "added", draft: summarise({ ...latest, items: next, lastCaptureAt: now }), itemId: item.id };
    }
    // Another capture got there first: read again and add to that.
  }
  return { ok: false, error: "busy", message: "Nova was busy with your other captures. Try again." };
}

// The draft a capture would join now, if there is one, and how many open
// drafts are waiting. For the extension's status line and the Notes header.
export async function currentDraft(profileId: string, now = new Date()): Promise<{ current: DraftSummary | null; open: number }> {
  const [latest, open] = await Promise.all([
    prisma.novaCaptureDraft.findFirst({ where: { profileId, status: "open" }, orderBy: { lastCaptureAt: "desc" }, select: ROW }) as Promise<Row | null>,
    prisma.novaCaptureDraft.count({ where: { profileId, status: "open" } }),
  ]);
  if (!latest) return { current: null, open };
  const items = readItems(latest.items);
  return { current: joinsDraft({ lastCaptureAt: latest.lastCaptureAt, passages: items.length }, now) ? summarise({ ...latest, items }) : null, open };
}

export async function listDrafts(profileId: string): Promise<DraftSummary[]> {
  const rows = (await prisma.novaCaptureDraft.findMany({
    where: { profileId, status: "open" }, orderBy: { lastCaptureAt: "desc" }, take: DRAFTS_LISTED, select: ROW,
  })) as Row[];
  return rows.map(r => summarise({ ...r, items: readItems(r.items) }));
}

export async function getDraft(profileId: string, id: string): Promise<DraftDetail | null> {
  const row = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: ROW })) as Row | null;
  return row ? detailOf(row) : null;
}

export type DraftWriteResult =
  | { ok: true; draft: DraftDetail }
  | { ok: false; error: "invalid" | "not_found" | "conflict" | "not_open"; message: string; draft?: DraftDetail };

// The learner's edits, on the version they were made on. A stale version is
// a conflict with the draft as it now stands (a capture arrived meanwhile):
// the page re-applies its edits to that and sends them again.
export async function editDraft(profileId: string, id: string, raw: unknown): Promise<DraftWriteResult> {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const edits = parseEdits(body?.edits);
  if (!edits || typeof body?.version !== "number") return { ok: false, error: "invalid", message: "That isn't a change Nova can make." };
  const row = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: ROW })) as Row | null;
  if (!row) return { ok: false, error: "not_found", message: "That draft isn't there any more." };
  if (row.status !== "open") return { ok: false, error: "not_open", message: "That draft has already been put in a note.", draft: detailOf(row) };
  if (row.version !== body.version) return { ok: false, error: "conflict", message: "The draft changed. Your change was applied to the newest version.", draft: detailOf(row) };
  const next = applyEdits({ title: row.title, items: readItems(row.items) }, edits);
  const written = await prisma.novaCaptureDraft.updateMany({
    where: { id, profileId, status: "open", version: row.version },
    data:  { title: next.title, items: next.items as unknown as object, version: { increment: 1 } },
  });
  const now = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: ROW })) as Row;
  if (written.count !== 1) return { ok: false, error: "conflict", message: "The draft changed. Try that again.", draft: detailOf(now) };
  return { ok: true, draft: detailOf(now) };
}

// Discarding keeps the row (status discarded), so Undo can bring it back.
export async function setDiscarded(profileId: string, id: string, discarded: boolean): Promise<DraftWriteResult> {
  const written = await prisma.novaCaptureDraft.updateMany({
    where: { id, profileId, status: discarded ? "open" : "discarded" },
    data:  discarded ? { status: "discarded", discardedAt: new Date(), version: { increment: 1 } } : { status: "open", discardedAt: null, version: { increment: 1 } },
  });
  const row = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: ROW })) as Row | null;
  if (!row) return { ok: false, error: "not_found", message: "That draft isn't there any more." };
  if (written.count !== 1 && row.status !== (discarded ? "discarded" : "open")) return { ok: false, error: "not_open", message: "That draft has already been put in a note.", draft: detailOf(row) };
  return { ok: true, draft: detailOf(row) };
}

// ── Merging ──────────────────────────────────────────────────────────────────

export type MergeTarget =
  | { kind: "new"; title: string; subjectId: string | null; topicName: string | null }
  | { kind: "existing"; noteId: string };

function parseTarget(raw: unknown): MergeTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "existing" && typeof t.noteId === "string" && t.noteId) return { kind: "existing", noteId: t.noteId };
  if (t.kind === "new") {
    return {
      kind: "new",
      title: typeof t.title === "string" ? t.title.trim().slice(0, NOTE_TITLE_MAX) : "",
      subjectId: typeof t.subjectId === "string" && t.subjectId ? t.subjectId : null,
      topicName: typeof t.topicName === "string" && t.topicName.trim() ? t.topicName.trim() : null,
    };
  }
  return null;
}

export type MergeResult =
  | { ok: true; preview: true; body: string; added: string; joined: string[]; noteTitle: string; noteLength: number | null }
  | { ok: true; preview: false; noteId: string; noteTitle: string; already: boolean }
  | { ok: false; error: "invalid" | "not_found" | "note_not_found" | "too_long" | "empty" | "conflict" | "unknown_subject" | "not_open"; message: string };

const fail = (error: Extract<MergeResult, { ok: false }>["error"], message: string): MergeResult => ({ ok: false, error, message });
class Stale extends Error {}

// A draft claimed by a merge in progress. Never seen by the page: the merge
// that claimed it either finishes (merged) or gives it back (open). One left
// behind by a crash is open again after MERGE_HOLD_MS.
const MERGING = "merging";
const MERGE_HOLD_MS = 60_000;
const release = (profileId: string, id: string) =>
  prisma.novaCaptureDraft.updateMany({ where: { id, profileId, status: MERGING }, data: { status: "open" } }).catch(() => undefined);

// Waits (briefly) for another request's merge to settle.
async function settled(profileId: string, id: string, row: Row): Promise<Row> {
  for (let i = 0; i < 40 && row.status === MERGING; i++) {
    await new Promise(r => setTimeout(r, 150));
    row = ((await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: { ...ROW, updatedAt: true } })) as Row & { updatedAt: Date } | null) ?? row;
    if (row.status === MERGING && Date.now() - (row as Row & { updatedAt: Date }).updatedAt.getTime() > MERGE_HOLD_MS) { await release(profileId, id); row = { ...row, status: "open" } }
  }
  return row;
}

// body: { target, version, day, preview? }. With preview, nothing is written:
// the answer is the text that would be added and where. Without it, the draft
// must still be the version previewed (or a conflict is answered).
export async function mergeDraft(profileId: string, id: string, raw: unknown): Promise<MergeResult> {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const target = parseTarget(body?.target);
  if (!target) return fail("invalid", "Choose a note, or create a new one.");
  const day = typeof body?.day === "string" && body.day.length === 10 && !Number.isNaN(Date.parse(body.day)) ? body.day : new Date().toISOString().slice(0, 10);
  const preview = body?.preview === true;

  let row = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: ROW })) as Row | null;
  if (!row) return fail("not_found", "That draft isn't there any more.");
  // Another request is merging it right now (a double press): its answer is
  // this one's too.
  if (row.status === MERGING && !preview) row = await settled(profileId, id, row);
  // Already merged: the same request again (a double press, a retry) is answered
  // with the note it made.
  if (row.status === "merged" && row.mergedNoteId && !preview) {
    const note = await noteRowWithBody(profileId, row.mergedNoteId);
    return { ok: true, preview: false, noteId: row.mergedNoteId, noteTitle: note?.title ?? "", already: true };
  }
  if (row.status !== "open") return fail("not_open", row.status === "discarded" ? "That draft was discarded. Restore it first." : "That draft is being put in a note. Try again in a moment.");
  if (!preview && typeof body?.version === "number" && body.version !== row.version) {
    return fail("conflict", "The draft changed since the preview. Check it again.");
  }
  const items = readItems(row.items);
  if (!items.length) return fail("empty", "This draft has nothing in it yet.");

  if (target.kind === "new") {
    const text = draftMarkdown(items);
    const title = target.title || draftTitle(row.title, items).slice(0, NOTE_TITLE_MAX);
    if (preview) return { ok: true, preview: true, body: text, added: text, joined: [], noteTitle: title, noteLength: null };
    // The draft is claimed before the note is made, so two presses at once make
    // one note: only the request that claims it creates; the other waits for it.
    const claimed = await prisma.novaCaptureDraft.updateMany({ where: { id, profileId, status: "open", version: row.version }, data: { status: MERGING } });
    if (claimed.count !== 1) {
      const now = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: { status: true } }));
      // Edited meanwhile: the preview is out of date. Otherwise another merge
      // holds it, and its answer is this one's.
      if (!now || now.status === "open") return fail("conflict", "The draft changed since the preview. Check it again.");
      return mergeDraft(profileId, id, body);
    }
    const made = await createNote(profileId, { title, body: text, subjectId: target.subjectId, topicName: target.topicName, once: true }).catch(err => { void release(profileId, id); throw err });
    if (!made.ok) {
      await release(profileId, id);
      return fail(made.error === "unknown_subject" ? "unknown_subject" : made.error === "body_too_long" ? "too_long" : "invalid", made.message);
    }
    await prisma.novaCaptureDraft.updateMany({
      where: { id, profileId, status: MERGING },
      data:  { status: "merged", mergedNoteId: made.note.id, mergedAt: new Date(), version: { increment: 1 } },
    });
    return { ok: true, preview: false, noteId: made.note.id, noteTitle: made.note.title, already: false };
  }

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const note = await noteRowWithBody(profileId, target.noteId);
    if (!note) return fail("note_not_found", "That note isn't there any more. Choose another.");
    const plan = mergeIntoBody(note.body, items, day);
    if (!plan) return fail("too_long", "That note can't take all of this: it would be longer than a note can be. Create a new note instead.");
    if (preview) return { ok: true, preview: true, body: plan.body, added: plan.added, joined: plan.joined, noteTitle: note.title, noteLength: note.body.length };
    try {
      await prisma.$transaction(async tx => {
        if (!(await replaceBodyIn(tx, profileId, note.id, note.updatedAt, plan.body))) throw new Stale();
        const claimed = await tx.novaCaptureDraft.updateMany({
          where: { id, profileId, status: "open", version: row.version },
          data:  { status: "merged", mergedNoteId: note.id, mergedAt: new Date(), version: { increment: 1 } },
        });
        // Merged or changed by another request meanwhile: nothing of this one stands.
        if (claimed.count !== 1) throw new Stale();
      });
      const after = await noteRowIn(prisma, profileId, note.id);
      return { ok: true, preview: false, noteId: note.id, noteTitle: after?.title ?? note.title, already: false };
    } catch (err) {
      if (!(err instanceof Stale)) throw err;
      const again = (await prisma.novaCaptureDraft.findFirst({ where: { id, profileId }, select: ROW })) as Row | null;
      if (again?.status === "merged" && again.mergedNoteId) return { ok: true, preview: false, noteId: again.mergedNoteId, noteTitle: note.title, already: true };
      if (!again || again.status !== "open" || again.version !== row.version) return fail("conflict", "The draft changed since the preview. Check it again.");
      // Only the note changed (an edit, autosave): read it again and add to that.
    }
  }
  return fail("conflict", "That note kept changing while Nova was adding to it. Nothing was added. Try again.");
}

// ── Placing a passage ────────────────────────────────────────────────────────

// One passage changed in place, on the version read; read again on a race.
async function changeItem(profileId: string, draftId: string, itemId: string, change: (item: CaptureItem) => CaptureItem | null): Promise<{ ok: true; item: CaptureItem; draft: DraftDetail } | { ok: false; error: "not_found" | "busy" }> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = (await prisma.novaCaptureDraft.findFirst({ where: { id: draftId, profileId }, select: ROW })) as Row | null;
    if (!row) return { ok: false, error: "not_found" };
    const items = readItems(row.items);
    const at = items.findIndex(i => i.id === itemId);
    if (at === -1) return { ok: false, error: "not_found" };
    const next = change(items[at]!);
    if (!next) return { ok: true, item: items[at]!, draft: detailOf(row) };
    const all = items.slice(); all[at] = next;
    const written = await prisma.novaCaptureDraft.updateMany({
      where: { id: draftId, profileId, version: row.version },
      data:  { items: all as unknown as object, version: { increment: 1 } },
    });
    if (written.count === 1) return { ok: true, item: next, draft: detailOf({ ...row, items: all, version: row.version + 1 }) };
  }
  return { ok: false, error: "busy" };
}

export type PlaceResult =
  | { ok: true; itemId: string; placement: Placement | null; suggestion: Placement | null; placedBy: "kivo" | "learner" | null; related: RelatedNote[]; draft: DraftDetail }
  | { ok: false; error: "not_found" | "busy" | "unknown_place"; message: string };

const PLACE_WORDS = {
  not_found: "That passage isn't in your drafts any more.",
  busy: "Kivo was busy with your other captures. Try again.",
  unknown_place: "That subject or topic isn't in your workspace any more. Choose another.",
} as const;

// Kivo's placement for one captured passage: asked once. A passage the
// learner placed (or cleared) themselves, or one already placed, is answered
// as it stands.
export async function placeDraftItem(profileId: string, draftId: string, itemId: string, options: Pick<NonNullable<Parameters<typeof suggestPlacement>[2]>, "generate" | "surface" | "now"> = {}): Promise<PlaceResult> {
  const row = (await prisma.novaCaptureDraft.findFirst({ where: { id: draftId, profileId }, select: ROW })) as Row | null;
  const item = row ? readItems(row.items).find(i => i.id === itemId) : undefined;
  if (!row || !item) return { ok: false, error: "not_found", message: PLACE_WORDS.not_found };
  if (item.placedBy === "learner" || item.placement || item.suggestion) {
    return { ok: true, itemId, placement: item.placement ?? null, suggestion: item.suggestion ?? null, placedBy: item.placedBy ?? null, related: [], draft: detailOf(row) };
  }
  const answer: PlacementAnswer = await suggestPlacement(profileId, { title: item.title, text: item.text, context: item.context, domain: item.site }, { generate: options.generate, surface: options.surface, requestId: `place:${itemId}`, now: options.now });
  const changed = await changeItem(profileId, draftId, itemId, current =>
    // The learner chose while Kivo was thinking: theirs stands.
    current.placedBy === "learner" ? null : { ...current, placement: answer.placement, suggestion: answer.suggestion, placedBy: answer.placement ? "kivo" : null });
  if (!changed.ok) return { ok: false, error: changed.error, message: PLACE_WORDS[changed.error] };
  return { ok: true, itemId, placement: changed.item.placement ?? null, suggestion: changed.item.suggestion ?? null, placedBy: changed.item.placedBy ?? null, related: answer.related, draft: changed.draft };
}

// The learner's own choice: a subject (and optionally one of its topics), or
// none at all. Checked against the workspace as it stands.
export async function setDraftItemPlacement(profileId: string, draftId: string, itemId: string, choice: { subjectId: string | null; topicId: string | null; topicName?: string | null }, now = new Date()): Promise<PlaceResult> {
  let placement: Placement | null = null;
  if (choice.subjectId) {
    forgetStructure(profileId);
    const { places } = await workspacePlaces(profileId, now.getTime());
    const place = chosenPlace(places, { subjectId: choice.subjectId, topicId: choice.topicId, topicName: choice.topicName ?? null });
    if (!place) return { ok: false, error: "unknown_place", message: PLACE_WORDS.unknown_place };
    placement = placementOf(place, "high", "learner", now);
  }
  const changed = await changeItem(profileId, draftId, itemId, current => ({ ...current, placement, suggestion: null, placedBy: "learner" }));
  if (!changed.ok) return { ok: false, error: changed.error, message: PLACE_WORDS[changed.error] };
  return { ok: true, itemId, placement, suggestion: null, placedBy: "learner", related: [], draft: changed.draft };
}

export { DRAFT_ITEMS_MAX };
