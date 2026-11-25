import { defineConfig } from "vite";
import { buildId } from "./scripts/build-id";

// Second bundle, loaded on demand: pdf-lib is ~200 KB gzipped, too heavy for portal.js.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // runs after the main build
    target: "es2020",
    lib: {
      entry: "src/pdf/index.ts",
      name: "PrintPortalPdfBundle",
      formats: ["iife"],
      fileName: () => "pdf-tools.js",
    },
  },
});
