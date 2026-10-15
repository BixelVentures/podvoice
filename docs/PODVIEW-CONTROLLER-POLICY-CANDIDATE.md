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
