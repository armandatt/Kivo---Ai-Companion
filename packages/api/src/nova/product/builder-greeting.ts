// ─── Build with Nova: its opening lines ───────────────────────────────────────
// Written by code, never by a model, in the language the learner chose at
// sign-up (onboarding / Settings): English, Hindi (Devanagari) or Hinglish
// (Roman letters). With the name they asked Nova to call them, said once in
// the greeting, not in every line. Pure, no imports beyond types.
//
// The Hindi lines avoid first-person verbs, which Hindi marks for gender:
// Nova has none.

import type { BuilderGreeting } from "./builder.types";

type Language = BuilderGreeting["language"];

const LINES: Record<Language, { title: (n: string | null) => string; body: string; opening: (n: string | null) => string; openingFor: string }> = {
  english: {
    title: n => (n ? `What would you like to build, ${n}?` : "What would you like to build?"),
    body: "Tell me about an exam, a project, a skill or something at work. I'll ask what I need, then propose a workspace on the right that you can edit. Nothing is created until you approve it.",
    opening: n => (n ? `Hi ${n}. What are you working on, and what would you like to end up with?` : "What are you working on, and what would you like to end up with?"),
    openingFor: "What would you like to change in {title}? Nothing changes until you approve it.",
  },
  hindi: {
    title: n => (n ? `${n}, आज क्या बनाना है?` : "आज क्या बनाना है?"),
    body: "किसी परीक्षा, प्रोजेक्ट, स्किल या काम के बारे में बताइए। ज़रूरी सवालों के बाद दाईं ओर एक वर्कस्पेस का प्रस्ताव दिखेगा, जिसे आप बदल सकते हैं। आपकी मंज़ूरी के बिना कुछ नहीं बनेगा।",
    opening: n => (n ? `नमस्ते ${n}! आप किस पर काम कर रहे हैं, और आख़िर में क्या चाहिए?` : "आप किस पर काम कर रहे हैं, और आख़िर में क्या चाहिए?"),
    openingFor: "{title} में क्या बदलना है? आपकी मंज़ूरी तक कुछ नहीं बदलेगा।",
  },
  hinglish: {
    title: n => (n ? `${n}, aaj kya build karna hai?` : "Aaj kya build karna hai?"),
    body: "Kisi exam, project, skill ya kaam ke baare mein batao. Zaroori sawaalon ke baad right side pe ek workspace propose hoga, jise aap edit kar sakte ho. Aapke approve karne tak kuch nahi banta.",
    opening: n => (n ? `Hey ${n}! Aap kis pe kaam kar rahe ho, aur end mein kya chahiye?` : "Aap kis pe kaam kar rahe ho, aur end mein kya chahiye?"),
    openingFor: "{title} mein kya change karna hai? Aapke approve karne tak kuch nahi badlega.",
  },
};

export function builderGreeting(language: string | null | undefined, name: string | null | undefined): BuilderGreeting {
  const lang: Language = language === "hindi" || language === "hinglish" ? language : "english";
  const n = name && name.trim() ? name.trim() : null;
  const l = LINES[lang];
  return { language: lang, name: n, title: l.title(n), body: l.body, opening: l.opening(n), openingFor: l.openingFor };
}

// A conversation's first line about a workspace of theirs.
export const openingFor = (g: BuilderGreeting, title: string): string => g.openingFor.split("{title}").join(title);
