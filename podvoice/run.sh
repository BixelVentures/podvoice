#!/usr/bin/env sh
# Add-on entrypoint. Options are read in Python from /data/options.json
# (see gatekeeper/config.py); SUPERVISOR_TOKEN is injected by Supervisor.
set -e
exec python -m gatekeeper
