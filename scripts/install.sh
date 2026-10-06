#!/usr/bin/env bash
# Couch Launcher installer for SteamOS / Bazzite (and other Linux desktops).
# Installs everything under your home directory: no root, no system packages.
#
#   ./install.sh [--dry-run] [--binary PATH] [--jellyfin-url URL] [--no-flatpak] [--yes]
#
# The Jellyfin API key is read from the COUCH_JELLYFIN_API_KEY environment variable or asked for
# (hidden input). It is written only to the config file, never to the command line.
# Steam's own files are never touched: the last step prints what to add in Steam by hand.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=0
YES=0
FLATPAK=1
JELLYFIN_URL=""
BINARY=""
CHROMIUM_ID="org.chromium.Chromium"
JELLYFIN_ID="org.jellyfin.JellyfinDesktop"
PORT=7744

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) YES=1 ;;
    --no-flatpak) FLATPAK=0 ;;
    --binary) BINARY="$2"; shift ;;
    --jellyfin-url) JELLYFIN_URL="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$BINARY" ]]; then
  for c in "$SCRIPT_DIR/couch-launcher-linux-x64" "$SCRIPT_DIR/../out/linux/couch-launcher-linux-x64"; do
    if [[ -f "$c" ]]; then BINARY="$c"; break; fi
  done
fi

BIN_DIR="$HOME/.local/bin"
EXE="$BIN_DIR/couch-launcher"
KIOSK="$BIN_DIR/couch-launcher-kiosk"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/couch-launcher.service"

step() { printf '\n[%s/6] %s\n' "$1" "$2"; }
run() {
  # Print every command; run it unless --dry-run.
  printf '  $ %s\n' "$*"
  if [[ $DRY_RUN -eq 0 ]]; then "$@"; fi
}
note() { printf '  %s\n' "$*"; }

[[ $DRY_RUN -eq 1 ]] && echo "Dry run: printing every step, changing nothing."

step 1 "Copy the executable to $EXE"
if [[ -z "$BINARY" ]]; then
  echo "  couch-launcher-linux-x64 not found next to this script; pass --binary PATH" >&2
  [[ $DRY_RUN -eq 1 ]] || exit 1
  BINARY="couch-launcher-linux-x64"
fi
run mkdir -p "$BIN_DIR"
run install -m 755 "$BINARY" "$EXE"

step 2 "Create the config file and set the Jellyfin URL and API key"
if [[ -z "$JELLYFIN_URL" && $DRY_RUN -eq 0 && $YES -eq 0 && -t 0 ]]; then
  read -r -p "  Jellyfin server URL (e.g. http://192.168.1.20:8096, blank to skip): " JELLYFIN_URL
fi
if [[ -n "$JELLYFIN_URL" && -z "${COUCH_JELLYFIN_API_KEY:-}" && $DRY_RUN -eq 0 && $YES -eq 0 && -t 0 ]]; then
  read -r -s -p "  Jellyfin API key (Dashboard > API Keys; input hidden): " COUCH_JELLYFIN_API_KEY
  echo
fi
export COUCH_JELLYFIN_API_KEY="${COUCH_JELLYFIN_API_KEY:-}"
if [[ -n "$JELLYFIN_URL" ]]; then
  if [[ -n "$COUCH_JELLYFIN_API_KEY" ]]; then
    run "$EXE" configure --jellyfin-url "$JELLYFIN_URL"
  else
    COUCH_JELLYFIN_API_KEY="" run "$EXE" configure --jellyfin-url "$JELLYFIN_URL"
    note "No API key given: add it later to the config file (couch-launcher config-path)."
  fi
else
  run "$EXE" configure
  note "No Jellyfin URL given: Watch stays empty until you add url and api_key to the config file."
fi

step 3 "Install and start the systemd user service"
run mkdir -p "$UNIT_DIR"
run install -m 644 "$SCRIPT_DIR/couch-launcher.service" "$UNIT"
run systemctl --user daemon-reload
run systemctl --user enable --now couch-launcher.service

step 4 "Install the kiosk browser (Chromium Flatpak) and give it controller access"
if [[ $FLATPAK -eq 1 ]]; then
  run flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  run flatpak install --user -y --noninteractive flathub "$CHROMIUM_ID"
  # --device=input exists from Flatpak 1.15.6; older versions need --device=all.
  FLATPAK_VERSION="$(flatpak --version 2>/dev/null | awk '{print $2}' || true)"
  if [[ -n "$FLATPAK_VERSION" ]] && printf '%s\n%s\n' "1.15.6" "$FLATPAK_VERSION" | sort -V -C; then
    run flatpak override --user --device=input "$CHROMIUM_ID"
  else
    run flatpak override --user --device=all "$CHROMIUM_ID"
  fi
else
  note "Skipped (--no-flatpak)."
fi
note "Kiosk wrapper: $KIOSK"
if [[ $DRY_RUN -eq 0 ]]; then
  KIOSK_LINE="$("$EXE" kiosk-command --shell --port "$PORT")"
  printf '#!/bin/sh\n# Opens Couch Launcher full screen. Add this file to Steam as a non-Steam game.\nexec %s\n' "$KIOSK_LINE" > "$KIOSK"
  chmod 755 "$KIOSK"
  note "$(tail -n 1 "$KIOSK")"
else
  note "would write: exec flatpak run $CHROMIUM_ID --kiosk ... http://127.0.0.1:$PORT/"
fi

step 5 "Install Jellyfin Desktop"
if [[ $FLATPAK -eq 1 ]]; then
  run flatpak install --user -y --noninteractive flathub "$JELLYFIN_ID"
else
  note "Skipped (--no-flatpak)."
fi
note "Then, once, in Desktop Mode: open Jellyfin Desktop and sign in to your server."

step 6 "Add the shortcuts in Steam (by hand: this script never edits Steam's files)"
cat <<STEPS
  In Desktop Mode, open Steam > Games > Add a Non-Steam Game to My Library > Browse:
    a. Choose $KIOSK and name the shortcut "Couch Launcher".
    b. Add "Jellyfin Desktop" from the list (or browse to /usr/bin/flatpak with launch
       options: run $JELLYFIN_ID) and keep "Jellyfin" in its name.
  Back in Gaming Mode, open Couch Launcher > Controller settings and apply the key-mapped
  layout from steam-input/README.md (D-pad = arrows, A = Enter, B = Escape, X = x, Y = y,
  LB = q, RB = e, Start = s, left stick = arrows).
  Then run: $EXE doctor
STEPS

if [[ $DRY_RUN -eq 0 ]]; then
  echo
  "$EXE" doctor || true
fi
echo
echo "Done."
