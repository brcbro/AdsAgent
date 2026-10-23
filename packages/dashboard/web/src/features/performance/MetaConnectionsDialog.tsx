import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { keys } from "@/lib/queries";
import type { AdAccount, MetaConnection, MetaConnectionInput, PerformanceOverview } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, useConfirm } from "@/components/ui/dialog";
import { Badge, Hint, Input, Label, Switch } from "@/components/ui/primitives";

/*
 * Meta connections: one access token plus the ad accounts it may read, per business or client.
 * Tokens are written once and never shown again; the server only returns their last characters.
 */

type Form = { label: string; accessToken: string; accountIds: string; apiVersion: string; conversionActions: string; leadActions: string };
const emptyForm = (): Form => ({ label: "", accessToken: "", accountIds: "", apiVersion: "", conversionActions: "", leadActions: "" });
const formFor = (c: MetaConnection): Form => ({
  label: c.label, accessToken: "", accountIds: c.accountIds.join(", "), apiVersion: c.apiVersion ?? "",
  conversionActions: (c.conversionActions ?? []).join(", "), leadActions: (c.leadActions ?? []).join(", "),
});
const toInput = (f: Form): MetaConnectionInput => ({
  label: f.label, accessToken: f.accessToken || undefined, accountIds: f.accountIds, apiVersion: f.apiVersion || undefined,
  conversionActions: f.conversionActions, leadActions: f.leadActions,
});

export function MetaConnectionsDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: PerformanceOverview }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<"new" | MetaConnection | null>(null);
  const connections = data.meta.connections;
  const refresh = () => client.invalidateQueries({ queryKey: keys.performance });

  async function toggle(c: MetaConnection, enabled: boolean) {
    try {
      await api.updateMetaConnection(c.id, { enabled });
      await refresh();
      toast.success(enabled ? `${c.label} is included in the next sync` : `${c.label} is paused`);
    } catch (err) { toast.error("Couldn't save", { description: errorMessage(err) }); }
  }
  async function remove(c: MetaConnection) {
    const ok = await confirm({ title: `Remove ${c.label}?`, description: "The token is deleted. Synced ads and metrics stay in the leaderboard, marked as disconnected.", confirmLabel: "Remove", tone: "danger" });
    if (!ok) return;
    try { await api.deleteMetaConnection(c.id); await refresh(); toast.success(`${c.label} removed`); }
    catch (err) { toast.error("Couldn't remove", { description: errorMessage(err) }); }
  }
  async function test(c: MetaConnection) {
    try {
      const r = await api.testMetaConnection({ id: c.id });
      toast.success(`${c.label}: ${r.accounts.length} account${r.accounts.length === 1 ? "" : "s"} readable`, { description: r.accounts.map((a) => `${a.name} (${a.id}${a.currency ? `, ${a.currency}` : ""})`).join("\n") });
    } catch (err) { toast.error(`${c.label}: connection failed`, { description: errorMessage(err) }); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Meta ad accounts" size="lg"
      description="One connection per Business Manager or client: its own access token and the ad accounts it may read. Every enabled connection is pulled by Sync now and the nightly sync."
      footer={editing ? undefined : (
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="primary" onClick={() => setEditing("new")} data-testid="meta-add-connection"><Plus /> Add connection</Button>
        </>
      )}>
      {editing ? (
        <ConnectionForm connection={editing === "new" ? undefined : editing} onDone={async (saved) => { setEditing(null); if (saved) await refresh(); }} />
      ) : !connections.length ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-medium text-fg">No Meta connection yet</p>
          <p className="mt-1 text-xs text-fg-muted">You need a system-user token with <code className="font-mono">ads_read</code> and the ad account ids (Ads Manager → Account overview).</p>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="meta-connections">
          {connections.map((c) => (
            <ConnectionRow key={c.id} connection={c}
              // Accounts synced before connections existed carry no connection id; match them by account id.
              accounts={data.accounts.filter((a) => a.platform === "meta" && (a.connectionId === c.id || (!a.connectionId && a.status === "connected" && c.accountIds.includes(a.externalId))))}
              report={data.lastReport?.accounts.filter((a) => a.connectionId === c.id) ?? []}
              onToggle={(v) => toggle(c, v)} onEdit={() => setEditing(c)} onRemove={() => remove(c)} onTest={() => test(c)} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function ConnectionRow({ connection: c, accounts, report, onToggle, onEdit, onRemove, onTest }: {
  connection: MetaConnection; accounts: AdAccount[]; report: NonNullable<PerformanceOverview["lastReport"]>["accounts"];
  onToggle: (v: boolean) => void; onEdit: () => void; onRemove: () => void; onTest: () => void;
}) {
  const fromEnv = c.source === "env";
  const errors = report.filter((r) => r.status === "error");
  const lastSync = accounts.map((a) => a.lastSyncAt).filter(Boolean).sort().at(-1);
  return (
    <li className="rounded-lg border border-line bg-surface p-3.5" data-testid="meta-connection">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{c.label}</span>
        {fromEnv && <Badge tone="info"><Lock className="size-3" aria-hidden /> .env</Badge>}
        <Badge tone={errors.length ? "danger" : !c.enabled ? "neutral" : accounts.length ? "success" : "warning"} dot>
          {errors.length ? "Sync error" : !c.enabled ? "Paused" : accounts.length ? `${accounts.length} account${accounts.length === 1 ? "" : "s"} synced` : "Not synced yet"}
        </Badge>
        <span className="ml-auto flex items-center gap-1">
          <Switch id={`conn-${c.id}`} label={`Enable ${c.label}`} checked={c.enabled} onCheckedChange={onToggle} />
          <IconButton label={`Test ${c.label}`} size="icon-sm" onClick={onTest}><Wifi /></IconButton>
          {!fromEnv && <IconButton label={`Edit ${c.label}`} size="icon-sm" onClick={onEdit}><Pencil /></IconButton>}
          {!fromEnv && <IconButton label={`Remove ${c.label}`} size="icon-sm" onClick={onRemove}><Trash2 /></IconButton>}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-fg-muted">
        Token {c.tokenHint} · accounts {c.accountIds.join(", ")}{c.apiVersion ? ` · ${c.apiVersion}` : ""}{lastSync ? ` · synced ${relativeTime(lastSync)}` : ""}
      </p>
      {accounts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {accounts.map((a) => <li key={a.id}><Badge tone={a.status === "connected" ? "neutral" : "warning"}>{a.name}{a.currency ? ` · ${a.currency}` : ""}</Badge></li>)}
        </ul>
      )}
      {errors.length > 0 && <p className="mt-2 text-xs text-danger">{errors.map((e) => `${e.name}: ${e.error}`).join(" · ")}</p>}
      {fromEnv && <p className="mt-2 text-xs text-fg-muted">Set in <code className="font-mono">.env</code> (META_ACCESS_TOKEN, META_AD_ACCOUNT_IDS). Edit the file and restart the dashboard to change it; META_ENV_CONNECTION_ENABLED=0 hides it.</p>}
    </li>
  );
}

function ConnectionForm({ connection, onDone }: { connection?: MetaConnection; onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState<Form>(connection ? formFor(connection) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm((f) => ({ ...f, [k]: e.target.value })); setTested(null); };

  async function test() {
    setTesting(true);
    try {
      const r = await api.testMetaConnection({ ...toInput(form), id: connection?.id, label: form.label || "Test" });
      setTested(r.accounts.map((a) => `${a.name} (${a.id}${a.currency ? `, ${a.currency}` : ""})`).join(" · "));
      toast.success(`${r.accounts.length} account${r.accounts.length === 1 ? "" : "s"} readable`);
    } catch (err) { setTested(null); toast.error("Connection failed", { description: errorMessage(err) }); }
    finally { setTesting(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (connection) await api.updateMetaConnection(connection.id, toInput(form));
      else await api.createMetaConnection(toInput(form));
      toast.success(connection ? `${form.label} saved` : `${form.label} added · click Sync now to backfill 90 days`);
      onDone(true);
    } catch (err) { toast.error("Couldn't save", { description: errorMessage(err) }); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="space-y-4" data-testid="meta-connection-form">
      <div>
        <Label htmlFor="conn-label">Name</Label>
        <Input id="conn-label" value={form.label} onChange={set("label")} placeholder="Client or Business Manager" autoFocus required />
      </div>
      <div>
        <Label htmlFor="conn-token" hint={connection ? "Leave blank to keep the saved token" : undefined}>Access token</Label>
        <Input id="conn-token" type="password" autoComplete="off" value={form.accessToken} onChange={set("accessToken")} placeholder={connection ? `Saved (${connection.tokenHint})` : "System-user token with ads_read"} required={!connection} />
        <Hint>Stored on this machine in the performance database; never sent to the browser again.</Hint>
      </div>
      <div>
        <Label htmlFor="conn-accounts" hint="Comma separated, with or without act_">Ad account ids</Label>
        <Input id="conn-accounts" value={form.accountIds} onChange={set("accountIds")} placeholder="act_1234567890, 2345678901" required />
      </div>
      <details className="rounded-lg border border-line px-3.5 py-2.5">
        <summary className="cursor-pointer text-sm font-medium text-fg">Advanced</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="conn-version">API version</Label>
            <Input id="conn-version" value={form.apiVersion} onChange={set("apiVersion")} placeholder="v21.0" />
          </div>
          <div>
            <Label htmlFor="conn-conv">Conversion actions</Label>
            <Input id="conn-conv" value={form.conversionActions} onChange={set("conversionActions")} placeholder="purchase, omni_purchase" />
          </div>
          <div>
            <Label htmlFor="conn-lead">Lead actions</Label>
            <Input id="conn-lead" value={form.leadActions} onChange={set("leadActions")} placeholder="lead" />
          </div>
        </div>
        <Hint className="mt-2">Blank uses the defaults. The first action type present on an ad counts as its conversion / lead.</Hint>
      </details>
      {tested && <p className="text-xs text-success">Readable: {tested}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>Cancel</Button>
        <Button variant="secondary" loading={testing} onClick={test} disabled={!form.accountIds.trim() || (!connection && !form.accessToken.trim())}><Wifi /> Test</Button>
        <Button type="submit" variant="primary" loading={saving}>{connection ? "Save" : "Add connection"}</Button>
      </div>
    </form>
  );
}
