// ─── Conversation Adapter ─────────────────────────────────────────────────────
// SKILL.md §16.4 — owner of Nova's conversation log.
// Conversation lives in CompanionMessage, the same table the rate limiter and
// proactive suppression read. It answers "what actually happened", and it is
// the durable trace every piece of evidence points back to (sourceMessageId).
// It is never read as memory.
// No LLM calls.

import { prisma } from "@repo/db/client";
import type { ConversationTurn } from "../types/context.types";

const COMPANION = "nova";
const NOVA_INTENT_PREFIX = "nova_";

// What a user turn was classified as. Stored with the message so the pattern
// detector can read real history instead of re-deriving it.
export interface UserTurnAnnotation {
  intent:  string;
  emotion: string;
  signals: string[];
  secondaryIntents?: string[];
}

interface NovaMessageMetadata {
  companion: string;
  signals?:  string[];
  secondaryIntents?: string[];
  [key: string]: unknown;
}

function isNovaRow(row: { intent: string | null; metadata: unknown }): boolean {
  const meta = row.metadata as NovaMessageMetadata | null;
  return meta?.companion === COMPANION || (row.intent?.startsWith(NOVA_INTENT_PREFIX) ?? false);
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function saveUserMessage(
  userId:     string,
  text:       string,
  annotation: UserTurnAnnotation,
  now:        Date,
): Promise<string> {
  const row = await prisma.companionMessage.create({
    data: {
      userId,
      role:      "user",
      text,
      intent:    annotation.intent,
      emotion:   annotation.emotion,
      metadata:  {
        companion: COMPANION,
        signals:   annotation.signals,
        secondaryIntents: annotation.secondaryIntents ?? [],
      },
      createdAt: now,
    },
    select: { id: true },
  });
  return row.id;
}

export async function saveAssistantMessage(
  userId:   string,
  text:     string,
  intent:   string,                    // e.g. "nova_challenge", "nova_proactive_missed_session"
  metadata: Record<string, string | number>,
  now:      Date,
): Promise<void> {
  await prisma.companionMessage.create({
    data: {
      userId,
      role:      "assistant",
      text,
      intent,
      metadata:  { companion: COMPANION, ...metadata },
      // Strictly after the user turn it answers, so ordering is stable.
      createdAt: new Date(now.getTime() + 1),
    },
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function loadConversationHistory(
  userId: string,
  limit = 6,
): Promise<ConversationTurn[]> {
  // Over-fetch: a user who switched companions has another companion's turns
  // in the same log.
  const rows = await prisma.companionMessage.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    take:    limit * 4,
    select:  { role: true, text: true, intent: true, metadata: true, createdAt: true },
  });

  return rows
    .filter(isNovaRow)
    .slice(0, limit)
    .reverse()
    .map(r => ({
      role:      r.role === "user" ? ("user" as const) : ("nova" as const),
      text:      r.text,
      createdAt: r.createdAt,
    }));
}

// Per-message classification history for the pattern detector, oldest first.
// Each entry holds the signal types plus the Understanding Brain's intent and
// emotion for that message.
export async function loadSignalHistory(
  userId: string,
  limit = 30,
): Promise<Array<{ timestamp: Date; signals: string[] }>> {
  const rows = await prisma.companionMessage.findMany({
    where:   { userId, role: "user" },
    orderBy: { createdAt: "desc" },
    take:    limit * 2,
    select:  { intent: true, emotion: true, metadata: true, createdAt: true },
  });

  return rows
    .filter(isNovaRow)
    .slice(0, limit)
    .reverse()
    .map(r => ({
      timestamp: r.createdAt,
      signals:   annotationTags({
        intent:  r.intent ?? "",
        emotion: r.emotion ?? "",
        signals: (r.metadata as NovaMessageMetadata | null)?.signals ?? [],
        secondaryIntents: (r.metadata as NovaMessageMetadata | null)?.secondaryIntents ?? [],
      }),
    }));
}

export function annotationTags(a: UserTurnAnnotation): string[] {
  return [...new Set([...a.signals, a.intent, ...(a.secondaryIntents ?? []), a.emotion].filter(Boolean))];
}

export async function userMessagedSince(userId: string, since: Date): Promise<boolean> {
  const row = await prisma.companionMessage.findFirst({
    where:  { userId, role: "user", createdAt: { gte: since } },
    select: { id: true },
  });
  return row !== null;
}
