// ─── The learner changing their own timezone ──────────────────────────────────
// A device reporting where it is never moves a timezone that is on record
// (product/learning-dna.ts, recordLearnerTimezone): a second device, or one
// on holiday, would keep moving the learner's days. The learner saying which
// zone they are in is different. That is their choice, made in Settings, and
// it is the one thing that replaces the zone Nova has.
//
// Whose profile it is comes from the session, never from the request.

import { prisma } from "@repo/db/client";
import { currentZoneName, isValidTimezone } from "../engines/learner-calendar";
import { learnerKey } from "./learner-key";
import type { TimezoneResponse } from "./learning-dna.types";

export async function changeLearnerTimezone(platformChatId: string, raw: unknown): Promise<TimezoneResponse> {
  // The runtime's own zone database is the judge of what a timezone is.
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64 || !isValidTimezone(raw)) {
    return { ok: false, error: "invalid_timezone" };
  }
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { persona: true, novaAcademicProfile: { select: { id: true, timezone: true, onboardingComplete: true } } },
  });
  if (!user) return { ok: false, error: "not_connected" };
  if (user.persona !== "nova") return { ok: false, error: "not_nova" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { ok: false, error: "onboarding_incomplete" };

  const zone = currentZoneName(raw);
  if (zone === profile.timezone) return { ok: true, timezone: zone, changed: false };
  await prisma.novaAcademicProfile.update({ where: { id: profile.id }, data: { timezone: zone } });
  return { ok: true, timezone: zone, changed: true };
}
