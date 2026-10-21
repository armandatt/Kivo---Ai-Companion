'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Send } from 'lucide-react';
import { AUDIENCES, AUDIENCE_LABEL, type Audience } from '@repo/api/nova/product/first-focus';
import {
  CREATURE_NAME_MAX, DEFAULT_CREATURE_NAME, ONBOARDING_V3, V3_FIELDS, checkCreatureName, checkOnboardingV3, type OnboardingFieldV3,
} from '@repo/api/nova/product/onboarding-answers';
import {
  OBSTACLE, OBSTACLES, OBSTACLE_LABELS, WEEKLY_HOURS_MAX, WEEKLY_PRESETS, WORKING_ON_LABELS, checkWeeklyHours, workingOnOptions,
  type ObstacleId, type TelegramAnswer, type WeeklyPresetId, type WorkingOnId,
} from '@repo/api/nova/product/onboarding-options';
import { TONE_OPTIONS, accountabilityOfTone, type Tone } from '@repo/api/nova/product/tone';
import type { ReplyLanguage } from '@repo/api/nova/types/understanding.types';
import { KivoMark } from '@/components/brand/kivo-brand';
import { Choice, CustomEntries, MultiChoice, Question } from '@/components/onboarding/answer-controls';
import { ConnectAction } from '@/components/nova/telegram-connect';
import { useTelegramLink } from '@/components/nova/use-telegram-link';
import { cn } from '@/lib/utils';

// Web onboarding (v3). An opening screen, then one question per screen:
//   what you do → what you're working on → time each week → what gets in the
//   way → language → tone → Telegram → (Nova) → your creature's name → done.
// Every answer has a reader; packages/api/src/nova/product/onboarding-answers.ts
// lists each one. The server checks and stores them (POST /api/onboarding);
// this page only collects them, and shows that they were saved only once the
// server says so. Finishing twice changes nothing.
//
// Always the dark theme: the page sits in a .kivo-dark region, whatever the
// learner chose for the dashboard.

type Multi<Id extends string> = { selected: Id[]; custom: string[] };

type Draft = {
  audience:     Audience | null;
  workingOn:    Multi<WorkingOnId>;
  weekly:       { preset: WeeklyPresetId | 'custom' | null; hours: string };
  obstacles:    Multi<ObstacleId>;
  language:     ReplyLanguage | null;
  tone:         Tone | null;
  telegram:     TelegramAnswer | null;
  creatureName: string;
};

const EMPTY: Draft = {
  audience: null, workingOn: { selected: [], custom: [] }, weekly: { preset: null, hours: '' },
  obstacles: { selected: [], custom: [] }, language: null, tone: null, telegram: null, creatureName: DEFAULT_CREATURE_NAME,
};

// A half-finished onboarding survives a refresh and back navigation: this
// tab's session storage, cleared when the tab closes and once the answers
// are saved.
const DRAFT_KEY = 'kivo-onboarding-draft-v3';

// The Nova reveal and the naming moment, kept from the earlier flow: Nova's
// name fades in large and spaced, the line under it a beat later, the button
// once both have landed; the creature's name holds the screen while saving.
const NOVA_TAGLINE = 'Steady. Structured. Always here.';
const REVEAL_BUTTON_MS = 2000;
const NAMING_MS = 1500;
const SCENE_CSS = `
@keyframes kivo-scene-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes kivo-step-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.kivo-reveal-name { animation: kivo-scene-fade 0.8s ease-out; font-size: clamp(4rem, 12vw, 8rem); line-height: 1; }
.kivo-reveal-desc { animation: kivo-scene-fade 1.2s ease-out 0.3s both; }
.kivo-reveal-button { animation: kivo-scene-fade 0.6s ease-out both; }
.kivo-naming { animation: kivo-scene-fade 0.6s ease-out; font-size: clamp(3rem, 10vw, 7rem); line-height: 1.05; }
.kivo-step { animation: kivo-step-in 0.25s ease-out; }
@media (prefers-reduced-motion: reduce) { .kivo-step, .kivo-reveal-name, .kivo-reveal-desc, .kivo-reveal-button, .kivo-naming { animation: none; } }
`;

function prefersLessMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

type StepId = 'welcome' | OnboardingFieldV3;
// The questions in the order asked: the server's own list (V3_FIELDS), so
// the page cannot ask them in another order or skip one.
const QUESTIONS: readonly OnboardingFieldV3[] = V3_FIELDS;
const STEPS: readonly StepId[] = ['welcome', ...QUESTIONS];
const PART: Record<OnboardingFieldV3, string> = {
  audience: 'About you', workingOn: 'About you', weeklyHours: 'Your time', obstacles: 'What gets in the way',
  language: 'How Nova talks', tone: 'How Nova talks', telegram: 'Telegram', creatureName: 'Your creature',
};

const LANGUAGES: ReadonlyArray<{ value: ReplyLanguage; label: string; hint: string }> = [
  { value: 'english',  label: 'English',  hint: 'Natural, everyday English.' },
  { value: 'hindi',    label: 'Hindi',    hint: 'हिन्दी, in Devanagari script. Study terms can stay in English.' },
  { value: 'hinglish', label: 'Hinglish', hint: 'Hindi and English mixed, in Roman letters, the way you text.' },
];

const TELEGRAM: ReadonlyArray<{ value: TelegramAnswer; label: string; hint: string }> = [
  { value: 'yes', label: 'Yes', hint: 'After you finish, you can connect it in one step.' },
  { value: 'no',  label: 'No',  hint: 'Everything in Kivo works without it.' },
];

function readDraft(): { draft: Draft; at: number } | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: Partial<Draft>; at?: unknown };
    if (!parsed.draft || typeof parsed.draft !== 'object') return null;
    const d = parsed.draft;
    const multi = <Id extends string>(m: Partial<Multi<Id>> | undefined): Multi<Id> => ({
      selected: Array.isArray(m?.selected) ? m!.selected : [], custom: Array.isArray(m?.custom) ? m!.custom.filter(c => typeof c === 'string') : [],
    });
    const at = typeof parsed.at === 'number' && Number.isInteger(parsed.at) && parsed.at >= 0 && parsed.at < STEPS.length ? parsed.at : 0;
    return {
      draft: {
        ...EMPTY, ...d,
        workingOn: multi(d.workingOn), obstacles: multi(d.obstacles),
        weekly: { preset: d.weekly?.preset ?? null, hours: typeof d.weekly?.hours === 'string' ? d.weekly.hours : '' },
        creatureName: typeof d.creatureName === 'string' ? d.creatureName : DEFAULT_CREATURE_NAME,
      },
      at,
    };
  } catch {
    return null;
  }
}

function clearDraft() {
  try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);

function OnboardingFlowContent() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [at, setAt] = useState(0);
  // Nothing is written back to storage before the stored draft has been read,
  // so a fresh mount cannot overwrite it with blanks.
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the server said when it saved: done, or done earlier (then nothing
  // from this page was written).
  const [done, setDone] = useState<null | { alreadyComplete: boolean; telegram: TelegramAnswer | null; creature: string }>(null);
  const [scene, setScene] = useState<'reveal' | 'naming' | null>(null);
  const [revealReady, setRevealReady] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readDraft();
    if (stored) { setDraft(stored.draft); setAt(stored.at); }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored || done) return;
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, at })); } catch { /* storage unavailable */ }
  }, [draft, at, restored, done]);
  // Each new question is announced: focus moves to it.
  useEffect(() => {
    if (restored) (scene ? sceneRef : headingRef).current?.focus();
  }, [at, restored, done, scene]);
  useEffect(() => {
    if (scene !== 'reveal') return;
    setRevealReady(false);
    const timer = setTimeout(() => setRevealReady(true), prefersLessMotion() ? 0 : REVEAL_BUTTON_MS);
    return () => clearTimeout(timer);
  }, [scene]);

  const step = STEPS[at]!;
  const set = (patch: Partial<Draft>) => { setDraft(d => ({ ...d, ...patch })); setError(null); };

  const weeklyAnswer = draft.weekly.preset === null ? null
    : draft.weekly.preset === 'custom' ? { preset: 'custom' as const, hours: draft.weekly.hours }
    : { preset: draft.weekly.preset };
  const weeklyCheck = weeklyAnswer ? checkWeeklyHours(weeklyAnswer) : null;
  const nameCheck = checkCreatureName(draft.creatureName);

  const answered = (() => {
    switch (step) {
      case 'welcome':      return true;
      case 'audience':     return draft.audience !== null;
      case 'workingOn':    return draft.workingOn.selected.length + draft.workingOn.custom.length > 0;
      case 'weeklyHours':  return weeklyCheck?.ok === true;
      case 'obstacles':    return draft.obstacles.selected.length + draft.obstacles.custom.length > 0;
      case 'language':     return draft.language !== null;
      case 'tone':         return draft.tone !== null;
      case 'telegram':     return draft.telegram !== null;
      case 'creatureName': return nameCheck.ok;
    }
  })();

  const payload = () => ({
    version:      ONBOARDING_V3,
    audience:     draft.audience,
    workingOn:    draft.workingOn,
    weeklyHours:  weeklyAnswer,
    obstacles:    draft.obstacles,
    language:     draft.language,
    tone:         draft.tone,
    telegram:     draft.telegram,
    creatureName: draft.creatureName,
    timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone,
    // For an API deployed before v3 (the web app deploys first): the older
    // fields, so that API still makes the account a Nova learner with its
    // context, tone and creature name. A v3 API reads only the fields above.
    quizAnswers: {
      mentorDomain:        'study',
      accountabilityStyle: draft.tone && accountabilityOfTone(draft.tone) === 'hard' ? 'No mercy' : 'Gentle nudges',
      learningContexts:    draft.audience ? [draft.audience] : [],
    },
  });

  async function finish() {
    // The same check the server runs, so a missing answer is pointed at here.
    const checked = checkOnboardingV3(payload());
    if (!checked.ok) {
      setAt(Math.max(0, STEPS.indexOf(checked.field)));
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    setScene('naming');
    const moment = new Promise(resolve => setTimeout(resolve, prefersLessMotion() ? 400 : NAMING_MS));
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (res.status === 401) { window.location.href = '/signin?from=/onboarding'; return; }
      const result = await res.json().catch(() => null) as { success?: boolean; error?: string; field?: string; alreadyComplete?: boolean } | null;
      if (!res.ok || !result?.success) {
        // The server names the answer it refused: go back to it.
        const field = QUESTIONS.find(q => q === result?.field);
        if (field) setAt(STEPS.indexOf(field));
        setError(result?.error ?? "That didn't save. Your answers are still here; try again.");
        return;
      }
      clearDraft();
      await moment;
      setDone({ alreadyComplete: result.alreadyComplete === true, telegram: checked.answers.telegram, creature: checked.answers.creatureName });
    } catch {
      setError("Couldn't reach Kivo. Check your connection; your answers are still here.");
    } finally {
      setScene(null);
      setSaving(false);
    }
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (!answered || saving) return;
    if (at === STEPS.length - 1) { void finish(); return; }
    // Nova is revealed between the last question and naming the creature.
    if (STEPS[at + 1] === 'creatureName') { setScene('reveal'); return; }
    setAt(at + 1);
  }

  function leaveReveal() {
    setScene(null);
    setAt(STEPS.indexOf('creatureName'));
  }

  const creature = nameCheck.ok ? nameCheck.name : DEFAULT_CREATURE_NAME;
  const questionNumber = step === 'welcome' ? 0 : QUESTIONS.indexOf(step) + 1;

  return (
    <div className="kivo-app">
      <style>{SCENE_CSS}</style>
      <div className="kivo-dark min-h-screen bg-background text-foreground">

        {scene === 'reveal' && (
          <section className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6 text-center" aria-labelledby="nova-reveal">
            <div ref={sceneRef} tabIndex={-1} className="focus:outline-none">
              <h1 id="nova-reveal" className="kivo-reveal-name font-black text-foreground" style={{ letterSpacing: '0.1em' }}>NOVA</h1>
              <p className="kivo-reveal-desc mx-auto mt-6 max-w-md text-lg text-foreground/75">{NOVA_TAGLINE}</p>
            </div>
            <div className="mt-12 h-12">
              {revealReady && (
                <button type="button" onClick={leaveReveal}
                  className="kivo-reveal-button group inline-flex h-12 items-center gap-2 rounded-full bg-action px-8 font-semibold text-action-foreground transition-[background-color,transform] duration-300 hover:scale-105 hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  Name your creature <ArrowRight aria-hidden className="size-5 transition-transform group-hover:translate-x-1" />
                </button>
              )}
            </div>
          </section>
        )}

        {scene === 'naming' && (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6 text-center" role="status" aria-live="polite">
            <div ref={sceneRef} tabIndex={-1} className="focus:outline-none">
              <h1 className="kivo-naming wrap-break-word font-black text-foreground" style={{ letterSpacing: '0.1em' }}>{creature}</h1>
              <span className="sr-only">Saving your answers…</span>
            </div>
          </section>
        )}

        <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 pb-8 pt-6 sm:px-6 sm:pt-10">
          <header className="flex items-center justify-between gap-3">
            <KivoMark size={24} className="text-foreground/85" />
            {!done && questionNumber > 0 && (
              <p className="text-xs font-medium text-foreground/70" aria-live="polite">
                Question {questionNumber} of {QUESTIONS.length} · {PART[step as OnboardingFieldV3]}
              </p>
            )}
          </header>

          {!done && questionNumber > 0 && (
            <div className="mt-4 flex gap-1" aria-hidden>
              {QUESTIONS.map((q, i) => (
                <span key={q} className={cn('h-1 flex-1 rounded-full transition-colors', i < questionNumber ? 'bg-action' : 'bg-white/12')} />
              ))}
            </div>
          )}

          {done ? (
            <Finished done={done} onEnter={() => router.push('/home')} headingRef={headingRef} />
          ) : (
            <form onSubmit={next} className="flex flex-1 flex-col pt-10 sm:pt-14" aria-busy={!restored} data-step={step}>
              <div ref={headingRef} tabIndex={-1} key={step} className="kivo-step focus:outline-none">
                {step === 'welcome' && (
                  <div className="pt-6 sm:pt-12">
                    <h1 className="text-[2.1rem] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[2.75rem]">
                      Let&apos;s build a system that works for you.
                    </h1>
                    <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-foreground/75">
                      Tell Kivo what you&apos;re working on, how you spend your time, and what kind of support helps you make progress.
                    </p>
                    <p className="mt-6 text-sm text-foreground/60">Eight short questions. You can change every answer later in Settings.</p>
                  </div>
                )}

                {step === 'audience' && (
                  <Question legend="What do you currently do?" hint="Kivo uses this for its examples and suggestions. Every feature is open to everyone.">
                    {AUDIENCES.map(a => (
                      <Choice key={a} name="audience" value={a} checked={draft.audience === a}
                        onSelect={() => set({ audience: a })} label={AUDIENCE_LABEL[a].label} />
                    ))}
                  </Question>
                )}

                {step === 'workingOn' && (
                  <Question legend="What are you currently working on?" hint="Choose everything that applies. You can add your own, too.">
                    {workingOnOptions(draft.audience).map(o => (
                      <MultiChoice key={o.id} name="workingOn" value={o.id} checked={draft.workingOn.selected.includes(o.id)}
                        onToggle={() => set({ workingOn: { ...draft.workingOn, selected: toggle(draft.workingOn.selected, o.id) } })} label={o.label} />
                    ))}
                    <CustomEntries id="working-on" entries={draft.workingOn.custom} labels={WORKING_ON_LABELS}
                      onChange={custom => set({ workingOn: { ...draft.workingOn, custom } })}
                      addLabel="Other: add your own"
                      placeholder={draft.audience === 'working' ? 'e.g. Launching our app in March' : draft.audience === 'school' ? 'e.g. Science olympiad' : 'e.g. Final-year thesis'} />
                  </Question>
                )}

                {step === 'weeklyHours' && (
                  <Question legend="How much time can you realistically give these goals each week?" hint="An honest estimate helps Nova suggest a plan you can actually follow.">
                    {WEEKLY_PRESETS.map(p => (
                      <Choice key={p.id} name="weekly" value={p.id} checked={draft.weekly.preset === p.id}
                        onSelect={() => set({ weekly: { ...draft.weekly, preset: p.id } })} label={p.label} />
                    ))}
                    <Choice name="weekly" value="custom" checked={draft.weekly.preset === 'custom'}
                      onSelect={() => set({ weekly: { ...draft.weekly, preset: 'custom' } })} label="I'll enter my own estimate" />
                    {draft.weekly.preset === 'custom' && (
                      <div className="mt-1 rounded-2xl border border-white/12 bg-card p-4">
                        <label htmlFor="weekly-hours" className="text-sm font-medium text-foreground/85">Hours per week</label>
                        <div className="mt-2 flex items-center gap-3">
                          <input id="weekly-hours" inputMode="decimal" autoComplete="off" value={draft.weekly.hours} placeholder="e.g. 7.5"
                            onChange={e => set({ weekly: { ...draft.weekly, hours: e.target.value } })}
                            aria-invalid={draft.weekly.hours.trim() !== '' && weeklyCheck?.ok === false}
                            aria-describedby="weekly-hours-note"
                            className="h-11 w-32 rounded-xl border border-white/15 bg-background px-3.5 text-[15px] text-foreground placeholder:text-foreground/45 focus:border-action focus:outline-none" />
                          <span className="text-[15px] text-foreground/75">hours a week</span>
                        </div>
                        <p id="weekly-hours-note" className={cn('mt-2 text-xs', draft.weekly.hours.trim() !== '' && weeklyCheck?.ok === false ? 'text-red-400' : 'text-subtle')}
                          role={draft.weekly.hours.trim() !== '' && weeklyCheck?.ok === false ? 'alert' : undefined}>
                          {draft.weekly.hours.trim() !== '' && weeklyCheck && !weeklyCheck.ok ? weeklyCheck.message : `From 0 to ${WEEKLY_HOURS_MAX}. Decimals are fine.`}
                        </p>
                      </div>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-subtle">It&apos;s an estimate, not a promise. Nova keeps each day&apos;s plan inside it, and nothing goes on your calendar unless you add it.</p>
                  </Question>
                )}

                {step === 'obstacles' && (
                  <Question legend="What usually makes it difficult to make progress?" hint="Choose as many as you need. This helps Nova support you in the right way.">
                    {OBSTACLES.map(id => (
                      <MultiChoice key={id} name="obstacles" value={id} checked={draft.obstacles.selected.includes(id)}
                        onToggle={() => {
                          // "Not sure" stands alone: choosing it clears the
                          // others, and choosing another clears it.
                          const selected = id === 'not_sure'
                            ? (draft.obstacles.selected.includes('not_sure') ? [] : ['not_sure' as const])
                            : toggle(draft.obstacles.selected.filter(s => s !== 'not_sure'), id);
                          set({ obstacles: { ...draft.obstacles, selected } });
                        }}
                        label={OBSTACLE[id].label} />
                    ))}
                    <CustomEntries id="obstacles" entries={draft.obstacles.custom} labels={OBSTACLE_LABELS}
                      onChange={custom => set({ obstacles: { ...draft.obstacles, custom } })}
                      addLabel="Other: add your own" placeholder="e.g. My phone" />
                    <p className="mt-1 text-xs leading-relaxed text-subtle">Nova uses this to choose how it helps. It never turns on reminders or messages because of it.</p>
                  </Question>
                )}

                {step === 'language' && (
                  <Question legend="Which language would you prefer Nova to speak?" hint="If you write to Nova in another language, it answers in that one.">
                    {LANGUAGES.map(l => (
                      <Choice key={l.value} name="language" value={l.value} checked={draft.language === l.value}
                        onSelect={() => set({ language: l.value })} label={l.label} hint={l.hint} />
                    ))}
                  </Question>
                )}

                {step === 'tone' && (
                  <Question legend="How should Nova talk to you?" hint="Choose the kind of support that helps you make progress.">
                    {TONE_OPTIONS.map(t => (
                      <Choice key={t.value} name="tone" value={t.value} checked={draft.tone === t.value}
                        onSelect={() => set({ tone: t.value })} label={t.label} hint={t.hint} />
                    ))}
                    <p className="mt-1 text-xs leading-relaxed text-subtle">Tone changes how Nova says things, never what&apos;s true. It turns calm whenever something is weighing on you, and asking for something different in a message always wins.</p>
                  </Question>
                )}

                {step === 'telegram' && (
                  <Question legend="Do you use Telegram?" hint="Telegram lets you talk to Nova there, too.">
                    {TELEGRAM.map(t => (
                      <Choice key={t.value} name="telegram" value={t.value} checked={draft.telegram === t.value}
                        onSelect={() => set({ telegram: t.value })} label={t.label} hint={t.hint} />
                    ))}
                    {draft.telegram === 'yes' && (
                      <p className="mt-1 flex gap-2.5 rounded-2xl border border-white/12 bg-card px-4 py-3 text-sm leading-relaxed text-foreground/75">
                        <Send aria-hidden className="mt-0.5 size-4 shrink-0 text-action-ink" />
                        When you finish, Kivo gives you a link that opens Nova in Telegram. Press Start there and your Telegram connects to this account. Kivo never asks for your Telegram password or login code.
                      </p>
                    )}
                  </Question>
                )}

                {step === 'creatureName' && (
                  <div>
                    <label htmlFor="creature-name" className="block text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[2rem]">
                      What would you like to call your creature?
                    </label>
                    <p className="mt-2 text-[15px] leading-relaxed text-foreground/70">Give your companion a name that feels like yours.</p>
                    <input id="creature-name" value={draft.creatureName} maxLength={CREATURE_NAME_MAX}
                      onChange={e => set({ creatureName: e.target.value })} autoComplete="off"
                      aria-invalid={!nameCheck.ok} aria-describedby="creature-name-note"
                      className="mt-6 h-12 w-full rounded-xl border border-white/15 bg-card px-4 text-lg text-foreground placeholder:text-foreground/45 focus:border-action focus:outline-none" />
                    <p id="creature-name-note" className={cn('mt-2 text-xs', nameCheck.ok ? 'text-subtle' : 'text-red-400')}>
                      {nameCheck.ok ? 'Your creature lives in your world on the Creature page. Nova is still Nova.' : nameCheck.message}
                    </p>
                    {draft.creatureName.trim() !== DEFAULT_CREATURE_NAME && (
                      <button type="button" onClick={() => set({ creatureName: DEFAULT_CREATURE_NAME })} className="mt-2 text-sm font-medium text-foreground/70 underline decoration-white/25 underline-offset-4 hover:text-foreground">
                        Use {DEFAULT_CREATURE_NAME}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {error && <p role="alert" className="mt-5 text-sm text-red-400">{error}</p>}

              <div className="mt-auto flex items-center justify-between gap-3 pt-10">
                <button type="button" onClick={() => { setError(null); setAt(Math.max(0, at - 1)); }} disabled={at === 0 || saving}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5 disabled:invisible">
                  <ArrowLeft aria-hidden className="size-4" /> Back
                </button>
                <button type="submit" disabled={!answered || saving || !restored}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-6 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
                  {saving ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Saving…</>
                    : step === 'welcome' ? <>Get started <ArrowRight aria-hidden className="size-4" /></>
                    : at === STEPS.length - 1 ? <>Finish <Check aria-hidden className="size-4" /></>
                    : <>Continue <ArrowRight aria-hidden className="size-4" /></>}
                </button>
              </div>
              {step === 'creatureName' && <p className="mt-8 text-center text-xs tracking-wide text-foreground/55" data-footer>Grow your world.</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// After the server has saved the answers. Nothing here claims more than it
// said: Telegram is "connected" only when the server reports the chat.
function Finished({ done, onEnter, headingRef }: {
  done: { alreadyComplete: boolean; telegram: TelegramAnswer | null; creature: string };
  onEnter: () => void;
  headingRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center py-10" data-finished>
      <div ref={headingRef} tabIndex={-1} className="focus:outline-none">
        <p className="text-sm font-medium text-action-ink">{done.alreadyComplete ? 'Already set up' : 'Saved'}</p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {done.alreadyComplete ? 'This account was already set up.' : 'Your system is ready.'}
        </h1>
      </div>
      <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-foreground/75">
        {done.alreadyComplete ? (
          <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />Onboarding was finished before, so these answers didn&apos;t change anything. You can change any of them in Settings.</li>
        ) : (
          <>
            <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />Nova has your answers. Next, add what you&apos;re working on in setup to get today&apos;s plan.</li>
            <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />{done.creature} is waiting in your world.</li>
            <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />Everything you answered can be changed in Settings.</li>
          </>
        )}
      </ul>
      {done.telegram === 'yes' && <TelegramStep />}
      <button type="button" onClick={onEnter}
        className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-action px-6 text-[15px] font-semibold text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Go to Kivo <ArrowRight aria-hidden className="size-4" />
      </button>
    </section>
  );
}

// The existing linking flow: a short-lived link from the server, Start in
// Telegram, and the server's own check that the chat is there.
function TelegramStep() {
  const link = useTelegramLink();
  return (
    <section className="mt-8 rounded-2xl border border-white/12 bg-card p-5" aria-labelledby="onboarding-telegram" data-telegram-step>
      <h2 id="onboarding-telegram" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Send aria-hidden className="size-4 text-action-ink" /> Connect Telegram
      </h2>
      {link.connection === null ? (
        <div aria-busy="true" aria-label="Checking Telegram" className="mt-3 h-5 w-48 animate-pulse rounded bg-white/5" />
      ) : link.connection.connected ? (
        <p className="mt-2 flex items-center gap-2 text-sm font-medium text-action-ink" role="status"><Check aria-hidden className="size-4" /> Telegram is connected to this account.</p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-foreground/75">Open the link, press Start, and Nova will be there too. It isn&apos;t connected until this says so.</p>
          <ConnectAction link={link} className="mt-4" />
          <p className="mt-3 text-xs text-subtle">Not now? Connect it any time from Settings → Connections.</p>
        </>
      )}
    </section>
  );
}

export default function OnboardingFlow() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlowContent />
    </Suspense>
  );
}
