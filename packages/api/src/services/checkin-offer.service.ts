// ── Pending check-in offer store ─────────────────────────────────────────────
// In-memory map: chatId → { minutes, offeredAt }
// Persists within the Railway process lifetime. Loss on restart is fine —
// the user can just mention a time again in their next message.

interface PendingOffer {
  minutes:   number;
  offeredAt: number; // Date.now()
}

const OFFER_EXPIRY_MS = 8 * 60 * 1000; // expire if user doesn't confirm within 8 min

const pending = new Map<string, PendingOffer>();

export function setPendingOffer(chatId: string, minutes: number): void {
  pending.set(chatId, { minutes, offeredAt: Date.now() });
}

export function getPendingOffer(chatId: string): number | null {
  const offer = pending.get(chatId);
  if (!offer) return null;
  if (Date.now() - offer.offeredAt > OFFER_EXPIRY_MS) {
    pending.delete(chatId);
    return null;
  }
  return offer.minutes;
}

export function clearPendingOffer(chatId: string): void {
  pending.delete(chatId);
}

// ── Time mention detection ────────────────────────────────────────────────────
// Returns the first numeric duration found in the text (in minutes), or null.
// Conservative range: 5 min – 8 hours. Avoids false positives from years,
// dates, and gym rep counts.

export function detectTimeMention(text: string): number | null {
  const lower = text.toLowerCase();

  // Hours: "2 hours", "1 hr", "in 2h"
  const hourMatch = lower.match(/\b(\d{1,2})\s*(?:hours?|hrs?)\b/);
  if (hourMatch) {
    const h = Number(hourMatch[1]);
    if (h >= 1 && h <= 8) return h * 60;
  }

  // "an hour" / "a hour" / "one hour"
  if (/\b(an?|one)\s+hour\b/.test(lower)) return 60;

  // "half an hour" / "half hour"
  if (/\bhalf\s+(?:an?\s+)?hour\b/.test(lower)) return 30;

  // Minutes: "30 min", "45 minutes"
  const minMatch = lower.match(/\b(\d{1,3})\s*(?:mins?|minutes?)\b/);
  if (minMatch) {
    const m = Number(minMatch[1]);
    if (m >= 5 && m <= 480) return m; // 5 min – 8 hours
  }

  return null;
}

// ── Offer gate ────────────────────────────────────────────────────────────────
// Returns true only when the time mention looks like a user commitment/return,
// not a deadline, question, or gym rep count.

export function shouldOfferCheckIn(text: string, intent: string): boolean {
  // These intents already handle time in a different way
  if (["deadline_set", "focus_start", "checkin_schedule", "checkin_cancel"].includes(intent)) {
    return false;
  }

  const lower = text.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Ignore very short messages and bare questions
  if (wordCount < 4) return false;
  if (text.trim().endsWith("?") && wordCount < 10) return false;

  // Strong commitment signal — user is saying they'll do something and come back
  const hasCommitment = /\b(i'?ll|i will|going to|gonna|will (study|work|be|come|focus|finish|do)|be back|brb|back in|catch you|update you|let you know|check in with you|report back|back after|after (i finish|this|studying))\b/.test(lower);
  if (hasCommitment) return true;

  // Medium-length message mentioning time + task — likely a commitment
  if (wordCount >= 7 && /\b(study|work|focus|practice|train|do|complete|finish|write|code|solve|read)\b/.test(lower)) return true;

  return false;
}

// ── Confirmation / rejection ──────────────────────────────────────────────────

export function isConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /^(yes|yeah|yep|yup|sure|ok|okay|ok sure|yes please|do it|go for it|sounds good|perfect|please|schedule it|set it|definitely|absolutely)\b/.test(t);
}

export function isRejection(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /^(no|nah|nope|not now|skip|skip it|don'?t|cancel|forget it|never mind|no thanks|its ok|it'?s ok|i'?ll come back|no need)\b/.test(t);
}

// ── Offer message ─────────────────────────────────────────────────────────────

export function buildOfferMessage(minutes: number): string {
  return `Want me to check in after ${formatMinutes(minutes)}? Reply yes or no.`;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} minutes`;
  if (m === 60) return "1 hour";
  if (m % 60 === 0) return `${m / 60} hours`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
