# PodView interface icons

39 interface assets are exact, unmodified Regular SVGs from the official `@phosphor-icons/core@2.1.1` npm package. Stable PodView filenames avoid changing canonical consumers. See `provenance.json` for the source path and SHA-256 of each file; `PHOSPHOR-LICENSE` contains the upstream MIT license.

Legacy filenames ending in `-fill.svg` are compatibility aliases, not icon weights: `pause-fill` uses Regular `pause`, `play-fill` uses Regular `play`, `skip-start-fill` uses Regular `skip-back`, `skip-end-fill` uses Regular `skip-forward`, and `volume-up-fill` uses Regular `speaker-high`. Their SVG `fill="currentColor"` paints the outline contours; it does not select the upstream Fill variant. Preserve the original bytes and consult the manifest rather than inferring style from the alias.

`vacuum.svg` retains the existing circular robot-vacuum silhouette because this package does not include a vacuum. It is a documented domain exception, not a claim of complete Phosphor coverage. Album artwork and station marks are unchanged. The legacy Bootstrap `LICENSE` remains for provenance of earlier or unrelated assets.
