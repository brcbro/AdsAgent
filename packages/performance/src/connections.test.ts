import assert from "node:assert/strict";
import test from "node:test";
import { ENV_CONNECTION_ID, envMetaConnection, metaAdapters, metaConfigFor, metaConnections, normalizeConnectionInput, redactConnection } from "./connections.js";
import { PerformanceStore } from "./store.js";
import { syncAll } from "./sync.js";
import type { AdPlatformAdapter } from "./sync.js";

test("Connection input is validated and merged over the saved one; the token is kept when left blank", () => {
  assert.throws(() => normalizeConnectionInput({ label: "", accessToken: "t", accountIds: "1" }), /name/);
  assert.throws(() => normalizeConnectionInput({ label: "A", accountIds: "123" }), /token/);
  assert.throws(() => normalizeConnectionInput({ label: "A", accessToken: "t", accountIds: "" }), /at least one/);
  assert.throws(() => normalizeConnectionInput({ label: "A", accessToken: "t", accountIds: "abc" }), /not an ad account id/);
  assert.throws(() => normalizeConnectionInput({ label: "A", accessToken: "t", accountIds: "123", apiVersion: "21" }), /v21\.0/);
  const created = normalizeConnectionInput({ label: " Client A ", accessToken: "tok-1234567", accountIds: "act_123, 456 123" }, undefined, "2026-10-23T00:00:00Z");
  assert.equal(created.label, "Client A"); assert.deepEqual(created.accountIds, ["123", "456"]); assert.equal(created.enabled, true);
  assert.match(created.id, /^meta_[0-9a-f]{8}$/); assert.equal(created.source, "dashboard"); assert.equal(created.createdAt, "2026-10-23T00:00:00Z");
  const edited = normalizeConnectionInput({ enabled: false, accountIds: ["789"], conversionActions: "lead" }, created, "2026-10-24T00:00:00Z");
  assert.equal(edited.id, created.id); assert.equal(edited.accessToken, "tok-1234567"); assert.deepEqual(edited.accountIds, ["789"]);
  assert.equal(edited.enabled, false); assert.deepEqual(edited.conversionActions, ["lead"]); assert.equal(edited.createdAt, created.createdAt);
  const pub = redactConnection(edited);
  assert.equal((pub as { accessToken?: string }).accessToken, undefined); assert.equal(pub.tokenHint, "…4567");
  const cfg = metaConfigFor(edited);
  assert.equal(cfg.connectionId, edited.id); assert.equal(cfg.apiVersion, "v21.0"); assert.deepEqual(cfg.conversionActions, ["lead"]); assert.ok(cfg.leadActions.length);
});

test("The .env pair becomes a read-only connection and saved connections are listed after it", () => {
  const store = new PerformanceStore(":memory:");
  assert.equal(envMetaConnection({}), undefined);
  const env = { META_ACCESS_TOKEN: "env-token", META_AD_ACCOUNT_IDS: "act_1,2", META_CONNECTION_LABEL: "Main BM" };
  const fromEnv = envMetaConnection(env)!;
  assert.equal(fromEnv.id, ENV_CONNECTION_ID); assert.equal(fromEnv.label, "Main BM"); assert.deepEqual(fromEnv.accountIds, ["1", "2"]); assert.equal(fromEnv.source, "env");
  assert.equal(envMetaConnection({ ...env, META_ENV_CONNECTION_ENABLED: "0" })!.enabled, false);
  store.saveConnection(normalizeConnectionInput({ label: "Client B", accessToken: "b-token", accountIds: "99", enabled: false }));
  store.saveConnection(normalizeConnectionInput({ label: "Client C", accessToken: "c-token", accountIds: "77" }));
  assert.deepEqual(metaConnections(store, env).map((c) => c.label), ["Main BM", "Client B", "Client C"]);
  assert.deepEqual(metaAdapters(store, env).map((a) => a.label), ["Main BM", "Client C"], "disabled connections get no adapter");
  const c = store.connections()[0];
  assert.ok(store.deleteConnection(c.id)); assert.equal(store.connections().length, 1); assert.equal(store.deleteConnection("nope"), false);
  store.close();
});

function fake(label: string, connectionId: string, accounts: string[], fail = false): AdPlatformAdapter {
  return {
    platform: "meta", connectionId, label,
    async listAccounts() {
      if (fail) throw new Error("Meta API: Invalid OAuth access token (code 190)");
      return accounts.map((id) => ({ id: `meta:${id}`, platform: "meta" as const, externalId: id, name: `Account ${id}`, status: "connected" as const, connectionId }));
    },
    async listAds(accountId: string, seen = "2026-10-21") { return [{ id: `meta:ad-${accountId}`, accountId, platform: "meta" as const, externalId: `ad-${accountId}`, name: `ad ${accountId}`, firstSeen: seen, lastSeen: seen }]; },
    async fetchDailyMetrics(accountId: string, _from: string, to: string) { return [{ adId: `meta:ad-${accountId}`, date: to, impressions: 2000, spend: 30, linkClicks: 20, videoPlays3s: 600, videoThruplays: 200 }]; },
  };
}

test("syncAll runs every connection, tags accounts with their connection, and skips an account listed twice", async () => {
  const store = new PerformanceStore(":memory:");
  const report = await syncAll(store, {
    adapters: [fake("Client A", "meta_a", ["1", "2"]), fake("Client B", "meta_b", ["2", "3"]), fake("Broken", "meta_c", [], true)],
    inboxDir: "/nonexistent-inbox-for-test-" + process.pid, projectIds: [], today: "2026-10-22", until: "2026-10-21",
  });
  assert.deepEqual(report.accounts.map((a) => [a.connectionLabel, a.accountId, a.status]), [
    ["Client A", "meta:1", "synced"], ["Client A", "meta:2", "synced"],
    ["Client B", "meta:2", "skipped"], ["Client B", "meta:3", "synced"],
    ["Broken", "meta:connection:meta_c", "error"],
  ]);
  assert.match(report.accounts[4].error!, /OAuth/);
  const byId = new Map(store.accounts().map((a) => [a.id, a]));
  assert.equal(byId.get("meta:1")?.connectionId, "meta_a"); assert.equal(byId.get("meta:2")?.connectionId, "meta_a"); assert.equal(byId.get("meta:3")?.connectionId, "meta_b");
  assert.equal(report.adsScored, 3);
  store.close();
});
