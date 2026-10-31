// ─── A reply as the model writes it ───────────────────────────────────────────
// Nova's tutor and Today's Nova answer in one JSON object, read and checked
// whole when it is finished (that object is what counts, and what the page
// keeps). While it is being written, the words the learner will read can
// already be shown: liveText picks them out of the unfinished JSON.
//
// This is display only. Nothing here decides anything, and the checked reply
// replaces it. A provider that gives no deltas simply shows the waiting state
// until the reply arrives.
//
// No regex (SKILL.md; the no-regex guard): the text is read by characters.

// The readable fields of each reply, wherever they are in the object.
export const TUTOR_LIVE_KEYS: readonly string[] = ["text", "question", "feedback"];
export const COPILOT_LIVE_KEYS: readonly string[] = ["reply", "question"];

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

// The string values of `keys` in a JSON object that may stop anywhere, in
// order. A string still being written counts as far as it is complete; an
// escape cut in half is left for the next call.
export function liveStrings(raw: string, keys: readonly string[]): string[] {
  const out: string[] = [];
  let i = raw.indexOf("{");
  if (i < 0) return out;
  let lastString: string | null = null;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch !== '"') {
      // A string followed by ":" was a key; anything else ends that reading.
      if (ch !== ":" && ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "\t") lastString = null;
      i++;
      continue;
    }
    let value = "";
    let closed = false;
    let j = i + 1;
    while (j < raw.length) {
      const c = raw[j]!;
      if (c === '"') { closed = true; j++; break; }
      if (c !== "\\") { value += c; j++; continue; }
      const next = raw[j + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = raw.slice(j + 2, j + 6);
        if (hex.length < 4) break;
        const code = Number.parseInt(hex, 16);
        if (Number.isNaN(code)) break;
        value += String.fromCharCode(code);
        j += 6;
        continue;
      }
      value += ESCAPES[next] ?? next;
      j += 2;
    }
    let after = j;
    while (after < raw.length && " \n\r\t".includes(raw[after]!)) after++;
    const isKey = closed && raw[after] === ":";
    if (isKey) {
      lastString = value;
    } else {
      if (lastString !== null && keys.includes(lastString) && value) out.push(value);
      lastString = null;
    }
    if (!closed) break;
    i = j;
  }
  return out;
}

// [S1], [S12]: the citations the checked reply turns into links.
function withoutCitations(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[" && text[i + 1] === "S") {
      let j = i + 2;
      while (j < text.length && text[j]! >= "0" && text[j]! <= "9") j++;
      if (j > i + 2 && text[j] === "]") {
        if (out.endsWith(" ")) out = out.slice(0, -1);
        i = j + 1;
        continue;
      }
      // Cut off mid-citation at the end of what has arrived: wait for the rest.
      if (j === text.length) break;
    }
    out += text[i];
    i++;
  }
  return out;
}

export function liveText(raw: string, keys: readonly string[]): string {
  return withoutCitations(liveStrings(raw, keys).join("\n\n"));
}
