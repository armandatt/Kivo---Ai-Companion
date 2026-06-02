import { prisma } from "@repo/db/client";

export function startFocusSession(
  chatId: string,
  sendMessage: Function,
  durationMin = 25
) {
  const duration = durationMin * 60 * 1000;

  // unique session
  const sessionId = Date.now().toString();
  void saveFocusSession(chatId, sessionId, durationMin);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://your-app.vercel.app";
  const FOCUS_URL = `${baseUrl}/focus?sessionId=${sessionId}`;

  // 🔥 TELEGRAM MESSAGE (interactive)
  sendMessage(chatId, `
🧠 *Focus Mode Activated*

⏳ ${durationMin} minutes  
📵 No distractions  
🎯 One task only  

Tap below for a clean focus screen 👇
${FOCUS_URL}

Start now. I’m here.
  `);

  // ⏳ TIMER BACKEND
  setTimeout(() => {
    void completeFocusSession(sessionId);
    sendMessage(chatId, `
✅ *Session Complete*

You showed up. That’s what matters.

Go again or take a break?
    `);
  }, duration);
}

async function saveFocusSession(platformChatId: string, sessionId: string, durationMin: number) {
  try {
    const user = await prisma.messengerUser.upsert({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId,
        },
      },
      update: {},
      create: {
        platform: "telegram",
        platformChatId,
      },
    });

    await prisma.focusSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        durationMin,
      },
    });
  } catch (error) {
    console.error("Failed to save focus session:", error);
  }
}

async function completeFocusSession(sessionId: string) {
  try {
    await prisma.focusSession.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Failed to complete focus session:", error);
  }
}
