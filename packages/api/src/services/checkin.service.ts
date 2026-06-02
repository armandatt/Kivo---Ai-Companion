import { getPlan } from "./planner.service";
import { getMemory } from "./memory.service";
import { getUpcomingDeadlines } from "./deadline.service";
import { getUser, type CompanionVisitKind } from "./user.service";

export async function generateDynamicCheckIn(userId: string) {
  const plan = await getPlan(userId);
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const user = await getUser(userId);

  const name = user.name && user.name !== "there" ? user.name : null;
  const activeGoal = memory.longTerm.goals?.[0];
  const deadlineLine = deadlines[0] ? `Nearest: ${deadlines[0].title}.` : null;
  const recentUserLine = getLastUserLine(memory.shortTerm || []);
  const planLines = plan ? plan.split("\n").filter(Boolean).slice(0, 3) : [];

  const lines = [
    name ? `Check-in, ${name}.` : "Check-in.",
    recentUserLine ? `Last I heard: "${recentUserLine}"` : null,
    activeGoal ? `Still moving this: ${activeGoal}?` : "What's the current focus?",
    planLines[0] ? `Next piece: ${planLines[0]}` : null,
    deadlineLine,
    "One honest line.",
  ];

  return lines.filter(Boolean).join("\n");
}

export async function generateCheckIn(userId: string) {
  const plan = await getPlan(userId);
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const activeGoal = memory.longTerm.goals?.[0];

  return `
🌅 I’m here. We start now.

Today has to get shaped before it starts shaping you.

${plan ? `Your current plan:\n${plan.split("\n").slice(0, 6).join("\n")}` : "No plan is locked yet."}

${activeGoal ? `Main thread: ${activeGoal}` : "Pick one clean target for today."}

${deadlines.length ? `Upcoming: ${deadlines[0].title}.` : ""}

Send me:
1. Your top priority
2. Any deadline I should track
3. What time you want to do the first focused block
  `;
}

export async function generateCompanionVisit(
  userId: string,
  kind: CompanionVisitKind
) {
  const user = await getUser(userId);
  const plan = await getPlan(userId);
  const memory = await getMemory(userId);
  const deadlines = await getUpcomingDeadlines(userId);
  const goals = memory.longTerm.goals || [];
  const activeGoal = goals[0];
  const struggles = memory.longTerm.struggles || [];
  const anchors = memory.longTerm.anchors || [];
  const preferences = memory.longTerm.preferences || [];
  const recentUserLine = getLastUserLine(memory.shortTerm || []);
  const name = user.name && user.name !== "there" ? user.name : "you";
  const creature = extractAnchor(anchors, "creature_name");
  const aspiration = extractAnchor(anchors, "aspiration_words");
  const accountability = extractPreference(preferences, "accountability_style") || user.tonePreference;
  const isGym = goals.some((goal: string) =>
    /\b(gym|fitness|workout|lift|bench|squat|deadlift|cut|bulk)\b/i.test(goal)
  );
  const planLines = plan ? plan.split("\n").filter(Boolean).slice(0, 5) : [];
  const deadlineLine = deadlines[0] ? `Nearest deadline: ${deadlines[0].title}.` : null;
  const emotionalThread = buildEmotionalThread({
    creature,
    aspiration,
    struggle: struggles[0],
    recentUserLine,
  });

  if (kind === "basic_2h" || kind === "basic_6h" || kind === "basic_10h") {
    return buildBasicMentorMessage({
      name,
      kind,
      activeGoal,
      deadlineLine,
      planLines,
      emotionalThread,
      accountability,
      isGym,
    });
  }

  if (kind === "major_4h" || kind === "major_8h") {
    return [
      kind === "major_4h" ? "Deep checkpoint." : "Second deep checkpoint.",
      `Pause for one honest minute, ${name}.`,
      emotionalThread,
      activeGoal ? `The thread we are protecting: ${activeGoal}` : "No main goal is pinned yet. Give me one.",
      planLines.length ? `Plan pulse:\n${planLines.slice(0, 4).join("\n")}` : "If there is no plan, we build the next block from what is real right now.",
      deadlineLine,
      isGym
        ? "Tell me: trained / not yet / avoiding. I can work with truth. I cannot work with silence."
        : "Tell me three things: what moved, what slipped, and what needs a new time.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (kind === "evening") {
    return [
      "Evening review. No performance. Just truth.",
      emotionalThread,
      activeGoal ? `Did you move this forward today: ${activeGoal}?` : "Tell me what moved today, even if it was small.",
      deadlineLine,
      "Send me: done / missed / moved.",
      isGym ? "If training happened, log sets or effort. If not, we adjust tomorrow without drama." : "If the plan slipped, say what changed. I’ll recalibrate tomorrow.",
      creature ? `${creature} does not need a perfect day. It needs you to return.` : "A real system is built by returning, not by pretending.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return generateCheckIn(userId);
}

function buildBasicMentorMessage(input: {
  name: string;
  kind: CompanionVisitKind;
  activeGoal?: string;
  deadlineLine: string | null;
  planLines: string[];
  emotionalThread?: string | null;
  accountability?: string | null;
  isGym: boolean;
}) {
  const label =
    input.kind === "basic_2h"
      ? "Two-hour pulse."
      : input.kind === "basic_6h"
        ? "Six-hour pulse."
        : "Ten-hour pulse.";
  const soft = input.accountability === "soft";

  return [
    label,
    soft
      ? `Still with you, ${input.name}. Small honest update.`
      : `Still here, ${input.name}. No drifting quietly.`,
    input.emotionalThread,
    input.activeGoal ? `Are we still moving this: ${input.activeGoal}?` : "What is the next honest action?",
    input.deadlineLine,
    input.planLines[0] ? `Next planned piece: ${input.planLines[0]}` : null,
    input.isGym
      ? "Reply with the next training action, even if it is just warm-up."
      : "Reply with one line: done, stuck, or changing plan.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildEmotionalThread(input: {
  creature?: string | null;
  aspiration?: string | null;
  struggle?: string;
  recentUserLine?: string | null;
}) {
  if (input.recentUserLine) {
    return `I remember where you left this: “${input.recentUserLine}”`;
  }

  if (input.aspiration) {
    return `You said the version you are building is: ${input.aspiration}. Keep acting like that person exists.`;
  }

  if (input.struggle) {
    return `The pattern we are watching: ${input.struggle}. Not judging it. Tracking it.`;
  }

  if (input.creature) {
    return `${input.creature} is not decoration. It is a reminder that your choices compound.`;
  }

  return null;
}

function getLastUserLine(shortTerm: string[]) {
  const line = [...shortTerm].reverse().find((message) => message.startsWith("user: "));
  if (!line) return null;
  const text = line.replace(/^user:\s*/, "").trim();
  return text.length > 90 ? `${text.slice(0, 87).trim()}...` : text;
}

function extractAnchor(anchors: string[], key: string) {
  const prefix = `${key}:`;
  const value = anchors.find((anchor) => anchor.startsWith(prefix));
  return value?.slice(prefix.length).trim() || null;
}

function extractPreference(preferences: string[], key: string) {
  const prefix = `${key}:`;
  const value = preferences.find((preference) => preference.startsWith(prefix));
  return value?.slice(prefix.length).trim() || null;
}
