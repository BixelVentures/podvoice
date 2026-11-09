# PodView · Claude-based comparison review · 9 November 2026

Review-only branch. Do not merge, deploy or install. Left is the existing PodView 2.0.140 renderer `5cf897a4`; right builds on the actual Claude export and user-selected Grille references. This is still a local presentation overlay, not canonical product integration.

## Run

From this repository root:

```sh
python3.12 docs/research/selected-direction-20261105/glyph-system/comparison/serve.py --repo . --port 4394
node --test docs/research/selected-direction-20261105/glyph-system/comparison/*.test.mjs
```

Open http://127.0.0.1:4394/comparison/#overblik. Primary product viewport: 1280×800 landscape. Local fixtures have no household effects. Actual Claude portable boards are alongside comparison in `claude-source-20261109/portable/`.

## Changes in this round

- Actual Claude geometry/fonts/material and player composition; neutral command system, meaningful domain tint, shared Small geometry.
- Tesla: compact defrost action and default detail without incidental vertical overflow in the inspected 1280×800 state.
- Recipes: full width with player hidden; stable Opskrifter header and complete page title; wrapping ingredient/recipe/action labels.
- Robot room/settings and music results can wrap; overview music label aligns left.
- Timer detail separates status copy from ring; bounded 56px finish control and 56px action height.
- Player metadata wrapping; explanatory empty-state copy uses body styling.

## Evidence and remaining work

23 focused comparison tests and inert.js syntax pass. Final overview, long recipe and active timer were rendered and visually inspected. The final completed timer and all long/empty/error player combinations have NOT been fully re-rendered. Earlier Astra, Product Design and Impeccable findings informed this round; do not treat that as exhaustive acceptance. Latest screenshots: comparison/references/final-review-*-20261109.png. Other captures can predate later changes.

The user still finds the overall interface cramped. Challenge spacing, hierarchy, typography, sizes and component composition within the approved direction. Preserve actual native capabilities and state owners. Explain an active other recipe clearly; currently its Continue action can be mistaken for this recipe's action. Review all screens and states for clipping, alignment and motion coherence.

The candidate still uses synthetic fixtures. Real Green source routes were identified, but no fresh read was made: authenticated same-origin GET view/api/snapshot, view/api/home, view/api/music?kind=playback with the existing configured room/account. Next: capture sanitized actual observations and replay using native applyHome/state owners, preserving timestamps; no fake freshness, command grants or LAN proxy. Keep credentials/private payloads out of Git. This is an explicit open item, not live-data acceptance.

No canonical runtime changes, merge, release, installation or physical acceptance in this handoff. The old candidate-pin JSON files predate this round and are historical, not final manifests. Git commit is the review source identity.
