// Nova's browser agent: the loop, run by the extension's background worker
// (background.js) for what the learner asks in the side panel.
//
//   UNDERSTAND → PLAN → OBSERVE → DECIDE → ACT → VERIFY → CONTINUE
//
//   understand  the objective, the conversation so far, and what the
//               learner's Kivo workspace holds for it (asked once when the
//               task starts: server …/agent/start, which counts the task once).
//   observe     the page the task is on, as elements and text (agent-page.js).
//   decide      one model call per step chooses one tool and keeps a plan
//               (server …/agent/step).
//   act         agent-tools.js does it, checking first (allowed? needs the
//               learner's OK? never?) and verifying after.
//   continue    until the model finishes, a limit is reached, or the learner
//               pauses, stops, is asked something, must allow a site, or must
//               do something only they may do (sign in, a human check).
//
// Limits are configurable (DEFAULT_LIMITS): steps, minutes and model calls.
// At a limit the model gets one last step to write up; the same action
// repeated is refused, and three refusals in a row end the task. The state is
// saved after every step (chrome.storage.session: memory, gone when the
// browser quits), so the panel can close and open and the worker can restart.
//
// Pause takes effect at the next safe boundary (after the step in flight);
// stop at once: nothing more is sent or done. Findings are quotes checked
// against the page they came from; the agent's own reading is kept apart.

export const DEFAULT_LIMITS = { steps: 30, minutes: 12, modelCalls: 36 }
export const STATE_KEY = 'kivo.agent'
const RESULT_CHARS = 300
const PRIVATE_KEPT = 40_000

/** @typedef {'running'|'paused'|'asking'|'confirming'|'access'|'done'|'stopped'|'failed'} Status */
export const FINISHED = ['done', 'stopped', 'failed']

export function newState({ objective, history = [], start, startTab = null, windowId, limits = DEFAULT_LIMITS, now = Date.now() }) {
  return {
    v: 2, id: `t${now.toString(36)}`, objective, history,
    ticket: start?.ticket ?? null, workspace: start?.summary ?? '', context: start ? { notes: start.notes ?? [], places: start.places ?? [] } : null,
    startTab, windowId, limits, startedAt: now, status: 'running',
    plan: [], steps: [], seen: [], sources: [], findings: [], saved: [], data: null, privateTexts: [], modelCalls: 0,
    pending: null, result: null, error: null, refusals: 0, current: 'Reading the page', finalAsked: false,
    granted: [], anySite: false, browser: null,
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
    case 'save_to_drafts': return `Saving “${a.args.title}” to your Drafts`
    case 'ask_user': return 'Asking you'
    case 'hand_over': return 'Waiting for you'
    case 'finish': return 'Writing it up'
    default: return a.tool
  }
}
export const actionWords = describe
const argsOf = a => JSON.stringify(a.args).slice(0, 300)
const sameAction = (a, b) => a && b && a.tool === b.tool && argsOf(a) === argsOf(b)
// Reading tools may repeat once the page has changed; acting ones may not repeat back to back.
const REPEATABLE = new Set(['read', 'wait', 'scroll', 'press', 'back', 'forward'])

/** What one step sends the server: bounded, no page but the current one. */
export function stepInput(state, tools, observation, watching = null) {
  const left = state.limits.steps - state.steps.length
  return {
    ticket: state.ticket,
    objective: state.objective, history: state.history ?? [], workspace: state.workspace, data: state.data, plan: state.plan,
    stepsLeft: Math.max(0, left),
    steps: state.steps.slice(-14).map(s => ({ tool: s.action.tool, args: argsOf(s.action), ok: s.ok, result: s.result })),
    observation, tabs: tools.tabList().slice(0, 10), watching,
    // Pages read before this one: the start of each, so a comparison has them.
    seen: (state.seen ?? []).filter(p => p.url !== observation?.url).slice(-6),
    sources: state.sources.map(s => ({ n: s.n, url: s.url, title: s.title })),
    findings: state.findings.slice(-40).map(f => ({ n: f.n, source: f.source, concept: f.concept, quote: f.quote.slice(0, 200) })),
    saved: state.saved.length,
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
  let observation = null
  let stopping = false
  let pausing = false
  let running = false
  const update = async patch => { Object.assign(state, patch, { browser: tools.snapshot?.() ?? null }); onUpdate(state); await save(state) }

  function addSource(src) {
    const found = state.sources.find(s => s.url === src.url)
    if (found) return found.n
    const n = state.sources.length + 1
    state.sources.push({ n, url: src.url, title: src.title || src.url })
    return n
  }
  // What a page said, kept short, for later steps (a comparison across tabs).
  const remember = o => {
    if (o.kind !== 'page' || !o.url) return
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
    return { ok: true, result: op === 'search' ? `Found ${res.data.found} things in the learner's Kivo (shown under WORKSPACE SEARCH RESULT).` : 'Read the note (shown under NOTE READ).' }
  }

  async function saveToDrafts(args) {
    const page = tools.page()
    const key = `${state.id}-s${state.saved.length + 1}`
    const res = await client.capture({ key, url: page?.kind === 'page' ? page.url : null, title: args.title, text: args.text, note: args.note || '', ...(state.saved.length === 0 && !state.findings.length ? { newDraft: true } : {}) })
    if (!res.ok || !res.data?.success) return { ok: false, result: res.ok ? res.data?.message ?? 'That did not save.' : res.message }
    state.saved.push({ key, title: args.title, draftId: res.data.draft?.id ?? null, itemId: res.data.itemId ?? null })
    return { ok: true, result: `Saved "${args.title}" to the learner's Drafts (Kivo files it under their subject and topic).` }
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
    if (action.tool === 'save_to_drafts') return saveToDrafts(action.args)
    if (!confirmed) {
      const why = await tools.check(action)
      if (why === 'never') return { ok: false, result: 'Kivo never types into password, payment or one-time-code fields: hand_over to the learner.' }
      if (why) return { confirm: why }
    }
    switch (action.tool) {
      case 'search': return tools.search(action.args)
      case 'open': return tools.open(action.args)
      case 'back': return tools.back()
      case 'forward': return tools.forward()
      case 'read': return tools.read(action.args)
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
      default: return { ok: false, result: `Nova has no tool called ${action.tool}.` }
    }
  }

  async function record(action, thought, out, expect = '') {
    const step = { action, thought, expect, ok: Boolean(out.ok), result: String(out.result ?? '').slice(0, RESULT_CHARS), at: now() }
    state.steps.push(step)
    if (out.observation) { observation = out.observation; remember(out.observation) }
    await update({ current: out.ok ? state.current : `${describe(action)}: ${step.result}` })
  }

  // What happens when the learner must act: allow a site, do something only
  // they may do, or say yes or no.
  async function waitFor(out, action, thought, expect) {
    if (out.confirm) {
      await update({ status: 'confirming', pending: { kind: 'confirm', reason: out.confirm, action, thought, expect, site: host(tools.page()?.url ?? '') }, current: 'Waiting for your OK' })
      return true
    }
    if (out.needsAccess) {
      await update({ status: 'access', pending: { kind: 'access', site: out.needsAccess.site, pattern: out.needsAccess.pattern, action, thought, expect }, current: `Waiting for you to allow ${out.needsAccess.site}` })
      return true
    }
    if (out.needsUser) {
      await record(action, thought, out, expect)
      await update({ status: 'asking', pending: { kind: 'needs_you', message: out.needsUser.message, tab: out.needsUser.tab, action: { tool: 'observe', args: {} }, thought }, current: 'Waiting for you' })
      return true
    }
    return false
  }

  async function loop() {
    if (running) return
    running = true
    try {
      // The first look: the page the task is on, before any decision (also
      // after the worker restarted, when the last observation is gone).
      if (!observation && tools.current() !== null) {
        const first = await tools.observe()
        if (first.observation) observation = first.observation
        else if (first.needsAccess || first.needsUser) { if (await waitFor(first, { tool: 'observe', args: {} }, 'To read the page the task is on.', '')) return }
      }
      while (!stopping && !pausing && state.status === 'running') {
        const minutes = (now() - state.startedAt) / 60_000
        const over = state.steps.length >= state.limits.steps || state.modelCalls >= state.limits.modelCalls || minutes >= state.limits.minutes
        // Out of budget: one last decision, told no steps are left, so it
        // writes up what it has. If even that does not finish, the task ends.
        if (over && state.finalAsked) { await update({ status: 'done', result: { status: 'partial', answer: 'Nova reached its limit for this task before writing up. What it did is in the steps; any findings are below.', completed: [], remaining: [], concepts: [], gaps: [] }, current: 'Stopped at the limit' }); break }
        const input = stepInput(state, tools, observation, await watching().catch(() => null))
        if (over) { state.finalAsked = true; input.stepsLeft = 0 }
        state.modelCalls++
        const res = await client.agentStep(input)
        if (stopping) break
        if (!res.ok || !res.data?.success) {
          if (res.kind === 'unauthenticated') { await update({ status: 'failed', error: res.message, current: 'Disconnected' }); break }
          const expired = res.ok && ['task_expired', 'task_limit'].includes(res.data?.error)
          await update({ status: expired ? 'failed' : 'paused', error: res.ok ? res.data?.message ?? 'Nova couldn’t decide the next step.' : res.message, current: expired ? 'This task ended' : 'Paused: Nova couldn’t decide the next step' })
          break
        }
        const { thought, action, plan, expect } = res.data
        if (Array.isArray(plan)) state.plan = plan
        await update({ current: describe(action), error: null })

        if (action.tool === 'finish') {
          await update({ status: 'done', result: action.args, current: action.args.status === 'done' ? 'Done' : action.args.status === 'partial' ? 'Partly done' : 'Could not finish' })
          break
        }
        if (action.tool === 'ask_user') {
          await update({ status: 'asking', pending: { kind: 'question', question: action.args.question, choices: action.args.choices ?? [], action, thought }, current: 'Waiting for your answer' })
          break
        }
        if (action.tool === 'hand_over') {
          await record(action, thought, { ok: true, result: 'Handed over to the learner.' }, expect)
          await update({ status: 'asking', pending: { kind: 'needs_you', message: action.args.reason, tab: tools.current(), action: { tool: 'observe', args: {} }, thought }, current: 'Waiting for you' })
          break
        }
        const recent = state.steps.slice(-3).map(s => s.action)
        const last = recent[recent.length - 1]
        if (REPEATABLE.has(action.tool) ? sameAction(last, action) && !state.steps[state.steps.length - 1]?.ok : recent.some(a => sameAction(a, action))) {
          state.refusals++
          await record(action, thought, { ok: false, result: 'Repeated: you already did exactly this. Look at the observation, choose something else, or finish.' }, expect)
          if (state.refusals >= 3) { await update({ status: 'failed', error: 'Nova kept repeating itself, so the task was stopped. What it did so far is kept.', current: 'Stopped' }); break }
          continue
        }
        state.refusals = 0
        const out = await execute(action)
        if (stopping) break
        if (await waitFor(out, action, thought, expect)) break
        await record(action, thought, out, expect)
      }
    } catch (err) {
      await update({ status: 'paused', error: 'Something went wrong in this step. Resume to try again.', current: 'Paused' })
      console.error('[kivo agent]', err)
    } finally {
      running = false
      if (pausing && state.status === 'running') await update({ status: 'paused', current: 'Paused' })
      pausing = false
    }
  }

  // Back from waiting: the action that waited is done (or not), then the loop goes on.
  async function carryOn(out, pending) {
    state.pending = null
    state.status = 'running'
    if (await waitFor(out, pending.action, pending.thought, pending.expect)) return
    await record(pending.action, pending.thought, out, pending.expect)
    return loop()
  }

  return {
    state,
    running: () => running,
    start: () => { stopping = false; pausing = false; if (state.status === 'paused') state.status = 'running'; return loop() },
    pause: () => { pausing = true },
    async stop() {
      stopping = true
      await update({ status: 'stopped', current: 'Stopped by you', pending: null })
    },
    /** The learner's answer to ask_user, or "done" after something only they could do. */
    async answer(text) {
      if (state.status !== 'asking' || !state.pending) return
      const pending = state.pending
      if (pending.kind === 'needs_you') {
        state.pending = null; state.status = 'running'
        const out = await tools.observe()
        if (out.observation) observation = out.observation
        if (await waitFor(out, pending.action, pending.thought, '')) return
        await record({ tool: 'observe', args: {} }, 'The learner is back.', { ...out, result: `The learner did what was needed and pressed Resume. ${out.result ?? ''}` })
        return loop()
      }
      return carryOn({ ok: true, result: `The learner answered: ${String(text).slice(0, 240)}` }, pending)
    },
    /** The learner's yes or no to an action that waits for them. */
    async confirm(allowed) {
      if (state.status !== 'confirming' || !state.pending) return
      const pending = state.pending
      state.pending = null; state.status = 'running'
      const out = allowed ? await execute(pending.action, { confirmed: true }) : { ok: false, result: 'The learner did not allow this. Do something else, or finish and say what is left.' }
      return carryOn(out, pending)
    },
    /** The learner allowed a site (or any site), or did not. */
    async access(granted, { pattern = null, anySite = false } = {}) {
      if (state.status !== 'access' || !state.pending) return
      const pending = state.pending
      if (granted) {
        if (anySite) state.anySite = true
        else if (pattern && !state.granted.includes(pattern)) state.granted.push(pattern)
        state.pending = null; state.status = 'running'
        const out = await execute(pending.action, { confirmed: false })
        return carryOn(out, pending)
      }
      return carryOn({ ok: false, result: `The learner did not allow Nova to use ${pending.site}. Do the task without it, or finish and say what is left.` }, pending)
    },
  }
}
