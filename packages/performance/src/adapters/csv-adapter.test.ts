import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseDate, parseNumber } from "../csv.js";
import { detectPlatform, importCsv } from "./csv-adapter.js";

test("CSV parser handles quotes, embedded delimiters, CRLF, BOM and semicolons", () => {
  const { headers, rows } = parseCsv('﻿Ad name;Spend\r\n"Hook, loss framed";"1.234,56"\r\nB;7\r\n');
  assert.deepEqual(headers, ["Ad name", "Spend"]);
  assert.equal(rows[0]["Ad name"], "Hook, loss framed"); assert.equal(rows[0].Spend, "1.234,56"); assert.equal(rows.length, 2);
});

test("Numbers in German and English locale formats, percentages and currency symbols", () => {
  assert.equal(parseNumber("1.234,56"), 1234.56); assert.equal(parseNumber("1,234.56"), 1234.56);
  assert.equal(parseNumber("12,5%"), 12.5); assert.equal(parseNumber("€ 1 234"), 1234);
  assert.equal(parseNumber("1,234"), 1234); assert.equal(parseNumber("0,5"), 0.5); assert.equal(parseNumber("--"), undefined);
  assert.equal(parseNumber("1.234"), 1234); assert.equal(parseNumber("3.5"), 3.5);
});

test("Dates in ISO, German and US formats", () => {
  assert.equal(parseDate("2026-10-19"), "2026-10-19"); assert.equal(parseDate("19.10.2026"), "2026-10-19"); assert.equal(parseDate("10/19/2026"), "2026-10-19");
});

const META = `Reporting starts,Day,Ad name,Ad ID,Campaign name,Ad set name,Impressions,Reach,Amount spent (EUR),Link clicks,Clicks (all),3-second video plays,ThruPlays,Video plays at 25%,Video plays at 100%,Purchases,Purchases conversion value
2026-10-18,2026-10-18,test_2026_10_11_h1_c2_9x16,120001,Trading DE,Broad 25-45,"12,345",9000,"150.25",240,300,3100,900,3500,700,4,"380.00"
2026-10-19,2026-10-19,test_2026_10_11_h1_c2_9x16,120001,Trading DE,Broad 25-45,"10,000",8000,"120.00",200,250,2500,800,3000,600,3,"300.00"
2026-10-19,2026-10-19,Competitor style hook,120002,Trading DE,Broad 25-45,8000,6000,90.00,100,120,1200,200,1400,150,1,90.00
,Total,,,,,"30,345",,,,,,,,,,`;

test("Meta Ads Manager export is detected and mapped into daily metrics; the Total row is skipped", () => {
  const r = importCsv(META, "export.csv");
  assert.equal(r.platform, "meta");
  assert.equal(r.ads.length, 2); assert.equal(r.metrics.length, 3); assert.equal(r.skippedRows, 1);
  const first = r.metrics[0];
  assert.equal(first.adExternalId, "120001"); assert.equal(first.date, "2026-10-18");
  assert.equal(first.impressions, 12_345); assert.equal(first.spend, 150.25); assert.equal(first.linkClicks, 240); assert.equal(first.clicks, 300);
  assert.equal(first.videoPlays3s, 3100); assert.equal(first.videoThruplays, 900); assert.equal(first.videoP25, 3500); assert.equal(first.videoP100, 700);
  assert.equal(first.conversions, 4); assert.equal(first.conversionValue, 380);
  assert.deepEqual(r.warnings, []);
});

const GOOGLE = `Day;Ad;Ad ID;Campaign;Ad group;Impr.;Cost;Clicks;Views;View rate;Video played to 25%;Video played to 100%;Conversions;Conv. value
19.10.2026;YT Hook A;777;DE Video;Group 1;20.000;210,50;300;6.000;30,00%;45,00%;12,50%;5,00;450,00`;

test("Google Ads export with German locale is detected; quartile percentages become counts", () => {
  const r = importCsv(GOOGLE, "google-ads.csv");
  assert.equal(r.platform, "google");
  const m = r.metrics[0];
  assert.equal(m.date, "2026-10-19"); assert.equal(m.impressions, 20_000); assert.equal(m.spend, 210.5); assert.equal(m.views, 6000);
  assert.equal(m.viewRate, 0.3); assert.equal(m.videoP25, 9000); assert.equal(m.videoP100, 2500); assert.equal(m.conversions, 5); assert.equal(m.conversionValue, 450);
  assert.equal(r.ads[0].campaignName, "DE Video");
});

test("Platform detection by file prefix beats header guessing; unknown layouts fail clearly", () => {
  assert.equal(detectPlatform(["Day", "Impr.", "Cost"], "meta-anything.csv"), "meta");
  assert.throws(() => importCsv("foo,bar\n1,2", "mystery.csv"), /Meta or Google/);
  assert.throws(() => importCsv("Day,Ad name\n2026-01-01,x", "meta-x.csv"), /impressions/);
});

test("A value column without a count column is never mistaken for the conversion count", () => {
  const g = importCsv("Day;Ad;Ad ID;Impr.;Cost;Conv. value\n19.10.2026;A;1;1000;10,00;450,00", "google-x.csv");
  assert.equal(g.metrics[0].conversions, undefined); assert.equal(g.metrics[0].conversionValue, 450);
  const m = importCsv("Day,Ad name,Ad ID,Impressions,Amount spent (EUR),Purchases conversion value\n2026-10-19,A,1,1000,10,380", "meta-x.csv");
  assert.equal(m.metrics[0].conversions, undefined); assert.equal(m.metrics[0].conversionValue, 380);
});
