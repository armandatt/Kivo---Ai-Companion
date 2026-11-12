# Chrome Web Store assets: Nova

Upload these in the Chrome Web Store Developer Dashboard (item "Nova", `eddopegjkjiadejiocfbhoecjlbfcjba`). The listing text is in `apps/extension/store/LISTING.md`.

| File | Store slot | Size |
|---|---|---|
| `screenshot-1-save.png` | Screenshot 1 | 1280×800 |
| `screenshot-2-library.png` | Screenshot 2 | 1280×800 |
| `screenshot-3-map.png` | Screenshot 3 | 1280×800 |
| `screenshot-4-nova.png` | Screenshot 4 | 1280×800 |
| `screenshot-5-focus.png` | Screenshot 5 | 1280×800 |
| `promo-small-440x280.png` | Small promo tile | 440×280 |
| `promo-marquee-1400x560.png` | Marquee promo tile | 1400×560 |
| Store icon | From the ZIP (`icons/128.png`, drawn by `scripts/build.mjs`) | 128×128 |

These were checked against https://developer.chrome.com/docs/webstore/images on 12 Nov 2026:

- Screenshots are 1280×800, full bleed, with square corners, and there are at most five.
- The store shows screenshots at 640×400, and every headline was checked at that size.
- The promo tiles carry no words.

## How they are made

Every pixel of the product shown is a capture. Only the headline, the background and the framing are laid out here.

- `raw/` holds 2× captures:
  - the running app, with the researcher demo workspace, dark theme and a local server;
  - the extension's real popup, using its own HTML, CSS and JavaScript against the local API;
  - arxiv.org's page for the ReAct paper.
- `compose.html` lays out each image from `raw/`. To make one:
  1. Serve this folder with `python3 -m http.server`.
  2. Open `compose.html?shot=1` to `5`, `?shot=promo` or `?shot=marquee`, with the browser window at the image's exact size.
  3. Screenshot the page.

The people and workspace shown are Kivo's demo personas, not a user's data. Screenshot 4 shows the Nova panel before a question is asked, so no answer is invented.
