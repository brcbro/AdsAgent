import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { useNavigate } from "react-router";
import { BarChart3, Bot, Clapperboard, Film, Keyboard, Moon, Music, Plus, Settings, Sun, Video, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { PROJECT_STATUS, relativeTime } from "@/lib/format";
import { usePref } from "@/lib/prefs";
import { useProjects } from "@/lib/queries";
import { Badge } from "../ui/primitives";
import { useShell } from "./shell-context";

/** Ctrl/⌘+K: jump to any project or page, or run a common action. */
export function CommandPalette() {
  const shell = useShell();
  const navigate = useNavigate();
  const projects = useProjects().data ?? [];
  const [theme, setTheme] = usePref("theme");
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const run = (fn: () => void) => () => {
    shell.setPaletteOpen(false);
    fn();
  };

  return (
    <Dialog.Root open={shell.paletteOpen} onOpenChange={shell.setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay/30 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg animate-fade-in">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search projects, pages and actions</Dialog.Description>
          <Command label="Command palette" loop className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder="Search projects, pages and actions…"
              className="h-12 border-b border-line bg-transparent px-4 text-base text-fg outline-none placeholder:text-fg-muted"
            />
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">No results.</Command.Empty>
              <Group heading="Actions">
                <Item icon={<Plus />} onSelect={run(() => shell.setNewProjectOpen(true))} shortcut="N">New video</Item>
                <Item icon={<Bot />} onSelect={run(() => navigate("/agent"))}>Start a brief with the Agent</Item>
                <Item icon={<Keyboard />} onSelect={run(() => shell.setShortcutsOpen(true))} shortcut="?">Keyboard shortcuts</Item>
                <Item icon={isDark ? <Sun /> : <Moon />} onSelect={run(() => setTheme(isDark ? "light" : "dark"))}>
                  {isDark ? "Switch to light theme" : "Switch to dark theme"}
                </Item>
              </Group>
              <Group heading="Go to">
                <Item icon={<Clapperboard />} onSelect={run(() => navigate("/studio"))} shortcut="Alt 1">Studio</Item>
                <Item icon={<Bot />} onSelect={run(() => navigate("/agent"))} shortcut="Alt 2">Agent</Item>
                <Item icon={<Film />} onSelect={run(() => navigate("/library/broll"))} shortcut="Alt 3">B-roll library</Item>
                <Item icon={<Music />} onSelect={run(() => navigate("/library/music"))}>Music library</Item>
                <Item icon={<UserRound />} onSelect={run(() => navigate("/library/avatars"))}>Avatar library</Item>
                <Item icon={<BarChart3 />} onSelect={run(() => navigate("/performance"))} shortcut="Alt 4">Performance</Item>
                <Item icon={<Settings />} onSelect={run(() => navigate("/settings"))} shortcut="Alt 5">Settings</Item>
              </Group>
              {projects.length > 0 && (
                <Group heading="Projects">
                  {projects.slice(0, 50).map((p) => (
                    <Item
                      key={p.id}
                      value={`${p.title} ${p.id}`}
                      icon={<Video />}
                      onSelect={run(() => navigate(`/studio/${p.id}`))}
                      trailing={<Badge tone={PROJECT_STATUS[p.status]?.tone}>{PROJECT_STATUS[p.status]?.label ?? p.status}</Badge>}
                    >
                      <span className="truncate">{p.title || p.id}</span>
                      <span className="ml-2 shrink-0 text-xs text-fg-muted">{relativeTime(p.updatedAt)}</span>
                    </Item>
                  ))}
                </Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted"
    >
      {children}
    </Command.Group>
  );
}

function Item({ icon, children, onSelect, shortcut, trailing, value }:
  { icon: ReactNode; children: ReactNode; onSelect: () => void; shortcut?: string; trailing?: ReactNode; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm text-fg data-[selected=true]:bg-subtle [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-muted"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      {trailing}
      {shortcut && <span className="text-xs text-fg-muted">{shortcut}</span>}
    </Command.Item>
  );
}
