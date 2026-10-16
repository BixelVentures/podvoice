#!/usr/bin/env bash
# Run on a Linux CI host against the exact candidate PodVoice image, with the
# candidate's normal /init entrypoint, /run.sh CMD, and actual gatekeeper module.
set -euo pipefail
image="${1:?pass the exact candidate image tag or digest}"
name="pv175-stdin-proof-$$"
test_root="$(mktemp -d)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$test_root"; }
trap cleanup EXIT
mkdir "$test_root/data"
printf '{}\n' > "$test_root/data/options.json"
printf '{}\n' > "$test_root/invalid-line"
printf 'image_id=%s\n' "$(docker image inspect "$image" --format '{{.Id}}')"
docker run -d -i --name "$name" --network none \
  --mount "type=bind,source=$test_root/data,target=/data" \
  "$image" >/dev/null
metadata="$(docker inspect "$name" --format '{{.State.Running}} {{.Config.OpenStdin}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}')"
printf 'container=%s\n' "$metadata"
[[ "$metadata" == 'true true ["/init"] ["/run.sh"]' ]]
# Docker attach is the same stdin path Supervisor uses. It stays attached to
# the long-running app, so timeout detaches this test client without forwarding
# TERM to the container. The single invalid line carries no credential/grant.
timeout 5 docker attach --sig-proxy=false "$name" < "$test_root/invalid-line" \
  > "$test_root/attach.log" 2>&1 || true
for _ in $(seq 1 30); do
  if docker logs "$name" 2>&1 | grep -Fq 'podvoice admin stdin rejected'; then
    break
  fi
  sleep 1
done
docker logs "$name" > "$test_root/container.log" 2>&1
grep -Fq 'podvoice admin stdin rejected' "$test_root/container.log"
[[ "$(docker inspect "$name" --format '{{.State.Running}}')" == true ]]
docker top "$name" -eo pid,ppid,args > "$test_root/processes.log"
grep -Fq 'python -m gatekeeper' "$test_root/processes.log"
printf 'PASS shipped s6 CMD received one inert Docker/Supervisor stdin line and rejected it; process remains alive\n'
