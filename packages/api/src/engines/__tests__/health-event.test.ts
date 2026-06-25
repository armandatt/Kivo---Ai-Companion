import {
  parseMessage,
  IntentType,
  ILLNESS_RE,
} from "../parsing-engine-v2"

function noCtx(): any {
  return { recentMessages: [] }
}

function hasIntent(result: any, type: IntentType): boolean {
  return result.intents.some((i: any) => i.type === type)
}

function actionable(result: any): IntentType | null {
  return result.actionableIntent?.type ?? null
}

function hasSignal(result: any, signal: string): boolean {
  return result.signals.includes(signal)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH EVENT — PARSING ENGINE V2
//
// These tests verify that illness declarations are detected as HEALTH_EVENT
// intents and emit the HEALTH_EVENT signal for downstream suppression.
// They also verify that workout-specific intents are NOT the actionable intent.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Health event — illness detection", () => {
  it("HE01 — 'I have a fever'", () => {
    const r = parseMessage("I have a fever", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE02 — 'I have a fever. Can't go to gym'", () => {
    const r = parseMessage("I have a fever. Can't go to gym", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    // HEALTH_EVENT (0.93) outranks LOG_SKIP (0.88)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
    // Must NOT select LOG_SKIP as the primary action
    expect(actionable(r)).not.toBe(IntentType.LOG_SKIP)
  })

  it("HE03 — 'Food poisoning'", () => {
    const r = parseMessage("Food poisoning", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE04 — 'Got food poisoning, skipping gym today'", () => {
    const r = parseMessage("Got food poisoning, skipping gym today", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE05 — 'Flu'", () => {
    const r = parseMessage("Flu", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE06 — 'Down with flu, won't make it to gym'", () => {
    const r = parseMessage("Down with flu, won't make it to gym", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
    expect(actionable(r)).not.toBe(IntentType.LOG_SKIP)
  })

  it("HE07 — 'Temperature 102'", () => {
    const r = parseMessage("Temperature 102", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE08 — 'temp 102, feel terrible'", () => {
    const r = parseMessage("temp 102, feel terrible", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE09 — 'feeling nauseous and vomiting'", () => {
    const r = parseMessage("feeling nauseous and vomiting", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })

  it("HE10 — 'got food poisoning last night, throwing up'", () => {
    const r = parseMessage("got food poisoning last night, throwing up", noCtx())
    expect(hasIntent(r, IntentType.HEALTH_EVENT)).toBe(true)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH EVENT — ILLNESS_RE REGEX
//
// Direct tests on the exported ILLNESS_RE pattern.
// ═══════════════════════════════════════════════════════════════════════════════

describe("ILLNESS_RE pattern coverage", () => {
  const matches = [
    "I have a fever",
    "fever is 102",
    "temperature 102",
    "temp 104",
    "got the flu",
    "influenza",
    "food poisoning",
    "food poison",
    "feeling sick",
    "vomiting all night",
    "nausea",
    "diarrhea",
    "diarrhoea",
    "puking",
    "throwing up",
    "stomach bug",
    "stomach virus",
    "migraine",
    "unwell",
    "under the weather",
    "not well",
    "ill",
    "bedridden",
  ]

  for (const phrase of matches) {
    it(`matches: "${phrase}"`, () => {
      expect(ILLNESS_RE.test(phrase)).toBe(true)
    })
  }

  it("does not match: 'feeling great'", () => {
    expect(ILLNESS_RE.test("feeling great")).toBe(false)
  })
  it("does not match: 'sick of this gym'", () => {
    // "sick of this" is burnout language — ILLNESS_RE should not catch it
    // (it's covered by BURNOUT_STATE_RE in the orchestrator instead)
    expect(ILLNESS_RE.test("sick of this gym")).toBe(false)
  })
  it("does not match: 'pain in knee'", () => {
    expect(ILLNESS_RE.test("pain in knee")).toBe(false)
  })
})
