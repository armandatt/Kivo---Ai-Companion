const negativeWords = ["tired", "sad", "bad", "rough", "exhausted", "anxious", "stressed", "overwhelmed", "lost"];
const positiveWords = ["great", "amazing", "good", "productive", "excited", "proud", "done", "finished"];

export function detectEmotion(text: string): string {
  if (negativeWords.some(w => text.includes(w))) return "negative";
  if (positiveWords.some(w => text.includes(w))) return "positive";
  return "neutral";
}
