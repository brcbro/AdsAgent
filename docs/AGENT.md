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
pnpm broll-classify                  # classify B-roll in data/broll/inbox/ (the dashboard does this automatically)
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

- **Script gate.** Auto-produce is off by default, so every brief stops at the review panel first. The panel runs the claim check live, shows the character budget (30–1500) and the duration estimate the planner uses (about 14 characters per second), and blocks approval while a blocked claim is present. "Ask the agent to revise" sends your note plus the current script back as the next brief. Sending a new brief while a script awaits review replaces that script (the dashboard asks first).
- **Blocked scripts.** A script the claim check blocks goes back to the review panel with the finding instead of failing; edit the wording and approve. Stopped jobs with a script offer "Edit script" to reopen the gate.
- **Video gate.** A finished video shows **Approve** and **Request changes** both in the chat and in the queue. A change request is recorded on the job and dropped into the composer as the next brief.
- **Chats.** Titles come from the agent's own title for the first brief (or a word-boundary cut of the message). "New chat" reuses an empty chat. Archived chats can be restored from the archive icon in the chat list. Drafts, script edits and composer settings are kept in the browser.
- **Worker.** Click the worker status in the queue header for restarts, exit codes and the tail of `data/agent-queue/worker.log`.
- **Shortcuts.** `Alt+C` new chat, `/` focus the brief, `Enter` send, `Shift+Enter` new line.

## Pronunciation

Text sent to ElevenLabs is rewritten to spoken German (for example `%` → "Prozent", `€` → "Euro", `CFD` → "C F D"). The stored script keeps the written form. Captions show what was actually spoken. Rules: `packages/pipeline/src/pronunciation.ts`.

## B-roll

Clips live in `data/broll/clips/<Category>/` (Trading, Lifestyle, Deep Work, Community); `data/broll/catalog.json` holds one entry per clip with its preview, tags and category. Portrait clips work best.

- **Adding clips.** Library → B-roll → **Add clips**: pick or drop MP4/MOV/WebM files (each is streamed to the server with its own progress bar), or switch to **Local paths** and paste file or folder paths for big batches on this machine (files are copied; the originals stay). Dropping files anywhere on the B-roll tab opens the same dialog. The default **Auto-classify** sends clips to `data/broll/inbox/`; choosing a category stores them directly under that folder as confirmed.
- **Inbox.** Anything copied into `data/broll/inbox/` by hand is picked up too, once the file has stopped changing for a few seconds. Clips dropped straight into a category folder are catalogued with that folder as their category (no model call).
- **Classifier.** The dashboard runs an always-on job that samples three frames from each inbox clip, asks the configured LLM (`LLM_PROVIDER`, `ANTHROPIC_MODEL`; override with `BROLL_CLASSIFY_MODEL`) for a category, tags, a confidence and a one-line description, then moves the clip under `clips/<Category>/` and writes the catalog entry. Confidence below `BROLL_REVIEW_THRESHOLD` (default 0.7), or a category outside the list, flags the clip **Needs review**. Confirmed clips are never re-classified, so re-running is safe. The job pauses while a manual render or an agent job runs (same `data/agent-queue/manual-render.lock` rule as the worker) and holds `data/agent-queue/broll-ingest.lock` so only one run is active. Progress and errors show in the Library header and in `data/broll/ingest-state.json`; a clip that fails (for example, no API key) stays in the inbox and is retried after ten minutes or on the next manual run.
- **Review.** The **Needs review** chip lists flagged clips with the classifier's confidence; pick the right category on the card or in the preview dialog to confirm. Any clip's category can be corrected from its preview dialog. Flagged clips are still available to the agent under their suggested category until corrected.
- **Manual runs.** **Classify unclassified** in the Library, or `pnpm broll-classify` from a terminal, processes the inbox, new files in category folders and leftover "Other" entries. `pnpm broll-catalog` still rebuilds the whole catalog (keeping classifier and human decisions).

## Music

Default track: `data/music/funk-bed.mp3`. Manage the catalog in `packages/core/src/musicTracks.ts`. The ffmpeg renderer normalises the bed and ducks it under the voice.
