import type { Metadata } from "next"
import Link from "next/link"
import { Confirm, LegalPage, Section } from "@/components/legal/legal-page"

// Plain terms for the service as it exists today. Business and legal facts
// the code cannot establish are <Confirm> placeholders, never guesses.

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Kivo and Nova.",
  // A draft with facts still to confirm: kept out of search results until published.
  robots: { index: false, follow: true },
}

const SECTIONS = [
  { id: "agreement", title: "These terms" },
  { id: "service", title: "What Kivo is" },
  { id: "eligibility", title: "Who can use Kivo" },
  { id: "account", title: "Your account" },
  { id: "content", title: "Your content" },
  { id: "ai", title: "AI and study guidance" },
  { id: "use", title: "Using Kivo fairly" },
  { id: "others", title: "Other services" },
  { id: "availability", title: "Changes to Kivo" },
  { id: "ending", title: "Ending your use" },
  { id: "liability", title: "Disclaimers and liability" },
  { id: "law", title: "Governing law" },
  { id: "changes", title: "Changes and contact" },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      sections={SECTIONS}
      summary={<p>Use Kivo to plan and track your own studying. What you write stays yours. Nova’s replies come from AI and can be wrong, so treat them as help, not as instructions you must follow. You can delete your account at any time from Settings.</p>}
    >
      <Section id="agreement" title="These terms">
        <p>These terms are an agreement between you and <Confirm id="entity" /> (“Kivo”, “we”). By creating an account or using Kivo, you agree to them. Our <Link href="/privacy">Privacy Policy</Link> explains what we collect and how it is used.</p>
      </Section>

      <Section id="service" title="What Kivo is">
        <p>Kivo is a study companion. Its companion, Nova, plans your day from your subjects, dates and time, times your study sessions, schedules reviews and shows your progress. You can use it in your browser, on Telegram if you connect it, and through the browser extension. Kivo is currently free to use.</p>
      </Section>

      <Section id="eligibility" title="Who can use Kivo">
        <p><Confirm id="minAge" /></p>
      </Section>

      <Section id="account" title="Your account">
        <ul>
          <li>Give an email address you can receive mail at, and keep your password to yourself.</li>
          <li>You are responsible for what happens under your account. Tell us at <Confirm id="contact" /> if you think someone else has used it.</li>
          <li>Signing in keeps you signed in on that browser for up to 30 days. Resetting your password does not yet sign out other browsers, so sign out of any you do not trust.</li>
        </ul>
      </Section>

      <Section id="content" title="Your content">
        <p>Your notes, tasks, goals, subjects, saved pages and messages are yours. You allow us to store, process and display them, and to send them to the service providers named in the <Link href="/privacy">Privacy Policy</Link> (including the AI provider for the features you use), only to run Kivo for you. Do not add content you do not have the right to use.</p>
      </Section>

      <Section id="ai" title="AI and study guidance">
        <ul>
          <li>Nova’s replies are written by an AI model. They can be wrong, incomplete or out of date. Check anything important against your own course materials.</li>
          <li>Plans, review dates and topic estimates are worked out from what you record and how you say your sessions went. They are estimates, not test results or grades.</li>
          <li>Kivo is not medical, mental-health, legal or professional advice, and it does not replace your teachers or your institution’s rules.</li>
          <li>Kivo changes your records only when you act or confirm. An AI reply alone never changes them.</li>
        </ul>
      </Section>

      <Section id="use" title="Using Kivo fairly">
        <p>Do not:</p>
        <ul>
          <li>try to reach another person’s account or data;</li>
          <li>attack, overload, probe or interfere with Kivo, or get around its limits;</li>
          <li>collect data from Kivo by automated means, apart from the browser extension’s intended use;</li>
          <li>use Kivo to break the law or to harm anyone.</li>
        </ul>
      </Section>

      <Section id="others" title="Other services">
        <p>Telegram, Google sign-in and your web browser are provided by other companies under their own terms. We are not responsible for them, and they may change or stop independently of Kivo.</p>
      </Section>

      <Section id="availability" title="Changes to Kivo">
        <p>Kivo is being developed actively. Features may change, be added or be removed, and the service may sometimes be unavailable. We do not promise that it will always be available or free of errors.</p>
      </Section>

      <Section id="ending" title="Ending your use">
        <p>You can stop using Kivo at any time and delete your account in Settings. Deleting your account deletes your study record with it, as the <Link href="/privacy#controls">Privacy Policy</Link> describes.</p>
        <p><Confirm id="termination" /></p>
      </Section>

      <Section id="liability" title="Disclaimers and liability">
        <p><Confirm id="liability" /></p>
      </Section>

      <Section id="law" title="Governing law">
        <p><Confirm id="governingLaw" /></p>
      </Section>

      <Section id="changes" title="Changes and contact">
        <p><Confirm id="changes" /> Questions about these terms: <Confirm id="contact" />.</p>
      </Section>
    </LegalPage>
  )
}
