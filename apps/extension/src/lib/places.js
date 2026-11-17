// Where a capture was filed, and changing it in seconds.
//
// After Capture, Kivo places the passage in the learner's own workspace
// (server: knowledge-placement.ts). This shows the answer in one quiet line:
//   high     "Filed under AI › Vector Databases · Change"
//   medium   the same, marked as Kivo's guess, so it is noticed
//   low      "Not filed · Suggested: … · File here · Choose"
// Change opens the picker the web uses too: search, or browse subject →
// topic → nested topic, with full names and Kivo's suggestion first. Arrow
// keys move, Right opens, Left goes up, Enter chooses, Escape closes. Only
// existing subjects and topics are offered; the server checks the choice again.

import { el } from './ui.js'

export const LIST_MAX = 50

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Subjects, once each, in their own path order. */
export function subjectOptions(places) {
  const seen = new Map()
  for (const p of places) if (!p.topicId && !seen.has(p.subjectId)) seen.set(p.subjectId, { id: p.subjectId, label: p.path.join(' › '), name: p.subjectName })
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** The topics of one subject, nested ones shown with their path inside it. */
export function topicOptions(places, subjectId) {
  return places.filter(p => p.subjectId === subjectId && p.topicId).map(p => {
    const inside = p.path.slice(p.path.indexOf(p.subjectName) + 1)
    return { id: p.topicId, label: (inside.length ? inside : [p.topicName]).join(' › '), name: p.topicName, depth: Math.max(0, inside.length - 1) }
  })
}

/** Every word typed must start a word of the label (or appear in it). Best matches first. */
export function filterOptions(options, query, max = LIST_MAX) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return { shown: options.slice(0, max), more: Math.max(0, options.length - max) }
  const scored = []
  for (const o of options) {
    const label = norm(o.label)
    const parts = label.split(/[^\p{L}\p{N}]+/u)
    let score = 0
    for (const w of words) {
      if (parts.some(p => p.startsWith(w))) score += 2
      else if (label.includes(w)) score += 1
      else { score = -1; break }
    }
    if (score >= 0) scored.push({ o, score: score + (norm(o.name).startsWith(words[0]) ? 1 : 0) })
  }
  scored.sort((a, b) => b.score - a.score || a.o.label.localeCompare(b.o.label))
  return { shown: scored.slice(0, max).map(x => x.o), more: Math.max(0, scored.length - max) }
}

export const placementWords = p => (p ? [p.subjectName, p.topicName].filter(Boolean).join(' › ') : '')

// ── The tree: subject → subjects and topics inside → topics inside a topic ──
// The same steps as the web's one picker (apps/web destination-picker.tsx).

const keyOf = p => (p.topicId ? `t:${p.topicId}` : `s:${p.subjectId}`)
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

/** Each place's parent, by its path: a topic's within its own subject, a subject's among subjects. */
export function placeParents(places) {
  const parents = new Map()
  for (const p of places) {
    const up = p.path.slice(0, -1)
    const parent = p.topicId
      ? places.find(q => q.subjectId === p.subjectId && q !== p && same(q.path, up)) ?? null
      : places.find(q => !q.topicId && q !== p && same(q.path, up)) ?? null
    parents.set(keyOf(p), parent ? keyOf(parent) : null)
  }
  return parents
}

/** What sits directly inside `at` (null: the top level): subjects first, then topics, by name. */
export function placeChildren(places, parents, at) {
  return places.filter(p => (parents.get(keyOf(p)) ?? null) === at)
    .sort((a, b) => (Boolean(a.topicId) === Boolean(b.topicId) ? a.path.at(-1).localeCompare(b.path.at(-1)) : a.topicId ? 1 : -1))
}

// ── The picker ─────────────────────────────────────────────────────────────────

/**
 * Search, or browse subject → topic → nested topic, then choose. Full names
 * wrap; a search result shows its whole path. Kivo's suggestion, when there
 * is one, is listed first and marked. Only existing places can be chosen
 * (a new topic is made in Kivo; the server checks every choice again).
 * @param {{ places: Array<object>, current: object | null, suggestion?: object | null, onChoose: (choice: { subjectId: string | null, topicId: string | null }) => Promise<void>, onCancel: () => void }} opts
 */
export function picker({ places, current, suggestion = null, onChoose, onCancel }) {
  const parents = placeParents(places)
  const byKey = new Map(places.map(p => [keyOf(p), p]))
  const currentKey = current ? (current.topicId ? `t:${current.topicId}` : `s:${current.subjectId}`) : null
  let at = currentKey ? parents.get(currentKey) ?? null : null
  let active = 0
  let rows = []
  const id = `kivo-picker-${Math.random().toString(36).slice(2, 8)}`
  const input = el('input', { class: 'combo-input', type: 'text', placeholder: 'Search your subjects and topics', autocomplete: 'off', spellcheck: false, role: 'combobox', ariaLabel: 'Search your subjects and topics', dataset: { placeSearch: '' } })
  input.setAttribute('aria-controls', `${id}-list`)
  input.setAttribute('aria-expanded', 'true')
  const crumbs = el('div', { class: 'place-crumbs small', dataset: { placeCrumbs: '' } })
  const list = el('ul', { class: 'combo-list place-list', id: `${id}-list`, role: 'listbox', ariaLabel: 'Where to file it' })
  const more = el('p', { class: 'small combo-more', hidden: true })
  const errors = el('div', { class: 'errors' })

  const run = async choice => {
    list.setAttribute('aria-busy', 'true')
    try { await onChoose(choice) } catch (err) { errors.replaceChildren(el('p', { class: 'alert', role: 'alert' }, err?.message || "That didn't save. Try again.")); list.removeAttribute('aria-busy') }
  }
  const choose = p => void run({ subjectId: p.subjectId, topicId: p.topicId ?? null })
  const open = key => { at = key; input.value = ''; active = 0; draw() }
  const up = () => { at = at ? parents.get(at) ?? null : null; active = 0; draw() }

  function draw() {
    const q = input.value.trim()
    more.hidden = true
    if (q) {
      const f = filterOptions(places.map(p => ({ id: keyOf(p), label: p.path.join(' › '), name: p.path.at(-1), place: p })), q)
      rows = f.shown.map(o => ({ place: o.place, full: true }))
      more.hidden = !f.more
      more.textContent = f.more ? `${f.more} more. Keep typing to narrow.` : ''
    } else {
      rows = []
      if (at === null && suggestion) { const s = byKey.get(suggestion.topicId ? `t:${suggestion.topicId}` : `s:${suggestion.subjectId}`); if (s) rows.push({ place: s, full: true, note: 'Kivo’s suggestion' }) }
      if (at !== null && byKey.get(at)) rows.push({ place: byKey.get(at), note: byKey.get(at).topicId ? 'This topic itself' : 'This subject itself' })
      for (const p of placeChildren(places, parents, at)) rows.push({ place: p })
    }
    active = Math.min(active, Math.max(0, rows.length - 1))
    // Where the list is: All subjects › Subject › Topic.
    const chain = []
    for (let k = at, seen = new Set(); k && !seen.has(k); k = parents.get(k) ?? null) { seen.add(k); chain.unshift(k) }
    crumbs.hidden = Boolean(q) || at === null
    crumbs.replaceChildren(
      el('button', { class: 'link', type: 'button', ariaLabel: 'Up one level', dataset: { placeUp: '' }, onclick: up }, '‹'),
      el('button', { class: 'link', type: 'button', onclick: () => open(null) }, 'All subjects'),
      ...chain.flatMap((k, i) => [' › ', i === chain.length - 1 ? el('strong', {}, byKey.get(k)?.path.at(-1) ?? '') : el('button', { class: 'link', type: 'button', onclick: () => open(k) }, byKey.get(k)?.path.at(-1) ?? '')]))
    list.replaceChildren(...rows.map((r, i) => {
      const p = r.place
      const kids = !q && !r.note && placeChildren(places, parents, keyOf(p)).length > 0
      const chosen = currentKey === keyOf(p)
      return el('li', { id: `${id}-o${i}`, role: 'option', class: 'combo-option place-row', ariaSelected: String(i === active), dataset: { optionId: keyOf(p), active: String(i === active) } },
        el('button', { class: 'place-pick', type: 'button', title: p.path.join(' › '), onmousedown: e => { e.preventDefault(); choose(p) } },
          r.full && p.path.length > 1 ? el('span', { class: 'place-path' }, `${p.path.slice(0, -1).join(' › ')} › `) : null,
          el('span', { class: 'place-name' }, p.path.at(-1)),
          r.note ? el('span', { class: 'place-note small' }, r.note) : null,
          chosen ? el('span', { class: 'place-chosen', ariaLabel: 'Filed here now' }, ' ✓') : null),
        kids ? el('button', { class: 'place-open', type: 'button', ariaLabel: `Show what is inside ${p.path.at(-1)}`, dataset: { placeOpen: keyOf(p) }, onmousedown: e => { e.preventDefault(); open(keyOf(p)) } }, '›') : null)
    }))
    if (!rows.length) list.replaceChildren(el('li', { class: 'combo-empty small' }, q ? 'Nothing matches. Try another word, or make the topic in Kivo first.' : 'Nothing inside yet.'))
    if (rows.length) input.setAttribute('aria-activedescendant', `${id}-o${active}`)
    list.querySelector(`#${id}-o${active}`)?.scrollIntoView({ block: 'nearest' })
  }

  input.addEventListener('input', () => { active = 0; draw() })
  input.addEventListener('keydown', e => {
    const r = rows[active]
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); draw() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw() }
    else if (e.key === 'Enter') { e.preventDefault(); if (r) choose(r.place) }
    else if (e.key === 'ArrowRight' && !input.value && r && !r.note && placeChildren(places, parents, keyOf(r.place)).length) { e.preventDefault(); open(keyOf(r.place)) }
    else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && !input.value && at) { e.preventDefault(); up() }
  })
  const node = el('div', { class: 'place-picker', role: 'group', ariaLabel: 'File under', dataset: { picker: '' },
    onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } } },
    el('label', { class: 'label', htmlFor: input.id }, 'File under'), input, crumbs, list, more, errors,
    el('div', { class: 'actions' },
      current ? el('button', { type: 'button', dataset: { placeClear: '' }, onclick: () => void run({ subjectId: null, topicId: null }) }, 'Leave unfiled') : null,
      el('button', { class: 'link', type: 'button', onclick: onCancel }, 'Cancel')))
  input.id = `${id}-q`
  draw()
  setTimeout(() => input.focus(), 0)
  return node
}

// ── The line under a capture ─────────────────────────────────────────────────

/**
 * Asks Kivo where the captured passage belongs, shows the answer, and lets
 * the learner change it. Returns the element at once ("Filing…").
 * @param {{ client: object, draftId: string, itemId: string, onUnauthenticated?: (res: object) => void }} opts
 */
export function placementLine({ client, draftId, itemId, onUnauthenticated }) {
  const line = el('div', { class: 'place-line small', role: 'status', dataset: { place: 'filing' } }, 'Filing it under the right subject…')
  let state = { placement: null, suggestion: null, placedBy: null }
  let places = null

  const loadPlaces = async () => {
    if (places) return places
    const res = await client.places()
    if (!res.ok) throw new Error(res.message)
    places = res.data.places
    return places
  }
  async function choose(choice) {
    const res = await client.choosePlace(draftId, itemId, choice.subjectId, choice.topicId)
    if (!res.ok || !res.data.success) throw new Error(res.ok ? res.data.message : res.message)
    state = res.data
    draw()
  }
  async function openPicker(current) {
    line.dataset.place = 'choosing'
    line.replaceChildren(el('span', {}, 'Loading your subjects…'))
    try {
      const all = await loadPlaces()
      if (!all.length) { line.replaceChildren(el('span', {}, 'You have no subjects yet. Add them in Kivo, then file this from Drafts.')); return }
      line.replaceChildren(picker({ places: all, current, suggestion: state.placement && state.placedBy !== 'learner' ? state.placement : state.suggestion, onChoose: choose, onCancel: draw }))
    } catch (err) {
      line.replaceChildren(el('span', { class: 'alert' }, err.message || "Your subjects didn't load."), el('button', { class: 'link', type: 'button', onclick: draw }, 'Back'))
    }
  }
  const change = (label, current) => el('button', { class: 'link', type: 'button', dataset: { placeChange: '' }, onclick: () => void openPicker(current) }, label)

  function draw() {
    const p = state.placement, s = state.suggestion
    if (p) {
      line.dataset.place = state.placedBy === 'learner' ? 'yours' : p.confidence
      line.replaceChildren(
        el('span', {}, state.placedBy === 'learner' ? 'Filed under ' : p.confidence === 'medium' ? 'Filed under (Kivo’s guess) ' : 'Filed under '),
        el('strong', { title: p.path.join(' › ') }, placementWords(p)), ' · ', change('Change', p))
      return
    }
    if (state.placedBy === 'learner') { line.dataset.place = 'unfiled'; line.replaceChildren(el('span', {}, 'Left unfiled, in your draft. '), change('File it', null)); return }
    line.dataset.place = 'low'
    line.replaceChildren(
      el('span', {}, s ? 'Not filed. Suggested: ' : 'Not filed: Kivo wasn’t sure where it belongs. '),
      s ? el('strong', { title: s.path.join(' › ') }, placementWords(s)) : null,
      s ? ' · ' : null,
      s ? el('button', { class: 'link', type: 'button', dataset: { placeAccept: '' }, onclick: () => void choose({ subjectId: s.subjectId, topicId: s.topicId }).catch(err => line.append(el('span', { class: 'alert' }, ` ${err.message}`))) }, 'File here') : null,
      s ? ' · ' : null,
      change('Choose', null))
  }

  void (async () => {
    const res = await client.place(draftId, itemId)
    if (!res.ok && res.kind === 'unauthenticated') { onUnauthenticated?.(res); return }
    if (!res.ok || !res.data.success) { line.dataset.place = 'failed'; line.replaceChildren(el('span', {}, 'Kept in your draft. Kivo couldn’t file it just now. '), change('Choose', null)); return }
    state = res.data
    draw()
  })()
  return line
}
