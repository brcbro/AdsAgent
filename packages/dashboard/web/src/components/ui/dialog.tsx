import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog as D, AlertDialog as A } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/format";
import { Button, buttonClass } from "./button";

/*
 * Shared modal: Radix provides role="dialog", aria-modal, focus trap, focus return and Esc /
 * backdrop dismissal for every dialog in the app.
 */

const OVERLAY = "fixed inset-0 z-50 bg-overlay/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in";
const CONTENT = cn(
  "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col",
  "rounded-lg border border-line bg-surface shadow-lg outline-none data-[state=open]:animate-scale-in",
);

const WIDTHS = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" } as const;

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", headerExtra, bodyClassName }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode;
  footer?: ReactNode; size?: keyof typeof WIDTHS; headerExtra?: ReactNode; bodyClassName?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={OVERLAY} />
        <D.Content className={cn(CONTENT, WIDTHS[size])}>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
              {description
                ? <D.Description className="mt-0.5 text-sm text-fg-muted">{description}</D.Description>
                : <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>}
            </div>
            {headerExtra}
            <D.Close className={buttonClass("ghost", "icon-sm", "-mt-1 -mr-2")} aria-label="Close">
              <X />
            </D.Close>
          </div>
          {children !== undefined && <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-bg/60 px-5 py-3 rounded-b-lg">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Optional extra content, e.g. a "don't ask again" checkbox. */
  body?: ReactNode;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...})) …` — one accessible alert dialog for the whole app. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    resolver.current?.(false);
    setOptions(opts);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <A.Root open={!!options} onOpenChange={(open) => { if (!open) close(false); }}>
        <A.Portal>
          <A.Overlay className={OVERLAY} />
          <A.Content className={cn(CONTENT, "max-w-md")}>
            <div className="px-5 pt-5 pb-4">
              <A.Title className="text-lg font-semibold text-fg">{options?.title}</A.Title>
              <A.Description asChild>
                <div className="mt-1.5 text-sm leading-relaxed text-fg-secondary">{options?.description}</div>
              </A.Description>
              {options?.body && <div className="mt-4">{options.body}</div>}
            </div>
            <div className="flex justify-end gap-2 rounded-b-lg border-t border-line bg-bg/60 px-5 py-3">
              <A.Cancel asChild><Button variant="secondary">{options?.cancelLabel ?? "Cancel"}</Button></A.Cancel>
              <A.Action asChild>
                <Button variant={options?.tone === "danger" ? "danger" : "primary"} onClick={() => close(true)}>
                  {options?.confirmLabel ?? "Confirm"}
                </Button>
              </A.Action>
            </div>
          </A.Content>
        </A.Portal>
      </A.Root>
    </ConfirmContext.Provider>
  );
}
