// ─── Nova Onboarding Persistence ──────────────────────────────────────────────
// Writes validated onboarding extractions to the structured DB tables.
// Called after every onboarding turn (fire-in-sequence, not fire-and-forget —
// the next reply may depend on the written state).
// Owner: Persistence layer. No LLM calls.

import { prisma } from "@repo/db/client";
import { writeRealityFact } from "../adapters/reality-adapter.js";
import type { ValidatedExtraction } from "./nova-onboarding-validator.js";

// ─── Main write function ──────────────────────────────────────────────────────

export async function persistOnboardingExtraction(
  userId:           string,
  validated:        ValidatedExtraction,
  isCompleteEnough: boolean,
): Promise<string> {
  // 1. Upsert NovaAcademicProfile (create on first extraction, update on subsequent)
  const profileUpdate: Record<string, unknown> = {};
  if (validated.institution)              profileUpdate["institution"]              = validated.institution;
  if (validated.degree)                   profileUpdate["degree"]                   = validated.degree;
  if (validated.major)                    profileUpdate["major"]                    = validated.major;
  if (validated.yearOfStudy)              profileUpdate["yearOfStudy"]              = validated.yearOfStudy;
  if (validated.targetGpa)               profileUpdate["targetGpa"]               = validated.targetGpa;
  if (validated.preferredStudyHoursPerDay) profileUpdate["preferredStudyHoursPerDay"] = validated.preferredStudyHoursPerDay;
  if (validated.preferredStudyTime)       profileUpdate["preferredStudyTime"]       = validated.preferredStudyTime;
  if (validated.studyStyle)               profileUpdate["studyStyleNotes"]          = validated.studyStyle;
  if (validated.biggestStruggle)          profileUpdate["biggestStruggle"]          = validated.biggestStruggle;
  if (validated.goals.length)             profileUpdate["goals"]                    = { set: validated.goals };
  if (isCompleteEnough) {
    profileUpdate["onboardingStep"]     = "in_progress";
    profileUpdate["onboardingComplete"] = true;
  } else {
    profileUpdate["onboardingStep"]     = "in_progress";
  }

  const profile = await prisma.novaAcademicProfile.upsert({
    where:  { userId },
    update: profileUpdate as Parameters<typeof prisma.novaAcademicProfile.update>[0]["data"],
    create: {
      userId,
      ...(validated.institution && { institution: validated.institution }),
      ...(validated.degree      && { degree:      validated.degree }),
      ...(validated.major       && { major:        validated.major }),
      ...(validated.yearOfStudy && { yearOfStudy:  validated.yearOfStudy }),
      ...(validated.targetGpa   && { targetGpa:    validated.targetGpa }),
      ...(validated.preferredStudyHoursPerDay && { preferredStudyHoursPerDay: validated.preferredStudyHoursPerDay }),
      ...(validated.preferredStudyTime  && { preferredStudyTime:  validated.preferredStudyTime }),
      ...(validated.studyStyle          && { studyStyleNotes:      validated.studyStyle }),
      ...(validated.biggestStruggle     && { biggestStruggle:      validated.biggestStruggle }),
      goals:              validated.goals,
      onboardingStep:     "in_progress",
      onboardingComplete: isCompleteEnough,
    },
  });

  const profileId = profile.id;

  // 2. Upsert subjects (one per name — unique on profileId + name)
  await Promise.allSettled(
    validated.subjects.map(s =>
      prisma.novaSubject.upsert({
        where:  { profileId_name: { profileId, name: s.name } },
        update: {
          ...(s.code    && { code:    s.code }),
          ...(s.credits && { credits: s.credits }),
          ...(s.type    && { subjectType: s.type }),
          isWeak:   s.isWeak,
          isStrong: s.isStrong,
        },
        create: {
          profileId,
          name:        s.name,
          code:        s.code,
          credits:     s.credits,
          subjectType: s.type,
          isWeak:      s.isWeak,
          isStrong:    s.isStrong,
        },
      })
    )
  );

  // 3. Write exams (create only — no upsert logic: exams are additive)
  // Skip if no scheduled date and no subject link — too sparse to be useful.
  const examWrites = validated.exams.filter(e => e.title && (e.scheduledAt || e.subjectName));
  if (examWrites.length > 0) {
    // Resolve subject IDs where possible
    const subjectNames = examWrites
      .map(e => e.subjectName)
      .filter((n): n is string => n !== null);

    const subjects = subjectNames.length > 0
      ? await prisma.novaSubject.findMany({
          where: { profileId, name: { in: subjectNames } },
          select: { id: true, name: true },
        })
      : [];

    const subjectIdByName = Object.fromEntries(subjects.map(s => [s.name, s.id]));

    await Promise.allSettled(
      examWrites.map(e => {
        const scheduledAt = parseRelativeDate(e.scheduledAt);
        if (!scheduledAt) return Promise.resolve(); // can't create exam without a date

        return prisma.novaExam.create({
          data: {
            profileId,
            title:      e.title,
            examType:   e.examType,
            scheduledAt,
            subjectId:  e.subjectName ? subjectIdByName[e.subjectName] ?? null : null,
          },
        });
      })
    );
  }

  // 4. Write reality facts (academic constraints, work, health)
  if (validated.realityFacts.length > 0) {
    await Promise.allSettled(
      validated.realityFacts.map(rf =>
        writeRealityFact(
          userId,
          mapRealityCategory(rf.category),
          rf.description,
          rf.description,
          0.85,
          180, // 180-day TTL — reality facts are semi-permanent
        )
      )
    );
  }

  return profileId;
}

// ── Load current onboarding state from DB ─────────────────────────────────────

export async function loadOnboardingState(userId: string): Promise<{
  profileId:                string | null;
  institution:              string | null;
  degree:                   string | null;
  major:                    string | null;
  yearOfStudy:              number | null;
  targetGpa:                number | null;
  goals:                    string[];
  subjectCount:             number;
  subjectNames:             string[];
  hasExams:                 boolean;
  preferredStudyHoursPerDay: number | null;
  preferredStudyTime:       string | null;
  biggestStruggle:          string | null;
  onboardingComplete:       boolean;
}> {
  const profile = await prisma.novaAcademicProfile.findUnique({
    where:  { userId },
    select: {
      id:                        true,
      institution:               true,
      degree:                    true,
      major:                     true,
      yearOfStudy:               true,
      targetGpa:                 true,
      goals:                     true,
      preferredStudyHoursPerDay: true,
      preferredStudyTime:        true,
      biggestStruggle:           true,
      onboardingComplete:        true,
      subjects:  { select: { name: true } },
      _count:    { select: { exams: true } },
    },
  });

  if (!profile) {
    return {
      profileId:                 null,
      institution:               null,
      degree:                    null,
      major:                     null,
      yearOfStudy:               null,
      targetGpa:                 null,
      goals:                     [],
      subjectCount:              0,
      subjectNames:              [],
      hasExams:                  false,
      preferredStudyHoursPerDay: null,
      preferredStudyTime:        null,
      biggestStruggle:           null,
      onboardingComplete:        false,
    };
  }

  return {
    profileId:                 profile.id,
    institution:               profile.institution,
    degree:                    profile.degree,
    major:                     profile.major,
    yearOfStudy:               profile.yearOfStudy,
    targetGpa:                 profile.targetGpa,
    goals:                     profile.goals,
    subjectCount:              profile.subjects.length,
    subjectNames:              profile.subjects.map(s => s.name),
    hasExams:                  profile._count.exams > 0,
    preferredStudyHoursPerDay: profile.preferredStudyHoursPerDay === 3.0 ? null : profile.preferredStudyHoursPerDay,
    preferredStudyTime:        profile.preferredStudyTime,
    biggestStruggle:           profile.biggestStruggle,
    onboardingComplete:        profile.onboardingComplete,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapRealityCategory(raw: string): import("../types/reality.types.js").RealityCategory {
  const map: Record<string, import("../types/reality.types.js").RealityCategory> = {
    time_constraint:     "time_constraint",
    work_constraint:     "work_constraint",
    health_constraint:   "health_constraint",
    academic_constraint: "academic_constraint",
    other:               "other",
  };
  return map[raw] ?? "other";
}

function parseRelativeDate(raw: string | null): Date | null {
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const now   = new Date();

  // "in N weeks" / "N weeks"
  const weekMatch = lower.match(/in\s*(\d+)\s*week/);
  if (weekMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(weekMatch[1]!, 10) * 7);
    return d;
  }

  // "in N days" / "N days"
  const dayMatch = lower.match(/in\s*(\d+)\s*day/);
  if (dayMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(dayMatch[1]!, 10));
    return d;
  }

  // "next month"
  if (lower.includes("next month")) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d;
  }

  // Named months: "december", "january", etc.
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  for (let i = 0; i < MONTHS.length; i++) {
    if (lower.includes(MONTHS[i]!)) {
      const targetMonth = i;
      const year = now.getMonth() <= targetMonth ? now.getFullYear() : now.getFullYear() + 1;
      return new Date(year, targetMonth, 15); // mid-month estimate
    }
  }

  // ISO date string passthrough
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}
