import { CheckCircle2, Monitor, Moon, Sun, XCircle } from "lucide-react";
import { toast } from "sonner";
import { usePrefs, type ThemePref } from "@/lib/prefs";
import { usePresets, useStudioConfig } from "@/lib/queries";
import type { AspectRatio } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Kbd, KeyValue, Label, Segmented, Select, Skeleton, SwitchRow } from "@/components/ui/primitives";
import { SHORTCUTS } from "@/components/shell/ShortcutsDialog";
import type { ReactNode } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@/lib/format";

export default function SettingsPage() {
  const config = useStudioConfig();
  const presets = usePresets().data ?? [];
  const [prefs, setPrefs] = usePrefs();
  const c = config.data;
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
          <p className="mt-1 text-sm text-fg-muted">Service status comes from the server's <code className="font-mono">.env</code>; preferences are saved in this browser.</p>
        </header>

        <Card title="Services" description="Keys are read on the server and never sent to the browser. Edit .env and restart the dashboard to change them.">
          {config.isPending ? <Skeleton className="h-28" /> : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              <Service name="Script writing" detail={`${c?.llmProvider === "openrouter" ? "OpenRouter" : "Anthropic"} · ${c?.scriptModel ?? "—"}`} ok={c?.services?.scripts} />
              <Service name="German voice" detail={`ElevenLabs · ${c?.voiceModel ?? "—"} · ${c?.voiceLanguage ?? "—"}`} ok={c?.services?.voice} />
              <Service name="Avatar video" detail="HeyGen" ok={c?.services?.avatar} />
            </ul>
          )}
          <Button variant="secondary" loading={refreshing} disabled={!c?.services?.avatar} onClick={async () => {
            setRefreshing(true);
            try {
              const refreshed = await api.refreshAvatars();
              await Promise.all([client.invalidateQueries({ queryKey: ["avatars"] }), client.invalidateQueries({ queryKey: keys.config })]);
              toast.success(`${refreshed.total} HeyGen v3 presenters refreshed`, { description: refreshed.defaultRepaired ? "The unavailable default presenter was replaced." : undefined });
            } catch (err) { toast.error("Avatar refresh failed", { description: errorMessage(err) }); }
            finally { setRefreshing(false); }
          }}>Refresh HeyGen avatars</Button>
          <p className="text-xs text-fg-muted">HeyGen API v3 · {c?.defaultAvatar ? `Default presenter: ${c.defaultAvatar.avatar_name}` : "Refresh the catalog to select an available default presenter."}</p>
        </Card>

        <LibraryStorageCard />

        <Card title="Output">
          <KeyValue items={[
            { label: "Finished videos", value: <span className="font-mono text-xs">{c?.outputFolder ?? "—"}</span> },
            { label: "Change with", value: <span className="font-mono text-xs">VIDEO_OUTPUT_DIR · VIDEO_SESSION</span> },
          ]} />
        </Card>

        <Card title="Appearance" description="The studio is designed light-first. Video previews always stay on a dark stage.">
          <Segmented<ThemePref> label="Theme" value={prefs.theme} onChange={(v) => setPrefs({ theme: v })}
            options={[
              { value: "light", label: <><Sun /> Light</> },
              { value: "dark", label: <><Moon /> Dark</> },
              { value: "system", label: <><Monitor /> System</> },
            ]} />
        </Card>

        <Card title="New video defaults">
          <div>
            <Label>Format</Label>
            <Segmented<AspectRatio> label="Default format" value={prefs.defaultAspectRatio} onChange={(v) => setPrefs({ defaultAspectRatio: v })}
              options={[{ value: "9:16", label: "Vertical 9:16" }, { value: "16:9", label: "Horizontal 16:9" }]} />
          </div>
          <div className="max-w-sm">
            <Label htmlFor="default-preset">Caption style</Label>
            <Select id="default-preset" value={prefs.defaultPresetId} onChange={(e) => setPrefs({ defaultPresetId: e.target.value })}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </Card>

        <Card title="Spending safeguards">
          <SwitchRow
            title="Confirm before using paid API credits"
            description="Ask before avatar videos that use HeyGen credits."
            checked={prefs.confirmSpend}
            onCheckedChange={(v) => setPrefs({ confirmSpend: v })}
          />
        </Card>

        <Card title="Keyboard shortcuts">
          <div className="grid gap-4 sm:grid-cols-2">
            {SHORTCUTS.map((g) => (
              <div key={g.group}>
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">{g.group}</h3>
                <ul className="space-y-1.5">
                  {g.items.map((i) => (
                    <li key={i.label} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-fg-secondary">{i.label}</span>
                      <span className="flex gap-1">{i.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Reset" description="Clears favourites, recent avatars, panel sizes and defaults in this browser. Projects are not affected.">
          <Button variant="danger-ghost" className="border border-danger/25" onClick={() => {
            try { localStorage.removeItem("adFactory.prefs.v1"); localStorage.removeItem("adFactory.scriptHistory.v1"); } catch { /* storage unavailable */ }
            toast.success("Preferences reset", { description: "Reloading…" });
            setTimeout(() => location.reload(), 600);
          }}>Reset preferences</Button>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Service({ name, detail, ok }: { name: string; detail: string; ok?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      {ok ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-danger" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{name}</div>
        <div className="truncate text-xs text-fg-muted">{detail}</div>
      </div>
      <span className={ok ? "text-xs font-medium text-success" : "text-xs font-medium text-danger"}>{ok ? "Configured" : "Missing key"}</span>
    </li>
  );
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes > 100 * 1_048_576 ? 0 : 1)} MB`;

/** B-roll clips, previews, the catalog and music are stored in the database; files on disk are a working copy. */
function LibraryStorageCard() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["library-storage"], queryFn: api.libraryStorage,
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : 60_000) });
  const [syncing, setSyncing] = useState(false);
  const d = q.data;
  const last = d?.last;
  return (
    <Card title="Library storage" description="Every B-roll clip, preview, the catalog and every music track is stored in the database, so a backup of the database holds the whole Library. Missing files are restored from it automatically.">
      {q.isPending ? <Skeleton className="h-24" /> : q.isError ? (
        <p className="text-sm text-danger">Couldn't read the Library storage: {errorMessage(q.error)}</p>
      ) : d && (
        <>
          <KeyValue items={[
            { label: "B-roll clips", value: `${d.status.byKind.broll.files} · ${mb(d.status.byKind.broll.bytes)}` },
            { label: "Previews", value: `${d.status.byKind.preview.files} · ${mb(d.status.byKind.preview.bytes)}` },
            { label: "Music", value: `${d.status.byKind.music.files} · ${mb(d.status.byKind.music.bytes)}` },
            { label: "Catalog", value: d.status.byKind.catalog.files ? "Stored" : "Not yet" },
            { label: "Total in database", value: <span className="font-medium text-fg">{mb(d.status.bytes)}</span> },
            { label: "Last sync", value: d.running ? "Syncing now…" : last ? `${relativeTime(last.at)} · ${last.stored + last.updated} stored, ${last.restored} restored` : "Not yet" },
          ]} />
          {(d.lastError || (last && (last.errors.length > 0 || last.tooLarge.length > 0))) && (
            <p className="text-xs text-warning">
              {d.lastError ? `Last sync failed: ${d.lastError}` : [
                last!.errors.length ? `${last!.errors.length} file(s) failed: ${last!.errors.slice(0, 2).map((e) => e.path).join(", ")}` : "",
                last!.tooLarge.length ? `${last!.tooLarge.length} file(s) over 950 MB stay on disk only` : "",
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </>
      )}
      <Button variant="secondary" loading={syncing || !!d?.running} onClick={async () => {
        setSyncing(true);
        try {
          const r = await api.syncLibraryStorage();
          client.setQueryData(["library-storage"], r);
          const l = r.last;
          toast.success("Library synced", { description: l ? `${l.stored + l.updated} stored, ${l.restored} restored, ${l.unchanged} unchanged` : undefined });
        } catch (err) { toast.error("Library sync failed", { description: errorMessage(err) }); }
        finally { setSyncing(false); }
      }}>Sync now</Button>
    </Card>
  );
}
