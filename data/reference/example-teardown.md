# Teardown: 0605(3).mp4 (reference ad)

Source: C:\Users\dloes\Downloads\0605(3).mp4 — 1080×1920, 30 fps, HEVC, 30.7s.
Contact sheet: example_contact_sheet.png (1 frame/sec, left→right, top→bottom).

## Structure

| Time | Section | Visuals |
|---|---|---|
| 0.0–4.6s | HOOK | Talking head, casual (tank top, plain wall), direct to camera |
| 4.6–13s | BODY 1 | Trading-chart b-roll: multi-monitor setups, candlestick charts |
| 13–20s | BODY 2 | More charts + laptop close-ups, dark room / screen glow |
| 20–25s | BODY 3 / PROOF | Phone screenshots of the product app (UI walkthrough) |
| 25–30s | CTA | Lifestyle b-roll: sports car, villa, driving; ends on app screen |

Scene cuts (ffmpeg scene>0.3): 4.1, 4.6, 10.1, 13.0, 14.9, 20.0, 22.0, then a
fast burst 24.6–30.2 (8 cuts in ~5.5s). Pacing: slow hook → medium body →
rapid-fire CTA section.

## Subtitle style

- ONE word at a time (occasionally two), synced to speech
- Plain white, bold sans-serif, no karaoke color highlight, subtle shadow
- Positioned center-low (~55–70% height), modest size — not full-width banners
- Runs continuously through talking head AND b-roll sections

## Takeaways for our template

1. Hook = talking head only (~4.5s), no b-roll. Our beat planner cuts to
   b-roll immediately in hooks — switch to talking-head-first for this style.
2. Body is almost entirely b-roll with voiceover; avatar barely returns.
3. CTA section uses *lifestyle* b-roll + product screens, not the talking head
   — our Phase-0 planner keeps CTA on the avatar; both styles worth testing.
4. Cut rhythm accelerates toward the end (urgency before CTA).
5. Subtitles: single-word, white, centered — implemented in Subtitles.tsx.
6. Product/app screen recordings are a b-roll category of their own —
   add "app-ui" as a library category when indexing.
