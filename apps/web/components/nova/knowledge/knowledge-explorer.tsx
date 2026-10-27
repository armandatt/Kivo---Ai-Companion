'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Flag, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { subjectColor } from '../subject-color'
import { LEVEL_TONE } from './labels'
import { searchTree, visibleRows, type TreeNode } from './knowledge-tree'

// The Knowledge explorer: subjects, the topics inside them and the topics
// inside those, as one tree. The chevron only opens or closes a branch; the
// row opens the subject's board or the topic's page. Keyboard as a tree
// (WAI-ARIA): up and down move, right opens or steps in, left closes or steps
// out, Home and End, Enter or Space opens. The filter above it lists every
// match with the names above it.

const INDENT = 14   // px per level
const BASE   = 8

function Marker({ node }: { node: TreeNode }) {
  if (node.kind === 'subject') return <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', subjectColor(node.name).dot)} />
  if (node.milestone) return <Flag aria-hidden className="size-3 shrink-0 text-foreground/45" />
  // A studied topic shows its level; one with no session behind it is hollow.
  const level = node.topic?.level
  if (level && level !== 'unverified') return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', LEVEL_TONE[level])} />
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-foreground/35" />
}

function Due({ n }: { n: number }) {
  if (n === 0) return null
  return <span className="ml-auto shrink-0 rounded-full bg-amber-300/12 px-1.5 text-[10px] font-semibold tabular-nums leading-4 text-amber-300" title={`${n} due to revisit`}>{n}<span className="sr-only"> due</span></span>
}

export function KnowledgeExplorer({ roots, selectedKey, open, onToggle, onOpen, className }: {
  roots:       TreeNode[]
  selectedKey: string | null
  open:        ReadonlySet<string>
  onToggle:    (key: string, to?: boolean) => void
  onOpen:      (node: TreeNode) => void
  className?:  string
}) {
  const [query, setQuery] = useState('')
  const rows    = useMemo(() => visibleRows(roots, open), [roots, open])
  const results = useMemo(() => searchTree(roots, query), [roots, query])
  const searching = query.trim().length > 0

  // One row takes Tab at a time: the chosen one, else the first.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const tabKey = rows.some(r => r.node.key === focusKey) ? focusKey : rows.some(r => r.node.key === selectedKey) ? selectedKey : rows[0]?.node.key ?? null
  const items = useRef(new Map<string, HTMLElement>())
  const byKeyboard = useRef(false)
  useEffect(() => {
    if (!byKeyboard.current || !focusKey) return
    byKeyboard.current = false
    items.current.get(focusKey)?.focus()
  }, [focusKey, rows])

  // A branch just opened eases its rows in.
  const [opened, setOpened] = useState<string | null>(null)
  const toggle = (key: string, to?: boolean) => { if (to ?? !open.has(key)) setOpened(key); onToggle(key, to) }

  const move = (key: string) => { byKeyboard.current = true; setFocusKey(key) }
  const onKey = (event: React.KeyboardEvent, node: TreeNode, at: number) => {
    const hasChildren = node.children.length > 0
    const isOpen = open.has(node.key)
    switch (event.key) {
      case 'ArrowDown': if (rows[at + 1]) move(rows[at + 1].node.key); break
      case 'ArrowUp':   if (rows[at - 1]) move(rows[at - 1].node.key); break
      case 'Home':      if (rows[0]) move(rows[0].node.key); break
      case 'End':       if (rows.length) move(rows[rows.length - 1].node.key); break
      case 'ArrowRight':
        if (hasChildren && !isOpen) toggle(node.key, true)
        else if (hasChildren) move(node.children[0].key)
        break
      case 'ArrowLeft':
        if (hasChildren && isOpen) toggle(node.key, false)
        else if (node.parentKey) move(node.parentKey)
        break
      case 'Enter': case ' ': onOpen(node); break
      default: return
    }
    event.preventDefault()
  }

  const resultsRef = useRef<HTMLUListElement>(null)
  const pick = (node: TreeNode) => { setQuery(''); onOpen(node) }
  const stepResults = (event: React.KeyboardEvent<HTMLElement>) => {
    const buttons = [...(resultsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') { buttons[Math.min(at + 1, buttons.length - 1)]?.focus(); event.preventDefault() }
    if (event.key === 'ArrowUp') { if (at <= 0) (event.currentTarget.closest('[data-explorer]')?.querySelector('input') as HTMLInputElement | null)?.focus(); else buttons[at - 1]?.focus(); event.preventDefault() }
  }

  return (
    <div data-explorer className={cn('flex min-h-0 flex-col', className)}>
      <label className="relative block shrink-0">
        <span className="sr-only">Find a subject or topic</span>
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a subject or topic"
          onKeyDown={e => {
            if (e.key === 'Escape' && query) { setQuery(''); e.preventDefault() }
            if (e.key === 'Enter' && results[0]) { pick(results[0].node); e.preventDefault() }
            if (e.key === 'ArrowDown' && searching) stepResults(e)
          }}
          className="h-8 w-full rounded-lg border border-white/8 bg-white/[0.03] pl-8 pr-7 text-[13px] text-foreground placeholder:text-foreground/40 focus:border-keppel-400/60 focus:outline-none" />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear the search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-foreground/45 hover:text-foreground">
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </label>

      <div className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {searching ? (
          results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-foreground/55" data-empty="search">No subject or topic called &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <ul ref={resultsRef} aria-label="Matches" className="space-y-px" onKeyDown={stepResults} data-results>
              {results.map(({ node, path }) => (
                <li key={node.key}>
                  <button type="button" onClick={() => pick(node)} data-result={node.key}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-keppel-400/70">
                    <span className="mt-1.5"><Marker node={node} /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground/90">{node.name}</span>
                      {path.length > 0 && <span className="block truncate text-[11px] text-foreground/50">{path.join(' / ')}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul role="tree" aria-label="Subjects and topics" className="relative" data-tree>
            {rows.map(({ node, level }, at) => {
              const hasChildren = node.children.length > 0
              const isOpen = open.has(node.key)
              const selected = node.key === selectedKey
              return (
                <li key={node.key} role="treeitem" aria-level={level} aria-selected={selected} aria-expanded={hasChildren ? isOpen : undefined}
                  tabIndex={node.key === tabKey ? 0 : -1}
                  ref={el => { if (el) items.current.set(node.key, el); else items.current.delete(node.key) }}
                  onKeyDown={e => { if (e.target === e.currentTarget) onKey(e, node, at) }}
                  onFocus={e => { if (e.target === e.currentTarget) setFocusKey(node.key) }}
                  onClick={() => { setFocusKey(node.key); onOpen(node) }}
                  data-node={node.key} data-kind={node.kind}
                  className={cn('group relative flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 text-[13px] outline-none transition-colors',
                    'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-keppel-400/70',
                    selected ? 'bg-white/8 text-foreground' : 'text-foreground/75 hover:bg-white/4 hover:text-foreground',
                    opened !== null && node.parentKey === opened && 'tree-in')}
                  style={{ paddingLeft: BASE + (level - 1) * INDENT }}>
                  {/* Guides: one faint line for each level above */}
                  {Array.from({ length: level - 1 }, (_, i) => (
                    <span key={i} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.07]" style={{ left: BASE + i * INDENT + 7 }} />
                  ))}
                  {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-action" />}
                  {hasChildren ? (
                    <span role="button" aria-label={isOpen ? `Close ${node.name}` : `Open ${node.name}`} tabIndex={-1}
                      onClick={e => { e.stopPropagation(); toggle(node.key) }}
                      className="-ml-0.5 flex size-4 shrink-0 items-center justify-center rounded text-foreground/45 hover:bg-white/8 hover:text-foreground">
                      <ChevronRight aria-hidden className={cn('size-3.5 transition-transform duration-150', isOpen && 'rotate-90')} />
                    </span>
                  ) : <span aria-hidden className="w-3.5 shrink-0" />}
                  <Marker node={node} />
                  <span className={cn('min-w-0 truncate', node.kind === 'subject' && 'font-medium', selected && 'font-medium')}>{node.name}</span>
                  <Due n={node.dueCount} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
