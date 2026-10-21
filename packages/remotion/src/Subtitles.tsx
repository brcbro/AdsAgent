import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { CaptionStyle, FPS, WordTimestamp, msToFrames } from "./types";

function activeWordIndex(words: WordTimestamp[], nowMs: number): number {
  const idx = words.findIndex((w) => nowMs >= w.startMs && nowMs < w.endMs);
  if (idx >= 0) return idx;
  for (let i = words.length - 1; i >= 0; i--) {
    if (nowMs >= words[i].endMs && nowMs < words[i].endMs + 300) return i;
  }
  return -1;
}

export const Subtitles: React.FC<{ words: WordTimestamp[]; style: CaptionStyle }> = ({
  words,
  style,
}) => {
  const frame = useCurrentFrame();
  const nowMs = (frame / FPS) * 1000;
  const activeIdx = activeWordIndex(words, nowMs);
  if (activeIdx < 0) return null;

  const phraseSize = style.phraseWords ?? 5;
  const start = Math.max(0, activeIdx - Math.floor(phraseSize / 2));
  const phrase = words.slice(start, start + phraseSize);
  const localActive = activeIdx - start;

  const container: React.CSSProperties = {
    position: "absolute",
    bottom: `${style.bottomPercent}%`,
    width: "100%",
    display: "flex",
    justifyContent: "center",
    padding: "0 48px",
    boxSizing: "border-box",
    zIndex: 100,
    pointerEvents: "none",
  };

  const pill: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSize: style.fontSize,
    textAlign: "center",
    lineHeight: 1.35,
    maxWidth: "92%",
    background: style.background,
    padding: style.background ? "10px 18px" : undefined,
    borderRadius: style.background ? 10 : undefined,
    letterSpacing: style.letterSpacing,
  };

  if (style.mode === "word") {
    const w = words[activeIdx];
    const wordStartFrame = msToFrames(w.startMs);
    const elapsed = Math.max(0, frame - wordStartFrame);
    const popScale =
      style.popIn === true
        ? interpolate(elapsed, [0, 7], [0.75, 1], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.back(1.6)),
          })
        : 1;
    return (
      <div style={container}>
        <span
          style={{
            ...pill,
            display: "inline-block",
            transform: `scale(${popScale})`,
            transformOrigin: "center center",
            color: style.activeColor ?? style.color,
            WebkitTextStroke: style.stroke === "none" ? undefined : style.stroke,
            textShadow: style.shadow === "none" ? undefined : style.shadow,
          }}
        >
          {w.word}
        </span>
      </div>
    );
  }

  return (
    <div style={container}>
      <span style={pill}>
        {phrase.map((w, i) => (
          <span
            key={`${w.startMs}-${i}`}
            style={{
              color: i === localActive ? (style.activeColor ?? style.color) : style.color,
              fontWeight: i === localActive ? style.fontWeight + 100 : style.fontWeight,
              fontStyle: style.fontStyle,
              WebkitTextStroke: style.stroke === "none" ? undefined : style.stroke,
              textShadow: style.shadow === "none" ? undefined : style.shadow,
              marginRight: i < phrase.length - 1 ? "0.35em" : 0,
            }}
          >
            {w.word}
          </span>
        ))}
      </span>
    </div>
  );
};
