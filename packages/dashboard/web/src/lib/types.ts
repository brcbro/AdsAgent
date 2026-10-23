/*
 * API shapes returned by the dashboard server. They mirror packages/core/src/metadata.ts,
 * captionPresets.ts and pipeline/src/agent-store.ts; those modules import Node APIs, so the
 * browser build keeps its own copies.
 */

export type ProjectStatus = "draft" | "generating" | "rendering" | "done" | "error";
export type AspectRatio = "9:16" | "16:9";

export interface MusicConfig {
  enabled?: boolean;
  file?: string;
  volume?: number;
  startOffsetMs?: number;
  youtubeUrl?: string;
  title?: string;
  duck?: boolean;
}

export interface CaptionConfig {
  presetId?: string;
  fontSize?: number;
  color?: string;
  bottomPercent?: number;
  background?: string;
}

export interface AvatarConfig {
  heygenAvatarId: string;
  name?: string;
  previewImageUrl?: string;
  gender?: "male" | "female";
}

export interface Project {
  id: string;
  title: string;
  scriptDe: string;
  introMs: number;
  avatarZoom: number;
  aspectRatio?: AspectRatio;
  outputSpeed?: number;
  fullAvatar?: boolean;
  brollCutMs?: number;
  fastCuts?: boolean;
  brollPinned?: string[];
  brollExcluded?: string[];
  avatar: AvatarConfig;
  muteAvatar?: boolean;
  avatarVolume?: number;
  music?: MusicConfig;
  captions?: CaptionConfig;
  status: ProjectStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  outputFile?: string;
}

/** Fields the editor may change; everything else is owned by the server and pipeline. */
export const EDITABLE_FIELDS = [
  "title", "scriptDe", "introMs", "aspectRatio", "outputSpeed", "fullAvatar",
  "brollCutMs", "avatar", "music", "captions", "brollPinned", "brollExcluded",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type ProjectDraft = Pick<Project, EditableField>;

/** A finished render kept in the project's history (packages/pipeline/src/versions.ts). */
export interface RenderVersion {
  id: string;
  createdAt: string;
  file: string;
  sizeBytes: number;
  settings: Partial<Pick<Project, "title" | "scriptDe" | "aspectRatio" | "outputSpeed" | "introMs" | "fullAvatar"
    | "brollCutMs" | "avatar" | "music" | "captions" | "brollPinned" | "brollExcluded">>;
}

export interface CaptionPreset {
  id: string;
  name: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  activeColor?: string;
  stroke: string;
  shadow: string;
  bottomPercent: number;
  background?: string;
  letterSpacing?: string;
  fontStyle?: string;
  popIn?: boolean;
  mode: "phrase" | "word";
  phraseWords?: number;
}

export interface MusicTrack {
  file: string;
  title: string;
  artist: string;
  youtubeUrl?: string;
  available: boolean;
  previewUrl: string;
}

export interface BrollClip {
  file: string;
  name: string;
  preview: string;
  category: string;
  tags?: string[];
  sourceFolder?: string;
  /** How the category was decided; missing means hand-sorted into its folder. */
  source?: "folder" | "classifier" | "human";
  confidence?: number;
  needsReview?: boolean;
  classifiedAt?: string;
  description?: string;
  addedAt?: string;
  /** Still in the inbox, waiting for the classifier. */
  pending?: true;
  clipUrl: string | null;
  previewUrl: string | null;
}

export interface BrollIngestState {
  running: boolean;
  paused?: boolean;
  startedAt?: string;
  total: number;
  done: number;
  current?: string;
  errors: Array<{ file: string; message: string; at: string }>;
  lastRunAt?: string;
  lastResult?: string;
  log?: string[];
  categories: string[];
  threshold: number;
  inboxDir: string;
}

export interface BrollImportResult {
  imported: Array<{ source: string; file: string }>;
  skipped: Array<{ path: string; reason: string }>;
  category: string;
}

export interface StudioConfig {
  heygenApiVersion?: string;
  defaultAvatar?: HeyGenAvatar;
  scriptModel: string;
  voiceModel: string;
  voiceLanguage: string;
  llmProvider?: "anthropic" | "openrouter";
  outputFolder?: string;
  services?: { scripts: boolean; voice: boolean; avatar: boolean };
}

export interface RenderStatus {
  rendering: boolean;
  projectId?: string | null;
  source?: "editor" | "agent" | null;
  startedAt?: string | null;
  lastLine?: string | null;
}

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender?: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

export interface AvatarPage {
  avatars: HeyGenAvatar[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export type JobStatus = "queued" | "running" | "script_review" | "needs_review" | "done" | "error" | "canceled";
export type JobStage = "script" | "voice" | "avatar" | "render" | "quality" | "complete";

export interface QualityCheck { name: string; result: "pass" | "warn" | "fail"; detail: string }
export interface QualityReport { passed: boolean; checkedAt: string; durationSeconds: number; checks: QualityCheck[] }

export interface AgentMessage { role: "user" | "assistant"; text: string; at: string }
export interface AgentSession { id: string; title: string; createdAt: string; messages: AgentMessage[]; titleLocked?: boolean; archivedAt?: string }
/** Chat list entry: no message bodies, just what the sidebar shows. */
export interface AgentSessionSummary {
  id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; lastMessage?: AgentMessage; titleLocked?: boolean; archivedAt?: string;
}
export interface ComplianceFinding { severity: "block" | "warn"; rule: string; match: string; message: string }
/** Result of /api/agent/script-check: claim findings plus the duration estimate the planner itself uses. */
export interface ScriptCheck { findings: ComplianceFinding[]; chars: number; minChars: number; maxChars: number; seconds: number; charsPerSecond: number }
export interface WorkerInfo { running: boolean; restarts: number; startedAt?: string; lastExit?: string; lastExitCode: number | null; log: string[] }

export interface AgentJob {
  productionMode?: "local" | "heygen";
  avatarId?: string;
  avatarName?: string;
  id: string;
  sessionId: string;
  projectId: string;
  brief: string;
  targetSeconds: number;
  autoProduce: boolean;
  status: JobStatus;
  stage: JobStage;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  scriptDe?: string;
  title?: string;
  reply?: string;
  visualPlan?: string[];
  rationale?: string;
  usedPatternIds?: string[];
  quality?: QualityReport;
  error?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectionNote?: string;
  hasProject?: boolean;
  events: Array<{ at: string; text: string }>;
}

export interface AgentState {
  sessions: AgentSessionSummary[];
  /** The most recent jobs plus every active one; older history loads through /api/agent/jobs. */
  jobs: AgentJob[];
  totalJobs: number;
  workerRunning: boolean;
  mode?: string;
}

/* ---------- Performance (ad metrics from Meta / Google / CSV) ---------- */
export type AdPlatform = "meta" | "google";
export interface AdAccount { id: string; platform: AdPlatform; externalId: string; name: string; currency?: string; status: "connected" | "csv" | "disconnected"; lastSyncAt?: string; connectionId?: string }
/** A Meta access token plus the ad accounts it reads; the token itself never reaches the browser. */
export interface MetaConnection {
  id: string; platform: "meta"; label: string; accountIds: string[]; apiVersion?: string; conversionActions?: string[]; leadActions?: string[];
  enabled: boolean; source: "env" | "dashboard"; tokenHint: string; createdAt: string; updatedAt: string;
}
export interface MetaConnectionInput { label?: string; accessToken?: string; accountIds?: string; apiVersion?: string; conversionActions?: string; leadActions?: string; enabled?: boolean }
export interface MetaConnectionTest { ok: true; accounts: Array<{ id: string; name: string; currency?: string; timezone?: string }> }
export interface PlatformAd {
  id: string; accountId: string; platform: AdPlatform; externalId: string; name: string; campaignName?: string; adsetName?: string;
  thumbnailUrl?: string; projectId?: string; variantKey?: string; firstSeen: string; lastSeen: string;
}
export interface LeaderboardRow {
  adId: string; windowDays: number; impressions: number; spend: number;
  hookRate?: number; holdRate?: number; ctr?: number; cpc?: number; cpa?: number; roas?: number; completionRate?: number;
  score: number; percentile: number; isWinner: boolean; isLoser: boolean; isFatigued: boolean; confidence: "low" | "medium" | "high"; computedAt: string;
  ad: PlatformAd; projectTitle?: string;
}
export interface PlatformSummary {
  platform: AdPlatform; accounts: number; ads: number; eligible: number; winners: number; losers: number; fatigued: number; spend: number;
  meanHookRate?: number; meanHoldRate?: number; meanCtr?: number; meanCpa?: number; meanPercentile: number; hookRateNote: string; holdRateNote: string;
}
export interface NormalizationReport { platforms: PlatformSummary[]; balanced: boolean; notes: string[] }
export interface PerformanceOverview {
  accounts: AdAccount[]; leaderboard: LeaderboardRow[];
  meta: { configured: boolean; connections: MetaConnection[]; accountIds: string[]; apiVersion?: string; conversionActions: string[] };
  google: { configured: boolean; customerIds: string[]; apiVersion?: string; loginCustomerId?: string };
  normalization: NormalizationReport;
  nightly: { enabled: boolean; hour: number; lastRun?: string; lastResult?: string };
  lastReport?: SyncReport;
  teardown: TeardownState;
  patternsUpdatedAt?: string;
  openSuggestions: number;
  imports: Array<{ file: string; platform?: AdPlatform; rows: number; importedAt: string }>;
  inbox: { dir: string; files: string[] }; latestMetricDate?: string; projects: Array<{ id: string; title: string }>; syncing: boolean;
}
export interface SyncReport {
  files: Array<{ file: string; status: "imported" | "unchanged" | "error"; platform?: string; ads?: number; rows?: number; warnings?: string[]; error?: string }>;
  accounts: Array<{ accountId: string; name: string; status: "synced" | "error" | "skipped"; platform?: AdPlatform; connectionId?: string; connectionLabel?: string; from?: string; to?: string; ads?: number; rows?: number; error?: string }>;
  adsScored: number; winners: number; losers: number; fatigued: number; linked: number; at: string;
}
export interface AdSeriesPoint { date: string; impressions?: number; spend?: number; hookRate?: number; ctr?: number }
export interface TeardownStructure {
  hookText: string; bodyText: string; ctaText: string; hookType: string; angle: string; persona: string; emotionalTrigger: string;
  claimStructure: string; ctaStyle: string; addressForm: string; usesNumbers: boolean; hookNote: string;
}
export interface Teardown {
  adId: string; source: "own" | "external" | "competitor"; status: "done" | "needs_transcript" | "error"; adName?: string; projectId?: string;
  transcriptDe?: string; structure?: TeardownStructure;
  visual: { visualStyle: string; talkingHeadRatio?: number; cutsPer10s?: number; hasTextOverlay?: boolean; musicEnergy: string; durationS?: number };
  model?: string; error?: string; createdAt: string; updatedAt: string;
}
export interface TeardownReport {
  candidates: number; done: number; needsTranscript: number; errors: number; skipped: number; llmCalls: number; patterns: number;
  items: Array<{ adId: string; status: Teardown["status"]; error?: string }>;
}
export interface TeardownState {
  llmConfigured: boolean; auto: boolean; maxPerRun: number; running: boolean; whisper: boolean; creativesDir: string; competitorsDir: string;
  counts: { done: number; needsTranscript: number; errors: number; competitors: number }; last?: TeardownReport;
}
export interface Pattern {
  id: string; dimension: string; value: string; sampleSize: number; winnerShare: number; lift: number; hookLift?: number; ctrLift?: number;
  direction: "positive" | "negative"; evidence: Array<{ adId: string; adName?: string; percentile: number; hookRate?: number; ctr?: number; hookText?: string; isWinner: boolean }>;
  summaryEn: string; summaryDe: string; updatedAt: string; disabled: boolean;
}
export interface PatternsResponse {
  patterns: Pattern[]; hooks: Array<{ adId: string; adName?: string; hookText: string; hookType?: string; percentile: number }>; updatedAt?: string; promptBlock: string;
}
export type SuggestionKind = "ad_to_scale" | "ad_to_kill" | "refresh_hook" | "hook" | "angle" | "cta" | "variant_to_render" | "pacing";
export interface Suggestion {
  id: string; kind: SuggestionKind; projectId?: string; sessionId?: string; title: string; body: string; rationale: string;
  patternIds: string[]; exampleAdIds: string[]; score: number; status: "open" | "accepted" | "dismissed"; createdAt: string;
  acceptedAt?: string;
  snapshot?: { at: string; percentile?: number; hookRate?: number; ctr?: number; cpa?: number; spend?: number };
  outcome?: { status: "pending" | "improved" | "flat" | "worse" | "won" | "mixed" | "lost"; summary: string; measuredAt: string; adIds: string[] };
}
export interface KbBriefing {
  id: string; angle: string; persona: string; painPoint: string; promise: string; tone: string; visualDirection: string[];
  hookConcepts: string[]; bodyConcept: string; ctaConcepts: string[]; source: string; usedPatternIds?: string[]; file: string; createdAt: string;
}
export interface ProjectPerformance { ads: number; winners: number; fatigued: number; spend: number; impressions: number; bestHookRate?: number; bestCtr?: number; bestVariantKey?: string }
