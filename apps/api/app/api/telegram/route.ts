//@ts-ignore
import { processMessage } from "@repo/api/processor/messageProcessor";
//@ts-ignore
import { buildContext } from "@repo/api/context/contextBuilder";
//@ts-ignore
import { generateResponse } from "@repo/api/services/llm";
//@ts-ignore
import { buildSystemState } from "@repo/api/services/decision.service";
//@ts-ignore
import { addToShortTerm, addToLongTerm } from "@repo/api/services/memory.service";
//@ts-ignore
import { runDecisionEngine } from "@repo/api/services/decision.engine";
//@ts-ignore
import { startFocusSession } from "@repo/api/services/focus.service";
//@ts-ignore
import { fireMentorIntakeOpener } from "@repo/api/services/mentorIntake.service";
//@ts-ignore
import { generateAIPlan, savePlan } from "@repo/api/services/planner.service";
//@ts-ignore
import { updateUserProfile } from "@repo/api/services/user.service";
//@ts-ignore
import { checkRateLimit } from "@repo/api/services/rateLimit.service";
//@ts-ignore
import { pushNearestDeadline, saveDeadline } from "@repo/api/services/deadline.service";
//@ts-ignore
import { formatMessengerText } from "@repo/api/services/formatter.service";
//@ts-ignore
import { generateProgressSummary, generateWeeklyReview } from "@repo/api/services/review.service";
//@ts-ignore
import { handleGymMessage } from "@repo/api/services/gym.service";
//@ts-ignore
import { handlePostSessionDebriefResponse, resetReengagementFlag } from "@repo/api/services/gymCron.service";
//@ts-ignore
import { needsIntake, getWebProfile, handleIntakeMessage } from "@repo/api/services/intake.service";
import { prisma } from "@repo/db/client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = body.message?.text || "";
    const chatId = body.message?.chat?.id;
    const from = body.message?.from;

    console.log("WEBHOOK HIT — incoming message:", text);

    if (!text || !chatId) {
      return Response.json({ ok: true });
    }

    const stopTyping = startTelegramTyping(chatId);

    try {
      await updateUserProfile(chatId.toString(), {
        displayName: [from?.first_name, from?.last_name].filter(Boolean).join(" ") || undefined,
        username: from?.username,
      });

      const handledTelegramConnect = await handleTelegramConnectStart(text, chatId);
      if (handledTelegramConnect) {
        return Response.json({ ok: true });
      }

      // Intake gate — runs until the domain-specific intake conversation is complete
      if (await needsIntake(chatId.toString())) {
        const webProfile = await getWebProfile(chatId.toString());
        const intakeResult = await handleIntakeMessage({
          platformChatId: chatId.toString(),
          text,
          webProfile,
        });
        if (intakeResult.handled) {
          await sendTelegramMessage(chatId, intakeResult.reply);
          return Response.json({ ok: true });
        }
      }

      const rateLimit = await checkRateLimit(chatId.toString());
      if (!rateLimit.allowed) {
        await sendTelegramMessage(chatId, "You’ve been busy today. Give me a few minutes to catch up.");
        return Response.json({ ok: true });
      }

      const processed = processMessage(text);
      const gymUserId = body.userId || body.user?.id;

      if (gymUserId) {
        await resetReengagementFlag(gymUserId);

        const debriefReply = await handlePostSessionDebriefResponse(gymUserId, processed.cleanedText);
        if (debriefReply) {
          await sendTelegramMessage(chatId, debriefReply);
          await addToShortTerm(chatId.toString(), debriefReply, {
            role: "assistant",
            intent: "post_session_debrief",
            emotion: processed.emotion,
          });
          return Response.json({ ok: true });
        }

        const gymResult = await handleGymMessage({
          userId: gymUserId,
          text: processed.cleanedText,
          intent: processed.intent,
        });

        if (gymResult.handled && gymResult.reply) {
          await sendTelegramMessage(chatId, gymResult.reply);
          await addToShortTerm(chatId.toString(), gymResult.reply, {
            role: "assistant",
            intent: processed.intent,
            emotion: processed.emotion,
          });
          return Response.json({ ok: true });
        }
      }

      await addToShortTerm(chatId.toString(), text, {
        role: "user",
        intent: processed.intent,
        emotion: processed.emotion,
      });

      if (processed.entities?.goal) {
        await addToLongTerm(chatId.toString(), "goals", processed.entities.goal);
      }

      if (processed.entities?.deadline) {
        await saveDeadline({
          platformChatId: chatId.toString(),
          title: processed.entities.deadline.label,
          dueAt: processed.entities.deadline.dueAt,
        });
      }

      const context = await buildContext(processed, chatId.toString());
      const systemState = buildSystemState(processed, context);
      const decision = await runDecisionEngine({
        message: text,
        processed,
        context,
        system: systemState,
      });

      if (decision.type === "focus_start") {
        startFocusSession(
          chatId.toString(),
          (id: string, text: string) => sendTelegramMessage(id, text, "Markdown"),
          processed.entities?.focusDurationMin || 25
        );
        return Response.json({ ok: true });
      }

      if (decision.type === "deadline") {
        const deadline = processed.entities?.deadline;
        const reply = deadline
          ? `Got it. I’ll keep ${deadline.label} in view.`
          : "I caught a deadline intent, but not the date. Send it like: assignment due Friday 6pm.";

        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      if (decision.type === "schedule_adjust") {
        const minutes = processed.entities?.timeShiftMin || 60;
        const updatedDeadline = await pushNearestDeadline(chatId.toString(), minutes);
        const reply = updatedDeadline
          ? `Done. I pushed ${updatedDeadline.title} by ${minutes >= 60 ? `${minutes / 60} hour` : `${minutes} minutes`}.`
          : "I can adjust that, but I do not see an active deadline yet. Send the deadline first.";

        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      if (decision.type === "progress") {
        const reply = await generateProgressSummary(chatId.toString());
        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      if (decision.type === "weekly_review") {
        const reply = await generateWeeklyReview(chatId.toString());
        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      if (decision.type === "planner_ai") {
        const plan = await generateAIPlan({ message: text, context });

        await savePlan(chatId.toString(), plan);
        await sendAndRemember(chatId, plan, processed.intent, processed.emotion);
        await sendTelegramMessage(chatId, "I’ll keep this in mind for your week.");
        return Response.json({ ok: true });
      }

      let reply = decision.type !== "llm" && decision.reply
        ? decision.reply
        : await generateResponse({
            message: text,
            context,
            system: systemState,
          });

      if (rateLimit.warning) {
        reply = `${reply}\n\nYou’re close to today’s free message limit, so I may slow down soon.`;
      }

      await sendAndRemember(chatId, reply, processed.intent, systemState.emotion);
      return Response.json({ ok: true });
    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return Response.json({ ok: false });
  }
}

async function handleTelegramConnectStart(text: string, chatId: number | string) {
  const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  const payload = match?.[1]?.trim();

  if (!match || !payload) {
    return false;
  }

  const profile = await prisma.userProfile.findUnique({
    where: { telegramConnectToken: payload },
    select: { id: true },
  });

  if (!profile) {
    await sendTelegramMessage(
      chatId,
      "That link has expired. Go back to your dashboard and try again."
    );
    return true;
  }

  await prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      telegramChatId: String(chatId),
      telegramConnected: true,
      telegramConnectedAt: new Date(),
      telegramConnectToken: null,
      lastActivityAt: new Date(),
    },
  });

  await fireMentorIntakeOpener(
    profile.id,
    String(chatId),
    (id: string, msg: string) => sendTelegramMessage(id, msg),
  );
  return true;
}

async function sendAndRemember(
  chatId: number | string,
  text: string,
  intent: string,
  emotion: string
) {
  await sendTelegramMessage(chatId, text);
  await addToShortTerm(chatId.toString(), text, {
    role: "assistant",
    intent,
    emotion,
  });
}

function startTelegramTyping(chatId: number | string) {
  void sendTelegramChatAction(chatId, "typing");

  const timer = setInterval(() => {
    void sendTelegramChatAction(chatId, "typing");
  }, 4000);

  return () => clearInterval(timer);
}

async function sendTelegramChatAction(
  chatId: number | string,
  action: "typing"
) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        action,
      }),
    });
  } catch (error) {
    console.error("Telegram typing action failed:", error);
  }
}

async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  parseMode?: "Markdown"
) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN or BOT_TOKEN not set");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatMessengerText(text),
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram send failed: ${error}`);
  }
}
