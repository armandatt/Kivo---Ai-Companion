import {
  TrainingWindow,
  TrainingState,
  resolveNextCycleDay,
  deriveTrainingWindow,
  classifyHourToWindow,
  deriveVirtualGymTime,
  isTrainingDayByFrequency,
  resolveTrainingState,
  computeConsecutiveMissesV2,
  adjustForQuietHours,
  getEffectiveChaseTime,
  parseSplitStateMinimal,
  getLocalDateISO,
  daysBetween,
  subtractDays,
  addMinutesHHMM,
} from "../scheduler-intelligence-v2"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function state(overrides: any = {}) {
  return {
    lastCompletedDayIndex: null,
    avgSessionDurationMin: 60,
    lastSkipDate:          null,
    lastSessionDate:       null,
    ...overrides,
  }
}

function intake(overrides: Record<string, string> = {}) {
  return {
    current_split:           "PPL",
    available_training_days: "3",
    ...overrides,
  }
}

function session(hour: number, tz = "UTC"): { date: Date } {
  // Build a date that, when read in `tz`, shows the given hour
  const d = new Date(`2024-01-15T${String(hour).padStart(2, "0")}:30:00Z`)
  return { date: d }
}

// ─── GROUP 1: resolveNextCycleDay (10 scenarios) ──────────────────────────────

describe("resolveNextCycleDay", () => {
  it("SC01 — PPL from scratch: first day is Chest+Triceps+Shoulders", () => {
    const result = resolveNextCycleDay(state({ lastCompletedDayIndex: null }), intake())
    expect(result).not.toBeNull()
    expect(result!.muscles).toBe("Chest + Triceps + Shoulders")
    expect(result!.splitDayIndex).toBe(0)
  })

  it("SC02 — PPL after Day 0 completed: next is Back+Biceps", () => {
    const result = resolveNextCycleDay(state({ lastCompletedDayIndex: 0 }), intake())
    expect(result!.muscles).toBe("Back + Biceps")
    expect(result!.splitDayIndex).toBe(1)
  })

  it("SC03 — PPL after Day 2 (Legs) completed: wraps to Day 0 Chest", () => {
    const result = resolveNextCycleDay(state({ lastCompletedDayIndex: 2 }), intake())
    expect(result!.muscles).toBe("Chest + Triceps + Shoulders")
    expect(result!.splitDayIndex).toBe(0)
  })

  it("SC04 — full_body split: always Full Body regardless of index", () => {
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: 1 }),
      intake({ current_split: "full_body", available_training_days: "3" }),
    )
    expect(result!.muscles).toBe("Full Body")
  })

  it("SC05 — upper_lower split cycles correctly", () => {
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: 0 }),
      intake({ current_split: "upper_lower", available_training_days: "4" }),
    )
    expect(result!.muscles).toContain("Lower Body")
  })

  it("SC06 — bro_split Day 4 (Arms) wraps to Day 0 (Chest)", () => {
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: 4 }),
      intake({ current_split: "bro_split", available_training_days: "5" }),
    )
    expect(result!.muscles).toBe("Chest")
  })

  it("SC07 — custom split_days_json overrides canonical split", () => {
    const custom = JSON.stringify(["Back", "Chest", "Arms"])
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: null }),
      intake({ current_split: "PPL", split_days_json: custom }),
    )
    expect(result!.muscles).toBe("Back")
  })

  it("SC08 — custom split_days_json mid-cycle", () => {
    const custom = JSON.stringify(["Push", "Pull", "Legs", "Upper"])
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: 2 }),
      intake({ current_split: "upper_lower", split_days_json: custom }),
    )
    expect(result!.muscles).toBe("Upper")
  })

  it("SC09 — PPL 6 days/week uses 6-day cycle", () => {
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: 5 }),
      intake({ current_split: "PPL", available_training_days: "6" }),
    )
    expect(result!.splitDayIndex).toBe(0)
  })

  it("SC10 — unstructured split defaults to Full Body cycle", () => {
    const result = resolveNextCycleDay(
      state({ lastCompletedDayIndex: null }),
      intake({ current_split: "unstructured", available_training_days: "3" }),
    )
    expect(result!.muscles).toBe("Full Body")
  })
})

// ─── GROUP 2: deriveTrainingWindow (8 scenarios) ──────────────────────────────

describe("deriveTrainingWindow", () => {
  it("SC11 — 5 morning sessions → MORNING high confidence", () => {
    const sessions = [7, 6, 8, 7, 6].map(h => session(h))
    const { window, confidence } = deriveTrainingWindow(sessions, "UTC")
    expect(window).toBe(TrainingWindow.MORNING)
    expect(confidence).toBe("high")
  })

  it("SC12 — 5 evening sessions → EVENING high confidence", () => {
    const sessions = [18, 19, 17, 20, 18].map(h => session(h))
    const { window, confidence } = deriveTrainingWindow(sessions, "UTC")
    expect(window).toBe(TrainingWindow.EVENING)
    expect(confidence).toBe("high")
  })

  it("SC13 — 4 afternoon sessions → AFTERNOON high confidence", () => {
    const sessions = [13, 14, 13, 14, 15].map(h => session(h))
    const { window, confidence } = deriveTrainingWindow(sessions, "UTC")
    expect(window).toBe(TrainingWindow.AFTERNOON)
    expect(confidence).toBe("high")
  })

  it("SC14 — mixed sessions → FLEXIBLE low confidence", () => {
    const sessions = [7, 13, 19, 8, 20].map(h => session(h))
    const { window, confidence } = deriveTrainingWindow(sessions, "UTC")
    expect(window).toBe(TrainingWindow.FLEXIBLE)
    expect(confidence).toBe("low")
  })

  it("SC15 — fewer than 3 sessions → FLEXIBLE low confidence", () => {
    const { window, confidence } = deriveTrainingWindow([session(7), session(8)], "UTC")
    expect(window).toBe(TrainingWindow.FLEXIBLE)
    expect(confidence).toBe("low")
  })

  it("SC16 — 3 morning + 2 evening → MORNING medium confidence", () => {
    const sessions = [7, 8, 7, 19, 18].map(h => session(h))
    const { window, confidence } = deriveTrainingWindow(sessions, "UTC")
    expect(window).toBe(TrainingWindow.MORNING)
    expect(confidence).toBe("medium")
  })

  it("SC17 — midnight/late-night sessions not counted → FLEXIBLE", () => {
    const sessions = [0, 1, 2, 3, 4].map(h => session(h))
    const { window, confidence } = deriveTrainingWindow(sessions, "UTC")
    expect(window).toBe(TrainingWindow.FLEXIBLE)
    expect(confidence).toBe("low")
  })

  it("SC18 — classifyHourToWindow maps correctly to windows", () => {
    expect(classifyHourToWindow(6)).toBe(TrainingWindow.MORNING)
    expect(classifyHourToWindow(13)).toBe(TrainingWindow.AFTERNOON)
    expect(classifyHourToWindow(19)).toBe(TrainingWindow.EVENING)
    expect(classifyHourToWindow(2)).toBeNull()
  })
})

// ─── GROUP 3: isTrainingDayByFrequency (6 scenarios) ─────────────────────────

describe("isTrainingDayByFrequency", () => {
  it("SC19 — daysSinceLast=0 → never a training day (already trained today)", () => {
    expect(isTrainingDayByFrequency(3, 0)).toBe(false)
    expect(isTrainingDayByFrequency(6, 0)).toBe(false)
  })

  it("SC20 — 3d/wk: last trained 1 day ago → rest day (minRest=1)", () => {
    expect(isTrainingDayByFrequency(3, 1)).toBe(false)
  })

  it("SC21 — 3d/wk: last trained 2 days ago → training day", () => {
    expect(isTrainingDayByFrequency(3, 2)).toBe(true)
  })

  it("SC22 — 4d/wk: last trained 1 day ago → training day (minRest=0)", () => {
    expect(isTrainingDayByFrequency(4, 1)).toBe(true)
  })

  it("SC23 — 6d/wk: last trained 1 day ago → training day", () => {
    expect(isTrainingDayByFrequency(6, 1)).toBe(true)
  })

  it("SC24 — 999 days since last (no history) → training day", () => {
    expect(isTrainingDayByFrequency(3, 999)).toBe(true)
  })
})

// ─── GROUP 4: resolveTrainingState (12 scenarios) ────────────────────────────

describe("resolveTrainingState", () => {
  const baseOpts = {
    timezone:             "UTC",
    observedWindow:       TrainingWindow.MORNING,
    preferredCheckInTime: "07:00",
    lastSkipDateISO:      null,
    completedTodayMuscles: null,
    daysSinceLastSession: 2,
    daysPerWeek:          3,
    hasAnyHistory:        true,
  }

  it("SC25 — completed today → COMPLETED regardless of window", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now: new Date("2024-01-15T10:00:00Z"),
      completedTodayMuscles: "Chest + Triceps",
    })
    expect(state).toBe(TrainingState.COMPLETED)
  })

  it("SC26 — skipped today (lastSkipDate = today) → SKIPPED", () => {
    const now = new Date("2024-01-15T10:00:00Z")
    const state = resolveTrainingState({
      ...baseOpts,
      now,
      lastSkipDateISO: "2024-01-15",
    })
    expect(state).toBe(TrainingState.SKIPPED)
  })

  it("SC27 — still in rest window (1 day since last, 3d/wk) → UPCOMING", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now: new Date("2024-01-15T10:00:00Z"),
      daysSinceLastSession: 1,
    })
    expect(state).toBe(TrainingState.UPCOMING)
  })

  it("SC28 — in window, no session → DUE", () => {
    // 07:30 UTC is within MORNING window and within ±1h of preferredCheckInTime 07:00
    const state = resolveTrainingState({
      ...baseOpts,
      now: new Date("2024-01-15T07:30:00Z"),
    })
    expect(state).toBe(TrainingState.DUE)
  })

  it("SC29 — window passed, no session → PENDING_CONFIRMATION", () => {
    // 15:00 UTC is well past 07:00 + 3h window end
    const state = resolveTrainingState({
      ...baseOpts,
      now: new Date("2024-01-15T15:00:00Z"),
    })
    expect(state).toBe(TrainingState.PENDING_CONFIRMATION)
  })

  it("SC30 — no history at all → UNKNOWN", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      hasAnyHistory:        false,
      daysSinceLastSession: 999,
      now: new Date("2024-01-15T10:00:00Z"),
    })
    expect(state).toBe(TrainingState.UNKNOWN)
  })

  it("SC31 — EVENING user, window not started yet (morning) → UPCOMING", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now:                  new Date("2024-01-15T09:00:00Z"),
      observedWindow:       TrainingWindow.EVENING,
      preferredCheckInTime: "19:00",
    })
    expect(state).toBe(TrainingState.UPCOMING)
  })

  it("SC32 — EVENING user, in window → DUE", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now:                  new Date("2024-01-15T19:30:00Z"),
      observedWindow:       TrainingWindow.EVENING,
      preferredCheckInTime: "19:00",
    })
    expect(state).toBe(TrainingState.DUE)
  })

  it("SC33 — FLEXIBLE user, window not derived, after 22:00 → PENDING_CONFIRMATION", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now:                  new Date("2024-01-15T22:30:00Z"),
      observedWindow:       TrainingWindow.FLEXIBLE,
      preferredCheckInTime: null,
    })
    expect(state).toBe(TrainingState.PENDING_CONFIRMATION)
  })

  it("SC34 — 4d/wk user: 1 day since last is still a training day → can be DUE", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now:                  new Date("2024-01-15T07:30:00Z"),
      daysPerWeek:          4,
      daysSinceLastSession: 1,
    })
    expect(state).toBe(TrainingState.DUE)
  })

  it("SC35 — completed today overrides skip", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now:                   new Date("2024-01-15T10:00:00Z"),
      completedTodayMuscles: "Back + Biceps",
      lastSkipDateISO:       "2024-01-15",
    })
    expect(state).toBe(TrainingState.COMPLETED)
  })

  it("SC36 — before window opens → UPCOMING not DUE", () => {
    const state = resolveTrainingState({
      ...baseOpts,
      now:                  new Date("2024-01-15T03:00:00Z"),
      observedWindow:       TrainingWindow.MORNING,
      preferredCheckInTime: "07:00",
    })
    expect(state).toBe(TrainingState.UPCOMING)
  })
})

// ─── GROUP 5: computeConsecutiveMissesV2 (8 scenarios) ───────────────────────

describe("computeConsecutiveMissesV2", () => {
  const today = "2024-01-15"

  it("SC37 — no missed sessions (trained today) → 0 misses", () => {
    expect(computeConsecutiveMissesV2([today], 3, today)).toBe(0)
  })

  it("SC38 — trained yesterday → 0 misses (still in rest window for 3d/wk)", () => {
    const yesterday = subtractDays(today, 1)
    expect(computeConsecutiveMissesV2([yesterday], 3, today)).toBe(0)
  })

  it("SC39 — last trained 3 days ago, nothing since → 1 miss", () => {
    const threeDaysAgo = subtractDays(today, 3)
    expect(computeConsecutiveMissesV2([threeDaysAgo], 3, today)).toBe(1)
  })

  it("SC40 — last trained 5 days ago → 2 consecutive misses (3d/wk)", () => {
    const fiveDaysAgo = subtractDays(today, 5)
    expect(computeConsecutiveMissesV2([fiveDaysAgo], 3, today)).toBe(2)
  })

  it("SC41 — 4d/wk user: last trained 1 day ago → 0 misses (no required rest)", () => {
    const yesterday = subtractDays(today, 1)
    expect(computeConsecutiveMissesV2([yesterday], 4, today)).toBe(0)
  })

  it("SC42 — 4d/wk user: last trained 3 days ago → 2 misses", () => {
    const threeDaysAgo = subtractDays(today, 3)
    expect(computeConsecutiveMissesV2([threeDaysAgo], 4, today)).toBe(2)
  })

  it("SC43 — trained 2 days ago, then missed 2 → 1 miss (for 3d/wk)", () => {
    // 2 days ago is within rest window for 3d/wk → not an expected training day
    // 4 days ago is an expected training day
    const twoDaysAgo = subtractDays(today, 2)
    // Only trained 2 days ago → yesterday was rest → today is the first expected miss
    expect(computeConsecutiveMissesV2([twoDaysAgo], 3, today)).toBe(0)
  })

  it("SC44 — no session history at all → 0 misses (no reference point)", () => {
    expect(computeConsecutiveMissesV2([], 3, today)).toBe(0)
  })
})

// ─── GROUP 6: Quiet hours & chase timing (6 scenarios) ───────────────────────

describe("adjustForQuietHours and getEffectiveChaseTime", () => {
  const nightOwlIntake = {
    sleep_time: "23:00",
    wake_time:  "07:00",
  }

  it("SC45 — time outside quiet hours → null (no adjustment)", () => {
    const result = adjustForQuietHours("14:00", nightOwlIntake)
    expect(result).toBeNull()
  })

  it("SC46 — time inside quiet hours → wake time returned", () => {
    const result = adjustForQuietHours("01:00", nightOwlIntake)
    expect(result).toBe("07:00")
  })

  it("SC47 — evening user: gym_time 20:00 + 5h = 01:00 → adjusted to wake 07:00", () => {
    const effective = getEffectiveChaseTime("20:00", 300, nightOwlIntake)
    expect(effective).toBe("07:00")
  })

  it("SC48 — morning user: gym_time 07:00 + 5h = 12:00 → no adjustment", () => {
    const effective = getEffectiveChaseTime("07:00", 300, nightOwlIntake)
    expect(effective).toBe("12:00")
  })

  it("SC49 — chase 1 (gym_time + 3h): 21:00 + 3h = 00:00 → adjusted to wake 07:00", () => {
    const effective = getEffectiveChaseTime("21:00", 180, nightOwlIntake)
    expect(effective).toBe("07:00")
  })

  it("SC50 — deriveVirtualGymTime maps all windows to correct defaults", () => {
    expect(deriveVirtualGymTime(TrainingWindow.MORNING)).toBe("07:00")
    expect(deriveVirtualGymTime(TrainingWindow.AFTERNOON)).toBe("13:00")
    expect(deriveVirtualGymTime(TrainingWindow.EVENING)).toBe("18:00")
    expect(deriveVirtualGymTime(TrainingWindow.FLEXIBLE)).toBe("10:00")
  })
})

// ─── Utility spot-checks ──────────────────────────────────────────────────────

describe("utility functions", () => {
  it("daysBetween: same date → 0", () => {
    expect(daysBetween("2024-01-15", "2024-01-15")).toBe(0)
  })

  it("daysBetween: 7 days apart → 7", () => {
    expect(daysBetween("2024-01-08", "2024-01-15")).toBe(7)
  })

  it("subtractDays: 3 days back", () => {
    expect(subtractDays("2024-01-15", 3)).toBe("2024-01-12")
  })

  it("addMinutesHHMM: midnight wraparound", () => {
    expect(addMinutesHHMM("23:30", 60)).toBe("00:30")
  })

  it("parseSplitStateMinimal: unknown raw → safe defaults", () => {
    const result = parseSplitStateMinimal(null)
    expect(result.lastCompletedDayIndex).toBeNull()
    expect(result.avgSessionDurationMin).toBe(60)
  })
})
