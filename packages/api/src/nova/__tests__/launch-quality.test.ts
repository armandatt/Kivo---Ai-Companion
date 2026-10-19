// Launch-quality fixes in the web app, read from source: the web app has no
// component test runner, so these show what the pages are written to do.
// None of it has been seen in a browser or heard through a screen reader.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const web = (file: string) => readFileSync(join(__dirname, "../../../../../apps/web", file), "utf8");

describe("the mobile menu button", () => {
  const sidebar = web("components/sidebar.tsx");
  it("has a name that says what pressing it does, and says whether the menu is open", () => {
    expect(sidebar).toContain("aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}");
    expect(sidebar).toContain("aria-expanded={isMobileOpen}");
  });
});

describe("the task editor is a modal a keyboard cannot fall out of", () => {
  const editor = web("components/nova/tasks/task-editor.tsx");
  it("keeps Tab inside it with the same rule the delete-account dialog uses", () => {
    expect(editor).toContain("import { trappedTabTarget } from '@/components/settings/dialog-focus'");
    expect(editor).toContain("trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, dialog)");
    expect(editor).toContain("if (e.key === 'Escape') { onClose(); return }");
  });
  it("takes focus on opening and gives it back to what opened it", () => {
    expect(editor).toContain("const opener = document.activeElement as HTMLElement | null");
    expect(editor).toContain("return () => { opener?.focus?.() }");
    expect(editor).toContain('role="dialog" aria-modal="true"');
  });
});

describe("the sign-up quiz survives a refresh", () => {
  const quiz = web("components/onboarding-flow.tsx");
  it("keeps the answers and the question reached in this tab's session storage", () => {
    expect(quiz).toContain("window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, at }))");
    expect(quiz).toContain("window.sessionStorage.getItem(DRAFT_KEY)");
    expect(quiz).not.toContain("localStorage");
  });
  it("writes nothing back before the stored draft has been read", () => {
    expect(quiz.indexOf("if (!restored || done) return;")).toBeLessThan(quiz.indexOf("window.sessionStorage.setItem("));
  });
  it("clears the draft only once the server has saved the answers", () => {
    const finish = quiz.slice(quiz.indexOf("async function finish()"), quiz.indexOf("function next("));
    expect(finish.indexOf("if (!res.ok || !result?.success)")).toBeLessThan(finish.indexOf("clearDraft()"));
    expect(finish.indexOf("clearDraft()")).toBeLessThan(finish.indexOf("setDone(true)"));
  });
  it("a stored position outside the quiz is ignored", () => {
    expect(quiz).toContain("Number.isInteger(parsed.at) && parsed.at >= 0 && parsed.at < STEPS.length");
  });
});

describe("reduced motion", () => {
  it("is honoured across the app", () => {
    const css = web("app/globals.css");
    const rule = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rule).toContain(".kivo-app *,");
    expect(rule).toContain("animation-duration: 0.01ms !important;");
    expect(rule).toContain("transition-duration: 0.01ms !important;");
  });
});

describe("the navigation over the Creature world", () => {
  const sidebar = web("components/sidebar.tsx");
  const shell = web("components/dashboard-shell.tsx");
  it("has one menu button, the shell's: the sidebar draws its own only when docked", () => {
    expect(sidebar).toContain("{mode.ownToggle && (");
    expect(web("components/sidebar-modes.ts")).toContain("ownToggle:   !overlay,");
  });
  it("closes on Escape, and the keyboard goes back to the shell's button", () => {
    expect(sidebar).toContain("if (overlay) { onOpenChange(false); return }");
    expect(shell).toContain("onOpenChange={setOverlayOpen}");
    expect(shell).toContain("navButtonRef.current?.focus()");
  });
  it("keeps Tab inside while it covers the page, with the rule the dialogs use", () => {
    expect(sidebar).toContain("import { trappedTabTarget } from '@/components/settings/dialog-focus'");
    expect(sidebar).toContain("trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, drawer)");
  });
  it("takes no focus while closing, and choosing a page puts the keyboard back on the menu button", () => {
    expect(sidebar).toContain("inert={mode.inert}");
    expect(sidebar).toContain("if (!overlay && (!active || active === document.body || drawer?.contains(active))) toggle?.focus()");
  });
  it("has a backdrop at every width, not only on a small screen", () => {
    expect(sidebar).toContain("mode.backdrop === 'small_screens' && 'lg:hidden'");
    expect(web("components/sidebar-modes.ts")).toContain("overlay ? 'every_width' : 'small_screens'");
  });
});
