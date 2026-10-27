import { Button } from "@/components/ui/button"
import { AuthAwareLink } from "@/components/auth-aware-link"
import { Reveal } from "@/components/landing/frame"
import { ArrowRight, Sparkle } from "@phosphor-icons/react/dist/ssr"

// The last ask on the landing page. It rises in like every other section
// (Reveal); nothing else on it moves.
export function FinalCTA() {
  return (
    <section className="py-24 sm:py-32 border-t border-[var(--color-baltic-sea-900)] overflow-hidden" style={{ background: '#060810' }}>
      <div className="mx-auto max-w-[1400px] px-2.5 sm:px-6 lg:px-12">
        <Reveal>
          <div
            className="relative rounded-3xl border border-[var(--color-keppel-800)]/50 bg-gradient-to-br from-[var(--color-keppel-950)] via-[var(--color-baltic-sea-950)] to-[var(--color-baltic-sea-950)] p-8 lg:p-16 text-center overflow-hidden"
            style={{ boxShadow: "0 0 120px -30px var(--color-keppel-600)" }}
          >
            <div
              aria-hidden
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: `radial-gradient(var(--color-keppel-400) 1px, transparent 1px)`, backgroundSize: "32px 32px" }}
            />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-keppel-900)]/50 border border-[var(--color-keppel-700)] mb-6">
                <Sparkle weight="duotone" className="h-4 w-4 text-[var(--color-keppel-400)]" />
                <span className="text-sm font-medium text-[var(--color-keppel-300)]">Nova is ready when you are</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-bold text-[var(--color-baltic-sea-100)] mb-4 text-balance">
                Start building your learning system.
              </h2>
              <p className="text-lg text-[var(--color-baltic-sea-400)] max-w-xl mx-auto mb-8">
                Your goals, your structure, your day. Free to start.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)] rounded-full h-12 px-8 font-semibold transition-shadow duration-300 hover:shadow-[0_0_30px_-5px_var(--color-keppel-400)]"
                >
                  <AuthAwareLink>
                    Start building with Kivo
                    <ArrowRight weight="bold" className="ml-2 h-4 w-4" />
                  </AuthAwareLink>
                </Button>
              </div>
              <p className="mt-6 text-sm text-[var(--color-baltic-sea-500)]">
                Works in your browser · Nova on Telegram if you want it · Your notes stay yours on every plan
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
