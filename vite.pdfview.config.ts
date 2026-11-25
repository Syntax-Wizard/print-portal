import { defineConfig } from "vite";
import { buildId } from "./scripts/build-id";

// Third bundle, loaded on demand by the mailbox page: pdf.js is large (~140 KB gzipped
// plus a ~380 KB worker, which build-site.ts copies to dist/pdf.worker.js).
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    lib: {
      entry: "src/pdfview/index.ts",
      name: "PrintPortalPdfViewBundle",
      formats: ["iife"],
      fileName: () => "pdf-view.js",
    },
  },
});
