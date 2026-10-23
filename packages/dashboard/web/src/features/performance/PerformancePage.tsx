import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BarChart3, FolderInput, KeyRound, Link2, RefreshCw, TrendingDown, Trophy } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { cn, relativeTime } from "@/lib/format";
import { keys, useAdSeries, usePerformance, useTeardown } from "@/lib/queries";
import { PatternsSection } from "./PatternsSection";
import { SuggestionsSection } from "./SuggestionsSection";
import { BriefingsSection } from "./BriefingsSection";
import { MetaConnectionsDialog } from "./MetaConnectionsDialog";
import type { AdPlatform, LeaderboardRow, NormalizationReport, PerformanceOverview, SyncReport, Teardown } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, Segmented, Select, Skeleton, Switch } from "@/components/ui/primitives";

type SortKey = "score" | "spend" | "impressions" | "hookRate" | "holdRate" | "ctr" | "cpa" | "roas";
type Filter = "all" | "winners" | "losers" | "fatigued" | "linked";

const pct = (v?: number) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const money = (v?: number, digits = 0) => (v === undefined ? "—" : `€${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
const int = (v?: number) => (v === undefined ? "—" : v.toLocaleString());
const PLATFORM_LABEL: Record<AdPlatform, string> = { meta: "Meta", google: "Google" };

export default function PerformancePage() {
  const overview = usePerformance();
  const client = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [platform, setPlatform] = useState<"all" | AdPlatform>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "score", dir: "desc" });
  const [selected, setSelected] = useState<LeaderboardRow | null>(null);

  const rows = useMemo(() => {
    const all = overview.data?.leaderboard ?? [];
    const filtered = all.filter((r) =>
      (platform === "all" || r.ad.platform === platform)
      && (filter === "all" || (filter === "winners" && r.isWinner) || (filter === "losers" && r.isLoser) || (filter === "fatigued" && r.isFatigued) || (filter === "linked" && !!r.ad.projectId)));
    const sign = sort.dir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return (av - bv) * sign;
    });
  }, [overview.data, filter, platform, sort]);

  async function sync() {
    setSyncing(true);
    try {
      const report = await api.performanceSync();
      await client.invalidateQueries({ queryKey: keys.performance });
      const imported = report.files.filter((f) => f.status === "imported");
      const errors = report.files.filter((f) => f.status === "error");
      const synced = report.accounts.filter((a) => a.status === "synced");
      const accountErrors = report.accounts.filter((a) => a.status === "error");
      const warnings = imported.flatMap((f) => (f.warnings ?? []).map((w) => `${f.file}: ${w}`));
      const summary = `${report.adsScored} ads scored · ${report.winners} winners · ${report.losers} losers${warnings.length ? `\n${warnings.join("\n")}` : ""}`;
      if (errors.length) toast.error(`${errors.length} file${errors.length > 1 ? "s" : ""} could not be imported`, { description: errors.map((f) => `${f.file}: ${f.error}`).join("\n") });
      const who = (a: SyncReport["accounts"][number]) => `${a.connectionLabel ? `${a.connectionLabel} · ` : ""}${a.name}`;
      if (accountErrors.length) toast.error(`Sync failed for ${accountErrors.map(who).join(", ")}`, { description: accountErrors.map((a) => a.error).join("\n") });
      if (synced.length) toast.success(`Synced ${synced.map((a) => `${who(a)} ${a.from} → ${a.to}`).join(", ")}`, { description: summary });
      else if (imported.length) toast.success(`${imported.length} file${imported.length > 1 ? "s" : ""} imported`, { description: summary });
      else if (!errors.length && !accountErrors.length) toast.info(report.adsScored ? `Nothing new. ${report.adsScored} ads re-scored.` : "No CSV files in the inbox and no Meta account configured.");
    } catch (err) { toast.error("Sync failed", { description: errorMessage(err) }); }
    finally { setSyncing(false); }
  }

  const d = overview.data;
  const counts = useMemo(() => {
    const all = d?.leaderboard ?? [];
    return { winners: all.filter((r) => r.isWinner).length, losers: all.filter((r) => r.isLoser).length, fatigued: all.filter((r) => r.isFatigued).length, linked: all.filter((r) => r.ad.projectId).length };
  }, [d]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Performance</h1>
            <p className="mt-1 text-sm text-fg-muted">Which ads win on Meta and Google, so the next brief starts from what already works.</p>
          </div>
          <Button variant="primary" loading={syncing} onClick={sync} data-testid="perf-sync"><RefreshCw /> Sync now</Button>
        </header>

        {overview.isPending ? <Skeleton className="h-28" /> : d && <Sources data={d} />}
        {d && d.normalization.platforms.length > 0 && <PlatformStrip report={d.normalization} />}

        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-fg">Leaderboard <span className="font-normal text-fg-muted">· last 30 days{d?.latestMetricDate ? ` to ${d.latestMetricDate}` : ""}</span></h2>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<"all" | AdPlatform> label="Platform" size="sm" value={platform} onChange={setPlatform}
                options={[{ value: "all", label: "All" }, { value: "meta", label: "Meta" }, { value: "google", label: "Google" }]} />
              <Segmented<Filter> label="Show" size="sm" value={filter} onChange={setFilter} options={[
                { value: "all", label: "All" },
                { value: "winners", label: `Winners${counts.winners ? ` ${counts.winners}` : ""}` },
                { value: "losers", label: `Losers${counts.losers ? ` ${counts.losers}` : ""}` },
                { value: "fatigued", label: `Fatigued${counts.fatigued ? ` ${counts.fatigued}` : ""}` },
                { value: "linked", label: `Linked${counts.linked ? ` ${counts.linked}` : ""}` },
              ]} />
            </div>
          </div>

          {overview.isPending ? (
            <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !d?.leaderboard.length ? (
            <EmptyState icon={<BarChart3 />} title="No ad data yet"
              description={`Export a daily ad report from Meta Ads Manager or Google Ads as CSV into ${d?.inbox.dir ?? "data/performance/inbox"}, then click Sync now.`}
              action={<Button variant="primary" loading={syncing} onClick={sync}><RefreshCw /> Sync now</Button>} />
          ) : !rows.length ? (
            <EmptyState icon={<Trophy />} title="Nothing matches this filter" description="Winners and losers need at least 1,000 impressions and €20 spend in the window." />
          ) : (
            <Leaderboard rows={rows} sort={sort} onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))} onOpen={setSelected} />
          )}
        </section>

        {d && !!d.leaderboard.length && <SuggestionsSection />}
        {d && !!d.leaderboard.length && <BriefingsSection llmConfigured={d.teardown.llmConfigured} />}
        {d && !!d.leaderboard.length && (
          <PatternsSection teardown={d.teardown} onRun={async () => {
            try {
              const r = await api.runTeardowns();
              await client.invalidateQueries({ queryKey: keys.performance });
              const skipped = r.skipped ? ` · ${r.skipped} skipped by the ${d.teardown.maxPerRun}-call cap` : "";
              const missing = r.needsTranscript ? ` · ${r.needsTranscript} need a transcript in ${d.teardown.creativesDir}` : "";
              toast.success(`${r.done} ads torn down with ${r.llmCalls} LLM call${r.llmCalls === 1 ? "" : "s"}`, { description: `${r.patterns} patterns${skipped}${missing}${r.errors ? ` · ${r.errors} failed` : ""}` });
            } catch (err) { toast.error("Teardown failed", { description: errorMessage(err) }); }
          }} />
        )}
      </div>
      {selected && d && <AdDialog row={selected} projects={d.projects} teardownEnabled={d.teardown.llmConfigured} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Sources({ data }: { data: PerformanceOverview }) {
  const client = useQueryClient();
  const byPlatform = (p: AdPlatform) => data.accounts.filter((a) => a.platform === p);
  const lastImport = data.imports[0];
  const [manageMeta, setManageMeta] = useState(false);
  const metaAccounts = byPlatform("meta");
  const metaConnected = metaAccounts.filter((a) => a.status === "connected");
  const metaErrors = (data.lastReport?.accounts ?? []).filter((a) => a.status === "error" && a.accountId.startsWith("meta"));
  const lastMetaSync = metaConnected.map((a) => a.lastSyncAt).filter(Boolean).sort().at(-1);
  const metaEnabled = data.meta.connections.filter((c) => c.enabled);
  const metaLabel = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const google = byPlatform("google");
  const googleConnected = google.filter((a) => a.status === "connected");
  const googleErrors = (data.lastReport?.accounts ?? []).filter((a) => a.status === "error" && a.accountId.startsWith("google"));
  const lastGoogleSync = googleConnected.map((a) => a.lastSyncAt).filter(Boolean).sort().at(-1);

  async function toggleNightly(enabled: boolean) {
    try {
      await api.performanceSettings({ nightlyEnabled: enabled });
      await client.invalidateQueries({ queryKey: keys.performance });
      toast.success(enabled ? "Nightly sync on · runs after 03:00" : "Nightly sync off");
    } catch (err) { toast.error("Couldn't save", { description: errorMessage(err) }); }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <SourceCard icon={<FolderInput />} title="CSV inbox" tone={data.inbox.files.length ? "success" : "neutral"}
        status={data.inbox.files.length ? `${data.inbox.files.length} file${data.inbox.files.length > 1 ? "s" : ""}` : "Empty"}
        detail={<><span className="font-mono text-xs">{data.inbox.dir}/</span>{lastImport ? ` · last import ${relativeTime(lastImport.importedAt)}` : ""}</>} />
      <SourceCard icon={<BarChart3 />} title="Meta Ads" data-testid="perf-meta-card"
        tone={metaErrors.length ? "danger" : metaConnected.length ? "success" : metaAccounts.length ? "info" : data.meta.configured ? "warning" : "neutral"}
        status={metaErrors.length ? "Sync error" : metaConnected.length ? `${metaLabel(metaConnected.length, "account")} connected` : data.meta.configured ? "Configured · not synced yet" : metaAccounts.length ? `${metaLabel(metaAccounts.length, "account")} via CSV` : "Not connected"}
        detail={metaErrors.length ? metaErrors.map((a) => `${a.connectionLabel ? `${a.connectionLabel} · ` : ""}${a.name}: ${a.error}`).join(" · ")
          : metaConnected.length ? `${metaEnabled.length > 1 ? `${metaLabel(metaEnabled.length, "connection")} · ` : ""}${metaConnected.map((a) => a.name).join(", ")}${lastMetaSync ? ` · synced ${relativeTime(lastMetaSync)}` : ""}`
          : data.meta.configured ? `${metaEnabled.map((c) => c.label).join(", ")} · accounts ${data.meta.accountIds.join(", ")} · click Sync now to backfill 90 days`
          : metaAccounts.length ? metaAccounts.map((a) => a.name).join(", ")
          : "Add a connection (token + ad accounts) per business, or use CSV exports."}
        footer={
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <Button variant="ghost" size="sm" onClick={() => setManageMeta(true)} data-testid="perf-meta-manage"><KeyRound /> {data.meta.connections.length ? `Manage ${metaLabel(data.meta.connections.length, "connection")}` : "Add connection"}</Button>
            {data.meta.configured && (
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                <span>
                  Nightly sync after {String(data.nightly.hour).padStart(2, "0")}:00
                  {data.nightly.lastRun ? ` · last ${data.nightly.lastRun}${data.nightly.lastResult && data.nightly.lastResult !== "ok" ? " (failed)" : ""}` : ""}
                </span>
                <Switch id="perf-nightly" label="Nightly sync" checked={data.nightly.enabled} onCheckedChange={toggleNightly} />
              </span>
            )}
          </div>
        } />
      {manageMeta && <MetaConnectionsDialog open onOpenChange={(o) => { if (!o) setManageMeta(false); }} data={data} />}
      <SourceCard icon={<BarChart3 />} title="Google Ads" data-testid="perf-google-card"
        tone={googleErrors.length ? "danger" : googleConnected.length ? "success" : google.length ? "info" : data.google.configured ? "warning" : "neutral"}
        status={googleErrors.length ? "Sync error" : googleConnected.length ? `${googleConnected.length} account${googleConnected.length > 1 ? "s" : ""} connected` : data.google.configured ? "Configured · not synced yet" : google.length ? `${google.length} account${google.length > 1 ? "s" : ""} via CSV` : "Not connected"}
        detail={googleErrors.length ? googleErrors.map((a) => `${a.name}: ${a.error}`).join(" · ")
          : googleConnected.length ? `${googleConnected.map((a) => a.name).join(", ")}${lastGoogleSync ? ` · synced ${relativeTime(lastGoogleSync)}` : ""} · view rate stands in for hook rate`
          : data.google.configured ? `Customers ${data.google.customerIds.join(", ")}${data.google.loginCustomerId ? ` via MCC ${data.google.loginCustomerId}` : ""} · click Sync now to backfill 90 days`
          : google.length ? google.map((a) => a.name).join(", ")
          : "Set GOOGLE_ADS_DEVELOPER_TOKEN, client id/secret, refresh token and GOOGLE_ADS_CUSTOMER_IDS in .env, or use CSV exports."} />
    </div>
  );
}

function SourceCard({ icon, title, status, detail, tone, footer, ...rest }: { icon: React.ReactNode; title: string; status: string; detail: React.ReactNode; tone: "neutral" | "success" | "info" | "warning" | "danger"; footer?: React.ReactNode; "data-testid"?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs" {...rest}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-fg [&_svg]:size-4 [&_svg]:text-fg-muted">{icon}{title}</span>
        <Badge tone={tone} dot>{status}</Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-fg-muted" title={typeof detail === "string" ? detail : undefined}>{detail}</p>
      {footer}
    </div>
  );
}

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "score", label: "Score", title: "Composite z-score within the account: hook, hold, CTR, CPA, ROAS" },
  { key: "spend", label: "Spend", title: "Spend in the window" },
  { key: "impressions", label: "Impr.", title: "Impressions in the window" },
  { key: "hookRate", label: "Hook", title: "Meta: 3-second plays ÷ impressions · Google: view rate" },
  { key: "holdRate", label: "Hold", title: "Meta: ThruPlays ÷ 3-second plays · Google: 100% ÷ 25% quartile" },
  { key: "ctr", label: "CTR", title: "Link clicks ÷ impressions" },
  { key: "cpa", label: "CPA", title: "Spend ÷ conversions (shrunk toward the account mean)" },
  { key: "roas", label: "ROAS", title: "Conversion value ÷ spend" },
];

function Leaderboard({ rows, sort, onSort, onOpen }: { rows: LeaderboardRow[]; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; onOpen: (r: LeaderboardRow) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-xs">
      <table className="w-full min-w-[880px] text-sm" data-testid="perf-leaderboard">
        <thead className="bg-subtle text-xs text-fg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Ad</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right font-medium">
                <button type="button" title={c.title} onClick={() => onSort(c.key)} className={cn("inline-flex items-center gap-1 rounded px-1 hover:text-fg", sort.key === c.key && "text-fg")}>
                  {c.label}{sort.key === c.key && (sort.dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">Project</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.adId} className="cursor-pointer hover:bg-subtle" onClick={() => onOpen(r)}>
              <td className="max-w-[320px] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-fg" title={r.ad.name}>{r.ad.name}</span>
                  {r.isWinner && <Badge tone="success"><Trophy className="size-3" /> Winner</Badge>}
                  {r.isLoser && <Badge tone="danger">Loser</Badge>}
                  {r.isFatigued && <Badge tone="warning"><TrendingDown className="size-3" /> Fatigued</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                  <span>{PLATFORM_LABEL[r.ad.platform]}</span>
                  {r.ad.campaignName && <><span>·</span><span className="truncate">{r.ad.campaignName}</span></>}
                  {r.confidence === "low" && <><span>·</span><span title="Below 1,000 impressions or €20 spend; excluded from winner picks">low volume</span></>}
                </div>
              </td>
              <td className="tabular px-2 py-2 text-right font-semibold text-fg">{r.score.toFixed(2)}</td>
              <td className="tabular px-2 py-2 text-right">{money(r.spend)}</td>
              <td className="tabular px-2 py-2 text-right">{int(r.impressions)}</td>
              <td className="tabular px-2 py-2 text-right">{pct(r.hookRate)}</td>
              <td className="tabular px-2 py-2 text-right">{pct(r.holdRate)}</td>
              <td className="tabular px-2 py-2 text-right">{pct(r.ctr)}</td>
              <td className="tabular px-2 py-2 text-right">{money(r.cpa, 2)}</td>
              <td className="tabular px-2 py-2 text-right">{r.roas === undefined ? "—" : `${r.roas.toFixed(2)}×`}</td>
              <td className="px-3 py-2 text-xs">
                {r.ad.projectId ? (
                  <Link to={`/studio/${encodeURIComponent(r.ad.projectId)}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-accent hover:underline">
                    <Link2 className="size-3" /> {r.projectTitle ?? r.ad.projectId}{r.ad.variantKey ? <span className="font-mono text-fg-muted"> {r.ad.variantKey}</span> : null}
                  </Link>
                ) : <span className="text-fg-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdDialog({ row, projects, teardownEnabled, onClose }: { row: LeaderboardRow; projects: Array<{ id: string; title: string }>; teardownEnabled: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const series = useAdSeries(row.adId);
  const teardown = useTeardown(row.adId);
  const [tearing, setTearing] = useState(false);
  async function tearDown() {
    setTearing(true);
    try {
      const r = await api.runTeardowns([row.adId]);
      await Promise.all([client.invalidateQueries({ queryKey: keys.teardown(row.adId) }), client.invalidateQueries({ queryKey: keys.performance }), client.invalidateQueries({ queryKey: keys.patterns })]);
      const item = r.items[0];
      if (item?.status === "done") toast.success("Ad torn down");
      else toast.warning(item?.status === "needs_transcript" ? "Transcript needed" : "Teardown failed", { description: item?.error });
    } catch (err) { toast.error("Teardown failed", { description: errorMessage(err) }); }
    finally { setTearing(false); }
  }
  const [projectId, setProjectId] = useState(row.ad.projectId ?? "");
  const [saving, setSaving] = useState(false);
  const points = series.data?.series ?? [];
  const maxHook = Math.max(0.0001, ...points.map((p) => p.hookRate ?? 0));

  async function save() {
    setSaving(true);
    try {
      await api.linkAd(row.adId, projectId || null);
      await client.invalidateQueries({ queryKey: keys.performance });
      toast.success(projectId ? "Ad linked to project" : "Link removed");
      onClose();
    } catch (err) { toast.error("Couldn't save the link", { description: errorMessage(err) }); }
    finally { setSaving(false); }
  }

  const stats: Array<[string, string]> = [
    ["Score", row.score.toFixed(2)], ["Percentile", pct(row.percentile)], ["Confidence", row.confidence],
    ["Spend", money(row.spend, 2)], ["Impressions", int(row.impressions)], ["Hook rate", pct(row.hookRate)], ["Hold rate", pct(row.holdRate)],
    ["Completion", pct(row.completionRate)], ["CTR", pct(row.ctr)], ["CPC", money(row.cpc, 2)], ["CPA", money(row.cpa, 2)], ["ROAS", row.roas === undefined ? "—" : `${row.roas.toFixed(2)}×`],
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title={row.ad.name} size="lg"
      description={`${PLATFORM_LABEL[row.ad.platform]}${row.ad.campaignName ? ` · ${row.ad.campaignName}` : ""}${row.ad.adsetName ? ` · ${row.ad.adsetName}` : ""} · ${row.ad.firstSeen} → ${row.ad.lastSeen}`}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={saving} onClick={save} disabled={(row.ad.projectId ?? "") === projectId}>Save link</Button></>}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {row.isWinner && <Badge tone="success"><Trophy className="size-3" /> Winner · top of its account</Badge>}
          {row.isLoser && <Badge tone="danger">Loser · bottom of its account</Badge>}
          {row.isFatigued && <Badge tone="warning"><TrendingDown className="size-3" /> Fatigued · 7-day hook rate or CTR fell over 30%</Badge>}
          {row.confidence === "low" && <Badge tone="neutral">Low volume · not eligible for winner/loser flags</Badge>}
        </div>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 rounded-lg border border-line bg-subtle p-3 sm:grid-cols-4">
          {stats.map(([k, v]) => <div key={k}><dt className="text-[11px] text-fg-muted uppercase">{k}</dt><dd className="tabular text-sm font-medium text-fg">{v}</dd></div>)}
        </dl>
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Daily hook rate</h3>
          {series.isPending ? <Skeleton className="h-16" /> : points.length ? (
            <div className="flex h-16 items-end gap-px" role="img" aria-label={`Hook rate over ${points.length} days`}>
              {points.map((p) => (
                <div key={p.date} title={`${p.date}: hook ${pct(p.hookRate)} · CTR ${pct(p.ctr)} · ${int(p.impressions)} impr.`}
                  className={cn("flex-1 rounded-t-sm", p.hookRate === undefined ? "bg-line" : "bg-accent/70")}
                  style={{ height: `${Math.max(4, ((p.hookRate ?? 0) / maxHook) * 100)}%` }} />
              ))}
            </div>
          ) : <p className="text-sm text-fg-muted">No daily rows.</p>}
        </div>
        <div data-testid="perf-teardown">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Teardown</h3>
            <Button variant="secondary" size="sm" loading={tearing} disabled={!teardownEnabled} onClick={tearDown}
              title={teardownEnabled ? "Analyse hook, angle, persona and pacing (one LLM call)" : "Set an LLM key in .env first"}>
              {teardown.data?.structure ? "Re-run teardown" : "Tear down"}
            </Button>
          </div>
          {teardown.isPending ? <Skeleton className="h-16" /> : !teardown.data ? (
            <p className="text-sm text-fg-muted">Not analysed yet. {row.ad.projectId ? "Linked project scripts are analysed without transcription." : "External ads need the creative and a transcript in the creatives folder."}</p>
          ) : teardown.data.status !== "done" ? (
            <p className="text-sm text-warning">{teardown.data.error ?? teardown.data.status}</p>
          ) : <TeardownView t={teardown.data} />}
        </div>
        <div>
          <label htmlFor="perf-link-project" className="mb-1 block text-xs font-semibold tracking-wide text-fg-muted uppercase">Linked project</label>
          <Select id="perf-link-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Not linked</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.id})</option>)}
          </Select>
          <p className="mt-1 text-xs text-fg-muted">Ads whose name contains a project ID are linked automatically on sync. Linking lets the Studio show which hook × CTA variant won.</p>
        </div>
      </div>
    </Dialog>
  );
}

function TeardownView({ t }: { t: Teardown }) {
  const s = t.structure!;
  const [showTranscript, setShowTranscript] = useState(false);
  const tags: Array<[string, string]> = [
    ["Hook", s.hookType], ["Angle", s.angle], ["Persona", s.persona], ["Trigger", s.emotionalTrigger], ["Claim", s.claimStructure], ["CTA", s.ctaStyle],
    ["Address", s.addressForm], ["Numbers", s.usesNumbers ? "yes" : "no"], ["Visuals", t.visual.visualStyle],
    ...(t.visual.cutsPer10s !== undefined ? [["Cuts/10s", String(t.visual.cutsPer10s)] as [string, string]] : []),
    ["Music", t.visual.musicEnergy], ...(t.visual.durationS !== undefined ? [["Length", `${t.visual.durationS}s`] as [string, string]] : []),
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map(([k, v]) => <Badge key={k} tone="neutral" className="h-auto py-0.5"><span className="text-fg-muted">{k}</span> {v}</Badge>)}
      </div>
      <dl className="space-y-1 rounded-lg border border-line bg-subtle p-3 text-sm">
        <div><dt className="inline text-xs font-semibold text-fg-muted uppercase">Hook </dt><dd className="inline text-fg">„{s.hookText}“</dd></div>
        <div><dt className="inline text-xs font-semibold text-fg-muted uppercase">CTA </dt><dd className="inline text-fg">„{s.ctaText}“</dd></div>
        {s.hookNote && <div className="text-xs text-fg-secondary italic">{s.hookNote}</div>}
      </dl>
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{t.source === "own" ? "From the project script" : t.source === "competitor" ? "Competitor file" : "From transcript"}{t.model ? ` · ${t.model}` : ""} · {relativeTime(t.updatedAt)}</span>
        {t.transcriptDe && <button type="button" className="text-accent hover:underline" onClick={() => setShowTranscript((v) => !v)}>{showTranscript ? "Hide transcript" : "Show transcript"}</button>}
      </div>
      {showTranscript && t.transcriptDe && <p className="max-h-40 overflow-auto rounded-lg border border-line p-3 text-sm whitespace-pre-wrap text-fg-secondary">{t.transcriptDe}</p>}
    </div>
  );
}

/** Per-platform means. Raw hook rates differ by construction (Google uses view rate); percentiles should sit near 50% on every platform. */
function PlatformStrip({ report }: { report: NormalizationReport }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-xs" data-testid="perf-platforms">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {report.platforms.map((p) => (
          <div key={p.platform} className="tabular flex flex-wrap items-baseline gap-x-3 text-xs text-fg-muted">
            <span className="text-sm font-semibold text-fg">{PLATFORM_LABEL[p.platform]}</span>
            <span>{p.ads} ads · {p.eligible} eligible · {p.winners} winner{p.winners === 1 ? "" : "s"}</span>
            <span title={p.hookRateNote}>hook {pct(p.meanHookRate)}</span>
            <span title={p.holdRateNote}>hold {pct(p.meanHoldRate)}</span>
            <span>CTR {pct(p.meanCtr)}</span>
            <span>CPA {money(p.meanCpa, 2)}</span>
            <span title="Mean percentile; ≈50% means this platform is neither favoured nor penalised">rank {pct(p.meanPercentile)}</span>
          </div>
        ))}
        <Badge tone={report.balanced ? "success" : "warning"} dot className="ml-auto">{report.balanced ? "Platforms ranked separately" : "Ranking looks unbalanced"}</Badge>
      </div>
      {report.notes.length > 0 && <p className="mt-1.5 text-xs text-fg-muted">{report.notes.join(" ")}</p>}
    </div>
  );
}
