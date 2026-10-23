# Lights successor — backend catalogue and named-controller admission

23 October2026 · source scope frozen, client integration owned by root. No version, activation, deployment, HA/provider/effect or physical claim.

Candidate `/private/tmp/pv-next-lights-complete-20261023`, branch `codex/pv-next-lights-complete-20261023`. Base is frozen draft `043bf6219a14b3a011fdcb0d68d97d8460f6b1fd3701c952c637e947ddd70ae0`; its23-file hashes were rechecked unchanged. Frozen78 release and old draft are untouched. This is a successor, not a modification to their pins.

## Delivered backend change

Both cached and uncached `/home` responses now add the actual bounded area registry catalogue and current own placement from the same authenticated read. Normal GET selects own area; explicit `?lightArea=ID` selects detail only. No second light read, room-name inference or own-placement mutation occurs. Source timestamps and the old light-cache expiry remain actual; deleting own area invalidates browsing other areas too. Internal controller ID, token and pin are never published.

`lightAreas` exact keys: `status`, `source:'home_assistant_area_registry'`, `sourceEpoch`, `observedAt`, `validUntil`, `bindingId`, `placementRevision`, `ownAreaId`, `selectedAreaId`, `items:[{areaId,areaName}]`. Observed catalogue: max64 unique actual `[A-Za-z0-9_-]{1,128}` IDs; printable trimmed labels1..160; ownAreaId exists in items; selectedAreaId exists or is null only for an unknown requested ID. Source/binding are64lowerhex; revision nonnegative integer. Actual registry-read time is in seconds; validity15s. Unavailable/unbound: all metadata/IDs/timestamps null and items[]. No fallback whole-home scope.

`lightPlacement` exact keys: `status:'bound'|'unavailable'|'unbound'`, `areaId`, `areaName`, `bindingId`, `placementRevision`. Bound matches the catalogue's current own entry/binding/revision. Nonbound has all metadata null. A valid catalogue/placement may remain observed/bound while light states are unavailable. A late source/profile/placement change clears both before delivery.

Existing snapshot `capabilities.controlSetup` now composes only `light` from the current named controller cookie, saved placement, explicit existing light policy and actual source/action availability. HTTP snapshot and SSE pass this cookie; every other domain continues to use its original HA actor/token. Grants remain per connection after the shared revision digest. Observation alone, HA actor alone, foreign/revoked/expired/unbound cookie or absent policy grants no light commands. Setup/actions retain the existing exact request and opaque task/option schemas from the baseline draft.

## Evidence

344 affected backend/source/control/ingress tests PASS in0.73s; Ruff, formatter, syntax and mypy2 changed backend sources PASS. Twenty new catalogue/admission tests include actual cached/uncached HTTP and SSE, two named screens/same room, own→other→own, unchanged observation/cache age, rename/delete/zero access, source/profile races, exact null placeholders, no internal identity leakage, and preserved other-domain ingress authority. Independent narrow source review gave GO for these additive boundaries. Prior556-test frozen-draft receipt remains evidence only for its unchanged scope.

## Root integration and remaining acceptance

Root/answer_finish61 consume the strict catalogue/placement and scoped observation. Root's normal home read always adopts own scope; explicit browse response populates separate liveLightDetail and must not overwrite own/Ro state. Existing ChoiceList and Light detail owners handle navigation; existing server-offered options remain sole command authority. No light policy has been enabled and no effect has been sent.

Client integration/rendered flows, native HA framework CI, final durable whole-chain release checks, any authorized live software trial and physical lamp acceptance are separate remaining work. Do not mark full L01–L07 finished from this backend receipt.

## Frozen delta

Five-file packet `086c2b3bde11d6aadd769d17a1384a0b8f5132fb8091becb02ea2633f655590f`; exact path hashes in `LIGHTS-NEXT-BACKEND-PIN.json`. Patch `/private/tmp/pv-lights-next-backend.patch` SHA256 `f852e4a14ae8c9227094297917ad512cda5831f936c68dc8b8b976acc7e3c3db` applies on the old frozen draft. Backend source files: `podvoice/gatekeeper/podview.py` and `tools.py`; tests: existing light bridge rig plus new catalogue and admission tests. No other production files changed in this successor step.
