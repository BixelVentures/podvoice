# Samlet servicearkitektur ·24. oktober2026 · produktmål under implementering

Denne direkte brugerbeslutning styrer det videre arbejde og supersederer antagelsen om, at PodView kun skal følge sin konfigurerede standardhøjttaler. De historiske wireafsnit nedenfor beskriver tidligere kildekandidater, ikke et afsluttet samlet musikforløb. Ingen ny wireform eller ekstra myndighed er indført alene ved denne dokumentation.

| Ejer | Ansvar | PodViews rolle |
| --- | --- | --- |
| HA | Faktiske hjemmedata og eksisterende adgang | Vis kildeleveret state; brug eksisterende optagne handlinger |
| PodConnect | Spotify-konto, faktisk item/playing/paused/progress og providerobservation | Projekter den faktiske observation; start ikke en alternativ afspilningsmotor |
| PodSpeakers | Optagne native højttalere og faktisk route/session/lifecycle | Vis faktisk output fra ejerens identiteter, ikke fra standardnavn eller ønsket destination |
| Eksisterende HA/PodVoice-bridge | Autentificeret transport, lukket projektion og aktuelle actiontilbud | Ingen selvstændig musiktruth; før handling til dens eksisterende serviceejer |
| PodView | Kanonisk UI-kit, lokal navigation og præsentation | Send eksplicit betjening, vis ejerens resultat og genopret læsning uden effekt-replay |

De fire uafhængige forhold er: transport til Green; providerens aktuelle observation; den faktiske lydrute; aktuelle betjeningsmuligheder. Ingen af dem må omskrives til en anden. At mangle frisk kommandomyndighed skjuler ikke i sig selv en lovligt optaget observation. At have en sangtitel eller en accepteret kommando beviser ikke startet native lyd. Et Spotify-device-ID alene identificerer ikke nødvendigvis den native PodSpeakers-højttaler, når flere native rum bruger samme Connect-device.

Samlet observation skal dannes af de eksisterende serviceejere ud fra faktisk providerstate, præcis optaget roster og faktisk native route. Standard/konfigureret output og næste valgte destination forbliver adskilt fra observeret aktuelt output. Frontend må ikke løse dette ved navnematch, bredere grants eller ved at mærke rå kontodata som rumbekræftet. Den endelige lukkede projektion og source-owned årsager afstemmes med backendens eksisterende ejere før implementering.

Accept kræver sammenhængende forløb: start fra PodView; start fra Spotify-appen; ændret sang; pause/fortsæt; skift mellem optagne native højttalere; ingen aktiv afspilning; providerudfald; Green-transportudfald og automatisk recovery; serviceejerens genstart. Hvert forløb skal bevare navigation og urelaterede aktiviteter og slutte i faktisk observeret state. Lokal simulation, source-/kliktests, renderreview, udgivelse, installation og fysisk lydaccept registreres hver for sig.

De foreløbige recovery-rettelser er komponentkandidater i denne samlede model, ikke en afsluttet levering.

## Samlet playback-kontrakt v2 ·24. oktober2026 · kildekandidat

Dette afsnit erstatter kun den historiske v1-kandidats binding til konfigureret output. Installeret Green78 og Sites52 er ikke dokumentation for denne nye kontrakt. Den samme eksisterende playback-læser anvendes; ingen ny klientmotor eller endpoint indføres.

`podview.room-playback.v2` har præcis ni rodfelter: `ok,schema,bootId,roomId,configEntryId,status,reason,binding,data`. `data` er den uændrede lukkede ottefelts `podconnect.playback.v1`-observation; native routeproof må ikke indsættes i dette DTO. `binding` er faktisk optaget output med `roomId,accountId,targetId,nativeRoomId,nativeHomepodId,bindingId,validUntil`. `validUntil` er UNIX-sekunder; UI konverterer til millisekunder én gang. Bindingens roomId er anmodende PodView-rum, native-identiteterne er den faktisk observerede rute.

| status | data | binding | reason |
| --- | --- | --- | --- |
| observed | frisk playing/paused | faktisk native binding | null |
| account_observed | frisk playing/paused | null | route_unavailable / ambiguous_output / output_not_admitted / owner_changed |
| idle | frisk no_active_playback | null | null |
| unavailable | null | null | account_unavailable / stale_observation / owner_changed |

PodConnects eksisterende `get_playback_snapshot(include_output:true)` ejer den samlede serviceobservation; eksisterende v1-kald uden flag ændres ikke. Bridge validerer/projekterer den faktiske optagne rute. Samme fælles faktiske resolver bruges til observation, kontrol og kø; passive læsninger afhænger ikke af et eksekverbart kontroltilbud. Default/NEXT-data forbliver hos deres eksisterende ejere og ændrer ikke aktuelt output. Native visningsnavne formateres kun fra præcise optagne katalog-identiteter; et navn er ikke routeproof.

Musik-`controlSetup.target` har `accountId,kind,targetId,expectedBindingId`, også for MOVE-kilden. Musik-`podview.control.v1`-tilbud ekkoer obligatorisk `expectedBindingId` på roden; andre domæners tilbud ændres ikke. Køtilbuddets input og `podview.queue-offer.v1`-svar har samme obligatoriske rodfelt. Uoverensstemmelse eller manglende ekko afvises før betjening. Feltet er ingen grant; backend skal genvalidere faktisk rute og præcis allerede tilladt policy. Eksekvering beholder eksisterende opaque task/option/revision-body. Ingen ny seek eller effekt-replay.

Metadatafriskhed, native bindingsfrist og aktuelle tilbud er separate. En udløbet rute ophæver betjening uden at opfinde transporttab eller fjerne stadig frisk kontometadata. `unavailable` kan bevare samme boot/rum/kontos sidst kendte visning read-only; `idle` rydder aktiv afspilning; `owner_changed` rydder gammel ejerhistorik. Ændret faktisk binding ophæver gamle kontrol-/køtilbud. Ændret standard eller NEXT alene gør ikke det aktuelle nummer til en anden højttaler. Almindelig automatisk transportrecovery bevarer navigation; renderfejl må ikke klassificeres som netværksfejl.

Kilde-/fixturetest, visuelt UI-kit-review, samlet servicekonformitet, udgivelse, installation og fysisk Connect/lydaccept registreres hver for sig. Ingen af disse softwareændringer beviser lyd på en højttaler.

---

# NEXT source contract · explicit named-screen enrollment ·23 October2026

Normal authenticated HA ingress retains its existing actor and capabilities; it does not automatically enroll a browser, adopt a profile or re-pin an old grant. The existing user-opened `setup.html?room=…` page opts into named-screen enrollment using the existing request → HA-administrator approval of exact name/match signal → proof-cookie claim → profile-cookie renewal routes. Legacy code pairing remains forbidden in HA mode. No new endpoint or weaker server check is introduced.

A connected claim alone is insufficient. The setup owner requires a closed successful renewal receipt and a fresh valid snapshot with the same boot, room and transport generation before `namedControllerRenewed` becomes usable. The original HA actor remains authoritative for other domains. The existing setup Button then says “Åbn PodView”; its status directs the user to HA **Konfigurér → PodViews rum · exact named screen → AreaSelector**. A saved placement is not light-effect authority. Policy/pin changes require current manual reapproval; no automatic replacement of an occupied profile slot occurs.

Only after confirmed renewal may a public intent marker record version, full cookie scope and room in optional browser storage. It contains no credential or capability and can authorize only a future validation attempt against the existing HttpOnly profile cookie. Default HA without this marker remains unchanged. Current intent renews the existing cookie at240s under the existing cookie-scope lock; peer notices only prompt reads/coalescing and never prove enrollment. Explicit setup cannot coalesce its required local proof. Authoritative renewal denial clears the named lane/marker and light admission while preserving valid HA-actor capabilities. Late generation/boot/room/source results cannot publish proof. Unknown request/claim is not automatically repeated, and no setup/navigation action commands a light.

This separate source overlay is not installation, proof of a current Mac cookie, live HA acceptance or physical lamp acceptance. Storage failure is reported in the existing setup status; it does not create an alternative authority path.

# NEXT successor · weather advice request-inflight presentation ·23 October2026

The separate working successor to the immutable7201 packet closes a presentation gap while the existing weather-advice POST is awaiting its first response. `LiveWeatherAdvice.sync` exposes internal `requesting`; `liveWeatherModel` maps it to the existing pending summary role with the same reserved Hero slot, gradient and aria-busy. Before dispatch the idle slot remains quiet. Ready advice, a real failure or an unavailable response keeps its existing meaning; no AI result is invented.

`requesting` is client presentation state only. It is not added to any server capability, receipt, wire schema or admission policy and does not itself schedule polling or another provider request. Actual server `pending` retains the existing bounded polling branch; existing interrupted-request recovery reads, source freshness, transport/owner/generation fences, cancellation and cleanup remain unchanged. No new renderer, DOM anatomy or family is introduced. This source-only change does not overwrite the7201 packet and awaits its own rendered review/release/provider evidence.

The same successor binds the default native `setTimeout` and `clearTimeout` functions to `globalThis` before storing them on LiveWeatherAdvice. This preserves their required browser receiver during pending polling and cleanup; explicitly injected timers keep their existing contract. The local Chrome Illegal invocation failure and the strict default-receiver regression motivated this correction. It adds no timer, declaration or API and does not establish the cause of any Green failure.

# NEXT source contract · explicit account-observed playback ·23 October2026

The next candidate admits a distinct server status `account_observed`, not a new claim of room or physical-output proof. Native integration CI, rendered product/library review and release/install acceptance remain separate; this does not describe installed78.

The existing closed eight-field `podview.room-playback.v1` envelope must match boot, configured room, account and exact configured binding/target. For this status its native `podconnect.playback.v1` data has exactly eight fields and no `room_proof_valid_until`; nested fields, freshness, owner epoch and poll ordering are validated. Only this explicit server projection can enter account-observed display custody. Raw account data or an arbitrary matching target name cannot become room proof.

`accountObservationBound` requires current playback read access and the exact account/binding custody. The parsed result is `accountObserved:true`, `readOnly:true`, `roomBound:false`. Existing `roomObservationBound`/`roomObservationCurrent` still require separate room proof. The canonical player truthfully displays the provider's playing or paused state, track metadata and admitted artwork, with “højttaler ikke bekræftet”/“Kontostatus” labels. It neither forces a paused state nor labels the configured name as observed physical output.

Account-observed data grants no queue, seek, rumbound transport or active-session move authority and cannot resolve a pending Play as room-confirmed success. Downgrade from room proof clears old queue/control offers. Expired account data is not retained through the room-proof display exception; denial, binding/account/boot changes and invalid reads remain fenced. Independent music discovery, explicit fresh Play offers and next-destination choices retain their own capabilities and owners. No runtime policy, new renderer/family, automatic effect or provider/audio acceptance follows from this frontend status.

# NEXT source contract · scoped HA lights and idle output intent ·23 October2026

This is the next source candidate, awaiting its native integration CI and rendered product/library review. It is not an installed78 contract or physical light/audio acceptance. Existing canonical renderer identities and anatomy remain unchanged; no new component family or client-issued authority is added. This section supersedes the historical blanket light deferral below only for the closed scoped-light capability described here.

The existing home read admits three joined closed DTOs: `lightAreas` (actual area catalogue, own/selected area IDs, source epoch, binding and placement revision), `lightPlacement` (the explicit configured own area), and `lights` (complete `ha_area` scope, actual entity rows and15-second observedAt/validUntil). Cross-area rows, mismatched catalogue/placement, invalid freshness and unscoped legacy example data cannot become live scope. Counts are light entities, not inferred physical bulbs or lit rooms. Unknown/unavailable entities remain unknown; a confirmed empty area says “Ingen lys i rummet”. Retained expired/offline data is last known, never a fresh observation.

`applyHome` admits only the explicitly bound own-area device into overview. The existing home rail additionally requires current matching own-area/catalogue/placement identity and freshness. The room chooser uses exact admitted area IDs; current selection is the observed scope, not a pending requested area. An explicit `home({lightArea})` read may populate `liveLightDetail` for another actual catalogue area. It cannot replace the own-area overview, configured placement, music/output, timer or weather. Transport/boot/room/catalogue/binding/generation changes fence late replies. Explicit refresh is read-only; disconnect/expiry/cleanup disables old bindings and clears their timers.

Navigation/opening a light or lamp dialog issues no command. Live lamp Tile/Dialog controls display admitted state only; only explicit `supportsBrightness` and a known value permit the corresponding dimmer presentation. The existing “Betjen lys”/“Betjen lampe” Button opens the existing `LiveControlView` Dialog to read a server-issued light setup for exact `{areaId}` or `{areaId,entityId}`. The closed `podview.control.v1` light task has a15-second maximum, opaque task/option IDs, exact HA scope and entity membership, and only `turn_on`, `turn_off` or integer0–100 `brightness` options. A brightness option is rejected unless every selected entity supports it.

The client joins task scope to a fresh current observation and rechecks actual transport, boot/room/provider/conversation owner, read/control capability, source epoch, binding/revision and membership before dispatch. Server admission and the current native task remain effect authority; neither a visible card, catalogue row nor local reducer grants it. One explicit offered option consumes the task once. Pending/accepted never optimistically rewrite observations; unknown effects do not automatically replay. No scene/colour controls or generic HA service payloads are introduced.

The empty player's existing output control may show “Næste afspilning: navn” for an explicit remembered destination under the existing account/room/transport/owner and selection-capability fence. This is intent for a future Play, distinct from configured default and observed active output. Invalidated context hides that intent. During accepted-start pending or active playback, the existing pending/observed player owns output identity. Selecting the next destination alone neither starts audio nor moves an active session. Existing SpeakerOutputView, PlayerView Button and ListRow owners implement this label; source tests are not provider or speaker acceptance.

# Historical display and reload recovery ·18 October2026 ·NEXT56 candidate

Complete, display-admitted visual answers are retained as dated, read-only records in the existing receipt owner. The existing ingress/configured-room read route `GET /view/api/answers?room=…&history=1` returns a closed historical DTO, independent of the current live task. It retains the latest20 records per configured room and server boot, at most64KiB per record. No disk, browser storage or durable household memory is added. Normal question/session changes and browser reload can recover this archive; server restart cannot. Server capture proves admission, not that a human saw the pixels. Existing reads are room-readable through ingress, not private to an individual controller or person.

Historical display never extends a live receipt, source deadline, task or action grant. Source retrieval, retries, choices, follow-ups and checklist mutations remain unavailable. Historical remote image URLs are not mounted or fetched; existing unavailable-image anatomy retains captions and credit. Bundled admitted illustrations may remain. Original observation time and AI/source provenance are preserved. Current and historical receipts deduplicate by identity.

History revision, removal revision and the bounded current receipt-ID membership accompany the existing snapshot. Ordinary admission preserves existing cards during hydration; eviction or exact revocation removes only affected records. Delayed live/history responses cannot reintroduce removed records or overwrite newer history. Temporary absence of history metadata or current-answer capability preserves already admitted display. Different room/server boot or an actual read-access denial clears the requesting browser; a failed control-only renewal does not establish read denial and does not erase other viewers' shared archive.

Normal conversation completion preserves history. Existing explicit stop/privacy/error revocation removes records for the exact original owner/session/epoch, including when a newer current task exists; it cannot remove an unrelated replacement's records. Room-owner replacement and shutdown clear the corresponding archive. The existing canonical answer/history renderers own every display state; no parallel renderer or component family is introduced. Source/unit evidence does not establish Green browser or physical acceptance.

# Current locality lifecycle ·18 October2026 ·NEXT49

The automatic seven-field displayLocation estimate now has a maximum60-second display lifetime. Existing30-second observations remain valid until their actual expiry; cached observations retain their original timestamps. This is a display-only freshness rule, not an action/control lease change. All geography thresholds, dataset pins, source qualification, data minimization and the unchanged two-field configured_label variant below remain in force.

One ToolRouter-owned, bounded HA config request may complete after the individual weather HTTP response. Ordinary admitted weather reads start or refresh that single-flight task once a valid observation is at least15seconds old. Weather never waits for it; a ready same-owner label is returned on the next ordinary read. A still-valid label remains during refresh; invalid/auth-denied/ambiguous results clear it. Source changes fence late results. App cleanup cancels and drains the task. The fixed authenticated internal endpoint and2-second request deadline are unchanged; no additional polling, retry or external geographical recipient is added.

Both canonical weather consumers use the same validator and existing expiry timer. A label expires exactly at validUntil while the actual forecast remains visible. Real owner/envelope-to-frontend tests cover every second through120seconds at16/24-second healthy read cadence and0.05/1.9-second config completion. Longer or hidden/offline-client delays may honestly expire. This proves the bounded source behavior, not Green causality, actual household locality or general geographic accuracy.

The NEXT47 section below is historical: its30-second maximum and cancellation on weather completion are superseded only by the lifecycle rules above. PodVoice2.0.49 is now verified installed/running with the exact143 packaged canonical assets; the household's automatic locality is still unproven. The passive post-install read showed the configured Mårslet label, not a verified automatic estimate. See integration/post49-readback-20261018 for the actual evidence.

# Current locality extension · 18 October 2026 · NEXT47

The existing weather locality slot admits two separate closed displayLocation variants: the unchanged two-field configured_label and a seven-field automatic estimate. The latter is `{name, source: ha_home_geonames, method: nearest_populated_place, scope: ha_home, datasetVersion, observedAt, validUntil}`. Name is qualified as “Ved X”; datasetVersion is the pinned public dataset SHA256; validity is at most30 seconds from an authenticated HA configuration read. Coordinates, distances, credentials and coordinate fingerprints remain server-side. Forecast source/location are preserved and are not asserted to equal the HA home position.

Only the existing server client/token may read the fixed Supervisor Core config endpoint. The complete bundled GeoNames DK dataset is resolved locally; no coordinates are sent to a geographical service. Ambiguous/invalid/slow results produce no automatic label. An unfinished config read is cancelled when weather completes, so weather never waits for the remaining locality budget. Existing normal reads may try again; there is no extra poll or background retry. Manual fallback stays explicitly configured. Both overview and detail drop expired automatic labels through the existing weather timer while retaining forecasts. Existing source information distinguishes the weather provider from GeoNames place-name attribution.

This is the reviewed NEXT47 data contract, not proof of Green installation or correct locality at the household. The unchanged six-public-point check matched four expectations and abstained on two desired names; no general accuracy or city-boundary claim follows.

# Current actual boundary · 14 October 2026, evening

The original workshop contract below is historical. The first real integration is PodVoice 2.0.23: authenticated existing HA ingress serves `/view/`, native timer observations, bounded PodConnect read facade and explicitly provisioned short-lived timer-only pairing. Provider keys remain on existing owners. Snapshot/SSE was observed on Green; full household/device/physical acceptance is not complete.

Passive follow-on media/weather/robot observations are independently reviewed and packaged, not yet installed. Commands must use explicit server-issued scopes and exact owner/session/task/revision bindings; viewer identity and display option IDs grant no authority. Unknown effects never replay. Completed-tool visual receipts bind exact room/session/turn/task/input revision plus current answer revision; sources are guarded same-owner reads rather than generated links/HTML. Optional extra AI remains separately disabled pending model/budget/config admission.

Lights are explicitly deferred in HA while retained in UI. GPT Site remains owner-private and a demo until supported authenticated server connectivity exists. Current receipts: STATUS.md and reviews/PODVIEW-LIVE-PLAN-2026-10-14.md.

---

# PodView v0.1 — behavior and integration contract

This repository is a working browser-only UX prototype. All identity, proximity, voice and transport controls are simulations. It does not establish physical PodVoice, camera, recognition, MCP or Home Assistant operation.

## Product behavior

Ambient displays a decorative landscape and actual Copenhagen time. Near displays a personal household scene using clearly labeled fixture appointments. An active task stays visible even if distance changes. Viewer and task owner are independent: another viewer can explicitly take over, keeping task content and advancing scene revision. Ending a task releases its scene; the distance determines the return view. Offline keeps existing content and blocks task selection, step updates, takeover and saving. Ending the demo and removing a local favorite remain local actions. Local favorites are browser-only, never described as shared memory.

## Prototype scene protocol

The actual POC uses `initialState()` and `transition(state, event)` in dist/model.js. Select and step events carry task ID and revision. A duplicate, stale or disconnected action cannot mutate the scene. The prototype does not generate production credentials or execute household actions.

## Proposed production boundary (unimplemented)

PodVoice remains sole owner of audio sessions, turn state and physical audio cleanup. PodView renders a server-owned scene and sends user actions. A renderer must not start a second voice engine. Family memory is a separate persistent service to be shared through the Pod API and custom MCP tools. Browser storage does not become the family memory backend.

Scene envelope: protocol_version, room_id, display_id, session_id, task_id, scene_id, revision, task_owner_id, viewer_id, content, allowed_actions, expires_at. Every action binds actor, device, session, scene and current revision. Server authorization is independent of the model and browser. A viewer recognition signal alone cannot authorize private content or a sensitive action.

Commands: scene.replace, scene.patch, session.ended, identity.observed, presence.changed. Browser returns scene.rendered and action.requested; action results distinguish accepted, executed, verified, failed and unknown. scene.rendered only acknowledges rendering. No replay of ambiguous physical effects.

On reconnect: authenticate, request authoritative snapshot and apply it atomically before admitting interaction. Do not replay offline clicks. Fence delayed results by session generation and scene revision. A new viewer must not silently acquire an old task. Shared family scenes need explicit visibility policies for guests and multiple viewers.

## First actual integration proof

1. A real PodVoice session publishes three choices to a paired browser display.
2. A touch selection returns to that SAME active session, with the exact option ID.
3. Voice selection chooses the same option as touch.
4. Disconnect retains visible content and blocks action dispatch; reconnect fetches a fresh snapshot.
5. A stale control from a terminated session is inert.
6. Profile changes preserve the active task until an explicit authorized takeover.

The user explicitly deferred camera use and automatic person recognition from the first POC. Manual profile selection is sufficient for the first integration. Custom screen and camera hardware are later possibilities. Camera enrollment, speaker identity, proximity thresholds, persistent household memory, native ChatGPT plugin routing and physical frame deployment are later implementation work. No claim of Apple-equivalent biometric security or session handoff is made.
