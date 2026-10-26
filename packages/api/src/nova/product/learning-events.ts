// ─── Learning events ──────────────────────────────────────────────────────────
// What a learner explicitly did with a page in their browser, received from
// the extension and kept as their own record. The only code that reads or
// writes NovaLearningEvent, and it writes no other table.
//
// A learning event is not evidence of learning. Saving a page moves no
// mastery, starts no session, feeds no Learning DNA and creates no fact,
// reality or pattern; learning-events.test.ts reads this file to hold that.
// A study request does not start a session either: it is context the Focus
// screen offers, and the ordinary start command (product/session.ts) starts
// the session when the learner says so.
//
// The server never fetches a saved address. It stores the address, the
// title and where the learner filed it, and nothing of the page itself
// except a passage the learner selected and sent ("selection_saved").
//
// A saved page is afterwards looked at for what it connects to
// (product/resource-processing.ts). That module decides; the rows it reads
// and writes are read and written here, so this is still the only code that
// touches the table. The saved row never depends on that step.

import { learnerKey } from "./learner-key";
import { normalizeResourceUrl } from "./resource-link";
import { prisma } from "@repo/db/client";
import { REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { likeLiteral, normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  EVENTS_PER_MINUTE, EVENT_EXCERPT_MAX, EVENT_ID_MAX, EVENT_ID_MIN, EVENT_TITLE_MAX, EVENT_TOPIC_MAX, EVENT_URL_MAX,
  type ExtensionContext, type LearningEventResponse, type LearningEventSource, type LearningEventType,
  type LearningResource, type LearningResourceResponse, type NovaSavedResourcesView,
  type ProcessingStatus, type ResourceConnection, type ResourceConnections, type ResourceProcessing, type ResourceUpdateResponse,
} from "./learning-events.types";

const EVENT_TYPES: LearningEventType[] = ["resource_saved", "selection_saved", "study_requested"];
// What the Saved list holds: pages and passages. A study request is not one.
const SAVED_TYPES: LearningEventType[] = ["resource_saved", "selection_saved"];
const SAVED_LIMIT = 200;
const DAY_MS      = 86_400_000;

type Failure = Extract<LearningEventResponse, { success: false }>;
const fail = (error: Failure["error"], message: string): Failure => ({ success: false, error, message });

// ── The address ───────────────────────────────────────────────────────────────
// One definition of an address Nova keeps, shared with the web app's own
// check (product/resource-link.ts).
export { normalizeResourceUrl };

// ── Validation ────────────────────────────────────────────────────────────────

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const isClientEventId = (v: unknown): v is string =>
  typeof v === "string" && v.length >= EVENT_ID_MIN && v.length <= EVENT_ID_MAX && [...v].every(ch => ID_CHARS.includes(ch));

// One line of text: control characters out, runs of whitespace to one space.
const oneLine = (text: string) => [...text].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");

// A passage as the learner selected it: its own line breaks kept (at most one
// blank line in a row), every other control character out, each line tidied.
function passage(text: string): string {
  const lines = text.split("\r\n").join("\n").split("\r").join("\n").split("\n").map(oneLine);
  const kept: string[] = [];
  for (const line of lines) if (line || (kept.length > 0 && kept[kept.length - 1] !== "")) kept.push(line);
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n");
}

export interface ParsedLearningEvent {
  eventType:     LearningEventType;
  clientEventId: string;
  url:           string;
  domain:        string;
  title:         string;
  subjectId:     string | null;
  topicName:     string | null;
  occurredAt:    Date;
  canonicalUrl:  string | null;
  excerpt:       string | null;
}

// Reads the fields a learning event has and no others. Whatever else the
// request carries (an owner, a page body, a metadata bag) is never looked at.
export function parseLearningEvent(raw: unknown, now: Date): { ok: true; event: ParsedLearningEvent } | { ok: false; failure: Failure } {
  const bad = (message: string) => ({ ok: false as const, failure: fail("invalid", message) });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("That isn't something Nova can save.");
  const input = raw as Record<string, unknown>;

  const eventType = EVENT_TYPES.find(t => t === input.eventType);
  if (!eventType) return bad("Nova doesn't know that action.");
  if (!isClientEventId(input.clientEventId)) return bad("That request is missing its id.");

  const address = normalizeResourceUrl(input.url);
  if (!address) return { ok: false, failure: fail("invalid_url", "Nova can only keep ordinary web pages.") };

  if (typeof input.title !== "string") return bad("A page needs a title.");
  if (input.title.length > EVENT_TITLE_MAX * 4) return bad(`Keep the title under ${EVENT_TITLE_MAX} characters.`);
  const title = oneLine(input.title);
  if (title.length > EVENT_TITLE_MAX) return bad(`Keep the title under ${EVENT_TITLE_MAX} characters.`);

  let subjectId: string | null = null;
  if (input.subjectId !== undefined && input.subjectId !== null && input.subjectId !== "") {
    if (typeof input.subjectId !== "string" || input.subjectId.length > 64) return bad("Pick one of your subjects.");
    subjectId = input.subjectId;
  }

  let topicName: string | null = null;
  if (input.topicName !== undefined && input.topicName !== null && input.topicName !== "") {
    if (typeof input.topicName !== "string" || input.topicName.length > EVENT_TOPIC_MAX * 4) return bad(`Keep the topic under ${EVENT_TOPIC_MAX} characters.`);
    const topic = normalizeTopicName(oneLine(input.topicName));
    if (topic.length > EVENT_TOPIC_MAX) return bad(`Keep the topic under ${EVENT_TOPIC_MAX} characters.`);
    if (topic && !subjectId) return bad("Pick a subject before a topic.");
    topicName = topic || null;
  }

  // The page's own name for itself. One that is not an address Nova keeps is
  // dropped, not refused: the save does not depend on it.
  const canonical    = typeof input.canonicalUrl === "string" ? normalizeResourceUrl(input.canonicalUrl) : null;
  const canonicalUrl = canonical && canonical.url !== address.url ? canonical.url : null;

  // A passage is read only for the action that is about one.
  let excerpt: string | null = null;
  if (eventType === "selection_saved") {
    if (typeof input.excerpt !== "string") return bad("Select some text on the page first.");
    if (input.excerpt.length > EVENT_EXCERPT_MAX * 2) return bad(`Select a shorter passage: Nova keeps up to ${EVENT_EXCERPT_MAX} characters.`);
    excerpt = passage(input.excerpt);
    if (!excerpt) return bad("Select some text on the page first.");
    if (excerpt.length > EVENT_EXCERPT_MAX) return bad(`Select a shorter passage: Nova keeps up to ${EVENT_EXCERPT_MAX} characters.`);
  }

  // The action's own time, if it is believable; otherwise now.
  let occurredAt = now;
  if (typeof input.capturedAt === "string" && input.capturedAt.length <= 40) {
    const at = new Date(input.capturedAt);
    if (!Number.isNaN(at.getTime()) && Math.abs(at.getTime() - now.getTime()) <= DAY_MS) occurredAt = at.getTime() > now.getTime() ? now : at;
  }

  return { ok: true, event: { eventType, clientEventId: input.clientEventId, url: address.url, domain: address.domain, title: title || address.domain, subjectId, topicName, occurredAt, canonicalUrl, excerpt } };
}

// ── Reading ───────────────────────────────────────────────────────────────────

const SELECT = {
  id: true, eventType: true, url: true, domain: true, title: true, subjectId: true, topicName: true, occurredAt: true,
  canonicalUrl: true, excerpt: true, filedBy: true,
  processingStatus: true, processingError: true, connections: true,
  subject: { select: { name: true } },
} as const;

type Row = {
  id: string; eventType: string; url: string; domain: string; title: string;
  subjectId: string | null; topicName: string | null; occurredAt: Date; subject: { name: string } | null;
  canonicalUrl: string | null; excerpt: string | null; filedBy: string | null;
  processingStatus: string; processingError: string | null; connections: unknown;
};

const STATUSES: ProcessingStatus[] = ["none", "pending", "processing", "done", "failed"];
const sameName = (a: string | null, b: string | null) => normalizeTopicName(a ?? "").toLowerCase() === normalizeTopicName(b ?? "").toLowerCase();

// What was stored as `connections`, read back as data: anything that is not
// the shape this module wrote is treated as nothing found.
function readConnections(stored: unknown): ResourceConnections {
  const empty: ResourceConnections = { version: 1, concepts: [], suggestions: [], model: false };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return empty;
  const raw = stored as Record<string, unknown>;
  const concepts = Array.isArray(raw.concepts) ? raw.concepts.filter((c): c is string => typeof c === "string").slice(0, 8) : [];
  const suggestions: ResourceConnection[] = [];
  for (const item of Array.isArray(raw.suggestions) ? raw.suggestions.slice(0, 8) : []) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.subjectId !== "string" || typeof c.subjectName !== "string") continue;
    suggestions.push({
      subjectId: c.subjectId, subjectName: c.subjectName,
      topicName:  typeof c.topicName === "string" && c.topicName ? c.topicName : null,
      confidence: c.confidence === "high" ? "high" : "possible",
      basis:      c.basis === "name_in_title" || c.basis === "name_in_selection" ? c.basis : "model",
    });
  }
  return { version: 1, concepts, suggestions, model: raw.model === true };
}

function toProcessing(row: Row): ResourceProcessing {
  const status = STATUSES.find(s => s === row.processingStatus) ?? "none";
  const found  = readConnections(row.connections);
  return {
    status,
    error:    status === "failed" ? (row.processingError ?? "Nova couldn't look at this one.") : null,
    canRetry: status !== "pending" && status !== "processing",
    concepts: found.concepts,
    // Where the page already is needs no suggesting.
    suggestions: found.suggestions.filter(c => !(c.subjectId === row.subjectId && sameName(c.topicName, row.topicName))),
  };
}

function toResource(row: Row): LearningResource {
  const blockedBy = !row.subjectId ? "no_subject" as const : !row.topicName ? "no_topic" as const : null;
  return {
    id: row.id, eventType: row.eventType as LearningEventType,
    url: row.url, domain: row.domain, title: row.title,
    subjectId: row.subjectId, subjectName: row.subject?.name ?? null, topicName: row.topicName,
    savedAt: row.occurredAt.toISOString(),
    canonicalUrl: row.canonicalUrl, excerpt: row.excerpt,
    filedBy: row.filedBy === "nova" ? "nova" : row.subjectId ? "learner" : null,
    processing: toProcessing(row),
    study: { available: blockedBy === null, blockedBy, minutes: REVIEW_BLOCK_MINUTES },
  };
}

type Learner = { status: "ready"; profileId: string } | { status: "not_connected" | "onboarding_incomplete" };

export async function resolveEventLearner(platformChatId: string): Promise<Learner> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true } } },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };
  return { status: "ready", profileId: profile.id };
}

async function subjectsWithTopics(profileId: string) {
  const subjects = await prisma.novaSubject.findMany({
    where:   { profileId },
    orderBy: { name: "asc" },
    select:  { id: true, name: true, topics: { where: { archivedAt: null }, select: { name: true }, orderBy: { name: "asc" } } },
  });
  return subjects.map(s => ({ id: s.id, name: s.name, topics: s.topics.map(t => t.name) }));
}

const activeSessionOf = async (profileId: string) => {
  const open = await prisma.novaStudySession.findFirst({
    where:  { profileId, status: { in: ["in_progress", "paused"] } },
    select: { topicName: true },
  });
  return open ? { topicName: open.topicName } : null;
};

// What the extension's popup needs to offer a save: the learner's own
// subjects and the topics already under them. Nothing about how they are doing.
export async function loadExtensionContext(platformChatId: string, name: string | null): Promise<ExtensionContext> {
  const learner = await resolveEventLearner(platformChatId);
  if (learner.status !== "ready") return learner;
  const [subjects, activeSession] = await Promise.all([subjectsWithTopics(learner.profileId), activeSessionOf(learner.profileId)]);
  return { status: "ready", learner: { name }, subjects, activeSession, limits: { title: EVENT_TITLE_MAX, topic: EVENT_TOPIC_MAX, excerpt: EVENT_EXCERPT_MAX } };
}

// The pages and passages the learner saved, newest first.
export async function loadSavedResources(
  platformChatId: string,
  filters: { subjectId?: string | null; topic?: string | null } = {},
): Promise<NovaSavedResourcesView> {
  const learner = await resolveEventLearner(platformChatId);
  if (learner.status !== "ready") return learner;
  const topic = filters.topic ? normalizeTopicName(filters.topic).slice(0, EVENT_TOPIC_MAX) : "";

  const [rows, subjects, activeSession] = await Promise.all([
    prisma.novaLearningEvent.findMany({
      where: {
        profileId: learner.profileId, eventType: { in: SAVED_TYPES },
        ...(filters.subjectId ? { subjectId: filters.subjectId.slice(0, 64) } : {}),
        ...(topic ? { topicName: { equals: likeLiteral(topic), mode: "insensitive" as const } } : {}),
      },
      orderBy: { occurredAt: "desc" }, take: SAVED_LIMIT, select: SELECT,
    }),
    prisma.novaSubject.findMany({ where: { profileId: learner.profileId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    activeSessionOf(learner.profileId),
  ]);
  return { status: "ready", resources: rows.map(toResource), subjects, activeSession };
}

// One event, by its id, for the learner it belongs to. Anyone else's id is
// simply not found.
export async function getLearningResource(profileId: string, id: string): Promise<LearningResourceResponse> {
  const row = typeof id === "string" && id.length <= 64
    ? await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: SELECT })
    : null;
  if (!row) return { ok: false, error: "not_found", message: "Nova doesn't have that page." };
  return { ok: true, resource: toResource(row), subjects: await subjectsWithTopics(profileId) };
}

export async function removeSavedResource(profileId: string, id: string): Promise<boolean> {
  if (typeof id !== "string" || id.length > 64) return false;
  const removed = await prisma.novaLearningEvent.deleteMany({ where: { id, profileId } });
  return removed.count > 0;
}

// ── Recording ─────────────────────────────────────────────────────────────────

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

const focusPathOf = (eventType: string, id: string) => (eventType === "study_requested" ? `/focus?study=${encodeURIComponent(id)}` : null);

// Records one explicit action. `profileId` and `source` come from the
// caller's credential; nothing in `raw` can name another learner.
export async function recordLearningEvent(
  profileId: string,
  raw:       unknown,
  options:   { source: LearningEventSource; now?: Date },
): Promise<LearningEventResponse> {
  const now    = options.now ?? new Date();
  const parsed = parseLearningEvent(raw, now);
  if (!parsed.ok) return parsed.failure;
  const event = parsed.event;

  const replay = async (): Promise<LearningEventResponse | null> => {
    const row = await prisma.novaLearningEvent.findUnique({
      where:  { profileId_clientEventId: { profileId, clientEventId: event.clientEventId } },
      select: SELECT,
    });
    return row ? {
      success: true, eventId: row.id, duplicate: true,
      action: row.eventType === "study_requested" ? "study_requested" : "saved",
      resource: toResource(row), focusPath: focusPathOf(row.eventType, row.id),
    } : null;
  };

  // A retry of an action already received: answer as before, write nothing.
  const seen = await replay();
  if (seen) return seen;

  const recent = await prisma.novaLearningEvent.count({ where: { profileId, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
  if (recent >= EVENTS_PER_MINUTE) return fail("rate_limited", "That's a lot at once. Give it a minute.");

  if (event.subjectId) {
    const own = await prisma.novaSubject.findFirst({ where: { id: event.subjectId, profileId }, select: { id: true } });
    if (!own) return fail("unknown_subject", "That subject isn't one of yours.");
  }

  // A topic the learner already has keeps its spelling. A new name is kept
  // as typed, on this event only: no topic is created, and nothing is
  // recorded about how well the learner knows it.
  let topicName = event.topicName;
  if (event.subjectId && topicName) {
    const known = await prisma.novaTopicMastery.findFirst({
      where:  { subjectId: event.subjectId, archivedAt: null, name: { equals: likeLiteral(topicName), mode: "insensitive" } },
      select: { name: true },
    });
    topicName = known?.name ?? topicName;
  }

  const filed = { title: event.title, subjectId: event.subjectId, topicName, occurredAt: event.occurredAt };

  // Saving a page that is already saved re-files it. There is one saved
  // entry per page, and one per passage of a page: the same passage sent
  // again is the same entry, a different passage is its own.
  if (event.eventType === "resource_saved" || event.eventType === "selection_saved") {
    const existing = await prisma.novaLearningEvent.findFirst({
      where:  { profileId, eventType: event.eventType, url: event.url, ...(event.eventType === "selection_saved" ? { excerpt: event.excerpt } : {}) },
      select: { id: true, subjectId: true, filedBy: true },
    });
    if (existing) {
      // Saved again with a subject: the learner's filing replaces whatever was
      // there. Saved again with none: a link Nova made is not undone by it.
      const refiled = event.subjectId || existing.filedBy !== "nova"
        ? { ...filed, filedBy: event.subjectId ? "learner" : null }
        : { title: event.title, occurredAt: event.occurredAt };
      const row = await prisma.novaLearningEvent.update({
        where: { id: existing.id },
        data:  { ...refiled, ...(event.canonicalUrl ? { canonicalUrl: event.canonicalUrl } : {}) },
        select: SELECT,
      });
      return { success: true, eventId: row.id, action: "already_saved", duplicate: false, resource: toResource(row), focusPath: null };
    }
  }

  try {
    const row = await prisma.novaLearningEvent.create({
      data: {
        profileId, eventType: event.eventType, source: options.source, clientEventId: event.clientEventId, url: event.url, domain: event.domain, ...filed,
        canonicalUrl: event.canonicalUrl, excerpt: event.excerpt, filedBy: event.subjectId ? "learner" : null,
        // A saved page or passage waits to be looked at. A study request does not.
        processingStatus: event.eventType === "study_requested" ? "none" : "pending",
      },
      select: SELECT,
    });
    return {
      success: true, eventId: row.id, duplicate: false,
      action: event.eventType === "study_requested" ? "study_requested" : "saved",
      resource: toResource(row), focusPath: focusPathOf(row.eventType, row.id),
    };
  } catch (err) {
    // The same action arrived twice at once: the other request stored it.
    if (isUniqueViolation(err)) {
      const stored = await replay();
      if (stored) return stored;
    }
    throw err;
  }
}

// ── Filing a saved page afterwards ────────────────────────────────────────────
// The learner's own change to where a saved page is filed: a subject and
// topic they chose (often one Nova suggested), keeping a link Nova made, or
// undoing it. Guarded on the learner's profile; someone else's id is not found.
export async function fileSavedResource(
  profileId: string, id: string,
  change: { kind: "file"; subjectId: unknown; topicName: unknown } | { kind: "keep" } | { kind: "undo" } | { kind: "unfile" } | { kind: "dismiss"; subjectId: unknown; topicName: unknown },
): Promise<ResourceUpdateResponse> {
  const missing = { ok: false as const, error: "not_found" as const, message: "Nova doesn't have that page." };
  if (typeof id !== "string" || id.length > 64) return missing;

  // "Not this one": the suggestion is taken off the page's list. Nothing else
  // about the page changes, and another look may suggest it again.
  if (change.kind === "dismiss") {
    if (typeof change.subjectId !== "string" || change.subjectId.length > 64) return { ok: false, error: "invalid", message: "That isn't one of the suggestions." };
    const topic   = typeof change.topicName === "string" && change.topicName.length <= EVENT_TOPIC_MAX * 4 ? change.topicName : null;
    const current = await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: { connections: true } });
    if (!current) return missing;
    const found = readConnections(current.connections);
    const kept  = found.suggestions.filter(c => !(c.subjectId === change.subjectId && sameName(c.topicName, topic)));
    if (kept.length !== found.suggestions.length) {
      await prisma.novaLearningEvent.updateMany({ where: { id, profileId }, data: { connections: { ...found, suggestions: kept } as unknown as object } });
    }
    const row = await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: SELECT });
    return row ? { ok: true, resource: toResource(row) } : missing;
  }

  // Filed under nothing, by the learner's choice: the page itself is kept.
  if (change.kind === "unfile") {
    await prisma.novaLearningEvent.updateMany({ where: { id, profileId }, data: { subjectId: null, topicName: null, filedBy: null } });
    const row = await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: SELECT });
    return row ? { ok: true, resource: toResource(row) } : missing;
  }

  if (change.kind === "keep" || change.kind === "undo") {
    // Only a link Nova made can be kept or undone, and only once.
    const data = change.kind === "keep" ? { filedBy: "learner" } : { subjectId: null, topicName: null, filedBy: null };
    await prisma.novaLearningEvent.updateMany({ where: { id, profileId, filedBy: "nova" }, data });
    const row = await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: SELECT });
    if (!row) return missing;
    return { ok: true, resource: toResource(row) };
  }

  if (typeof change.subjectId !== "string" || !change.subjectId || change.subjectId.length > 64) return { ok: false, error: "invalid", message: "Pick one of your subjects." };
  const subject = await prisma.novaSubject.findFirst({ where: { id: change.subjectId, profileId }, select: { id: true } });
  if (!subject) return { ok: false, error: "unknown_subject", message: "That subject isn't one of yours." };

  let topicName: string | null = null;
  if (typeof change.topicName === "string" && change.topicName.trim()) {
    if (change.topicName.length > EVENT_TOPIC_MAX * 4) return { ok: false, error: "invalid", message: `Keep the topic under ${EVENT_TOPIC_MAX} characters.` };
    const typed = normalizeTopicName(oneLine(change.topicName));
    if (typed.length > EVENT_TOPIC_MAX) return { ok: false, error: "invalid", message: `Keep the topic under ${EVENT_TOPIC_MAX} characters.` };
    const known = typed ? await prisma.novaTopicMastery.findFirst({
      where:  { subjectId: subject.id, archivedAt: null, name: { equals: likeLiteral(typed), mode: "insensitive" } },
      select: { name: true },
    }) : null;
    topicName = known?.name ?? (typed || null);
  }

  const done = await prisma.novaLearningEvent.updateMany({ where: { id, profileId }, data: { subjectId: subject.id, topicName, filedBy: "learner" } });
  if (done.count === 0) return missing;
  const row = await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: SELECT });
  return row ? { ok: true, resource: toResource(row) } : missing;
}

// ── Rows for processing (product/resource-processing.ts) ──────────────────────
// Every write is one conditional update, so a page is looked at by one worker
// at a time and a late answer from a superseded attempt changes nothing.

export const PROCESSING_MAX_ATTEMPTS = 3;
const PROCESSING_STALE_MS = 3 * 60_000;      // an attempt that never reported back
const PROCESSING_RETRY_MS = 10 * 60_000;     // before a failed one is tried again unasked

export interface ProcessingClaim {
  id: string; profileId: string; startedAt: Date;
  title: string; domain: string; excerpt: string | null; subjectId: string | null;
}

// Takes one saved page for processing. `by: "learner"` is the Retry button:
// it may take a page in any state except one being looked at right now.
// `by: "queue"` takes only what is waiting.
export async function claimForProcessing(id: string, by: "learner" | "queue", now: Date, profileId?: string): Promise<ProcessingClaim | null> {
  if (typeof id !== "string" || id.length > 64) return null;
  const stale = new Date(now.getTime() - PROCESSING_STALE_MS);
  const idle  = { OR: [{ processingStatus: { not: "processing" } }, { processingStartedAt: null }, { processingStartedAt: { lt: stale } }] };
  const waiting = { OR: [
    { processingStatus: "pending" },
    { processingStatus: "processing", processingStartedAt: { lt: stale } },
    { processingStatus: "failed", processingAttempts: { lt: PROCESSING_MAX_ATTEMPTS }, processingStartedAt: { lt: new Date(now.getTime() - PROCESSING_RETRY_MS) } },
  ] };
  const claimed = await prisma.novaLearningEvent.updateMany({
    where: { id, ...(profileId ? { profileId } : {}), eventType: { in: SAVED_TYPES }, ...(by === "learner" ? idle : waiting) },
    data:  { processingStatus: "processing", processingStartedAt: now, processingError: null, processingAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return null;
  const row = await prisma.novaLearningEvent.findFirst({
    where:  { id, processingStatus: "processing", processingStartedAt: now },
    select: { id: true, profileId: true, title: true, domain: true, excerpt: true, subjectId: true },
  });
  return row ? { ...row, startedAt: now } : null;
}

// Stores what was found. `file` is a link Nova may make by itself: it is
// written only while the page is still filed nowhere, and marked as Nova's.
export async function completeProcessing(
  claim: ProcessingClaim, found: ResourceConnections, file: { subjectId: string; topicName: string | null } | null, now: Date,
): Promise<boolean> {
  const mine = { id: claim.id, processingStatus: "processing", processingStartedAt: claim.startedAt };
  const data = { processingStatus: "done", processedAt: now, processingError: null, connections: found as unknown as object };
  if (file) {
    const filed = await prisma.novaLearningEvent.updateMany({ where: { ...mine, subjectId: null }, data: { ...data, subjectId: file.subjectId, topicName: file.topicName, filedBy: "nova" } });
    if (filed.count > 0) return true;
  }
  return (await prisma.novaLearningEvent.updateMany({ where: mine, data })).count > 0;
}

// Records that an attempt failed. The saved page is untouched.
export async function failProcessing(claim: ProcessingClaim, message: string, now: Date): Promise<void> {
  await prisma.novaLearningEvent.updateMany({
    where: { id: claim.id, processingStatus: "processing", processingStartedAt: claim.startedAt },
    data:  { processingStatus: "failed", processedAt: now, processingError: message.slice(0, 200) },
  });
}

// Saved pages waiting to be looked at, oldest first.
export async function listWaitingForProcessing(now: Date, take: number): Promise<string[]> {
  const stale = new Date(now.getTime() - PROCESSING_STALE_MS);
  const rows = await prisma.novaLearningEvent.findMany({
    where: { eventType: { in: SAVED_TYPES }, OR: [
      { processingStatus: "pending" },
      { processingStatus: "processing", processingStartedAt: { lt: stale } },
      { processingStatus: "failed", processingAttempts: { lt: PROCESSING_MAX_ATTEMPTS }, processingStartedAt: { lt: new Date(now.getTime() - PROCESSING_RETRY_MS) } },
    ] },
    orderBy: { createdAt: "asc" }, take, select: { id: true },
  });
  return rows.map(r => r.id);
}

// The learner's own subjects and topic names: the only things a saved page
// can be connected to.
export const loadVocabulary = (profileId: string) => subjectsWithTopics(profileId);

export async function getSavedResource(profileId: string, id: string): Promise<LearningResource | null> {
  const row = await prisma.novaLearningEvent.findFirst({ where: { id, profileId }, select: SELECT });
  return row ? toResource(row) : null;
}

// ── For the Knowledge Map ─────────────────────────────────────────────────────
// The newest `take` saved pages with what each was filed under, and how many
// there are in all.
export async function listResourceLinks(profileId: string, take: number): Promise<{
  resources: Array<{
    id: string; title: string; url: string; domain: string; eventType: string; subjectId: string | null; topicName: string | null; occurredAt: Date;
    // Who filed it there, and the places it was suggested for and not filed under.
    filedBy: "learner" | "nova" | null; suggestions: ResourceConnection[];
  }>;
  total: number;
}> {
  const [rows, total] = await Promise.all([
    prisma.novaLearningEvent.findMany({
      where: { profileId }, orderBy: { occurredAt: "desc" }, take,
      select: { id: true, title: true, url: true, domain: true, eventType: true, subjectId: true, topicName: true, occurredAt: true, filedBy: true, connections: true },
    }),
    prisma.novaLearningEvent.count({ where: { profileId } }),
  ]);
  const resources = rows.map(({ connections, filedBy, ...row }) => ({
    ...row,
    filedBy: filedBy === "nova" ? "nova" as const : row.subjectId ? "learner" as const : null,
    suggestions: readConnections(connections).suggestions.filter(c => !(c.subjectId === row.subjectId && sameName(c.topicName, row.topicName))),
  }));
  return { resources, total };
}

// ── For Nova's help on a note (product/note-assist.ts) ────────────────────────
// Saved pages filed under a subject (and, first, the ones under its topic):
// title, site, address and the passage the learner selected, if any. Nova
// has not read any page; the server never fetches one.
export async function listResourceSources(profileId: string, subjectId: string, topicName: string | null, take: number): Promise<Array<{
  id: string; title: string; domain: string; url: string; excerpt: string | null; onTopic: boolean;
}>> {
  const rows = await prisma.novaLearningEvent.findMany({
    where:   { profileId, subjectId, eventType: { in: ["resource_saved", "selection_saved"] } },
    orderBy: { occurredAt: "desc" }, take: take * 3,
    select:  { id: true, title: true, domain: true, url: true, excerpt: true, topicName: true },
  });
  const onTopic = (t: string | null) => sameName(t, topicName) && topicName !== null;
  return [...rows.filter(r => onTopic(r.topicName)), ...rows.filter(r => !onTopic(r.topicName))]
    .slice(0, take)
    .map(r => ({ id: r.id, title: r.title, domain: r.domain, url: r.url, excerpt: r.excerpt ? r.excerpt.slice(0, 1_200) : null, onTopic: onTopic(r.topicName) }));
}

// When the learner renames, moves or removes a topic in study setup
// (product/setup-edit.ts), the saved pages filed under it follow, in the
// caller's transaction. Only the filing changes; what was saved does not.
export async function refileResourcesForTopic(
  tx: Pick<typeof prisma, "novaLearningEvent">,
  profileId: string,
  from: { subjectId: string; topicName: string },
  to: { subjectId: string; topicName: string | null },
): Promise<number> {
  const r = await tx.novaLearningEvent.updateMany({
    where: { profileId, subjectId: from.subjectId, topicName: { equals: from.topicName, mode: "insensitive" } },
    data:  { subjectId: to.subjectId, topicName: to.topicName },
  });
  return r.count;
}
