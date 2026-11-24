'use client'

// A product demonstration: a poster that opens a player. Nothing loads until
// it is opened (preload none, the poster lazy), it never plays by itself, and
// it carries captions. Shared by pages that show a real recording of Kivo.
// Only ever given a recording of the thing the page is about (founder review
// #04): a page with no such recording passes none and shows nothing.

import { useEffect, useRef, useState } from 'react'
import { Play, X } from 'lucide-react'

export interface DemoVideoSource { src: string; type: string; poster: string; captions: string; seconds: number; title: string; summary: string }

export function DemoVideo({ video }: { video: DemoVideoSource }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative block w-full overflow-hidden rounded-xl border border-white/10 bg-black text-left focus-visible:outline-2 focus-visible:outline-ring" data-demo-video-open>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static poster from /public */}
        <img src={video.poster} alt="" loading="lazy" className="aspect-video w-full object-cover opacity-85 transition-opacity group-hover:opacity-100" />
        <span className="absolute inset-0 grid place-items-center"><span className="grid size-14 place-items-center rounded-full bg-white/90 text-black shadow-lg"><Play aria-hidden className="size-6 translate-x-0.5" /></span></span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <span className="block text-sm font-semibold text-white">{video.title}</span>
          <span className="block text-xs text-white/75">{video.summary} · {video.seconds} s</span>
        </span>
      </button>
      {open && <Player video={video} onClose={() => setOpen(false)} />}
    </>
  )
}

function Player({ video, onClose }: { video: DemoVideoSource; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={video.title} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative w-full max-w-4xl" onClick={e => e.stopPropagation()}>
        <button ref={close} type="button" onClick={onClose} aria-label="Close video" className="absolute -top-10 right-0 rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        <video controls preload="none" playsInline poster={video.poster} className="aspect-video w-full rounded-xl bg-black shadow-2xl" data-demo-player>
          <source src={video.src} type={video.type} />
          <track kind="captions" src={video.captions} srcLang="en" label="English" default />
        </video>
      </div>
    </div>
  )
}
