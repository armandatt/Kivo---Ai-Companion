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
// title and where the learner filed it, and nothing of the page itself.

import { learnerKey } from "./learner-key";
import { prisma } from "@repo/db/client";
import { REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { likeLiteral, normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  EVENTS_PER_MINUTE, EVENT_ID_MAX, EVENT_ID_MIN, EVENT_TITLE_MAX, EVENT_TOPIC_MAX, EVENT_URL_MAX,
  type ExtensionContext, type LearningEventResponse, type LearningEventSource, type LearningEventType,
  type LearningResource, type LearningResourceResponse, type NovaSavedResourcesView,
} from "./learning-events.types";

const EVENT_TYPES: LearningEventType[] = ["resource_saved", "study_requested"];
const SAVED_LIMIT = 200;
const DAY_MS      = 86_400_000;

type Failure = Extract<LearningEventResponse, { success: false }>;
const fail = (error: Failure["error"], message: string): Failure => ({ success: false, error, message });

// ── The address ───────────────────────────────────────────────────────────────

// Query parameters that carry credentials rather than say which page it is.
// They are dropped before the address is stored.
const CREDENTIAL_PARAMS = new Set([
  "token", "access_token", "id_token", "refresh_token", "auth", "authorization", "apikey", "api_key", "key",
  "password", "passwd", "pwd", "secret", "signature", "sig", "session", "sessionid", "session_id", "sid", "otp",
]);
const CREDENTIAL_PARAM_PREFIXES = ["x-amz-", "x-goog-"];

// A web page address, cleaned for keeping: http or https only, no login in
// it, no fragment, no credential parameters. null: not an address Nova keeps.
export function normalizeResourceUrl(raw: unknown): { url: string; domain: string } | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > EVENT_URL_MAX) return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;

  parsed.username = "";
  parsed.password = "";
  parsed.hash     = "";
  for (const name of [...parsed.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (CREDENTIAL_PARAMS.has(lower) || CREDENTIAL_PARAM_PREFIXES.some(p => lower.startsWith(p))) parsed.searchParams.delete(name);
  }
  const url = parsed.toString();
  if (url.length > EVENT_URL_MAX) return null;
  const host = parsed.hostname.toLowerCase();
  return { url, domain: host.startsWith("www.") ? host.slice(4) : host };
}

// ── Validation ────────────────────────────────────────────────────────────────

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const isClientEventId = (v: unknown): v is string =>
  typeof v === "string" && v.length >= EVENT_ID_MIN && v.length <= EVENT_ID_MAX && [...v].every(ch => ID_CHARS.includes(ch));

// One line of text: control characters out, runs of whitespace to one space.
const oneLine = (text: string) => [...text].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");

export interface ParsedLearningEvent {
  eventType:     LearningEventType;
  clientEventId: string;
  url:           string;
  domain:        string;
  title:         string;
  subjectId:     string | null;
  topicName:     string | null;
  occurredAt:    Date;
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

  // The action's own time, if it is believable; otherwise now.
  let occurredAt = now;
  if (typeof input.capturedAt === "string" && input.capturedAt.length <= 40) {
    const at = new Date(input.capturedAt);
    if (!Number.isNaN(at.getTime()) && Math.abs(at.getTime() - now.getTime()) <= DAY_MS) occurredAt = at.getTime() > now.getTime() ? now : at;
  }

  return { ok: true, event: { eventType, clientEventId: input.clientEventId, url: address.url, domain: address.domain, title: title || address.domain, subjectId, topicName, occurredAt } };
}

// ── Reading ───────────────────────────────────────────────────────────────────

const SELECT = {
  id: true, eventType: true, url: true, domain: true, title: true, subjectId: true, topicName: true, occurredAt: true,
  subject: { select: { name: true } },
} as const;

type Row = {
  id: string; eventType: string; url: string; domain: string; title: string;
  subjectId: string | null; topicName: string | null; occurredAt: Date; subject: { name: string } | null;
};

function toResource(row: Row): LearningResource {
  const blockedBy = !row.subjectId ? "no_subject" as const : !row.topicName ? "no_topic" as const : null;
  return {
    id: row.id, eventType: row.eventType as LearningEventType,
    url: row.url, domain: row.domain, title: row.title,
    subjectId: row.subjectId, subjectName: row.subject?.name ?? null, topicName: row.topicName,
    savedAt: row.occurredAt.toISOString(),
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
    select:  { id: true, name: true, topics: { select: { name: true }, orderBy: { name: "asc" } } },
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
  return { status: "ready", learner: { name }, subjects, activeSession, limits: { title: EVENT_TITLE_MAX, topic: EVENT_TOPIC_MAX } };
}

// The pages the learner saved, newest first.
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
        profileId: learner.profileId, eventType: "resource_saved",
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
      where:  { subjectId: event.subjectId, name: { equals: likeLiteral(topicName), mode: "insensitive" } },
      select: { name: true },
    });
    topicName = known?.name ?? topicName;
  }

  const filed = { title: event.title, subjectId: event.subjectId, topicName, occurredAt: event.occurredAt };

  // Saving a page that is already saved re-files it. There is one saved
  // entry per page.
  if (event.eventType === "resource_saved") {
    const existing = await prisma.novaLearningEvent.findFirst({
      where:  { profileId, eventType: "resource_saved", url: event.url },
      select: { id: true },
    });
    if (existing) {
      const row = await prisma.novaLearningEvent.update({ where: { id: existing.id }, data: filed, select: SELECT });
      return { success: true, eventId: row.id, action: "already_saved", duplicate: false, resource: toResource(row), focusPath: null };
    }
  }

  try {
    const row = await prisma.novaLearningEvent.create({
      data:   { profileId, eventType: event.eventType, source: options.source, clientEventId: event.clientEventId, url: event.url, domain: event.domain, ...filed },
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
