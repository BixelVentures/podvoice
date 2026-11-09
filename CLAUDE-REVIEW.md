# PodView glyph design candidate · review only

This branch packages the local comparison candidate on renderer baseline `5cf897a4d766e1be48a8cf1df3456c6051aa570f` (PodView 2.0.140). It is for Claude review, not merge, deployment, installation, live integration or physical acceptance. Canonical renderer files and existing status documents remain unchanged.

## Run

From the repository root, with Python 3.12 and Node:

```sh
python3.12 docs/research/selected-direction-20261105/glyph-system/comparison/serve.py
node --test docs/research/selected-direction-20261105/glyph-system/comparison/*.test.mjs
```

Open http://127.0.0.1:4392/comparison/. The server extracts the pinned renderer from Git and overlays the candidate only in the right column. The left column retains the baseline. Same-origin fixtures are inert; network effects and playback are blocked. Primary viewport: **1280×800 landscape**. Mobile access was requested for the library, not a separate mobile product redesign.

## Review anchors

- `comparison/references/01-overview.png` and `02-lights.png`, `03-robot-active.png`, `04-component-states.png` are the user-selected visual anchors.
- `COMPONENT-RULES-v1.md` documents the existing component roles. Its latest direct user rule wins over earlier studies: **neutral dark primary / light secondary; inverse on dark instruments. Domain colors belong to identity, material and status; danger/error remain semantic exceptions.**
- `comparison/references/` contains current screen captures, six final Small pairs and recorded motion examples. GIFs loop the capture, not the underlying user action.
- `comparison/candidate-pin-20261109.json` identifies the portable review source and materials. The retained `candidate-pin-20261108.json` is historical and superseded; it does not cover the final edits.

The implementation uses existing anatomy, observation owners and controls. Candidate modules add presentation and narrow fixes for retained recipe identity, overview ordering and review navigation. No service owner or device permission is added. Unknown/stale data must not imply activity; lamp brightness must never be averaged into a fictional percentage.

## Handoff status

Final visual edits synced: Timer's Slutter text is removed only for fresh running overview timers (`data-status=running`, `data-stale=false`); Light's negative-space bulb is restored; material fields are edge-anchored with reserved text padding. Latest capture: `comparison/references/overview-edge-bulb-20261109.jpg`. Focused candidate checks passed 23/23. Baseline npm test passed the component gate and 4751 tests; four localhost-listen tests were initially blocked by the environment and all four passed in a focused rerun with local-listen permission. This baseline suite does not cover the comparison overlay. Python 3.12 AST check passed for the portable server. Final paired visual review passed all three targeted changes. Typography, padding and neutral actions remain unchanged; the negative-space bulb is restored; edge material fields are clipped to their surfaces. Review caught an overly broad timer selector, now narrowed so paused/stale/done states retain their existing content. Latest paired review evidence is `comparison/references/overview-edge-bulb-20261109.jpg`. Main agent owns branch push and verification; no merge or deployment is authorized.

Earlier evidence is retained for context; do not infer every old screenshot represents the final candidate. Review the actual running right column against the selected references. Product adoption belongs in a later coordinated change to canonical owners, not automatic merge of this overlay.
