import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served under /app by the Fastify backend, so assets resolve against that base. During `vite dev`,
// /api and /login are proxied to the running backend on :8089.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8089",
      "/login": "http://localhost:8089",
      "/change": "http://localhost:8089",
    },
  },
});
