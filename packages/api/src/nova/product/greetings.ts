// ─── Nova's opening words, in the learner's language ──────────────────────────
// What Nova says before the learner has said anything: the greeting on
// Today and the opening of Build with Nova. Written by code (no model is
// asked to greet), in the language they chose at sign-up or in Settings:
// English, Hindi in Devanagari, or Hinglish in Roman letters. A message they
// write in another language still wins from then on (interaction/language.ts).
//
// Hindi and Hinglish lines avoid gendered verb forms for Nova and for the
// learner, so they read right for everyone.
//
// No imports, so the web app imports it directly.

export type GreetingLanguage = "english" | "hindi" | "hinglish";
const lang = (l: string | null | undefined): GreetingLanguage => (l === "hindi" || l === "hinglish" ? l : "english");

// By the learner's own clock: morning 5-12, afternoon 12-17, evening after.
export function greetingFor(language: string | null | undefined, hour: number): string {
  const part = hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : 2;
  return {
    english:  ["Good morning", "Good afternoon", "Good evening"],
    hindi:    ["सुप्रभात", "नमस्ते", "शुभ संध्या"],
    hinglish: ["Good morning", "Namaste", "Good evening"],
  }[lang(language)][part]!;
}

// The opening of Build with Nova: the heading, the line under it, what is
// asked first in a conversation, and what is asked first when it is about
// something of theirs.
export interface BuilderOpening { heading: string; intro: string; question: string; addTo: (title: string) => string; placeholder: string; reply: string }
const OPENING: Record<GreetingLanguage, BuilderOpening> = {
  english: {
    heading: "What would you like to build?",
    intro: "Tell me about an exam, a project, a skill or something at work. I'll ask what I need, then propose a workspace on the right that you can edit. Nothing is created until you approve it.",
    question: "What are you working on, and what would you like to end up with?",
    addTo: title => `What would you like to add to ${title}? I'll only add to it: nothing there is changed or removed.`,
    placeholder: "e.g. I'm building TrackerX, a project tracker for small teams",
    reply: "Ask for a change, or ask Nova anything…",
  },
  hindi: {
    heading: "आज क्या बनाना है?",
    intro: "किसी परीक्षा, प्रोजेक्ट, कौशल या काम के बारे में बताइए। कुछ ज़रूरी सवालों के बाद दाईं ओर एक वर्कस्पेस का प्रस्ताव आएगा, जिसे आप बदल सकते हैं। आपकी मंज़ूरी के बिना कुछ नहीं बनेगा।",
    question: "आप किस पर काम कर रहे हैं, और आख़िर में क्या चाहिए?",
    addTo: title => `${title} में क्या जोड़ना है? इसमें सिर्फ़ जोड़ा जाएगा: जो पहले से है, वह न बदलेगा, न हटेगा।`,
    placeholder: "जैसे: मुझे दिसंबर में DSA की परीक्षा देनी है",
    reply: "कोई बदलाव या सवाल लिखिए…",
  },
  hinglish: {
    heading: "Aaj kya build karna hai?",
    intro: "Kisi exam, project, skill ya kaam ke baare mein batao. Kuch zaroori sawaalon ke baad right side pe ek workspace ka proposal aayega, jise tum edit kar sakte ho. Tumhare approve kiye bina kuch nahi banega.",
    question: "Kis cheez pe kaam chal raha hai, aur end mein kya chahiye?",
    addTo: title => `${title} mein kya add karna hai? Isme sirf add hoga: jo pehle se hai, woh na badlega, na hatega.`,
    placeholder: "Jaise: December mein mera DSA ka exam hai",
    reply: "Koi change ya sawaal likho…",
  },
};
export const builderOpening = (language: string | null | undefined): BuilderOpening => OPENING[lang(language)];

// Asked by code when Nova holds back a proposal it would make from one
// detail: where they are, and the date they are working towards.
export function startingQuestion(language: string | null | undefined): string {
  return {
    english: "Before I propose anything: where are you with it right now, and is there a date you're working towards?",
    hindi: "कुछ भी प्रस्तावित करने से पहले: अभी यह किस स्थिति में है, और क्या कोई तारीख़ है जिस तक इसे पूरा करना है?",
    hinglish: "Kuch propose karne se pehle: abhi yeh kis stage pe hai, aur koi date hai jis tak isse khatam karna hai?",
  }[lang(language)];
}
