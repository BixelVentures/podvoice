## 2.0.169

- Hent højttalerlisten, mens Vibe indlæses, lad Din musik vente på samme Vibe-opslag, og skjul robottens tidligere rum under opstart, når Home Assistant har bekræftet, at det stammer fra før turen.

## 2.0.168

- Skjul robottens tidligere rum, når Home Assistant bekræfter, at rumværdien stammer fra før den aktive tur.
- Lad Annuller fortsætte efter en konkurrerende timerlæsning, når samme ejer og adgang er bekræftet.

## 2.0.167

- Vis om radioens Stop ikke blev sendt, blev afvist eller har ukendt udfald. Vis en konkret besked, hvis en valgt playliste ikke kan bekræftes ved fornyelse.

## 2.0.166

- Bevar viste køvalg og valgte musikforslag gennem baggrundsfornyelse, fasthold robotens returbekræftelse under midlertidige læsefejl, og tilføj afgrænset fejldiagnostik for mistet musikbetjening og afviste robottryk.

## 2.0.165

- Bevar betjening og eksplicitte valg under opdateringer på musik, radio, robot, lys og timere; behold korrekte mål ved ventende handlinger og vis resten af opskriftskataloget ved en ugyldig række.

## 2.0.164

- Bevar opskriftskatalogets rulleposition, når du går tilbage fra en opskrift.
- Bevar robotkladden for hver rengøringstype, når panelet fornyes.

## 2.0.163

- Vis grafik fra den eksisterende billedcache eller en lokal illustration, når Spotify-omslaget mangler på en personlig playliste.

## 2.0.162

- Gør den senest valgte playliste tilgængelig igen, når musikkilden har bekræftet, at der ikke længere afspilles.

## 2.0.161

- Vis +1 og −1 på en aktiv timer, når Home Assistant tilbyder justering.
- Bevar robottens åbne bekræftelse ved fornyelse for samme robot og handling.

## 2.0.160

- Forny radiostatus før udløb, bevar senest kendt musik ved et forsinket svar, og vis én Base-handling under robotpause.

## 2.0.159

- Base forbliver tilgængelig, når robotvisningen automatisk gendanner den seneste rengøring.

## 2.0.158

- PodView keeps music choices usable when another screen opens or refreshes its suggestions.

## 2.0.157

- Bevar musikbetjening ved listeudvidelse, forny højttalerdata ved udløb, bevar robottens åbne Base under fornyelse, og vis den faktisk indlæste PodView-version.

## 2.0.156

- Bevar covernes plads ved første indlæsning i Find musik. Tid på dagen bruger samme billedplacering under loading og ved manglende cover.

## 2.0.155

- Bevar opskriftskatalogets scrollposition ved turen via forsiden, også mens nye katalogdata indlæses.

## 2.0.154

- Vis forventet færdigopladning fra Teslas oprindelige ladeobservation; manglende eller for gammel sluttid skjules alene, og blandede HA-/PodVoice-versioner bevarer øvrige bildata.

## 2.0.153

- Bevar robotrum og rengøringsvalg synligt under netudfald; genvalidér betjeningen automatisk uden genindlæsning eller automatisk Start.

- Opdatér opskrifters åbne uploadhistorik uden at miste fokus; Prøv igen genbruger samme læsesløjfe og bevarer den godkendte visning.

## 2.0.152

- Tesla-handlinger viser neutral fremdrift frem til frisk HA-status; uafhængige funktioner forbliver tilgængelige efter kvittering, og samtidige fejl bevares.

## 2.0.151

- Keep robot cleaning choices during temporary loss of current water status and require a fresh observation before Start.

## 2.0.150

- Restore approved music discovery and stable controls across refresh, expiry and room changes; preserve robot drafts and feedback, correct weather freshness and answer history, explain radio configuration errors, and restore balanced Tesla confirmation controls.

## 2.0.149

- Preserve admitted robot Start receipts through transient stale observations and keep confirmed speaker rows stable during roster refresh. Extend external-output, cancelled-start and recipe-completion software evidence.

## 2.0.148

- Open authorized weather details after an initial source failure, recover in place, and preserve explicit access denial. Verify decoded local cover fallback without image generation.

## 2.0.147

- Keep station choices usable during radio transitions, recover interrupted Find Music tabs, preserve loading geometry and same-item covers, and retain historical answer reading position when new answers arrive.

## 2.0.146

- Keep the newest scoped HA Tesla status per field with its real observation time, preserve omitted known fields, and require corroborated current trunk direction before offering or sending a command. Requires HA component 0.1.17 for trunk controls; opening PodView does not wake the car.

## 2.0.145

- Keep explicit queue choices through in-flight commands and refresh, including fresh surviving rows when newly exposed metadata is missing. Exact occurrence continuity is supplied by Speakers 0.26.68; no URI/index guessing or replay after unknown outcomes. A new deliberate choice can recover in the same view without waiting for a poll or reloading.
- Open the existing active recipe directly from its home widget without changing its visual layout.

## 2.0.144

- Seek on the existing player timeline while playing or paused, retain the chosen position during refresh, and keep each seek bound to the current track and output. Requires PodConnect Control 0.10.37; older Control keeps existing controls.

## 2.0.143

- Music controls never grey out while a command settles: pause/play flips at once, a tap during a running command is queued, and an unknown outcome no longer locks the controls. Requires PodConnect Control 0.10.35.
- Simpler development process and CI; public README.

## 2.0.142

- Show the selected song or playlist immediately and retain its cover while the player waits for the matching playback observation.

## 2.0.141

- Distinguish an unavailable queue read, an invalid response and the first failed comparison in rejected queue selection receipts. Keep existing checks and playback behavior.

## 2.0.140

- Keep an admitted floor selector reachable when the active robot map has no configured HA areas, including a single offered alternate.
- Retain the existing Rooms and Cleaning options composition for partial setups, with explicit owner-admitted settings and honest absent room/Start capabilities.
- Show the verified current floor without inventing a current-floor action; preserve expiry, offline, pending and unknown-outcome guards.
- Keep missing-cover music-note artwork neutral instead of tinting the whole player gray; retain real cover and radio palette behavior.
- Record the short UX request delivery agreement. Actual robot, music and device acceptance remain separately open.

## 2.0.139

- Preserve the confirmed speaker destination across healthy, semantically unchanged service discovery, including idle, while retaining exact current owner checks for every executable read and action.
- Keep existing UNKNOWN fences and reject old offers and real owner or contract changes; remembered destination never grants playback authority.
- Record bounded queue request/receipt outcomes, execution stage and possible-send status in the existing owner log without playback content or credentials.
- Preserve the approved UI and native companion 0.1.16. The original unobserved queue receipt and actual device acceptance remain separately tracked.

## 2.0.138

- Keep native content execution identities separate from speaker alias identities when selecting music and confirming output changes.
- Confirm the captured destination alias and registry before publishing the new room, preserving native command, account, route and freshness guards.
- Prevent a valid output change from being rejected solely because its independent content and alias identities differ; retain uncertainty fences for actual owner changes.
- Preserve the approved UI and native companion 0.1.16. Intermittent playback-read and actual device acceptance remain separately tracked.

## 2.0.137

- Keep the configured speaker available as a return destination after moving an existing session to another native output on the same Spotify Connect device.
- Preserve existing destination permissions, fresh actual-output checks, native MOVE receipts and the approved speaker-picker UI.
- Native companion remains 0.1.16; unrelated music-read, queue and device acceptance remain separately tracked.

## 2.0.136

- Import valid recipe microdata when a source has no usable recipe JSON-LD, through the existing importer and storage flow.
- Preserve JSON-LD priority, source validation, rejection history and the approved recipe UI.
- Native music-read diagnosis and physical iPhone/device acceptance remain open.

## 2.0.135

- Adjust active and paused timers through the same native Home Assistant timer owner, with revision checks and no automatic effect replay.
- Preserve the original timer and signed adjustments in the existing journal; cancellation cannot resurrect an earlier pending adjustment.
- Native timer adjustment requires Home Assistant component 0.1.16 loaded and its v2 capability discovered; existing basic controls remain available with older components.
- Keep connection feedback in the existing header and screen settings without covering weather or action feedback; preserve Retry focus and geometry.
- Keep the Ro player clear of the active timer/robot rail on portrait displays.
- Native music-read diagnosis and physical acceptance remain open.

## 2.0.134

- Retain dated weather facts through bounded source failures and reload, and clear expired current facts consistently across detail, Home and photo views.
- Preserve original retrieval timestamps and existing authorization checks; cached weather does not grant action rights.
- Synchronize canonical UI sources safely before asset generation and include the existing weather/slow-start journeys in the browser check.
- Native music-read diagnosis and physical acceptance remain open.

## 2.0.133

- Preserve pending music choices and current controls while playback and queue observations settle; keep refresh feedback local to the affected action.
- Restore the approved ongoing-recipe row across category changes and hydrate the existing recipe widget without changing its design.
- Keep an admitted robot start alive through slow settings, preserve exact-once dispatch, and align the approved busy-state layout.
- Restore missing fog and severe-weather icons and add content-free playback adapter failure categories.
- Underlying native music-read failures and physical acceptance remain open; no automatic replay is introduced.

## 2.0.132

- Improve the approved touch music cards and preserve a single text layer during recommendation refresh.
- Restore local cooking progress, checked ingredients and disclosure state after reload.
- Preserve unsent robot room selections across expired setup cleanup and avoid shortening unrelated controls for unused base actions.

## 2.0.131

- Preserve a pending music choice through ordinary Home Assistant snapshot updates; require fresh validated playback authority before starting.
- Show a readable, scoped failure when an explicit playlist choice receives read-only recommendations.
- Correlate renewal response and rejection through the existing bounded diagnostics and Home Assistant logs without retrying commands.

## 2.0.130

- Preserve bounded action diagnostics under polling pressure and trace music selection through the existing native receipt.
- Retain existing touch controls and the approved component library; add cold-start and natural night-entry browser coverage.

## 2.0.129

- Update Home Assistant observations through the existing live connection while preserving touch navigation, focus and content.
- Preserve unsent robot room selections and independent cleaning-mode choices through expired offers and reopening.
- Revalidate active robot settings against their relevant dependencies and observe accepted changes in the open detail.
- Keep light and vehicle observations current across commands, in-flight reads and unrelated voice activity.
- Correlate control and recipe outcomes through existing diagnostics without giving telemetry command authority.
- Keep the existing Home Assistant entry and canonical UI components.

## 2.0.128

- Renew robot controls earlier and preserve eligible room selections on reopening.
- Record bounded server stage and rejection reasons when robot control renewal cannot be restored.
- Import supported recipe links automatically and retain upload status/history (HA companion 0.1.15).
- Keep Find musik loading rows aligned with their loaded layout and admit verified Spotify playlist cover hosts.
- Keep the first connection render safe before radio observations arrive.

## 2.0.127

- Preserve independently observed Tesla state and timestamps across partial Home Assistant updates (HA component 0.1.14).

## 2.0.126

- Restore the approved recipe and Find musik layouts, illustration assets, disclosures and cooking steps.
- Apply the agreed climate dependency to Tesla seat heating and defrost at display, prepare and send.
- Read newer cabin temperature from the configured Home Assistant sensor without waking the vehicle (HA component 0.1.13).

## 2.0.125

- Preserve robot control settings across renewal when a time setting is present.

## 2.0.124

- Accept private recipe links and return review decisions to the iPhone shortcut.

## 2.0.123

- Support a dedicated PodConnect transport credential for radio.

Older entries are in the Git history.
