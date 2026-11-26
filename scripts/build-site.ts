/**
 * Build the bookmarklet and the install page into dist/.
 *
 * PORTAL_BASE_URL is where dist/ will be served (must end with "/"), e.g.
 *   https://<github-user>.github.io/tombo/
 * It defaults to the mock printer's /__portal/ path for local testing.
 */

import { copyFileSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { buildId } from "./build-id";
import { BRAND_FAVICON, BRAND_MARK_SVG } from "../src/brand/mark";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

const baseUrl = process.env.PORTAL_BASE_URL ?? "http://localhost:8631/__portal/";
if (!/^https?:\/\/.+\/$/.test(baseUrl)) {
  throw new Error(`PORTAL_BASE_URL must be an http(s) URL ending with "/": ${baseUrl}`);
}
const version = JSON.parse(readFileSync(root("package.json"), "utf-8")).version as string;

export function buildBookmarklet(source: string, base: string): string {
  const code = transformSync(source.replaceAll("__PORTAL_BASE_URL__", base), { minify: true, target: "es2015" }).code.trim();
  // Encode only what breaks a URL; keeps the bookmark readable if someone inspects it.
  return `javascript:${encodeURIComponent(code).replace(/%20/g, " ").replace(/%2C/g, ",").replace(/%3B/g, ";").replace(/%3D/g, "=")}`;
}

const bookmarklet = buildBookmarklet(readFileSync(root("src/loader/bookmarklet.js"), "utf-8"), baseUrl);

const locales = Object.fromEntries(
  ["ja", "en", "zh"].map((lang) => [lang, JSON.parse(readFileSync(root(`src/i18n/locales/${lang}.json`), "utf-8")).install]),
);

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const html = readFileSync(root("site/index.html"), "utf-8")
  .replaceAll("__BOOKMARKLET__", escapeAttr(bookmarklet))
  .replace("__I18N__", JSON.stringify(locales).replace(/</g, "\\u003c"))
  .replace("__VERSION__", version)
  .replaceAll("__BRAND_SVG__", BRAND_MARK_SVG)
  .replaceAll("__BRAND_FAVICON__", BRAND_FAVICON);

mkdirSync(root("dist"), { recursive: true });
writeFileSync(root("dist/index.html"), html);
writeFileSync(root("dist/bookmarklet.txt"), bookmarklet + "\n");
// Uncached "which build is current" check, read by src/main.ts on every bookmark click.
writeFileSync(root("dist/version.json"), JSON.stringify({ buildId: buildId(), version }) + "\n");
// pdf.js worker for the mailbox thumbnails (started from a blob: URL by src/pdfview/loader.ts).
copyFileSync(root("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), root("dist/pdf.worker.js"));
// pdf.js WebAssembly decoders (CCITT/JBIG2 for black & white scans, JPEG 2000, colour management).
// The folder carries the pdf.js version so an upgrade never meets cached decoders of another one.
const pdfjsVersion = JSON.parse(readFileSync(root("node_modules/pdfjs-dist/package.json"), "utf-8")).version as string;
const wasmDir = root(`dist/pdfjs-wasm-${pdfjsVersion}`);
mkdirSync(wasmDir, { recursive: true });
for (const file of readdirSync(root("node_modules/pdfjs-dist/wasm"))) {
  // quickjs runs scripts embedded in PDFs, which thumbnails never need.
  if (/\.(wasm|js)$/.test(file) && !file.startsWith("quickjs")) copyFileSync(root(`node_modules/pdfjs-dist/wasm/${file}`), `${wasmDir}/${file}`);
}
console.log(`Install page and bookmarklet built for ${baseUrl} (${bookmarklet.length} chars)`);
