import { NavLink, useNavigate } from "react-router";
import { Popover } from "radix-ui";
import { BarChart3, Bot, Clapperboard, HelpCircle, Library, Search, Settings } from "lucide-react";
import { cn, elapsed } from "@/lib/format";
import { useAgentState, useProjects, useRenderStatus, useStudioConfig } from "@/lib/queries";
import { useNow } from "@/lib/hooks";
import { IconButton } from "../ui/button";
import { Badge, Kbd } from "../ui/primitives";
import { useShell } from "./shell-context";

const NAV = [
  { to: "/studio", label: "Studio", icon: Clapperboard },
  { to: "/agent", label: "Agent", icon: Bot },
  { to: "/library", label: "Library", icon: Library },
  { to: "/performance", label: "Performance", icon: BarChart3 },
];

export function TopBar() {
  const shell = useShell();
  const navigate = useNavigate();
  const agent = useAgentState().data;
  const activeJobs = agent?.jobs.filter((j) => j.status === "queued" || j.status === "running").length ?? 0;
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-4">
      <NavLink to="/studio" className="flex items-center gap-2.5 rounded-md pr-2" aria-label="Ad Factory Studio home">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg shadow-sm">
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden><path d="M8 5.5v13l10.5-6.5z" /></svg>
        </span>
        <span className="hidden text-base font-semibold tracking-tight text-fg sm:block">
          Ad Factory <span className="font-normal text-fg-muted">Studio</span>
        </span>
      </NavLink>

      <nav aria-label="Primary" className="mx-auto flex items-center gap-1 rounded-lg border border-line bg-subtle p-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              "relative inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-all duration-150",
              isActive ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            {to === "/agent" && activeJobs > 0 && (
              <span className="tabular grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-fg" aria-label={`${activeJobs} active jobs`}>
                {activeJobs}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-1.5">
        <RenderStatusPill />
        <button
          type="button"
          onClick={() => shell.setPaletteOpen(true)}
          className="hidden h-9 items-center gap-2 rounded-md border border-line bg-surface pr-1.5 pl-3 text-sm text-fg-muted shadow-xs transition-colors hover:border-line-strong hover:text-fg lg:inline-flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="mr-4">Search…</span>
          <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
        </button>
        <IconButton label="Search and commands" className="lg:hidden" onClick={() => shell.setPaletteOpen(true)}><Search /></IconButton>
        <IconButton label="Keyboard shortcuts" onClick={() => shell.setShortcutsOpen(true)}><HelpCircle /></IconButton>
        <IconButton label="Settings" onClick={() => navigate("/settings")}><Settings /></IconButton>
      </div>
    </header>
  );
}

/** Global render state, visible on every page. Clicking it explains what is running and where. */
function RenderStatusPill() {
  const status = useRenderStatus();
  const agent = useAgentState().data;
  const projects = useProjects().data;
  const config = useStudioConfig().data;
  const navigate = useNavigate();
  const rendering = !!status.data?.rendering;
  const now = useNow(1000, rendering);
  const offline = status.isError;
  const workerOnline = agent?.workerRunning;
  const project = projects?.find((p) => p.id === status.data?.projectId);

  const tone = offline ? "danger" : rendering ? "accent" : "success";
  const label = offline ? "Offline" : rendering ? "Rendering" : "Ready";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="rounded-full" aria-label={`Studio status: ${label}`}>
          <Badge tone={tone} dot pulse={rendering} className="h-7 px-2.5 text-sm">
            {label}
            {rendering && status.data?.startedAt && <span className="tabular text-accent/70">{elapsed(status.data.startedAt, now)}</span>}
          </Badge>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-80 rounded-lg border border-line bg-surface p-4 shadow-lg animate-fade-in">
          <h2 className="text-sm font-semibold text-fg">Studio status</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <StatusRow label="Server" ok={!offline} value={offline ? "Not reachable" : "Connected"} />
            <StatusRow label="Agent worker" ok={!!workerOnline} value={workerOnline ? "Online · queue saved" : "Restarting"} />
            <StatusRow
              label="Render"
              ok={!offline}
              value={rendering ? `${status.data?.source === "agent" ? "Agent job" : "Editor"} · ${elapsed(status.data?.startedAt, now) || "starting"}` : "Idle"}
            />
          </dl>
          {rendering && (
            <div className="mt-3 rounded-md bg-subtle p-2.5 text-xs text-fg-secondary">
              <div className="font-medium text-fg">{project?.title ?? status.data?.projectId}</div>
              {status.data?.lastLine && <div className="mt-1 truncate font-mono text-fg-muted">{status.data.lastLine}</div>}
              {status.data?.projectId && (
                <button type="button" className="mt-2 font-medium text-accent hover:underline" onClick={() => navigate(`/studio/${status.data!.projectId}`)}>
                  Open in Studio →
                </button>
              )}
            </div>
          )}
          {config && (
            <div className="mt-3 border-t border-line pt-3 text-xs text-fg-muted">
              {config.scriptModel} · {config.voiceModel} · {config.voiceLanguage}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-fg">
        <span className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-danger")} aria-hidden />
        {value}
      </dd>
    </div>
  );
}
