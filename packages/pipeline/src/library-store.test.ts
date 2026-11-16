import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryStore, libraryKind } from "./library-store.js";

function tempLibrary(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "library-store-test-"));
  const data = path.join(dir, "data");
  const write = (rel: string, body: string) => {
    const abs = path.join(data, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  };
  const stores: LibraryStore[] = [];
  // Forward slashes on purpose: the folder must be recognised whichever slash style it is given in.
  const open = (maxBytes?: number) => { const s = new LibraryStore(path.join(dir, "lib.sqlite"), data.replace(/\\/g, "/"), maxBytes); stores.push(s); return s; };
  t.after(() => { for (const s of stores) { try { s.close(); } catch { /* already closed */ } } fs.rmSync(dir, { recursive: true, force: true }); });
  return { data, write, open };
}

test("only Library files count: clips, previews, the catalog and music; never temp or stray files", () => {
  assert.equal(libraryKind("broll/clips/Trading/a.mp4"), "broll");
  assert.equal(libraryKind("broll/clips/a.MOV"), "broll");
  assert.equal(libraryKind("broll/previews/a.mp4.jpg"), "preview");
  assert.equal(libraryKind("broll/catalog.json"), "catalog");
  assert.equal(libraryKind("music/01-funk.mp3"), "music");
  for (const p of ["broll/clips/a.mp4.123.part", "broll/inbox/a.mp4", "broll/download-batch-1.result.json", "music/sub/a.mp3",
    "ads/x/main.mp4", "broll/clips/a.mp4.9.restore.tmp", "broll/clips/.hidden/a.mp4"]) assert.equal(libraryKind(p), null, p);
});

test("stores new files, skips unchanged ones, rewrites changed ones", async (t) => {
  const lib = tempLibrary(t);
  lib.write("broll/clips/Trading/a.mp4", "clip-a");
  lib.write("music/01.mp3", "song");
  lib.write("broll/catalog.json", "[]");
  lib.write("broll/inbox/new.mp4", "not yet classified");
  const store = lib.open();
  const first = await store.sync();
  assert.equal(first.stored, 3); assert.equal(first.restored, 0);
  assert.equal(store.status().files, 3);
  assert.equal(store.status().byKind.music.files, 1);
  const second = await store.sync();
  assert.equal(second.stored, 0); assert.equal(second.unchanged, 3);
  const later = new Date(Date.now() + 5000);
  const catalog = lib.write("broll/catalog.json", "[{\"file\":\"a\"}]");
  fs.utimesSync(catalog, later, later);
  const third = await store.sync();
  assert.equal(third.updated, 1);
});

test("a fresh disk gets the whole Library back from the database, catalog first", async (t) => {
  const lib = tempLibrary(t);
  lib.write("broll/clips/Trading/a.mp4", "clip-a");
  lib.write("broll/previews/a.mp4.jpg", "jpg");
  lib.write("broll/catalog.json", "[1]");
  lib.write("music/01.mp3", "song");
  const store = lib.open();
  await store.sync();
  fs.rmSync(lib.data, { recursive: true, force: true });
  const report = await store.sync();
  assert.equal(report.restored, 4);
  assert.equal(fs.readFileSync(path.join(lib.data, "broll", "clips", "Trading", "a.mp4"), "utf8"), "clip-a");
  assert.equal(fs.readFileSync(path.join(lib.data, "broll", "catalog.json"), "utf8"), "[1]");
  assert.equal(fs.readFileSync(path.join(lib.data, "music", "01.mp3"), "utf8"), "song");
  // Restored files keep their time, so the next sync does not read them again.
  assert.equal((await store.sync()).unchanged, 4);
});

test("a clip moved to its category folder moves in the database instead of coming back", async (t) => {
  const lib = tempLibrary(t);
  const before = lib.write("broll/clips/new-clip.mp4", "same bytes");
  const store = lib.open();
  await store.sync();
  const after = path.join(lib.data, "broll", "clips", "Lifestyle", "new-clip.mp4");
  fs.mkdirSync(path.dirname(after), { recursive: true });
  fs.renameSync(before, after);
  const report = await store.sync();
  assert.equal(report.stored, 1); assert.equal(report.moved, 1); assert.equal(report.restored, 0);
  assert.equal(fs.existsSync(before), false);
  assert.equal(store.status().byKind.broll.files, 1);
});

test("files too large for one database value stay on disk and are reported; remove() deletes for good", async (t) => {
  const lib = tempLibrary(t);
  lib.write("broll/clips/huge.mp4", "x".repeat(50));
  lib.write("broll/clips/small.mp4", "x");
  const store = lib.open(10);
  const report = await store.sync();
  assert.deepEqual(report.tooLarge, ["broll/clips/huge.mp4"]);
  assert.equal(store.status().files, 1);
  assert.equal(store.remove("broll/clips/small.mp4"), true);
  assert.equal(fs.existsSync(path.join(lib.data, "broll", "clips", "small.mp4")), false);
  assert.equal((await store.sync()).restored, 0);
});

test("export → import moves the Library to another machine, merging catalogs and refusing foreign paths", async (t) => {
  const a = tempLibrary(t);
  const b = tempLibrary(t);
  a.write("broll/clips/Trading/chart.mp4", "chart-bytes");
  a.write("broll/previews/chart.mp4.jpg", "jpg");
  a.write("music/01.mp3", "song");
  a.write("broll/catalog.json", JSON.stringify([{ file: "E:\WORK\data\broll\clips\Trading\chart.mp4", name: "chart.mp4",
    preview: "data\broll\previews\chart.mp4.jpg", category: "Trading", tags: ["chart"], description: "Candles on a laptop" }]));
  const storeA = a.open();
  await storeA.sync();
  const bundle = path.join(path.dirname(a.data), "export.sqlite");
  storeA.exportTo(bundle);

  // Machine B already has a clip of its own.
  b.write("broll/clips/Lifestyle/own.mp4", "own-bytes");
  b.write("broll/catalog.json", JSON.stringify([{ file: "/srv/app/data/broll/clips/Lifestyle/own.mp4", name: "own.mp4", category: "Lifestyle", tags: [] }]));
  const storeB = b.open();
  await storeB.sync();

  // A hostile or damaged export must not write outside the Library.
  const { DatabaseSync } = await import("node:sqlite");
  const tamper = new DatabaseSync(bundle);
  for (const p of ["../escape.mp4", "ads/x/main.mp4"]) {
    tamper.prepare("INSERT INTO library_files(path, kind, sha256, size, mtime_ms, updated_at, data) VALUES(?,?,?,?,?,?,?)")
      .run(p, "broll", "0", 1, 0, "", new Uint8Array([1]));
  }
  tamper.close();

  const report = await storeB.importFrom(bundle);
  assert.equal(report.added, 3); // clip, preview, music
  assert.equal(report.replaced, 1); // catalog
  assert.equal(report.rejected, 2);
  assert.equal(fs.readFileSync(path.join(b.data, "broll", "clips", "Trading", "chart.mp4"), "utf8"), "chart-bytes");
  assert.equal(fs.readFileSync(path.join(b.data, "music", "01.mp3"), "utf8"), "song");
  assert.equal(fs.existsSync(path.join(path.dirname(b.data), "escape.mp4")), false);
  const catalog = JSON.parse(fs.readFileSync(path.join(b.data, "broll", "catalog.json"), "utf8")) as Array<{ name: string; description?: string }>;
  assert.deepEqual(catalog.map((e) => e.name).sort(), ["chart.mp4", "own.mp4"]);
  assert.equal(catalog.find((e) => e.name === "chart.mp4")?.description, "Candles on a laptop");
  assert.equal(storeB.status().byKind.broll.files, 2);
  // Importing the same file again changes nothing.
  const again = await storeB.importFrom(bundle);
  assert.equal(again.added + again.replaced, 0);
});
