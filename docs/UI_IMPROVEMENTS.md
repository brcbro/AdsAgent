# Dashboard UI — Improvement Plan (White / Premium / Enterprise)

## Status (2026-10-13)

Implemented in the React rebuild (`packages/dashboard/web/`): every P0 and P1 item, and
most P2 items. Server changes that support it: safe metadata saves (URL decides the id,
pipeline-owned fields can't be overwritten, schema validation), project archive endpoint,
live render progress in `/api/render-status`, service status in `/api/studio-config`,
exact gender filter for avatars, and video lookup that falls back to `data/ads/<id>/out/`.

Follow-up (2026-10-14) — the remaining items, now done:

- 4.9 Version history and A/B compare: the pipeline keeps the last 10 renders per project with a
  settings snapshot (`pipeline/src/versions.ts`); the Studio plays, compares (synced, with a
  settings diff) and restores them. Restore brings back captions, music, B-roll and export
  settings; the script and presenter stay, because Apply edits reuses the latest narration.
- 5.18 Pin / exclude B-roll per project (`brollPinned`, `brollExcluded`); pinned clips are
  guaranteed a cut where they match the script best.
- 9.3 Rename and archive agent chats. Archive hides the chat but keeps its jobs and approvals.
- 5.13 Real music waveforms (decoded in the browser, cached), with click-to-seek while playing.
- 1.12 Dark mode (Settings → Appearance; light stays the default).
- 3.6 Long lists skip off-screen rendering (`content-visibility`) instead of a virtualisation library.
- 12.5 Playwright browser tests (`pnpm test:ui`) against a fake API that rejects any unexpected call.

Still open: 12.6 i18n (a German UI). The interface is English while content is German; translating
the UI is a product decision.

Scope: `packages/dashboard/public/index.html` (editor, ~1300 lines) and
`packages/dashboard/public/agent.js` (Agent Studio). Today the UI is a dark
theme (`#0a0a0e` + gold `#ffd700`), built with inline `innerHTML` templates,
emoji/unicode icons and 9–11px text.

Priority legend: **P0** = bug / broken behaviour, **P1** = core of the
premium white redesign, **P2** = enterprise polish, **P3** = nice to have.

---

## 1. Design system (foundation — do this first)

| # | Pri | Change |
|---|-----|--------|
| 1.1 | P1 | **Light theme tokens.** Replace the `:root` palette with a neutral white system: page `#FAFAFA`, surface `#FFFFFF`, subtle `#F4F4F5`, border `#E4E4E7`, strong border `#D4D4D8`, text `#09090B`, secondary text `#52525B`, muted `#71717A`. |
| 1.2 | P1 | **New accent.** Gold `#ffd700` fails contrast on white (≈1.4:1). Use one confident brand accent, e.g. deep indigo `#4F46E5` (or near-black `#18181B` for a monochrome "Linear/Vercel" look). Keep gold only as a small brand mark if wanted. |
| 1.3 | P1 | **Semantic colours** with AA contrast on white: success `#16A34A`, warning `#D97706`, danger `#DC2626`, info `#2563EB`, each with a 50-tint background for badges/alerts. Remove hard-coded `#6f6`, `#f77`, `#ccc`, `#222`, `#333`. |
| 1.4 | P1 | **Typography.** Load Inter (or Geist) instead of the system stack. Scale: 12 / 13 / 14 / 16 / 20 / 24. **Minimum 12px** — the current 9px and 10px labels (`.av-label`, `.preset-mode`, `.cap-label`, `.pi-label`, hints) are below enterprise readability. Use `font-feature-settings: "tnum"` for timers, percentages and counts. |
| 1.5 | P1 | **Spacing + radius + elevation tokens.** 4px spacing grid; radius 6 / 8 / 12; three shadow levels (`xs` for inputs, `sm` for cards, `lg` for modals/popovers). On white, depth comes from soft shadows + 1px borders, not dark fills. |
| 1.6 | P1 | **Real icon set.** Replace `✦ ↻ ▶ ↓ ■ › ⬘ ← →` with inline Lucide SVG icons (16px, 1.5 stroke). Emoji glyphs render differently per OS and look unfinished. |
| 1.7 | P1 | **Remove all inline `style="…"`** (≈25 occurrences, e.g. `style="font-size:10px;color:var(--muted)"`) and move them into named classes (`.hint`, `.meta`, etc.). |
| 1.8 | P1 | **Component classes**: one `Button` with variants (`primary`, `secondary`, `ghost`, `danger`) and sizes (`sm`, `md`, `lg`); `Input`, `Select`, `Textarea`, `Switch`, `Slider`, `Badge`, `Card`, `Tabs`, `Modal`, `Toast`, `Tooltip`, `Skeleton`, `EmptyState`. Today there are 8+ ad-hoc button styles (`.send-btn`, `.header-button`, `.download-btn`, `.stop-btn`, `.speed-pre`, `.btn-confirm`, `.pager button` …). |
| 1.9 | P1 | **Focus rings.** Inputs currently use `outline: none` with a faint border change. Add a visible 2px accent ring (`:focus-visible`) on every interactive element. |
| 1.10 | P2 | **Video canvas stays dark.** Even in the white theme, keep the player stage and caption previews on a neutral dark (`#0B0B0F`) surface so captions are judged against realistic footage. |
| 1.11 | P2 | **Scrollbars**: 8px thin, light-grey thumb, visible on hover (current 4px is hard to grab). |
| 1.12 | P3 | Keep tokens structured so a dark mode can be re-added later via `[data-theme="dark"]`. |

## 2. App shell & navigation

| # | Pri | Change |
|---|-----|--------|
| 2.1 | P1 | **Proper top bar**: logo + product name left; primary nav **Studio · Agent · Library** as segmented tabs in the centre; right side: global render status, credits/usage indicator, settings, help. Height 56px. |
| 2.2 | P0 | **Agent Studio overlay covers the editor on load.** `#agentWorkspace` has no `hidden` attribute, so it renders over the editor at startup and is positioned with a hard-coded `inset: 49px 0 0`. Make Agent and Studio real views with explicit navigation instead of an overlay. |
| 2.3 | P1 | **URL routing** (`#/studio/:projectId`, `#/agent/:sessionId`). Refreshing the page currently loses the selected project and view; links can't be shared. |
| 2.4 | P1 | Move model/voice info (`serviceSummary` showing raw model IDs) out of the header into a **status popover / Settings** page. |
| 2.5 | P1 | **Global status pill** that reflects real worker state everywhere (it is only updated while a single project is polling). States: Idle · Rendering (n) · Worker offline. |
| 2.6 | P2 | **Command palette** (`Ctrl/⌘+K`): new video, switch project, open agent, search B-roll. |
| 2.7 | P2 | **Keyboard shortcuts** + a `?` cheat-sheet: Space play/pause, J/K/L, `,`/`.` frame step, `Ctrl+S` save, `Ctrl+Enter` render / send to agent. |
| 2.8 | P2 | **Responsive layout.** The editor grid is fixed `188px 1fr 360px` with no breakpoints. Make the project sidebar collapsible, the inspector resizable, and stack panels below ~1100px. |
| 2.9 | P2 | Settings page: API keys status (configured / missing, never showing values), default voice, default caption preset, default format, output folder. |

## 3. Projects sidebar

| # | Pri | Change |
|---|-----|--------|
| 3.1 | P1 | Project rows with **thumbnail** (first frame / avatar), title, relative time ("2 h ago"), duration, format badge (9:16 / 16:9) and a status badge. |
| 3.2 | P1 | **Human status labels** with consistent badge colours: Draft · Generating · Rendering · Ready · Failed (today raw values like `draft`, `generating`). |
| 3.3 | P1 | **Search + filter** (status, format, date) and sort. |
| 3.4 | P1 | Row **context menu**: Rename (inline), Duplicate, Open output folder, Delete (with confirm). Today there is no rename/delete at all. |
| 3.5 | P1 | Better default names than `New Video 14:23:11`; prompt for a name or derive it from the script's first words. |
| 3.6 | P2 | Group by date (Today / This week / Older); virtualise list when large. |
| 3.7 | P2 | Don't auto-create a project on first load (`init()` calls `newVideo()` when empty) — show a welcoming **empty state** with "New video" and "Start with Agent" instead. |

## 4. Preview / player (centre)

| # | Pri | Change |
|---|-----|--------|
| 4.1 | P1 | **Custom player controls** under the video: play/pause, scrubber with hover time, `00:12 / 00:28` timecode, mute/volume, fullscreen, loop. Native `<video controls>` looks different per browser. |
| 4.2 | P0 | **Speed control is misleading.** It only changes browser playback (`playbackRate`), but sits next to Download and is sent with the download call — users will expect the exported MP4 to be faster. Either label it "Preview speed" and shrink it into the player's settings menu, or make it a real export option. Range is also 1×–2× only; add 0.5× / 0.75×. |
| 4.3 | P0 | **Video reloads on unrelated actions.** `renderPreview()` sets a new `?t=Date.now()` src every call (avatar change, aspect-ratio change, `renderAll`), restarting playback and defeating caching. Only change the src when the render actually changed (use `updatedAt` as the cache key). |
| 4.4 | P1 | **Rich processing state.** Replace "Generating video…" + spinner with a stage stepper (Script → Voice → Avatar → B-roll → Render → QA), progress bar, elapsed time and ETA ("usually 2–5 min"). The `#stepsEl` placeholder is never filled. |
| 4.5 | P1 | Format switch (9:16 / 16:9) as a **segmented control above the stage**, not hidden in the Advanced tab. |
| 4.6 | P1 | **Caption-line editing**: today it's hidden behind a double-click and a "drag the yellow line" badge. Add an explicit "Adjust caption position" toggle button, a labelled handle, safe-zone guides (Meta/TikTok UI overlays), and snap points. |
| 4.7 | P2 | Caption drag supports **mouse only** — add pointer/touch events and keyboard nudging (↑/↓). |
| 4.8 | P2 | Export menu: Download MP4, Copy file path, Open folder, and later "Export all variants". |
| 4.9 | P2 | **Version history** per project (each render kept with timestamp) and an A/B compare view. |
| 4.10 | P2 | Empty / no-avatar states as proper illustrated empty states with a clear next action. |

## 5. Inspector (right panel)

| # | Pri | Change |
|---|-----|--------|
| 5.1 | P1 | **Re-order tabs by workflow**: Script → Voice & Music → Captions → B-roll → Settings. The current default tab is Captions and Script is 4th, even though the script comes first. |
| 5.2 | P1 | Tabs as icon + label, with `role="tablist"`, `aria-selected` and arrow-key navigation. |
| 5.3 | P1 | Group controls into **titled sections/cards** with a short description, instead of a long flat list of uppercase 10px labels. |
| 5.4 | P1 | **Sliders with editable number inputs** (font size, position, volume, intro duration) plus a reset-to-default icon. |
| 5.5 | P1 | Replace checkboxes in `.toggle-row` with real **switches**; the whole row should toggle (today only the label/checkbox is clickable despite `cursor: pointer` on the row). |
| 5.6 | P1 | Avatar card: larger thumbnail, provider badge (HeyGen / Local), "Change" button instead of a `›` glyph. |

### Script tab
| # | Pri | Change |
|---|-----|--------|
| 5.7 | P1 | Character + word count and **estimated spoken duration** (e.g. "≈ 24 s at German speaking rate") with a warning outside 20–30 s. |
| 5.8 | P1 | Auto-growing editor with comfortable 14px text and line height; optional segment markers (Hook / Body / CTA). |
| 5.9 | P2 | "Improve with AI" / "Send to Agent" actions and a revision history of the script. |

### Captions tab
| # | Pri | Change |
|---|-----|--------|
| 5.10 | P1 | Presets as a **2-column visual gallery** on dark thumbnails, with a check mark on the active one; filter chips Word-by-word / Phrase. |
| 5.11 | P1 | Larger live preview using the actual sample text and position. |
| 5.12 | P2 | Favourite presets and "Set as default for new projects". |

### Audio tab
| # | Pri | Change |
|---|-----|--------|
| 5.13 | P1 | Track list with **inline play/pause** per track and a mini waveform; the current "Preview Track" button starts a new `Audio()` every click with no way to stop it. |
| 5.14 | P1 | Show voice settings (model, language, voice) as read-only info rows with a link to Settings, not as raw IDs in a yellow box. |
| 5.15 | P2 | Music ducking / fade-in-out controls. |

### B-roll tab
| # | Pri | Change |
|---|-----|--------|
| 5.16 | P1 | Settings visible (not hidden in a `<details>`); category as **chips**, search with clear button. |
| 5.17 | P1 | Clip cards with duration + orientation badge and **hover-to-play** preview; click opens the preview modal. |
| 5.18 | P2 | Pin / exclude specific clips per project; drag clips onto a timeline (later). |
| 5.19 | P2 | Move the full library to its own **Library** page with a larger grid. |

### Settings (was "Advanced") tab
| # | Pri | Change |
|---|-----|--------|
| 5.20 | P1 | Render info as a clean key/value list with copy buttons (project ID, output path, created/updated). |
| 5.21 | P2 | Re-check the default format: the product targets Meta vertical ads, but the editor defaults to 16:9. |

## 6. Primary actions (bottom of inspector)

| # | Pri | Change |
|---|-----|--------|
| 6.1 | P1 | **One clear primary action.** Today three stacked buttons (Create Local Preview / Create Avatar Video (HeyGen) / Apply Edits) plus explanatory paragraphs compete. Use a single primary "Render" **split button** whose menu offers Local preview · HeyGen avatar · Apply edits only, with the right default chosen from project state. |
| 6.2 | P1 | **Cost confirmation** before any action that spends credits (ElevenLabs / HeyGen / Claude): dialog showing what will be generated and that it uses credits; "don't ask again for local previews" option. |
| 6.3 | P1 | **Unsaved-changes indicator** ("Unsaved changes · Save") in the action bar. |
| 6.4 | P1 | Disabled buttons must say **why** (tooltip: "Choose an avatar first", "Render a video first", "B-roll library is empty"). |

## 7. Feedback, state & data safety

| # | Pri | Change |
|---|-----|--------|
| 7.1 | P0 | **Edits are not saved and can be lost.** Script, captions, music and settings live only in the in-memory `current` object until a render. Switching projects discards them, and the 5 s poll replaces `current` with the server copy during a render. Add debounced **autosave** (or explicit Save with a dirty state + "leave without saving?" guard). |
| 7.2 | P0 | **Silent failures.** `catch {}` swallows errors in download logging, caption-position save (`endDrag`) and polling. Surface them as toasts and retry polling with back-off + "connection lost" banner. |
| 7.3 | P1 | Replace the single `#msg` line at the bottom of the right panel with a **toast system** (success / warning / error, auto-dismiss, stackable) plus inline field errors. |
| 7.4 | P1 | **Skeleton loaders** for projects, presets, avatars, B-roll while loading; the app currently shows nothing until all 5 API calls finish. |
| 7.5 | P1 | Friendly **error page** instead of "Load error · Restart: pnpm dashboard", with a Retry button and details disclosure. |
| 7.6 | P1 | Confirm dialogs for destructive actions: Stop render, Cancel job, Delete project. |
| 7.7 | P2 | Optimistic UI updates where safe (rename, preset choice). |

## 8. Modals (Avatar picker, B-roll preview)

| # | Pri | Change |
|---|-----|--------|
| 8.1 | P0 | **Escape only closes the B-roll modal**, not the avatar modal. Add a shared modal component: `role="dialog"`, `aria-modal`, focus trap, focus return, Esc + backdrop close. |
| 8.2 | P1 | Light backdrop (`rgba(9,9,11,0.4)` + subtle blur) instead of 90% black; modal with 12px radius and large shadow; enter/exit animation (150 ms). |
| 8.3 | P1 | Avatar picker: filter chips (Gender, Talking-head 9:16, Recently used), larger cards with readable names (now 9px), hover zoom, selected check mark, skeletons while loading, numbered pagination or infinite scroll. Replace the inline `onerror` handler with a placeholder image. |
| 8.4 | P2 | Avatar "favourites" and "recently used" row on top. |
| 8.5 | P2 | B-roll preview modal: clip metadata (category, tags, duration, resolution), prev/next navigation. |

## 9. Agent Studio (`agent.js`)

| # | Pri | Change |
|---|-----|--------|
| 9.1 | P0 | **Queue re-render resets the UI.** Every 4 s poll that changes state rebuilds `#agentJobs` via `innerHTML`, collapsing open `<details>` and dropping focus/caret in a script textarea being edited. Patch cards by job ID (keyed update) or preserve open/focus state. |
| 9.2 | P0 | **Chat always jumps to the bottom** on every redraw, even if the user scrolled up to read. Only auto-scroll when already near the bottom or a new message arrives. |
| 9.3 | P1 | **Conversation sidebar** (list of chats with titles, dates, search, rename, delete) instead of a `<select>` dropdown. |
| 9.4 | P1 | Chat bubbles: user right-aligned, agent left with avatar icon, timestamps, Markdown rendering, copy button, "thinking…" indicator while a job is queued/running. |
| 9.5 | P1 | Composer: `Enter` to send / `Shift+Enter` newline, prompt suggestion chips on the welcome screen, duration as a segmented control (10 / 20 / 30 / 45 s), "Auto-produce" as a switch with explanation tooltip. |
| 9.6 | P1 | Job cards: **stage progress stepper** (Script → Voice → B-roll → Render → QA), status badge colours, attempt counter, relative time. Quality report as pass/warn/fail icons with a summary ("7/8 checks passed"). |
| 9.7 | P1 | Action hierarchy on job cards: Approve = primary, Open video = secondary, Retry = secondary, Cancel = danger-ghost with confirm. Today they all use `.header-button`. |
| 9.8 | P1 | Script-review step as a proper **review panel** (side-by-side script editor, estimated duration, "Approve & produce" CTA) rather than a textarea inside a `<details>`. |
| 9.9 | P2 | Queue filters (This chat / All, Status) and a "show more" instead of silently truncating at 30 jobs. |
| 9.10 | P2 | Inline video player inside the finished job card. |
| 9.11 | P2 | Worker status as a coloured dot + label ("Worker online") with last heartbeat time. |

## 10. Accessibility (enterprise baseline: WCAG 2.2 AA)

| # | Pri | Change |
|---|-----|--------|
| 10.1 | P1 | Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI borders/icons (current muted `#7a7a8c` and gold would fail on white). |
| 10.2 | P1 | All icon-only buttons get `aria-label`; speed `−`/`+` buttons, pager arrows, chevrons currently have none. |
| 10.3 | P1 | Project list items and avatar/preset cards are `<div onclick>` — make them `<button>`/`role="option"` so they're keyboard reachable. |
| 10.4 | P1 | Form controls have real `<label for>`; status updates use `aria-live` regions (toasts, render progress). |
| 10.5 | P2 | `prefers-reduced-motion` support for spinners/animations; minimum 32px hit targets (speed buttons are 26px). |

## 11. Motion & micro-interactions (premium feel)

| # | Pri | Change |
|---|-----|--------|
| 11.1 | P1 | Consistent 120–200 ms transitions with one easing curve on hover, press (`scale(0.98)`), tab switch, modal open, toast in/out. |
| 11.2 | P2 | Subtle success moment when a render finishes (toast + thumbnail fade-in), and progress bar animation instead of a bare spinner. |
| 11.3 | P2 | Hover-reveal secondary actions on list rows and cards to keep the UI calm. |

## 12. Code quality / architecture (so it's "properly done")

| # | Pri | Change |
|---|-----|--------|
| 12.1 | P1 | Split the 1300-line `index.html` into `styles/` (tokens, components, layout) and JS modules (`api.js`, `state.js`, `views/studio.js`, `views/agent.js`, `components/*.js`). |
| 12.2 | P1 | Recommended for enterprise level: migrate to **Vite + React + TypeScript + Tailwind + Radix/shadcn-ui**. Gives accessible dialogs/tabs/menus out of the box, keyed rendering (fixes 9.1/9.2), and typed API calls shared with `@ai-ads/core` schemas. Express keeps serving the built `dist/`. |
| 12.3 | P1 | One central state store with a `dirty` flag and a single polling/subscription service (today two independent pollers: 5 s for renders, 4 s for the agent). Consider Server-Sent Events for render + job progress. |
| 12.4 | P2 | Harden the `esc()` helpers (also escape `>` and `'`) or remove string-HTML templating entirely with the framework move. |
| 12.5 | P2 | Visual regression + Playwright smoke tests for the main flows (new video → local preview → download; agent brief → approve). |
| 12.6 | P3 | i18n-ready UI strings (UI is English, content German). |

---

## Suggested rollout

1. **Phase 1 — Fix P0s** (2.2, 4.2, 4.3, 7.1, 7.2, 8.1, 9.1, 9.2). Small, safe, immediately noticeable.
2. **Phase 2 — White design system** (section 1) + new app shell (section 2) applied to the existing markup.
3. **Phase 3 — Re-skin each area**: projects, player, inspector, actions, modals, Agent Studio (sections 3–9).
4. **Phase 4 — Enterprise polish**: accessibility audit, shortcuts, command palette, settings, version history, tests (sections 10–12).

If the React migration (12.2) is chosen, do it at the start of Phase 2 so the redesign is built once.
