# AI Assistants walkthrough video (bug batch 28 Nov, item 11)

Status: **recorded (Kivo side), owner clip and MP4 still to do.**

- Files: `apps/web/public/assistants/walkthrough.webm` (VP9, 1280×720, 29 s, 656 KB), `walkthrough-poster.png`, `walkthrough.vtt` (English captions).
- Shown on `/assistants` under "See it in 30 seconds" through `components/media/demo-video.tsx`: poster only until opened (`preload="none"`, lazy poster), never autoplays, captions on.
- Recorded against local dev with the seeded local test account `local@kivo.test` (synthetic data only, no real account). The consent screen is Kivo's real `/connect/authorize` page from a genuine local OAuth registration; Allow was never pressed.
- How it was made: Playwright frames at 6 fps, encoded in the browser with MediaRecorder (Playwright's own video recorder and ffmpeg are not installed on this machine). Such WebM files carry no duration header: the seek bar shows the length after the first play. The MP4 step below fixes that.

## Timeline

| Time | Shows |
|---|---|
| 0.0–3.5 s | The AI Assistants page; the Kivo address card |
| 3.5–5.7 s | Copy pressed; the address is copied once |
| 5.7–11.8 s | Claude chosen: the three steps, step 1 already done, the exact clicks |
| **11.8–16.8 s** | **MARKED SLOT: replace with the owner's clip** |
| 16.8–22.7 s | Kivo's consent screen ("Allow Claude to use your Kivo?") |
| 22.7–28.7 s | The Knowledge Map, with a note an assistant created (via Kivo Connect) |

## The clip to record (10–15 s)

In a clean browser profile signed in to Claude (no chat history or other connectors visible), at 1280×720:

1. `claude.ai/customize/connectors` → **Add** → **Add custom connector**.
2. Name **Kivo**, paste `https://www.thekivo.in/api/mcp` as the MCP server URL.
3. **Add** → **Connect** (stop as Kivo's consent page opens).

Blur the account menu. Then replace 11.8–16.8 s with the clip and update the captions (cue 4) and `seconds` in `ASSISTANTS_WALKTHROUGH` (`components/connect/assistants-model.ts`).

## MP4 (H.264) and size

With ffmpeg installed (`brew install ffmpeg`):

```
cd apps/web/public/assistants
ffmpeg -i walkthrough.webm -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart -an walkthrough.mp4
```

Expect about 1 MB (limit 5 MB). Then set `src: '/assistants/walkthrough.mp4', type: 'video/mp4'` in `ASSISTANTS_WALKTHROUGH` (or keep both and add a second `<source>`), and delete the WebM if it is no longer used.
