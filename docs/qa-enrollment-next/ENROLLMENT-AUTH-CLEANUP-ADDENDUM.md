# Auth source cleanup after historical subset freeze

The original ENROLLMENT-AUTH-PINS.json/patch remains a historical seven-file receipt. Later fd40 rebase intentionally merged both canonical docs; these docs no longer have the old subset hashes. Auth runtime/setup behavior otherwise stayed frozen except this concrete cleanup:

An authoritative named-cookie403 removed proof/storage intent but left namedLaneWanted true, so an existing public peer-notice lane could remain listening. The existing403 causal test was extended to require a closed lane: RED before; GREEN after forgetNamedIntent sets namedLaneWanted=false. This does not grant authority, change the HA actor, call effects or retry enrollment. Focused81tests PASS; independent answer_quality accepted the one-line cleanup. No additional runtime refinement was made.

Current exact auth runtime/test SHA256:

- dist/podvoice-transport.js: `82421b72bb22bde2a88a3cf75622cfbd730d3aed94db70fbd8a3b5b871806f42`
- dist/setup.js: `27f8e152d0bec355132aa35f46eef06ce3e1251172d184ae4fc9aedda01d2b97`
- tests/named-controller-enrollment.test.js: `c1c15435da355dd90aacf7625431da0418639951d52a23c6d42cd8b5236a45a7`

Logs: /private/tmp/pv-enrollment-lane-red.log and /private/tmp/pv-enrollment-focused.log. Final combined candidate must use fd40 weather source and rebuilt bundles; fullsuite/kit/browser evidence is captured only after other owners freeze. No current Mac cookie, HA administrator or physical light was contacted.
