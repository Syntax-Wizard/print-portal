/**
 * Take over the printer's page: stop its timers, replace the old frameset document with a
 * clean standards-mode document, and mount the app.
 */

import { render } from "preact";
import { initI18n } from "./i18n";
import { App } from "./ui/App";
import { BRAND_FAVICON, BRAND_NAME } from "./brand/mark";

/** The original page refreshes its frames every 120 s; those timers must not fire into our UI. */
function clearPageTimers(): void {
  const highest = window.setTimeout(() => undefined, 0);
  for (let id = 0; id <= highest; id++) {
    window.clearTimeout(id);
    window.clearInterval(id);
  }
}

const SHELL = () => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${BRAND_NAME}</title>
<link rel="icon" type="image/svg+xml" href="${BRAND_FAVICON}">
</head>
<body><div id="app"></div></body>
</html>`;

export function takeover(css: string): void {
  if (window.__printPortal) return;
  window.__printPortal = { version: __PORTAL_VERSION__ };
  clearPageTimers();

  // document.open() discards the frameset (and its quirks-mode doctype) and starts a fresh document.
  document.open();
  document.write(SHELL());
  document.close();

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  void initI18n().then(() => {
    render(<App />, document.getElementById("app")!);
  });
}
