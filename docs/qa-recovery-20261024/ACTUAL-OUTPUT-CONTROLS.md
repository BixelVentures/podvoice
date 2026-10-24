# Actual output, controls and queue · source closure · 24 October 2026

This scoped implementation exists only in `/private/tmp/podview-recovery-20261024`. It composes the existing media parser, native control owner, queue owner and output picker. Root owns the combined build, rendered Product Design/Impeccable review, publication and release. No HA, provider or audio effect was performed here.

## One observed identity, separate permission

`LiveControlView.musicContext()` now consumes the canonical `playbackBinding(playback,snapshot,account)` helper. It uses the actual admitted v2 output (or admitted legacy v1 room binding), not configured/default/NEXT destination. Metadata and route must both be fresh via `roomObservationCurrent`; the existing `controlSetup:music` capability is still required. Actual binding is not an action grant.

The context key preserves actual account/target/native-room/homepod/binding identity across a mere validUntil refresh. Expired route, stale metadata, foreign account or replacement binding cannot fetch or reuse controls. MOVE uses that same actual source; a stale catalogue outputSelected flag cannot override it. The exact actual destination pair remains blocked as a redundant MOVE. Each explicit command still obtains a fresh opaque server task and consumes it once; pending, UNKNOWN and late-result fences remain unchanged.

| Existing wire owner | Required precondition | Response | Effect request |
|---|---|---|---|
| music control/setup | target: accountId, kind=spotify_device, targetId, expectedBindingId; MOVE additionally speakerId | music control.v1 ROOT expectedBindingId, mandatory64 lowercase hex, exact match | unchanged opaque task/revision/option/args |
| music/queue/offer | ROOT accountId, targetId, expectedBindingId plus existing boot/room | queue-offer.v1 ROOT expectedBindingId, mandatory64 lowercase hex, exact match and existing closed fields | unchanged opaque task/revision/option |

The transport and consumer reject absent/mismatched echoes. Other control domains keep their existing raw shapes. No seek, capability expansion, source inference, automatic effect retry or optimistic playback update was added.

## Output names and row selection

`SpeakerOutputView.actualLabel(binding)` formats only an exact admitted catalogue account/native-room/homepod match. The caller supplies an already admitted binding; the roster cannot create one. A valid catalogue remains available for this formatting even when there is no configured default label. Configured label and NEXT choice remain separate.

Current-output badges and aria-pressed require fresh provider metadata, an actual native binding, and an exact catalogue pair. Catalogue nativeSelected/outputSelected hints alone do not mark a current row or disable another destination. A last-known caption is retained only for a row that previously matched actual output; expiry never preserves a pressed state. New actual identity clears prior row custody. The existing ListRow/Button anatomy is unchanged.

## Evidence and limits

The focused actual control/queue/output/transport/recovery set passes **294/294**, with changed-module/test syntax PASS. Receipt: `/private/tmp/pv-recovery-actual-binding-final.log`. Current component gate passes63 modules; its only added declaration is the nonvisual actualLabel helper within the existing SpeakerOutputView owner, with explanatory scope. No family, container or registry baseline was replaced.

Meaningful cases cover actual non-default output, mandatory echo mismatch/absence, account-only metadata without route, route expiry, held setup/offer while binding changes, exact MOVE source, misleading selected-output hints, single consumed effects, native metadata expiry before route expiry, catalogue expiry, and independent configured/NEXT lifetimes. Existing observer/network recovery tests remain included. Browser/physical acceptance is not established by these tests. Backend must ship the agreed actual v2 projection, server freshness resolver and exact offer echoes together; older backend contracts are not silently accepted as new ones.

## Scoped file hashes

- `dist/live-control-view.js`: `c4e4c82e33b01a5ebb2ae5011199d93cc38220e8787ce560196567bf87ae4fbd`
- `dist/live-queue-view.js`: `0ca291df6e48b1d709a2896fa5f789e47c301a5be209c33f2281a1a70492c15a`
- `dist/speaker-output-view.js`: `170c698a53860a5a891145fce722b35df318d709c8df0b3e5c0d0f206bbbfe12`
- `dist/podvoice-transport.js`: `0c045c62ad9a5f746d8a79a2b36a8e1dcbda2bcfaf10fe97bcb505a9fbfdd2b3`
- `dist/control-model.js`: `60fff418458c9e955c0bd81f8b3e5eeddebb9cf9f1ba5631617d239274e8d7ed`
- `docs/component-library-registry.json`: `06e4e800ae325232c022dc674fe25263e6bdb95360fe5b78bbf006b00a2aa847`
- `tests/native-music-controls.test.js`: `fc92fe086b6689cbf797da919f77239bc0700ea39ba9e63757e64fb820a9b3f4`
- `tests/live-queue-view.test.js`: `aefe6fa09e02ebf9e79eeb71e9488da82b8f24ed4e49ff2c64ef565e2b5aa192`
- `tests/live-queue-occurrence.test.js`: `b3e3e3814dc911a0c565af44f0dd7e5126d8a612dea64a1610a8c367ec8767d0`
- `tests/podvoice-transport.test.js`: `076fae3d0a041bc2364f251af1749bb774508e8027088ab7fb91fe10f9dd9fcf`
- `tests/control-model.test.js`: `7931854f0118885e623eb3f62a4406c6effc34bac1842bcbe4890c9426c55c15`
- `tests/speaker-output-view.test.js`: `b05020ef7204cc18cd879541fbef113a72b07ba5485f80811304c06613603c87`
- `tests/configured-speaker-label.test.js`: `a7a17fbccdf8dfd1f558233b49a57563e2dabe50b1ea82c5de8072003c815cb8`
- `tests/transport-recovery.test.js`: `ded6f4593471b32e9d812eb3af5abe6b3d9e01db3d7cd821e073a4b7f9e7855a`

Follow-up full-suite dependency repair: `tests/robot-control-renewal.test.js` resolves the real media-observation owner instead of matching an obsolete literal import/stub. Its16/16 tests and syntax pass (`/private/tmp/pv-recovery-robot-loader.log`); no production change. SHA256 `1d5a4eb4b8000bb68362873f6e5275719006138f922c65230a95d51e2d3f4240`.

Independent final review found a queue continuation race after an accepted action awaited a media refresh. The existing choose owner now rechecks generation, actual media owner and original scope before touching pending state or loading another offer. An A→B held-refresh test failed before the fix with two B reads instead of one; current19/19 queue tests pass, including the normal accepted-refresh path. Receipts: `/private/tmp/pv-recovery-queue-refresh-red.log` and `-green.log`. The earlier294-test receipt predates this narrow follow-up; root owns the final combined suite.

Final rendered-review follow-up: disabled play/pause labels now derive displayPlaying from canonical admitted `roomObservationDisplay`, independently of a missing command context. The effect toggle, freshness, options and blocked gates remain unchanged. Playing with no capability or read-only account observation previously said Fortsæt; the two cases were RED before correction. Current124/124 native/control-view tests pass, including paused labels and zero setup/effect assertions. Receipts: `/private/tmp/pv-recovery-control-label-red.log` and `-green.log`. Root owns actual after capture and final combined suite.
