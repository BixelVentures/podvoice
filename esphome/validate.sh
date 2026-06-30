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
# Usage:   ./validate.sh [file.yaml ...]      (defaults to podvoice-phase1b.yaml)
# Needs:   Python 3.12+ (brew install python@3.12). Creates an isolated venv.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

VENV="${ESPHOME_VENV:-/tmp/esphome-venv}"
PY="$(command -v python3.12 || command -v python3.13 || command -v python3.11 || command -v python3)"
if [ ! -x "$VENV/bin/esphome" ]; then
  echo "Installing esphome into $VENV ..."
  "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check esphome
fi

# Dummy secrets so !secret resolves during validation (real values live in the
# ESPHome add-on's Secrets, never in git). Removed on exit.
cat > secrets.yaml <<'EOF'
wifi_ssid: "validate-ssid"
wifi_password: "validate-pass"
podvoice_api_key: "j9cvcoCxSjNVzRghGcJ8AHMcR9t/IGH5h4UbaJyfH3I="
EOF
trap 'rm -f secrets.yaml' EXIT

rc=0
for f in "${@:-podvoice-phase1b.yaml}"; do
  echo "=================== esphome config $f ==================="
  "$VENV/bin/esphome" config "$f" >/tmp/esphome-validate.out 2>&1 && \
    echo "VALID: $f" || { rc=1; echo "INVALID: $f"; tail -30 /tmp/esphome-validate.out; }
done
exit $rc
