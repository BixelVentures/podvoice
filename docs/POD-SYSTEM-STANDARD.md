# Pod System Engineering Standard v1

Vedtaget af brugeren 27. oktober 2026 for PodVoice, PodView og PodConnect.
Kanonisk specifikation: `BixelVentures/podvoice:docs/POD-SYSTEM-STANDARD.md`.
Vedligeholder: PodVoice-integrationslead. Projektets eksisterende sikkerheds-,
review-, arkitektur- og releasegrænser bevares. Aktuel kandidat og resultater findes
fortsat i eksisterende STATUS-/feedbackposter; denne fil er ingen ny statuslog.

## De fem bindende krav

1. **Hele brugeroplevelsen.** Beskriv input → valideret handling → faktisk service/
   enhed → observeret resultat → synlig/hørbar feedback → fejl/recovery. Inspicér
   den aktive kilde, kontrakter, eksisterende tests og naboejere før implementation.
   Tag konventionelle handlinger og tilstande med uden at kræve, at brugeren opremser
   dem. Manglende integration er et leverancegap, ikke en tavs scopeindskrænkning.
   Nye hardware-/adgangsegenskaber kræver stadig deres faktiske kontrakt og gates.
2. **Samme funktion fra stemme og touch.** Brug én autoritativ ejer pr. domæne og
   de eksisterende handlinger/identiteter. UI må ikke have sin egen enhedssandhed.
   Pending intention, accepteret kommando og bekræftet effekt er forskellige.
   UNKNOWN må aldrig automatisk gensendes. Ingen ny global state-service,
   command-bus, musikmotor eller konkurrerende lifecycle-ejer.
3. **Autonom softwareverifikation.** Agenten ejer softwaretest, browserkontrol og
   fejlsøgning. Genbrug eksisterende miljø og harnesses; ret observerede årsager og
   tilføj kausal regression, hvor praktisk muligt. Prøv det samlede berørte flow og
   de relevante naboveje. Bevar beståede checks på uændrede bits. Fysisk fravær må
   ikke stoppe uafhængigt softwarearbejde. Brugeren er ikke primær softwaretester.
4. **Verificeret oplevelse før færdigmelding.** Registrér unit/kontrakt, sammensat
   integration, rigtig browser, rigtig service og fysisk hardware særskilt med
   bestået/fejlet/blokeret/ikke kørt og konkrete inerte afhængigheder. Aflever ændring,
   faktisk evidens, rester og brugsklarhed. Kode, publicering, installation og fysisk
   accept er særskilte resultater. Et åbent nødvendigt bevis betyder åben accept.
5. **Permanent på tværs.** Hvert projekts AGENTS indeholder den bindende kerne og en
   repository-reference til denne specifikation på den aftalte revision. Ved arbejde
   på tværs skal den aktive kandidat kunne findes uden antagelser om en bestemt Mac,
   sibling-mappe eller midlertidig klon. Mini genbruger senere samme kontrakter.

Kravene gælder alle relevante Pod-opgaver. Musik er første sammensatte acceptflow,
ikke en indsnævring af reglerne til musik. En lokal rettelse kræver kun berørt flow
og relevante regressioner; uændrede domæner kræver ikke en ny fuld systemgate.

## Agentens faste udførelsescyklus

For hver meningsfuld ændring, i det eksisterende miljø og inden for gældende adgang:

1. Inspicér faktisk implementation, kontrakter, kaldesteder og berørte naboejere.
2. Beskriv forventede brugerrejser, tilstandsskift og fejl/recovery før rettelsen.
3. Implementér vertikalt: input, valideret handling, state/events, service/enhed,
   observerbar feedback og recovery. Ingen dekorative kontroller.
4. Start nødvendige lokale services til prøven. Brug allerede autoriserede rigtige
   integrationer; en ny fysisk prøve, installation eller providergrænse kræver fortsat
   sin faktiske adgang. Manglende adgang angives præcist, mens uafhængigt arbejde fortsætter.
5. Kør relevante statiske kontroller og automatiske integration-/regressionstests.
6. Brug rigtig browserautomation til den berørte faktiske UI-rejse, hvor tilgængelig;
   inspicér renderet resultat og faktisk klik/touch, ikke alene DOM-erstatninger.
7. Inspicér relevante servicelogs, browserkonsol, netværksfejl og applikations-/enhedsstate.
8. Ret den første dokumenterede årsag, ikke næste symptom eller en kosmetisk kompensation.
9. Gentest det ændrede/ugyldiggjorte flow og relevante regressioner; genbrug øvrige PASS.
10. Fortsæt fejlsøgning inden for budgettet. Bevar fejlede resultater og navngiv en reel
    blokering, ejer og næste handling; tavs succes eller en logget fejl er ingen afslutning.

Alle fejlveje i det berørte flow skal kunne diagnosticeres i eksisterende ejerlogs:
afvisning, timeout, exception, UNKNOWN og fejlet recovery. Brug faste trin-/årsags-/
udfaldskoder og eksisterende sikker request-/operationkorrelation, hvor tilgængelig.
En samlet busy-kode må ikke skjule forskellige ejere, når forskellen afgør rettelsen.
Logning må ikke ændre produktudfald eller vise nøgler, rå payloads eller persondata;
rutinemæssige succesfulde poll-kald må ikke drukne fejl. Kravet betyder ikke optagelse
af al tale eller fuldt privat indhold, og ingen ny logplatform indføres.

Brug eksisterende service-/enhedsobservation som orakel uafhængigt af UI. En fixture,
der annoncerer en handling uden at kunne udføre dens forfattede effekt, er selv en
fixturefejl og må ikke give browseraccept. Den må heller ikke blive til en runtimepatch.

## Ejere og fælles kontrakt

```text
PodVoice: tale ─┐                         ┌─ service-/enhedens faktiske tilstand
               ├─ eksisterende ejer ────┤
PodView: touch ─┘                         └─ bekræftet observation → begge flader
```

| Domæne | Autoritativ ejer | Fladernes opgave |
|---|---|---|
| Samtalebetydning | Aktiv GPT-Live/providervej | Input og korrekt præsentation |
| Session/lifecycle | ThinSession; fysisk I/O via VoicePELink/firmware | Vis observeret status; skab ikke parallel lifecycle |
| Musik, kø, output og volumen | Eksisterende PodConnect Control/Native/lydvej | Stemme og touch bruger samme mål og udførelsesejer |
| Audio focus/ducking | Eksisterende attention-/outputejere | Senere pause/volumenvalg respekteres ved release |
| Timere | Eksisterende HA-timerejer | Samme timer-ID, deadline, cancel og alarm-ack |
| Hjemmeenheder | HA og faktisk integration/enhed | Vis observeret tilstand, ikke alene ønsket handling |
| UI og bevægelse | PodViews kanoniske komponentbibliotek | Samme renderer, states og tokens i bibliotek og produkt |

Eksisterende action-/event-/statekontrakter bevares. Følg deres konto, rum, mål,
ejer, session/tur, request/operation og revision/generation, hvor kontrakten udstiller
dem. Manglende korrelation er et konkret kontraktgap; ingen opdigtet global ID-kæde.
`music.play` og lignende er adfærdsnavne, ikke beslutning om nye wire-API'er.

Fælles kontrakt betyder konsistent ejerskab, ikke én global tilstandsservice.
Forbindelse, readiness, pending og observeret resultat skal kunne skelnes. Bevar
sand tom, venter, unavailable, fejl og sidst kendt tilstand. UI-komponentens eksistens
beviser ingen integration. Ændret UI følger fortsat PodViews browser-, visuelle og
Product Design-/Impeccable-krav. Den aktive adapter-/audio-policy bestemmer duplex og
afbrydelser; standarden åbner ingen ny barge-in- eller lydfunktion.

## Fuld funktions- og acceptmatrix fra det oprindelige input

Dette er bindende forventet adfærd, ikke påstand om allerede implementeret/testet
funktion. Manglende kapabilitet registreres med ejer og næste handling i eksisterende
issue/status; den må ikke skjules som bestået eller fjernes fra scope uden produktbeslutning.

| Område | Hvad skal prøves samlet? |
|---|---|
| Wakeword | Den faktisk konfigurerede Hey Chat/wake-model åbner én korrekt samtale; fysisk wake/inputbevis holdes særskilt |
| GPT-Live/samtale | Dansk input/svar, room context, opfølgning i samme samtale, understøttet afbrydelse/Stop, semantisk afslutning og næste wake |
| PodView | Faktisk samtalestatus og relevant widget følger ejerens events; touch virker, motion følger reelle hændelser, og reconnect må ikke vise falsk readiness |
| Musik | Play/pause/resume, next/previous, seek/progress, volumen/mute, metadata/artwork, loading/buffering/error samt fælles voice/touch-styring |
| PodConnect/audio | Rigtigt output og routing, track-/køstatus, ekstern Spotify-ændring, duck under samtale og recovery efter audio-policy; senere touchvalg respekteres |
| Timere | Stemmeoprettelse → samme timer-ID/deadline i PodView → synkron nedtælling → touch-cancel/stop/alarm-ack → faktisk terminal status |
| Home Assistant | Stemmehandling → faktisk observeret enhedsændring → korrekt PodView-state; fejl/rejection må ikke vises som gennemført |
| Robusthed | Berørt servicegenstart, net-/provider-/HA-tab, stale events og reconnect → ærlig fejltilstand → frisk recovery uden dobbelt effekt eller replay |
| PodView Mini | Fremtidig flade til samme state/event/action-kontrakter; ingen genimplementation af domæneejerskab |

Konkrete tværgående forløb ud over musik:

- **Stemme → timer → skærm → touch:** opret kendt varighed, observer samme ID/deadline,
  kontrollér nedtælling mod ejerens tid, annullér/stop fra UI og bekræft den faktiske
  ejers terminalstatus. Efterfølgende stemmestatus må ikke genoplive timeren.
- **Stemme → HA → skærm:** valider mål/adgang, udfør handling, læs faktisk enhedsstate
  og kontrollér matchende UI. En service-ACK er ikke alene fysisk enhedsbevis.
- **Musik → samtale → musik:** start musik, wake/understøttet afbrydelse, observer
  korrekt audio focus/duck, dansk samtale og afslutning, og bekræft recovery til den
  policy, der nu gælder. Et senere pause-/volumenvalg må ikke overskrives af restore.
- **Tab → recovery:** afbryd den relevante forbindelse i eksisterende inert harness,
  kontrollér synlig fejl/pending/sidst kendt state, genetablér og læs frisk autoritativ
  status. Gamle callbacks/kommandoer må ikke krydse ny generation. Rigtig restart/
  hardwareadfærd er særskilt test, ikke automatisk tilladt af en simulationsprøve.

Hver prøve kontrollerer både underliggende funktion og det synlige/hørbare resultat
på det bevisniveau, der påstås. En API-test uden browser dækker kun sin API-kant.

## Første sammensatte musikaccept

**Kendt tale → afspil → vis → touch-pause → verificér samme output.**

| Trin | Krav | Bevisgrænse |
|---|---|---|
| Tal | Kendt input vælger indhold og aktuelt autoriseret output | Typed/tool-fixture beviser ikke tale, wake eller rigtig AI |
| Afspil | Eksisterende content-ejer udfører én start | Dispatch/accept er ikke faktisk lyd |
| Vis | Frisk observation giver rigtigt track, output og state i kanonisk player | UI er ikke sit eget serviceorakel |
| Pause | Faktisk touch-pause bruger samme Connect-ejer | Ingen parallel fallback eller replay ved UNKNOWN |
| Verificér | Korreleret settlement og frisk paused-state fra samme ejer/output | Hørbar stilhed kræver fysisk observation |

Før accept bindes resultater til samme konkrete kombination af Voice/backend-kilde
eller artifact, PodView-assetmanifest, Control, Speakers, relevant firmware og
effektive kontrakter. Dirty source kræver hash/manifest af faktiske bits; base-SHA
og versionsnumre alene beviser ikke identitet. Brug eksisterende evidenskvittering
og statuspost. Genkontrollér identitet ved publicering og installation.

Genbrug eksisterende tests i de aktive kloner:

- PodVoice: faktisk ToolRouter, PodViewBridge, musikfacade og observation gennem
  eksisterende integrationsharness; inert servicegrænse skal navngives.
- PodConnect: eksisterende `tests/ha_framework/test_media_player_native_owner.py`
  dækker HA/touch-ejerparitet; `tests/test_*.py` dækker service-/observationsejere.
  Pinned HA/Native-protokolprøver er softwarebevis, ikke HomePod-lyd.
- PodView: kanoniske player-/control-/observationstests og den eksisterende
  `scripts/music-remote-night-fixture.mjs` til rigtig browser med inert backend.
  DOM-erstatning er kontrakttest; rigtig browser med fake backend er browserbevis.

En samling grønne deltests kaldes ikke hele kædens E2E. Registrér præcis hvilke
kanter samme prøve faktisk udfører, og hvilke der stadig mangler. Et forbedret
harness lukker ikke en allerede åben musikregression.

Nødvendige berørte regressioner: duplicate/dobbeltklik, stale/udskiftet ejer,
forsinket svar efter reconnect, UNKNOWN uden replay, ekstern Spotify-ændring og
readfejl uden falsk idle. Senere touch-pause eller manuel volumen må ikke overskrives
af attention-release. Musik skal fortsætte med PodView lukket. Vent på observeret
slutbetingelse under eksisterende kontraktdeadline, ikke faste sleeps.

Efter softwarearbejdet samles én kort autoriseret fysisk serie: wake+kendt tale,
hørbar musik på valgt output, touch-pause, duck/restore efter faktisk policy,
samtaleslut og næste wake. Eksisterende golden-/lifecycle-/produktgates bevares.
Play/pause/resume/next/previous/seek/volumen/mute, metadata/artwork/progress,
loading/buffering/error, ekstern synkronisering, kø/EOF og recovery forbliver fuld
musikaccept; denne første prøve lukker kun sit afgrænsede flow.

## Indarbejdelse i eksisterende arbejde

PodVoice-lead ejer integration; PodView ejer UI; PodConnect ejer musik/output.
Hver opgave har fortsat én ansvarlig ejer og én næste handling i eksisterende post.
Knyt input, forventet faktisk effekt, UI-feedback, fejl/recovery og bevisniveau til
opgavens eksisterende acceptkrav. Opret ingen parallel backlog eller statusplatform.

Brug eksisterende fast-/CI-kommandoer. Nye integrationsregressioner i de almindelige
testmapper følger deres eksisterende discovery; ændr kun CI ved et påvist coveragegap.
Rene instruktioner og docs kræver link-/diffkontrol, ikke bred runtime-releasegate.
Merge/publicering/installation følger gældende konkrete godkendelser og review.
Indførelse af standarden er ikke i sig selv bestået produktaccept.

## Definition of Done og aflevering

En feature er først færdig, når forventet adfærd er implementeret, relevante samlede
prøver består, UI-kontroller udfører rigtige handlinger, observeret state matcher
service/enhed, relevante fejl/recovery håndteres, og eksisterende kritisk funktion
fortsat består. Alle nødvendige uverificerede afhængigheder står eksplicit åbne.
En dokumenteret blokering er en ærlig handover, ikke en bestået feature.

Slutrapporten skal besvare fem konkrete punkter:

1. Hvad er implementeret?
2. Hvad er faktisk testet, og hvilke afhængigheder var inerte?
3. Hvilket bevis viser det forventede resultat?
4. Hvilke fejl eller uverificerede forhold står tilbage, med ejer/næste handling?
5. Er funktionen klar til faktisk brug, og til hvilken afgrænset brug?

Brugeren ejer produktintention og produktbeslutninger. Agenten ejer den nødvendige
softwarefejlsøgning, testudførelse og QA; kun reelt fysiske/ikke observerbare kanter
eller nødvendige beslutninger lægges hos brugeren.
