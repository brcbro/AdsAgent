import type express from "express";

/** The dashboard is a local tool: it binds to the loopback interface only. */
export const DASHBOARD_HOST = "127.0.0.1";

/**
 * Local-only request guard.
 * - Host must be one of the local names for this port (blocks DNS rebinding).
 * - Non-GET/HEAD requests with an Origin header must come from this dashboard's own origin
 *   (blocks cross-site form posts and fetches). Requests without Origin (curl, same-origin tools) pass.
 */
export function localOnlyGuard(port: number): express.RequestHandler {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  return (req, res, next) => {
    if (!allowedHosts.has(String(req.headers.host ?? "").toLowerCase())) {
      res.status(403).json({ error: "Forbidden: unexpected Host header" });
      return;
    }
    const origin = req.headers.origin;
    if (req.method !== "GET" && req.method !== "HEAD" && origin !== undefined && !allowedOrigins.has(String(origin).toLowerCase())) {
      res.status(403).json({ error: "Forbidden: cross-origin request" });
      return;
    }
    next();
  };
}
