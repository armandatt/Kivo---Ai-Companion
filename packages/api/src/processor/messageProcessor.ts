import { parseDate } from "chrono-node"
import { generateOpenAIText } from "../services/openai.service"

// ── Types ─────────────────────────────────────────────────────────────────────

type Intent =
  | "recovery_query" | "nutrition_query" | "pain_report" | "pr_log" | "lift_log"
  | "gym_checkin" | "soreness_log" | "missed_session" | "weight_log" | "energy_checkin"
  | "checkin_cancel" | "checkin_schedule" | "schedule_adjust" | "focus_start"
  | "planning" | "streak_check" | "progress_check" | "emotional_trigger"
  | "rest_day" | "deadline_set" | "weekly_review" | "completion" | "goal_set"
  | "health_event" | "general_chat"

type Emotion = "positive" | "negative" | "neutral"

type LLMAnalysis = {
  intent:           Intent
  emotion:          Emotion
  focusDurationMin: number | null
  timeShiftMin:     number | null
}

const VALID_INTENTS = new Set<string>([
  "recovery_query", "nutrition_query", "pain_report", "pr_log", "lift_log",
  "gym_checkin", "soreness_log", "missed_session", "weight_log", "energy_checkin",
  "checkin_cancel", "checkin_schedule", "schedule_adjust", "focus_start",
  "planning", "streak_check", "progress_check", "emotional_trigger",
  "rest_day", "deadline_set", "weekly_review", "completion", "goal_set",
  "health_event", "general_chat",
])

// ── LLM call ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You classify messages sent to an AI accountability companion (gym + study + life goals).
Output ONLY a JSON object — no explanation, no markdown.

{
  "intent": <best matching intent>,
  "emotion": "positive" | "negative" | "neutral",
  "focusDurationMin": <integer minutes if user is starting a focus/study/work session with a stated duration, else null>,
  "timeShiftMin": <integer minutes if user asks to push/delay a scheduled check-in, else null>
}

INTENT OPTIONS (pick exactly one):
  recovery_query    — asking if it's okay to train, about overtraining, soreness
  nutrition_query   — asking about protein, diet, macros, food choices
  pain_report       — reporting an injury or pain during/after training
  pr_log            — logging a new personal record / max lift
  lift_log          — logging a specific set/rep/weight (squat, bench, deadlift, etc.)
  gym_checkin       — reporting they finished a workout session
  soreness_log      — reporting muscle soreness or DOMS
  missed_session    — reporting they skipped a planned workout
  weight_log        — logging their body weight
  energy_checkin    — reporting their energy or mood level
  checkin_cancel    — asking to stop or disable check-ins / reminders
  checkin_schedule  — asking to be checked on after a specific time ("check me in 30 min")
  schedule_adjust   — asking to push/delay something by a time amount
  focus_start       — starting a focus, study, or deep work session
  planning          — asking to create or update a weekly/daily plan
  streak_check      — asking about their streak count
  progress_check    — asking about progress, stats, or how they're doing
  emotional_trigger — expressing stress, burnout, feeling overwhelmed or emotional
  rest_day          — declaring they are taking a rest day
  deadline_set      — setting a new deadline for a task or exam
  weekly_review     — requesting a weekly summary or review
  completion        — reporting they completed a task, exam, workout, or goal
  goal_set          — setting a new goal
  health_event      — declaring illness: fever, flu, food poisoning, nausea, vomiting, migraine, unwell
  general_chat      — everything else`

async function llmAnalyze(text: string): Promise<LLMAnalysis> {
  const raw = await generateOpenAIText({
    model:             "gpt-4o-mini",
    maxOutputTokens:   80,
    systemInstruction: SYSTEM_PROMPT,
    prompt:            text,
  })

  const json = JSON.parse(raw.replace(/```json|```/g, "").trim()) as Partial<LLMAnalysis>

  return {
    intent:           VALID_INTENTS.has(json.intent ?? "") ? (json.intent as Intent) : "general_chat",
    emotion:          (["positive", "negative", "neutral"] as const).includes(json.emotion as Emotion)
                        ? json.emotion as Emotion
                        : "neutral",
    focusDurationMin: typeof json.focusDurationMin === "number" ? json.focusDurationMin : null,
    timeShiftMin:     typeof json.timeShiftMin     === "number" ? json.timeShiftMin     : null,
  }
}

// ── Tier 1: regex classifier ──────────────────────────────────────────────────
// Primary path — handles the large majority of messages cheaply.
// Returns general_chat only when genuinely uncertain → triggers LLM (Tier 2).
// Order matters: more specific / higher-confidence patterns come first.

function regexIntent(t: string): Intent {

  // ── Recovery query ───────────────────────────────────────────────────────
  if (/\b(should i (train|workout|exercise|go to gym)|ok(ay)? to (train|workout|exercise)|safe to (train|workout)|is it ok (to train|to workout)|can i (train|workout|exercise) today|am i overtraining|overtraining\?|need (a )?rest day|too sore to (train|workout)|rest or (train|workout)|train through soreness)\b/.test(t))
    return "recovery_query"

  // ── Nutrition query ──────────────────────────────────────────────────────
  if (/\b(how much protein|protein (intake|goal|target|requirement|sources?|per day)|what (should i eat|to eat (for|to))|macro(s|nutrients)?|calorie(s)? (intake|goal|target|deficit|surplus|count)|diet (plan|advice|tip|question)|how many calories|daily protein|protein (for muscle|for bulking|for cutting)|eating (enough|more|less) protein)\b/.test(t))
    return "nutrition_query"

  // ── Pain report ──────────────────────────────────────────────────────────
  // Require body-part OR exercise context to avoid false positives ("pain in the ass" etc.)
  if (/\b(knee|shoulder|lower back|upper back|wrist|elbow|hip|ankle|neck|spine|rotator cuff|hamstring|groin)\b.*\b(pain|hurts?|sore|injured?|aching|strain(ed)?|sprain(ed)?|tweak(ed)?|pop(ped)?|tear|torn)\b/.test(t))
    return "pain_report"
  if (/\b(pain|hurts?|injured?|tweak(ed)?|pulled|strain(ed)?|sprain(ed)?|popped)\b.*\b(when (i |i'm )?(lift|bench|squat|deadlift|press|pull|push|train|workout|exercise)|during (workout|training|lifting|squats?|bench))\b/.test(t))
    return "pain_report"
  if (/\b(threw out (my )?back|hurt (my|myself) (at the gym|lifting|training|squatting|deadlifting)|can.?t (lift|move) (my |the )?(arm|shoulder|leg|back) (properly|at all))\b/.test(t))
    return "pain_report"

  // ── PR log ───────────────────────────────────────────────────────────────
  if (/\b(new (pr|pb|max|personal (record|best))|hit (a |my )?(new )?(pr|pb|max|1rm)|broke (my )?(pr|pb|record)|smashed (my )?(pr|pb)|personal (record|best)|pr (on|for|today)|new 1rm|lifetime (best|max)|all[ -]?time (best|max)|first time (hitting|lifting|doing|squatting|benching|pulling) \d)\b/.test(t))
    return "pr_log"

  // ── Lift log ─────────────────────────────────────────────────────────────
  // Exercise name + weight / sets / reps format — keep specific to avoid noise
  if (/\b(bench(ed)?( press(ed)?)?|squat(ted|s)?|deadlift(ed|s)?|overhead press|ohp|pull[ -]?up|chin[ -]?up|barbell row|db row|dumbbell row|cable row|lat pulldown|military press|incline bench|decline bench|hip thrust|leg press|leg curl|leg extension|rdl|romanian deadlift|sumo deadlift|dip(s|ped)?|lunge(d|s)?|calf raise|face pull|lateral raise|bicep curl|tricep extension|skull crusher|front squat)\b.*\b(\d+\s*(kg|lbs?)|(\d+\s*x\s*\d+)|\d+\s*(sets?|reps?))\b/.test(t))
    return "lift_log"
  // Set/rep notation first, then exercise name
  if (/\b\d+\s*x\s*\d+\b.*\b(bench|squat|deadlift|press|row|curl|pull|dip|lunge|rdl)\b/.test(t))
    return "lift_log"
  // "did 4 sets of bench" / "knocked out 3x10 squats"
  if (/\b(did|hit|knocked out|completed?|finished?|done with)\b.{0,25}\b\d+\s*(sets?|reps?)\b.{0,25}\b(bench|squat|deadlift|press|row|curl|pull|chest|back|legs?|arms?|shoulders?|push|pull)\b/.test(t))
    return "lift_log"

  // ── Gym checkin ──────────────────────────────────────────────────────────
  if (/\b(just (finished|done|wrapped up|completed|got back from)|done with (my |the |a )?(workout|training|session|gym|lift(ing)?|push day|pull day|leg day)|workout (done|complete|finished|over|crushed)|hit the gym|crushed (it|today|the workout|my (workout|session))|session (done|complete|over)|back from (the )?gym|gym (done|complete|finished)|training (done|complete|finished|over)|just (trained|lifted|hit legs?|hit chest|hit back|hit arms?|hit shoulders?)|killed (it|the (workout|session))|smashed (it|today|the workout)|beast(ed)? (it|today)|workout (in the books|complete))\b/.test(t))
    return "gym_checkin"

  // ── Soreness log ─────────────────────────────────────────────────────────
  if (/\b(doms|muscle soreness|post.?workout soreness|delayed onset|feeling (yesterday.?s|last (session|workout|training)))\b/.test(t))
    return "soreness_log"
  if (/\b(legs?|arms?|chest|back|shoulders?|quads?|hamstrings?|glutes?|calves?|triceps?|biceps?|lats?|traps?)\b.*\b(are (dead|wrecked|destroyed|sore|on fire|absolutely dead|smashed|toast)|is (dead|wrecked|sore|killing me)|killing me|so sore|can.?t (walk|move|straighten|bend)|absolutely (dead|wrecked|destroyed))\b/.test(t))
    return "soreness_log"
  if (/\bsore\b/.test(t) && /\b(from|after|yesterday|last night|this morning|the workout|training)\b/.test(t))
    return "soreness_log"

  // ── Missed session ───────────────────────────────────────────────────────
  if (/\b(skipped (the )?(gym|workout|training|session|today|leg day|push day|pull day|upper|lower)|missed (the )?(workout|training|session|gym|leg day)|didn.?t (go to (the )?gym|train(ing)?|workout|exercise|make it (to the gym)?)|no gym (today|this morning|tonight|yesterday)|couldn.?t (make it|go to gym|train|get to gym)|bailed on (gym|training|workout|the session)|didn.?t show up|failed to (train|workout|go)|no training today|missed (my|the) (session|lift|workout))\b/.test(t))
    return "missed_session"

  // ── Weight log ───────────────────────────────────────────────────────────
  if (/\b(i (currently )?weigh|current(ly)? weigh(ing)?|bodyweight[\s:]*\d|body weight[\s:]*\d|weigh(ing|ed)[\s:]*\d+\s*(kg|lbs?|pounds?)|weight (today|this morning|check|update|log)[\s:]*\d|bw[\s:]*\d+|scale (says?|read|showed)\s*\d)\b/.test(t))
    return "weight_log"
  // "[number] kg/lbs" only if it also has bodyweight context (not just a lift)
  if (/\b\d+(\.\d+)?\s*(kg|lbs?|pounds?)\b/.test(t) && /\b(weigh(t)?|bw|body weight|bodyweight|scale|morning weight)\b/.test(t))
    return "weight_log"

  // ── Energy checkin ───────────────────────────────────────────────────────
  if (/\b(no energy|zero energy|low energy|energy (is |levels? )?(low|high|great|terrible|zero|on point|good today)|feeling (energized|flat|groggy|sluggish|drained|pumped up|wired|tired today|exhausted today)|full of energy|dragging (today|this morning)|super tired today|energy (today|this morning|check)|how.?s my energy)\b/.test(t))
    return "energy_checkin"
  // Short energy reports: "feeling great today", "feeling terrible" (only when standalone/short)
  if (/^(feeling (great|amazing|terrible|awful|good|bad|meh|okay|off)|energy (low|high|good|bad|great|terrible)|pretty (tired|energized|flat|good|great))[\s!.]*$/.test(t))
    return "energy_checkin"

  // ── Checkin cancel ───────────────────────────────────────────────────────
  if (/\b(stop|cancel|disable|turn off|no more|don.?t (want|need|send)|remove|pause)\b.{0,20}\b(check.?ins?|reminders?|notifications?|pings?|alerts?|updates?|messages?|follow.?ups?)\b/.test(t))
    return "checkin_cancel"
  if (/\b(no more (check.?ins?|reminders?|pings?|notifications?|updates?)|stop (pinging|reminding|checking on|messaging) me)\b/.test(t))
    return "checkin_cancel"

  // ── Checkin schedule ─────────────────────────────────────────────────────
  if (/\b(check(?: (me|on me|in|back))?|remind(?: me)?|ping(?: me)?|text(?: me)?|message(?: me)?|follow up(?: with me)?|hit me up|let me know|catch(?: me)?|get back to me)\b.{0,30}\b(\d{1,3})\s*(min|mins?|minutes?|hour|hours?|hr|hrs?)\b/.test(t))
    return "checkin_schedule"
  if (/\bin\s+(\d{1,3})\s*(min|mins?|minutes?|hour|hours?|hr|hrs?)\b/.test(t) && /\b(check|remind|ping|text|follow|message|hit)\b/.test(t))
    return "checkin_schedule"
  if (/\b(check me|remind me|ping me)\b.{0,20}\bafter\b.{0,15}\b\d/.test(t))
    return "checkin_schedule"
  // "after 1 hour" / "after 45 min" without explicit check verb — inferred
  if (/\bafter\s+(\d{1,3})\s*(min|mins?|minutes?|hour|hours?|hr|hrs?)\b/.test(t) && t.length < 40)
    return "checkin_schedule"

  // ── Schedule adjust ──────────────────────────────────────────────────────
  if (/\b(push(ing)? (it |this |check.?in |the check.?in )?(back|by|to)|extend(ing)? (by|for|it)|delay(ing)? (by|for|it)|postpone (by|for|it)|give me (\d+|a (few|couple)) more (min|mins?|minutes?|hour|hours?|hr|hrs?)|(\d+) more (min|mins?|minutes?|hour|hours?|hr|hrs?))\b/.test(t))
    return "schedule_adjust"

  // ── Focus start ──────────────────────────────────────────────────────────
  // Named session with or without duration
  if (/\b(start(ing)?( a| my)?( focus| study| work| deep work| coding| reading)? session|focus (mode|session|timer)|deep work( session)?|pomodoro( timer)?|start(ing)? (the )?timer|set(ting)? (a )?timer (for|of))\b/.test(t))
    return "focus_start"
  // Activity + duration → starting focused work
  if (/\b(studying|working|coding|reading|focusing|locking in|heads? down|going dark|phone (away|down|off)) for\b.{0,15}\b\d+\s*(min|mins?|minutes?|hour|hours?|hr|hrs?)\b/.test(t))
    return "focus_start"
  if (/\b(no (distractions?|interruptions?)|silent( mode)?|dnd|do not disturb|airplane mode) for\b.{0,15}\b\d/.test(t))
    return "focus_start"

  // ── Planning ─────────────────────────────────────────────────────────────
  if (/\b(plan my (week|day|tomorrow|today|schedule|routine)|make( me)? a (plan|schedule)|build( me)? a (plan|schedule|routine|workout plan|study plan)|help me (plan|build a plan|organize)|update( my)? (plan|schedule|routine|weekly plan)|create( me)? a (plan|schedule|study plan|workout plan)|revise (my )?(plan|schedule)|set up my (week|schedule|routine)|new (plan|weekly plan|study plan|workout plan)|planning (my|for) (week|day|tomorrow|today)|what should i (do|study|work on|focus on) (today|tomorrow|this week)|can you (make|build|create|update) (a |my )plan)\b/.test(t))
    return "planning"

  // ── Streak check ─────────────────────────────────────────────────────────
  if (/\b(my (current )?streak|what.?s my streak|streak (count|today|so far|check)?|how many days (in a row|have i (been|done)|streak)|days? in a row|current streak|am i on a streak|streak (broken|alive|going))\b/.test(t))
    return "streak_check"

  // ── Progress check ───────────────────────────────────────────────────────
  if (/\b(how am i doing|my (progress|stats?|performance|numbers?|report)|show me (my )?(progress|stats?|numbers?|report)|how have i been (doing)?|am i on track|where am i (at|with (my progress)?)|progress (check|update|report|so far)|how.?s my (progress|performance)|overall (progress|performance|stats?)|give me (my|a) (progress|stats?|report))\b/.test(t))
    return "progress_check"

  // ── Emotional trigger ────────────────────────────────────────────────────
  if (/\b(can.?t do this( anymore)?|giving up|want(ing)? to quit|feel(ing)? like (quitting|giving up)|losing motivation|lost (all |my )?motivation|zero motivation|no motivation (left|at all)?|demotivated|unmotivated|burn(ed|ing)? out|completely overwhelmed|can.?t keep up|falling apart|breaking down|what.?s the (point|use)|not okay|so (stressed out|anxious|depressed|done)|too much (pressure|stress|work)|struggling (really )?(bad|hard|a lot)|can.?t cope|feeling (hopeless|defeated|broken|worthless)|everything (is|feels) (pointless|too much|overwhelming)|ready to (quit|give up|stop))\b/.test(t))
    return "emotional_trigger"

  // ── Health event ─────────────────────────────────────────────────────────
  if (/\b(fever|flu\b|influenza|food\s*poison(?:ing)?|feeling sick|vomit(?:ing)?|nausea|diarr?h(?:oea)?|puk(?:e|ing)|throwing up|stomach\s+(?:bug|virus)|migraine|unwell|under the weather|not well|i'?m ill\b|bedridden|temperature\s+\d+|temp\s+\d+)\b/.test(t))
    return "health_event"

  // ── Rest day ─────────────────────────────────────────────────────────────
  if (/\b(rest day|taking (a |the )?day off|active recovery day|full rest(ing)?|recovery day|no (training|workout|gym|lifting) today|day off (from (gym|training|workout|lifting))?|skipping (gym|training|workout) (today|intentionally)|gonna (rest|recover|chill) today|light day today|deload (week|day)|taking it easy (today|this week))\b/.test(t))
    return "rest_day"

  // ── Deadline set ─────────────────────────────────────────────────────────
  if (/\b(exam (is |on |scheduled for|date is|tomorrow|next (week|month))|deadline (is|on|by|for)|due (on|by|date is)|submit(ting)? by|hand(ing)? in (on|by)|presentation (is|on|scheduled|date)|interview (is|on|scheduled (for)?)|assignment (due|deadline|is due|is on)|test (is|on|scheduled|date)|project (due|deadline|is due)|submission (is|date|deadline)|final(s)? (is|on|scheduled)|viva (is|on|scheduled))\b/.test(t))
    return "deadline_set"

  // ── Weekly review ─────────────────────────────────────────────────────────
  if (/\b(weekly (review|recap|summary|report|check.?in)|week (review|recap|summary|report|in review)|how (was|did) (my |this |the )?week( go)?|end of (the )?week|this week.?s (summary|recap|review|performance)|review (my|this|the) week|wrap.?up (the|this|my) week|how.?d (the|this|my) week go|week.?s (end|wrap.?up))\b/.test(t))
    return "weekly_review"

  // ── Completion ───────────────────────────────────────────────────────────
  // Specific "I completed X" context — avoid false positives from bare "done" or "finished"
  if (/\b(just (finished|completed|submitted|passed|shipped|wrapped up|knocked out|got done with|crossed off)|finally (done with|finished|completed|submitted)|completed (the |my |it|this|that)\b|finished (the |my |a )\b|submitted (the |my )\b|passed (the |my |it|exam|test)\b|assignment (done|submitted|complete(d)?)|exam (done|over|finished|cleared|passed)|project (done|submitted|complete(d)?|shipped|launched)|chapter (done|complete(d)?|finished)|task (done|complete(d)?|finished)|knocked it out|mission (accomplished|complete(d)?)|wrapped (it|things?) up|all done with\b|checked (it |that )?off)\b/.test(t))
    return "completion"

  // ── Goal set ─────────────────────────────────────────────────────────────
  if (/\b(my goal (is|for|this (week|month)|next (week|month))|new goal|setting (a )?new? goal|goal for (this|next) (week|month|year)|i (want|need|plan) to (lose|gain|build|get|become|learn|achieve|reach|improve|start|run|finish|complete|pass|hit)|i.?m (trying|aiming|planning|working|going) to (lose|gain|build|get|become|learn|achieve|reach|improve|start|run|finish|complete|pass|hit)|my target (is|for)|want to (lose \d|gain \d|build muscle|run|get fit|hit \d|reach \d))\b/.test(t))
    return "goal_set"

  return "general_chat"
}

function regexEmotion(t: string): Emotion {
  if (/\b(tired|exhausted|drained|sad|bad|rough|stressed( out)?|overwhelmed|anxious|lost|hopeless|demotivated|unmotivated|burn(ed|ing)? out|struggling|can.?t|giving up|want(ing)? to quit|no motivation|feeling (off|low|terrible|awful|horrible|down|like crap|like shit)|not okay|depressed|defeated|falling (behind|apart)|breaking down|frustrated|discouraged|useless|worthless|failing)\b/.test(t))
    return "negative"
  if (/\b(great|amazing|awesome|excellent|fantastic|solid|productive|excited|proud|happy|confident|motivated|energized|pumped(?: up)?|crushed it|killing it|nailed it|on fire|locked in|focused|consistent|smashed it|knocked it out|beast mode|feeling (good|great|strong|incredible|on point|fire)|on point|strong (session|day|week)|best (session|day|week)|absolutely (nailed|crushed|smashed|killed)|loving (it|this|the progress)|so (good|happy|proud|excited|motivated)|damn good|fire (day|session|workout))\b/.test(t))
    return "positive"
  return "neutral"
}

function extractFocusDurationMin(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/)
  if (m) return Number(m[1])
  const h = text.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs)\b/)
  if (h) return Number(h[1]) * 60
  return null
}

function extractTimeShiftMin(text: string): number | null {
  const h = text.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs)\b/)
  if (h) return Number(h[1]) * 60
  const m = text.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/)
  if (m) return Number(m[1])
  return null
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function processMessage(text: string) {
  const cleanedText = text.toLowerCase().trim()

  // ── Tier 1: regex (free, instant) ────────────────────────────────────────
  // Handles the large majority of messages that have clear keywords/structure.
  // Struct parsers (durations, time shifts) always stay regex — no ambiguity there.
  const regexResult  = regexIntent(cleanedText)
  const emotion      = regexEmotion(cleanedText)   // 3-state emotion stays regex
  let focusDurationMin = extractFocusDurationMin(cleanedText)
  let timeShiftMin     = extractTimeShiftMin(cleanedText)

  // ── Tier 2: LLM (only when regex is genuinely uncertain) ─────────────────
  // "general_chat" means regex found no clear signal → ask LLM for nuance.
  // Saves ~80 % of LLM calls while still handling natural-language edge cases.
  let intent: Intent = regexResult
  if (regexResult === "general_chat") {
    try {
      const analysis   = await llmAnalyze(text)
      intent           = analysis.intent
      focusDurationMin = analysis.focusDurationMin ?? focusDurationMin
      timeShiftMin     = analysis.timeShiftMin     ?? timeShiftMin
    } catch {
      // LLM unreachable — keep the regex result
    }
  }

  // Date and deadline extraction stay with chrono-node — it's reliable
  const date           = parseDate(text)
  const deadlineLabel  = intent === "deadline_set"
    ? text.replace(/\b(due|deadline|by|on|at)\b/gi, " ").replace(/\s+/g, " ").trim()
    : null

  const entities = {
    date,
    goal:             intent === "goal_set" ? text : null,
    deadline:         deadlineLabel && date ? { label: deadlineLabel, dueAt: date } : null,
    focusDurationMin,
    timeShiftMin,
  }

  return {
    cleanedText,
    intent,
    emotion,
    entities,
    triggers: {
      startFocus:   intent === "focus_start",
      planning:     intent === "planning",
      saveDeadline: intent === "deadline_set",
      emotional:    intent === "emotional_trigger",
      gym:
        intent.startsWith("gym_") ||
        intent.endsWith("_log") ||
        intent === "missed_session" ||
        intent === "weight_log" ||
        intent === "energy_checkin" ||
        intent === "recovery_query" ||
        intent === "nutrition_query" ||
        intent === "pain_report",
    },
  }
}
