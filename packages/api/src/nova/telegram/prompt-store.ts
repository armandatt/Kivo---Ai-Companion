// ─── Telegram prompts ─────────────────────────────────────────────────────────
// The only code that touches NovaTelegramPrompt.
//
// A prompt is a message Nova sent that offers choices. It is conversation
// state, and the only conversation state Telegram has: it is how a tap, or a
// typed "yeah", finds out what it is an answer to. It survives restarts and
// is the same on every instance.
//
//   one open prompt per learner   openKey is unique while a prompt is open,
//                                  so the database refuses a second
//   a prompt is answered once     resolving is one conditional write; of two
//                                  taps (or a tap and a typed answer), one wins
//   a prompt expires              after expiresAt it can no longer be answered
//
// The option a tap names is looked up here. Nothing from the tap itself is
// trusted beyond those two ids.

import { prisma } from "@repo/db/client";
import { PROMPT_TTL_MINUTES, type PromptKind, type PromptOption, type PromptSpec } from "./telegram.types";

export const PROMPT_RETENTION_DAYS = 30;

export interface OpenPrompt {
  id:        string;
  kind:      PromptKind;
  options:   PromptOption[];
  messageId: number | null;
  expiresAt: Date;
}

type ResolvedBy = "callback" | "text" | "superseded" | "command" | "undelivered";

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

function toOpenPrompt(row: { id: string; kind: string; options: unknown; telegramMessageId: number | null; expiresAt: Date }): OpenPrompt {
  return {
    id: row.id, kind: row.kind as PromptKind, messageId: row.telegramMessageId, expiresAt: row.expiresAt,
    options: Array.isArray(row.options) ? row.options as unknown as PromptOption[] : [],
  };
}

// Opens a prompt, closing whichever one was open. Two opens at the same
// moment cannot both hold the open slot: the loser retries once, after the
// winner's prompt has become the one to close.
export async function openPrompt(profileId: string, chatId: string, spec: PromptSpec, now: Date): Promise<OpenPrompt> {
  const create = () => prisma.$transaction(async tx => {
    await tx.novaTelegramPrompt.updateMany({
      where: { openKey: profileId },
      data:  { openKey: null, resolvedAt: now, resolution: { by: "superseded" satisfies ResolvedBy } },
    });
    return tx.novaTelegramPrompt.create({
      data: {
        profileId, chatId, kind: spec.kind, openKey: profileId,
        options:   JSON.parse(JSON.stringify(spec.options)) as object,
        createdAt: now,
        expiresAt: new Date(now.getTime() + PROMPT_TTL_MINUTES[spec.kind] * 60_000),
      },
      select: { id: true, kind: true, options: true, telegramMessageId: true, expiresAt: true },
    });
  });
  try {
    return toOpenPrompt(await create());
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return toOpenPrompt(await create());
  }
}

export async function recordPromptMessage(promptId: string, messageId: number): Promise<void> {
  await prisma.novaTelegramPrompt.update({ where: { id: promptId }, data: { telegramMessageId: messageId } })
    .catch(err => console.error("[nova:telegram] prompt message id not recorded", err));
}

// The learner's open prompt, if it can still be answered.
export async function loadOpenPrompt(profileId: string, now: Date): Promise<OpenPrompt | null> {
  const row = await prisma.novaTelegramPrompt.findUnique({
    where:  { openKey: profileId },
    select: { id: true, kind: true, options: true, telegramMessageId: true, expiresAt: true },
  });
  return row && row.expiresAt > now ? toOpenPrompt(row) : null;
}

export type Resolution =
  | { ok: true; option: PromptOption; kind: PromptKind; messageId: number | null }
  // closed: answered, replaced or expired. unknown: no such prompt for this
  // learner (a forged or mistyped reference).
  | { ok: false; reason: "closed" | "unknown" };

// Answers a prompt exactly once. The write matches only a prompt that is
// this learner's, still open and not expired, so a second tap, a tap on an
// old message and a tap carrying someone else's prompt id all change nothing.
export async function resolvePrompt(
  profileId: string,
  promptId:  string,
  optionId:  string,
  by:        "callback" | "text",
  now:       Date,
): Promise<Resolution> {
  const row = await prisma.novaTelegramPrompt.findFirst({
    where:  { id: promptId, profileId },
    select: { id: true, kind: true, options: true, telegramMessageId: true, expiresAt: true },
  });
  if (!row) return { ok: false, reason: "unknown" };
  const prompt = toOpenPrompt(row);
  const option = prompt.options.find(o => o.id === optionId);
  if (!option) return { ok: false, reason: "unknown" };

  const claimed = await prisma.novaTelegramPrompt.updateMany({
    where: { id: promptId, profileId, openKey: profileId, resolvedAt: null, expiresAt: { gt: now } },
    data:  { openKey: null, resolvedAt: now, resolution: { by, optionId } },
  });
  if (claimed.count !== 1) return { ok: false, reason: "closed" };
  return { ok: true, option, kind: prompt.kind, messageId: prompt.messageId };
}

// Closes the open prompt without an answer: a command replaced the
// conversation, or its message never reached the learner.
export async function closeOpenPrompt(profileId: string, by: "command" | "undelivered", now: Date, promptId?: string): Promise<void> {
  await prisma.novaTelegramPrompt.updateMany({
    where: { openKey: profileId, ...(promptId ? { id: promptId } : {}) },
    data:  { openKey: null, resolvedAt: now, resolution: { by } },
  });
}

// Housekeeping. Open prompts are never purged here; an expired one is closed
// when the next prompt opens.
export async function purgeOldPrompts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PROMPT_RETENTION_DAYS * 86_400_000);
  const gone = await prisma.novaTelegramPrompt.deleteMany({
    where: { OR: [{ resolvedAt: { lt: cutoff } }, { openKey: null, expiresAt: { lt: cutoff } }] },
  });
  return gone.count;
}
