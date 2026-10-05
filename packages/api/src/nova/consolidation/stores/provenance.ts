// Shared shape of the provenance JSON kept on consolidated rows.

import type { Provenance } from "../../types/consolidation.types";

export const MAX_PROVENANCE_ENTRIES = 10;

export interface StoredProvenance {
  sources:  Provenance[];
  history?: Array<{ value: string; confidence: number; replacedAt: string }>;
}

export function readProvenance(json: unknown): StoredProvenance {
  const p = (json ?? null) as StoredProvenance | null;
  return { sources: p?.sources ?? [], history: p?.history ?? [] };
}

export function sourceMessageIds(json: unknown): string[] {
  return readProvenance(json).sources.flatMap(s => (s.sourceMessageId ? [s.sourceMessageId] : []));
}

export function appendProvenance(
  json:       unknown,
  source:     Provenance | null,
  superseded: { value: string; confidence: number } | null | undefined,
  now:        Date,
): object {
  const stored = readProvenance(json);
  const next: StoredProvenance = {
    sources: [...stored.sources, ...(source ? [source] : [])].slice(-MAX_PROVENANCE_ENTRIES),
    history: [
      ...(stored.history ?? []),
      ...(superseded ? [{ ...superseded, replacedAt: now.toISOString() }] : []),
    ].slice(-MAX_PROVENANCE_ENTRIES),
  };
  return JSON.parse(JSON.stringify(next)) as object;
}
