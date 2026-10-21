import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { TopBar } from "./components/shell/TopBar";
import { ConnectionBanner } from "./components/shell/ConnectionBanner";
import { CommandPalette } from "./components/shell/CommandPalette";
import { ShortcutsDialog } from "./components/shell/ShortcutsDialog";
import { useShell } from "./components/shell/shell-context";
import { NewProjectDialog } from "./features/studio/NewProjectDialog";
import { StudioPage } from "./features/studio/StudioPage";
import { EmptyState, Spinner } from "./components/ui/primitives";
import { Button } from "./components/ui/button";
import { useHotkeys } from "./lib/hooks";
import { useThemeSync } from "./lib/theme";
import { Compass } from "lucide-react";

// Secondary pages load on demand to keep the editor's first paint small.
const AgentPage = lazy(() => import("./features/agent/AgentPage"));
const LibraryPage = lazy(() => import("./features/library/LibraryPage"));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage"));
const PerformancePage = lazy(() => import("./features/performance/PerformancePage"));

export function App() {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  useThemeSync();

  useHotkeys({
    "mod+k": () => shell.setPaletteOpen(!shell.paletteOpen),
    "?": () => shell.setShortcutsOpen(true),
    n: () => shell.setNewProjectOpen(true),
    "alt+1": () => navigate("/studio"),
    "alt+2": () => navigate("/agent"),
    "alt+3": () => navigate("/library"),
    "alt+4": () => navigate("/performance"),
    "alt+5": () => navigate("/settings"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <a href="#main" className="sr-only z-[200] rounded-md bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:absolute focus:top-2 focus:left-2">
        Skip to content
      </a>
      <TopBar />
      <ConnectionBanner />
      <main id="main" className="min-h-0 flex-1">
        {/* Per-page boundary: a failing view keeps the top bar, and navigating away resets it. */}
        <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<div className="grid h-full place-items-center"><Spinner className="size-6" /></div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/studio" replace />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/:projectId" element={<StudioPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/agent/:sessionId" element={<AgentPage />} />
            <Route path="/library" element={<Navigate to="/library/broll" replace />} />
            <Route path="/library/:tab" element={<LibraryPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={
              <EmptyState
                className="h-full"
                icon={<Compass />}
                title="Page not found"
                description="This address doesn't match any page in the studio."
                action={<Button variant="primary" onClick={() => navigate("/studio")}>Go to Studio</Button>}
              />
            } />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <CommandPalette />
      <ShortcutsDialog />
      <NewProjectDialog open={shell.newProjectOpen} onOpenChange={shell.setNewProjectOpen} />
    </div>
  );
}
