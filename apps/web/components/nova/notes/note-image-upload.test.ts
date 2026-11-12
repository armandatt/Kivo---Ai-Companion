// Screenshots into a note and to Nova (note-image-upload.ts): where a line
// goes, what a failure says and whether a retry can help, and which earlier
// images a follow-up sends again (12 Nov).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { earlierImages, imageMarkdown, insertImageLines, storeImageData, storeImageFile } from './note-image-upload'
import { canRetry } from './tutor-session'
import { imageLine } from './note-blocks'

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch

test('the line is a note image the renderer reads, its caption made safe', () => {
  const line = imageMarkdown('cimgaaaaaaaa01', 'Slide [4]\nlecture')
  assert.equal(line, '![Slide 4 lecture](kivo-image:cimgaaaaaaaa01)')
  assert.deepEqual(imageLine(line), { alt: 'Slide 4 lecture', id: 'cimgaaaaaaaa01' })
})

test('pasted at the caret: on lines of their own, the text around kept', () => {
  const r = insertImageLines('Before here.After here.', 12, ['![a](kivo-image:x1234567)', '![b](kivo-image:y1234567)'])
  assert.equal(r.text, 'Before here.\n\n![a](kivo-image:x1234567)\n\n![b](kivo-image:y1234567)\n\nAfter here.')
  assert.equal(r.text.slice(0, r.caret).endsWith('\n\n'), true)
  assert.equal(insertImageLines('', 0, ['![a](kivo-image:x1234567)']).text, '![a](kivo-image:x1234567)\n')
  assert.equal(insertImageLines('Line\n', 5, ['![a](kivo-image:x1234567)']).text, 'Line\n\n![a](kivo-image:x1234567)\n')
})

test('stored: the id comes back; the same key is sent on a retry', async () => {
  const sent: string[] = []
  const post = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body)).clientKey); return new Response(JSON.stringify({ ok: true, image: { id: 'cimg1' } }), { status: 200 }) }) as unknown as typeof fetch
  assert.deepEqual(await storeImageData('n1', 'AAAA', 'k1', post), { ok: true, id: 'cimg1' })
  await storeImageData('n1', 'AAAA', 'k1', post)
  assert.deepEqual(sent, ['k1', 'k1'])
})

test('a failure says why, and says whether trying again can help', async () => {
  assert.deepEqual(await storeImageData('n1', 'A', 'k', reply(413, { ok: false, error: 'too_large', message: 'That image is too large.' })), { ok: false, message: 'That image is too large.', retry: false })
  assert.deepEqual(await storeImageData('n1', 'A', 'k', reply(400, { ok: false, error: 'unsupported', message: 'Only PNG, JPEG or WebP images can go in a note.' })), { ok: false, message: 'Only PNG, JPEG or WebP images can go in a note.', retry: false })
  assert.deepEqual(await storeImageData('n1', 'A', 'k', reply(404, { ok: false, error: 'not_found', message: "That note doesn't exist any more." })), { ok: false, message: "That note doesn't exist any more.", retry: false })
  assert.equal((await storeImageData('n1', 'A', 'k', reply(401, { error: 'Unauthenticated' }))).ok, false)
  const busy = await storeImageData('n1', 'A', 'k', reply(429, { ok: false, error: 'rate_limited', message: "That's a lot at once. Give it a minute." }))
  assert.equal(busy.ok === false && busy.retry, true)
  const down = await storeImageData('n1', 'A', 'k', (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)
  assert.equal(down.ok === false && down.retry, true)
})

test('an unsupported file is refused before anything is sent', async () => {
  let called = false
  const r = await storeImageFile('n1', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'k', (async () => { called = true; return new Response('{}') }) as unknown as typeof fetch)
  assert.equal(r.ok, false); assert.equal(called, false)
})

test('a small image is sent as it is', async () => {
  let body: { data: string } | null = null
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  await storeImageFile('n1', png, 'k', (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ ok: true, image: { id: 'c' } })) }) as unknown as typeof fetch)
  assert.equal(body!.data, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
})

test('a follow-up sends the latest earlier images again, never one sent now, at most four in all', () => {
  const asks = [{ images: ['a1', 'a2'] }, {}, { images: ['b1'] }, { images: ['c1', 'c2'] }]
  assert.deepEqual(earlierImages(asks, []), ['c1', 'c2', 'b1', 'a1'])
  assert.deepEqual(earlierImages(asks, ['n1', 'n2', 'n3']), ['c1'])
  assert.deepEqual(earlierImages(asks, ['c1']), ['c2', 'b1', 'a1'])
})

test('a message with a stored screenshot can be sent again after a reload; a lost PDF cannot', () => {
  assert.equal(canRetry({ mode: 'explain', attached: ['shot.png'], images: ['cimg1'] }), true)
  assert.equal(canRetry({ mode: 'explain', attached: ['shot.png', 'paper.pdf'], images: ['cimg1'] }), false)
  assert.equal(canRetry({ mode: 'explain', attached: ['shot.png'], toStore: [{ name: 'shot.png', data: 'A', key: 'k' }] }), true)
  assert.equal(canRetry({ mode: 'explain' }), true)
})

test('what the tab keeps of a conversation: the image ids, never the bytes', async () => {
  const { withoutFiles } = await import('./tutor-session')
  const kept = withoutFiles({ id: 'e1', role: 'learner', at: 1, ask: { mode: 'explain', message: 'x', images: ['cimg1'], toStore: [{ name: 's.png', data: 'AAAA', key: 'k' }], files: [{ name: 'p.pdf', data: 'BBBB' }], previews: ['blob:x'] } } as never) as unknown as { ask: Record<string, unknown> }
  assert.deepEqual(kept.ask.images, ['cimg1'])
  assert.equal('toStore' in kept.ask || 'files' in kept.ask || 'previews' in kept.ask, false)
})
