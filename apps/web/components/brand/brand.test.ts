// The product is Kio; it was Kivo until October 2026. Run with `npm test`.
//
// Every tracked file is read, and the old name may appear only as one of the
// identifiers below, each kept because something outside this repository's
// code depends on it (stored data, a browser, another deployment, a host).
// To keep another one, add it here with its reason.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'

const KEPT: Array<[RegExp, string]> = [
  [/kivo-(?:signal|style|mentors|match)-v\d/g, 'version tags stored on PersonalityAssessment rows and in UserProfile.mentorMatch, compared when read'],
  [/kivo_user_id|kivo_plan/g, 'metadata on subscriptions already created at Polar; the webhook reads kivo_user_id back'],
  [/x-kivo-(?:proxy-proof|client-ip)|kivo-auth-proxy-v1/g, 'the web proxy and the API are deployed separately and must agree on these'],
  [/kivo-theme|kivo-(?:note-draft|today-focus|today-layout|today-studio|today-subject|tutor|notes-layout|notes-list|onboarding-draft-v3|tz-reported|study-proposal|map-orientation|map-view|pending-save|pending-note-capture|recovery-hidden|focus-sound|focus-music|focus-room|build-split|calendar-view)|kivo_intro_v3|kivo\.telegram-card\.dismissed/g, 'browser storage keys: renaming them would lose drafts and settings people already have'],
  [/kivo-\$\{MOCK_TOTAL_DAYS\}/g, "the seed of Rex's sample creature world: renaming it redraws the terrain"],
  [/app\.kivo\.Nova(?:\.Extension)?/g, 'the Safari app and extension bundle ids: macOS registers the extension by them'],
  [/kivo-api(?:-6jh4\.onrender\.com|-staging)?|kivo-staging|kivo_staging_bot|kivo-ai-companion-web-kar8/g, 'names of hosted services, projects and bots that exist under these names'],
  [/daysWithKivo/g, "a field of GET /api/journey's response, which the web app reads"],
  [/thekivo\.in/g, 'the old domain, named only where the text says it is the old one'],
  [/called Kivo until October 2026|the old Kivo/g, 'says the product was renamed'],
]

// The monorepo's root by this file's place, not by `git rev-parse`: apps/web
// can hold a stray .git of its own.
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const SELF = 'apps/web/components/brand/brand.test.ts'
const texts = new Map<string, string>()
for (const file of files) {
  if (file === SELF || /\.(png|ico|jpe?g|woff2?)$/.test(file)) continue
  try { texts.set(file, readFileSync(join(root, file), 'utf8')) } catch { /* listed by git, not on disk */ }
}

test('the old name appears only as an identifier kept for a reason', () => {
  assert.ok(texts.size > 500 && texts.has('apps/web/app/layout.tsx'), 'reads the whole monorepo')
  const found: string[] = []
  for (let [file, text] of texts) {
    if (!/kivo/i.test(text)) continue
    for (const [pattern] of KEPT) text = text.replace(pattern, '')
    const lines = text.split('\n')
    lines.forEach((line, i) => { if (/kivo/i.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`) })
  }
  assert.deepEqual(found, [])
})

test('the old domain is named only in the API environment example, as the old one', () => {
  const at = [...texts].filter(([, text]) => /thekivo\.in/.test(text)).map(([file]) => file)
  assert.deepEqual(at, ['apps/api/.env.example'])
})
