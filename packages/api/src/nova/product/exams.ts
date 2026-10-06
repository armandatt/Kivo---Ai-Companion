// ─── Exams: adding one after onboarding ───────────────────────────────────────
// A domain-owned write, like a session command: the learner confirms an exam
// (a button, after Nova read one out of a message and asked) and it is added.
// It is never written on a model's reading alone, and it is not memory: an
// exam is an academic record the Planning and Exam engines already read.
// No LLM call.

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { isIsoDay } from "../brains/understanding-parser";

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
  input: { title: string; subjectName: string | null; date: string },
  now = new Date(),
): Promise<AddExamResult> {
  const title = input.title.trim().slice(0, 80);
  if (!title) return { status: "invalid", reason: "no_title" };
  if (!isIsoDay(input.date)) return { status: "invalid", reason: "bad_date" };

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { novaAcademicProfile: { select: { id: true, timezone: true, subjects: { select: { id: true, name: true, code: true } } } } },
  });
  const profile = user?.novaAcademicProfile;
  if (!profile) return { status: "not_ready" };

  const today = dayKey(now, resolveTimezone(profile.timezone));
  if (input.date < today) return { status: "invalid", reason: "in_the_past" };
  const at = examInstant(input.date);
  if (at.getTime() - now.getTime() > EXAM_HORIZON_DAYS * DAY_MS) return { status: "invalid", reason: "too_far" };

  const wanted  = (input.subjectName ?? title).trim().toLowerCase();
  const subject = profile.subjects.find(s => s.name.toLowerCase() === wanted || (s.code ?? "").toLowerCase() === wanted) ?? null;

  // The same exam, said twice or already known from setup: same subject (or
  // the same title when there is no subject) within a day of that date.
  const near = await prisma.novaExam.findMany({
    where:  { profileId: profile.id, scheduledAt: { gte: new Date(at.getTime() - DAY_MS), lte: new Date(at.getTime() + DAY_MS) } },
    select: { title: true, subjectId: true },
  });
  const duplicate = near.some(e => subject ? e.subjectId === subject.id : e.title.trim().toLowerCase() === title.toLowerCase());
  if (duplicate) return { status: "exists", title, date: input.date };

  await prisma.novaExam.create({
    data: { profileId: profile.id, subjectId: subject?.id ?? null, title, examType: "exam", scheduledAt: at },
  });
  return { status: "added", title, date: input.date };
}

// Whether an exam on (about) that day is already on record, so Nova does not
// ask to add what it already has.
export function examAlreadyKnown(
  upcoming: Array<{ title: string; subjectName?: string | null; scheduledAt: Date }>,
  exam:     { title: string; date: string },
): boolean {
  if (!isIsoDay(exam.date)) return true;
  const at   = examInstant(exam.date).getTime();
  const name = exam.title.trim().toLowerCase();
  return upcoming.some(e => {
    if (Math.abs(e.scheduledAt.getTime() - at) > 1.5 * DAY_MS) return false;
    const names = [e.title, e.subjectName ?? ""].map(n => n.trim().toLowerCase()).filter(Boolean);
    return names.some(n => n.includes(name) || name.includes(n));
  });
}
