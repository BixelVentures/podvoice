# Connection recovery · bounded source correction · 24 October 2026

Base: isolated `/private/tmp/podview-recovery-20261024`, final3 plus marked26fa entry overlay. No main, frozen packet, installed Green, cookie, pairing, provider or audio change. Root owns the combined build and rendered review.

## Confirmed defect and correction

The existing transport called presentation observers inside its network-failure catch. A valid source snapshot whose `onConnection` or `onSnapshot` renderer threw was therefore classified as a Green outage. This discarded the connected state, invalidated media through the host, and initiated network recovery even though the source read was valid. The SSE path also failed to refresh its accepted-read watchdog when the observer threw.

`dist/podvoice-transport.js` now arms the accepted-read watchdog before notifying observers and isolates each observer. Errors are still reported through the native `reportError` mechanism, or console error when unavailable. A failing observer cannot revoke a valid read, suppress the remaining observer, or prevent recovery from an actual network failure. Existing source validation, six-second freshness deadline, bounded retry delays, controller proof, capability filtering and no-effect-replay policy are unchanged. No automatic enrollment or additional network request type was added.

A generation/closed/current-snapshot fence prevents reentrant observer code from delivering an older snapshot after a newer one was admitted. This is display delivery only; it grants no authority.

## Causal evidence

`tests/transport-recovery.test.js` gained four actual-transport regressions: valid SSE observer failure; initial connected observer failure; real SSE outage while the disconnected observer throws; and nested acceptance of a newer snapshot during delivery. The first two were RED before the source correction (16/18 existing+new passed, two failed), then passed. The full focused transport/auth/controller/enrollment group now passes **98/98**. Syntax checks pass for both changed files.

The existing recovery tests still demonstrate dropped/stalled reads, capped backoff, terminal access denial, stale stream retirement, shutdown cancellation and no effect replay. These are inert causal tests, not a claim of live network availability.

An additional read-only composition used the actual pre-fd40 `LiveWeatherAdvice` owner and a browser-style native timer receiver check. With the old transport the unbound timer error produced `connecting → connected → disconnected`, rejected `Illegal invocation`, and no stream. With the corrected transport the same observer error was reported while the accepted source remained connected with its stream. This demonstrates that the old weather error can cause this false-outage path. It does not identify the actual installed78 browser stack as proven; the root's passive console capture did not expose a useful stack. The successor already retains fd40's bound native timer correction.

Independent read-only review found no new backend cadence/schema mismatch: current v79/v80 SSE uses the same guarded authenticated context and snapshot projection, sends one-second full snapshots, and real empty bridge/receipt snapshots were accepted repeatedly at unchanged revision. Six-second frontend expiry is longer than that cadence. The reviewer found the nested-delivery issue above; it is covered by the new fence/test.

## Files and receipts

- `dist/podvoice-transport.js`: SHA256 `1ec2f2e6d14335b22cfe1220bc175637ff02087f8a24add846b39eea6f48b8dd`
- `tests/transport-recovery.test.js`: SHA256 `ded6f4593471b32e9d812eb3af5abe6b3d9e01db3d7cd821e073a4b7f9e7855a`
- Red receipt: `/private/tmp/pv-recovery-observer-red.log`
- Focused green receipt: `/private/tmp/pv-recovery-observer-green.log`
- Old-weather composition receipt: `/private/tmp/pv-recovery-old-weather-cause.log`

This source correction does not establish the sole cause of the human-reported outage. Current installed78 differs from this successor. The native PodConnect playback failure and missing/crowded Back investigation are separate owners. No browser, full combined build, release, installation or physical acceptance is claimed by this report.

Later same-workspace integration adds the agreed actual-output request preconditions to this transport. The connection-only hashes above remain a historical scoped receipt; current combined source hashes and wire tests are recorded in `ACTUAL-OUTPUT-CONTROLS.md` and `ACTUAL-OUTPUT-CONTROLS-PINS.json`. The notification correction itself is retained.
