'use client'

// The product previews, each loaded when the visitor scrolls near it: the
// page's first paint carries only the hero.

import dynamic from 'next/dynamic'
import { NearMount } from './frame'

const Placeholder = ({ h }: { h: number }) => <div aria-hidden className="animate-pulse rounded-[1.4rem] border border-white/8 bg-white/[0.02]" style={{ height: h }} />

const MapDemo = dynamic(() => import('./map-demo').then(m => m.MapDemo), { ssr: false, loading: () => <Placeholder h={640} /> })
const BuildDemo = dynamic(() => import('./build-demo').then(m => m.BuildDemo), { ssr: false, loading: () => <Placeholder h={544} /> })
const NotesDemo = dynamic(() => import('./notes-demo').then(m => m.NotesDemo), { ssr: false, loading: () => <Placeholder h={656} /> })
const PaperDemo = dynamic(() => import('./notes-demo').then(m => m.PaperDemo), { ssr: false, loading: () => <Placeholder h={352} /> })
const TodayDemo = dynamic(() => import('./today-demo').then(m => m.TodayDemo), { ssr: false, loading: () => <Placeholder h={600} /> })

export const LazyMapDemo = () => <NearMount minHeight={560}><MapDemo /></NearMount>
export const LazyBuildDemo = () => <NearMount minHeight={600}><BuildDemo /></NearMount>
export const LazyNotesDemo = () => <NearMount minHeight={656}><NotesDemo /></NearMount>
export const LazyPaperDemo = () => <NearMount minHeight={352}><PaperDemo /></NearMount>
export const LazyTodayDemo = () => <NearMount minHeight={600}><TodayDemo /></NearMount>
