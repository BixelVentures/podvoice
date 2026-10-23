# PodView interface icons

40 interface assets are exact, unmodified Regular SVGs from the official `@phosphor-icons/core@2.1.1` npm package. Stable PodView filenames avoid changing canonical consumers. See `provenance.json` for the source path and SHA-256 of each file; `PHOSPHOR-LICENSE` contains the upstream MIT license.

Legacy filenames ending in `-fill.svg` are compatibility aliases, not icon weights: `pause-fill` uses Regular `pause`, `play-fill` uses Regular `play`, `skip-start-fill` uses Regular `skip-back`, `skip-end-fill` uses Regular `skip-forward`, and `volume-up-fill` uses Regular `speaker-high`. Their SVG `fill="currentColor"` paints the outline contours; it does not select the upstream Fill variant. Preserve the original bytes and consult the manifest rather than inferring style from the alias.

`vacuum.svg` retains the existing circular robot-vacuum silhouette because this package does not include a vacuum. It is a documented domain exception, not a claim of complete Phosphor coverage. Album artwork and station marks are unchanged. The legacy Bootstrap `LICENSE` remains for provenance of earlier or unrelated assets.

`image-square.svg` is an additional unmodified official Phosphor Regular asset read from the upstream GitHub repository on23 October2026. Its own source URL and SHA-256 are recorded in provenance.json; it is not claimed as extracted from the pinned package archive. It identifies the existing Foto navigation, not sleep or Do Not Disturb.

`house.svg` is an additional unmodified official Phosphor Regular asset fetched23 October2026. Its upstream URL and SHA-256 are recorded in provenance.json. It identifies Hjem, the passive home view. The retained image-square asset is no longer the navigation icon.
