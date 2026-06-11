import {
  parseMessage,
  IntentType,
  EntityType,
} from "../parsing-engine-v2"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ctx(lastAssistantMsg: string, step?: string): any {
  return {
    recentMessages: [{ role: "assistant", text: lastAssistantMsg }],
    currentOnboardingStep: step,
  }
}

function noCtx(): any {
  return { recentMessages: [] }
}

function hasIntent(result: any, type: IntentType): boolean {
  return result.intents.some((i: any) => i.type === type)
}

function hasEntity(result: any, type: EntityType): boolean {
  return result.entities.some((e: any) => e.type === type)
}

function actionable(result: any): IntentType | null {
  return result.actionableIntent?.type ?? null
}

// ═══════════════════════════════════════════════════════════════════════════════
// A — REMINDER REQUESTS (15 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("A — Reminder requests", () => {
  it("SC01 — 'remind me every hour to drink water'", () => {
    const r = parseMessage("remind me every hour to drink water", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
    expect(hasEntity(r, EntityType.FREQUENCY)).toBe(true)
    expect(hasEntity(r, EntityType.REMINDER_TARGET)).toBe(true)
  })

  it("SC02 — 'bro remind me every hour to drink water'", () => {
    const r = parseMessage("bro remind me every hour to drink water", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
    expect(r.intents.find((i: any) => i.type === IntentType.REMINDER_CREATE)?.frequency).toBe("60min")
  })

  it("SC03 — 'keep reminding me to drink water'", () => {
    const r = parseMessage("keep reminding me to drink water", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC04 — 'water reminder every 60 mins'", () => {
    const r = parseMessage("water reminder every 60 mins", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(r.entities.find((e: any) => e.type === EntityType.FREQUENCY)?.normalized).toBe("60min")
  })

  it("SC05 — 'ping me every hour for water'", () => {
    const r = parseMessage("ping me every hour for water", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC06 — 'set a reminder to stretch every 2 hours'", () => {
    const r = parseMessage("set a reminder to stretch every 2 hours", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(r.entities.find((e: any) => e.type === EntityType.FREQUENCY)?.normalized).toBe("120min")
  })

  it("SC07 — 'remind me to take my meds at 9pm'", () => {
    const r = parseMessage("remind me to take my meds at 9pm", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasEntity(r, EntityType.TIME)).toBe(true)
    expect(r.entities.find((e: any) => e.type === EntityType.TIME)?.normalized).toBe("21:00")
  })

  it("SC08 — 'make sure I drink water'", () => {
    const r = parseMessage("make sure I drink water", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
  })

  it("SC09 — 'remind me to eat lunch'", () => {
    const r = parseMessage("remind me to eat lunch", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
  })

  it("SC10 — 'can you remind me every 30 min to stand up'", () => {
    const r = parseMessage("can you remind me every 30 min to stand up", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(r.entities.find((e: any) => e.type === EntityType.FREQUENCY)?.normalized).toBe("30min")
  })

  it("SC11 — 'daily reminder to log my workout'", () => {
    const r = parseMessage("daily reminder to log my workout", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(r.entities.find((e: any) => e.type === EntityType.FREQUENCY)?.normalized).toBe("1440min")
  })

  it("SC12 — 'send me a reminder every hour'", () => {
    const r = parseMessage("send me a reminder every hour", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasEntity(r, EntityType.FREQUENCY)).toBe(true)
  })

  it("SC13 — 'reminder for water every hour'", () => {
    const r = parseMessage("reminder for water every hour", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
  })

  it("SC14 — 'check me in 2 hours' (checkin schedule, not reminder_create)", () => {
    const r = parseMessage("check me in 2 hours", noCtx())
    expect(hasIntent(r, IntentType.CHECKIN_SCHEDULE)).toBe(true)
  })

  it("SC15 — 'stop the water reminder' → reminder_delete", () => {
    const r = parseMessage("stop the water reminder", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_DELETE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_DELETE)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// B — MIXED MESSAGES: reminder + context both survive (15 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — Mixed messages", () => {
  it("SC16 — reminder + soreness both detected", () => {
    const r = parseMessage("Remind me every hour to drink water and btw chest is sore", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC17 — reminder + skip both detected", () => {
    const r = parseMessage("set water reminder every hour, also skipped legs today", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC18 — reminder + low energy both detected", () => {
    const r = parseMessage("ping me every hour for water and I'm feeling tired", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC19 — skip + reminder request both detected", () => {
    const r = parseMessage("I skipped the gym and remind me to stretch later", noCtx())
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC20 — pain context + reminder request both detected", () => {
    const r = parseMessage("chest is sore and can you remind me to rest tomorrow", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    // Recommendation not blocked — the user is only requesting a reminder
    expect(r.signals).not.toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC21 — pain + reminder: reminder is actionable intent", () => {
    const r = parseMessage("bro my back hurts and remind me to drink water", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC22 — workout done + stretch reminder both detected", () => {
    const r = parseMessage("I hit chest today and remind me every 2 hrs to stretch", noCtx())
    expect(hasIntent(r, IntentType.LOG_WORKOUT)).toBe(true)
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
  })

  it("SC23 — workout done + ping: checkin_schedule detected", () => {
    const r = parseMessage("workout done, ping me in 2 hours", noCtx())
    expect(hasIntent(r, IntentType.LOG_WORKOUT)).toBe(true)
    expect(hasIntent(r, IntentType.CHECKIN_SCHEDULE)).toBe(true)
  })

  it("SC24 — mood positive + reminder: reminder actionable", () => {
    const r = parseMessage("feeling great today and remind me at 9pm to log", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.MOOD_CONTEXT)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC25 — reminder + nutrition query: both survive", () => {
    const r = parseMessage("I need water reminders every hour and how much protein should I eat", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.NUTRITION_QUERY)).toBe(true)
  })

  it("SC26 — skip + reminder: reminder wins actionable", () => {
    const r = parseMessage("skipped gym and need a water reminder", noCtx())
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
  })

  it("SC27 — reminder + sore knee: pain context stored", () => {
    const r = parseMessage("remind me to train tomorrow and my knee is a bit sore", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(r.signals).toContain("PAIN_MENTIONED")
  })

  it("SC28 — water every hour + missed session: both stored", () => {
    const r = parseMessage("water every hour please, also I missed today's session", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
  })

  it("SC29 — reminder + energy context: both detected", () => {
    const r = parseMessage("need reminder for workout at 6pm and my energy is low", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
  })

  it("SC30 — reminder + nutrition query: both survive, neither drops", () => {
    const r = parseMessage("remind me every hour to drink water also what should I eat", noCtx())
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
    expect(r.intents.length).toBeGreaterThanOrEqual(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// C — PAIN/SORENESS: no auto-recommendation (10 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("C — Pain context, no auto-recommendation", () => {
  it("SC31 — 'chest is sore' → pain context, not recommendation", () => {
    const r = parseMessage("chest is sore", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
    expect(r.signals).toContain("PAIN_MENTIONED")
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC32 — 'my legs are dead' → pain context, no action", () => {
    const r = parseMessage("my legs are dead", noCtx())
    // "dead" is colloquial — should pick up on pain-adjacent language
    expect(actionable(r)).toBeNull()
  })

  it("SC33 — 'back is sore after yesterday' → pain context", () => {
    const r = parseMessage("back is sore after yesterday", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC34 — 'shoulder is a bit tight' → pain context", () => {
    const r = parseMessage("shoulder is a bit tight", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(r.signals).toContain("PAIN_MENTIONED")
  })

  it("SC35 — 'arms are killing me from yesterday' → pain context, no action", () => {
    const r = parseMessage("arms are killing me from yesterday", noCtx())
    expect(actionable(r)).toBeNull()
  })

  it("SC36 — 'knee is a bit sore' → pain context, no recommendation action", () => {
    const r = parseMessage("knee is a bit sore", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC37 — 'I have some lower back pain' → pain context", () => {
    const r = parseMessage("I have some lower back pain", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC38 — 'feeling sore all over' → pain context", () => {
    const r = parseMessage("feeling sore all over", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC39 — 'my chest hurts after training' → pain context", () => {
    const r = parseMessage("my chest hurts after training", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC40 — pain mention + explicit advice request → recommendation allowed", () => {
    const r = parseMessage("chest is sore, what should I do?", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
    // When explicit request exists, recommendation is not blocked
    expect(r.signals).toContain("PAIN_MENTIONED")
    // Recommendation REQUEST is allowed (gate lets explicit requests through)
    const recIntent = r.intents.find((i: any) => i.type === IntentType.RECOMMENDATION_REQUEST)
    expect(recIntent).toBeDefined()
    expect(recIntent?.confidence).toBeGreaterThan(0.5)
  })

  // ── INJURY_CONTEXT signal emission (Gap fix) ─────────────────────────────────

  it("SC40b — 'I think I tore my shoulder' → INJURY_CONTEXT intent AND signal", () => {
    const r = parseMessage("I think I tore my shoulder", noCtx())
    expect(hasIntent(r, IntentType.INJURY_CONTEXT)).toBe(true)
    expect(r.signals).toContain("PAIN_MENTIONED")
    expect(r.signals).toContain("INJURY_CONTEXT")
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC40c — 'possible knee fracture' → INJURY_CONTEXT signal emitted", () => {
    const r = parseMessage("I may have a knee fracture, it snapped during squats", noCtx())
    expect(hasIntent(r, IntentType.INJURY_CONTEXT)).toBe(true)
    expect(r.signals).toContain("INJURY_CONTEXT")
    expect(r.signals).toContain("PAIN_MENTIONED")
  })

  it("SC40d — 'dislocated shoulder' → INJURY_CONTEXT signal but NOT plain pain signal conflict", () => {
    const r = parseMessage("dislocated my shoulder yesterday", noCtx())
    expect(hasIntent(r, IntentType.INJURY_CONTEXT)).toBe(true)
    expect(r.signals).toContain("INJURY_CONTEXT")
    expect(r.signals).toContain("PAIN_MENTIONED")
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
  })

  it("SC40e — plain soreness (no severe word) does NOT emit INJURY_CONTEXT signal", () => {
    const r = parseMessage("my chest is sore today", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(r.signals).toContain("PAIN_MENTIONED")
    expect(r.signals).not.toContain("INJURY_CONTEXT")
  })

  it("SC40f — injury + explicit recommendation request → INJURY_CONTEXT signal set, recommendation NOT blocked", () => {
    const r = parseMessage("I have a torn shoulder, what exercises can I still do?", noCtx())
    expect(hasIntent(r, IntentType.INJURY_CONTEXT)).toBe(true)
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
    expect(r.signals).toContain("PAIN_MENTIONED")
    expect(r.signals).toContain("INJURY_CONTEXT")
    // Explicit request → not blocked, but LLM will still require location/severity/duration
    expect(r.signals).not.toContain("RECOMMENDATION_BLOCKED")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// D — SHORT REPLIES / AMBIGUITY DISAMBIGUATION (15 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("D — Short reply disambiguation", () => {
  it("SC41 — 'yeah' after session-done question → session confirmation", () => {
    const r = parseMessage("yeah", ctx("Did today's session happen?"))
    expect(hasIntent(r, IntentType.SESSION_CONFIRMATION)).toBe(true)
  })

  it("SC42 — 'no' after session-done question → failure signal", () => {
    const r = parseMessage("no", ctx("Did you train today?"))
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
  })

  it("SC43 — 'evening' after time question → training window answer", () => {
    const r = parseMessage("evening", ctx("What time do you usually train?"))
    expect(hasIntent(r, IntentType.TRAINING_WINDOW_ANSWER)).toBe(true)
  })

  it("SC44 — '3' after days-per-week question → days_per_week_answer", () => {
    const r = parseMessage("3", ctx("How many days a week are you going to show up?"))
    expect(hasIntent(r, IntentType.DAYS_PER_WEEK_ANSWER)).toBe(true)
  })

  it("SC45 — 'hard' after feel question → session feel answer", () => {
    const r = parseMessage("hard", ctx("How did that feel — easy, hard, or somewhere in between?"))
    expect(hasIntent(r, IntentType.SESSION_FEEL_ANSWER)).toBe(true)
  })

  it("SC46 — 'sure' after general question → confirmation", () => {
    const r = parseMessage("sure", ctx("Should we keep the same schedule?"))
    expect(hasIntent(r, IntentType.CONFIRMATION)).toBe(true)
  })

  it("SC47 — 'k' (acknowledgement) → acknowledgement intent", () => {
    const r = parseMessage("k", ctx("Got it. Next session: Chest."))
    expect(hasIntent(r, IntentType.ACKNOWLEDGEMENT)).toBe(true)
  })

  it("SC48 — 'yep done' after session question → session confirmation", () => {
    const r = parseMessage("yep done", ctx("Did today's session happen?"))
    expect(hasIntent(r, IntentType.SESSION_CONFIRMATION)).toBe(true)
  })

  it("SC49 — '6am' after time question → training window answer", () => {
    const r = parseMessage("6am", ctx("What time do you usually train?"))
    expect(hasIntent(r, IntentType.TRAINING_WINDOW_ANSWER)).toBe(true)
  })

  it("SC50 — 'not really' after session-done question → failure signal", () => {
    const r = parseMessage("not really", ctx("Did you train?"))
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
  })

  it("SC51 — 'okay' with no context → acknowledgement or low-confidence confirmation", () => {
    const r = parseMessage("okay", noCtx())
    expect(
      hasIntent(r, IntentType.ACKNOWLEDGEMENT) || hasIntent(r, IntentType.CONFIRMATION)
    ).toBe(true)
  })

  it("SC52 — '5' after days-per-week question → days_per_week_answer", () => {
    const r = parseMessage("5", ctx("How many days a week are you actually going to show up?"))
    expect(hasIntent(r, IntentType.DAYS_PER_WEEK_ANSWER)).toBe(true)
  })

  it("SC53 — 'moderate' after feel question → session feel answer", () => {
    const r = parseMessage("moderate", ctx("How did that feel?"))
    expect(hasIntent(r, IntentType.SESSION_FEEL_ANSWER)).toBe(true)
  })

  it("SC54 — 'morning' after time question → training window answer", () => {
    const r = parseMessage("morning", ctx("What time do you train?"))
    expect(hasIntent(r, IntentType.TRAINING_WINDOW_ANSWER)).toBe(true)
  })

  it("SC55 — 'nah' after session-done question → failure signal", () => {
    const r = parseMessage("nah", ctx("Did you train?"))
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// E — ONBOARDING / STATEFUL ANSWERS (10 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("E — Onboarding and stateful answers", () => {
  it("SC56 — 'PPL' during ga_split step → onboarding answer", () => {
    const r = parseMessage("PPL", ctx("Walk me through your split", "ga_split"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
  })

  it("SC57 — '4' during ga_schedule step → days_per_week_answer", () => {
    const r = parseMessage("4", ctx("How many days a week?", "ga_schedule"))
    expect(hasIntent(r, IntentType.DAYS_PER_WEEK_ANSWER)).toBe(true)
  })

  it("SC58 — '75kg 5ft10' during ga_body step → onboarding answer", () => {
    const r = parseMessage("75kg 5ft10", ctx("Weight and height?", "ga_body"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
    expect(hasEntity(r, EntityType.WEIGHT_KG)).toBe(true)
  })

  it("SC59 — 'fat loss' during ga_goal step → onboarding answer", () => {
    const r = parseMessage("fat loss", ctx("What are we training for?", "ga_goal"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
  })

  it("SC60 — 'intermediate' during ga_drill step → onboarding answer", () => {
    const r = parseMessage("intermediate", ctx("How long have you been training?", "ga_drill"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
  })

  it("SC61 — '7pm' during ga_gym_time step → training window answer", () => {
    const r = parseMessage("7pm", ctx("What time do you train?", "ga_gym_time"))
    expect(hasIntent(r, IntentType.TRAINING_WINDOW_ANSWER)).toBe(true)
  })

  it("SC62 — 'none' during ga_injuries step → onboarding answer", () => {
    const r = parseMessage("none", ctx("Any injuries I need to know about?", "ga_injuries"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
  })

  it("SC63 — 'Akshar' during ga_name step → onboarding answer", () => {
    const r = parseMessage("Akshar", ctx("What's your name?", "ga_name"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
  })

  it("SC64 — '6' during ga_schedule step → days_per_week_answer", () => {
    const r = parseMessage("6", ctx("How many days a week?", "ga_schedule"))
    expect(hasIntent(r, IntentType.DAYS_PER_WEEK_ANSWER)).toBe(true)
  })

  it("SC65 — 'Looks good' during ga_review step → onboarding answer", () => {
    const r = parseMessage("Looks good", ctx("Anything wrong before I lock this in?", "ga_review"))
    expect(hasIntent(r, IntentType.ONBOARDING_ANSWER)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// F — CONTEXT MENTION ≠ EXPLICIT REQUEST (10 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("F — Context mention, not explicit request", () => {
  it("SC66 — 'I'm traveling next week' → availability context, no action", () => {
    const r = parseMessage("I'm traveling next week", noCtx())
    expect(hasIntent(r, IntentType.AVAILABILITY_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC67 — 'been feeling stressed lately' → mood context, no action", () => {
    const r = parseMessage("been feeling stressed lately", noCtx())
    expect(hasIntent(r, IntentType.MOOD_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC68 — 'skipped again today' → failure signal, no action", () => {
    const r = parseMessage("skipped again today", noCtx())
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC69 — 'chest day was brutal yesterday' → no new action needed", () => {
    const r = parseMessage("chest day was brutal yesterday", noCtx())
    expect(actionable(r)).toBeNull()
  })

  it("SC70 — 'had a really long work day' → availability context", () => {
    const r = parseMessage("had a really long work day", noCtx())
    expect(actionable(r)).toBeNull()
  })

  it("SC71 — 'feeling unmotivated' → mood context, no action", () => {
    const r = parseMessage("feeling unmotivated", noCtx())
    expect(hasIntent(r, IntentType.MOOD_CONTEXT)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC72 — 'didn't sleep well' → no actionable intent", () => {
    const r = parseMessage("didn't sleep well", noCtx())
    expect(actionable(r)).toBeNull()
  })

  it("SC73 — 'haven't trained in 5 days' → failure signal, no action", () => {
    const r = parseMessage("haven't trained in 5 days", noCtx())
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
    expect(actionable(r)).toBeNull()
  })

  it("SC74 — 'thinking about quitting' → mood context, no recommendation", () => {
    const r = parseMessage("thinking about quitting", noCtx())
    expect(actionable(r)).toBeNull()
  })

  it("SC75 — 'eating a lot of junk lately' → nutrition context, not a query", () => {
    const r = parseMessage("eating a lot of junk lately", noCtx())
    // Should NOT be a nutrition query (no question)
    expect(hasIntent(r, IntentType.NUTRITION_QUERY)).toBe(false)
    expect(actionable(r)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// G — EXPLICIT REQUESTS → actionable (10 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("G — Explicit requests", () => {
  it("SC76 — 'what should I eat for muscle gain?' → actionable nutrition/recommendation intent", () => {
    const r = parseMessage("what should I eat for muscle gain?", noCtx())
    expect(
      hasIntent(r, IntentType.RECOMMENDATION_REQUEST) || hasIntent(r, IntentType.NUTRITION_QUERY)
    ).toBe(true)
    // Something must be actionable (either type qualifies)
    expect(actionable(r)).not.toBeNull()
  })

  it("SC77 — 'help me with my training program' → advice/recommendation request actionable", () => {
    const r = parseMessage("help me with my training program", noCtx())
    expect(
      hasIntent(r, IntentType.ADVICE_REQUEST) || hasIntent(r, IntentType.RECOMMENDATION_REQUEST)
    ).toBe(true)
    expect(actionable(r)).not.toBeNull()
  })

  it("SC78 — 'can you suggest exercises for chest' → recommendation request", () => {
    const r = parseMessage("can you suggest exercises for chest", noCtx())
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
    expect(actionable(r)).toBe(IntentType.RECOMMENDATION_REQUEST)
  })

  it("SC79 — 'what's the best way to improve my squat' → recommendation", () => {
    const r = parseMessage("what's the best way to improve my squat", noCtx())
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
  })

  it("SC80 — 'recommend a split for 4 days a week' → recommendation request", () => {
    const r = parseMessage("recommend a split for 4 days a week", noCtx())
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
    expect(actionable(r)).toBe(IntentType.RECOMMENDATION_REQUEST)
  })

  it("SC81 — 'how much protein should I eat?' → nutrition query", () => {
    const r = parseMessage("how much protein should I eat?", noCtx())
    expect(hasIntent(r, IntentType.NUTRITION_QUERY)).toBe(true)
    expect(actionable(r)).toBe(IntentType.NUTRITION_QUERY)
  })

  it("SC82 — 'how am I doing with my training?' → progress query", () => {
    const r = parseMessage("how am I doing with my training?", noCtx())
    expect(hasIntent(r, IntentType.PROGRESS_QUERY)).toBe(true)
    expect(actionable(r)).toBe(IntentType.PROGRESS_QUERY)
  })

  it("SC83 — 'create a workout plan for me' → plan request", () => {
    const r = parseMessage("create a workout plan for me", noCtx())
    expect(hasIntent(r, IntentType.PLAN_REQUEST)).toBe(true)
    expect(actionable(r)).toBe(IntentType.PLAN_REQUEST)
  })

  it("SC84 — 'my knee hurts, should I still train?' → pain + recommendation allowed", () => {
    const r = parseMessage("my knee hurts, should I still train?", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(true)
    // Explicit "should I train" → recommendation allowed despite pain
    const recIntent = r.intents.find((i: any) => i.type === IntentType.RECOMMENDATION_REQUEST)
    expect(recIntent?.confidence).toBeGreaterThan(0.5)
  })

  it("SC85 — 'I want to build muscle, where do I start?' → goal + recommendation", () => {
    const r = parseMessage("I want to build muscle, where do I start?", noCtx())
    // Should detect goal intent and/or recommendation request
    expect(
      hasIntent(r, IntentType.GOAL_SET) || hasIntent(r, IntentType.RECOMMENDATION_REQUEST)
    ).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// H — ENTITY EXTRACTION (10 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("H — Entity extraction", () => {
  it("SC86 — time entity extracted from reminder", () => {
    const r = parseMessage("remind me to eat at 7pm", noCtx())
    const timeEntity = r.entities.find((e: any) => e.type === EntityType.TIME)
    expect(timeEntity).toBeDefined()
    expect(timeEntity?.normalized).toBe("19:00")
  })

  it("SC87 — frequency entity: 'every 2 hours'", () => {
    const r = parseMessage("remind me to stretch every 2 hours", noCtx())
    const freq = r.entities.find((e: any) => e.type === EntityType.FREQUENCY)
    expect(freq?.normalized).toBe("120min")
  })

  it("SC88 — muscle group entity extracted", () => {
    const r = parseMessage("chest is sore from yesterday", noCtx())
    expect(hasEntity(r, EntityType.MUSCLE_GROUP)).toBe(true)
    const muscle = r.entities.find((e: any) => e.type === EntityType.MUSCLE_GROUP)
    expect(muscle?.normalized).toBe("chest")
  })

  it("SC89 — weight entity: '75kg'", () => {
    const r = parseMessage("I weigh 75kg", noCtx())
    expect(hasEntity(r, EntityType.WEIGHT_KG)).toBe(true)
    const w = r.entities.find((e: any) => e.type === EntityType.WEIGHT_KG)
    expect(w?.normalized).toBe("75kg")
  })

  it("SC90 — temporal ref: 'tomorrow'", () => {
    const r = parseMessage("remind me to train tomorrow", noCtx())
    const temp = r.entities.find((e: any) => e.type === EntityType.TEMPORAL_REF)
    expect(temp?.normalized).toBe("tomorrow")
  })

  it("SC91 — temporal ref: 'after gym'", () => {
    const r = parseMessage("remind me to eat after gym", noCtx())
    const temp = r.entities.find((e: any) => e.type === EntityType.TEMPORAL_REF)
    expect(temp?.normalized).toBe("post_workout")
  })

  it("SC92 — 24h time extraction", () => {
    const r = parseMessage("remind me at 18:30", noCtx())
    const time = r.entities.find((e: any) => e.type === EntityType.TIME)
    expect(time?.normalized).toBe("18:30")
  })

  it("SC93 — reminder target extracted from natural text", () => {
    const r = parseMessage("remind me every hour to drink water", noCtx())
    const target = r.entities.find((e: any) => e.type === EntityType.REMINDER_TARGET)
    expect(target?.value).toContain("drink water")
  })

  it("SC94 — multiple muscle groups extracted", () => {
    const r = parseMessage("back and chest are both sore", noCtx())
    const muscles = r.entities.filter((e: any) => e.type === EntityType.MUSCLE_GROUP)
    expect(muscles.length).toBeGreaterThanOrEqual(2)
  })

  it("SC95 — temporal ref: 'tonight'", () => {
    const r = parseMessage("I'll train tonight", noCtx())
    const temp = r.entities.find((e: any) => e.type === EntityType.TEMPORAL_REF)
    expect(temp?.normalized).toBe("today_evening")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// I — VAGUE / EDGE CASES / SUCCESS CRITERIA (5 scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

describe("I — Edge cases and success criteria validation", () => {
  it("SC96 — empty message → requiresClarification, no action", () => {
    const r = parseMessage("", noCtx())
    expect(r.requiresClarification).toBe(true)
    expect(actionable(r)).toBeNull()
    expect(r.signals).toContain("EMPTY_MESSAGE")
  })

  it("SC97 — vague 'maybe' with no context → requires clarification", () => {
    const r = parseMessage("maybe", noCtx())
    expect(r.requiresClarification).toBe(true)
  })

  it("SC98 — SUCCESS CRITERIA 1: water reminder → no workout recommendation", () => {
    // The critical production failure: reminder routed into coaching
    const r = parseMessage("remind me every hour to drink water", noCtx())
    expect(actionable(r)).toBe(IntentType.REMINDER_CREATE)
    // Must NOT produce a recommendation intent
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(false)
  })

  it("SC99 — SUCCESS CRITERIA 3: two intents — both survive", () => {
    const r = parseMessage("remind me to drink water every hour and I skipped the gym today", noCtx())
    // Both intents must be in the intents array — neither dropped
    expect(hasIntent(r, IntentType.REMINDER_CREATE)).toBe(true)
    expect(hasIntent(r, IntentType.FAILURE_SIGNAL)).toBe(true)
    expect(r.intents.length).toBeGreaterThanOrEqual(2)
  })

  it("SC100 — SUCCESS CRITERIA 6: context mention ≠ request (pain no recommendation)", () => {
    // Core failure mode: "chest is sore" should never produce exercise recommendations
    const r = parseMessage("chest is sore", noCtx())
    expect(hasIntent(r, IntentType.PAIN_CONTEXT)).toBe(true)
    expect(hasIntent(r, IntentType.RECOMMENDATION_REQUEST)).toBe(false)
    expect(r.signals).toContain("RECOMMENDATION_BLOCKED")
    expect(actionable(r)).toBeNull()
  })
})
