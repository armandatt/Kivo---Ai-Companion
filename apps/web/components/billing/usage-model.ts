// What the Plan & usage page says about each allowance. Pure: it formats the
// server's figures (GET /api/billing → billing/accounting/summary.ts) and
// never works out an allowance, a balance or a period itself. Every number on
// the page comes from there; this file only decides how it reads.

export type Tier = 'free' | 'plus' | 'pro'
export type Allowance = { used: number; limit: number | null; remaining: number | null; resetsAt: string | null }
export type McpView = { lifetimeUsed: number; lifetimeLimit: number | null; readOnly: boolean; readOnlyUsed: number | null; readOnlyLimit: number | null; readOnlyResetsAt: string | null }
export type Allowances = {
  mode: 'off' | 'shadow' | 'enforce'
  enforced: { nova: boolean; browser: boolean; mcp: boolean; storage: boolean }
  tier: Tier
  nova: Allowance
  browser: Allowance
  mcp: McpView
  storage: { usedBytes: number; limitBytes: number; remainingBytes: number }
}
export type TierAllowance = { novaCredits: number; browserTasks: number; mcpLifetime: number | null; mcpReadOnly: number | null; storageBytes: number }

export type RowState = 'ok' | 'low' | 'used_up' | 'fair_use' | 'read_only'

export interface UsageRow {
  key: 'nova' | 'browser' | 'storage' | 'mcp'
  name: string
  figure: string               // "42 of 150 credits"
  left: string | null          // "108 left"
  pct: number | null           // 0–100 for the bar; null when there is no fixed limit
  used: number; limit: number | null
  state: RowState
  renews: string | null        // "Renews 1 December" (the viewer's own time zone), or a lifetime note
  what: string                 // what counts
  atLimit: string              // what happens when it runs out
  extra?: { label: string; figure: string; pct: number | null; renews: string | null } // Free MCP: the monthly reads
}

export interface DateOpts { locale?: string; timeZone?: string }

// A period's end is an instant; shown as the viewer's own calendar day.
export function renewsOn(iso: string | null, o: DateOpts = {}): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `Renews ${d.toLocaleDateString(o.locale, { day: 'numeric', month: 'long', ...(o.timeZone ? { timeZone: o.timeZone } : {}) })}`
}

export function bytes(b: number): string {
  if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })} GB`
  if (b >= 1_000_000) return `${(b / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: b < 10_000_000 ? 1 : 0 })} MB`
  if (b > 0) return `${Math.max(1, Math.round(b / 1_000)).toLocaleString('en-US')} KB`
  return '0 MB'
}

const n = (v: number) => v.toLocaleString('en-US')
const pctOf = (used: number, limit: number) => limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100))
const stateOf = (used: number, limit: number): RowState => used >= limit ? 'used_up' : pctOf(used, limit) >= 80 ? 'low' : 'ok'

// The sentence for "what happens at the limit": the rule once limits apply,
// and plainly that nothing pauses while they are still being measured.
function atLimit(enforced: boolean, mode: Allowances['mode'], rule: string): string {
  if (enforced) return rule
  return mode === 'off'
    ? `${rule} These monthly limits aren't applied yet.`
    : `${rule} Not applied yet: Kivo is measuring use while these limits are introduced, and nothing pauses because of them.`
}

// Reads and writes, said apart (connect/usage-class.ts decides which a tool is).
const READS_AND_WRITES = 'A read looks at your notes, map or saved pages and changes nothing; a write creates, adds to, links, files or (with your approval) moves or deletes something.'

export function usageRows(a: Allowances, o: DateOpts = {}): UsageRow[] {
  const rows: UsageRow[] = []

  // Nova credits
  {
    const { used, limit } = a.nova
    const lim = limit ?? 0
    rows.push({
      key: 'nova', name: 'Nova credits', used, limit,
      figure: limit === null ? `${n(used)} credits used` : `${n(used)} of ${n(limit)} credits`,
      left: limit === null ? null : `${n(Math.max(0, a.nova.remaining ?? lim - used))} left`,
      pct: limit === null ? null : pctOf(used, lim),
      state: limit === null ? 'fair_use' : stateOf(used, lim),
      renews: renewsOn(a.nova.resetsAt, o),
      what: 'Nova on the web, Telegram and the extension. A usual request uses about one credit; long documents, files and bigger jobs use more, in proportion to the work. A request that fails because of Kivo uses none.',
      atLimit: atLimit(a.enforced.nova, a.mode, 'When they run out, asking Nova pauses until they renew. Notes, maps, plans and focus sessions keep working.'),
    })
  }

  // Browser tasks
  {
    const { used, limit } = a.browser
    const lim = limit ?? 0
    rows.push({
      key: 'browser', name: 'Browser-agent tasks', used, limit,
      figure: limit === null ? `${n(used)} tasks` : `${n(used)} of ${n(limit)} tasks`,
      left: limit === null ? null : `${n(Math.max(0, a.browser.remaining ?? lim - used))} left`,
      pct: limit === null ? null : pctOf(used, lim),
      state: limit === null ? 'fair_use' : stateOf(used, lim),
      renews: renewsOn(a.browser.resetsAt, o),
      what: 'One task each time you ask Nova to do something in your browser, however many steps it takes.',
      atLimit: atLimit(a.enforced.browser, a.mode, 'When they run out, new tasks wait until they renew. A task that has already started always finishes.'),
    })
  }

  // Storage: a gauge, not a monthly allowance
  {
    const { usedBytes, limitBytes } = a.storage
    rows.push({
      key: 'storage', name: 'Images and attachments', used: usedBytes, limit: limitBytes,
      figure: `${bytes(usedBytes)} of ${bytes(limitBytes)}`,
      left: `${bytes(Math.max(0, a.storage.remainingBytes))} left`,
      pct: pctOf(usedBytes, limitBytes),
      state: stateOf(usedBytes, limitBytes),
      renews: 'Doesn’t reset: it’s what you have stored',
      what: 'Images and screenshots in your notes, and files waiting in Build with Nova. Note text, maps and plans are not counted.',
      atLimit: atLimit(a.enforced.storage, a.mode, 'When it is full, new uploads pause. Everything already stored stays, still opens and can still be exported. Nothing is deleted.'),
    })
  }

  // ChatGPT and Claude (MCP)
  const m = a.mcp
  if (m.lifetimeLimit === null) {
    rows.push({
      key: 'mcp', name: 'ChatGPT and Claude', used: m.lifetimeUsed, limit: null,
      figure: `${n(m.lifetimeUsed)} calls so far`, left: null, pct: null, state: 'fair_use',
      renews: 'No fixed number · fair use',
      what: `Each time an assistant reads or changes your Kivo through the connector. ${READS_AND_WRITES}`,
      atLimit: 'There is no monthly number on your plan. Limits on very heavy or automated use, such as many calls a minute, still apply to protect Kivo.',
    })
  } else {
    const readFigure = `${n(m.readOnlyUsed ?? 0)} of ${n(m.readOnlyLimit ?? 0)} reads`
    const readExtra = { label: 'Read calls this month', figure: readFigure, pct: m.readOnlyLimit ? pctOf(m.readOnlyUsed ?? 0, m.readOnlyLimit) : null, renews: renewsOn(m.readOnlyResetsAt, o) }
    rows.push({
      key: 'mcp', name: 'ChatGPT and Claude', used: m.lifetimeUsed, limit: m.lifetimeLimit,
      figure: `${n(Math.min(m.lifetimeUsed, m.lifetimeLimit))} of ${n(m.lifetimeLimit)} calls`,
      left: m.readOnly ? null : `${n(Math.max(0, m.lifetimeLimit - m.lifetimeUsed))} left`,
      pct: pctOf(m.lifetimeUsed, m.lifetimeLimit),
      state: m.readOnly ? 'read_only' : stateOf(m.lifetimeUsed, m.lifetimeLimit),
      renews: 'Lifetime: these calls don’t reset',
      what: `Each time an assistant reads or changes your Kivo through the connector. Free includes ${n(m.lifetimeLimit)} calls in total; after them, assistants can still read your Kivo, ${n(m.readOnlyLimit ?? 0)} times a month. ${READS_AND_WRITES}`,
      atLimit: atLimit(a.enforced.mcp, a.mode, m.readOnly
        ? 'Changes from ChatGPT and Claude are paused. Reading still works, up to the monthly reads, and starts again each month.'
        : 'After them, changes from ChatGPT and Claude pause, and reading continues within the monthly reads.'),
      ...(m.readOnly ? { extra: readExtra } : {}),
    })
  }
  return rows
}

// How the account's allowances compare with the next plan on sale.
export interface CompareLine { name: string; now: string; next: string }
export function compareLines(now: TierAllowance, next: TierAllowance): CompareLine[] {
  const mcp = (t: TierAllowance) => t.mcpLifetime === null ? 'Fair use' : `${n(t.mcpLifetime)} calls, then ${n(t.mcpReadOnly ?? 0)} reads a month`
  return [
    { name: 'Nova credits a month', now: n(now.novaCredits), next: n(next.novaCredits) },
    { name: 'Browser-agent tasks a month', now: n(now.browserTasks), next: n(next.browserTasks) },
    { name: 'Images and attachments', now: bytes(now.storageBytes), next: bytes(next.storageBytes) },
    { name: 'ChatGPT and Claude', now: mcp(now), next: mcp(next) },
  ]
}

// ── Founder review #05: the whole matrix, and a prompt where it helps ──

export interface PlanColumn { tier: Tier; name: string; price: string; onSale: boolean; current: boolean }
// Every plan side by side, from the server's table (billing/offer.ts planCatalog).
export function planMatrix(catalog: Record<Tier, TierAllowance>, cols: PlanColumn[]): Array<{ name: string; cells: string[] }> {
  const mcp = (t: TierAllowance) => t.mcpLifetime === null ? 'Fair use' : `${n(t.mcpLifetime)} calls, then ${n(t.mcpReadOnly ?? 0)} reads a month`
  const pick = (f: (t: TierAllowance) => string) => cols.map(c => f(catalog[c.tier]))
  return [
    { name: 'Nova credits a month', cells: pick(t => n(t.novaCredits)) },
    { name: 'Browser-agent tasks a month', cells: pick(t => n(t.browserTasks)) },
    { name: 'Images and attachments', cells: pick(t => bytes(t.storageBytes)) },
    { name: 'ChatGPT and Claude', cells: pick(mcp) },
    { name: 'Progress and Learning DNA', cells: pick(() => 'Included') },
  ]
}

// A line under a row that is running low or used up, naming what the next
// plan on sale gives for that allowance. Only for a plan on sale now (the
// server's nextOffer); never when the next plan gives no more of it.
export function upgradeHint(row: Pick<UsageRow, 'key' | 'state'>, offer: { name: string; allowance: TierAllowance } | null, now: TierAllowance | null): string | null {
  if (!offer || (row.state !== 'low' && row.state !== 'used_up' && row.state !== 'read_only')) return null
  const a = offer.allowance
  switch (row.key) {
    case 'nova': return now && a.novaCredits <= now.novaCredits ? null : `${offer.name} gives ${n(a.novaCredits)} Nova credits a month.`
    case 'browser': return now && a.browserTasks <= now.browserTasks ? null : `${offer.name} gives ${n(a.browserTasks)} browser-agent tasks a month.`
    case 'storage': return now && a.storageBytes <= now.storageBytes ? null : `${offer.name} gives ${bytes(a.storageBytes)} for images and attachments.`
    case 'mcp': return a.mcpLifetime === null ? `On ${offer.name}, ChatGPT and Claude are fair use, reads and writes.` : null
  }
}
