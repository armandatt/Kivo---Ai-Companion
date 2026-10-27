// Facts the Privacy Policy and Terms need that the code cannot establish.
// Each is shown on the page as a marked placeholder until the owner supplies
// it; nothing here is a guess. One list, so the pages and the review of what
// is missing never disagree.

export const TO_CONFIRM = {
  entity:        'The legal name of the person or company that provides Kio',
  contact:       'A contact email address for privacy and legal questions',
  address:       'A postal address, if the law that applies to you requires one',
  effectiveDate: 'The date these documents take effect',
  minAge:        'The minimum age to use Kio, and whether younger users need a parent or guardian’s consent',
  providers:     'The service providers used in production and where they store data. The code points to Vercel (web app), Render (API), Neon (database), Resend (email) and Polar (billing); confirm these and their regions',
  aiProvider:    'Which AI provider production uses (the code supports Anthropic’s Claude, Google Gemini and OpenAI, chosen by configuration) and that provider’s terms on the data it receives',
  analytics:     'How Vercel Web Analytics is configured and what it records',
  hostingLogs:   'Whether the hosting providers’ request logs record IP addresses, and for how long',
  noSale:        'Whether Kio sells personal data or shares it with anyone other than the service providers listed',
  retention:     'How long account data, conversations and study records are kept, and how long backups are kept',
  requests:      'How someone asks for a copy of their data, or for deletion if they cannot sign in',
  legalBasis:    'The legal bases for processing and the rights section required where your users are (for example the GDPR in the EU and UK), if it applies',
  changes:       'How changes to these documents will be announced',
  termination:   'When Kio may suspend or close an account',
  billing:       'Pro’s renewal, cancellation, refund and tax terms, and whether Polar sells it as merchant of record',
  consentKeeping:'How long sign-up agreement records are kept, including whether any record is kept after an account is deleted',
  liability:     'Warranty disclaimer and limitation of liability wording, from a qualified legal adviser',
  governingLaw:  'Which law governs the Terms and where disputes are decided',
} as const

export type ToConfirm = keyof typeof TO_CONFIRM
