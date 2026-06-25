import {
  parseMessage,
  IntentType,
  ACK_RE,
} from "../parsing-engine-v2"
import {
  selectClosureContext,
  pickClosureReply,
  CLOSURE_POOLS,
  type ClosureContext,
} from "../../services/acknowledgementPool.service"

// ─── Test helpers ─────────────────────────────────────────────────────────────

function noCtx(): any {
  return { recentMessages: [] }
}

function guidanceCtx(): any {
  return {
    recentMessages: [
      {
        role:   "assistant",
        text:   "Rest up — no training with a fever. Stay hydrated and message me when you're back.",
        intent: "health_event",
      },
    ],
  }
}

function hasIntent(result: any, type: IntentType): boolean {
  return result.intents.some((i: any) => i.type === type)
}

function hasSignal(result: any, signal: string): boolean {
  return result.signals.includes(signal)
}

function actionable(result: any): IntentType | null {
  return result.actionableIntent?.type ?? null
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACK_RE PATTERN COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

describe("ACK_RE — single-concept acknowledgement coverage", () => {
  const variants = [
    "ok", "okay", "k", "kk", "kkk", "kay",
    "okie", "okayiee", "okayyy",
    "thanks", "thank you", "thx", "ty", "cheers",
    "cool", "sure", "yep", "yeah", "ya", "yup", "alright", "aight", "ight",
    "got it", "got that", "will do", "noted", "understood", "roger",
    "appreciate it", "appreciate that", "sounds good", "sounds great",
    "nice", "great", "awesome", "perfect", "solid",
    "👍", "👍👍", "❤️", "🙏", "💪", "✅", "🤝", "😊", "🙌",
    "thanks.", "okay!", "got it.", "cool!",
  ]

  for (const v of variants) {
    it(`ACK_RE matches: "${v}"`, () => {
      expect(ACK_RE.test(v)).toBe(true)
    })
  }
})

describe("ACK_RE — does NOT match substantive messages", () => {
  const nonAck = [
    "okay, but what about my diet?",
    "thanks for the advice, should I rest tomorrow too?",
    "got it. will I lose progress?",
    "cool, what exercises can I do instead?",
    "I have a fever",
    "can't go to gym today",
    "how many sets should I do?",
  ]

  for (const v of nonAck) {
    it(`ACK_RE does NOT match: "${v}"`, () => {
      expect(ACK_RE.test(v)).toBe(false)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// PARSING ENGINE — SINGLE-WORD ACKNOWLEDGEMENT + CONVERSATION_CLOSURE
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMessage — single-word acknowledgement detection", () => {
  it("AC01 — 'okay' after guidance → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("okay", guidanceCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("AC02 — 'okay' with no context → still ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("okay", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC03 — 'Thanks.' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Thanks.", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC04 — 'Got it.' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Got it.", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC05 — 'Cool.' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Cool.", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC06 — '👍' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("👍", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC07 — '❤️' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("❤️", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC08 — 'okayiee' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("okayiee", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC09 — 'alright' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("alright", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC10 — 'will do' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("will do", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })

  it("AC11 — 'sounds good' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE", () => {
    const r = parseMessage("sounds good", noCtx())
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-WORD CLOSURE — all spec-required variants
// These bypass ACK_RE (end-anchored) but are caught by detectMultiWordClosure().
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMessage — multi-word closure (spec required variants)", () => {
  const variants: [string, string][] = [
    ["MW01", "Thanks Rex"],
    ["MW02", "Thanks bro"],
    ["MW03", "Thanks man"],
    ["MW04", "Got it boss"],
    ["MW05", "Got it man"],
    ["MW06", "Okay sounds good"],
    ["MW07", "Appreciate it bro"],
    ["MW08", "Will do man"],
    ["MW09", "Alright I'll try that"],
    ["MW10", "Sounds good Rex"],
  ]

  for (const [id, text] of variants) {
    it(`${id} — '${text}' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE`, () => {
      const r = parseMessage(text, noCtx())
      expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
      expect(actionable(r)).toBeNull()
    })
  }
})

describe("parseMessage — multi-word closure (additional coverage)", () => {
  const extras: string[] = [
    "Thanks a lot",
    "Okay cool",
    "Alright I'll try",
    "Appreciate it man",
    "Thanks man",
    "Got it man",
    "Will do bro",
    "Sounds great Rex",
    "Good work noted",
    "Got it noted",
  ]

  for (const text of extras) {
    it(`'${text}' → ACKNOWLEDGEMENT + CONVERSATION_CLOSURE`, () => {
      const r = parseMessage(text, noCtx())
      expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// ANTI-STEAL — closure must NOT fire when message has substantive content
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMessage — anti-steal: closure does not fire on substantive messages", () => {
  it("AS01 — 'okay, but what about my diet?' → NOT CONVERSATION_CLOSURE", () => {
    const r = parseMessage("okay, but what about my diet?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS02 — 'Okay but what about protein?' → NOT CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Okay but what about protein?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS03 — 'Thanks, when should I do cardio?' → NOT CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Thanks, when should I do cardio?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS04 — 'Will do. Remind me tomorrow.' → NOT CONVERSATION_CLOSURE (reminder wins)", () => {
    const r = parseMessage("Will do. Remind me tomorrow.", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
    // Reminder is the actionable intent
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("AS05 — 'Got it, can you adjust my calories?' → NOT CONVERSATION_CLOSURE (has ?)", () => {
    const r = parseMessage("Got it, can you adjust my calories?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS06 — 'Thanks, remind me every hour to drink water' → REMINDER_CREATE wins", () => {
    const r = parseMessage("Thanks, remind me every hour to drink water", noCtx())
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS07 — 'Okay but what exercises can I do?' → NOT CONVERSATION_CLOSURE", () => {
    const r = parseMessage("okay, but what exercises can I do?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS08 — 'Got it. Will I lose progress?' → NOT CONVERSATION_CLOSURE (has ?)", () => {
    const r = parseMessage("Got it. Will I lose progress?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS09 — 'Thanks for the advice, should I rest tomorrow too?' → NOT CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Thanks for the advice, should I rest tomorrow too?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS10 — 'Thanks so much, what about stretching?' → NOT CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Thanks so much, what about stretching?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AS11 — 6-word closure with no question still blocked if > 5 words", () => {
    // 8 words — exceeds the 5-word guard in detectMultiWordClosure
    const r = parseMessage("Thanks so much for all this help", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ACKNOWLEDGEMENT DOES NOT STEAL ACTIONABLE INTENT
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMessage — ack does not steal actionable intent", () => {
  it("AC12 — 'okay, but what exercises can I do?' → no CONVERSATION_CLOSURE", () => {
    const r = parseMessage("okay, but what exercises can I do?", noCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AC13 — 'thanks, remind me every hour to drink water' → REMINDER_CREATE wins", () => {
    const r = parseMessage("thanks, remind me every hour to drink water", noCtx())
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
  })

  it("AC14 — 'okay' after session-done question → SESSION_CONFIRMATION (not closure)", () => {
    const questionCtx = {
      recentMessages: [{ role: "assistant", text: "Did you complete the session today?" }],
    }
    const r = parseMessage("okay", questionCtx)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
    expect(
      hasIntent(r, IntentType.SESSION_CONFIRMATION) || hasIntent(r, IntentType.CONFIRMATION)
    ).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH EVENT + ACKNOWLEDGEMENT COMBINATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMessage — health event followed by acknowledgement", () => {
  it("AC15 — 'I have a fever' → HEALTH_EVENT (not closure)", () => {
    const r = parseMessage("I have a fever", noCtx())
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(true)
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(false)
    expect(actionable(r)).toBe(IntentType.HEALTH_EVENT)
  })

  it("AC16 — 'okay' after health guidance → CONVERSATION_CLOSURE (not health event)", () => {
    const r = parseMessage("okay", guidanceCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(false)
    expect(actionable(r)).toBeNull()
  })

  it("AC17 — 'Thanks Rex' after health guidance → CONVERSATION_CLOSURE", () => {
    const r = parseMessage("Thanks Rex", guidanceCtx())
    expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    expect(hasSignal(r, "HEALTH_EVENT")).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ACKNOWLEDGEMENT POOL — selectClosureContext
// ═══════════════════════════════════════════════════════════════════════════════

describe("selectClosureContext — signal-driven pool selection", () => {
  const noIntents: Array<{ role: string; intent?: string }> = []

  it("POOL01 — HEALTH_EVENT signal → HEALTH pool", () => {
    expect(selectClosureContext(["HEALTH_EVENT", "CONVERSATION_CLOSURE"], noIntents)).toBe("HEALTH")
  })

  it("POOL02 — INJURY_CONTEXT signal → INJURY pool", () => {
    expect(selectClosureContext(["INJURY_CONTEXT", "CONVERSATION_CLOSURE"], noIntents)).toBe("INJURY")
  })

  it("POOL03 — no signals, health_event in recent intents → HEALTH pool", () => {
    const msgs = [
      { role: "assistant", intent: "health_event" },
    ]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("HEALTH")
  })

  it("POOL04 — no signals, pain_report in recent intents → INJURY pool", () => {
    const msgs = [
      { role: "assistant", intent: "pain_report" },
    ]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("INJURY")
  })

  it("POOL05 — no signals, log_pain in recent intents → INJURY pool", () => {
    const msgs = [{ role: "assistant", intent: "log_pain" }]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("INJURY")
  })

  it("POOL06 — no signals, emotional_trigger in recent intents → EMOTIONAL pool", () => {
    const msgs = [{ role: "assistant", intent: "emotional_trigger" }]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("EMOTIONAL")
  })

  it("POOL07 — no signals, mood_context in recent intents → EMOTIONAL pool", () => {
    const msgs = [{ role: "assistant", intent: "mood_context" }]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("EMOTIONAL")
  })

  it("POOL08 — no signals, gym_checkin in recent intents → ACHIEVEMENT pool", () => {
    const msgs = [{ role: "assistant", intent: "gym_checkin" }]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("ACHIEVEMENT")
  })

  it("POOL09 — no signals, pr_log in recent intents → ACHIEVEMENT pool", () => {
    const msgs = [{ role: "assistant", intent: "pr_log" }]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("ACHIEVEMENT")
  })

  it("POOL10 — no signals, no matching intents → GENERAL pool", () => {
    const msgs = [
      { role: "assistant", intent: "acknowledgement" },
      { role: "user",      intent: "general_chat" },
    ]
    expect(selectClosureContext(["CONVERSATION_CLOSURE"], msgs)).toBe("GENERAL")
  })

  it("POOL11 — empty signals, empty messages → GENERAL pool", () => {
    expect(selectClosureContext([], [])).toBe("GENERAL")
  })

  it("POOL12 — HEALTH_EVENT signal overrides achievement intents", () => {
    const msgs = [{ role: "assistant", intent: "gym_checkin" }]
    expect(selectClosureContext(["HEALTH_EVENT", "CONVERSATION_CLOSURE"], msgs)).toBe("HEALTH")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ACKNOWLEDGEMENT POOL — pickClosureReply
// ═══════════════════════════════════════════════════════════════════════════════

describe("pickClosureReply — dedup and pool membership", () => {
  const contexts: ClosureContext[] = ["HEALTH", "INJURY", "EMOTIONAL", "ACHIEVEMENT", "GENERAL"]

  for (const ctx of contexts) {
    it(`${ctx} — reply is a member of ${ctx} pool`, () => {
      const reply = pickClosureReply(ctx)
      expect(CLOSURE_POOLS[ctx]).toContain(reply)
    })

    it(`${ctx} — consecutive calls with same lastReply produce a different string`, () => {
      const first = pickClosureReply(ctx)
      const pool = CLOSURE_POOLS[ctx] as readonly string[]
      if (pool.length > 1) {
        const second = pickClosureReply(ctx, first)
        expect(second).not.toBe(first)
      }
    })
  }

  it("DEDUP — all pool values are unique within each pool", () => {
    for (const [ctx, pool] of Object.entries(CLOSURE_POOLS)) {
      const unique = new Set(pool)
      expect(unique.size).toBe(pool.length)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION AUDIT — 12 category coverage
//
// For each conversation category, verify:
//   • The acknowledgement is detected as CONVERSATION_CLOSURE
//   • The correct pool context is selected
//   • No workout-focus intents survive into signals
// ═══════════════════════════════════════════════════════════════════════════════

describe("Conversation audit — acknowledgements across all categories", () => {

  // ── Category 1: Health events ──────────────────────────────────────────────
  describe("Cat 1 — Health events", () => {
    const healthCtx = {
      recentMessages: [
        { role: "user",      text: "I have a fever",                         intent: "health_event" },
        { role: "assistant", text: "Rest up — no training with a fever.",     intent: "health_event" },
      ],
    }
    it("AUDIT_HE01 — 'Thanks' after health event → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Thanks", healthCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_HE02 — 'Got it man' after health event → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Got it man", healthCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_HE03 — context → HEALTH pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], healthCtx.recentMessages)).toBe("HEALTH")
    })
  })

  // ── Category 2: Injuries ───────────────────────────────────────────────────
  describe("Cat 2 — Injuries", () => {
    const injuryCtx = {
      recentMessages: [
        { role: "user",      text: "Knee is killing me",  intent: "log_pain" },
        { role: "assistant", text: "Don't train on it.",  intent: "pain_report" },
      ],
    }
    it("AUDIT_IN01 — 'Got it boss' after injury context → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Got it boss", injuryCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_IN02 — context → INJURY pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], injuryCtx.recentMessages)).toBe("INJURY")
    })
  })

  // ── Category 3: Burnout ────────────────────────────────────────────────────
  describe("Cat 3 — Burnout", () => {
    const burnoutCtx = {
      recentMessages: [
        { role: "user",      text: "I'm burnt out",                    intent: "mood_context" },
        { role: "assistant", text: "One step at a time.",              intent: "emotional_trigger" },
      ],
    }
    it("AUDIT_BU01 — 'Okay' after burnout context → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Okay", burnoutCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_BU02 — context → EMOTIONAL pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], burnoutCtx.recentMessages)).toBe("EMOTIONAL")
    })
  })

  // ── Category 4: Emotional conversations ───────────────────────────────────
  describe("Cat 4 — Emotional", () => {
    const emotionalCtx = {
      recentMessages: [
        { role: "user",      text: "Feeling really low",           intent: "mood_context" },
        { role: "assistant", text: "I hear you. Take your time.",  intent: "mood_context" },
      ],
    }
    it("AUDIT_EM01 — 'Sounds good' after emotional exchange → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Sounds good", emotionalCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_EM02 — context → EMOTIONAL pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], emotionalCtx.recentMessages)).toBe("EMOTIONAL")
    })
  })

  // ── Category 5: Life constraints (travel, busy) ────────────────────────────
  describe("Cat 5 — Life constraints", () => {
    const travelCtx = {
      recentMessages: [
        { role: "user",      text: "Traveling this week",             intent: "availability_context" },
        { role: "assistant", text: "Hotel workouts noted. We adapt.", intent: "general_chat" },
      ],
    }
    it("AUDIT_LC01 — 'Alright I'll try that' after travel → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Alright I'll try that", travelCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_LC02 — context → GENERAL pool (no specific signal)", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], travelCtx.recentMessages)).toBe("GENERAL")
    })
  })

  // ── Category 6: Success / achievements ────────────────────────────────────
  describe("Cat 6 — Success events", () => {
    const achievementCtx = {
      recentMessages: [
        { role: "user",      text: "Just crushed my workout",          intent: "gym_checkin" },
        { role: "assistant", text: "Good session. Keep that momentum.", intent: "gym_checkin" },
      ],
    }
    it("AUDIT_AC01 — 'Nice' after gym checkin → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("nice", achievementCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_AC02 — context → ACHIEVEMENT pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], achievementCtx.recentMessages)).toBe("ACHIEVEMENT")
    })
  })

  // ── Category 7: Recovery days ──────────────────────────────────────────────
  describe("Cat 7 — Recovery days", () => {
    const recoveryCtx = {
      recentMessages: [
        { role: "user",      text: "Taking a rest day",      intent: "log_skip" },
        { role: "assistant", text: "Good call. Rest is work.", intent: "general_chat" },
      ],
    }
    it("AUDIT_RD01 — 'Got it' after rest day → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Got it", recoveryCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_RD02 — context → GENERAL pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], recoveryCtx.recentMessages)).toBe("GENERAL")
    })
  })

  // ── Category 8: Travel ─────────────────────────────────────────────────────
  describe("Cat 8 — Travel", () => {
    it("AUDIT_TR01 — 'Will do man' while traveling → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Will do man", noCtx())
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
  })

  // ── Category 9: Exams / deadlines ─────────────────────────────────────────
  describe("Cat 9 — Exams and deadlines", () => {
    it("AUDIT_EX01 — 'Thanks bro' during exam period → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Thanks bro", noCtx())
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
  })

  // ── Category 10: Family issues ─────────────────────────────────────────────
  describe("Cat 10 — Family issues", () => {
    const familyCtx = {
      recentMessages: [
        { role: "user",      text: "Family stuff going on",         intent: "mood_context" },
        { role: "assistant", text: "Take the time you need.",       intent: "emotional_trigger" },
      ],
    }
    it("AUDIT_FA01 — 'Okay' after family issue exchange → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Okay", familyCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_FA02 — context → EMOTIONAL pool", () => {
      expect(selectClosureContext(["CONVERSATION_CLOSURE"], familyCtx.recentMessages)).toBe("EMOTIONAL")
    })
  })

  // ── Category 11: Off-topic ─────────────────────────────────────────────────
  describe("Cat 11 — After off-topic exchange", () => {
    const offTopicCtx = {
      recentMessages: [
        { role: "assistant", text: "Let's keep the focus on your training.", intent: "general_chat" },
      ],
    }
    it("AUDIT_OT01 — 'Sounds good Rex' after off-topic → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Sounds good Rex", offTopicCtx)
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
  })

  // ── Category 12: General coaching ─────────────────────────────────────────
  describe("Cat 12 — General coaching closure", () => {
    it("AUDIT_GC01 — 'Appreciate it bro' → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Appreciate it bro", noCtx())
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
    it("AUDIT_GC02 — 'Okay sounds good' → CONVERSATION_CLOSURE", () => {
      const r = parseMessage("Okay sounds good", noCtx())
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// WORKOUT-FOCUS SPAM PROOF
//
// These tests verify the structural invariant:
// "If CONVERSATION_CLOSURE is in signals, the route gate fires.
//  The gate returns before orchestrator, off-topic classifier,
//  gym short-circuit, and scheduler execute."
//
// This is proved via the signal — any message emitting CONVERSATION_CLOSURE
// will be intercepted by the gate in route.ts before reaching those systems.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Workout-focus spam invariant — CONVERSATION_CLOSURE blocks all routing", () => {
  const allSpecVariants = [
    "Thanks Rex", "Thanks bro", "Thanks man",
    "Got it boss", "Got it man",
    "Okay sounds good", "Appreciate it bro",
    "Will do man", "Alright I'll try that", "Sounds good Rex",
    "okay", "thanks", "👍", "❤️", "will do", "noted", "got it", "alright",
  ]

  for (const text of allSpecVariants) {
    it(`'${text}' → CONVERSATION_CLOSURE emitted (gate fires, orchestrator never reached)`, () => {
      const r = parseMessage(text, noCtx())
      expect(hasSignal(r, "CONVERSATION_CLOSURE")).toBe(true)
      // Confirm no workout/gym actionable intent leaks through
      expect(actionable(r)).toBeNull()
    })
  }

  it("No spec variant produces a RECOMMENDATION_BLOCKED signal (no coaching intent)", () => {
    for (const text of allSpecVariants) {
      const r = parseMessage(text, noCtx())
      expect(hasSignal(r, "RECOMMENDATION_BLOCKED")).toBe(false)
    }
  })

  it("No spec variant produces HEALTH_EVENT signal (no false illness detection)", () => {
    for (const text of allSpecVariants) {
      const r = parseMessage(text, noCtx())
      expect(hasSignal(r, "HEALTH_EVENT")).toBe(false)
    }
  })
})
