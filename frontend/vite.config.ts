/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/, so the build sets PLYREVIEW_BASE=/ply-review/
const base = process.env.PLYREVIEW_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
