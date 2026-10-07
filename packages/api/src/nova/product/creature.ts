// ─── Creature view ────────────────────────────────────────────────────────────
// What the Creature page shows a Nova learner. A read model over two views
// that already exist: Today (the streak) and Progress (active days, weeks).
// It computes no streak and counts no session of its own, writes nothing and
// calls no LLM.

import { createHash } from "node:crypto";
import { loadNovaProgress } from "./progress";
import { loadNovaToday } from "./today";
import type { NovaProgressReady } from "./progress.types";
import {
  CREATURE_BASE_HEALTH, CREATURE_DAYS_PER_LEVEL, CREATURE_HEALTH_PER_DAY,
  type NovaCreatureReady, type NovaCreatureView,
} from "./creature.types";

export const creatureLevel = (activeDays: number): number =>
  1 + Math.floor(Math.max(0, activeDays) / CREATURE_DAYS_PER_LEVEL);

// Active days in this week and the last finished one.
export function creatureHealth(weeks: NovaProgressReady["consistency"]["weeks"]): number {
  const recent = weeks.filter(w => !w.beforeStart).slice(-2).reduce((sum, w) => sum + w.activeDays, 0);
  return Math.min(100, CREATURE_BASE_HEALTH + recent * CREATURE_HEALTH_PER_DAY);
}

export function buildCreatureView(input: { seed: string; streakDays: number; progress: NovaProgressReady }): NovaCreatureReady {
  const activeDays = input.progress.overview.activeDays;
  return {
    status: "ready",
    seed:        input.seed,
    streakDays:  Math.max(0, input.streakDays),
    activeDays,
    level:       creatureLevel(activeDays),
    worldHealth: creatureHealth(input.progress.consistency.weeks),
  };
}

// A terrain seed that is the learner's own and says nothing about them.
export const creatureSeed = (platformChatId: string): string =>
  `nova-${createHash("sha256").update(`creature:${platformChatId}`).digest("hex").slice(0, 12)}`;

export async function loadNovaCreature(platformChatId: string, options: { now?: Date } = {}): Promise<NovaCreatureView> {
  const now = options.now ?? new Date();
  const [today, progress] = await Promise.all([loadNovaToday(platformChatId, { now }), loadNovaProgress(platformChatId, { now })]);
  if (progress.status !== "ready") return progress;
  if (today.status !== "ready") return today;
  return buildCreatureView({ seed: creatureSeed(platformChatId), streakDays: today.progress.streakDays, progress });
}
