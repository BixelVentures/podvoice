# Enrollment setup · isolated UI review · 23 October 2026

Scope: isolated `/private/tmp/podview-enrollment-next-20261023`, existing Setup page and shared native field owner. No production installation, Home Assistant access or hardware acceptance. Product Design audit and Impeccable polish/craft-floor skills applied to personally inspected rendered screenshots; no external design service was called.

## Baseline and correction

[Before](screenshots/setup-before.jpg): missing canonical ui-kit.css foundations, Arial/fallback teal, 48px heading and 52px CTA. The page now loads the same token owner as product, composes existing Card and Button recipes, and uses the existing native field with its opt-in primary-size variant. No new component family. Setup CSS contains page/form composition and shared typography tokens, not a parallel button or field skin. Existing dialog fields retain52px geometry.

[After](screenshots/setup-after.jpg), [Pending](screenshots/setup-pending.jpg), [Linked](screenshots/setup-linked.jpg) are actual1280×800 captures. Card width520px, padding32px; title28/34 semibold, body17/24; input and both actions64px. Linked card650px high fits viewport. All text wraps; no horizontal overflow. Native keyboard Tab to the secondary link produces the shared2px visible focus outline. Warm neutral surfaces, consistent left anchors, adequate content spacing and clearly separate primary/secondary actions pass this bounded rendered review. Disabled input and pending primary preserve their geometry. No ambient motion was introduced.

## Actual local flow

1. Static isolated page initially shows truthful no-HA status with disabled submission.
2. Closed loopback fixture `/view/setup.html?room=enrollment` supplies authored data. Entered `Lokal UI-kontrol` and clicked the native request button.
3. Pending name remains visible, input/submit disabled, public matching signal and local approval link visible.
4. Opened the fixture's explicit `Lokal fixture · ingen Home Assistant` admin page; clicked `Godkend lokalt eksempel`.
5. Existing native polling/claim/renew/fresh-snapshot flow reaches linked status and `Åbn PodView`; no automatic navigation. Room guidance explicitly states that saved room is not light authority.

No app-state injection, live cookies, provider calls or device actions. Fixture rejects product effects. This is local rendered/functional evidence, not real enrollment acceptance or user design acceptance.

## Validation and limits

28 focused setup/entry/kit tests pass (26 existing +2 kit tests). Component gate before combined build reports only generated-asset mismatches; final combined build/full suite belongs to release owner. No registry baseline changed. Field variant regression explicitly preserves existing dialog52px default.

Bounded auth review found two issues, both corrected by transport/setup owner: unconfirmed named renewal removes only light authority, and linked UI no longer remains linked after named proof loss. Authoritative403 also clears namedLaneWanted to stop the peer lane. Source review GO preserves ordinary HA actor and separate named proof; no general security certification implied.

## Entry proof after final combined build

Actual local `/view/?room=enrollment` → photo click → Lige nu → clock button → Skærm og enhed → Om skærmen → **Navngiv skærmen**. [Entry screenshot](screenshots/setup-entry.jpg); [native destination](screenshots/setup-entry-destination.jpg). This separate capture used the existing2006×1038 viewport, not1280; no shared viewport resize/reset occurred. The entry uses canonical secondary Button typography20/26 and a64px high target. Native click reached exact same-origin `/view/setup.html?room=enrollment`; existing authored cookie renewal reached linked state without a new request. Own tab closed.

Bounded entry review: visible, readable, correct neutral secondary action, no clipping of the entry. Existing unrelated long “Hjemmet” status in this empty fixture crowds its left row label; this is visible in entry screenshot and remains outside this entry-only change. Do not treat the entire settings panel as newly visually accepted.

## Bounded modal correction · supersedes entry limitation above

Root requested the two visible defects corrected before delivery. Working copy only: canonical ui-kit.css network read-only ListRows now use `max-content minmax(0,1fr)` so the label retains width and the value wraps in its own column. The existing secondary entry has16px separation after info. Shared `.pv-btn` owns `text-decoration:none` for Button anchors; redundant local Setup anchor styling removed. No auth or markup changes.

[Actual after image](screenshots/setup-entry-fixed.jpg) personally inspected with Product Design/Impeccable criteria: Hjemmet label/value no longer collide, button no longer touches paragraph or has underline. [Measured evidence](SETUP-ENTRY-FIX-GEOMETRY.json): label/value gap16px, info/button gap16px, Button64px, dialog520px/padding32px. Existing viewport2006×1038 unchanged. Three focused kit assertions pass and built component gate63PASS. New generated CSS954f4d49…; release owner must seal a new packet (previous final packet was not modified).

## Final target-size evidence ·1280×800 fixed iframe

QA-only `/fixture-frame` renders the unchanged product inside an actual iframe measured1280×800 at0,0; the shared browser viewport was not resized or reset. [Expanded modal at top](screenshots/setup-entry-1280-top.jpg) and [native scroll to entry](screenshots/setup-entry-1280-scrolled.jpg) are actual1280×800 screenshot clips of that frame, not resized images.

Personally inspected both images against Product Design audit and Impeccable polish/craft-floor: modal centered in the full frame at380,32 with520px width/736px bounded height and32px padding. Its full830px content scrolls within the dialog; one native downward scroll reaches94px. The entry is then fully visible at412,672 with64px height and32px bottom inset. Hjemmet label/value retain16px separation and readable two-line wrapping; info/Button separation16px; no underline. The top title scrolls out as expected with the existing modal's single scroll container. No overlapping controls or clipped entry remain in this bounded target-size review. [Geometry](SETUP-ENTRY-1280-GEOMETRY.json).

Production files unchanged during this proof. No live enrollment, HA/provider actions, authentication re-test or browser-size changes. Only own QA tab used and closed. Evidence ready for final3 sealing; earlier2006px captures remain historical and are not used to claim target-size acceptance.
