import { generateGeminiText } from "./gemini.service";
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
	You are Kevo, an intelligent planning assistant.

User info:
- Name: ${input.context.user.name}
- Goals: ${input.context.memory.longTerm.goals?.join(", ")}

User request:
"${input.message}"

Task:
1. Extract activities
2. Distribute them across a week
3. Keep it realistic
4. Keep it clean and structured

Format STRICTLY like:

📅 Your Week — Structured

Mon:
• Task
• Task

Tue:
• Task

...

	Keep it concise.
	`;

  try {
    return await generateGeminiText({ prompt, maxOutputTokens: 900 });
  } catch (error) {
    console.error("Gemini planner error:", error);
    return "Couldn't generate plan right now. Try again in a bit.";
  }
}
