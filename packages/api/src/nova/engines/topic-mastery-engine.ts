// ─── Topic Mastery Engine ─────────────────────────────────────────────────────
// SKILL.md §8 — FSRS-lite (SM-2 inspired) mastery tracking.
// NEVER makes LLM calls. The caller provides the subjectId.
// Writes go through updateTopicMastery(), which owns the upsert and the
// record of each change (NovaTopicMasterySnapshot), in one transaction.
// Owner: Topic Mastery Engine.
//
// ── Source hierarchy (MUST be respected by all callers) ──────────────────────
//
//   "session_report"    — evidence: full FSRS update, interval grows, reviewCount++
//                         Only SessionExecutionReport consumers may use this source.
//
//   "conversation_signal" — observation: confidenceReported + lastStudiedAt only.
//                           No interval change. No reviewCount increment.
//                           Mastery probability updates with 0.15 weight (vs 0.40).
//                           Used when a student mentions a topic in conversation
//                           without a backing session execution report.
//
// No engine may infer verified learning from conversation if an execution
// report exists. Conversation provides observations. Sessions provide evidence.

import { prisma } from "@repo/db/client";

// ── FSRS-lite algorithm ───────────────────────────────────────────────────────
// Confidence (0–1, student self-report) → SM-2 grade (1–5).
// Grade < 3 → reset interval to 1 day, reduce ef_factor.
// Grade >= 3 → grow interval, adjust ef_factor.

function confidenceToGrade(confidence: number): number {
  if (confidence >= 0.85) return 5;
  if (confidence >= 0.70) return 4;
  if (confidence >= 0.55) return 3;
  if (confidence >= 0.40) return 2;
  return 1;
}

interface FsrsUpdate {
  masteryProbability: number;
  efFactor:           number;
  intervalDays:       number;
  nextReviewAt:       Date;
}

function computeFsrsUpdate(
  current: { masteryProbability: number; efFactor: number; intervalDays: number; reviewCount: number } | null,
  reportedConfidence: number,
  now: Date,
): FsrsUpdate {
  const grade = confidenceToGrade(reportedConfidence);

  if (!current || current.reviewCount === 0) {
    // First study: bootstrap state from reported confidence
    const interval = grade >= 4 ? 3 : grade >= 3 ? 2 : 1;
    const nextReviewAt = new Date(now);
    nextReviewAt.setDate(nextReviewAt.getDate() + interval);
    return {
      masteryProbability: Math.round(reportedConfidence * 100) / 100,
      efFactor:           2.5,
      intervalDays:       interval,
      nextReviewAt,
    };
  }

  // Blended mastery update (prevents wild swings from a single report)
  const newMastery = Math.min(1, Math.round((0.6 * current.masteryProbability + 0.4 * reportedConfidence) * 100) / 100);

  let newEfFactor: number;
  let newInterval: number;

  if (grade >= 3) {
    // Correct recall: update ef_factor and grow interval
    newEfFactor = Math.max(
      1.3,
      current.efFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02),
    );
    newEfFactor = Math.round(newEfFactor * 100) / 100;
    newInterval = Math.max(1, Math.round(current.intervalDays * newEfFactor));
  } else {
    // Incorrect / low confidence: reset interval, decrease ef_factor
    newEfFactor = Math.max(1.3, Math.round((current.efFactor - 0.2) * 100) / 100);
    newInterval = 1;
  }

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);

  return {
    masteryProbability: newMastery,
    efFactor:           newEfFactor,
    intervalDays:       newInterval,
    nextReviewAt,
  };
}

// ── Topic identity ────────────────────────────────────────────────────────────
// A topic is (subject, name). The subject comes from the session, which
// knows it; it is never rediscovered from the topic's wording when the
// session has one. Names are compared without regard to case or spacing, so
// "deadlocks" and "Deadlocks " are one topic.

export function normalizeTopicName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

// Case-insensitive matching in Postgres is ILIKE, where % and _ are
// wildcards. A name is compared as the literal text it is.
export const likeLiteral = (text: string) => text.replace(/[\\%_]/g, "\\$&");

const sameName = (a: string, b: string) =>
  normalizeTopicName(a).toLowerCase() === normalizeTopicName(b).toLowerCase();

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const ACRONYM_SKIP = new Set(["and", "of", "the", "in", "to", "for", "a", "an", "on"]);

// "Operating Systems" → "os"; "Design and Analysis of Algorithms" → "daa".
function acronymOf(subjectName: string): string {
  return words(subjectName).filter(w => !ACRONYM_SKIP.has(w)).map(w => w[0]).join("");
}

// ── Subject matcher ────────────────────────────────────────────────────────────
// For a topic that arrives with no subject (a chat turn). It answers only
// "does this text name one of the student's subjects?": the whole name, its
// code, its acronym, or the subject's name as a whole phrase inside the text
// ("operating systems deadlocks"). Whole words only: "a" names no subject.
// A topic that names no subject ("Deadlocks") is not matched; see
// resolveTopicSubject for the other way a subject can be known.

export function matchTopicToSubject(
  topicName: string,
  subjects:  Array<{ id: string; name: string; code?: string | null }>,
): { subjectId: string; resolvedName: string } | null {
  const topic = words(topicName ?? "");
  if (subjects.length === 0 || topic.length === 0) return null;
  const text  = topic.join(" ");

  const hit = (s: { id: string }) => ({ subjectId: s.id, resolvedName: normalizeTopicName(topicName) });

  // 1. The text is the subject: its name, code, or acronym.
  for (const s of subjects) {
    const name = words(s.name).join(" ");
    if (text === name) return hit(s);
    if (s.code && text === words(s.code).join(" ")) return hit(s);
    const acronym = acronymOf(s.name);
    if (acronym.length >= 2 && text === acronym) return hit(s);
  }

  // 2. The subject's full name appears in the text as a phrase. The longest
  //    name wins, so "Advanced Algorithms" is not taken for "Algorithms".
  const containing = subjects
    .filter(s => {
      const name = words(s.name).join(" ");
      return name.length > 0 && ` ${text} `.includes(` ${name} `);
    })
    .sort((a, b) => b.name.length - a.name.length)[0];
  return containing ? hit(containing) : null;
}

// Every subject a short text names: by its name, code or acronym, as whole
// words anywhere in the text ("OS exam" names Operating Systems). Used where
// the text is a label the student gave something, such as an exam.
export function subjectsNamedIn<S extends { name: string; code?: string | null }>(text: string, subjects: S[]): S[] {
  const said = ` ${words(text ?? "").join(" ")} `;
  if (said.trim().length === 0) return [];
  return subjects.filter(s => {
    const acronym = acronymOf(s.name);
    const names = [words(s.name).join(" "), s.code ? words(s.code).join(" ") : "", acronym.length >= 2 ? acronym : ""];
    return names.some(n => n.length > 0 && said.includes(` ${n} `));
  });
}

// The learner's topics a name refers to ("something about deep learning"):
// every topic of a subject the name names or that holds the name, and every
// topic whose own name is the name, holds it, or is held in it. Whole words,
// any case. A name that matches none of these matches nothing: nothing is
// guessed from meaning, and the order of `topics` is kept.
export function topicsNamedBy<T extends { topicName: string; subjectName: string }>(
  named:    string,
  topics:   T[],
  subjects: Array<{ name: string; code?: string | null }>,
): T[] {
  const said = words(named ?? "").join(" ");
  if (said.length < 2) return [];
  const padded = ` ${said} `;
  const subjectNames = new Set(subjectsNamedIn(named, subjects).map(s => s.name.toLowerCase()));
  for (const s of subjects) if (` ${words(s.name).join(" ")} `.includes(padded)) subjectNames.add(s.name.toLowerCase());
  return topics.filter(t => {
    if (subjectNames.has(t.subjectName.toLowerCase())) return true;
    const name = words(t.topicName).join(" ");
    if (name.length === 0) return false;
    return ` ${name} `.includes(padded) || (name.length >= 3 && padded.includes(` ${name} `));
  });
}

// The subject for a topic that arrived without one. In order:
//   1. the text names a subject (matchTopicToSubject)
//   2. the student already has this topic under exactly one subject: a topic
//      keeps the subject it was first studied in
// Otherwise null. Nothing is guessed: with no subject, no mastery is written.
export async function resolveTopicSubject(
  topicName: string,
  subjects:  Array<{ id: string; name: string; code?: string | null }>,
): Promise<{ subjectId: string; resolvedName: string } | null> {
  const named = matchTopicToSubject(topicName, subjects);
  if (named) return named;
  if (subjects.length === 0 || !normalizeTopicName(topicName ?? "")) return null;

  const known = await prisma.novaTopicMastery.findMany({
    where: {
      subjectId: { in: subjects.map(s => s.id) },
      name:      { equals: likeLiteral(normalizeTopicName(topicName)), mode: "insensitive" },
      archivedAt: null,
    },
    select: { subjectId: true, name: true },
  });
  return known.length === 1 ? { subjectId: known[0]!.subjectId, resolvedName: known[0]!.name } : null;
}

// ── Source type ───────────────────────────────────────────────────────────────

export type MasteryUpdateSource = "session_report" | "conversation_signal";

// ── Main export ────────────────────────────────────────────────────────────────
// source = "session_report"      → full FSRS update (evidence)
// source = "conversation_signal" → observation-only write (no FSRS, no count)

export async function updateTopicMastery(
  subjectId:          string,
  topicName:          string,
  reportedConfidence: number,
  now:                Date,
  source:             MasteryUpdateSource = "conversation_signal",
  // The session whose execution report this is. With it, the same report
  // cannot move the topic twice.
  sessionId:          string | null = null,
): Promise<void> {
  const clampedConf = Math.max(0, Math.min(1, reportedConfidence));

  // The change and the record of it (NovaTopicMasterySnapshot) are one
  // write: both happen or neither does.
  await prisma.$transaction(async tx => {
    // One row per topic, whatever the casing or spacing it was typed in.
    const existing = await tx.novaTopicMastery.findFirst({
      where:  { subjectId, name: { equals: likeLiteral(normalizeTopicName(topicName)), mode: "insensitive" } },
      select: {
        name:               true,
        masteryProbability: true,
        efFactor:           true,
        intervalDays:       true,
        reviewCount:        true,
      },
    });

    const name = existing?.name ?? normalizeTopicName(topicName);
    if (!name) return;
    const masteryBefore = existing?.masteryProbability ?? null;

    let written: { id: string; masteryProbability: number; reviewCount: number };

    if (source === "session_report") {
      // ── Evidence path: full FSRS update ────────────────────────────────────
      const update = computeFsrsUpdate(existing, clampedConf, now);

      written = await tx.novaTopicMastery.upsert({
        where:  { subjectId_name: { subjectId, name } },
        update: {
          masteryProbability: update.masteryProbability,
          confidenceReported: clampedConf,
          efFactor:           update.efFactor,
          intervalDays:       update.intervalDays,
          nextReviewAt:       update.nextReviewAt,
          lastStudiedAt:      now,
          reviewCount:        { increment: 1 },
        },
        create: {
          subjectId,
          name,
          masteryProbability: update.masteryProbability,
          confidenceReported: clampedConf,
          efFactor:           update.efFactor,
          intervalDays:       update.intervalDays,
          nextReviewAt:       update.nextReviewAt,
          lastStudiedAt:      now,
          reviewCount:        1,
        },
        select: { id: true, masteryProbability: true, reviewCount: true },
      });
    } else {
      // ── Observation path: soft update only ──────────────────────────────────
      // No FSRS interval change. No reviewCount increment.
      // masteryProbability updated with a 0.15 weight (vs 0.40 for evidence).
      // If no prior record exists, create with reviewCount = 0 and discounted mastery.
      const newMastery = existing
        ? Math.min(1, Math.round((0.85 * existing.masteryProbability + 0.15 * clampedConf) * 100) / 100)
        : Math.round(clampedConf * 0.7 * 100) / 100;  // discount first-time conversation mention

      written = await tx.novaTopicMastery.upsert({
        where:  { subjectId_name: { subjectId, name } },
        update: {
          masteryProbability: newMastery,
          confidenceReported: clampedConf,
          lastStudiedAt:      now,
          // intentionally NOT updating: efFactor, intervalDays, nextReviewAt, reviewCount
        },
        create: {
          subjectId,
          name,
          masteryProbability: newMastery,
          confidenceReported: clampedConf,
          efFactor:           2.5,    // default, unchanged until first session
          intervalDays:       1,
          nextReviewAt:       now,    // due immediately — no session evidence yet
          lastStudiedAt:      now,
          reviewCount:        0,      // not a verified review
        },
        select: { id: true, masteryProbability: true, reviewCount: true },
      });
    }

    // The engine's record of what it just did. Progress reads these rows;
    // they are never an input to mastery.
    const subject = await tx.novaSubject.findUnique({ where: { id: subjectId }, select: { profileId: true } });
    if (!subject) return;
    await tx.novaTopicMasterySnapshot.create({
      data: {
        topicId:       written.id,
        profileId:     subject.profileId,
        source,
        sessionId:     source === "session_report" ? sessionId : null,
        masteryBefore,
        masteryAfter:  written.masteryProbability,
        confidence:    clampedConf,
        reviewCount:   written.reviewCount,
        recordedAt:    now,
      },
    });
  }).catch(err => {
    // This session's report already moved this topic (unique topic+session):
    // the transaction rolled back, so the replay changed nothing.
    if (isUniqueViolation(err)) return;
    throw err;
  });
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

// ── Declared topics ───────────────────────────────────────────────────────────
// A topic the student says a subject covers, before any of it is studied. The
// row is created with nothing in it: no mastery, no review, no date. It says
// the topic exists, which is what lets the Planning Engine schedule it; what
// the student knows of it is still written only by updateTopicMastery, from a
// session. A name the subject already has (in any casing) is left alone.

// Topics of every level: a semester subject in units, topics and subtopics.
export const MAX_TOPICS_PER_SUBJECT = 300;

type TreeTx = Pick<typeof prisma, "novaTopicMastery">;
type Have = { id: string; name: string; archivedAt: Date | null; parentId: string | null; position: number | null; createdAt: Date };
const nameKey = (n: string) => normalizeTopicName(n).toLowerCase();

// Siblings in their saved order: position, then (an older row with none)
// the order they were added in. Never by name (product/topic-tree.ts).
const bySavedOrder = (a: Have, b: Have) =>
  a.position !== null && b.position !== null && a.position !== b.position ? a.position - b.position
  : a.position === null && b.position !== null ? 1 : a.position !== null && b.position === null ? -1
  : a.createdAt.getTime() - b.createdAt.getTime();

// The topics beside one another under a parent get positions 0, 1, 2… in
// the order they already have, so a topic added after them comes after
// them. Rows that already say their order are left as they are.
async function settlePositions(tx: TreeTx, have: Have[], parentId: string | null): Promise<number> {
  const siblings = have.filter(t => t.parentId === parentId).sort(bySavedOrder);
  for (const [i, t] of siblings.entries()) {
    if (t.position === i) continue;
    await tx.novaTopicMastery.update({ where: { id: t.id }, data: { position: i } });
    t.position = i;
  }
  return siblings.length;
}

export interface TopicTreeInput {
  name: string;
  // The topic of this subject it sits inside, by name: one already there or
  // one earlier in this list. null: under `under` (the top, by default).
  parent: string | null;
  kind?: "milestone" | null;
  details?: object | null;
}

// Adds topics to a subject as a tree, merging by name with what is there:
// a topic it has already stays where it is, as it is (an archived one comes
// back, with its history); a new one goes inside its parent, after the
// topics already beside it, in the order given. One query per level.
export async function declareTopicTree(
  tx: TreeTx,
  subjectId: string,
  topics: TopicTreeInput[],
  options: { under?: string | null } = {},
): Promise<{ added: string[]; existing: string[]; ids: Map<string, string> }> {
  const have: Have[] = await tx.novaTopicMastery.findMany({ where: { subjectId }, select: { id: true, name: true, archivedAt: true, parentId: true, position: true, createdAt: true } });
  const ids = new Map(have.map(t => [nameKey(t.name), t.id]));
  // Naming an archived topic again brings it back, with its history.
  const wanted = new Set(topics.map(t => nameKey(t.name)));
  const back = have.filter(t => t.archivedAt !== null && wanted.has(nameKey(t.name)));
  if (back.length > 0) await tx.novaTopicMastery.updateMany({ where: { id: { in: back.map(t => t.id) } }, data: { archivedAt: null } });

  const added: string[] = [];
  const existing: string[] = [];
  const under = options.under ?? null;
  // Level by level: each topic's parent is made before it.
  let pending = topics.map(t => ({ ...t, name: normalizeTopicName(t.name).slice(0, 120) })).filter(t => t.name);
  const seen = new Set<string>();
  for (let round = 0; pending.length > 0 && round < 12; round++) {
    const ready = pending.filter(t => t.parent === null || ids.has(nameKey(t.parent)) || !pending.some(p => nameKey(p.name) === nameKey(t.parent!)));
    if (ready.length === 0) break;
    const rows: Array<{ subjectId: string; name: string; parentId: string | null; position: number; kind?: string; details?: object; createdAt: Date }> = [];
    const next = new Map<string | null, number>();
    const at = Date.now();
    for (const t of ready) {
      const k = nameKey(t.name);
      if (seen.has(k)) continue;
      seen.add(k);
      if (ids.has(k)) { existing.push(t.name); continue; }
      if (have.length + rows.length >= MAX_TOPICS_PER_SUBJECT) break;
      const parentId = t.parent ? ids.get(nameKey(t.parent)) ?? under : under;
      if (!next.has(parentId)) next.set(parentId, await settlePositions(tx, have, parentId));
      const position = next.get(parentId)!;
      next.set(parentId, position + 1);
      // A millisecond apart too, so an older reader that orders by time agrees.
      rows.push({ subjectId, name: t.name, parentId, position, ...(t.kind ? { kind: t.kind } : {}), ...(t.details ? { details: t.details } : {}), createdAt: new Date(at + rows.length) });
    }
    if (rows.length > 0) {
      const made = await tx.novaTopicMastery.createManyAndReturn({ data: rows, skipDuplicates: true, select: { id: true, name: true, archivedAt: true, parentId: true, position: true, createdAt: true } });
      for (const m of made) { ids.set(nameKey(m.name), m.id); have.push(m); added.push(m.name); }
    }
    pending = pending.filter(t => !ready.includes(t));
  }
  return { added, existing, ids };
}

// Topics by name at the top of a subject (or inside `under`): setup, Subject
// Studio and Build with Nova's "add these topics".
export async function declareTopics(
  tx:        TreeTx,
  subjectId: string,
  names:     string[],
  options:   { under?: string | null; kind?: "milestone" | null } = {},
): Promise<{ added: string[]; existing: string[] }> {
  const { added, existing } = await declareTopicTree(tx, subjectId, names.map(name => ({ name, parent: null, kind: options.kind ?? null })), { under: options.under ?? null });
  return { added, existing };
}

// ── Archiving (product/topic-archive.ts) ──────────────────────────────────────
// A mark on the row, never a delete: mastery, review schedule, history and
// sessions stay. Guarded on the learner owning the topic and on its current
// state, so a repeat or a second tab changes nothing. True when it changed.
export async function setTopicArchived(profileId: string, topicId: string, archived: boolean, now: Date): Promise<boolean> {
  const r = await prisma.novaTopicMastery.updateMany({
    where: { id: topicId, subject: { profileId }, archivedAt: archived ? null : { not: null } },
    data:  { archivedAt: archived ? now : null },
  });
  return r.count === 1;
}

// ── Editing topics (product/setup-edit.ts) ────────────────────────────────────
// A topic's identity is its row: renaming or moving it keeps its mastery,
// review schedule and history (snapshots and sessions point at its id).

type TopicTx = Pick<typeof prisma, "novaTopicMastery">;

export async function renameTopicIn(tx: TopicTx, topicId: string, name: string): Promise<void> {
  await tx.novaTopicMastery.update({ where: { id: topicId }, data: { name: normalizeTopicName(name).slice(0, 120) } });
}

// To another subject, with everything inside it, at the top of that subject
// after its topics. The caller has checked no name there is taken.
export async function moveTopicIn(tx: TopicTx, topicId: string, subjectId: string): Promise<void> {
  const all = await tx.novaTopicMastery.findMany({ where: { subjectId: (await tx.novaTopicMastery.findUniqueOrThrow({ where: { id: topicId }, select: { subjectId: true } })).subjectId }, select: { id: true, parentId: true } });
  const inside = new Set([topicId]);
  for (let grew = true; grew;) { grew = false; for (const t of all) if (t.parentId && inside.has(t.parentId) && !inside.has(t.id)) { inside.add(t.id); grew = true; } }
  const there: Have[] = await tx.novaTopicMastery.findMany({ where: { subjectId }, select: { id: true, name: true, archivedAt: true, parentId: true, position: true, createdAt: true } });
  const position = await settlePositions(tx, there, null);
  await tx.novaTopicMastery.updateMany({ where: { id: { in: [...inside] } }, data: { subjectId } });
  await tx.novaTopicMastery.update({ where: { id: topicId }, data: { parentId: null, position } });
}

// Inside another topic of the same subject (null: at its top), after the
// topics already there, or at `index` among them. The caller has checked it
// makes no loop and is not too deep (product/topic-tree.ts rules).
export async function placeTopicIn(tx: TopicTx, topicId: string, parentId: string | null, index: number | null = null): Promise<void> {
  const t = await tx.novaTopicMastery.findUniqueOrThrow({ where: { id: topicId }, select: { subjectId: true } });
  const there: Have[] = await tx.novaTopicMastery.findMany({ where: { subjectId: t.subjectId }, select: { id: true, name: true, archivedAt: true, parentId: true, position: true, createdAt: true } });
  const siblings = there.filter(x => x.parentId === parentId && x.id !== topicId).sort(bySavedOrder);
  const at = index === null ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  const order = [...siblings.slice(0, at).map(x => x.id), topicId, ...siblings.slice(at).map(x => x.id)];
  await tx.novaTopicMastery.update({ where: { id: topicId }, data: { parentId } });
  for (const [i, id] of order.entries()) await tx.novaTopicMastery.update({ where: { id }, data: { position: i } });
}

// These topics, all beside one another, in this order; the others beside
// them keep theirs, after these.
export async function orderTopicsIn(tx: TopicTx, topicIds: string[]): Promise<void> {
  if (topicIds.length === 0) return;
  const first = await tx.novaTopicMastery.findUniqueOrThrow({ where: { id: topicIds[0]! }, select: { subjectId: true, parentId: true } });
  const there: Have[] = await tx.novaTopicMastery.findMany({ where: { subjectId: first.subjectId, parentId: first.parentId }, select: { id: true, name: true, archivedAt: true, parentId: true, position: true, createdAt: true } });
  const rest = there.filter(x => !topicIds.includes(x.id)).sort(bySavedOrder).map(x => x.id);
  for (const [i, id] of [...topicIds, ...rest].entries()) await tx.novaTopicMastery.update({ where: { id }, data: { position: i } });
}

// What a plan or the learner says about a topic (its explanation, a
// milestone's effort and goals), and whether it is a milestone. null
// details: none (stored as {}, which reads as none).
export async function setTopicDetailsIn(tx: TopicTx, topicId: string, change: { details?: object | null; kind?: "milestone" | null }): Promise<void> {
  await tx.novaTopicMastery.update({
    where: { id: topicId },
    data: { ...(change.details !== undefined ? { details: change.details ?? {} } : {}), ...(change.kind !== undefined ? { kind: change.kind } : {}) },
  });
}

// Only for a topic with no history (topicHasHistory), checked by the caller in
// the same transaction.
export async function removeTopicIn(tx: TopicTx, topicId: string): Promise<void> {
  await tx.novaTopicMastery.delete({ where: { id: topicId } });
}
