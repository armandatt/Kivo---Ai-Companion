import { generateOpenAIText } from "./openai.service";
import { prisma } from "@repo/db/client";

const planStore: Record<string, string> = {};

export async function savePlan(userId: string, plan: string) {
  planStore[userId] = plan;

  try {
    const user = await prisma.messengerUser.upsert({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId: userId,
        },
      },
      update: {},
      create: {
        platform: "telegram",
        platformChatId: userId,
      },
    });

    await prisma.plan.updateMany({
      where: {
        userId: user.id,
        status: "active",
      },
      data: {
        status: "archived",
      },
    });

    await prisma.plan.create({
      data: {
        userId: user.id,
        content: plan,
      },
    });
  } catch (error) {
    console.error("Failed to save plan:", error);
  }
}

export async function getPlan(userId: string) {
  try {
    const plan = await prisma.plan.findFirst({
      where: {
        status: "active",
        user: {
          platform: "telegram",
          platformChatId: userId,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return plan?.content || planStore[userId] || null;
  } catch (error) {
    console.error("Failed to load plan:", error);
    return planStore[userId] || null;
  }
}

export async function generateAIPlan(input: {
  message: string;
  context: any;
}) {
  const prompt = `
You are Kevo, building a realistic weekly execution plan.

User:
- Name: ${input.context.user.name}
- Goals: ${input.context.memory.longTerm.goals?.join(", ") || "none"}
- Deadlines: ${input.context.memory.longTerm.deadlines?.join(", ") || "none"}
- Preferences: ${input.context.memory.longTerm.preferences?.join(", ") || "none"}

User request:
"${input.message}"

Build the plan by:
1. Extracting concrete activities from the request.
2. Spreading work across the next 7 days.
3. Keeping daily load realistic.
4. Adding recovery or buffer time when the request involves gym, study, deadlines, or burnout.
5. Using short action labels, not long explanations.

Return only this format:

Your Week - Structured

Mon:
- Task
- Task

Tue:
- Task

Wed:
- Task

Thu:
- Task

Fri:
- Task

Sat:
- Task

Sun:
- Task

Keep it concise. Do not add intro or outro text.
`;

  try {
    return await generateOpenAIText({ prompt, maxOutputTokens: 900 });
  } catch (error) {
    console.error("OpenAI planner error:", error);
    return "Couldn't generate plan right now. Try again in a bit.";
  }
}
