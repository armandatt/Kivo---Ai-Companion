// ─── Usage events: one row per model call ─────────────────────────────────────
// The only code that touches AiUsageEvent. The LLM client describes each call
// (services/llm-usage.ts emitLlmCall) and this writes it, with who it was for
// and what it cost (pricing.ts). Measurement only: nothing here reads the
// daily allowance or changes it, and AiUsageDay is not touched.
//
// Who it was for, in order: the meter key the entry point already had; else
// the learner, mapped to their account the way the meter maps them
// (entitlements.ts accountForLearner); else their profile's learner; else the
// surface itself ("system:background"), for work with no learner behind it.

import { prisma } from "@repo/db/client";
import type { LlmCallEvent } from "../services/llm-usage";
import { accountForLearner } from "./entitlements";
import { costOf } from "./pricing";
import { utcDay } from "./usage";

async function learnerOfProfile(profileId: string): Promise<string | null> {
  const row = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { user: { select: { platformChatId: true } } } });
  return row?.user.platformChatId ?? null;
}

export async function usageKeysFor(context: LlmCallEvent["context"]): Promise<{ subjectKey: string; attributedKey: string | null }> {
  const learner = context.learner ?? (context.profileId ? await learnerOfProfile(context.profileId).catch(() => null) : null);
  if (context.usageKey) return { subjectKey: context.usageKey, attributedKey: learner };
  if (learner) {
    const userId = await accountForLearner(learner).catch(() => null);
    return { subjectKey: userId ? `user:${userId}` : `learner:${learner}`, attributedKey: learner };
  }
  return { subjectKey: `system:${context.surface}`, attributedKey: null };
}

const tokens = (n: number | null) => n === null ? null : Math.min(n, 2_147_483_647);

export async function writeUsageEvent(event: LlmCallEvent): Promise<void> {
  const { context, usage } = event;
  const keys = await usageKeysFor(context);
  const cost = costOf(event);
  await prisma.aiUsageEvent.create({
    data: {
      ...keys,
      interactionId:            context.interactionId,
      requestId:                context.requestId,
      feature:                  context.feature,
      surface:                  context.surface,
      provider:                 event.provider,
      model:                    event.model.slice(0, 120),
      inputTokens:              tokens(usage.inputTokens),
      outputTokens:             tokens(usage.outputTokens),
      cacheCreationInputTokens: tokens(usage.cacheCreationInputTokens),
      cacheReadInputTokens:     tokens(usage.cacheReadInputTokens),
      attempts:                 event.attempts,
      outcome:                  event.outcome,
      failureCategory:          event.failureCategory,
      latencyMs:                Math.max(0, Math.round(event.latencyMs)),
      isBackground:             context.isBackground,
      isAllowanceCounted:       context.isAllowanceCounted,
      estimatedCostMicros:      cost.estimatedCostMicros,
      costState:                cost.costState,
      pricingVersion:           cost.pricingVersion,
      day:                      utcDay(event.at),
      createdAt:                event.at,
    },
  });
}
