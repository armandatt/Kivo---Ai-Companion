'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import {
  AUDIENCES, AUDIENCE_LABEL, FIRST_FOCUS_DETAIL_MAX, firstFocusOptions, goalFromFirstFocus, type Audience, type FirstFocusId,
} from '@repo/api/nova/product/first-focus';
import {
  COMPANION_NAME_MAX, DEFAULT_COMPANION_NAME, ONBOARDING_VERSION, checkOnboardingV2,
} from '@repo/api/nova/product/onboarding-answers';
import {
  ACCOUNTABILITY_OPTIONS, ACCOUNTABILITY_QUESTION, STYLE_QUESTIONS, type StyleDimension,
} from '@repo/api/personality/style-items';
import { KivoMark } from '@/components/brand/kivo-brand';
import { THEME_SCRIPT } from '@/components/theme/kivo-theme';
import { cn } from '@/lib/utils';

// Web onboarding. Five parts, one question per screen:
//   who you are → what to help with first → how you like to be helped (four
//   short questions) → your companion's name → done.
// Every answer has a use; packages/api/src/nova/product/onboarding-answers.ts
// lists each one. The server checks and stores them (POST /api/onboarding);
// this page only collects them. Finishing twice changes nothing.

type Draft = {
  audience:            Audience | null;
  focus:               FirstFocusId | null;
  detail:              string;
  accountabilityStyle: 'soft' | 'hard' | null;
  style:               Partial<Record<StyleDimension, string>>;
  companionName:       string;
};

const EMPTY: Draft = { audience: null, focus: null, detail: '', accountabilityStyle: null, style: {}, companionName: DEFAULT_COMPANION_NAME };

// A half-finished onboarding survives a refresh: this tab's session storage,
// cleared when the tab closes and as soon as the answers are saved.
const DRAFT_KEY = 'kivo-onboarding-draft-v2';

type StepId = 'audience' | 'focus' | 'accountability' | StyleDimension | 'name';
const STEPS: ReadonlyArray<{ id: StepId; part: string }> = [
  { id: 'audience',       part: 'About you' },
  { id: 'focus',          part: 'Your focus' },
  { id: 'accountability', part: 'How you like help' },
  ...STYLE_QUESTIONS.map(q => ({ id: q.id, part: 'How you like help' })),
  { id: 'name',           part: 'Your companion' },
];

function readDraft(): { draft: Draft; at: number } | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: Partial<Draft>; at?: unknown };
    if (!parsed.draft || typeof parsed.draft !== 'object') return null;
    const at = typeof parsed.at === 'number' && Number.isInteger(parsed.at) && parsed.at >= 0 && parsed.at < STEPS.length ? parsed.at : 0;
    return { draft: { ...EMPTY, ...parsed.draft, style: { ...(parsed.draft.style ?? {}) } }, at };
  } catch {
    return null;
  }
}

function clearDraft() {
  try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

// One option in a radio group: a native radio, so arrow keys, Space and
// screen readers work as they do everywhere, drawn as a card.
function Choice({ name, value, checked, onSelect, label, hint }: {
  name: string; value: string; checked: boolean; onSelect: () => void; label: string; hint?: string;
}) {
  return (
    <label
      className={cn(
        'group relative flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        checked ? 'border-action bg-action-soft' : 'border-white/12 bg-card hover:border-white/25',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
          checked ? 'border-action bg-action text-action-foreground' : 'border-white/25',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-sm leading-snug text-foreground/65">{hint}</span>}
      </span>
    </label>
  );
}

function Question({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[2rem]">{legend}</legend>
      {hint && <p className="mt-2 text-[15px] leading-relaxed text-foreground/65">{hint}</p>}
      <div className="mt-6 grid gap-2.5">{children}</div>
    </fieldset>
  );
}

function OnboardingFlowContent() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [at, setAt] = useState(0);
  // Nothing is written back to storage before the stored draft has been read,
  // so a fresh mount cannot overwrite it with blanks.
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);

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
    if (restored) headingRef.current?.focus();
  }, [at, restored, done]);

  const step = STEPS[at]!;
  const set = (patch: Partial<Draft>) => { setDraft(d => ({ ...d, ...patch })); setError(null); };

  const answered = (() => {
    switch (step.id) {
      case 'audience':       return draft.audience !== null;
      case 'focus':          return draft.focus !== null && (draft.focus !== 'other' || draft.detail.trim().length > 0);
      case 'accountability': return draft.accountabilityStyle !== null;
      case 'name':           return true;
      default:               return draft.style[step.id] !== undefined;
    }
  })();

  const payload = () => ({
    version:             ONBOARDING_VERSION,
    audience:            draft.audience,
    firstFocus:          { id: draft.focus, detail: draft.detail.trim() || null },
    accountabilityStyle: draft.accountabilityStyle,
    style:               draft.style,
    companionName:       draft.companionName,
    timezone:            Intl.DateTimeFormat().resolvedOptions().timeZone,
    // For an API deployed before v2 (the web app deploys first): the older
    // fields, so that API still makes the account a Nova learner with its
    // goal, context, tone and name. A v2 API reads only the fields above.
    quizAnswers: {
      mentorDomain:        'study',
      primaryGoal:         draft.focus ? goalFromFirstFocus({ id: draft.focus, detail: draft.detail.trim() || null }, draft.audience) : undefined,
      accountabilityStyle: draft.accountabilityStyle === 'hard' ? 'No mercy' : 'Gentle nudges',
      learningContexts:    draft.audience ? [draft.audience] : [],
    },
    creatureName:        draft.companionName.trim() || DEFAULT_COMPANION_NAME,
  });

  async function finish() {
    // The same check the server runs, so a missing answer is pointed at here.
    const checked = checkOnboardingV2(payload());
    if (!checked.ok) {
      const unanswered = STYLE_QUESTIONS.find(q => draft.style[q.id] === undefined)?.id ?? 'name';
      const stepOf: Record<typeof checked.field, StepId> = {
        audience: 'audience', firstFocus: 'focus', accountabilityStyle: 'accountability', style: unanswered, companionName: 'name',
      };
      setAt(Math.max(0, STEPS.findIndex(s => s.id === stepOf[checked.field])));
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (res.status === 401) { window.location.href = '/signin?from=/onboarding'; return; }
      const result = await res.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!res.ok || !result?.success) {
        setError(result?.error ?? "That didn't save. Your answers are still here; try again.");
        return;
      }
      clearDraft();
      setDone(true);
    } catch {
      setError("Couldn't reach Kivo. Check your connection; your answers are still here.");
    } finally {
      setSaving(false);
    }
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (!answered || saving) return;
    if (at === STEPS.length - 1) { void finish(); return; }
    setAt(at + 1);
  }

  const options = firstFocusOptions(draft.audience);
  const companion = draft.companionName.trim() || DEFAULT_COMPANION_NAME;

  return (
    <div className="kivo-app min-h-screen bg-background text-foreground">
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 pb-10 pt-6 sm:px-6 sm:pt-10">
        <header className="flex items-center justify-between">
          <KivoMark size={24} className="text-foreground/85" />
          {!done && <p className="text-xs font-medium text-subtle" aria-live="polite">Step {at + 1} of {STEPS.length} · {step.part}</p>}
        </header>

        {!done && (
          <div className="mt-4 flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s.id} className={cn('h-1 flex-1 rounded-full transition-colors', i <= at ? 'bg-action' : 'bg-white/10')} />
            ))}
          </div>
        )}

        {done ? (
          <section className="flex flex-1 flex-col justify-center py-10">
            <div ref={headingRef} tabIndex={-1} className="focus:outline-none">
              <p className="text-sm font-medium text-action-ink">You&apos;re set up</p>
              <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-foreground">{companion} is ready.</h1>
            </div>
            <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-foreground/70">
              <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />Next, tell {companion} what you&apos;re studying. It takes a minute and gives you today&apos;s plan.</li>
              <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />Everything you answered can be changed in Settings.</li>
              <li className="flex gap-3"><Check aria-hidden className="mt-1 size-4 shrink-0 text-action-ink" />Connect Telegram from Today when you want reminders and check-ins there.</li>
            </ul>
            <button type="button" onClick={() => router.push('/home')}
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-action px-6 text-[15px] font-semibold text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Enter Kivo <ArrowRight aria-hidden className="size-4" />
            </button>
          </section>
        ) : (
          <form onSubmit={next} className="flex flex-1 flex-col pt-10 sm:pt-14" aria-busy={!restored}>
            <div ref={headingRef} tabIndex={-1} className="focus:outline-none">
              {step.id === 'audience' && (
                <Question legend="What best describes you right now?" hint="Kivo uses this for its words and examples. Every feature is open to everyone.">
                  {AUDIENCES.map(a => (
                    <Choice key={a} name="audience" value={a} checked={draft.audience === a}
                      onSelect={() => set({ audience: a })} label={AUDIENCE_LABEL[a].label} hint={AUDIENCE_LABEL[a].hint} />
                  ))}
                </Question>
              )}

              {step.id === 'focus' && (
                <Question legend="What would you most like Nova to help you with first?" hint="Pick the one that matters most now. It decides where setup starts.">
                  {options.map(o => (
                    <Choice key={o.id} name="focus" value={o.id} checked={draft.focus === o.id}
                      onSelect={() => set({ focus: o.id })} label={o.label} hint={o.hint} />
                  ))}
                  {draft.focus !== null && (
                    <div className="mt-2">
                      <label htmlFor="focus-detail" className="text-sm font-medium text-foreground/80">
                        {draft.focus === 'other' ? 'What would you like help with?' : 'Anything specific?'}{' '}
                        {draft.focus !== 'other' && <span className="font-normal text-subtle">(optional)</span>}
                      </label>
                      <input id="focus-detail" value={draft.detail} maxLength={FIRST_FOCUS_DETAIL_MAX}
                        onChange={e => set({ detail: e.target.value })}
                        placeholder={draft.audience === 'working' ? 'e.g. AWS Solutions Architect in December' : draft.audience === 'school' ? 'e.g. Class 12 board exams in March' : 'e.g. Operating Systems midterm on the 14th'}
                        className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-card px-3.5 text-[15px] text-foreground placeholder:text-foreground/40 focus:border-action focus:outline-none" />
                      <p className="mt-1.5 text-xs text-subtle">It becomes your first goal, which you can edit later.</p>
                    </div>
                  )}
                </Question>
              )}

              {step.id === 'accountability' && (
                <Question legend={ACCOUNTABILITY_QUESTION} hint="This sets Nova's tone when you slip, never how much it plans for you.">
                  {ACCOUNTABILITY_OPTIONS.map(o => (
                    <Choice key={o.value} name="accountability" value={o.value} checked={draft.accountabilityStyle === o.value}
                      onSelect={() => set({ accountabilityStyle: o.value })} label={o.label} hint={o.hint} />
                  ))}
                </Question>
              )}

              {STYLE_QUESTIONS.map(q => step.id === q.id && (
                <Question key={q.id} legend={q.question} hint="No right answer. If you ask for something different in a message, Nova does that instead.">
                  {q.options.map(o => (
                    <Choice key={o.value} name={q.id} value={o.value} checked={draft.style[q.id] === o.value}
                      onSelect={() => set({ style: { ...draft.style, [q.id]: o.value } })} label={o.label} hint={o.hint} />
                  ))}
                </Question>
              ))}

              {step.id === 'name' && (
                <div>
                  <label htmlFor="companion-name" className="block text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[2rem]">
                    What would you like to call your companion?
                  </label>
                  <p className="mt-2 text-[15px] leading-relaxed text-foreground/65">Keep Nova, or pick a name of your own. You can change it later.</p>
                  <input id="companion-name" value={draft.companionName} maxLength={COMPANION_NAME_MAX}
                    onChange={e => set({ companionName: e.target.value })} autoComplete="off"
                    className="mt-6 h-12 w-full rounded-xl border border-white/12 bg-card px-4 text-lg text-foreground placeholder:text-foreground/40 focus:border-action focus:outline-none" />
                  {draft.companionName.trim() !== DEFAULT_COMPANION_NAME && (
                    <button type="button" onClick={() => set({ companionName: DEFAULT_COMPANION_NAME })} className="mt-2 text-sm font-medium text-foreground/65 underline decoration-white/25 underline-offset-4 hover:text-foreground">
                      Use Nova
                    </button>
                  )}
                </div>
              )}
            </div>

            {error && <p role="alert" className="mt-5 text-sm text-red-500">{error}</p>}

            <div className="mt-auto flex items-center justify-between gap-3 pt-10">
              <button type="button" onClick={() => { setError(null); setAt(Math.max(0, at - 1)); }} disabled={at === 0 || saving}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5 disabled:invisible">
                <ArrowLeft aria-hidden className="size-4" /> Back
              </button>
              <button type="submit" disabled={!answered || saving || !restored}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-6 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
                {saving ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Saving…</>
                  : at === STEPS.length - 1 ? <>Finish <Check aria-hidden className="size-4" /></>
                  : <>Continue <ArrowRight aria-hidden className="size-4" /></>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function OnboardingFlow() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlowContent />
    </Suspense>
  );
}
