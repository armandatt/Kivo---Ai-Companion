// The arithmetic of a selected area. Pure.
//
// The rectangle is in CSS pixels of the viewport; the picture is of the same
// viewport in device pixels. Their ratio is measured from the picture itself,
// not taken from devicePixelRatio, so browser zoom and a high-density display
// both come out right, and the scroll position plays no part.

/**
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ w: number, h: number }} viewport
 * @param {{ width: number, height: number }} image
 * @returns {{ sx: number, sy: number, sw: number, sh: number } | null}
 */
export function cropArea(rect, viewport, image) {
  if (![rect?.x, rect?.y, rect?.w, rect?.h, viewport?.w, viewport?.h].every(n => Number.isFinite(n)) || !(viewport.w > 0) || !(viewport.h > 0)) return null
  const fx = image.width / viewport.w, fy = image.height / viewport.h
  const sx = Math.max(0, Math.round(rect.x * fx)), sy = Math.max(0, Math.round(rect.y * fy))
  const sw = Math.min(image.width - sx, Math.round(rect.w * fx)), sh = Math.min(image.height - sy, Math.round(rect.h * fy))
  return sw >= 1 && sh >= 1 ? { sx, sy, sw, sh } : null
}

// How long a captured area waits for the popup before it is let go.
export const REGION_SHOT_KEEP_MS = 10 * 60_000
export const REGION_SHOT_KEY = 'novaRegionShot'

/** The captured area for this tab, if there is a fresh one. */
export function freshShot(stored, tabId, now = Date.now()) {
  if (!stored || typeof stored.src !== 'string' || !stored.src.startsWith('data:image/')) return null
  if (stored.tabId !== tabId || !(now - stored.at < REGION_SHOT_KEEP_MS)) return null
  return stored
}
