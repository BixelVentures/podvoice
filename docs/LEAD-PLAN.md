# Lead-plan D2 — én fælles udførelse, to betjeningsflader

Dato: 25. oktober 2026. Lead, integrations- og releaseejer: `/root` i PodVoice-tråden.
Status: **planreview GO; implementation, release og fysisk accept er ikke godkendt af planens score**.

Dette er den ene kanoniske arbejdsplan for den godkendte D2-retning. Den eksisterende
`docs/STATUS.md` er fortsat beslutnings- og resultatlog; denne fil er planen, ikke en
parallel statuslog. PodView ejer den kanoniske UI-kilde og slutreview. Ingen konkurrerende
release eller installation oprettes. Denne gemning ændrer kun dokumentation.

## 1. Grundlag og uafhængige reviews

| Reviewer | Agent | D1 | D2 | Endelig afgørelse |
|---|---|---:|---:|---|
| Levering og fuldstændighed | `sol61_release75_review` | 94 | **97/100** | GO som faseopdelt implementerings- og leveringsplan |
| Stemme og lifecycle | `voice_close87` | 96 | **98/100** | PLAN GO |
| Connect og systemintegration | `weather_backend_review` | 93 | **97/100** | GO for den faseopdelte plan |

Reviewerne har afgivet deres scorer uafhængigt. D2 lukkede de alvorlige planfund om
konkrete HA-callers, ordinary-route release, stationsprotokol, close-adfærd og aktivering/
rollback. Ingen åbne P0/P1-planfund i de gennemgåede områder. Scorerne er ikke en
sandsynlighed for fysisk funktion, source GO eller tilladelse til at springe gates over.

Senest verificerede Green-baseline: PodVoice **2.0.89**, Speakers **0.26.53**, Control
**0.10.23**, PodVoice HA-komponent **0.1.6**. Diagnose-only 2.0.90 er merget som
`65fe801a8bb587ba42518ce4dbb04ee39b59fd76`, tree
`58f550af185e8ab2f325bdba4db680e297a69da1`; installation af 90 er ikke verificeret.
89 er ikke fysisk godkendt som stabil samlet version. Ingen ekstra mellem-installation
af 90 er nødvendig for denne plan. Versions-/live-status aflæses igen ved udførelse.

Dette checkout er historisk og dirty. Dets ældre runtime-/half-duplex-beskrivelser er
ikke den aktuelle v2.x-retning eller shippede kilde. Implementering starter fra det
verificerede aktuelle træ i den vedvarende usynkroniserede udviklingsklon; lokale
historiske runtimeændringer må ikke blandes ind som en ny produktionsbaseline.

## 2. Mål og arkitektur

**PodView og PodVoice er betjeningsflader til de samme serviceejere.** Vi forenkler den
eksisterende vej; ingen rewrite, ekstra musikmotor, generisk command-bus eller ny
global tilstandsservice. GPT-Live, full duplex, ThinSession og VoicePELink bevares.

| Funktion | Eneste udførelses-/sandhedsejer | Fladernes opgave |
|---|---|---|
| Musik, kø, output, volumen | Eksisterende PodConnect/Control → Native/C → HomePod | Intention og faktisk observeret resultat |
| Timer | HA-timerintegrationen | Samme start/status/cancel/alarm-ack fra begge flader |
| Robot | HA-integration og faktisk robot/dock | Samme kommando, kapabilitet og status |
| Samtalebetydning | GPT-Live | Input og præsentation |
| Samtale/lifecycle | ThinSession | Adapterne må ikke skabe en parallel lifecycle |
| Fysisk I/O og rearm-bevis | Firmware via VoicePELink | Ingen fabrikeret playback-, LED- eller wake-kvittering |

Kø er Connect-data. Manglende kølæsning må ikke stoppe afspilning eller blokere Play/
Pause/volumen. Musik og næste nummer skal fungere med PodView lukket. Spotify-appen
er en legitim anden betjening af samme output; ændringer derfra skal observeres uden
at UI låser eller skriver sin egen sandhed tilbage.

Spotify Radio betyder eksempelvis »Gå til sangradio«, hvor Spotify leverer flere
lignende numre. Autoplay efter sidste nummer er beslægtet, men ikke samme kontrakt.
Begge fortsættelser ejes af Connect, ikke PodViews Radio-widget eller klientens kø.

### 2.1 Fjern den påviste HomePod-bypass

Valgt START og præcis MOVE deler allerede ejer. Generiske HA-medie-/stemmekald kan
derimod gå direkte til Spotify WebAPI, mens touch går gennem bundet Control. Det er
parallel effektadmission/kvittering, ikke bevis for to fysiske lydmotorer.

| HA-/voice-operation | Fælles ejer for verificeret Native/HomePod-mål |
|---|---|
| Play/Unpause, Pause, Next, Previous | `get_room_playback_controls` → `control_room_playback` |
| Absolut volumen | `get_room_volume_controls` → `control_room_volume`, `args.percent` |
| Volumenstep | Samme ejer; beregn fra frisk faktisk basevolumen |
| Valgt track/playlist | `get_room_content_controls` → prepare → start selected content |
| Flytning | Eksisterende RoomMove get → prepare → move |
| Køforekomst | Eksisterende QueueBroker/RoomQueue get → prepare → control |
| Frigiv højttaler | Den nye bundne release-handling, afsnit 4 |

Native-klassifikation genbruger præcis `target_id == speakers.start_identity()` og
frisk konto-/alias-/rum-/HomePod-/routeidentitet. Navn, HA-area og »selected« er ikke
klassifikation. Manglende identitet betyder ukendt/utilgængelig, aldrig ekstern fallback.
Verificerede ikke-Native Spotify-enheder beholder deres eksisterende adapter.

`PlaybackCommands.execute` ejer serverens aktuelle konto, owner epoch, poll, sekvens,
request-id og room/native/C-proof. HA- og PodView-adgang samt volumenpolicy bevares
hver for sig; en HA-adapter må ikke låne en UI-task eller fabrikere proof. Fjern
optimistisk HA `playing` før udførelse; pending intention er særskilt fra observeret state.

Seek, shuffle, repeat, SelectSource og øvrige allerede annoncerede content-typer skal
spores gennem wrappers, service-/toolannoncering og sekundære callers. Manglende
Native-paritet får den mindst mulige typede udvidelse af samme transport/content/list-
ejer i denne levering. Ufærdig paritet er **blokeret implementation**, ikke skjult
featurefjernelse eller tilladelse til gammel WebAPI-bypass.

### 2.2 Fjern tre klientkompensationer efter servicekontrakten er bevist

1. Eksisterende Control `get_playback` får opt-in `include_controls:true`, som kræver
   `include_output:true` og returnerer lukket `podconnect.playback.v3`. v1/v2 bevares.
   Genbrug RoomTransport.observe og RoomVolume.read uden offer-oprettelse. Readonly
   `controls` indeholder status, finite reason, binding-id, min. oprindelig valid-until,
   supported actions og faktisk base-/effective-volume eller null. Ingen execution-
   sekvens, prepare-id eller granttoken. Samme account/owner/poll/native/C-route skal
   holde før og efter awaits. Fjern derefter passive eksekverbare setup-kald til visning.
2. Eksisterende Commands.receipts og playback-read kan med request-id/command-sequence
   levere versioneret settlement: confirmed/pending/superseded/unknown/rejected, original
   identitet og faktisk observation. Serverejeren sammenholder konsumeret Native-
   operation/effectrevision med frisk samme-ejer-observation. En senere Spotify-tid
   alene er ikke bekræftelse. Volume kræver faktisk volume-read. Fjern derefter klientens
   action-specifikke matching og otte-sekunders opfølgningsloop; behold almindelige
   read-/freshness-/late-response-guards.
3. QueueBroker modtager vist opaque occurrence-id og queue-revision og opløser præcis
   forekomst atomisk før frisk Native-admission. Flyt eksisterende ordnede reconciliation
   ind i denne ejer. Ukendt/stale forekomst afvises; duplikeret URI må ikke gættes.
   Fjern derefter klientens URI-/indeksremap.

UI beholder navigation, sidste kendte præsentation, lokal pending og legal DTO-validation.
Normale reads, sangskift og udløbet engangstilbud må ikke blinke hele betjeningen disabled.
Et eksplicit klik får stadig frisk serveradgang. Revocation og ændret ejer afviser sandt.
UNKNOWN må aldrig automatisk genafspille en effekt. Readfejl i ét domæne deaktiverer ikke andre.

## 3. Udførelse og parallelle ejerspor

| Spor | Ejerrolle | Leverance og næste gate |
|---|---|---|
| Connect/lyd/fælles kommandoejer | Connect-engineer | Første tabende START-kant → kausal RED → mindste ejerrettelse; fuld aktuel HA/touch/voice-paritet |
| Release og station | Connect-engineer; C/Native separat reviewer | Afsnit 4: journal er hård gate; afsnit 5 stationsfortsættelse er pauset af brugeren |
| Svar/close/provider | Voice-engineer | Afsnit 6; faktisk input/resultat/output, ikke en blanket relay-patch |
| Timer/Stop/LED | Native/HA-engineer | Én alarm-/Stop-transaktion, samme-generation LED/playback/rearm |
| Reads/diagnostik | Backend-engineer | Proven 429-RED og prioriteret bounded retention, afsnit 7 |
| Historik/visuals/vejr | Backend-engineer + kanonisk PodView-ejer | Afsnit 8, ingen ny renderer eller cacheplatform |
| UI/robot/adgang | PodView-ejer; lead integrerer backend | Minimal semantisk fletning, afsnit 9 |
| Recovery/latens/release | Lead | Måling → største flaskehals → samlet artifact/aktivering, afsnit 10 |

Brug op til otte nyttige agenter, én skriver pr. fil. Lead fletter overlappende hunks;
PodView bygger/reviewer kanoniske assets. Undersøgelser har en navngiven ejer, konkret
spørgsmål og næste artefakt. Efter en kort afgrænset undersøgelse uden bevis angives
den nøjagtige manglende kant; ingen uendelig polling, fixtureplatform eller spekulativ patch.

## 4. PC70 — manuel frigivelse af præcis højttalerejer

Manager `POST /api/release` har lukket body `{room_id, expected_binding_id, request_id}`.
Eksisterende room-status tilføjer readonly `release.owner_binding_id`: serverhash af
aktuelt Native-owner/C-route/writer-generation-descriptor. Det er ikke Control's hash
eller et nyt adgangstoken. Manager genlæser og sammenligner før prepare.

Udvid eksisterende nativeTransportOffer/roomTransportPending med action `release`.
Genbrug Native owner/revision og det eksisterende lukkede writer-proof med seks felter:
`native_process:{boot_id,pid,proc_start_ticks}`, `writer_fd`, `source_epoch`,
`open_generation`, `input_path_digest`, `pipe_identity:{device,inode,type:'fifo'}`.

C-bound prepare har præcis native_prepare_id, action release, args_digest,
native_owner, native_revision, purpose `manual_release_v1`, writer_proof.
Bound commit tilføjer token og expected_input_path_digest. C pinner faktisk input_epoch
internt; Native sammenligner returneret identitet med sin fangede C-route.

Ordinary `clean_absent` bruger en lukket `transport_release`-variant i den eksisterende
retirement-journal og transport_slot; ingen opdigtet completed-START-token. START/MOVE
bevarer deres eksisterende retirement. C persisterer prepare/gate-closed **før** ACK og
før Native må Close. Prepare-reply bruger særskilt lukket
`podconnect.output_transport_release_prepare.v1`, med token, prepare-id, owner/revision,
identity/proof, purpose, prepared outcome, gate_closed, durable_pending, remaining_ms og
physical_result_verified:false. En almindelig pause-ACK er ikke release-prepare.

Efter bekræftet prepare: revalidér → luk/join præcis fanget Native-ejer **uden for dens
actor** → eksisterende bound-family release-confirm med kun token, native_prepare_id,
native_revision, native_close_done:true. C beviser selv process/FD/all-writers-closed,
samme FIFO/old input-epoch, ingen fremmed route og drain; boolen alene er ikke bevis.
Frigiv kun gammelt device/incarnation/selection-revision, aldrig global empty-deselect.

Terminalt resultat er lukket release_result.v1 med ok, prepare_id, outcome
retired/rejected/unknown, terminal, contexts_drained, retry_allowed:false og
physical_result_verified:false. Prepare409 før mutation giver ingen Close. Tabt prepare-
ACK giver UNKNOWN/fence indtil eksakt operation-read. Klientcancel efter holdbar prepare
må ikke stoppe serverejet cleanup. Stale svar/restart må aldrig frigive en nyere ejer.
404, EOF og disconnected er ikke terminalt retirement-bevis.

Før implementation/freeze: uafhængigt C-owner-/journal-feasibility-review; kausale tests
for START/MOVE/ordinary, paused/playing, nyere ejer, lost ACK, cancel, crash, late confirm
og frisk efterfølgende START. Upgrade/reboot/downgrade-kompatibilitet er obligatorisk.

## 5. PC13 — fuld stationsfortsættelse

**Pauset efter brugerens udtrykkelige beslutning 26. oktober.** Den lange Spotify
Radio/stationsfortsættelse er synligt udskudt og er ikke længere en gate for denne
samlede udgivelse. Stop research, nye providerkald og protokolimplementation på dette
delspor indtil genoptagelse. Eksisterende ordinary START/reconnect, korrekt lyd,
kontrol, trackidentitet og sand tilstand efter 404 er stadig med i leverancen.
Kravene nedenfor bevares som genoptagelseskriterier; de er ikke opfyldt eller frafaldet.

Gate0 ejes af Connect-engineeren: genbrug en faktisk vellykket station next-page/context/
Dealer-trace. Mangler den, kør en bounded autentificeret read-only undersøgelse med
indledende resolve og to efterfølgende sider pr. case, uden Play, transfer eller audio.
Bevar private data lokalt; intet auth-/husholdningsindhold i publiceret testmateriale.

Gate0 skal levere faktisk request/cursor/context, successor-identitet, history/duplicate-
semantik og forskel mellem EOF, 404, 401/403, 429, netfejl og malformed response.
At stationURI kan encodes i eksisterende autoplay-request er ikke providerbevis.

Implementér kun den verificerede opaque cursor-/requestkontrakt i eksisterende resolver/
listeejer. Én continuation pr. boundary; stage/decode successor og revalidér ejer før
eksisterende handoff. Natural EOF, Next og prefetch skal bruge samme implementering.
Pagefejl er ikke EOF; ingen GoStart-rewind, første-sang-fallback eller blind retry-loop.
Tests krydser mindst to udtømte sidegrænser og Next/prefetch-race.

**Uden verificeret kontrakt forbliver stationsfortsættelsen uløst.** Den blokerer
efter brugerens pause ikke denne udgivelse. Ingen påstand om færdig radiokode.

## 6. Stemme, svar og afslutning

PV215/101: skeln mellem forkert/manglende faktisk svar, tabt gemt tekst og tabt UI.
Korrelér command/session/generation/input → delegation/resultat → primær tekst/lyd →
History → room-read → JS. En senere korrekt typed prøve uden commentary-relay afviser
en blanket »manglende relay«-årsag. Ret kun første dokumenterede tabende ejergrænse.

PV153: prompten forbyder allerede selvstændig generisk kvitterings-/fremskridtstale.
Undersøg exact resolveret startup/custom/primary/backend-instruktion og outputejerskab;
fjern kun en konkret konflikt. Ellers er model-/protokoloverholdelse fortsat åben.
Naturlig hum/prosodi og et kort naturligt ja/hmm er tilladt efter brugerens præcisering
26. oktober, også før en reel handling eller under afslutningen. Ingen sådan reaktion
må påstå et endnu ukendt udfald. Gentagne generiske Modtaget-/fremskridtsreplikker er
fortsat uønskede.
Efter aktuelt accepteret silent=true genereres ingen ny tale eller smålyde, mens
allerede modtaget/igangværende lyd stadig drænes korrekt. Ingen frasefilter eller blind PCM-mute.

Brugeren har fastlagt UX:
- Eksplicit »Tak, det var det«: afslut uden nyt opfølgningsvindue. Tavs standard er
  tilladt; ingen ny farvelgenerering kræves.
- Efter almindeligt svar: fire sekunders reel quiet til opfølgning, ikke yderligere
  fast to-sekunders ophold efter LED-ACK.

Normal idle: eksisterende 4s quiet → native closing-LED-ACK → atomisk revalidering →
eksisterende finalizer. Fjern fast post-ACK 2s; ACK-timeout er teknisk fejlgrænse.
Semantisk kandidat: accepteret aktuelt END/backend-settlement og nødvendig kendt work/
audio-consumption → session.close → modtag al sen lyd → rigtig SessionClosed →
stream.finish/exact playback_finished → teardown/rearm, uden nyt fast 4s followup.
Tavs afslutning skal være faktisk understøttet provideradfærd, ikke kassering af PCM.

Før adoption skal en fokuseret faktisk SDK/GPT-Live-prøve bevise close-kontrakten uden
tab af kendt output eller accepteret input. Kan den ikke, er hurtig semantic close
blokeret; ingen fabrikeret audio-done/ACK eller vilkårlig erstatningsdelay. Nyt aktuelt
input før atomisk close-admission annullerer; efter commit afsluttes rent og næste wake
virker. Full duplex gælder aktiv samtale, ikke en umulig garanti om input efter close.

Bevar 88's raw-fragment-rettelse og ny faktisk input/delegation som stale-close-cancel.
Test END med/uden lyd, late audio, input ved 4s/LED-ACK, pending work, forkert generation,
dubletter, provider-close-fejl, forkert playback-finish, én teardown/rearm og Talk-adapter.
Ændret semantik gennemgår eksisterende fokuserede fem-case live-gate uden huseffekter. Brugeren godkendte de
konkrete syntetiske prøver uden en garanteret $5-grænse; dette er ikke et automatisk
krav om flere kald. Genbrug uændrede resultater. PV219 kræver rigtig mute/unmute-provider-ACK.

Evalueringsdisciplin: rapportér input/fixturevaliditet, semantisk handling, faktisk
software-lifecycle, talestil, faseopdelt latens og fysisk accept hver for sig.
Et samlet FAIL må ikke omtales som fejl i alle dimensioner; en bestået dimension
må heller ikke gøre det samlede krav grønt. Eksakte værdier/identiteter/protokoller
kræver eksakt kontrol; en meningsfuld naturlig formulering bedømmes ikke på ordret
lighed med et referencesvar. Testværktøjets stimulusflow må ikke afhænge af en
uvedkommende ordret transskription. Kontrollér afvigelsen mod det faktiske spor,
før produktkode ændres; bevar originalrapport og særskil offline-genbedømmelse.
Mål både brugerens sidste inputlyd til afslutning og backend-settlement til afslutning;
den sidste er kun en delfase. Enkeltmålinger og 5/5 er afgrænset acceptancevidens,
ikke et estimat på 99,9% produktionsstabilitet. Brug først gemte spor til analyse;
yt providerkald kræver en konkret ændring eller et præcist ubesvaret spørgsmål.
Disse fortolkningsregler ændrer ingen eksisterende D2-gate eller acceptgrænse.

Præcisering efter brugerens hum-beslutning: literal PCM-tavshed og naturlig
ikke-sproglig lyd er forskellige stilkrav. Bevar tidligere strengt tavse rapporter
uændret; supplér med kilde-/tidsbundet semantisk vurdering under det præciserede
produktkrav. En caption er tekstligt indholdsbevis, ikke fysisk/acoustisk accept.
Dette ændrer hverken currentness-, outputbevarings-, close-, latens- eller fem-case-
kravene og gør ikke tidligere uprøvet kilde provider-godkendt.

F17's forklaringer/trin/sammenligninger bruger én eksisterende delegation af original-
opgaven med svar og struktur; korte facts/matematik/handlinger beholder direkte vej.
Ingen ekstra selector-/redraw-modelrunde. Held WIP adopteres først efter nyttig fuld
talt færdiggørelse og close-gates. Den gamle explicit-close-prøve forbliver UNKNOWN.

Timer/Stop/LED: HA ejer timerdeadline og alarmstatus; 1s UI-tick er kun visning.
Alarm, fysisk knap og voice-Stop samles i samme aktuelle alarm-/playbacktransaktion.
Ingen lokal ASR-fraseautoritet. Test Stop før started, samtidig voice/knap, sen alarm
efter cancel, gamle LED/playback-events efter rearm og cleanup/reconnect. Firmware
ændres kun ved en konkret firmware-RED og indgår da som særskilt pinned artifact.

## 7. Samtidige reads og brugbar central diagnose

Proven RED: to klienter med samme aktuelle home/targets-read kan give 200/429/200.
Lad samme-nøgle followers vente på den igangværende læsning i to eksisterende bridge-
completion slots med exact cachekey/sourcebinding. Bevar 8/10s bounds. Followers må
ikke annullere ejeren, starte en ny læsning eller låne dens adgang. Genvalidér egen
auth/rum/session/binding og brug normal cache samt per-controller lights/target-scope.
Selection/grants/mutations og forskellige nøgler/capacity-fences coalesces ikke.

Retention beholder 512 rækker/256KiB/7 dage. Routine kræver code start/ok/empty,
current ikke false, status absent/2xx og præcis en af: request med endpoint snapshot,
events,home,answers,music,source,weather-advice; music_read med absent/music; queue_read
med absent/music/queue/offer. Alle øvrige rækker har højere retentionprioritet.
Eviktér ældste routine først, derefter ældste øvrige. Ny appendbatch beskyttes indtil
første durable ACK; kan batchen ikke passe, fejler den uden ACK. Senere writes må eviktere.
Bevar fsync, dedupe, auth og monotont serverSeq med lovlige huller. Ingen evig loggaranti.

Brug eksisterende content-free diagnostics og faste årsags-/fasemarkører på manglende
ejergrænser. Ingen ny loggerplatform, rå nøgler, URLs, lyd, argumenter eller private
huslogs i public source. Upload-age/receive-order er ikke præcist eventur. Alle aktuelt
retained logs er læst; det er ikke alle historiske hændelser eller fuld actiondækning.

## 8. Historik, visuelle svar, covers, vejr og cache

F16: persistér kun allerede valideret `_archive_display`-snapshot som typet record i
eksisterende History. Bevar receiptId, tid, proveniens og content; dedup original-id;
20 pr. rum/64KiB pr. item plus eksisterende globale rolling-cap. Ændr den tidligere
bridge-lifetime-only-kontrakt eksplicit. Reload kun til autoriseret historical renderer,
aldrig current receipt/action-registry eller ny TTL. Clear/revoke/removal overlever
restart; diskfejl logges som ikke gemt. Legacy-fragmenter er ærligt mærket transcript,
ikke heuristisk færdiggjorte Live-svar. Test faktisk SDK → Thin → snapshot → disk →
restart → samme-rum-read → kanonisk JS samt malformed/stale/room/privacy-negativer.

AI-covers: passiv policy/cache-ledger → faktisk DTO → samme asset HTTP/decode. Statiske
Humør-billeder er ikke AI-Stemning-bevis. Weather-read og AI-advice har særskilt årsag/
fejlstatus; typed log i 89 beviser ikke, at oprindelig providerfejl er forklaret.
Genbrug eksisterende scoped weather/source singleflight/900s-friskhed, advice-, mood-
og durable content/policy/model/prompt-hash-artcache. UI-rerender må ikke regenerere AI,
forlænge source-TTL eller forny handlingsautoritet. Intet ekstra cacheprojekt.

## 9. PodView, robot og adgang

Bindende input fra PodView: `docs/qa-ui22/LEAD-PLAN-KNOWLEDGE-HANDOFF-20261025.md` og
hele eksisterende F01–F23-matrix i PodView-repoet. Ingen af de 23 krav erstattes af de
nyere arkitekturfund eller PC70/13. Produkt og bibliotek bruger samme kanoniske kit.

Frossen NEXT91: `/private/tmp/podview-remote-followup-next91-20261025-final`, handoff
`21e525d74210d2f74165e6ee5090309295be202bf501bfde7a65e24a722e1ed2`, manifest
`df1c208b549b88a263352d06ad0500446ca1b2b24e675683d2becb520e111ac7`.
Den reparerer accepted-MOVE passiv destination-observation og én queue-read ved ny URI.
Genbrug dens kausale regressioner; ved server-settlement fjernes kun klientkompensation
som faktisk er erstattet. Ingen genintroduktion af gammel matcher under fletningen.

Robotpakken `integration/robot-complete-20261025/` er bestilt til næste release.
Rebase servicepatch 87 → aktuelt 90/91 med hunks; merge kanonisk klient sammen med NEXT91.
LiveControl/transport/CSS overlapper: overskriv ikke hele filer og kopier ikke gammelt
bundle ovenpå nyere kode. Byg kombinerede assets én gang og returnér slutpins til PodView.
Inventér faktisk robot/dock entity/device/uniqueId/roller før tilbud; ingen grantudvidelse.
Medtag startvalg mode/sug/vand/rum/repeat, settings under tur, og støttede dock wash/
empty/dry start/stop. Korteditor/zoner, planer, per-rum-sekvenser og jobbundne terminal-
resultater er ikke leveret af pakken og må ikke fejlagtigt markeres færdige.

Bevar F07–F11 cover/sourcecopy/spinner/stabil geometri/feedback-slot, F12 sekunder,
F13–F14 vejr og F15 modal. Alle UI-ændringer får faktisk scoped Product Design/
Impeccable produkt- og biblioteksrenderreview; kliktest erstatter det ikke.

Kontrollér faktisk browser/server enroll/claim/renew/placement/revoke, room-change,
multitab, sleep/reconnect og boot. Gyldig durable grant må ikke kræve ny parring efter
normal readfejl. Revocation afviser sandt; fejl i én widget må ikke låse andre.

## 10. Recovery, måling, levering og rollback

MCP genbruger 1/2/5/10/30s-backoff, derefter højst ét forsøg/minut; direkte dialog
fortsætter under HA-udfald, og capability discovery genoprettes uden dobbelte sessioner.
Ingen lokal skyggesandhed. Mål #104 før #105/#106/#107: startup/input, meningsfuld fysisk
lyd og close/LED-off/ny wake. Optimer største dokumenterede flaskehals. Eksisterende
voice-mål p50/p90 1,2/1,8s simpelt, 1,5/2,5s lokalt værktøj bevares; earcon er ikke svar.
UI-inputfeedback, serviceaccept, frisk state og faktisk lyd måles hver for sig med
p50/p95/max og clockproveniens; fixturetiming er ikke et Green-løfte.

Planlagt næste bundle: PV **2.0.91**, Speakers **0.26.54**, Control **0.10.24**;
PV HA-komponent **0.1.7** med timer-bridge-rettelsen og nye pins.
Verificér at versionsnumre er ledige ved freeze; bind faktiske commits, trees,
rootfs/assets, komponentfiler, options/policy og data. Ét PR pr. berørt repo og én
officiel CI på hvert endeligt frossent træ. Focused kausal/adapter/static under udvikling;
genbrug uændrede checks/reviews. Independent adversarial review for high-risk delta.

Installation er ét koordineret vedligeholdelsesvindue, ikke ét image for alle dele:
1. Lås backup/kompatibilitetsmatrix og verificér offentlig OCI/alle relevante pins.
2. Vent på ingen aktive samtaler, timere/alarmer, robotjob eller effect-transaktioner.
   Eksisterende timere må ikke annulleres for at skabe vinduet.
3. Speakers først → Control/HACS-filer → PV/add-on og eventuelle HA-komponentfiler →
   én nødvendig HA Core-restart. Download eller options-reload er ikke hot-code-bevis.
4. Verificér faktisk kørende moduler, versioner, handlers og capabilities før aktivering
   af nye handlinger. Mixed versions giver finite unavailable/read-only, ingen bypass.
5. Kør faktiske passive Green/browserflows for read, adgang, kø, historik, vejr og
   robotforberedelse. Ingen audio-, volume-, alarm- eller robotkommando fra agent nu.

Rollback #113 testes versionsspecifikt isoleret. Backup gælder kompatibelt bundle,
ikke kun UI/image. Før første nye C-purpose-write er gammel rollback uændret. Efter
write må gammel C/Native ikke gendannes ensidigt, journal slettes eller UNKNOWN
opfindes clean. Nuværende nye par skal terminalisere egne ops, join writers og etablere
legacy-readable journal under eksisterende transaktion før parvis rollback. Kan det
ikke bevises, er rollback blokeret og fremadrettet recovery påkrævet. Ny History-record
skal have legacy-reader-kompatibilitetsprøve. Upgrade/reboot/downgrade før freeze.

## 11. Dækning, kanban og accept

Frisk audit ved planreview: **50 åbne issues, PV37 + PC13**, inklusive tre epics.

| Spor | Issue-dækning |
|---|---|
| Musik/Connect | PV118,174,237,239,241,111,187; PC6,8,9,10,11,12,13,29,51,53,58,70,71 |
| Voice/lifecycle | PV101,102,103,107,119,124,153,215,219,229 |
| Timer | PV110 |
| Diagnose | PV98 |
| Adgang/recovery/settings | PV109,113,175,184,193,197,115 desktop/Talk/accessibility |
| Hastighed | PV104,105,106,108 |
| Samlet accept | PV112,116; epics94,95,96 |
| Synligt udskudt | PV151 web, PV180 Frameo; kun mobil-delen af115; PC13 lang stationsfortsættelse efter brugerens pause |

PV102 er historisk/nedprioriteret sammenligning, ikke en lokal regnemotor. PC71 kræver
statusreconciliation for allerede leveret fixture, ikke en ny patch. Epics lukkes ikke
med resterende kriterier; udskudte emner må ikke få opdigtet Done-status.

F01/21 musik+arkitektur; F02–06/20 betjening/reads; F07–11 art/result/feedback;
F12 timer; F13–14 vejr; F15 settings; F16 historik; F17 visuelle svar; F18 voice;
F19 log; F22 samlet review/release/install; F23 lydløst agentarbejde. Bevar originale
feedbackhenvisninger og registrér kode, test, renderreview, installation og feltbevis særskilt.

Kanban: Backlog → In Progress → In Review → Ready for QA → Done; Blocked med ejer,
konkret manglende artefakt og næste handling. Ready for QA kræver integreret og
softwareverificeret kode; ikke blot patch, grøn lokal unit-test eller plan-score.
Ingen kendt softwarefejl skubbes til fysisk test. Done følger faktisk issueaccept.

Softwaregates dækker forsinket/afvist/UNKNOWN, expiry, late events, naturligt sangskift,
Spotify-appændringer, hurtige klik/volumendrag, samme/ny route, multiklient, nettab og boot.
Actual HA/MCP/entity → fælles ejer og touch undersøges samlet, ikke kun mocked helper.

Én senere autoriseret fysisk serie: actual Connect/PV-start og lyd; Connect før Play
og omvendt; pause/resume/next/previous/volumen/mute/seek efter capability; præcis kø/
duplikater og output/move/disconnect/reconnect;
tre start/output/reconnect-cyklusser. Lang stationsfortsættelse over sidegrænser
afventer særskilt genoptagelse og indgår ikke i denne accept. Voice PE svar/opfølgning/afbrydelse/semantisk og
idle-close/LED/teardown/rearm/ny wake; 10s timeralarm, voice-Stop og fysisk knap/LED.
Stop ved første fejl, undersøg første tabende kant; ingen blind effekt- eller bred testsuite-gentagelse.

Ingen automatisk fysisk robotprøve. Den korte serie erstatter ikke 10/10 lifecycle,
fuld funktionsmatrix112, fysisk latens eller syvdøgns samme-artifact-soak116. De er
separate acceptfaser, ikke syv dages kodearbejde. Plan-score er aldrig produktaccept.

## Final delivery addition — user request 26 October

After combined product integration, review, publication and installation, republish the existing GPT Sites product preview and full UI library from exactly the same accepted canonical UI source. Preserve existing Site identity, audience and stable links. This is a final delivery task, not a new design branch or physical acceptance claim. PodView owns canonical UI composition and supplies existing Site/library identity; root coordinates verified delivery. Do not publish a newer or partial UI ahead of the actual product release.

## Natural affirmation clarification — direct user decision 26 October

Brief natural Ja and Hmm are permitted, including before a real delegated action, without claiming success. Repetitive generic Modtaget/progress replies remain excluded. This widens only the delivery-style criterion; immediate real delegation, truthful owed results and current accepted END authority remain unchanged. Source paragraph and existing tests are aligned after independent review. Earlier recorded provider observations keep their original stricter-prompt identity; raw FAIL reports are immutable. Functional observations may be reused with explicit provenance; this policy change alone neither proves five new-prompt provider cases nor justifies blindly repeating all earlier calls.
