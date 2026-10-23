# Isolated Lights backend draft — not release-ready

23 October2026. Source frozen; no version assigned. Candidate `/private/tmp/pv78-lights-20261023` branch `codex/pv78-lights-20261023`. **This is not basic78 release input.**

Baseline is the staged verified77 source at `/private/tmp/pv77-account-playlists-20261023`. Published revision `a537077b0ecb31a9def0759cf5a5c44873f0ec85`, OCI index `sha256:55e8651e127cee58ac214157af152f2fb94f49abf06814145b077184258e9dbd`. Candidate GitHEAD is historical76 `5b753604c703e90f7fd5c63ea3ccd219ab814670`; it does not identify the staged77 bytes. Canonical PodView dist and frozen77 are untouched.

## Implemented

- Existing ControllerRegistry schema3 stores explicit area ID +monotonic placement revision. Old profiles remain unbound; no room/output/name adoption. Current admin, exact profile, fresh area catalogue, CAS, revoke/source/owner checks and explicit clear use existing HA Options/AreaSelector +existing admin transport.
- Existing ToolRouter reads exact inherited HA-area membership and only those light states, max64, combined128KiB/2s, 15s real validity. Known empty is complete observed zero; unknown is retained; count unit is light entities, not physical bulbs.
- Existing `/home` adds profile-scoped `lights`, separate from shared room cache. Optional `lightArea` selects only the detail read; current own placement stays fixed. Two controllers/same session are partitioned. Cache preserves timestamps, expires, rechecks current catalogue/deleted own area and rejects late responses. Own +one browsed scope per controller, global128-entry cap.
- Existing TouchControls accepts opt-in light policy/opaque options and exact area/individual targets. Default absent policy permits no light commands. Current named controller cookie is used for light setup/actions, including HA ingress; HA actor alone never adopts placement. Exact set/source/placement/boot/session/revision is re-read. Async preflight executes after existing ToolRouter target preparation before normal policy/send. No REST mutation bypass or automatic retry; accepted request is not observed/physical success.

## Closed wire

`/home.lights` exact keys:

```text
status: observed|unavailable|unbound
source: home_assistant_state
sourceEpoch: string|null
observedAt, validUntil: seconds|null
scope: null|{kind:ha_area,areaId,areaName,bindingId,placementRevision,isOwnArea}
complete: boolean
items: [{entityId,areaId,name,state:on|off|unknown|unavailable,
         brightness:0..255|null,supportsBrightness:boolean}]
countUnit: light_entities
```

Setup uses existing request `{bootId,roomId,domain:'light',target:{areaId[,entityId]}}` (no revision/recipeId). Response/actions retain existing task/revision/opaque option IDs; action request is `{bootId,roomId,taskId,revision,requestId,optionId,args}`. Brightness uses existing percent argument. Optional existing controlpolicy addition is `light:[{areaId,actions:['turn_on','turn_off','brightness']}]`, max16 unique areas. No policy has been activated.

## Evidence and limits

Final combined inert Python regression: **556 passed in2.18s**. Covers real registry/admin/bridge HTTP, existing control and ToolRouter regressions, exact source/target checks, missing/deleted/renamed areas, two-screen cache separation, TTL/current fences and HTTP errors preserving other home domains. Membership race test was RED when async callback was not forwarded and GREEN after forwarding; actual existing dispatch preparation was held while area membership changed. Ruff/format/syntax PASS; mypy7 backend sources PASS. No HA, provider, deployment or physical command was sent.

Not complete: canonical frontend scoped-DTO admission, real room picker, own-room Ro policy and light controls; `/home` does not expose `lightAreas` catalogue yet. Existing legacy client must not consume this as unscoped home lighting. Native HA framework HTTP/AreaSelector test was added but fixed localvenv lacks HA/voluptuous; pinned HA CI remains. `scripts/dev fast` rejects temporary checkout; final durable gate remains. Independent whole-chain review/CI and actual visual/local/live/physical acceptance remain. **Do not mark full L01–L07 delivered.**

## Exact frozen delta

Packet SHA256 `043bf6219a14b3a011fdcb0d68d97d8460f6b1fd3701c952c637e947ddd70ae0` is over canonical sorted compact JSON path→SHA256 mapping in `LIGHTS-DRAFT-PIN.json`; 23 runtime/test/translation files. Reusable exact diff against verified77 source: `/private/tmp/pv-lights-draft-v77.patch` (no generated assets, no version/release metadata). Final pin file includes exact per-file hashes. Lead alone owns integration into a successor and re-evaluation against any changed base.
