// ─── Focus context ────────────────────────────────────────────────────────────
// A read model: the learner's own records filed under the topic they are
// about to study or are studying. It reads tasks, saved pages and exams only
// through the modules that own them, and the session note through the
// session store. It writes nothing, calls no model and decides nothing: a
// record is shown because the learner filed it under this subject or topic,
// never because something inferred it belongs.
//
// Showing a task or a saved page here is not evidence of anything. Finishing
// the task, or opening the page, moves no mastery.

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { listTasks } from "./tasks";
import { listResourceLinks } from "./learning-events";
import { listExams } from "./exams";
import { listNoteLinks } from "./notes";
import { latestSessionNote } from "../persistence/nova-persistence";
import {
  REFLECTION_FIELD_MAX,
  type FocusContextNote, type FocusContextResource, type FocusContextTask, type NovaFocusContextReady, type NovaFocusContextView, type SessionReflection,
} from "./focus-context.types";
import type { NovaTaskItem } from "./tasks.types";

export const FOCUS_TASKS_SHOWN     = 5;
export const FOCUS_RESOURCES_SHOWN = 4;
export const FOCUS_NOTES_SHOWN     = 4;
// How many of the learner's newest notes are looked through for this topic.
const NOTES_READ = 200;
const RESOURCES_READ = 200;

// Names are compared the way the Knowledge Map compares them: trimmed,
// single-spaced, any case.
const key = (name: string | null | undefined): string => (name ?? "").trim().split(" ").filter(Boolean).join(" ").toLowerCase();

// ── The session note ──────────────────────────────────────────────────────────

const clean = (value: unknown): string | null => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.split("\r\n").join("\n").trim();
  return text.length > REFLECTION_FIELD_MAX ? null : text;
};

// The three answers as they will be kept. "invalid": not three short texts.
// "empty": nothing was written, so there is nothing to keep.
export function parseReflection(raw: unknown): { ok: true; reflection: SessionReflection } | { ok: false; reason: "invalid" | "empty" } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "invalid" };
  const r = raw as Record<string, unknown>;
  const did = clean(r["did"]), blocked = clean(r["blocked"]), next = clean(r["next"]);
  if (did === null || blocked === null || next === null) return { ok: false, reason: "invalid" };
  if (!did && !blocked && !next) return { ok: false, reason: "empty" };
  return { ok: true, reflection: { did, blocked, next } };
}

// A note as stored on the session, read back. Anything that is not one is no note.
export function readReflection(stored: string | null): SessionReflection | null {
  if (!stored) return null;
  try {
    const parsed = parseReflection(JSON.parse(stored));
    return parsed.ok ? parsed.reflection : null;
  } catch {
    return null;
  }
}

// ── Pure builder ──────────────────────────────────────────────────────────────

export function buildFocusContext(input: {
  subject:   { id: string; name: string } | null;
  topicName: string | null;
  tasks:     NovaTaskItem[];
  resources: Array<{ id: string; title: string; url: string; domain: string; subjectId: string | null; topicName: string | null }>;
  notes?:    Array<{ id: string; title: string; subjectId: string | null; topicName: string | null; updatedAt: Date }>;
  exams:     Array<{ title: string; subjectName: string | null; daysUntil: number }>;
  lastNote:  { text: string | null; date: Date } | null;
}): NovaFocusContextReady {
  const { subject } = input;
  const topic = key(input.topicName);
  // Filed under this subject, and either under this topic or under no topic
  // at all. Something filed under another topic of the subject is not this
  // topic's, and something with no subject is nobody's.
  const belongs = (item: { subjectId: string | null; topicName: string | null }) =>
    subject !== null && item.subjectId === subject.id && (key(item.topicName) === topic || key(item.topicName) === "");
  const onTopic = (item: { topicName: string | null }) => topic !== "" && key(item.topicName) === topic;
  const topicFirst = <T extends { onTopic: boolean }>(a: T, b: T) => Number(b.onTopic) - Number(a.onTopic);

  const tasks: FocusContextTask[] = input.tasks
    .filter(t => t.status !== "done" && belongs(t))
    .map(t => ({ id: t.id, title: t.title, status: t.status as "todo" | "in_progress", dueInDays: t.dueInDays, onTopic: onTopic(t) }))
    .sort(topicFirst)
    .slice(0, FOCUS_TASKS_SHOWN);

  const resources: FocusContextResource[] = input.resources
    .filter(belongs)
    .map(r => ({ id: r.id, title: r.title, url: r.url, domain: r.domain, onTopic: onTopic(r) }))
    .sort(topicFirst)
    .slice(0, FOCUS_RESOURCES_SHOWN);

  const notes: FocusContextNote[] = (input.notes ?? [])
    .filter(belongs)
    .map(n => ({ id: n.id, title: n.title, updatedAt: n.updatedAt.toISOString(), onTopic: onTopic(n) }))
    .sort(topicFirst)
    .slice(0, FOCUS_NOTES_SHOWN);

  const exam = subject
    ? input.exams.filter(e => key(e.subjectName) === key(subject.name)).sort((a, b) => a.daysUntil - b.daysUntil)[0]
    : undefined;

  const note = input.lastNote ? readReflection(input.lastNote.text) : null;

  return {
    status:      "ready",
    subjectName: subject?.name ?? null,
    topicName:   input.topicName,
    tasks,
    resources,
    notes,
    deadline:    exam ? { title: exam.title, daysUntil: exam.daysUntil } : null,
    lastNote:    note && input.lastNote ? { ...note, date: input.lastNote.date.toISOString() } : null,
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────

// `where` names the topic. Left out, it is the running session's.
export async function loadFocusContext(
  platformChatId: string,
  where:          { subjectName: string | null; topicName: string | null } | null,
  now = new Date(),
): Promise<NovaFocusContextView> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true, subjects: { select: { id: true, name: true } } } } },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };

  let target = where;
  if (!target) {
    const running = await prisma.novaStudySession.findFirst({
      where:   { profileId: profile.id, status: { in: ["in_progress", "paused"] } },
      orderBy: { createdAt: "desc" },
      select:  { topicName: true, subjectId: true },
    });
    target = running
      ? { topicName: running.topicName, subjectName: profile.subjects.find(s => s.id === running.subjectId)?.name ?? null }
      : { topicName: null, subjectName: null };
  }
  const subject = target.subjectName ? profile.subjects.find(s => key(s.name) === key(target!.subjectName)) ?? null : null;

  const [tasks, links, noted, exams, lastNote] = await Promise.all([
    listTasks(profile.id, { now }),
    listResourceLinks(profile.id, RESOURCES_READ),
    listNoteLinks(profile.id, NOTES_READ),
    listExams(platformChatId, now),
    subject && target.topicName ? latestSessionNote(profile.id, subject.id, target.topicName) : Promise.resolve(null),
  ]);

  return buildFocusContext({
    subject, topicName: target.topicName,
    tasks: tasks.tasks, resources: links.resources, notes: noted.notes, exams: exams ?? [], lastNote,
  });
}
