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
Root `dist/` is ignored, disposable build/preview staging. The existing
`scripts/prepare-podview-checkout.mjs` copies tracked renderer files into `dist/`
**only when `dist/` does not exist**. It does not synchronize later edits in either
direction. A successful preview or test therefore does not prove the tracked source
contains changes made only in staging.

Before building a changed tracked renderer, inspect any existing `dist/` and preserve
uncommitted staging work outside the checkout. Once that work is preserved, move the
old staging directory aside, then use the existing commands from the repository root:

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

## Preserving the earlier standalone workspace

The previous Documents/PodView workspace is retained with its local files and
historical evidence. It has no normal Git commits or GitHub remote. It contains
local differences, including preview tooling and study material, so it must not be
deleted or blindly overlaid on this checkout. Reconcile an intended local change
against the agreed integration candidate, using its source owner and evidence,
before adopting it into the tracked paths above. Existing in-flight candidates keep
their current owner and frozen pins. New development starts in this checkout.
