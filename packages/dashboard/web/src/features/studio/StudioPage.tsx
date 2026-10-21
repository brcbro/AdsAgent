import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, FileQuestion, PanelLeftOpen, Plus, Sparkles } from "lucide-react";
import { useProject, useProjects } from "@/lib/queries";
import { usePref } from "@/lib/prefs";
import { useHotkeys, useMediaQuery } from "@/lib/hooks";
import { cn } from "@/lib/format";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useShell } from "@/components/shell/shell-context";
import { ProjectSidebar } from "./ProjectSidebar";
import { Stage } from "./Stage";
import { Inspector } from "./Inspector";
import { StudioContext, type StudioState } from "./studio-context";
import { useProjectDraft } from "./useProjectDraft";
import { useRenderActions } from "./useRenderActions";
import { useVideoVersion } from "./useVideoVersion";

export function StudioPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const shell = useShell();
  const projects = useProjects();
  const [collapsed, setCollapsed] = usePref("sidebarCollapsed");
  const wide = useMediaQuery("(min-width: 1024px)");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // /studio with no id opens the most recent project.
  useEffect(() => {
    if (!projectId && projects.data?.length) navigate(`/studio/${projects.data[0].id}`, { replace: true });
  }, [projectId, projects.data, navigate]);

  useEffect(() => setDrawerOpen(false), [projectId]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  useHotkeys({ "[": () => (wide ? setCollapsed(!collapsed) : setDrawerOpen((o) => !o)) });

  const sidebar = <ProjectSidebar activeId={projectId} onCollapse={wide ? () => setCollapsed(true) : () => setDrawerOpen(false)} />;

  return (
    <div className="flex h-full min-h-0">
      {wide && !collapsed && sidebar}
      {!wide && drawerOpen && (
        <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Projects">
          <div className="absolute inset-0 bg-overlay/30 animate-fade-in" onClick={() => setDrawerOpen(false)} />
          <div className="relative h-full animate-slide-in shadow-lg">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {(!wide || collapsed) && (
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
            <IconButton label="Show projects" size="icon-sm" onClick={() => (wide ? setCollapsed(false) : setDrawerOpen(true))}>
              <PanelLeftOpen />
            </IconButton>
            <span className="text-sm font-medium text-fg-muted">Projects</span>
          </div>
        )}
        {projects.isPending ? (
          <StudioSkeleton />
        ) : !projects.data?.length && !projectId ? (
          <EmptyState
            className="h-full"
            icon={<Sparkles />}
            title="Create your first video"
            description="Start from a German script with captions, music and B-roll — or describe what you need and let the agent write it."
            action={<>
              <Button variant="primary" size="lg" onClick={() => shell.setNewProjectOpen(true)}><Plus /> New video</Button>
              <Button variant="secondary" size="lg" onClick={() => navigate("/agent")}><Bot /> Start with the Agent</Button>
            </>}
          />
        ) : projectId ? (
          <ProjectWorkspace key={projectId} projectId={projectId} />
        ) : null}
      </div>
    </div>
  );
}

function ProjectWorkspace({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const query = useProject(projectId);
  const project = query.data;
  const draft = useProjectDraft(project);
  const actions = useRenderActions(project, draft);
  const videoVersion = useVideoVersion(project);
  const [adjustingCaptions, setAdjustingCaptions] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("script");
  const wide = useMediaQuery("(min-width: 1024px)");

  useHotkeys({
    "mod+s": () => void draft.saveNow(),
    "mod+enter": () => void actions.run(actions.primary),
  });

  useEffect(() => { if (project?.status !== "done") setAdjustingCaptions(false); }, [project?.status]);

  const value = useMemo<StudioState | null>(() => project ? ({
    project, draft, actions, videoVersion, adjustingCaptions, setAdjustingCaptions, inspectorTab, setInspectorTab,
  }) : null, [project, draft, actions, videoVersion, adjustingCaptions, inspectorTab]);

  if (query.isError) {
    return (
      <EmptyState
        className="h-full"
        icon={<FileQuestion />}
        title="Project not found"
        description="It may have been archived, or the link is out of date."
        action={<Button variant="primary" onClick={() => navigate("/studio")}>Open latest project</Button>}
      />
    );
  }
  if (!value || !draft.draft) return <StudioSkeleton />;

  return (
    <StudioContext.Provider value={value}>
      <div className={cn("flex min-h-0 flex-1", wide ? "flex-row" : "flex-col overflow-y-auto")}>
        <Stage />
        <Inspector />
      </div>
    </StudioContext.Provider>
  );
}

function StudioSkeleton() {
  return (
    <div className="flex min-h-0 flex-1" aria-busy="true" aria-label="Loading project">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="flex-1 rounded-xl" />
      </div>
      <div className="hidden w-[380px] flex-col gap-3 border-l border-line bg-surface p-4 lg:flex">
        <Skeleton className="h-16" />
        <Skeleton className="h-9" />
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
