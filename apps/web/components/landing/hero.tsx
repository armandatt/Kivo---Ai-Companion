// The top of the landing page: what Kio is, the way in, and the robot.
// The composition is the original hero's (hero-dual-chat.tsx before Landing
// 2.0): two columns from md, words on the left, the robot on the right in a
// 520px stage that floats on `botFloat`, over the hero's sparkles. Only the
// words changed. Nova's walkthrough is the next section, not part of this one.
//
// The entrance is CSS (`hero-in`, globals.css), so the page is drawn with
// everything in place without JavaScript and nothing waits for hydration;
// reduced motion gets no entrance, no float and no sparkles.

import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthAwareLink } from '@/components/auth-aware-link'
import { SplineBot } from '@/components/spline-bot'
import { HeroSparkles } from './hero-sparkles'

export function LandingHero() {
  return (
    <section className="relative flex items-center overflow-hidden px-4 pb-12 pt-20" style={{ background: '#060810', minHeight: '100vh' }} aria-labelledby="hero-title">
      <HeroSparkles />
      <div className="relative z-10 mx-auto w-full max-w-7xl">
        <div className="grid items-center gap-12 md:grid-cols-2 lg:gap-16">
          <div className="space-y-7">
            <p className="hero-in inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold"
              style={{ border: '1px solid rgba(0,229,160,0.2)', background: 'rgba(0,229,160,0.06)', color: '#00E5A0' }}>
              An AI-powered learning OS
            </p>
            <h1 id="hero-title" className="hero-in text-balance text-5xl font-black leading-[1.05] tracking-tight md:text-6xl lg:text-7xl" style={{ animationDelay: '80ms' }}>
              <span style={{ color: '#e8eaf0' }}>Turn what you learn into </span><span style={{ color: '#00E5A0' }}>what you know.</span>
            </h1>
            <p className="hero-in max-w-lg text-lg leading-relaxed text-slate-400" style={{ animationDelay: '160ms' }}>
              Build your learning system. Connect your knowledge. Study with Nova.
            </p>
            <div className="hero-in flex flex-col gap-3 pt-1 sm:flex-row" style={{ animationDelay: '240ms' }}>
              <Button asChild size="lg" className="font-bold text-slate-950 transition-transform hover:scale-[1.02]" style={{ background: '#00E5A0', boxShadow: '0 0 24px rgba(0,229,160,0.25)' }}>
                <AuthAwareLink>Start building with Kio <ArrowRight aria-hidden className="ml-1 size-4" /></AuthAwareLink>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/15 bg-transparent text-slate-200 hover:bg-white/5 hover:text-white">
                <a href="#build">Explore how it works</a>
              </Button>
            </div>
            <ul className="hero-in flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm text-slate-500" style={{ animationDelay: '320ms' }}>
              {['Free to start', 'Works in your browser', 'Nova on Telegram too'].map(t => (
                <li key={t} className="flex items-center gap-2"><span aria-hidden className="size-1.5 rounded-full" style={{ background: '#00E5A0' }} />{t}</li>
              ))}
            </ul>
          </div>

          {/* The robot: the original stage, size and float. */}
          <div className="relative flex items-center justify-center" style={{ minHeight: '520px' }} data-hero-robot>
            <div className="hero-robot relative h-[520px] w-full">
              <SplineBot className="h-full w-full" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
