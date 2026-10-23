# Weather deferred advice · local native afterproof

23 October 2026. Software-only authored loopback proof; no GPT/provider request, HA action, audio or timer. Server4185 session11362 serves current dist; product URL `/fixture-frame?room=weather-advice-deferred&size=1280x800`. Timer items are empty. Root reports1998/1998 and component gate63 PASS; separate fixture tests4/4 PASS.

Actual flow: photo weather → canonical weather detail → reserved gradient slot → authored ready advice → Back → reopen weather. Ready text remains “Tag jakken med – skyerne har allerede taget deres på.” Empty player remains unchanged. Final native browser error log is empty. The first browser attempt exposed native timer receiver Illegal invocation; the owner fixed default timers with bind(globalThis), with a causal regression, before this fresh afterproof.

## Inspected images

- [Requesting](screenshots/weather-requesting-final.jpg), [ready](screenshots/weather-ready-final.jpg), [reopened](screenshots/weather-reopen-final.jpg): actual JPEG1280×800 clips of native1280×800 product iframe; shared Chrome viewport was not resized.
- [Library pending](screenshots/weather-library-pending-final.jpg), [library ready](screenshots/weather-library-ready-final.jpg): existing `weather-advice-pending`/`weather-advice-ready` authored library states, scaled preview within2006px outer screenshot. Library is anatomy comparison, not native server-advice proof.

Product Design + Impeccable visual criteria applied to actual saved pixels: clear temperature/condition/advice hierarchy, same reserved advice slot, readable domain color, preserved hero bounds, aligned player/topbar, no overlap or spinner/text-panel replacement. Library and product share existing weather renderer and gradient anatomy. Bounded visual GO; screenshot proves visible gradient/ready endpoints, not a measured animation timeline. No new visual finding.

Fixture holds POST4000ms below existing6000ms timeout. No poll is scheduled by client requesting status; actual server receipt permits subsequent home polling. Root server journal must bind exact POST/receipt/home order and one-POST/no-replay conclusion; no timestamp claim is inferred solely from screenshot. Reopen visibly retains ready advice. No actual model latency, quality, paid-service, Green or physical acceptance is claimed. Optional failure browser variant was not run; existing causal tests cover failure behavior.

## Source binding

- live-home-view.js SHA256 `6ba2a4917d3554e72fb313f6c6130df18cadd9c3936c1b7e21d41e27046d1e85`
- weather-view.js `35623609a9227cdeb7c1e1623d2332bad8bc80db356e0971dde01b4acd125dc4`
- podview.bundle.js `89e907c82059905bb0ca6786f01ed073781c98c865d606ef046d79a258b937c4`
- test-only weather-deferred-fixture.mjs `265667237baa8a59f276da9843e1d7c0ec01400638a1e8d341be290cf871d71d`

Both own QA tabs closed. Server remains root-owned. No frozen packet/runtime edits by this reviewer.

## Preserved server trace

Root preserved [WEATHER-REQUESTING-FIXTURE-TRACE.txt](WEATHER-REQUESTING-FIXTURE-TRACE.txt): initial home1 idle/posts0 → POST count1 held4000 → receipt pending → home2 ready/posts1 → home3 ready/posts1. This binds one native POST, later unpaid home reads and no additional POST after reopen. Capture did not record a synchronized server timestamp; pending receipt also uses the same gradient. Therefore browser proof is loading-gradient→ready→retained reopen, while exact pre-receipt zero-poll behavior is bounded to the separate inert causal test/source proof. No claim of screenshot-before-receipt timing.
