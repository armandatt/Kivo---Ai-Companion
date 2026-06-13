// ═══════════════════════════════════════════════════════════════════════════════
// PARSING / UNDERSTANDING ENGINE V2
//
// Pure function — no LLM, no DB, no side effects.
// Takes raw message text + conversation context.
// Returns fully structured ParseResult consumed by all downstream systems.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum IntentType {
  // ── Explicit actionable requests ──────────────────────────────────────────
  REMINDER_CREATE         = "reminder_create",
  REMINDER_EDIT           = "reminder_edit",
  REMINDER_DELETE         = "reminder_delete",
  LOG_WORKOUT             = "log_workout",
  LOG_SKIP                = "log_skip",
  LOG_WEIGHT              = "log_weight",
  LOG_SORENESS            = "log_soreness",
  LOG_PAIN                = "log_pain",
  PLAN_REQUEST            = "plan_request",
  ADVICE_REQUEST          = "advice_request",
  RECOMMENDATION_REQUEST  = "recommendation_request",
  NUTRITION_QUERY         = "nutrition_query",
  GOAL_SET                = "goal_set",
  SCHEDULE_UPDATE         = "schedule_update",
  PROGRESS_QUERY          = "progress_query",
  CHECKIN_SCHEDULE        = "checkin_schedule",

  // ── Contextual signals — mentions only, not directives ────────────────────
  RECOVERY_CONTEXT        = "recovery_context",
  PAIN_CONTEXT            = "pain_context",
  INJURY_CONTEXT          = "injury_context",
  FAILURE_SIGNAL          = "failure_signal",
  PROGRESS_CONTEXT        = "progress_context",
  MOOD_CONTEXT            = "mood_context",
  AVAILABILITY_CONTEXT    = "availability_context",
  TRAVEL_CONTEXT          = "travel_context",
  NUTRITION_CONTEXT       = "nutrition_context",
  ENERGY_CONTEXT          = "energy_context",

  // ── Conversational ────────────────────────────────────────────────────────
  CONFIRMATION            = "confirmation",
  REJECTION               = "rejection",
  ACKNOWLEDGEMENT         = "acknowledgement",
  GENERAL_CHAT            = "general_chat",

  // ── Flow-specific answers (stateful) ──────────────────────────────────────
  ONBOARDING_ANSWER       = "onboarding_answer",
  TRAINING_WINDOW_ANSWER  = "training_window_answer",
  SESSION_FEEL_ANSWER     = "session_feel_answer",
  SESSION_CONFIRMATION    = "session_confirmation",
  DAYS_PER_WEEK_ANSWER    = "days_per_week_answer",
}

export enum EntityType {
  TIME            = "time",
  DATE            = "date",
  FREQUENCY       = "frequency",
  MUSCLE_GROUP    = "muscle_group",
  INJURY          = "injury",
  FOOD            = "food",
  EXERCISE        = "exercise",
  GOAL_REF        = "goal_ref",
  REMINDER_TARGET = "reminder_target",
  LOCATION        = "location",
  DURATION        = "duration",
  WEIGHT_KG       = "weight_kg",
  TEMPORAL_REF    = "temporal_ref",
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IntentResult {
  type:                  IntentType
  confidence:            number       // 0.0–1.0
  evidence:              string[]     // fragments that triggered this intent
  isActionable:          boolean      // executable directive vs contextual mention
  requiresClarification: boolean
  action?:               string       // create_reminder | log_session | etc.
  target?:               string       // what the action targets
  frequency?:            string       // for reminder intents
}

export interface ExtractedEntity {
  type:        EntityType
  value:       string
  raw:         string       // original fragment from message
  normalized?: string       // canonical form (ISO time, lowercase muscle, etc.)
}

export interface ConversationMessage {
  role:    "user" | "assistant"
  text:    string
  intent?: string
}

export interface ParseContext {
  recentMessages:          ConversationMessage[]
  currentOnboardingStep?:  string    // e.g. "ga_schedule", "ga_gym_time"
  hasPendingReminder?:     boolean
  hasPendingConfirmation?: boolean
}

export interface ParseResult {
  intents:               IntentResult[]
  entities:              ExtractedEntity[]
  signals:               string[]        // "PAIN_MENTIONED", "RECOMMENDATION_BLOCKED", etc.
  actionableIntent:      IntentResult | null
  confidence:            number
  requiresClarification: boolean
  reasoning:             string
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Reminder ─────────────────────────────────────────────────────────────────
const REMINDER_VERB_RE    = /\b(?:remind(?:ers?)?(?:\s+me)?|ping(?:\s+me)?|alert(?:\s+me)?|notify(?:\s+me)?|set\s+(?:a\s+)?reminders?|keep\s+reminding(?:\s+me)?|make\s+sure\s+(?:i|I)\s|send\s+(?:me\s+a\s+)?reminders?|need\s+(?:a\s+)?\w+\s+reminders?)\b/i
// Implicit reminder: "[thing] every [frequency]" (no verb, inferred)
const IMPLICIT_REMINDER_RE = /\b\w[\w\s]{0,20}\s+every\s+(?:\d+\s*(?:hours?|hr|mins?|minutes?|days?)|hour|day|morning|evening)\b/i
const REMINDER_DELETE_RE  = /\b(?:stop|cancel|remove|delete|disable|turn\s+off)\b.{0,25}\b(?:reminders?|ping|alert)\b/i
const REMINDER_EDIT_RE    = /\b(?:change|update|edit|switch|modify|move|reschedule)\b.{0,30}\b(?:reminders?|ping|alert)\b/i
const FREQUENCY_NUM_RE    = /\bevery\s+(\d+)\s*(hours?|hr|mins?|minutes?|days?)\b/i
const EVERY_HOUR_RE       = /\bevery\s+hour\b|\bhourly\b/i
const EVERY_30MIN_RE      = /\bevery\s+(?:30\s*(?:min|minute)|half\s*hour)\b/i
const DAILY_RE            = /\bdaily\b|\bevery\s+day\b/i

// ─── Recommendation gate ──────────────────────────────────────────────────────
// Explicit requests that permit recommendation output
const RECOMMEND_REQUEST_RE = /\b(?:what\s+should\s+(?:i|I)|(?:can\s+you\s+)?(?:suggest|recommend)|what\s+(?:exercises?|workouts?|splits?|can\s+(?:i|I))|how\s+(?:do\s+(?:i|I)|can\s+(?:i|I)|should\s+(?:i|I))\s+(?:train|fix|improve|work|deal|handle|build|get)|what.?s\s+the\s+best\s+(?:way|approach|method)\s+to|help\s+(?:me\s+(?:with|build|create|fix)|with\s+my)|(?:create|make|build|give\s+me)\s+(?:me\s+a\s+)?(?:a\s+)?(?:workout\s+plan|workout|plan|program|split|routine|meal\s+plan)|is\s+it\s+(?:okay|safe|ok)\s+to|should\s+(?:i|I)\s+(?:still\s+)?(?:train|workout|exercise|lift))\b/i

// ─── Pain / injury ────────────────────────────────────────────────────────────
const PAIN_WORDS_RE  = /\b(?:pain|hurt(?:ing|s)?|sore|ache|achy|tight|strain(?:ed)?|tweak(?:ed)?|injur(?:y|ed|ies)|sprain(?:ed)?|pulled?|popped?|snapped?|clicking|burning|pinching|tender)\b/i
const INJURY_SEVERE_RE = /\b(?:torn|tore|tear|fracture|break|broken|dislocated|ruptured)\b/i
const BODY_PART_RE  = /\b(?:knee|shoulder|back|wrist|elbow|hip|ankle|neck|chest|quad|hamstring|glute|lat|trap|calf|calves|arm|leg|lower\s+back|upper\s+back|rotator\s+cuff|bicep|tricep)\b/i

// ─── Failure / skip ───────────────────────────────────────────────────────────
const FAILURE_RE = /\b(?:skipped?|missed|couldn'?t|didn'?t(?:\s+(?:go|train|workout|make\s+it))?|no\s+(?:gym|workout|training|session)\s*(?:today)?|bailed|failed\s+to|haven'?t\s+(?:trained|gone)|haven'?t\s+been)\b/i

// ─── Mood / emotional ─────────────────────────────────────────────────────────
const MOOD_NEG_RE = /\b(?:stressed|overwhelmed|anxious|depressed|demotivated|unmotivated|burnt?\s*out|burnt?\s*out|losing\s+motivation|no\s+motivation|feeling\s+(?:low|down|off|terrible|awful|hopeless)|want(?:ing)?\s+to\s+quit|giving\s+up|can'?t\s+do\s+this|too\s+much)\b/i
const MOOD_POS_RE = /\b(?:feeling\s+(?:great|amazing|fantastic|strong|good|pumped|motivated|on\s+fire)|crushed\s+(?:it|today)|nailed\s+it|on\s+point|locked\s+in|fired\s+up)\b/i

// ─── Travel / availability ────────────────────────────────────────────────────
const TRAVEL_RE = /\b(?:travel(?:l?ing|l?ed)?|going\s+(?:away|out\s+of\s+town)|on\s+a\s+trip|out\s+of\s+town|away\s+(?:next|this)\s+week|leaving\s+(?:tomorrow|next)|vacation|holiday)\b/i
const BUSY_RE   = /\b(?:busy|no\s+time|too\s+much\s+(?:on|going\s+on)|schedule\s+(?:is\s+)?(?:packed|full|crazy)|work(?:ing)?\s+(?:a\s+lot|overtime|long\s+hours)|no\s+free\s+time)\b/i

// ─── Short reply classification ───────────────────────────────────────────────
const AFFIRM_RE = /^(?:yeah|yes|yep|yup|ya|sure|okay|ok|fine|alright|absolutely|definitely|of\s+course|correct|right|exactly|confirmed?|done|for\s+sure|totally|yep\s+done|did\s+it|yess+|perfect|great|awesome|nice|love\s+it|all\s+good|aight|ight|aiight|good(?:\s+(?:with\s+(?:this|that|it)|to\s+go|enough))?|looks?\s+good(?:\s+to\s+me)?|works?(?:\s+for\s+me)?|sounds?\s+good(?:\s+to\s+me)?|let'?s\s+(?:do\s+it|go)|i'?m\s+good|im\s+good)\.?!?$/i
const DENY_RE   = /^(?:no|nope|nah|na|not\s+really|not\s+yet|not\s+today|haven'?t|didn'?t|nahh|incorrect|wrong|negative|not\s+(?:good|right|correct)|that'?s\s+(?:not\s+right|wrong)|thats\s+(?:not\s+right|wrong)|change\s+it|don'?t\s+like\s+it|dont\s+like\s+it)\.?!?$/i
const ACK_RE    = /^(?:k|kay|kk|ok|okay|thanks?|cool|got\s+it|noted|understood|roger|makes?\s+sense)\.?!?$/i

// Non-anchored — matches a modification request anywhere in the text
// (e.g. "swap chest and back day", "can you change the split").
const MODIFICATION_RE = /\b(?:swap|change|modify|replace|add|remove|different|adjust|redo|switch|move)\b/i

// ─── Confirmation / rejection — exported for reuse outside this engine ─────────
// These are the SOURCE OF TRUTH for "is this an affirmation / rejection /
// modification request" across the codebase. Other engines (e.g. onboarding)
// should consume these instead of maintaining their own exact-match Sets.
export function isAffirmative(text: string): boolean {
  return AFFIRM_RE.test(text.trim())
}
export function isNegative(text: string): boolean {
  return DENY_RE.test(text.trim())
}
export function isModificationRequest(text: string): boolean {
  return MODIFICATION_RE.test(text)
}

// ─── Onboarding step → expected answer type ───────────────────────────────────
const ONBOARDING_STEP_MAP: Record<string, IntentType> = {
  ga_name:      IntentType.ONBOARDING_ANSWER,
  ga_goal:      IntentType.ONBOARDING_ANSWER,
  ga_body:      IntentType.ONBOARDING_ANSWER,
  ga_drill:     IntentType.ONBOARDING_ANSWER,
  ga_lifts:     IntentType.ONBOARDING_ANSWER,
  ga_schedule:  IntentType.DAYS_PER_WEEK_ANSWER,
  ga_split:     IntentType.ONBOARDING_ANSWER,
  ga_gym_time:  IntentType.TRAINING_WINDOW_ANSWER,
  ga_nutrition: IntentType.ONBOARDING_ANSWER,
  ga_injuries:  IntentType.ONBOARDING_ANSWER,
  ga_review:    IntentType.ONBOARDING_ANSWER,
}

// ─── Question-type detection in last assistant message ────────────────────────
const Q_SESSION_DONE_RE   = /(?:did|does|have).{0,20}(?:session|workout|training|train|it\s+happen)|did\s+you\s+(?:go|train|workout)/i
const Q_FEEL_RE           = /how\s+did\s+(?:that|it|the\s+session)\s+feel|easy,\s+hard|how\s+was\s+(?:that|it|the\s+session)/i
const Q_DAYS_WEEK_RE      = /how\s+many\s+days?\s+(?:a\s+week|per\s+week)|days?\s+(?:a\s+week|per\s+week|you\s+(?:train|workout))/i
const Q_TIME_RE           = /what\s+time|when\s+do\s+you\s+(?:train|workout|gym)|(?:training|gym)\s+(?:time|window)/i
const Q_SPLIT_RE          = /(?:your\s+)?split|ppl|upper.?lower|push.?pull/i
const Q_GENERAL_YES_NO_RE = /[?]$/i

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY EXTRACTORS
// ═══════════════════════════════════════════════════════════════════════════════

function extractFrequency(text: string): ExtractedEntity | null {
  const numMatch = FREQUENCY_NUM_RE.exec(text)
  if (numMatch) {
    const n    = parseInt(numMatch[1]!)
    const unit = numMatch[2]!.toLowerCase()
    const mins = unit.startsWith("h") ? n * 60 : unit.startsWith("d") ? n * 24 * 60 : n
    return {
      type:       EntityType.FREQUENCY,
      value:      `every ${n} ${unit}`,
      raw:        numMatch[0],
      normalized: `${mins}min`,
    }
  }
  if (EVERY_HOUR_RE.test(text)) {
    return { type: EntityType.FREQUENCY, value: "every 1 hour", raw: "every hour", normalized: "60min" }
  }
  if (EVERY_30MIN_RE.test(text)) {
    return { type: EntityType.FREQUENCY, value: "every 30 min", raw: text, normalized: "30min" }
  }
  if (DAILY_RE.test(text)) {
    return { type: EntityType.FREQUENCY, value: "daily", raw: "daily", normalized: "1440min" }
  }
  return null
}

function extractReminderTarget(text: string): ExtractedEntity | null {
  // "remind me (every X) to X" / "keep reminding me to X" / "ping me (every X) for X"
  const verbMatch = text.match(
    /\b(?:keep\s+)?(?:remind(?:ing)?(?:\s+me)?|ping(?:\s+me)?)(?:\s+every\s+\S+)?\s+(?:to\s+|for\s+)?(.{3,50}?)(?:\s+and\b|\s+also\b|\s+btw\b|$)/i
  )
  if (verbMatch?.[1]?.trim()) {
    const value = verbMatch[1].trim()
    if (value.length >= 3) return { type: EntityType.REMINDER_TARGET, value, raw: verbMatch[0] }
  }
  // "reminder to/for/about X" or "[X] reminder"
  const nounMatch = text.match(/(?:(\w[\w\s]{0,25}?)\s+)?reminders?\s*(?:\s+(?:to|for|about)\s+(.{3,40}?))?(?:\s+and\b|\s+also\b|$)/i)
  if (nounMatch) {
    const target = (nounMatch[2] ?? nounMatch[1] ?? "").trim()
    if (target.length >= 3) return { type: EntityType.REMINDER_TARGET, value: target, raw: nounMatch[0] }
  }
  // "make sure I X"
  const makeMatch = text.match(/\bmake\s+sure\s+(?:i|I)\s+(.{3,40}?)(?:\s+and\b|\s+also\b|$)/i)
  if (makeMatch?.[1]?.trim()) {
    const value = makeMatch[1].trim()
    return { type: EntityType.REMINDER_TARGET, value, raw: makeMatch[0] }
  }
  return null
}

function extractTime(text: string): ExtractedEntity | null {
  const twelveHour = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (twelveHour) {
    let h = parseInt(twelveHour[1]!), m = parseInt(twelveHour[2] ?? "0")
    const p = twelveHour[3]!.toLowerCase()
    if (p === "pm" && h < 12) h += 12
    if (p === "am" && h === 12) h = 0
    const norm = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`
    return { type: EntityType.TIME, value: twelveHour[0], raw: twelveHour[0], normalized: norm }
  }
  const twentyFour = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (twentyFour) {
    return { type: EntityType.TIME, value: twentyFour[0], raw: twentyFour[0], normalized: twentyFour[0] }
  }
  return null
}

function extractTemporalRef(text: string): ExtractedEntity | null {
  const t = text.toLowerCase()
  const refs: Record<string, string> = {
    "tonight":      "today_evening",
    "today":        "today",
    "tomorrow":     "tomorrow",
    "next week":    "next_week",
    "this weekend": "this_weekend",
    "before bed":   "bedtime",
    "after work":   "after_work",
    "after office": "after_work",
    "after gym":    "post_workout",
    "after class":  "after_class",
    "in the morning": "morning",
    "in the evening": "evening",
    "morning":      "morning",
    "evening":      "evening",
    "afternoon":    "afternoon",
    "later":        "later_today",
  }
  for (const [phrase, normalized] of Object.entries(refs)) {
    if (t.includes(phrase)) {
      return { type: EntityType.TEMPORAL_REF, value: phrase, raw: phrase, normalized }
    }
  }
  return null
}

function extractMuscleGroups(text: string): ExtractedEntity[] {
  const muscles: Record<string, string> = {
    "chest":       "chest",
    "back":        "back",
    "legs?":       "legs",
    "shoulders?":  "shoulders",
    "arms?":       "arms",
    "biceps?":     "biceps",
    "triceps?":    "triceps",
    "lats?":       "lats",
    "quads?":      "quads",
    "hamstrings?": "hamstrings",
    "glutes?":     "glutes",
    "calves?":     "calves",
    "traps?":      "traps",
  }
  const found: ExtractedEntity[] = []
  for (const [pattern, normalized] of Object.entries(muscles)) {
    const re = new RegExp(`\\b${pattern}\\b`, "i")
    const m  = re.exec(text)
    if (m) found.push({ type: EntityType.MUSCLE_GROUP, value: m[0], raw: m[0], normalized })
  }
  return found
}

function extractWeightKg(text: string): ExtractedEntity | null {
  const kgMatch = text.match(/\b(\d{2,3}(?:\.\d)?)\s*(?:kg|kilos?)\b/i)
  if (kgMatch) {
    return { type: EntityType.WEIGHT_KG, value: kgMatch[0], raw: kgMatch[0], normalized: kgMatch[1] + "kg" }
  }
  const lbsMatch = text.match(/\b(\d{2,3}(?:\.\d)?)\s*(?:lbs?|pounds?)\b/i)
  if (lbsMatch) {
    const kg = Math.round(parseFloat(lbsMatch[1]!) * 0.453592 * 10) / 10
    return { type: EntityType.WEIGHT_KG, value: lbsMatch[0], raw: lbsMatch[0], normalized: `${kg}kg` }
  }
  return null
}

function extractAllEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const freq = extractFrequency(text);    if (freq)     entities.push(freq)
  const target = extractReminderTarget(text); if (target) entities.push(target)
  const time = extractTime(text);         if (time)     entities.push(time)
  const temp = extractTemporalRef(text);  if (temp)     entities.push(temp)
  const muscles = extractMuscleGroups(text); entities.push(...muscles)
  const weight = extractWeightKg(text);   if (weight)   entities.push(weight)
  return entities
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT DETECTORS
// Each returns an IntentResult if the pattern fires, null otherwise.
// ═══════════════════════════════════════════════════════════════════════════════

function makeIntent(
  type:        IntentType,
  confidence:  number,
  evidence:    string[],
  isActionable: boolean,
  opts:        Partial<IntentResult> = {},
): IntentResult {
  return { type, confidence, evidence, isActionable, requiresClarification: false, ...opts }
}

function detectReminderCreate(text: string): IntentResult | null {
  const hasVerb     = REMINDER_VERB_RE.test(text)
  const hasImplicit = IMPLICIT_REMINDER_RE.test(text)

  if (!hasVerb && !hasImplicit) return null
  if (REMINDER_DELETE_RE.test(text)) return null  // deletion takes precedence

  const freq     = extractFrequency(text)
  const target   = extractReminderTarget(text)
  const evidence = [text.slice(0, 60)]

  // High confidence: both frequency and target clear
  if (freq && target) {
    return makeIntent(IntentType.REMINDER_CREATE, 0.97, evidence, true, {
      action: "create_reminder", target: target.value, frequency: freq.normalized,
    })
  }

  // Implicit reminder ("water every hour please") — freq-only, target inferred
  if (hasImplicit && freq && !hasVerb) {
    // Extract the implicit target (word(s) before "every")
    const implicitTarget = text.match(/\b(\w[\w\s]{0,20}?)\s+every\s+/i)?.[1]?.trim()
    return makeIntent(IntentType.REMINDER_CREATE, 0.84, evidence, true, {
      action: "create_reminder",
      target: implicitTarget ?? undefined,
      frequency: freq.normalized,
    })
  }

  // Verb found, partial info
  // If verb + target are both present, we can act; only require clarification when both missing
  return makeIntent(IntentType.REMINDER_CREATE, 0.82, evidence, true, {
    action:                "create_reminder",
    target:                target?.value,
    frequency:             freq?.normalized,
    requiresClarification: !target && !freq,
  })
}

function detectReminderDelete(text: string): IntentResult | null {
  if (!REMINDER_DELETE_RE.test(text)) return null
  return makeIntent(IntentType.REMINDER_DELETE, 0.90, [text.slice(0, 60)], true, { action: "delete_reminder" })
}

function detectLogSkip(text: string): IntentResult | null {
  // Natural-language skip: "can't train today", "won't make it", "not going today", etc.
  const hasNaturalSkip = /\b(?:can.?t|cannot|won.?t|will\s+not)\s+(?:train(?:ing)?|make\s+it|get\s+to\s+(?:the\s+)?gym|go(?:\s+to\s+(?:the\s+)?gym)?)|not\s+(?:going\s+(?:today|to\s+(?:the\s+)?gym)?|making\s+it\s+today|able\s+to\s+(?:train|workout|go)|training\s+today)|missing\s+today.?s\s+(?:workout|session|gym)\b/i.test(text)
  if (hasNaturalSkip) {
    return makeIntent(IntentType.LOG_SKIP, 0.88, [text.slice(0, 60)], true, { action: "log_skip" })
  }
  if (!FAILURE_RE.test(text)) return null
  const isExplicitLog  = /\b(?:log|record|mark|note|save)\b/i.test(text)
  // "Skipped push today", "missed chest day" — gym-context skips are inherently log requests
  const hasSessionSkip = /\b(?:skipped?|missed)\s+(?:gym|workout|training|session|push|pull|legs?|chest|back|shoulders?|arms?|today)\b/i.test(text)
  if (isExplicitLog || hasSessionSkip) {
    // Retrospective skip report ("skipped legs today") — below REMINDER_CREATE minimum (0.82)
    // so any explicit user directive wins when both coexist.
    return makeIntent(IntentType.LOG_SKIP, 0.80, [text.slice(0, 60)], true, { action: "log_skip" })
  }
  return null
}

function detectFailureSignal(text: string): IntentResult | null {
  if (!FAILURE_RE.test(text)) return null
  return makeIntent(IntentType.FAILURE_SIGNAL, 0.85, [text.slice(0, 60)], false)
}

function detectPainContext(text: string): IntentResult | null {
  if (!PAIN_WORDS_RE.test(text) && !INJURY_SEVERE_RE.test(text)) return null

  const hasSevere = INJURY_SEVERE_RE.test(text)
  const hasBody   = BODY_PART_RE.test(text)

  // Only flag if there's a body-part reference or clearly a pain report
  if (!hasBody && !hasSevere) {
    // Generic "sore" without body part — still flag but lower confidence
    const sorenessMatch = /\bsore\b/i.test(text)
    if (!sorenessMatch) return null
    return makeIntent(IntentType.PAIN_CONTEXT, 0.70, [text.slice(0, 60)], false)
  }

  const type = hasSevere ? IntentType.INJURY_CONTEXT : IntentType.PAIN_CONTEXT
  return makeIntent(type, hasBody ? 0.91 : 0.78, [text.slice(0, 60)], false)
}

function detectRecommendationRequest(text: string): IntentResult | null {
  if (!RECOMMEND_REQUEST_RE.test(text)) return null
  // Require minimum text length to avoid false positives on short queries
  return makeIntent(IntentType.RECOMMENDATION_REQUEST, 0.88, [text.slice(0, 60)], true, {
    action: "generate_recommendation",
  })
}

function detectAdviceRequest(text: string): IntentResult | null {
  // Covers "help me with X", "I need advice on X", "guidance on X"
  if (!/(help\s+me\s+with|i\s+need\s+(?:advice|guidance|help)\s+(?:on|about|with)|give\s+me\s+(?:advice|guidance)|can\s+you\s+help)/i.test(text)) return null
  return makeIntent(IntentType.ADVICE_REQUEST, 0.84, [text.slice(0, 60)], true, { action: "give_advice" })
}

function detectNutritionQuery(text: string): IntentResult | null {
  const explicit = /\b(?:how\s+much\s+protein|protein\s+(?:intake|goal|target|sources?)|what\s+(?:should\s+i\s+eat|to\s+eat)|macro(?:s|nutrients)?|calori(?:es?)\s+(?:intake|goal|target)|diet\s+(?:plan|advice|tip))\b/i.test(text)
  const context  = /\b(?:eating|food|meal|diet|protein|calories?|macros?|nutrition)\b/i.test(text)
  if (!explicit && !context) return null
  if (explicit) return makeIntent(IntentType.NUTRITION_QUERY, 0.89, [text.slice(0, 60)], true)
  // Context mention only — nutrition context not a query
  return null
}

function detectNutritionContext(text: string): IntentResult | null {
  if (!/\b(?:eating|food|meal|diet|protein|calories?|macros?|nutrition|ate|had|eaten|having)\b/i.test(text)) return null
  if (detectNutritionQuery(text)) return null
  // Explicit food consumption verb + specific food → higher confidence
  const hasConsumptionVerb = /\b(?:ate|had|eaten|eating|having)\b/i.test(text)
  const hasSpecificFood    = /\b(?:chicken|eggs?|rice|oats?|fish|meat|dal|paneer|salad|bread|pasta|fruit|milk|curd|yogurt|nuts?|veggies?|vegetables?|sandwich|smoothie|shake|whey|supplement)\b/i.test(text)
  const conf = (hasConsumptionVerb && hasSpecificFood) ? 0.82 : 0.72
  return makeIntent(IntentType.NUTRITION_CONTEXT, conf, [text.slice(0, 40)], false)
}

function detectMoodContext(text: string): IntentResult | null {
  if (!MOOD_NEG_RE.test(text) && !MOOD_POS_RE.test(text)) return null
  return makeIntent(IntentType.MOOD_CONTEXT, 0.80, [text.slice(0, 60)], false)
}

function detectTravelContext(text: string): IntentResult | null {
  if (!TRAVEL_RE.test(text) && !BUSY_RE.test(text)) return null
  return makeIntent(IntentType.AVAILABILITY_CONTEXT, 0.80, [text.slice(0, 60)], false)
}

function detectLogWorkout(text: string): IntentResult | null {
  const done = /\b(?:just\s+(?:finished|done|wrapped\s+up|completed|got\s+back\s+from)|done\s+with\s+(?:my|the|a)?\s*(?:workout|training|session|gym|lift)|workout\s+(?:done|complete|finished|over|crushed)|crushed\s+(?:it|today|the\s+workout|my\s+session)|back\s+from\s+(?:the\s+)?gym|session\s+(?:done|complete)|hit\s+the\s+gym|hit\s+(?:legs?|chest|back|shoulders?|arms?|quads?|hamstrings?|glutes?|pull|push)\s+today)\b/i.test(text)
  // Explicit lift log: "bench 75 x 8", "squat 100kg 3x5", "deadlift 3 sets"
  const explicitLift = /\b(?:bench|squat|deadlift|press(?:ing)?|rows?|curls?|pull.?ups?|dips?)\b.{0,30}\b\d+\b/i.test(text)
  if (!done && !explicitLift) return null
  return makeIntent(IntentType.LOG_WORKOUT, 0.88, [text.slice(0, 60)], true, { action: "log_session" })
}

function detectGoalSet(text: string): IntentResult | null {
  if (!/\b(?:my\s+goal|i\s+(?:want|need|plan)\s+to|i'?m\s+(?:trying|aiming|planning)\s+to|want\s+to\s+(?:lose|gain|build|get|become)|my\s+target|new\s+goal)\b/i.test(text)) return null
  return makeIntent(IntentType.GOAL_SET, 0.82, [text.slice(0, 60)], true, { action: "set_goal" })
}

function detectPlanRequest(text: string): IntentResult | null {
  if (!/\b(?:plan\s+my\s+(?:week|day)|make(?:\s+me)?\s+a\s+(?:plan|schedule)|build(?:\s+me)?\s+a\s+(?:plan|routine|workout\s+plan|workout)|create(?:\s+me)?\s+a\s+(?:plan|program|routine|workout\s+plan|workout)|create\s+(?:a\s+)?workout\s+plan|update\s+(?:my\s+)?plan|help\s+me\s+plan|weekly\s+(?:plan|schedule))\b/i.test(text)) return null
  return makeIntent(IntentType.PLAN_REQUEST, 0.90, [text.slice(0, 60)], true, { action: "build_plan" })
}

function detectProgressQuery(text: string): IntentResult | null {
  if (!/\b(?:how\s+am\s+i\s+doing|my\s+(?:progress|stats?|performance|numbers?)|show\s+(?:me\s+)?(?:my\s+)?(?:progress|stats?)|am\s+i\s+on\s+track|progress\s+(?:check|update))\b/i.test(text)) return null
  return makeIntent(IntentType.PROGRESS_QUERY, 0.83, [text.slice(0, 60)], true)
}

function detectCheckinSchedule(text: string): IntentResult | null {
  const hasVerb = /\b(?:check(?:\s+(?:me|on\s+me|in|back))?|remind(?:\s+me)?|ping(?:\s+me)?|text\s+me|follow\s+up|hit\s+me\s+up|let\s+me\s+know|catch(?:\s+me)?)\b/i.test(text)
  const hasTime = /\b(\d{1,3})\s*(?:min|mins?|minutes?|hour|hours?|hr|hrs?)\b/i.test(text)
  const hasTrig = /\b(?:every|in|after|within)\b/i.test(text)
  if (hasVerb && hasTime && hasTrig) {
    return makeIntent(IntentType.CHECKIN_SCHEDULE, 0.91, [text.slice(0, 60)], true, {
      action: "schedule_checkin",
    })
  }
  return null
}

function detectReminderEdit(text: string): IntentResult | null {
  if (!REMINDER_EDIT_RE.test(text)) return null
  return makeIntent(IntentType.REMINDER_EDIT, 0.88, [text.slice(0, 60)], true, { action: "edit_reminder" })
}

function detectLogWeight(text: string): IntentResult | null {
  const hasWeightVerb = /\b(?:i\s+(?:weigh|am\s+\d|weight)|(?:my\s+)?(?:bodyweight|body\s+weight|current\s+weight)\s+(?:is|was|:|=)|weighed?\s+in\s+at)\b/i.test(text)
  if (!hasWeightVerb) return null
  if (!extractWeightKg(text)) return null
  return makeIntent(IntentType.LOG_WEIGHT, 0.88, [text.slice(0, 60)], true, { action: "log_weight" })
}

const LOG_SORENESS_RE = /\b(?:(?:chest|legs?|back|shoulders?|arms?|biceps?|triceps?|lats?|quads?|hamstrings?|glutes?|calves?|traps?)\s+(?:is|are|feels?|feeling)?\s*(?:sore|tender|tight|stiff|aching|achy|fatigued)|(?:soreness|DOMS)\s+(?:in\s+)?(?:my\s+)?(?:chest|legs?|back|shoulders?|arms?|quads?|hamstrings?|glutes?|calves?))\b/i

function detectLogSoreness(text: string): IntentResult | null {
  if (!LOG_SORENESS_RE.test(text)) return null
  return makeIntent(IntentType.LOG_SORENESS, 0.85, [text.slice(0, 60)], true, { action: "log_soreness" })
}

const LOG_PAIN_RE = /\b(?:(?:knee|shoulder|wrist|elbow|hip|ankle|neck|lower\s+back|upper\s+back)\s+(?:is\s+)?(?:pain(?:ful)?|hurt(?:ing|s)?|aching|achy)|(?:pain|hurt(?:ing|s)?)\s+(?:in\s+(?:my\s+)?)?(?:knee|shoulder|wrist|elbow|hip|ankle|neck|back))\b/i

function detectLogPain(text: string): IntentResult | null {
  if (!LOG_PAIN_RE.test(text)) return null
  return makeIntent(IntentType.LOG_PAIN, 0.86, [text.slice(0, 60)], true, { action: "log_pain" })
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISAMBIGUATION — short replies and stateful answers
// ═══════════════════════════════════════════════════════════════════════════════

function getLastAssistantMessage(context: ParseContext): string {
  return context.recentMessages
    .filter(m => m.role === "assistant")
    .at(-1)?.text ?? ""
}

function disambiguateByConversationState(
  text:    string,
  context: ParseContext,
): IntentResult | null {
  const t    = text.trim().toLowerCase()
  const last = getLastAssistantMessage(context)

  // ── Onboarding step takes priority ────────────────────────────────────────
  const step = context.currentOnboardingStep
  if (step && ONBOARDING_STEP_MAP[step]) {
    const intentType = ONBOARDING_STEP_MAP[step]!
    if (step === "ga_schedule") {
      const numMatch = t.match(/^\d+$/)
      if (numMatch) return makeIntent(IntentType.DAYS_PER_WEEK_ANSWER, 0.95, [text], false)
    }
    if (step === "ga_gym_time") {
      if (/^(?:morning|evening|afternoon|night|am|pm|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\s*$/i.test(t)) {
        return makeIntent(IntentType.TRAINING_WINDOW_ANSWER, 0.93, [text], false)
      }
    }
    // Generic onboarding answer
    return makeIntent(intentType, 0.85, [text], false)
  }

  // ── Session done question ──────────────────────────────────────────────────
  if (Q_SESSION_DONE_RE.test(last)) {
    if (AFFIRM_RE.test(t) || /^(?:yep\s+done|did\s+it|trained|went|went\s+today|finished)$/i.test(t)) {
      return makeIntent(IntentType.SESSION_CONFIRMATION, 0.93, [text], true, {
        action: "confirm_session",
      })
    }
    if (DENY_RE.test(t) || /^(?:not\s+today|skipped|missed|didn'?t)$/i.test(t)) {
      return makeIntent(IntentType.FAILURE_SIGNAL, 0.90, [text], false)
    }
  }

  // ── Feel question ──────────────────────────────────────────────────────────
  if (Q_FEEL_RE.test(last)) {
    if (/^(?:easy|moderate|hard|tough|failed|okay|solid|rough|great|brutal|light|very\s+hard|really\s+hard)$/i.test(t)) {
      return makeIntent(IntentType.SESSION_FEEL_ANSWER, 0.93, [text], false)
    }
  }

  // ── Days per week question ─────────────────────────────────────────────────
  if (Q_DAYS_WEEK_RE.test(last)) {
    const numMatch = t.match(/^\d+$/)
    if (numMatch) return makeIntent(IntentType.DAYS_PER_WEEK_ANSWER, 0.94, [text], false)
  }

  // ── Training time / window question ───────────────────────────────────────
  if (Q_TIME_RE.test(last)) {
    if (/^(?:morning|evening|afternoon|night|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)$/i.test(t)) {
      return makeIntent(IntentType.TRAINING_WINDOW_ANSWER, 0.92, [text], false)
    }
  }

  // ── General yes/no question ────────────────────────────────────────────────
  if (Q_GENERAL_YES_NO_RE.test(last)) {
    if (AFFIRM_RE.test(t)) return makeIntent(IntentType.CONFIRMATION, 0.80, [text], false)
    if (DENY_RE.test(t))   return makeIntent(IntentType.REJECTION, 0.80, [text], false)
  }

  // ── Standalone acknowledgement ─────────────────────────────────────────────
  if (ACK_RE.test(t)) return makeIntent(IntentType.ACKNOWLEDGEMENT, 0.75, [text], false)
  if (AFFIRM_RE.test(t)) return makeIntent(IntentType.CONFIRMATION, 0.65, [text], false, { requiresClarification: true })
  if (DENY_RE.test(t))   return makeIntent(IntentType.REJECTION, 0.65, [text], false, { requiresClarification: true })

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION SAFETY GATE
// ═══════════════════════════════════════════════════════════════════════════════

function applyRecommendationGate(
  intents: IntentResult[],
  signals: string[],
): { intents: IntentResult[]; signals: string[] } {
  const hasPain          = intents.some(i => i.type === IntentType.PAIN_CONTEXT || i.type === IntentType.INJURY_CONTEXT)
  const hasInjury        = intents.some(i => i.type === IntentType.INJURY_CONTEXT)
  const hasExplicitReq   = intents.some(i => i.type === IntentType.RECOMMENDATION_REQUEST || i.type === IntentType.ADVICE_REQUEST)
  // Other actionable intents that are not recommendation-type and not pain-logging
  // (LOG_PAIN/LOG_SORENESS are the same pain mention, not a separate directive —
  // they should not suppress RECOMMENDATION_BLOCKED)
  const hasOtherActionable = intents.some(i =>
    i.isActionable &&
    i.type !== IntentType.RECOMMENDATION_REQUEST &&
    i.type !== IntentType.ADVICE_REQUEST &&
    i.type !== IntentType.LOG_PAIN &&
    i.type !== IntentType.LOG_SORENESS
  )

  const outSignals = [...signals]
  const outIntents = [...intents]

  if (hasPain) {
    outSignals.push("PAIN_MENTIONED")
    // Emit INJURY_CONTEXT as a distinct signal when severity warrants it —
    // the LLM uses this to apply stricter safety rules (require location/severity/duration).
    if (hasInjury) outSignals.push("INJURY_CONTEXT")

    if (!hasExplicitReq) {
      // Only add RECOMMENDATION_BLOCKED when it's a pure context mention with no other actionable
      // intent (i.e. "chest is sore" alone, not "chest is sore + remind me")
      if (!hasOtherActionable) {
        outSignals.push("RECOMMENDATION_BLOCKED")
      }
      // Demote any accidental recommendation intents (should not exist without explicit request)
      for (const intent of outIntents) {
        if (intent.type === IntentType.RECOMMENDATION_REQUEST) {
          intent.confidence = Math.min(intent.confidence, 0.30)
          intent.requiresClarification = true
        }
      }
    }
  }

  return { intents: outIntents, signals: outSignals }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

// LOG_PAIN and LOG_SORENESS are excluded — they are passive auto-logging signals,
// not user directives. Including them would suppress RECOMMENDATION_BLOCKED for
// pure pain mentions like "my back hurts".
const ACTIONABLE_TYPES = new Set<IntentType>([
  IntentType.REMINDER_CREATE,
  IntentType.REMINDER_EDIT,
  IntentType.REMINDER_DELETE,
  IntentType.LOG_WORKOUT,
  IntentType.LOG_SKIP,
  IntentType.LOG_WEIGHT,
  IntentType.RECOMMENDATION_REQUEST,
  IntentType.ADVICE_REQUEST,
  IntentType.NUTRITION_QUERY,
  IntentType.PLAN_REQUEST,
  IntentType.GOAL_SET,
  IntentType.SCHEDULE_UPDATE,
  IntentType.PROGRESS_QUERY,
  IntentType.CHECKIN_SCHEDULE,
  IntentType.SESSION_CONFIRMATION,
])

function isShortAmbiguous(text: string): boolean {
  return text.trim().split(/\s+/).length <= 3 &&
    (AFFIRM_RE.test(text.trim()) || DENY_RE.test(text.trim()) || ACK_RE.test(text.trim()))
}

/**
 * Main parser entry point.
 *
 * Runs all intent detectors on the message, extracts entities, applies
 * disambiguation and the recommendation safety gate, then selects the
 * highest-confidence actionable intent.
 *
 * Synchronous, deterministic, no LLM, no DB.
 */
export function parseMessage(
  text:     string,
  context:  ParseContext = { recentMessages: [] },
): ParseResult {
  const signals: string[] = []

  // ── Empty / trivial ───────────────────────────────────────────────────────
  const trimmed = text.trim()
  if (!trimmed || trimmed.length === 0) {
    return {
      intents: [],
      entities: [],
      signals: ["EMPTY_MESSAGE"],
      actionableIntent: null,
      confidence: 0,
      requiresClarification: true,
      reasoning: "Empty or trivial message",
    }
  }

  // ── Short ambiguous: use conversation context for disambiguation ───────────
  if (isShortAmbiguous(trimmed)) {
    const disambig = disambiguateByConversationState(trimmed, context)
    if (disambig) {
      const entities = extractAllEntities(trimmed)
      return {
        intents:              [disambig],
        entities,
        signals,
        actionableIntent:     ACTIONABLE_TYPES.has(disambig.type) ? disambig : null,
        confidence:           disambig.confidence,
        requiresClarification: disambig.requiresClarification,
        reasoning:            `Short reply disambiguated as ${disambig.type} using conversation context`,
      }
    }
  }

  // ── Stateful answer detection ──────────────────────────────────────────────
  const stateIntent = disambiguateByConversationState(trimmed, context)

  // ── Run all detectors on full text ────────────────────────────────────────
  const rawIntents: IntentResult[] = []

  // Actionable detectors
  const rem = detectReminderCreate(trimmed);       if (rem)  rawIntents.push(rem)
  const del = detectReminderDelete(trimmed);       if (del)  rawIntents.push(del)
  const edt = detectReminderEdit(trimmed);         if (edt)  rawIntents.push(edt)
  const log = detectLogWorkout(trimmed);           if (log)  rawIntents.push(log)
  const skp = detectLogSkip(trimmed);              if (skp)  rawIntents.push(skp)
  const wgt = detectLogWeight(trimmed);            if (wgt)  rawIntents.push(wgt)
  const sor = detectLogSoreness(trimmed);          if (sor)  rawIntents.push(sor)
  const lp  = detectLogPain(trimmed);              if (lp)   rawIntents.push(lp)
  const rec = detectRecommendationRequest(trimmed);if (rec)  rawIntents.push(rec)
  const adv = detectAdviceRequest(trimmed);        if (adv)  rawIntents.push(adv)
  const nuq = detectNutritionQuery(trimmed);       if (nuq)  rawIntents.push(nuq)
  const pln = detectPlanRequest(trimmed);          if (pln)  rawIntents.push(pln)
  const gol = detectGoalSet(trimmed);              if (gol)  rawIntents.push(gol)
  const prg = detectProgressQuery(trimmed);        if (prg)  rawIntents.push(prg)
  const ck  = detectCheckinSchedule(trimmed);      if (ck)   rawIntents.push(ck)

  // Contextual detectors
  const pain = detectPainContext(trimmed);         if (pain) rawIntents.push(pain)
  const fail = detectFailureSignal(trimmed);       if (fail) rawIntents.push(fail)
  const mood = detectMoodContext(trimmed);         if (mood) rawIntents.push(mood)
  const trav = detectTravelContext(trimmed);       if (trav) rawIntents.push(trav)
  const nctx = detectNutritionContext(trimmed);    if (nctx) rawIntents.push(nctx)

  // Merge stateful answer (highest priority if present)
  if (stateIntent && !rawIntents.some(i => i.type === stateIntent.type)) {
    rawIntents.unshift(stateIntent)
  }

  // ── Fallback: general chat ─────────────────────────────────────────────────
  if (rawIntents.length === 0) {
    rawIntents.push(makeIntent(IntentType.GENERAL_CHAT, 0.60, [trimmed.slice(0, 40)], false))
  }

  // ── Extract entities ───────────────────────────────────────────────────────
  const entities = extractAllEntities(trimmed)

  // ── Apply recommendation safety gate ──────────────────────────────────────
  const gated = applyRecommendationGate(rawIntents, signals)
  const intents = gated.intents
  const finalSignals = gated.signals

  // ── Deduplicate (keep highest confidence per type) ─────────────────────────
  const seenTypes = new Map<IntentType, IntentResult>()
  for (const intent of intents) {
    const existing = seenTypes.get(intent.type)
    if (!existing || intent.confidence > existing.confidence) {
      seenTypes.set(intent.type, intent)
    }
  }
  const deduped = [...seenTypes.values()].sort((a, b) => b.confidence - a.confidence)

  // ── Select actionable intent ───────────────────────────────────────────────
  const actionableIntent = deduped.find(i =>
    ACTIONABLE_TYPES.has(i.type) &&
    i.confidence >= 0.60 &&
    !i.requiresClarification
  ) ?? null

  // ── Overall confidence ─────────────────────────────────────────────────────
  const overallConfidence = deduped[0]?.confidence ?? 0
  const requiresClarification = deduped.every(i => i.requiresClarification) ||
    (deduped.length === 1 && deduped[0]?.type === IntentType.GENERAL_CHAT)

  // ── Reasoning ─────────────────────────────────────────────────────────────
  const intentSummary = deduped.slice(0, 3).map(i => `${i.type}(${i.confidence.toFixed(2)})`).join(", ")
  const reasoning = `Detected: [${intentSummary}]. Actionable: ${actionableIntent?.type ?? "none"}.${
    finalSignals.includes("RECOMMENDATION_BLOCKED") ? " Recommendation blocked (pain mentioned without explicit request)." : ""
  }`

  return {
    intents:              deduped,
    entities,
    signals:              finalSignals,
    actionableIntent,
    confidence:           overallConfidence,
    requiresClarification,
    reasoning,
  }
}
