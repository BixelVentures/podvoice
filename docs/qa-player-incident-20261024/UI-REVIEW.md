# Player incident ·24 October · MAIN local visual review

Scope: observed playing progression, paused/stale frozen presentation, nullable volume with real max35 schema, first explicit intent while setup is deferred, and retained navigation. Same canonical product/library at native fixed1280×800 and980×800; no shared browser resizing. Production HA tab remains untouched. Final screenshots below use the combined MAIN build after root GO; production files were not edited by this review.

QA-only `scripts/player-incident-fixture.mjs` uses authored existing v2 DTOs, loopback4189, normal product transport/SSE. Outer native buttons change server observation modes and hold/release control setup; product appstate is never injected. Actual action endpoint always403, effectDispatches remains0. The offered task models known volume35 with max35; unknown-volume sets null. This validates display/admission behavior, not physical audio or provider support.

Planned bounded evidence: multiple DOM samples of progress separated by actual interactions (static image is not timing proof); native pause observation remains fixed; stale cannot extrapolate; unknown volume disabled with truthful label; hold-setup then native Pause immediately shows pending before setup completes, double activation suppressed; release returns rejected action without a fabricated observed pause. Screenshots inspected using Product Design hierarchy/spacing and Impeccable craft-floor criteria, with actual library same-owner reference.

## Actual review result

Bounded PASS for the changed player presentation. Product Design and Impeccable review of the actual images found no new blocking hierarchy, spacing, control placement, contrast or geometry defect in this player batch. Placeholder artwork is intentional authored fixture content. At980 the existing one-line title/artist truncation is retained, with full accessible names. Header and player do not overlap. No new design or styling was introduced.

- Native1280 iframe measured1280×800 at outer offset0,112. Playing volume DOM: min0,max100,value35,disabledfalse, even though the offered command policy is max35. The screenshot visibly places the thumb at35%.
- Hold setup then native Pause showed **Afventer svar…** before setup completion. Existing content stayed in place; Pause/volume became disabled and volume stayed35. Release produced one denied action, with no fabricated paused observation. The following paused state came from the separate authored paused observation button.
- Paused observation was84000ms in AX and remained84000 in the later DOM sample at1792833864797. Stale retained84000ms and changed its accessible description to Sidst kendte position. Known track/output remained visible; no claim of current playback was added.
- Fresh unknown-volume at980 showed the disabled slider; its accessible value is unknown (—), while the existing numeric output remains screen-reader-only. The native fallback0 is not presented as a known0% label. The screenshot alone does not explain why volume is unavailable; service/status evidence remains separate.
- Playing observations advanced92419→98568→102401ms over successive actual reads/interactions. This proves visible progression, not a measured exact1Hz local timer: source polling also advances the fixture. Exact cadence and absence of every transient repaint require the causal source tests; static screenshots are not timing proof. No35→0 repaint was observed between the recorded ready/pending samples, but this is not a continuous frame recording.
- Canonical library music-paused and player-active-offline were opened using the actual native state selector. Same player anatomy, cover frame, transport and separate volume roles remained; offline library preserved1:24 and disabled commands. Library screenshot outer viewport is2006×1158, with its documented1280 composition scaled; it is not represented as a native1280 screenshot.
- Final native journal: modeplaying,holdfalse,pending0,setups24,actionsDenied1,effectDispatches0. No Home Assistant, provider, audio or device action occurred.

## Personally inspected images

All paths relative to this report directory:

- screenshots/player-incident-playing-1280.jpg — native1280×800 ready/progress/35%.
- screenshots/player-incident-pending-1280.jpg — native1280×800 deferred explicit setup, retained35% and pending toast.
- screenshots/player-incident-paused-1280.jpg — native1280×800 paused observation.
- screenshots/player-incident-stale-1280.jpg — native1280×800 retained stale metadata/progress.
- screenshots/player-incident-unknown-980.jpg — native980×800 unknown volume and compact layout.
- screenshots/player-incident-library-paused.jpg — library context/top portion.
- screenshots/player-incident-library-paused-lower.jpg — personally inspected lower controls: resume icon,35% volume, retained1:24, unchanged spacing.
- screenshots/player-incident-library-stale.jpg — library lower content/control anatomy after native outer scroll.

URLs: http://127.0.0.1:4189/incident and ?width=980; /view/library.html#component=player&state=player%3Amusic-paused&view=single&level=screens&recipe=player; stateplayer:player-active-offline. Actual UI interactions only; no private appstate injection or shared viewport changes. This review does not prove physical behavior, command execution, or exhaustive animation timing. Root separately owns full-suite results and release decisions.
