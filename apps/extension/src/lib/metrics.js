// What each browser-agent task cost and did, kept on this device only
// (chrome.storage.local, the latest METRICS_KEPT), so the token use and the
// work of each kind of task can be measured before anything is "optimised".
// No objective text, no page, no address: counts and a kind.

export const METRICS_KEY = 'nova.agentMetrics'
export const METRICS_KEPT = 50

/** One finished task, as numbers. */
export function taskMetrics(state) {
  const m = state.metrics ?? {}
  const ended = m.endedAt ?? Date.now()
  return {
    id: state.id, kind: state.kind ?? state.mode ?? 'page', status: state.status, result: state.result?.status ?? null,
    seconds: Math.round((ended - (state.startedAt ?? ended)) / 1000),
    steps: state.steps?.length ?? 0, modelCalls: m.modelCalls ?? state.modelCalls ?? 0,
    inputTokens: m.inputTokens ?? 0, outputTokens: m.outputTokens ?? 0,
    actions: m.actions ?? 0, failedActions: m.failedActions ?? 0, refusals: m.refusals ?? 0, recoveries: m.recoveries ?? 0,
    tabsOpened: m.tabsOpened ?? 0, tabsClosed: state.closedTabs ?? 0,
    sourcesRead: state.sources?.length ?? 0, at: ended,
  }
}

export async function recordTaskMetrics(area, state) {
  const now = taskMetrics(state)
  const kept = (await area.get(METRICS_KEY))?.[METRICS_KEY]
  const list = (Array.isArray(kept) ? kept : []).filter(x => x.id !== now.id)
  list.push(now)
  await area.set({ [METRICS_KEY]: list.slice(-METRICS_KEPT) })
  return now
}
