import { Header } from "@/components/header"
import { LandingHero } from "@/components/landing/hero"
import { BuildSection, Capabilities, Journey, MapSection, NotesSection, TodaySection, UseCases } from "@/components/landing/sections"
import { Pricing } from "@/components/pricing"
import { FAQ } from "@/components/faq"
import { FinalCTA } from "@/components/final-cta"
import { Footer } from "@/components/footer"

// The landing page tells one story: create your system, connect your
// knowledge, understand your sources, shape your day, make progress. Each
// product section has a working sample preview (components/landing); they
// run in the browser and save nothing.
export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <LandingHero />
        <MapSection />
        <BuildSection />
        <NotesSection />
        <TodaySection />
        <Capabilities />
        <Journey />
        <UseCases />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
