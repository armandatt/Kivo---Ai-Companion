// Builds the extension for release and writes the ZIP the Chrome Web Store takes.
//
//   NOVA_URL=https://your-nova.example npm run package --workspace nova-extension
//   → apps/extension/release/nova-extension-<version>.zip
//
// The ZIP holds the built extension and nothing else: no source maps, no
// tests, no environment file, no credential (the extension has none until a
// learner pairs it). The same sources and the same NOVA_URL give the same
// bytes every time: entries are sorted and carry one fixed date, so the
// printed SHA-256 can be compared against a rebuild.
//
// It refuses to package anything that is not the audited shape: a release
// must talk to an https address that is not this machine, ask for the two
// permissions and no others, and carry no other address.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fail = message => { console.error(`Cannot package: ${message}`); process.exit(1) }

// ── The address ───────────────────────────────────────────────────────────────
const LOCAL = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']
if (!process.env.NOVA_URL) fail('set NOVA_URL to the address of the Nova web app, e.g. NOVA_URL=https://your-nova.example')
let origin
try {
  const url = new URL(process.env.NOVA_URL)
  if (url.protocol !== 'https:') throw new Error('a release must use https')
  if (LOCAL.includes(url.hostname) || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')) throw new Error('a release cannot point at this machine')
  if (url.username || url.password) throw new Error('the address must not carry a login')
  origin = url.origin
} catch (err) {
  fail(`bad NOVA_URL (${err.message})`)
}

// ── Build into a clean folder ─────────────────────────────────────────────────
const stage = mkdtempSync(join(tmpdir(), 'nova-extension-release-'))
execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { env: { ...process.env, NOVA_URL: origin, NOVA_EXTENSION_OUT: stage }, stdio: 'ignore' })

const files = []
const walk = dir => { for (const name of readdirSync(dir).sort()) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : files.push(path) } }
walk(stage)
const entries = files.map(path => ({ name: relative(stage, path).split(sep).join('/'), data: readFileSync(path) })).sort((a, b) => (a.name < b.name ? -1 : 1))

// ── Check what is about to be shipped ─────────────────────────────────────────
const EXPECTED = ['config.js', 'icons/128.png', 'icons/16.png', 'icons/48.png', 'lib/api.js', 'lib/page.js', 'lib/store.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js']
const names = entries.map(e => e.name)
if (JSON.stringify(names) !== JSON.stringify(EXPECTED)) fail(`unexpected files in the build: ${names.join(', ')}`)

const text = name => entries.find(e => e.name === name).data.toString('utf8')
const manifest = JSON.parse(text('manifest.json'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.manifest_version !== 3) fail('the manifest is not version 3')
if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} is not package.json version ${pkg.version}`)
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['activeTab', 'storage'])) fail(`permissions are ${JSON.stringify(manifest.permissions)}`)
for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'web_accessible_resources', 'externally_connectable']) {
  if (manifest[key] !== undefined) fail(`the manifest declares ${key}`)
}
if ((manifest.description ?? '').length > 132) fail('the manifest description is over the store limit of 132 characters')
if (text('config.js').trim().split('\n').pop() !== `export const NOVA_URL = ${JSON.stringify(origin)}`) fail('config.js does not hold the release address')

for (const entry of entries.filter(e => !e.name.endsWith('.png'))) {
  const body = entry.data.toString('utf8')
  const elsewhere = [...body.matchAll(/https?:\/\/[^\s'"`<>)]+/g)].map(m => m[0]).filter(found => !found.startsWith(origin))
  if (elsewhere.length) fail(`${entry.name} names another address: ${elsewhere[0]}`)
  if (LOCAL.some(host => body.includes(host))) fail(`${entry.name} mentions a local address`)
  if (/nvx_[A-Za-z0-9]|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{16}|AIza[0-9A-Za-z_-]{20}/.test(body)) fail(`${entry.name} looks like it holds a credential`)
}

// ── The ZIP ───────────────────────────────────────────────────────────────────
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
// One date for every entry: 2020-01-01 00:00, in the ZIP's own format.
const DOS_TIME = 0, DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

function zip(list) {
  const locals = [], central = []
  let offset = 0
  for (const { name, data } of list) {
    const packed = deflateRawSync(data, { level: 9 })
    const file = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc32(data), 14)
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(file.length, 26)
    locals.push(head, file, packed)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(0x0314, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(DOS_TIME, 12); dir.writeUInt16LE(DOS_DATE, 14); dir.writeUInt32LE(crc32(data), 16)
    dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(file.length, 28)
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); dir.writeUInt32LE(offset, 42)
    central.push(dir, file)
    offset += head.length + file.length + packed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const outDir = process.env.NOVA_EXTENSION_RELEASE ?? join(root, 'release')
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `nova-extension-${manifest.version}.zip`)
const archive = zip(entries)
writeFileSync(target, archive)
rmSync(stage, { recursive: true, force: true })

console.log(`Nova extension ${manifest.version} for ${origin}`)
console.log(`  ${target}`)
console.log(`  ${entries.length} files, ${archive.length} bytes`)
console.log(`  sha256 ${createHash('sha256').update(archive).digest('hex')}`)
