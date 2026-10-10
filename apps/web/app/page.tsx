import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { NovaShowcase } from "@/components/nova-showcase"
import { BentoGrid } from "@/components/bento-grid"
import { HowItWorks } from "@/components/how-it-works"
import { CreatureReveal } from "@/components/creature-reveal"
import { Pricing } from "@/components/pricing"
import { Testimonials } from "@/components/testimonials"
import { FAQ } from "@/components/faq"
import { FinalCTA } from "@/components/final-cta"
import { Footer } from "@/components/footer"

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection />
        <NovaShowcase />
        <BentoGrid />
        <HowItWorks />
        <CreatureReveal />
        <Testimonials />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
