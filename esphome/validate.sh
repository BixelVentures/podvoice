#!/usr/bin/env bash
# =============================================================================
# validate.sh — run the REAL esphome CLI config-check on PodVoice firmware yamls,
# so config errors are caught BEFORE flashing (no wasted flash cycles).
#
# Why this exists: the ESPHome *Builder* (web editor) and a flash round-trip are a
# slow, lossy way to validate. `esphome config` is the authoritative validator and
# resolves packages + !extend exactly like a build. (It was this script's check
# that proved !extend can't extend single-instance components like voice_assistant,
# and that the no-!extend full-duplex config is valid.)
#
# Usage:   ./validate.sh [file.yaml ...]      (defaults to podvoice.yaml)
# Build:   ESPHOME_COMMAND=compile ESPHOME_SECRETS_FILE=/safe/path/secrets.yaml \
#            ./validate.sh podvoice.yaml
# Needs:   Python 3.12+ (brew install python@3.12). Creates an isolated venv.
# All ESPHome work happens in /private/tmp by default — never in the iCloud repo.
# =============================================================================
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="${ESPHOME_WORK_DIR:-/private/tmp/pv-esphome}"
VENV="${ESPHOME_VENV:-/private/tmp/podvoice-esphome-venv}"
COMMAND="${ESPHOME_COMMAND:-config}"
SECRETS_FILE="${ESPHOME_SECRETS_FILE:-$SOURCE_DIR/secrets.yaml}"
PY="$(command -v python3.12 || command -v python3.13 || command -v python3.11 || command -v python3)"
if [ ! -x "$VENV/bin/esphome" ] || ! "$VENV/bin/esphome" version | grep -q "2026.6.2"; then
  echo "Installing ESPHome 2026.6.2 into $VENV ..."
  "$PY" -m venv --clear "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check esphome==2026.6.2
fi

# Copy source to the disposable build tree. The repository and its real secrets are
# read-only inputs; a failed validation can never replace or delete them.
mkdir -p "$WORK_DIR"
rsync -a --exclude .esphome --exclude secrets.yaml "$SOURCE_DIR/" "$WORK_DIR/"
if [ -f "$SECRETS_FILE" ]; then
  if [ "$SECRETS_FILE" != "$WORK_DIR/secrets.yaml" ]; then
    cp "$SECRETS_FILE" "$WORK_DIR/secrets.yaml"
  fi
elif [ "$COMMAND" != "config" ]; then
  echo "FAILED: $COMMAND requires a real ESPHOME_SECRETS_FILE; refusing to build flashable firmware with the validation key."
  exit 2
else
  cat > "$WORK_DIR/secrets.yaml" <<'EOF'
wifi_ssid: "validate-ssid"
wifi_password: "validate-pass"
podvoice_api_key: "j9cvcoCxSjNVzRghGcJ8AHMcR9t/IGH5h4UbaJyfH3I="
EOF
fi
cd "$WORK_DIR"

rc=0
for f in "${@:-podvoice.yaml}"; do
  f="$(basename "$f")"
  echo "=================== esphome $COMMAND $f ==================="
  "$VENV/bin/esphome" "$COMMAND" "$f" >/private/tmp/podvoice-esphome.out 2>&1 && \
    echo "OK: $f" || { rc=1; echo "FAILED: $f"; tail -30 /private/tmp/podvoice-esphome.out; }
done
exit $rc
