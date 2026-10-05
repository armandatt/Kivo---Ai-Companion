import {
  getLatestSignal,
  getOperatingStyleForChat,
  getSignalForChat,
  isPersonalitySignalEnabled,
  reassess,
  recordOnboardingMatch,
  type PersonalityDb,
  type StoredMentorMatch,
} from "../personality.service";
import { matchMentor } from "../mentor-compatibility";
import { scoreSignal } from "../signal-scoring";

// An in-memory stand-in for the two tables this module touches.
function fakeDb(profiles: Array<Record<string, unknown>> = []) {
  const assessments: Array<Record<string, unknown>> = [];
  let clock = 0;

  const db: PersonalityDb = {
    personalityAssessment: {
      async create({ data }) {
        const row = { id: `a${assessments.length + 1}`, createdAt: clock++, ...data };
        assessments.push(row);
        return row;
      },
      async findFirst(args) {
        const where = args.where as { userId: string; status: string };
        const rows = assessments
          .filter(a => a.userId === where.userId && a.status === where.status)
          .sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
        return rows[0] ? { scores: rows[0].scores } : null;
      },
    },
    userProfile: {
      async findUnique(args) {
        const where = args.where as { userId: string };
        return profiles.find(p => p.userId === where.userId) ?? null;
      },
      async findFirst(args) {
        const where = args.where as { telegramChatId: string };
        return profiles.find(p => p.telegramChatId === where.telegramChatId) ?? null;
      },
      async update({ where, data }) {
        const profile = profiles.find(p => p.userId === where.userId);
        if (!profile) throw new Error("profile not found");
        Object.assign(profile, data);
        return profile;
      },
    },
  };
  return { db, assessments, profiles };
}

const NOW = new Date("2026-10-05T12:00:00.000Z");
const answers = { s1: 2, s2: 4, s3: 5, s4: 5 };

afterEach(() => {
  delete process.env.PERSONALITY_SIGNAL_ENABLED;
});

describe("onboarding persistence", () => {
  it("stores raw answers, the derived signal and the match in separate places", async () => {
    const { db, assessments, profiles } = fakeDb([{ userId: "u1", primaryPersona: "rex" }]);
    const signal = scoreSignal(answers);
    const match = matchMentor({ domain: "gym", accountabilityStyle: "hard", signal });

    await recordOnboardingMatch({ userId: "u1", answers, signal, resolution: "engine", match, assignedMentorId: "rex" }, NOW, db);

    expect(assessments).toHaveLength(1);
    expect(assessments[0]).toMatchObject({
      userId: "u1",
      instrumentVersion: "kivo-signal-v1",
      status: "complete",
      responses: answers,
      scores: signal,
      completedAt: NOW,
    });

    const stored = profiles[0]!.mentorMatch as StoredMentorMatch;
    expect(stored).toEqual({ resolution: "engine", assignedMentorId: "rex", assignedAt: NOW.toISOString(), match, reassessment: null });
    // The raw answers never reach the profile.
    expect(JSON.stringify(stored)).not.toContain('"s1"');
  });

  it("records the match but no assessment when the user sent no signal answers", async () => {
    const { db, assessments, profiles } = fakeDb([{ userId: "u1", primaryPersona: "zen" }]);
    const match = matchMentor({ domain: "general" });

    await recordOnboardingMatch({ userId: "u1", answers: null, signal: null, resolution: "engine", match, assignedMentorId: "zen" }, NOW, db);

    expect(assessments).toHaveLength(0);
    expect((profiles[0]!.mentorMatch as StoredMentorMatch).match!.signalVersion).toBeNull();
  });
});

describe("assignments the engine did not make", () => {
  it("stores no match when a legacy client named the persona itself", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "nova" }]);

    await recordOnboardingMatch(
      { userId: "u1", answers: null, signal: null, resolution: "legacy_client_persona", match: null, assignedMentorId: "nova" },
      NOW, db,
    );

    expect(profiles[0]!.mentorMatch).toEqual({
      resolution: "legacy_client_persona", assignedMentorId: "nova", assignedAt: NOW.toISOString(), match: null, reassessment: null,
    });
  });

  it("drops a match that names a different mentor from the one assigned", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "nova" }]);
    const zenMatch = matchMentor({ domain: null });
    expect(zenMatch.mentorId).toBe("zen");

    for (const resolution of ["legacy_client_persona", "engine", "domain_missing_default"] as const) {
      await recordOnboardingMatch(
        { userId: "u1", answers: null, signal: null, resolution, match: zenMatch, assignedMentorId: "nova" },
        NOW, db,
      );
      const stored = profiles[0]!.mentorMatch as StoredMentorMatch;
      expect(stored.assignedMentorId).toBe("nova");
      expect(stored.match).toBeNull();
      expect(JSON.stringify(stored)).not.toContain("zen");
    }
  });

  it("flags the general default when no domain was given", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "zen" }]);
    const match = matchMentor({ domain: null });
    await recordOnboardingMatch(
      { userId: "u1", answers: null, signal: null, resolution: "domain_missing_default", match, assignedMentorId: "zen" },
      NOW, db,
    );
    const stored = profiles[0]!.mentorMatch as StoredMentorMatch;
    expect(stored.resolution).toBe("domain_missing_default");
    expect(stored.match!.mentorId).toBe("zen");
  });

  it("records an unresolved re-run, not a guess, when the profile has no domain", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "nova" }]);
    await recordOnboardingMatch(
      { userId: "u1", answers: null, signal: null, resolution: "legacy_client_persona", match: null, assignedMentorId: "nova" },
      NOW, db,
    );

    const result = await reassess("u1", answers, NOW, db);

    expect(result).toMatchObject({ ok: true, match: null, assignedMentor: "nova" });
    const stored = profiles[0]!.mentorMatch as StoredMentorMatch;
    expect(stored.resolution).toBe("legacy_client_persona");
    expect(stored.reassessment).toEqual({ at: NOW.toISOString(), match: null });
    expect(JSON.stringify(stored)).not.toContain("zen");
  });
});

describe("reading the current signal", () => {
  it("returns null for a user who has never answered", async () => {
    const { db } = fakeDb();
    expect(await getLatestSignal("nobody", db)).toBeNull();
  });

  it("returns the newest complete assessment", async () => {
    const { db } = fakeDb([{ userId: "u1", primaryPersona: "rex", mentorDomain: "gym" }]);
    await reassess("u1", { s1: 1, s2: 1, s3: 1, s4: 1 }, NOW, db);
    await reassess("u1", { s1: 5, s2: 5, s3: 5, s4: 5 }, NOW, db);
    expect((await getLatestSignal("u1", db))!.scores.routine).toBe(100);
  });

  it("finds a Telegram user's signal through the linked web profile", async () => {
    const { db } = fakeDb([{ userId: "u1", telegramChatId: "555", primaryPersona: "rex", mentorDomain: "gym" }]);
    await reassess("u1", answers, NOW, db);
    expect(await getSignalForChat("555", db)).toEqual(scoreSignal(answers));
  });

  it("returns null for a Telegram user with no linked web profile", async () => {
    const { db } = fakeDb();
    expect(await getSignalForChat("999", db)).toBeNull();
  });
});

describe("prompt context flag", () => {
  it("is off unless PERSONALITY_SIGNAL_ENABLED is exactly 'true'", () => {
    expect(isPersonalitySignalEnabled()).toBe(false);
    process.env.PERSONALITY_SIGNAL_ENABLED = "1";
    expect(isPersonalitySignalEnabled()).toBe(false);
    process.env.PERSONALITY_SIGNAL_ENABLED = "true";
    expect(isPersonalitySignalEnabled()).toBe(true);
  });

  it("returns nothing, and does not query, while the flag is off", async () => {
    const db = {
      personalityAssessment: { create: jest.fn(), findFirst: jest.fn() },
      userProfile: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    expect(await getOperatingStyleForChat("555", db)).toEqual([]);
    expect(db.userProfile.findFirst).not.toHaveBeenCalled();
  });

  it("returns behavioural lines when the flag is on", async () => {
    process.env.PERSONALITY_SIGNAL_ENABLED = "true";
    const { db } = fakeDb([{ userId: "u1", telegramChatId: "555", primaryPersona: "rex", mentorDomain: "gym" }]);
    await reassess("u1", answers, NOW, db);
    const lines = await getOperatingStyleForChat("555", db);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toMatch(/external structure/);
  });

  it("returns nothing for an existing user who has no signal", async () => {
    process.env.PERSONALITY_SIGNAL_ENABLED = "true";
    const { db } = fakeDb([{ userId: "u1", telegramChatId: "555", primaryPersona: "rex" }]);
    expect(await getOperatingStyleForChat("555", db)).toEqual([]);
  });

  it("swallows a database failure instead of breaking the reply", async () => {
    process.env.PERSONALITY_SIGNAL_ENABLED = "true";
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      personalityAssessment: { create: jest.fn(), findFirst: jest.fn() },
      userProfile: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockRejectedValue(new Error("relation does not exist") as never),
        update: jest.fn(),
      },
    };
    expect(await getOperatingStyleForChat("555", db as unknown as PersonalityDb)).toEqual([]);
    error.mockRestore();
  });
});

describe("re-running the assessment", () => {
  it("rejects invalid answers and stores nothing", async () => {
    const { db, assessments } = fakeDb([{ userId: "u1", primaryPersona: "rex" }]);
    const result = await reassess("u1", { s1: 9, s2: 3 }, NOW, db);
    expect(result.ok).toBe(false);
    expect(assessments).toHaveLength(0);
  });

  it("adds a new row and leaves earlier ones untouched", async () => {
    const { db, assessments } = fakeDb([{ userId: "u1", primaryPersona: "rex", mentorDomain: "gym" }]);
    await reassess("u1", { s1: 1, s2: 1, s3: 1, s4: 1 }, NOW, db);
    const first = JSON.stringify(assessments[0]);
    await reassess("u1", { s1: 5, s2: 5, s3: 5, s4: 5 }, NOW, db);
    expect(assessments).toHaveLength(2);
    expect(JSON.stringify(assessments[0])).toBe(first);
  });

  it("never changes the assigned mentor", async () => {
    const { db, profiles } = fakeDb([
      { userId: "u1", primaryPersona: "rex", mentorDomain: "gym", accountabilityStyle: "hard", toneModifier: null },
    ]);
    const result = await reassess("u1", { s1: 5, s2: 3, s3: 5, s4: 5 }, NOW, db);

    expect(result).toMatchObject({ ok: true, assignedMentor: "rex" });
    expect(profiles[0]!.primaryPersona).toBe("rex");
    expect(profiles[0]!.toneModifier).toBeNull();
  });

  it("keeps the original match and records the re-run beside it", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "zen", mentorDomain: "general" }]);
    const signal = scoreSignal(answers);
    const original = matchMentor({ domain: "general", signal });
    await recordOnboardingMatch({ userId: "u1", answers, signal, resolution: "engine", match: original, assignedMentorId: "zen" }, NOW, db);

    const later = new Date("2026-11-01T00:00:00.000Z");
    await reassess("u1", { s1: 5, s2: 5, s3: 1, s4: 1 }, later, db);

    const stored = profiles[0]!.mentorMatch as StoredMentorMatch;
    expect(stored.assignedMentorId).toBe("zen");
    expect(stored.assignedAt).toBe(NOW.toISOString());
    expect(stored.match).toEqual(original);
    expect(stored.reassessment!.at).toBe(later.toISOString());
    expect(stored.reassessment!.match!.mentorId).toBe("zen");
    expect(stored.resolution).toBe("engine");
  });

  it("works for a user assigned a mentor before this feature existed", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "nova", mentorDomain: "study" }]);
    const result = await reassess("u1", answers, NOW, db);

    expect(result).toMatchObject({ ok: true, assignedMentor: "nova" });
    const stored = profiles[0]!.mentorMatch as StoredMentorMatch;
    expect(stored).toMatchObject({ resolution: "predates_matching", assignedMentorId: "nova", assignedAt: null, match: null });
    expect(stored.reassessment!.match!.mentorId).toBe("nova");
  });

  it("stores the signal but no match for a user with no onboarding profile", async () => {
    const { db, assessments } = fakeDb();
    const result = await reassess("u-new", answers, NOW, db);
    expect(result).toEqual({ ok: true, signal: scoreSignal(answers), match: null, assignedMentor: null });
    expect(assessments).toHaveLength(1);
  });

  it("keeps a legacy stub persona assigned rather than replacing it", async () => {
    const { db, profiles } = fakeDb([{ userId: "u1", primaryPersona: "spark", mentorDomain: "general" }]);
    const result = await reassess("u1", answers, NOW, db);
    expect(result).toMatchObject({ ok: true, assignedMentor: "spark" });
    expect(profiles[0]!.primaryPersona).toBe("spark");
    expect((profiles[0]!.mentorMatch as StoredMentorMatch).reassessment!.match!.mentorId).toBe("zen");
  });
});
