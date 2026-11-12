#!/bin/sh
# Build the signed iPhone shortcut "Opskrifter til PodView" (macOS only).
# Template (no secrets) -> lint -> binary plist -> `shortcuts sign --mode anyone`.
# Address and upload code are import questions answered on the iPhone.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
template="$root/podvoice/shortcuts/opskrifter-til-podview.plist"
target="$root/podvoice/gatekeeper/static/podview/assets/opskrifter-til-podview.shortcut"

if [ "$(uname -s)" != "Darwin" ] || ! command -v shortcuts >/dev/null 2>&1; then
  echo "build-recipe-shortcut: kræver macOS med kommandoen 'shortcuts'" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

plutil -lint "$template"
cp "$template" "$work/Opskrifter til PodView.shortcut"
plutil -convert binary1 "$work/Opskrifter til PodView.shortcut"
shortcuts sign --mode anyone \
  --input "$work/Opskrifter til PodView.shortcut" \
  --output "$work/signed.shortcut"

if [ "$(head -c 4 "$work/signed.shortcut")" != "AEA1" ]; then
  echo "build-recipe-shortcut: signeringen gav ikke en AEA1-fil" >&2
  exit 1
fi
cp "$work/signed.shortcut" "$target"
chmod 644 "$target"
echo "Signed shortcut: $target"
