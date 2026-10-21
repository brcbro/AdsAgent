import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive, ArrowDownUp, Check, Copy, Download, Film, Filter, Hash, MoreHorizontal, PanelLeftClose, Pencil, Plus, TrendingDown, Trophy, UserRound,
} from "lucide-react";
import { api, errorMessage, videoUrl } from "@/lib/api";
import { cn, isBusy, PROJECT_STATUS, relativeTime } from "@/lib/format";
import { copyText, useInView } from "@/lib/hooks";
import { keys, useProjectPerformance, useProjects } from "@/lib/queries";
import type { Project, ProjectPerformance, ProjectStatus } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/dialog";
import { Menu, RightClickMenu, type MenuEntry } from "@/components/ui/menu";
import { Badge, SearchInput, Skeleton } from "@/components/ui/primitives";
import { useShell } from "@/components/shell/shell-context";

type StatusFilter = "all" | "ready" | "draft" | "active" | "failed";
type Sort = "recent" | "name";

const FILTERS: Record<StatusFilter, { label: string; match: (s: ProjectStatus) => boolean }> = {
  all: { label: "All projects", match: () => true },
  ready: { label: "Ready", match: (s) => s === "done" },
  draft: { label: "Drafts", match: (s) => s === "draft" },
  active: { label: "In progress", match: (s) => isBusy(s) },
  failed: { label: "Failed", match: (s) => s === "error" },
};

function dateGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - 86_400_000) return "Yesterday";
  if (t >= startOfToday - 6 * 86_400_000) return "This week";
  return "Earlier";
}

export function ProjectSidebar({ activeId, onCollapse }: { activeId?: string; onCollapse: () => void }) {
  const projects = useProjects();
  const shell = useShell();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("recent");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects.data ?? [])
      .filter((p) => FILTERS[filter].match(p.status))
      .filter((p) => !q || `${p.title} ${p.id} ${p.avatar?.name ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => sort === "name" ? (a.title || a.id).localeCompare(b.title || b.id) : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    if (sort === "name") return [{ label: "", items: list }];
    const map = new Map<string, Project[]>();
    for (const p of list) {
      const g = dateGroup(p.updatedAt);
      map.set(g, [...(map.get(g) ?? []), p]);
    }
    return [...map].map(([label, items]) => ({ label, items }));
  }, [projects.data, query, filter, sort]);

  const total = projects.data?.length ?? 0;
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface" aria-label="Projects">
      <div className="space-y-3 border-b border-line p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">
            Projects <span className="tabular ml-1 font-normal text-fg-muted">{total}</span>
          </h2>
          <IconButton label="Hide sidebar ( [ )" size="icon-sm" onClick={onCollapse}><PanelLeftClose /></IconButton>
        </div>
        <Button variant="primary" className="w-full" onClick={() => shell.setNewProjectOpen(true)}><Plus /> New video</Button>
        <div className="flex gap-1.5">
          <SearchInput value={query} onChange={setQuery} placeholder="Search projects" className="flex-1" />
          <Menu
            trigger={<IconButton label="Filter by status" variant={filter === "all" ? "secondary" : "primary"}><Filter /></IconButton>}
            items={(Object.keys(FILTERS) as StatusFilter[]).map((f) => ({
              label: FILTERS[f].label,
              icon: filter === f ? <Check /> : <span className="size-4" />,
              onSelect: () => setFilter(f),
            }))}
          />
          <Menu
            trigger={<IconButton label="Sort projects" variant="secondary"><ArrowDownUp /></IconButton>}
            items={[
              { label: "Most recent", icon: sort === "recent" ? <Check /> : <span className="size-4" />, onSelect: () => setSort("recent") },
              { label: "Name (A–Z)", icon: sort === "name" ? <Check /> : <span className="size-4" />, onSelect: () => setSort("name") },
            ]}
          />
        </div>
        {filter !== "all" && (
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span>Showing {FILTERS[filter].label.toLowerCase()} · {shown}</span>
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setFilter("all")}>Clear</button>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Project list">
        {projects.isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-2"><Skeleton className="size-11 rounded-md" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>
          ))
        ) : shown === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-fg-muted">{total ? "No projects match your filters." : "No projects yet."}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label || "all"} className="mb-2">
              {group.label && <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-fg-muted">{group.label}</h3>}
              <ul className="space-y-0.5">
                {group.items.map((p) => <ProjectRow key={p.id} project={p} active={p.id === activeId} />)}
              </ul>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}

function ProjectRow({ project, active }: { project: Project; active: boolean }) {
  const perf = useProjectPerformance().data?.[project.id];
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const status = PROJECT_STATUS[project.status] ?? PROJECT_STATUS.draft;
  const busy = isBusy(project.status);

  async function rename(title: string) {
    setRenaming(false);
    const clean = title.trim();
    if (!clean || clean === project.title) return;
    try {
      const saved = await api.saveProject(project.id, { title: clean });
      client.setQueryData(keys.project(project.id), saved);
      client.setQueryData<Project[]>(keys.projects, (list) => list?.map((p) => (p.id === project.id ? saved : p)));
      toast.success("Project renamed");
    } catch (err) {
      toast.error("Couldn't rename the project", { description: errorMessage(err) });
    }
  }

  async function duplicate() {
    try {
      const copy = await api.createProject({
        id: `video_${Date.now()}`,
        title: `${project.title || project.id} (copy)`,
        scriptDe: project.scriptDe,
        introMs: project.introMs,
        aspectRatio: project.aspectRatio,
        avatar: project.avatar,
        music: project.music,
        captions: project.captions,
      });
      const saved = await api.saveProject(copy.id, {
        outputSpeed: project.outputSpeed, fullAvatar: project.fullAvatar, brollCutMs: project.brollCutMs,
      });
      client.setQueryData<Project[]>(keys.projects, (list) => [saved, ...(list ?? [])]);
      toast.success("Project duplicated");
      navigate(`/studio/${saved.id}`);
    } catch (err) {
      toast.error("Couldn't duplicate the project", { description: errorMessage(err) });
    }
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive "${project.title || project.id}"?`,
      description: "The project and its exported video move to data/archive and disappear from the list. You can restore them by moving the folder back.",
      confirmLabel: "Archive project",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.archiveProject(project.id);
      const remaining = (client.getQueryData<Project[]>(keys.projects) ?? []).filter((p) => p.id !== project.id);
      client.setQueryData(keys.projects, remaining);
      client.removeQueries({ queryKey: keys.project(project.id) });
      toast.success("Project archived");
      if (active) navigate(remaining[0] ? `/studio/${remaining[0].id}` : "/studio");
    } catch (err) {
      toast.error("Couldn't archive the project", { description: errorMessage(err) });
    }
  }

  const items: MenuEntry[] = [
    { label: "Rename", icon: <Pencil />, onSelect: () => setRenaming(true), disabled: busy, keepFocus: true },
    { label: "Duplicate", icon: <Copy />, onSelect: duplicate },
    { label: "Copy project ID", icon: <Hash />, onSelect: async () => { if (await copyText(project.id)) toast.success("Project ID copied"); } },
    ...(project.status === "done" ? [{
      label: "Download MP4", icon: <Download />, onSelect: () => {
        const a = document.createElement("a");
        a.href = videoUrl(project.id, project.updatedAt);
        a.download = `${project.title || project.id}.mp4`;
        a.click();
      },
    }] : []),
    { label: "Archive", icon: <Archive />, onSelect: archive, danger: true, disabled: busy, separatorBefore: true },
  ];

  return (
    <RightClickMenu items={items}>
      <li className={cn(
        "group relative flex items-center gap-3 rounded-lg p-2 transition-colors duration-150 [content-visibility:auto] [contain-intrinsic-size:auto_60px]",
        active ? "bg-accent-subtle" : "hover:bg-subtle",
      )}>
        <ProjectThumb project={project} />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput initial={project.title} onDone={rename} />
          ) : (
            <Link
              to={`/studio/${project.id}`}
              className="block truncate text-sm font-medium text-fg after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent"
              aria-current={active ? "page" : undefined}
              title={project.title || project.id}
              onDoubleClick={(e) => { if (!busy) { e.preventDefault(); setRenaming(true); } }}
            >
              {project.title || project.id}
            </Link>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
            <Badge tone={status.tone} dot pulse={busy} className="h-[18px] px-1.5">{status.label}</Badge>
            <span className="truncate">{relativeTime(project.updatedAt)}</span>
            <span aria-hidden>·</span>
            <span>{project.aspectRatio ?? "16:9"}</span>
          </div>
          {perf && <PerformanceStrip perf={perf} />}
        </div>
        <div className={cn("relative z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", active && "opacity-100")}>
          <Menu trigger={<IconButton label="Project actions" size="icon-sm" tooltip={false}><MoreHorizontal /></IconButton>} items={items} />
        </div>
      </li>
    </RightClickMenu>
  );
}

/** Live ad results for projects linked on the Performance page: 30-day spend, best hook rate, flags. */
function PerformanceStrip({ perf }: { perf: ProjectPerformance }) {
  const hook = perf.bestHookRate === undefined ? null : `${Math.round(perf.bestHookRate * 100)}% hook`;
  const title = `${perf.ads} linked ad${perf.ads === 1 ? "" : "s"} · ${perf.impressions.toLocaleString()} impressions in 30 days${perf.bestVariantKey ? ` · best variant ${perf.bestVariantKey}` : ""}`;
  return (
    <div className="tabular mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted" data-testid="project-performance" title={title}>
      <span>€{Math.round(perf.spend).toLocaleString()}</span>
      {hook && <><span aria-hidden>·</span><span>{hook}</span></>}
      {perf.winners > 0 && <Trophy className="size-3 text-success" aria-label={`${perf.winners} winning ad${perf.winners === 1 ? "" : "s"}`} />}
      {perf.fatigued > 0 && <TrendingDown className="size-3 text-warning" aria-label="Fatigued ad" />}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string) => { if (!done.current) { done.current = true; onDone(value); } };
  return (
    <input
      ref={ref}
      autoFocus
      defaultValue={initial}
      aria-label="Project name"
      onFocus={(e) => e.target.select()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(initial);
      }}
      className="relative z-10 h-7 w-full rounded-md border border-accent bg-surface px-2 text-sm text-fg ring-3 ring-accent/15 outline-none"
    />
  );
}

export function ProjectThumb({ project, className }: { project: Project; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [failed, setFailed] = useState(false);
  const image = project.avatar?.previewImageUrl;
  return (
    <div ref={ref} className={cn("relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-subtle text-fg-muted", className)}>
      {project.status === "done" && inView && !failed ? (
        <video
          src={`${videoUrl(project.id, project.updatedAt)}#t=1`}
          preload="metadata"
          muted
          playsInline
          onError={() => setFailed(true)}
          className="size-full object-cover"
          aria-hidden
        />
      ) : image && !failed ? (
        <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : project.avatar?.heygenAvatarId ? <UserRound className="size-4" /> : <Film className="size-4" />}
    </div>
  );
}
