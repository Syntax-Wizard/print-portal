#!/bin/bash
# Install (or update) a macOS LaunchAgent that publishes exact toner levels every hour.
# The printer address stays in the local plist and is never committed.
#
#   scripts/toner/install-agent.sh <printer-host>     install / update
#   scripts/toner/install-agent.sh --uninstall        remove
set -euo pipefail

LABEL="io.github.print-portal.toner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/print-portal-toner.log"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

HOST="${1:?Usage: $0 <printer-host> | --uninstall}"

# Prefer a stable Node path (fnm's default alias) over per-shell shims.
NODE=""
for candidate in "$HOME/.local/share/fnm/aliases/default/bin/node" "$HOME/Library/Application Support/fnm/aliases/default/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -x "$candidate" ]]; then NODE="$candidate"; break; fi
done
[[ -n "$NODE" ]] || { echo "Node.js not found" >&2; exit 1; }

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--import</string><string>tsx</string>
    <string>scripts/toner/publish.ts</string>
    <string>--printer</string><string>$HOST</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL (every hour). Log: $LOG"
