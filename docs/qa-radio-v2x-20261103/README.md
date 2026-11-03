# Combined118 + radio · final source composition ·3 November2026

This isolated candidate `/private/tmp/pv118-radio-combined-20261103`, branch `codex/radio-v2x-118-combined`, starts from public117 `652499b349f0c45973e366221ff8667dc5ed944f`, copies the exact lead-owned `/private/tmp/pv118-maintenance-ui-20261103` source and then applies the semantic radio source delta. The lead folder was never edited. Nine protected robot/weather/Tesla source hashes remain byte-identical; see `preserved-lead-source-pins.json`. Canonical `dist` and packaged217assets mirror the same final source and build. No version bump, push, publication, installation or household effects.

Independent source review found one concrete cross-source volume gesture defect: an old radio drag could reach Spotify after preemption, or vice versa. The existing PlayerView now captures the stable source/output/owner and transport identity at pointer or keyboard input and revalidates it at commit and shared host routing. A changed owner cancels the old gesture; a new explicit gesture remains available. Passive timestamps and Spotify next-track metadata do not invalidate a same-owner volume intent. LiveControlView's retained Spotify bounds/draft listener cannot clamp a radio input or mutate the previous Spotify draft. No new visual component or command owner.

Causal focused191tests PASS; own-tree117 UI4972/4972PASS; **combined118 npm test4978/4978PASS, zero skips, component gate67**. Current64 Go serialization → combined118 Python ingress → combinedJS/assets **124/124PASS, zero skips**. Source-independent Python neighbors/Ruff/mypy below remain applicable: the gesture change is JavaScript-only. The earlier failures and superseded test expectations are recorded as development evidence, not final acceptance.

Actual Chrome1280×800 was used for the final gesture check because the previously used in-app browser became unavailable. `08-radio-to-spotify-gesture.jpg` and `09-spotify-to-radio-gesture.jpg` show the source after a real keyboard range input; the inert owner swaps between input and change. `browser-gesture-receipt.json` records **zero calls to both command routes in both transitions**. These are explicitly inert source fixtures, not Spotify/native or acoustic service proof. Earlier first-round QA fixture errors (missing allowed() method and a retained local-only seek range) were corrected in the QA fixture only. Existing source renders are retained; no production workaround was introduced for a fixture gap. The screenshots carry the expected keyboard focus ring. Independent gesture review: scopedGO on7e9ae153; the original actual-route reproduction now produces zero effects in8cases across both sources, both ranges and pointer/keyboard. Three reviewed production files are byte-identical in this combined candidate; full bundles differ for the expected118changes. See independent-gesture-review.json. Real runtime coexistence/recovery remains tracked by root separately.

## Original scoped117 render review and reusable evidence

# Radio UI on PodVoice 2.0.117 · 3 November 2026

Source base: `652499b349f0c45973e366221ff8667dc5ed944f`. Isolated branch `codex/radio-v2x-ui`. No installation, real provider or household effects.

The current canonical PlayerView, SpeakerOutputView, ChoiceList and NotificationQueue remain the renderers. The radio port adds a closed source adapter and existing bridge routes, not a second visual player. The newer 117 queue metadata guard, MOVE origin/choice/UNKNOWN settlement and retained roster behavior survive the semantic port. Robot/Tesla/weather implementation files are not replaced.

## Rendered review (Product Design + Impeccable)

Actual in-app browser at 1280×800, same built candidate in product and library. Saved screenshot bytes were inspected during capture:

1. `01-pending-1280x800.jpg`: retained P3 selection, P4 Starter label, vivid correct cover and shared black control progress; no top Starter panel.
2. `02-playing-1280x800.jpg`: P3 and Stop square in the existing player.
3. `03-stopped-1280x800.jpg`: actual local Stop click; existing Play triangle resumes at live point, selected tile says Stoppet, no duplicate status.
4. `04-liveclient-pending-1280x800.jpg`: click P1 through actual LiveRadioView against an explicitly inert owner; pending offer is held, controls unavailable while custody unknown.
5. `05-liveclient-rejected-1280x800.jpg`: rejected inert command returns to the honest prior empty player and shared bottom-left error toast.
6. `06-liveclient-unknown-1280x800.jpg`: UNKNOWN keeps station commands disabled; shared toast explains uncertainty, no optimistic radio playback or replay.
7. `07-library-pending-1280x800.jpg`: actual library navigation → Radio → Afprøv → Stationsskift afventer; iframe uses the same 1280×800 product renderer.

Hierarchy, fixed geometry, spacing, 64px controls, title/copy roles, card edges and feedback placement inspected together. One actual defect was corrected: generic disabled Button styling added an inset frame to label-feedback ChoiceList tiles while another station was pending. The canonical disabled rule now exempts retained label feedback just as it exempts progress feedback. The selected tile keeps one edge; siblings retain their shared surface. No radio-specific spinner, color or component family was added.

Impeccable mechanical scan reports one existing Inter-font warning in ui/components.css. The approved PodView typography is retained; no font redesign is justified. No new targeted mechanical issue was reported. Accessibility labels and disabled/busy states checked in DOM; this is not a full accessibility certification.

## Verification boundaries

`npm test` uses local one-file import wrappers for the repository's current `tests/podview/*.test.mjs` suite because the copied canonical package script expects `tests/*.test.js`. Those wrappers are untracked QA only; they preserve per-file test isolation and are not shipped. Final 4955/4955 PASS, zero skip, component gate67. The initial blocked local-port run and stale historical radio-pause assertions were retained outside this final evidence; the expectations now reflect the user's live Start/Stop decision.

Python focused radio/assets plus existing music-control/MOVE settlement neighbors: 311 PASS and8 explicit cross-repository cases initially skipped pending paired Go/JS execution. Actual current64 Go serializer → Python ingress → canonical JS paired radio/assets run: 124/124 PASS, zero skips; this exercises all eight initially skipped cases. Ruff and format6files PASS; mypy4sourcefiles PASS. Current browser fixture executes the production renderers/adapter with inert scripted responses; it is not a native/HA service or acoustic acceptance result.

The private QA fixture source is not part of the product graph or asset manifest. An early incomplete browser fixture lacked timer fields and threw before render; it was corrected in QA only, with no speculative production fix. There were no new browser errors after that fixture correction. Actual current backend coexistence/recovery qualification, lead's combined118 source adoption, release, Green installation and physical audio acceptance remain separate.
