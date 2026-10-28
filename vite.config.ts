import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { mkdirSync, cpSync } from "node:fs";
import { resolve } from "node:path";
const base = "/SlideRecall/";
export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: "bundle-pdf-resources",
      buildStart() {
        for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
          mkdirSync(resolve("public/pdf", dir), { recursive: true });
          cpSync(
            resolve("node_modules/pdfjs-dist", dir),
            resolve("public/pdf", dir),
            { recursive: true },
          );
        }
      },
    },
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "SlideRecall",
        short_name: "SlideRecall",
        description: "スライドを見て、思い出して、話す。",
        lang: "ja",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#f4f5f0",
        theme_color: "#276354",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: [
          "**/*.{js,mjs,css,html,svg,png,webmanifest,bcmap,pfb,ttf,wasm}",
        ],
        maximumFileSizeToCacheInBytes: 8000000,
        navigateFallback: `${base}index.html`,
        navigateFallbackAllowlist: [/^\/SlideRecall\/(?:index\.html)?$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
