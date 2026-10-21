// ─── Exams: adding, moving and removing one ───────────────────────────────────
// A domain-owned write, like a session command: the learner confirms an exam
// (a button, after Nova read one out of a message and asked) and it is added.
// It is never written on a model's reading alone, and it is not memory: an
// exam is an academic record the Planning and Exam engines already read.
// No LLM call.
//
// This file is the only writer of NovaExam after onboarding. A change or a
// removal is the learner's own, made on the exam-date editor, and always
// names the exam among that learner's own: every query carries the profile.
//
// Nothing is stored about a plan or a reminder, so nothing has to be undone
// when a date moves: Today, the Planner and the proactive tick all read the
// exams afresh, and a countdown that was approved for the old date is
// dropped when its reason is gone (nova-proactive-cron.ts).
//
// Removing an exam deletes the row. Nothing hangs off an exam (no session,
// mastery or note refers to one), so no history goes with it.

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { isIsoDay } from "../brains/understanding-parser";
import { calendarDaysUntil, dateDayKey } from "../engines/learner-calendar";
import { subjectsNamedIn } from "../engines/topic-mastery-engine";
import { EXAM_TITLE_MAX, type ExamChangeError, type NovaExamItem } from "./exams.types";
import { deadlineType, parseDeadlineType, type DeadlineType } from "./deadline-types";

export const EXAM_HORIZON_DAYS = 366;
const DAY_MS = 86_400_000;

// Noon UTC of the named day: inside that calendar day for every timezone
// from UTC-11 to UTC+11, so "days until" counts the day the learner meant.
export const examInstant = (isoDay: string): Date => new Date(`${isoDay}T12:00:00.000Z`);

export type AddExamResult =
  | { status: "added" | "exists"; title: string; date: string }
  | { status: "invalid"; reason: "bad_date" | "in_the_past" | "too_far" | "no_title" }
  | { status: "not_ready" };

export async function addExam(
  platformChatId: string,
  // kind: what sort of date it is (product/deadline-types.ts). Left out, an
  // exam. Not called "type": callers pass action objects whose `type` is the
  // action's name, and that must never be stored as the date's kind.
  input: { title: string; subjectName: string | null; date: string; kind?: DeadlineType },
  now = new Date(),
): Promise<AddExamResult> {
  const title = input.title.trim().slice(0, 80);
  if (!title) return { status: "invalid", reason: "no_title" };
  if (!isIsoDay(input.date)) return { status: "invalid", reason: "bad_date" };

  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, timezone: true, subjects: { select: { id: true, name: true, code: true } } } } },
  });
  const profile = user?.novaAcademicProfile;
  if (!profile) return { status: "not_ready" };

  const today = dayKey(now, resolveTimezone(profile.timezone));
  if (input.date < today) return { status: "invalid", reason: "in_the_past" };
  const at = examInstant(input.date);
  if (at.getTime() - now.getTime() > EXAM_HORIZON_DAYS * DAY_MS) return { status: "invalid", reason: "too_far" };

  // The subject is the one the label names. Two or none: no subject.
  const named   = subjectsNamedIn(input.subjectName ?? title, profile.subjects);
  const subject = named.length === 1 ? named[0]! : null;

  // The same exam, said twice or already known from setup: the same subject
  // within a day of that date. With no subject to compare, any exam on that
  // day is taken to be the one meant: a second, nameless exam on the same day
  // is far more likely a duplicate than a new obligation.
  const near = await prisma.novaExam.findMany({
    where:  { profileId: profile.id, scheduledAt: { gte: new Date(at.getTime() - DAY_MS), lte: new Date(at.getTime() + DAY_MS) } },
    select: { title: true, subjectId: true },
  });
  const duplicate = subject ? near.some(e => e.subjectId === subject.id) : near.length > 0;
  if (duplicate) return { status: "exists", title, date: input.date };

  await prisma.novaExam.create({
    data: { profileId: profile.id, subjectId: subject?.id ?? null, title, examType: parseDeadlineType(input.kind) ?? "exam", scheduledAt: at },
  });
  return { status: "added", title, date: input.date };
}

// A workspace's dates (product/workspaces.ts), inside its transaction, by
// the same rules as addExam: from today, within the horizon, never a second
// date for a subject on (about) a day it already has one. Returns how many
// were added and the ones that were not, with why.
export async function addDatesIn(
  tx: Pick<typeof prisma, "novaExam">,
  profileId: string,
  dates: Array<{ title: string; subjectId: string | null; kind: DeadlineType; day: string }>,
  today: string,
  now = new Date(),
): Promise<{ added: number; skipped: Array<{ title: string; reason: "exists" | "invalid" }> }> {
  let added = 0;
  const skipped: Array<{ title: string; reason: "exists" | "invalid" }> = [];
  for (const d of dates) {
    const title = d.title.trim().slice(0, EXAM_TITLE_MAX);
    const at = isIsoDay(d.day) ? examInstant(d.day) : null;
    if (!title || !at || d.day < today || at.getTime() - now.getTime() > EXAM_HORIZON_DAYS * DAY_MS) { skipped.push({ title: title || "a date", reason: "invalid" }); continue; }
    const near = await tx.novaExam.findMany({
      where:  { profileId, scheduledAt: { gte: new Date(at.getTime() - DAY_MS), lte: new Date(at.getTime() + DAY_MS) } },
      select: { subjectId: true },
    });
    if (d.subjectId ? near.some(e => e.subjectId === d.subjectId) : near.length > 0) { skipped.push({ title, reason: "exists" }); continue; }
    await tx.novaExam.create({ data: { profileId, subjectId: d.subjectId, title, examType: parseDeadlineType(d.kind) ?? "exam", scheduledAt: at } });
    added++;
  }
  return { added, skipped };
}

// What Nova may offer to add when a message names an exam and its day, and
// under which of the learner's subjects. Nova never picks the subject itself.
//
//   the label names one subject   offered under it, unless that subject has an
//                                 exam on (about) that day already
//   it names none ("exam is       if any exam is on that day, that one is
//   tomorrow", "Databases" for    almost certainly meant: nothing is offered.
//   "Database Management          Otherwise it is offered with the learner's
//   Systems")                     subjects to choose from
//   it names several              offered with those to choose from
//
// An exam is never offered without a subject: one cannot be planned for.
export interface ExamOffer { title: string; date: string; subjectNames: string[] }
export const EXAM_SUBJECT_CHOICES = 4;

export function examToOffer(
  exam:     { title: string; date: string },
  subjects: Array<{ id: string; name: string; code?: string | null }>,
  upcoming: Array<{ subjectId: string | null; scheduledAt: Date }>,
): ExamOffer | null {
  if (!isIsoDay(exam.date) || subjects.length === 0) return null;
  const at    = examInstant(exam.date).getTime();
  const near  = upcoming.filter(e => Math.abs(e.scheduledAt.getTime() - at) <= 1.5 * DAY_MS);
  const named = subjectsNamedIn(exam.title, subjects);
  if (named.length === 0 && near.length > 0) return null;
  const free  = (named.length > 0 ? named : subjects).filter(s => !near.some(e => e.subjectId === s.id));
  if (free.length === 0) return null;
  return { title: exam.title.trim().slice(0, 80), date: exam.date, subjectNames: free.slice(0, EXAM_SUBJECT_CHOICES).map(s => s.name) };
}

// ── The exams on record, and changing one ─────────────────────────────────────

const isoDayOf = (at: Date): string => at.toISOString().slice(0, 10);

async function learnerProfile(platformChatId: string) {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, timezone: true } } },
  });
  return user?.novaAcademicProfile ?? null;
}

async function examsOf(profile: { id: string; timezone: string | null }, now: Date): Promise<NovaExamItem[]> {
  const today = dayKey(now, resolveTimezone(profile.timezone));
  const rows  = await prisma.novaExam.findMany({
    // From the start of the learner's yesterday: an exam is stored at noon
    // UTC of its day, and one dated today must not drop off the list at noon.
    where:   { profileId: profile.id, scheduledAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } },
    orderBy: { scheduledAt: "asc" },
    select:  { id: true, title: true, examType: true, scheduledAt: true, subject: { select: { name: true } } },
  });
  return rows
    .map(e => ({ id: e.id, title: e.title, type: deadlineType(e.examType), subjectName: e.subject?.name ?? null, date: isoDayOf(e.scheduledAt),
      daysUntil: calendarDaysUntil(e.scheduledAt, now, profile.timezone) }))
    .filter(e => e.date >= today);
}

// The learner's dated deadlines whose day falls from..to (YYYY-MM-DD,
// inclusive), past ones too, for the calendar. By profile: the caller has
// already resolved the learner. A stored date is a day (dateDayKey).
export async function listDeadlinesBetween(
  profile: { id: string; timezone: string | null },
  range:   { from: string; to: string },
): Promise<Array<{ id: string; title: string; type: DeadlineType; subjectName: string | null; date: string }>> {
  // A day of slack on either side: a stored instant is read in the learner's
  // zone, which can put it on the neighbouring UTC day.
  const first = Date.parse(`${range.from}T00:00:00.000Z`) - DAY_MS;
  const last  = Date.parse(`${range.to}T23:59:59.999Z`) + DAY_MS;
  const rows = await prisma.novaExam.findMany({
    where:   { profileId: profile.id, scheduledAt: { gte: new Date(first), lte: new Date(last) } },
    orderBy: { scheduledAt: "asc" },
    select:  { id: true, title: true, examType: true, scheduledAt: true, subject: { select: { name: true } } },
  });
  return rows
    .map(e => ({ id: e.id, title: e.title, type: deadlineType(e.examType), subjectName: e.subject?.name ?? null, date: dateDayKey(e.scheduledAt, profile.timezone) }))
    .filter(e => e.date >= range.from && e.date <= range.to);
}

// The learner's exams from today on, soonest first. null: no Nova profile yet.
export async function listExams(platformChatId: string, now = new Date()): Promise<NovaExamItem[] | null> {
  const profile = await learnerProfile(platformChatId);
  return profile ? examsOf(profile, now) : null;
}

export type ExamChange = { title: string; date: string; type: DeadlineType };
export type ExamChangeCheck =
  | { ok: true; change: ExamChange; changed: boolean }
  | { ok: false; reason: Exclude<ExamChangeError, "not_found"> };

// Whether a change to one exam can be made, and what it comes to. Pure.
// `input` is the request body: only `title`, `date` and `type` are read, and
// one left out keeps what is on record. `others` are the learner's other exams.
export function checkExamChange(
  current: { title: string; date: string; subjectId: string | null; type?: DeadlineType },
  others:  Array<{ title: string; date: string; subjectId: string | null }>,
  input:   unknown,
  today:   string,
  now:     Date,
): ExamChangeCheck {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, reason: "invalid" };
  const body = input as Record<string, unknown>;
  if (body["title"] !== undefined && typeof body["title"] !== "string") return { ok: false, reason: "invalid" };
  if (body["date"]  !== undefined && typeof body["date"]  !== "string") return { ok: false, reason: "invalid" };
  const was  = current.type ?? "exam";
  const type = body["type"] === undefined ? was : parseDeadlineType(body["type"]);
  if (type === null) return { ok: false, reason: "invalid" };

  const title = body["title"] === undefined ? current.title : (body["title"] as string).trim();
  const date  = body["date"]  === undefined ? current.date  : (body["date"] as string).trim();
  if (!title) return { ok: false, reason: "no_title" };
  if (title.length > EXAM_TITLE_MAX) return { ok: false, reason: "invalid" };

  const changed = title !== current.title || date !== current.date || type !== was;
  if (date !== current.date) {
    if (!isIsoDay(date)) return { ok: false, reason: "bad_date" };
    if (date < today) return { ok: false, reason: "in_the_past" };
    if (examInstant(date).getTime() - now.getTime() > EXAM_HORIZON_DAYS * DAY_MS) return { ok: false, reason: "too_far" };
    // A move of a day or two is not a duplicate of itself: only another exam
    // of the same subject on that very day is. With no subject, the title
    // stands in for it.
    const clash = others.some(o => o.date === date && (
      current.subjectId !== null ? o.subjectId === current.subjectId
        : o.subjectId === null && o.title.trim().toLowerCase() === title.toLowerCase()
    ));
    if (clash) return { ok: false, reason: "duplicate" };
  }
  return { ok: true, change: { title, date, type }, changed };
}

export type ExamWriteResult =
  | { status: "saved" | "removed"; exams: NovaExamItem[] }
  | { status: "invalid"; reason: Exclude<ExamChangeError, "not_found"> }
  | { status: "not_found" }
  | { status: "not_ready" };

// Moves or renames one of the learner's own exams. The id selects among
// their exams only. Saying the same thing twice changes nothing the second time.
export async function updateExam(platformChatId: string, examId: string, input: unknown, now = new Date()): Promise<ExamWriteResult> {
  const profile = await learnerProfile(platformChatId);
  if (!profile) return { status: "not_ready" };
  if (typeof examId !== "string" || !examId) return { status: "not_found" };

  const all = await prisma.novaExam.findMany({
    where:  { profileId: profile.id },
    select: { id: true, title: true, examType: true, scheduledAt: true, subjectId: true },
  });
  const row = all.find(e => e.id === examId);
  if (!row) return { status: "not_found" };

  const flat  = (e: (typeof all)[number]) => ({ title: e.title, date: isoDayOf(e.scheduledAt), subjectId: e.subjectId, type: deadlineType(e.examType) });
  const check = checkExamChange(flat(row), all.filter(e => e.id !== examId).map(flat), input, dayKey(now, resolveTimezone(profile.timezone)), now);
  if (!check.ok) return { status: "invalid", reason: check.reason };

  if (check.changed) {
    const written = await prisma.novaExam.updateMany({
      where: { id: examId, profileId: profile.id },
      data:  { title: check.change.title, scheduledAt: examInstant(check.change.date), examType: check.change.type },
    });
    // Removed between the read and the write: there is nothing to change.
    if (written.count === 0) return { status: "not_found" };
  }
  return { status: "saved", exams: await examsOf(profile, now) };
}

// Removes one of the learner's own exams. Removing one that is already gone
// is "not_found", which a caller retrying a removal may take as done.
export async function removeExam(platformChatId: string, examId: string, now = new Date()): Promise<ExamWriteResult> {
  const profile = await learnerProfile(platformChatId);
  if (!profile) return { status: "not_ready" };
  if (typeof examId !== "string" || !examId) return { status: "not_found" };
  const gone = await prisma.novaExam.deleteMany({ where: { id: examId, profileId: profile.id } });
  if (gone.count === 0) return { status: "not_found" };
  return { status: "removed", exams: await examsOf(profile, now) };
}
