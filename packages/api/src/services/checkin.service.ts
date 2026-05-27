import { getPlan } from "./planner.service";
import { getMemory } from "./memory.service";
import { getUpcomingDeadlines } from "./deadline.service";

export async function generateCheckIn(userId: string) {
  const plan = await getPlan(userId);
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const activeGoal = memory.longTerm.goals?.[0];

  return `
🌅 Morning.

Here’s what matters today:

${plan ? plan.split("\n").slice(0, 6).join("\n") : "No plan yet."}

${activeGoal ? `Keep the thread tied to this: ${activeGoal}` : "Pick one clean target today."}

${deadlines.length ? `Upcoming: ${deadlines[0].title}.` : ""}

What’s the one thing you’re focusing on today?
  `;
}

export async function generateCompanionVisit(
  userId: string,
  kind: "morning" | "plan_nudge" | "evening"
) {
  const plan = await getPlan(userId);
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const goals = memory.longTerm.goals || [];
  const activeGoal = goals[0];
  const isGym = goals.some((goal: string) =>
    /\b(gym|fitness|workout|lift|bench|squat|deadlift|cut|bulk)\b/i.test(goal)
  );
  const planLines = plan ? plan.split("\n").filter(Boolean).slice(0, 5) : [];
  const deadlineLine = deadlines[0] ? `Nearest deadline: ${deadlines[0].title}.` : null;

  if (kind === "plan_nudge") {
    return [
      "Quick check-in.",
      planLines.length ? "You have this lined up:" : activeGoal ? `Still tied to: ${activeGoal}` : "No plan is locked yet.",
      ...planLines.slice(0, 3),
      deadlineLine,
      isGym ? "For gym: do not negotiate with the warm-up. Just start." : "Want me to update the plan or push a time block?",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (kind === "evening") {
    return [
      "Evening check.",
      activeGoal ? `Did you move this forward today: ${activeGoal}?` : "Tell me what moved today, even if it was small.",
      deadlineLine,
      isGym ? "If training happened, log it. If it did not, we adjust tomorrow without drama." : "If the plan slipped, say what changed. I’ll recalibrate it.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return generateCheckIn(userId);
}
