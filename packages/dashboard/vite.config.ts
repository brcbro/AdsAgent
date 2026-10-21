import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const api = `http://127.0.0.1:${process.env.DASHBOARD_PORT ?? 3847}`;

// `pnpm dashboard` builds into web/dist and Express serves it; `pnpm dashboard:dev` proxies to a running server.
export default defineConfig({
  root: path.join(here, "web"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(here, "web/src") } },
  build: { outDir: path.join(here, "web/dist"), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    // The dashboard API only accepts its own Host/Origin, so rewrite both for proxied calls.
    proxy: {
      "/api": { target: api, changeOrigin: true, headers: { origin: api } },
      "/data": { target: api, changeOrigin: true },
    },
  },
});
