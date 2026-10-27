import { Header } from "@/components/header"
import { LandingHero } from "@/components/landing/hero"
import { BuildSection, Capabilities, Journey, MapSection, NotesSection, UseCases, WorkspaceSection } from "@/components/landing/sections"
import { Pricing } from "@/components/pricing"
import { FAQ } from "@/components/faq"
import { FinalCTA } from "@/components/final-cta"
import { Footer } from "@/components/footer"

// The landing page tells one story: Kivo is a learning OS with an AI-powered
// second brain. See it whole (one topic mapped, understood and planned), then how
// Nova helps build it, the map itself, learning from notes and papers, then
// the rest. The sections share one background, lit down the page. Each product section has a working sample
// preview (components/landing); they run in the browser and save nothing.
export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="relative" style={{ background: '#060810' }}>
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[90vh] h-[60rem] w-[70rem] max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,229,160,0.06),transparent)]" />
          <div className="absolute left-0 top-[45%] h-[50rem] w-[50rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.05),transparent)]" />
        </div>
        <LandingHero />
        <WorkspaceSection />
        <BuildSection />
        <MapSection />
        <NotesSection />
        <Capabilities />
        <UseCases />
        <Journey />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
