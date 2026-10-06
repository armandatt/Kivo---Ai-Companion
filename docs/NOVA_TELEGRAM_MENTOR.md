# Nova on Telegram (Mentor V1)

Telegram is a surface over Nova, not a second Nova. It owns no session, plan, mastery, memory, reality or timer. Every state change it causes goes through a function the web app also calls.

```
update ─ admit (secret, update_id) ─ normalise ─┬─ command  ─┐
                                                 ├─ callback ─┼─ action ─ product function ─ reply
                                                 └─ text ─ Understanding (1 call, with context)
                                                           └─ safeReading (pure): what of it may be used
                                                           └─ decideAction (pure): what is allowed ─┘
                                                              └─ canonical turn: log, evidence, consolidation,
                                                                 Response Brain only if the reply needs wording
```

## Where things live

| Concern | File | Notes |
|---|---|---|
| Update → event | `nova/telegram/telegram-event.ts` | Pure. Private chats only. Callback data is `p:<promptId>:<optionId>`. |
| One update, start to finish | `nova/telegram/telegram-turn.ts` | The only orchestration. No early-return gate chain. |
| What an action does | `nova/telegram/telegram-actions.ts` | Calls `runNovaSessionCommand`, `loadNovaToday`, `recordStatedMinutes`, `addExam`. No DB client. |
| Reply text and buttons | `nova/telegram/telegram-replies.ts` | Pure templates over the Today and session views. Also the no-model fallback. |
| Open question | `nova/telegram/prompt-store.ts` | Only writer of `NovaTelegramPrompt`. |
| Limits, lease, delivery state | `nova/telegram/channel-store.ts` | Only writer of `NovaTelegramChannel`. |
| Delivery | `nova/telegram/telegram-client.ts` | Reports sent / blocked / rate-limited / unknown. |
| Account linking | `nova/telegram/telegram-link.ts` | Expiry, single use, one chat per account, sets the Nova persona. |
| What of a reading may be used | `nova/decision/interpretation-safety.ts` | Pure. Noise becomes a neutral reading; an unclear one keeps only the feeling and circumstance; values are range-checked. |
| Reading → action | `nova/decision/action-decision.ts` | Pure. Preconditions per action; confidence is only a floor. |
| Tone | `nova/decision/register.ts` | Pure. serious / steady / playful. |
| Proactive decision | `nova/decision/proactive-decision.ts` | Pure. Candidates, gates, rank. |
| Proactive delivery | `nova/proactive/proactive-outbox.ts`, `nova-proactive-cron.ts` | Only writer of `NovaProactiveMessage`. |

## Rules that must hold

- **One reader of meaning.** Free text goes to the Understanding Brain once, with a context block (today's date, the running session, the open question). The orchestrator is handed that reading and does not read the message again. No regex, keyword list, yes/no parser or disambiguation pass exists on the Telegram path; `telegram-mentor.test.ts` reads the source to hold this.
- **A reading is a proposal, and confidence is not permission.** The model can be wrong and sure of it. `safeReading` decides what of a reading may be used at all; `decideAction` then checks each action's own preconditions against the reading and the real state. A reading that fails them becomes an offer or a question.

  | Action | Runs only when | Otherwise |
  |---|---|---|
  | Start a session | an explicit start request that names a topic today's plan has, with no session open; or the answer to a Start option | the offer, with Start buttons |
  | Pause / resume | an explicit request and a session in the matching state | the session's status |
  | End a session | never from a sentence; the answer to "How did it go?" | "How did it go?" |
  | Add an exam | never from a sentence; the Add option, which exists only for one of the learner's subjects with no exam that day | nothing is offered |
  | Pause nudges for the day | an explicit "not today" (`deferUntil: tomorrow`) | "Later", which pauses nothing |
  | Record stated time | minutes in a clear message, no session open | not recorded |
  | Change an open offer | minutes stated while a Start offer is open | re-offered at that length; nothing starts |

  Nothing that changes state runs when `clarity` is not `clear`, or when the message takes back what it asks for (`changeOfMind`).
- **Noise does nothing.** A reading marked `unintelligible` is replaced by a neutral one before anything sees it, is answered with a question, and does not enter the canonical turn: no signal, evidence, consolidation job or state. Only the conversation log records it. `ambiguous` and `unsupported` readings keep the feeling and any stated circumstance and lose everything they could act or record on.
- **The Response Brain cannot claim an action.** It is asked to word a result only when the operation succeeded, and is told exactly what was done. On a turn with no action it is told nothing was done. A failed operation is stated by its template.
- **Ending a session needs an outcome.** `/done`, the End button and "I finished" all ask "How did it go?". The answer (a tap, or a typed reply read against that open prompt) is the confirmation, and it is what calls the canonical `end` command.
- **One open prompt per learner.** `openKey` is unique while a prompt is open. Resolving is one conditional write, so a double tap, an old button, a replaced prompt, an expired prompt and another learner's prompt id all change nothing.
- **Nothing in process memory.** The prompt, the turn lease, the action limiter and the model budget are rows in Postgres.
- **"Started" and "Logged" are said after the write is read back**, never before.
- **The turn starts and ends no session itself.** `sessionCommands: "surface"` makes `sessionLifecycle` skip start / pause / resume / end; only a confusion point on a running session is still recorded.
- **Evidence is not memory.** Reality observations, signals and the new `topic_struggle` signal go through the existing consolidation job. Telegram writes no `UserFact`, `UserReality` or `BehavioralPattern`.

## What changes state, and what can then differ

| Learner says | Canonical write | What reads it later |
|---|---|---|
| Start (tap, or confident request) | `openStudySession` via `runNovaSessionCommand` | Focus page, `/status`, proactive gate |
| Struggled / Okay / Good / Crushed it | `persistSessionEnd`: report, FSRS mastery update, mastery snapshot, Learning DNA refresh, consolidation job | Knowledge, Progress, Today, Planner, review schedule |
| "I've only got 30 minutes" | `NovaAcademicProfile.statedMinutes` + local day (`recordStatedMinutes`) | Today and Planner on every surface, until the learner's day ends |
| "I can't study tonight, family stuff" | reality claim → consolidation → `UserReality` (temporary, expiring); proactive paused to local midnight | Today constraints, register, proactive gates |
| "family thing is sorted" | reality resolution → consolidation | the same |
| "I keep messing up deadlocks" | `topic_struggle` → consolidation → soft mastery observation (0.15 weight, no interval change, no review counted), at most once per topic per 20 h | Knowledge, Today's weak area, plan ranking |
| "I have my OS exam Friday" | nothing until the learner taps Add; then `addExam`, under the subject the title names | Exam engine, plan, exam countdown |
| "exam is tomorrow" (no subject) | nothing, and nothing is offered | — |
| "asdfghjkl" | nothing | — |
| "Not today" (button or typed) | `NovaTelegramChannel.proactivePausedUntil`, to the learner's local midnight | proactive gate |

Not stored: raw updates, parsed intents as state, a Telegram transcript (the conversation log is `CompanionMessage`, as for the web), any Telegram copy of a session.

## Proactive messages

Four reasons only: `exam_countdown` (the Today view's `daysUntil` ≤ 3), `review_due`, `missed_plan_recovery` (no session for 2 to 7 local days, keyed by the last day studied, so once per lapse) and `daily_nudge`. All candidates are generated, then gated, then ranked.

- **Silence unless**: nudges on, chat deliverable, a real timezone stored, not paused, not 23:00–07:00 local, no session running, no message from the learner in 30 minutes, fewer than two delivered today, four hours since the last, no health or injury reality.
- **Study pressure also needs**: the learner's window (Learning DNA's usual window once supported, else what they said in setup, else 17:00–20:00), no emotional or life constraint, nothing studied today, no earlier push today.
- **Outbox**: `claimed → ready → sending → sent`. The claim is the unique `(profileId, occurrenceKey)`. Text is stored before sending, so a retry does not ask the model again. A send with no answer becomes `unknown` and is never resent. Only `sent`, `sending` and `unknown` count toward the cap. A decision not to send writes nothing.
- **Timing is a window**, never a minute. A late tick still finds the window open.
- **A retry is asked again.** A message approved on an earlier tick and not yet delivered goes out only if `holdReason` (the same gates, with what is true now) allows it; held, it waits, and is dropped when its three-hour retry window passes. A session finished in the last 30 minutes counts as recent contact, like a message.
- **Web-only learners are never messaged**: the tick selects `platform: "telegram"` rows.

## Model calls

| Input | Calls |
|---|---|
| Command, button, stale prompt, limit notice | 0 |
| Free text with a plain answer | 1 (Understanding, fast tier) |
| Free text that carries a feeling or a circumstance, or is conversation | 2 (Understanding + Response Brain) |
| Proactive message | 1 (wording), or 0 past the daily budget |

Per-learner daily budgets: `NOVA_TELEGRAM_DAILY_UNDERSTANDING` (default 150) and `NOVA_TELEGRAM_DAILY_RESPONSES` (default 40). Past the first, Nova answers with buttons. Past the second, with the plain template. If either model fails, the action already taken stands and the template is sent.

## Tone (product decision made here; change it in one place)

The static layer keeps "never shame or guilt-trip" and "no emoji unless the student uses them". Teasing is allowed only when the register is `playful`, which requires the learner's explicit "push me hard" answer and none of: a heavy emotion, an active reality constraint, an exam within three days. Teasing is about a habit the evidence shows, never the person. There are no joke templates.

## Deploying

1. `(cd packages/db && npx prisma db push)` first. Additive: two tables (`NovaTelegramPrompt`, `NovaTelegramChannel`), new columns on `NovaProactiveMessage`, `NovaAcademicProfile` and `UserProfile`.
2. Set `TELEGRAM_WEBHOOK_SECRET` on the API and register the webhook with the same `secret_token` and `allowed_updates` including `message` and `callback_query`. **In production Nova ignores every update without a valid secret.** Rex is unchanged by this.
3. Set `NEXT_PUBLIC_APP_URL` (https) on the API for "Open Nova" buttons.
4. Deploy. Connect links issued before the deploy have no expiry on record and are refused; the dashboard issues a new one.
5. Before real learners, and after any change to the Understanding prompt or the action decision: `npx tsx --tsconfig tsconfig.json scripts/novaTelegramEval.ts 3`. Each case lists the decisions that are right and the ones that would corrupt state; the run exits 1 on any of the second kind.

| Variable | Purpose |
|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | Required for Nova in production |
| `NOVA_PROACTIVE_DISABLED=true` | Stops Nova messaging first, no deploy needed |
| `NOVA_TELEGRAM_DAILY_UNDERSTANDING`, `NOVA_TELEGRAM_DAILY_RESPONSES` | Per-learner daily model budgets |
| `TELEGRAM_API_BASE` | Test seam for the Bot API address |

**Rollback.** The schema change is additive, so the previous build runs against the new schema and ignores the new columns and tables. To stop only the proactive messages, set `NOVA_PROACTIVE_DISABLED=true`; no deploy is needed.

## Watching it

One JSON line per update, `layer: "nova_telegram"`, with a `correlationId`, the input type, whether Understanding ran and how long it took, the decision, the operation and its result, evidence kinds, whether a reply was generated or fell back, the send status and Telegram's message id, and a `failure` category. No message text is logged, only its length. Proactive sends log `layer: "nova_proactive"` with the occurrence and outcome.

Worth alerting on: `failure` of `internal`, `operation_failed`, `understanding_failed`; proactive `outcome` of `unknown` or `blocked`; outbox rows stuck in `claimed` or `ready`.

## Known limits

- Telegram is optional. A Nova account is a learner from its first request (`nova/product/learner-identity.ts`); its row is keyed `web:<userId>` until a chat is connected, when `telegram-link.ts` re-keys that same row to the chat. There is no unlink: once connected, the chat is the learner's key.
- A chat that already holds a Nova learner, or a finished Rex setup, cannot be connected to an account that has its own Nova learner. It is refused, not merged.
- Token counts in the turn log are estimates; the shared model client does not report usage.
- Templates are English only.
- Quiet hours are fixed at 23:00–07:00 local.
- The connect limiter and one-chat-per-account rule are enforced in code, not by a database constraint.
- What the real model reads from messy text is not covered by automated tests, which use recorded model outputs (including the wrong ones the model really gave). The evaluation script is the check, and it needs a model key.
- A start asked for in words runs only for a topic or subject on today's plan. A topic the learner has but today's plan does not is offered, one tap from starting.
- An exam is offered from chat only for one of the learner's own subjects. Any other exam is added in the Planner.
- A session left running is never closed by Nova. It ends when the learner ends it.
- The same Understanding Brain reads web chat, where `sessionIntent: "start"` can still start a session from a sentence. This hardening covers the Telegram path only.
