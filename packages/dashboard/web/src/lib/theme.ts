import { useEffect } from "react";
import { usePref } from "./prefs";

/** Applies the saved theme to <html data-theme> and follows the OS setting when "system" is chosen. */
export function useThemeSync() {
  const [theme] = usePref("theme");
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mql.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111114" : "#ffffff");
    };
    apply();
    if (theme !== "system") return;
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [theme]);
}
