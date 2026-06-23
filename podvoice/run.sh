#!/usr/bin/with-contenv bashio
# Add-on entrypoint. MUST run through `with-contenv` so s6-overlay v3 exports the
# Supervisor-written container environment (incl. SUPERVISOR_TOKEN, found at
# /run/s6/container_environment/) into the process env — otherwise the HA core-API
# call sends an empty "Bearer " header. Options are read in Python from
# /data/options.json (see gatekeeper/config.py).
set -e
exec python -m gatekeeper
