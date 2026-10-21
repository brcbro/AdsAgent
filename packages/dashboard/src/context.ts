import type { installAgentDashboard } from "./agent-dashboard.js";

/** Dependencies shared by route groups that need the render pipeline or the agent queue. */
export interface DashboardContext {
  isRendering: () => boolean;
  agent: ReturnType<typeof installAgentDashboard>;
}
