import type { Metadata } from "next"
import Link from "next/link"
import { PRIVACY_VERSION } from "@repo/api/auth/legal"
import { Confirm, LegalPage, Section } from "@/components/legal/legal-page"

// Written from what the code stores and sends (the database schema, the auth
// and Nova services, the browser extension's own statement). Anything the
// code cannot establish is a <Confirm> placeholder, never a guess.

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Kio collects, why, who processes it, and the controls you have.",
  // A draft with facts still to confirm: kept out of search results until published.
  robots: { index: false, follow: true },
}

const SECTIONS = [
  { id: "who", title: "Who we are" },
  { id: "collect", title: "What we collect" },
  { id: "use", title: "How we use it" },
  { id: "ai", title: "AI features" },
  { id: "sources", title: "Research papers and sources" },
  { id: "processors", title: "Who processes it" },
  { id: "browser", title: "Cookies and your browser" },
  { id: "controls", title: "Your controls" },
  { id: "keeping", title: "How long we keep it" },
  { id: "security", title: "Security" },
  { id: "children", title: "Children" },
  { id: "rights", title: "Your rights" },
  { id: "changes", title: "Changes and contact" },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={PRIVACY_VERSION}
      sections={SECTIONS}
      summary={<p>Kio keeps what you give it to plan and run your studying: your account, what you study, what you write, and your conversations with Nova. Some of it is sent to an AI provider to answer you. You can edit or delete what you create, and delete your whole account from Settings.</p>}
    >
      <Section id="who" title="Who we are">
        <p>Kio is provided by <Confirm id="entity" />. Kio was called Kivo until October 2026; the name changed, not the service. You can contact us at <Confirm id="contact" />. <Confirm id="address" /></p>
      </Section>

      <Section id="collect" title="What we collect">
        <p><strong>Your account.</strong> Your name and email address, and whether that address has been confirmed. If you sign up with a password, we store it only as a one-way hash, never the password itself. If you sign in with Google, we receive from Google your email address, your name, a link to your profile picture and your Google account identifier. Google’s sign-in tokens are not stored.</p>
        <p><strong>Your answers when you set up.</strong> What you are working toward, what you are learning for (school, college, work or other), how firmly you want to be nudged, when you would like a daily check-in, and your timezone. If you answer the four short statements at the end of setup, we keep your answers and a summary of them. The summary is used to match you with a companion and, where that feature is turned on, to adjust how it phrases its coaching. It is not a personality test result.</p>
        <p><strong>What you study and create.</strong></p>
        <ul>
          <li>Your subjects, topics, exams and other dates, your goals, and your usual study time.</li>
          <li>Your study sessions: when they started and ended, how long they were, your answer to “How did it go?”, and any short note you add afterwards.</li>
          <li>Your tasks, your notes (including what you write in them), and where you put cards on your Knowledge Map.</li>
          <li>Each day’s flow on Today: the items you planned, their order and times, and what the day is for.</li>
          <li>Your calendar events and the reminders you set on them.</li>
          <li>Workspaces you build with Nova: the conversation, the plan’s versions and what was created from it. Files you attach (a PDF or a photo) are kept with that conversation until the workspace is built or the conversation is cancelled, and then deleted.</li>
          <li>Research papers you import: the paper’s link, its details (title, authors, identifiers), its abstract and any text its source shares openly, saved as one of your notes.</li>
          <li>Pages you save: their address, title, site and the subject and topic you file them under. If you save a selected passage from a page, that passage too.</li>
        </ul>
        <p><strong>What Kio works out from that.</strong> Estimates of how well you know each topic, when topics are due for review, your progress over time, and patterns in how you study. These come from your own records and answers. They are estimates, not test results.</p>
        <p><strong>Your profile.</strong> What you choose to add on your Profile page: a headline, organisation, location, a short bio, skills and links. Only you see it, and Nova does not read it.</p>
        <p><strong>Your agreement to these documents.</strong> When you create an account, which versions of the Terms of Service and this Privacy Policy you agreed to, when, and whether you signed up with email or Google. Nothing about your device or network is recorded with it.</p>
        <p><strong>Billing, if you subscribe.</strong> Your plan, its status and its renewal dates. Payments are handled by Polar; Kio does not receive or store your card details.</p>
        <p><strong>Your conversations with Nova.</strong> The messages you send Nova on Telegram and in the chat on the web, and Nova’s replies, with Kio’s reading of each message (for example, whether you asked for a plan). Nova also keeps facts you mention that matter for planning, such as being ill this week or working a job, so it does not push you when it should not. Two conversations are not stored by Kio at all: planning your day with Nova on Today, and studying a note with Nova. They stay in your browser tab and are gone when you close it.</p>
        <p><strong>Telegram, if you connect it.</strong> Your Telegram chat identifier, your name as it appears on Telegram and your Telegram username.</p>
        <p><strong>The browser extension, if you use it.</strong> When you press its buttons: the page’s address and title, the subject and topic you choose, and a passage only if you choose to save one. For each connected browser, a label such as “Chrome on macOS”, when it was connected and last used, and a one-way hash of its credential.</p>
        <p><strong>Sign-in safety.</strong> To limit repeated sign-in, sign-up and reset attempts, we count attempts per email address, stored in a hashed form.</p>
      </Section>

      <Section id="use" title="How we use it">
        <ul>
          <li>To run Kio for you: building today’s plan, timing and recording study sessions, scheduling reviews, and showing your progress, notes, tasks, saved pages and map.</li>
          <li>To send you account emails: sign-up codes, password-reset links, and notices about your account (for example, that an address is already registered).</li>
          <li>To message you on Telegram if you connected it, including the check-in at the time you chose and reminders such as a review falling due.</li>
          <li>To answer and help you with AI, as described below.</li>
          <li>To keep accounts safe, for example by limiting repeated sign-in attempts.</li>
        </ul>
        <p><Confirm id="noSale" /></p>
      </Section>

      <Section id="ai" title="AI features">
        <p>Some features send information to an AI model provider to produce a reply. Kio decides what to send for each feature:</p>
        <ul>
          <li><strong>Talking to Nova</strong> (web or Telegram): your message, recent conversation, and the parts of your study record that the reply needs, such as today’s plan or your goals.</li>
          <li><strong>Planning today with Nova:</strong> your message, the recent conversation, today’s flow, your upcoming dates and goals, and the names of the subjects and topics on your Knowledge Map.</li>
          <li><strong>Building with Nova:</strong> your messages, the plan so far, and any file you attach.</li>
          <li><strong>Nova as your note editor:</strong> the note’s text and what you asked it to change.</li>
          <li><strong>Transcribing a PDF or photo</strong> into a note, when you ask for it: that file. Kio does not keep the file afterwards.</li>
          <li><strong>Nova’s help on a note:</strong> that note’s text, and a few of your related notes and saved pages.</li>
          <li><strong>Filing a saved page:</strong> the page’s title, its site name, any passage you saved, and the names of your subjects and topics. Not the page’s address. Kio never opens the page.</li>
          <li><strong>Asking Nova to update your subjects:</strong> the names of your subjects and topics, your goals and your request.</li>
          <li><strong>Asking about a page from the browser extension:</strong> your question, the page’s title and site name, and any text you selected. The question is not stored.</li>
        </ul>
        <p>The note you add after a study session is not sent to the AI model. AI replies can be wrong; nothing an AI reply says changes your records unless you confirm it.</p>
        <p>The provider used is <Confirm id="aiProvider" />.</p>
      </Section>

      <Section id="sources" title="Research papers and sources">
        <p>When you import a paper, Kio’s server asks the source’s own public service for it (arXiv, Crossref, DataCite, Semantic Scholar, OpenReview or Europe PMC, depending on the link). That request names the paper, not you. Kio takes only what the source shares openly, never anything behind a sign-in or a paywall.</p>
        <p>When you open a paper’s PDF or a note’s source beside your note, Kio’s server first reads that site’s response headers to see whether it allows being shown inside another site. Your browser then loads the PDF or page directly from that site, as it would in a new tab, so that site sees your visit under its own privacy policy. Kio does not copy or store the PDF.</p>
      </Section>

      <Section id="processors" title="Who processes it">
        <p>Kio relies on service providers to host and deliver it. Each receives only what its part of the service needs:</p>
        <ul>
          <li>Hosting for the web app and the server, and the database. <Confirm id="providers" /></li>
          <li>Resend, which delivers Kio’s emails.</li>
          <li>Polar, which takes payment if you subscribe to Pro.</li>
          <li>Google, if you choose to sign in with Google.</li>
          <li>Telegram, which carries your messages with Nova if you connect it. Telegram’s own privacy policy applies to your use of Telegram.</li>
          <li>The AI model provider described above.</li>
          <li>Vercel Web Analytics, which records visits to Kio’s pages. <Confirm id="analytics" /></li>
        </ul>
        <p><Confirm id="hostingLogs" /></p>
      </Section>

      <Section id="browser" title="Cookies and your browser">
        <ul>
          <li><strong>Session cookie.</strong> Keeps you signed in, for up to 30 days.</li>
          <li><strong>Google sign-in cookie.</strong> A short-lived cookie used only while you sign in with Google, to check the reply really comes from your sign-in.</li>
          <li><strong>Stored in your browser only.</strong> Your theme choice, unsaved drafts of notes and a few display preferences stay in your browser’s storage and are not sent to Kio until you save.</li>
          <li><strong>Music in Focus.</strong> If you play music in the Focus room, it plays in YouTube’s, Spotify’s or Apple Music’s own player, loaded from their sites, which may set their own cookies.</li>
          <li><strong>Your timezone.</strong> Your browser reports it to Kio so that “today” and your check-in time match your day.</li>
        </ul>
      </Section>

      <Section id="controls" title="Your controls">
        <ul>
          <li>Edit or delete your notes, tasks, saved pages, exams and other dates, and goals. Topics you no longer study can be archived.</li>
          <li>Change your check-in time and other preferences in <Link href="/settings">Settings</Link>.</li>
          <li>Disconnect the browser extension from its popup or from the Browser Extension page.</li>
          <li>Reset your password from your <Link href="/profile">Profile</Link>, or with Forgot password on the sign-in page.</li>
          <li><strong>Delete your account</strong> in Settings. This deletes your account and your Nova study record with it: subjects, topics, sessions, notes, tasks, saved pages, your map, connected browsers, and your conversation with Nova. Two exceptions: if another Kio account is connected to the same Telegram chat, that chat’s history is left for that account; and a Telegram chat first set up with Rex, Kio’s earlier companion, keeps its own history.</li>
          <li>There is no button to disconnect Telegram yet. You can stop Nova messaging you by blocking the bot in Telegram, or by deleting your account.</li>
          <li>There is no self-service download of your data yet. <Confirm id="requests" /></li>
        </ul>
      </Section>

      <Section id="keeping" title="How long we keep it">
        <p>A sign-up code stops working after 10 minutes, and a password-reset link after one hour. A connected browser’s credential stops working after 30 days without use. Everything else is kept while your account exists, until you delete it or delete your account.</p>
        <p><Confirm id="retention" /></p>
        <p><Confirm id="consentKeeping" /></p>
      </Section>

      <Section id="security" title="Security">
        <p>Passwords, sign-up codes, password-reset tokens and browser credentials are stored only as one-way hashes. Each request is checked against your own account, so one learner’s records are not reachable from another’s. No system is perfectly secure, and we do not promise that yours will never be exposed.</p>
      </Section>

      <Section id="children" title="Children">
        <p><Confirm id="minAge" /></p>
      </Section>

      <Section id="rights" title="Your rights">
        <p>Depending on where you live, you may have rights over your personal data, such as to access, correct or delete it. Use the controls above, or contact us at <Confirm id="contact" />.</p>
        <p><Confirm id="legalBasis" /></p>
      </Section>

      <Section id="changes" title="Changes and contact">
        <p><Confirm id="changes" /> Questions about this policy: <Confirm id="contact" />. See also the <Link href="/terms">Terms of Service</Link>.</p>
      </Section>
    </LegalPage>
  )
}
