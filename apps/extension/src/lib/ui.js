// Small DOM helpers shared by the popup and the side panel. Text is always
// set as text, never as markup.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (value !== false && value !== null && value !== undefined) node[key] = value
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child)
  return node
}

export const alertBox = message => el('p', { class: 'alert', role: 'alert', dataset: { error: '' } }, message)
export const sr = (text, props = {}) => el('label', { class: 'sr', ...props }, text)

// A button doing its work: says what it is doing, shows a small spinner (CSS)
// and is announced as busy. `idle` puts its own words back.
export function busy(button, text) { button.dataset.label = button.textContent; button.textContent = text; button.setAttribute('aria-busy', 'true') }
export function idle(button) { if (button.dataset.label) button.textContent = button.dataset.label; delete button.dataset.label; button.removeAttribute('aria-busy') }

// The site's own name, not a subdomain's: en.wikipedia.org is W, docs.python.org
// is P, and bbc.co.uk is B (a short second level before a country code is skipped).
export function siteInitial(domain) {
  const parts = String(domain || '?').split('.')
  let at = Math.max(0, parts.length - 2)
  if (at > 0 && parts[parts.length - 1].length === 2 && parts[at].length <= 3) at--
  return parts[at].charAt(0)
}

// ── Screenshots ───────────────────────────────────────────────────────────────
// Taken only when the learner presses Screenshot, shown before anything is
// sent, and sent only with a question. They can drag across it to send only
// the part they mean (a diagram). It leaves as a JPEG no larger than
// SHOT_MAX_SIDE on its long side, and is kept nowhere: not here, not in Nova.

export const SHOT_MAX_SIDE   = 1600
export const SHOT_MAX_BASE64 = 1_400_000   // the server takes up to 1,500,000

export async function loadPicture(src) {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

// The picture, or the part of it the learner marked (as fractions of its
// size), as plain base64, or null if it cannot be made small enough.
export function encodeShot(img, mark) {
  const area = mark ?? { x: 0, y: 0, w: 1, h: 1 }
  const sx = Math.round(area.x * img.naturalWidth), sy = Math.round(area.y * img.naturalHeight)
  const sw = Math.max(1, Math.round(area.w * img.naturalWidth)), sh = Math.max(1, Math.round(area.h * img.naturalHeight))
  const scale  = Math.min(1, SHOT_MAX_SIDE / Math.max(sw, sh))
  const canvas = el('canvas', { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) })
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.85, 0.7, 0.55]) {
    const url  = canvas.toDataURL('image/jpeg', quality)
    const data = url.slice(url.indexOf(',') + 1)
    if (data.length <= SHOT_MAX_BASE64) return data
  }
  return null
}

export const clamp = n => Math.min(1, Math.max(0, n))
export const markBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
export function placeMark(node, mark) {
  node.hidden = !mark
  if (mark) Object.assign(node.style, { left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.w * 100}%`, height: `${mark.h * 100}%` })
}
