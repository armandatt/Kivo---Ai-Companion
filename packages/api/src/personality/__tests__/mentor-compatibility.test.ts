import {
  DIMENSION_WEIGHTS,
  SIGNAL_MAX_SHIFT,
  buildNeedVector,
  matchMentor,
  mentorCompatibility,
  normalizeAccountability,
  normalizeDomain,
  toneModifierFor,
} from "../mentor-compatibility";
import { MENTOR_REGISTRY, type MentorProfile } from "../mentor-registry";
import { scoreSignal } from "../signal-scoring";

const signal = (s1: number, s2: number, s3: number, s4: number) => scoreSignal({ s1, s2, s3, s4 });
const mentor = (id: string) => MENTOR_REGISTRY.find(m => m.id === id)!;

// A registry where two mentors can serve the same domain, as will be the case
// once characters are selectable independently of the pipeline.
const drill:  MentorProfile = { id: "rex", assignable: true, domains: ["general"], characteristics: { intensity: 0.9, warmth: 0.3, structure: 0.8, reflectiveness: 0.1 } };
const guide:  MentorProfile = { id: "zen", assignable: true, domains: ["general"], characteristics: { intensity: 0.2, warmth: 0.6, structure: 0.1, reflectiveness: 0.95 } };
const twoGeneral = [drill, guide];

describe("input normalisation", () => {
  it("maps anything that is not gym or study to general", () => {
    expect(["gym", "GYM", "study", "general", "", null, undefined, "finance"].map(normalizeDomain))
      .toEqual(["gym", "gym", "study", "general", "general", "general", "general", "general"]);
  });

  it("reads both stored values and quiz labels for accountability", () => {
    expect(["hard", "No mercy", "soft", "Gentle nudges", "dynamic", "", null].map(normalizeAccountability))
      .toEqual(["hard", "hard", "soft", "soft", null, null, null]);
  });
});

describe("registry", () => {
  it("only Rex, Nova and Zen are assignable, one per domain", () => {
    expect(MENTOR_REGISTRY.filter(m => m.assignable).map(m => [m.id, m.domains]))
      .toEqual([["rex", ["gym"]], ["nova", ["study"]], ["zen", ["general"]]]);
  });

  it("stub personas are registered but can never be scored or chosen", () => {
    const stubs = MENTOR_REGISTRY.filter(m => !m.assignable);
    expect(stubs.map(m => m.id)).toEqual(["vera", "spark", "compass", "anchor", "lingua"]);
    for (const stub of stubs) {
      expect(mentorCompatibility(buildNeedVector({}).need, stub)).toBeNull();
    }
  });
});

describe("need vector", () => {
  it("is neutral when nothing is known", () => {
    expect(buildNeedVector({}).need).toEqual({ intensity: 0.5, warmth: 0.5, structure: 0.5, reflectiveness: 0.5 });
  });

  it("takes intensity from the explicit accountability answer", () => {
    expect(buildNeedVector({ accountabilityStyle: "No mercy" }).need.intensity).toBe(0.9);
    expect(buildNeedVector({ accountabilityStyle: "Gentle nudges" }).need.intensity).toBe(0.2);
  });

  it("raises structure for outcome goals", () => {
    expect(buildNeedVector({ goalCategory: "fitness" }).need.structure).toBe(0.7);
    expect(buildNeedVector({ goalCategory: "life" }).need.structure).toBe(0.5);
  });

  it("lets the signal nudge, by at most the cap", () => {
    const neutral = buildNeedVector({}).need;
    for (const s1 of [1, 3, 5]) for (const s3 of [1, 3, 5]) for (const s4 of [1, 3, 5]) {
      const need = buildNeedVector({ signal: signal(s1, 3, s3, s4) }).need;
      for (const dim of Object.keys(neutral) as Array<keyof typeof neutral>) {
        expect(Math.abs(need[dim] - neutral[dim])).toBeLessThanOrEqual(SIGNAL_MAX_SHIFT + 1e-9);
      }
    }
  });

  it("never lets the signal move intensity once the user has stated a preference", () => {
    for (const style of ["hard", "soft"]) {
      const without = buildNeedVector({ accountabilityStyle: style }).need.intensity;
      for (const s3 of [1, 2, 3, 4, 5]) {
        const result = buildNeedVector({ accountabilityStyle: style, signal: signal(3, 3, s3, 3) });
        expect(result.need.intensity).toBe(without);
        expect(result.sources.intensity).toEqual([`accountability:${style}`]);
      }
    }
  });

  it("uses the signal for intensity only when no preference was given", () => {
    expect(buildNeedVector({ signal: signal(3, 3, 5, 3) }).need.intensity).toBe(0.35);
    expect(buildNeedVector({ signal: signal(3, 3, 1, 3) }).need.intensity).toBe(0.65);
  });

  it("records where each value came from", () => {
    const { sources } = buildNeedVector({ accountabilityStyle: "hard", goalCategory: "study", signal: signal(1, 3, 5, 5) });
    expect(sources).toEqual({
      intensity:      ["accountability:hard"],
      warmth:         ["signal:composure_low"],
      structure:      ["goal:study", "signal:routine_low"],
      reflectiveness: ["signal:reflection_high"],
    });
  });
});

describe("compatibility score", () => {
  it("is 100 for a perfect fit and falls with distance", () => {
    const rex = mentor("rex");
    expect(mentorCompatibility({ ...rex.characteristics! }, rex)!.score).toBe(100);
    expect(mentorCompatibility({ intensity: 0.1, warmth: 0.3, structure: 0.8, reflectiveness: 0.1 }, rex)!.score)
      .toBe(70);
  });

  it("follows the documented weighted-distance formula", () => {
    const need = { intensity: 0.9, warmth: 0.5, structure: 0.7, reflectiveness: 0.5 };
    const zen = mentor("zen").characteristics!;
    const total = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    const weighted =
      DIMENSION_WEIGHTS.intensity * Math.abs(need.intensity - zen.intensity) +
      DIMENSION_WEIGHTS.warmth * Math.abs(need.warmth - zen.warmth) +
      DIMENSION_WEIGHTS.structure * Math.abs(need.structure - zen.structure) +
      DIMENSION_WEIGHTS.reflectiveness * Math.abs(need.reflectiveness - zen.reflectiveness);
    expect(mentorCompatibility(need, mentor("zen"))!.score).toBe(Math.round(1000 * (1 - weighted / total)) / 10);
  });

  it("returns a per-dimension breakdown", () => {
    const result = mentorCompatibility(buildNeedVector({ accountabilityStyle: "hard" }).need, mentor("nova"))!;
    expect(result.mentorId).toBe("nova");
    expect(result.breakdown.intensity).toEqual({ need: 0.9, mentor: 0.5, distance: 0.4, weight: 3 });
  });

  it("weights the explicit dimension more than any signal-only dimension", () => {
    expect(DIMENSION_WEIGHTS.intensity).toBeGreaterThan(DIMENSION_WEIGHTS.structure);
    expect(DIMENSION_WEIGHTS.intensity).toBeGreaterThan(DIMENSION_WEIGHTS.reflectiveness);
  });
});

describe("domain is a hard constraint", () => {
  it.each([["gym", "rex"], ["study", "nova"], ["general", "zen"], [null, "zen"]])("%p -> %s", (domain, expected) => {
    const match = matchMentor({ domain });
    expect(match.mentorId).toBe(expected);
    expect(match.eligible).toEqual([expected]);
    expect(match.decidedBy).toBe("only_eligible_mentor");
  });

  it("holds for every combination of accountability, goal and signal", () => {
    const expected = { gym: "rex", study: "nova", general: "zen" } as const;
    for (const domain of ["gym", "study", "general"] as const)
      for (const accountabilityStyle of ["hard", "soft", null])
        for (const goalCategory of ["fitness", "study", "life", null])
          for (const s1 of [1, 5]) for (const s3 of [1, 5]) for (const s4 of [1, 5]) {
            const match = matchMentor({ domain, accountabilityStyle, goalCategory, signal: signal(s1, 3, s3, s4) });
            expect(match.mentorId).toBe(expected[domain]);
          }
  });

  it("keeps a gym user on Rex even when another mentor scores higher", () => {
    // Gentle, reflective, unstructured: the closest fit on paper is Zen.
    const match = matchMentor({ domain: "gym", accountabilityStyle: "soft", signal: signal(5, 3, 5, 5) });
    expect(match.ranked[0]!.mentorId).toBe("zen");
    expect(match.ranked[0]!.eligible).toBe(false);
    expect(match.mentorId).toBe("rex");
  });

  it("falls back to the domain default when the registry has nobody eligible", () => {
    const match = matchMentor({ domain: "study" }, twoGeneral);
    expect(match.mentorId).toBe("nova");
    expect(match.decidedBy).toBe("domain_default");
    expect(match.eligible).toEqual([]);
  });
});

describe("ranking between eligible mentors", () => {
  it("picks the highest-scoring eligible mentor", () => {
    const hard = matchMentor({ domain: "general", accountabilityStyle: "hard" }, twoGeneral);
    expect(hard.mentorId).toBe("rex");
    expect(hard.decidedBy).toBe("highest_compatibility");

    const soft = matchMentor({ domain: "general", accountabilityStyle: "soft" }, twoGeneral);
    expect(soft.mentorId).toBe("zen");
  });

  it("does not let the signal override an explicit accountability preference", () => {
    // Asked for no mercy; the signal alone would point at the gentle mentor.
    for (const s1 of [1, 5]) for (const s3 of [1, 5]) for (const s4 of [1, 5]) {
      const match = matchMentor(
        { domain: "general", accountabilityStyle: "hard", signal: signal(s1, 3, s3, s4) },
        twoGeneral,
      );
      expect(match.mentorId).toBe("rex");
    }
  });

  it("lets the signal decide when the user gave no preference", () => {
    const reflective = matchMentor({ domain: "general", signal: signal(5, 3, 5, 5) }, twoGeneral);
    expect(reflective.mentorId).toBe("zen");
    const doer = matchMentor({ domain: "general", signal: signal(1, 3, 1, 1) }, twoGeneral);
    expect(doer.mentorId).toBe("rex");
  });

  it("never selects a non-assignable mentor", () => {
    const hidden: MentorProfile = { ...drill, assignable: false };
    const match = matchMentor({ domain: "general", accountabilityStyle: "hard" }, [hidden, guide]);
    expect(match.mentorId).toBe("zen");
    expect(match.eligible).toEqual(["zen"]);
  });
});

describe("ties", () => {
  const twinA: MentorProfile = { ...drill, id: "rex" };
  const twinB: MentorProfile = { ...drill, id: "zen" };

  it("keeps the current mentor when scores tie", () => {
    const match = matchMentor({ domain: "general", currentMentor: "zen" }, [twinA, twinB]);
    expect(match.mentorId).toBe("zen");
    expect(match.decidedBy).toBe("tie_kept_current_mentor");
  });

  it("otherwise uses registry order, whichever way the list is read", () => {
    const match = matchMentor({ domain: "general" }, [twinA, twinB]);
    expect(match.mentorId).toBe("rex");
    expect(match.decidedBy).toBe("tie_registry_order");

    const reversed = matchMentor({ domain: "general" }, [twinB, twinA]);
    expect(reversed.mentorId).toBe("zen");
  });

  it("ignores a current mentor that is not among the tied candidates", () => {
    const match = matchMentor({ domain: "general", currentMentor: "nova" }, [twinA, twinB]);
    expect(match.mentorId).toBe("rex");
  });
});

describe("determinism", () => {
  it("returns an identical result for identical input, every time", () => {
    const input = { domain: "general", accountabilityStyle: "No mercy", goalCategory: "work", signal: signal(2, 4, 1, 5) };
    const first = JSON.stringify(matchMentor(input));
    for (let i = 0; i < 50; i++) expect(JSON.stringify(matchMentor(input))).toBe(first);
  });

  it("does not mutate its input or the registry", () => {
    const input = Object.freeze({ domain: "gym", accountabilityStyle: "soft", signal: Object.freeze(signal(1, 1, 1, 1)) });
    const before = JSON.stringify(MENTOR_REGISTRY);
    matchMentor(input);
    expect(JSON.stringify(MENTOR_REGISTRY)).toBe(before);
  });

  it("records the versions that produced the match", () => {
    const match = matchMentor({ domain: "gym", signal: signal(3, 3, 3, 3) });
    expect([match.engineVersion, match.registryVersion, match.signalVersion])
      .toEqual(["kivo-match-v1", "kivo-mentors-v1", "kivo-signal-v1"]);
    expect(matchMentor({ domain: "gym" }).signalVersion).toBeNull();
  });
});

describe("tone modifier", () => {
  it("matches the existing onboarding rule", () => {
    expect(toneModifierFor("rex", "soft")).toBe("firm_not_brutal");
    expect(toneModifierFor("nova", "hard")).toBe("structured_direct");
    expect(toneModifierFor("zen", "hard")).toBe("purposeful_direct");
    expect(toneModifierFor("rex", "hard")).toBeNull();
    expect(toneModifierFor("nova", "soft")).toBeNull();
    expect(toneModifierFor("zen", null)).toBeNull();
  });

  it("is set from accountability, not from the signal", () => {
    for (const s3 of [1, 5]) {
      expect(matchMentor({ domain: "gym", accountabilityStyle: "Gentle nudges", signal: signal(3, 3, s3, 3) }).toneModifier)
        .toBe("firm_not_brutal");
      expect(matchMentor({ domain: "gym", accountabilityStyle: "No mercy", signal: signal(3, 3, s3, 3) }).toneModifier)
        .toBeNull();
    }
  });
});
