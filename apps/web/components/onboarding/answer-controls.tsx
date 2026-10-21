'use client';

import { useState, type ReactNode } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import {
  CUSTOM_ENTRIES_MAX, CUSTOM_ENTRY_MAX, CUSTOM_ENTRY_MESSAGE, checkCustomEntry,
} from '@repo/api/nova/product/onboarding-options';
import { cn } from '@/lib/utils';

// The answer controls onboarding and Settings share. Native radios and
// checkboxes, drawn as cards, so arrow keys, Space and screen readers work as
// they do everywhere; the selected state is a filled mark and a teal border,
// never colour alone.

const CARD = 'group relative flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';
const CARD_ON = 'border-action bg-action-soft';
const CARD_OFF = 'border-white/12 bg-card hover:border-white/25';

function Mark({ on, round }: { on: boolean; round: boolean }) {
  return (
    <span aria-hidden className={cn(
      'mt-0.5 grid size-5 shrink-0 place-items-center border transition-colors',
      round ? 'rounded-full' : 'rounded-md',
      on ? 'border-action bg-action text-action-foreground' : 'border-white/30',
    )}>
      {on && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

function Body({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-[15px] font-medium text-foreground">{label}</span>
      {hint && <span className="mt-0.5 block text-sm leading-snug text-foreground/70">{hint}</span>}
    </span>
  );
}

// One option of a single-choice question.
export function Choice({ name, value, checked, onSelect, label, hint }: {
  name: string; value: string; checked: boolean; onSelect: () => void; label: string; hint?: string;
}) {
  return (
    <label className={cn(CARD, checked ? CARD_ON : CARD_OFF)}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      <Mark on={checked} round />
      <Body label={label} hint={hint} />
    </label>
  );
}

// One option of a choose-any question.
export function MultiChoice({ name, value, checked, onToggle, label, hint }: {
  name: string; value: string; checked: boolean; onToggle: () => void; label: string; hint?: string;
}) {
  return (
    <label className={cn(CARD, checked ? CARD_ON : CARD_OFF)}>
      <input type="checkbox" name={name} value={value} checked={checked} onChange={onToggle} className="sr-only" />
      <Mark on={checked} round={false} />
      <Body label={label} hint={hint} />
    </label>
  );
}

export function Question({ legend, hint, children, as = 'fieldset' }: {
  legend: string; hint?: ReactNode; children: ReactNode; as?: 'fieldset' | 'div';
}) {
  const Title = as === 'fieldset' ? 'legend' : 'h2';
  const Wrap = as;
  return (
    <Wrap>
      <Title className="text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[2rem]">{legend}</Title>
      {hint && <p className="mt-2 text-[15px] leading-relaxed text-foreground/70">{hint}</p>}
      <div className="mt-6 grid gap-2.5">{children}</div>
    </Wrap>
  );
}

const FIELD = 'h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-card px-3.5 text-[15px] text-foreground placeholder:text-foreground/45 focus:border-action focus:outline-none';
const SMALL_BUTTON = 'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/15 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-50';

// The learner's own entries for a question: add, edit in place, remove. Each
// is checked here as the server checks it (one line, distinct, within the
// limits), and refused with a reason rather than cut.
export function CustomEntries({ id, entries, onChange, labels, addLabel, placeholder }: {
  id: string; entries: string[]; onChange: (next: string[]) => void; labels: readonly string[]; addLabel: string; placeholder: string;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const checked = checkCustomEntry(text, entries, labels);
    if (!checked.ok) { setError(CUSTOM_ENTRY_MESSAGE[checked.reason]); return; }
    onChange([...entries, checked.entry]);
    setText('');
    setError(null);
  }

  function saveEdit(i: number) {
    const others = entries.filter((_, j) => j !== i);
    const checked = checkCustomEntry(editText, others, labels);
    if (!checked.ok) { setError(CUSTOM_ENTRY_MESSAGE[checked.reason]); return; }
    onChange(entries.map((e, j) => (j === i ? checked.entry : e)));
    setEditing(null);
    setError(null);
  }

  const full = entries.length >= CUSTOM_ENTRIES_MAX;

  return (
    <div className="mt-2 rounded-2xl border border-dashed border-white/15 p-4" data-custom-entries={id}>
      <label htmlFor={`${id}-new`} className="text-sm font-medium text-foreground/85">{addLabel}</label>
      {entries.length > 0 && (
        <ul className="mt-3 grid gap-2" aria-label="Added by you">
          {entries.map((entry, i) => (
            <li key={`${entry}-${i}`} className="flex items-center gap-2">
              {editing === i ? (
                <>
                  <input aria-label={`Edit "${entry}"`} value={editText} maxLength={CUSTOM_ENTRY_MAX} autoFocus
                    onChange={e => { setEditText(e.target.value); setError(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); saveEdit(i); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setError(null); }
                    }}
                    className={FIELD} />
                  <button type="button" onClick={() => saveEdit(i)} className={SMALL_BUTTON}>Save</button>
                </>
              ) : (
                <>
                  <span className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-action/60 bg-action-soft px-3.5 text-[15px] text-foreground">
                    <Check aria-hidden className="size-4 shrink-0 text-action-ink" />
                    <span className="truncate">{entry}</span>
                  </span>
                  <button type="button" onClick={() => { setEditing(i); setEditText(entry); setError(null); }} aria-label={`Edit "${entry}"`} className={SMALL_BUTTON}>
                    <Pencil aria-hidden className="size-4" />
                  </button>
                  <button type="button" onClick={() => { onChange(entries.filter((_, j) => j !== i)); setEditing(null); setError(null); }} aria-label={`Remove "${entry}"`} className={SMALL_BUTTON}>
                    <X aria-hidden className="size-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="mt-3 flex gap-2">
          <input id={`${id}-new`} value={text} maxLength={CUSTOM_ENTRY_MAX} placeholder={placeholder} autoComplete="off"
            onChange={e => { setText(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            className={FIELD} />
          <button type="button" onClick={add} className={SMALL_BUTTON}>
            <Plus aria-hidden className="size-4" /> Add
          </button>
        </div>
      )}
      {error ? <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>
        : <p className="mt-2 text-xs text-subtle">{full ? `That's ${CUSTOM_ENTRIES_MAX}, the most you can add.` : `Only you see these. Up to ${CUSTOM_ENTRIES_MAX}, ${CUSTOM_ENTRY_MAX} characters each.`}</p>}
    </div>
  );
}
