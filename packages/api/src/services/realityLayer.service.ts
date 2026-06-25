// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC REALITY LAYER — short-TTL contextual facts between messages and memory.
//
// Solves the "fever → /log" problem: a user declares illness, then later tries to
// log a workout. Without a reality layer, Rex has no persistent signal that the
// user is sick (message context is gone, long-term memory doesn't store illness).
//
// Categories + TTLs:
//   health          72h  — fever, flu, food poisoning, nausea
//   injury         336h  — torn muscle, fracture, severe strain (14 days)
//   emotional       48h  — burnout, grief, anxiety declared
//   life_constraint 168h — exam week, travel, no gym access (7 days)
//   training_context 24h — rest day, deload, active recovery
//
// Phase 1 (this file): deterministic extraction from Parser V2 signals only.
// Phase 2 (realityExtractor.service.ts): async LLM extraction for novel facts.
// ═══════════════════════════════════════════════════════════════════════════════

import { prisma } from "@repo/db/client";

export type RealityCategory =
  | "health"
  | "injury"
  | "emotional"
  | "life_constraint"
  | "training_context";

export interface UserRealityFact {
  id: string;
  category: string;
  fact: string;
  confidence: number;
  relevanceScore: number;
  expiresAt: Date;
  createdAt: Date;
}

const CATEGORY_TTL_HOURS: Record<RealityCategory, number> = {
  health:           72,
  injury:           336,  // 14 days
  emotional:        48,
  life_constraint:  168,  // 7 days
  training_context: 24,
};

const MAX_REALITIES = 8;

// ── Read ─────────────────────────────────────────────────────────────────────

export async function readActiveReality(platformChatId: string): Promise<UserRealityFact[]> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      realities: {
        where: { isActive: true, expiresAt: { gt: new Date() } },
        orderBy: [{ relevanceScore: "desc" }, { confidence: "desc" }],
        take: MAX_REALITIES,
        select: {
          id: true,
          category: true,
          fact: true,
          confidence: true,
          relevanceScore: true,
          expiresAt: true,
          createdAt: true,
        },
      },
    },
  });
  return user?.realities ?? [];
}

// ── Write ─────────────────────────────────────────────────────────────────────

// Phase 2 entry point: accepts explicit ttlHours and relevanceScore.
// Deduplicates: skips write if active fact in same category exists from the last 4h.
export async function writeRealityFact(
  platformChatId: string,
  category: RealityCategory,
  fact: string,
  confidence: number,
  relevanceScore: number,
  ttlHours: number,
  sourceText?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id: true,
      realities: {
        where: { category, isActive: true, createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) return;
  if (user.realities.length > 0) return; // dedup: same category written in last 4h

  await prisma.userReality.create({
    data: { userId: user.id, category, fact, confidence, relevanceScore, sourceText, expiresAt },
  });
  const all = await prisma.userReality.findMany({
    where: { userId: user.id, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (all.length > MAX_REALITIES) {
    await prisma.userReality.updateMany({
      where: { id: { in: all.slice(MAX_REALITIES).map(r => r.id) } },
      data: { isActive: false },
    });
  }
}

async function writeReality(
  platformChatId: string,
  category: RealityCategory,
  fact: string,
  confidence: number,
  sourceText?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CATEGORY_TTL_HOURS[category] * 60 * 60 * 1000);

  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  if (!user) return;

  await prisma.userReality.create({
    data: { userId: user.id, category, fact, confidence, sourceText, expiresAt },
  });

  // Trim oldest entries beyond the cap
  const all = await prisma.userReality.findMany({
    where: { userId: user.id, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (all.length > MAX_REALITIES) {
    await prisma.userReality.updateMany({
      where: { id: { in: all.slice(MAX_REALITIES).map(r => r.id) } },
      data: { isActive: false },
    });
  }
}

// ── Deterministic extraction (Phase 1) ───────────────────────────────────────
// Called immediately after V2 parse, fire-and-forget. Never blocks the response.

export function writeRealityFromV2Signals(
  platformChatId: string,
  signals: string[],
  text: string,
): void {
  const snippet = text.slice(0, 120);
  void (async () => {
    try {
      if (signals.includes("HEALTH_EVENT")) {
        await writeReality(
          platformChatId,
          "health",
          `User reported illness: "${snippet}"`,
          0.9,
          text,
        );
      }
      if (signals.includes("INJURY_CONTEXT")) {
        await writeReality(
          platformChatId,
          "injury",
          `User reported injury: "${snippet}"`,
          0.9,
          text,
        );
      }
    } catch (err) {
      console.error("[realityLayer] writeRealityFromV2Signals error:", err);
    }
  })();
}

// ── Resolution detection ──────────────────────────────────────────────────────

const RESOLUTION_RE: Partial<Record<RealityCategory, RegExp>> = {
  health: /\b(?:feeling\s+better|all\s+better|recovered|back\s+to\s+normal|healthy\s+again|no\s+longer\s+sick|fever(?:'s|\s+is)?\s+gone|better\s+now)\b/i,
  injury: /\b(?:healed|pain(?:'s|\s+is)?\s+gone|fully\s+recovered|no\s+more\s+pain|cleared\s+to\s+train|injury\s+(?:is\s+)?gone)\b/i,
};

export function resolveRealityFromV2Signals(
  platformChatId: string,
  signals: string[],
  text: string,
): void {
  void (async () => {
    try {
      for (const [category, re] of Object.entries(RESOLUTION_RE) as [RealityCategory, RegExp][]) {
        if (re.test(text)) {
          const user = await prisma.messengerUser.findUnique({
            where: { platform_platformChatId: { platform: "telegram", platformChatId } },
            select: { id: true },
          });
          if (user) {
            await prisma.userReality.updateMany({
              where: { userId: user.id, category, isActive: true },
              data: { isActive: false, resolvedAt: new Date() },
            });
          }
        }
      }
    } catch (err) {
      console.error("[realityLayer] resolveRealityFromV2Signals error:", err);
    }
  })();
}

// ── Conflict gate ─────────────────────────────────────────────────────────────
// Returns a clarification message if health/injury reality conflicts with a /log.
// Callers should return early if this returns a string.

export function buildConflictReply(activeReality: UserRealityFact[]): string | null {
  const healthFact  = activeReality.find(r => r.category === "health");
  const injuryFact  = activeReality.find(r => r.category === "injury");

  if (healthFact) {
    return "You mentioned being sick recently. Are you sure you want to log a workout right now? Reply yes to log it, or rest up if you need more time.";
  }
  if (injuryFact) {
    return "You mentioned an injury. Are you still dealing with it? Log it if you trained around it — or hold off if you need more recovery.";
  }
  return null;
}

// ── System prompt block ───────────────────────────────────────────────────────
// Injected into Rex's context before healthEventBlock.

export function buildRealityBlock(activeReality: UserRealityFact[]): string | null {
  if (activeReality.length === 0) return null;

  const lines: string[] = [];
  for (const fact of activeReality) {
    const hoursLeft = Math.round((fact.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000));
    const label = fact.category.toUpperCase().replace("_", " ");
    lines.push(`[${label}] ${fact.fact} (context expires ~${hoursLeft}h)`);
  }

  const hasHealth  = activeReality.some(r => r.category === "health");
  const hasInjury  = activeReality.some(r => r.category === "injury");

  const directives: string[] = [];
  if (hasHealth) {
    directives.push("→ HEALTH context active: Do NOT push training. Recovery-first responses. Do not ask why they missed sessions.");
  }
  if (hasInjury) {
    directives.push("→ INJURY context active: Avoid prescribing exercises for the affected area. Acknowledge before coaching.");
  }

  return [
    "ACTIVE REALITY (persisted context, hours-to-days TTL):",
    ...lines,
    ...directives,
  ].join("\n");
}
