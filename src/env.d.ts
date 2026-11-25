/// <reference types="vite/client" />

/** Injected at build time from package.json. */
declare const __PORTAL_VERSION__: string;

interface Window {
  /** Set once the portal has taken over the page, so a second bookmarklet click is a no-op. */
  __printPortal?: { version: string };
}
