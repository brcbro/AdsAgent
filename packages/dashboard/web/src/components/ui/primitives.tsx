import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Switch as RadixSwitch, ToggleGroup } from "radix-ui";
import { Loader2, RotateCcw, Search, X } from "lucide-react";
import { cn, type Tone } from "@/lib/format";
import { Tip } from "./tooltip";

const FIELD = cn(
  "w-full rounded-md border border-line bg-surface text-sm text-fg shadow-xs placeholder:text-fg-muted",
  "transition-[border-color,box-shadow] duration-150 hover:border-line-strong",
  "focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none",
  "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-muted",
);

export function Input({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(FIELD, "h-9 px-3", className)} {...props} />;
}

export function Textarea({ className, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cn(FIELD, "px-3 py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        FIELD,
        "select-chevron h-9 appearance-none pr-9 pl-3",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className, label, ref }:
  { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string; ref?: Ref<HTMLInputElement> }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-muted hover:bg-subtle hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Label({ htmlFor, children, hint, className }: { htmlFor?: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1.5 flex items-baseline justify-between gap-2", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">{children}</label>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </div>
  );
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 text-xs leading-relaxed text-fg-muted", className)}>{children}</p>;
}

const TONES: Record<Tone, string> = {
  neutral: "bg-subtle text-fg-secondary border-line",
  accent: "bg-accent-subtle text-accent border-accent/20",
  success: "bg-success-subtle text-success border-success/20",
  warning: "bg-warning-subtle text-warning border-warning/20",
  danger: "bg-danger-subtle text-danger border-danger/20",
  info: "bg-info-subtle text-info border-info/20",
};
const DOTS: Record<Tone, string> = {
  neutral: "bg-fg-muted", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info",
};

export function Badge({ tone = "neutral", dot, pulse, children, className }:
  { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOTS[tone], pulse && "animate-pulse-soft")} aria-hidden />}
      {children}
    </span>
  );
}

export function Switch({ checked, onCheckedChange, id, disabled, label }:
  { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; disabled?: boolean; label?: string }) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-muted-surface transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}

/** A full-width row whose whole surface toggles the switch. */
export function SwitchRow({ title, description, checked, onCheckedChange, disabled }:
  { title: string; description?: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-4 rounded-lg border border-line bg-surface px-3.5 py-3", disabled && "opacity-60")}>
      <label htmlFor={id} className={cn("min-w-0 flex-1", !disabled && "cursor-pointer")}>
        <span className="block text-sm font-medium text-fg">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Slider with a precise number input and a reset-to-default button. */
export function RangeField({ label, value, onChange, min, max, step = 1, unit = "", defaultValue, disabled, hint, format, scale = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string;
  defaultValue?: number; disabled?: boolean; hint?: ReactNode; format?: (v: number) => string; scale?: number;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const display = Math.round((value * scale) * 100) / 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>
        <div className="flex items-center gap-1">
          {defaultValue !== undefined && value !== defaultValue && !disabled && (
            <Tip content={`Reset to ${format ? format(defaultValue) : defaultValue * scale + unit}`}>
              <button type="button" onClick={() => onChange(defaultValue)} aria-label={`Reset ${label}`}
                className="grid size-6 place-items-center rounded text-fg-muted hover:bg-subtle hover:text-fg">
                <RotateCcw className="size-3.5" />
              </button>
            </Tip>
          )}
          <div className="flex h-7 items-center rounded-md border border-line bg-surface pr-2 shadow-xs focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
            <input
              type="number"
              value={display}
              min={min * scale}
              max={max * scale}
              step={step * scale}
              disabled={disabled}
              aria-label={`${label} value`}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(clamp(v / scale)); }}
              className="tabular w-12 bg-transparent pl-2 text-right text-sm text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            {unit && <span className="pl-0.5 text-xs text-fg-muted">{unit}</span>}
          </div>
        </div>
      </div>
      <input
        id={id}
        type="range"
        className="range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--fill" as string]: `${fill}%` }}
        aria-valuetext={format ? format(value) : `${display}${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <Hint className="mt-1">{hint}</Hint>}
    </div>
  );
}

/** Single-choice segmented control (radio semantics, arrow-key navigation). */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md", disabled, className }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; title?: string }>;
  label: string; size?: "sm" | "md"; disabled?: boolean; className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      disabled={disabled}
      className={cn("inline-flex rounded-md border border-line bg-subtle p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          title={o.title}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[5px] font-medium text-fg-muted transition-all duration-150 whitespace-nowrap",
            "hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-sm disabled:opacity-50 [&_svg]:size-3.5",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "press inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150",
        active ? "border-accent bg-accent-subtle text-accent" : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:text-fg",
      )}
    >
      {children}
      {count !== undefined && <span className={cn("tabular", active ? "text-accent/70" : "text-fg-muted")}>{count}</span>}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse-soft rounded-md bg-muted-surface/70", className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-accent", className)} aria-hidden />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-subtle px-1.5 font-sans text-[11px] font-medium text-fg-secondary">{children}</kbd>;
}

export function EmptyState({ icon, title, description, action, className, dark }:
  { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center animate-fade-in", className)}>
      <div className={cn("mb-4 grid size-12 place-items-center rounded-xl border [&_svg]:size-5",
        dark ? "border-white/10 bg-white/5 text-white/70" : "border-line bg-surface text-fg-muted shadow-sm")}>{icon}</div>
      <h3 className={cn("text-lg font-semibold", dark ? "text-white" : "text-fg")}>{title}</h3>
      {description && <p className={cn("mt-1 max-w-sm text-sm", dark ? "text-white/60" : "text-fg-muted")}>{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Titled group of controls inside the inspector. */
export function Section({ title, description, actions, children, className }:
  { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-b border-line px-4 py-4 last:border-b-0", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function KeyValue({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line rounded-lg border border-line bg-surface">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-3 px-3 py-2">
          <dt className="shrink-0 text-xs text-fg-muted">{item.label}</dt>
          <dd className="min-w-0 truncate text-right text-sm text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ value, indeterminate, className }: { value?: number; indeterminate?: boolean; className?: string }) {
  return (
    <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted-surface", className)} role="progressbar"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(value ?? 0)}>
      {indeterminate
        ? <div className="absolute inset-y-0 w-2/5 rounded-full bg-accent animate-indeterminate" />
        : <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${value ?? 0}%` }} />}
    </div>
  );
}
