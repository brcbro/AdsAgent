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
