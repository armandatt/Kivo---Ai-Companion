// ─── Nova Onboarding Orchestrator ─────────────────────────────────────────────
// Entry point for Nova messages when onboardingComplete = false.
//
// Pipeline (SKILL.md compliant):
//   1. load state + history    (DB reads, parallel)
//   2. extractAcademicFacts()  (Understanding Brain — gpt-4o-mini, facts only)
//   3. validateExtraction()    (deterministic normalization)
//   4. makeOnboardingDecision() (Decision Engine — deterministic, no LLM)
//   5. persistOnboardingExtraction() (DB writes, blocks before reply)
//   6. generateOnboardingReply()  (Response Brain — gpt-4o-mini, expression only)
//   7. save conversation turn  (fire-and-forget for next-turn context)
//
// Owner: Orchestrator. Coordinates — does not own any one layer's logic.

import { prisma } from "@repo/db/client";
import { learnerKey } from "../product/learner-key";
import { extractAcademicFacts }         from "./nova-onboarding-extractor";
import { validateExtraction }            from "./nova-onboarding-validator";
import { makeOnboardingDecision }        from "./nova-onboarding-decision-engine";
import { generateOnboardingReply }       from "./nova-onboarding-response";
import { persistOnboardingExtraction, loadOnboardingState } from "./nova-onboarding-persistence";
import { saveUserMessage, saveAssistantMessage, loadConversationHistory } from "../adapters/conversation-adapter";

export interface OnboardingResult {
  reply:    string;
  complete: boolean;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runNovaOnboarding(input: {
  platformChatId: string;
  text:           string;
  timestamp:      Date;
}): Promise<OnboardingResult> {
  const { platformChatId, text } = input;

  // 1. Resolve MessengerUser
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { id: true },
  });

  if (!user) {
    return {
      reply:    "Hey, I'm Nova. Tell me about your studies — which year are you in, and where?",
      complete: false,
    };
  }

  const userId = user.id;

  // 2. Load state + history in parallel
  const [currentState, history] = await Promise.all([
    loadOnboardingState(userId),
    loadConversationHistory(userId, 8),
  ]);

  if (currentState.onboardingComplete) {
    return { reply: "What do you want to work on today?", complete: true };
  }

  const historyForBrains = history.map(t => ({
    role: t.role === "nova" ? ("nova" as const) : ("user" as const),
    text: t.text,
  }));

  // 3. Understanding Brain — extract facts only
  const extraction = await extractAcademicFacts({
    message: text,
    state:   currentState,
    history: historyForBrains,
  });

  // 4. Validator — deterministic normalization
  const validated = validateExtraction(extraction.extracted);

  // 5. Decision Engine — deterministic, no LLM
  const decision = makeOnboardingDecision(extraction, validated, currentState);

  // 6. Persist — must complete before Response Brain runs
  //    (Response Brain may need projectedState to be accurate)
  const hasAnythingToWrite =
    validated.institution ||
    validated.degree ||
    validated.major ||
    validated.yearOfStudy ||
    validated.targetGpa ||
    validated.goals.length > 0 ||
    validated.subjects.length > 0 ||
    validated.exams.length > 0 ||
    validated.preferredStudyHoursPerDay ||
    validated.preferredStudyTime ||
    validated.studyStyle ||
    validated.biggestStruggle ||
    validated.realityFacts.length > 0;

  if (hasAnythingToWrite) {
    await persistOnboardingExtraction(userId, validated, decision.isCompleteEnough).catch(err => {
      console.error("[nova:onboarding] persistence error:", err);
    });
  }

  // 7. Response Brain — express the decision conversationally
  const reply = await generateOnboardingReply({
    originalText: text,
    extraction,
    decision,
    currentState,
    history: historyForBrains,
  });

  // 8. Save conversation turn (fire-and-forget — next turn context).
  //    intent "intake": mandatory onboarding turns do not count against the
  //    rate limit, same rule as Rex.
  const turnAt = new Date();
  saveUserMessage(userId, text, { intent: "intake", emotion: "neutral", signals: [] }, turnAt)
    .then(() => saveAssistantMessage(userId, reply, "nova_onboarding", {
      intervention: "onboarding",
      confidence:   extraction.confidence,
    }, turnAt))
    .catch(err => {
      console.error("[nova:onboarding] turn save error:", err);
    });

  // 9. Structured log
  console.log(JSON.stringify({
    ts:              new Date().toISOString(),
    chatId:          platformChatId,
    layer:           "nova:onboarding",
    confidence:      extraction.confidence,
    intent:          extraction.intent,
    justCaptured:    decision.justCaptured.map(f => f.field),
    conflicts:       decision.conflictsDetected.length,
    nextFocus:       decision.nextFocus,
    isComplete:      decision.isCompleteEnough,
    projected:       decision.projectedState,
    unknownAspects:  extraction.unknownAspects.length,
    message:         text.slice(0, 60),
  }));

  return {
    reply,
    complete: decision.isCompleteEnough,
  };
}

// ── Standalone completion check (used by route.ts) ────────────────────────────

export async function isOnboardingComplete(platformChatId: string): Promise<boolean> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { onboardingComplete: true } } },
  });
  return user?.novaAcademicProfile?.onboardingComplete === true;
}
