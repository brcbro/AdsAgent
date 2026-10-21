export type WordTimestamp = {
  word: string;
  startMs: number;
  endMs: number;
};

export type Beat = {
  startMs: number;
  endMs: number;
  kind: "talking_head" | "broll";
  clipPath?: string;
  clipInMs?: number;
};

export type CaptionStyle = {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  activeColor?: string;
  stroke: string;
  shadow: string;
  bottomPercent: number;
  background?: string;
  letterSpacing?: string;
  fontStyle?: string;
  popIn?: boolean;
  mode: "phrase" | "word";
  phraseWords?: number;
};

export type SegmentProps = {
  id: string;
  durationMs: number;
  avatarSrc?: string;
  audioSrc?: string;
  words: WordTimestamp[];
  beats: Beat[];
};

export type AdProps = {
  segments: SegmentProps[];
  musicSrc?: string;
  musicVolume?: number;
  musicStartMs?: number;
  captionStyle?: CaptionStyle;
  avatarZoom?: number;
  muteAvatar?: boolean;
  avatarVolume?: number;
  aspectRatio?: "9:16" | "16:9";
};

export const FPS = 30;

export const msToFrames = (ms: number): number => Math.round((ms / 1000) * FPS);

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
  fontWeight: 600,
  fontSize: 32,
  color: "#FFFFFF",
  stroke: "none",
  shadow: "none",
  bottomPercent: 18,
  background: "rgba(0,0,0,0.72)",
  mode: "phrase",
  phraseWords: 5,
};
