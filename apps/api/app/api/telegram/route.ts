// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING ARCHITECTURE — SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════════════════════
//
//  Telegram webhook
//    └─ updateUserProfile (upsert — ensures messengerUser row exists)
//    └─ needsIntake() ─────────────── intakeComplete = false?
//         ├─ isV2Active() = true ──── handleOnboardingV2()   ← ONE gym brain
//         │    ├─ state machine drives every step transition
//         │    ├─ no LLM decides nextStep
//         │    └─ finalizeIntake() on review confirm → intakeComplete = true
//         │
//         └─ isV2Active() = false ─── handleIntakeMessage()  ← V1 fallback only
//              ├─ KEEP: study path  (sb1 … sb8)
//              ├─ KEEP: general path (gn1 … gn3)
//              ├─ MIGRATE: legacy gym mid-flow (ga_name … ga_review)
//              │    kept only for users who started before V2 shipped
//              │    removal pending telemetry showing zero active V1 gym sessions
//              └─ not_started → initOnboardingV2() migrates to V2
//
//  isV2Active() = true when:
//    • intakeStep is null / "not_started"   (any new user)
//    • intakeStep is any value AND a V2 MemoryFact (type=onboarding_v2) exists
//
//  isV2Active() = false when:
//    • intakeStep is a V1 step name (ga_name, sb1, etc.) AND no V2 MemoryFact
//
//  V1 entry point (fireMentorIntakeOpener — called on /start web-connect):
//    • gym domain  → initOnboardingV2()  (does NOT write intakeStep)
//    • study/general → writes intakeStep = sb1/gn1 directly (V1 path)
//
//  Dead code (never reached from this file):
//    • onboarding.service.ts: handleOnboardingMessage, needsOnboarding
//      (use onboardingComplete/onboardingStep — separate web-quiz fields)
//    • onboarding-engine-v2.ts: confirmAndFinalizeOnboarding
//      (superseded by the W6 review block inside handleOnboardingV2)
//
// ═══════════════════════════════════════════════════════════════════════════════
//@ts-ignore
import { processMessage } from "@repo/api/processor/messageProcessor";
//@ts-ignore
import { runOrchestrator } from "@repo/api/engines/mentor-orchestrator";
//@ts-ignore
import { addToShortTerm, addToLongTerm } from "@repo/api/services/memory.service";
//@ts-ignore
import { writeMomentPromiseFromChat, writeMomentIdentityShiftFromChat, detectIdentityShift } from "@repo/api/services/momentMemory.service";
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
import { handleOnboardingV2, isV2Active } from "@repo/api/engines/onboarding-engine-v2";
//@ts-ignore
import { handleWorkoutCommand, handleActiveLoggingMessage, resetReactivationCount, commitNLWorkoutSession, commitNLSkip, updatePRFromNL } from "@repo/api/services/workoutTracking.service";
//@ts-ignore
import { handleOffTopicMessage } from "@repo/api/services/offTopicClassifier.service";
//@ts-ignore
import { scheduleCheckIn, cancelCheckIn } from "@repo/api/services/scheduleCheckin.service";
//@ts-ignore
import { listReminders, cancelReminderByIndex, parseAndCreateReminder, cancelReminderByKeyword, updateReminderByKeyword } from "@repo/api/services/customReminder.service";
//@ts-ignore
import { parseAndSaveNutrition } from "@repo/api/services/rexSessionContext.service";
//@ts-ignore
import { parseMessage } from "@repo/api/engines/parsing-engine-v2";
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

// ── Processing lock (per-chat, in-memory, 45 s TTL) ──────────────────────────
// Prevents concurrent LLM/orchestrator calls for the same chat.
// Railway is single-instance + persistent — process-level Maps survive requests.
// 45 s TTL auto-clears stale locks so a crash never permanently blocks a user.
const inFlightChats = new Map<string, number>(); // chatId → acquired timestamp (ms)
const LOCK_TTL_MS   = 45_000;

function tryAcquireLock(chatId: string): boolean {
  const since = inFlightChats.get(chatId);
  if (since !== undefined && Date.now() - since < LOCK_TTL_MS) return false;
  inFlightChats.set(chatId, Date.now());
  return true;
}
function releaseLock(chatId: string): void {
  inFlightChats.delete(chatId);
}

// ── Rate-limit busy-message dedup ─────────────────────────────────────────────
// Show "you've hit the limit" at most once per 5 minutes — not on every message.
// Without this, rapid retries spam the user with identical responses.
const rateLimitBusySentAt  = new Map<string, number>(); // chatId → last sent (ms)
const BUSY_MSG_COOLDOWN_MS = 5 * 60 * 1000;

function shouldSendBusyMessage(chatId: string): boolean {
  const last = rateLimitBusySentAt.get(chatId);
  if (last === undefined || Date.now() - last > BUSY_MSG_COOLDOWN_MS) {
    rateLimitBusySentAt.set(chatId, Date.now());
    return true;
  }
  return false;
}

// ── Rate-limit warning dedup ──────────────────────────────────────────────────
// Shows the "approaching limit" warning at most once per day per user.
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
    let lockAcquired = false;

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
      // Routing decision tree (single source of truth):
      //
      //   Telegram message
      //     └─ needsIntake() = true
      //          ├─ isV2Active() = true  → handleOnboardingV2()   [gym, all new users]
      //          │    └─ handled=false   → WARN + fall-through (should not happen)
      //          └─ isV2Active() = false → handleIntakeMessage()  [study / general / legacy gym mid-V1]
      //
      // isV2Active() = true when:
      //   • intakeStep is null / "not_started"  (new user, no prior step written)
      //   • intakeStep is anything AND a V2 MemoryFact state record exists
      //
      // isV2Active() = false when:
      //   • intakeStep is a V1 step name (ga_name, ga_goal, sb1, gn1, …) AND no V2 state
      //   → those users continue on V1 until they complete naturally
      if (await needsIntake(chatId.toString())) {
        if (await isV2Active(chatId.toString())) {
          const v2Result = await handleOnboardingV2({ platformChatId: chatId.toString(), text });
          if (v2Result.handled) {
            await sendTelegramMessage(chatId, v2Result.reply);
            return Response.json({ ok: true });
          }
          // V2 returned handled=false — should never happen for an active V2 session.
          // Log and fall through so the user is not silently dropped.
          console.warn(`[intake] V2 returned handled=false for chatId=${chatId} — falling through`);
        } else {
          // V1 fallback: study / general paths, and legacy gym users mid-V1
          const webProfile   = await getWebProfile(chatId.toString());
          const intakeResult = await handleIntakeMessage({ platformChatId: chatId.toString(), text, webProfile });
          if (intakeResult.handled) {
            await sendTelegramMessage(chatId, intakeResult.reply);
            return Response.json({ ok: true });
          }
        }
      }

      // ── Workout commands (/log /pr /progress /history /overload /streak /split)
      const workoutCmd = await handleWorkoutCommand(chatId.toString(), text);
      if (workoutCmd.handled) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), chatId: String(chatId), message: text.slice(0, 80), route: "command", intent: workoutCmd.intent ?? "workout_cmd", service: "workoutTracking" }));
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

      // ── Parsing Engine V2 ─────────────────────────────────────────────────
      // Must run before reminder routing so multi-intent messages survive
      // (e.g. "remind me to drink water and chest is sore" → both intents extracted).
      const v2ParseCtx = await buildParseContext(chatId.toString());
      const v2Parse    = parseMessage(text, v2ParseCtx);

      // ── Structured production log (observability) ─────────────────────────
      // One line per user message. Used for debugging intent classification,
      // routing decisions, and signal coverage in production.
      console.log(JSON.stringify({
        ts:         new Date().toISOString(),
        chatId:     String(chatId),
        message:    text.slice(0, 120),
        intent:     v2Parse.actionableIntent?.type ?? "none",
        confidence: v2Parse.confidence,
        signals:    v2Parse.signals,
        intents:    v2Parse.intents.map((i: any) => `${i.type}(${i.confidence.toFixed(2)})`),
        reasoning:  v2Parse.reasoning,
      }));

      // ── Natural-language reminder creation (V2-controlled routing) ────────
      // Replaces the legacy /\b(remind|..)\b/ regex. Uses Parsing Engine V2
      // actionableIntent so multi-intent messages (reminder + pain context,
      // reminder + skip, etc.) route correctly and secondary intents survive.
      if (v2Parse.actionableIntent?.type === "reminder_create") {
        const result = await parseAndCreateReminder(chatId.toString(), text);
        if (result) {
          await addToShortTerm(chatId.toString(), text, { role: "user", intent: "reminder_create", emotion: "neutral" });
          await sendAndRemember(chatId, result.reply, "reminder_create", "neutral");
          // Multi-intent: check for a secondary gym-relevant intent in the same message
          // (e.g. "remind me every hour and chest is sore" — soreness must also be logged)
          const GYM_SECONDARY_TYPES = new Set(["log_soreness", "log_pain", "log_skip", "log_weight", "log_workout"]);
          const secondary = v2Parse.intents.find(
            (i: any) => i.type !== "reminder_create" && GYM_SECONDARY_TYPES.has(i.type)
          );
          if (secondary && body.userId) {
            const secIntent = mapV2ToGymIntent(secondary.type, text);
            if (secIntent) {
              await handleGymMessage({ userId: body.userId, text, intent: secIntent }).catch(() => {});
            }
          }
          return Response.json({ ok: true });
        }
        // parseAndCreateReminder returned null — fall through to orchestrator
      }

      // ── Reminder: delete (V2-gated) ───────────────────────────────────────
      if (v2Parse.actionableIntent?.type === "reminder_delete") {
        const keyword = v2Parse.entities.find((e: any) => e.type === "reminder_target")?.value;
        if (keyword) {
          await addToShortTerm(chatId.toString(), text, { role: "user", intent: "reminder_cancel", emotion: "neutral" });
          const reply = await cancelReminderByKeyword(chatId.toString(), keyword);
          await sendAndRemember(chatId, reply, "reminder_cancel", "neutral");
          return Response.json({ ok: true });
        }
        // no keyword extracted — fall through to orchestrator
      }

      // ── Reminder: edit (V2-gated) ─────────────────────────────────────────
      if (v2Parse.actionableIntent?.type === "reminder_edit") {
        const keyword         = v2Parse.entities.find((e: any) => e.type === "reminder_target")?.value;
        const newScheduleText = text.match(/\bto\s+(.+)$/i)?.[1]?.trim();
        if (keyword && newScheduleText) {
          await addToShortTerm(chatId.toString(), text, { role: "user", intent: "reminder_edit", emotion: "neutral" });
          const reply = await updateReminderByKeyword(chatId.toString(), keyword, newScheduleText);
          await sendAndRemember(chatId, reply, "reminder_edit", "neutral");
          return Response.json({ ok: true });
        }
        // insufficient info — fall through to orchestrator
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
        // Dedup: show this message at most once per 5 minutes so rapid retries
        // don't create a spam loop of identical blocked responses.
        if (shouldSendBusyMessage(chatId.toString())) {
          await sendTelegramMessage(
            chatId,
            "You've hit the free conversation limit for now.\n\nI'll be back shortly.\n\nYour training data and progress are safe.",
          );
        }
        return Response.json({ ok: true });
      }

      // ── Processing lock ───────────────────────────────────────────────────
      // Prevents concurrent LLM calls for the same chat arriving milliseconds
      // apart. If a prior request is in-flight, acknowledge and drop this one.
      // The lock is released in the finally block below — guaranteed even on error.
      lockAcquired = tryAcquireLock(chatId.toString());
      if (!lockAcquired) {
        await sendTelegramMessage(chatId, "I'm still processing your last message. Give me a moment.");
        return Response.json({ ok: true });
      }

      // ── Any real user message resets the reactivation counter ────────────
      // Fire-and-forget — do not let a DB hiccup block the response.
      resetReactivationCount(chatId.toString()).catch(() => {});

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

        // Parser V2 decides intent; fall back to messageProcessor for intents
        // V2 doesn't cover (energy_checkin, pr_log, gym_checkin via processed).
        const v2GymIntent = mapV2ToGymIntent(v2Parse.actionableIntent?.type ?? "", text)
          ?? processed.intent;

        const gymResult = await handleGymMessage({
          userId: gymUserId,
          text:   processed.cleanedText,
          intent: v2GymIntent,
        });
        if (gymResult.handled && gymResult.reply) {
          console.log(JSON.stringify({ ts: new Date().toISOString(), chatId: String(chatId), message: text.slice(0, 80), route: "gym_shortcircuit", intent: v2GymIntent, service: "gym.service" }));
          await sendAndRemember(chatId, gymResult.reply, v2GymIntent, processed.emotion);
          return Response.json({ ok: true });
        }
      }

      // ── NL parity writes (Telegram-only users, no gymUserId) ─────────────
      // Keeps /history, /streak, /pr, /split consistent for users who describe
      // workouts or skips in natural language instead of using /log commands.
      if (!gymUserId) {
        const nlIntent = v2Parse.actionableIntent?.type
        if (nlIntent === "log_workout") {
          commitNLWorkoutSession(chatId.toString(), text).catch(() => {})
        }
        if (nlIntent === "log_skip") {
          commitNLSkip(chatId.toString()).catch(() => {})
        }
        // PR parity: update personalRecords from NL so /pr sees the new record
        if (/\b(?:hit\s+(?:a\s+)?(?:new\s+)?(?:pr|pb)|new\s+(?:pr|pb)|personal\s+(?:record|best))\b/i.test(text)) {
          updatePRFromNL(chatId.toString(), text).catch(() => {})
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

      // ── Nutrition logging (V2-gated) ──────────────────────────────────────
      // Parser V2 gates all nutrition writes. Raw regex removed — "ASK > GUESS".
      // >= 0.55: log (covers "I ate chicken" at 0.82, food mentions at 0.72)
      // < 0.55: skip — no silent writes on vague/ambiguous messages
      const nutIntent = v2Parse.intents.find(
        (i: any) => i.type === "nutrition_context" || i.type === "nutrition_query"
      );
      if (nutIntent && nutIntent.confidence >= 0.55) {
        parseAndSaveNutrition(chatId.toString(), text).catch(() => {});
      }

      // ── P0 Fix 2: Split-change redirect ───────────────────────────────────
      // Natural language split change requests ("change my split", "switch to PPL")
      // are intercepted here and redirected to /setup split.  The LLM cannot
      // persist split state, so discussing it without executing is misleading.
      // Advice/plan requests ("what split should I use?") pass through normally.
      const SPLIT_CHANGE_RE = /\b(?:change|switch|modify|redo|update)\b.{0,25}\b(?:split|program|routine)\b|\b(?:make\s+it|go\s+(?:with|to)|switch\s+to|try)\s+(?:ppl|upper.?lower|full.?body|bro.?split)\b|\b(?:new|different)\s+split\b/i;
      if (SPLIT_CHANGE_RE.test(text) && !text.startsWith("/")) {
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: "schedule_update", emotion: "neutral" });
        await sendAndRemember(chatId, "To apply a split change, use /setup split — I'll walk you through it.", "setup_redirect", "neutral");
        return Response.json({ ok: true });
      }

      // ── Safety gate: low-confidence recommendation block ──────────────────
      // When the parser isn't sure what the user wants, asking beats guessing.
      const RECOMMENDATION_INTENT_TYPES = new Set([
        "recommendation_request", "advice_request", "nutrition_query",
        "plan_request", "goal_set", "schedule_update",
      ]);
      if (
        RECOMMENDATION_INTENT_TYPES.has(v2Parse.actionableIntent?.type ?? "") &&
        v2Parse.confidence < 0.55
      ) {
        logBetaFailure(chatId, text, v2Parse.actionableIntent?.type ?? "unknown", v2Parse.confidence, "low_confidence_recommendation_blocked");
        const clarifyReply = "Before I give you anything specific — what are you trying to do? Looking for a training adjustment, a nutrition tweak, or something else?";
        await addToShortTerm(chatId.toString(), text, { role: "user", intent: v2Parse.actionableIntent?.type ?? "general", emotion: "neutral" });
        await sendAndRemember(chatId, clarifyReply, "clarification_request", "neutral");
        return Response.json({ ok: true });
      }

      // Beta failure: parser flagged clarification needed even at normal confidence
      if (v2Parse.requiresClarification) {
        logBetaFailure(chatId, text, v2Parse.actionableIntent?.type ?? "none", v2Parse.confidence, "requires_clarification");
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
        parseResult: v2Parse,
      });

      // ── Post-pipeline log: full trace including decision and route ─────────
      console.log(JSON.stringify({
        ts:       new Date().toISOString(),
        chatId:   String(chatId),
        message:  text.slice(0, 120),
        intent:   v2Parse.actionableIntent?.type ?? "none",
        decision: `${result.decision.action}/${result.decision.subAction ?? ""}`,
        rule:     result.decision.ruleId,
        route:    v2Parse.actionableIntent?.type ? mapV2ToGymIntent(v2Parse.actionableIntent.type, text) ?? "orchestrator" : "orchestrator",
      }));

      // Write moment memories (fire-and-forget — never blocks the reply)
      if (result.analysis.hasCommitment || result.analysis.intent === "commitment_made") {
        writeMomentPromiseFromChat(chatId.toString(), text).catch(() => {})
      }
      const identitySignal = detectIdentityShift(text)
      if (identitySignal) {
        writeMomentIdentityShiftFromChat(chatId.toString(), text, identitySignal).catch(() => {})
      }

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
      // Guaranteed unlock — runs even if an exception escapes the try block.
      // Without this, a thrown error would leave the chat permanently locked
      // until the 45 s TTL expires.
      if (lockAcquired) releaseLock(chatId.toString());
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

// ── Beta failure logger ───────────────────────────────────────────────────────
// Writes one structured line per incident. Collected during beta to identify
// the most common parser failures and routing gaps in production.
function logBetaFailure(
  chatId:     number | string,
  message:    string,
  intent:     string,
  confidence: number,
  reason:     string,
): void {
  console.log(JSON.stringify({
    ts:           new Date().toISOString(),
    beta_failure: true,
    chatId:       String(chatId),
    message:      message.slice(0, 120),
    intent,
    confidence,
    reason,
  }));
}

// ── V2 intent → gym.service intent mapping ────────────────────────────────────
// Parser V2 decides intent; gym.service executes the action.
// Deterministic extraction (weights, reps, exercise names) stays inside gym.service.
function mapV2ToGymIntent(v2Type: string, text: string): string | null {
  switch (v2Type) {
    case "log_workout": {
      // Distinguish explicit lift log from general checkin
      const hasExercise = /\b(?:bench|squat|deadlift|press(?:ing)?|rows?|curls?)\b/i.test(text);
      const hasNumber   = /\b\d+\s*(?:kg|x)\b/i.test(text);
      return (hasExercise && hasNumber) ? "lift_log" : "gym_checkin";
    }
    case "log_weight":       return "weight_log";
    case "log_soreness":     return "soreness_log";
    case "log_skip":         return "missed_session";
    case "log_pain":         return "pain_report";
    case "progress_query":   return "recovery_query";
    case "recovery_context": return "recovery_query";
    case "nutrition_context": return "nutrition_query";
    case "nutrition_query":  return "nutrition_query";
    default:                 return null;
  }
}

// ── Parsing Engine V2 context builder ────────────────────────────────────────
// Loads the last 5 messages for short-reply disambiguation and the current
// intake step for stateful onboarding answers.  Intentionally cheap and
// fault-tolerant — a DB error here must never block the message pipeline.
async function buildParseContext(platformChatId: string) {
  try {
    const user = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
      select: {
        intakeStep: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take:    5,
          select:  { role: true, text: true, intent: true },
        },
      },
    });
    if (!user) return { recentMessages: [] };
    return {
      recentMessages:        [...user.messages].reverse().map(m => ({
        role:   m.role as "user" | "assistant",
        text:   m.text,
        intent: m.intent ?? undefined,
      })),
      currentOnboardingStep: (user as any).intakeStep ?? undefined,
    };
  } catch {
    return { recentMessages: [] };
  }
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
