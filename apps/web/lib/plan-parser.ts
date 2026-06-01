type DayAbbr = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"

const DAY_ORDER: DayAbbr[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// Matches a day label at (or near) the start of a line, possibly preceded by
// list markers or numbering like "1. Monday:" or "- Mon:"
const DAY_HEADER_RE =
  /^[\s\d.\-*#>]*\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i

function normAbbr(raw: string): DayAbbr {
  const l = raw.toLowerCase()
  if (l.startsWith("mon")) return "Mon"
  if (l.startsWith("tue")) return "Tue"
  if (l.startsWith("wed")) return "Wed"
  if (l.startsWith("thu")) return "Thu"
  if (l.startsWith("fri")) return "Fri"
  if (l.startsWith("sat")) return "Sat"
  return "Sun"
}

// Strips the separator after the day label and splits comma-separated items.
// Handles:  ": task1, task2"  |  " (Jun 3): task1"  |  " — task1"
function extractInlineTasks(afterLabel: string): string[] {
  const stripped = afterLabel.replace(/^\s*(?:\([^)]*\))?\s*[:—\-]+\s*/, "").trim()
  if (!stripped) return []
  return stripped.split(/\s*,\s*/).map((s) => s.trim()).filter((s) => s.length > 1)
}

// Removes leading bullet/number prefix from a task line
function cleanTaskLine(line: string): string {
  return line.trim().replace(/^[\-*•·>]+\s*/, "").replace(/^\d+[.)]\s*/, "").trim()
}

export interface ParsedPlanDay {
  dayAbbr: DayAbbr
  tasks: string[]
}

// Core parser: converts AI-generated plan prose into per-day task arrays.
// Lenient — skips unrecognisable lines rather than throwing.
export function parsePlanContent(content: string): ParsedPlanDay[] {
  const lines = content.split(/\r?\n/)
  const dayMap = new Map<DayAbbr, string[]>()
  let current: DayAbbr | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const m = line.match(DAY_HEADER_RE)
    if (m) {
      current = normAbbr(m[1])
      const afterLabel = line.slice(m[0].length)
      const inline = extractInlineTasks(afterLabel)
      if (!dayMap.has(current)) dayMap.set(current, [])
      dayMap.get(current)!.push(...inline)
      continue
    }

    if (current) {
      const text = cleanTaskLine(line)
      if (text.length > 1) {
        if (!dayMap.has(current)) dayMap.set(current, [])
        dayMap.get(current)!.push(text)
      }
    }
  }

  return DAY_ORDER.filter((d) => (dayMap.get(d)?.length ?? 0) > 0).map((d) => ({
    dayAbbr: d,
    tasks: dayMap.get(d)!,
  }))
}

export interface BuiltTask {
  id: string
  title: string
}

export interface BuiltWeekDay {
  date: string
  tasks: BuiltTask[]
}

// Maps parsed plan onto 7 ISO date strings (Mon–Sun of the current week).
// Task IDs are stable: `${planId}_${dayAbbr}_${index}`.
export function buildWeekDays(
  planContent: string | null,
  planId: string | null,
  weekDates: string[] // 7 ISO date strings, index 0 = Monday
): BuiltWeekDay[] {
  const parsed = planContent ? parsePlanContent(planContent) : []
  const byAbbr = new Map(parsed.map((d) => [d.dayAbbr, d.tasks]))
  const pid = planId ?? "local"

  return weekDates.map((date, i) => {
    const abbr = DAY_ORDER[i]
    const raw = byAbbr.get(abbr) ?? []
    return {
      date,
      tasks: raw.map((title, j) => ({ id: `${pid}_${abbr}_${j}`, title })),
    }
  })
}

// Returns today's tasks extracted from plan content.
export function parseTodayTasks(
  planContent: string | null,
  planId: string | null
): BuiltTask[] {
  if (!planContent) return []
  const parsed = parsePlanContent(planContent)
  const dayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const todayAbbr = DAY_ORDER[dayIdx]
  const entry = parsed.find((d) => d.dayAbbr === todayAbbr)
  if (!entry) return []
  const pid = planId ?? "local"
  return entry.tasks.map((title, i) => ({ id: `${pid}_${todayAbbr}_${i}`, title }))
}
