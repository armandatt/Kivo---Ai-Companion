// Where a capture was filed, and changing it in seconds.
//
// After Capture, Kivo places the passage in the learner's own workspace
// (server: knowledge-placement.ts). This shows the answer in one quiet line:
//   high     "Filed under AI › Vector Databases · Change"
//   medium   the same, marked as Kivo's guess, so it is noticed
//   low      "Not filed · Suggested: … · File here · Choose"
// Change opens two searchable fields: the subject, then a topic inside it
// (filtered to that subject, nested topics shown with their path). Arrow keys
// move, Enter chooses, Escape closes. Only existing subjects and topics are
// offered; the server checks the choice again.

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

// ── One searchable field ──────────────────────────────────────────────────────

let fieldCount = 0
function combobox({ label, placeholder, options, onPick, initial = '' }) {
  const id = `kivo-field-${++fieldCount}`
  const input = el('input', { id, class: 'combo-input', type: 'text', placeholder, autocomplete: 'off', spellcheck: false, value: initial, role: 'combobox' })
  const list = el('ul', { class: 'combo-list', id: `${id}-list`, role: 'listbox', hidden: true })
  const more = el('p', { class: 'small combo-more', hidden: true })
  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-expanded', 'false')
  input.setAttribute('aria-autocomplete', 'list')
  let shown = [], active = -1

  function draw() {
    const f = filterOptions(options(), input.value)
    shown = f.shown
    active = shown.length ? 0 : -1
    list.replaceChildren(...shown.map((o, i) => el('li', {
      id: `${id}-o${i}`, role: 'option', class: 'combo-option', dataset: { optionId: o.id }, style: o.depth ? `padding-left: ${10 + o.depth * 12}px` : '',
      onmousedown: e => { e.preventDefault(); choose(i) },
    }, o.label)))
    if (!shown.length) list.replaceChildren(el('li', { class: 'combo-empty small' }, 'Nothing matches. Try another word.'))
    more.hidden = !f.more
    more.textContent = f.more ? `${f.more} more. Keep typing to narrow.` : ''
    mark()
    open(true)
  }
  function mark() {
    for (const [i, li] of [...list.querySelectorAll('[role=option]')].entries()) li.setAttribute('aria-selected', String(i === active))
    if (active >= 0) { input.setAttribute('aria-activedescendant', `${id}-o${active}`); list.querySelector(`#${id}-o${active}`)?.scrollIntoView({ block: 'nearest' }) }
    else input.removeAttribute('aria-activedescendant')
  }
  function open(on) { list.hidden = !on; input.setAttribute('aria-expanded', String(on)) }
  function choose(i) { const o = shown[i]; if (!o) return; input.value = o.label; open(false); onPick(o) }

  input.addEventListener('focus', draw)
  input.addEventListener('input', draw)
  input.addEventListener('blur', () => setTimeout(() => open(false), 120))
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) draw(); else { active = Math.min(shown.length - 1, active + 1); mark() } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark() }
    else if (e.key === 'Enter') { if (!list.hidden && active >= 0) { e.preventDefault(); choose(active) } }
    else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); open(false) } }
  })
  return { node: el('div', { class: 'combo' }, el('label', { class: 'label', htmlFor: id }, label), input, list, more), input }
}

// ── The picker: subject, then topic ──────────────────────────────────────────

/**
 * @param {{ places: Array<object>, current: object | null, onChoose: (choice: { subjectId: string | null, topicId: string | null }) => Promise<void>, onCancel: () => void }} opts
 */
export function picker({ places, current, onChoose, onCancel }) {
  let subjectId = current?.subjectId ?? null
  let topicId = current?.topicId ?? null
  const subjects = subjectOptions(places)
  const initialSubject = subjects.find(s => s.id === subjectId)?.label ?? ''
  const initialTopic = subjectId ? topicOptions(places, subjectId).find(t => t.id === topicId)?.label ?? '' : ''
  const save = el('button', { class: 'primary', type: 'button', disabled: !subjectId, dataset: { placeSave: '' } }, 'File here')
  const topic = combobox({ label: 'Topic (optional)', placeholder: 'Search topics in this subject', initial: initialTopic, options: () => (subjectId ? topicOptions(places, subjectId) : []), onPick: o => { topicId = o.id; save.focus() } })
  topic.input.disabled = !subjectId
  topic.input.addEventListener('input', () => { if (!topic.input.value.trim()) topicId = null })
  const subject = combobox({ label: 'Subject', placeholder: 'Search your subjects', initial: initialSubject, options: () => subjects, onPick: o => {
    if (o.id !== subjectId) { topicId = null; topic.input.value = '' }
    subjectId = o.id; save.disabled = false; topic.input.disabled = !topicOptions(places, subjectId).length; (topic.input.disabled ? save : topic.input).focus()
  } })
  const errors = el('div', { class: 'errors' })
  const run = async choice => {
    save.disabled = true
    try { await onChoose(choice) } catch (err) { errors.replaceChildren(el('p', { class: 'alert', role: 'alert' }, err?.message || "That didn't save. Try again.")); save.disabled = false }
  }
  save.addEventListener('click', () => void run({ subjectId, topicId }))
  const node = el('div', { class: 'place-picker', role: 'group', ariaLabel: 'File under', dataset: { picker: '' },
    onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } } },
    subject.node, topic.node, errors,
    el('div', { class: 'actions' }, save,
      current ? el('button', { type: 'button', dataset: { placeClear: '' }, onclick: () => void run({ subjectId: null, topicId: null }) }, 'Leave unfiled') : null,
      el('button', { class: 'link', type: 'button', onclick: onCancel }, 'Cancel')))
  setTimeout(() => subject.input.focus(), 0)
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
      line.replaceChildren(picker({ places: all, current, onChoose: choose, onCancel: draw }))
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
