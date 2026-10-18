// ─── Knowledge Map layout ─────────────────────────────────────────────────────
// Where the learner put the cards on their map, and nothing else. This is the
// only reader and writer of NovaMapLayout; the map's read model
// (knowledge-map.ts) stays read-only and knows nothing of it.
//
//   - A position is stored only for an item on the learner's own map now: a
//     save is checked against loadNovaKnowledgeMap, which reads every item
//     through its owner, by the learner's profile. An id from the request is
//     never authority for anything but which of their own items it means.
//   - Moving a card writes this table only: no note, saved page, topic,
//     subject or link changes, and nothing is recorded about what the learner
//     knows.
//   - Reset removes this learner's positions and nothing else.

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { loadNovaKnowledgeMap } from "./knowledge-map";
import {
  MAP_LAYOUT_COORD_MAX, MAP_LAYOUT_ID_MAX, MAP_LAYOUT_MAX_POSITIONS, MAP_LAYOUT_NODE_TYPES,
  type MapLayoutNodeType, type MapLayoutResetResponse, type MapLayoutSaveResponse, type MapLayoutStatus, type MapLayoutView, type MapPosition,
} from "./map-layout.types";

export interface ParsedPosition { node: string; nodeType: MapLayoutNodeType; nodeId: string; x: number; y: number }

const INVALID = (message: string) => ({ ok: false as const, error: "invalid" as const, message });

// A row id as the map writes one: letters, digits, "_" and "-" (cuids).
function isRowId(id: string): boolean {
  if (id.length === 0 || id.length > MAP_LAYOUT_ID_MAX) return false;
  for (const ch of id) {
    const c = ch.charCodeAt(0);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || ch === "_" || ch === "-";
    if (!ok) return false;
  }
  return true;
}

// "<type>:<row id>", the map's own node id, split and checked. null: not one.
export function parseNodeId(node: unknown): { nodeType: MapLayoutNodeType; nodeId: string } | null {
  if (typeof node !== "string") return null;
  const at = node.indexOf(":");
  if (at <= 0) return null;
  const type = node.slice(0, at), id = node.slice(at + 1);
  if (!(MAP_LAYOUT_NODE_TYPES as readonly string[]).includes(type) || !isRowId(id)) return null;
  return { nodeType: type as MapLayoutNodeType, nodeId: id };
}

const coordinate = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAP_LAYOUT_COORD_MAX ? Math.round(v * 100) / 100 : null;

// A save's body, checked whole: one bad entry refuses the save, so nothing is
// half-applied. A node named twice keeps its last position. Pure.
export function parseLayoutInput(raw: unknown): { ok: true; positions: ParsedPosition[] } | ReturnType<typeof INVALID> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return INVALID("That isn't a layout.");
  const list = (raw as Record<string, unknown>).positions;
  if (!Array.isArray(list)) return INVALID("That isn't a layout.");
  if (list.length > MAP_LAYOUT_MAX_POSITIONS) return INVALID(`A layout holds at most ${MAP_LAYOUT_MAX_POSITIONS} positions.`);
  const byNode = new Map<string, ParsedPosition>();
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return INVALID("That isn't a position.");
    const e = entry as Record<string, unknown>;
    const id = parseNodeId(e.node);
    if (!id) return INVALID("That isn't an item on the map.");
    const x = coordinate(e.x), y = coordinate(e.y);
    if (x === null || y === null) return INVALID("That position is off the map.");
    const node = `${id.nodeType}:${id.nodeId}`;
    byNode.delete(node);
    byNode.set(node, { node, ...id, x, y });
  }
  return { ok: true, positions: [...byNode.values()] };
}

// The learner's profile, by the key the session resolved. Never an id from
// the request.
async function profileOf(platformChatId: string): Promise<{ ok: true; profileId: string } | { ok: false; status: MapLayoutStatus }> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true } } },
  });
  if (!user) return { ok: false, status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { ok: false, status: "onboarding_incomplete" };
  return { ok: true, profileId: profile.id };
}

const NOT_READY = (status: MapLayoutStatus) => ({ ok: false as const, error: status, message: "Finish setting up with Nova first." });

export async function loadMapLayout(platformChatId: string): Promise<MapLayoutView> {
  const profile = await profileOf(platformChatId);
  if (!profile.ok) return NOT_READY(profile.status);
  const rows = await prisma.novaMapLayout.findMany({
    where:  { profileId: profile.profileId },
    select: { nodeType: true, nodeId: true, x: true, y: true },
    take:   MAP_LAYOUT_MAX_POSITIONS * 2,
  });
  const positions: MapPosition[] = rows.map(r => ({ node: `${r.nodeType}:${r.nodeId}`, x: r.x, y: r.y }));
  return { ok: true, positions };
}

export async function saveMapLayout(platformChatId: string, raw: unknown): Promise<MapLayoutSaveResponse> {
  const parsed = parseLayoutInput(raw);
  if (!parsed.ok) return parsed;
  const profile = await profileOf(platformChatId);
  if (!profile.ok) return NOT_READY(profile.status);
  const profileId = profile.profileId;

  // Only the learner's own items, as their map has them now.
  const map = await loadNovaKnowledgeMap(platformChatId);
  if (map.status !== "ready") return NOT_READY(map.status);
  const onMap = new Set(map.nodes.map(n => n.id));
  const keep = parsed.positions.filter(p => onMap.has(p.node));
  const skipped = parsed.positions.filter(p => !onMap.has(p.node)).map(p => p.node);

  // One transaction: a save is stored whole or not at all. Each position is
  // an upsert on (learner, kind, row), so a repeat or a second tab's save of
  // the same card leaves one row, the later position.
  if (keep.length > 0) {
    await prisma.$transaction(keep.map(p => prisma.novaMapLayout.upsert({
      where:  { profileId_nodeType_nodeId: { profileId, nodeType: p.nodeType, nodeId: p.nodeId } },
      create: { profileId, nodeType: p.nodeType, nodeId: p.nodeId, x: p.x, y: p.y },
      update: { x: p.x, y: p.y },
    })));
  }
  return { ok: true, saved: keep.length, skipped };
}

export async function resetMapLayout(platformChatId: string): Promise<MapLayoutResetResponse> {
  const profile = await profileOf(platformChatId);
  if (!profile.ok) return NOT_READY(profile.status);
  const removed = await prisma.novaMapLayout.deleteMany({ where: { profileId: profile.profileId } });
  return { ok: true, removed: removed.count };
}
