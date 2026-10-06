// ─── Exams: adding one after onboarding ───────────────────────────────────────
// A domain-owned write, like a session command: the learner confirms an exam
// (a button, after Nova read one out of a message and asked) and it is added.
// It is never written on a model's reading alone, and it is not memory: an
// exam is an academic record the Planning and Exam engines already read.
// No LLM call.

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { isIsoDay } from "../brains/understanding-parser";
import { subjectsNamedIn } from "../engines/topic-mastery-engine";

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
    data: { profileId: profile.id, subjectId: subject?.id ?? null, title, examType: "exam", scheduledAt: at },
  });
  return { status: "added", title, date: input.date };
}

// What Nova may offer to add when a message names an exam and its day.
// Only an exam for one of the learner's own subjects is offered, and only
// when that subject has no exam on (about) that day already. An exam that
// names no subject ("exam is tomorrow") is never offered: the learner's
// existing exam for that day is almost certainly the one they mean, and an
// exam with no subject cannot be planned for.
export function examToOffer(
  exam:     { title: string; date: string },
  subjects: Array<{ id: string; name: string; code?: string | null }>,
  upcoming: Array<{ subjectId: string | null; scheduledAt: Date }>,
): { title: string; subjectName: string; date: string } | null {
  if (!isIsoDay(exam.date)) return null;
  const named = subjectsNamedIn(exam.title, subjects);
  if (named.length !== 1) return null;
  const subject = named[0]!;
  const at = examInstant(exam.date).getTime();
  const known = upcoming.some(e => e.subjectId === subject.id && Math.abs(e.scheduledAt.getTime() - at) <= 1.5 * DAY_MS);
  return known ? null : { title: exam.title.trim().slice(0, 80), subjectName: subject.name, date: exam.date };
}
