#!/usr/bin/env bash
# Run on a Linux CI host against the exact candidate PodVoice image, with the
# candidate's normal /init entrypoint, /run.sh CMD, and actual gatekeeper module.
set -euo pipefail
image="${1:?pass the exact candidate image tag or digest}"
name="pv175-stdin-proof-$$"
test_root="$(mktemp -d)"
cleanup() {
  timeout --kill-after=2s 5s docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT
mkdir "$test_root/data"
printf '{}\n' > "$test_root/data/options.json"
printf '{}\n' > "$test_root/invalid-line"
printf 'phase=image_inspect\n'
image_id="$(timeout --kill-after=2s 5s docker image inspect "$image" --format '{{.Id}}')"
printf 'image_id=%s\n' "$image_id"
printf 'phase=container_run\n'
timeout --kill-after=2s 5s docker run -d -i --name "$name" --network none \
  --mount "type=bind,source=$test_root/data,target=/data" \
  "$image" >/dev/null
printf 'phase=container_inspect\n'
metadata="$(timeout --kill-after=2s 5s docker inspect "$name" --format '{{.State.Running}} {{.Config.OpenStdin}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}')"
printf 'container=%s\n' "$metadata"
[[ "$metadata" == 'true true ["/init"] ["/run.sh"]' ]]
# Docker attach is the same stdin path Supervisor uses. It stays attached to
# the long-running app, so timeout detaches this test client without forwarding
# TERM to the container. The single invalid line carries no credential/grant.
printf 'phase=attach\n'
set +e
timeout --kill-after=2s 5s docker attach --sig-proxy=false "$name" \
  < "$test_root/invalid-line" > "$test_root/attach.log" 2>&1
attach_status=$?
set -e
printf 'attach_status=%s\n' "$attach_status"
case "$attach_status" in
  0|124|137) ;;
  *) exit "$attach_status" ;;
esac
printf 'phase=wait_for_rejection\n'
deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  timeout --kill-after=2s 3s docker logs "$name" > "$test_root/container.log" 2>&1
  if grep -Fq 'podvoice admin stdin rejected' "$test_root/container.log"; then
    break
  fi
  sleep 1
done
if ! grep -Fq 'podvoice admin stdin rejected' "$test_root/container.log"; then
  tail -n 40 "$test_root/container.log"
  exit 1
fi
printf 'phase=final_inspect\n'
[[ "$(timeout --kill-after=2s 5s docker inspect "$name" --format '{{.State.Running}}')" == true ]]
printf 'phase=process_check\n'
timeout --kill-after=2s 5s docker top "$name" -eo pid,ppid,args > "$test_root/processes.log"
grep -Fq 'python -m gatekeeper' "$test_root/processes.log"
printf 'PASS shipped s6 CMD received one inert Docker/Supervisor stdin line and rejected it; process remains alive\n'
