import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { SESSION_VIDEO_DIR, VIDEO_SESSION, ensureDir } from "@ai-ads/core";
import { installAgentDashboard } from "./agent-dashboard.js";
import { installBrollIngest } from "./broll-ingest.js";
import type { DashboardContext } from "./context.js";
import { renderState } from "./render-state.js";
import { DASHBOARD_HOST, localOnlyGuard } from "./security.js";
import { registerAvatarRoutes } from "./routes/avatars.js";
import { registerBrollRoutes } from "./routes/broll.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { registerProductionRoutes } from "./routes/production.js";
import { registerProjectRoutes } from "./routes/projects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT ?? 3847);
const app = express();
app.use(localOnlyGuard(PORT));
app.use(express.json({ limit: "2mb" }));
// The React app is built by `vite build` into web/dist; hashed assets cache forever, index.html never.
const WEB_DIST = path.join(__dirname, "../web/dist");
app.use(express.static(WEB_DIST, {
  index: false,
  setHeaders: (res, file) => {
    res.setHeader("Cache-Control", file.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable");
  },
}));

const agentDashboard = installAgentDashboard(app, () => renderState.rendering);
const ctx: DashboardContext = {
  isRendering: () => renderState.rendering || !!agentDashboard.active(),
  agent: agentDashboard,
};

registerProjectRoutes(app);
registerProductionRoutes(app, ctx);
registerAvatarRoutes(app);
registerMediaRoutes(app);
// The B-roll classifier waits while a manual render or an agent job runs (same rule as the worker's render lock).
const brollIngest = installBrollIngest({ busy: () => ctx.isRendering() });
registerBrollRoutes(app, brollIngest);
registerLearningRoutes(app);
const performance = registerPerformanceRoutes(app);

app.use("/api", (_req, res) => { res.status(404).json({ error: "Unknown API route" }); });

// Client-side routes (/studio/…, /agent/…) all load the single-page app.
app.get(/^\/(?!api\/|data\/).*/, (_req, res) => {
  const index = path.join(WEB_DIST, "index.html");
  if (!fs.existsSync(index)) {
    res.status(503).type("text").send("Dashboard UI is not built yet. Run: pnpm --filter @ai-ads/dashboard run build");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(index);
});

async function isDashboardRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects`);
    return res.ok;
  } catch {
    return false;
  }
}

const server = app.listen(PORT, DASHBOARD_HOST, () => {
  agentDashboard.start();
  ensureDir(SESSION_VIDEO_DIR);
  console.log(`\n  AI Ad Factory Dashboard → http://localhost:${PORT}`);
  console.log(`  Output folder: video/${VIDEO_SESSION}/\n`);
});

process.on("SIGINT", () => { brollIngest.close(); agentDashboard.close(); performance.close(); server.close(); process.exit(0); });
process.on("SIGTERM", () => { brollIngest.close(); agentDashboard.close(); performance.close(); server.close(); process.exit(0); });

server.on("error", async (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    if (await isDashboardRunning(PORT)) {
      console.log(`\n  Dashboard already running → http://localhost:${PORT}\n`);
      process.exit(0);
    }
    console.error(`\n  Port ${PORT} is in use by another process.`);
    console.error(`  Free it: lsof -ti :${PORT} | xargs kill\n`);
    process.exit(1);
  }
  throw err;
});
