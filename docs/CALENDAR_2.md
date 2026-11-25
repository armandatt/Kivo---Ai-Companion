# Calendar 2.0: planning time for learning work

Branch `feature/calendar-2` (local, not pushed). The calendar connects **tasks → time → focus → done** without a second task system: a task stays one `NovaTask` (Planner/board), and time set aside for it is an ordinary `NovaCalendarEvent` with `taskId` (category `study`). No schema change.

## Research (25 Nov 2026, official pages)

| Product | What is genuinely useful | For Kivo |
|---|---|---|
| Motion ([auto-scheduling](https://www.usemotion.com/help/time-management/auto-scheduling), [behind the scenes](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes)) | Weighs deadline, priority and duration together; flags "could not fit"; reschedules past-due work | **Adopted** the ordering and the honest "could not fit". **Rejected** silent automatic moves: Kivo proposes, the learner adds. |
| Reclaim ([features](https://help.reclaim.ai/en/articles/6210740-reclaim-s-features), [buffers](https://reclaim.ai/features/buffer-time), [habits](https://reclaim.ai/features/habits)) | Focus-time goals, buffers between blocks, habits | **Adopted** buffers and a daily focus limit. Habits: future (Kivo's repeating events cover simple routines). |
| Sunsama ([daily planning](https://help.sunsama.com/docs/daily-planning), [timeboxing](https://sunsama.com/features/timeboxing)) | Estimates feed a visible daily workload; a realistic-day ritual | **Adopted** the per-day workload line (planned vs free). A guided ritual: future. |
| Akiflow ([features](https://akiflow.com/features), [universal inbox](https://akiflow.com/universal-inbox)) | An inbox of tasks waiting to be time-blocked; fast drag to calendar | **Adopted** the "Needs time" list. Drag from it: future. |
| Morgen ([AI planner](https://www.morgen.so/ai-planner)) | AI plans shown as previews; nothing hits the calendar without approval; capacity and at-risk checks | **Adopted** proposals-as-previews and "late" warnings. |
| Superfocus ([App Store](https://apps.apple.com/us/app/superfocus/id6756355064)) | Goals with their to-dos turned into planned time | Kivo already links tasks to subjects and topics; proposals carry them. |
| Google Calendar | Reliable day/week/month/agenda, recurrence, keyboard navigation | **Adopted** a Day view and D/W/M/A, ←/→, T shortcuts. |

## Before (audit)

Month, Week and Agenda views; events (timed/all-day, daily/weekly/monthly repeats, skipped occurrences, Telegram reminders); tasks shown on their due day; exam/assignment deadlines; "Set aside time on the calendar" from a task; range queries capped at 62 days. Missing: a Day view, anything for tasks without time, suggestions, workload, missed blocks, focus from the calendar.

## Built

- **`product/calendar-plan.ts`** (pure, tested): `proposeTimes` orders tasks (due day → priority → shorter first), searches working hours from now (rounded to 15 min) over 14 days, avoids every timed event plus a buffer, caps planned work per day (existing study blocks count), proposes on or before the due day or marks the earliest later slot **late** with the reason, or **could not fit**. A task over 3 h gets its first 3 h block (marked). `isMissed` finds blocks whose task stayed open.
- **`product/calendar-planner.ts`** + `POST /api/nova/calendar/plan` (reads only): unscheduled tasks (no block from now on), missed blocks (last 7 days, one per task), proposals, and the next 7 days' load (busy, planned, free).
- **Page**: Day view (one-day timeline, now-line, scroll to now); Week/Day heads show each day's load; **Plan your time** panel (collapsed by default): Missed (Find a new time / I did it), Needs time (estimate, due, priority, subject › topic; Find a time; Focus now), proposals with Add to calendar / Not now, Find times for all + Add all, working-hours and daily-focus settings. Keyboard: ←/→, T, D, W, M, A.
- **Control**: nothing is written until **Add to calendar**; the block is created through the existing calendar route with a key from task + start, so a double click makes one block. "I did it" marks the task done through the tasks route.

## Not built (honest limits)

- **Nova planning chat** ("plan my week around my exams") is not wired: proposals are deterministic today. The natural next step is a Nova tool that calls `planCalendar` and returns the same proposals for the learner to accept, never writing on its own.
- Working hours and daily focus live in the browser (localStorage), not the account.
- No drag-and-drop from Needs time to the grid; no automatic re-plan on deadline change (the panel recomputes whenever the calendar or tasks change, and the learner re-adds).
- No external calendar sync (Google/Outlook): none exists in Kivo; documented as future.
- Focus starts only for a task filed under a subject and topic (the session engine studies topics).
