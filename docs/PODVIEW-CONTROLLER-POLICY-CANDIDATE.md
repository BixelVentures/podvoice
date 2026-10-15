# PodView controller policy candidate — review only

This document proposes a normal installed-frame controller. It does not enable a
credential, grant, provider command, or a longer permission. The current one-use
pairing code, five-minute HttpOnly cookie, and default-off
`podview_control_policy` continue to govern the candidate source routes.

## Operator scope

Recommended policy: one installed frame, one `roomId`, one configured PodConnect
account, an allowlist of exact `spotify_device` target IDs, an allowlist of actions,
and an operator-chosen `maxVolume` for each target. The proposed permission window
is at most 24 hours with an absolute expiry; a shorter window remains valid. A
new installation needs a new operator approval. No account default, device-name
match, configured-alias inference, viewer identity, or browser URI grants control.
The scope is a closed versioned server record; unknown fields and duplicate
controller or target IDs reject the entire record. The existing
`podview_control_policy` exact room/account/target/action/maxVolume rows remain the
upper bound even after a frame credential is approved.

## Setup and normal use

`/view/setup` is the only proposed place for code entry and controller management.
The ordinary timer and music scenes show actions only when a current server
capability says they are available; they contain no pairing hash, technical access
button, or permission explanation. A human operator authenticates to the setup
flow, chooses the exact scope and expiry, checks the observed target metadata and
volume, and enters a separately provisioned one-use enrollment code. The frame
generates an installation key; the server stores only its public key and the
closed scope. A browser-generated key proves possession of that installation,
not physical immovability, so revocation remains essential. Enrollment must use a
new operator-owned code and must not reinterpret the existing five-minute pair
hash as 24-hour authority.

On a new browser process or server restart, the persisted scope is only
eligibility. A fresh signed challenge and live room/native-owner check issue a
short transient controller ticket; pending music/timer tasks, request IDs,
receipts, and native owner epochs never survive the restart. Each action rechecks
the ticket, exact current policy row, task/session/input revision, selected output,
owner epoch and fresh provider observation. New track play also checks observed
volume against the approved maximum at provider send and consumes the option
before any await. Unknown outcomes are not retried. The UI asks the person to
confirm the displayed song, output and observed volume at action time; voice
selection uses the same option ID and a later-turn trusted approval signal.

The setup page offers immediate revoke. Revocation persists a deny record before
returning success, deletes transient tickets and pending offers, and prevents
already-open requests at their next pre-send guard. Removing the frame or
changing room/account/target/actions/maxVolume also revokes the old scope and
requires fresh enrollment. If persistent storage or clock validation is
unavailable, no controller ticket is issued. A 24-hour expiry must not silently
become a rolling 24-hour window.

## Review and activation gate

This proposal needs a separate review of enrollment authentication, public-key
storage, challenge replay protection, revocation durability and immediate
pre-send fences. Runtime routes and credential handling are not implemented here.
At activation, the operator must explicitly approve either the proposed bounded
24-hour installed-frame permission or the current five-minute per-session pairing
behavior, enter the enrollment code themselves, and choose a maximum volume.
Until then the product stays on the current five-minute default.

## Native room/start proof migration · source candidate, 15 October 2026

The installed Home Assistant Core baseline supplied by the lead is **2026.8.2**.
This backend change does not assume Core 2026.10 or change the panel/kiosk route.
It matches frozen PodConnect Control source `0d1231e9302fe2d4a842cd6814d47f9c107d26df`
(tree `5bcdb0e1f648d58bf02dd847ae7dea5c2e8ae6bf`). Publication, installation,
provider execution and physical output remain separate gates.

For an existing `podview_control_policy.music` row, retain its exact `accountId`,
`targetId`, approved `actions` and operator `maxVolume`. Add both `nativeRoomId`
and `nativeHomepodId` using native stable IDs obtained from the native owner.
`targetId` must be that owner's exact Spotify engine device ID. The outer `roomId`
is still the PodVoice session/frame room; it does not infer the native room ID.
Neither display names nor HA areas are a binding source. A row with only one new
field, empty IDs, unknown keys or invalid types rejects the policy. No existing
policy, pairing code, grant or provider credential is changed by this source work.

Legacy rows with neither native field continue to parse and retain their existing
transport permissions and passive reads. They cannot expose or execute selected-track
play. Operators must deliberately add the two native IDs to the already approved
row; the code does not discover, guess, widen or persist a new grant. An old Control
service/response lacking this contract fails closed for selected-track play.

The server calls `get_track_play_controls` with its configured `room_id` and exact
account/device. It retains a closed `podconnect.start_volume.v1` proof binding the
engine, native room, HomePod, native policy revision, alias incarnation/registry,
readiness, selected-output state, mode and native output volume to the existing
session/task/revision/grant. Offers expire at the earliest source/observation
expiry, at most 60 seconds; a fresh read never extends an offer. At action time,
the fresh proof must match the offered proof, and the exact native configuration
row and original ownership must remain current. The browser submits only the same
opaque option and confirmed volume; it never supplies native proof or provider args.

For `fresh_start`, the confirmed level comes from native `start_volume_percent`.
For `same_session`, it comes from native `output_volume_percent`, preserving a manual
volume adjustment. `maxVolume` remains the existing operator authorization ceiling,
not a second start-volume setting. There is no PodView start-volume constant. The
frozen Control contract also requires known observed Spotify volume at or below that
ceiling; a high/unknown observation therefore blocks even a prospective fresh reset.
If the native fixed start policy exceeds the approved ceiling, play fails closed.
Changing native mode/policy/output/alias proof requires a new offer.

The single `control_playback` request forwards only the server-held track URI and
maximum plus native `room_id`, `homepod_id`, `start_policy_revision` and
`alias_incarnation`. Native Control owns preparation, its five-second one-use lease,
commit immediately before provider send and native output readiness. PodVoice gives
that bounded 14-second operation a 16-second transport budget; an interrupted or
ambiguous request remains unknown and cannot be replayed. This change leaves the
existing five transport actions unchanged, including ordinary pause/resume. It does
not add a cross-process cancellation protocol after the sole Control POST; native
Control still owns its own pre-send guards. Physical acceptance and production
scope/admission pins require lead coordination and independent frozen review.
