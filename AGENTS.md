# PodVoice agentkontrakt

Denne fil er indgangen for alle mennesker og agenter. Den forhindrer, at historiske
spor, grønne deltests eller plausible lydhypoteser bliver til en ny produktionsretning.

## Læs i denne rækkefølge

1. `docs/STATUS.md` — hvad der fysisk er bevist lige nu.
2. `docs/INVARIANTER.md` — den bindende tværgående systemkontrakt.
3. `docs/PRODUKTMÅL.md` — gates og målbare acceptkrav.
4. `docs/ARKITEKTUR.md` — forklaring af den ene produktionsvej.

`PLAN.md`, `docs/PLAN-BEAT-GEMINI.md`, `docs/PLAN-DUPLEX.md` og
`docs/HANDOVER-v2.md` er historiske research-/handoverfiler. De må bruges som baggrund,
men aldrig som autoritet over de fire filer ovenfor.

## Hurtig standardcyklus

Lokale gates må ikke køres fra Documents, Desktop, iCloud, OneDrive eller anden
synkroniseret storage. Brug én vedvarende usynkroniseret dev-clone og en ekstern Python
3.12-venv; det langsomme workspace må kun være redigerings-/handoverflade. De tre
autoritative kommandoer er:

```sh
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev fast --base origin/main
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev lifecycle --base origin/main
PODVOICE_PYTHON=/absolut/sti/til/python scripts/dev release --base origin/main
```

Kør `fast` under udvikling, `lifecycle` kun når dens mekaniske scope dækker hele diffet,
og `release` præcis én gang efter diff-freeze og det review, ændringen kræver. Derefter
ét PR/merge-flow uden manuelle CI-genkørsler og én installation af den grønne main-
artifact. SafeEval/preflight må kun tilføjes, når ændringen berører prompt, schema,
værktøjer eller Realtime-semantik.

En timeout, sandboxfejl eller flaky test er ikke produktevidens og må ikke udløse en
runtime-patch. Isolér årsagen én gang; ret workflowet eller testens observerede
slutbetingelse separat, og genkør kun den gate, som fejlen faktisk ugyldiggjorde. Hvis
samme procesforsinkelse gentager sig, er næste handling en permanent tooling-regression,
ikke endnu en manuel workaround.

En sendt provider-control-event er aldrig i sig selv bevis for sin påståede effekt.
Ved `clear`, `commit`, `delete`, `cancel`, `truncate` og `response.create` skal
regressionen fortsætte gennem de efterfølgende korrelerede serverevents og bevise den
tilstand, som runtime bygger videre på. En fake, der kun tæller outbound-kaldet, kan
ikke godkende ejergrænsen.

## Den eneste produktionsretning

- Voice PE-firmware ejer fysisk wake, mic-latch, playback-events og rearm-bevis.
- `VoicePELink` er den eneste native-API-adapter.
- `ThinSession` er den eneste runtime-samtalemotor for Voice PE og Talk.
- OpenAI Realtime ejer sprog, turforståelse, værktøjsvalg og semantisk afslutning.
- Voice PE er half-duplex og bruger FLAC-announcement. Talk er en separat browser-I/O-
  overflade og må ikke bruges som fysisk bevis for pucken.
- PodVoice ejer kun mekanikken: mic-gate, værktøjsdispatch, fysisk playback, én teardown
  og én rearm. Lokale fraser eller ASR-aliaser må ikke eje samtalens betydning.

Classic (`orchestrator.py`, `state.py`, `gatekeeper.py`, `watchdog.py`) og direct PCM er
karantæneret legacy/regressionskode. De må ikke importeres af add-on-builderen, aktiveres
af settings eller udvikles som parallel produktionsvej. En ændring dér skal enten fjerne
legacy eller bevare en historisk regression; den må ikke introducere ny produktlogik.

## Bindende samtaleloop

Al runtime-, firmware-, test- og UI-udvikling skal bevare præcis denne ene kæde:

```text
IDLE
  → fysisk “Okay Nabu”
LISTENING
  → speech_stopped
THINKING
  → fysisk playback_started
AI_SPEAKING
  → fysisk playback_finished + ekkohale
LOUNGE_WINDOW
  → opfølgning i samme Realtime-session → THINKING → AI_SPEAKING → LOUNGE_WINDOW
  → Realtime end_conversation eller fire sekunders fysisk stilhed
CLOSING
  → præcis én teardown → korreleret firmware-rearm
IDLE
```

`CLOSING` er navnet på den ene close-transaction, ikke en sjette `State`; de eneste
runtime-stateværdier er fortsat de fem produktstates.

Fire sekunders timeout betyder ubrudt fysisk stilhed i en åben lyttefase. En accepteret
`speech_started` annullerer straks idle-deadlinen indtil matching `speech_stopped`;
idle-close må atomisk genkontrollere, at state fortsat er `LISTENING` eller
`LOUNGE_WINDOW`, og at ingen brugertale er aktiv. Timeout må aldrig lukke i `THINKING`,
`AI_SPEAKING`, en værktøjsrunde eller et åbent start→stop-interval. Regressionen skal
krydse den virkelige deadline med begge VAD-kanter, ikke springe direkte til stop.

`State` er den eneste half-duplex mic-gate for Voice PE: kun `LISTENING` og
`LOUNGE_WINDOW` må sende fysisk lyd til Realtime. Talk kan være full-duplex gennem samme
`ThinSession`, men beviser ikke puckens lydvej. Én synkron audio-generation-grænse må
kun skæres ved første gyldige `speech_stopped`, efter den aktuelle playback-leases
fysiske finish plus ekkohale, og ved exact korreleret rearm-ACK. Der skæres aldrig ved
wake, fordi same-breath-prefix skal bevares.

LED er feedback på samme kæde, ikke en anden state machine: bright cyan ved
`LISTENING`, amber ved `THINKING`, green først ved fysisk `playback_started`, dim cyan
ved `LOUNGE_WINDOW` og slukket efter fuld teardown. Fejlet fysisk stop/rearm skal vises
som fault, ikke falsk mørk readiness. Firmware ejer wake-latch, mic-forward,
playback-events og rearm-bevis; add-onen sender kun LED-kommandoen for den aktuelle
`ThinSession`-state.

Enhver løsning med ny session per tur, lokal frase-/matematik-/semantikmotor,
obligatorisk fortsættelsesværktøj, parallel runtime, wake-cut, timer-ejet turafslutning
eller uobserveret firmware/gain/VAD/prompt-tuning er modstridende og må ikke merges.

## Ord med præcis betydning

- **Første virkende version:** mindst én frisk fysisk golden chain har bevist wake →
  første svar → opfølgning → modelsemantisk lukning → fysisk farvel → teardown/rearm →
  ny wake. Den milepæl er opnået af v1.13.11 og registreret i `docs/STATUS.md`.
- **Lifecycle release-godkendt:** samme kandidat har bestået 10/10 automatiske og 10/10
  ubrudte fysiske cyklusser. Ikke det samme som “første virkende version”.
- **Produktmålet nået:** funktions-, latens-, stabilitets- og benchmark-gates i
  `docs/PRODUKTMÅL.md` er bestået. Må aldrig udledes af én vellykket samtale.

## Lead review og beslutningsejerskab

Ethvert ikke-trivielt ændringssæt har præcis én **Lead Voice/Reliability Engineer** som
teknisk beslutningsejer. Lead samler forslag fra mennesker og agenter til én retning,
kontrollerer den mod de fire autoritative dokumenter og kan stoppe arbejdet. Flere
agenter er reviewere, ikke parallelle arkitekturmyndigheder; flertalsafstemning eller en
grøn deltest kan ikke tilsidesætte leadens krav om sammenhængende bevis.

Før kodeændringer i runtime, lifecycle, Realtime, værktøjskontrakt, lyd, prompt,
firmware eller release skal lead oprette en kort aktiv beslutningspost i
`docs/STATUS.md` med:

- observeret fejl og stærkeste direkte evidens;
- hele berørte kæde fra fysisk input til næste wake samt nærliggende races/fejlveje;
- berørte invarianter, én falsificerbar årsagshypotese og eksplicitte ikke-mål;
- planlagte regressioner, sammensatte gates og rollback-grænse.

Efter ændringen opdaterer lead samme post med faktisk ændring, resultater, afvigelser,
resterende usikkerhed og kandidatens præcise fysiske gate-status. En plan eller
forventning må aldrig stå som et resultat. `docs/STATUS.md` er den vedvarende log for den
aktive beslutning; opret ikke en ny konkurrerende agent-, plan- eller statusfil.
Lead vedligeholder `AGENTS.md`, når en hændelse afslører et varigt hul i selve
arbejdskontrakten. Kandidatstatus og enkelthypoteser hører kun hjemme i
`docs/STATUS.md`, så agentindgangen forbliver kort og stabil.

De samme risikofyldte ændringer kræver en **uafhængig adversarial review** fra en anden
agent eller person før merge/release. Revieweren skal forsøge at modbevise årsagen og
kontrollere mindst: ejerskab, eventrækkefølge, stale/duplicate/out-of-order-events,
timeout/fejl/teardown/rearm, den modsatte I/O-adapter og om testen faktisk rammer de
shippede bits. Implementøren må ikke godkende sit eget review. Rene stave-/docsændringer
og isolerede tests uden produktionsadfærd kræver ikke særskilt reviewer eller
beslutningspost.

### Bevisrangorden og stop-the-line

Ved modstrid gælder stærkeste direkte bevis for den samme kandidat og samme påstand:

1. fysisk Voice PE-trace med device-/provider-/speakerlyd og korrelerede firmwareevents;
2. sammensat test af den shippede add-on/firmware og rigtig provider/protokol;
3. rigtig Talk/Thin-integration og sikker live Realtime-eval;
4. deterministiske integration-, unit-, kontrakt- og statiske tests;
5. transcript, UI, loguddrag, hypotese eller plausibel forklaring uden den fulde kæde.

Et lavere lag kan finde fejl og stoppe en kandidat, men kan aldrig bortforklare en fejl
fra et højere lag eller bevise fysisk funktion. Et tilfældigt korrekt svar beviser ikke
input, værktøjsvalg eller lifecycle.

Lead skal stoppe ændring/release og markere kandidaten **ikke testklar**, når evidens
modsiger hypotesen, en invariant ikke kan bevises, en nærliggende race er uafklaret,
reviewet har en uløst alvorlig finding, eller test/kode/config ikke er samme bits som
kandidaten. Der må ikke patches videre på næste symptom, før den samlede eventkæde og
årsagsgrænse er opdateret. Kun `docs/PRODUKTMÅL.md` kan definere hvilke gates der åbner
igen.

## Obligatorisk ændringskontrol

Før ændringer i arkitektur, Realtime, VAD, lyd, firmware eller lifecycle:

1. Navngiv de berørte invarianter.
2. Bevar én samlet half-duplex-kæde; optimer ikke én komponent på bekostning af den
   fysiske eventrækkefølge.
3. Omsæt hver fysisk fejl til en permanent regression med den observerede kausale
   eventrækkefølge. Ved generation-/release-/stale-callback-risiko skal testen injicere
   en forsinket event efter grænsen og bevise, at den ikke krydser næste generation.
4. Test både den fælles `ThinSession`-kontrakt og den relevante I/O-adapter.
5. Kald aldrig en kandidat testklar eller færdig alene på komponenttests, Talk eller CI.
6. Opdatér `docs/STATUS.md` ved ny fysisk evidens. Overskriv aldrig en bevist baseline
   med en ny kandidat, før den nye kandidat selv har bestået den relevante fysiske gate.
7. Godkend aldrig en golden chain alene fordi svaret tilfældigvis var korrekt. Den kendte
   testytring og det observerede input skal være semantisk konsistente. Et tomt eller
   tydeligt afvigende input kræver gennemlytning af både device- og provider-sporet og
   tæller som fejl/ukendt, indtil lydkæden er forklaret. Et heldigt tool-kald er ikke
   bevis for stabil hørelse.
8. Ret den mindste ejergrænse uden samtidige tuninger eller nye abstraktioner. Kør først
   målrettet regression og relevant adapter, derefter tidligere feltregressioner og én
   fuld releasegate på det frosne diff. SafeEval køres kun ved ændret prompt, schema,
   værktøjer eller Realtime-semantik.
9. Rollback og byteidentitet arver aldrig “golden” eller “stabil”; kandidaten skal bestå
   alle senere feltregressioner. Stabilitet kræver samme artifact 10/10 ubrudt.

Før implementering skal lead desuden gennemgå hele den kausale kæde og mindst ét trin på
hver side af den mistænkte fejl. En lokal rettelse er ugyldig, hvis den blot flytter
ejerskab, timing eller fejl til mic-gate, provider, tool-round, playback, teardown eller
rearm. Efter implementering gentages gennemgangen mod det faktiske diff og reviewerens
adversarial findings.

Gain, VAD, bip, prompt og timeouts må kun ændres på baggrund af en trace eller en på
forhånd defineret måling. Tænke-lyd, duplex og barge-in er selvstændige gatede features;
de må ikke kobles ind i den virkende half-duplex-kæde som en uobserveret bivirkning.

## Bindende udviklingsprioritet

Når den aktive kandidat har bestået golden chain og 10/10 fysisk lifecycle, er næste
arbejde i denne rækkefølge:

1. **Udviklingsprioritet 1 — oplevet fysisk svartid.** Mål
   `speech_stopped → playback_started`, del kæden op og
   optimer den største dokumenterede flaskehals én ad gangen. Første lyd skal være
   meningsfuld tale; et earcon eller en generisk værktøjspreamble tæller ikke som svar.
   Målet er p50 ≤ 1,2 s for enkle ture og et stretchmål så tæt på 1,0 s som muligt uden
   at bryde forståelse, værktøjer, playback-sandhed eller lifecycle.
2. **Udviklingsprioritet 2 — diskret modtaget-signal.** Først efter latency-gaten må et
   ca. 80 ms firmwarelokalt signal ved `UserSpeechStopped` udvikles som en isoleret
   mixer-sidekanal. Det må ikke bruge announcement-vejen, forsinke Realtime eller eje
   nogen samtaletilstand.
3. **Udviklingsprioritet 3 — automatisk HA/MCP-recovery.** Hjem og vejr skal selv komme
   tilbage efter tabt HA/MCP-forbindelse uden manuel reload, add-on-genstart eller tab
   af en aktiv Realtime-samtale.
4. **Udviklingsprioritet 4 — fysisk funktionsmatrix.** Dansk, hjem, vejr, web, musik,
   timere og opfølgninger skal bestå de målbare antal i `docs/PRODUKTMÅL.md`.
5. **Udviklingsprioritet 5 — samlet UI-gennemgang.** Panelet skal vise sand readiness,
   fejl og næste handling, fungere på mobil/HA-app/desktop og bestå de definerede
   accessibility-, Talk-, settings- og browsergates.

Ingen agent må bruge feedbacksignalet til at maskere langsomhed eller udvikle prioritet
1 og 2 i samme kandidat. En UI-ændring må ikke ændre samtalens lifecycle som en skjult
bivirkning. De fulde gates står i `docs/PRODUKTMÅL.md`, og den aktuelle rækkefølge står
i `docs/STATUS.md`.
