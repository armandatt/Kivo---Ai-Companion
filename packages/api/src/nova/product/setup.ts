// ─── Study setup ──────────────────────────────────────────────────────────────
// The one place the learner's study setup is read and written after
// onboarding: what each subject covers, and how they usually study. Telegram
// and the web app both call it, for the same learner, so there is one setup.
//
// Nothing is saved from a sentence. A statement becomes a proposal
// (proposeSetup, pure), the proposal is shown back, and applySetup runs only
// when the learner confirms it. The learner is whoever the chat key resolves
// to; a subject is looked up among that learner's own.
// No LLM call.

import { prisma } from "@repo/db/client";
import { declareTopics, subjectsNamedIn } from "../engines/topic-mastery-engine";
import type { SetupFacts } from "../interaction/initialization";
import { STUDY_TIMES, type SetupStatement, type StudyTime } from "../types/understanding.types";
import { learnerKey } from "./learner-key";

export const SETUP_SUBJECT_CHOICES = 4;

export interface SetupProposal {
  // The subject the topics are for. More than one: the learner picks.
  subjectChoices: string[];
  topics:         string[];
  dailyMinutes:   number | null;
  studyTime:      StudyTime | null;
}

export interface SetupChange {
  subjectName:  string | null;
  topics:       string[];
  dailyMinutes: number | null;
  studyTime:    StudyTime | null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// What could be saved from what was said. Topics need a subject of the
// learner's own: the one they named, their only one, or one they pick. A
// name that is itself one of their subjects is not a topic.
export function proposeSetup(
  stated:   SetupStatement,
  subjects: Array<{ name: string; code?: string | null }>,
): SetupProposal | null {
  const topics = stated.topics.filter(t => !subjects.some(s => same(s.name, t) || (s.code ? same(s.code, t) : false)));
  let subjectChoices: string[] = [];
  if (topics.length > 0 && subjects.length > 0) {
    const named = stated.subject
      ? subjects.filter(s => same(s.name, stated.subject!) || (s.code ? same(s.code, stated.subject!) : false))
      : [];
    const hinted = named.length > 0 ? named : stated.subject ? subjectsNamedIn(stated.subject, subjects) : [];
    subjectChoices = hinted.length === 1 ? [hinted[0]!.name]
      : subjects.length === 1 ? [subjects[0]!.name]
      : subjects.slice(0, SETUP_SUBJECT_CHOICES).map(s => s.name);
  }
  const keptTopics = subjectChoices.length > 0 ? topics : [];
  if (keptTopics.length === 0 && stated.dailyMinutes === null && stated.studyTime === null) return null;
  return { subjectChoices, topics: keptTopics, dailyMinutes: stated.dailyMinutes, studyTime: stated.studyTime };
}

export type ApplySetupResult =
  | { status: "saved"; subjectName: string | null; added: string[]; existing: string[]; dailyMinutes: number | null; studyTime: StudyTime | null }
  | { status: "not_ready" }          // no Nova learner behind this key, or onboarding unfinished
  | { status: "unknown_subject" };   // the subject is not one of this learner's

export async function applySetup(platformChatId: string, change: SetupChange): Promise<ApplySetupResult> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true, subjects: { select: { id: true, name: true } } } } },
  });
  const profile = user?.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "not_ready" };

  const subject = change.topics.length > 0
    ? profile.subjects.find(s => change.subjectName !== null && same(s.name, change.subjectName)) ?? null
    : null;
  if (change.topics.length > 0 && !subject) return { status: "unknown_subject" };

  const studyTime    = STUDY_TIMES.find(t => t === change.studyTime) ?? null;
  const dailyMinutes = typeof change.dailyMinutes === "number" && change.dailyMinutes >= 10 && change.dailyMinutes <= 16 * 60
    ? Math.round(change.dailyMinutes) : null;

  // Saving twice saves once: a topic the subject already has is left as it is.
  const topics = await prisma.$transaction(async tx => {
    const declared = subject ? await declareTopics(tx, subject.id, change.topics) : { added: [], existing: [] };
    if (dailyMinutes !== null || studyTime !== null) {
      await tx.novaAcademicProfile.update({
        where: { id: profile.id },
        data:  {
          ...(dailyMinutes !== null ? { preferredStudyHoursPerDay: Math.round((dailyMinutes / 60) * 100) / 100 } : {}),
          ...(studyTime !== null ? { preferredStudyTime: studyTime } : {}),
        },
      });
    }
    return declared;
  });
  return { status: "saved", subjectName: subject?.name ?? null, ...topics, dailyMinutes, studyTime };
}

// What is on record, for deciding what (if anything) to ask for next.
export async function loadSetupFacts(platformChatId: string, now = new Date()): Promise<SetupFacts | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: {
      novaAcademicProfile: {
        select: {
          preferredStudyTime: true,
          subjects: { select: { name: true, _count: { select: { topics: true } } }, orderBy: { createdAt: "asc" } },
          _count:   { select: { exams: { where: { scheduledAt: { gte: now } } } } },
        },
      },
    },
  });
  const profile = user?.novaAcademicProfile;
  if (!profile) return null;
  return {
    subjects:      profile.subjects.map(s => ({ name: s.name, topicCount: s._count.topics })),
    upcomingExams: profile._count.exams,
    studyTime:     profile.preferredStudyTime,
  };
}
