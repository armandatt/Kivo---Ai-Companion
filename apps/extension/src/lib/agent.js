// Nova's browser agent: the loop, run by the extension's background worker
// (background.js) for a task the user gives the side panel ("Do it for me").
// A plain question about the page never comes here: the panel answers it
// directly from the page (intent routing, lib/intent.js).
//
//   PLAN → OBSERVE → DECIDE → ACT → VERIFY → CONTINUE OR FINISH → CLEAN UP
//
//   plan      the objective, its scope ("first 3", "short", "pointwise"),
//             the conversation so far and what the user's Kivo workspace
//             holds for it (server …/agent/start, which counts the task once).
//   observe   the page the task is on, as elements and text (agent-page.js),
//             with which parts of it have been read.
//   decide    one model call per step chooses one tool and keeps a plan
//             (server …/agent/step).
//   act       agent-tools.js does it, checking first (allowed? needs the
//             user's OK? never?) and verifying after.
//   continue  until the outcome is reached, a limit is hit, or the user is
//             needed (an answer, an OK, a site to allow, something only they
//             may do), pauses or cancels.
//
// The task's status is a state machine (TRANSITIONS): one status at a time,
// and only the moves listed are possible, so a cancelled or completed task
// can never start acting again and a declined approval is never carried out.
//
// Repetition is judged by progress, not by the tool's name: the same action
// on the same element of the same, unchanged page that made no difference
// before is refused; opening five different emails is five different actions.
// Two refusals in a row and Nova asks the user instead of failing.
//
// The state is saved after every step (chrome.storage.session), so the panel
// can close and open and the worker can restart. An action is marked in
// flight before it runs, so a restart never replays it blindly.

export const DEFAULT_LIMITS = { steps: 30, minutes: 12, modelCalls: 36 }
export const STATE_KEY = 'kivo.agent'
const RESULT_CHARS = 300
const PRIVATE_KEPT = 40_000

/**
 * @typedef {'planning'|'running'|'awaiting_permission'|'awaiting_user'|'paused'|'completed'|'failed'|'cancelled'} Status
 */
export const STATUS = Object.freeze({
  PLANNING: 'planning', RUNNING: 'running', AWAITING_PERMISSION: 'awaiting_permission', AWAITING_USER: 'awaiting_user',
  PAUSED: 'paused', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled',
})
export const FINISHED = [STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED]
export const WAITING = [STATUS.AWAITING_PERMISSION, STATUS.AWAITING_USER]
// Every move a task may make. Finished is final.
export const TRANSITIONS = Object.freeze({
  planning:            ['running', 'failed', 'cancelled'],
  running:             ['awaiting_permission', 'awaiting_user', 'paused', 'completed', 'failed', 'cancelled'],
  awaiting_permission: ['running', 'awaiting_user', 'paused', 'failed', 'cancelled'],
  awaiting_user:       ['running', 'awaiting_permission', 'paused', 'completed', 'failed', 'cancelled'],
  paused:              ['running', 'failed', 'cancelled'],
  completed: [], failed: [], cancelled: [],
})
export const canMove = (from, to) => from === to || (TRANSITIONS[from] ?? []).includes(to)

// Earlier states (version 2) used other words; a saved task reads the same.
const OLD_STATUS = { asking: 'awaiting_user', confirming: 'awaiting_user', access: 'awaiting_permission', done: 'completed', stopped: 'cancelled' }
export const statusOf = s => OLD_STATUS[s] ?? s

/** What the user asked for, read for its scope: how many, how long, what shape. */
export const NO_SCOPE = Object.freeze({ limit: null, short: false, format: null })

export function newState({ objective, history = [], start, startTab = null, windowId, limits = DEFAULT_LIMITS, now = Date.now(), mode = 'page', scope = NO_SCOPE }) {
  return {
    v: 3, id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, objective, history,
    ticket: start?.ticket ?? null, workspace: start?.summary ?? '', context: start ? { notes: start.notes ?? [], places: start.places ?? [] } : null,
    mode: mode === 'research' ? 'research' : 'page', scope: { ...NO_SCOPE, ...(scope ?? {}) },
    startTab, windowId, limits, startedAt: now, status: STATUS.RUNNING,
    plan: [], steps: [], seen: [], sources: [], findings: [], saved: [], data: null, privateTexts: [],
    pending: null, result: null, error: null, refusals: 0, current: 'Reading the page', finalAsked: false, rewriteAsked: false,
    granted: [], anySite: false, denied: [], browser: null, inflight: null, attempts: [], searches: [],
    metrics: { modelCalls: 0, inputTokens: 0, outputTokens: 0, actions: 0, failedActions: 0, refusals: 0, recoveries: 0, tabsOpened: 0, endedAt: null },
    modelCalls: 0,
  }
}

const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'a page' } }
const describe = a => {
  switch (a.tool) {
    case 'search': return `Searching for “${a.args.query}”`
    case 'open': return `Opening ${host(a.args.url)}`
    case 'back': return 'Going back'
    case 'forward': return 'Going forward'
    case 'read': return a.args.part > 1 ? `Reading part ${a.args.part}` : 'Reading the page'
    case 'find': return `Looking for “${a.args.query}” on the page`
    case 'scroll': return 'Scrolling for more'
    case 'wait': return a.args.text ? `Waiting for “${a.args.text}”` : 'Waiting for the page'
    case 'click': return 'Clicking'
    case 'fill': return `Typing “${String(a.args.text).slice(0, 40)}${String(a.args.text).length > 40 ? '…' : ''}”`
    case 'select': return `Choosing “${a.args.option}”`
    case 'check': return a.args.checked ? 'Selecting an option' : 'Clearing an option'
    case 'press': return `Pressing ${a.args.key}`
    case 'switch_tab': return 'Switching tabs'
    case 'close_tab': return 'Closing a tab'
    case 'extract': return `Keeping a finding: ${a.args.concept}`
    case 'workspace_search': return `Searching your Kivo for “${a.args.query}”`
    case 'read_note': return 'Reading one of your notes'
    case 'workspace_related': return 'Following connections in your Kivo'
    case 'save_to_drafts': return `Saving “${a.args.title}” to your Drafts`
    case 'ask_user': return 'Asking you'
    case 'hand_over': return 'Waiting for you'
    case 'finish': return 'Writing it up'
    case 'observe': return 'Looking at the page again'
    case 'map': return { select: 'Selecting a card on your map', open: 'Opening a card on your map', related: 'Showing what is connected', parent: 'Going to the parent card', follow: 'Following a connection', zoom: 'Zooming the map', pan: 'Moving the map', whole: 'Showing the whole map', connect: 'Connecting two cards', describe: 'Reading your map' }[a.args.op] ?? 'Working on your map'
    default: return a.tool
  }
}
export const actionWords = describe
const argsOf = a => JSON.stringify(a.args).slice(0, 300)
const READING = new Set(['read', 'find', 'scroll', 'wait', 'observe', 'workspace_search', 'workspace_related', 'read_note'])
const ACTING = new Set(['click', 'fill', 'select', 'check', 'press', 'map'])

/**
 * What an action is aimed at, so "the same action" means the same thing on
 * the same element, not the same tool: an element by its role, name and
 * group as the page showed it (its number alone can be reused), a page by
 * its address, a search by its words.
 */
export function targetOf(action, observation) {
  const a = action.args ?? {}
  if ('index' in a && a.index !== null && a.index !== undefined) {
    const all = [...(observation?.elements ?? []), ...(observation?.links ?? []), ...(observation?.found?.elements ?? [])]
    const e = all.find(x => x.i === a.index)
    const who = e ? `${e.role ?? 'link'}|${e.name ?? e.text ?? ''}|${e.group ?? ''}|${e.href ?? ''}` : `#${a.index}`
    const what = action.tool === 'fill' ? `|${String(a.text).slice(0, 80)}` : action.tool === 'select' ? `|${a.option}` : action.tool === 'check' ? `|${a.checked}` : action.tool === 'press' ? `|${a.key}` : ''
    return `${action.tool}:${who}${what}`
  }
  if (action.tool === 'open') return `open:${String(a.url).split('#')[0]}`
  if (action.tool === 'search' || action.tool === 'workspace_search' || action.tool === 'find') return `${action.tool}:${String(a.query ?? '').toLowerCase().trim()}`
  return `${action.tool}:${argsOf(action)}`
}
/** The page as it stood: its address and how it looked (the fingerprint). */
export const pageKey = observation => (observation ? `${String(observation.url ?? '').split('#')[0]}|${observation.print ?? ''}|${observation.part ?? 1}` : 'none')

/**
 * Whether doing `action` now would repeat an attempt that made no progress:
 * the same target, on the same unchanged page, which failed or changed
 * nothing. A legitimate repeat (the next email, Next on the next quiz page,
 * a field typed again after an error appeared) is a different target or a
 * different page, and is allowed.
 */
export function isNoProgressRepeat(attempts, action, observation) {
  const key = targetOf(action, observation)
  const at = pageKey(observation)
  return attempts.some(t => t.key === key && t.page === at && (!t.ok || !t.changed))
}

/** Words in a Markdown answer, for the "short" scope. */
export const wordCount = text => String(text ?? '').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
export const SHORT_WORDS = 130
const bulletLines = text => String(text ?? '').split('\n').filter(l => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length

/**
 * Whether a finished answer keeps to the scope the user set; the reason
 * when it does not (the model is asked once to finish again).
 */
export function scopeProblem(scope, answer) {
  if (!scope) return null
  const words = wordCount(answer)
  if (scope.short && words > SHORT_WORDS) return `The user asked for a short answer; yours is ${words} words. Finish again in at most ${Math.min(SHORT_WORDS, 100)} words, keeping only what answers them.`
  if (scope.format === 'points' && bulletLines(answer) < 2) return 'The user asked for points: finish again with the answer as a short bulleted list.'
  if (scope.limit && scope.format === 'points' && bulletLines(answer) > scope.limit + 1) return `The user asked for ${scope.limit}: finish again with exactly ${scope.limit} points.`
  return null
}

/** What one step sends the server: bounded, no page but the current one. */
export function stepInput(state, tools, observation, watching = null) {
  const left = state.limits.steps - state.steps.length
  const cov = observation?.url ? tools.coverage?.(observation.url) : null
  return {
    ticket: state.ticket,
    objective: state.objective, history: state.history ?? [], workspace: state.workspace, data: state.data, plan: state.plan,
    mode: state.mode, scope: state.scope,
    stepsLeft: Math.max(0, left),
    steps: state.steps.slice(-14).map(s => ({ tool: s.action.tool, args: argsOf(s.action), ok: s.ok, result: s.result })),
    observation: observation ? { ...observation, partsRead: cov?.read ?? observation.partsRead ?? [observation.part ?? 1], searched: cov?.searched ?? [] } : null,
    tabs: tools.tabList().slice(0, 10), watching,
    // Pages read before this one: the start of each, so a comparison has them.
    seen: (state.seen ?? []).filter(p => p.url !== observation?.url).slice(-6),
    sources: state.sources.map(s => ({ n: s.n, url: s.url, title: s.title })),
    findings: state.findings.slice(-40).map(f => ({ n: f.n, source: f.source, concept: f.concept, quote: f.quote.slice(0, 200) })),
    saved: state.saved.length,
    denied: (state.denied ?? []).slice(0, 10),
  }
}

/**
 * @param {{
 *   state: object, tools: object, client: object,
 *   save?: (state: object) => Promise<void>, onUpdate?: (state: object) => void,
 *   watching?: () => Promise<{ tab: number, title: string, site: string } | null>,
 *   now?: () => number,
 * }} deps
 */
export function createAgent({ state, tools, client, save = async () => {}, onUpdate = () => {}, watching = async () => null, now = () => Date.now() }) {
  state.status = statusOf(state.status)
  state.metrics ??= { modelCalls: state.modelCalls ?? 0, inputTokens: 0, outputTokens: 0, actions: 0, failedActions: 0, refusals: 0, recoveries: 0, tabsOpened: 0, endedAt: null }
  state.attempts ??= []
  state.denied ??= []
  state.searches ??= []
  state.scope ??= { ...NO_SCOPE }
  state.mode ??= 'page'
  let observation = null
  let stopping = false
  let pausing = false
  let running = false

  const update = async patch => {
    if (patch.status && !canMove(state.status, patch.status)) {
      console.warn('[kivo agent] refused move', state.status, '→', patch.status)
      const { status: _ignored, ...rest } = patch
      patch = rest
    }
    const url = tools.page?.()?.url
    Object.assign(state, patch, { browser: tools.snapshot?.() ?? null, ...(url ? { where: host(url) } : {}) })
    if (FINISHED.includes(state.status) && !state.metrics.endedAt) state.metrics.endedAt = now()
    onUpdate(state)
    await save(state)
  }
  const live = () => !stopping && !FINISHED.includes(state.status)

  function addSource(src) {
    const found = state.sources.find(s => s.url === src.url)
    if (found) return found.n
    const n = state.sources.length + 1
    state.sources.push({ n, url: src.url, title: src.title || src.url })
    return n
  }
  // A page actually read is a source the answer may cite; a results page is not.
  const remember = o => {
    if (o.kind !== 'page' || !o.url) return
    addSource({ url: String(o.url).split('#')[0], title: o.title })
    state.seen = (state.seen ?? []).filter(p => p.url !== o.url)
    state.seen.push({ url: o.url, title: o.title, text: String(o.text ?? '').slice(0, 1200) })
    if (state.seen.length > 8) state.seen.shift()
  }
  const keepPrivate = text => {
    state.privateTexts.push(String(text))
    while (state.privateTexts.join('').length > PRIVATE_KEPT) state.privateTexts.shift()
  }

  async function workspace(op, args) {
    const res = await client.agentWorkspace({ ticket: state.ticket, op, ...(op === 'search' ? { query: args.query } : { id: args.id }) })
    if (!res.ok || !res.data?.success) return { ok: false, result: res.ok ? res.data?.message ?? 'Kivo could not read that.' : res.message }
    state.data = { kind: res.data.kind, text: res.data.text }
    keepPrivate(res.data.text)
    return { ok: true, result: op === 'note' ? 'Read the note (shown under NOTE READ).' : `Found ${res.data.found} things in the user's Kivo (shown under WORKSPACE SEARCH RESULT).` }
  }

  async function saveToDrafts(args) {
    const page = tools.page()
    // The same content gives the same key: a save repeated after a restart is stored once (server: same key).
    let h = 0
    for (const ch of `${args.title}\n${args.text}`) h = (h * 31 + ch.codePointAt(0)) >>> 0
    const key = `${state.id}-s${h.toString(36)}`
    if (state.saved.some(x => x.key === key)) return { ok: true, result: `"${args.title}" is already saved in this task.` }
    const res = await client.capture({ key, url: page?.kind === 'page' ? page.url : null, title: args.title, text: args.text, note: args.note || '', ...(state.saved.length === 0 && !state.findings.length ? { newDraft: true } : {}) })
    if (!res.ok || !res.data?.success) return { ok: false, result: res.ok ? res.data?.message ?? 'That did not save.' : res.message }
    state.saved.push({ key, title: args.title, draftId: res.data.draft?.id ?? null, itemId: res.data.itemId ?? null })
    return { ok: true, result: `Saved "${args.title}" to the user's Drafts (Kivo files it under their subject and topic).` }
  }

  // Code's own limits on what the model proposes, before anything runs.
  function gate(action) {
    // A task on the user's page: that page first. The web is searched only
    // once the page has been read through, or searched for the words, and
    // did not have it (or when the user named other sites: research).
    if (action.tool === 'search' && state.mode === 'page') {
      const page = tools.page()
      const cov = page?.kind === 'page' ? tools.coverage?.(page.url) : null
      const readAll = cov && cov.read.length >= cov.parts
      const looked = cov?.searched?.length > 0
      if (page?.kind === 'page' && !readAll && !looked) return `This task is about the page the user is on. Read the rest of it (parts ${cov ? Array.from({ length: cov.parts }, (_, i) => i + 1).filter(p => !cov.read.includes(p)).join(', ') : '2+'}) or use find for the words before searching the web.`
    }
    if (action.tool === 'open' && state.denied.some(p => sameSite(p, action.args.url))) return `The user did not allow ${host(action.args.url)} for this task. Do without it, or finish and say what is left.`
    return null
  }

  async function execute(action, { confirmed = false } = {}) {
    if (action.tool === 'extract') {
      const v = tools.verifyQuote(action.args.quote)
      if (!v.ok) return { ok: false, result: v.result }
      const source = addSource(v.source)
      if (state.findings.some(f => f.source === source && f.quote === action.args.quote)) return { ok: false, result: 'That finding is already kept.' }
      state.findings.push({ n: state.findings.length + 1, key: `${state.id}-f${state.findings.length + 1}`, source, quote: action.args.quote, note: action.args.note, concept: action.args.concept })
      return { ok: true, result: `Kept finding #${state.findings.length} from source [${source}].` }
    }
    if (action.tool === 'workspace_search') return workspace('search', action.args)
    if (action.tool === 'read_note') return workspace('note', action.args)
    if (action.tool === 'workspace_related') return workspace('related', action.args)
    if (action.tool === 'save_to_drafts') return saveToDrafts(action.args)
    if (!confirmed) {
      const why = await tools.check(action)
      if (why === 'never') return { ok: false, result: 'Kivo never types into password, payment or one-time-code fields: hand_over to the user.' }
      if (why) return { confirm: why }
    }
    const tabsBefore = tools.ownTabs?.().length ?? 0
    const out = await (async () => {
      switch (action.tool) {
        case 'search': return tools.search(action.args)
        case 'open': return tools.open(action.args)
        case 'back': return tools.back()
        case 'forward': return tools.forward()
        case 'read': return tools.read(action.args)
        case 'find': return tools.find(action.args)
        case 'scroll': return tools.scroll(action.args)
        case 'wait': return tools.wait(action.args)
        case 'click': return tools.click(action.args)
        case 'fill': return tools.fill(action.args)
        case 'select': return tools.select(action.args)
        case 'check': return tools.setChecked(action.args)
        case 'press': return tools.press(action.args)
        case 'switch_tab': return tools.switchTab(action.args)
        case 'close_tab': return tools.closeTab(action.args)
        case 'observe': return tools.observe()
        case 'map': return tools.map(action.args)
        default: return { ok: false, result: `Nova has no tool called ${action.tool}.` }
      }
    })()
    state.metrics.tabsOpened += Math.max(0, (tools.ownTabs?.().length ?? 0) - tabsBefore)
    if (action.tool === 'search' && out.results) state.searches = [...state.searches, { query: action.args.query, results: out.results }].slice(-4)
    // A site the user already said no to in this task is not asked again.
    if (out.needsAccess && state.denied.includes(out.needsAccess.pattern)) return { ok: false, result: `The user did not allow ${out.needsAccess.site} for this task. Do without it, or finish and say what is left.` }
    return out
  }

  async function record(action, thought, out, expect = '', before = observation) {
    const step = { action, thought, expect, ok: Boolean(out.ok), result: String(out.result ?? '').slice(0, RESULT_CHARS), at: now() }
    state.steps.push(step)
    if (ACTING.has(action.tool) || ['open', 'back', 'forward', 'search', 'switch_tab', 'close_tab'].includes(action.tool)) {
      state.metrics.actions++
      if (!out.ok) state.metrics.failedActions++
    }
    if (/found it again/.test(step.result)) state.metrics.recoveries++
    const changed = out.changed ?? (out.observation ? pageKey(out.observation) !== pageKey(before) : false)
    state.attempts.push({ key: targetOf(action, before), page: pageKey(before), ok: step.ok, changed: Boolean(changed) || READING.has(action.tool) && step.ok && action.tool !== 'read' })
    if (state.attempts.length > 40) state.attempts.shift()
    if (out.observation) { observation = out.observation; remember(out.observation) }
    state.inflight = null
    await update({ current: out.ok ? state.current : `${describe(action)}: ${step.result}` })
  }

  // What happens when the user must act: allow a site, do something only
  // they may do, or say yes or no.
  async function waitFor(out, action, thought, expect) {
    if (out.confirm) {
      await update({ status: STATUS.AWAITING_USER, pending: { kind: 'confirm', reason: out.confirm, action, thought, expect, site: host(tools.page()?.url ?? ''), id: `${state.id}-c${state.steps.length}` }, current: 'Waiting for your OK' })
      return true
    }
    if (out.needsAccess) {
      await update({ status: STATUS.AWAITING_PERMISSION, pending: { kind: 'access', site: out.needsAccess.site, pattern: out.needsAccess.pattern, action, thought, expect, id: `${state.id}-a${state.steps.length}` }, current: `Waiting for you to allow ${out.needsAccess.site}` })
      return true
    }
    if (out.needsUser) {
      await record(action, thought, out, expect)
      await update({ status: STATUS.AWAITING_USER, pending: { kind: 'needs_you', message: out.needsUser.message, tab: out.needsUser.tab, action: { tool: 'observe', args: {} }, thought, id: `${state.id}-u${state.steps.length}` }, current: 'Waiting for you' })
      return true
    }
    return false
  }

  async function finishWith(args) {
    // The user's scope is kept to: an answer that does not is written again once.
    const problem = !state.rewriteAsked ? scopeProblem(state.scope, args.answer) : null
    if (problem) {
      state.rewriteAsked = true
      await record({ tool: 'finish', args: { status: args.status } }, 'Checking the answer keeps to what was asked.', { ok: false, result: problem })
      return false
    }
    const status = STATUS.COMPLETED
    await update({ status, result: args, pending: null, current: args.status === 'done' ? 'Done' : args.status === 'partial' ? 'Partly done' : 'Could not finish' })
    return true
  }

  async function loop() {
    if (running) return
    running = true
    try {
      // The first look: the page the task is on, before any decision (also
      // after the worker restarted, when the last observation is gone).
      if (!observation && tools.current() !== null) {
        const first = await tools.observe()
        if (first.observation) { observation = first.observation; remember(first.observation) }
        else if (first.needsAccess || first.needsUser) { if (await waitFor(first, { tool: 'observe', args: {} }, 'To read the page the task is on.', '')) return }
      }
      while (live() && !pausing && state.status === STATUS.RUNNING) {
        const minutes = (now() - state.startedAt) / 60_000
        const over = state.steps.length >= state.limits.steps || state.metrics.modelCalls >= state.limits.modelCalls || minutes >= state.limits.minutes
        // Out of budget: one last decision, told no steps are left, so it
        // writes up what it has. If even that does not finish, the task ends.
        if (over && state.finalAsked) { await update({ status: STATUS.COMPLETED, result: { status: 'partial', answer: 'Nova reached its limit for this task before writing up. What it did is listed under the details; any findings are below.', completed: [], remaining: [], concepts: [], gaps: [] }, current: 'Stopped at the limit' }); break }
        const input = stepInput(state, tools, observation, await watching().catch(() => null))
        if (over) { state.finalAsked = true; input.stepsLeft = 0 }
        state.metrics.modelCalls++
        state.modelCalls = state.metrics.modelCalls
        const res = await client.agentStep(input)
        if (!live()) break
        if (res.ok && res.data?.usage) { state.metrics.inputTokens += res.data.usage.inputTokens ?? 0; state.metrics.outputTokens += res.data.usage.outputTokens ?? 0 }
        if (!res.ok || !res.data?.success) {
          if (res.kind === 'unauthenticated') { await update({ status: STATUS.FAILED, error: res.message, current: 'Disconnected' }); break }
          const expired = res.ok && ['task_expired', 'task_limit'].includes(res.data?.error) || ['task_expired', 'task_limit'].includes(res.kind)
          await update({ status: expired ? STATUS.FAILED : STATUS.PAUSED, error: res.ok ? res.data?.message ?? 'Nova couldn’t decide the next step.' : res.message, current: expired ? 'This task ended' : 'Paused: Nova couldn’t reach Kivo. Resume to try again.' })
          break
        }
        const { thought, action, plan, expect } = res.data
        if (Array.isArray(plan)) state.plan = plan
        await update({ current: describe(action), error: null })

        if (action.tool === 'finish') {
          if (await finishWith(action.args)) break
          continue
        }
        if (action.tool === 'ask_user') {
          await update({ status: STATUS.AWAITING_USER, pending: { kind: 'question', question: action.args.question, choices: action.args.choices ?? [], action, thought, id: `${state.id}-q${state.steps.length}` }, current: 'Waiting for your answer' })
          break
        }
        if (action.tool === 'hand_over') {
          await record(action, thought, { ok: true, result: 'Handed over to the user.' }, expect)
          await update({ status: STATUS.AWAITING_USER, pending: { kind: 'needs_you', message: action.args.reason, tab: tools.current(), action: { tool: 'observe', args: {} }, thought, id: `${state.id}-u${state.steps.length}` }, current: 'Waiting for you' })
          break
        }
        const blocked = gate(action)
        if (blocked) { await record(action, thought, { ok: false, result: blocked }, expect); continue }
        // No progress: the same thing, on the same unchanged page, that did nothing before.
        if (isNoProgressRepeat(state.attempts, action, observation)) {
          state.refusals++
          state.metrics.refusals++
          await record(action, thought, { ok: false, result: 'Already tried exactly this on this same page, and it made no progress. Do something different: find the element by its words, re-read, try another way, or ask the user.' }, expect)
          if (state.refusals >= 2) {
            await update({ status: STATUS.AWAITING_USER, pending: { kind: 'question', question: `Nova is stuck: ${thought || 'its last attempts changed nothing on the page'}. What should it do?`, choices: ['Try another way', 'Stop and tell me what you have'], action: { tool: 'ask_user', args: {} }, thought, id: `${state.id}-q${state.steps.length}` }, current: 'Stuck: waiting for you' })
            break
          }
          continue
        }
        state.refusals = 0
        if (!READING.has(action.tool)) { state.inflight = { action, at: now(), url: observation?.url ?? null, print: observation?.print ?? null }; await save(state) }
        const out = await execute(action)
        if (!live()) break
        if (await waitFor(out, action, thought, expect)) break
        await record(action, thought, out, expect)
      }
    } catch (err) {
      if (live()) await update({ status: STATUS.PAUSED, error: 'Something went wrong in this step. Resume to try again.', current: 'Paused' })
      console.error('[kivo agent]', err)
    } finally {
      running = false
      if (pausing && state.status === STATUS.RUNNING) await update({ status: STATUS.PAUSED, current: 'Paused' })
      pausing = false
    }
  }

  // Back from waiting: the action that waited is done (or not), then the loop goes on.
  async function carryOn(out, pending) {
    if (!live()) return
    state.pending = null
    await update({ status: STATUS.RUNNING })
    if (await waitFor(out, pending.action, pending.thought, pending.expect)) return
    await record(pending.action, pending.thought, out, pending.expect)
    return loop()
  }
  // An answer meant for this question, and nothing older.
  const current = (kind, id) => state.pending && state.pending.kind === kind && (!id || !state.pending.id || state.pending.id === id)

  return {
    state,
    running: () => running,
    start: () => {
      if (FINISHED.includes(state.status)) return Promise.resolve()
      stopping = false; pausing = false
      if (state.status === STATUS.PAUSED) state.status = STATUS.RUNNING
      return loop()
    },
    pause: () => { pausing = true },
    /** Cancel: nothing more is sent or done, and nothing waiting can be carried out later. */
    async stop() {
      stopping = true
      if (FINISHED.includes(state.status)) return
      await update({ status: STATUS.CANCELLED, current: 'Stopped by you', pending: null, inflight: null })
    },
    /** The user's answer to ask_user, or "done" after something only they could do. */
    async answer(text, id = null) {
      if (state.status !== STATUS.AWAITING_USER || !state.pending || !['question', 'needs_you'].includes(state.pending.kind) || (id && state.pending.id && state.pending.id !== id)) return
      const pending = state.pending
      if (pending.kind === 'needs_you') {
        state.pending = null
        await update({ status: STATUS.RUNNING })
        const out = await tools.observe()
        if (out.observation) observation = out.observation
        if (await waitFor(out, pending.action, pending.thought, '')) return
        await record({ tool: 'observe', args: {} }, 'The user is back.', { ...out, result: `The user did what was needed and pressed carry on. ${out.result ?? ''}` })
        return loop()
      }
      // Stuck, and the user said to stop: the write-up, with nothing more done.
      if (pending.action?.tool === 'ask_user' && !pending.action.args?.question && String(text).toLowerCase().startsWith('stop')) state.limits = { ...state.limits, steps: state.steps.length }
      state.refusals = 0
      return carryOn({ ok: true, result: `The user answered: ${String(text).slice(0, 240)}` }, pending)
    },
    /** The user's yes or no to an action that waits for them. A no is final for that action. */
    async confirm(allowed, id = null) {
      if (state.status !== STATUS.AWAITING_USER || !current('confirm', id)) return
      const pending = state.pending
      state.pending = null
      if (!allowed) return carryOn({ ok: false, result: 'The user did not allow this. Do not try it again; do something else, or finish and say what is left.' }, pending)
      await update({ status: STATUS.RUNNING })
      state.inflight = { action: pending.action, at: now(), url: observation?.url ?? null, print: observation?.print ?? null, confirmed: true }
      await save(state)
      const out = await execute(pending.action, { confirmed: true })
      if (!live()) return
      return carryOn(out, { ...pending, kind: 'done' })
    },
    /** The user allowed a site (or any site), or did not. A no is kept for the rest of the task. */
    async access(granted, { pattern = null, anySite = false, id = null } = {}) {
      if (state.status !== STATUS.AWAITING_PERMISSION || !current('access', id)) return
      const pending = state.pending
      if (granted) {
        if (anySite) state.anySite = true
        else if (pattern && !state.granted.includes(pattern)) state.granted.push(pattern)
        state.pending = null
        await update({ status: STATUS.RUNNING })
        const out = await execute(pending.action, { confirmed: false })
        if (!live()) return
        return carryOn(out, pending)
      }
      if (pending.pattern && !state.denied.includes(pending.pattern)) state.denied.push(pending.pattern)
      return carryOn({ ok: false, result: `The user did not allow Nova to use ${pending.site}. Do the task without it, or finish and say what is left. Do not ask for it again.` }, pending)
    },
  }
}

function sameSite(pattern, url) {
  try { const u = new URL(url); return pattern === `${u.protocol}//${u.hostname}/*` } catch { return false }
}

/**
 * The task's own tabs to close when it ends: all of Nova's (never one of the
 * user's), unless the user keeps them. A Nova tab in front is closed too:
 * Nova put it there; the user is taken back to the tab the task started on.
 */
export function tabsToClose(state, ownTabs) {
  if (state.keepTabs) return []
  return [...ownTabs]
}

/**
 * A task's state when the worker starts again: one that was running was cut
 * off, so it waits to be resumed; an action that was in flight is recorded
 * as interrupted (whether it happened is checked on the page, not assumed).
 */
export function recoveredState(state, now = Date.now()) {
  const status = statusOf(state.status)
  const next = { ...state, status }
  if (status === STATUS.RUNNING || status === STATUS.PLANNING) {
    next.status = STATUS.PAUSED
    next.current = 'Paused: Nova’s background work restarted. Press Resume to carry on.'
  }
  if (state.inflight) {
    const a = state.inflight.action
    next.steps = [...(state.steps ?? []), { action: a, thought: 'Interrupted', expect: '', ok: false, at: now,
      result: `Interrupted while doing this: it may or may not have happened. Look at the page to see whether it did before doing it again${state.inflight.confirmed ? ' (it was approved once; a repeat needs the user again)' : ''}.` }]
    next.attempts = [...(state.attempts ?? []), { key: 'interrupted', page: 'none', ok: false, changed: false }]
    next.inflight = null
  }
  return next
}
