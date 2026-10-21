import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/format";
import { Tip } from "./tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost" | "on-dark";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg shadow-xs hover:bg-accent-hover",
  secondary: "bg-surface text-fg border border-line shadow-xs hover:bg-subtle hover:border-line-strong",
  ghost: "text-fg-secondary hover:bg-subtle hover:text-fg",
  danger: "bg-danger text-danger-fg shadow-xs hover:bg-danger-hover",
  "danger-ghost": "text-danger hover:bg-danger-subtle",
  "on-dark": "text-white/85 hover:bg-white/10 hover:text-white",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md",
  lg: "h-10 px-4 text-base gap-2 rounded-md",
  icon: "size-9 rounded-md",
  "icon-sm": "size-8 rounded-md",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "press inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none",
    "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, loading, asChild, className, children, disabled, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      className={buttonClass(variant, size, className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? children : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}

/** Icon-only button: the label is required and doubles as its tooltip. */
export function IconButton({ label, children, tooltip = true, size = "icon", variant = "ghost", ...props }:
  Omit<ButtonProps, "children"> & { label: string; children: ReactNode; tooltip?: boolean }) {
  const button = <Button aria-label={label} size={size} variant={variant} {...props}>{children}</Button>;
  return tooltip ? <Tip content={label}>{button}</Tip> : button;
}

/**
 * A disabled control can't show a tooltip (it receives no pointer events), so this wraps it in a
 * focusable span that explains why it is unavailable.
 */
export function DisabledReason({ reason, children, className }: { reason?: string | null; children: ReactNode; className?: string }) {
  if (!reason) return <>{children}</>;
  return (
    <Tip content={reason}>
      <span tabIndex={0} className={cn("inline-flex", className)} aria-label={reason}>{children}</span>
    </Tip>
  );
}
