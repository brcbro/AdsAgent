/** Small RFC-4180-ish CSV parser: quotes, escaped quotes, CRLF, BOM, and `,` / `;` / tab delimiters. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delimiter) { record.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.some((f) => f.trim() !== "")) records.push(record);
      record = [];
      continue;
    }
    field += c;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== "")) records.push(record);
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (r[i] ?? "").trim(); });
    return row;
  });
  return { headers, rows };
}

function detectDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",", bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/** "1.234,56" / "1,234.56" / "12,5%" / "€ 1 234" → number. Empty or "--" → undefined. */
export function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  let s = value.trim().replace(/[^\d.,\-]/g, "");
  if (!s || s === "-" ) return undefined;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the later one is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Only commas: decimal if exactly one with 1–2 digits after it, otherwise thousands.
    const after = s.length - lastComma - 1;
    s = (s.split(",").length === 2 && after > 0 && after <= 2) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot > -1) {
    const after = s.length - lastDot - 1;
    if (s.split(".").length > 2 || after === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Accepts YYYY-MM-DD, DD.MM.YYYY, MM/DD/YYYY, "Jun 17, 2026" → YYYY-MM-DD. */
export function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
