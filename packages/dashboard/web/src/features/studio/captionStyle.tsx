import type { CSSProperties } from "react";
import type { CaptionPreset } from "@/lib/types";

/** CSS approximation of a caption preset for previews (the real render uses ffmpeg ASS styles). */
export function captionCss(p: CaptionPreset, fontSize: number): CSSProperties {
  const hasBg = p.background && p.background !== "transparent" && p.background !== "none";
  return {
    fontFamily: p.fontFamily,
    fontWeight: p.fontWeight,
    fontStyle: p.fontStyle,
    fontSize,
    color: p.color,
    letterSpacing: p.letterSpacing,
    lineHeight: 1.2,
    WebkitTextStroke: p.stroke && p.stroke !== "none" ? p.stroke : undefined,
    textShadow: p.shadow && p.shadow !== "none" ? p.shadow : undefined,
    ...(hasBg ? {
      background: p.background,
      padding: `${Math.round(fontSize * 0.28)}px ${Math.round(fontSize * 0.45)}px`,
      borderRadius: Math.round(fontSize * 0.25),
      display: "inline-block",
    } : {}),
  };
}

export function CaptionSample({ preset, fontSize, text }: { preset: CaptionPreset; fontSize: number; text?: string }) {
  if (preset.mode === "word") {
    return <span style={captionCss(preset, fontSize)}><span style={{ color: preset.activeColor || preset.color }}>{text?.split(" ")[0] ?? "Trading"}</span></span>;
  }
  return <span className="text-center" style={captionCss(preset, fontSize)}>{text ?? "Die meisten Trader scheitern"}</span>;
}
