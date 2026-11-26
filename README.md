# Tombo

A modern, multilingual (Japanese / English / Chinese) print screen for the lab's FUJI XEROX
ApeosPort-V C4476. It needs **no server**: a bookmarklet loads the app into the
printer's own web page, so every request is same-origin and goes straight to the printer.
The printer's original screen keeps working; reloading the page brings it back.

## How it works

1. A user opens the printer's web page and clicks the **Tombo** bookmark.
2. The bookmark loads `portal.js` from GitHub Pages.
3. `portal.js` replaces the old frameset page with the new UI, which reads status pages
   (`stgen.htm`, `sttray.htm`, …) and submits jobs to `/UPLPRT.cmd`.

## Development

```sh
npm install
npm run dev        # mock printer on :8631 + Vite on http://localhost:5173 (nothing is printed)
npm test           # unit tests (parsers, option mapping, client)
npm run e2e        # build + Playwright tests: runs the real bookmarklet against the mock printer
```

`npm run dev` proxies printer paths to the mock printer. To try against the real printer
(this **really prints**), run `PRINTER_URL=http://<printer> npx vite` instead.

Mock printer scenarios: `MOCK_SCENARIO=lowToner|paperOut|jam|slow npm run mock`.

## Build and deploy

```sh
PORTAL_BASE_URL=https://<github-user>.github.io/tombo/ npm run build
```

`dist/` then contains `portal.js`, the install page `index.html`, and `bookmarklet.txt`.
Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds with the right
base URL and publishes to GitHub Pages. Enable Pages with source "GitHub Actions" in the
repository settings once.

Never put the printer's address in this repository: the code uses `location.origin`, and
test fixtures under `mock-printer/fixtures/` are sanitized (no real user names or IPs).

## Mailboxes

The **Mailbox** page lists the printer's mailboxes (ボックス), opens one with its password
and saves scanned documents as PDF (or TIFF/JPEG), or deletes them. The password and the
printer's token (which is equivalent to it) are kept in memory only and dropped after
30 minutes without activity. Deleting fails while someone uses the control panel; the UI
says so. In the mock printer every box opens with `1234`; `POST /__mock/scan?box=27` adds a
document and `MOCK_SCENARIO=boxBusy` makes deletes fail.

## Exact toner levels

The printer's web pages only report toner in 25% steps; exact levels need SNMP, which a
browser cannot use. A lab member's Mac therefore measures them over SNMP and publishes a
small JSON file to the `toner-data` branch (single force-pushed commit). The UI reads it from
`raw.githubusercontent.com` and shows a measured value only when it agrees with the live
25% range; otherwise it falls back to the range.

```sh
npm run toner:publish -- --printer <host> --dry-run   # measure and print, publish nothing
npm run toner:install -- <host>                       # hourly LaunchAgent on macOS
scripts/toner/install-agent.sh --uninstall            # remove it
```

The agent does nothing when the printer is unreachable (e.g. away from the lab). Otherwise
it publishes every hour, so the "measured … ago" shown on the page is the latest measurement.
Log: `~/Library/Logs/print-portal-toner.log`.

## Layout

| Path | Purpose |
|---|---|
| `src/printer/` | Printer adapter: page parsers, option mapping, upload client. No UI code. |
| `src/ui/` | Preact UI (pages, components, polling, per-browser settings). |
| `src/i18n/` | i18next setup and `locales/{ja,en,zh}.json`. Add a language by adding a file. |
| `src/loader/bookmarklet.js` | Bookmarklet source (minified at build time). |
| `src/bootstrap.tsx` | Takes over the printer page and mounts the app. |
| `site/` | Install page template. |
| `mock-printer/` | Fake printer for development and tests. |
| `scripts/toner/` | SNMP snapshot, publisher and LaunchAgent installer for exact toner levels. |
