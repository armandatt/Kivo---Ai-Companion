// Screenshots pasted into the message box (Cmd+V / Ctrl+V): the images on
// the clipboard, named so the learner and Nova can tell them apart. Pure;
// the composer turns them into attachments like any other file. Run the
// tests with `npm test`.

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' }

// The files on the clipboard that are images, in their order.
export function imagesOnClipboard(items: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }>): File[] {
  const out: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const f = item.getAsFile()
    if (f) out.push(f)
  }
  return out
}

// "Screenshot 1.png", "Screenshot 2.png", … not taken by what is attached
// already. A clipboard image is usually called "image.png", whatever it is.
export function pastedName(taken: readonly string[], type: string): string {
  const ext = EXT[type] ?? 'png'
  let n = 1
  while (taken.includes(`Screenshot ${n}.${ext}`)) n++
  return `Screenshot ${n}.${ext}`
}

// A photo larger than this is made smaller in the browser before it is sent:
// a screenshot reads as well at 2000 pixels, and fits the 3 MB a message takes.
export const SHRINK_OVER_BYTES = 1_200_000
export const SHRINK_MAX_SIDE = 2000
export function shrunkSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, SHRINK_MAX_SIDE / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}
