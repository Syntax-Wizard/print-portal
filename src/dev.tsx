/**
 * Development entry point (`npm run dev`): renders the app directly, with printer requests
 * proxied to the mock printer so everything stays same-origin like production.
 */

import { render } from "preact";
import "./ui/styles.css";
import { initI18n } from "./i18n";
import { App } from "./ui/App";
// In development the lazily loaded bundles are imported directly instead of being injected.
import "./pdf/index";
import { pdfView } from "./pdfview/index";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfView.useWorker(pdfWorkerUrl);
(window as unknown as { __printPortalPdfWorkerReady?: boolean }).__printPortalPdfWorkerReady = true;

void initI18n().then(() => render(<App />, document.getElementById("app")!));
