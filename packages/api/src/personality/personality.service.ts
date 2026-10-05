// ─── Personality signal: persistence ──────────────────────────────────────────
// Three things are stored, and kept apart:
//   • PersonalityAssessment.responses  raw answers, exactly as given
//   • PersonalityAssessment.scores     the derived signal
//   • UserProfile.mentorMatch          how the mentor was chosen
// The assignment itself stays where it always was: UserProfile.primaryPersona.
//
// Every assessment is a new row, so re-running never rewrites history. The
// newest complete row is the current signal.

import { prisma } from "@repo/db/client";
import { SIGNAL_VERSION } from "./signal-items";
import {
  describeOperatingStyle,
  parseStoredSignal,
  scoreSignal,
  validateSignalAnswers,
  type PersonalitySignal,
  type SignalAnswers,
} from "./signal-scoring";
import { matchMentor, type MentorMatch } from "./mentor-compatibility";

// The slice of Prisma this module uses. Declared here so tests can pass a fake.
export interface PersonalityDb {
  personalityAssessment: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: Record<string, unknown>): Promise<{ scores: unknown } | null>;
  };
  userProfile: {
    findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
}

const defaultDb = prisma as unknown as PersonalityDb;

// How an assignment came about.
//   engine                  the compatibility engine chose it from the user's answers
//   domain_missing_default  no domain was given, so the general default was assigned
//   legacy_client_persona   an older client named the persona itself; the engine
//                           had no domain to work from and did not choose anything
//   predates_matching       assigned before this feature existed
export type MatchResolution =
  | "engine"
  | "domain_missing_default"
  | "legacy_client_persona"
  | "predates_matching";

// What UserProfile.mentorMatch holds.
export interface StoredMentorMatch {
  resolution:       MatchResolution;
  // The mentor actually assigned (mirrors UserProfile.primaryPersona at that time).
  assignedMentorId: string | null;
  assignedAt:       string | null;
  // The match that produced the assignment. null whenever the engine did not
  // choose it (legacy_client_persona, predates_matching), so a match is never
  // stored that names a mentor other than the one assigned.
  match:            MentorMatch | null;
  // The newest re-run. Recorded for inspection; it never changes the assignment.
  // match is null when the profile has no domain to match against.
  reassessment:     { at: string; match: MentorMatch | null } | null;
}

// Prompt context is off unless this is exactly "true". Read at call time, like
// the other feature flags.
export function isPersonalitySignalEnabled(): boolean {
  return process.env.PERSONALITY_SIGNAL_ENABLED === "true";
}

export async function saveAssessment(
  userId:  string,
  answers: SignalAnswers,
  signal:  PersonalitySignal,
  now:     Date = new Date(),
  db:      PersonalityDb = defaultDb,
): Promise<void> {
  await db.personalityAssessment.create({
    data: {
      userId,
      instrumentVersion: SIGNAL_VERSION,
      status:            "complete",
      responses:         answers,
      scores:            signal,
      completedAt:       now,
    },
  });
}

export async function getLatestSignal(
  userId: string,
  db:     PersonalityDb = defaultDb,
): Promise<PersonalitySignal | null> {
  const row = await db.personalityAssessment.findFirst({
    where:   { userId, status: "complete" },
    orderBy: { createdAt: "desc" },
    select:  { scores: true },
  });
  return parseStoredSignal(row?.scores);
}

// Telegram-side lookup. MessengerUser has no foreign key to User; the link is
// UserProfile.telegramChatId. Users who never did web onboarding have no signal.
export async function getSignalForChat(
  platformChatId: string,
  db:             PersonalityDb = defaultDb,
): Promise<PersonalitySignal | null> {
  const profile = await db.userProfile.findFirst({
    where:  { telegramChatId: platformChatId },
    select: { userId: true },
  });
  const userId = profile?.userId;
  if (typeof userId !== "string") return null;
  return getLatestSignal(userId, db);
}

// The only thing prompt builders should call. Never throws: a missing table,
// a missing profile or a disabled flag all mean "no extra context".
export async function getOperatingStyleForChat(
  platformChatId: string,
  db:             PersonalityDb = defaultDb,
): Promise<string[]> {
  if (!isPersonalitySignalEnabled()) return [];
  try {
    return describeOperatingStyle(await getSignalForChat(platformChatId, db));
  } catch (error) {
    console.error("[personality] operating style lookup failed:", error);
    return [];
  }
}

// Called once web onboarding has saved the profile. Stores the assessment (when
// the user answered the four statements) and how the mentor was chosen.
export async function recordOnboardingMatch(
  input: {
    userId:           string;
    answers:          SignalAnswers | null;
    signal:           PersonalitySignal | null;
    resolution:       Exclude<MatchResolution, "predates_matching">;
    // Required unless resolution is legacy_client_persona, where it must be null.
    match:            MentorMatch | null;
    assignedMentorId: string;
  },
  now:   Date = new Date(),
  db:    PersonalityDb = defaultDb,
): Promise<void> {
  if (input.answers && input.signal) {
    await saveAssessment(input.userId, input.answers, input.signal, now, db);
  }
  // Only keep a match that actually produced this assignment.
  const match = input.resolution !== "legacy_client_persona" && input.match?.mentorId === input.assignedMentorId
    ? input.match
    : null;
  const stored: StoredMentorMatch = {
    resolution:       input.resolution,
    assignedMentorId: input.assignedMentorId,
    assignedAt:       now.toISOString(),
    match,
    reassessment:     null,
  };
  await db.userProfile.update({ where: { userId: input.userId }, data: { mentorMatch: stored } });
}

export type ReassessResult =
  | { ok: false; errors: string[] }
  | {
      ok:            true;
      signal:        PersonalitySignal;
      // null when there is no onboarding profile, or it has no domain, to match against.
      match:         MentorMatch | null;
      // The mentor the user keeps. A re-run never changes it.
      assignedMentor: string | null;
    };

// Re-running the four statements. Adds a new assessment row and records what
// the engine would recommend now. It does NOT change the assigned mentor:
// switching mentors is a product decision, not a side effect of a new score.
export async function reassess(
  userId:     string,
  rawAnswers: unknown,
  now:        Date = new Date(),
  db:         PersonalityDb = defaultDb,
): Promise<ReassessResult> {
  const validation = validateSignalAnswers(rawAnswers);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const signal = scoreSignal(validation.answers);
  await saveAssessment(userId, validation.answers, signal, now, db);

  const profile = await db.userProfile.findUnique({
    where:  { userId },
    select: { primaryPersona: true, mentorDomain: true, accountabilityStyle: true, goalCategory: true, mentorMatch: true },
  });
  if (!profile) return { ok: true, signal, match: null, assignedMentor: null };

  const assignedMentor = typeof profile.primaryPersona === "string" ? profile.primaryPersona : null;
  // Without a domain the engine would have to assume one, and would then
  // "recommend" a mentor on a guess. Record that nothing could be matched.
  const domain = typeof profile.mentorDomain === "string" && profile.mentorDomain.trim() ? profile.mentorDomain : null;
  const match = domain
    ? matchMentor({
        domain,
        accountabilityStyle: profile.accountabilityStyle as string | null,
        goalCategory:        profile.goalCategory as string | null,
        signal,
        currentMentor:       assignedMentor,
      })
    : null;

  const previous = (profile.mentorMatch ?? null) as Partial<StoredMentorMatch> | null;
  const stored: StoredMentorMatch = {
    resolution:       previous?.resolution ?? "predates_matching",
    assignedMentorId: assignedMentor ?? previous?.assignedMentorId ?? null,
    assignedAt:       previous?.assignedAt ?? null,
    match:            previous?.match ?? null,
    reassessment:     { at: now.toISOString(), match },
  };
  await db.userProfile.update({ where: { userId }, data: { mentorMatch: stored } });

  return { ok: true, signal, match, assignedMentor };
}
