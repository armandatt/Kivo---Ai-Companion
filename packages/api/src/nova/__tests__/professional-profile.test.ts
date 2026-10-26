// The learner's professional profile (product/professional-profile.ts): what a
// save may hold, how it is read back, and that the page is open to both
// companions. Pure; no database.

import {
  BIO_MAX, HEADLINE_MAX, LINKS_MAX, PROFILE_KEY, SKILLS_MAX,
  checkLink, checkProfessionalProfile, initialsOf, linkLabel, profileIn,
} from "../product/professional-profile";
import { routeAccess } from "../product/companion";

describe("what a profile may hold", () => {
  it("keeps the learner's words, one line where it is one line, paragraphs in the bio", () => {
    const r = checkProfessionalProfile({
      headline: "  Backend   engineer\nlearning ML ", organisation: "Acme", location: null,
      bio: "First line.\n\n\n\nSecond   paragraph.  \n", skills: ["Python", "python", " SQL ", ""],
      links: [{ url: "linkedin.com/in/asha" }, "https://github.com/asha", "https://github.com/asha"],
    });
    expect(r).toEqual({ ok: true, profile: {
      headline: "Backend engineer learning ML", organisation: "Acme", location: null,
      bio: "First line.\n\nSecond paragraph.", skills: ["Python", "SQL"],
      links: [{ url: "https://linkedin.com/in/asha", label: "LinkedIn" }, { url: "https://github.com/asha", label: "GitHub" }],
    } });
  });
  it("an empty profile, or null, clears it", () => {
    expect(checkProfessionalProfile(null)).toEqual({ ok: true, profile: null });
    expect(checkProfessionalProfile({ headline: "  ", skills: [], links: [] })).toEqual({ ok: true, profile: null });
  });
  it("too long is refused with the field it is in; nothing is cut to fit", () => {
    expect(checkProfessionalProfile({ headline: "x".repeat(HEADLINE_MAX + 1) })).toMatchObject({ ok: false, field: "headline" });
    expect(checkProfessionalProfile({ bio: "x".repeat(BIO_MAX + 1) })).toMatchObject({ ok: false, field: "bio" });
    expect(checkProfessionalProfile({ skills: Array.from({ length: SKILLS_MAX + 1 }, (_, i) => `s${i}`) })).toMatchObject({ ok: false, field: "skills" });
    expect(checkProfessionalProfile({ links: Array.from({ length: LINKS_MAX + 1 }, (_, i) => `https://e${i}.com`) })).toMatchObject({ ok: false, field: "links" });
    expect(checkProfessionalProfile({ headline: 42 })).toMatchObject({ ok: false, field: "headline" });
    expect(checkProfessionalProfile("hello")).toMatchObject({ ok: false });
  });
});

describe("links", () => {
  it("only web addresses, with no credentials in them", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://files.example.com", "https://user:pw@example.com", "localhost", "not a link", ""]) {
      expect(checkLink(bad).ok).toBe(false);
    }
    expect(checkLink("example.com/me")).toEqual({ ok: true, link: { url: "https://example.com/me", label: "example.com" } });
    expect(checkLink("http://www.behance.net/asha")).toMatchObject({ ok: true, link: { label: "Behance" } });
    expect(linkLabel("https://in.linkedin.com/in/asha")).toBe("LinkedIn");
  });
  it("a save with one bad link is refused whole", () => {
    expect(checkProfessionalProfile({ headline: "Hi", links: ["https://ok.com", "javascript:void(0)"] })).toMatchObject({ ok: false, field: "links" });
  });
});

describe("reading it back", () => {
  it("from the onboarding answers, through the same check; anything else reads as none", () => {
    expect(profileIn({ [PROFILE_KEY]: { headline: "Designer", links: ["dribbble.com/asha"] }, tone: "calm" })).toMatchObject({ headline: "Designer", links: [{ label: "Dribbble" }] });
    expect(profileIn({ [PROFILE_KEY]: { headline: "x".repeat(500) } })).toBeNull();
    expect(profileIn(null)).toBeNull();
    expect(profileIn([])).toBeNull();
  });
  it("initials for the avatar", () => {
    expect(initialsOf("Asha  Rao Kumar", "a@b.com")).toBe("AK");
    expect(initialsOf("asha", "a@b.com")).toBe("A");
    expect(initialsOf("", "zed@b.com")).toBe("Z");
  });
});

describe("the page", () => {
  it("is open to a Nova learner and a Rex account alike, like Settings", () => {
    expect(routeAccess("nova", "/profile")).toBe("render");
    expect(routeAccess("rex", "/profile")).toBe("render");
  });
});
