// ─── Study Snapshot ───────────────────────────────────────────────────────────
// Parallel DB loader. Loads all academic data for one orchestrator turn.
// SKILL.md §1.5 — everything needed for the current response must already
// exist in the database from a previous turn.
// Owner: Study Snapshot. No LLM calls. Pure DB reads.

import { prisma } from "@repo/db/client";
import type { AcademicStateSnapshot } from "../types/academic-state.types";
import { pausedSecondsOf } from "./session-clock";

export interface ActiveSessionInfo {
  id:                     string;
  startedAt:              Date;
  topicName:              string | null;
  subjectId:              string | null;
  subjectName:            string | null;
  status:                 string;    // "in_progress" | "paused"
  currentFocus:           string | null;
  plannedDurationMinutes: number;
  confusionPoints:        string[];
  topicsCompleted:        string[];
  pauseCount:             number;
  totalPausedMinutes:     number;
  totalPausedSeconds:     number;    // exact time spent in finished pauses
  pausedAt:               Date | null;
  energyLevel:            string | null;
}

export interface StudySnapshotResult {
  // Profile
  profileId:                string | null;
  yearOfStudy:              number | null;
  major:                    string | null;
  institution:              string | null;
  semesterStartDate:        Date | null;
  semesterEndDate:          Date | null;
  preferredStudyHoursPerDay: number;
  daysSinceJoined:          number;

  // Active session (in_progress, if any)
  activeSession:            ActiveSessionInfo | null;

  // Subjects
  subjects: Array<{
    id:   string;
    name: string;
    code: string | null;
  }>;

  // Recent study sessions (last 90 days)
  studySessions: Array<{
    id:              string;
    sessionDate:     Date;
    status:          string;
    durationMinutes: number;
    topicId:         string | null;
    topicName:       string | null;
  }>;

  // Upcoming exams
  upcomingExams: Array<{
    id:          string;
    title:       string;
    examType:    string;
    scheduledAt: Date;
    subjectId:   string | null;
    subjectName: string | null;
  }>;

  // Prior state
  storedScores:            import("../types/academic-state.types").AcademicScores | null;
  storedStreakDays:        number;
  storedConsecutiveMisses: number;
  stateHistory:            AcademicStateSnapshot[];

  // Cognitive state
  cognitiveState: {
    investigationTopic:       string | null;
    investigationHypotheses:  string[];
    investigationMissingData: string[];
    investigationEvidence:    Record<string, string> | null;
    investigationAttempts:    number;
    investigationStatus:      string | null;
    investigationStartedAt:   Date | null;
    investigationUpdatedAt:   Date | null;
    followUpChecks:           unknown;
    reasoningHistory:         unknown;
    stateHistory:             unknown;
  } | null;

  // Learning DNA
  learningDNA: {
    optimalSessionMinutes:      number | null;
    preferredReviewStyle:       string | null;
    planAdherenceProfile:       string | null;
    dataPointCount:             number;
    confidence:                 string;
    overconfidentSubjects:      string[];
    underconfidentSubjects:     string[];
    peakStudyHours:             string[];
  } | null;
}

export async function loadStudySnapshot(platformChatId: string): Promise<StudySnapshotResult> {
  const now          = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);

  // Resolve MessengerUser
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, createdAt: true, novaAcademicProfile: {
      select: {
        id: true, yearOfStudy: true, major: true, institution: true,
        semesterStartDate: true, semesterEndDate: true,
        preferredStudyHoursPerDay: true,
        subjects: { select: { id: true, name: true, code: true } },
        studySessions: {
          where: { sessionDate: { gte: ninetyDaysAgo } },
          select: {
            id: true, sessionDate: true, status: true,
            durationMinutes: true, topicId: true, topicName: true,
          },
          orderBy: { sessionDate: "desc" },
        },
        exams: {
          where: { scheduledAt: { gte: now } },
          select: {
            id: true, title: true, examType: true, scheduledAt: true,
            subjectId: true, subject: { select: { name: true } },
          },
          orderBy: { scheduledAt: "asc" },
          take: 5,
        },
        cognitiveState: {
          select: {
            investigationTopic: true, investigationHypotheses: true,
            investigationMissingData: true, investigationEvidence: true,
            investigationAttempts: true, investigationStatus: true,
            investigationStartedAt: true, investigationUpdatedAt: true,
            followUpChecks: true, reasoningHistory: true, stateHistory: true,
          },
        },
        learningDNA: {
          select: {
            optimalSessionMinutes: true, preferredReviewStyle: true,
            planAdherenceProfile: true, dataPointCount: true, confidence: true,
            overconfidentSubjects: true, underconfidentSubjects: true,
            peakStudyHours: true,
          },
        },
      },
    } },
  });

  if (!user?.novaAcademicProfile) {
    const daysSinceJoined = user
      ? Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000)
      : 0;

    return {
      profileId: null, yearOfStudy: null, major: null, institution: null,
      semesterStartDate: null, semesterEndDate: null,
      preferredStudyHoursPerDay: 3.0,
      daysSinceJoined,
      activeSession: null,
      subjects: [], studySessions: [], upcomingExams: [],
      storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
      stateHistory: [], cognitiveState: null, learningDNA: null,
    };
  }

  const p = user.novaAcademicProfile;
  const daysSinceJoined = Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000);

  // Load active session separately (can't filter same relation twice in Prisma select)
  const inProgressSession = await prisma.novaStudySession.findFirst({
    where:   { profileId: p.id, status: { in: ["in_progress", "paused"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, sessionDate: true, topicName: true, subjectId: true,
      status: true, currentFocus: true, plannedDurationMinutes: true,
      confusionPoints: true, topicsCompleted: true,
      pauseCount: true, totalPausedMinutes: true, totalPausedSeconds: true, pausedAt: true,
      energyLevel: true,
    },
  });

  const activeSession: ActiveSessionInfo | null = inProgressSession
    ? {
        id:                     inProgressSession.id,
        startedAt:              inProgressSession.sessionDate,
        topicName:              inProgressSession.topicName,
        subjectId:              inProgressSession.subjectId,
        subjectName:            inProgressSession.subjectId
          ? (p.subjects.find(s => s.id === inProgressSession.subjectId)?.name ?? null)
          : null,
        status:                 inProgressSession.status,
        currentFocus:           inProgressSession.currentFocus,
        plannedDurationMinutes: inProgressSession.plannedDurationMinutes ?? 0,
        confusionPoints:        inProgressSession.confusionPoints,
        topicsCompleted:        inProgressSession.topicsCompleted,
        pauseCount:             inProgressSession.pauseCount,
        totalPausedMinutes:     inProgressSession.totalPausedMinutes,
        totalPausedSeconds:     pausedSecondsOf(inProgressSession),
        pausedAt:               inProgressSession.pausedAt,
        energyLevel:            inProgressSession.energyLevel,
      }
    : null;

  // Parse stored state from cognitiveState.stateHistory
  let storedScores:            import("../types/academic-state.types").AcademicScores | null = null;
  let storedStreakDays         = 0;
  let storedConsecutiveMisses  = 0;
  let stateHistory:            AcademicStateSnapshot[] = [];

  if (p.cognitiveState?.stateHistory) {
    try {
      const hist = p.cognitiveState.stateHistory as unknown as AcademicStateSnapshot[];
      if (Array.isArray(hist) && hist.length > 0) {
        stateHistory  = hist.slice(-12);
        const last    = hist[hist.length - 1]!;
        storedScores  = last.scores;
      }
    } catch { /* malformed state history — start fresh */ }
  }

  return {
    profileId:                p.id,
    yearOfStudy:              p.yearOfStudy,
    major:                    p.major,
    institution:              p.institution,
    semesterStartDate:        p.semesterStartDate,
    semesterEndDate:          p.semesterEndDate,
    preferredStudyHoursPerDay: p.preferredStudyHoursPerDay,
    daysSinceJoined,
    activeSession,
    subjects:   p.subjects,
    studySessions: p.studySessions.map(s => ({
      id:              s.id,
      sessionDate:     s.sessionDate,
      status:          s.status,
      durationMinutes: s.durationMinutes,
      topicId:         s.topicId,
      topicName:       s.topicName,
    })),
    upcomingExams: p.exams.map(e => ({
      id:          e.id,
      title:       e.title,
      examType:    e.examType,
      scheduledAt: e.scheduledAt,
      subjectId:   e.subjectId,
      subjectName: e.subject?.name ?? null,
    })),
    storedScores,
    storedStreakDays,
    storedConsecutiveMisses,
    stateHistory,
    cognitiveState: p.cognitiveState ? {
      investigationTopic:       p.cognitiveState.investigationTopic,
      investigationHypotheses:  p.cognitiveState.investigationHypotheses,
      investigationMissingData: p.cognitiveState.investigationMissingData,
      investigationEvidence:    p.cognitiveState.investigationEvidence as Record<string, string> | null,
      investigationAttempts:    p.cognitiveState.investigationAttempts,
      investigationStatus:      p.cognitiveState.investigationStatus,
      investigationStartedAt:   p.cognitiveState.investigationStartedAt,
      investigationUpdatedAt:   p.cognitiveState.investigationUpdatedAt,
      followUpChecks:           p.cognitiveState.followUpChecks,
      reasoningHistory:         p.cognitiveState.reasoningHistory,
      stateHistory:             p.cognitiveState.stateHistory,
    } : null,
    learningDNA: p.learningDNA ? {
      optimalSessionMinutes:  p.learningDNA.optimalSessionMinutes,
      preferredReviewStyle:   p.learningDNA.preferredReviewStyle,
      planAdherenceProfile:   p.learningDNA.planAdherenceProfile,
      dataPointCount:         p.learningDNA.dataPointCount,
      confidence:             p.learningDNA.confidence,
      overconfidentSubjects:  p.learningDNA.overconfidentSubjects,
      underconfidentSubjects: p.learningDNA.underconfidentSubjects,
      peakStudyHours:         p.learningDNA.peakStudyHours,
    } : null,
  };
}
