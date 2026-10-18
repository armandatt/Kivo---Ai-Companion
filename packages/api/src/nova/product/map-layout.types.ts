// ─── Knowledge Map layout: the contract for where the learner put things ──────
// A position is only a position. It says nothing about what an item is or how
// it is connected (that is the map's read model, knowledge-map.types.ts), and
// moving a card changes no note, saved page, topic or link.
// No imports, so the web app can import the types directly.

export const MAP_LAYOUT_NODE_TYPES = ["subject", "topic", "note", "resource"] as const;
export type MapLayoutNodeType = (typeof MAP_LAYOUT_NODE_TYPES)[number];

// One save holds at most this many positions. A map draws at most 150 notes
// and 150 saved pages, so this is room for every subject and topic besides.
export const MAP_LAYOUT_MAX_POSITIONS = 1000;
// How far from the middle of the map a card may be put, either way.
export const MAP_LAYOUT_COORD_MAX = 100_000;
// The largest save body the route reads.
export const MAP_LAYOUT_BODY_MAX_BYTES = 96_000;
// A row id, as the map names it after "<type>:".
export const MAP_LAYOUT_ID_MAX = 64;

// node: the map's own node id, "<type>:<row id>" (MapNode.id).
export interface MapPosition { node: string; x: number; y: number }

export type MapLayoutStatus = "not_nova" | "not_connected" | "onboarding_incomplete";

// GET /api/nova/knowledge-map/layout
export type MapLayoutView =
  | { ok: true; positions: MapPosition[] }
  | { ok: false; error: MapLayoutStatus | "failed"; message: string };

// PUT /api/nova/knowledge-map/layout  { positions: MapPosition[] }
// saved: how many were stored. skipped: well-formed ids that are not on the
// learner's map now (an item deleted in another tab, say); nothing is stored
// for them, and the rest of the save still is.
export type MapLayoutSaveResponse =
  | { ok: true; saved: number; skipped: string[] }
  | { ok: false; error: MapLayoutStatus | "invalid" | "too_large" | "failed"; message: string };

// DELETE /api/nova/knowledge-map/layout
// Removes the learner's saved positions and nothing else.
export type MapLayoutResetResponse =
  | { ok: true; removed: number }
  | { ok: false; error: MapLayoutStatus | "failed"; message: string };
