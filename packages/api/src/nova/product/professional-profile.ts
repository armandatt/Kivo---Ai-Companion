// ─── The learner's professional profile ──────────────────────────────────────
// Pure, no imports: shared by the settings route (which checks and stores it)
// and the web app's Profile page (which checks it as it is typed).
//
// What they say about themselves professionally: a headline, where they work
// or study, where they are, a short bio, skills and up to four links. Every
// field is optional and in their own words. It is kept with the other
// onboarding answers (UserProfile.onboardingAnswers, under PROFILE_KEY), like
// learningContexts, so no schema change was needed. A saved profile replaces
// the one before; null clears it.
//
// It is the learner's, for the learner: only they see it, no engine, brain,
// plan or prompt reads it, and nothing is inferred from it.
//
// Links: http or https only, no user name or password in them, at most
// LINK_MAX characters. Nothing here fetches them; the page opens them with
// rel="noopener noreferrer nofollow". No regex (the no-regex guard).

export const PROFILE_KEY = "professionalProfile";

export const HEADLINE_MAX     = 80;
export const ORGANISATION_MAX = 80;
export const LOCATION_MAX     = 60;
export const BIO_MAX          = 500;
export const SKILL_MAX        = 32;
export const SKILLS_MAX       = 12;
export const LINK_MAX         = 300;
export const LINKS_MAX        = 4;

export interface ProfileLink {
  url:   string;
  // What the page calls it: the site's own name for a few known ones, else
  // the address's host.
  label: string;
}

export interface ProfessionalProfile {
  headline:     string | null;
  organisation: string | null;
  location:     string | null;
  bio:          string | null;
  skills:       string[];
  links:        ProfileLink[];
}

export const EMPTY_PROFILE: ProfessionalProfile = { headline: null, organisation: null, location: null, bio: null, skills: [], links: [] };

// Sites named the way people write them.
const KNOWN_SITES: ReadonlyArray<[string, string]> = [
  ["linkedin.com", "LinkedIn"], ["github.com", "GitHub"], ["gitlab.com", "GitLab"], ["x.com", "X"], ["twitter.com", "X"],
  ["medium.com", "Medium"], ["behance.net", "Behance"], ["dribbble.com", "Dribbble"], ["kaggle.com", "Kaggle"],
  ["leetcode.com", "LeetCode"], ["scholar.google.com", "Google Scholar"], ["orcid.org", "ORCID"], ["substack.com", "Substack"],
];

// One line: runs of spaces, tabs and line breaks become one space.
function oneLine(s: string): string {
  let out = "", gap = false;
  for (const c of s) {
    if (c === " " || c === "\n" || c === "\r" || c === "\t") { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += c; gap = false;
  }
  return out;
}

// A bio keeps its paragraphs (at most one blank line between them).
function paragraphs(s: string): string {
  const lines = s.split("\r").join("").split("\n").map(l => oneLine(l));
  const out: string[] = [];
  for (const l of lines) { if (l || (out.length && out[out.length - 1] !== "")) out.push(l); }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

export function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const bare = host.startsWith("www.") ? host.slice(4) : host;
    const known = KNOWN_SITES.find(([site]) => bare === site || bare.endsWith(`.${site}`));
    return known ? known[1] : bare;
  } catch { return url; }
}

// A link as given: an address with no scheme is read as https.
export function checkLink(raw: unknown): { ok: true; link: ProfileLink } | { ok: false; message: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, message: "Add an address, or remove the link." };
  if (text.length > LINK_MAX) return { ok: false, message: `Keep a link under ${LINK_MAX} characters.` };
  const withScheme = text.includes("://") ? text : `https://${text}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { return { ok: false, message: `${text} isn't a web address.` }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "Links must start with http or https." };
  if (url.username || url.password) return { ok: false, message: "A link can't carry a user name or password." };
  if (!url.hostname.includes(".")) return { ok: false, message: `${text} isn't a web address.` };
  const href = url.toString();
  return { ok: true, link: { url: href, label: linkLabel(href) } };
}

type Checked = { ok: true; profile: ProfessionalProfile | null } | { ok: false; field: keyof ProfessionalProfile; message: string };

// What a save may hold. null (or a profile with nothing in it) clears it.
// Anything too long, or a link that isn't one, is refused with the field it
// is in: nothing is cut to fit.
export function checkProfessionalProfile(raw: unknown): Checked {
  if (raw === null) return { ok: true, profile: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "headline", message: "That isn't a profile." };
  const o = raw as Record<string, unknown>;
  const text = (field: "headline" | "organisation" | "location", max: number, label: string): string | null | { error: string } => {
    const v = o[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") return { error: `${label} must be text.` };
    const t = oneLine(v);
    if (t.length > max) return { error: `Keep ${label.toLowerCase()} under ${max} characters.` };
    return t || null;
  };
  const headline = text("headline", HEADLINE_MAX, "Your headline");
  if (headline && typeof headline === "object") return { ok: false, field: "headline", message: headline.error };
  const organisation = text("organisation", ORGANISATION_MAX, "Where you work or study");
  if (organisation && typeof organisation === "object") return { ok: false, field: "organisation", message: organisation.error };
  const location = text("location", LOCATION_MAX, "Your location");
  if (location && typeof location === "object") return { ok: false, field: "location", message: location.error };

  let bio: string | null = null;
  if (o.bio !== undefined && o.bio !== null) {
    if (typeof o.bio !== "string") return { ok: false, field: "bio", message: "Your bio must be text." };
    bio = paragraphs(o.bio) || null;
    if (bio && bio.length > BIO_MAX) return { ok: false, field: "bio", message: `Keep your bio under ${BIO_MAX} characters.` };
  }

  const skills: string[] = [];
  if (o.skills !== undefined && o.skills !== null) {
    if (!Array.isArray(o.skills)) return { ok: false, field: "skills", message: "Skills must be a list." };
    for (const s of o.skills) {
      if (typeof s !== "string") return { ok: false, field: "skills", message: "Each skill must be text." };
      const t = oneLine(s);
      if (!t) continue;
      if (t.length > SKILL_MAX) return { ok: false, field: "skills", message: `Keep each skill under ${SKILL_MAX} characters.` };
      if (!skills.some(k => k.toLowerCase() === t.toLowerCase())) skills.push(t);
    }
    if (skills.length > SKILLS_MAX) return { ok: false, field: "skills", message: `Up to ${SKILLS_MAX} skills.` };
  }

  const links: ProfileLink[] = [];
  if (o.links !== undefined && o.links !== null) {
    if (!Array.isArray(o.links)) return { ok: false, field: "links", message: "Links must be a list." };
    if (o.links.length > LINKS_MAX) return { ok: false, field: "links", message: `Up to ${LINKS_MAX} links.` };
    for (const l of o.links) {
      const given = l && typeof l === "object" ? (l as { url?: unknown }).url : l;
      const checked = checkLink(given);
      if (!checked.ok) return { ok: false, field: "links", message: checked.message };
      if (!links.some(k => k.url === checked.link.url)) links.push(checked.link);
    }
  }

  const profile: ProfessionalProfile = { headline, organisation, location, bio, skills, links } as ProfessionalProfile;
  return { ok: true, profile: isEmpty(profile) ? null : profile };
}

export function isEmpty(p: ProfessionalProfile | null): boolean {
  return !p || (!p.headline && !p.organisation && !p.location && !p.bio && p.skills.length === 0 && p.links.length === 0);
}

// The profile kept in the onboarding answers, read back through the same
// check: a stored value that no longer passes reads as none.
export function profileIn(answers: unknown): ProfessionalProfile | null {
  const o = answers && typeof answers === "object" && !Array.isArray(answers) ? answers as Record<string, unknown> : null;
  const checked = checkProfessionalProfile(o?.[PROFILE_KEY] ?? null);
  return checked.ok ? checked.profile : null;
}

// Initials for the avatar: the first letters of the first and last words.
export function initialsOf(name: string | null | undefined, email: string): string {
  const words = oneLine(name ?? "").split(" ").filter(Boolean);
  const pick = (w: string) => [...w][0]?.toUpperCase() ?? "";
  if (words.length >= 2) return pick(words[0]!) + pick(words[words.length - 1]!);
  if (words.length === 1) return pick(words[0]!);
  return pick(email) || "K";
}
