import { useEffect, useRef, useState, type RefCallback } from "react";

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

type Handler = (e: KeyboardEvent) => void;

/**
 * Global keyboard shortcuts. Keys are written like "mod+k", "shift+?", "space", "j".
 * "mod" is Ctrl on Windows/Linux and ⌘ on macOS. Plain keys are ignored while typing in a field.
 */
export function useHotkeys(bindings: Record<string, Handler>, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key === " " ? "space" : e.key.toLowerCase();
      const combo = `${mod ? "mod+" : ""}${e.altKey ? "alt+" : ""}${key}`;
      const handler = ref.current[combo];
      if (!handler) return;
      if (!mod && isTypingTarget(e.target)) return;
      // Leave keys alone while a dialog or menu owns focus.
      if (!mod && document.querySelector("[role=dialog][data-state=open],[role=alertdialog][data-state=open],[role=menu]")) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Re-render on an interval (for "elapsed" timers and relative times). */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function useInView<T extends Element>(rootMargin = "200px"): [RefCallback<T>, boolean] {
  const [inView, setInView] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref: RefCallback<T> = (node) => {
    observer.current?.disconnect();
    if (!node || inView) return;
    observer.current = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.current?.disconnect(); }
    }, { rootMargin });
    observer.current.observe(node);
  };
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, inView];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
