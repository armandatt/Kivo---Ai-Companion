// Builds the unpacked extension into dist/.
//
//   NOVA_URL=https://your-nova.example npm run build --workspace nova-extension
//
// NOVA_URL is the address of the Nova web app. It is the only address the
// extension ever talks to, and it is fixed at build time: the extension has
// no setting that could point it somewhere else.
//
// NOVA_RELEASE=1 makes this a build for real use: NOVA_URL must then be given,
// be https and not point at this machine. Without it, a missing NOVA_URL means
// localhost:3000 (development), and a local address is allowed, which is also
// how a build is pointed at a dead port to see the popup's failure states.
// `npm run build:safari:release` sets it, as `npm run package` does its own check.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out  = process.env.NOVA_EXTENSION_OUT ?? join(root, 'dist')

let origin
try {
  const release = process.env.NOVA_RELEASE === '1'
  if (release && !process.env.NOVA_URL) throw new Error('a release needs NOVA_URL: the https address of the Nova web app')
  const url = new URL(process.env.NOVA_URL ?? 'http://localhost:3000')
  const local = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')
  if (release && (url.protocol !== 'https:' || local || url.username || url.password)) throw new Error('a release must use an https address that is not this machine and carries no login')
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('NOVA_URL must be https (or localhost)')
  origin = url.origin
} catch (err) {
  console.error(`Bad NOVA_URL: ${err.message}`)
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'icons'), { recursive: true })
cpSync(join(root, 'src'), out, { recursive: true, filter: source => !source.endsWith('manifest.template.json') })
writeFileSync(join(out, 'config.js'), `// Written by scripts/build.mjs.\nexport const NOVA_URL = ${JSON.stringify(origin)}\n`)
writeFileSync(join(out, 'manifest.json'), readFileSync(join(root, 'src', 'manifest.template.json'), 'utf8'))

// ── KaTeX, for maths in Nova's answers (sidepanel.html). The same package the
// web app draws notes with, copied into the package: no remote code. Only
// what the panel loads: the script, its stylesheet, the woff2 fonts (every
// browser the extension runs in reads woff2) and the licence.
const katexDir = dirname(createRequire(join(root, 'package.json')).resolve('katex/package.json'))
const vendor = join(out, 'vendor', 'katex')
mkdirSync(join(vendor, 'fonts'), { recursive: true })
cpSync(join(katexDir, 'dist', 'katex.min.js'), join(vendor, 'katex.min.js'))
cpSync(join(katexDir, 'dist', 'katex.min.css'), join(vendor, 'katex.min.css'))
cpSync(join(katexDir, 'LICENSE'), join(vendor, 'LICENSE'))
for (const font of readdirSync(join(katexDir, 'dist', 'fonts')).filter(f => f.endsWith('.woff2'))) cpSync(join(katexDir, 'dist', 'fonts', font), join(vendor, 'fonts', font))

// ── Icons: Kivo's mark (components/brand/kivo-brand.tsx: a dot, two arcs and
// the node on its orbit, on a 32-unit grid) in ink on a white tile, drawn here
// so the repository holds no binaries. Supersampled, so edges are smooth at 16px.
// The 128px icon is the store icon too: 96px of artwork, 16px clear each side.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body))
  return Buffer.concat([head, body, tail])
}
const INK = [13, 17, 23], TEAL = [63, 182, 168]
// Coverage of one point by the mark, on the 32-unit grid: [alpha, colour].
function markAt(u, v, small) {
  const d = Math.hypot(u - 16, v - 16)
  const layers = []
  if (Math.hypot(u - 25, v - 16) <= 1.9) layers.push([1, TEAL])
  if (d <= 4.2) layers.push([1, INK])
  // At toolbar sizes the arcs are a little bolder, or they vanish.
  if (Math.abs(d - 9) <= (small ? 1.4 : 0.85)) {
    if (u >= 16 && v <= 16) layers.push([small ? 0.7 : 0.5, INK])        // the arc top to right
    else if (u <= 16 && v >= 16) layers.push([small ? 0.45 : 0.25, INK])  // the arc bottom to left
  }
  return layers[0] ?? null
}
function icon(size) {
  const pad = size >= 128 ? 16 : size >= 48 ? 3 : 0, tile = size - pad * 2
  const radius = tile * 0.24, rows = [], N = 4
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        const px = x + (sx + 0.5) / N - pad, py = y + (sy + 0.5) / N - pad
        if (px < 0 || py < 0 || px > tile || py > tile) continue
        const dx = Math.max(radius - px, px - (tile - radius), 0), dy = Math.max(radius - py, py - (tile - radius), 0)
        if (dx * dx + dy * dy > radius * radius) continue
        // The tile, with a faint edge so it stays apart from a light toolbar.
        const edge = Math.min(px, py, tile - px, tile - py) < Math.max(0.6, tile / 96) ? 0.1 : 0
        let c = [255 - 255 * edge * 0.6, 255 - 255 * edge * 0.6, 255 - 255 * edge * 0.6]
        const m = markAt((px / tile) * 32, (py / tile) * 32, size < 64)
        if (m) c = c.map((ch, i) => ch * (1 - m[0]) + m[1][i] * m[0])
        r += c[0]; g += c[1]; b += c[2]; a += 255
      }
      const n = N * N, cover = a / 255
      row.set(cover ? [Math.round(r / cover), Math.round(g / cover), Math.round(b / cover), Math.round(a / n)] : [0, 0, 0, 0], 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
for (const size of [16, 48, 128]) writeFileSync(join(out, 'icons', `${size}.png`), icon(size))

console.log(`Nova extension built for ${origin} → ${out}`)
