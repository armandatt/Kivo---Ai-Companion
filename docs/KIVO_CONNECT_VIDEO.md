# Kivo Connect demonstration video (founder review #04): what to record

Status: **not recorded.** The player is built (`components/media/demo-video.tsx`) and the Kivo Connect guide shows it only when `CONNECT_VIDEO` in `components/connect/mcp-clients.ts` is set. Until then nothing is rendered: no empty or broken player.

No existing recording qualifies:
- `kivo-videos/ai-assistants-connect-claude.webm` (24 Nov) shows only Kivo's own AI Assistants page, recorded locally. It has no Claude or ChatGPT screens.
- The landing page videos are about other features.

## The recording (one take, real accounts, 60–90 s)

Use a test Kivo account with a small, non-personal map (for example "Operating Systems" with three topics and one note). Use a Claude account on a plan with custom connectors, or ChatGPT on the web.

1. **Kivo, AI Assistants page:** select Connect next to Claude, then copy the link (`https://www.thekivo.in/api/mcp`).
2. **Claude:** `claude.ai/customize/connectors` → Add → Add custom connector → name "Kivo" → paste the link as the MCP server URL → Continue → Add → Connect.
   - **ChatGPT instead:** `chatgpt.com/plugins` → + → Add custom MCP server → Server URL → OAuth → Create as a plugin → install.
3. **Kivo consent page:** "Allow Claude to use your Kivo?" with the permission list; select **Allow**.
4. **Back in Kivo:** the AI Assistants page shows "Claude is connected" by itself.
5. **A read:** in Claude, ask "What topics do I have in Operating Systems in Kivo?" The answer must name the real topics.
6. **A write:** ask "Save the key points of this chat as a note in Kivo under Deadlocks". Then show the note open in Kivo, filed under that topic.

Do not show email addresses, other connectors, chat history or personal data. Blur the account menu.

## Adding it

1. Export as WebM (VP9, 1280×720 or 1920×1080, under 15 MB) with a poster PNG, a frame from step 5.
2. Write English captions as WebVTT, one cue per step, in the words shown on screen.
3. Put the three files in `apps/web/public/connect/` as `kivo-connect-demo.webm`, `.png` and `.vtt`.
4. In `mcp-clients.ts`, set `CONNECT_VIDEO = { src: '/connect/kivo-connect-demo.webm', type: 'video/webm', poster: '/connect/kivo-connect-demo.png', captions: '/connect/kivo-connect-demo.vtt', seconds: <length>, title: 'Connect Claude to Kivo', summary: 'Add, allow, read and save' }`.

The player never autoplays, loads nothing until opened, and carries the captions.
