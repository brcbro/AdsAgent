import { parseCsv, parseDate, parseNumber } from "../csv.js";
import type { AdMetricsDaily, Platform, PlatformAd } from "../types.js";

/*
 * Day-one data source: CSV exports from Meta Ads Manager ("Export table data", daily breakdown)
 * and Google Ads ("Download" on the Ads report, segmented by day). Columns are matched by
 * normalized header aliases, so English and German exports and minor renames both work.
 */

type Field = keyof Omit<AdMetricsDaily, "adId" | "raw"> | "adId" | "adName" | "campaignName" | "adsetName" | "accountName" | "accountId";

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9%]/g, "");

/** First alias whose normalized form equals, or is a prefix of, the normalized header wins. */
const ALIASES: Record<Platform, Partial<Record<Field, string[]>>> = {
  meta: {
    date: ["day", "tag", "date", "reportingstarts", "berichtsbeginn"],
    adId: ["adid", "anzeigenid", "werbeanzeigenid"],
    adName: ["adname", "anzeigenname", "werbeanzeigenname"],
    campaignName: ["campaignname", "kampagnenname"],
    adsetName: ["adsetname", "anzeigengruppenname"],
    accountName: ["accountname", "kontoname", "werbekontoname"],
    accountId: ["adaccountid", "accountid", "werbekontoid"],
    impressions: ["impressions", "impressionen"],
    reach: ["reach", "reichweite"],
    spend: ["amountspent", "ausgegebenerbetrag", "spend", "cost", "kosten"],
    clicks: ["clicksall", "clicks", "klicksalle", "klicks"],
    linkClicks: ["linkclicks", "linkklicks"],
    videoPlays3s: ["3secondvideoplays", "3secondvideoviews", "3sekundenvideowiedergaben", "videoplays3s"],
    videoThruplays: ["thruplays", "thruplay"],
    videoP25: ["videoplaysat25%", "videowiedergabenbei25%", "videoplaysat25"],
    videoP50: ["videoplaysat50%", "videowiedergabenbei50%", "videoplaysat50"],
    videoP75: ["videoplaysat75%", "videowiedergabenbei75%", "videoplaysat75"],
    videoP100: ["videoplaysat100%", "videowiedergabenbei100%", "videoplaysat100"],
    // Value columns come first: "purchases" would otherwise prefix-match "purchases conversion value" when no count column exists.
    conversionValue: ["purchasesconversionvalue", "purchaseconversionvalue", "kaufconversionwert", "conversionvalue"],
    conversions: ["purchases", "käufe", "results", "ergebnisse", "conversions"],
    leads: ["leads", "leadsform", "onfacebookleads"],
  },
  google: {
    date: ["day", "tag", "date", "datum"],
    adId: ["adid", "anzeigenid"],
    adName: ["adname", "ad", "anzeigenname", "anzeige"],
    campaignName: ["campaign", "kampagne"],
    adsetName: ["adgroup", "anzeigengruppe"],
    accountName: ["accountname", "account", "kontoname", "customername"],
    accountId: ["customerid", "accountid", "kundennummer"],
    impressions: ["impr", "impressions", "impressionen"],
    spend: ["cost", "kosten"],
    clicks: ["clicks", "klicks"],
    views: ["views", "videoviews", "aufrufe"],
    viewRate: ["viewrate", "aufrufrate"],
    videoP25: ["videoplayedto25%", "video25%", "videoplayedto25"],
    videoP50: ["videoplayedto50%", "video50%", "videoplayedto50"],
    videoP75: ["videoplayedto75%", "video75%", "videoplayedto75"],
    videoP100: ["videoplayedto100%", "video100%", "videoplayedto100"],
    conversionValue: ["convvalue", "conversionvalue", "convwert", "conversionswert", "allconvvalue"],
    conversions: ["conversions", "conv"],
  },
};

export function detectPlatform(headers: string[], fileName = ""): Platform | undefined {
  const name = fileName.toLowerCase();
  if (/^(meta|facebook|fb)[-_ ]/.test(name)) return "meta";
  if (/^(google|gads|youtube)[-_ ]/.test(name)) return "google";
  const h = headers.map(norm);
  const has = (aliases: string[]) => h.some((x) => aliases.some((a) => x === a || x.startsWith(a)));
  if (has(ALIASES.meta.spend!) && (has(ALIASES.meta.videoPlays3s!) || has(ALIASES.meta.videoThruplays!) || has(["reach", "reichweite"]))) return "meta";
  if (has(ALIASES.google.impressions!) && (has(ALIASES.google.views!) || has(ALIASES.google.viewRate!) || has(["adgroup", "anzeigengruppe"]))) return "google";
  if (has(["adsetname", "anzeigengruppenname"])) return "meta";
  if (has(["campaign", "kampagne"]) && has(["cost", "kosten"])) return "google";
  return undefined;
}

export function mapHeaders(headers: string[], platform: Platform): Partial<Record<Field, string>> {
  const result: Partial<Record<Field, string>> = {};
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const [field, aliases] of Object.entries(ALIASES[platform]) as [Field, string[]][]) {
    let hit = normalized.find((h) => aliases.includes(h.n));
    if (!hit) {
      // Prefix match, but never let "clicks" claim "clicks all" twice or "video plays at 25%" match "video plays".
      hit = normalized.find((h) => aliases.some((a) => h.n.startsWith(a) && !Object.values(result).includes(h.raw)));
    }
    if (hit && !Object.values(result).includes(hit.raw)) result[field] = hit.raw;
  }
  return result;
}

export interface CsvImportResult {
  platform: Platform;
  accountExternalId: string;
  accountName: string;
  ads: Array<Pick<PlatformAd, "externalId" | "name" | "campaignName" | "adsetName">>;
  metrics: Array<Omit<AdMetricsDaily, "adId"> & { adExternalId: string }>;
  skippedRows: number;
  columns: Partial<Record<Field, string>>;
  warnings: string[];
}

export function importCsv(text: string, fileName = ""): CsvImportResult {
  const { headers, rows } = parseCsv(text);
  const platform = detectPlatform(headers, fileName);
  if (!platform) throw new Error(`Can't tell whether ${fileName || "this file"} is a Meta or Google export. Prefix the file name with "meta-" or "google-".`);
  const columns = mapHeaders(headers, platform);
  const warnings: string[] = [];
  for (const required of ["date", "impressions"] as Field[]) {
    if (!columns[required]) throw new Error(`${fileName || "CSV"}: no "${required}" column found. Headers: ${headers.join(", ")}`);
  }
  if (!columns.adId && !columns.adName) throw new Error(`${fileName || "CSV"}: needs an "Ad ID" or "Ad name" column`);
  if (!columns.spend) warnings.push("No spend column; CPA/ROAS and confidence will be limited.");
  if (platform === "meta" && !columns.videoPlays3s) warnings.push("No 3-second video plays column; hook rate unavailable.");
  if (platform === "google" && !columns.views) warnings.push("No video views column; hook rate unavailable.");

  const get = (row: Record<string, string>, f: Field) => (columns[f] ? row[columns[f]!] : undefined);
  const num = (row: Record<string, string>, f: Field) => parseNumber(get(row, f));
  const pct = (row: Record<string, string>, f: Field) => {
    const raw = get(row, f);
    const n = parseNumber(raw);
    return n === undefined ? undefined : raw?.includes("%") || n > 1 ? n / 100 : n;
  };

  const ads = new Map<string, CsvImportResult["ads"][number]>();
  const metrics: CsvImportResult["metrics"] = [];
  let skippedRows = 0;
  let accountExternalId = "", accountName = "";

  for (const row of rows) {
    const date = parseDate(get(row, "date"));
    const name = get(row, "adName") ?? "";
    const externalId = get(row, "adId") || name;
    if (!date || !externalId || /^total/i.test(name)) { skippedRows++; continue; }
    accountExternalId ||= get(row, "accountId") ?? "";
    accountName ||= get(row, "accountName") ?? "";
    if (!ads.has(externalId)) ads.set(externalId, { externalId, name: name || externalId, campaignName: get(row, "campaignName"), adsetName: get(row, "adsetName") });

    const impressions = num(row, "impressions");
    const m: CsvImportResult["metrics"][number] = {
      adExternalId: externalId, date, impressions, reach: num(row, "reach"), spend: num(row, "spend"),
      clicks: num(row, "clicks"), linkClicks: num(row, "linkClicks"),
      videoPlays3s: num(row, "videoPlays3s"), videoThruplays: num(row, "videoThruplays"),
      conversions: num(row, "conversions"), conversionValue: num(row, "conversionValue"), leads: num(row, "leads"),
      views: num(row, "views"), viewRate: pct(row, "viewRate"), raw: row,
    };
    // Google reports quartiles as percentages of impressions; Meta as absolute play counts.
    for (const q of ["videoP25", "videoP50", "videoP75", "videoP100"] as const) {
      if (platform === "google") {
        const rate = pct(row, q);
        m[q] = rate === undefined || impressions === undefined ? undefined : Math.round(rate * impressions);
      } else m[q] = num(row, q);
    }
    metrics.push(m);
  }
  const fallbackAccount = platform === "meta" ? "meta-csv" : "google-csv";
  return {
    platform, ads: [...ads.values()], metrics, skippedRows, columns, warnings,
    accountExternalId: accountExternalId || fallbackAccount,
    accountName: accountName || (platform === "meta" ? "Meta (CSV import)" : "Google Ads (CSV import)"),
  };
}
