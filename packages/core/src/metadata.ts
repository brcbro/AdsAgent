import { z } from "zod";

export const MusicConfig = z.object({
  enabled: z.boolean().default(true),
  file: z.string().default("data/music/funk-bed.mp3"),
  volume: z.number().min(0).max(1).default(0.2),
  startOffsetMs: z.number().optional(),
  youtubeUrl: z.string().optional(),
  title: z.string().optional(),
  /** Lower the music while the voice speaks (ffmpeg renderer). Unset means on; set false to disable. */
  duck: z.boolean().optional(),
});
export type MusicConfig = z.infer<typeof MusicConfig>;

export const CaptionConfig = z.object({
  presetId: z.string().default("meta-clean"),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  bottomPercent: z.number().optional(),
  /** Set to "none" to disable caption background pill. */
  background: z.string().optional(),
});
export type CaptionConfig = z.infer<typeof CaptionConfig>;

export const AvatarConfig = z.object({
  heygenAvatarId: z.string(),
  name: z.string().optional(),
  previewImageUrl: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
});
export type AvatarConfig = z.infer<typeof AvatarConfig>;

export const ProjectMetadata = z.object({
  id: z.string(),
  title: z.string(),
  scriptDe: z.string(),
  introMs: z.number().min(3000).max(10000).default(6000),
  avatarZoom: z.number().min(1).max(2.5).default(1),
  aspectRatio: z.enum(["9:16", "16:9"]).default("16:9"),
  /** Baked into final MP4 via ffmpeg (e.g. 1.2 = 20% faster). */
  outputSpeed: z.number().min(0.5).max(2).default(1),
  /** When true, entire video stays on talking-head avatar (no B-roll cuts). */
  fullAvatar: z.boolean().default(false),
  /** B-roll clip length in ms (lower = faster cuts). */
  brollCutMs: z.number().min(600).max(4000).optional(),
  /** Alternate avatar ↔ B-roll for editor-style pacing. */
  fastCuts: z.boolean().default(false),
  /** Catalog clip files that must appear in the video (placed where they match the script best). */
  brollPinned: z.array(z.string()).optional(),
  /** Catalog clip files never used for this project. */
  brollExcluded: z.array(z.string()).optional(),
  avatar: AvatarConfig,
  /** When true, avatar clip audio is omitted from the final render. */
  muteAvatar: z.boolean().default(false),
  /** Avatar voice gain (HeyGen clips are quiet vs music beds). */
  avatarVolume: z.number().min(0).max(3).default(1.4),
  music: MusicConfig.optional(),
  captions: CaptionConfig.optional(),
  status: z.enum(["draft", "generating", "rendering", "done", "error"]).default("draft"),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  outputFile: z.string().optional(),
});
export type ProjectMetadata = z.infer<typeof ProjectMetadata>;

import { DEFAULT_MUSIC_FILE, MUSIC_TRACKS } from "./musicTracks.js";

export const DEFAULT_MUSIC: MusicConfig = {
  enabled: true,
  file: DEFAULT_MUSIC_FILE,
  volume: 0.2,
  youtubeUrl: MUSIC_TRACKS[0]?.youtubeUrl,
  title: `${MUSIC_TRACKS[0]?.title} — ${MUSIC_TRACKS[0]?.artist}`,
};
