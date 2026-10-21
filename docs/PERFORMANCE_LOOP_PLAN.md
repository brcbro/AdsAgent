# Performance Loop — Meta & Google Ads → Winner Detection → Suggestions

Goal: the factory learns from the ads it ships. Performance data from Meta Ads and Google Ads
flows back in, the system finds the best-performing ads and *why* they work, and every new
brief/script gets concrete, data-backed suggestions ("hooks that open with a loss-framed question
have 2.1× hook rate — try one"). This is Phase 2 of [PLAN.md](../PLAN.md) (Module A) extended
to Google and wired into the Agent Studio and Studio that already exist.

Scope of this plan: one new package `packages/performance`, a few new tables in the existing
SQLite queue, two dashboard pages, and prompt injection into `agent-script.ts`/`scriptgen.ts`.
No cloud services. Everything runs in the existing local Express + worker process.

---

## 0. Principles

- **Read-only on the ad platforms.** We pull insights; we never change budgets, pause ads or
  upload creatives (upload stays a separate Phase 3 item behind its own confirmation gate).
- **Platform-agnostic core.** Meta and Google are *adapters* producing the same normalized rows.
  Scoring, winner detection, teardown and suggestions never know which platform a row came from.
- **Link ads to our projects by naming convention**, not by hoping someone fills a field.
  Rendered files are already named `{adId}_{hook}_{cta}_{ratio}.mp4`; the ad name on the platform
  must contain the project ID. Unlinked winners are still torn down (as "external" creatives).
- **Suggestions, not autopilot.** The output is ranked, explained recommendations shown at the
  two existing human gates (brief/script review, final review). The human picks.

---

## 1. Data model (new tables in `data/agent-queue/agent.sqlite`)

Reuse `AgentStore`'s `better-sqlite`/`node:sqlite` handle and its "CREATE TABLE IF NOT EXISTS"
migration style.

```sql
-- One row per connected ad account
ad_accounts(id TEXT PK, platform TEXT CHECK(platform IN ('meta','google')), external_id TEXT,
            name TEXT, currency TEXT, timezone TEXT, status TEXT, last_sync_at TEXT)

-- One row per creative/ad on the platform (stable across days)
platform_ads(id TEXT PK,            -- '<platform>:<external ad id>'
             account_id TEXT, platform TEXT, external_id TEXT,
             name TEXT, campaign_name TEXT, adset_name TEXT,
             creative_video_url TEXT, thumbnail_url TEXT,
             project_id TEXT NULL,   -- our data/ads/<id> if matched
             variant_key TEXT NULL,  -- e.g. 'h1_c2_9x16'
             first_seen TEXT, last_seen TEXT, status TEXT)

-- Daily metrics, normalized across platforms
ad_metrics_daily(ad_id TEXT, date TEXT,
                 impressions INT, reach INT, spend REAL, clicks INT, link_clicks INT,
                 video_plays_3s INT, video_thruplays INT,          -- Meta
                 video_p25 INT, video_p50 INT, video_p75 INT, video_p100 INT,
                 views INT, view_rate REAL,                        -- Google (video views / impressions)
                 conversions REAL, conversion_value REAL, leads INT,
                 raw JSON,                                         -- untouched platform payload
                 PRIMARY KEY(ad_id, date))

-- Rolling computed KPIs + score (recomputed after each sync)
ad_scores(ad_id TEXT PK, window_days INT, impressions INT, spend REAL,
          hook_rate REAL, hold_rate REAL, ctr REAL, cpc REAL, cpa REAL, roas REAL,
          completion_rate REAL, score REAL, percentile REAL,
          is_winner INT, is_loser INT, confidence TEXT CHECK(confidence IN ('low','medium','high')),
          computed_at TEXT)

-- Structured teardown of a creative (ours or external)
ad_teardowns(ad_id TEXT PK, transcript_de TEXT, hook_text TEXT, body_text TEXT, cta_text TEXT,
             hook_type TEXT, angle TEXT, persona TEXT, emotional_trigger TEXT, claim_structure TEXT,
             visual_style TEXT, talking_head_ratio REAL, cuts_per_10s REAL, has_text_overlay INT,
             music_energy TEXT, duration_s REAL, model TEXT, created_at TEXT)

-- The Winning Patterns KB: one row per learned pattern
patterns(id TEXT PK, dimension TEXT,       -- 'hook_type' | 'angle' | 'persona' | 'cta_style' | 'pacing' | 'visual_style' | 'duration'
         value TEXT,                        -- e.g. 'loss-framed question'
         sample_size INT, winner_share REAL, lift REAL,   -- lift = avg score of ads with this value / overall avg
         evidence JSON,                     -- top 3 ad_ids + their KPIs
         summary_de TEXT, summary_en TEXT,  -- one-line human statement
         platform TEXT NULL,                -- NULL = both
         updated_at TEXT)

-- Suggestions generated for a specific project/brief (so we can track if they were taken)
suggestions(id TEXT PK, project_id TEXT NULL, session_id TEXT NULL, kind TEXT,
            -- 'hook' | 'angle' | 'cta' | 'pacing' | 'variant_to_render' | 'ad_to_scale' | 'ad_to_kill'
            title TEXT, body TEXT, rationale TEXT, pattern_ids JSON, example_ad_ids JSON,
            score REAL, status TEXT DEFAULT 'open',  -- open | accepted | dismissed
            created_at TEXT)
```

Also extend `ProjectMetadata` (`packages/core/src/metadata.ts`) with an optional
`performance?: { platformAdIds: string[]; lastSyncedAt?: string }` so the Studio can show numbers
on the project card without a join.

---

## 2. Platform adapters (`packages/performance/src/adapters/`)

Common interface:

```ts
interface AdPlatformAdapter {
  platform: "meta" | "google";
  listAccounts(): Promise<AdAccount[]>;
  listAds(accountId: string, since: string): Promise<PlatformAd[]>;
  fetchDailyMetrics(accountId: string, from: string, to: string): Promise<AdMetricsDaily[]>;
  fetchCreativeVideoUrl(adId: string): Promise<string | null>;   // for teardown download
}
```

### 2.1 Meta (Marketing API, already decided in PLAN.md)
- Auth: system-user token in `.env` (`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_IDS`), permission `ads_read`.
- Endpoints: `/{act_id}/ads?fields=name,status,creative{video_id,thumbnail_url},campaign{name},adset{name}`;
  `/{act_id}/insights?level=ad&time_increment=1&fields=impressions,reach,spend,clicks,inline_link_clicks,actions,action_values,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,...,video_p100_watched_actions`.
- Mapping: `video_plays_3s` ← `video_play_actions`, `thruplays` ← `video_thruplay_watched_actions`,
  leads/purchases ← `actions[action_type=lead|purchase]`, value ← `action_values`.
- Creative download: `/{video_id}?fields=source` (needs the ad account's video permission).
- Rate limits: the insights call is async-capable; use `async` report jobs for >30-day backfills.

### 2.2 Google Ads (Google Ads API, GAQL)
- Auth: OAuth refresh token + developer token (`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_IDS`,
  optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID` for an MCC). Use the official `google-ads-api` npm client.
- Query (video / Demand Gen / Performance Max video assets):
  ```sql
  SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.video_ad.video.asset,
         campaign.name, ad_group.name, segments.date,
         metrics.impressions, metrics.cost_micros, metrics.clicks,
         metrics.video_views, metrics.video_view_rate,
         metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate,
         metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate,
         metrics.conversions, metrics.conversions_value
  FROM ad_group_ad WHERE segments.date BETWEEN ... AND ad_group_ad.ad.type IN (VIDEO_AD, ...)
  ```
- Mapping: `hook_rate` has no 3-second equivalent; use `video_view_rate` as the hook proxy and
  `p100/p25` as hold rate. Record this in `ad_scores.confidence` ("medium" for Google video KPIs).
- Creative download: Google serves YouTube IDs, not files. Store the YouTube URL; teardown uses
  `yt-dlp` *only for the account's own uploaded assets* (configurable, off by default).
- Google Ads API developer-token approval takes days; start the application in week 1.

### 2.3 Manual CSV adapter (day-1 fallback)
Drop `data/performance/inbox/*.csv` exported from Meta Ads Manager / Google Ads UI. A column-mapping
file per platform turns them into `ad_metrics_daily` rows. This makes the whole loop usable before
either API is approved, and is the fixture source for tests.

---

## 3. Scoring & winner detection (`packages/performance/src/score.ts`)

Pure functions, unit-tested with CSV fixtures (same style as `beat-plan.test.ts`).

1. **Window:** last 7 and last 30 days, per ad. Require `impressions ≥ 1000` and
   `spend ≥ €20` in the window, otherwise `confidence = low` and excluded from winner picks.
2. **Creative KPIs**
   - `hook_rate = plays_3s / impressions` (Google: `view_rate`)
   - `hold_rate = thruplays / plays_3s` (Google: `p100_rate / p25_rate`)
   - `completion_rate = p100 / impressions`
   - `ctr = link_clicks / impressions`, `cpc`, `cpa = spend / conversions`, `roas`
3. **Composite score** — z-score each KPI *within the same account and platform* (so Meta and
   Google never compete on raw numbers), then weighted sum. Default weights, editable in Settings:
   `hook 0.25, hold 0.20, ctr 0.20, cpa 0.25, roas 0.10` (cpa inverted). When conversions are
   missing (top-of-funnel accounts) the cpa/roas weights redistribute to the video KPIs.
4. **Bayesian shrinkage** toward the account mean for low-volume ads so a 1,200-impression fluke
   does not become a "winner" (simple empirical-Bayes on hook/ctr rates).
5. **Winner / loser flags:** top 15 % by score with `confidence ≥ medium` → `is_winner`;
   bottom 20 % with spend above threshold → `is_loser` (feeds "kill" suggestions).
6. **Fatigue detection:** 7-day score vs 30-day score; a drop > 30 % on a former winner flags
   `fatigued` → suggestion "refresh hook on {ad}".

---

## 4. Ad teardown (`packages/performance/src/teardown.ts`)

Runs as a queued job (`kind: "teardown"`) for every winner, every loser (for contrast), and every
file in `data/performance/competitors/`. Reuses existing machinery:

1. Download creative → `data/performance/creatives/<ad_id>.mp4` (ffmpeg probe for duration/fps).
2. Transcript: if the ad is **ours**, we already have the script and word timings in
   `data/ads/<id>/` — no transcription. External: local Whisper (`whisper.cpp` or `faster-whisper`
   sidecar, German). Store `transcript_de`.
3. **Structure pass** with `chatJson` (`llm.ts`): split into hook/body/cta, classify
   `hook_type` (question / bold claim / story / pattern interrupt / social proof / loss-framed …),
   `angle`, `persona`, `emotional_trigger`, `claim_structure`, `cta_style`.
   Fixed enum vocabularies in zod so patterns aggregate cleanly.
4. **Visual pass**: 1 keyframe/s via ffmpeg → Claude vision → `visual_style`,
   `talking_head_ratio`, `cuts_per_10s` (from ffmpeg scene detection, not the LLM), overlays, music energy.
5. Upsert `ad_teardowns`.

Our own ads get most of this for free from `metadata.json` (captions preset, music, `fastCuts`,
`brollCutMs`, avatar) — write a `teardownFromProject()` that fills the row without any LLM call.

---

## 5. Pattern mining → Winning Patterns KB (`patterns.ts`)

After every sync + teardown batch:

1. For each `dimension` × `value` with `sample_size ≥ 5`: `lift = mean(score | value) / mean(score)`,
   `winner_share = winners_with_value / ads_with_value`.
2. Keep patterns with `|lift − 1| ≥ 0.15` and sample ≥ 5; mark as `positive`/`negative`.
3. One LLM call per *changed* pattern to write `summary_de` / `summary_en`
   ("Hooks, die mit einer Verlust-Frage starten, haben 2,1× Hook-Rate (n=14)").
4. Cross-dimension combos (hook_type × persona) only when sample ≥ 8; otherwise too noisy.

The KB is the single thing injected into prompts. Keep it small: top 12 positive, top 5 negative
patterns, each ≤ 160 chars, plus 3 example hook texts from the best-scoring ads.

---

## 6. Suggestions engine (`suggest.ts`)

Three places produce suggestions, all writing to the `suggestions` table:

| Trigger | Kind | What it produces |
|---|---|---|
| After each sync | `ad_to_scale`, `ad_to_kill`, `refresh_hook` | Account-level actions with numbers ("Ad X: hook rate 38 % vs account 21 %, CPA €14 vs €31 — scale") |
| Opening a brief / new chat in Agent Studio | `hook`, `angle`, `cta` | 3 hook concepts, 1 angle, 1 CTA, each citing a pattern and an example ad |
| At final review in Studio | `variant_to_render`, `pacing` | "Render the h2×c1 variant first — h2's hook type is a winner", "cuts/10s of your winners ≈ 6; this project is at 3" |

Rules: a suggestion must cite ≥ 1 `pattern_id` or `ad_id`; dedupe by `(project_id, kind, title)`;
`accepted` / `dismissed` state is kept so the next round can measure whether accepted suggestions
actually won (feeds the KB as a meta-signal later).

### Prompt injection (the part that makes generated ads better)
- `agent-script.ts` `planAgentResponse`: append a `winningPatterns` block to the system prompt
  (`loadKbForPrompt({ platform, persona? })`) and instruct: *"Prefer hook types listed as winners;
  avoid listed losers; mention which pattern you used in `rationale`."* Add `rationale` and
  `usedPatternIds` to `AgentReply` so the Script Review panel can show "why this hook".
- `scriptgen.ts` (golden path / batches): same block; briefings with `source: "meta-analysis"`
  are generated from the KB (`generateBriefingsFromKb(n)`), which is Module B's "Generate 5 briefings".
- Guardrail: KB text is data. Wrap it in a delimited block and keep the existing
  "never invent statistics / guaranteed results" instruction *after* it.

---

## 7. Jobs & scheduling

Add job kinds to the existing worker (`agent-worker.ts`, sequential, lease-based):

- `perf.sync` — per account, nightly at 03:00 local + "Sync now" button. Pulls last 3 days
  (metrics are restated by both platforms for ~72 h) and upserts. Backfill 90 days on first connect.
- `perf.score` — recompute `ad_scores` after a sync.
- `perf.teardown` — one job per ad, idempotent on `ad_id`, max 3 retries; LLM/vision spend is
  capped by the existing spending safeguards in Settings.
- `perf.patterns` — after teardowns; then `perf.suggest`.

A tiny in-process scheduler (`setInterval` + "last run" row) is enough; no cron dependency.

---

## 8. Dashboard

**New page: Performance** (`features/performance/`)
- Account connection cards (Meta / Google / CSV inbox) with last sync, status, Sync now.
- Leaderboard table: ad, platform, thumbnail, spend, hook rate, hold rate, CTR, CPA, score, flags
  (winner / loser / fatigued), linked project. Sort/filter; click → teardown drawer (structure,
  keyframes, transcript, pattern tags) and "Create brief from this ad" (prefills Agent Studio).
- Patterns panel: the KB as cards with lift, n, examples; toggle a pattern off if the client disagrees.
- Suggestions inbox: account-level actions with Accept / Dismiss (accept only records the decision —
  it does not touch the platform).

**Existing pages**
- Studio project card: small KPI strip when `performance.platformAdIds` is set.
- Agent Studio: "Suggested hooks" chips above the composer; Script Review panel shows the
  rationale and pattern the script used.
- Settings: platform credentials (masked), score weights, thresholds, nightly sync toggle,
  teardown spend cap, `yt-dlp` opt-in.

API routes: `routes/performance.ts` → `GET /api/performance/accounts|ads|patterns|suggestions`,
`POST /api/performance/sync`, `POST /api/performance/suggestions/:id/{accept,dismiss}`,
`POST /api/performance/link` (manual project↔ad link). Playwright tests against the fake API, as today.

---

## 9. Linking our ads to platform ads

1. **Name convention**: exported files already carry `{adId}_{hook}_{cta}_{ratio}`; document that
   the ad *name* on Meta/Google must start with that string (the Phase 3 auto-upload will do it).
2. Matcher at sync: regex on `platform_ads.name` → `project_id`, `variant_key`.
3. Fallback: perceptual hash of the first 3 s (ffmpeg `signature` filter or 8 frame pHashes)
   compared to our `versions/` renders; manual link in the UI as last resort.
4. Once linked, the variant matrix in Studio shows which hook×cta combination won, which is the
   whole point of the modular-segment design.

---

## 10. Roadmap

| Step | Deliverable | Est. |
|---|---|---|
| 1 | ✅ `packages/performance` skeleton, tables, CSV adapter, `score.ts` + tests, Performance page leaderboard | done |
| 2 | ✅ Meta adapter + nightly sync job + project linking + KPI strip in Studio | done (needs a system-user token in `.env` to go live) |
| 3 | ✅ Teardown pipeline (own ads from script + metadata, external via sidecar transcript or `WHISPER_CMD`, cuts via ffmpeg), patterns KB, Patterns panel | done (vision keyframe pass deferred; cut frequency comes from ffmpeg) |
| 4 | ✅ Suggestions engine + prompt injection in Agent Studio / Script Review / Final review | done (`generateBriefingsFromKb` deferred to step 6) |
| 5 | ✅ Google Ads adapter (REST + GAQL, OAuth refresh token), Google KPI mapping, cross-platform normalization check (per-platform strip, Google confidence capped at medium) | done (needs the developer token in `.env` to go live) |
| 6 | ✅ Fatigue detection (step 1), competitor drop folder (step 3), suggestion outcome tracking with KPI snapshots and a per-pattern meta-signal in the KB prompt, KB-driven briefing generator (`pnpm briefings`, Performance page) | done |

Exit criterion: every new brief in Agent Studio shows ≥ 3 data-backed hook suggestions, each
traceable to a real ad and KPI, and the Performance page answers "what should I scale, kill or
refresh today" without opening Ads Manager.

---

## 11. Risks & open items

| Risk | Mitigation |
|---|---|
| Meta app review / Google developer token delays | CSV inbox adapter makes steps 1, 3, 4 shippable without any API |
| Small accounts → noisy winners | Shrinkage + min-volume thresholds + confidence label; never show a "winner" with `confidence=low` |
| Google has no 3-second metric | View rate as proxy, flagged medium confidence; scores z-scored per platform so they are not mixed raw |
| Teardown LLM/vision spend at scale | Only winners, losers, competitors; existing spend caps; our own ads need no LLM |
| Attribution lag (conversions restated) | Re-pull last 3 days each sync; CPA/ROAS use the 30-day window only |
| KB text used as prompt injection vector | Teardown outputs are enum-constrained; free-text summaries are length-capped and placed inside a delimited data block |

**To confirm with the client before step 2:** which Meta ad account(s) and system user; whether
Google Ads is actually running video (if only Search, the Google adapter reduces to CTR/CPA and
step 5 shrinks to 2–3 days); the conversion event that defines "CPA" on each platform; and
whether competitor creatives may be downloaded and stored locally.
