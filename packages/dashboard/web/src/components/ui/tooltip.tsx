import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>{children}</Tooltip.Provider>;
}

export function Tip({ content, children, side = "top", shortcut }:
  { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; shortcut?: string }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-[100] flex max-w-72 items-center gap-2 rounded-md bg-inverse px-2.5 py-1.5 text-xs font-medium text-inverse-fg shadow-md animate-fade-in"
        >
          {content}
          {shortcut && <kbd className="rounded bg-inverse-fg/15 px-1.5 font-sans text-[11px] text-inverse-fg/80">{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
