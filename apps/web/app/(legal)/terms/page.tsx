import type { Metadata } from "next"
import Link from "next/link"
import { PLANS, formatPrice } from "@repo/api/billing/plans"
import { TERMS_VERSION } from "@repo/api/auth/legal"
import { LegalPage, Section } from "@/components/legal/legal-page"
import { COURTS, EFFECTIVE_DATE, GOVERNING_LAW, LEGAL_CONTACT, LEGAL_ENTITY, MIN_AGE } from "@/components/legal/to-confirm"

// Plain terms for the service as it exists today. Business and legal facts
// the code cannot establish come from the owner (components/legal/to-confirm.ts);
// one still missing would be a <Confirm> placeholder, never a guess.

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Kivo and Nova.",
}

const SECTIONS = [
  { id: "agreement", title: "These terms" },
  { id: "service", title: "What Kivo is" },
  { id: "eligibility", title: "Who can use Kivo" },
  { id: "account", title: "Your account" },
  { id: "content", title: "Your content" },
  { id: "ai", title: "AI and study guidance" },
  { id: "plans", title: "Plans and payment" },
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
      updated={TERMS_VERSION}
      effective={EFFECTIVE_DATE}
      sections={SECTIONS}
      summary={<p>Use Kivo to plan and track your own studying. What you write stays yours. Nova’s replies come from AI and can be wrong, so treat them as help, not as instructions you must follow. You can delete your account at any time from Settings.</p>}
    >
      <Section id="agreement" title="These terms">
        <p>These terms are an agreement between you and {LEGAL_ENTITY} (“Kivo”, “we”). When you create an account you are asked to agree to them, and you cannot create one without doing so; using Kivo means you continue to agree. Our <Link href="/privacy">Privacy Policy</Link> explains what we collect and how it is used.</p>
      </Section>

      <Section id="service" title="What Kivo is">
        <p>Kivo is a study companion. Its companion, Nova, plans your day from your subjects, dates and time, times your study sessions, schedules reviews and shows your progress. You can use it in your browser, on Telegram if you connect it, and through the browser extension.</p>
      </Section>

      <Section id="eligibility" title="Who can use Kivo">
        <p>You must be at least {MIN_AGE} years old to use Kivo. If you are under 18, you may use Kivo only with the consent of a parent or guardian, who agrees to these terms for you and is responsible for your use of it. If we learn that someone under {MIN_AGE} has an account, or that someone under 18 is using Kivo without that consent, we may close the account.</p>
      </Section>

      <Section id="account" title="Your account">
        <ul>
          <li>Give an email address you can receive mail at, and keep your password to yourself.</li>
          <li>You are responsible for what happens under your account. Tell us at <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> if you think someone else has used it.</li>
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
          <li>Kivo changes your records only when you act or confirm. An AI reply alone never changes them: Nova’s plans for your day and the workspaces it proposes are applied only when you approve them.</li>
        </ul>
      </Section>

      <Section id="plans" title="Plans and payment">
        <p>Kivo has a free plan. Pro, at {formatPrice(PLANS.pro_monthly)} a {PLANS.pro_monthly.interval}{PLANS.pro_monthly.trialDays ? ` after a ${PLANS.pro_monthly.trialDays}-day trial` : ""}, raises how much you can ask Nova each day. Payment is taken by Polar. Whatever plan you are on, what you have written and recorded stays yours, and nothing is deleted when a trial or a subscription ends.</p>
        <ul>
          <li><strong>Renewal.</strong> Pro renews automatically at the end of each billing period until you cancel.</li>
          <li><strong>Cancelling.</strong> You can cancel at any time. You keep Pro until the end of the period you have paid for, and you are not charged again.</li>
          <li><strong>Refunds.</strong> Payments are not refunded, including for part of a period, except where the law that applies to you requires a refund.</li>
          <li><strong>Taxes and the seller.</strong> Polar sells Pro as the merchant of record: it takes the payment, charges any tax that applies and issues the receipt. Its own terms apply to the purchase.</li>
          <li><strong>Price changes.</strong> If the price of Pro changes, we will tell you before your next renewal at the new price, and you can cancel before then.</li>
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
        <p>Telegram, Google sign-in, Polar and your web browser are provided by other companies under their own terms. We are not responsible for them, and they may change or stop independently of Kivo.</p>
        <p>Research papers and pages you import or open beside a note belong to their authors and publishers. Kivo brings in only what a source shares openly and shows a source inside Notes only where that source allows it; otherwise it opens in its own tab. Respect each source’s own terms.</p>
      </Section>

      <Section id="availability" title="Changes to Kivo">
        <p>Kivo is being developed actively. Features may change, be added or be removed, and the service may sometimes be unavailable. We do not promise that it will always be available or free of errors.</p>
      </Section>

      <Section id="ending" title="Ending your use">
        <p>You can stop using Kivo at any time and delete your account in Settings. Deleting your account deletes your study record with it, as the <Link href="/privacy#controls">Privacy Policy</Link> describes.</p>
        <p>We may suspend or close an account that breaks these terms, puts other people or Kivo at risk, or where the law requires it. Where we can, we will tell you first and say why, so that you can put it right. If we stop offering Kivo altogether, we will tell you in advance where we can.</p>
      </Section>

      <Section id="liability" title="Disclaimers and liability">
        <p>Kivo is provided “as is” and “as available”. As far as the law allows, we give no warranties beyond those stated in these terms, including that Kivo will meet your needs, be uninterrupted or be free of errors, or that study plans, estimates or AI replies will be correct.</p>
        <p>As far as the law allows, Kivo is not liable for indirect or consequential loss, such as lost marks, lost opportunities or lost data that you could have kept a copy of. Our total liability to you for anything arising from Kivo is limited to the amount you paid us in the 12 months before the claim, or ₹1,000, whichever is greater.</p>
        <p>Nothing in these terms limits any liability that cannot be limited under the law that applies to you, or any rights you have as a consumer that cannot be given up.</p>
      </Section>

      <Section id="law" title="Governing law">
        <p>These terms are governed by {GOVERNING_LAW}. Disputes are decided by {COURTS}, unless the law where you live gives you the right to bring a claim there.</p>
      </Section>

      <Section id="changes" title="Changes and contact">
        <p>When we change these terms, the date at the top of this page changes. If a change matters to how you use Kivo, we will tell you by email or in Kivo before it takes effect. Questions about these terms: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.</p>
      </Section>
    </LegalPage>
  )
}
