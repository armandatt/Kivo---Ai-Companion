import { getMemory } from "./memory.service";
import { getUpcomingDeadlines } from "./deadline.service";

export async function generateProgressSummary(userId: string) {
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const goals = memory.longTerm.goals || [];

  if (!goals.length && !deadlines.length) {
    return "I do not have enough signal yet. Tell me one goal, one deadline, or what you showed up for today.";
  }

  return [
    "Here is the honest read:",
    goals[0] ? `Goal in focus: ${goals[0]}` : null,
    deadlines[0] ? `Nearest deadline: ${deadlines[0].title}` : null,
    "Next move: choose one action you can finish today.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateWeeklyReview(userId: string) {
  const memory = await getMemory(userId);
  const goals = memory.longTerm.goals || [];
  const deadlines = memory.longTerm.deadlines || [];

  return [
    "Weekly review:",
    goals.length ? `What stayed alive: ${goals.slice(0, 3).join(", ")}` : "No clear goal tracked yet.",
    deadlines.length ? `Pressure points: ${deadlines.slice(0, 2).join(", ")}` : "No active deadlines tracked.",
    "One insight: consistency comes from making the next step smaller, then actually doing it.",
  ].join("\n");
}
