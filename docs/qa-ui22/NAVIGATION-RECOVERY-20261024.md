# Navigation recovery ·24 October2026

Working candidate `/private/tmp/podview-recovery-20261024`, no production changes by this workstream. Added only an inert QA wrapper `scripts/navigation-recovery-fixture.mjs`: fixed980/1280×800 iframes, explicit native local Disconnect/Restore forms, closes local SSE streams and returns503 during authored outage. No upstream/device calls.

## Actual bounded proof

-980×800: native Home→overview→Radio; local SSE closed/API503. Radio remains open, Back remains visible and enabled. Measured Back330×64, icon32×32; long offline header text166px does not collapse left navigation. Native Back returned to overview while disconnected; restoring fixture recovered connection without reload, and opening Tesla subsequently worked.
-1280×800: native Home→overview→Tesla; SSE/API outage retained Tesla detail and Back. Screenshot shows existing canonical title+arrow, unchanged shared kit spacing and passive empty-state explanation.

Images personally inspected using Product Design audit and Impeccable craft-floor/refinement criteria: [980 Radio](screenshots/navigation-radio-offline-980.jpg), [1280 Tesla](screenshots/navigation-tesla-offline-1280.jpg). No Back clipping or overlapping action found in these cases. Shared browser viewport not resized. No active music/timer supplied by this empty fixture, so their retained playback/countdown is not claimed.

## Source conclusions and limits

`renderTopbar` preserves detail level and Back regardless of connection. A legacy max480 hide rule is superseded by a later same-specificity display rule; it is not established as causal. Long offline text did not reproduce missing Back at tested widths. No CSS patch justified by current evidence.

Potential coupled failure: `renderTopbar()` runs late in `WidgetHost.render()`. A preceding domain render exception could leave stale navigation after scene changes. Transport owner independently reproduced observer exceptions being misclassified as connection failure, but neither workstream has the real failing domain stack. This remains a hypothesis, not the proven cause of the human report. Do not mark that report resolved solely from these empty-fixture checks.

## Authorized exception-path hardening

Added one causal test executing canonical WidgetHost.render and renderTopbar: overview→Radio state transition followed by an authored domain projection exception. Before correction it fails because shell remains `home`; after correction it reaches `detail` and requests the existing Back action for Radio. The original error propagates unchanged (no catch-all masking), and timer/music object references and focus remain intact. Existing native title-button tests separately cover retained arrow/title DOM and one Back handler.

Minimal source correction: invoke existing renderTopbar at render entry, before fallible domain projection. The existing final reconciliation remains, with unchanged-update guards preventing repeat title/clock animation. No CSS, geometry, new components or control authority changes.15 focused topbar tests and syntax pass. This establishes robustness for the authored exception path, not the exact installed human failure. Final combined built-render confirmation remains with parent before closure.

## Final combined-build confirmation

After parent reported combined full-suite exit0, repeated the actual native Radio→local SSE/API503 outage→automatic restore at both fixed1280×800 and980×800. Radio and Back remained present; restoration returned the date/normal empty player without reload and retained Radio. Native Back subsequently returned to overview. Saved and personally inspected `screenshots/navigation-final-offline-1280.jpg` and `screenshots/navigation-final-offline-980.jpg`. Product Design/Impeccable review: Back hierarchy, readable title and retained Card composition pass this bounded flow; **980 remaining visual finding: centered Svar pill visually intrudes into the weather-icon region**. No CSS correction under the current architecture freeze. This is not whole-product acceptance or proof of active playback retention. Both own QA tabs closed; owned4187 fixture process stopped (exit130). No shared browser viewport change. Candidate remains unreleased.

## Shared three-slot topbar correction

Canonical owner `dist/ui-kit.css` now bounds BOTH outside slots with the existing centered224px activity reservation and24px separation. Existing weather/time controls shrink within the right slot; caption/status ellipsis preserves full DOM/accessible text. No typography,64px weather/time/Back geometry, new markup or authority changes. Existing Svar48px silhouette remains unchanged. Generated `dist/podview.css` rebuilt.

Actual same inert native flows after change:980 connected overview→Radio→disconnect→Back→overview→Tesla→automatic restore;1280 overview→Tesla→disconnect→automatic restore→Back→Radio. Back and history identity retained. At980 offline right context x626,width330, history right602:24px gap. At1280 offline context x849.66,width406.34,right1256; history right752; Back480×64, both context controls64px tall. Connected980 context308.85px likewise fits.

Personally inspected Product Design/Impeccable screenshots `topbar-slots-offline-980.jpg` and `topbar-slots-offline-1280.jpg`: overlap removed, title hierarchy/spacing/padding and contrast retained.980 truncation is visible and accessible full status remains in AX. `topbar-slots-connected-1280.jpg` was captured immediately during transition and is NOT settled-state acceptance evidence (weather temporarily clipped). Connecting transient was not captured: fast fixture recovery moved to connected before observation; existing connecting-state unit tests support it but are not visual proof. These two specific settled/connecting capture gaps remain for combined holistic review, not a full visual completion claim.

16 focused topbar/layout tests PASS; component gate63 PASS. New layout test pins shared symmetric reservation, shrinkability and text-preserving ellipsis, checks24px separation at980/1280 and forbids hidden controls or typography/height changes in the correction block. No full-suite duplicate; parent combines. Source frozen; own fixture58134 stopped, own tabs closed, shared viewport unchanged.
