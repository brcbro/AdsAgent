import type { Page } from "@playwright/test";

/*
 * In-browser fake of the dashboard API. Every /api request is answered here; anything without a
 * handler is recorded in `unexpected` and fails with 501, so a test can assert that the UI made
 * no request it didn't mean to (for example a render that would spend API credits).
 */

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export function fixtures() {
  const projects = [
    {
      id: "proj_ready", title: "Trading FOMO — Hook A", scriptDe: "Trading ohne System ist riskant. Lerne klare Regeln. Melde dich heute an.",
      introMs: 6000, avatarZoom: 1, aspectRatio: "9:16", outputSpeed: 1, fullAvatar: false, avatar: { heygenAvatarId: "", name: "Local waveform preview" },
      music: { enabled: true, volume: 0.25, file: "data/music/a.mp3" }, captions: { presetId: "meta-clean", fontSize: 32, bottomPercent: 18 },
      status: "done", createdAt: iso(120), updatedAt: iso(5), outputFile: "E:/video/proj_ready.mp4",
    },
    {
      id: "proj_draft", title: "Draft — Risk rules", scriptDe: "Drei Regeln für dein Risikomanagement.",
      introMs: 6000, avatarZoom: 1, aspectRatio: "9:16", avatar: { heygenAvatarId: "" },
      captions: { presetId: "meta-clean", fontSize: 32 }, status: "draft", createdAt: iso(300), updatedAt: iso(60),
    },
  ];
  const versions: Record<string, unknown[]> = {
    proj_ready: [
      { id: `v_${now - 60_000}`, createdAt: iso(1), file: "a.mp4", sizeBytes: 4_000_000,
        settings: { aspectRatio: "9:16", captions: { presetId: "meta-bold", fontSize: 40 }, music: { enabled: true, volume: 0.1 }, outputSpeed: 1.1, scriptDe: "Neu." } },
      { id: `v_${now - 3_600_000}`, createdAt: iso(60), file: "b.mp4", sizeBytes: 4_100_000,
        settings: { aspectRatio: "9:16", captions: { presetId: "meta-clean", fontSize: 32 }, music: { enabled: true, volume: 0.25 }, outputSpeed: 1, scriptDe: "Alt." } },
    ],
  };
  const agent = {
    workerRunning: true,
    sessions: [{
      id: "chat_2", title: "NVDA FOMO hook", createdAt: iso(30), messages: [{ role: "user", text: "Verpasster NVDA-Run", at: iso(30) }],
    }, {
      id: "chat_1", title: "Workday planning video", createdAt: iso(90),
      messages: [
        { role: "user", text: "Create a ten-second video about planning.", at: iso(90) },
        { role: "assistant", text: "Here is your **German** video.", at: iso(88) },
      ],
    }],
    jobs: [
      { id: "job_video", sessionId: "chat_1", projectId: "proj_ready", brief: "Planning video", title: "Planning video", targetSeconds: 10, autoProduce: true,
        status: "done", stage: "complete", createdAt: iso(90), updatedAt: iso(85), attempts: 1, events: [{ at: iso(90), text: "Worker started" }],
        quality: { passed: true, checkedAt: iso(85), durationSeconds: 9.8, checks: [{ name: "Decodes", result: "pass", detail: "ok" }] } },
      { id: "job_reply", sessionId: "chat_1", projectId: "agent_reply", brief: "Can I edit the script?", title: "Question about scripts", targetSeconds: 20, autoProduce: true,
        status: "done", stage: "complete", createdAt: iso(70), updatedAt: iso(69), attempts: 1, events: [{ at: iso(70), text: "Answered" }] },
      { id: "job_review", sessionId: "chat_2", projectId: "agent_review", brief: "Verpasster NVDA-Run", title: "NVDA FOMO", targetSeconds: 20, autoProduce: false,
        status: "script_review", stage: "voice", createdAt: iso(30), updatedAt: iso(29), attempts: 1, events: [{ at: iso(30), text: "Script ready for review" }],
        scriptDe: "Hast du den NVDA-Run verpasst? Dann kennst du das Gefühl. Hol dir jetzt den Plan.",
        rationale: "Opens loss-framed because that hook type ranks 1.6× above average in your account.", usedPatternIds: ["hook_type:loss_framed"] },
    ],
  };
  return { projects, versions, agent };
}

export interface ApiCall { method: string; path: string; body: unknown }

export async function mockApi(page: Page) {
  const data = fixtures();
  const calls: ApiCall[] = [];
  const unexpected: string[] = [];

  await page.route("**/data/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: unknown = undefined;
    try { body = request.postDataJSON(); } catch { body = request.postData(); }
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    const project = (id: string) => data.projects.find((p) => p.id === id);
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/api/projects") return json(data.projects);
    if (method === "GET" && (m = path.match(/^\/api\/projects\/([^/]+)$/))) {
      const p = project(m[1]);
      return p ? json(p) : json({ error: "Not found" }, 404);
    }
    if (method === "PUT" && (m = path.match(/^\/api\/projects\/([^/]+)\/metadata$/))) {
      const p = project(m[1]);
      if (!p) return json({ error: "Not found" }, 404);
      Object.assign(p, body as object, { updatedAt: new Date().toISOString() });
      return json(p);
    }
    if (method === "GET" && (m = path.match(/^\/api\/projects\/([^/]+)\/versions$/))) return json(data.versions[m[1]] ?? []);
    if (method === "POST" && path.endsWith("/download")) return json({ ok: true });
    if (method === "GET" && path.startsWith("/api/video/")) return route.fulfill({ status: 404, body: "" });
    if (method === "GET" && path.includes("/versions/") && path.endsWith("/video")) return route.fulfill({ status: 404, body: "" });
    if (method === "GET" && path === "/api/render-status") return json({ rendering: false });
    if (method === "GET" && path === "/api/caption-presets") {
      return json([
        { id: "meta-clean", name: "Meta Clean", fontFamily: "Arial", fontWeight: 600, fontSize: 32, color: "#fff", stroke: "none", shadow: "none", bottomPercent: 18, background: "rgba(0,0,0,.7)", mode: "phrase" },
        { id: "meta-bold", name: "Meta Bold", fontFamily: "Arial", fontWeight: 800, fontSize: 34, color: "#fff", stroke: "none", shadow: "none", bottomPercent: 20, mode: "word" },
      ]);
    }
    if (method === "GET" && path === "/api/music-tracks") {
      return json([{ file: "data/music/a.mp3", title: "Track A", artist: "Artist", available: true, previewUrl: "/data/music/a.mp3" }]);
    }
    if (method === "GET" && path === "/api/broll/catalog") {
      return json([
        { file: "/clips/Trading/chart.mp4", name: "trading_chart__x.mp4", preview: "", category: "Trading", tags: ["chart"], clipUrl: null, previewUrl: null },
        { file: "/clips/Lifestyle/beach.mp4", name: "beach_walk__y.mp4", preview: "", category: "Lifestyle", tags: ["beach"], clipUrl: null, previewUrl: null },
      ]);
    }
    if (method === "GET" && path === "/api/studio-config") {
      return json({ scriptModel: "claude-test", voiceModel: "eleven_test", voiceLanguage: "German (de)", llmProvider: "anthropic",
        outputFolder: "video/test", services: { scripts: true, voice: true, avatar: true } });
    }
    if (method === "GET" && path === "/api/avatars") return json({ avatars: [{ avatar_id: "av_1", avatar_name: "Anna Office", gender: "female" }], total: 1, page: 1, limit: 48, pages: 1 });
    if (method === "GET" && path === "/api/agent/state") return json(data.agent);
    if (method === "GET" && path === "/api/performance/overview") {
      const ad = (id: string, name: string, projectId?: string) => ({ id, accountId: "meta:1", platform: "meta", externalId: id.split(":")[1], name, campaignName: "Trading DE", projectId, variantKey: projectId ? "h1_c1_9x16" : undefined, firstSeen: "2026-10-01", lastSeen: "2026-10-30" });
      const score = (adId: string, over: Record<string, unknown>) => ({ adId, windowDays: 30, impressions: 40_000, spend: 600, hookRate: 0.25, holdRate: 0.3, ctr: 0.015, cpc: 1, cpa: 30, roas: 2.5, completionRate: 0.1, score: 0, percentile: 0.5, isWinner: false, isLoser: false, isFatigued: false, confidence: "high", computedAt: "2026-10-30T00:00:00Z", ...over });
      return json({
        accounts: [{ id: "meta:1", platform: "meta", externalId: "1", name: "Meta (CSV import)", status: "csv", lastSyncAt: "2026-10-30T08:00:00Z" }],
        leaderboard: [
          { ...score("meta:1", { score: 1.2, percentile: 1, isWinner: true, hookRate: 0.38 }), ad: ad("meta:1", "proj_1_h1_c1_9x16", "proj_1"), projectTitle: "Workday planning" },
          { ...score("meta:2", { score: -1.1, percentile: 0, isLoser: true, hookRate: 0.11 }), ad: ad("meta:2", "Old creative") },
          { ...score("meta:3", { score: 0.1, confidence: "low", impressions: 300, spend: 4 }), ad: ad("meta:3", "Tiny test") },
        ],
        imports: [{ file: "meta-october.csv", platform: "meta", rows: 90, importedAt: "2026-10-30T08:00:00Z" }],
        inbox: { dir: "data/performance/inbox", files: ["meta-october.csv"] }, latestMetricDate: "2026-10-30",
        projects: [{ id: "proj_1", title: "Workday planning" }], syncing: false,
        meta: { configured: true, accountIds: ["123"], apiVersion: "v21.0", conversionActions: ["purchase"] },
        google: { configured: true, customerIds: ["1234567890"], apiVersion: "v19", loginCustomerId: "9999999999" },
        normalization: { balanced: true, notes: ["Scores are ranked within each platform and account; compare percentiles and flags across platforms, never raw hook rates."], platforms: [
          { platform: "meta", accounts: 1, ads: 3, eligible: 2, winners: 1, losers: 1, fatigued: 0, spend: 1204, meanHookRate: 0.247, meanHoldRate: 0.3, meanCtr: 0.015, meanCpa: 30, meanPercentile: 0.5, hookRateNote: "3-second plays ÷ impressions", holdRateNote: "ThruPlays ÷ 3-second plays" },
        ] },
        nightly: { enabled: true, hour: 3, lastRun: "2026-10-30", lastResult: "ok" },
        teardown: { llmConfigured: true, auto: true, maxPerRun: 10, running: false, whisper: false, creativesDir: "data/performance/creatives", competitorsDir: "data/performance/competitors", counts: { done: 6, needsTranscript: 1, errors: 0, competitors: 1 } },
        patternsUpdatedAt: "2026-10-30T08:05:00Z", openSuggestions: 3,
      });
    }
    if (method === "GET" && path === "/api/performance/suggestions") {
      const status = (url.searchParams.get("status") ?? "open,accepted").split(",");
      const kinds = url.searchParams.get("kind")?.split(",");
      const projectId = url.searchParams.get("projectId");
      const base = { patternIds: [] as string[], exampleAdIds: [] as string[], score: 1, status: "open" as const, createdAt: "2026-10-30T08:05:00Z" };
      const all = projectId
        ? projectId === "proj_ready" ? [
            { ...base, id: "variant_1", kind: "variant_to_render", projectId, title: "Push variant h1_c1_9x16", body: "Of 2 linked variants, h1_c1_9x16 ranks highest (hook 38.0%, CTR 2.1%).", rationale: "Percentile 100% vs 20% in the account", exampleAdIds: ["meta:1", "meta:2"] },
            { ...base, id: "pacing_1", kind: "pacing", projectId, title: "Cut faster: winners average more B-roll cuts", body: "This project has 1 cuts per 10 s; the 4 winning ads average 5.0.", rationale: "Winners' mean pacing 5.0 cuts/10 s" },
          ] : []
        : [
            { ...base, id: "scale_1", kind: "ad_to_scale", projectId: "proj_1", title: 'Scale "proj_1_h1_c1_9x16"', body: "Top of its account on the composite score with high confidence.", rationale: "hook rate 38.0% vs 21.0% · CPA €14.00 vs €31.00 · €600 spend", exampleAdIds: ["meta:1"] },
            { ...base, id: "kill_1", kind: "ad_to_kill", title: 'Pause "Old creative"', body: "Bottom of its account over 30 days with €600 already spent.", rationale: "hook rate 11.0% vs 21.0%", exampleAdIds: ["meta:2"], status: "dismissed" as const },
            { ...base, id: "refresh_1", kind: "refresh_hook", title: 'Refresh the hook of "Tired ad"', body: "Still a winner but fading.", rationale: "hook rate 20.0% vs 21.0%", exampleAdIds: ["meta:3"], status: "accepted" as const, acceptedAt: "2026-10-20T00:00:00Z",
              outcome: { status: "improved", summary: "hook 20.0% → 26.0% · CTR 1.0% → 1.2% · CPA -5% since 2026-10-20", measuredAt: "2026-10-30T08:05:00Z", adIds: ["meta:3"] } },
            { ...base, id: "hook_1", kind: "hook", title: "Open with a loss framed hook", body: "Like „Hast du den NVDA-Run verpasst?“ — same mechanism, new angle or ticker.", rationale: 'Hook type "loss_framed" ranks 1.6× higher than average (n=6, 50% winners).', patternIds: ["hook_type:loss_framed"] },
            { ...base, id: "angle_1", kind: "angle", title: 'Lead with the "fomo" angle', body: "Frame the whole ad around fomo; it ranks 1.5× above average.", rationale: 'Angle "fomo" ranks 1.5×', patternIds: ["angle:fomo"] },
          ];
      return json({ suggestions: all.filter((s) => status.includes(s.status) && (!kinds || kinds.includes(s.kind))) });
    }
    if (method === "POST" && (m = path.match(/^\/api\/performance\/suggestions\/([^/]+)\/(accept|dismiss|reopen)$/))) return json({ ok: true });
    if (method === "GET" && path === "/api/performance/briefings") {
      return json({ briefings: [{
        id: "kb_2026_10_30_01_verpasste_chancen", angle: "Verpasste Chancen: Der Markt wartet nicht", persona: "Männer 25–45, angestellt, konsumieren Finfluencer-Content", painPoint: "Sieht andere verdienen", promise: "System statt Bauchgefühl", tone: "Direkt",
        visualDirection: ["Charts", "Laptop"], hookConcepts: ["Loss-Frame Frage: Wie viel hat dich dein Zögern gekostet?", "Call-out: Wenn du seit Monaten nur zuschaust…"], bodyConcept: "Regeln statt raten.", ctaConcepts: ["Kostenloses Erstgespräch"],
        source: "meta-analysis", usedPatternIds: ["hook_type:loss_framed"], file: "data/briefings/kb_2026_10_30_01_verpasste_chancen.json", createdAt: "2026-10-30T09:00:00Z",
      }] });
    }
    if (method === "POST" && path === "/api/performance/briefings") {
      const count = (body as { count?: number }).count ?? 3;
      return json({ generated: Array.from({ length: count }, (_, i) => ({ file: `data/briefings/kb_2026_10_30_0${i + 2}_x.json`, id: `kb_${i}`, angle: `Angle ${i + 1}`, hookConcepts: ["h"], usedPatternIds: [] })) });
    }
    if (method === "GET" && path === "/api/performance/patterns") {
      return json({
        updatedAt: "2026-10-30T08:05:00Z", promptBlock: "<winning_patterns>\n- [hook_type:loss_framed] …\n</winning_patterns>",
        hooks: [{ adId: "meta:1", adName: "proj_1_h1_c1_9x16", hookText: "Hast du den NVDA-Run verpasst?", hookType: "loss_framed", percentile: 1 }],
        patterns: [
          { id: "hook_type:loss_framed", dimension: "hook_type", value: "loss_framed", sampleSize: 6, winnerShare: 0.5, lift: 1.6, hookLift: 1.4, direction: "positive", evidence: [{ adId: "meta:1", adName: "proj_1_h1_c1_9x16", percentile: 1, hookText: "Hast du den NVDA-Run verpasst?", isWinner: true }], summaryEn: 'Hook type "loss_framed" ranks 1.6× higher than average · 1.4× hook rate (n=6, 50% winners).', summaryDe: "…", updatedAt: "2026-10-30T08:05:00Z", disabled: false },
          { id: "hook_type:bold_claim", dimension: "hook_type", value: "bold_claim", sampleSize: 6, winnerShare: 0, lift: 0.4, direction: "negative", evidence: [], summaryEn: 'Hook type "bold_claim" ranks below average (0.4×) (n=6); avoid unless the brief demands it.', summaryDe: "…", updatedAt: "2026-10-30T08:05:00Z", disabled: true },
        ],
      });
    }
    if (method === "POST" && (m = path.match(/^\/api\/performance\/patterns\/([^/]+)\/toggle$/))) return json({ ok: true, disabled: (body as { disabled?: boolean }).disabled !== false });
    if (method === "GET" && (m = path.match(/^\/api\/performance\/ads\/([^/]+)\/teardown$/))) {
      if (m[1] !== "meta%3A1" && m[1] !== "meta:1") return json({ error: "No teardown yet" }, 404);
      return json({
        adId: "meta:1", source: "own", status: "done", adName: "proj_1_h1_c1_9x16", projectId: "proj_1", transcriptDe: "Hast du den NVDA-Run verpasst? Dann kennst du das Gefühl. Hol dir den Plan.",
        structure: { hookText: "Hast du den NVDA-Run verpasst?", bodyText: "Dann kennst du das Gefühl.", ctaText: "Hol dir den Plan.", hookType: "loss_framed", angle: "fomo", persona: "beginner", emotionalTrigger: "fear", claimStructure: "promise", ctaStyle: "direct", addressForm: "du", usesNumbers: false, hookNote: "Loss framing with a concrete ticker." },
        visual: { visualStyle: "mixed", cutsPer10s: 4, hasTextOverlay: true, musicEnergy: "medium", durationS: 28 }, model: "claude-test", createdAt: "2026-10-30T08:00:00Z", updatedAt: "2026-10-30T08:00:00Z",
      });
    }
    if (method === "POST" && path === "/api/performance/teardowns/run") {
      const ids = (body as { adIds?: string[] }).adIds;
      return json({ candidates: ids?.length ?? 4, done: ids?.length ?? 3, needsTranscript: ids ? 0 : 1, errors: 0, skipped: 0, llmCalls: ids?.length ?? 3, patterns: 2, items: (ids ?? ["meta:1"]).map((adId) => ({ adId, status: "done" })) });
    }
    if (method === "GET" && (m = path.match(/^\/api\/performance\/ads\/([^/]+)\/series$/))) {
      return json({ ad: { id: m[1] }, series: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-2${i + 1}`, impressions: 1000, spend: 20, hookRate: 0.2 + i * 0.02, ctr: 0.01 })) });
    }
    if (method === "GET" && path === "/api/performance/projects") return json({ proj_ready: { ads: 2, winners: 1, fatigued: 0, spend: 1234.5, impressions: 80_000, bestHookRate: 0.38, bestCtr: 0.021, bestVariantKey: "h1_c1_9x16" } });
    if (method === "POST" && path === "/api/performance/settings") return json({ ok: true, nightlyEnabled: (body as { nightlyEnabled?: boolean }).nightlyEnabled ?? true });
    if (method === "POST" && path === "/api/performance/sync") return json({ files: [{ file: "meta-october.csv", status: "unchanged" }], accounts: [], adsScored: 3, winners: 1, losers: 1, fatigued: 0, linked: 1, at: "2026-10-30T09:00:00Z" });
    if (method === "POST" && (m = path.match(/^\/api\/performance\/ads\/([^/]+)\/link$/))) return json({ ok: true, ad: { id: m[1], projectId: (body as { projectId?: string }).projectId } });

    unexpected.push(`${method} ${path}`);
    return json({ error: `Not mocked: ${method} ${path}` }, 501);
  });

  return { data, calls, unexpected };
}
