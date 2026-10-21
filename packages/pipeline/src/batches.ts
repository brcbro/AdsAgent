/**
 * Named batch definitions for `pnpm batch-run <name>`.
 *
 * Each entry replaces one of the former dated scripts (batch-5-*, batch-10,
 * jun17-*, jun20-*, produce-pair, demo, test-one). The ad copy is unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_MUSIC,
  MUSIC_TRACKS,
  ProjectMetadata,
  REPO_ROOT,
} from "@ai-ads/core";
import { config } from "./config.js";
import { loadMetadata } from "./produce.js";
import { FACTORY_CAPTIONS } from "./factory.js";

/** A project as written in this file. Fields with schema defaults may be omitted. */
export type BatchJob = Omit<z.input<typeof ProjectMetadata>, "createdAt" | "updatedAt" | "status">;

export type BatchDef = {
  description: string;
  /** Output folder under video/ when VIDEO_SESSION is not set. */
  session?: string;
  /**
   * sequential: one project at a time in this process.
   * parallel: one `produce` process per project, all at once (adds --shuffle-broll).
   */
  mode: "sequential" | "parallel";
  /** Use factory settings: ElevenLabs voice, semantic B-roll, ffmpeg render. */
  factory?: boolean;
  /** Reuse saved avatar clips instead of calling HeyGen. */
  skipHeygen?: boolean;
  jobs: () => BatchJob[];
};

function cachedAvatars(): { heygenAvatarId: string; name: string }[] {
  const cachePath = path.join(REPO_ROOT, "data", "avatars.json");
  if (fs.existsSync(cachePath)) {
    const list = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as { avatar_id: string; avatar_name: string }[];
    if (list.length) return list.map((a) => ({ heygenAvatarId: a.avatar_id, name: a.avatar_name }));
  }
  return [{ heygenAvatarId: config.heygenAvatarId(), name: "Default" }];
}

function availableTracks() {
  return MUSIC_TRACKS.filter((t) => fs.existsSync(path.join(REPO_ROOT, t.file)));
}

function shuffled<T>(items: T[]): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// ── trading-intro (was batch.ts) ───────────────────────────────────────────────

const TRADING_INTRO: Omit<BatchJob, "avatar">[] = [
  {
    id: "batch_01_trading",
    title: "Trading System DE",
    scriptDe:
      "Die meisten verlieren beim Trading, weil sie ohne System raten. Kein Risikomanagement, keine klaren Regeln — nur Bauchgefühl. In unserem Training lernst du strukturiert: Einstiege planen, Verluste begrenzen, diszipliniert handeln. Kein Finfluencer-Hype. Echtes Handwerk für echte Ergebnisse. Starte jetzt mit einem klaren System.",
    introMs: 5000,
    music: { ...DEFAULT_MUSIC, volume: 0.4 },
    captions: { presetId: "meta-clean" },
  },
  {
    id: "batch_02_lifestyle",
    title: "Trading Lifestyle DE",
    scriptDe:
      "Stell dir vor: Du handelst von überall — Laptop, Charts, Fokus. Trading bedeutet Freiheit, wenn du es richtig lernst. Unser Programm zeigt dir den Weg: von den Basics bis zum strukturierten System. Charts lesen, Märkte verstehen, kluge Entscheidungen treffen. Bereit für den nächsten Schritt? Dein Trading-Training wartet auf dich.",
    introMs: 7000,
    music: { ...DEFAULT_MUSIC, volume: 0.4 },
    captions: { presetId: "meta-highlight" },
  },
  {
    id: "batch_03_community",
    title: "Community Training DE",
    scriptDe:
      "Du bist nicht allein. Tausende lernen gerade strukturiertes Trading — mit klarem Plan statt blindem Raten. Unser Training verbindet Theorie, Praxis und Community. Lerne von Profis, übe mit echten Setups, wachse Schritt für Schritt. Kein Druck, kein Chaos — nur ein System, das funktioniert. Melde dich an. Link in der Bio.",
    introMs: 6000,
    music: { ...DEFAULT_MUSIC, volume: 0.4 },
    captions: { presetId: "reels-boxed" },
  },
];

// ── editor-golden (was batch-5-golden.ts) ──────────────────────────────────────

const EDITOR_AVATARS = [
  { heygenAvatarId: "Annie_Casual_Sitting_Front_2_public", name: "Annie Casual Sitting Front 2", gender: "female" as const },
  { heygenAvatarId: "Bojan_sitting_businesstraining_side", name: "Bojan Business Training Side 2", gender: "male" as const },
];

const EDITOR_SCRIPTS = [
  "Trading ohne System ist wie Fahren ohne Lenkrad — irgendwann crasht es. Die meisten Anfänger verlieren Geld, weil sie ohne Plan, ohne Risikomanagement und ohne klare Regeln starten. In unserem professionellen Trading-Training lernst du Schritt für Schritt, wie echte Profis denken und handeln. Du bekommst konkrete Strategien für Einstiege, Stop-Loss und Gewinnmitnahmen. Kein Finfluencer-Hype, keine leeren Versprechen — nur Methodik, die funktioniert. Melde dich an und starte heute mit Struktur statt Bauchgefühl.",
  "Die meisten Trader scheitern, weil sie ohne Plan starten. Kein Risikomanagement, keine klaren Regeln — nur Emotionen und Bauchgefühl. In unserem Training lernst du ein System, das funktioniert: Einstiege definieren, Verluste begrenzen, Gewinne laufen lassen. Wir zeigen dir Charts, Trends und diszipliniertes Handeln — Schritt für Schritt, ohne Hype. Tausende haben diesen Weg bereits gegangen. Bereit für deinen nächsten Schritt? Starte heute strukturiert statt zu raten. Link in der Bio.",
];

function randomTrack() {
  const available = MUSIC_TRACKS.filter((t) => fs.existsSync(path.join(REPO_ROOT, t.file)));
  return available[Math.floor(Math.random() * available.length)] ?? MUSIC_TRACKS[0];
}

// ── parallel-5 (was batch-5-parallel.ts) ──────────────────────────────────────

const PARALLEL_SCRIPTS = [
  "Dein größter Feind beim Trading bist nicht der Markt — es ist deine eigene Psychologie. Angst, Gier und Impulsivität zerstören mehr Konten als jede Strategie. In unserem Training lernst du, Emotionen zu kontrollieren, Regeln einzuhalten und auch nach Verlusttagen diszipliniert zu bleiben. Kein Motivations-Gelaber — echte Methodik für deinen Kopf und dein Handeln. Starte heute mit mentaler Stärke statt Selbstsabotage.",
  "Ein Trade ohne Stop-Loss ist kein Trade — es ist ein unkontrolliertes Risiko. Profis wissen: Der erste Job ist nicht Gewinn, sondern Kapital schützen. Wir zeigen dir, wie du Positionsgrößen berechnest, Verluste begrenzt und trotzdem Chancen offen lässt. Risikomanagement ist der Unterschied zwischen Hobby und Beruf. Lerne es richtig, bevor du das nächste Mal blind einsteigst.",
  "Stell dir vor: Du arbeitest von überall — Laptop, Charts, Fokus. Trading bedeutet Freiheit, wenn du es richtig lernst. Unser Programm führt dich von den Basics bis zum strukturierten System: Märkte lesen, Setups erkennen, kluge Entscheidungen treffen. Kein Luxus-Hype — ein klarer Weg für Menschen, die Ernst machen wollen. Dein nächster Schritt beginnt hier.",
  "Du bist nicht allein. Tausende lernen gerade strukturiertes Trading — mit Plan statt blindem Raten. Unser Training verbindet Theorie, Praxis und echte Community. Lerne von erfahrenen Tradern, übe mit konkreten Setups und wachse Schritt für Schritt. Kein Druck, kein Chaos — nur ein System, das du jeden Tag anwenden kannst. Melde dich an und werde Teil davon.",
  "Genug mit zufälligen Trades und verlorenem Geld. Es ist Zeit für Struktur. Unser professionelles Trading-Training zeigt dir, wie du einen Plan erstellst, Märkte analysierst und konsequent umsetzt — ohne Finfluencer-Blabla. Klare Regeln, echte Beispiele, Ergebnisse die skalieren. Link in der Bio — starte jetzt, bevor der nächste Markt dich wieder aus dem Spiel wirft.",
];

// ── portrait-10 (was batch-10.ts) ─────────────────────────────────────────────

const PORTRAIT_AVATARS = [
  { heygenAvatarId: "Annie_expressive_public", name: "Annie Expressive", gender: "female" as const },
  { heygenAvatarId: "Brandon_expressive_public", name: "Brandon Expressive", gender: "male" as const },
  { heygenAvatarId: "Caroline_expressive_public", name: "Caroline Expressive", gender: "female" as const },
  { heygenAvatarId: "Annie_Office_Standing_Front_public", name: "Annie Office Standing", gender: "female" as const },
  { heygenAvatarId: "Brandon_Office_Standing_Front_public", name: "Brandon Office Standing", gender: "male" as const },
  { heygenAvatarId: "Annie_Casual_Standing_Front_public", name: "Annie Casual Standing", gender: "female" as const },
  { heygenAvatarId: "Brandon_Business_Standing_Front_public", name: "Brandon Business Standing", gender: "male" as const },
  { heygenAvatarId: "Caroline_Business_Standing_Front_public", name: "Caroline Business Standing", gender: "female" as const },
  { heygenAvatarId: "Annie_Lounge_Standing_Front_public", name: "Annie Lounge Standing", gender: "female" as const },
  { heygenAvatarId: "Brandon_Kitchen_Standing_Front_public", name: "Brandon Kitchen Standing", gender: "male" as const },
];

const PORTRAIT_SCRIPTS: string[] = [
  "Die meisten Trader scheitern, weil sie ohne Plan starten. Kein Risikomanagement, keine klaren Regeln — nur Emotionen. In unserem Training lernst du ein System, das funktioniert: Einstiege definieren, Verluste begrenzen, Gewinne laufen lassen. Starte heute strukturiert statt zu raten.",
  "Trading ist kein Glücksspiel. Es ist ein Handwerk, das man lernt. Unser Programm zeigt dir Schritt für Schritt, wie Profis Märkte lesen, Setups erkennen und diszipliniert handeln. Von den Grundlagen bis zum fertigen Trading-Plan. Bereit für echtes Wissen statt Hype?",
  "Stell dir vor: Du öffnest deinen Laptop, hast einen klaren Plan und weißt genau, was du tust. So fühlt sich strukturiertes Trading an. Wir zeigen dir, wie du Charts liest, Trends erkennst und kluge Entscheidungen triffst — ohne Stress und ohne Raten.",
  "Viele Anfänger verlieren Geld, weil sie zu früh mit echtem Kapital starten. Unser Training baut zuerst dein Fundament: Marktverständnis, Risikomanagement, Trading-Psychologie. Erst wenn du bereit bist, gehst du live. Sicher. Strukturiert. Professionell.",
  "Finanzielle Freiheit beginnt mit dem richtigen Mindset. Lerne, wie du Emotionen kontrollierst, Verluste akzeptierst und an deinem System festhältst. Unser Coaching verbindet Theorie mit Praxis — damit du nicht nur weißt, was du tun musst, sondern es auch wirklich umsetzt.",
  "Du willst nicht nur traden — du willst es richtig lernen. Keine leeren Versprechen, kein Finfluencer-Blabla. Bei uns bekommst du klare Strategien, echte Beispiele und ein System, das du jeden Tag anwenden kannst. Melde dich an und starte deine Trading-Reise.",
  "Jeder erfolgreiche Trader hat eines gemeinsam: ein System. Unser Training gibt dir genau das — klare Einstiegsregeln, Stop-Loss-Strategien und einen Plan für jeden Trade. Kein Bauchgefühl mehr. Nur noch strukturiertes, professionelles Handeln.",
  "Märkte bewegen sich schnell. Wer ohne Vorbereitung startet, verliert. Unser Kurs bereitet dich vor: von Candlestick-Mustern über Trendanalyse bis zum kompletten Trade-Setup. Lerne in deinem Tempo, übe mit echten Charts, wachse jeden Tag.",
  "Trading allein ist schwer. Deshalb bieten wir ein komplettes Training mit klarem Fahrplan. Du lernst nicht nur Theorie — du verstehst, warum Profis so handeln. Risiko begrenzen, Chancen nutzen, diszipliniert bleiben. Dein nächster Schritt beginnt hier.",
  "Genug mit zufälligen Trades und verlorenem Geld. Es ist Zeit für Struktur. Unser professionelles Trading-Training zeigt dir, wie du einen Plan erstellst, Märkte analysierst und konsequent umsetzt. Kein Hype — nur Methodik, die funktioniert. Link in der Bio.",
];

const PORTRAIT_CAPTION_PRESETS = [
  "meta-clean", "meta-bold", "meta-highlight", "reels-boxed", "reels-subtitle",
  "meta-clean", "meta-bold", "meta-highlight", "reels-boxed", "minimal-lower",
];

// ── jun17 ─────────────────────────────────────────────────────────────────────

const JUN17_AVATARS = [
  { heygenAvatarId: "Annie_Casual_Sitting_Front_2_public", name: "Annie Casual Sitting Front 2", gender: "female" as const },
  { heygenAvatarId: "Bojan_sitting_businesstraining_side", name: "Bojan Business Training Side 2", gender: "male" as const },
];

const JUN17_PAIR_SCRIPTS = [
  "Dein größter Feind beim Trading bist du selbst — Angst, Gier, Impulsivität. In unserem Training lernst du, Emotionen zu kontrollieren und Regeln einzuhalten, auch nach Verlusttagen. Kein Motivations-Gelaber — echte Methodik für deinen Kopf. Starte heute mit mentaler Stärke statt Selbstsabotage.",
  "Ein Trade ohne Stop-Loss ist kein Trade — es ist unkontrolliertes Risiko. Profis schützen zuerst ihr Kapital. Wir zeigen dir Positionsgrößen, Verlustbegrenzung und wie du Chancen offen lässt. Risikomanagement ist der Unterschied zwischen Hobby und Beruf. Lerne es richtig, bevor du blind einsteigst.",
];

const JUN17_PARALLEL_SCRIPTS = [
  "Dein größter Feind beim Trading bist nicht der Markt — es ist deine eigene Psychologie. Angst, Gier und Impulsivität zerstören mehr Konten als jede Strategie. In unserem Training lernst du, Emotionen zu kontrollieren, Regeln einzuhalten und auch nach Verlusttagen diszipliniert zu bleiben. Kein Motivations-Gelaber — echte Methodik für deinen Kopf und dein Handeln. Starte heute mit mentaler Stärke statt Selbstsabotage.",
  "Ein Trade ohne Stop-Loss ist kein Trade — es ist ein unkontrolliertes Risiko. Profis wissen: Der erste Job ist nicht Gewinn, sondern Kapital schützen. Wir zeigen dir, wie du Positionsgrößen berechnest, Verluste begrenzt und trotzdem Chancen offen lässt. Risikomanagement ist der Unterschied zwischen Hobby und Beruf. Lerne es richtig, bevor du das nächste Mal blind einsteigst.",
  "Stell dir vor: Du arbeitest von überall — Laptop, Charts, Fokus. Trading bedeutet Freiheit, wenn du es richtig lernst. Unser Programm führt dich von den Basics bis zum strukturierten System: Märkte lesen, Setups erkennen, kluge Entscheidungen treffen. Kein Luxus-Hype — ein klarer Weg für Menschen, die Ernst machen wollen. Dein nächster Schritt beginnt hier.",
  "Du bist nicht allein. Tausende lernen gerade strukturiertes Trading — mit Plan statt blindem Raten. Unser Training verbindet Theorie, Praxis und echte Community. Lerne von erfahrenen Tradern, übe mit konkreten Setups und wachse Schritt für Schritt. Kein Druck, kein Chaos — nur ein System, das du jeden Tag anwenden kannst. Melde dich an und werde Teil davon.",
  "Genug mit zufälligen Trades und verlorenem Geld. Es ist Zeit für Struktur. Unser professionelles Trading-Training zeigt dir, wie du einen Plan erstellst, Märkte analysierst und konsequent umsetzt — ohne Finfluencer-Blabla. Klare Regeln, echte Beispiele, Ergebnisse die skalieren. Link in der Bio — starte jetzt, bevor der nächste Markt dich wieder aus dem Spiel wirft.",
];

const JOSH_AVATAR_NAME = "Josh";

function joshAvatar() {
  return { heygenAvatarId: config.heygenAvatarId(), name: JOSH_AVATAR_NAME, gender: "male" as const };
}

const JUN17_MALE: Omit<BatchJob, "avatar">[] = [
  {
    id: "jun17_09",
    title: "Jun 17 — Josh · Trading Psychologie",
    scriptDe:
      "Die meisten Trader scheitern nicht am Markt — sie scheitern an sich selbst. Impulsive Entscheidungen, kein Plan, kein Risikomanagement. In unserem Training lernst du, wie Profis denken: klare Regeln, klare Setups, klare Exits. Kein Gambling, keine Emotionen — echte Methodik. Melde dich an und baue endlich ein System, das funktioniert.",
    introMs: 5000,
    avatarZoom: 1.05,
    aspectRatio: "9:16",
    fullAvatar: false,
    fastCuts: false,
    brollCutMs: 1400,
    outputSpeed: 1.2,
    music: { enabled: true, file: MUSIC_TRACKS[3].file, volume: 0.3, title: MUSIC_TRACKS[3].title },
    captions: FACTORY_CAPTIONS,
    muteAvatar: false,
    avatarVolume: 1,
  },
  {
    id: "jun17_10",
    title: "Jun 17 — Josh · Vom Lernen zum System",
    scriptDe:
      "Du willst vom Trading leben? Dann hör auf, Charts zu scrollen und fang an zu lernen. Wir zeigen dir Schritt für Schritt, wie du Märkte liest, Setups erkennst und konsequent handelst — mit Struktur statt Bauchgefühl. Kein Hype, kein Schnell-reich-Werden — professionelles Training für Leute, die es ernst meinen. Link in der Bio.",
    introMs: 5000,
    avatarZoom: 1.05,
    aspectRatio: "9:16",
    fullAvatar: false,
    fastCuts: false,
    brollCutMs: 1400,
    outputSpeed: 1.2,
    music: { enabled: true, file: MUSIC_TRACKS[4].file, volume: 0.3, title: MUSIC_TRACKS[4].title },
    captions: FACTORY_CAPTIONS,
    muteAvatar: false,
    avatarVolume: 1,
  },
];

const JUN20_MALE: Omit<BatchJob, "avatar">[] = [
  {
    id: "jun20_01",
    title: "Jun 20 — Josh · Zusehen vs. Handeln",
    scriptDe:
      "Die meisten reden über Trading — wenige handeln mit System. Während du Videos schaust, machen andere echte Trades nach Plan. Stop-Loss, Positionsgröße, klare Regeln. Wir zeigen dir, wie du vom Zusehen zum strukturierten Handeln kommst. Kein Schnell-reich-Werden — echtes Training für Menschen, die handeln wollen, nicht nur träumen. Link in der Bio.",
    introMs: 5000,
    avatarZoom: 1.05,
    aspectRatio: "9:16",
    fullAvatar: false,
    fastCuts: false,
    brollCutMs: 1400,
    outputSpeed: 1.2,
    music: { enabled: true, file: MUSIC_TRACKS[5].file, volume: 0.3, title: MUSIC_TRACKS[5].title },
    captions: FACTORY_CAPTIONS,
    muteAvatar: false,
    avatarVolume: 1,
  },
  {
    id: "jun20_02",
    title: "Jun 20 — Josh · FOMO / Zögern kostet",
    scriptDe:
      "Wie viel hat dich dein Zögern dieses Jahr schon gekostet? Chancen, die du gesehen hast — und nicht genutzt. Nicht weil du dumm bist, sondern weil dir keiner ein klares System gegeben hat. Bei uns lernst du Einstiege, Exits und Risikomanagement Schritt für Schritt. Bevor du das nächste Mal blind einsteigst — hol dir erst die Methode. Melde dich an.",
    introMs: 5000,
    avatarZoom: 1.05,
    aspectRatio: "9:16",
    fullAvatar: false,
    fastCuts: false,
    brollCutMs: 1400,
    outputSpeed: 1.2,
    music: { enabled: true, file: MUSIC_TRACKS[6].file, volume: 0.3, title: MUSIC_TRACKS[6].title },
    captions: FACTORY_CAPTIONS,
    muteAvatar: false,
    avatarVolume: 1,
  },
];

// ── Registry ──────────────────────────────────────────────────────────────────

const JUN17_SINGLE_JOB: BatchJob = {
  id: "jun17_01",
  title: "Jun 17 — Annie · 5s avatar + B-roll",
  scriptDe:
    "Trading ohne System ist wie Fahren ohne Lenkrad — irgendwann crasht es. Die meisten Anfänger verlieren Geld, weil sie ohne Plan, ohne Risikomanagement und ohne klare Regeln starten. In unserem professionellen Training lernst du Schritt für Schritt, wie echte Profis denken und handeln. Klare Strategien, diszipliniertes Handeln, echte Methodik — kein Hype. Melde dich an und starte heute mit Struktur statt Bauchgefühl.",
  introMs: 5000,
  avatarZoom: 1.05,
  aspectRatio: "9:16",
  fullAvatar: false,
  fastCuts: false,
  brollCutMs: 1400,
  outputSpeed: 1.2,
  avatar: { heygenAvatarId: "Annie_Casual_Sitting_Front_2_public", name: "Annie Casual Sitting Front 2", gender: "female" },
  music: { enabled: true, file: MUSIC_TRACKS[3].file, volume: 0.2, title: MUSIC_TRACKS[3].title },
  captions: { presetId: "poppins-stroke-word", fontSize: 52, bottomPercent: 42, background: "none" },
};

const FEMALE_RERENDER_IDS = ["jun17_01", "jun17_02", "jun17_04", "jun17_06", "jun17_08"];

function femaleRerenderJobs(): BatchJob[] {
  return FEMALE_RERENDER_IDS.map((id) => {
    const meta = loadMetadata(id);
    if (!meta) throw new Error(`Missing metadata for ${id}`);
    return {
      ...meta,
      muteAvatar: false,
      avatarVolume: 1.4,
      music: {
        enabled: true,
        file: meta.music?.file ?? "data/music/funk-bed.mp3",
        volume: 0.25,
        startOffsetMs: meta.music?.startOffsetMs,
        title: meta.music?.title,
        youtubeUrl: meta.music?.youtubeUrl,
      },
      captions: { presetId: "poppins-bold-italic-pop", fontSize: 68, bottomPercent: 42, background: "none" },
    };
  });
}

export const BATCHES: Record<string, BatchDef> = {
  "trading-intro": {
    description: "3 trading ads with an intro avatar, then B-roll (batch_01–03). Needs data/avatars.json (pnpm avatars).",
    mode: "sequential",
    jobs: () => {
      const avatars = cachedAvatars();
      return TRADING_INTRO.map((job, i) => ({ ...job, avatar: avatars[i % avatars.length] }));
    },
  },

  "editor-golden": {
    description: "2 editor ads: avatar + fast B-roll cuts, random phonk at 25%, 1.2× (edit_01–02).",
    mode: "sequential",
    jobs: () =>
      EDITOR_SCRIPTS.map((scriptDe, i) => {
        const n = String(i + 1).padStart(2, "0");
        const av = EDITOR_AVATARS[i];
        const track = randomTrack();
        return {
          id: `edit_${n}`,
          title: `Editor Ad ${n} — ${av.name}`,
          scriptDe,
          introMs: 4500,
          avatarZoom: 1.05,
          aspectRatio: "9:16",
          fullAvatar: false,
          fastCuts: true,
          brollCutMs: 900,
          outputSpeed: 1.2,
          avatar: av,
          music: { enabled: true, file: track.file, volume: 0.25, title: track.title },
          captions: { presetId: "poppins-italic-word", fontSize: 36, bottomPercent: 40 },
        };
      }),
  },

  "parallel-5": {
    description: "5 parallel renders with unique scripts and unique phonk (par_01–05).",
    mode: "parallel",
    jobs: () => {
      const tracks = shuffled(availableTracks());
      return PARALLEL_SCRIPTS.map((scriptDe, i) => {
        const n = String(i + 1).padStart(2, "0");
        const av = EDITOR_AVATARS[i % 2];
        const track = tracks[i];
        return {
          id: `par_${n}`,
          title: `Parallel Ad ${n} — ${av.name}`,
          scriptDe,
          introMs: 4500,
          avatarZoom: 1.05,
          aspectRatio: "9:16",
          fullAvatar: false,
          fastCuts: true,
          brollCutMs: 900,
          outputSpeed: 1.2,
          avatar: av,
          music: { enabled: true, file: track.file, volume: 0.25, title: track.title },
          captions: { presetId: "poppins-italic-word", fontSize: 36, bottomPercent: 40 },
        };
      });
    },
  },

  "portrait-10": {
    description: "10 portrait 9:16 trading ads with standing avatars (ad_01–10).",
    mode: "sequential",
    jobs: () =>
      PORTRAIT_SCRIPTS.map((scriptDe, i) => {
        const n = String(i + 1).padStart(2, "0");
        return {
          id: `ad_${n}`,
          title: `Trading Ad ${n}`,
          scriptDe,
          introMs: 6000 + (i % 3) * 500,
          avatarZoom: 1,
          avatar: PORTRAIT_AVATARS[i],
          music: { enabled: false, file: "data/music/funk-bed.mp3", volume: 0 },
          captions: { presetId: PORTRAIT_CAPTION_PRESETS[i], fontSize: 32 },
        };
      }),
  },

  "jun17-single": {
    description: "Single test render: 5s avatar, then B-roll (jun17_01).",
    session: "17th June",
    mode: "sequential",
    jobs: () => [JUN17_SINGLE_JOB],
  },

  "jun17-pair": {
    description: "Two Jun 17 ads, Annie and Bojan, ~25s scripts (jun17_02–03).",
    session: "17th June",
    mode: "sequential",
    jobs: () => {
      const tracks = availableTracks();
      const m4 = tracks[4] ?? tracks[0];
      const m5 = tracks[5] ?? tracks[1];
      return JUN17_PAIR_SCRIPTS.map((scriptDe, i) => {
        const n = String(i + 2).padStart(2, "0");
        const av = JUN17_AVATARS[i];
        const track = i === 0 ? m4 : m5;
        return {
          id: `jun17_${n}`,
          title: `Jun 17 Ad ${n} — ${av.name}`,
          scriptDe,
          introMs: 5000,
          avatarZoom: 1.05,
          aspectRatio: "9:16",
          fullAvatar: false,
          fastCuts: false,
          brollCutMs: 1400,
          outputSpeed: 1.2,
          avatar: av,
          music: { enabled: true, file: track.file, volume: 0.2, title: track.title },
          captions: { presetId: "poppins-stroke-word", fontSize: 52, bottomPercent: 42, background: "none" },
        };
      });
    },
  },

  "jun17-parallel": {
    description: "Five parallel Jun 17 renders, no captions or music (jun17_04–08).",
    session: "17th June",
    mode: "parallel",
    jobs: () =>
      JUN17_PARALLEL_SCRIPTS.map((scriptDe, i) => {
        const n = String(i + 4).padStart(2, "0");
        const av = JUN17_AVATARS[i % 2];
        return {
          id: `jun17_${n}`,
          title: `Jun 17 Ad ${n} — ${av.name} (no captions/music)`,
          scriptDe,
          introMs: 5000,
          avatarZoom: 1.05,
          aspectRatio: "9:16",
          fullAvatar: false,
          fastCuts: false,
          brollCutMs: 1400,
          outputSpeed: 1.2,
          avatar: av,
          music: { enabled: false, file: "data/music/funk-bed.mp3", volume: 0 },
          captions: { presetId: "none" },
        };
      }),
  },

  "jun17-female-rerender": {
    description: "Re-render the Jun 17 female ads from saved avatar clips: voice 100%, music 25%, pop captions.",
    session: "17th June",
    mode: "sequential",
    skipHeygen: true,
    jobs: femaleRerenderJobs,
  },

  "jun17-male": {
    description: "Two Josh ads for Jun 17 through the factory settings (jun17_09–10).",
    session: "17th June",
    mode: "sequential",
    factory: true,
    jobs: () => JUN17_MALE.map((job) => ({ ...job, avatar: joshAvatar() })),
  },

  "jun20-male": {
    description: "Two Josh ads for Jun 20 through the factory settings (jun20_01–02).",
    session: "20th June",
    mode: "sequential",
    factory: true,
    jobs: () => JUN20_MALE.map((job) => ({ ...job, avatar: joshAvatar() })),
  },

  "produce-pair": {
    description: "Two new 9:16 scene-avatar ads: a man and a woman (ad_male_office, ad_female_bar).",
    mode: "sequential",
    jobs: () => [
      {
        id: "ad_male_office",
        title: "Trading Training — Mann",
        scriptDe:
          "Als Trader ohne System bist du dem Zufall ausgeliefert. In unserem Training lernst du klare Regeln: Risiko begrenzen, Einstiege planen, Emotionen kontrollieren. Kein Finfluencer-Hype — nur echte Methodik. Starte heute mit Struktur statt Bauchgefühl.",
        introMs: 6000,
        avatarZoom: 1.55,
        avatar: { heygenAvatarId: "Artur_sitting_office_front", name: "Artur Office Front" },
        music: { ...DEFAULT_MUSIC, volume: 0.25 },
        captions: { presetId: "meta-clean", fontSize: 30 },
      },
      {
        id: "ad_female_bar",
        title: "Trading Training — Frau",
        scriptDe:
          "Finanzielle Freiheit beginnt mit dem richtigen Wissen. Lerne Trading Schritt für Schritt — mit klarem System statt Bauchgefühl. Unser Training zeigt dir, wie Profis denken und handeln. Bereit für deinen nächsten Schritt? Melde dich jetzt an.",
        introMs: 6000,
        avatarZoom: 1.55,
        avatar: { heygenAvatarId: "Annie_Bar_Sitting_Front_public", name: "Annie Bar Sitting Front" },
        music: { ...DEFAULT_MUSIC, volume: 0.25 },
        captions: { presetId: "meta-highlight", fontSize: 30 },
      },
    ],
  },

  "dashboard-demo": {
    description: "30s dashboard demo, portrait kitchen avatar (dashboard_demo).",
    mode: "sequential",
    jobs: () => [
      {
        id: "dashboard_demo",
        title: "Dashboard Demo — 30s Portrait",
        scriptDe:
          "Trading ohne System ist wie Fahren ohne Lenkrad — irgendwann crasht es. Die meisten Anfänger verlieren Geld, weil sie ohne Plan, ohne Risikomanagement und ohne klare Regeln starten. In unserem professionellen Trading-Training lernst du Schritt für Schritt, wie echte Profis denken und handeln. Du bekommst konkrete Strategien für Einstiege, Stop-Loss und Gewinnmitnahmen. Kein Finfluencer-Hype, keine leeren Versprechen — nur Methodik, die funktioniert. Unser Programm verbindet Theorie mit Praxis: Charts lesen, Trends erkennen, diszipliniert bleiben. Tausende Trader haben diesen Weg bereits gegangen. Jetzt bist du dran. Melde dich an und starte heute mit Struktur statt Bauchgefühl.",
        introMs: 7000,
        avatarZoom: 1,
        avatar: { heygenAvatarId: "Brandon_Kitchen_Standing_Front_public", name: "Brandon Kitchen Standing Front", gender: "male" },
        music: { enabled: false, file: "data/music/funk-bed.mp3", volume: 0 },
        captions: { presetId: "meta-clean", fontSize: 32 },
      },
    ],
  },

  "test-16-june": {
    description: "Scene avatar on a bar background, 25s+, no music, German captions (test_16_june).",
    mode: "sequential",
    jobs: () => [
      {
        id: "test_16_june",
        title: "Trading Training — Test",
        scriptDe:
          "Als Trader ohne System bist du dem Zufall ausgeliefert. Jeder Tag ohne Plan kostet dich Nerven, Zeit und oft auch Geld. In unserem professionellen Trading-Training lernst du Schritt für Schritt, wie echte Profis denken und handeln. Du bekommst klare Regeln für Risikomanagement, präzise Einstiege und diszipliniertes Exit-Management. Kein Finfluencer-Hype, keine leeren Versprechen — nur bewährte Methodik. Die meisten Anfänger scheitern, weil sie ohne Struktur starten. Bereit für deinen nächsten Schritt? Starte heute mit einem System, das funktioniert.",
        introMs: 7000,
        avatarZoom: 1,
        avatar: { heygenAvatarId: "Annie_Bar_Sitting_Front_public", name: "Annie Bar Sitting Front", gender: "female" },
        music: { enabled: false, file: "data/music/funk-bed.mp3", volume: 0 },
        captions: { presetId: "meta-clean", fontSize: 32 },
      },
    ],
  },
};
