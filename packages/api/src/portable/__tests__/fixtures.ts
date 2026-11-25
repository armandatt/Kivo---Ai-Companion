// Small real files for the portable tests: a PNG of a given size, a JPEG
// header, a WebP header and a minimal PDF. Built in code, never read from disk.
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

export function png(w = 40, h = 30, seed = 1): Uint8Array {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * seed) & 255; raw[o + 1] = 90; raw[o + 2] = (y * 7 + seed) & 255; }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// A WebP header (VP8X) declaring 64×48: enough for imageInfo, not a picture.
export function webp(): Uint8Array {
  const b = Buffer.alloc(30); b.write("RIFF", 0, "latin1"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "latin1"); b.write("VP8X", 12, "latin1");
  b.writeUIntLE(63, 24, 3); b.writeUIntLE(47, 27, 3);
  return new Uint8Array(b);
}

export function pdf(text = "Hello from a PDF"): Uint8Array {
  const body = `%PDF-1.4\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]>> endobj\n% ${text}\ntrailer <</Root 1 0 R>>\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
