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

## 25 Nov 2026: page redesigned, recording still blocked

The redesigned guide (`app/(legal)/integrations/kivo-connect/page.tsx`) puts the demonstration in the hero, beside the headline. While `CONNECT_VIDEO` is null it shows **Kivo's real consent screen** (`public/connect/consent-screen.webp`, captured from `/connect/authorize` after a genuine OAuth dynamic registration, for the synthetic local learner "Riya"), captioned as that screen. Setting `CONNECT_VIDEO` swaps the hero to the player; nothing else changes.

**Why the video isn't recorded:** claude.ai and chatgpt.com must reach a public MCP address, so the recording needs (a) production Kivo with a dedicated test account holding only synthetic material, and (b) the owner's own Claude or ChatGPT login to add the connector. Neither was available to the agent, and adding a connector to the owner's personal assistant account was not authorised. No recording was fabricated.

**To record (about 10 minutes):**
1. Sign up a test Kivo account (an address you control, e.g. a `+kivo-demo` alias). Name it "Riya". Add the subject *Operating Systems* with topics *Paging*, *Deadlocks*, *Memory management*, and one note *Paging cheat sheet* filed under *Paging* (two or three lines; nothing personal).
2. In a clean browser profile, signed in to that Kivo account and to Claude, record 1920×1080, browser chrome hidden, following the six steps above.
3. Read: "What do my Kivo notes say about paging?" (the assistant calls `search_notes`/`get_note`). Write: "Save the key points of this chat as a note in Kivo under Deadlocks" (`capture_knowledge`). Optional approval beat: "Move Paging cheat sheet under Memory management" → open the approval link → Approve (`move_note`, `check_approval`).
4. Finish on the note open in Kivo, filed under Deadlocks.

**Caption script (WebVTT, one cue per beat):**
```
WEBVTT

00:00.000 --> 00:06.000
Kivo Connect: your Kivo knowledge in Claude.

00:06.000 --> 00:18.000
In Claude, add a custom connector and paste Kivo's address.

00:18.000 --> 00:28.000
Kivo asks you first: here is exactly what Claude may do. Allow.

00:28.000 --> 00:44.000
Ask about your own notes. Claude searches Kivo and answers from them.

00:44.000 --> 01:00.000
Ask it to save what you worked out. It lands in Kivo, filed under the topic.

01:00.000 --> 01:10.000
Bigger changes wait for your approval in Kivo. Disconnect any time.
```
The transcript is the same text; publish it beside the video on the guide.
