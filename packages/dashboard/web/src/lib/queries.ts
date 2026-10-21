import { QueryClient, keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { isBusy } from "./format";

/*
 * One polling service for the whole app. Render status drives everything else: while something
 * renders, projects and the current project refresh quickly; when idle they refresh slowly.
 * Failed polls retry with exponential back-off and surface as the "connection lost" banner.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      refetchOnWindowFocus: true,
      staleTime: 2_000,
    },
  },
});

export const keys = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  renderStatus: ["render-status"] as const,
  presets: ["presets"] as const,
  music: ["music"] as const,
  broll: ["broll"] as const,
  config: ["studio-config"] as const,
  avatars: (p: object) => ["avatars", p] as const,
  versions: (id: string) => ["versions", id] as const,
  agent: ["agent-state"] as const,
  performance: ["performance"] as const,
  projectPerformance: ["project-performance"] as const,
  patterns: ["patterns"] as const,
  suggestions: (p: object) => ["suggestions", p] as const,
  kbBriefings: ["kb-briefings"] as const,
  teardown: (id: string) => ["teardown", id] as const,
  adSeries: (id: string) => ["ad-series", id] as const,
};

export function useRenderStatus() {
  return useQuery({
    queryKey: keys.renderStatus,
    queryFn: api.renderStatus,
    refetchInterval: (q) => (q.state.status === "error" ? 8_000 : q.state.data?.rendering ? 2_500 : 5_000),
    retry: 1,
  });
}

export function useProjects() {
  const rendering = useRenderStatus().data?.rendering;
  return useQuery({ queryKey: keys.projects, queryFn: api.projects, refetchInterval: rendering ? 4_000 : 20_000 });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: keys.project(id ?? ""),
    queryFn: () => api.project(id!),
    enabled: !!id,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 2_500 : false),
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}

const STATIC = { staleTime: 5 * 60_000, refetchOnWindowFocus: false } as const;
export const usePresets = () => useQuery({ queryKey: keys.presets, queryFn: api.presets, ...STATIC });
export const useMusic = () => useQuery({ queryKey: keys.music, queryFn: api.music, ...STATIC });
export const useBroll = () => useQuery({ queryKey: keys.broll, queryFn: api.broll, ...STATIC });
export const useStudioConfig = () => useQuery({ queryKey: keys.config, queryFn: api.studioConfig, ...STATIC });

export function useAvatars(params: { page: number; q?: string; portrait?: boolean; gender?: string }, enabled = true) {
  return useQuery({
    queryKey: keys.avatars(params),
    queryFn: () => api.avatars(params),
    enabled,
    placeholderData: keepPreviousData,
    ...STATIC,
  });
}

export function useVersions(id: string, enabled = true) {
  return useQuery({ queryKey: keys.versions(id), queryFn: () => api.versions(id), enabled, staleTime: 0 });
}

export function useAgentState(active: boolean) {
  return useQuery({ queryKey: keys.agent, queryFn: api.agentState, refetchInterval: active ? 3_000 : 12_000 });
}

export const usePerformance = () => useQuery({ queryKey: keys.performance, queryFn: api.performance, staleTime: 10_000 });
export const useAdSeries = (id: string | undefined) =>
  useQuery({ queryKey: keys.adSeries(id ?? ""), queryFn: () => api.adSeries(id!), enabled: !!id, ...STATIC });
export const useProjectPerformance = () => useQuery({ queryKey: keys.projectPerformance, queryFn: api.projectPerformance, staleTime: 60_000, refetchOnWindowFocus: false });
export const usePatterns = () => useQuery({ queryKey: keys.patterns, queryFn: api.patterns, staleTime: 30_000 });
export const useTeardown = (id: string | undefined) =>
  useQuery({ queryKey: keys.teardown(id ?? ""), queryFn: () => api.teardown(id!), enabled: !!id, staleTime: 0, retry: false });
export const useSuggestions = (params: Parameters<typeof api.suggestions>[0] = {}, enabled = true) =>
  useQuery({ queryKey: keys.suggestions(params), queryFn: () => api.suggestions(params), enabled, staleTime: 30_000 });
export const useKbBriefings = (enabled = true) => useQuery({ queryKey: keys.kbBriefings, queryFn: api.kbBriefings, enabled, staleTime: 30_000 });
