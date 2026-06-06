//@ts-ignore
import { processMessage } from "@repo/api/processor/messageProcessor";
//@ts-ignore
import { runOrchestrator } from "@repo/api/engines/mentor-orchestrator";
//@ts-ignore
import { addToShortTerm, addToLongTerm } from "@repo/api/services/memory.service";
//@ts-ignore
import { startFocusSession } from "@repo/api/services/focus.service";
//@ts-ignore
import { fireMentorIntakeOpener } from "@repo/api/services/mentorIntake.service";
//@ts-ignore
import { saveDeadline, pushNearestDeadline } from "@repo/api/services/deadline.service";
//@ts-ignore
import { updateUserProfile } from "@repo/api/services/user.service";
//@ts-ignore
import { checkRateLimit } from "@repo/api/services/rateLimit.service";
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
//@ts-ignore
import { handleWorkoutCommand, handleActiveLoggingMessage } from "@repo/api/services/workoutTracking.service";
//@ts-ignore
import { handleOffTopicMessage } from "@repo/api/services/offTopicClassifier.service";
//@ts-ignore
import { scheduleCheckIn, cancelCheckIn } from "@repo/api/services/scheduleCheckin.service";
//@ts-ignore
import { listReminders, cancelReminderByIndex, parseAndCreateReminder } from "@repo/api/services/customReminder.service";
//@ts-ignore
import { parseAndSaveNutrition } from "@repo/api/services/rexSessionContext.service";
//@ts-ignore
import { detectTimeMention } from "@repo/api/services/checkin-offer.service";
//@ts-ignore
import { shouldOfferCheckIn } from "@repo/api/services/checkin-offer.service";
//@ts-ignore
import { isConfirmation, isRejection } from "@repo/api/services/checkin-offer.service";
//@ts-ignore
import { getPendingOffer, setPendingOffer, clearPendingOffer } from "@repo/api/services/checkin-offer.service";
//@ts-ignore
import { buildOfferMessage } from "@repo/api/services/checkin-offer.service";
import { prisma } from "@repo/db/client";

export const runtime = "nodejs";

// ── Rate-limit warning dedup ──────────────────────────────────────────────────
// Shows the warning at most once per day per user. Resets on process restart,
// which is fine — Railway restarts are infrequent.
const rateLimitWarnedToday = new Map<string, string>(); // chatId → "YYYY-MM-DD"

function hasWarnedToday(chatId: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return rateLimitWarnedToday.get(chatId) === today;
}
function markWarned(chatId: string): void {
  rateLimitWarnedToday.set(chatId, new Date().toISOString().slice(0, 10));
}

export async function POST(req: Request) {
  try {
    const body   = await req.json();
    const text   = body.message?.text || "";
    const chatId = body.message?.chat?.id;
    const from   = body.message?.from;

    if (!text || !chatId) return Response.json({ ok: true });

    const stopTyping = startTelegramTyping(chatId);

    try {
      // ── Profile update (display name, username) ───────────────────────────
      await updateUserProfile(chatId.toString(), {
        displayName: [from?.first_name, from?.last_name].filter(Boolean).join(" ") || undefined,
        username:    from?.username,
      });

      // ── /start token handling (web → Telegram connect) ────────────────────
      if (await handleTelegramConnectStart(text, chatId)) {
        return Response.json({ ok: true });
      }

      // ── Intake gate ───────────────────────────────────────────────────────
      if (await needsIntake(chatId.toString())) {
        const webProfile    = await getWebProfile(chatId.toString());
        const intakeResult  = await handleIntakeMessage({ platformChatId: chatId.toString(), text, webProfile });
        if (intakeResult.handled) {
          await sendTelegramMessage(chatId, intakeResult.reply);
          return Response.json({ ok: true });
        }
      }

      // ── Workout commands (/log /pr /progress /history /overload /streak /split)
      const workoutCmd = await handleWorkoutCommand(chatId.toString(), text);
      if (workoutCmd.handled) {
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: workoutCmd.intent ?? "workout_cmd", emotion: "neutral" });
        await sendAndRemember(chatId, workoutCmd.reply, workoutCmd.intent ?? "workout_cmd", "neutral");
        return Response.json({ ok: true });
      }

      // ── /reminders — list active custom reminders ─────────────────────────
      if (/^\/reminders\b/i.test(text.trim())) {
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: "reminders_list", emotion: "neutral" });
        const reply = await listReminders(chatId.toString());
        await sendAndRemember(chatId, reply, "reminders_list", "neutral");
        return Response.json({ ok: true });
      }

      // ── /cancel N — remove a custom reminder by index ─────────────────────
      const cancelMatch = text.trim().match(/^\/cancel\s+(\d+)$/i);
      if (cancelMatch) {
        const index = parseInt(cancelMatch[1]!, 10);
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: "reminder_cancel", emotion: "neutral" });
        const reply = await cancelReminderByIndex(chatId.toString(), index);
        await sendAndRemember(chatId, reply, "reminder_cancel", "neutral");
        return Response.json({ ok: true });
      }

      // ── Natural-language reminder creation ────────────────────────────────
      // "remind me at 8am to...", "update me at breakfast with...", "check in with me at 10pm..."
      if (/\b(remind|reminder|update me at|check in with me at|ping me at)\b/i.test(text)) {
        const result = await parseAndCreateReminder(chatId.toString(), text);
        if (result?.created) {
          await addToShortTerm(chatId.toString(), text, { role: "user", intent: "reminder_create", emotion: "neutral" });
          await sendAndRemember(chatId, result.reply, "reminder_create", "neutral");
          return Response.json({ ok: true });
        }
        // If parsing failed, fall through to normal processing
      }

      // ── Active workout logging (mid-session set entry) ────────────────────
      const loggingResult = await handleActiveLoggingMessage(chatId.toString(), text);
      if (loggingResult.handled) {
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: "workout_logging", emotion: "neutral" });
        await sendAndRemember(chatId, loggingResult.reply, "workout_logging", "neutral");
        return Response.json({ ok: true });
      }

      // ── Rate limit ────────────────────────────────────────────────────────
      const rateLimit = await checkRateLimit(chatId.toString());
      if (!rateLimit.allowed) {
        await sendTelegramMessage(chatId, "You've been busy today. Give me a few minutes to catch up.");
        return Response.json({ ok: true });
      }

      // ── Gym short-circuit (runs before general processing) ────────────────
      const processed = await processMessage(text);
      const gymUserId = body.userId || body.user?.id;

      if (gymUserId) {
        await resetReengagementFlag(gymUserId);

        const debriefReply = await handlePostSessionDebriefResponse(gymUserId, processed.cleanedText);
        if (debriefReply) {
          await sendAndRemember(chatId, debriefReply, processed.intent, processed.emotion);
          return Response.json({ ok: true });
        }

        const gymResult = await handleGymMessage({
          userId: gymUserId,
          text:   processed.cleanedText,
          intent: processed.intent,
        });
        if (gymResult.handled && gymResult.reply) {
          await sendAndRemember(chatId, gymResult.reply, processed.intent, processed.emotion);
          return Response.json({ ok: true });
        }
      }

      // ── Entity extraction (goals → Goal table; deadlines → Deadline table) ─
      // These run for ALL messages so data is always captured.
      if (processed.entities?.goal) {
        await addToLongTerm(chatId.toString(), "goals", processed.entities.goal).catch(() => {});
      }
      if (processed.entities?.deadline) {
        await saveDeadline({
          platformChatId: chatId.toString(),
          title:          processed.entities.deadline.label,
          dueAt:          processed.entities.deadline.dueAt,
        }).catch(() => {});
      }

      // ── Check-in offer confirmation/rejection ────────────────────────────────
      // Runs before the orchestrator so a simple "yes" doesn't go through LLM.
      const pendingMinutes = getPendingOffer(chatId.toString());
      if (pendingMinutes !== null) {
        if (isConfirmation(text)) {
          clearPendingOffer(chatId.toString());
          const schedResult = await scheduleCheckIn(chatId.toString(), `in ${pendingMinutes} min`);
          await addToShortTerm(chatId.toString(), text,  { role: "user",      intent: "check_in_response", emotion: "neutral" });
          await sendAndRemember(chatId, schedResult.reply, "checkin_schedule", "neutral");
          return Response.json({ ok: true });
        }
        if (isRejection(text)) {
          // User said no — clear the offer and fall through to normal processing
          clearPendingOffer(chatId.toString());
        }
      }

      // ── Focus session ─────────────────────────────────────────────────────
      // Side effect: starts an async timer loop — can't be handled inside orchestrator.
      if (processed.intent === "focus_start" || processed.triggers?.startFocus) {
        const durationMin = processed.entities?.focusDurationMin || 25;
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        startFocusSession(
          chatId.toString(),
          (id: string, msg: string) => sendTelegramMessage(id, msg, "Markdown"),
          durationMin,
        );
        return Response.json({ ok: true });
      }

      // ── Deadline save + template reply ────────────────────────────────────
      if (processed.intent === "deadline_set") {
        const deadline = processed.entities?.deadline;
        const reply    = deadline
          ? `Got it. I'll keep ${deadline.label} in view.`
          : "I caught a deadline intent, but not the date. Send it like: assignment due Friday 6pm.";
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      // ── Schedule adjustment ───────────────────────────────────────────────
      if (processed.intent === "schedule_adjust") {
        const minutes        = processed.entities?.timeShiftMin || 60;
        const updatedDeadline = await pushNearestDeadline(chatId.toString(), minutes);
        const reply           = updatedDeadline
          ? `Done. I pushed ${updatedDeadline.title} by ${minutes >= 60 ? `${minutes / 60} hour` : `${minutes} minutes`}.`
          : "I can adjust that, but there is no active deadline yet. Send the deadline first.";
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      // ── Proactive check-in scheduling / cancellation ──────────────────────
      if (processed.intent === "checkin_schedule") {
        const result = await scheduleCheckIn(chatId.toString(), text);
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        await sendAndRemember(chatId, result.reply, "checkin_schedule", "neutral");
        return Response.json({ ok: true });
      }
      if (processed.intent === "checkin_cancel") {
        const result = await cancelCheckIn(chatId.toString());
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        await sendAndRemember(chatId, result.reply, "checkin_cancel", "neutral");
        return Response.json({ ok: true });
      }

      // ── Progress summary / weekly review ──────────────────────────────────
      if (processed.intent === "progress_check" || processed.intent === "streak_check") {
        const reply = await generateProgressSummary(chatId.toString());
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }
      if (processed.intent === "weekly_review") {
        const reply = await generateWeeklyReview(chatId.toString());
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: processed.intent, emotion: processed.emotion });
        await sendAndRemember(chatId, reply, processed.intent, processed.emotion);
        return Response.json({ ok: true });
      }

      // ── Off-topic classification (3-layer: regex → hardcoded → cheap LLM) ──
      // Training-related messages pass through instantly (no cost).
      // Everything else is handled here without touching the orchestrator.
      const offTopicResult = await handleOffTopicMessage(chatId.toString(), text);
      if (offTopicResult.handled) {
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: "off_topic", emotion: "neutral" });
        await sendAndRemember(chatId, offTopicResult.reply, offTopicResult.intent, "neutral");
        return Response.json({ ok: true });
      }

      // ── Nutrition logging (fire-and-forget) ───────────────────────────────
      if (/\b(ate|eating|had|protein|calories|meal|breakfast|lunch|dinner|snack|macros|pre.?workout|post.?workout|grams? of|chicken|rice|oats)\b/i.test(text)) {
        parseAndSaveNutrition(chatId.toString(), text).catch(() => {});
      }

      // ══════════════════════════════════════════════════════════════════════
      // DEFAULT PATH — full mentor engine pipeline
      //
      // runOrchestrator handles:
      //   conversation analysis → memory + state load → pattern detection →
      //   mentor decision → feasibility → planner → intervention →
      //   engine-aware LLM call → response validation → persist (reply + state)
      //
      // persistMode "full" because the user message was NOT pre-saved above.
      // ══════════════════════════════════════════════════════════════════════
      const result = await runOrchestrator({
        platformChatId: chatId.toString(),
        text,
        platform:    "telegram",
        timestamp:   new Date(),
        persistMode: "full",
      });

      let reply = result.reply;

      // Rate limit soft warning — shown at most once per day per user
      if (rateLimit.warning && !hasWarnedToday(chatId.toString())) {
        markWarned(chatId.toString());
        reply = `${reply}\n\nYou're close to today's free message limit, so I may slow down soon.`;
      }

      await sendTelegramMessage(chatId, reply);

      // ── Check-in offer — detect time mention and ask if user wants a follow-up
      // Only fires if: no pending offer already, time found, message looks like a commitment.
      if (pendingMinutes === null) {
        const detectedMin = detectTimeMention(text);
        if (detectedMin && shouldOfferCheckIn(text, processed.intent)) {
          setPendingOffer(chatId.toString(), detectedMin);
          const offer = buildOfferMessage(detectedMin);
          await sendTelegramMessage(chatId, offer);
          await addToShortTerm(chatId.toString(), offer, {
            role:    "assistant",
            intent:  "checkin_offer",
            emotion: "neutral",
          });
        }
      }

      return Response.json({ ok: true });

    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return Response.json({ ok: false });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TELEGRAM CONNECT — /start <token> from web dashboard
// ═══════════════════════════════════════════════════════════════════════════════

async function handleTelegramConnectStart(text: string, chatId: number | string): Promise<boolean> {
  const match   = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  const payload = match?.[1]?.trim();
  if (!match || !payload) return false;

  const profile = await prisma.userProfile.findUnique({
    where:  { telegramConnectToken: payload },
    select: { id: true },
  });

  if (!profile) {
    await sendTelegramMessage(chatId, "That link has expired. Go back to your dashboard and try again.");
    return true;
  }

  await prisma.userProfile.update({
    where: { id: profile.id },
    data:  {
      telegramChatId:       String(chatId),
      telegramConnected:    true,
      telegramConnectedAt:  new Date(),
      telegramConnectToken: null,
      lastActivityAt:       new Date(),
    },
  });

  // Check if this user already completed intake.
  // Reconnecting (e.g. after deleting chat history) should never restart the intake flow.
  const existingUser = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: String(chatId) } },
    select: { intakeComplete: true },
  });

  if (existingUser?.intakeComplete) {
    await sendTelegramMessage(chatId, "We're reconnected. Pick up where you left off.");
    return true;
  }

  // First-time connect — run the full intake opener
  await fireMentorIntakeOpener(
    profile.id,
    String(chatId),
    (id: string, msg: string) => sendTelegramMessage(id, msg),
  );
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function sendAndRemember(
  chatId: number | string,
  text: string,
  intent: string,
  emotion: string,
) {
  await sendTelegramMessage(chatId, text);
  await addToShortTerm(chatId.toString(), text, { role: "assistant", intent, emotion });
}

function startTelegramTyping(chatId: number | string) {
  void sendTelegramChatAction(chatId, "typing");
  const timer = setInterval(() => void sendTelegramChatAction(chatId, "typing"), 4000);
  return () => clearInterval(timer);
}

async function sendTelegramChatAction(chatId: number | string, action: "typing") {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, action }),
    });
  } catch { /* typing indicator failure is non-fatal */ }
}

async function sendTelegramMessage(chatId: number | string, text: string, parseMode?: "Markdown") {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id: chatId,
      text:    formatMessengerText(text),
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram send failed: ${err}`);
  }
}
