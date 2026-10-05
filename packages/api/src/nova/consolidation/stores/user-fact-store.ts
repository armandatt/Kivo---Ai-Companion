// ─── UserFact Store ───────────────────────────────────────────────────────────
// SKILL.md §16.4 — owner of durable facts about the user.
// Writes only what the consolidator decided. No rules live here.

import { prisma } from "@repo/db/client";
import type { ConsolidationDecision, StoredFact } from "../../types/consolidation.types";
import { appendProvenance, sourceMessageIds } from "./provenance";
import type { Db } from "./db";

export async function loadActiveFacts(userId: string): Promise<StoredFact[]> {
  const rows = await prisma.userFact.findMany({
    where:   { userId, status: "active" },
    orderBy: { lastObservedAt: "desc" },
    take:    200,
    select:  {
      id: true, type: true, key: true, value: true,
      confidence: true, evidenceCount: true, lastObservedAt: true, provenance: true,
    },
  });
  return rows.map(({ provenance, ...r }) => ({ ...r, sourceMessageIds: sourceMessageIds(provenance) }));
}

export async function applyFactDecision(
  db:       Db,
  userId:   string,
  decision: ConsolidationDecision,
  now:      Date,
): Promise<void> {
  const w = decision.write;
  if (w?.target !== "user_fact") return;
  if (decision.action !== "CREATE" && decision.action !== "UPDATE") return;

  const where = { userId_type_key: { userId, type: w.type, key: w.key } };
  const prior = await db.userFact.findUnique({ where, select: { provenance: true } });

  const data = {
    value:           w.value,
    confidence:      w.confidence,
    evidenceCount:   w.evidenceCount,
    status:          "active",
    sourceCompanion: "nova",
    sourceMessageId: decision.provenance?.sourceMessageId ?? null,
    provenance:      appendProvenance(prior?.provenance, decision.provenance, w.supersedes, now),
    lastObservedAt:  now,
  };

  await db.userFact.upsert({
    where,
    update: data,
    create: { userId, type: w.type, key: w.key, firstObservedAt: now, ...data },
  });
}
