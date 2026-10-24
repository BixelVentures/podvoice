# Marked enrollment entry ·24 October2026

New working successor `/private/tmp/podview-enrollment-marked-next-20261024` derived from immutable final3, source/ flattened beside dist/; node_modules symlinks canonical workspace dependencies. Main workspace and final3 unchanged.

Only production deltas: WidgetHost's existing gated link appends exact `enrollment=1` after encoded current room; generated podview.bundle.js rebuilt. All other dist files are byte-identical to final3. Marker is a routing hint, not identity, authority, cookie, grant, capability or fallback. The existing same-origin/current ingress path and live/connected/current snapshot/continuity/room checks remain. Constructing a new URL discards previous query/hash; focused test now starts with old room, enrollment=0, unrelated query and hash and asserts exact clean final URL plus existing offline/snapshot/capability/demo hiding boundaries.

Validation: widget-view syntax PASS,9 screen-settings tests PASS, rebuilt component gate63PASS. Root owns required combined full suite.

## Actual rendered/local navigation proof

Used existing inert loopback fixture `/fixture-frame` with actual1280×800 iframe, unchanged browser viewport. Native overview→clock→Om skærmen→scroll showed the unchanged kit entry. Actual href measured:
`http://127.0.0.1:4186/view/setup.html?room=enrollment&enrollment=1`

Native click reached that exact marked setup URL (AX frame URL); no submission, approval or device action. Fixture's static route ignores this query marker: this proof does **not** validate the patched real backend guard or live HA routing. No live HA tab/cookie was accessed.

[Entry](screenshots/enrollment-marked-entry.jpg) and [destination](screenshots/enrollment-marked-destination.jpg) are actual1280×800 captures personally inspected using Product Design audit and Impeccable refinement/craft-floor criteria. No visual change: existing neutral Card/Button, legible text hierarchy, retained16px gaps and64px entry, no underline/collision. Destination retains existing520px Card/32px padding. No new motion/anatomy/style. Own tab closed; own fixture process stopped after capture.

## Exact production hashes

- dist/widget-view.js: `6f4f1a21c3393d196dc3ea8bca1b684a9c070269fe97e24b8f193be695a70f92`
- dist/podview.bundle.js: `f05e2156998791f299f20ac773009d7cbb36a4b88785821c744331090f3ade09`
- tests/screen-settings.test.js: `6675270332975b02f8f34b57b14e455d5a8a13dca5cac2bb0fe11960a808217c`

Root independently inspected both saved1280 images and source diff. The destination shows truthful local renewal-needed state; no claim of real HA approval or cleared cookies. Integrated isolated npm test2038/2038 and gate63 PASS; all201 other runtime and208 other source hashes match final3. Main/Site52 are still final3; this tiny overlay is separately handed to the existing backend/release owner.
