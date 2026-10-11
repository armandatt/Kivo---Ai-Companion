// ─── Nova proactive tick ──────────────────────────────────────────────────────
// Runs every five minutes inside the API process (apps/api/lib/checkin-cron).
// For each learner it gathers facts, asks the proactive decision whether
// anything is worth saying, and if so delivers it through the outbox:
//
//   facts → decideProactive (pure) → claim → word → ready → send → sent
//
// Nothing is sent that was not first claimed, and a claim is unique per
// logical occurrence, so a late tick, a restart or a second instance cannot
// send the same thing twice. A tick that sends nothing writes nothing.
//
// Timing is by window, never by matching a minute: a tick that runs late
// still finds the window open, and the claim keeps it to once.
//
// The daily check-in is one of the reasons, not a second job. A learner who
// chose a check-in time (web onboarding or Settings) gets it from that time,
// for CHECKIN_WINDOW_MINUTES; one who chose none is nudged in their study
// window as before. Every learner the tick looks at ends in exactly one
// outcome, and the tick logs the count of each.

import { prisma } from "@repo/db/client";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { getOverdueTopics } from "../engines/retention-engine";
import { dayKey, dayNumber, localHour, localMinute } from "../engines/learner-calendar";
import { STUDY_WINDOWS } from "../engines/learning-dna-engine";
import { loadReplyLanguage, saveAssistantMessage, userMessagedSince } from "../adapters/conversation-adapter";
import { loadOperatingStyle, loadAccountabilityStyle } from "../adapters/operating-style-adapter";
import { ensureLearnerTimezone, loadAccountPreferences } from "../adapters/account-preferences-adapter";
import { retryPendingConsolidations } from "../consolidation/run-consolidation";
import { chooseRegister } from "../decision/register";
import {
  decideProactive, generateCandidates, holdReason, inCheckinWindow, informOnly, isQuietFor, studyWindow, RECENT_MESSAGE_MINUTES,
  type ProactiveCandidate, type ProactiveFacts, type ProactiveGates,
} from "../decision/proactive-decision";
import { loadLearningDna } from "../persistence/learning-dna-store";
import { loadNovaToday } from "../product/today";
import type { NovaTodayReady } from "../product/today.types";
import type { ProactiveType } from "../types/proactive.types";
import { ensureChannel, loadChannel, markDelivered, markUndeliverable, spendModelCall } from "../telegram/channel-store";
import { closeOpenPrompt, openPrompt, purgeOldPrompts, recordPromptMessage } from "../telegram/prompt-store";
import { createTelegramClient } from "../telegram/telegram-client";
import { encodeCallback } from "../telegram/telegram-event";
import { recommendationReply } from "../telegram/telegram-replies";
import type { InlineButton, PromptSpec, TelegramClient } from "../telegram/telegram.types";
import {
  beginSend, claimOccurrence, dropUnworded, loadDelivered, markReady, markSendFailed, markSent, purgeLegacyDecisions, recoverPending,
  type OutboxRow,
} from "./proactive-outbox";
import { proactiveFallback, wordProactiveMessage, type ProactiveWordingInput } from "./nova-proactive-response";

export interface NovaProactiveCronResult {
  ok:      boolean;
  sent:    number;
  checked: number;
  errors:  number;
  // How many learners ended the tick in each outcome ("sent", "no_timezone",
  // "quiet_hours", "nothing_due", "suppressed", …). Counts only.
  outcomes?: Record<string, number>;
}

// Why nothing is sent on an ordinary tick: not yet time, or today's message
// has already gone.
const ROUTINE: ReadonlySet<string> = new Set(["outside_window", "too_soon_after_last", "daily_cap", "already_nudged_today", "already_sent_today", "studied_today"]);

// What happened to one learner this tick.
type Outcome =
  | "sent" | "send_failed" | "held" | "claimed_elsewhere"
  | "no_timezone" | "quiet_hours" | "proactive_off" | "undeliverable" | "not_ready"
  | "nothing_due" | "suppressed";

export interface ProactiveDeps {
  client?: TelegramClient;
  word?:   (input: ProactiveWordingInput) => Promise<{ text: string; generated: boolean }>;
}

const PRIORITY: Record<ProactiveType, number> = { exam_countdown: 9, missed_plan_recovery: 6, review_due: 4, daily_checkin: 3, daily_nudge: 3 };

// Topics due for review, by the one definition (retention-engine.ts): the
// same topics Home, the Planner and Knowledge show as due.
export async function loadOverdueTopics(profileId: string, now: Date): Promise<Array<{ topicName: string; nextReviewAt: Date }>> {
  const due = getOverdueTopics(await getAllTopicMasteries(profileId, now), now);
  return due.slice(0, 5).map(t => ({ topicName: t.topicName, nextReviewAt: t.reviewDueAt! }));
}

export async function runNovaProactiveCron(now = new Date(), deps: ProactiveDeps = {}): Promise<NovaProactiveCronResult> {
  // Housekeeping that does not depend on sending.
  await retryPendingConsolidations(now)
    .then(r => { if (r.retried > 0) console.log(`[nova:cron] consolidation retries: ${r.completed}/${r.retried} completed`); })
    .catch(err => console.error("[nova:cron] consolidation retry failed", err));
  await purgeOldPrompts(now).catch(err => console.error("[nova:cron] prompt purge failed", err));
  await purgeLegacyDecisions(now).catch(err => console.error("[nova:cron] legacy decision purge failed", err));

  // Operational switch: stops Nova messaging first without a deploy. Replies
  // to learners, commands and buttons are unaffected.
  if (process.env.NOVA_PROACTIVE_DISABLED === "true") {
    console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_proactive", tick: "disabled", reason: "NOVA_PROACTIVE_DISABLED" }));
    return { ok: true, sent: 0, checked: 0, errors: 0, outcomes: {} };
  }

  const client = deps.client ?? createTelegramClient();
  const word   = deps.word ?? wordProactiveMessage;

  // Learners Nova may message first at all: set up, and on Telegram. One
  // whose timezone nobody has reported is still looked at, so that the zone
  // their browser gave at sign-up can be adopted, and so that being skipped
  // for want of one is counted instead of invisible.
  const profiles = await prisma.novaAcademicProfile.findMany({
    where:  { onboardingComplete: true, user: { persona: "nova", platform: "telegram" } },
    select: {
      id: true, timezone: true, preferredStudyTime: true,
      user: { select: { id: true, platformChatId: true, displayName: true } },
    },
  });

  let sent = 0, errors = 0;
  const outcomes: Record<string, number> = {};
  for (const profile of profiles) {
    let outcome: string;
    try {
      outcome = await processLearner(profile, now, client, word);
      if (outcome === "sent") sent++;
    } catch (err) {
      // One learner's failure never stops the rest of the tick.
      console.error(`[nova:cron] profile ${profile.id} failed:`, err);
      errors++;
      outcome = "error";
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  // One line per tick: what the job did, whether or not anything was sent.
  console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_proactive", tick: "done", checked: profiles.length, sent, errors, outcomes }));
  return { ok: true, sent, checked: profiles.length, errors, outcomes };
}

type LearnerRow = {
  id: string; timezone: string | null; preferredStudyTime: string | null;
  user: { id: string; platformChatId: string; displayName: string | null };
};

async function processLearner(
  profile: LearnerRow,
  now:     Date,
  client:  TelegramClient,
  word:    NonNullable<ProactiveDeps["word"]>,
): Promise<Outcome> {
  const chatId  = profile.user.platformChatId;
  // What they chose on the web: a check-in time, and the zone their browser
  // reported. Nova will not guess what time it is for a learner.
  const account = await loadAccountPreferences(chatId);
  const zone    = await ensureLearnerTimezone(profile, chatId, account);
  if (!zone) return "no_timezone";
  const hour   = localHour(now, zone);
  const minute = localMinute(now, zone);
  const day    = dayKey(now, zone);
  const clock  = { localHour: hour, localMinute: minute, checkinMinute: account.checkinMinute };
  // The cheapest gate first: most ticks for most learners end here.
  if (isQuietFor(clock as ProactiveFacts)) return "quiet_hours";

  await ensureChannel(profile.id);
  const channel = await loadChannel(profile.id);
  if (!channel.proactiveEnabled) return "proactive_off";
  if (channel.undeliverableSince) return "undeliverable";
  const paused = channel.proactivePausedUntil !== null && channel.proactivePausedUntil > now;

  const view   = await loadNovaToday(chatId, { learnerName: profile.user.displayName, now });
  if (view.status !== "ready") return "not_ready";

  // ── Decide ─────────────────────────────────────────────────────────────────
  const [delivered, dna, dueTopics, messagedRecently] = await Promise.all([
    loadDelivered(profile.id, day),
    loadLearningDna(profile.id, now),
    loadOverdueTopics(profile.id, now),
    userMessagedSince(profile.user.id, new Date(now.getTime() - RECENT_MESSAGE_MINUTES * 60_000)),
  ]);

  // Where their sessions actually fall, once Learning DNA supports it.
  const usual = dna?.signals.find(s => s.key === "usual_study_window");
  const usualWindow = usual && (usual.level === "supported" || usual.level === "strong") && !usual.weakening
    ? STUDY_WINDOWS.find(w => w.key === usual.valueKey) ?? null
    : null;

  const today   = dayNumber(day);
  const lastDay = view.progress.lastSession ? dayKey(new Date(view.progress.lastSession.date), zone) : null;
  const facts: ProactiveFacts = {
    localDay: day, localHour: hour, localMinute: minute, checkinMinute: account.checkinMinute,
    window:   account.checkinMinute !== null
      ? { from: Math.floor(account.checkinMinute / 60), to: Math.min(24, Math.floor(account.checkinMinute / 60) + 3), basis: "chosen" }
      : studyWindow({ dnaWindow: usualWindow, statedPreference: profile.preferredStudyTime }),
    studiedToday:         lastDay === day,
    daysSinceLastSession: lastDay ? today - dayNumber(lastDay) : null,
    lastSessionDay:       lastDay,
    exams: view.upcoming.map(e => ({
      id: `${e.title}:${e.scheduledAt.slice(0, 10)}`.slice(0, 80), title: e.title,
      // The Today view's own count, so Telegram and the web app never
      // disagree about how far away an exam is.
      daysUntil: e.daysUntil,
    })),
    reviewDueCount: dueTopics.length,
    hasPlan:        view.recommendation !== null,
  };
  // Someone who has just closed a session was with Nova a moment ago, on
  // whichever surface: that is recent contact, the same as a message.
  const last = view.progress.lastSession;
  const finishedRecently = last !== null
    && now.getTime() - (new Date(last.date).getTime() + last.minutes * 60_000) < RECENT_MESSAGE_MINUTES * 60_000;
  const gates: ProactiveGates = {
    proactiveEnabled: channel.proactiveEnabled, paused, undeliverable: false, hasTimezone: true,
    activeSession: view.activeSession !== null, messagedRecently: messagedRecently || finishedRecently,
    // Once today's check-in time has come round, a learner who has already
    // written to Nova is not checked in on as well.
    messagedSinceCheckin: account.checkinMinute !== null && inCheckinWindow(facts)
      ? await userMessagedSince(profile.user.id, new Date(now.getTime() - (hour * 60 + minute - account.checkinMinute) * 60_000))
      : false,
    sentToday: delivered.today, lastSentAt: delivered.lastSentAt,
    realityCategories: passingConstraints(view, now), now,
  };

  // ── Something a previous tick approved but did not deliver ─────────────────
  // It is not decided again, and nothing new is considered while it waits.
  // But it goes out only if it would still be right to send: the gates are
  // asked again with what is true now. Held, it is tried on a later tick, and
  // the outbox drops it once its retry window has passed.
  const pending = await recoverPending(profile.id, now);
  if (pending.length > 0) {
    const waiting = pending[0]!;
    const held    = holdReason(waiting.type as ProactiveType, facts, gates);
    if (held) {
      console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_proactive", profileId: profile.id, type: waiting.type, occurrence: waiting.occurrenceKey, outcome: "held", reason: held }));
      return "held";
    }
    // Claimed, and the process ended before it was worded: it is worded now,
    // from what is true now. If its reason has gone (the exam was removed,
    // the review was done), nothing is said.
    let fresh: Parameters<typeof deliver>[7] = null;
    if (!waiting.text) {
      const candidate = generateCandidates(facts).find(c => c.occurrenceKey === waiting.occurrenceKey);
      if (!candidate) {
        await dropUnworded(waiting.id);
        console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_proactive", profileId: profile.id, type: waiting.type, occurrence: waiting.occurrenceKey, outcome: "dropped", reason: "reason_no_longer_holds" }));
        return "nothing_due";
      }
      fresh = { candidate, facts, windowBasis: facts.window.basis, dueTopics: dueTopics.map(t => t.topicName) };
    }
    return await deliver(waiting, profile, zone, view, now, client, word, fresh, informOnly(waiting.type as ProactiveType, gates)) ? "sent" : "send_failed";
  }

  const decision = decideProactive(facts, gates);
  if (!decision.chosen) {
    if (decision.suppressed.length === 0) return "nothing_due";
    // Most ticks find the day's message not yet due or already sent. That is
    // the ordinary state, not news. Any other reason is why a message that
    // was due did not go out, and is logged.
    const reasons = decision.suppressed.filter(s => !ROUTINE.has(s.reason));
    if (reasons.length > 0) {
      console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_proactive", profileId: profile.id, sent: false, suppressed: reasons }));
    }
    return reasons.length > 0 ? "suppressed" : "nothing_due";
  }

  // ── Claim ──────────────────────────────────────────────────────────────────
  const row = await claimOccurrence(profile.id, decision.chosen, day, PRIORITY[decision.chosen.type], now);
  if (!row) return "claimed_elsewhere";   // this occurrence already has an owner
  console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_proactive", profileId: profile.id, type: decision.chosen.type, occurrence: decision.chosen.occurrenceKey, outcome: "due" }));
  return await deliver(row, profile, zone, view, now, client, word, { candidate: decision.chosen, facts, windowBasis: facts.window.basis, dueTopics: dueTopics.map(t => t.topicName) }, decision.informOnly) ? "sent" : "send_failed";
}

// Circumstances that will pass. A temporary one lasts two weeks at most
// (consolidation/policies/reality-policy.ts); a standing one is believed for
// months, and silencing Nova for that long is not what it is for.
const PASSING_WITHIN_MS = 15 * 86_400_000;
function passingConstraints(view: NovaTodayReady, now: Date): string[] {
  return view.constraints
    .filter(c => c.expiresAt !== null && new Date(c.expiresAt).getTime() - now.getTime() <= PASSING_WITHIN_MS)
    .map(c => c.category);
}

// Words (if not yet worded), then sends, one outbox row.
async function deliver(
  row:     OutboxRow,
  profile: LearnerRow,
  zone:    string,
  view:    NovaTodayReady,
  now:     Date,
  client:  TelegramClient,
  word:    NonNullable<ProactiveDeps["word"]>,
  fresh:   { candidate: ProactiveCandidate; facts: ProactiveFacts; windowBasis: string; dueTopics: string[] } | null,
  // Inform, do not ask: no recommended block and no Start button.
  quiet:   boolean,
): Promise<boolean> {
  const chatId = profile.user.platformChatId;
  const type   = row.type as ProactiveType;
  const rec    = quiet ? null : view.recommendation;

  let text = row.text;
  if (!text) {
    const lines: string[] = [];
    // A check-in's reason is that they asked for it; that is not a fact to tell them.
    if (fresh && type !== "daily_checkin") lines.push(capitalize(fresh.candidate.reason));
    if (rec)   lines.push(`Recommended now: ${rec.topicName} (${rec.subjectName}), ${rec.durationMinutes} min${rec.reasons[0] ? `, because ${rec.reasons[0]}` : ""}`);
    // A check-in with nothing to recommend asks; it never invents a plan.
    if (type === "daily_checkin" && !rec) lines.push("Nothing is planned for today yet");
    if (fresh?.windowBasis === "learning_dna" && !quiet) lines.push("Their recorded sessions usually fall around this time of day");
    const input: ProactiveWordingInput = {
      type, studentName: profile.user.displayName, facts: lines,
      register: chooseRegister({
        emotion: "neutral", daysUntilNextExam: view.nextDeadline?.daysUntil ?? null,
        activeReality: passingConstraints(view, now),
        accountability: await loadAccountabilityStyle(chatId),
      }),
      operatingStyle: await loadOperatingStyle(chatId),
      hasStartButton: rec !== null,
      // The one message that may ask: there is no plan to point at.
      asksWhatToday:  type === "daily_checkin" && !rec,
      informOnly:     quiet,
      language:       await loadReplyLanguage(profile.user.id),
    };
    // Past today's budget for generated wording, the plain line goes out.
    const worded = await spendModelCall(profile.id, "response", dayKey(now, zone))
      ? await word(input)
      : { text: proactiveFallback(input), generated: false };
    text = worded.text;
    await markReady(row.id, text);
  }

  if (!await beginSend(row.id, now)) return false;

  // The same Start buttons /today gives, as a prompt of kind "nudge".
  const spec: PromptSpec | null = rec ? recommendationReply(view, rec, { kind: "nudge" }).prompt ?? null : null;
  const prompt = spec ? await openPrompt(profile.id, chatId, spec, now) : null;
  const buttons: InlineButton[][] = [];
  if (prompt) {
    const all = prompt.options.map(o => ({ text: o.label, callback_data: encodeCallback(prompt.id, o.id) }));
    for (let i = 0; i < all.length; i += 2) buttons.push(all.slice(i, i + 2));
  }

  const result = await client.sendMessage(chatId, text, buttons);
  const log = (outcome: string) => console.log(JSON.stringify({
    ts: now.toISOString(), layer: "nova_proactive", profileId: profile.id, type, occurrence: row.occurrenceKey,
    outcome, attempt: row.attempts + 1, messageId: result.ok ? result.messageId : null,
  }));

  if (result.ok) {
    await markSent(row.id, result.messageId, now);
    if (prompt) await recordPromptMessage(prompt.id, result.messageId);
    await markDelivered(profile.id, now).catch(() => {});
    // In Nova's conversation history only once it has actually been said.
    await saveAssistantMessage(profile.user.id, text, `nova_proactive_${type}`, { proactiveType: type }, now)
      .catch(err => console.error("[nova:cron] conversation log failed", err));
    log("sent");
    return true;
  }

  // Not delivered (or not known to be): these buttons are not an open question.
  if (prompt && result.kind !== "unknown") await closeOpenPrompt(profile.id, "undelivered", now, prompt.id).catch(() => {});
  if (result.kind === "blocked") {
    await markSendFailed(row.id, "permanent", result.detail);
    await markUndeliverable(profile.id, now);
  } else if (result.kind === "unknown") {
    await markSendFailed(row.id, "unknown", result.detail);
  } else if (result.kind === "bad_request") {
    await markSendFailed(row.id, "permanent", result.detail);
  } else {
    await markSendFailed(row.id, "retryable", result.detail);
  }
  log(result.kind);
  return false;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
