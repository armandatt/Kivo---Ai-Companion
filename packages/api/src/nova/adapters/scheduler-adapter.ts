// ─── Scheduler Adapter ────────────────────────────────────────────────────────
// Loads conversation history for the context builder.
// Saves Nova's response as a conversation turn in the DB.
// Reuses Rex's existing MemoryFact table (type="conversation").
// No LLM calls.
// Owner: Scheduler Adapter.

import { prisma } from "@repo/db/client";
import type { ConversationTurn } from "../types/context.types.js";

// ── Load recent conversation history ──────────────────────────────────────────

export async function loadConversationHistory(
  userId: string,
  limit = 6,
): Promise<ConversationTurn[]> {
  const turns = await prisma.memoryFact.findMany({
    where:   { userId, type: "conversation" },
    orderBy: { createdAt: "desc" },
    take:    limit * 2,
  });

  const history: ConversationTurn[] = turns
    .reverse()
    .map(t => {
      let role: "user" | "nova" = "user";
      let text = t.value;

      try {
        const parsed = JSON.parse(t.value) as { role?: string; text?: string };
        if (parsed.role === "nova" || parsed.role === "assistant") role = "nova";
        text = parsed.text ?? t.value;
      } catch {
        // Plain string — treat as user turn
      }

      return { role, text, createdAt: t.createdAt };
    })
    .slice(-limit);

  return history;
}

// ── Save a conversation turn ───────────────────────────────────────────────────

export async function saveConversationTurn(
  userId:       string,
  userText:     string,
  novaReply:    string,
  turnMetadata: {
    intervention:  string;
    reasoningMode: string;
    confidence:    number;
    graphNode:     string;
  },
): Promise<void> {
  const now = new Date();

  await prisma.memoryFact.create({
    data: {
      userId,
      type:       "conversation",
      key:        `conv_user_${now.getTime()}`,
      value:      JSON.stringify({ role: "user", text: userText }),
      confidence: 1.0,
    },
  });

  await prisma.memoryFact.create({
    data: {
      userId,
      type:       "conversation",
      key:        `conv_nova_${now.getTime() + 1}`,
      value:      JSON.stringify({ role: "nova", text: novaReply, ...turnMetadata }),
      confidence: turnMetadata.confidence,
    },
  });
}
