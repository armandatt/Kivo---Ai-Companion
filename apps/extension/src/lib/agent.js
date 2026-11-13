// The research agent's loop, in the side panel (research.js):
//
//   PLAN → OBSERVE → DECIDE → EXECUTE → VERIFY → CONTINUE
//
//   plan      the objective, and what the learner's Kivo workspace already
//             holds for it (asked once, server: research-agent.ts context).
//   decide    one model call per step chooses one tool (server: step).
//   execute   lib/agent-tools.js does it, checking first and verifying after.
//   continue  until the model finishes, a limit is reached, or the learner
//             pauses, stops, or is asked something.
//
// Limits are configurable (DEFAULT_LIMITS): steps, minutes and model calls.
// The same action repeated is refused, and three refusals in a row end the
// task. The state is saved after every step (chrome.storage.session, gone
// when the browser quits) so a closed panel can resume where it stopped.
//
// Findings are quotes checked against the page they came from; the agent's
// own reading of each is kept apart as its note. Nothing is saved to Kivo
// here: the learner reviews the result and saves it (research.js).

export const DEFAULT_LIMITS = { steps: 24, minutes: 10, modelCalls: 30 }
export const STATE_KEY = 'kivo.research'
const RESULT_CHARS = 280

/** @typedef {'running'|'paused'|'asking'|'confirming'|'done'|'stopped'|'failed'} Status */

export function newState({ objective, workspace, includePage = null, limits = DEFAULT_LIMITS, now = Date.now() }) {
  return {
    v: 1, id: `r${now.toString(36)}`, objective, workspace: workspace?.summary ?? '', context: workspace ?? null,
    includePage, limits, startedAt: now, status: 'running', steps: [], sources: [], findings: [], modelCalls: 0,
    pending: null, result: null, error: null, refusals: 0, current: 'Planning the research',
  }
}

const describe = a => {
  switch (a.tool) {
    case 'search': return `Searching for “${a.args.query}”`
    case 'open': { try { return `Opening ${new URL(a.args.url).hostname.replace(/^www\./, '')}` } catch { return 'Opening a page' } }
    case 'read': return `Reading part ${a.args.part}`
    case 'scroll': return 'Scrolling for more'
    case 'click': return 'Following a link'
    case 'type': return `Searching the site for “${a.args.text}”`
    case 'switch_tab': return 'Going back to another source'
    case 'extract': return `Keeping a finding: ${a.args.concept}`
    case 'ask_user': return 'Asking you'
    case 'finish': return 'Comparing findings and writing it up'
    default: return a.tool
  }
}
export const actionWords = describe
const argsOf = a => JSON.stringify(a.args).slice(0, 300)
const sameAction = (a, b) => a && b && a.tool === b.tool && argsOf(a) === argsOf(b)

/** What one step sends the server: bounded, no page but the current one. */
export function stepInput(state, tools, observation) {
  const left = state.limits.steps - state.steps.length
  return {
    objective: state.objective, workspace: state.workspace, stepsLeft: Math.max(0, left),
    steps: state.steps.slice(-14).map(s => ({ tool: s.action.tool, args: argsOf(s.action), ok: s.ok, result: s.result })),
    observation, tabs: tools.tabList().slice(0, 10),
    sources: state.sources.map(s => ({ n: s.n, url: s.url, title: s.title })),
    findings: state.findings.slice(-40).map(f => ({ n: f.n, source: f.source, concept: f.concept, quote: f.quote.slice(0, 200) })),
  }
}

/**
 * @param {{ state: object, tools: object, client: object, save?: (state: object) => Promise<void>, onUpdate?: (state: object) => void, now?: () => number }} deps
 */
export function createAgent({ state, tools, client, save = async () => {}, onUpdate = () => {}, now = () => Date.now() }) {
  let observation = null
  let stopping = false
  let pausing = false
  let running = false
  const update = async patch => { Object.assign(state, patch); onUpdate(state); await save(state) }

  function addSource(src) {
    const found = state.sources.find(s => s.url === src.url)
    if (found) return found.n
    const n = state.sources.length + 1
    state.sources.push({ n, url: src.url, title: src.title || src.url })
    return n
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
    if (!confirmed) {
      const why = await tools.check(action)
      if (why === 'never') return { ok: false, result: 'Kivo never types into password fields.' }
      if (why) return { confirm: why }
    }
    switch (action.tool) {
      case 'search': return tools.search(action.args)
      case 'open': return tools.open(action.args)
      case 'read': return tools.read(action.args)
      case 'scroll': return tools.scroll(action.args)
      case 'click': return tools.click(action.args)
      case 'type': return tools.type(action.args)
      case 'switch_tab': return tools.switchTab(action.args)
      default: return { ok: false, result: `Kivo has no tool called ${action.tool}.` }
    }
  }

  async function record(action, thought, out) {
    const step = { action, thought, ok: Boolean(out.ok), result: String(out.result ?? '').slice(0, RESULT_CHARS), at: now() }
    state.steps.push(step)
    if (out.observation) observation = out.observation
    // A page read becomes a source only when something is kept from it.
    await update({ current: out.ok ? state.current : `${describe(action)}: ${step.result}` })
  }

  async function loop() {
    if (running) return
    running = true
    try {
      while (!stopping && !pausing && state.status === 'running') {
        const minutes = (now() - state.startedAt) / 60_000
        const over = state.steps.length >= state.limits.steps || state.modelCalls >= state.limits.modelCalls || minutes >= state.limits.minutes
        // Out of budget: one last decision, told no steps are left, so it
        // writes up what it has. If even that does not finish, the task ends.
        if (over && state.finalAsked) { await update({ status: 'done', result: { summary: 'Kivo reached its limit for this task before writing a summary. The findings it kept are below.', concepts: [], gaps: [] }, current: 'Stopped at the limit' }); break }
        const input = stepInput(state, tools, observation)
        if (over) { state.finalAsked = true; input.stepsLeft = 0 }
        state.modelCalls++
        const res = await client.researchStep(input)
        if (stopping) break
        if (!res.ok || !res.data?.success) {
          if (res.kind === 'unauthenticated') { await update({ status: 'failed', error: res.message, current: 'Disconnected' }); break }
          await update({ status: 'paused', error: res.ok ? res.data?.message ?? 'Kivo couldn’t decide the next step.' : res.message, current: 'Paused: Kivo couldn’t decide the next step' })
          break
        }
        const { thought, action } = res.data
        await update({ current: describe(action), error: null })

        if (action.tool === 'finish') {
          await update({ status: 'done', result: action.args, current: 'Done' })
          break
        }
        if (action.tool === 'ask_user') {
          await update({ status: 'asking', pending: { kind: 'question', question: action.args.question, action, thought }, current: 'Waiting for your answer' })
          break
        }
        const recent = state.steps.slice(-3).map(s => s.action)
        if (action.tool !== 'read' && recent.some(a => sameAction(a, action)) || action.tool === 'read' && sameAction(recent[recent.length - 1], action)) {
          state.refusals++
          await record(action, thought, { ok: false, result: 'Repeated: you already did exactly this. Choose something else, or finish.' })
          if (state.refusals >= 3) { await update({ status: 'failed', error: 'Kivo kept repeating itself, so the task was stopped. The findings so far are kept.', current: 'Stopped' }); break }
          continue
        }
        state.refusals = 0
        const out = await execute(action)
        if (stopping) break
        if (out.confirm) {
          await update({ status: 'confirming', pending: { kind: 'confirm', reason: out.confirm, action, thought }, current: 'Waiting for your OK' })
          break
        }
        if (out.needsUser) {
          // Something only the learner may do (a site's human check): wait for them.
          await record(action, thought, out)
          await update({ status: 'asking', pending: { kind: 'needs_you', message: out.needsUser.message, tab: out.needsUser.tab, action, thought }, current: 'Waiting for you' })
          break
        }
        await record(action, thought, out)
      }
    } catch (err) {
      await update({ status: 'paused', error: 'Something went wrong in this step. Resume to try again.', current: 'Paused' })
      console.error('[kivo research]', err)
    } finally {
      running = false
      if (pausing && state.status === 'running') await update({ status: 'paused', current: 'Paused' })
      pausing = false
    }
  }

  return {
    state,
    start: () => { stopping = false; pausing = false; if (state.status === 'paused') state.status = 'running'; return loop() },
    pause: () => { pausing = true },
    async stop() {
      stopping = true
      await update({ status: 'stopped', current: 'Stopped by you', pending: null })
    },
    /** The learner's answer to ask_user, or "done" after something only they could do. */
    async answer(text) {
      if (state.status !== 'asking' || !state.pending) return
      const { action, thought, kind } = state.pending
      state.pending = null
      state.status = 'running'
      await record(action, thought, kind === 'needs_you'
        ? { ok: true, result: 'The learner did what the site asked. Try that again.' }
        : { ok: true, result: `The learner answered: ${String(text).slice(0, 240)}` })
      return loop()
    },
    /** The learner's yes or no to an action that waits for them. */
    async confirm(allowed) {
      if (state.status !== 'confirming' || !state.pending) return
      const { action, thought } = state.pending
      state.pending = null
      state.status = 'running'
      const out = allowed ? await execute(action, { confirmed: true }) : { ok: false, result: 'The learner did not allow this. Do something else.' }
      await record(action, thought, out)
      return loop()
    },
  }
}
