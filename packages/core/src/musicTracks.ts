import fs from "node:fs";
import path from "node:path";
import { MUSIC_DIR, REPO_ROOT } from "./paths.js";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  /** Path relative to repo root, e.g. data/music/01-funk-abnormal.mp3 */
  file: string;
  /** yt-dlp search query (preferred — direct URLs often go unavailable) */
  searchQuery: string;
  youtubeUrl?: string;
};

/** Top phonk / reel background tracks — synced via `pnpm music-sync`. */
export const MUSIC_TRACKS: MusicTrack[] = [
  {
    id: "funk-abnormal",
    title: "FUNK ABNORMAL (Ultra Slowed)",
    artist: "DJ V12",
    file: "data/music/01-funk-abnormal.mp3",
    searchQuery: "DJ V12 FUNK ABNORMAL ultra slowed",
    youtubeUrl: "https://www.youtube.com/watch?v=vv-jaSGbNhQ",
  },
  {
    id: "metamorphosis",
    title: "METAMORPHOSIS",
    artist: "INTERWORLD",
    file: "data/music/02-metamorphosis.mp3",
    searchQuery: "INTERWORLD METAMORPHOSIS phonk",
  },
  {
    id: "close-eyes",
    title: "Close Eyes",
    artist: "DVRST",
    file: "data/music/03-close-eyes.mp3",
    searchQuery: "DVRST Close Eyes slowed",
  },
  {
    id: "phonky-town",
    title: "Phonky Town",
    artist: "PlayaPhonk",
    file: "data/music/04-phonky-town.mp3",
    searchQuery: "PlayaPhonk Phonky Town",
  },
  {
    id: "murder-in-my-mind",
    title: "Murder In My Mind",
    artist: "Kordhell",
    file: "data/music/05-murder-in-my-mind.mp3",
    searchQuery: "Kordhell Murder In My Mind phonk",
  },
  {
    id: "after-dark",
    title: "After Dark",
    artist: "Mr.Kitty",
    file: "data/music/06-after-dark.mp3",
    searchQuery: "Mr Kitty After Dark slowed",
  },
  {
    id: "scopin",
    title: "Scopin",
    artist: "Kordhell",
    file: "data/music/07-scopin.mp3",
    searchQuery: "Kordhell Scopin phonk",
  },
  {
    id: "giga-chad",
    title: "Can You Feel My Heart (Phonk)",
    artist: "Bring Me The Horizon",
    file: "data/music/08-giga-chad.mp3",
    searchQuery: "Can You Feel My Heart phonk remix slowed",
  },
  {
    id: "why-not",
    title: "Why Not",
    artist: "Ghostface Playa",
    file: "data/music/09-why-not.mp3",
    searchQuery: "Ghostface Playa Why Not phonk",
  },
  {
    id: "king",
    title: "King",
    artist: "Kanade",
    file: "data/music/10-king.mp3",
    searchQuery: "Kanade King phonk slowed",
  },
];

export function getMusicTrack(id: string): MusicTrack | undefined {
  return MUSIC_TRACKS.find((t) => t.id === id);
}

export function getMusicTrackByFile(file: string): MusicTrack | undefined {
  return MUSIC_TRACKS.find((t) => t.file === file);
}

export function musicTrackAvailable(track: MusicTrack): boolean {
  return fs.existsSync(path.join(REPO_ROOT, track.file));
}

export function listMusicTracksForApi(): Array<
  MusicTrack & { available: boolean; previewUrl: string }
> {
  return MUSIC_TRACKS.map((t) => ({
    ...t,
    available: musicTrackAvailable(t),
    previewUrl: `/data/music/${path.basename(t.file)}`,
  }));
}

/** Legacy default path — first track in catalog. */
export const DEFAULT_MUSIC_FILE = MUSIC_TRACKS[0].file;

export function ensureMusicDir(): string {
  if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });
  return MUSIC_DIR;
}
