export function detectIntent(text: string): string {
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
