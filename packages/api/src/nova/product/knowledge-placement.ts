// ─── Where a passage belongs: Kivo's workspace intelligence ───────────────────
// One service for every capture path: the extension's Capture, the research
// agent's findings and Drafts in Kivo. Rules: knowledge-placement-rules.ts.
//
//   1. The workspace as it stands (Subject Studio's structure, cached briefly
//      per learner and keyed by its version) gives the places: existing
//      subjects and topics only, with ids.
//   2. Keyword evidence ranks them (rarer words count more), and the learner's
//      notes that share the passage's key words add evidence for the places
//      they are filed under.
//   3. One exact name and nothing competing: filed, "high", no model call.
//      Otherwise one small-model call picks among the top candidates; code
//      caps its confidence by the evidence. "low": not filed, suggested.
//
// What the model is given: the passage, the page title and site, a little of
// the text around it, and the labels of at most CANDIDATES_FOR_MODEL places.
// Never the whole workspace, never the address. Nothing here writes: the
// draft module stores the answer (capture-drafts.ts).

import { generateOpenAIText } from "../../services/openai.service";
import { startInteraction } from "../../services/llm-usage";
import { compare, keyTerms } from "../../connect/similarity";
import { searchNoteBodies } from "./notes";
import { loadStudyStructure } from "./setup-edit";
import {
  decide, decideByName, placesOf, placementPrompt, rankPlaces, readPick,
  CANDIDATES_FOR_MODEL, PLACEMENT_SYSTEM,
  type Place, type Placement, type PlacementDecision, type PlacementText, type RankedPlace,
} from "./knowledge-placement-rules";

export const PLACEMENT_DEADLINE_MS = 4_000;
const STRUCTURE_TTL_MS = 30_000;
const RELATED_NOTES = 8;

// ── The workspace, briefly cached ─────────────────────────────────────────────
// A capture burst (ten passages from one article) reads the structure once.
// Any edit in Subject Studio changes its version; forgetStructure() drops the
// cache at once when a learner changes a placement.

const cache = new Map<string, { at: number; version: string; places: Place[] }>();

export async function workspacePlaces(profileId: string, now = Date.now()): Promise<{ version: string; places: Place[] }> {
  const hit = cache.get(profileId);
  if (hit && now - hit.at < STRUCTURE_TTL_MS) return hit;
  const st = await loadStudyStructure(profileId);
  const entry = { at: now, version: st.version, places: placesOf(st) };
  cache.set(profileId, entry);
  if (cache.size > 2_000) for (const [k, v] of cache) if (now - v.at >= STRUCTURE_TTL_MS) cache.delete(k);
  return entry;
}
export const forgetStructure = (profileId: string) => { cache.delete(profileId); };

// ── Related notes: evidence, and duplicates ───────────────────────────────────

export interface RelatedNote { id: string; title: string; subjectId: string | null; subjectName: string | null; topicName: string | null; overlap: "exact_duplicate" | "same_concept" | "related" | "new" }

export async function relatedNotes(profileId: string, t: PlacementText, take = RELATED_NOTES): Promise<RelatedNote[]> {
  const terms = keyTerms(`${t.title} ${t.text}`, 6);
  if (!terms.length) return [];
  const notes = await searchNoteBodies(profileId, terms, { take: 30, bodyMax: 20_000 });
  const passage = { title: t.title, body: t.text };
  return notes
    .map(n => ({ n, c: compare(passage, { title: n.title, body: n.body }) }))
    .filter(x => x.c.overlap !== "new")
    .sort((a, b) => (b.c.textScore + b.c.titleScore) - (a.c.textScore + a.c.titleScore))
    .slice(0, take)
    .map(({ n, c }) => ({ id: n.id, title: n.title, subjectId: n.subjectId, subjectName: n.subjectName, topicName: n.topicName, overlap: c.overlap }));
}

// A filed note that shares the passage's words is evidence for its place.
export function withNoteEvidence(ranked: RankedPlace[], places: Place[], notes: RelatedNote[]): RankedPlace[] {
  if (!notes.length) return ranked;
  const out = new Map(ranked.map(r => [r.place.key, { ...r }]));
  for (const n of notes) {
    if (!n.subjectId) continue;
    const weight = n.overlap === "related" ? 0.4 : 0.8;
    const place = places.find(p => p.subjectId === n.subjectId && (n.topicName ? p.topicName?.toLowerCase() === n.topicName.toLowerCase() : p.topicId === null));
    if (!place) continue;
    const r = out.get(place.key) ?? { place, score: 0, exact: null };
    r.score = Math.round((r.score + weight) * 1000) / 1000;
    out.set(place.key, r);
  }
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, CANDIDATES_FOR_MODEL);
}

// ── Deciding ──────────────────────────────────────────────────────────────────

export interface PlacementAnswer extends PlacementDecision { modelUsed: boolean; candidates: number; related: RelatedNote[] }

const modelOff = () => process.env.NOVA_PLACEMENT_MODEL_DISABLED === "true" || process.env.NOVA_RESOURCE_MODEL_DISABLED === "true";

export async function suggestPlacement(
  profileId: string, t: PlacementText,
  options: { now?: Date; generate?: typeof generateOpenAIText; deadlineMs?: number; requestId?: string; surface?: "extension" | "web" } = {},
): Promise<PlacementAnswer> {
  const now = options.now ?? new Date();
  const [{ places }, related] = await Promise.all([workspacePlaces(profileId, now.getTime()), relatedNotes(profileId, t).catch(() => [] as RelatedNote[])]);
  if (!places.length) return { placement: null, suggestion: null, modelUsed: false, candidates: 0, related };

  const ranked = withNoteEvidence(rankPlaces(t, places), places, related);
  const byName = decideByName(ranked, now);
  if (byName) return { placement: byName, suggestion: null, modelUsed: false, candidates: ranked.length, related };

  // Nothing to ask about: with no evidence at all, the shortlist would be
  // arbitrary. Only a workspace small enough to list whole is shown as is.
  const shortlist: RankedPlace[] = ranked.length ? ranked : places.length <= CANDIDATES_FOR_MODEL ? places.map(place => ({ place, score: 0, exact: null })) : [];
  if (!shortlist.length || modelOff()) {
    return { ...decide(null, ranked, now), modelUsed: false, candidates: shortlist.length, related };
  }

  const generate = options.generate ?? generateOpenAIText;
  try {
    const reply = await startInteraction({
      feature: "capture_placement", surface: options.surface ?? "extension", profileId,
      requestId: options.requestId ?? `place:${now.getTime()}`, isBackground: false, isAllowanceCounted: false,
    }, () => generate({ model: "gpt-4o-mini", systemInstruction: PLACEMENT_SYSTEM, prompt: placementPrompt(t, shortlist), maxOutputTokens: 80, deadlineMs: options.deadlineMs ?? PLACEMENT_DEADLINE_MS, json: true }));
    const pick = readPick(typeof reply === "string" ? reply : "", shortlist);
    return { ...decide(pick, ranked.length ? ranked : shortlist, now), modelUsed: true, candidates: shortlist.length, related };
  } catch (err) {
    // The capture is kept either way: unfiled, with the best keyword guess.
    console.error("[nova:placement] model unavailable:", (err as Error).name);
    return { ...decide(null, ranked, now), modelUsed: true, candidates: shortlist.length, related };
  }
}

export type { Placement };
