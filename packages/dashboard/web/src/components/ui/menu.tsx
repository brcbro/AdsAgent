import { useRef, type ReactNode } from "react";
import { DropdownMenu as M, ContextMenu as C } from "radix-ui";
import { cn } from "@/lib/format";

const CONTENT = "z-50 min-w-48 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-lg animate-fade-in";
const ITEM = cn(
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg outline-none select-none",
  "data-[highlighted]:bg-subtle data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-muted",
);

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  description?: string;
  shortcut?: string;
  separatorBefore?: boolean;
  /** The item opens an inline editor: don't send focus back to the menu trigger when the menu closes. */
  keepFocus?: boolean;
}

function Items({ items, Item, Separator, onPick }:
  { items: MenuEntry[]; Item: typeof M.Item; Separator: typeof M.Separator; onPick: (item: MenuEntry) => void }) {
  return (
    <>
      {items.map((item) => (
        <div key={item.label}>
          {item.separatorBefore && <Separator className="my-1 h-px bg-line" />}
          <Item
            className={cn(ITEM, item.danger && "text-danger [&_svg]:text-danger data-[highlighted]:bg-danger-subtle", item.description && "items-start py-2")}
            disabled={item.disabled}
            onSelect={() => { onPick(item); item.onSelect?.(); }}
          >
            {item.icon}
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.label}</span>
              {item.description && <span className="mt-0.5 block text-xs font-normal text-fg-muted">{item.description}</span>}
            </span>
            {item.shortcut && <span className="text-xs text-fg-muted">{item.shortcut}</span>}
          </Item>
        </div>
      ))}
    </>
  );
}

/** Shared focus handling: remember whether the chosen item wants focus left where it puts it. */
function useKeepFocus() {
  const keep = useRef(false);
  return {
    onPick: (item: MenuEntry) => { keep.current = !!item.keepFocus; },
    onCloseAutoFocus: (e: Event) => { if (keep.current) { e.preventDefault(); keep.current = false; } },
  };
}

export function Menu({ trigger, items, align = "end", className }: { trigger: ReactNode; items: MenuEntry[]; align?: "start" | "end"; className?: string }) {
  const focus = useKeepFocus();
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className={cn(CONTENT, className)} onCloseAutoFocus={focus.onCloseAutoFocus}>
          <Items items={items} Item={M.Item} Separator={M.Separator} onPick={focus.onPick} />
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

/** Right-click menu with the same entries as the row's "…" menu. */
export function RightClickMenu({ children, items }: { children: ReactNode; items: MenuEntry[] }) {
  const focus = useKeepFocus();
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className={CONTENT} onCloseAutoFocus={focus.onCloseAutoFocus}>
          <Items items={items} Item={C.Item as unknown as typeof M.Item} Separator={C.Separator as unknown as typeof M.Separator} onPick={focus.onPick} />
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}
