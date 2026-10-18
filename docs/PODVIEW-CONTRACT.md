# Historical display and reload recovery ·18 October2026 ·NEXT56 candidate

Complete, display-admitted visual answers are retained as dated, read-only records in the existing receipt owner. The existing ingress/configured-room read route `GET /view/api/answers?room=…&history=1` returns a closed historical DTO, independent of the current live task. It retains the latest20 records per configured room and server boot, at most64KiB per record. No disk, browser storage or durable household memory is added. Normal question/session changes and browser reload can recover this archive; server restart cannot. Server capture proves admission, not that a human saw the pixels. Existing reads are room-readable through ingress, not private to an individual controller or person.

Historical display never extends a live receipt, source deadline, task or action grant. Source retrieval, retries, choices, follow-ups and checklist mutations remain unavailable. Historical remote image URLs are not mounted or fetched; existing unavailable-image anatomy retains captions and credit. Bundled admitted illustrations may remain. Original observation time and AI/source provenance are preserved. Current and historical receipts deduplicate by identity.

History revision, removal revision and the bounded current receipt-ID membership accompany the existing snapshot. Ordinary admission preserves existing cards during hydration; eviction or exact revocation removes only affected records. Delayed live/history responses cannot reintroduce removed records or overwrite newer history. Temporary absence of history metadata or current-answer capability preserves already admitted display. Different room/server boot or an actual read-access denial clears the requesting browser; a failed control-only renewal does not establish read denial and does not erase other viewers' shared archive.

Normal conversation completion preserves history. Existing explicit stop/privacy/error revocation removes records for the exact original owner/session/epoch, including when a newer current task exists; it cannot remove an unrelated replacement's records. Room-owner replacement and shutdown clear the corresponding archive. The existing canonical answer/history renderers own every display state; no parallel renderer or component family is introduced. Source/unit evidence does not establish Green browser or physical acceptance.

# Current locality lifecycle ·18 October2026 ·NEXT49

The automatic seven-field displayLocation estimate now has a maximum60-second display lifetime. Existing30-second observations remain valid until their actual expiry; cached observations retain their original timestamps. This is a display-only freshness rule, not an action/control lease change. All geography thresholds, dataset pins, source qualification, data minimization and the unchanged two-field configured_label variant below remain in force.

One ToolRouter-owned, bounded HA config request may complete after the individual weather HTTP response. Ordinary admitted weather reads start or refresh that single-flight task once a valid observation is at least15seconds old. Weather never waits for it; a ready same-owner label is returned on the next ordinary read. A still-valid label remains during refresh; invalid/auth-denied/ambiguous results clear it. Source changes fence late results. App cleanup cancels and drains the task. The fixed authenticated internal endpoint and2-second request deadline are unchanged; no additional polling, retry or external geographical recipient is added.

Both canonical weather consumers use the same validator and existing expiry timer. A label expires exactly at validUntil while the actual forecast remains visible. Real owner/envelope-to-frontend tests cover every second through120seconds at16/24-second healthy read cadence and0.05/1.9-second config completion. Longer or hidden/offline-client delays may honestly expire. This proves the bounded source behavior, not Green causality, actual household locality or general geographic accuracy.

The NEXT47 section below is historical: its30-second maximum and cancellation on weather completion are superseded only by the lifecycle rules above. PodVoice2.0.49 is now verified installed/running with the exact143 packaged canonical assets; the household's automatic locality is still unproven. The passive post-install read showed the configured Mårslet label, not a verified automatic estimate. See integration/post49-readback-20261018 for the actual evidence.

# Current locality extension · 18 October 2026 · NEXT47

The existing weather locality slot admits two separate closed displayLocation variants: the unchanged two-field configured_label and a seven-field automatic estimate. The latter is `{name, source: ha_home_geonames, method: nearest_populated_place, scope: ha_home, datasetVersion, observedAt, validUntil}`. Name is qualified as “Ved X”; datasetVersion is the pinned public dataset SHA256; validity is at most30 seconds from an authenticated HA configuration read. Coordinates, distances, credentials and coordinate fingerprints remain server-side. Forecast source/location are preserved and are not asserted to equal the HA home position.

Only the existing server client/token may read the fixed Supervisor Core config endpoint. The complete bundled GeoNames DK dataset is resolved locally; no coordinates are sent to a geographical service. Ambiguous/invalid/slow results produce no automatic label. An unfinished config read is cancelled when weather completes, so weather never waits for the remaining locality budget. Existing normal reads may try again; there is no extra poll or background retry. Manual fallback stays explicitly configured. Both overview and detail drop expired automatic labels through the existing weather timer while retaining forecasts. Existing source information distinguishes the weather provider from GeoNames place-name attribution.

This is the reviewed NEXT47 data contract, not proof of Green installation or correct locality at the household. The unchanged six-public-point check matched four expectations and abstained on two desired names; no general accuracy or city-boundary claim follows.

# Current actual boundary · 14 October 2026, evening

The original workshop contract below is historical. The first real integration is PodVoice 2.0.23: authenticated existing HA ingress serves `/view/`, native timer observations, bounded PodConnect read facade and explicitly provisioned short-lived timer-only pairing. Provider keys remain on existing owners. Snapshot/SSE was observed on Green; full household/device/physical acceptance is not complete.

Passive follow-on media/weather/robot observations are independently reviewed and packaged, not yet installed. Commands must use explicit server-issued scopes and exact owner/session/task/revision bindings; viewer identity and display option IDs grant no authority. Unknown effects never replay. Completed-tool visual receipts bind exact room/session/turn/task/input revision plus current answer revision; sources are guarded same-owner reads rather than generated links/HTML. Optional extra AI remains separately disabled pending model/budget/config admission.

Lights are explicitly deferred in HA while retained in UI. GPT Site remains owner-private and a demo until supported authenticated server connectivity exists. Current receipts: STATUS.md and reviews/PODVIEW-LIVE-PLAN-2026-10-14.md.

---

# PodView v0.1 — behavior and integration contract

This repository is a working browser-only UX prototype. All identity, proximity, voice and transport controls are simulations. It does not establish physical PodVoice, camera, recognition, MCP or Home Assistant operation.

## Product behavior

Ambient displays a decorative landscape and actual Copenhagen time. Near displays a personal household scene using clearly labeled fixture appointments. An active task stays visible even if distance changes. Viewer and task owner are independent: another viewer can explicitly take over, keeping task content and advancing scene revision. Ending a task releases its scene; the distance determines the return view. Offline keeps existing content and blocks task selection, step updates, takeover and saving. Ending the demo and removing a local favorite remain local actions. Local favorites are browser-only, never described as shared memory.

## Prototype scene protocol

The actual POC uses `initialState()` and `transition(state, event)` in dist/model.js. Select and step events carry task ID and revision. A duplicate, stale or disconnected action cannot mutate the scene. The prototype does not generate production credentials or execute household actions.

## Proposed production boundary (unimplemented)

PodVoice remains sole owner of audio sessions, turn state and physical audio cleanup. PodView renders a server-owned scene and sends user actions. A renderer must not start a second voice engine. Family memory is a separate persistent service to be shared through the Pod API and custom MCP tools. Browser storage does not become the family memory backend.

Scene envelope: protocol_version, room_id, display_id, session_id, task_id, scene_id, revision, task_owner_id, viewer_id, content, allowed_actions, expires_at. Every action binds actor, device, session, scene and current revision. Server authorization is independent of the model and browser. A viewer recognition signal alone cannot authorize private content or a sensitive action.

Commands: scene.replace, scene.patch, session.ended, identity.observed, presence.changed. Browser returns scene.rendered and action.requested; action results distinguish accepted, executed, verified, failed and unknown. scene.rendered only acknowledges rendering. No replay of ambiguous physical effects.

On reconnect: authenticate, request authoritative snapshot and apply it atomically before admitting interaction. Do not replay offline clicks. Fence delayed results by session generation and scene revision. A new viewer must not silently acquire an old task. Shared family scenes need explicit visibility policies for guests and multiple viewers.

## First actual integration proof

1. A real PodVoice session publishes three choices to a paired browser display.
2. A touch selection returns to that SAME active session, with the exact option ID.
3. Voice selection chooses the same option as touch.
4. Disconnect retains visible content and blocks action dispatch; reconnect fetches a fresh snapshot.
5. A stale control from a terminated session is inert.
6. Profile changes preserve the active task until an explicit authorized takeover.

The user explicitly deferred camera use and automatic person recognition from the first POC. Manual profile selection is sufficient for the first integration. Custom screen and camera hardware are later possibilities. Camera enrollment, speaker identity, proximity thresholds, persistent household memory, native ChatGPT plugin routing and physical frame deployment are later implementation work. No claim of Apple-equivalent biometric security or session handoff is made.
