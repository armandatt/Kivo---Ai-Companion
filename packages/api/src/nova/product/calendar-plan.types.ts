// ─── Calendar planning: the contract with the calendar page ─────────────────
// What POST /api/nova/calendar/plan answers (calendar-planner.ts). No imports,
// so the web app imports this file directly.

export interface PlanSettingsView { dayStart: number; dayEnd: number; focusPerDay: number; bufferMinutes: number; horizonDays: number }
export interface PlanTaskView { id: string; title: string; minutes: number; estimated: boolean; dueDay: string | null; overdue: boolean; priority: "low" | "medium" | "high" | null; subjectName: string | null; topicName: string | null }
export interface MissedBlock { eventId: string; key: string; taskId: string; taskTitle: string; startAt: string; endAt: string; day: string }
export interface ProposalView { taskId: string; title: string; day: string | null; startAt: string | null; endAt: string | null; startTime: string | null; endTime: string | null; minutes: number; late: boolean; split: boolean; reason: string | null }
export interface DayLoad { day: string; busyMinutes: number; plannedMinutes: number; freeMinutes: number; capacityMinutes: number }
export interface CalendarPlanView {
  ok: true; today: string; timezone: string; settings: PlanSettingsView;
  unscheduled: PlanTaskView[]; missed: MissedBlock[]; proposals: ProposalView[]; workload: DayLoad[];
}
export type CalendarPlanResult = CalendarPlanView | { ok: false; error: "invalid" | "failed"; message: string };
