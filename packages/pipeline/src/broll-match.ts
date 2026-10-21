import { createHash } from "node:crypto";
import type { Beat, WordTimestamp } from "@ai-ads/core";
import { loadBrollCatalog } from "./broll.js";

export type BrollCatalogEntry = {
  file: string;
  name: string;
  preview: string;
  category: string;
  tags?: string[];
  sourceFolder?: string;
};

/** Map ~/Downloads/B-Roll subfolder names to internal categories. */
export function categoryFromPath(clipPath: string): string {
  const p = clipPath.toLowerCase().replace(/\\/g, "/");
  if (p.includes("trading content") || p.includes("/trading")) return "Trading";
  if (p.includes("lifestyle") || p.includes("freiheit")) return "Lifestyle";
  if (p.includes("deep work") || p.includes("fokus")) return "Deep Work";
  if (p.includes("interaktion") || p.includes("community")) return "Community";
  return inferCategoryFromName(pathBasename(clipPath));
}

function inferCategoryFromName(name: string): string {
  const n = name.toLowerCase();
  if (/trad|chart|forex|stock|crypto|bitcoin|market|trader|candle|screen|monitor|portfolio|invest/.test(n)) {
    return "Trading";
  }
  if (/lifestyle|travel|luxury|pool|car|freedom|freiheit|yacht|jet|beach|city.?view/.test(n)) {
    return "Lifestyle";
  }
  if (/phone|smartphone|social|community|meeting|team|interakt|gestik|explain/.test(n)) {
    return "Community";
  }
  if (/laptop|keyboard|typing|focus|work|office|macbook|desk|study|learn|notiz|konzen/.test(n)) {
    return "Deep Work";
  }
  return "Other";
}

const THEME_KEYWORDS: Array<{ re: RegExp; categories: string[]; weight: number }> = [
  { re: /trading|trade|markt|börse|aktie|chart|forex|krypto|bitcoin|portfolio|invest|verlust|gewinn|strategie|setup|signal|risiko|kapital|geld verdienen|handeln|position|trend|candle|screen|monitor|analyse|technisch|fundamental/i, categories: ["Trading", "Deep Work"], weight: 3 },
  { re: /psychologie|emotion|angst|gier|disziplin|mental|kopf|selbst|motivation|vertrauen|stress|fokus|kontrolle|regel|plan|system|methode|training|lernen|professionell|struktur|schritt/i, categories: ["Deep Work", "Community"], weight: 2 },
  { re: /lifestyle|freiheit|frei|reisen|luxus|leben|traum|erfolg|unabhängig|überall|remote|flexibel|zeit|balance|genug|start|heute|morgen|zukunft/i, categories: ["Lifestyle", "Deep Work"], weight: 2 },
  { re: /community|team|gruppe|menschen|interaktion|gespräch|support|netzwerk|zusammen|melde|anmelden|link|bio|programm|kurs|coaching|mentor/i, categories: ["Community", "Deep Work"], weight: 2 },
  { re: /laptop|computer|tastatur|tipper|schreib|arbeit|büro|desk|home.?office|screen time|arbeiten/i, categories: ["Deep Work", "Trading"], weight: 1.5 },
  { re: /smartphone|handy|phone|scroll|social|app|notification/i, categories: ["Community", "Lifestyle"], weight: 1.5 },
];

function pathBasename(p: string): string {
  // avoid importing path in hot loop — use last segment
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function tagsFromName(name: string): string[] {
  return name
    .replace(/\.(mp4|mov|webm)$/i, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((t) => t.length > 2)
    .map((t) => t.toLowerCase());
}

export function enrichCatalogEntry(raw: BrollCatalogEntry): BrollCatalogEntry {
  const category = raw.category && raw.category !== "Other" ? raw.category : categoryFromPath(raw.file);
  const tags = raw.tags?.length ? raw.tags : tagsFromName(raw.name);
  return { ...raw, category, tags };
}

function preferredCategories(text: string): Map<string, number> {
  const scores = new Map<string, number>();
  for (const { re, categories, weight } of THEME_KEYWORDS) {
    if (re.test(text)) {
      for (const cat of categories) {
        scores.set(cat, (scores.get(cat) ?? 0) + weight);
      }
    }
  }
  if (scores.size === 0) scores.set("Deep Work", 1);
  return scores;
}

function scoreClip(entry: BrollCatalogEntry, query: string, catScores: Map<string, number>): number {
  const q = query.toLowerCase();
  const tags = entry.tags ?? tagsFromName(entry.name);
  let score = catScores.get(entry.category) ?? 0;

  for (const tag of tags) {
    if (q.includes(tag) || tag.length > 4 && q.split(/\s+/).some((w) => w.includes(tag) || tag.includes(w))) {
      score += 2;
    }
  }

  const name = entry.name.toLowerCase();
  for (const word of q.split(/\s+/).filter((w) => w.length > 4)) {
    if (name.includes(word)) score += 1.5;
  }

  return score;
}

/** Words spoken during [startMs, endMs). Falls back to proportional script slice. */
export function scriptTextForBeat(
  words: WordTimestamp[] | undefined,
  scriptDe: string,
  startMs: number,
  endMs: number,
  durationMs: number,
): string {
  if (words?.length) {
    const slice = words.filter((w) => w.startMs < endMs && w.endMs > startMs).map((w) => w.word);
    if (slice.length) return slice.join(" ");
  }
  const ratioStart = startMs / Math.max(durationMs, 1);
  const ratioEnd = endMs / Math.max(durationMs, 1);
  const tokens = scriptDe.split(/\s+/);
  const i0 = Math.floor(ratioStart * tokens.length);
  const i1 = Math.ceil(ratioEnd * tokens.length);
  return tokens.slice(i0, i1).join(" ");
}

export function pickClip(
  query: string,
  catalog: BrollCatalogEntry[],
  used: Set<string>,
  adId: string,
  beatIndex: number,
): BrollCatalogEntry | null {
  const enriched = catalog.map(enrichCatalogEntry);
  const catScores = preferredCategories(query);
  const ranked = enriched
    .map((e) => ({ e, score: scoreClip(e, query, catScores) }))
    .sort((a, b) => b.score - a.score);

  const hash = createHash("md5").update(`${adId}:${beatIndex}:${query}`).digest();
  const offset = hash.readUInt16BE(0);

  const unused = ranked.filter(({ e }) => !used.has(e.file));
  const candidates = unused.length ? unused : ranked;
  if (!candidates.length) return null;
  const bestScore = candidates[0].score;
  const best = candidates.filter(({ score }) => score === bestScore);
  return best[offset % best.length].e;
}

export type BrollChoices = {
  /** Clip files that must be used; each goes to the B-roll beat whose words match it best. */
  pinned?: string[];
  /** Clip files that must never be used. */
  excluded?: string[];
  /** Catalog override for tests; defaults to data/broll/catalog.json. */
  catalog?: BrollCatalogEntry[];
};

/** Assign clipPath + query on each broll beat from script context. */
export function assignSemanticBroll(
  beats: Beat[],
  words: WordTimestamp[] | undefined,
  scriptDe: string,
  adId: string,
  durationMs: number,
  choices: BrollChoices = {},
): Beat[] {
  const excluded = new Set(choices.excluded ?? []);
  const catalog = (choices.catalog ?? (loadBrollCatalog() as BrollCatalogEntry[])).filter((c) => !excluded.has(c.file));
  if (!catalog.length) return beats;

  const queries = beats.map((beat) =>
    beat.kind === "broll" ? scriptTextForBeat(words, scriptDe, beat.startMs, beat.endMs, durationMs) : "");
  const brollIndexes = beats.flatMap((b, i) => (b.kind === "broll" ? [i] : []));

  // Pinned clips first: each takes the free beat it scores highest on (earliest beat on ties).
  const assigned = new Map<number, BrollCatalogEntry>();
  const pinned = (choices.pinned ?? [])
    .map((file) => catalog.find((c) => c.file === file))
    .filter((c): c is BrollCatalogEntry => !!c);
  for (const clip of pinned.slice(0, brollIndexes.length)) {
    const entry = enrichCatalogEntry(clip);
    let best = -1;
    let bestScore = -Infinity;
    for (const i of brollIndexes) {
      if (assigned.has(i)) continue;
      const score = scoreClip(entry, queries[i], preferredCategories(queries[i]));
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best >= 0) assigned.set(best, clip);
  }

  const used = new Set([...assigned.values()].map((c) => c.file));
  let brollIdx = 0;

  return beats.map((beat, i) => {
    if (beat.kind !== "broll") return beat;
    const query = queries[i];
    const pick = assigned.get(i) ?? pickClip(query, catalog, used, adId, brollIdx);
    brollIdx++;
    if (!pick) return beat;
    used.add(pick.file);
    return {
      ...beat,
      query,
      clipPath: pick.file,
      clipInMs: beat.clipInMs ?? Math.floor(Math.random() * 2500),
    };
  });
}
