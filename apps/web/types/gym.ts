export type GymData = {
  streak:             number
  sessionsThisWeek:   number
  plannedThisWeek:    number
  consistencyScore:   number
  volumeThisWeekKg:   number
  splitType:          string
  daysPerWeek:        number
  splitDays: Array<{
    dayName:     string
    muscles:     string
    isRest:      boolean
    isToday:     boolean
    isCompleted: boolean
  }>
  todayMuscles:    string | null
  gymTimeStr:      string | null
  minutesUntilGym: number | null
  nextSessionMuscles: string
  nextSessionTargets: Array<{
    exercise:     string
    nextWeightKg: number
    reps:         number
    flag:         "increase" | "maintain" | "technique_check" | "rep_increase" | null
    note:         string
  }>
  mainLifts: Array<{
    exercise:  string
    currentKg: number
    deltaKg:   number
    isPR:      boolean
    trend:     number[]
  }>
  flags:               string[]
  interventionMessage: string | null
  weeklyVolume: Array<{
    muscle: string
    sets:   number
    target: number
  }>
  heatmap: Array<{
    date:    string
    trained: boolean
    rpe:     number | null
  }>
  avgRpe:         number | null
  rpeDescription: string
}
