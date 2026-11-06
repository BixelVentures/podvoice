# PodView source and shared release

PodView is developed and released inside this PodVoice repository. There is no
separate PodView repository, renderer copy or release pipeline.

## Where to work

Use a persistent, unsynchronized clone, for example `~/Developer/podvoice`.
Start with `AGENTS.md`, `docs/STATUS.md`, `docs/UI-DELIVERY-GOAL.md`,
`docs/PODVIEW-CONTRACT.md` and the applicable product/UI-kit decisions.

| Purpose | Git-tracked location |
| --- | --- |
| Canonical renderer, styles and assets | `podvoice/gatekeeper/static/podview/` |
| UI regression tests | `tests/podview/*.test.mjs` |
| Component contract and registry | `docs/COMPONENT-LIBRARY.md`, `docs/component-library-registry.json` |
| Build and preview tools | `scripts/build-assets.mjs`, `scripts/build-scripts.mjs`, `scripts/dev.mjs` |
| Current UI feedback and evidence | `docs/UI-DELIVERY-GOAL.md` |

Create a `codex/` branch from the agreed integration base. Check `git status` and
confirm that base before changing files. An active release candidate is not
implicitly replaced by a fresh checkout of main.

## Source, staging and generated files

Edit the tracked renderer under `podvoice/gatekeeper/static/podview/`.
Root `dist/` is ignored build/preview staging, but may contain in-flight work.
The existing `scripts/prepare-podview-checkout.mjs` validates the canonical source,
staging and asset-manifest baseline before writing. It prepares missing staging and
synchronizes a changed canonical file only when staging still matches the recorded
baseline. Staging edits, deletions, divergence and unknown baselines stop preparation
with the exact path; they must not be overwritten to make a build pass.

Inspect a reported conflict and preserve its actual bytes before reconciling the
specific file against its identified source pin. Preserve the existing directory;
do not bulk-replace it with another checkout. Run the existing commands from the
repository root:

```sh
npm ci
npm run build:assets
```

Run only the checks required for the actual change; the UI/component suite is required
for renderer changes. Browser and visual review remain separate from source checks.
Both build and test commands prepare missing staging through the existing npm hook.
After a build, compare the staged renderer with the tracked directory. Review and
copy back only the generated delivery assets that actually changed (`podview.css`,
`podview.bundle.js`, `library.bundle.js`); confirm their source pins and the existing
manifest checks on the same candidate. Do not bulk-copy stale staging over source.
Confirm all intended edits appear in `git diff`. Once source, staging and generated
assets agree, run the final applicable checks on that candidate before committing:

```sh
npm test
npm run dev -- --host 127.0.0.1 --port 4173
```

## One delivery path

Commit tracked source, required generated assets, affected tests and evidence on the
same candidate. Push to this repository and use the existing integration lead and
PR → official CI → merge → publisher → Green installation path. Preserve the current
release's exact source/asset pins and existing admission rules. This guide creates no
new release, installation or physical acceptance claim.

## HA companion publication is a separate producer output

The add-on GHCR image and the native `custom_components/podvoice` integration are
consumed through different mechanisms. A successful add-on publisher does not
prove that HACS can obtain or load the matching native component. Record the normal
GitHub release/tag and its resolved source commit separately from the GHCR image,
HACS download, loaded integration version and discovered capabilities.

The 6 November adoption found that add-on136 was installed while HACS still offered
only old2.0.70, which contains companion0.1.5. The reviewed metadata-only publisher
path must run after successful trusted same-repository main-push CI, preserve all
product checks and immutable targets, and read back any uncertain write before a
retry. Its136 backfill archive target is the exact fully-CI-verified metadata main commit,
with byte-identical shipped/native payload to the already-tested
69b357b72cdd451751e0c3ea72d3feed4c8c9527 and companion0.1.16. Record both source
identities honestly; the installed add-on remains69b. This avoids requesting an
unavailable Workflows:write grant for an old target with different workflow files.
Normal HACS repository-archive delivery needs no invented ZIP asset. Existing tags
or releases are never moved or overwritten to make adoption pass.

The integration lead remains the sole live/install/release operator. Actual native
load and fresh discovery are required before timer-v2 is offered as available;
source contents, a release label or download alone do not establish capability.

## Preserving the earlier standalone workspace

The previous Documents/PodView workspace is retained with its local files and
historical evidence. It has no normal Git commits or GitHub remote. It contains
local differences, including preview tooling and study material, so it must not be
deleted or blindly overlaid on this checkout. Reconcile an intended local change
against the agreed integration candidate, using its source owner and evidence,
before adopting it into the tracked paths above. Existing in-flight candidates keep
their current owner and frozen pins. New development starts in this checkout.
