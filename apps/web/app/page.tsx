import { Header } from "@/components/header"
import { LandingHero } from "@/components/landing/hero"
import { BuildSection, Capabilities, CreatureSection, ExtensionSection, FocusSection, Journey, MapSection, MentorSection, NotesSection, UseCases, WorkspaceSection } from "@/components/landing/sections"
import { Pricing } from "@/components/pricing"
import { FAQ } from "@/components/faq"
import { FinalCTA } from "@/components/final-cta"
import { Footer } from "@/components/footer"

// The landing page tells one story: Kivo is a learning OS with an AI-powered
// second brain. Nova builds it with you, the map is the second brain itself, then
// one topic seen whole (mapped, understood and planned), learning from notes and
// papers, saving what you read (Nova for Chrome), then the loop that keeps it going (Nova writes first on Telegram,
// the focus room, the creature's world), then the rest. The sections share one background, lit down the page. Each product section has a working sample
// preview (components/landing); they run in the browser and save nothing.
export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="relative" style={{ background: '#060810' }}>
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[90vh] h-[60rem] w-[70rem] max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,229,160,0.06),transparent)]" />
          <div className="absolute left-0 top-[35%] h-[50rem] w-[50rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.05),transparent)]" />
          <div className="absolute right-0 top-[58%] h-[56rem] w-[56rem] translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,229,160,0.05),transparent)]" />
        </div>
        <LandingHero />
        <BuildSection />
        <MapSection />
        <WorkspaceSection />
        <NotesSection />
        <ExtensionSection />
        <MentorSection />
        <FocusSection />
        <CreatureSection />
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
