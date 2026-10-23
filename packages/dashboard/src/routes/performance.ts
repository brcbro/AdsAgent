import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { ADS_DIR, REPO_ROOT } from "@ai-ads/core";
import {
  COMPETITORS_DIR, CREATIVES_DIR, ENV_CONNECTION_ID, GoogleAdsAdapter, INBOX_DIR, MetaAdapter, PerformanceStore, googleConfigFromEnv, loadKbForPrompt,
  evaluateOutcomes, metaAdapters, metaConfigFor, metaConnections, normalizationReport, normalizeConnectionInput, projectSuggestionsFor, redactConnection,
  refreshSuggestions, runTeardowns, snapshotFor, startNightlySync, syncAll, winningHooks,
  type AdScore, type MetaConnectionInput, type PlatformAd, type SuggestionKind, type SyncReport, type TeardownReport,
} from "@ai-ads/performance";
import { generateAndSaveBriefings, listKbBriefings } from "../../../pipeline/src/briefings-from-kb.js";
import { llmConfigured, teardownDeps } from "../teardown-deps.js";

export interface LeaderboardRow extends AdScore {
  ad: PlatformAd;
  projectTitle?: string;
}

function projectTitles(): Map<string, string> {
  const titles = new Map<string, string>();
  try {
    for (const dir of fs.readdirSync(ADS_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(ADS_DIR, dir.name, "metadata.json"), "utf8")) as { title?: string };
        titles.set(dir.name, meta.title ?? dir.name);
      } catch { titles.set(dir.name, dir.name); }
    }
  } catch { /* no projects yet */ }
  return titles;
}

function countTeardowns(store: PerformanceStore) {
  const counts = { done: 0, needsTranscript: 0, errors: 0, competitors: 0 };
  for (const t of store.teardowns()) {
    if (t.source === "competitor") counts.competitors++;
    if (t.status === "done") counts.done++; else if (t.status === "needs_transcript") counts.needsTranscript++; else counts.errors++;
  }
  return counts;
}

/** Ad performance: CSV inbox + Meta Marketing API sync (manual and nightly), leaderboard, manual project links, teardowns and the patterns KB. */
export function registerPerformanceRoutes(app: express.Express): { close: () => void } {
  const store = new PerformanceStore();
  // Meta connections are read on every sync, so one added in the dashboard is picked up without a restart.
  const connections = () => metaConnections(store);
  const googleConfig = googleConfigFromEnv();
  const google = googleConfig ? new GoogleAdsAdapter(googleConfig) : undefined;
  let current: Promise<SyncReport> | undefined;
  let lastReport: SyncReport | undefined;
  let teardownCurrent: Promise<TeardownReport> | undefined;
  let lastTeardown: TeardownReport | undefined;
  const deps = teardownDeps();

  const runTeardown = (adIds?: string[]) => {
    if (teardownCurrent) return teardownCurrent;
    const maxLlmCalls = Number(store.setting("teardownMaxPerRun", "10")) || 10;
    teardownCurrent = runTeardowns(store, deps, { adIds, maxLlmCalls }).then((r) => { lastTeardown = r; return r; }).finally(() => { teardownCurrent = undefined; });
    return teardownCurrent;
  };
  const runSync = () => {
    if (current) return current;
    current = syncAll(store, { adapters: metaAdapters(store), google }).then((r) => {
      lastReport = r;
      // Teardowns spend LLM credits, so they run after the sync response and only when a provider key exists.
      if (store.setting("teardownAuto", "1") === "1" && llmConfigured()) void runTeardown().catch(() => {});
      return r;
    }).finally(() => { current = undefined; });
    return current;
  };
  const nightly = startNightlySync(store, runSync);
  const metaOverview = () => {
    const all = connections();
    const enabled = all.filter((c) => c.enabled);
    return {
      configured: enabled.length > 0,
      connections: all.map(redactConnection),
      accountIds: [...new Set(enabled.flatMap((c) => c.accountIds))],
      apiVersion: enabled[0] ? metaConfigFor(enabled[0]).apiVersion : undefined,
      conversionActions: enabled[0] ? metaConfigFor(enabled[0]).conversionActions : [],
    };
  };

  /* ---- Meta connections: one token + its ad accounts per business, managed from the dashboard ---- */
  app.get("/api/performance/connections", (_req, res) => { res.json({ connections: connections().map(redactConnection) }); });

  app.post("/api/performance/connections", (req, res) => {
    try {
      const c = normalizeConnectionInput((req.body ?? {}) as MetaConnectionInput);
      store.saveConnection(c);
      res.json({ ok: true, connection: redactConnection(c) });
    } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.put("/api/performance/connections/:id", (req, res) => {
    const id = req.params.id;
    if (id === ENV_CONNECTION_ID) { res.status(400).json({ error: "This connection comes from .env; edit the file and restart the dashboard" }); return; }
    const existing = connections().find((c) => c.id === id);
    if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }
    try {
      const c = normalizeConnectionInput((req.body ?? {}) as MetaConnectionInput, existing);
      store.saveConnection(c);
      res.json({ ok: true, connection: redactConnection(c) });
    } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.delete("/api/performance/connections/:id", (req, res) => {
    const id = req.params.id;
    if (id === ENV_CONNECTION_ID) { res.status(400).json({ error: "Remove META_ACCESS_TOKEN from .env to drop this connection" }); return; }
    if (!store.deleteConnection(id)) { res.status(404).json({ error: "Connection not found" }); return; }
    res.json({ ok: true });
  });

  /** Lists the ad accounts a token can read. Body: the form values; `id` alone (or with a blank token) tests the saved token. */
  app.post("/api/performance/connections/test", async (req, res) => {
    const body = (req.body ?? {}) as MetaConnectionInput & { id?: string };
    const existing = body.id ? connections().find((c) => c.id === body.id) : undefined;
    try {
      const c = normalizeConnectionInput({ ...body, label: body.label || existing?.label || "Test" }, existing);
      const accounts = await new MetaAdapter(metaConfigFor(c)).listAccounts();
      res.json({ ok: true, accounts: accounts.map((a) => ({ id: a.externalId, name: a.name, currency: a.currency, timezone: a.timezone })) });
    } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.get("/api/performance/overview", (_req, res) => {
    const titles = projectTitles();
    const adsById = new Map(store.ads().map((a) => [a.id, a]));
    const leaderboard: LeaderboardRow[] = store.scores().flatMap((s) => {
      const ad = adsById.get(s.adId);
      return ad ? [{ ...s, ad, projectTitle: ad.projectId ? titles.get(ad.projectId) : undefined }] : [];
    });
    let inboxFiles: string[] = [];
    try { inboxFiles = fs.readdirSync(INBOX_DIR).filter((f) => /\.(csv|tsv)$/i.test(f)); } catch { /* inbox not created yet */ }
    res.json({
      accounts: store.accounts(),
      leaderboard,
      imports: store.imports(),
      inbox: { dir: path.relative(REPO_ROOT, INBOX_DIR).replace(/\\/g, "/"), files: inboxFiles },
      latestMetricDate: store.latestMetricDate(),
      projects: [...titles.entries()].map(([id, title]) => ({ id, title })),
      syncing: !!current,
      meta: metaOverview(),
      google: {
        configured: !!googleConfig,
        customerIds: googleConfig?.customerIds ?? [],
        apiVersion: googleConfig?.apiVersion,
        loginCustomerId: googleConfig?.loginCustomerId,
      },
      normalization: normalizationReport(store.scores(), store.ads()),
      nightly: {
        enabled: store.setting("nightlyEnabled", "1") === "1",
        hour: 3,
        lastRun: store.setting("nightlyLastRun"),
        lastResult: store.setting("nightlyLastResult"),
      },
      lastReport,
      teardown: {
        llmConfigured: llmConfigured(),
        auto: store.setting("teardownAuto", "1") === "1",
        maxPerRun: Number(store.setting("teardownMaxPerRun", "10")) || 10,
        running: !!teardownCurrent,
        whisper: !!process.env.WHISPER_CMD?.trim(),
        creativesDir: path.relative(REPO_ROOT, CREATIVES_DIR).replace(/\\/g, "/"),
        competitorsDir: path.relative(REPO_ROOT, COMPETITORS_DIR).replace(/\\/g, "/"),
        counts: countTeardowns(store),
        last: lastTeardown,
      },
      patternsUpdatedAt: store.setting("patternsUpdatedAt"),
      openSuggestions: store.suggestions({ projectId: null, status: ["open"] }).length,
    });
  });

  app.get("/api/performance/patterns", (_req, res) => {
    const disabled = store.disabledPatternIds();
    res.json({
      patterns: store.patterns().map((p) => ({ ...p, disabled: disabled.has(p.id) })),
      hooks: winningHooks(store.teardowns(), store.scores(), 5),
      updatedAt: store.setting("patternsUpdatedAt"),
      promptBlock: loadKbForPrompt(store),
    });
  });

  app.post("/api/performance/patterns/:id/toggle", (req, res) => {
    const id = req.params.id;
    if (!store.patterns().some((p) => p.id === id)) { res.status(404).json({ error: "Pattern not found" }); return; }
    store.setPatternDisabled(id, req.body?.disabled !== false);
    res.json({ ok: true, disabled: store.disabledPatternIds().has(id) });
  });

  /** ?projectId=… computes and persists that project's final-review suggestions; without it, account + brief suggestions. */
  app.get("/api/performance/suggestions", (req, res) => {
    const projectId = typeof req.query.projectId === "string" && req.query.projectId.trim() ? req.query.projectId.trim() : undefined;
    const kinds = typeof req.query.kind === "string" && req.query.kind ? (req.query.kind.split(",") as SuggestionKind[]) : undefined;
    const status: Array<"open" | "accepted" | "dismissed"> = typeof req.query.status === "string" && req.query.status ? (req.query.status.split(",") as Array<"open" | "accepted" | "dismissed">) : ["open", "accepted"];
    if (projectId) {
      if (!fs.existsSync(path.join(ADS_DIR, projectId))) { res.status(404).json({ error: "Unknown project" }); return; }
      const list = projectSuggestionsFor(store, projectId).filter((s) => status.includes(s.status) && (!kinds || kinds.includes(s.kind)));
      res.json({ suggestions: list });
      return;
    }
    res.json({ suggestions: store.suggestions({ projectId: null, kind: kinds, status }) });
  });

  app.post("/api/performance/suggestions/:id/:action", (req, res) => {
    const action = req.params.action;
    if (action !== "accept" && action !== "dismiss" && action !== "reopen") { res.status(404).json({ error: "Unknown action" }); return; }
    try {
      if (action === "accept") {
        // Snapshot the cited ad's KPIs so the outcome can be measured against them later.
        const s = store.suggestions().find((x) => x.id === req.params.id);
        const at = new Date().toISOString();
        const cited = s?.exampleAdIds[0] ? store.scores().find((sc) => sc.adId === s.exampleAdIds[0]) : undefined;
        store.setSuggestionStatus(req.params.id, "accepted", { at, snapshot: snapshotFor(cited, at) });
        evaluateOutcomes(store, at);
      } else store.setSuggestionStatus(req.params.id, action === "dismiss" ? "dismissed" : "open");
      res.json({ ok: true });
    } catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  /** KB-driven briefings: one LLM call writes `count` briefing files into data/briefings/. */
  app.get("/api/performance/briefings", (_req, res) => { res.json({ briefings: listKbBriefings() }); });
  app.post("/api/performance/briefings", async (req, res) => {
    if (!llmConfigured()) { res.status(400).json({ error: "No LLM key configured (ANTHROPIC_API_KEY or OPENROUTER_API_KEY)" }); return; }
    const count = Math.max(1, Math.min(10, Number(req.body?.count) || 3));
    const context = typeof req.body?.context === "string" && req.body.context.trim() ? req.body.context.trim().slice(0, 1000) : undefined;
    try {
      const out = await generateAndSaveBriefings(count, context);
      res.json({ generated: out.map(({ file, briefing }) => ({ file: path.relative(REPO_ROOT, file).replace(/\\/g, "/"), id: briefing.id, angle: briefing.angle, hookConcepts: briefing.hookConcepts, usedPatternIds: briefing.usedPatternIds })) });
    } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post("/api/performance/suggestions/refresh", (_req, res) => { res.json(refreshSuggestions(store)); });

  app.get("/api/performance/ads/:id/teardown", (req, res) => {
    const t = store.teardown(req.params.id);
    if (!t) { res.status(404).json({ error: "No teardown yet" }); return; }
    res.json(t);
  });

  app.post("/api/performance/teardowns/run", async (req, res) => {
    if (!llmConfigured()) { res.status(400).json({ error: "No LLM key configured (ANTHROPIC_API_KEY or OPENROUTER_API_KEY)" }); return; }
    if (teardownCurrent) { res.status(409).json({ error: "Teardowns are already running" }); return; }
    const adIds = Array.isArray(req.body?.adIds) ? req.body.adIds.filter((x: unknown) => typeof x === "string") : undefined;
    try { res.json(await runTeardown(adIds)); }
    catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.get("/api/performance/projects", (_req, res) => { res.json(store.projectSummaries()); });

  app.get("/api/performance/ads/:id/series", (req, res) => {
    const ad = store.ad(req.params.id);
    if (!ad) { res.status(404).json({ error: "Ad not found" }); return; }
    res.json({ ad, series: store.dailySeries(ad.id, 30) });
  });

  app.post("/api/performance/sync", async (_req, res) => {
    if (current) { res.status(409).json({ error: "A sync is already running" }); return; }
    try { res.json(await runSync()); }
    catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post("/api/performance/settings", (req, res) => {
    if (typeof req.body?.nightlyEnabled === "boolean") store.setSetting("nightlyEnabled", req.body.nightlyEnabled ? "1" : "0");
    if (typeof req.body?.teardownAuto === "boolean") store.setSetting("teardownAuto", req.body.teardownAuto ? "1" : "0");
    if (typeof req.body?.teardownMaxPerRun === "number" && req.body.teardownMaxPerRun >= 0 && req.body.teardownMaxPerRun <= 500) store.setSetting("teardownMaxPerRun", String(Math.round(req.body.teardownMaxPerRun)));
    res.json({
      ok: true, nightlyEnabled: store.setting("nightlyEnabled", "1") === "1",
      teardownAuto: store.setting("teardownAuto", "1") === "1", teardownMaxPerRun: Number(store.setting("teardownMaxPerRun", "10")) || 10,
    });
  });

  app.post("/api/performance/ads/:id/link", (req, res) => {
    const projectId = typeof req.body?.projectId === "string" && req.body.projectId.trim() ? req.body.projectId.trim() : null;
    if (projectId && !fs.existsSync(path.join(ADS_DIR, projectId))) { res.status(400).json({ error: "Unknown project" }); return; }
    try {
      store.linkAdToProject(req.params.id, projectId, typeof req.body?.variantKey === "string" ? req.body.variantKey : null);
      res.json({ ok: true, ad: store.ad(req.params.id) });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return { close: () => { nightly.stop(); store.close(); } };
}
