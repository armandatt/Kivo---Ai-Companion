import { SIGNAL_ITEMS, SIGNAL_SCALE, SIGNAL_VERSION } from "../signal-items";
import {
  MAX_OPERATING_STYLE_LINES,
  OPERATING_STYLE_HEADER,
  bandFor,
  describeOperatingStyle,
  parseStoredSignal,
  scoreSignal,
  validateSignalAnswers,
} from "../signal-scoring";

const answers = (s1: number, s2: number, s3: number, s4: number) => ({ s1, s2, s3, s4 });

describe("signal items", () => {
  it("has exactly four statements in a fixed order", () => {
    expect(SIGNAL_ITEMS.map(i => i.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(SIGNAL_ITEMS.map(i => i.dimension)).toEqual(["routine", "sociability", "composure", "reflection"]);
  });

  it("uses the verbatim IPIP statements it cites", () => {
    expect(SIGNAL_ITEMS.map(i => [i.ipipItem, i.text, i.keyed])).toEqual([
      [43, "I follow a schedule.", "+"],
      [21, "I start conversations.", "+"],
      [4,  "I get stressed out easily.", "-"],
      [45, "I spend time reflecting on things.", "+"],
    ]);
  });

  it("offers a five-point scale from 1 to 5", () => {
    expect(SIGNAL_SCALE.map(p => p.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is versioned kivo-signal-v1", () => {
    expect(SIGNAL_VERSION).toBe("kivo-signal-v1");
  });
});

describe("answer validation", () => {
  it("accepts a complete set of 1-5 integers", () => {
    expect(validateSignalAnswers(answers(1, 3, 5, 2))).toEqual({ ok: true, answers: answers(1, 3, 5, 2) });
  });

  it("rejects an incomplete set and names what is missing", () => {
    const result = validateSignalAnswers({ s1: 3, s2: 3 });
    expect(result).toEqual({ ok: false, errors: ["missing answer: s3", "missing answer: s4"] });
  });

  it.each([0, 6, -1, 2.5, NaN, "3", true, null])("rejects the value %p", (bad) => {
    const result = validateSignalAnswers({ s1: bad, s2: 3, s3: 3, s4: 3 });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown item ids", () => {
    const result = validateSignalAnswers({ ...answers(3, 3, 3, 3), s9: 4 });
    expect(result).toEqual({ ok: false, errors: ["unknown item: s9"] });
  });

  it.each([undefined, null, "s1=3", 7, [3, 3, 3, 3]])("rejects non-object input %p", (bad) => {
    expect(validateSignalAnswers(bad).ok).toBe(false);
  });
});

describe("scoring", () => {
  it("normalises 1-5 onto 0-100", () => {
    expect([1, 2, 3, 4, 5].map(v => scoreSignal(answers(v, 3, 3, 3)).scores.routine))
      .toEqual([0, 25, 50, 75, 100]);
  });

  it("reverse-scores the stress statement only", () => {
    const agree = scoreSignal(answers(5, 5, 5, 5));
    expect(agree.scores).toEqual({ routine: 100, sociability: 100, composure: 0, reflection: 100 });

    const disagree = scoreSignal(answers(1, 1, 1, 1));
    expect(disagree.scores).toEqual({ routine: 0, sociability: 0, composure: 100, reflection: 0 });
  });

  it("bands 0-25 low, 50 mid, 75-100 high", () => {
    expect([0, 25, 50, 75, 100].map(bandFor)).toEqual(["low", "low", "mid", "high", "high"]);
    expect(scoreSignal(answers(2, 3, 2, 4)).bands)
      .toEqual({ routine: "low", sociability: "mid", composure: "high", reflection: "high" });
  });

  it("stamps the signal with its version", () => {
    expect(scoreSignal(answers(3, 3, 3, 3)).version).toBe("kivo-signal-v1");
  });

  it("is deterministic", () => {
    expect(scoreSignal(answers(4, 2, 5, 1))).toEqual(scoreSignal(answers(4, 2, 5, 1)));
  });

  it("refuses to score an incomplete set", () => {
    expect(() => scoreSignal({ s1: 3 })).toThrow("missing answer for s2");
  });
});

describe("stored signals", () => {
  it("round-trips a signal through JSON", () => {
    const signal = scoreSignal(answers(4, 2, 5, 1));
    expect(parseStoredSignal(JSON.parse(JSON.stringify(signal)))).toEqual(signal);
  });

  it("returns null for another version, a malformed value or nothing", () => {
    const signal = scoreSignal(answers(3, 3, 3, 3));
    expect(parseStoredSignal({ ...signal, version: "kivo-signal-v2" })).toBeNull();
    expect(parseStoredSignal({ version: "kivo-signal-v1", scores: {}, bands: {} })).toBeNull();
    expect(parseStoredSignal(null)).toBeNull();
    expect(parseStoredSignal(undefined)).toBeNull();
    expect(parseStoredSignal("high")).toBeNull();
  });
});

describe("prompt context", () => {
  it("says nothing for a user with no signal", () => {
    expect(describeOperatingStyle(null)).toEqual([]);
    expect(describeOperatingStyle(undefined)).toEqual([]);
  });

  it("says nothing when every answer is in the middle", () => {
    expect(describeOperatingStyle(scoreSignal(answers(3, 3, 3, 3)))).toEqual([]);
  });

  it("gives one behavioural line per non-middle dimension", () => {
    const lines = describeOperatingStyle(scoreSignal(answers(1, 3, 5, 5)));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/external structure/);
    expect(lines[1]).toMatch(/one thing at a time/);
    expect(lines[2]).toMatch(/think things through/);
  });

  it("never gives more than three lines, dropping the conversational one first", () => {
    expect(MAX_OPERATING_STYLE_LINES).toBe(3);
    for (const s1 of [1, 2, 3, 4, 5]) for (const s2 of [1, 2, 3, 4, 5]) for (const s3 of [1, 2, 3, 4, 5]) for (const s4 of [1, 2, 3, 4, 5]) {
      expect(describeOperatingStyle(scoreSignal(answers(s1, s2, s3, s4))).length).toBeLessThanOrEqual(3);
    }

    // All four dimensions are non-middle here, so one line has to go.
    const lines = describeOperatingStyle(scoreSignal(answers(1, 5, 5, 5)));
    expect(lines).toHaveLength(3);
    expect(lines.join(" ")).not.toMatch(/back-and-forth|specific question/);

    // With room to spare, the conversational line is kept.
    expect(describeOperatingStyle(scoreSignal(answers(3, 1, 3, 3)))).toEqual([
      "Usually keeps replies short and may not volunteer detail: ask one specific question, not an open-ended one.",
    ]);
  });

  it("never says how hard or how gently to push", () => {
    // Intensity belongs to the user's explicit accountability choice.
    const intensity = /plain|blunt|direct|harsh|hard|tough|firm|strict|push|press|mercy|gentle|soft|easy|lenient|back off|small|demand|feedback/i;
    const single = [
      answers(1, 3, 3, 3), answers(5, 3, 3, 3), answers(3, 1, 3, 3), answers(3, 5, 3, 3),
      answers(3, 3, 1, 3), answers(3, 3, 5, 3), answers(3, 3, 3, 1), answers(3, 3, 3, 5),
    ];
    // One answer off-centre at a time reaches every line, including any the cap can drop.
    for (const only of single) {
      const lines = describeOperatingStyle(scoreSignal(only));
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toMatch(intensity);
    }
  });

  it("gives the same lines whatever accountability style the user chose", () => {
    // It takes only the signal, so the chosen style cannot alter the lines, and
    // the header tells the model the lines never change that style.
    expect(describeOperatingStyle.length).toBe(1);
    expect(OPERATING_STYLE_HEADER).toMatch(/never changes their chosen accountability style/);
  });

  it("never exposes trait labels, scores or raw answers to the model", () => {
    const banned = /neurotic|introvert|extravert|conscientious|agreeabl|openness|big five|personality|score|\d/i;
    for (const s1 of [1, 5]) for (const s2 of [1, 5]) for (const s3 of [1, 5]) for (const s4 of [1, 5]) {
      for (const line of describeOperatingStyle(scoreSignal(answers(s1, s2, s3, s4)))) {
        expect(line).not.toMatch(banned);
      }
    }
    expect(OPERATING_STYLE_HEADER).not.toMatch(/neurotic|introvert|extravert|big five|diagnos/i);
    expect(OPERATING_STYLE_HEADER).toMatch(/Use it silently/);
    expect(OPERATING_STYLE_HEADER).toMatch(/Never mention it/);
  });
});
