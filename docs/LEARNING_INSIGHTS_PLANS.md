# Learning DNA and Progress on paid plans: decision needed (founder review #07, #09)

Status: **blocked pending the owner's decision. No access was changed.**

## 1. Live today, on every plan (unchanged)

Checked 25 Nov 2026: no Learning DNA or Progress code or route reads a plan or tier. `apps/web/components/nova/learning-dna`, `components/nova/progress`, `/api/nova/learning-dna` and `/api/nova/progress` all serve every account the same.

- **Learning DNA** (`/learning-dna`):
  - Usual session length, time of day (once the timezone is known) and comparisons from "How did it go?" answers.
  - Each comes with its evidence level and whether it is weakening.
  - "What Nova doesn't know" lists what is not computed.
- **Progress** (`/progress`):
  - Counted sessions and active days, and the consistency trend.
  - Topic growth (mastery history), journey events, comebacks and recent sessions.
  - What was not counted, and why.
- **Free, Plus and Pro** all show both in full: pricing page, `plans.ts` Free features, and Plan and usage ("Included" in the comparison).

## 2. Proposed, not built, not approved

The paid layer in section "Proposal" below. Nothing in it exists in code. It must not be advertised, priced or gated until approved.

## 3. Needs the owner's explicit approval

Listed at the end ("What is needed from the owner"). Until then, sections 1 and 2 stay as they are.

## What the review asks

- Make Learning DNA a Plus and Pro feature.
- Give Progress Reports a Free and paid split, with premium sections locked behind an upgrade.

## What the canonical product decisions say today

- **`docs/PLAN_AND_USAGE.md`:** "Progress and Learning DNA are included in full on every plan. Nothing about a person's own learning history is behind a paid plan." Also: "No Pro-only analytics: Learning DNA and Progress have no capability beyond what every plan already gets, so nothing is labelled Pro-only. Packaging a deeper analysis for Pro needs that analysis to exist first; it would be a separate, approved piece of work."
- **`plans.ts`:** Free's features list "Progress and Learning DNA". The pricing page and the Plan and usage page say the same.
- **`CLAUDE.md` (Learning DNA):** distraction, burnout, preferred formats, focus and energy are **not computed**, because nothing on record supports them.

So there is no "advanced" Learning DNA or Progress today to put behind a plan. Locking what exists would hide a learner's own history from them, which both the brief and the current product rules forbid. Inventing a paid section with nothing behind it would be a false feature. Either way, it conflicts with the plan matrix, which needs your approval to change.

## Proposal (section 2): a real premium layer

These are new capabilities, built on records Kivo already keeps. None of them hides or removes anything a learner has today.

| Capability | Built from | Plan (proposal) |
|---|---|---|
| **Monthly learning report**: a written review of the month (topics moved, comebacks, what was planned against what was done, the next month's focus), generated once a month and kept | Progress read model, mastery history, Today flows, tasks; one model call a month | Plus and Pro |
| **Long-range patterns**: Learning DNA signals over 6 to 12 months instead of 90 days, showing how each changed (session length, time of day, the effect of planning) | `NovaStudySession`, `NovaLearningDNA.signals` history | Pro |
| **Exam readiness forecast**: per exam, the topics not yet solid against the days left, with a recommended weekly load (stated as an estimate) | `examShortfall`, retention schedule | Plus and Pro |
| **Export of a learner's own history** (CSV or PDF) | Progress, Learning DNA | Every plan (it is their data) |

Enforcement would sit on the server: a `capabilities` field in `billing/access.ts` (`insights.monthly_report`, `insights.long_range`), checked by each new route. Nothing would be hidden in the browser alone. After a downgrade, reports already generated stay readable; only new generation stops.

## What is needed from the owner

1. Approve or change the table above (the features and their plans).
2. Confirm that today's Progress and Learning DNA stay free in full. This document recommends that they do.
3. Then the paid layer is built as its own reviewed piece of work, with the pricing page and `plans.ts` features updated in the same change.
