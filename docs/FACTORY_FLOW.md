# Video Factory — Complete Production Flow

One command produces a finished Meta ad from a project ID. Designed for **batch runs** (hundreds/thousands of videos) where scripts and avatars are reused or pre-generated.

```bash
pnpm factory --sync-broll          # once: index ~/Downloads/B-Roll
pnpm factory jun17_01 jun17_02     # render finished ads
pnpm factory jun17_01 --skip-heygen  # re-edit only (cached avatar)
```

Output: **`video/final/<id>.mp4`**

---

## End-to-end pipeline

```
metadata.json (script + avatar + music)
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 1. VOICE — ElevenLabs v3 (NOT HeyGen TTS)                  │
│    POST /v1/text-to-speech/{voice}/with-timestamps        │
│    model: eleven_v3                                       │
│    → data/ads/<id>/main.mp3                               │
│    → word timestamps for karaoke captions                 │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 2. AVATAR — HeyGen lip-sync only                          │
│    Upload MP3 → generateAvatarClip(audioPath)             │
│    HeyGen animates face to ElevenLabs audio               │
│    → data/agent/<id>/main.mp4  (reusable cache)          │
│    Pure talking-head, 30–40s, 9:16                        │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 3. BEAT PLAN — timeline                                     │
│    0–5s:   talking head only (intro)                      │
│    5s–end: B-roll cuts every ~1.4s                        │
│    Avatar audio continues under B-roll                    │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 4. SEMANTIC B-ROLL — match script to clips                 │
│    For each B-roll beat:                                  │
│      • slice script words in that time window             │
│      • score clips from data/broll/catalog.json           │
│      • pick best category: Trading / Lifestyle / etc.     │
│    Source: ~/Downloads/B-Roll/                              │
│      Trading Content/                                     │
│      Lifestyle & Freiheit Content/                        │
│      Deep Work & Fokus Content/                           │
│      Interaktion & Community Content/                     │
│    Previews: data/broll/previews/*.jpg                    │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 5. RENDER — ffmpeg (local, ~10–30s)                       │
│    Concat video segments (avatar + B-roll play as video)  │
│    Mix audio: voice 100% + music bed 30%                  │
│    Burn ALL CAPS captions (+30% font size)                │
│    → data/ads/<id>/out/final.mp4                          │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ 6. POST — 1.2× speed                                       │
│    ffmpeg setpts + atempo on full export                  │
│    → video/final/<id>.mp4                                 │
└───────────────────────────────────────────────────────────┘
```

---

## Folder layout

| Path | Purpose |
|------|---------|
| `~/Downloads/B-Roll/` | Raw B-roll downloads (4 category folders) |
| `data/broll/clips/` | Symlinked clips with category prefix in filename |
| `data/broll/previews/` | Screenshot per clip for catalog / future vision AI |
| `data/broll/catalog.json` | `{ file, category, tags, preview, sourceFolder }` |
| `data/ads/<id>/metadata.json` | Script, avatar, music, caption settings |
| `data/ads/<id>/main.mp3` | ElevenLabs voice |
| `data/agent/<id>/main.mp4` | HeyGen avatar cache (reuse with `--skip-heygen`) |
| `data/ads/<id>/beats.json` | Timeline + semantic B-roll assignments |
| `data/ads/<id>/out/final.mp4` | Pre-speed render |
| `video/final/<id>.mp4` | **Deliverable** |

---

## Voice: ElevenLabs v3 vs HeyGen TTS

| | Golden / Factory | Old produce path |
|--|------------------|------------------|
| Voice | **ElevenLabs v3** | HeyGen built-in German TTS |
| Avatar | HeyGen **audio mode** | HeyGen **text mode** |
| Quality | Natural, human-like | Robotic / bot-like |
| Captions | Real word timestamps | Estimated proportional |

**Required env:** `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `HEYGEN_API_KEY`

Force old voice: `pnpm produce <id> --heygen-voice`

---

## B-roll semantic matching

1. **Sync** clips from `~/Downloads/B-Roll` → `data/broll/clips/` (folder name preserved in filename)
2. **Catalog** — ffmpeg screenshot at 35% + category + tags from filename
3. **Per beat** — German script slice → keyword themes → score clips by category + tags
4. **Anti-repeat** — no duplicate clip within one video

Example: script mentions *"Trading ohne System… Markt… Verlust"* → **Trading** clips (charts, screens, trader at desk).

Example: *"Freiheit… von überall arbeiten"* → **Lifestyle** clips.

---

## Default factory settings

| Setting | Value |
|---------|-------|
| Intro (avatar only) | 5 seconds |
| B-roll cut length | 1.4s |
| Music volume | **30%** (normalized, voice stays primary) |
| Voice volume | 100% |
| Output speed | **1.2×** |
| Captions | Poppins bold italic, **ALL CAPS**, 88px (~30% larger) |
| Renderer | ffmpeg (local) |

---

## Batch production (thousands of videos)

Scripts and avatars are **cached** — re-rendering is cheap:

```bash
# First run per ad (ElevenLabs + HeyGen — minutes, costs API credits)
pnpm factory ad_001 ad_002 ad_003

# Re-edit only (B-roll shuffle, caption tweak, music — seconds, free)
pnpm factory ad_001 ad_002 --skip-heygen --shuffle-broll
```

**Scale pattern:**
1. Pre-generate all `metadata.json` files (dashboard or batch script)
2. Run HeyGen overnight for new avatars (`pnpm factory ...` without `--skip-heygen`)
3. Iterate edits with `--skip-heygen` (ffmpeg only)
4. Collect deliverables from `video/final/`

---

## Commands reference

```bash
pnpm factory --sync-broll              # Refresh B-roll index + screenshots
pnpm factory <id>                      # Full factory run
pnpm factory <id> --skip-heygen        # Re-render with cached avatar
pnpm produce <id> --elevenlabs         # Manual: ElevenLabs + HeyGen
pnpm produce <id> --semantic-broll     # Manual: semantic B-roll
pnpm produce <id> --renderer=ffmpeg    # Manual: fast local render
pnpm broll-catalog                     # Rebuild catalog only
```

---

## Future upgrades (PLAN.md)

- Claude vision on preview JPGs for richer clip tags
- Embedding search (sqlite-vec) for finer semantic match
- whisperX forced alignment if ElevenLabs timestamps unavailable
- Job queue for parallel HeyGen polling across hundreds of ads
