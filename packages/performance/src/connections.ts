import { randomUUID } from "node:crypto";
import { DEFAULT_CONVERSION_ACTIONS, DEFAULT_LEAD_ACTIONS, MetaAdapter, metaConfigFromEnv, type MetaConfig } from "./adapters/meta.js";
import type { PerformanceStore } from "./store.js";

/*
 * Ad platform connections. One connection = one access token plus the ad accounts it may read,
 * so several businesses / Business Managers can be synced side by side. Connections added in the
 * dashboard live in the performance database; the legacy `.env` pair (META_ACCESS_TOKEN +
 * META_AD_ACCOUNT_IDS) shows up as a read-only connection with the id "env".
 */

export const ENV_CONNECTION_ID = "env";

export interface MetaConnection {
  id: string;
  platform: "meta";
  label: string;
  accessToken: string;
  /** Ad account ids without the `act_` prefix. */
  accountIds: string[];
  apiVersion?: string;
  conversionActions?: string[];
  leadActions?: string[];
  enabled: boolean;
  source: "env" | "dashboard";
  createdAt: string;
  updatedAt: string;
}

/** What the API accepts when a connection is created or edited; the token is optional on edit. */
export interface MetaConnectionInput {
  label?: string;
  accessToken?: string;
  accountIds?: string[] | string;
  apiVersion?: string;
  conversionActions?: string[] | string;
  leadActions?: string[] | string;
  enabled?: boolean;
}

/** The connection as the browser sees it: never the token, only a hint of its last characters. */
export type PublicMetaConnection = Omit<MetaConnection, "accessToken"> & { tokenHint: string };

export const normalizeAccountId = (id: string) => id.trim().replace(/^act_/i, "");
const list = (v: string[] | string | undefined): string[] | undefined => {
  if (v === undefined) return undefined;
  const parts = (Array.isArray(v) ? v : v.split(/[,\s]+/)).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
};

export function redactConnection(c: MetaConnection): PublicMetaConnection {
  const { accessToken, ...rest } = c;
  return { ...rest, tokenHint: accessToken.length > 6 ? `…${accessToken.slice(-4)}` : "set" };
}

/** Validates user input and merges it over an existing connection. Throws a readable error for the UI. */
export function normalizeConnectionInput(input: MetaConnectionInput, existing?: MetaConnection, now = new Date().toISOString()): MetaConnection {
  const label = (input.label ?? existing?.label ?? "").trim();
  if (!label) throw new Error("Give the connection a name (for example the business or client)");
  if (label.length > 80) throw new Error("The name is too long (80 characters max)");
  const accessToken = (input.accessToken ?? "").trim() || existing?.accessToken || "";
  if (!accessToken) throw new Error("An access token is required");
  if (/\s/.test(accessToken)) throw new Error("The access token must not contain spaces");
  const accountIds = [...new Set((list(input.accountIds) ?? existing?.accountIds ?? []).map(normalizeAccountId))];
  if (!accountIds.length) throw new Error("Add at least one ad account id");
  const bad = accountIds.find((id) => !/^\d{1,20}$/.test(id));
  if (bad) throw new Error(`"${bad}" is not an ad account id (digits, with or without the act_ prefix)`);
  const apiVersion = (input.apiVersion ?? existing?.apiVersion ?? "").trim() || undefined;
  if (apiVersion && !/^v\d+\.\d+$/.test(apiVersion)) throw new Error("The API version looks like v21.0");
  return {
    id: existing?.id ?? `meta_${randomUUID().slice(0, 8)}`, platform: "meta", label, accessToken, accountIds, apiVersion,
    conversionActions: input.conversionActions !== undefined ? list(input.conversionActions) : existing?.conversionActions,
    leadActions: input.leadActions !== undefined ? list(input.leadActions) : existing?.leadActions,
    enabled: input.enabled ?? existing?.enabled ?? true, source: "dashboard",
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
}

/** The `.env` configuration as a connection, when both variables are set. */
export function envMetaConnection(env: NodeJS.ProcessEnv = process.env): MetaConnection | undefined {
  const cfg = metaConfigFromEnv(env);
  if (!cfg) return undefined;
  const disabled = env.META_ENV_CONNECTION_ENABLED?.trim() === "0";
  return {
    id: ENV_CONNECTION_ID, platform: "meta", label: env.META_CONNECTION_LABEL?.trim() || "From .env", accessToken: cfg.accessToken,
    accountIds: cfg.accountIds.map(normalizeAccountId), apiVersion: cfg.apiVersion, conversionActions: cfg.conversionActions, leadActions: cfg.leadActions,
    enabled: !disabled, source: "env", createdAt: "", updatedAt: "",
  };
}

/** Every Meta connection: the `.env` one first, then the ones saved from the dashboard. */
export function metaConnections(store: PerformanceStore, env: NodeJS.ProcessEnv = process.env): MetaConnection[] {
  const fromEnv = envMetaConnection(env);
  const saved = store.connections().filter((c) => c.platform === "meta") as MetaConnection[];
  return fromEnv ? [fromEnv, ...saved] : saved;
}

export function metaConfigFor(c: MetaConnection): MetaConfig {
  return {
    connectionId: c.id, label: c.label, accessToken: c.accessToken, accountIds: c.accountIds, apiVersion: c.apiVersion || "v21.0",
    conversionActions: c.conversionActions?.length ? c.conversionActions : DEFAULT_CONVERSION_ACTIONS,
    leadActions: c.leadActions?.length ? c.leadActions : DEFAULT_LEAD_ACTIONS,
  };
}

/** One adapter per enabled connection, ready for `syncAll({ adapters })`. */
export function metaAdapters(store: PerformanceStore, env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): MetaAdapter[] {
  return metaConnections(store, env).filter((c) => c.enabled).map((c) => new MetaAdapter(metaConfigFor(c), fetchImpl));
}
