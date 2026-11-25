// ─── What an image is, by its bytes ───────────────────────────────────────────
// Pure (no database): PNG, JPEG or WebP, and the size the bytes declare. Used
// by note images (note-images.ts) and by shared .kivo packages (portable/),
// which check an image's bytes before anything is stored.

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

// The type and size the bytes say, or null when they are none of the three.
export function imageInfo(input: Uint8Array): { type: ImageType; width: number; height: number } | null {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length >= 24 && b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG" && b.subarray(12, 16).toString("latin1") === "IHDR") {
    return { type: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // The first start-of-frame marker holds the size.
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at++; continue; }
      const marker = b[at + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = b.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
      }
      at += 2 + length;
    }
    return null;
  }
  if (b.length >= 30 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    const chunk = b.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return { type: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { type: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") { const bits = b.readUInt32LE(21); return { type: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  }
  return null;
}

