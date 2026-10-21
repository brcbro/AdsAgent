# AI Ad Factory — Build Plan

Pipeline tool that turns winning-ad analysis + chat briefings into finished 24–30s German Meta video ads: HeyGen talking head + ElevenLabs voice + auto-selected B-roll + Remotion assembly with subtitles. Hook, body, and CTA are independently swappable segments.

**Decisions already made (with client):**
- Meta data via **Marketing API** (system user token)
- Human review gates at **script approval** and **final cut approval** only
- Interface: **local web app**
- B-roll on **local disk/NAS**, pipeline runs locally

---

## 1. Core concept: the modular ad

Every ad is a composition of three segments, each generated and stored independently:

```
[HOOK 3–6s] + [BODY 14–18s] + [CTA 4–6s]  =  24–30s total
```

Each segment has its own script, its own ElevenLabs audio, its own HeyGen avatar clip, and its own B-roll plan. Swapping a hook means re-rendering only the Remotion composition with a different hook segment — **no new HeyGen/ElevenLabs cost**. This is what makes variant testing cheap: 4 hooks × 1 body × 2 CTAs = 8 ad variants from 7 generated segments.

The central data structure is the **Ad Project JSON** that flows through every stage:

```jsonc
{
  "id": "ad_2026_06_0042",
  "briefing": { "angle": "...", "persona": "...", "tone": "...", "source": "meta-analysis | chat" },
  "segments": {
    "hooks": [ { "id": "h1", "script_de": "...", "audio": "...", "avatar": "...", "duration_ms": 4200,
                 "broll_plan": [...], "word_timestamps": [...] } ],
    "body":  { ... },
    "ctas":  [ { ... } ]
  },
  "variants": [ { "hook": "h1", "cta": "c2", "render": "out/ad_0042_h1_c2.mp4", "status": "approved" } ],
  "state": "briefing | script_review | generating | assembly | final_review | exported"
}
```

---

## 2. Architecture overview

```
┌─────────────────────────────  Web App (Next.js, local)  ─────────────────────────────┐
│  Briefing chat │ Ad pipeline board │ Script review gate │ Preview + final cut gate   │
└──────┬─────────────────┬──────────────────┬─────────────────────┬────────────────────┘
       │                 │                  │                     │
┌──────▼──────┐  ┌───────▼───────┐  ┌───────▼────────┐  ┌─────────▼────────┐
│ A. Analysis │  │ B. Briefing & │  │ C. Generation  │  │ D. Assembly      │
│ Meta API +  │  │   Script      │  │ ElevenLabs +   │  │ B-roll matching  │
│ competitor  │  │   (Claude)    │  │ HeyGen workers │  │ + Remotion       │
└──────┬──────┘  └───────────────┘  └────────────────┘  └─────────┬────────┘
       │                                                          │
┌──────▼──────────────────────────────────────────────────────────▼────────┐
│ E. Asset & Knowledge Store: SQLite (+ vector search) + file storage      │
│    indexed B-roll library · winning-patterns KB · usage tracking         │
└───────────────────────────────────────────────────────────────────────────┘
```

**Stack:** TypeScript monorepo (pnpm). Next.js web app, Remotion for rendering, SQLite + `sqlite-vec` for metadata/embeddings/job queue, `ffmpeg` for media ops, all LLM/vision work via OpenRouter (model configurable per env, default Claude). No Redis, no Postgres, no cloud — everything runs on one Windows machine/NAS. A small Python sidecar only if scene detection needs it (PySceneDetect); otherwise ffmpeg scene-cut detection suffices.

---

## 3. Module A — Meta ads analysis (briefing fuel)

### Own account (Marketing API)
1. Nightly sync job pulls all video ads + insights: impressions, 3-sec video plays, ThruPlays, video watch percentiles, CTR, CPA/ROAS.
2. Compute creative KPIs per ad: **hook rate** (3s plays / impressions), **hold rate** (ThruPlay / 3s plays), CTR, CPA. Rank ads; flag top ~15% as "winners".
3. For each winner: download the video (creative asset via API), then run the **ad teardown**:
   - Transcribe (local Whisper) → German transcript with timestamps
   - LLM segments transcript into hook / body / CTA, classifies the angle, persona addressed, emotional trigger, claim structure
   - Vision pass on keyframes (1 frame/sec → Claude vision): visual style, talking-head vs B-roll ratio, cut frequency, text overlays
4. Store as structured **Winning Patterns KB**: per-pattern entries ("hooks that open with a loss-framed question have 2.1× hook rate"), refreshed as data accumulates. This KB is injected into every briefing/script generation prompt.

### Competition
The Ad Library API is unreliable for non-political ads; the EU transparency version of the **Ad Library website** does show competitor ads. Plan: a lightweight manual flow — you save competitor ad videos/links into a `competitors/` drop folder, the same teardown pipeline (transcribe → segment → classify) ingests them into the KB tagged `source: competitor`. Automating Ad Library scraping is a Phase-3 nice-to-have, not a dependency.

---

## 4. Module B — Briefing & script

### Briefing creation, two entry points
1. **From analysis:** "Generate 5 briefings" → LLM samples from the Winning Patterns KB, produces briefings with deliberately varied angles (the prompt receives the last N briefings and is instructed to differentiate — this also feeds the anti-repetition goal).
2. **Chat:** web-app chat panel backed by Claude with the KB as context. You type an idea ("hook about the guy who missed the NVDA run"), the bot drafts a structured briefing, you refine conversationally, hit "Accept" → briefing saved.

Both produce the same briefing schema: angle, persona, pain point, promise, tone, **N hook concepts, 1 body concept, M CTA concepts**, visual direction keywords.

### Script generation with duration budgeting
German spoken pace is ~13–15 characters/sec for energetic ad reads. The generator works in a loop:

1. LLM writes German scripts per segment with explicit character budgets (hook ≤ ~75 chars for 5s, body ≤ ~240 chars, CTA ≤ ~80 chars).
2. Estimated duration check (chars ÷ rate). Out of budget → automatic rewrite pass.
3. **German correctness pass:** self-hosted LanguageTool (free, runs locally, excellent for German grammar/orthography) + an LLM review prompt specifically for unnatural phrasing, Anglicisms, and TTS pitfalls (numbers, currency, tickers like "NVDA" get spelled-out pronunciation hints).
4. **GATE 1 — Script review in the web app.** You see all segments, estimated durations, and flagged issues; edit inline, then approve. Nothing costs money before this point.

After real audio exists (Module C), actual durations replace estimates; if a segment lands outside budget, it's flagged for a trim-rewrite + regenerate (one click, small ElevenLabs cost).

---

## 5. Module C — Voice & avatar generation

Order matters: **audio first, avatar driven by that audio.** This guarantees the ElevenLabs German voice is what's heard, and the avatar length always equals audio length.

1. **ElevenLabs v3** per segment, with a project-level **pronunciation dictionary** (brand name, tickers, finance jargon). Audio tags for delivery control on the hook (urgency/emphasis).
2. **Word timestamps for subtitles:** if the v3 endpoint doesn't return reliable character-level timestamps, run local **whisperX forced alignment** against the known script — gives perfect word-level timing since the text is known. (This fallback is cheap and deterministic; build it from day 1.)
3. Duration check against budget → auto trim-rewrite loop if needed (before spending HeyGen credits).
4. **HeyGen API**: upload the audio asset, generate avatar video per segment (avatar talking to the uploaded audio, not HeyGen TTS). Request the cleanest available background (solid color keyable green/grey if alpha export isn't on the plan tier) at 1080×1920 or highest available, so Remotion can frame/crop freely.
5. Poll job status, download, store under the segment in the Ad Project.

Per-ad cost estimate at this stage: ~€1–3 ElevenLabs + HeyGen credits per segment-set; variants reuse segments at zero marginal API cost.

---

## 6. Module E first — B-roll library indexing (prerequisite for D)

### Phase-1 scope: curated subset, not 32k
Start with **300–800 hand-picked clips** across the four categories (luxury lifestyle, trading, hard work, gym). This gets to a working product in weeks, and the indexing pipeline built for 800 scales unchanged to 32k later (it's just compute time).

### Indexing pipeline (per clip)
1. `ffprobe` metadata: duration, resolution, fps, orientation.
2. Scene-cut detection (ffmpeg `select='gt(scene,0.3)'`); multi-shot files are virtually split into sub-clips with in/out points — the retrieval unit is the **shot**, not the file.
3. Extract 2–3 keyframes per shot → **Claude vision** produces: one-sentence description, category, tags (objects, setting, mood, energy level, camera motion), suitability flags (has text/logos/faces — important for rights and for avoiding visual conflicts with subtitles).
4. Embed the description text (embedding model) → vector stored in `sqlite-vec` alongside tags.
5. Quality score (resolution, stability heuristic) for ranking.

Indexing cost: roughly 1–2 vision calls per shot — trivial for 800 clips, an overnight batch job at 32k scale.

### Anti-repetition (explicit requirement)
A `clip_usage` table records every clip placed in any rendered ad. Selection score:

```
score = semantic_similarity
      − λ1 · uses_in_last_30_days
      − λ2 · already_used_with_similar_briefing   (briefing-embedding distance)
      + λ3 · quality_score
```

Then **sample from the top-k** (k≈8, softmax) instead of always taking the argmax, and enforce hard rules: no clip twice within one ad, cooldown of X days per clip, and per-ad cap of clips sharing the same source file. Result: two similar briefings get overlapping *style* but different *footage*.

---

## 7. Module D — Visual plan & Remotion assembly

### Visual plan
Input: approved script + real word timestamps + briefing's visual direction + cut-rhythm patterns from the Winning Patterns KB. An LLM produces a **beat sheet**: a timeline of 1.5–3s windows, each marked `talking_head` or `broll` with a search query ("close-up of hands on a steering wheel, night city"), plus on-screen text moments. Typical pattern: hook = fast B-roll cuts with avatar voiceover, body = alternating avatar/B-roll, CTA = avatar full-frame + end card.

Each `broll` beat runs through the retrieval + anti-repetition ranking → concrete clip + in/out points written into the plan.

### Remotion composition
One parametric composition, props = the full Ad Project JSON:

- **Track 1:** talking-head segments (keyed/cropped, full-frame or PiP per beat)
- **Track 2:** B-roll cutaways with subtle scale/movement, cut on beat boundaries
- **Track 3:** word-by-word karaoke subtitles from the timestamps (brand font, active-word highlight, safe-area aware: top 14% / bottom 20% clear for Meta UI)
- **Track 4:** hook text overlay, logo watermark, CTA end card
- **Audio:** segment voice tracks + optional music bed with ducking (sidechain via volume envelope)

Output: 1080×1920 (9:16) primary; 4:5 and 1:1 as crop-variant renders of the same composition. Local render via `@remotion/renderer` — a 30s 1080p vertical renders in ~1–3 min on a decent machine.

**GATE 2 — Final cut review:** Remotion Player embedded in the web app for instant preview (props-driven, no render needed to preview). Approve → final render(s) → export folder with naming convention `{adId}_{hook}_{cta}_{ratio}.mp4` ready for Meta upload. (Auto-upload via Marketing API as paused ads = Phase 3.)

---

## 8. Web app & orchestration

- **Pipeline board:** every ad project as a card moving through `briefing → script review → generating → assembly → final review → exported`, with cost tracking per ad.
- **Job queue in SQLite** (a `jobs` table + a worker process): ElevenLabs/HeyGen calls, indexing batches, renders. Survives restarts, retries with backoff, never blocks the UI. HeyGen jobs are async-polled.
- **Briefing chat** and **library browser** (search the indexed B-roll, see usage heat) as additional tabs.
- Everything addressable by ID; all artifacts on disk under `data/ads/{adId}/…` so the file system stays inspectable.

---

## 9. Roadmap

### Phase 0 — Golden path validation (≈ week 1)
No UI. One script that takes a hand-written briefing JSON and produces ONE finished ad end-to-end: Claude script → manual approval in terminal → ElevenLabs → HeyGen → whisperX timestamps → hand-picked 10 B-roll clips → Remotion render with subtitles.
**Purpose: de-risk every external API (HeyGen audio-driven generation, ElevenLabs v3 German quality, timestamp accuracy) before building anything around them.** Also: teardown of the provided example video (`0605(3).mp4`) to extract its structure as the first Remotion template reference.

### Phase 1 — MVP factory (≈ weeks 2–3)
- B-roll indexer + retrieval + anti-repetition on 300–800 curated clips
- Visual plan generation
- Web app: briefing chat, script gate, Remotion preview, final gate, export
- Segment-swap variant rendering (hooks × CTAs matrix)
- **Exit criterion: 3–5 publishable ads per day with ~30 min total human time each.**

### Phase 2 — Analysis loop (≈ weeks 4–5)
- Meta Marketing API sync + KPI ranking + automated ad teardowns → Winning Patterns KB
- Auto-generated briefing batches from the KB
- Competitor drop-folder ingestion
- Real performance data of *our generated ads* flows back into the KB → the factory learns

### Phase 3 — Scale & polish (week 6+)
- Index the full 32k library (batch job)
- Auto-upload to Meta as paused ads; naming/UTM conventions
- Music bed library + auto-ducking, A/B subtitle styles
- Optional: Ad Library automation for competitors, cloud rendering if volume demands it

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| HeyGen avatar quality/latency varies; audio-driven mode behaves differently per plan tier | Phase 0 validates exactly this before any architecture commits to it |
| ElevenLabs v3 German mispronounces finance terms/numbers | Pronunciation dictionary + TTS-pitfall rewrite pass + script gate happens before generation |
| v3 may not return word timestamps | whisperX forced alignment against known script — built as the default, not a fallback |
| Meta Marketing API app review/permissions take time | Start the app + system-user setup in week 1, parallel to Phase 0; manual CSV/video drop folder works meanwhile |
| Vision-tagging 32k clips is slow/costly upfront | Curated subset first; full library is an overnight batch later, pipeline identical |
| Similar briefings → repetitive ads | Usage-penalized sampling + briefing-similarity penalty + cooldowns (Module E) |
| Compliance (financial advertising claims, DE) | Add a claim-check pass to the script gate: LLM flags promises/guarantees that violate Meta's financial-products ad policies before you approve |

---

## 11. Open items to confirm before Phase 0

1. **HeyGen plan tier** — does it include API access and audio-upload (audio-driven avatar)? Which avatar(s) will be used?
2. **Meta** — who can create the system user / app for Marketing API access on the ad account?
3. The **example video** should be torn down in Phase 0 as the reference for pacing, subtitle style, and structure — ffmpeg isn't installed on this machine yet; it's a Phase-0 setup dependency (ffmpeg, Node 20+, pnpm).
4. **Brand kit** — font, colors, logo files, subtitle style reference for the Remotion template.
