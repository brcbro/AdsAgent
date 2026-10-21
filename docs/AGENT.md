# AI Ad Factory — Operator Guide

Operate the video pipeline from the web dashboard or the command line. Both read and write the same `data/ads/<id>/metadata.json`.

## Commands

```bash
pnpm dashboard                       # http://localhost:3847 (this machine only)
pnpm produce <id>                    # render one project from its metadata
pnpm produce <id> --skip-heygen      # re-render from the saved avatar clip (no HeyGen call)
pnpm factory <id> [more-ids...]      # factory settings: ElevenLabs, semantic B-roll, ffmpeg, ALL CAPS
pnpm batch-run --list                # list named batches
pnpm batch-run <name> [--only <id>]  # run a batch (see the list above)
pnpm avatars                         # cache HeyGen avatars → data/avatars.json
pnpm typecheck                       # typecheck pipeline and dashboard
pnpm --filter @ai-ads/pipeline run test   # unit tests
```

Batch names: `trading-intro`, `editor-golden`, `parallel-5`, `portrait-10`, `jun17-single`, `jun17-pair`, `jun17-parallel`, `jun17-female-rerender`, `jun17-male`, `jun20-male`, `produce-pair`, `dashboard-demo`, `test-16-june`. Definitions live in `packages/pipeline/src/batches.ts`.

Batches choose an output folder (`video/<session>/`) unless `VIDEO_SESSION` is already set. Parallel batches run one `produce` process per project.

## Output

```
data/ads/<id>/             # working files: metadata.json, main.mp3, main.mp4, beats.json, out/
video/<session>/<id>.mp4   # finished deliverable (session defaults to "16th June")
video/final/<id>.mp4       # copy of the latest finished render
```

Set `VIDEO_OUTPUT_DIR` (in `.env` or the shell) to write `video/` somewhere outside the repo.

## Metadata

Edit through the dashboard or in `metadata.json`.

| Field | Purpose |
|-------|---------|
| `introMs` | Avatar visible on screen (3000–10000). Voice continues over B-roll after. |
| `music.volume` | 0–1 (default 0.2) |
| `music.enabled` | Toggle the music bed |
| `music.duck` | Lower the music while the voice speaks (ffmpeg renderer). Default on; set `false` to disable. |
| `captions.presetId` | One of the caption presets in `packages/core/src/captionPresets.ts` |
| `avatar.heygenAvatarId` | From `data/avatars.json` or the HeyGen API |

## Safety gates

- **Claim check.** Before any voice or avatar generation, the script is checked for blocked finance claims (guarantees, risk-free trading, get-rich promises, return figures). A blocked script stops the job. Softer wording (e.g. "Sicher", "Finanzielle Freiheit") is reported as a warning for a human to review. Rules: `packages/pipeline/src/compliance.ts`.
- **Narration cap.** One ElevenLabs request may not exceed `ELEVENLABS_MAX_CHARS` characters (default 3000).
- **Human approval.** Agent Studio never approves a video automatically. A finished video shows an **Approve** button; only a rendered video with a quality report can be approved.

## Agent Studio

Describe a video in the chat and run the agent. It writes a German script, generates the voice, cuts B-roll and captions, runs technical quality checks, then waits for approval. The queue is stored in `data/agent-queue/agent.sqlite`. Jobs are retried up to three times. Voice retries after an interrupted request may spend ElevenLabs credits again, so they need an explicit retry.

## Pronunciation

Text sent to ElevenLabs is rewritten to spoken German (for example `%` → "Prozent", `€` → "Euro", `CFD` → "C F D"). The stored script keeps the written form. Captions show what was actually spoken. Rules: `packages/pipeline/src/pronunciation.ts`.

## B-roll

Clips live in `data/broll/clips/`. Run `pnpm broll-catalog` after adding clips to generate tags and previews. Portrait clips work best.

## Music

Default track: `data/music/funk-bed.mp3`. Manage the catalog in `packages/core/src/musicTracks.ts`. The ffmpeg renderer normalises the bed and ducks it under the voice.
