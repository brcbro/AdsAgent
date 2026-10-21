import { Dialog } from "../ui/dialog";
import { Kbd } from "../ui/primitives";
import { useShell } from "./shell-context";

const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

export const SHORTCUTS: Array<{ group: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    group: "General",
    items: [
      { keys: [mod, "K"], label: "Search and commands" },
      { keys: ["N"], label: "New video" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Alt", "1–5"], label: "Studio · Agent · Library · Performance · Settings" },
    ],
  },
  {
    group: "Studio",
    items: [
      { keys: [mod, "S"], label: "Save now" },
      { keys: [mod, "Enter"], label: "Run the primary render action" },
      { keys: ["["], label: "Toggle project sidebar" },
    ],
  },
  {
    group: "Player",
    items: [
      { keys: ["Space"], label: "Play / pause" },
      { keys: ["J"], label: "Back 5 seconds" },
      { keys: ["K"], label: "Play / pause" },
      { keys: ["L"], label: "Forward 5 seconds" },
      { keys: [",", "."], label: "Step one frame back / forward" },
      { keys: ["M"], label: "Mute / unmute" },
      { keys: ["F"], label: "Fullscreen" },
      { keys: ["↑", "↓"], label: "Move caption line (while adjusting)" },
    ],
  },
  {
    group: "Agent",
    items: [
      { keys: ["Enter"], label: "Send brief" },
      { keys: ["Shift", "Enter"], label: "New line" },
    ],
  },
];

export function ShortcutsDialog() {
  const shell = useShell();
  return (
    <Dialog open={shell.shortcutsOpen} onOpenChange={shell.setShortcutsOpen} title="Keyboard shortcuts" size="lg">
      <div className="grid gap-6 sm:grid-cols-2">
        {SHORTCUTS.map((group) => (
          <section key={group.group}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">{group.group}</h3>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-fg-secondary">{item.label}</span>
                  <span className="flex shrink-0 gap-1">{item.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
