// How a task of Nova's browser agent looks inside the side panel's
// conversation (sidepanel.js): one turn, while it runs and once it is done.
//
// While it runs: what Nova is doing now, its plan (done, current, still to
// do), Pause or Resume, Stop, and the card for whatever waits for the learner
// (a question, an OK for an action with consequences, a site to allow,
// something only they may do on the page). What it has done is folded under
// "What Nova did". Nothing technical: no indexes, no tool names.
//
// When it is done: Nova's answer (Markdown), whether the task was done,
// partly done or could not be done, what was completed and what is left,
// the sources it read, findings by source (quotes checked against the page,
// Nova's reading kept apart), and Save to Drafts, which captures each
// finding the way a selected passage is captured (Kivo files each one).
//
// The panel never acts on the page itself: every button sends a message to
// the background worker (lib/agent-runtime.js). Allowing a site is asked of
// the browser here, from the learner's click, as the browser requires.

import { STATUS, actionWords, statusOf } from './agent.js'
import { ANY_SITE } from './agent-tools.js'
import { placementLine } from './places.js'
import { alertBox, busy, el, idle } from './ui.js'
import { browser } from './browser.js'

export const send = async (type, payload = {}) => (await browser.agentSend(type, payload)) ?? { ok: false, message: 'Nova’s background work is not answering. Close the panel and open it again.' }

const STATUS_WORDS = { planning: 'Starting', running: 'Working', paused: 'Paused', awaiting_user: 'Waiting for you', awaiting_permission: 'Waiting for you', completed: 'Done', cancelled: 'Stopped', failed: 'Could not finish' }
const RESULT_WORDS = { done: 'Done', partial: 'Partly done', blocked: 'Could not be done' }

/** The numbers [n] an answer cites. */
export function citedIn(answer) {
  const out = new Set()
  const text = String(answer ?? '')
  for (let i = text.indexOf('['); i >= 0; i = text.indexOf('[', i + 1)) {
    const end = text.indexOf(']', i)
    if (end < 0) break
    for (const part of text.slice(i + 1, end).split(',')) { const n = Number(part.trim()); if (Number.isInteger(n) && n > 0 && n < 100) out.add(n) }
  }
  return out
}

/** A finished task, kept in the conversation (bounded). */
export function taskSummary(state) {
  const status = statusOf(state.status)
  const cited = citedIn(state.result?.answer)
  return {
    id: state.id, status, error: state.error ?? null,
    result: state.result ? { status: state.result.status ?? 'done', completed: state.result.completed ?? [], remaining: state.result.remaining ?? [], concepts: state.result.concepts ?? [], gaps: state.result.gaps ?? [] } : null,
    steps: state.steps.slice(-30).map(s => ({ words: actionWords(s.action), ok: s.ok, result: s.ok ? '' : s.result })),
    stepCount: state.steps.length,
    // Sources are the pages the answer cites; the others were only read.
    sources: state.sources.filter(s => cited.has(s.n)).slice(0, 20),
    pagesRead: state.sources.length,
    findings: state.findings.slice(0, 40).map(f => ({ n: f.n, key: f.key, source: f.source, concept: f.concept, quote: f.quote, note: f.note })),
    saved: state.saved.slice(0, 20),
    ownTabs: (state.browser?.tabs ?? []).filter(([, t]) => t.own).map(([id]) => id),
    closedTabs: state.closedTabs ?? 0,
    objective: state.objective, answer: state.result?.answer ?? null,
  }
}

/** The answer a finished task gives the conversation. */
export function answerOf(state) {
  if (state.result?.answer) return state.result.answer
  const status = statusOf(state.status)
  if (status === STATUS.CANCELLED) return state.steps.length ? 'You stopped this task. What Nova did before that is under Details.' : 'You stopped this task before Nova did anything.'
  return state.error || 'Nova stopped before it could finish.'
}

function planList(plan) {
  if (!plan?.length) return null
  const firstOpen = plan.findIndex(p => !p.done)
  return el('ol', { class: 'plan', ariaLabel: 'Nova’s plan' },
    plan.map((p, i) => el('li', { dataset: { done: String(p.done), now: String(i === firstOpen) } }, p.step)))
}

// What Nova did, folded: the count is shown only inside, when it is opened.
function stepsList(steps, open = false) {
  if (!steps?.length) return null
  return el('details', { class: 'did', open, dataset: { details: '' } },
    el('summary', { class: 'small' }, 'Details'),
    el('p', { class: 'small did-count' }, `${steps.length} step${steps.length === 1 ? '' : 's'}`),
    el('ol', { class: 'steps' }, steps.map(s => el('li', { dataset: { ok: String(s.ok) } }, el('span', {}, `${s.words}${s.ok || !s.result ? '' : `: ${s.result}`}`)))))
}

// A research task's searches: the words, and the sources they found (not the results page itself).
function searching(state) {
  const last = state.searches?.at(-1)
  if (!last) return null
  return el('div', { class: 'searching', dataset: { searching: '' } },
    el('p', { class: 'small' }, `Searched for “${last.query}”`),
    last.results?.length ? el('ul', { class: 'found-sources' }, last.results.slice(0, 5).map(r => el('li', { title: r.url }, el('span', { class: 'src-title' }, r.title || r.url), el('span', { class: 'src-site small' }, (() => { try { return new URL(r.url).hostname.replace(/^www\./, '') } catch { return '' } })())))) : null)
}

function pendingCard(state) {
  const p = state.pending
  if (!p) return null
  const task = state.id
  if (p.kind === 'question') {
    const answer = el('input', { class: 'combo-input', placeholder: 'Your answer', ariaLabel: 'Your answer to Nova' })
    const go = text => { if (text.trim()) void send('agent:answer', { task, id: p.id, text: text.trim() }) }
    const sendButton = el('button', { class: 'primary', type: 'button', onclick: () => go(answer.value) }, 'Send')
    answer.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(answer.value) } })
    setTimeout(() => answer.focus(), 0)
    return el('div', { class: 'card', dataset: { pending: 'question' } },
      el('strong', {}, 'Nova asks'), el('p', {}, p.question),
      p.choices?.length ? el('div', { class: 'choices' }, p.choices.map(c => el('button', { type: 'button', class: 'choice', onclick: () => go(c) }, c))) : null,
      el('div', { class: 'answer-row' }, answer, sendButton))
  }
  if (p.kind === 'confirm') {
    return el('div', { class: 'card', dataset: { pending: 'confirm' } },
      el('strong', {}, 'Allow this?'),
      el('p', {}, `${actionWords(p.action)}${p.site ? ` on ${p.site}` : ''}.`),
      el('p', { class: 'small' }, p.reason),
      el('div', { class: 'card-actions' },
        el('button', { class: 'primary', type: 'button', dataset: { confirmYes: '' }, onclick: () => void send('agent:confirm', { task, id: p.id, allowed: true }) }, 'Allow once'),
        el('button', { type: 'button', dataset: { confirmNo: '' }, onclick: () => void send('agent:confirm', { task, id: p.id, allowed: false }) }, 'Don’t allow')))
  }
  if (p.kind === 'access') {
    const note = el('p', { class: 'small card-note', role: 'status' })
    const ask = (origins, { anySite = false, remember = false } = {}) => {
      // Straight from the click, as the browser requires: Chrome asks the user itself.
      void browser.allowSites(origins).then(granted => {
        if (!granted) note.textContent = 'Chrome didn’t allow it. Nova will carry on without this site.'
        return send('agent:access', { task, id: p.id, granted, pattern: p.pattern, anySite: granted && anySite, remember: granted && remember })
      })
    }
    return el('div', { class: 'card access-card', dataset: { pending: 'access' } },
      el('strong', {}, `Allow Nova on ${p.site}?`),
      el('p', {}, `To continue, Nova needs to read and use ${p.site}. Chrome will ask you to confirm.`),
      el('div', { class: 'card-actions' },
        el('button', { class: 'primary', type: 'button', dataset: { accessSite: '' }, title: `Nova can use ${p.site} until you remove it in Sites Nova can use`, onclick: () => ask([p.pattern], { remember: true }) }, `Allow ${p.site}`),
        el('button', { type: 'button', dataset: { accessAny: '' }, title: 'For research across many sites. Removed when this task ends.', onclick: () => ask(ANY_SITE, { anySite: true }) }, 'Any site, this task'),
        el('button', { class: 'quiet', type: 'button', dataset: { accessNo: '' }, onclick: () => void send('agent:access', { task, id: p.id, granted: false }) }, 'Don’t allow')),
      el('p', { class: 'small card-note' }, 'An allowed site stays allowed until you remove it in the Nova popup, under Sites.'),
      note)
  }
  if (p.kind === 'needs_you') {
    return el('div', { class: 'card', dataset: { pending: 'needs_you' } },
      el('strong', {}, 'Over to you'), el('p', {}, p.message),
      el('div', { class: 'card-actions' },
        el('button', { class: 'primary', type: 'button', dataset: { needsYouDone: '' }, onclick: () => void send('agent:answer', { task, id: p.id, text: 'done' }) }, 'Done, carry on'),
        typeof p.tab === 'number' ? el('button', { type: 'button', dataset: { showTab: '' }, onclick: () => void send('agent:show', { tab: p.tab }) }, 'Show the tab') : null))
  }
  return null
}

/** A task while it runs (or waits). */
export function liveTask(state) {
  const status = statusOf(state.status)
  const task = state.id
  const pause = el('button', { type: 'button', dataset: { agentPause: '' }, onclick: () => { pause.disabled = true; pause.textContent = 'Pausing…'; void send('agent:pause', { task }) } }, 'Pause')
  const resume = el('button', { class: 'primary', type: 'button', dataset: { agentResume: '' }, onclick: () => { resume.disabled = true; void send('agent:resume', { task }) } }, 'Resume')
  const stop = el('button', { type: 'button', dataset: { agentStop: '' }, onclick: () => { stop.disabled = true; void send('agent:stop', { task }) } }, 'Stop')
  const where = state.where ? ` · ${state.where}` : ''
  return el('div', { class: 'task', dataset: { task: state.id, status } },
    el('div', { class: 'now', role: 'status', ariaLive: 'polite', dataset: { status } },
      el('span', { class: 'now-text' }, status === STATUS.PAUSED && state.error ? state.error : state.current),
      el('span', { class: 'now-meta small' }, `${STATUS_WORDS[status] ?? ''}${where}`)),
    pendingCard(state),
    state.mode === 'research' ? searching(state) : null,
    planList(state.plan),
    el('div', { class: 'run-controls' }, status === STATUS.RUNNING ? pause : status === STATUS.PAUSED ? resume : null, stop),
    stepsList(state.steps.slice(-30).map(s => ({ words: actionWords(s.action), ok: s.ok, result: s.ok ? '' : s.result }))))
}

/** What a finished task adds under its answer. */
export function taskExtras(task, { client, openNova, onSaved = () => {} }) {
  if (!task) return null
  const r = task.result
  const bySource = task.sources.map(src => ({ src, items: task.findings.filter(f => f.source === src.n) })).filter(g => g.items.length)
  const errors = el('div', { class: 'errors' })
  const slot = el('div', { class: 'saved-lines' })
  const save = bySource.length ? el('button', { class: 'primary', type: 'button', dataset: { saveFindings: '' } }, `Save ${task.findings.length} finding${task.findings.length === 1 ? '' : 's'} to Drafts`) : null
  save?.addEventListener('click', () => void saveFindings(task, save, slot, errors, client, openNova).then(ok => { if (ok) onSaved() }))
  const st = statusOf(task.status)
  const status = st === STATUS.COMPLETED ? RESULT_WORDS[r?.status ?? 'done'] : STATUS_WORDS[st]
  return el('div', { class: 'task-done', dataset: { taskDone: task.id, result: r?.status ?? task.status } },
    el('p', { class: 'task-status small' }, el('span', { class: 'dot', ariaHidden: 'true' }), `${status}${task.sources.length ? ` · ${task.sources.length} source${task.sources.length === 1 ? '' : 's'} cited` : ''}${task.closedTabs ? ` · closed ${task.closedTabs} tab${task.closedTabs === 1 ? '' : 's'} Nova opened` : ''}`),
    // What was done and what is left, for a task (a plain question needs no checklist).
    r?.remaining?.length || (r?.completed?.length && task.stepCount > 2 && r.status !== 'done') ? el('div', { class: 'outcome' },
      r.completed.length ? el('div', {}, el('p', { class: 'label' }, 'Done'), el('ul', { class: 'kivo-has' }, r.completed.map(c => el('li', {}, c)))) : null,
      r.remaining.length ? el('div', {}, el('p', { class: 'label' }, 'Not done'), el('ul', { class: 'kivo-has' }, r.remaining.map(c => el('li', {}, c)))) : null) : null,
    r?.concepts?.length ? el('div', { class: 'chips', ariaLabel: 'Key concepts' }, r.concepts.map(c => el('span', {}, c))) : null,
    r?.gaps?.length ? el('div', {}, el('p', { class: 'label' }, 'Missing from your Kivo'), el('ul', { class: 'kivo-has' }, r.gaps.map(g => el('li', {}, g)))) : null,
    task.sources.length ? el('ol', { class: 'sources', ariaLabel: 'Sources' }, task.sources.map(src => el('li', {}, el('span', { class: 'n' }, `[${src.n}]`), el('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.title)))) : null,
    bySource.length ? el('details', { class: 'findings' },
      el('summary', { class: 'small' }, `Findings (${task.findings.length}), by source`),
      bySource.map(g => el('div', { class: 'group' },
        el('div', { class: 'group-head' }, el('span', { class: 'n' }, `[${g.src.n}]`), el('a', { href: g.src.url, target: '_blank', rel: 'noopener', title: g.src.url }, g.src.title)),
        g.items.map(f => el('div', { class: 'finding', dataset: { finding: String(f.n) } },
          el('span', { class: 'small' }, f.concept),
          el('blockquote', { class: 'quote' }, f.quote),
          f.note ? el('p', { class: 'reading' }, el('b', {}, 'Nova’s reading: '), f.note) : null))))) : null,
    task.saved.length ? el('div', { class: 'saved-lines' }, el('p', { class: 'label' }, 'Saved to your Drafts'),
      task.saved.map(s => el('div', { class: 'finding' }, el('span', { class: 'small' }, s.title), s.draftId && s.itemId ? placementLine({ client, draftId: s.draftId, itemId: s.itemId }) : null)),
      el('button', { class: 'link ext', type: 'button', onclick: () => openNova(`/notes/drafts${task.saved[0]?.draftId ? `?d=${encodeURIComponent(task.saved[0].draftId)}` : ''}`) }, 'Review in Kivo')) : null,
    errors, save, slot,
    stepsList(task.steps),
    task.ownTabs.length ? el('div', { class: 'run-controls' },
      el('button', { class: 'link', type: 'button', dataset: { closeTabs: '' }, onclick: async e => { await browser.closeTabs(task.ownTabs); task.ownTabs = []; e.target.remove() } }, `Close the ${task.ownTabs.length} tab${task.ownTabs.length === 1 ? '' : 's'} Nova left open`)) : null)
}

// Each finding is captured the way a selected passage is (one draft for the
// task, the answer first), then filed by Kivo: the same path and service.
async function saveFindings(task, button, slot, errors, client, openNova) {
  if (button.getAttribute('aria-busy')) return false
  busy(button, 'Saving…'); button.disabled = true; errors.replaceChildren()
  const lines = []
  let draftId = null
  const items = []
  if (task.answer) items.push({ key: `${task.id}-summary`, url: null, title: `Nova: ${task.objective}`.slice(0, 300), text: '', note: `${task.answer}${task.sources.length ? `\n\nSources:\n${task.sources.map(s => `[${s.n}] ${s.title}: ${s.url}`).join('\n')}` : ''}`.slice(0, 4000), label: 'Answer' })
  for (const f of task.findings) {
    const src = task.sources.find(s => s.n === f.source)
    items.push({ key: f.key, url: src?.url ?? null, title: src?.title ?? '', text: f.quote, context: f.concept, note: f.note ? `Nova’s reading: ${f.note}` : '', label: f.concept })
  }
  for (const [i, item] of items.entries()) {
    const { label, ...capture } = item
    const res = await client.capture({ ...capture, ...(i === 0 ? { newDraft: true } : {}) })
    if (!res.ok || !res.data.success) { errors.replaceChildren(alertBox(res.ok ? res.data.message : res.message)); break }
    draftId = res.data.draft.id
    lines.push(el('div', { class: 'finding' }, el('span', { class: 'small' }, label), placementLine({ client, draftId, itemId: res.data.itemId })))
  }
  idle(button)
  if (!draftId) { button.disabled = false; return false }
  button.textContent = 'Saved to Drafts'
  slot.replaceChildren(
    el('p', { class: 'toast', role: 'status' }, `Saved ${lines.length} item${lines.length === 1 ? '' : 's'} to one draft. Kivo is filing each under your subjects; change any below.`),
    ...lines,
    el('button', { class: 'link ext', type: 'button', onclick: () => openNova(`/notes/drafts?d=${encodeURIComponent(draftId)}`) }, 'Review the draft in Kivo'))
  return true
}
