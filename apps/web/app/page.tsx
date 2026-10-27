import { Header } from "@/components/header"
import { LandingHero } from "@/components/landing/hero"
import { BuildSection, Capabilities, Journey, MapSection, NotesSection, TodaySection, UseCases } from "@/components/landing/sections"
import { Pricing } from "@/components/pricing"
import { FAQ } from "@/components/faq"
import { FinalCTA } from "@/components/final-cta"
import { Footer } from "@/components/footer"

// The landing page tells one story: discover Kivo, see Nova help build a
// workspace, explore the second brain it makes, learn from notes and papers,
// shape the day, then the rest. Each product section has a working sample
// preview (components/landing); they run in the browser and save nothing.
export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <LandingHero />
        <BuildSection />
        <MapSection />
        <NotesSection />
        <TodaySection />
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
