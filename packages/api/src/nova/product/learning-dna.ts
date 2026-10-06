// ─── Learning DNA view builder ────────────────────────────────────────────────
// Lays out what the Learning DNA engine concluded for the page: a label and
// a section for each signal, and whether the belief is moving. It concludes
// nothing itself. Read-only, no LLM call.

import { prisma } from "@repo/db/client";
import { currentZoneName, isValidTimezone } from "../engines/learner-calendar";
import {
  DNA_EMERGING_AT, DNA_EVIDENCE_DAYS, DNA_LEAD, DNA_MIN_PER_SIDE, DNA_STRONG_AT, DNA_SUPPORTED_AT,
  trendOf,
  type DnaMemoryMap, type DnaSignal, type DnaSignalKey,
} from "../engines/learning-dna-engine";
import { loadLearningDna } from "../persistence/learning-dna-store";
import type { DnaSection, DnaSignalView, NovaLearningDnaReady, NovaLearningDnaView, TimezoneResponse } from "./learning-dna.types";

const PLACE: Record<DnaSignalKey, { section: DnaSection; label: string }> = {
  typical_session:      { section: "rhythm",    label: "Typical session" },
  plan_follow_through:  { section: "rhythm",    label: "Planned length" },
  days_per_week:        { section: "rhythm",    label: "Weekly rhythm" },
  usual_study_window:   { section: "rhythm",    label: "Usual study time" },
  best_session_size:    { section: "works",     label: "Session length that goes best" },
  best_study_window:    { section: "works",     label: "Time of day that goes best" },
  revision_spacing:     { section: "works",     label: "Gap before coming back to a topic" },
  needs_more_retrieval: { section: "struggles", label: "Topics that need more retrieval" },
};

// Dimensions of Learning DNA that nothing on record can support today.
export const NOT_TRACKED: NovaLearningDnaReady["notTracked"] = [
  { label: "Distraction triggers", reason: "Nova records no distraction events. Pauses and short sessions are not evidence of distraction." },
  { label: "Burnout threshold",    reason: "Nothing Nova records can support a claim about burnout, so it makes none." },
  { label: "Preferred formats",    reason: "Nova doesn't know whether a session was reading, video or practice." },
  { label: "Focus and energy",     reason: "Nova has no real measure of either during a session." },
];

export function buildLearningDnaView(input: {
  signals:  DnaSignal[];
  memory:   DnaMemoryMap;
  sessionsConsidered: number;
  answeredSessions:   number;
  timezone: string | null;
  statedStudyTime: string | null;
  now:      Date;
}): NovaLearningDnaReady {
  const signals: DnaSignalView[] = input.signals.map(s => {
    const memory = input.memory[s.key];
    const held   = memory && memory.valueKey === s.valueKey && s.valueKey !== null ? memory : null;
    const { trend, note } = trendOf(s, memory, input.now);
    return {
      key: s.key, ...PLACE[s.key],
      level: s.level, headline: s.valueLabel, value: s.value,
      evidenceCount: s.evidenceCount, evidenceUnit: s.evidenceUnit,
      lastUpdated: s.lastEvidenceAt?.toISOString() ?? null,
      trend, trendNote: note,
      explanation: s.explanation,
      heldSince: held?.since ?? null,
      previous:  held?.previous ?? null,
    };
  });

  return {
    status:      "ready",
    generatedAt: input.now.toISOString(),
    sessionsConsidered: input.sessionsConsidered,
    answeredSessions:   input.answeredSessions,
    windowDays:  DNA_EVIDENCE_DAYS,
    timezone:    input.timezone,
    statedStudyTime: input.statedStudyTime,
    signals,
    changing:    signals.filter(s => s.trend !== null && s.trend !== "steady").map(s => s.key),
    notTracked:  NOT_TRACKED,
    thresholds:  { emerging: DNA_EMERGING_AT, supported: DNA_SUPPORTED_AT, strong: DNA_STRONG_AT, perSide: DNA_MIN_PER_SIDE, leadPoints: DNA_LEAD * 100 },
  };
}

type Learner =
  | { status: "ready"; profileId: string; timezone: string | null; statedStudyTime: string | null }
  | { status: "not_connected" | "onboarding_incomplete" };

async function resolveLearner(platformChatId: string): Promise<Learner> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true, timezone: true, preferredStudyTime: true } } },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };
  return { status: "ready", profileId: profile.id, timezone: profile.timezone, statedStudyTime: profile.preferredStudyTime };
}

export async function loadNovaLearningDna(
  platformChatId: string,
  options: { now?: Date } = {},
): Promise<NovaLearningDnaView> {
  const now = options.now ?? new Date();
  const learner = await resolveLearner(platformChatId);
  if (learner.status !== "ready") return learner;

  const loaded = await loadLearningDna(learner.profileId, now);
  if (!loaded) return { status: "onboarding_incomplete" };

  return buildLearningDnaView({
    signals: loaded.signals,
    memory:  loaded.memory,
    sessionsConsidered: loaded.evidence.sessions.length,
    answeredSessions:   loaded.evidence.sessions.filter(s => s.outcome !== null).length,
    timezone: loaded.evidence.timezone,
    statedStudyTime: learner.statedStudyTime,
    now,
  });
}

// ── Timezone ──────────────────────────────────────────────────────────────────
// Nova's setup conversation never asks for a timezone, so the learner's own
// device reports it once. It is stored only while none is stored: a later
// request, from any device, cannot move the learner's days. Whose profile it
// is comes from the session, never from the request.

export async function recordLearnerTimezone(platformChatId: string, raw: unknown): Promise<TimezoneResponse> {
  // The runtime's own zone database is the judge of what a timezone is.
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64 || !isValidTimezone(raw)) {
    return { ok: false, error: "invalid_timezone" };
  }
  const learner = await resolveLearner(platformChatId);
  if (learner.status !== "ready") return { ok: false, error: learner.status };
  if (learner.timezone && isValidTimezone(learner.timezone)) return { ok: true, timezone: learner.timezone, changed: false };

  // Conditional on still being unset (or unusable): two tabs agree on one value.
  const zone = currentZoneName(raw);
  await prisma.novaAcademicProfile.updateMany({
    where: { id: learner.profileId, OR: [{ timezone: null }, { timezone: learner.timezone }] },
    data:  { timezone: zone },
  });
  const stored = await prisma.novaAcademicProfile.findUnique({ where: { id: learner.profileId }, select: { timezone: true } });
  return { ok: true, timezone: stored?.timezone ?? zone, changed: stored?.timezone === zone };
}
