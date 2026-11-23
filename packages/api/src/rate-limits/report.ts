// ─── What the limits saw: the operator's report (read only) ──────────────────
// scripts/rateLimitReport.ts prints it. It answers, from rows that already
// exist (no extra logging):
//   - which policies refused, or would have in shadow, and how often
//     (rl.obs.* hourly rows, kept 14 days): an endpoint under attack, or a
//     limit too tight for real students;
//   - which subjects are over or near a limit now (counter rows, kept a day),
//     account ids as stored and addresses only as keyed hashes;
//   - concurrency: slots held now against each limit.

import { prisma } from "@repo/db/client";
import { DIMENSIONS, POLICIES, type Dimension } from "./policies";

export interface EventRow { event: string; policy: string; dimension: string; count: number }
export interface HotSubject { policy: string; dimension: Dimension; windowSeconds: number; subject: string; count: number; limit: number; ratio: number }
export interface SlotRow { policy: string; scope: string; subject: string; held: number; limit: number | null }

const OBS = /^rl\.obs\.([a-z_]+)\.(.+)\.([a-z]+):obs:hour$/;
const COUNTER = /^rl\.(.+)\.(user|ip|client|task|global)\.(\d+)s:(.+)$/;
const LEASE = /^rl\.(.+)\.conc-(user|global):(.+)$/;

export async function rateLimitReport(hours = 24, now = new Date()): Promise<{ events: EventRow[]; hot: HotSubject[]; slots: SlotRow[] }> {
  const since = new Date(now.getTime() - hours * 3_600_000);
  const obs = await prisma.$queryRaw<{ key: string; count: number }[]>`
    SELECT key, sum(count)::int AS count FROM "RateLimitWindow" WHERE key LIKE 'rl.obs.%' AND "windowStart" >= ${since} GROUP BY key`;
  const events = obs.flatMap(r => { const m = OBS.exec(r.key); return m ? [{ event: m[1]!, policy: m[2]!, dimension: m[3]!, count: Number(r.count) }] : []; })
    .sort((a, b) => b.count - a.count);

  const windows = await prisma.$queryRaw<{ key: string; count: number }[]>`
    SELECT key, max(count)::int AS count FROM "RateLimitWindow" WHERE key LIKE 'rl.%' AND key NOT LIKE 'rl.obs.%' AND "expiresAt" >= ${since} GROUP BY key`;
  const hot: HotSubject[] = [];
  for (const r of windows) {
    const m = COUNTER.exec(r.key);
    if (!m) continue;
    const [, policy, dim, secs, subject] = m as unknown as [string, string, Dimension, string, string];
    const w = POLICIES[policy]?.[dim]?.find(x => x.windowMs === Number(secs) * 1000);
    if (!w || !DIMENSIONS.includes(dim)) continue;
    const ratio = Number(r.count) / w.limit;
    if (ratio >= 0.8) hot.push({ policy, dimension: dim, windowSeconds: Number(secs), subject, count: Number(r.count), limit: w.limit, ratio: Math.round(ratio * 100) / 100 });
  }
  hot.sort((a, b) => b.ratio - a.ratio);

  const leases = await prisma.$queryRaw<{ key: string; held: number }[]>`
    SELECT key, count(*)::int AS held FROM "RateLimitLease" WHERE "expiresAt" > ${now} GROUP BY key`;
  const slots = leases.flatMap(r => {
    const m = LEASE.exec(r.key);
    if (!m) return [];
    const p = POLICIES[m[1]!];
    return [{ policy: m[1]!, scope: m[2]!, subject: m[3]!, held: Number(r.held), limit: p?.concurrency?.[m[2] as "user" | "global"] ?? null }];
  }).sort((a, b) => b.held - a.held);

  return { events, hot: hot.slice(0, 50), slots: slots.slice(0, 50) };
}
