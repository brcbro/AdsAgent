# AI Ad Factory

Pipeline that turns briefings into finished 24–30s German Meta video ads:
Claude scripts → ElevenLabs voice → HeyGen avatar → B-roll → Remotion render
with karaoke subtitles. Hook, body, and CTA are independently swappable
segments. Full architecture and roadmap: [PLAN.md](PLAN.md).

## Setup

1. `pnpm install`
2. Copy `.env.example` to `.env` and fill in the API keys.
3. Drop a handful of vertical b-roll clips (mp4) into `data/broll/`.
4. ffmpeg must be on PATH (`winget install Gyan.FFmpeg`). Use Node.js 22.13 or later for the agent's built-in SQLite queue.

For direct Claude script generation, set `LLM_PROVIDER=anthropic`,
`ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL=claude-haiku-5-5` in `.env`.
OpenRouter remains available with `LLM_PROVIDER=openrouter` and its own key.
Local previews require only ElevenLabs credentials. Avatar generation also requires HeyGen credentials.
Voice generation defaults to `ELEVENLABS_MODEL=eleven_v4` and `ELEVENLABS_LANGUAGE=de`.

To add B-roll on Windows, copy MP4, MOV, or WebM clips into `data/broll/clips/`.
Use subfolders `Trading`, `Lifestyle`, `Deep Work`, and `Community`, plus descriptive
filenames such as `trading-chart-laptop.mp4`. Run `pnpm broll-catalog` after adding
clips to generate category tags and preview screenshots. Portrait clips work best;
landscape clips are cropped to fill portrait videos. Existing projects with
`fullAvatar: true` need that setting changed to `false` to show B-roll.

## Golden path (Phase 0)

```sh
pnpm golden data/briefings/example-trading-fomo.json
```

Flow: generates German scripts for every hook/body/CTA concept in the
briefing → you approve or request revisions in the terminal (nothing costs
money before approval) → ElevenLabs TTS per segment → HeyGen avatar driven by
that audio → simple beat plan with b-roll from `data/broll/` → Remotion
renders every hook × CTA variant to `data/ads/<adId>/out/`.

By default only the first hook and first CTA are synthesized (API spend);
pass `--all` to generate every concept.

## Packages

- `packages/core` — Ad Project schema (zod), paths, JSON store
- `packages/pipeline` — golden-path CLI + Claude/ElevenLabs/HeyGen clients
- `packages/remotion` — 1080×1920 composition: avatar + b-roll beats + subtitles
- `packages/performance` — ad metrics store, CSV import (Meta / Google), scoring and winner detection

Finished ads are published to `video/<session>/<adId>.mp4` (session defaults to `16th June`; set `VIDEO_OUTPUT_DIR` to write elsewhere). Operator details, safety gates, and commands: [docs/AGENT.md](docs/AGENT.md).

## Dashboard

```sh
pnpm dashboard   # builds the UI, then serves http://localhost:3847
```

The UI is a React + Vite + Tailwind app in `packages/dashboard/web/`, built into
`web/dist/` and served by the Express server. For UI work with hot reload, keep
`pnpm dashboard` running and start `pnpm dashboard:dev` (http://localhost:5173, proxies the API).

Pages: **Studio** (projects, player, script/audio/captions/B-roll/settings),
**Agent** (chat, script review, job queue), **Library** (B-roll, music, avatars) and
**Settings** (service status, defaults, spending safeguards). Edits autosave; actions that
spend API credits ask for confirmation first. Press `Ctrl+K` for search and `?` for shortcuts.
Archiving a project moves it to `data/archive/`. Agent docs: `docs/AGENT.md`, `docs/HEYGEN_AVATARS.md`.

Every finished render is also kept in `data/ads/<id>/versions/` (the last 10) with the settings
that produced it. **Versions** in the Studio plays, compares (side by side, synced) and restores
them. In the **B-roll** tab, pin clips that must appear or exclude clips that must never appear;
pinned clips go where they match the script best. Dark mode is available in Settings.

UI tests run in a real browser against a fake API, so they never touch your projects or spend credits:

```sh
pnpm test:ui   # Playwright; uses Microsoft Edge on Windows
```

To make a video without HeyGen, enter your German text in **Script**, choose captions
and music, then click **Create Local Preview**. This creates a separate project with
a three-second waveform intro followed by automatically matched B-roll. It uses the
configured ElevenLabs German voice and saves word timings for captions. Matching
saved narration is reused; new text, voice, model, or language generates new audio
and uses ElevenLabs credits. Play or download the result, or use **Apply Edits** to
adjust B-roll, captions, and music without generating another voice.

### Agent Studio

Open **Agent Studio**, describe your video, choose a target duration, and click
**Send**. Choose **Local preview** for a waveform intro, or **HeyGen avatar** and
a presenter for a lip-synced introduction. Both use ElevenLabs German narration
followed by B-roll, captions and music. HeyGen mode also uses HeyGen API credits.
Claude uses the saved conversation to write a German script;
ElevenLabs narration, B-roll, captions and music are produced locally, then the
worker checks full video decoding, audio levels, resolution, duration, caption
timings, caption baseline and timeline/source coverage. These are technical checks;
review the finished video for pronunciation, visual relevance and creative quality.

Turn off **Auto-produce video** to edit the script before generating audio, then click **Approve & produce**.
Follow-up messages can revise the previous brief/script. Questions receive chat
replies without creating narration. **Open in Studio** returns to the editor for playback
and downloading. Queue cards show activity, script, quality results and cancel/retry
controls. The first version produces one video per request, using the configured
German voice and 9:16 format.

Chat and job records persist in `data/agent-queue/agent.sqlite`. One worker processes
jobs sequentially with leases and heartbeats; pending jobs resume when the dashboard
restarts. Scripts and completed narration are reused after interruption. If a voice
request was interrupted before a complete audio checkpoint, the job pauses for
review; explicit retry may use ElevenLabs credits again. Failed jobs require retry,
with at most three attempts. Work continues while the dashboard and computer are
running. Existing jobs and new Local preview jobs never call HeyGen.

HeyGen uses v3 for avatar listing, multipart audio uploads, generation, status and
balance checks. Run `pnpm avatars` to refresh available public studio presenters and repair
an unavailable default in `.env`. A generation stores its request key, audio asset
and video ID beside its source clip. Retries resume the saved video or reuse the
same idempotency key within the safe window; uncertain submissions older than
23 hours pause for review rather than creating another paid video.

## Performance (Meta & Google ad results)

The **Performance** page ranks your ads by a composite of hook rate, hold rate, CTR, CPA and ROAS,
scored within each account and platform, and flags winners, losers and fatigued creatives.
Export a daily ad report from Meta Ads Manager or Google Ads as CSV into `data/performance/inbox/`
(see the README there for the columns) and click **Sync now**. Ads whose name contains a project ID
from `data/ads/` are linked to that project automatically; others can be linked in the ad's dialog.
A sample export lives in `data/performance/samples/`; copy it into the inbox to try the page.

For a direct Meta connection, set `META_ACCESS_TOKEN` (a system-user token with `ads_read`) and
`META_AD_ACCOUNT_IDS` in `.env` and restart the dashboard. The first **Sync now** backfills 90 days
of daily ad insights; every later sync re-pulls the last 3 days, and a nightly sync runs after 03:00
while the dashboard is open (toggle on the Meta card). Projects with linked ads show 30-day spend and
best hook rate in the Studio sidebar and an **Ad performance** section under Settings.
After each sync the winners and losers are **torn down**: hook, body and CTA, hook type, angle,
persona, trigger, CTA style and pacing, using the configured Claude model (at most 10 LLM calls per
run by default; linked projects reuse their script, so no transcription). External ads need the
creative and a German transcript in `data/performance/creatives/`, competitor videos go into
`data/performance/competitors/` (optionally transcribed via `WHISPER_CMD`). Once 5+ ads are torn
down, the **Winning patterns** section shows which hook types, angles and pacing rank above or
below average, with lift, sample size and example hooks; any pattern can be switched out of the
prompts. The same block is injected into the Agent Studio script prompt and the golden-path script
generator, and the Script Review panel shows the agent's rationale and the pattern ids it applied.

**Suggestions** on the Performance page list what to scale, pause or refresh (with the ad's KPIs
against the account mean) and what the next brief should try (hook type, angle, CTA style, each
citing a pattern and an example hook). The Agent Studio composer shows the brief ideas as chips
that append to your brief, and a project's Settings tab shows which linked variant to push and
whether its pacing matches the winners. Accept and Dismiss only record the decision; nothing
changes on the ad platforms.

For a direct Google Ads connection, set `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
`GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` and `GOOGLE_ADS_CUSTOMER_IDS` (plus
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` when going through a manager account) in `.env`. Google has no
3-second metric, so view rate stands in for hook rate and the 100 % ÷ 25 % quartiles for hold rate;
ads are ranked within their own platform and account, Google winners are capped at medium
confidence, and the strip above the leaderboard shows each platform's means and whether the
ranking is balanced. Both sample exports live in `data/performance/samples/`.

Accepting a suggestion stores the cited ad's KPIs at that moment; every later sync measures the
**outcome** (improved, flat, worse for account actions; won, mixed, lost for brief ideas, judged by
the new ads whose scripts applied the pattern) and shows it on the card. Those outcomes flow back
into the prompt block as a meta-signal per pattern. **Briefings from the data** drafts a batch of
deliberately different briefings from the Winning patterns and the last angles used, writes them
to `data/briefings/kb_*.json` for `pnpm golden`, and offers a **Send to Agent** link; the same batch
runs from the terminal with `pnpm briefings --n 5`. Plan and status:
[docs/PERFORMANCE_LOOP_PLAN.md](docs/PERFORMANCE_LOOP_PLAN.md).

## Batch test videos

```sh
pnpm batch-run --list           # named batches and what they render
pnpm batch                      # alias for: pnpm batch-run trading-intro
pnpm batch-run jun17-pair --only jun17_02
```

Batches are data in `packages/pipeline/src/batches.ts`; the runner is `packages/pipeline/src/batch-run.ts`.
