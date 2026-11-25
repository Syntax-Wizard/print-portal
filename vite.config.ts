import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// Where printer requests are proxied during `npm run dev`.
// Defaults to the local mock printer so development never wastes paper.
const printerTarget = process.env.PRINTER_URL ?? "http://localhost:8631";

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Printer pages (e.g. /sttray.htm) and the upload endpoint, kept same-origin like production.
      "^/[A-Za-z0-9_]+\\.(htm|cmd)(\\?.*)?$": { target: printerTarget, changeOrigin: true },
      // Mailbox download links.
      "^/box/": { target: printerTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    // Production output is a single self-contained script loaded by the bookmarklet.
    lib: {
      entry: "src/main.ts",
      name: "PrintPortal",
      formats: ["iife"],
      fileName: () => "portal.js",
    },
  },
  define: {
    __PORTAL_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
    // Exact toner levels (scripts/toner/). Defaults to the mock printer's sample for local work.
    __TONER_DATA_URL__: JSON.stringify(process.env.TONER_DATA_URL ?? "http://localhost:8631/__portal/toner.json"),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
