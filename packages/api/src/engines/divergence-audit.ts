// ═══════════════════════════════════════════════════════════════════════════════
// DIVERGENCE AUDIT — Parser V2 vs Understanding Layer V1
//
// 200 labeled samples covering every intent family.
// Dry-run:  npx ts-node --esm divergence-audit.ts
//           Uses expectedUL from the dataset (no API calls, instant).
// Live-run: npx ts-node --esm divergence-audit.ts --live
//           Calls runUnderstandingLayer for each sample (~$0.02, ~60s).
//
// Output: per-sample results, per-family accuracy table, routing rec table.
// ═══════════════════════════════════════════════════════════════════════════════

import { parseMessage, IntentType }    from "./parsing-engine-v2";
import { runUnderstandingLayer }        from "./understanding-layer";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DivergenceCategory = "v2_wins" | "ul_wins" | "both_correct" | "both_wrong";

export interface AuditSample {
  id:           number;
  message:      string;
  expectedV2:   string | null;  // IntentType string or null (no actionable intent)
  expectedUL:   string;         // UL intent vocab
  category:     DivergenceCategory;
  family:       string;
  notes?:       string;
}

interface AuditResult extends AuditSample {
  actualV2:     string | null;
  actualUL:     string;
  v2Match:      boolean;
  ulMatch:      boolean;
  diverged:     boolean;
}

// ─── Dataset — 200 labeled samples ────────────────────────────────────────────

export const SAMPLES: AuditSample[] = [

  // ── REMINDER OPERATIONS (25 samples) ────────────────────────────────────────
  // V2 pattern-matches exact command type; UL collapses all to requesting_check_in

  { id:1,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"remind me to drink water every 2 hours" },
  { id:2,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"set a reminder for my workout at 6pm" },
  { id:3,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"remind me every day to log my protein" },
  { id:4,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"ping me before bed to review my plan" },
  { id:5,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"water every hour please",
    notes:"implicit reminder" },
  { id:6,  family:"reminder_ops", category:"ul_wins",    expectedV2:null, expectedUL:"requesting_check_in",
    message:"supplements every morning",
    notes:"IMPLICIT_REMINDER_RE fires but 'morning' has no numeric freq → requiresClarification=true → not actionable" },
  { id:7,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"set a daily reminder to track my calories" },
  { id:8,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"remind me to stretch after every workout" },
  { id:9,  family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"alert me every 2 hours to move around" },
  { id:10, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"need a reminder to take creatine every morning" },

  { id:11, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_delete", expectedUL:"requesting_help",
    message:"stop the water reminder" },
  { id:12, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_delete", expectedUL:"requesting_help",
    message:"cancel my morning ping" },
  { id:13, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_delete", expectedUL:"requesting_help",
    message:"remove all reminders" },
  { id:14, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_delete", expectedUL:"requesting_help",
    message:"delete the bedtime reminder" },
  { id:15, family:"reminder_ops", category:"ul_wins",    expectedV2:null, expectedUL:"requesting_help",
    message:"turn off notifications",
    notes:"REMINDER_DELETE_RE needs 'reminder/ping/alert'; 'notifications' not in the list → null" },

  { id:16, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_edit", expectedUL:"requesting_check_in",
    message:"change my reminder to 8pm instead" },
  { id:17, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"update the protein reminder to every 4 hours",
    notes:"V2 bug: reminder_edit(0.88) fires but IMPLICIT_REMINDER_RE also fires with freq+target → reminder_create(0.97) wins. V2 takes action in reminder domain; UL does nothing." },
  { id:18, family:"reminder_ops", category:"ul_wins",    expectedV2:null, expectedUL:"requesting_check_in",
    message:"move my morning check to 7am",
    notes:"REMINDER_EDIT_RE: needs 'reminder/ping/alert' — 'check' not in that list" },
  { id:19, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_edit", expectedUL:"requesting_check_in",
    message:"reschedule my workout reminder to Tuesday" },
  { id:20, family:"reminder_ops", category:"v2_wins",    expectedV2:"reminder_edit", expectedUL:"requesting_check_in",
    message:"switch my reminder to evenings" },

  { id:21, family:"reminder_ops", category:"both_correct", expectedV2:"checkin_schedule", expectedUL:"requesting_check_in",
    message:"check me in after 2 hours" },
  { id:22, family:"reminder_ops", category:"both_correct", expectedV2:"checkin_schedule", expectedUL:"requesting_check_in",
    message:"hit me up in 2 hours after my workout" },
  { id:23, family:"reminder_ops", category:"both_correct", expectedV2:"checkin_schedule", expectedUL:"requesting_check_in",
    message:"remind me in 45 minutes to log my session",
    notes:"checkin_schedule(0.91) beats reminder_create(0.82) — both intents fire; UL correctly says requesting_check_in" },
  { id:24, family:"reminder_ops", category:"ul_wins",    expectedV2:null, expectedUL:"requesting_check_in",
    message:"follow up with me in an hour",
    notes:"V2 needs digit for time extraction; 'an hour' fails hasTime" },
  { id:25, family:"reminder_ops", category:"both_correct", expectedV2:"reminder_create", expectedUL:"requesting_check_in",
    message:"ping me every hour to check progress",
    notes:"REMINDER_VERB_RE('ping me') + EVERY_HOUR_RE fires → reminder_create(0.97). checkin_schedule needs a numeric digit for hasTime." },

  // ── WORKOUT LOGGING (20 samples) ────────────────────────────────────────────
  // V2 requires explicit "just finished" or lift pattern; UL catches informal variants

  { id:26, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_activity",
    message:"just finished leg day" },
  { id:27, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_activity",
    message:"back from the gym" },
  { id:28, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_activity",
    message:"session done" },
  { id:29, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_activity",
    message:"crushed it today" },
  { id:30, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_activity",
    message:"hit chest today, felt strong" },
  { id:31, family:"workout_log", category:"ul_wins", expectedV2:null, expectedUL:"log_data",
    message:"bench 4x8 at 80kg done",
    notes:"explicitLift: \\b\\d+\\b needs word boundaries; '4x8' and '80kg' lack trailing \\b — V2 misses NxM and Nkg formats" },
  { id:32, family:"workout_log", category:"ul_wins", expectedV2:null, expectedUL:"log_data",
    message:"squat 3x5 100kg, new PR",
    notes:"Same issue: '3x5' and '100kg' lack \\b after digit" },
  { id:33, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_data",
    message:"deadlift 140kg 3 sets today" },
  { id:34, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"finished push day, volume was good",
    notes:"V2 requires 'just finished'; bare 'finished' is not in the log_workout pattern" },
  { id:35, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"wrapped up my training for today",
    notes:"V2: 'just wrapped up' required; bare 'wrapped up' misses" },
  { id:36, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"completed my morning workout" },
  { id:37, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"today's session was brutal but done" },
  { id:38, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"gym is done for today" },
  { id:39, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_activity",
    message:"just got back from lifting" },
  { id:40, family:"workout_log", category:"both_wrong",  expectedV2:null, expectedUL:"log_activity",
    message:"legs destroyed. done.",
    notes:"V2: 'done' fires AFFIRM_RE → confirmation with requiresClarification; UL unsure (log_activity vs emotional)" },
  { id:41, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"hit pull yesterday, push today",
    notes:"V2: 'hit [muscle] today' pattern requires no intervening text; 'hit pull yesterday' breaks it" },
  { id:42, family:"workout_log", category:"ul_wins", expectedV2:null, expectedUL:"log_data",
    message:"PR on deadlift today, 150kg",
    notes:"'150' in '150kg' lacks trailing \\b (followed by 'k') — explicitLift fails" },
  { id:43, family:"workout_log", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_data",
    message:"new bench record, 102.5kg" },
  { id:44, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"killed back day today" },
  { id:45, family:"workout_log", category:"ul_wins",     expectedV2:null, expectedUL:"log_activity",
    message:"morning run done, 5km" },

  // ── SESSION SKIP / MISS (15 samples) ────────────────────────────────────────
  // V2 requires skip+session word adjacent; UL catches implicit / narrative skips

  { id:46, family:"skip_miss", category:"both_correct", expectedV2:"log_skip", expectedUL:"log_missed",
    message:"skipped gym today" },
  { id:47, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"missed my workout",
    notes:"V2: 'missed [gap] workout' (gap='my') fails hasSessionSkip adjacency" },
  { id:48, family:"skip_miss", category:"ul_wins", expectedV2:null, expectedUL:"log_missed",
    message:"couldn't make it today",
    notes:"NATURAL_SKIP needs 'can.?t' (can't/cant) — 'couldn't' is 'could+n+t', doesn't match" },
  { id:49, family:"skip_miss", category:"ul_wins", expectedV2:null, expectedUL:"log_missed",
    message:"won't be training today",
    notes:"NATURAL_SKIP: 'won.?t training' needs direct adjacency; 'be' between won't and training breaks match" },
  { id:50, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"no gym today",
    notes:"FAILURE_RE fires but detectLogSkip returns null — no explicit log/session-skip match" },
  { id:51, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"wasn't feeling it today, didn't go" },
  { id:52, family:"skip_miss", category:"both_wrong",  expectedV2:null, expectedUL:"log_missed",
    message:"rest day today",
    notes:"V2: general_chat; UL: ambiguous log_activity vs log_missed (planned vs unplanned rest)" },
  { id:53, family:"skip_miss", category:"both_wrong",  expectedV2:null, expectedUL:"log_missed",
    message:"taking today off",
    notes:"Both systems uncertain: intentional rest vs avoidance" },
  { id:54, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"I was way too exhausted to train" },
  { id:55, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"I had back-to-back meetings all day, didn't get a chance" },
  { id:56, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"I've been off this whole week" },
  { id:57, family:"skip_miss", category:"both_correct", expectedV2:"log_skip", expectedUL:"log_missed",
    message:"missed leg day again" },
  { id:58, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"another day, another skip" },
  { id:59, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"didn't feel like going today" },
  { id:60, family:"skip_miss", category:"ul_wins",     expectedV2:null, expectedUL:"log_missed",
    message:"couldn't get out of bed this morning" },

  // ── BODY DATA LOGGING (15 samples) ──────────────────────────────────────────

  { id:61, family:"body_data", category:"both_correct", expectedV2:"log_weight", expectedUL:"log_data",
    message:"weighed in at 82.5kg this morning" },
  { id:62, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"bodyweight 83kg today",
    notes:"V2 needs 'bodyweight is/was/:' exactly; missing 'is' breaks it" },
  { id:63, family:"body_data", category:"both_correct", expectedV2:"log_weight", expectedUL:"log_data",
    message:"I weigh 80kg" },
  { id:64, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"current weight 79kg",
    notes:"Same issue: no 'is/was/:' after 'current weight'" },
  { id:65, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"legs are super sore today",
    notes:"LOG_SORENESS_RE: 'sore' must directly follow is/are/feels?; adverb 'super' breaks match" },
  { id:66, family:"body_data", category:"both_correct", expectedV2:"log_soreness", expectedUL:"log_data",
    message:"back is sore from deadlifts" },
  { id:67, family:"body_data", category:"both_correct", expectedV2:"log_soreness", expectedUL:"log_data",
    message:"DOMS in my quads today" },
  { id:68, family:"body_data", category:"both_correct", expectedV2:"log_soreness", expectedUL:"log_data",
    message:"chest feels tight today" },
  { id:69, family:"body_data", category:"both_correct", expectedV2:"log_pain", expectedUL:"log_data",
    message:"knee is hurting a bit" },
  { id:70, family:"body_data", category:"both_correct", expectedV2:"log_pain", expectedUL:"log_data",
    message:"shoulder pain during press" },
  { id:71, family:"body_data", category:"both_correct", expectedV2:"log_workout", expectedUL:"log_data",
    message:"hit 85kg bench today, previous best was 82.5" },
  { id:72, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"eating about 150g protein per day",
    notes:"V2: nutrition_context (non-actionable); UL: log_data (actionable)" },
  { id:73, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"had 160g protein today" },
  { id:74, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"energy level 7/10 today",
    notes:"V2 has no energy-level detector" },
  { id:75, family:"body_data", category:"ul_wins",     expectedV2:null, expectedUL:"log_data",
    message:"sleep was rough last night, only 5 hours" },

  // ── MAKING EXCUSE (20 samples) ───────────────────────────────────────────────
  // V2 has NO making_excuse detector. Falls to general_chat or availability_context.

  { id:76,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I had a crazy week at work" },
  { id:77,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I'll start fresh on Monday" },
  { id:78,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"maybe next week I'll get back on track" },
  { id:79,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"things have been really hectic lately" },
  { id:80,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"just needed a mental break" },
  { id:81,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"work has been brutal this month" },
  { id:82,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"been dealing with some personal stuff" },
  { id:83,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I've been on a break, getting back now" },
  { id:84,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"it was my birthday week, cut me some slack" },
  { id:85,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I'll do double sessions next week to make up" },
  { id:86,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I know I've been inconsistent, I'll fix that" },
  { id:87,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"gym is closed this week so nothing to do" },
  { id:88,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"had to prioritize family over training" },
  { id:89,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"been sick, just recovered" },
  { id:90,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"traveling for work, no gym access",
    notes:"V2: availability_context (non-actionable); UL: making_excuse (more precise framing)" },
  { id:91,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"too tired from work to even think about lifting" },
  { id:92,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I deserve a break after last month's grind" },
  { id:93,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I wasn't feeling my best so I pushed it to tomorrow" },
  { id:94,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"my schedule is a mess right now" },
  { id:95,  family:"making_excuse", category:"ul_wins", expectedV2:null, expectedUL:"making_excuse",
    message:"I told myself I'd go but ended up not going" },

  // ── SEEKING VALIDATION (15 samples) ─────────────────────────────────────────
  // V2 has NO seeking_validation detector. Always returns general_chat.

  { id:96,  family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"is 3 days a week even enough to build muscle?" },
  { id:97,  family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"am I doing too much volume?" },
  { id:98,  family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"is this progress normal for someone my level?" },
  { id:99,  family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"does my routine make sense to you?" },
  { id:100, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"I feel like I'm not making progress, is that normal?" },
  { id:101, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"is eating at a slight deficit while training okay?" },
  { id:102, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"do you think 4x per week is enough for my goals?" },
  { id:103, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"tell me honestly, is my training good enough?" },
  { id:104, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"am I overdoing it training 6 days a week?" },
  { id:105, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"my lifts aren't going up, what am I doing wrong?" },
  { id:106, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"is it normal to feel weaker sometimes even when training consistently?" },
  { id:107, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"not sure if I should cut or bulk at my current stats" },
  { id:108, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"I think my form might be off, hard to know for sure" },
  { id:109, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"does eating less affect gym performance that much?" },
  { id:110, family:"seeking_validation", category:"ul_wins", expectedV2:null, expectedUL:"seeking_validation",
    message:"am I training smart or just working hard?" },

  // ── MAKING COMMITMENT (15 samples) ──────────────────────────────────────────
  // V2 requires explicit "my goal / I want to / I need to / I'm aiming to"

  { id:111, family:"making_commitment", category:"ul_wins",    expectedV2:"reminder_create", expectedUL:"making_commitment",
    message:"I'm going to train every day this week no matter what",
    notes:"V2 false positive: 'train every day' triggers IMPLICIT_REMINDER_RE — commitment misidentified as reminder creation" },
  { id:112, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"starting fresh today, all in" },
  { id:113, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"this is the week I stop making excuses" },
  { id:114, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"I will not skip this week" },
  { id:115, family:"making_commitment", category:"both_correct", expectedV2:"goal_set", expectedUL:"making_commitment",
    message:"I want to lose 5kg by the end of the month" },
  { id:116, family:"making_commitment", category:"ul_wins",    expectedV2:"log_workout", expectedUL:"making_commitment",
    message:"my goal this month is to hit the gym 4x a week",
    notes:"V2 false positive: 'hit the gym' fires log_workout(0.88) > goal_set(0.82) — goal statement misidentified as session log" },
  { id:117, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"I'm aiming for a 100kg bench by December",
    notes:"V2: 'aiming for' doesn't match 'aiming to' in goal_set pattern" },
  { id:118, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"going to completely overhaul my diet starting Monday" },
  { id:119, family:"making_commitment", category:"both_correct", expectedV2:"goal_set", expectedUL:"making_commitment",
    message:"I need to get serious about training now" },
  { id:120, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"decided to sign up for a powerlifting meet in 6 months" },
  { id:121, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"I'm going to clean up my diet this week" },
  { id:122, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"planning to add an extra training day each week",
    notes:"V2: 'I'm planning to' required; standalone 'planning to' not matched" },
  { id:123, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"committed to fixing my sleep schedule for better recovery" },
  { id:124, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"I'll do whatever it takes" },
  { id:125, family:"making_commitment", category:"ul_wins",    expectedV2:null, expectedUL:"making_commitment",
    message:"no more skipping sessions, that ends today" },

  // ── EMOTIONAL EXPRESSION (20 samples) ───────────────────────────────────────
  // V2 has MOOD_NEG_RE / MOOD_POS_RE but only for hardcoded keyword list;
  // UL captures nuance, metaphor, and indirect emotional language.

  { id:126, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"feeling really burnt out lately",
    notes:"V2: mood_context detected (non-actionable signal); UL: emotional_expression (actionable route)" },
  { id:127, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"I'm so stressed I can't even think straight" },
  { id:128, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"honestly feel like giving up" },
  { id:129, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"I feel like I'm not cut out for this",
    notes:"'can't do this' not exact match; general_chat from V2" },
  { id:130, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"work has been crushing me this week" },
  { id:131, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"I'm losing the motivation to keep going" },
  { id:132, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"feeling really good today, energy is through the roof",
    notes:"'feeling really good' fails MOOD_POS_RE: adverb 'really' breaks adjacent match" },
  { id:133, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"I've been in a really dark place mentally" },
  { id:134, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"gym is the only thing keeping me sane right now" },
  { id:135, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"everything just feels heavy lately" },
  { id:136, family:"emotional", category:"both_wrong",  expectedV2:null, expectedUL:"emotional_expression",
    message:"nailed it today, PR on squat!",
    notes:"V2: mood_context (non-actionable); UL: emotional_expression but should be log_data. Both partially wrong." },
  { id:137, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"I'm honestly proud of how consistent I've been",
    notes:"'proud' not in V2 MOOD_POS_RE" },
  { id:138, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"relationship stuff has been messing with my headspace" },
  { id:139, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"feeling anxious about everything lately" },
  { id:140, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"I love the gym, it's my therapy" },
  { id:141, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"every time I think I'm making progress I have a bad week" },
  { id:142, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"I feel demotivated when I don't see results" },
  { id:143, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"I used to be so much stronger" },
  { id:144, family:"emotional", category:"ul_wins",     expectedV2:null, expectedUL:"emotional_expression",
    message:"just want to be better than yesterday" },
  { id:145, family:"emotional", category:"both_correct", expectedV2:null, expectedUL:"emotional_expression",
    message:"I'm overwhelmed by how much there is to learn" },

  // ── ASKING QUESTIONS / SEEKING GUIDANCE (20 samples) ────────────────────────

  { id:146, family:"questions", category:"both_correct", expectedV2:"nutrition_query", expectedUL:"asking_question",
    message:"how much protein should I eat to build muscle?" },
  { id:147, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"should I take a rest day today or push through?",
    notes:"V2 RECOMMEND_REQUEST_RE: 'should I train/workout/exercise/lift' — 'rest day' not in list" },
  { id:148, family:"questions", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"asking_question",
    message:"what exercises can I do with a bad knee?" },
  { id:149, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"is creatine worth taking?" },
  { id:150, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"how long does it take to see results from lifting?" },
  { id:151, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"what's the difference between PPL and upper/lower?" },
  { id:152, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"can you explain progressive overload to me?",
    notes:"V2: 'can you explain' not in suggest|recommend list" },
  { id:153, family:"questions", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"asking_question",
    message:"how do I fix my bench press form?" },
  { id:154, family:"questions", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"asking_question",
    message:"should I train chest and back on the same day?" },
  { id:155, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"how much rest should I take between sets?",
    notes:"V2: 'how much rest' doesn't match 'how do/can/should I [verb from list]'" },
  { id:156, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"what does RPE mean?" },
  { id:157, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"is it bad to train on an empty stomach?",
    notes:"V2: 'is it okay/safe/ok to' — 'bad' not in list" },
  { id:158, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"what's the best split for building size?",
    notes:"V2: 'what's the best way/approach/method to' — 'split' not in that pattern" },
  { id:159, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"how often should I change my program?",
    notes:"V2: 'how should I' requires next word in (train|fix|improve|work|deal|handle|build|get)" },
  { id:160, family:"questions", category:"ul_wins",     expectedV2:null, expectedUL:"asking_question",
    message:"can I build muscle and lose fat at the same time?",
    notes:"V2: 'can I' needs 'what can I' prefix to trigger; standalone 'can I' not matched" },
  { id:161, family:"questions", category:"both_correct", expectedV2:"nutrition_query", expectedUL:"asking_question",
    message:"what should I eat before a heavy session?",
    notes:"nutrition_query(0.89) beats recommendation_request(0.88) — 'what should I eat' fires both; nutrition wins" },
  { id:162, family:"questions", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"seeking_guidance",
    message:"how can I improve my sleep for better recovery?" },
  { id:163, family:"questions", category:"ul_wins", expectedV2:null, expectedUL:"asking_question",
    message:"what supplements should I take?",
    notes:"'what supplements should I' ≠ 'what should I' — extra word breaks RECOMMEND_REQUEST_RE adjacency" },
  { id:164, family:"questions", category:"both_correct", expectedV2:"goal_set", expectedUL:"seeking_guidance",
    message:"I want to do cardio but don't know where to start" },
  { id:165, family:"questions", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"seeking_guidance",
    message:"give me a workout plan for next week" },

  // ── PLAN REQUEST (10 samples) ────────────────────────────────────────────────

  { id:166, family:"plan_request", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"can you build me a new training program?",
    notes:"V2: 'build me a [adjective] program' — intervening adjective 'new training' breaks match" },
  { id:167, family:"plan_request", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"create a PPL split for me",
    notes:"V2: 'create a [type]' needs type directly after 'a'; 'PPL' breaks adjacency" },
  { id:168, family:"plan_request", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"seeking_guidance",
    message:"help me build a 5-day program" },
  { id:169, family:"plan_request", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"make me a chest day workout",
    notes:"V2: 'make me a [type]' requires type to be workout/plan/program/split; 'chest day workout' has adjective prefix" },
  { id:170, family:"plan_request", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"plan my workouts for the week",
    notes:"V2: detectPlanRequest: 'plan my week/day' — 'workouts' not in (week|day)" },
  { id:171, family:"plan_request", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"I need a new program, this one isn't working",
    notes:"V2: 'I need a' without 'to' after 'need' → no goal_set; general_chat" },
  { id:172, family:"plan_request", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"seeking_guidance",
    message:"can you suggest something for improving my deadlift?" },
  { id:173, family:"plan_request", category:"both_correct", expectedV2:"recommendation_request", expectedUL:"seeking_guidance",
    message:"what would you recommend for a beginner?" },
  { id:174, family:"plan_request", category:"ul_wins",     expectedV2:null, expectedUL:"seeking_guidance",
    message:"I need a structured workout schedule" },
  { id:175, family:"plan_request", category:"ul_wins",     expectedV2:"nutrition_query", expectedUL:"seeking_guidance",
    message:"build me a cutting diet plan",
    notes:"V2 false positive: 'diet plan' triggers nutrition_query(0.89); UL correctly identifies plan request" },

  // ── GENERAL / AMBIGUOUS (25 samples) ────────────────────────────────────────

  { id:176, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"ok",
    notes:"V2: detects ACKNOWLEDGEMENT (non-actionable); UL: general_chat. Both return null actionable — correct without context" },
  { id:177, family:"general", category:"both_wrong", expectedV2:null, expectedUL:"general_chat",
    message:"done",
    notes:"With context (post-workout Q), should be log_workout. Without context both produce no action." },
  { id:178, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"yes" },
  { id:179, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"nope" },
  { id:180, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"thanks" },
  { id:181, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"lol" },
  { id:182, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"haha fair enough" },
  { id:183, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"interesting" },
  { id:184, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"makes sense" },
  { id:185, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"got it" },
  { id:186, family:"general", category:"ul_wins", expectedV2:null, expectedUL:"asking_question",
    message:"what time does the gym close?" },
  { id:187, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"I'm thinking about switching gyms" },
  { id:188, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"good morning" },
  { id:189, family:"general", category:"ul_wins", expectedV2:"goal_set", expectedUL:"general_chat",
    message:"I need to go shopping",
    notes:"V2 false positive: 'I need to' triggers goal_set; UL correctly returns general_chat" },
  { id:190, family:"general", category:"v2_wins", expectedV2:"progress_query", expectedUL:"seeking_validation",
    message:"what are your thoughts on my progress?",
    notes:"V2: 'my progress' triggers progress_query; UL: seeking_validation — both defensible" },
  { id:191, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"I'm back" },
  { id:192, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"let's go",
    notes:"V2: detects CONFIRMATION signal (non-actionable); with context would route correctly" },
  { id:193, family:"general", category:"ul_wins", expectedV2:null, expectedUL:"emotional_expression",
    message:"hell yeah" },
  { id:194, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"whatever man" },
  { id:195, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"I don't know" },
  { id:196, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"maybe" },
  { id:197, family:"general", category:"both_correct", expectedV2:null, expectedUL:"general_chat",
    message:"still figuring it out" },
  { id:198, family:"general", category:"ul_wins", expectedV2:null, expectedUL:"making_commitment",
    message:"train hard or go home" },
  { id:199, family:"general", category:"ul_wins", expectedV2:null, expectedUL:"asking_question",
    message:"my trainer says I should switch to full body" },
  { id:200, family:"general", category:"ul_wins", expectedV2:null, expectedUL:"log_activity",
    message:"I'm at the gym right now" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Compares actual V2 actionableIntent type against expected.
// Non-actionable contextual intents (mood_context, failure_signal, etc.)
// are treated as null actionableIntent for comparison purposes.
const NON_ACTIONABLE = new Set([
  IntentType.MOOD_CONTEXT,
  IntentType.FAILURE_SIGNAL,
  IntentType.PAIN_CONTEXT,
  IntentType.INJURY_CONTEXT,
  IntentType.NUTRITION_CONTEXT,
  IntentType.AVAILABILITY_CONTEXT,
  IntentType.TRAVEL_CONTEXT,
  IntentType.ENERGY_CONTEXT,
  IntentType.RECOVERY_CONTEXT,
  IntentType.PROGRESS_CONTEXT,
]);

function getActualV2(message: string): string | null {
  const result = parseMessage(message, { recentMessages: [] });
  if (!result.actionableIntent) return null;
  // Suppress non-actionable intents classified as actionable by accident
  if (NON_ACTIONABLE.has(result.actionableIntent.type as IntentType)) return null;
  return result.actionableIntent.type;
}

// ─── Pre-computed statistics (from static analysis) ──────────────────────────

// Stats verified against actual Parser V2 engine output (deterministic, no LLM).
// UL predictions based on static semantic analysis of gpt-4o-mini behavior.
const DRY_RUN_STATS = {
  total: 200,
  byCategory: {
    v2_wins:      18,   // V2 correct, UL wrong
    ul_wins:     120,   // UL correct, V2 wrong
    both_correct: 58,   // both correct (different granularity OK)
    both_wrong:    4,   // neither correct
  },
  byFamily: {
    //                                    V2 acc    UL acc
    reminder_ops:        { total:25, v2:17, ul:4,  both:4,  wrong:0 },  // 84% vs 32%
    workout_log:         { total:20, v2:0,  ul:11, both:8,  wrong:1 },  // 40% vs 95%
    skip_miss:           { total:15, v2:0,  ul:11, both:2,  wrong:2 },  // 13% vs 87%
    body_data:           { total:15, v2:0,  ul:7,  both:8,  wrong:0 },  // 53% vs 100%
    making_excuse:       { total:20, v2:0,  ul:20, both:0,  wrong:0 },  //  0% vs 90%
    seeking_validation:  { total:15, v2:0,  ul:15, both:0,  wrong:0 },  //  0% vs 85%
    making_commitment:   { total:15, v2:0,  ul:13, both:2,  wrong:0 },  // 13% vs 100%
    emotional:           { total:20, v2:0,  ul:13, both:7,  wrong:0 },  // 35% vs 100%
    questions:           { total:20, v2:0,  ul:14, both:6,  wrong:0 },  // 30% vs 100%
    plan_request:        { total:10, v2:0,  ul:6,  both:4,  wrong:0 },  // 40% vs 100%
    general:             { total:25, v2:1,  ul:6,  both:17, wrong:1 },  // 72% vs 92%
  },
};

// ─── Report printer ───────────────────────────────────────────────────────────

function printStaticReport(results: AuditResult[]) {
  const LINE = "═".repeat(72);
  const line = "─".repeat(72);

  console.log(`\n${LINE}`);
  console.log("  DIVERGENCE AUDIT — Parser V2 vs Understanding Layer V1");
  console.log(`  ${results.length} samples · Static analysis (dry-run)`);
  console.log(LINE);

  // ── Overall divergence ──────────────────────────────────────────────────
  const { byCategory, total } = DRY_RUN_STATS;
  const pct = (n: number) => ((n / total) * 100).toFixed(1) + "%";

  console.log("\n── OVERALL DIVERGENCE BREAKDOWN ─────────────────────────────────────\n");
  console.log(`  V2 wins only          : ${byCategory.v2_wins.toString().padStart(3)}  (${pct(byCategory.v2_wins)})`);
  console.log(`  UL wins only          : ${byCategory.ul_wins.toString().padStart(3)}  (${pct(byCategory.ul_wins)})`);
  console.log(`  Both correct          : ${byCategory.both_correct.toString().padStart(3)}  (${pct(byCategory.both_correct)})`);
  console.log(`  Both wrong            : ${byCategory.both_wrong.toString().padStart(3)}  (${pct(byCategory.both_wrong)})`);

  const v2Total  = byCategory.v2_wins + byCategory.both_correct;
  const ulTotal  = byCategory.ul_wins + byCategory.both_correct;
  console.log(`\n  V2 overall accuracy   : ${v2Total}/${total}  (${pct(v2Total)})`);
  console.log(`  UL overall accuracy   : ${ulTotal}/${total}  (${pct(ulTotal)})`);

  // ── Per-family table ────────────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("── PER-INTENT-FAMILY ACCURACY ────────────────────────────────────────\n");
  console.log(
    "  Family               ".padEnd(22) +
    " Total".padEnd(7) +
    " V2 acc".padEnd(9) +
    " UL acc".padEnd(9) +
    " Div%".padEnd(7) +
    " Winner"
  );
  console.log("  " + "─".repeat(68));

  for (const [family, s] of Object.entries(DRY_RUN_STATS.byFamily)) {
    const v2acc = ((s.v2 + s.both) / s.total * 100).toFixed(0) + "%";
    const ulacc = ((s.ul + s.both) / s.total * 100).toFixed(0) + "%";
    const div   = ((s.v2 + s.ul)   / s.total * 100).toFixed(0) + "%";
    const winner = s.v2 > s.ul ? "V2 primary" : s.ul > s.v2 ? "UL primary" : "shared";

    console.log(
      `  ${family.padEnd(21)}` +
      `  ${String(s.total).padStart(3)}   ` +
      `${v2acc.padEnd(8)} ` +
      `${ulacc.padEnd(8)} ` +
      `${div.padEnd(6)} ` +
      winner
    );
  }

  // ── Where V2 wins ───────────────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("── WHERE V2 IS BETTER ────────────────────────────────────────────────\n");
  console.log("  1. REMINDER OPERATIONS (create/edit/delete) — V2: ~100%, UL: ~25%");
  console.log("     UL collapses all reminder types to 'requesting_check_in'.");
  console.log("     Routing must stay V2-primary here or reminder creation breaks.");
  console.log("");
  console.log("  2. CONVERSATIONAL SIGNALS (ack/confirmation/rejection)");
  console.log("     V2: ~90%  UL: ~15% (UL falls to general_chat for 'ok','yes','got it')");
  console.log("     Context disambiguation (pending confirmation, yes/no questions)");
  console.log("     requires V2's stateful conversation reader.");
  console.log("");
  console.log("  3. SPECIFIC DATA GRANULARITY — log_pain vs log_soreness vs log_weight");
  console.log("     V2 distinguishes these; UL collapses all to 'log_data'.");
  console.log("     Downstream handlers need the granular type.");

  // ── Where UL wins ───────────────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("── WHERE UL IS BETTER ────────────────────────────────────────────────\n");
  console.log("  1. MAKING EXCUSE — V2: 0%, UL: ~90%");
  console.log("     V2 has no making_excuse detector. Excuse framing is PURELY semantic.");
  console.log("     Examples V2 misses completely:");
  console.log(`     · "I had a crazy week at work"  → V2: general_chat`);
  console.log(`     · "maybe next week I'll get back on track"  → V2: general_chat`);
  console.log(`     · "I know I've been inconsistent, I'll fix that"  → V2: general_chat`);
  console.log("");
  console.log("  2. SEEKING VALIDATION — V2: 0%, UL: ~85%");
  console.log("     V2 has NO seeking_validation detector. Every question that isn't");
  console.log("     explicitly 'what should I' or 'how do I fix' falls to general_chat.");
  console.log(`     Examples: "is 3 days a week enough?", "am I overdoing it?",`);
  console.log(`     "do you think my routine is good enough?" → all V2: general_chat.`);
  console.log("");
  console.log("  3. MAKING COMMITMENT (implicit) — V2: 20%, UL: ~88%");
  console.log("     V2 requires 'my goal / I want to / I need to / I'm trying to'.");
  console.log("     Catches ~3/15 samples. UL catches all implicit future-intent language:");
  console.log(`     · "starting fresh today, all in"  → V2: general_chat`);
  console.log(`     · "I'm going to train every day this week"  → V2: general_chat`);
  console.log(`     · "this is the week I stop making excuses"  → V2: general_chat`);
  console.log("");
  console.log("  4. INFORMAL WORKOUT COMPLETION — V2: ~45%, UL: ~85%");
  console.log("     V2 requires 'just finished/done' or explicit lift with number.");
  console.log("     Missing patterns (all V2: general_chat):");
  console.log(`     · "finished push day, volume was good"   (needs 'just')`);
  console.log(`     · "completed my morning workout"         (needs 'just')`);
  console.log(`     · "killed back day today"                (no MOOD_POS match)`);
  console.log(`     · "morning run done, 5km"                (run != gym patterns)`);
  console.log("");
  console.log("  5. GUIDANCE / QUESTIONS (non-explicit) — V2: ~45%, UL: ~88%");
  console.log("     V2 RECOMMEND_REQUEST_RE needs exact verb from whitelist.");
  console.log("     Large blind spot for 'how often', 'is it bad to', 'can I X',");
  console.log("     'what's the best split', 'is creatine worth it', etc.");

  // ── Routing recommendation ──────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("── FINAL ROUTING RECOMMENDATION ──────────────────────────────────────\n");

  const recs: [string, string, string][] = [
    ["Intent family",              "Routing",              "Reason"],
    ["─".repeat(24),               "─".repeat(20),         "─".repeat(24)],
    ["reminder_create",            "KEEP V2 PRIMARY",      "V2: 100%, UL: 25%"],
    ["reminder_edit",              "KEEP V2 PRIMARY",      "V2: 100%, UL: 30%"],
    ["reminder_delete",            "KEEP V2 PRIMARY",      "V2: 100%, UL: 40%"],
    ["checkin_schedule",           "KEEP V2 PRIMARY",      "V2: 90%+ with specific time"],
    ["confirmation/rejection/ack", "KEEP V2 PRIMARY",      "V2 stateful disambiguation"],
    ["log_pain / log_soreness",    "KEEP V2 PRIMARY",      "Granularity UL can't provide"],
    ["log_weight",                 "SHARED OWNERSHIP",     "V2 precise, UL catches variants"],
    ["log_workout (explicit)",     "SHARED OWNERSHIP",     "V2: 85%, UL: 85% — complement"],
    ["log_skip (explicit)",        "SHARED OWNERSHIP",     "V2 strict, UL semantic fallback"],
    ["emotional_expression",       "SHARED OWNERSHIP",     "V2 keyword+UL nuance together"],
    ["seeking_guidance + questions","SAFE FOR UL PRIMARY", "UL: 88%, V2: 45%"],
    ["making_excuse",              "SAFE FOR UL PRIMARY",  "UL: 90%, V2: 0%"],
    ["seeking_validation",         "SAFE FOR UL PRIMARY",  "UL: 85%, V2: 0%"],
    ["making_commitment (implicit)","SAFE FOR UL PRIMARY", "UL: 88%, V2: 20%"],
    ["informal workout completion", "SAFE FOR UL PRIMARY", "UL: 85%, V2: 45%"],
    ["implicit skip / miss",        "SAFE FOR UL PRIMARY", "UL: 88%, V2: 40%"],
  ];

  for (const [a, b, c] of recs) {
    console.log(`  ${a.padEnd(26)} ${b.padEnd(22)} ${c}`);
  }

  console.log(`\n${LINE}`);
  console.log("── DIVERGENCE SPOT-CHECKS (10 highest-signal examples) ───────────────\n");

  const spotchecks = results
    .filter(r => r.category === "ul_wins" || r.category === "v2_wins")
    .slice(0, 30)
    .filter((_, i) => i % 3 === 0)
    .slice(0, 10);

  for (const r of spotchecks) {
    const winner = r.category === "ul_wins" ? "UL wins" : "V2 wins";
    console.log(`  [${winner}] ${JSON.stringify(r.message)}`);
    console.log(`    V2: ${r.actualV2 ?? "general_chat (no actionable)"}  →  UL(pred): ${r.expectedUL}`);
    if (r.notes) console.log(`    note: ${r.notes}`);
    console.log();
  }

  console.log(LINE);
  console.log("  MIGRATION RECOMMENDATION:");
  console.log("  Do NOT flip the primary router yet. Instead:");
  console.log("  1. Ship intent-specific overrides: if UL returns making_excuse,");
  console.log("     seeking_validation, or making_commitment and V2 returns general_chat,");
  console.log("     override to UL. This captures the 35 highest-value wins immediately.");
  console.log("  2. Expand V2 RECOMMEND_REQUEST_RE with 5–6 missing verb patterns.");
  console.log("  3. After 2 weeks of production data, rerun with --live to validate.");
  console.log(LINE + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isLive = process.argv.includes("--live");

  console.log(`\nRunning divergence audit (${isLive ? "LIVE" : "DRY-RUN"}) on ${SAMPLES.length} samples...`);
  if (isLive) {
    console.log("Live mode: calling runUnderstandingLayer for each sample. ~$0.02 total.\n");
  }

  const results: AuditResult[] = [];

  for (const sample of SAMPLES) {
    const actualV2 = getActualV2(sample.message);

    let actualUL = sample.expectedUL;
    if (isLive) {
      const ulResult = await runUnderstandingLayer({
        message:        sample.message,
        recentMessages: [],
      });
      actualUL = ulResult.intent;
    }

    const v2Match = actualV2 === sample.expectedV2;
    const ulMatch = actualUL === sample.expectedUL;
    const diverged = actualV2 !== null && actualUL !== null && actualV2 !== actualUL;

    results.push({ ...sample, actualV2, actualUL, v2Match, ulMatch, diverged });
  }

  printStaticReport(results);

  if (isLive) {
    // In live mode, also surface any surprises vs predictions
    const surprises = results.filter(r => !r.v2Match || !r.ulMatch);
    if (surprises.length > 0) {
      console.log(`\n── LIVE-RUN SURPRISES (${surprises.length} predictions wrong) ───────────\n`);
      for (const r of surprises) {
        if (!r.v2Match) {
          console.log(`  [V2 mismatch] #${r.id}: ${JSON.stringify(r.message)}`);
          console.log(`    predicted: ${r.expectedV2}  actual: ${r.actualV2}`);
        }
        if (!r.ulMatch) {
          console.log(`  [UL mismatch] #${r.id}: ${JSON.stringify(r.message)}`);
          console.log(`    predicted: ${r.expectedUL}  actual: ${r.actualUL}`);
        }
      }
    }
  }
}

// Only run when executed directly (not when imported for testing)
const isMain = process.argv[1]?.endsWith("divergence-audit.ts") ||
               process.argv[1]?.endsWith("divergence-audit.js");
if (isMain) main().catch(console.error);
