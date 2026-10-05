// The slice of the Prisma client the consolidation stores use. Both the
// client and a transaction client satisfy it, so every store can run inside
// one transaction.

import type { prisma } from "@repo/db/client";

export type Db = Pick<
  typeof prisma,
  | "userFact"
  | "userReality"
  | "behavioralPattern"
  | "novaCognitiveState"
  | "novaStudySession"
  | "novaAcademicProfile"
  | "novaConsolidationJob"
>;
