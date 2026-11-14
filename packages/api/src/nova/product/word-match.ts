// ─── Words, matched the same way everywhere ───────────────────────────────────
// Pure, no imports: the saved-page reader (resource-processing.ts), the
// placement rules (knowledge-placement-rules.ts) and anything the web page
// imports can use it. No regex.

// A name this short matches too much by accident ("C", "OS") to act on.
const NAME_MIN_CHARS = 3;

// The words of a text, lower-cased: runs of letters and digits, whatever the
// script. Punctuation and spacing separate words and are otherwise ignored.
export function wordsOf(text: string): string[] {
  const words: string[] = [];
  let word = "";
  for (const ch of text.toLowerCase()) {
    const at = ch.codePointAt(0) ?? 0;
    // Scripts without case (Devanagari, CJK) count as letters; the punctuation
    // and symbol blocks above Latin do not.
    const uncased = at > 0x2ff && !(at >= 0x2000 && at <= 0x2bff) && !(at >= 0x3000 && at <= 0x303f) && !(at >= 0xfe00 && at <= 0xfe6f) && !(at >= 0xff00 && at <= 0xff0f);
    const letter  = ch.toLowerCase() !== ch.toUpperCase() || (ch >= "0" && ch <= "9") || uncased;
    if (letter) { word += ch; continue; }
    if (word) { words.push(word); word = ""; }
  }
  if (word) words.push(word);
  return words;
}

// Whether `name`, as whole words in order, appears in `text`.
export function namesIt(textWords: string[], name: string): boolean {
  const wanted = wordsOf(name);
  if (wanted.length === 0 || wanted.join("").length < NAME_MIN_CHARS) return false;
  for (let i = 0; i + wanted.length <= textWords.length; i++) {
    let all = true;
    for (let j = 0; j < wanted.length; j++) if (textWords[i + j] !== wanted[j]) { all = false; break; }
    if (all) return true;
  }
  return false;
}

// A word's singular, for evidence that should not care about plurals
// ("vectors" is evidence for "Vector Databases"). English endings only, and
// only on words long enough not to be mangled ("bus", "class" stay as they are).
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses") || word.endsWith("shes") || word.endsWith("ches") || word.endsWith("xes")) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}
