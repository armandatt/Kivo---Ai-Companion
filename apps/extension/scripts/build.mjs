// Builds the unpacked extension into dist/.
//
//   NOVA_URL=https://your-nova.example npm run build --workspace nova-extension
//
// NOVA_URL is the address of the Nova web app. It is the only address the
// extension ever talks to, and it is fixed at build time: the extension has
// no setting that could point it somewhere else.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out  = process.env.NOVA_EXTENSION_OUT ?? join(root, 'dist')

let origin
try {
  const url = new URL(process.env.NOVA_URL ?? 'http://localhost:3000')
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

// ── Icons: a rounded teal square, drawn here so the repository holds no binaries.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body))
  return Buffer.concat([head, body, tail])
}
function icon(size) {
  const radius = size * 0.24, rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0), dy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0)
      const inside = dx * dx + dy * dy <= radius * radius
      const t = (x + y) / (2 * size)
      row.set([Math.round(127 - 80 * t), Math.round(207 - 64 * t), Math.round(192 - 64 * t), inside ? 255 : 0], 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
for (const size of [16, 48, 128]) writeFileSync(join(out, 'icons', `${size}.png`), icon(size))

console.log(`Nova extension built for ${origin} → ${out}`)
