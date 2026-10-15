# Detaljerede agentkrav

> V2.x-retningen er kun GPT-Live med full duplex, præciseret af brugeren 15/10.
> V1.x-half-duplex er historisk, ikke produktionskrav. Kontinuerlig Live-input under
> svar er tilsigtet. OpenAI Realtime-wirekrav gælder alene den beholdte diagnostik/
> regression; de må ikke blive GPT-Live-gates eller begrunde lukning af aktiv Live-mic.

Disse krav gælder ved de risikofyldte opgavetyper, der er angivet i
[AGENTS.md](../AGENTS.md). Læs kun de sektioner, som matcher arbejdet; de fire
produktdokumenter er autoritative for runtime-retning og gates.

Før freeze skal ændrede signaturer, callbacks og admission-grænser spores gennem
alle berørte kaldesteder, wrappers og testfixtures. Ret disse i samme ændringssæt,
så en forældet fixture ikke først opdages efter en lang samlet gate.

Dokumentationsændringer og isolerede fixture-rettelser udløser kun relevante
statiske/fokuserede kontroller. Genkør ikke en hel lokal releasegate eller manuel CI
på grund af dem. Den obligatoriske officielle CI køres på den endelige kandidat;
lokal bred kontrol tilføjes kun ved en konkret fejl eller nødvendigt offline arbejde.

Testopsætning er et middel til at levere issue-rettelsen. Genbrug eksisterende
harness og den mindst mulige adapter; lad ikke et reparationsforløb vokse til et
selvstændigt testprodukt. En fejlet prøve bevares som fejlet, og test-/providerbevis,
udgivelse, installation og fysisk accept beskrives hver for sig.

Ved pause: gem det konkrete igangværende arbejde og angiv åbne issues med status
**planlagt build**, **udgivet/afventer test** eller **ingen version aftalt**.
Hvis brugeren præciserer, at den igangværende udgivelse skal færdiggøres før pausen,
færdiggøres den afgrænsede levering uden at starte nye forbedringsspor.

## Hurtig standardcyklus

Lokale gates må ikke køres fra Documents, Desktop, iCloud, OneDrive eller anden
synkroniseret storage. Brug én vedvarende usynkroniseret dev-clone og en ekstern Python
3.12-venv; det langsomme workspace må kun være redigerings-/handoverflade. Kommandoer
og valg af udviklingskontrol står i [UDVIKLINGSFLOW](UDVIKLINGSFLOW.md).

Normalcyklus: ret årsagen → kør den berørte regression med `fast --test` → ét
fokuseret review → push til én samlet PR. Flaget kan gentages med flere pytest-noder;
det bevarer statiske checks og er kun delvis udviklingsfeedback. Genkør ikke beståede
checks på uændrede filer. Browser og fuld testsuite køres i officiel CI én gang på det
frosne ændringssæt; lokal `release` bruges kun til konkret CI-fejl eller offline arbejde.
Kør én scopekontrol mod aktuel main ved freeze, ikke ved hver lille iteration.
`lifecycle` bruges kun, når dens mekaniske scope dækker hele diffet. Derefter ét
merge-flow og én installation af grøn main. Fokuseret preflight af den faktiske GPT-Live-vej bruges kun ved ændret prompt,
schema, værktøjer eller GPT-Live-semantik. Realtime-SafeEval beviser kun sin egen
diagnostik/sammenligning, aldrig GPT-Live-semantik; se EVALUERING.md. Fysisk afprøvning samles i én serie.

En WIP-base beviser kun sit eget source-delta. Før merge/release skal hele kandidaten
bindes og scopekontrolleres mod aktuel main; sammensatte ejergrænser kræver en præcis,
uafhængigt reviewet profil. Skift ikke base eller en generisk klassifikation for at
få den samme release til at passere. Repoet er public: hent almindelig Git-ancestry
via HTTPS uden credentials og uden checkout/reset, før manuel GitData-rekonstruktion
overvejes. Gamle lokale auth-fejl er ikke en produktfejl.

`fast` cacher kun stabile preflightdele og kører berørte statiske checks og fokuseret
pytest parallelt med isolerede caches; der må ikke tilføjes en separat collection-pass.
Aktuelle målinger står i UDVIKLINGSFLOW, ikke her.

Før firmwarebuild kontrolleres både ESPHome-venv og eksisterende PlatformIO-penv med
`python scripts/check_firmware_env.py <esphome-venv> <platformio-penv> --uv-cache <platformio-core>/.cache/uv`.
Manglende pyvenv.cfg, dist-info/METADATA eller cachearkivets WHEEL kræver et rent buildmiljø; genkør ikke
ESPHome mod samme beskadigede miljø, hvor upstream skjuler installerens stderr.

En timeout, sandboxfejl eller flaky test er ikke produktevidens og må ikke udløse en
runtime-patch. Isolér årsagen én gang; ret workflowet eller testens observerede
slutbetingelse separat, og genkør kun den gate, som fejlen faktisk ugyldiggjorde. Hvis
samme procesforsinkelse gentager sig, er næste handling en permanent tooling-regression,
ikke endnu en manuel workaround.

En afgrænset HA-pause kræver en særskilt Restore Owner-agent med frisk, minimal
kontekst, klargjort og med bekræftet ejerskab mens HA endnu viser Kører, før Stop.
Kun Restore Owner ejer før-Stop-tidsgrænsen, Stop-kvitteringen, den eksisterende
provider-startgate og genstarten. Operatøren skal startes med `exec_command`-indstillingen
`tty: true`; samme åbne session bruges til den linjeafsluttede startgate, da stdin-EOF
afbryder før provider. Efter stoppet providerarbejde skal Start iværksættes
straks ved operatorens terminalresultat uanset verdict eller senest pause_start +120 s,
og Kører verificeres inden pause_start +180 s; 60 s er reserveret til restore.
Root må ikke selv pause HA eller udføre analyse, dokumentation eller review, mens HA
er stoppet; restore må ikke afhænge af en besked eller fortsættelse fra root.
Eksisterende menneskelig godkendelse og operatorens providerdeadline bevares.
Dette er et ansvars- og deadlinekrav, ikke en hård tilgængelighedsgaranti ved agent-,
browser-, netværks- eller HA-fejl.

For den beholdte historiske Realtime-protokolprobe gælder følgende, ikke for
GPT-Live-produktion: En sendt provider-control-event er aldrig i sig selv bevis for
sin påståede effekt.
Ved `clear`, `commit`, `delete`, `cancel`, `truncate` og `response.create` skal
regressionen fortsætte gennem de efterfølgende korrelerede serverevents og bevise den
tilstand, som runtime bygger videre på. En fake, der kun tæller outbound-kaldet, kan
ikke godkende ejergrænsen.

Før en fysisk diagnoseprøve skal agenten kontrollere den installerede versions
diagnosefelter og frisk optagelsesstatus efter seneste genstart/opdatering. Historik,
runtime-tidslinje, aktiveret næste optagelse og faktisk gemt lyd er forskellige beviser.
En gammel lydfil eller en lokalt testet diagnostikpatch må aldrig kaldes aktiv diagnose.

Kun i samme historiske Realtime-probe: manuel `input_audio_buffer.commit` er aldrig
bevis for, at en aktiv provider-VAD er terminal. En afvist spændvidde må først frigive næste mic-open efter natural matching
`speech_stopped`, commit/item og eksakt delete-ACK; manglende terminalkant skal lukke
samme session bounded fail-closed.

Før hvert firmwarebyg skal `tests/firmware/boot_package_regression.py` køres med den pinnede
ESPHome-Python. Den reelle package-merge skal bevare hele hardware-bootsekvensen og
alle overlay-hooks præcis én gang; rå YAML-tekst er ikke dette bevis. Ved ændret
boot skal genereret C++ også kontrolleres før upload.

## Produktretning og accept har ét hjem

[ARKITEKTUR](ARKITEKTUR.md) beskriver den eneste GPT-Live/full-duplex-produktionsvej,
I/O og faktiske Live WAV-output. [INVARIANTER](INVARIANTER.md) ejer input-/output-
generationer, tool-/close-autoritet, privacy og lifecycle.
[PRODUKTMÅL](PRODUKTMÅL.md) ejer præcise gates, tællinger, latency og definitionerne af
første virkende version, lifecycle-godkendelse og produktaccept. V1.x-milepæle arves
ikke som v2.x-accept. [STATUS](STATUS.md) ejer aktuel prioritet og fysisk evidens.

Disse kontrakter kopieres ikke her. Legacy Realtime-prober beskriver kun deres egen
adapter; de kan ikke vælge produktionsmotor, lukke aktiv Live-input under svar eller
opfinde Live VAD/ACK-events. Se [EVALUERING](EVALUERING.md) for skellet.

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
3. rigtig Talk/Thin-integration og sikker eval af den faktisk valgte provider;
4. deterministiske integration-, unit-, kontrakt- og statiske tests;
5. transcript, UI, loguddrag, hypotese eller plausibel forklaring uden den fulde kæde.

Semantisk provideraccept skal navngive den faktisk kørte adapter, primærmodel,
backendmodel/delegation, prompt og værktøjssnapshot før resultatet bruges som
årsagsbevis. `LiveRealtimeDriver` tester Realtime; navnet beviser ikke GPT-Live.
Historisk Realtime-diagnostik og GPT-Live-produktion arver aldrig hinandens semantikresultater. Ret ikke en
produktionsprompt ud fra en anden providervej uden at afklare den ejergrænse.

Effektiv prompt- og schemabinding skal udledes af den faktiske startupkonfiguration
efter Thins capability- og policytilpasninger. Constructorværdier eller hashes af
gemte baseinstruktioner er ikke wirebevis. Preflight skal kontrollere denne binding
gennem den shippede wake-grænse før provideradmission og dække både understøttede
og ikke-understøttede capabilities, når de vælger forskellige promptgrene.
En binding før SDK beviser den forventede startup, ikke serverens accepterede
konfiguration. Når startupkvitteringen eksponerer instruktioner og schema, bind
indholdsfri fingeraftryk til samme generation. Manglende felter er ukendte;
SDK-defaults er ikke bevis for, hvilke felter der var på wire.

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
2. Bevar én samlet GPT-Live full-duplex-kæde; optimer ikke én komponent på bekostning af den
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
   målrettet regression og relevant adapter, derefter relevante tidligere feltregressioner og én
   fuld CI-kontrol på det frosne diff. Ved ændret prompt, schema, værktøjer eller
   GPT-Live-semantik bruges kun relevant prøve af den faktiske providervej.
9. Rollback og byteidentitet arver aldrig “golden” eller “stabil”; kandidaten skal bestå
   alle senere feltregressioner. Stabilitet kræver samme artifact 10/10 ubrudt.

Ved mistænkt firmwarecrash skal den bevarede native crashlog hentes og den
installerede kandidats ELF/artifact-identitet sikres før reboot eller flash.
En backtrace uden tidspunkt beviser et tidligere crash, ikke automatisk årsagen til
en bestemt samtale. Ved tråd-/RTOS-fejl skal ejerskab af delte signaler kontrolleres
på tværs af den præcise shippede framework- og afhængighedskode.

Før implementering skal lead desuden gennemgå hele den kausale kæde og mindst ét trin på
hver side af den mistænkte fejl. En lokal rettelse er ugyldig, hvis den blot flytter
ejerskab, timing eller fejl til mic-gate, provider, tool-round, playback, teardown eller
rearm. Efter implementering gentages gennemgangen mod det faktiske diff og reviewerens
adversarial findings.

Gain, VAD, bip, prompt og timeouts må kun ændres på baggrund af en trace eller en på
forhånd defineret måling. Tænke-lyd er en separat feature. Full duplex og naturlig
afbrydelse er v2.x-produktretningen; deres fysiske funktion skal dokumenteres, ikke
udskydes med et gammelt half-duplex-krav eller erklæres bevist af åben mic alene.

## Prioritet og måling

Følg aktuel rækkefølge i [STATUS](STATUS.md) og gates i
[PRODUKTMÅL](PRODUKTMÅL.md). Oplevet svartid måles fra fysisk taleslut til første
meningsfulde svarlyd på samme kandidat, med rum-/deviceproveniens; et earcon eller en
preamble må ikke maskere ventetiden. Feedbacksignal, UI og anden isoleret ændring må
ikke ændre lifecycle eller skjule en ubevist funktion som sideeffekt.
