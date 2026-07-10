import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/procedural-snow-world/" : "/",
  server: { port: 4173 },
  preview: { port: 4173 },
  build: { target: "es2022" },
});
