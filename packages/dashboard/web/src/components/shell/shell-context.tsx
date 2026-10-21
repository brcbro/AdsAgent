import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface ShellState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  newProjectOpen: boolean;
  setNewProjectOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

/** App-wide overlays that can be opened from anywhere (top bar, command palette, shortcuts). */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const value = useMemo(
    () => ({ paletteOpen, setPaletteOpen, shortcutsOpen, setShortcutsOpen, newProjectOpen, setNewProjectOpen }),
    [paletteOpen, shortcutsOpen, newProjectOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside ShellProvider");
  return ctx;
}
