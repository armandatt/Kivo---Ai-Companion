export function detectIntent(text: string): string {
  // ── Gym-specific ────────────────────────────────────────────────────────────
  if (/\b(should i train today|am i overtraining|ok to train|okay to train|train on sore)\b/.test(text)) return "recovery_query";
  if (/\b(how much protein|what should i eat|protein sources|good protein sources)\b/.test(text)) return "nutrition_query";
  if (/\b(knee hurts|shoulder pain|lower back sore|pain when|hurts when)\b/.test(text)) return "pain_report";
  if (/\b(new .*\bpr\b|new max|hit \d+(\.\d+)?\s*kg.*\b(squat|bench|deadlift)|\bpr\b)\b/.test(text)) return "pr_log";
  if (/\b(bench|squat|squats|deadlift|deadlifts|press|row|curl)\b.*\b(\d+(\.\d+)?\s*kg|\d+\s*x\s*\d+|\d+\s*sets?\b)/.test(text)) return "lift_log";
  if (/\b(just finished training|hit the gym|done with .*day|finished .*workout|done training)\b/.test(text)) return "gym_checkin";
  if (/\b(chest is sore|legs are dead|back is killing me|sore|doms)\b/.test(text)) return "soreness_log";
  if (/\b(skipped today|didn'?t go|missed my workout|missed workout|skipped workout)\b/.test(text)) return "missed_session";
  if (/\b(i weigh|current weight|weighing)\b.*\d+|\b\d+(\.\d+)?\s*kg\b/.test(text)) return "weight_log";
  if (/\b(feeling flat|no energy|feeling great|low energy|tired today|energized)\b/.test(text)) return "energy_checkin";

  // ── Cancel check-in (must come before schedule patterns) ───────────────────
  if (
    /\b(stop|cancel|disable|turn off|don'?t)\b/.test(text) &&
    /\b(check.?in|check me|remind(ers?)?|updates?|pings?|checking|notifications?)\b/.test(text)
  ) return "checkin_cancel";
  if (/\b(no more (check.?ins?|reminders?|updates?|pings?|notifications?))\b/.test(text)) return "checkin_cancel";

  // ── Schedule check-in ───────────────────────────────────────────────────────
  // Matches: "check every 1 hour", "remind me in 30 min", "text me after 20 min",
  //          "ping me in 1 hour", "message me every hour", "hit me up in 15 min",
  //          "follow up in 30", "let me know after 45 min", "catch me in 20 min"
  const hasScheduleVerb = /\b(check(?: in| on me| me)?|remind(?: me)?|update me|ping(?: me)?|text me|message me|hit me up|follow up|let me know|catch(?: me)?|keep checking)\b/.test(text);
  const hasTimeValue    = /\b(\d{1,3})\s*(?:min|mins?|minutes?|hour|hours?|hr|hrs?)\b/.test(text);
  const hasTimeIndicator = /\b(every|each|in|after|within|around)\b/.test(text);

  if (hasScheduleVerb && hasTimeValue && hasTimeIndicator) return "checkin_schedule";

  // "check every hour" / "remind me every hour" (no explicit number)
  if (hasScheduleVerb && /\bevery\s+hour\b/.test(text)) return "checkin_schedule";

  // "text me in 30" / "after 30 min" with strong scheduling verb even without time indicator
  if (hasScheduleVerb && hasTimeValue) return "checkin_schedule";

  // ── Schedule adjust ─────────────────────────────────────────────────────────
  if (
    (text.includes("push") || text.includes("extend") || text.includes("postpone") || text.includes("delay")) &&
    (text.includes("hour") || text.includes("hr") || text.includes("min") || text.includes("minute"))
  ) return "schedule_adjust";

  // ── Focus ───────────────────────────────────────────────────────────────────
  if (/\b(start focus|focus mode|focus session|pomodoro|timer)\b/.test(text)) return "focus_start";

  // ── Planning ────────────────────────────────────────────────────────────────
  if (/\b(plan my week|plan my day|plan for (today|tomorrow|this week)|planner|update plan|change plan|make a plan|need a plan)\b/.test(text)) return "planning";
  if (text.includes("plan") && (text.includes("week") || text.includes("day") || text.includes("schedule"))) return "planning";

  // ── Progress / streak ───────────────────────────────────────────────────────
  if (/\b(streak|how many days)\b/.test(text)) return "streak_check";
  if (/\b(progress|how am i doing|my stats|my score)\b/.test(text)) return "progress_check";

  // ── Emotional ───────────────────────────────────────────────────────────────
  if (/\b(rough day|not feeling it|burnout|can'?t do this|overwhelmed today)\b/.test(text)) return "emotional_trigger";

  // ── Misc ────────────────────────────────────────────────────────────────────
  if (/\b(skip today|rest day|taking the day off)\b/.test(text)) return "rest_day";
  if (/\b(due|deadline|submit by|hand in|due on|due at)\b/.test(text)) return "deadline_set";
  if (/\b(weekly (report|review)|week in review|end of week)\b/.test(text)) return "weekly_review";
  if (/\b(done|finished|completed|submitted|shipped|deployed|passed)\b/.test(text)) return "completion";
  if (/\b(i want|my goal|i'?m trying to|i want to|goal is|want to (learn|build|get|become|lose|gain))\b/.test(text)) return "goal_set";

  return "general_chat";
}
