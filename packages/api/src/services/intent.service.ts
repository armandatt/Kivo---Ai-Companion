export function detectIntent(text: string): string {
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

  // Cancel a scheduled check-in — must come before schedule patterns
  if (
    /\b(stop|cancel|disable|turn off)\b/.test(text) &&
    /\b(check.?in|check me|reminders?|updates?|pings?|checking)\b/.test(text)
  ) return "checkin_cancel";
  if (/\b(no more (check.?ins?|reminders?|updates?|pings?))\b/.test(text)) return "checkin_cancel";

  // Schedule a proactive check-in: "check every 1 hour", "remind me in 30 min", "update me every hour"
  if (
    /\b(check(?: in| on me| me)?|remind me|update me|ping me|keep checking)\b/.test(text) &&
    /\b(every|in|each)\b/.test(text) &&
    /\b(\d+\s*(min|mins?|minutes?|hour|hours?|hr|hrs?))\b/.test(text)
  ) return "checkin_schedule";
  // "check every hour" without a number
  if (/\b(check(?: in| on me| me)?|remind me|update me|ping me|keep checking)\b.*\bevery\s+hour\b/.test(text)) return "checkin_schedule";

  if (
    (text.includes("push") || text.includes("extend") || text.includes("postpone") || text.includes("delay")) &&
    (text.includes("hour") || text.includes("hr") || text.includes("min") || text.includes("minute"))
  ) return "schedule_adjust";
  if (text.includes("start focus") || text.includes("focus mode") || text.includes("focus session")) return "focus_start";
  if (text.includes("plan my week") || text.includes("plan my day") || text.includes("planner") || text.includes("update plan") || text.includes("change plan") || text.includes("plan")) return "planning";
  if (text.includes("streak")) return "streak_check";
  if (text.includes("progress") || text.includes("how am i doing")) return "progress_check";
  if (text.includes("rough day") || text.includes("not feeling it")) return "emotional_trigger";
  if (text.includes("skip today")) return "rest_day";
  if (text.includes("due") || text.includes("deadline")) return "deadline_set";
  if (text.includes("weekly report") || text.includes("weekly review")) return "weekly_review";
  if (text.includes("done") || text.includes("finished")) return "completion";
  if (text.includes("i want") || text.includes("goal") || text.includes("trying to")) return "goal_set";

  return "general_chat";
}
