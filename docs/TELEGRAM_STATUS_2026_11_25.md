# Telegram bot: status (founder review #08, 25 Nov 2026)

The review marked Telegram as "pending" with no list of what was missing. This audit read the implementation (`packages/api/src/nova/telegram/`, `apps/api/app/api/telegram/route.ts`), `docs/NOVA_TELEGRAM_MENTOR.md`, and ran every Telegram test.

## Tests run

| Suite | Result |
|---|---|
| Jest: `telegram-mentor`, `telegram-hardening`, `semantic-interaction`, and the other Telegram tests | 289 / 289 pass (including 2 added today) |
| Real Postgres: `nova-telegram`, `nova-telegram-acceptance`, `nova-hardening`, `nova-first-use`, `nova-unlinked-chat` | 157 / 157 pass |

### Re-verified (second pass, same day)

| Suite | Result |
|---|---|
| Jest: telegram, semantic-interaction, first-use, reply-language, grounded-reply | 363 / 363 pass |
| Real Postgres: nova-telegram, -acceptance, -hardening, -first-use, -unlinked-chat, -language, nova-exams, usage-enforcement, usage-accounting | 224 / 224 pass |

**Account limits**, checked in code and tests:
- **Telegram can't bypass them.** Its Understanding call reserves from the account's own Nova credits; `usage-enforcement.itest.ts` holds that "Telegram's turn is refused once the month's credits are used".
- **If billing can't be read,** the chat gets Free's allowance, never an unlimited one (`telegram-turn.ts`).
- **A retried update** reserves once, keyed by `telegram:<chat>:<update_id>`.
- **Exam dates** use the learner's calendar days, the same as Today (`nova-exams.itest.ts`).

## Implemented and covered by tests

- **Webhook:** secret-token check, update dedup (`ProcessedTelegramUpdate`), one reply per update, typing indicator, timings logged per turn.
- **Account linking:** `/start <token>` re-keys the web learner to the chat. A linked chat with no row gets Nova, never Rex.
- **First message:** decided by `first-use.ts`, sent once per chat.
- **Conversation:** one Understanding call, then `safeReading` and `decideAction`, then shared actions, then the canonical turn. No regex classifiers.
- **Commands:** `/today`, `/week`, `/progress`, `/done`, `/help`; the chat's command menu is set per chat.
- **Buttons:** one open prompt per learner, resolved with one conditional write.
- **Sessions:** start, pause and end. Ending asks "How did it go?".
- **Plan changes from chat:** skip, add or reorder today, with Undo.
- **Languages:** English and Hinglish (chosen language held; explicit switch).
- **Proactive messages:** outbox, at most two a day, quiet hours, life-context holds.
- **Model failures:** deadlines per call; a busy or broken model gets a different reply from an unreadable message.
- **Entitlements:** the Understanding call reserves the learner's Nova credits (`reserveForInteraction`, feature `telegram_understanding`). Every model call is tagged `telegram_*` (Nova credits, the same account balance as the web). When credits run out the reply is `TEXT.creditsUsed`, which names no plan.
- **Rate limits:** the webhook is in Phase 5's `webhook` category. Per-chat limits are in the channel store.

## Bugs confirmed

None in this audit: every Telegram test passes, and the code paths above match their documentation.

## Incomplete features (documented gaps)

| Gap | State |
|---|---|
| Exam shortfall not said on Telegram | **Fixed today.** `/today` and the plan reply now include `shortfall.summary` (the same sentence Today shows) and the two ways to change it. Tests added in `semantic-interaction.test.ts`. |
| Reminders from a sentence | Deliberately unsupported: answered "nothing was scheduled". Reminders exist only on calendar events made on the web. Building them needs a product decision (timezone source, outbox type). |
| Moving or removing an exam from chat | Web only (`/settings/study#exams`). Needs a product decision on confirmation wording. |
| A second message while the first is being recorded | Answered "Still on your last message"; not queued. Queueing needs a timer, which the tests currently forbid. |
| Bot display name (K-28d) | Blocked on the owner (BotFather). |

## Missing tests

- The live webhook path with a real Telegram update over HTTP against a deployed API. Covered today by `scripts/e2e` locally, not in CI.
- `scripts/novaTelegramEval.ts` against the production model after any Understanding prompt change. It needs a model key, so it is not run here.

## Next steps (proposed, each needs an owner decision)

1. Decide on reminders from chat (the outbox exists; the reading of times needs a rule).
2. Add exam editing to Telegram with confirmation buttons.
3. Run `novaTelegramEval.ts` against the live model before the Bennett onboarding week.
