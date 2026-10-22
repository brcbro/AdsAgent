import type {
  AgentJob, AgentSession, AgentSessionSummary, AgentState, ScriptCheck, WorkerInfo, AvatarPage, BrollClip, CaptionPreset, MusicTrack,
  Project, ProjectDraft, RenderStatus, RenderVersion, StudioConfig,
  AdSeriesPoint, KbBriefing, PatternsResponse, PerformanceOverview, PlatformAd, ProjectPerformance, Suggestion, SuggestionKind, SyncReport, Teardown, TeardownReport,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fetch JSON; non-2xx responses throw an ApiError carrying the server's `error` message. */
async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...rest,
      ...(json !== undefined
        ? { method: rest.method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }
        : {}),
    });
  } catch {
    throw new ApiError("Can't reach the dashboard server. Check that `pnpm dashboard` is running.", 0);
  }
  const text = await response.text();
  let data: unknown = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { /* plain-text error body */ }
  if (!response.ok) {
    const message = (data as { error?: string } | undefined)?.error ?? (text || `Request failed (${response.status})`);
    throw new ApiError(message, response.status);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  projects: () => request<Project[]>("/api/projects"),
  project: (id: string) => request<Project>(`/api/projects/${enc(id)}`),
  createProject: (body: Partial<Project>) => request<Project>("/api/projects", { json: body }),
  saveProject: (id: string, draft: Partial<ProjectDraft>) =>
    request<Project>(`/api/projects/${enc(id)}/metadata`, { method: "PUT", json: draft }),
  versions: (id: string) => request<RenderVersion[]>(`/api/projects/${enc(id)}/versions`),
  restoreVersion: (id: string, versionId: string) =>
    request<{ project: Project; scriptChanged: boolean }>(`/api/projects/${enc(id)}/versions/${enc(versionId)}/restore`, { json: {} }),
  archiveProject: (id: string) => request<{ ok: true; archivedTo: string }>(`/api/projects/${enc(id)}/archive`, { json: {} }),

  localPreview: (id: string, meta: Project) =>
    request<{ ok: true; id: string; project: Project }>(`/api/projects/${enc(id)}/local-preview`, { json: meta }),
  sendAvatar: (id: string, meta: Project) => request<{ ok: true }>(`/api/projects/${enc(id)}/send`, { json: meta }),
  applyEdits: (id: string, meta: Project) => request<{ ok: true }>(`/api/projects/${enc(id)}/recaption`, { json: meta }),
  cancelRender: (projectId: string) => request<{ ok: true }>("/api/render/cancel", { json: { projectId } }),
  renderStatus: () => request<RenderStatus>("/api/render-status"),
  logDownload: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/projects/${enc(id)}/download`, { json: body }),

  presets: () => request<CaptionPreset[]>("/api/caption-presets"),
  music: () => request<MusicTrack[]>("/api/music-tracks"),
  broll: () => request<BrollClip[]>("/api/broll/catalog"),
  studioConfig: () => request<StudioConfig>("/api/studio-config"),
  avatars: (params: { page: number; q?: string; portrait?: boolean; gender?: string }) => {
    const search = new URLSearchParams({ page: String(params.page) });
    if (params.q) search.set("q", params.q);
    if (params.portrait) search.set("portrait", "1");
    if (params.gender) search.set("gender", params.gender);
    return request<AvatarPage>(`/api/avatars?${search}`);
  },

  agentState: () => request<AgentState>("/api/agent/state"),

  performance: () => request<PerformanceOverview>("/api/performance/overview"),
  performanceSync: () => request<SyncReport>("/api/performance/sync", { json: {} }),
  patterns: () => request<PatternsResponse>("/api/performance/patterns"),
  suggestions: (params: { projectId?: string; kind?: SuggestionKind[]; status?: Array<"open" | "accepted" | "dismissed"> } = {}) => {
    const search = new URLSearchParams();
    if (params.projectId) search.set("projectId", params.projectId);
    if (params.kind?.length) search.set("kind", params.kind.join(","));
    if (params.status?.length) search.set("status", params.status.join(","));
    const qs = search.toString();
    return request<{ suggestions: Suggestion[] }>(`/api/performance/suggestions${qs ? `?${qs}` : ""}`);
  },
  kbBriefings: () => request<{ briefings: KbBriefing[] }>("/api/performance/briefings"),
  generateBriefings: (body: { count: number; context?: string }) =>
    request<{ generated: Array<{ file: string; id: string; angle: string; hookConcepts: string[]; usedPatternIds: string[] }> }>("/api/performance/briefings", { json: body }),
  suggestionAction: (id: string, action: "accept" | "dismiss" | "reopen") => request<{ ok: true }>(`/api/performance/suggestions/${enc(id)}/${action}`, { json: {} }),
  togglePattern: (id: string, disabled: boolean) => request<{ ok: true; disabled: boolean }>(`/api/performance/patterns/${enc(id)}/toggle`, { json: { disabled } }),
  teardown: (adId: string) => request<Teardown>(`/api/performance/ads/${enc(adId)}/teardown`),
  runTeardowns: (adIds?: string[]) => request<TeardownReport>("/api/performance/teardowns/run", { json: adIds ? { adIds } : {} }),
  performanceSettings: (body: { nightlyEnabled?: boolean; teardownAuto?: boolean; teardownMaxPerRun?: number }) => request<{ ok: true; nightlyEnabled: boolean; teardownAuto: boolean; teardownMaxPerRun: number }>("/api/performance/settings", { json: body }),
  projectPerformance: () => request<Record<string, ProjectPerformance>>("/api/performance/projects"),
  adSeries: (adId: string) => request<{ ad: PlatformAd; series: AdSeriesPoint[] }>(`/api/performance/ads/${enc(adId)}/series`),
  linkAd: (adId: string, projectId: string | null) => request<{ ok: true; ad: PlatformAd }>(`/api/performance/ads/${enc(adId)}/link`, { json: { projectId } }),
  refreshAvatars: () => request<{ total: number; defaultRepaired: boolean; defaultAvatarId: string }>("/api/avatars/refresh", { json: {} }),
  agentSession: (id: string) => request<AgentSession>(`/api/agent/sessions/${enc(id)}`),
  archivedSessions: () => request<AgentSessionSummary[]>("/api/agent/sessions?archived=1"),
  searchSessions: (q: string) => request<{ ids: string[] }>(`/api/agent/sessions?q=${enc(q)}`),
  unarchiveSession: (id: string) => request<AgentSession>(`/api/agent/sessions/${enc(id)}/unarchive`, { json: {} }),
  agentJobs: (params: { sessionId?: string; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params.sessionId) search.set("sessionId", params.sessionId);
    if (params.offset) search.set("offset", String(params.offset));
    if (params.limit) search.set("limit", String(params.limit));
    return request<{ jobs: AgentJob[]; total: number; offset: number; limit: number }>(`/api/agent/jobs?${search}`);
  },
  scriptCheck: (scriptDe: string) => request<ScriptCheck>("/api/agent/script-check", { json: { scriptDe } }),
  workerInfo: (lines = 80) => request<WorkerInfo>(`/api/agent/worker?lines=${lines}`),
  newSession: () => request<AgentSession>("/api/agent/sessions", { json: {} }),
  renameSession: (id: string, title: string) => request<AgentSession>(`/api/agent/sessions/${enc(id)}/rename`, { json: { title } }),
  archiveSession: (id: string) => request<AgentSession>(`/api/agent/sessions/${enc(id)}/archive`, { json: {} }),
  sendBrief: (sessionId: string, body: { message: string; targetSeconds: number; autoProduce: boolean; productionMode?: "local" | "heygen"; avatarId?: string }) =>
    request<AgentJob>(`/api/agent/sessions/${enc(sessionId)}/messages`, { json: body }),
  jobAction: (jobId: string, action: "approve" | "retry" | "cancel" | "reject" | "reopen", body: Record<string, unknown> = {}) =>
    request<AgentJob>(`/api/agent/jobs/${enc(jobId)}/${action}`, { json: body }),
};

/** URL of a project's finished MP4. `version` busts the browser cache only after a new render. */
export function videoUrl(id: string, version?: string | number): string {
  return `/api/video/${enc(id)}/final.mp4${version ? `?v=${enc(String(version))}` : ""}`;
}

export function versionVideoUrl(id: string, versionId: string): string {
  return `/api/projects/${enc(id)}/versions/${enc(versionId)}/video`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
