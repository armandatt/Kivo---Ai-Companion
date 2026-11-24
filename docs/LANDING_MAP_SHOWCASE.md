# Landing page: Knowledge Map showcase

The landing page's Knowledge Map section (`MapSection` in `apps/web/components/landing/sections.tsx`) opens with real screenshots of the app's Knowledge Map. The interactive sample map that was already there now sits below them under "Try it on a sample map."

## What it shows

- **Eyebrow:** "AI-powered Second Brain", the established positioning held by `landing.test.ts`.
- **Headline:** "Your knowledge should connect, not stay scattered."
- **Key** (four points, each visible in the screenshot):
  - subjects inside subjects (OS Lab inside Operating Systems);
  - topics inside topics (Deadlocks holds Banker's algorithm);
  - notes (amber dot) and saved pages (blue square) filed under their topic;
  - links written in notes, `[[Deadlocks]]`, crossing subjects (the faint lines).
- **Images:**
  - **Computer:** `public/landing/knowledge-map-desktop.webp`, 2090×1175, about 59 KB. The whole Operating Systems tree at 74%, with its notes, saved pages, OS Lab and the link lines leaving for DBMS and Discrete Mathematics.
  - **Phone (under 640px):** `public/landing/knowledge-map-mobile.webp`, 720×948, about 24 KB. The app's own phone layout inside Operating Systems.

## Where the images come from

- **The real app,** on the main branch's map (not the Knowledge Map rework on `review-a`).
- **Captured with:**
  - a local database only (`novafresh` on Docker);
  - a synthetic account (`showcase-demo@example.invalid`, display name "Riya");
  - dark theme, at 2× and 3× pixel density.
- **Sample data:** a semester invented for the purpose. Nothing belongs to any real learner.
  - Subjects: Operating Systems (with OS Lab inside it), DBMS, Discrete Mathematics.
  - Five notes written for the sample.
  - Five public reference pages (Wikipedia, PostgreSQL docs, man7.org).
- **Removed from the stills:** only floating aids that would cover cards in a picture: the minimap, the "Every item is drawn" pill, the hover preview, and Next's development badge.
- **Labelling:** the window says "Sample", and the caption says it's the Knowledge Map with a sample semester.

## Performance

- Plain `<img>` inside `<picture>`, with `loading="lazy"` and `decoding="async"`. No map code loads for it.
- Width, height and aspect ratio are set for each breakpoint, so the page doesn't shift. Measured: no layout shift from this section at 1440, 820 and 390 px.
- The images are requested only when the section approaches the viewport.

## Re-capturing (when the map's look changes)

1. Seed the sample learner in a **local** database. The seed script is in the 25 Nov session log; it uses `applyStudyEdits`, `createNote` and `recordLearningEvent`, and marks onboarding complete.
2. Sign a local session for that account with the local `JWT_SECRET`, and open `/map` in dark theme.
3. **Computer:**
   - viewport 1840×1080 at 2×, set zoom to 100%, zoom out two wheel steps (74%);
   - centre the Operating Systems tree;
   - capture the map canvas below the toolbar;
   - crop x 110–2200, y 390–1565 of the 2× image; WebP quality 82.
4. **Phone:**
   - viewport 390×844 at 3×, open `/map?explore=subject:<Operating Systems id>`;
   - capture the canvas, crop x 60–1040, y 600–1890, resize to 720 wide.
5. **Update the code:** `MAP_SHOWCASE` sizes in `sections.tsx`. `landing.test.ts` checks the files exist, stay under 150 KB, load lazily and are described.
