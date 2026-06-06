import { getMemory } from "./memory.service";
import { getUpcomingDeadlines } from "./deadline.service";
import { getUser } from "./user.service";

export async function generateDynamicCheckIn(userId: string) {
  const memory    = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const user      = await getUser(userId);

  const name           = user.name && user.name !== "there" ? user.name : null;
  const activeGoal     = memory.longTerm.goals?.[0];
  const deadlineLine   = deadlines[0] ? `Nearest: ${deadlines[0].title}.` : null;
  const recentUserLine = getLastUserLine(memory.shortTerm || []);

  const lines = [
    name ? `Check-in, ${name}.` : "Check-in.",
    recentUserLine ? `Last I heard: "${recentUserLine}"` : null,
    activeGoal ? `Still moving this: ${activeGoal}?` : "What's the current focus?",
    deadlineLine,
    "One honest line.",
  ];

  return lines.filter(Boolean).join("\n");
}

function getLastUserLine(shortTerm: string[]) {
  const line = [...shortTerm].reverse().find((message) => message.startsWith("user: "));
  if (!line) return null;
  const text = line.replace(/^user:\s*/, "").trim();
  return text.length > 90 ? `${text.slice(0, 87).trim()}...` : text;
}
