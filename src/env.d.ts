/// <reference types="vite/client" />

/** Injected at build time from package.json. */
declare const __PORTAL_VERSION__: string;

/** Identifies one build; shared by portal.js and pdf-tools.js. */
declare const __BUILD_ID__: string;

/** URL of the published exact toner snapshot, or "" when disabled. */
declare const __TONER_DATA_URL__: string;

interface Window {
  /** Set once the portal has taken over the page, so a second bookmarklet click is a no-op. */
  __printPortal?: { version: string };
}
