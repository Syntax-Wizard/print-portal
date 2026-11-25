import { defineConfig } from "@playwright/test";

// End-to-end tests run against the mock printer, which also serves the built bundle.
// Run `npm run build` first (the `e2e` script does this).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // On CI, failures also become annotations on the commit, readable without the (login-only) logs.
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // One retry on CI so a timing flake on the slower runner does not block deploying; the
  // github reporter still marks such tests as flaky.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:8631",
    // Use the locally installed Chrome; set PW_CHANNEL="" to use Playwright's bundled Chromium (e.g. in CI).
    channel: process.env.PW_CHANNEL ?? "chrome",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  webServer: {
    command: "npx tsx mock-printer/server.ts",
    url: "http://localhost:8631/print.htm",
    env: { MOCK_SPEED: "4" },
    reuseExistingServer: false,
    stdout: "ignore",
  },
});
