# PodVoice-status — én aktuel sandhed

### 6/10 — aktiv beslutning: v2.0 frosset Alpha-baseline, derefter v2.x-hastighed

**Udgivet og installeret 6/10 kl.15:19: v2.0.0, Alpha fortsat ON.** PR97 merged
som main52f10a30295247c9e6455895babca2ab83f54ab8. Endeligt reviewed head
821c12f4f3161140f010753df45487ee55ec2807: frozen releasegate104,0s PASS;
PR-CI37468087094 og ARM64-build begge grønne. Uafhængigt Sol-review af den isolerede
Talk-fixture-korrektion giver GO; whole diffSHA
c9d734dee6018eb4e4e15bd14061f6c5effb783c3cd24496312f80659284c397. Ingen
produktdeadline eller runtime ændret. Main-CI37468680515 har grøn lint/test og
publish; merge-tree matcher den testede kandidat.

Publiceret immutable OCI-index
sha256:a5fe4984bd1d33794f9b5ce44f9efed9e0c2ca2d9a4734bfda34bd9f347f6a02,
ARM64-manifest sha256:5134c82e1bef503d1e0c8e2cef9319ab2098449a6e9634bfdf03a102c909ff7e.
HA viste nyeste2.0.0; opdatering blev kørt én gang med sikkerhedskopi markeret.
HA viser nu Nuværende version2.0.0/Kører. Startup15:19:13 bekræfter version2.0.0,
gitSHA52f10a3 og rootfs-v1:
0ae257328c962b532b550095be2299e8de2c574a11293abfc98b5aa8a023a643.
Voice PE er forbundet; firmwarekontrakt OK på uændret
podvoice_build_113112_liveclosing1/ESPHome2026.6.2, kanal1/gain16, enhedsbekræftet
Hey Chat+Hey Jarvis. Panelet viser v2.0.0, ingen åben samtale og wake afprøves;
gemt Alpha-checkbox er ON og stilhedsværdi4s. Ingen ny firmwareflash, providerprøve,
lydtest eller fysisk golden/10/10 udført. Installation er bekræftet, v2.0 fysisk
accept er fortsat afventende; tidligere .116-feltundtagelse og åbne fund bevares.

Brugerens seneste v2.x-præcisering er føjet til UI-epic95: integrér Alpha som den
normale GPT-Live-oplevelse og konsolidér alle definitive valg. Når retningen er
endeligt valgt, fjernes midlertidige Alpha/test-betegnelser og parallelle legacy-/
ON/OFF-produktvalg fra daglig brug med eksplicit settingsmigration og dokumenteret
rollback. Reelle brugerpræferencer og fejlsandhed bevares. Dette er backlog, ikke
allerede udført UI-ændring i den frosne v2.0-runtime.

De tre vedvarende v2.x-epics:

1. [Hastighed94](https://github.com/BixelVentures/podvoice/issues/94): opstart,
   meningsfulde svar og afslutning; fysisk måling før én flaskehals ad gangen.
2. [UI95](https://github.com/BixelVentures/podvoice/issues/95): integrér Alpha og
   definitive valg; fjern støj, nonsens og legacy, gør daglig brug enkel.
3. [Stabilitet/funktioner96](https://github.com/BixelVentures/podvoice/issues/96):
   konkrete logfejl, brugbar diagnose, recovery og resterende funktionshuller.

Denne installationsreceipt er docs-only efter det frosne release-diff. Den ændrer
ikke det publicerede artifact og kræver ingen ny provider-/fysisk kontrol.


Implementeret kandidat: version2.0.0 er ens i pyproject/config/package; kun disse
metadata og STATUS/CHANGELOG ændres i de shippede bits (oprindeligt fem filer). thin.py SHA6e5fe542 og live_idle.py
SHA3611aea3 er uændrede; alle andre produktions-/firmwarebits matcher main. Det
uafhængige Sol-review final_116_review giver GO til ærlig Alpha-milepælsbygning,
merge og installation under softwaregates, ingen P0/P1; ingen versionstyret
migration eller runtimeforgrening fundet. Ny version ændrer også MCP-clientInfo-
metadata, ikke værktøjer eller samtalelogik. Ingen ekstra betalt providerprøve.

Første lokale fast i sandbox: Ruff/format/mypy55 grøn; lokale webtestservers kunne
ikke binde sockets (PermissionError). Det er en miljøbegrænsning, ikke produktevidens;
ingen runtimepatch udledes. Gate køres med de nødvendige lokale procesrettigheder.
Den rettighedskorrigerede fast fik grøn integration (65,61s) og alle unit-batches
(152,31s), men scopelåsen afviste det samlede resultat, fordi brugerens nye v2.x-UI-
præcisering blev tilføjet STATUS under kørslen. Det tæller ikke som en bestået gate.
Hele femfilsdiffet blev frosset før releasegate, som også dækkede disse docsændringer.
Ingen runtimepatch eller ekstra providerprøve. Review-GO omfatter fortsat uændret
metadatakandidat; den nye UI-note er dokumentation, ikke en skjult UI-/lifecycleændring.

Lead/root — separat tooling-beslutning i denne kandidat: den første releasegate
stoppede straks i candidate-scope, fordi en ren __version__-ændring fejlagtigt
klassificeres som runtime uden ny regression. Ingen runtime-, provider- eller
fysisk fejl. Hypotese: en eksakt diff med kun én fjernet og én tilføjet numerisk
__version__-streng kan klassificeres som metadata; enhver anden linje/produktionsfil
skal stadig kræve den eksisterende regression/review. Uafhængigt review fandt en
P1 i første toolingforsøg: +++/----lignende unary kode blev behandlet som fileheader.
Den afviste løsning bevares som fejl; metadata-undtagelsen læser nu kun indhold inde
i faktiske Git-hunks og nulstiller ved hver filegrænse. Ekstra added/removed unary
kode, også med whitespace, afvises. De første11 metadata-positive/negative
cases bestod; et nyt review fandt siden en yderligere P1: CR/newline-normalisering
kunne skjule en ekstra assignment som en linje uden diffprefix. Metadata-undtagelsen
skal derfor bruge LF-framing og afvise alle andre hunklinjer end ændringer og Git
EOF-markør; den må kun anvendes på de eksisterende unified=0-diffs. Tilføj rå og
normaliserede CR-regressioner før nyt review-GO. Review fandt derefter en spoofet
filegrænse efter CR-normalisering. Den konkrete rettelse er nu at bevare Git-stdout
som bytes og dekode UTF-8 uden universal-newline-ændring. Real-Git-regressioner
skal afvise CR-code og den spoofede filegrænse gennem inspect_repository, ikke kun
et håndlavet diff. Ingen release-GO eller normal produktaccept er udledt. Ingen ændret source-GO antages, før den rettede gate er reviewed. Ret kun denne gategrænse,
med positive og adversarial negative tests for ekstra kode, anden fil og malformed
version. Tooling er en separat ændring; shippede bits ændres stadig kun i version.
Review og målrettet scope-test før én ny gyldig releasegate på det nye frosne diff;
den forkastede scope-kørsel er ikke en bestået fuld gate eller en runtimepatch.
Målrettede candidate-scope/release-contract-regressioner består, Ruff/format er
grønne, og faktisk candidate-scope siger version metadata only. Tooling er
isoleret i scope-gaten og dens eksisterende regressioner; ingen shippet runtimeændring.
Efter raw-Git-rettelsen består alle21 målrettede metadata-/real-Git-regressioner,
inklusive den spoofede CR-filegrænse gennem inspect_repository. Ruff/format grøn.
Nyt uafhængigt Sol-review v200_final_review giver source-GO uden uløste P0/P1;
real-Git-CR og spoofet filegrænse afvises gennem produktions-_git. Reviewet diffSHA
81ab62ff608c3fe0be312eaf5d40cdb954d8a895a92a5bf210f85c347550ca78, toolingSHA
dc97aa33507734b59b728a5603cf49cdadb1f61cf4128a798374bab051c68dd5. Denne sidste
receipt er docs-only. Alle syv filer fryses nu, tooling i separat commit; én gyldig
releasegate køres før PR/merge/publicering. Fysisk v2.0-accept er stadig afventende.

Lead/root — isoleret testkorrektion før merge: PR97 head56eda47 havde grøn ARM64-
bygning og lokal release140,0s, men CI37466783577 fejlede i Talk-regressionen
`test_typed_first_http_create_timeout_keeps_socket_live_and_never_dispatches`.
Den injicerede 100ms outer connect-deadline gav den forventede første timeout og
korrekt cleanup; samme kunstige budget blev derefter beholdt i den raske næste
provider-generation, som CI afviste. Hypotese: fejlindsprøjtningen lækker ind i
recovery-beviset. Afgrænset testrettelse: gendan det oprindelige budget før næste
generation og lad dens raske HTTP-create tage mere end100ms deterministisk.
Alle negative første-generations-assertions og ingen-replay-assertions bevares.
Runtime/deadlines ændres ikke. Målrettet Talk-test og frosset releasegate før nyt
naturligt CI-flow; ingen manuel CI-genkørsel eller ny betalt providerprøve.

Isoleringen bekræfter årsagsgrænsen: uden budgetgendannelse afvises næste raske
HTTP-create efter200ms med præcis CI-fejlen rejected/submitted. Med gendannelse
består alle syv Talk-WebRTC-integrationer. Dette er permanent test-fixture-recovery,
ikke en produktrettelse eller skjult timeout-tuning. Det nye ottefilsdiff fryses;
én releasegate og et nyt CI fra push er påkrævet før merge.

Lead/root. Brugeren beder om en v2.0-milepælsrelease, som fastholder den fungerende
funktion, og om at skubbe alle fund til repoet før hastighed/tweaks i v2.x. Kandidaten
må kun ændre versionsmetadata og release-/beslutningsdokumentation. Runtime, prompt,
model, værktøjer, gain/VAD, UI4s, den korrelerede 2s-afslutningsfase og firmware112
fastholdes byteidentisk med installeret .116/main a2b5a27. Det er en **Alpha-baseline**,
ikke lifecycle release-godkendt, 97/100, fuld funktionsparitet eller produktmålet nået.
Den eksplicit godkendte .116-feltundtagelse og fejlede 5×-kontrol bevares synligt.

Stærkeste nye bevis: otte automatisk gemte manifestdele fra fem .116-sessioner
14:14:07–14:16:29 den 6/10, læst fra HA uden ny optagelse, lydopslag eller ændret
indstilling. Samme rootfs-v1 dcdbfac9db5aa1bad9be61a97aeead2ae2f665679b65cad5cf48e99ce675d0f5,
firmware podvoice_build_113112_liveclosing1, channel1/gain16 og gpt-live-1. Brugeren
melder, at det ser ud til at virke, men at gul stadig varer længe. Rådata/historik er
private; repoet får kun reducerede hændelser og målinger, ingen hjemmelyd eller nøgler.

| Conversation trace / 20261006 | Lukkeårsag | Wake registreret → provider klar | Gul ACK → deadline | Gul ACK → rearm |
|---|---|---:|---:|---:|
| T141407-473-6465ce43 | model-close | 4,168s | ingen gul fase | ikke relevant |
| T141439-269-12946594 | app-idle-timeout | 2,569s | 2,058s | 3,860s |
| T141542-687-fd72da52 | app-idle-timeout | 2,875s | 2,047s | 4,065s |
| T141557-869-897c3d15 | app-idle-timeout | 2,031s | 2,016s | 3,885s |
| T141617-514-89efa2c1 | app-idle-timeout | 2,021s | 2,030s | 3,938s |

Kilde for intervallerne er samme manifests host-monotonic at_ms, ikke transcriptets
leveringstid eller stopur. Gul start er korreleret firmware LED-TX-ACK; rearm er matching
recovered-ACK. IDLE er registreret 1ms senere. Det er eventbevis, ikke rumoptaget lyd.
Alle fem bevarer provider-terminal → exact playback_finished → close_requested →
teardown_complete → matching rearm → IDLE. Efterfølgende fysiske wake-events beviser
recovery for de første fire; sidste sessions næste wake er ikke optaget. Ingen frisk
Stop-/klik-/afbrydelsesprøve i dette datasæt. Ikke 5/5 vellykkede svar eller en 10/10-gate.

Semantisk første prøve: terminal backend settled +17465ms → provider close send
+17468ms, altså 3ms og ingen UI4s/gul ventetid. Provider-terminal +18589ms, fysisk
playback_finished +18996ms, rearm +19532ms. Historikken viser farvelinput og kort
kvittering; fuld hørbar farvelhale er ikke uafhængigt rumoptaget her.

De fire timeoutprøver har én gul start/deadline hver; ingen genstart af UI4s er
registreret. Gul består af 2,016–2,058s aftalt guard, 0,789–1,072s fra deadline til
provider-terminal, 0,411–0,494s terminal→playback-finish, og 0,421–0,551s playback-finish→rearm. Korrektion til
ældre flaskehals: socket-/SDK-release er nu kun 14–15ms; den er ikke den tidligere
1,81s oprydningslås. Providerens terminalventetid og fysisk dræn må ikke blandes sammen.

Åbne fund, som v2.x skal bevare og afklare:

1. T141542 registrerer et klokke-spørgsmål, men ingen assistanttekst/backendopgave;
   gemt speaker-PCM RMS2,2/peak0,14% understøtter manglende meningsfuldt svar. Det kan
   ikke kaldes korrekt besvaret. Årsagen er uafklaret; gennemgå hele input/provider/
   delegation/output-kæden før patch. T141617 har samme næsten tavse stream og ingen
   historikinput; tom wake er kun en hypotese. Ingen lokal tekstregel tilføjes.
2. Alle fem traces er incomplete med hhv. 380/142/130/152/136 tabte diagnosekommandoer.
   Native indgangskø rapporterer nul tabte frames/bytes; diagnosehul er ikke det samme
   som dokumenteret hakkende playback. Første v2.x målearbejde skal isolere recorderens
   begrænsning og bevare identitet/clock/provenance uden at belaste samtalekæden.
3. Wake→provider-ready varierer 2,021–4,168s. Dette er opkobling fra detekteret wake,
   ikke sagt wake→detektion og ikke sidste brugerord→hørbart svar. Første streamstart
   kan være tavs; tidligere UI-etiket om hørbar lyd må ikke bruges som fysisk latencybevis.
4. Fejlede .116 SDK-kontrol 42→48, forventet44, er fortsat uløst. Timeroprettelse
   mangler allerede i ON/OFF. Talk-browserens fulde farvel/dræn er parkeret. Ingen
   automatisk lukning i alle støjforhold, wake99,9% eller fuld funktionsmatrix er bevist.

V2.x-produkt/UI-krav, efter brugerens efterfølgende afklaring: ryd cirka95% af den oplevede UI-
kompleksitet væk, så hovedvisningen er forståelig og funktionsdygtig til daglig brug.
95% er et ambitionsniveau, ikke en målt effekt. Bevar start/Stop, valgt/aktiv Alpha,
ærlig forbindelse/samtalestatus, arbejds-/afslutningsfase, styrende logik og faktisk
nedtælling. Saml avanceret diagnose, detaljeret telemetry og sjældne indstillinger
bag en tydelig sekundær adgang. Brugeren præciserer: alt UI-støj, nonsens og legacy skal fjernes, ikke blot gemmes
bag menuer. Audit skal skelne overflødige/forældede UI-elementer fra brugbare funktioner
og sand fejlinformation; reel avanceret diagnose bevares som sekundær adgang.
Ingen aktuel brugbar funktion eller fejlsandhed skjules/fjernes.
Brugeren placerer oprydningen i v2.x-serien, efter den frosne v2.0-baseline.
Dette er en særskilt kommende UI-kandidat med mobil/HA-app/desktop, tastatur og
accessibility-kontrol samt uændret lifecycle. Den er ikke implementeret i denne
metadata-baseline og må ikke regnes som udført ved version2.0.0 alene.
Frisk læst Hjem-visning viser konkrete oprydningspunkter: “Er Nabu klar?” trods
HeyChat/HeyJarvis, readiness-tooltip “aktiv Realtime-session” samtidig med “Ingen
åben samtale”, og en gul-fase-tabel på2s uden samlet terminal/dræn/rearm-varighed.
Bevar forskellen mellem senest prøvet provider og faktisk aktiv forbindelse. Dette
er observerede UI-formuleringer, ikke bevis for en skjult aktiv runtime-session.

Tre vedvarende v2.x-epics er nu oprettet i repoet med konkrete fund og færdigkriterier:
- Hastighed: https://github.com/BixelVentures/podvoice/issues/94
- UI: https://github.com/BixelVentures/podvoice/issues/95
- Stabilitet og funktioner: https://github.com/BixelVentures/podvoice/issues/96

Prioritet for v2.x: (a) luk det konkrete ubesvarede-spørgsmål-/diagnosehul med
observeret årsagsgrænse; (b) måle hele kæden til første meningsfulde svar, opdelt i
opstart, input/forståelse, provider/tool og faktisk playback; (c) optimere største
målte, fjernelige ventetid én kandidat ad gangen; (d) afkort gul kun med bevaret
nye-opgaver/lyd, fuld farvelhale, Stop og næste wake. Ingen samtidig tuning af prompt,
VAD/gain/buffere. 40 simple +20 værktøjsture og direkte sammenligning er stadig mål,
ikke resultater; dette lille datasæt giver ingen p50/p95-accept.

Berørte release-invarianter: præcis artifact/version-identitet, én ThinSession-/
close-/rearm-ejer, ingen accept-arv fra byteidentitet. Kausal hypotese for denne
metadata-kandidat: uændrede runtimebytes giver uændret funktion; version/provenance
må ikke ændre prompt, settings, tool schema eller firmwarekontrakt. Ikke-mål er alle
runtime-/hastighedsrettelser, ny AI, transport eller fysisk accept. Plan: kontrollér
versionslighed og hele diffet mod main, uafhængigt adversarial review, relevante
softwaregates og én releasegate efter freeze; derefter ét PR/main-artifact-flow.
Ingen ny betalt providerkontrol begrundes af versionsmetadata. Ny artifact får sin
egen identitet og arver ingen golden/10/10. Rollback til præcis .116-artifact ved
versions-/settings-/readiness-regression; AlphaON og gemte wakevalg bevares. En
normal stabil v2.0-godkendelse afventer de fysiske/semantiske gates, ikke flere ord.


### 6/10 — frisk fysisk feltfejl på installeret .114: timeout klar, ingen afslutning

Lead/root, read-only gennemgang efter brugerens netop udførte prøve. Automatisk
afslutning er **FAIL** på denne prøve; .114 er ikke fysisk godkendt. Talk forbliver
parkeret. Ingen runtime-, settings-, firmware-, release- eller installationsændring
udført ved denne gennemgang.

Prøve 08:30:20–08:31:51, conversation_trace_id
`20261006T083020-054-8bbb7d20`. Alle syv gemte tidslinjedele identificerer add-on
1.13.114/rootfs-v1 `31212c77b6b0397c9490956726479ff46dda03745af5517d7758f1b47b57cbde`,
firmware `podvoice_build_113112_liveclosing1`, contractOK, gpt-live-1 og gain16.
Metadata angiver custom prompt SHA `0c041d38218a9362888e664d0e9715cdec1b8816f38636576ae76dadb57fea64`.
De eksisterende automatiske data er læst via HA-panelet; ingen ny optagelse,
lydopslag, extra AI eller brugerprøve er startet.

Direkte evidens: sidste backendresponse er completed ved +53753ms. Ved +66437ms
viser `live_idle_diagnostic` blocker=ready, quiet_s=4.943449891 og nul responses,
batches, tools, continuation eller pending_audio. Ved +88903ms er samme vindue
stadig ready, nu quiet_s=27.318666667. Ingen preclose-start/visible/elapsed findes
i de gemte hændelser. Fysisk knap ved +89455ms giver close_requested(reason=stop)
ved +89458ms; teardown_complete +90954ms; wake_rearm_recovered +91160ms. Stop til
rearm-kvittering er 1.705s, ikke bevis for en efterfølgende fysisk wake.

Årsagsgrænsen er flyttet fra rå baggrunds-VAD til **played-speech-låsen efter det
færdige idle-vindue**. Sammenholdt med den shippede source ce8d730 (thin.py2272–2274,
6395–6407): preclose kræver `_live_close_speech_played`, men flaget sættes kun hvis
én observation både har nonzero output og consumed_frames >= DEN SAMME observations
frame_end. 849 gemte native observationer omfatter 172 nonzero vinduer; **nul** af
disse opfylder den samtidige consumed-test. Mixeren er foran den fysiske consumer.
Sidste nonzero grænse frame_end=2635184 ved +60590ms er faktisk passeret af samme
source_epoch/reply_token/playback ved +60797ms, consumed_frames=2636580; den nye
observation har peak=0. Koden husker ikke den tidligere nonzero grænse og kan derfor
aldrig anerkende dette forsinkede forbrugsbevis. Dette er en konkret, falsificerbar
softwarehypotese; ingen målt rå-TV-veto eller ventende værktøj forklarer ready-perioden.

Afgrænset næste rettelse, endnu IKKE implementeret: bevar en identitetsbundet
nonzero framegrænse og anerkend faktisk forbrug i en senere frisk observation fra
samme playback/source/provider/native generation. Genbrug eksisterende ejerskab;
undlad at fjerne playback-bevis eller forlænge UI4s. Ny lyd/arbejde skal fortsat
afbryde idle/preclose, og stale/reset/Stop må aldrig overføre grænsen til næste wake.
Berørt kæde: providerlyd → FLAC → announcement-mix → faktisk consumer → played-
speech-bevis → UI4s → korreleret LED-TX/2s → provider-close/drain → teardown/rearm.
Planlagt regression skal reproducere mixed-nonzero → senere consumed-zero, også
over generation/reset, og bevise manglende/forældet consumption fail-closed.
Uafhængigt review, relevante adapter/gates og ny fysisk prøve kræves før rettelsen
kan godkendes. Ingen ændret fortolker, prompt, transport, gain, VAD eller timeout.

Bevisbegrænsning: alle syv lydtraces er incomplete med tabte diagnosekommandoer;
der er ingen rumoptagelse. Hændelserne beviser ready-vindue og Stop-kæde, ikke enhver
lydgrænse eller fravær af alle mulige events. Bevarede private, reducerede tidslinjer
og indholdsfri driftsdiagnostik: `/private/tmp/pv114-field-20261006/`, mode0600.
UI viser også ufuldstændig diagnose. Recording-tab er et særskilt observeret hul,
ikke i sig selv årsag til runtime-fejlen.


### 6/10 — aktiv rettelse: senere fysisk forbrug åbner app-timeout

Lead/root. Brugeren har nu bedt om rettelse, udgivelse og installation. Base er
main ce8d730 (.114), frisk usynkroniseret clone. Feltbeviset ovenfor er årsagen;
.114 er installeret, men fejlede automatisk afslutning. Ingen accept arves.

Hypotese: huskes en valid nonzero announcement-framegrænse under eksakt native/
provider/session/playback-identitet, kan en senere frisk og fremadgående måling
bevise forbrug uden samtidig nonzero output. Den fælles Thin-ejer bevarer alle
øvrige guards: faktisk playback-start, nyt output/arbejde afbryder ro, UI4s,
korreleret LED/2s, provider-close, fysisk dræn, Stop og eksakt rearm. Grænsen må
ikke krydse stale/duplicate/out-of-order, reset, providerrotation eller næste wake.
Kæde/invarianter er som ovenfor; ingen ny fortolker eller lifecycle-ejer.

Ikke-mål: prompt, VAD, gains, firmware, transport, tools, skjulte timeoutændringer,
Talk-afslutning eller større omskrivning. Firmware .112 ABI genbruges. Tilføj kun
manglende eksisterende diagnosefelter for forbrugsbeviset, hvis nødvendigt.

Regressionsplan: mixed-nonzero med consumer bagud → frisk zero med consumer over
samme grænse → UI4s trods TV → LED-ACK/2s → provider-close → eksakt fysisk finish →
én teardown/rearm → ny wake. Manglende consumption, gamle kilder/generationer og
forsinkede callbacks afvises; ny lyd/arbejde/Stop bevarer eksisterende annullering.
Test relevant native-adapter, tidligere close-races og Talk/OFF. Uafhængigt
adversarial review før diff-freeze, fast og én fuld releasegate. Ingen ændret
providersemantik, derfor ingen ny betalt promptprøve. Grøn main-artifact installeres
med præcis runtime-identitet; fysisk golden og 10/10 er fortsat afventende.
Rollback er .114/.112, ikke en fysisk godkendt løsning. Stop-the-line ved uklart
identitets-/consumption-bevis eller uløst alvorlig reviewfinding.

Implementeret .115-kandidat: ThinSession husker den eksakte nonzero framegrænse
under session/provider/native/playback/source/rate-identitet og anerkender senere
frisk fremadgående consumption. En bevaret provisional take()-måling må kun bevise
forbrug af den kendte grænse; eksisterende quiet-vindue giver den aldrig lukkeautoritet.
Nyt nonzero native output annullerer preclose allerede mens det er ventende.
Reset fjerner pending-grænsen; wake/rotation og ownerændring fjerner played-bevis.
Indholdsfri diagnose viser nu played-lås og pending framegrænse. Prompt, firmware,
UI4s/2s, providersdk, tools og transport er uændrede.

Ruff/format og mypy55 består. Første fast blev afbrudt på kold typekontrol; isolering
fandt seks konkrete Any/None-typefejl, som er rettet med eksplicitte None-guards.
Anden fast havde grøn typekontrol og 700/701 integrationscases; paneltesten genbrugte
index1 fra den ændrede realistiske played_answer-fixture og gentog observationen.
Fixtureforløbet fortsætter nu fra index2 uden ændret produktadfærd. 83 målrettede
causal/preclose/panel/idle/nativeadapter-cases består på det aktuelle diff. Unitdelen
fra den afbrudte fast arves ikke. Uafhængig review og én fuld frossen releasegate
udestod på dette trin; ingen PR/merge/release/install af .115 endnu.

Uafhængig adversarial review /root/consumption_review giver software source-GO uden
blokerende findings. Faktiske 849 feltobservationer blev gennemspillet via den reelle
VoicePELink-parser: 813 same-playback-målinger accepteret, gammel regel 0 hits,
ny regel første played-lås ved +5977ms/seq56 på zero og gyldig ved seq587. Dette er
forensisk softwarebevis, ikke ny fysisk accept. Frozen runtime SHA256
cb5855667ed984bfeb5c72394e8f1a727d78a184a7459e1ed5006bbcd1506784;
reviewet runtime/testpatch SHA256
44c305748bc3e544ee7f35aed71e741367fcc7167b2c44ad10a57ed02ce5d5e1.
Det samlede diff fryses nu til én fuld releasegate. Fysisk closure/golden/10/10
for .115 er stadig afventende. Talk forbliver parkeret.

Den ene fulde releasekørsel består ruff/format, mypy55, candidate-scope
(physical_output) og alle 701 integrationstests. Unit-stage når 92%, men rammer
240s-grænsen med én fejl; målrettet isolering beviser versionsmismatch i
pyproject.toml (.114 mod add-on/runtime .115). Kun udgivelsesmetadata rettes til
.115; runtime/testpatch er byteidentisk med det uafhængigt reviewede diff.
Kun den ugyldige unit-stage færdiggøres; de grønne stages gentages ikke.
Unit-isoleringen fandt desuden et separat, gentaget testtiming-hul i den historiske
idle-check-probe: 2s wall-clock tillod kun 20 af de 26 scripted opening-frames
under host-load, hvorefter testen korrekt gav UNKNOWN. En kold SDK-import blokkerede
9,56s i isoleringen. Dette er ikke .115 runtime-evidens. Permanent test-only
rettelse styrer probe-pacing deterministisk og bevarer rigtig installeret SDK,
wire-parent/settlement/negative assertions og separat bounded hang-guard.
Produktionsprobe, provider-timeouts og den reviewede runtime ændres ikke.

Gentaget unit-stage procesforsinkelse (240s, ca.56%, ingen registreret testfejl)
udløser en permanent tooling-regression efter agentkontrakten. Kun lokal testkørsel
opdeles i deterministiske sekventielle, begrænsede grupper med præcis én dækning af
alle unitmoduler, fail-fast og child-cleanup. Ingen produktionsdeadline eller test
fjernes. scripts/dev_cycle.py og dens egne regressioner ændres separat fra den
bytefrosne lydrettelse; lead gennemgår workflowdiffet før publicering. Resterende
unitdækning gennemføres med den nye faste mekanisme, ikke endnu en manuel tidsgrænse.

Lead har gennemgået det separate toolingdiff: alle 97 unitmoduler dækkes præcis én
gang i fire sekventielle subprocesses, hver med den hidtidige 240s releasegrænse;
fejl afbryder næste gruppe, timeout og worker-SIGTERM rydder aktive child-grupper.
49 målrettede workflowtests og 46 SDK-probetests består; Ruff/format/diffcheck grøn.
Frozen dev_cycle SHA256 d882afa7eba24031450f8b7b6722d637f3e68c77de86242eb3d9d1b861556130;
workflowtest c3fc840b23b5e755d517f0cced84b79f68909e8439a41bdd360852380e942e42;
SDK-test 786012f576975c67ea205f334bda603d54a4585db10a5c1b5ba6895a89280d5b.
Ny candidate-scope består stadig kun physical_output. Den ugyldige unit-stage
færdiggøres med den faste worker; draft-PR/eksakt CI må køre parallelt, men merge
og installation afventer begge grønne kontroller. Fysisk .115-accept afventes.

Unit-worker gruppe1 består. Gruppe2 fandt en test-only race i den historiske
live_alpha_probe Stop-send-regression: dens 5ms instruction-timeout nåede at
udløbe samtidig med Stop-observeren. Stop-send-casen har nu ingen send-deadline,
så testen beviser at Stop alene afbryder pending send; den separate timeout-send-
case beholder 5ms og den ydre test-hang-guard bevares. Alle seks lifetime-cases
består målrettet. Produktionsprobe/runtime er uændret. Unit-stage er fortsat
ikke samlet grøn, og draft-PR92 forbliver draft indtil den præcise source består.

Endeligt software-resultat: alle fire faste unitgrupper består (samtlige 2711
unitcases); 701 integrationcases består; ruff/format, mypy55 og final candidate-
scope physical_output består. Den ene releasekørsels ugyldige unit-stage er
færdiggjort efter de afgrænsede test/toolingrettelser; øvrige grønne stages er
ikke blindt gentaget. PR92 head29ab381d8314032a6eb3dbbc7ba34f1dd9e67c32 har
fuld lint/test og ARM64-build success (run37434982892). Uafhængigt runtime-review
og leadens workflowreview er afsluttet uden blokerende findings.
PR92 er merget som 9a1d7f1f071c006eba34b5c05e745b526e058265; lokalt/remotely
verificeret tree ec92e83de0811e9d53361c030ae708f7f0de16e6 er byteidentisk.
Main-push run37435550611 publicerer .115 med normale fulde checks, ingen manuel
CI-genkørsel. Installation afventedes på dette trin; resultat følger nedenfor.

Publicering og installation afsluttet 6/10: main-run37435550611 består fuld
lint/test og publish-addon. Publiceret ARM64-image 1.13.115 har digest
sha256:9f11dd06265c11e867bf62ba13d021fd5b155bf1e555de27f1a889296aa9fb5a
og revision 9a1d7f1f071c006eba34b5c05e745b526e058265. HA-opdateringsdialogen
og app-info bekræfter installeret 1.13.115, nyeste 1.13.115 og Kører.
Efter genstart viser PodVoice-panelet v1.13.115, Voice PE forbundet og ingen
aktiv samtale. Alpha ON, UI4s og device-bekræftet Hey Chat + Hey Jarvis er
kontrolleret; boot/watchdog/autoupdate er bevaret. Firmware .112 er uændret;
den eksisterende native aktivitetskontrakt er tilstrækkelig til denne rettelse.
Screenshotbevis: /private/tmp/pv115-installed.png. Den installerede rootfs-v1-
hash er ikke aflæst; image-digest må ikke udlægges som denne hash.

Fysisk gate-status for samme .115: frisk automatisk afslutning med TV,
bevaret opfølgning, lydhale, LED-sluk og næste wake AFVENTER brugerens
normale prøve. Ingen ny golden chain eller 10/10 er bevist. Software er
rettet, reviewed, merget, publiceret og installeret; produktaccept er ikke
opnået endnu. Automatiske logs er aktive. Talk forbliver parkeret; ingen
nye lydklip/providerprøver eller settings-/firmwareændringer er startet.









Fysisk feltresultat 6/10 efter installation af .115: brugeren bekræfter automatisk
LED-sluk i første prøve, dernæst med Jørgen Leth/Simpson-baggrundstale og høj Dua Lipa.
Alle tre gemte manifests bekræfter reason=app-idle-timeout, playback_finished,
teardown_complete, wake_rearm_recovered og led_command IDLE/on=false. Det er
appstyret inaktivitet, ikke modelsemantisk farvel. Samme .115/rootfs-v1
`efa60669826c99d0989e6fe651a865e6ad9abbe9a53c1a7750567203f673d5d7`, firmware
`podvoice_build_113112_liveclosing1`, contractOK, gain16, uændret custom prompt.

Tider fra samme gemte at_ms-clock (gul er korreleret LED-TX-ACK, sluk er kommando):
- 11:38 trace `20261006T113807-020-99782ffb`: gul +14634 → preclose elapsed +21508
  (6.874s); providerterminal +22433; playback-finish +22905; rearm +23455;
  sluk +23457. Gul→sluk 8.823s. Idle4s var allerede færdig før gul.
- 11:39 trace `20261006T113934-135-58e7bbad`: gul +21888 → elapsed +23935
  (2.047s); terminal +24978; playback-finish +25448; rearm +25870; sluk +25871.
  Gul→sluk 3.983s. Brugerens baggrundstale-prøve afsluttede selv.
- 11:41 trace `20261006T114105-249-fe85b4b8`: gul +43985 → elapsed +48801
  (4.816s); terminal +49839; playback-finish +50335; rearm +50754; sluk +50756.
  Gul→sluk 6.771s. Brugerens høje musik-prøve afsluttede selv, langsommere.
  Ready4.01s ved +48756 samtidig med shadow VAD=active: rå tale har intet veto.

Restfejl: den gule fase er ikke stabilt2s. I første prøve nulstilles quiet-count
210→212 efter zero sample_count0/output_valid=false +16401, igen214 efter samme
provisional-grænse +17123. Nyt fuldt4s quiet-vindue kræves af _live_quiet_ready()
inde i den allerede synlige2s fase; count0 må ikke selv godkende stilhed, men denne
kobling forlænger no-go-fasen. Musikprøven viser samme baseline-reset1102→1104
under gul. Native/outputejerskab og ingen ny audible output skal undersøges samlet
før en afgrænset ny rettelse; ikke forlænge/skjult forkorte UI4s eller fjerne
fysisk dræn. Providerterminal tager ca0.923/1.042/1.037s, derefter faktisk stream-
finish/rearm; denne nødvendige kæde forklarer også ~1.94s efter den gule grace.

Bevisgrænse: manifests er incomplete med henholdsvis191/139/149 tabte kommandoer;
ingen rumoptagelse eller komplette nye golden/10/10. Senere registrerede wakes
beviser at næste samtale kunne åbne, ikke hele acceptmatrix. Intet runtime- eller
settingsdiff er lavet ved denne read-only feltgennemgang. Reducerede private
indholdsfrie uddrag: `/private/tmp/pv115-field-20261006/closure-summary.json`.

## 1/10 — aktiv beslutning: én GPT-Live, appstyret inaktivitet

Lead/root. Brugeren har afvist en ekstra AI-vurdering. Den åbne GPT-Live ejer
henvendelse, baggrundstale, svar og semantisk farvel; ThinSession ejer mekanik,
gemt timeout og én close/drain/rearm. Installeret baseline er fortsat add-on
.113 / firmware .112 / Alpha ON / UI 4s. Ingen .114 er installeret eller fysisk
godkendt. PR90 med ekstra audio-klassifikator er lukket som opgivet.

Observeret fejl: ved TV-prøven kom ingen ny opgave fra GPT-Live, men rå
firmware-VAD og transcriptfragmenter holdt den lokale timeout åben og kunne
forkaste END. Der findes ikke et dokumenteret typed addressedness-/thinking-
done-event. Rå tale er derfor ingen ubegrænset autoritet for fortsættelse.

Den første native hypotese blev modbevist og STANDSET: instructions.append ved
idle gav ACK, men ingen backendresponse/END og 28.800 nonzero PCM-bytes efter
checkpoint. Kendt 2+2-input/svar, én Live-forbindelse, 0 retries, ingen hjemmelyd,
HA-handling eller audio-judge; ren providerlukning og 22,0s voiceforbrug.
Source 38ffef5b003ce98dbebcd4d64094038916708027574660b9639d689f60b62b74,
driver 32f26a4f1cf22224b404126758733935f0276b8bafa2057081a52de9546ce275,
manifest d8f1929b5a8e988322eefa8c66ffb36069bd873c111b57fb35658e825231cc45.
Privat rapport /private/tmp/pv114-native-primary-quiet-1001a/report.json (0600).
TV-prøve/release/install blev ikke gennemført; .113 blev startet igen bagefter.
Denne prøve kvalificerer IKKE den nye source. Append-ACK er ikke modelbeslutning.

Revideret årsagsgrænse før ny kode: OpenAI placerer inaktivitetslukning hos appen.
En ekstra obligatorisk model-END ved timeout var en forkert afhængighed.
Falsificerbar hypotese: efter faktisk mixerforbrugt assistant-svar, frisk
assistant-outputro og intet krævet backend-/værktøjsarbejde kan UI 4s starte den
allerede godkendte synlige 2s afslutningsfase, også under TV. Nye observerbare
svar/opgaver, tekst og Stop/generation skal annullere den gamle timeout.
Semantisk END har sin egen completed-batch/resultat/continuation-receipt.

Berørt kæde: firmware mic → samme Live-lyd og fortolkning → faktisk announcement-
output ved mixer → gemt idleperiode → eksisterende .112 native LED-service med
nonce/capture/token/TX-sequence → 2s fra korreleret TX-ACK → eksisterende provider-
close → eksakt fysisk drain → teardown/rearm → næste wake. På begge sider testes
ny lyd/backend, forsinket LED-ACK, Stop under provider-close og stale næste session.
Invarianter: ThinSession eneste ejer; Live ejer betydning; ingen fabrikerede tur-
eller audio-done-events; completed batch før handling/lifecycle; approval/input-
currency for handlinger uændret; frisk fysisk output; én teardown og rearm; OFF
uændret. Talk er en separat adapter og arver intet rumbevis.

Faktisk ændring: mandatory idle-append/checkpoint-END er fjernet. Native idle
bruger output/work-clock, ikke raw-TV-veto. Automatisk oprettelse af audio-judge
fra settings er fjernet. Live-instruktionen tydeliggør samme primære models
fortolkning og separat app-timeout; OFF-prompt/schema uændret. Model-END kan
ikke ophæves af rå transcript alene; faktisk ny backend/svar eller tekst kan.
Ingen allerede udført handling gentages efter resultat-/fortsættelsesfejl.

Afslutningsfasen er bundet til den eksisterende .112 LED-TX-ABI, ikke panelstatus.
Kun callback-provenance metadata aktiveres; overgangens plain PCM bevares, intet
same-breath-bufferreset/dræn eller audio-judge. Manglende capability/ACK giver
teknisk ubekræftet lukning, aldrig påstået synlig succes. Korreleret ACK starter
2s; handshake, kommandoadmission og efterfølgende provider/drain er særskilt tid,
så dette er IKKE et løfte om samlet 6s fra sidste ord til slukket LED.

Tre owner-races er rettet: cancelled ACK sender exact-token cancel før sen TX kan
påvirke næste session; committed idle-finalizer overføres synkront til eksisterende
_goodbye-ejer, så sen providerlyd ikke annullerer dræn, mens Stop stadig cancel/
joins den; efter awaited native cancel genmales aktuel LED kun ved samme session/
provider/native generation. Firmware ændres ikke; genbrug installeret .112 med
amp-boot, gains, VAD og wake uændret. Ingen blind genflash.

Ikke-mål: ny AI, motor, transport, lokale fraser, gain/VAD/wake-tuning eller skjult
højere UI-timeout. En ufærdig henvendt ytring/stille primary-tænkning kan stadig
ligne TV uden observerbar opgave/lyd. 2s er reaktionstid, ikke forståelsesbevis.
Lang tale og spørgsmål lige ved grænsen kræver provider-/rumbevis; en grøn test
kan ikke garantere bevaret første ord. Talk idle/dræn er fortsat ubekræftet og
må ikke beskrives som løst af native ændringen.

Planlagte regressioner/gates: TV under END og idle; ingen rawcurrency-undtagelse
for handling/approval; faktisk ny lyd/backend; stale/duplicate/out-of-order efter
Stop/generation; plain PCM under metadataopt-in; delayed/cancelled LED-ACK;
provider-close blokeret → Stop → frisk wake; samme Thin-kontrakt og modsat adapter/
OFF. Uafhængigt adversarial source-review, relevant fast, ændret prompt kræver
fokuseret live-gate, derefter én releasegate på frosset diff og exact CI/artifact.
Rollback installeret .113 med samme .112 firmware; arver ingen fysisk godkendelse.

Resultater indtil nu: den nye samlede fast-kæde består Ruff/format/Mypy55,
integration63,02s og unit115,96s; samlet116,3s. Relateret Live/idle/panel/native-
adapter-suite består også. Uafhængig review har accepteret finalizer/Stop-ejerskab
og korreleret TX-countdown; sidste cancel/repaint-delta har separat GO, inklusive
gammel cancel → ny preclose i samme generation uden gammel genmaling. Tidligere fast/providerprøve arves ikke. Releasegate er IKKE kørt,
ingen ny PR/merge/publicering/installation, ingen frisk fysisk golden/10/10 eller
provider-godkendelse af denne source. Kandidaten er ikke fysisk testklar eller 97/100.

Fokuseret native-promptprøve før release: præcis to eksisterende syntetiske
baseline-cases (real-followup, tv-ongoing-query), samme shippede Thin/Live og
installerede SDK3.13.0. Én primary ad gangen, 0retry, max140s og stop ved første
FAIL/UNKNOWN; ingen implicit eksperimentpolicy, hjemmelyd, HA eller musikhandling.
Reviewet one-use private handoff og pinned source/driver/fixtures før/efteradmission;
HA pauses eksklusivt og genstartes bagefter. Prøvens scope er syntetisk samtale-
semantik; fysisk idle/LED/rumhenvendelse forbliver UNKNOWN. Dette er endnu en
planlagt gate, ikke et resultat. Ingen betalt request kørt på denne source endnu.

Fokuseret providerprøve faktisk gennemført: begge baseline-cases OBSERVED_PASS,
known-input/output/timing/fixtures/clean-shutdown/final-usage true, én forbindelse
per case, 0END, ingen runtime faults eller domænehandling. Source3457a444c89157da4171fecc8cd347798fb1cc7095850fab05b87acfc7662e46,
driver24bd4c80bda1a3f8fc8ca170f8eae93b4835a7b5d8abd4cdd2d82518baf3625a;
manifest uændret d8f1929b5a8e988322eefa8c66ffb36069bd873c111b57fb35658e825231cc45.
Privat rapport /private/tmp/pv114-current-primary-1001b/batch-summary.json (0600).
Dette kvalificerer current Live-prompt og faktisk Thin/provider samtalesemantik;
rig har null-sink/syntetisk capture og beviser IKKE native fysisk idle/LED/dræn.
Ingen ekstra audio-judge, retries eller hjemmelyd. HA .113 genstartet efter prøven.

Ny causal grænse før sidste mekaniske rettelse: PRE-commit preclose-ejeren ryddes
synkront ved cancel, men dens finally kan stadig afvente nativecancel. Den var
ikke joined af teardown og kunne overleve rearm, også efter tidligere output-
cancel. Kandidaten stoppes ved denne owner-grænse indtil en lille specifik pending-
preclose-owner-ledger bevarer alle disse tasks til done og eksisterende bounded
teardown join'er dem før rearm. Ubekræftet join skal give teardown incomplete/
readiness false; ingen generel task-/samtaleomskrivning. Regression: blokeret
nativecancel → Stop → ingen rearm/nywake før join eller synligt boundedfault.
Denne rettelse ændrer ingen Live-prompt, SDK, audio/turforståelse eller værktøjer;
den allerede beståede promptgate skal ikke genkøres på gæt. Sourceidentiteten
fra providerprøven bevares særskilt fra den kommende frosne owner-fix.

Den sidste PREcommit owner-fix er implementeret og uafhængigt source-GO:
pending-preclose-taskset bevares fra spawn til done, inkl pensionerede tasks;
bounded join efter provider-close og før rearm indgår i teardown_complete.
To causal regressioner består: blockedcancel stopper rearm/nywake til join,
og jointimeout giver incomplete/readiness false. Relaterede syv testfiler og
Ruff/formatter/diffcheck består. Ingen prompt-/SDK-ændring efter providerprøven.
UI-legendens tekst er rettet til gul 2s app-afslutningsfase versus faktisk
slukket samtale; ingen ny UI-lifecycle eller kontrol. .114 changelog angiver den
fysiske usikkerhed. Det samlede produktdiff fryses nu før én fuld releasegate.

Release-admission på frosset62aff967 stoppede før tests: candidate-scope klassificerer
realtime_semantics+rearm som uafhængige domæner. Det aktuelle reviewerede diff er
én kausal close-kæde, men ingen eksisterende exact-tree coupling-admission dækker
netop dette tuple/surface-snapshot. Ingen runtime-patch fra gatefejlen. Tooling
rettes separat og afgrænset: kun native app-close surfaces+kausale regressioner,
samme pinned hele produktionstræ, base og uafhængig reviewer; andre domæner eller
manglende tests skal stadig afvises. Regressionen skal afvise stalefingerprint,
HA/firmware/audio-scope og manglende regression før coupling kan åbne. Kun den
fejlede admission og endnu ikke gennemførte downstream gates genkøres; bestået
format/runtime/providerbevis genkøres ikke uden ændret relevant scope.

Tooling-delta og hele produktionstræet har separat uafhængigt GO. 39 scope-
regressioner består; eksakt couplingfingerprint nedenfor er reviewerens godkendte
bytes, ikke en generel waiver. Første releaseforsøg stoppede ved admission;
Mypy/unit/integration gennemførte ikke, og deres resultater arves ikke. Det nye
frosne diff genåbner admission og de nødvendige downstream checks. Ingen runtime-
ændring er begrundet af gatefejlen.

Historisk scope-godkendelse for .114 (ikke en aktiv admission for .115):
```json
{"base_tip": "a8cbe5117ad67ec6368e4a292df8263ffb4b0884", "domains": ["realtime_semantics", "rearm"], "fingerprint": "c6d821bd1c2d3df078d201a41100c83bf88e53372631fcdbd74d1dc0245853e3", "merge_base": "a8cbe5117ad67ec6368e4a292df8263ffb4b0884", "rationale": "One reviewed Live interpretation/native app-timeout close chain: exclusive semantic END, correlated visible LED phase, exact cancellation cleanup joined before rearm. No firmware, VAD, transport or HA-tool tuning.", "reviewer": "independent agent /root/ui_live_status_map", "version": 1}
```

Den ene gennemførte fulde releasegate er grøn på fa78bc17b030494320df6593dedc3722c5812665:
exactcoupling/Ruff/format/Mypy55, integration64,80s, unit118,44s; samlet118,8s.
Frozen produktionstræ c6d821bd1c2d3df078d201a41100c83bf88e53372631fcdbd74d1dc0245853e3
uændret efter gate; denne resultatpost er docs-only. Exact-head PR-CI/ARM64 og
publiceret mainartifact/install følger nu. Ingen fysisk gate eller 97-score arves.

## 1/10 — opgivet spor: ekstra audio-klassifikationsmodel (ikke installeret)

Lead/root. Direkte fejlbevis: .113 quiet returnerede rettidigt men uden tilladt
scalar-enum; indhold ukendt. Hypotese: én tvunget ordinary function-call giver
et validerbart resultat på samme audio-model. Vendor understøtter function
calling, ikke Structured Outputs; strict:false og strict lokal parser.

Berørt kæde: samme sealed source-PCM/kontekst → SDK/request → én datakuvert →
lokal validator → ThinSession beslutning → fysisk dræn/teardown/rearm.
Invarianter: Thin er eneste samtale-/lukkeejer; resultatet giver aldrig værktøjs-
autoritet; gamle/dublerede identiteter afvises; ingen rå VAD-veto; ukendt failclosed.
Modellen fortolker addressedness. Ingen ToolRouter-dispatch, tool-resultat,
fortsættelsesrequest, ny motor, retry, timeout/gain/firmware/tuning.

Samme model, PCM, observeret kontekst,2s absolute budget og16 outputtokens
bevares. Hvis functionframing ikke passer inden16 og finish length: STOP;
ingen salvage/automatisk tokenforhøjelse. Forced report_audio, parallelfalse,
én præcis enum-property. Parser kræver tool_calls finish, én kendt function,
bounded id/JSON uden duplicatekeys/NaN/ekstra keys eller blandet output.
Gyldigt unknown skelnes fra protokolfejl. Safe diagnostik kopierer ikke args.

Før en ny fuld udgivelse bruges eksisterende reviewet one-use loopback-handoff
med afgrænset audio-envelope-mode, kun samme packaged LiveEvalService-probe.
Samme private nøgleoverførsel,30s admission, source/fixturehash, eksklusivt
provider-vindue, max5/0retry/stopførstefejl, privat rapport og HA-genstart i finally.
Ingen ny credential/adgang, transport i produkt eller hjemmelyd. Handoff-mode
reviewes og testes før faktisk brug; ny batch kræver særskilt godkendelse.

Planlagte regressioner: actualSDK wire-shape/one HTTP/0retry/0continuation;
alle3enum og 0/2calls, mixedoutput, malformed/truncatedJSON, duplicatekeys,
usage/deadline/cancel/stale. Eksisterende Thin/fence og begge I/O-kæder bevares.
Astra uafhængig adversarial review før freeze/release; relevant gates én gang.
Rollback .113 samme firmware. Ny rigtig batch kræver særskilt godkendelse;
seneste godkendte batch er allerede stoppet ved første fejl. Guard0/ref tom
bevares indtil provider- og fysisk inputgrænsebevis. Ingen rumgate bestået.

Faktisk protocolændring: report_audio ordinary function-call, strict:false,
parallelfalse; lokal exactenum/strictJSON/onecall parser inkl malformedUnicode.
Same model/PCM/context/16token ceiling/2s/0retry. Ingen Thin/firmwareændring.
Astra uafhængig protocol GO efter37 actualSDK/probe/Thin tests. HTTP503 én HTTP,
parseroverrun afvises, alle semanticunknown/protocolinvalid grænser består.
Firmwareaudit: generated actualbuild audio/RMT bytes matcher .112; ingen konkret
flash nødvendig. Fysisk Closing→source-fence og meningsfuld svarlatens umålt.
Privat måleværktøj review afventer endpoint/proxy-override afvisning før adgang;
ingen betalt prøve eller runtimeaktivering kørt for denne kandidat endnu.

Astra final GO protocol+handoff:37 SDK/probe/Thin og43 handoff tests består.
Endpoint/proxy-override afvises før private admission og igen før dispatch;
caller-cancel fastholder første UNKNOWN og joined cleanup uden næste request.
JudgeSHA35491b69cdd3e4fef4b8a80c2bc01cc63b77b06efab3ce37acd9732a1e69d469;
handoffSHA2f803b6b9c70ca80fcef2794152ff0ba1e0f3dc86073e83cde9bcc064cbd98b6.
Fast første kørsel: lokalt socketbind blev sandboxafvist; integrationfejl var
PermissionError, unit sibling afbrudt: IKKE PASS. Ingen runtimeændring.
Samme fast med lokale testforbindelser består: Ruff/format/Mypy55,
integration60.99s,unit108.48s,samlet108.9s. Ny eksplicit godkendelse til max5
syntetiske klip ved OpenAI er anmodet og endnu ikke modtaget. Ingen paidcall.
Diff fryses nu efter uafhængig GO; én releasegate følger på dette diff.

Frosset kandidat264f25367c3af5fce86c533764d75454ec7b0e82 bestod én fuld
releasegate: single unclassified_runtime scope, Ruff/format/Mypy55,
integration60.83s,unit105.66s,samlet106.0s. Eksakt-commit CI/ARM64 følger PR.
Reviewet handoff-fingerprint aaebfe67ce1c766ad8f42cf21bfb3409f4a64efc7a1e9d74e42dae90b8b21a6a;
fast shippedmanifest23da76b13bf41f4653ba7fff8e8b2712e266525bf5d2b1bd6881b78965da74ff.
Der er ikke gennemført providerprøve, merge, installation eller aktivering af .114.
Installeret baseline forbliver add-on .113/firmware .112/Alpha ON/guard0.

Frisk betalt prøve blev eksplicit godkendt af brugeren og udført én gang mod
frosset source. Run eval-envelope-1790859139-84a4f5: quiet UNKNOWN,
reason deadline_exhausted,2.003225s. Ingen responseID/model/usage/formatmetadata;
årsagen inden for HTTP-kæden er UKENDT. Én attempt, ingen øvrige klip/retry.
Rapport /private/tmp/pv114-provider-envelope-01/report.json, cleanup joined.
HA var verificeret Stoppet før admission og Kører .113 igen efter prøve.
Nøgle kun privat browser/proceshukommelse, browservariabel nulstillet, ingen
ny nøgle/adgang oprettet. .114 er IKKE TESTKLAR; PR90 forbliver draft, ingen
merge/install/TV-aktivering. Eksakt PR-CI36863722599 bestod tests ogARM64;
softwarelaget kan ikke tilsidesætte providerfejlen. Installeret firmware .112.

Samlet årsagsgrænse opdateret efter read-only Astra audit: SDK-klienten oprettes
frisk før første HTTP-vurdering i probe. Voice PE's Live-websocket opvarmer ikke
samme klients HTTP-pool; produktionens første vurdering kan også være kold.
SDK/httpx idle keepalive5s betyder, at wake-prewarm alene ikke er et bevis/fix.
Det er en PLAUSIBEL komponent, ikke årsagen bevist af deadlinefejlen.
Ingen token-/deadline-/transport-/gain-/firmwarepatch på dette symptom.
Næste isolerede observation: én uændret quiet-request med SAME installedSDK/
2s/16tokens/0retry og fixedname HTTPX trace TCP/TLS/upload/headers/body/cancel.
Kun tider/faste enums, aldrig traceinfo/headers/keys/payload. Midlertidigt
målescript genbruger reviewet engangshandoff og packagedjudge, ingen motor.
Observeren reviewes og testes offline før én særskilt godkendt providerrequest.
Det skal skelne opkobling fra venten efter upload; sidstnævnte er ikke alene
inferencebevis. Ingen ny request godkendt eller kørt efter den stoppede batch.

Privat observer frosset/reviewet: /private/tmp/pv114-http-phase-probe.py,
SHA d0de02886126c265a249f75ce066315f2c4f05233020f3269607b701e42f1061;
binding1e661576cb26f2a5810650dad5ef1892d568b5f216f8e6a804d745f8b89c7a42.
Astra GO measurement-only;5 offline tests består. Én canonical POST,
0retry/redirect/prewarm, samme quiet/PCM/model/16tokens/2s; fixedtrace enums+
tider64max, ingen traceinfo. Caller-cancel fastholderUNKNOWN/boundedcleanup.
Rigtig TCP/TLS traceemission endnu umålt. Ingen listener/key/providerrequest
kørt. Ny særskilt godkendelse til ét quiet-opslag med observer anmodes;
ingen autorisation udledes af den stoppede max5batch.
HA efter genstart14:53:52 identitet .113/a8cbe511/rootfs7b947d5b verificeret;
native .112-marker+contract OK og dualwake bekræftet14:53:55. Alpha ON,
timeout4s og ingen aktiv samtale genbekræftet i UI. Installeret løsning gendannet.

Fysisk inputgrænse genvalideret mod faktisk .112 buildsource: I2S RX har
4 DMA-descriptors á256frames ved16kHz (64ms nominelt); mic-task læser derefter
PCM og kalder sourcecallback. Samplefencen læser produced_samples i denne
callback, ikke ADC-tid. Derfor er64ms kapacitet ingen målt guard/maxlatens.
Eksisterende local-only kalibrator venter på fysisk wake/button og kræver kendt
lyd+video af ringens synlige Afslutter-grænse. Den må ikke starte provider eller
opfinde synligt F ud fra softwareACK. Ingen ny firmwareændring begrundet.
Kalibratoren er IKKE kørt; ingen fysisk måling eller aktiveringsreference skabt.
Der er ingen bekræftet igangværende prøve/job at vente på. Den ene nye
OpenAI-observation afventer fortsat eksplicit svar på det konkrete spørgsmål;
automatisk goal-continuation er ikke betalt-kald-autorisation. Ingen ny APIrequest.

Bruger godkendte ét quiet-kald med HTTPfaseobserver. Udført én gang:
/private/tmp/pv114-http-phase-trial-01/report.json,1HTTP/0retry,1.860258s,
cleanup joined. TCP43.3ms+TLS20.8ms; uploadfærdig292.3ms, headers1845.1ms
(1552.8ms efter upload; IKKE inferencebevis). Model gpt-audio-1.5,350tokens,
defaulttier. Én kendt report_audio-call,22byteargs/ingen content, men finish stop:
finish_reason_not_tool_calls. Prøven er fortsat UNKNOWN: args blev ikke valideret
eller gemt efter tidlig reject; byteantal er ikke semantisk resultat.
HA-cloud kort utilgængelig ved restore, siden genoprettet. Add-on .113 Kører,
startup15:26:10/rootfs7b947d5b, native15:26:14/marker113112/contractOK/dualwake.
Ingen .114-installation/aktivering. Tidligere deadlineårsag stadig ukendt.

Opdateret årsagsgrænse FØR kode: faktisk audio-model returnerede stop+én kendt
call, validator krævede tool_calls-marker. Official ChatCompletions beskriver
tool_calls; ingen dokumenteret audio-undtagelse. Installeret SDK-parser afviser
length/content_filter og behandler message.tool_calls uafhængigt af stopmarkør.
Astra read-only GO til snæver kompatibilitetspolitik, ikke vendorgaranti.
Hypotese: begge afsluttede markører kan bære fuldt validerbar klassifikation.
Hele kæde genlæst: sealedPCM/context → SDK → validator → Thin identity/work/
deadline → relevant-preservation eller background-finalize → dræn/rearm.
Ingen request/model/prompt/tokens/deadline/firmware/Thinændring, dispatch/retry
eller salvage af gammel prøve. UNKNOWN failclosed. Kun exact gpt-audio-1.5
accepterer stop/tool_calls OG alle øvrige checks; faktisk finish bevares.
Regression: begge marker×alle3enum, malformed-matrix begge, actualSDK wire-
uændret/cancel/stale/timeout. Diffreview før ny freeze; fast og release efter
freeze. Rollback .113. Provider/fysisk gate IKKE bestået; guard0/ref tom.

Faktisk kompatibilitetsrettelse: kun validate_response ændret til stop/tool_calls;
request/judge identity/deadline AST-uændret. Astra uafhængig diff-GO:16 actualSDK-
tests består, alle malformed-grænser under begge marker, ingen P1/P2 uløst.
JudgeSHA176daccc075987c8e5b37dbb0571072a57004fc21a34cf6484b769bc9cc7ab95.
Fast på denne rettelse består Ruff/format/Mypy55, integration61.17s,
unit106.17s,samlet106.5s. Full release efter ny freeze følger; gammel gate
arves ikke. Ny guarded max5providerprøve er anmodet og IKKE godkendt/kørt.
Ny handoffbindingadbd546db5bee7ae046e424cebd7fac62721a2205bacd94b18b11a9eb97f7765.

Ny frosset runtime18fd7a515e1bacf5c233d21151e84adcf2fe8490 bestod sin ene
fulde releasegate: scope single unclassified_runtime, Ruff/format201/Mypy55,
integration61.24s, unit100.04s, samlet100.3s. Næste step exactcommitCI/ARM64,
og særskilt godkendt max5prøve. Ingen betalt prøve efter observerkaldet.

Exact-kandidat1cab1d183fa038e147897bb4c4cbf58bf6d57edc: CI36869909505
success, lint-test2m50s/ARM64build3m13s, publish SKIPPED som draft-PR.
Der er ikke publiceret en .114mainartifact. Firmwarediff mod installeret main
har ingen firmwarefiler; faktisk eksisterende OTAsha genverificeret
1445c2f9592d36b08734019f4e8434dff1b0591c9c32e4229c7e8e7101d3a4be,
actualbuild113112-marker og4×256 DMAframes genlæst. Det er lokal bytekontrol,
ikke ny fysisk gate. Ingen gentagen compile/flash eller gain/VADændring.
Menneskets svar på den særskilte rettede max5prøve mangler stadig. Ingen nye
OpenAI-kald, nøgleadmission eller jobs startet. Efter CI er der intet live job
at vente på; softwarebevis er fuldført, provider/fysisk bevis mangler.

Brugerens Ja til prøve godkendte den rettede max5batch. Første30sformular
udløb før nøgleadmission (exit2: No credential accepted; no provider started).
Ingen APIretry: samme godkendte batch fik ny formular med deterministisk samlet
browseradmission. Denne accepterede nøglen og kørte én sekvens, ikke en gentaget
betalt prøve. Run eval-envelope-1790863759-d87d82 stoppede første quiet:
2.003714s/deadline_exhausted, ingen response/model/usage/formatmetadata.
Rapport /private/tmp/pv114-provider-compatible-02/report.json, attempted1,
0retry, cleanupjoined, exactjudge176daccc og bindingadbd546d. TV/directed/aside/
boundary-klip blev IKKE sendt. .114 er fortsat IKKE TESTKLAR; ingen merge,
installation eller aktivering. Førsteformularens tomme output er ikke en APIfejl.

STOP-THE-LINE efter samlet timingaudit: to quiet-deadlinefejl og én afsluttet
1.860s request (kun140ms tilbage før fysisk guard/fence) modsiger påstanden om
pålidelig2scriticalpath. Ikke bevis for at alle calls skal være>2s. Den eneste
phasetrace viser64msTCP/TLS,1553ms efter upload; blindprewarm ikke begrundet,
og de to deadlines har ingen trace. Cause inden for server/netvent er ukendt.
Ingen skjult forhøjelse af UI4s eller produktClosing2s og ingen symptompipelinepatch.
Astra read-only anbefaler ét observeret uændret quiet-kald med en udtrykkelig8s
LABgrænse og2s som produkteligibilityreference. Late svar er observation uden
Thin-autoritet; noresponse8s er fortsat ukendt. Tempværktøj forberedes/reviewes
offline, packagedrequest/strictparser genbruges. Ingen yderligere callgodkendelse
udledes af den stoppede batch. Hele kausale kæde/rollback/fysiske gates bevares.

Efter batch: HA .113 Kører, startup16:11:29 rootfs7b947d5b/a8cbe511.
Nativeconnection16:11:32, firmware113112/contractOK og dualwake bekræftet.
UI genbekræfter Alpha ON/timeout4s/ingen samtale. Nøglevariabel nulstillet,
ingen ny credential/nøglelagring. Screenshot pv114-after-compatible-batch-alpha.jpg.

Labobserver klar/reviewet: /private/tmp/pv114-http-lab-probe.py,
SHA251c91d910de56d2563a2a31b3be6a851ff6313118515bd7143c064a75dff074;
binding9f89684228e1530e8c2332a88034829a3cd61e96041be220eea3c92a3f3a1ba3.
Astra GO til én særskilt godkendt måling;7 focused actualSDK tests består.
Exactpayload lig packaged2sjudge, fast8sLAB/0retry/onecanonicalPOST, ingen
produktion/adgangsflytning. within_production_budget beskriver kun requesten,
ikke totalfysiskguard/fence; latevalid giver nul runtimeautoritet. Separate2s
cleanup, source/environmentchecks før/efterprivatadmission, fixedtraceprivacy.
Ingen call/admission kørt; ny eksplicit godkendelse anmodes. Ingen nye runtime-
ændringer, softwaregates eller PR-CI-genkørsler begrundet af denne tempmåling.

## 1/10 — .113 diagnostik af den afviste lydvurdering

Lead/root ejer denne afgrænsede ændring. Installeret .112 og firmware113112
forbliver Alpha ON med ny TV-closure inaktiv. Rigtig .112-probe gav quiet
UNKNOWN/invalid_response på1.18s og stoppede uden retry. Den detaljerede årsag
kan ikke genfindes: UI skjuler run-id; status uden id returnerer kun fuldprofil.
Hypotesen er et observerbarhedshul i validator/rapportgrænsen, ikke en bevist
fejl i modelvalg eller svarsemantik. Ingen valideringsregel lempes på gæt.

Berørt kæde: fast syntetisk lyd → faktisk SDK → eksisterende strictvalidator →
identitetsbundet rapport → Test-panel/retained read-only status → diagnostisk
lease release → næste wake. ThinSession, inputfence, timeout, streaming, Stop,
værktøjer, prompt/model og firmware ændres ikke. Risiko: en subsetrapport må
ikke blive fuld releasepreflight eller udløse en ny request under reload.

Ændringen giver præcis begrænset reason-code for hvert eksisterende reject,
sikker strukturmetadata uden responseindhold/nøgler og eksplicit genfinding af
sidste audio-idle-probe. UI viser id og returned model. Regressioner skal bevise
samme acceptance/rejection, intet privat responseindhold, samme rapport ved
reload, nul nye requests og uændret idløs fuldrapportadmission. Uafhængig review,
relevant fast/releasegate og ét normalt release/installflow følger frosset diff.
Rollback er .112 på samme firmware; ingen TV-aktivering eller fysisk accept
udledes af diagnostik. En ny betalt prøve kræver brugerens særskilte svar,
fordi den første godkendte batch allerede stoppede ved første fejl.

Faktisk ændring: validatorens eksisterende afvisningsgrænser giver specifikke
faste årsager og en bounded strukturprojektion uden generatedcontent/refusaltekst.
Sidste audio-idle-rapport kan genfindes ved eksplicit kindGET og præcist run-id;
generisk fuldpreflight er uændret. Subsetretention må ikke invalidere fulde beviser.
UI viser run-/model-/kodeidentitet og rapportlink og genfinder med read-onlyGET.
Astra fandt én P2-race: forsinket reloadstatus kunne overskrive nyere brugerstart.
Generation guard ved alle fire awaitgrænser og den faktiske shippede JS-regression
lukker den. Astra final GO; ingen alvorlig uløst finding. 197112/113-strukturcases
gav nul forskel i acceptance. 11 actualSDK-prøver,11 probe/render+10 HTTP-prøver
og seneste3 causalUI-prøver består. Request, prompt, model, deadline, retries,
lease, ThinSession og firmware er uændrede. Firmware113112 genbruges.
Fast: Ruff/format/Mypy55 og integration61.86s består; unit blev termineret af
120s toolingbudget ved cirka94% uden testfejl og er IKKE bestået. Ingen runtime-
patch følger dette. Én normal frosset releasegate med eksisterende240s-budget
skal bevise hele unit/integration; gate-timeout er ikke produktevidens. Scope
PASS single unclassified_runtime. Betalt gentagelse afventes stadig som en
særskilt godkendt prøve, ikke automatisk retry af den stoppede batch.
Frosset kandidat5c66c5d0764a659a186bd1ad3323841d01a8850f bestod den ene fulde
releasegate: scope, Ruff/format201, Mypy55, unit112.35s, integration og samlet
112.7s. Fastunitens tidligere procesforsinkelse gav ingen reproduceret produkt-
fejl; originalårsagen forbliver UKENDT. Ingen deadlineværdi eller runtime blev
ændret for at få gaten igennem. Dette er softwarebevis, ikke provider/rumbevis.

Faktisk release/install: PR89 merged, main a8cbe5117ad67ec6368e4a292df8263ffb4b0884;
PR-CI36858133610 og main/publish36858697492 grønne. Image
sha256:710d60ea353851f20882fad9450f902762cd0842ef2022f72910c5eded3d69e5;
context f8a59e28cf88b8615eafc40ec74bf01e88d6889c72d70e2966128ff2ce5b5d7c.
HA .113 startup14:06 og rootfs-v1:7b947d5b0ad690f7b6495f63e648c997c07b53dc731b102ddaf95445923023c2
verificeret. Firmware .112 podvoice_build_113112_liveclosing1, dual wake og
Alpha ON bevares. TV-closure stadig INAKTIV: guard0/ref tom, ingen fysisk gate.
Brugerens nye afgrænsede batch blev brugt én gang og stoppede efter første quiet.
Run eval-1790856552-de3d7f:1.059336s UNKNOWN/verdict_not_exact_enum. Model
og øvrig protokolmetadata gyldig; finish stop, string16 tegn, outputtext1 token.
Generatedtekst blev ikke gemt; dens indhold/årsag er UKENDT. Cleanup joined,
TV/positiv/grænseklip IKKE kørt. Dette er et formatfejlbevis, ikke semantisk
klassifikationsbevis. Ingen automatisk retry eller aktivering følger.

## 1/10 — HA-adgang genetableret, native idle-prøver afsluttet

Frisk browser viser PodVoice v1.13.110 Kører; lokal HA-adresse svarer HTTP 200.
Brugeren oplyser HA Green online igen. Ingen runtime eller firmware er opdateret.
Det gemte og reviewede native idle-check er nu afprøvet mod rigtig provider;
begge afgrænsede forsøg gav UNKNOWN (se resultater nedenfor).
Den tidligere reviewede private engangshandoff genbruges med et eksplicit
`--idle-check`-valg: højst quiet og TV, ingen gamle semantikforsøg eller automatisk
retry. Script/manifest-hashes bindes før key-admission og hvert barn. UNKNOWN
stopper batchen. Formens adgangs-/origin-/udløbskontrakt og privat procesmiljø
bevares. Handoffændringen reviewes før nøgleoverførsel. HA stoppes kun i det
godkendte eksklusive vindue og genstartes straks efter prøven, også ved fejl.
Målet i Goal-værktøjet er fortsat registreret BLOCKED; genoptagelsen ændrer ikke
objektivet. Resume af selve goal-status kræver klientens målbetjening; arbejdet
fortsætter her på brugerens genoptagelse.

Første native prøve `pv-native-idle-trial-1001-01`: quiet UNKNOWN, én forbindelse,
korrekt kendt "Hvad er to plus to" → "Det er fire". Sidste nonzero provider-output
6,889 s; check10,909 s; eksakt append-ACK11,608 s, provider timeline7800–8000 ms.
Ingen delegation, backendrespons eller verdict gennem observationsslut15,609 s.
Resultatet er negativt protokolbevis før resolveren, ikke en afprøvet dårlig
henvendelsesklassifikation. Cleanup og finalusage bestod;12 Live-sekunder,
ingen backendforbrug. TV-prøven blev korrekt ikke kørt. Rapport/timeline:
`/private/tmp/pv-native-idle-trial-1001-01/native-idle-quiet/`.
Nøgle var kun i browser-/proceshukommelse; browservariabel ryddet, form lukket.
HA blev verificeret Stoppet før overførsel og Kører igen straks efter batchens exit3.
Den private handoffændring havde uafhængigt GO før brug;71 målrettede tests
og fastgate (unit94,39 s, integration58,46 s, Ruff/format/mypy) bestod.

Native steering-kandidaten er **ikke testklar til runtimeaktivering**. Frisk
officiel dokumentation bekræfter steering/context injection, ikke tvungen
delegation eller machine-visible afgørelse:
https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update
https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model
Uafhængig reviewer anbefaler præcis én afgrænset opfølgning: hypotese er, at
checket blev behandlet som tavs samtalestyring, ikke en backendopgave. Varianten
skal i frontend, backend, tooldescription og append beskrive samme konkrete,
maskinsynlige registreringsopgave med request-id og lyd-/kontekstvurdering.
Samme model, fixtures,2 s-budget, fulde korrelationsorakel, timing og stillekrav.
Ingen tvungen response.create, retry, tale eller lempet gate. Første resultat
bevares. Ved endnu en UNKNOWN stoppes native append-retningen; en separat
eksplicit audio/context-vurdering kræver en ny beslutning før implementering.

Record-task-opfølgningen `pv-native-idle-record-trial-1001-01` gav også quiet
UNKNOWN: korrekt åbningsinput/output, én forbindelse, ingen backend/verdict,
stille check, clean shutdown og komplet forbrug. TV blev ikke kørt. Rapporten
binder `protocol_variant=record-task`. Produktionen .110 er igen verificeret
Kører; formular lukket. Native append-retningen er stoppet efter det aftalte
andet UNKNOWN; ingen runtimeaktivering. 79 målrettede tests bestod. Den seneste
fast-log viser kun unit-stadiet (83,59 s), ikke en fuld fast-gate; dette må ikke
rapporteres som fuldt gatebevis.

## 1/10 — godkendt endelig inputgrænse for den næste afslutningskandidat

Efter Astra-review af den uklassificerede lydhale har brugeren eksplicit godkendt
én synlig Afslutter-fase: spørgsmål påbegyndt før den fase bevares; nyt spørgsmål
påbegyndt efter dens start kræver Hey Jarvis igen. Denne produktgrænse afløser
kravet om ny relevant input helt frem til teardown-commit. Fire sekunders UI-
opfølgningsvindue plus højst to sekunders kandidatbudget til en enkelt afgrænset
lyd/kontekstvurdering er nu godkendt som start af brugeren. To sekunder er en
øvre beslutningsgrænse, ikke fast søvn; faktisk latency og fysisk lukning er umålt.
Native append gav ikke maskinsynlig beslutning og må ikke aktiveres. Alternativet
skal først bevise en isoleret stateless audio/context-protokol og en finitiv
inputgrænse; den ændrede adfærd er endnu hverken kodet eller installeret. Rå
host-metadata er stadig ikke fysisk samplebevis. Ingen ekstra timer eller
parallel klassifikationspolicy må kobles ind som en skjult reserve.

## 1/10 — erstat native append med én afgrænset audio/context-vurdering

Brugeren kræver videre arbejde og iteration mod faktisk TV-lukning, ikke kun UI.
Lead bevarer samme ThinSession/close/rearm-ejer. Stærkeste direkte evidens er to
rigtige native idle-prøver uden maskinsynlig beslutning; den retning er stoppet.
Hypotese: én eksplicit stateless audio/context-request kan give korreleret
relevant/background/unknown inden godkendt højst2s ved én endelig Afslutter-grænse.
Rå aktivitet må ikke genstarte et ubegrænset vurderingsloop. OFF, prompt/tale,
værktøjsautorisation, fysisk Stop og firmwaregain er ikke mål for denne prøve.

Kæde før runtime: fixed PCM/context → rigtigSDK/request → identitetsbundet enum,
usage og deadline → Thin's fremtidige inputbevaring eller eksisterende lukkeejer →
fysisk drain/rearm/nywake. Manglende verdict må ikke fremstilles som background.
Før-F prefix UNKNOWN er konservativ abstention, ikke bevist bevaret samtale.
Host callbackorden er ikke firmwarecapture-fence; fysisk input/replay-gate er åben.
En stateless reviewer er ingen ny samtalemotor og må ikke dispatch tools/lyd.

Isoleret scratchkontrakt /private/tmp/pv-audio-idle-probe-draft:13 actualSDK/httpx2
probe-regressioner og6 wrapperregressioner består. Uafhængigt Astrareview GO ved
binding ac13fdbd5c1d02c69cda60ac3722c885dc602ade7d79e15266c02cffabba79e3.
GO gælder kun isoleret providerprøve via eksisterende private handoff og faktisk
verificeret eksklusivt vindue. Ingen nøgle/providerrequest eller runtimeaktivering
har fundet sted. Fixedbatch quiet,TV,directed-over-TV,aside,boundaryprefix; max5
calls,0retries; stop tidligt ved mismatch/UNKNOWN, sidste prefix må kun relevant/
unknown. Modellens identitet og audio-tokenusage valideres;2s indeholder prep/send/
parse,cleanup separat bounded. Rollback: behold .111 runtime uændret hvis kvalitets-
eller latensbevis fejler. Næste handling er konkret reviewedlauncher/rigtigprovider-
prøve og afgrænset runtime-fenceplan, ikke flere nativepromptvarianter.

Brugeren har godkendt max5 korte syntetiske OpenAI-calls via samme private
handoff. Scratchlauncher Astrareview GO ved SHA7c441523a68dc4cbaaf22bff485ec7ca730374d64c375c9032c5159855748bba;
wrapperbindingac13fdbd5c1d02c69cda60ac3722c885dc602ade7d79e15266c02cffabba79e3.
HAs gemte nøglefelt kan kun aflæses som maskeret værdi; ingen nøgle/providerrequest
modtaget. Privatkopiering valideret negativt og variabel ryddet; HA ikke pauset.
Brugeren afventer spørgsmål om klar til privatengangsfelt; kodearbejde fortsætter.

### Praktisk Afslutter-bevis — lille RMT-hook, ingen fiktiv clock-sync

Lead har valgt konkret soleadapter-API begin_live_closing(token, absolute
hostdeadline) med særskilt nativeadmission og identificeret LED-TX-done. Deadline
starter konservativt før kommandoen og forlænges ikke til ny2s ved ACK. Minimal
optional RMT-observer kræver pinned officielleddriver: TXdone ISR gemmer kun txid/devicebootstamp i intern SRAM under korte IDF
kritiske sektioner; mainloop publicerer korreleret fakta. Den faktiske S3-
compiler afviste lockfree antagelsen, som derfor ikke er kandidatens mekanisme. Closing
RGB/frame/nonce/epoch/token bindes til den faktisk sendte frame, gamle effekter og
Stop/mute/error må ikke kvittere nyt Closing. OFF observerdisabled, AMPbootuændret.
Ingen LightCall.perform/mark_shown fremstilles som synliglysgrænse.

Native capture fortsætter i samme consumer gennem eksplicit måltguard inden
samplefence. Nominal DMA64ms +RMT15ms er researchtal, ikke beviste maksimum eller
skjult defaulttuning. Actualguard skal bindes til måling/foruddefineret nearF-prøve;
loss/epoch/skift/overskredetbudget giver technicalUNKNOWN. Lidt konservativpostF-
overcapture er en eksperimentel risiko, ikke en samplepræcis analoggaranti.
Code-drafts /private/tmp/pv-alpha-close-draft og /private/tmp/pv-alpha-led-draft;
callbackledger15 smalle actualCPP/protobuf/adapter-regressioner og inactiveGO er
ikke fullESP32artifact eller fysiskreleasegate. Hele nyclosure stadiginaktiv.

Integreret uafhængigt Astra-slutreview er GO til eksperimentel installation
med guard0, derefter målt aktivering på samme artifact. Alle fem runtimefund er
lukket med kausale regressioner: rå transcripts, farvel uden for beslutningsbudget,
tvetydig replay-afsendelse, bounded kontekst og indgående PCM under finalisering.
23 målrettede regressionsprøver og seneste driver setup-failure/render-prøve består.
Fire full-fast kontraktfejl var gamle harness/pin/binding-antagelser, ikke påvist
feltfejl; alle24 tests i de tre berørte moduler består efter præcis opdatering.
Alle39 shippede komponentfiler matcher immutable source
083424b18b67c54698b16a148c79502f58480cd7. Final pinned ESP32-S3 build består
16,19s, config0xa899c506, build2026-10-01 12:45:09+0200.
Ingen fysiske gates er bestået for .112. Guard er0/empty indtil ekstern
lyd/lys-reference og native PCM/sourcefence beviser en målt empirisk før-F-dækning;
callback-sampletællere alene er ikke ADC-tid. Providerprøven på højst5 fixed
syntetiske klip er godkendt og findes i Test-fanen i samme kandidat med den
allerede gemte nøgle; ingen hjemmeoptagelser eller ny nøgleoverførsel kræves.
Én eksklusiv batch, ingen retry, stop ved første uklarhed/mismatch; faktisk SDK,
model/usage/deadline/kliphash og teardownforløb registreres. Målt guardref og
Alpha-valg gemmes på eksisterende settingsvej. Same ThinSession/VoicePELink ejer
hele afslutning/rearm; Talk/OFF, gain, wakeord og værktøjsautorisation bevares.
Fuld fastgate på stabilt diff består: Ruff/format, Mypy55, hele unit99,61s
og integration60,59s. Release-scope identificerer konkret manglende smal
reviewadmission for audio_input/physical_output/realtime_semantics-koblingen;
Tooling er opdateret i to filer med præcise surfaces/regressionskrav og samme
exacttree-binding;38 kausale scope-tests består, ingen runtimepatch.
Final OTA SHA2561445c2f9592d36b08734019f4e8434dff1b0591c9c32e4229c7e8e7101d3a4be.
Genereret audio/LED CPP/H matcher byte-for-byte den reviewede kilde. Præcis én frozen releasegate på a98f65daccf5e18272c3a981717ff379a4e07897
består: scopebinding, Ruff/format201, Mypy55, unit112,05s og integration61,41s.
Ingen kandidatændring under gaten. PR88 CI36852156763 byggede ARM64, men
én uændret Talk-Node-prøve overskred10s. Den eksakte CI-scriptbyte matcher
lokal script og består lokalt; timer-leak blev ikke bevist. Separat test-only
slutobserver kræver nu alle assertions færdige, nul reelle ventende timere,
naturlig procesexit og samme10s; ingen runtimepatch, exit-tvang eller deadline-
forhøjelse. De to berørte tests og Ruff består. Oprindelig CI-årsag er UKENDT;
ny automatiseret CI afprøver denne permanente observer. Produktionsfingerprint
og build-context er byteidentiske med frozen releasegate. PR88 ny CI36853245295 bestod både lint/test og ARM64 efter testobserver.
Merged main72e6b9427392a4200496e94eee16543dd945ed3c; automatisk main-CI/
publish36853626202 SUCCESS. Buildcontext2b14ffecf8fe3fe39e1611670bf73fc56e7597321d37c7c523530d7565fc3248;
imageghcr.io/bixelventures/aarch64-addon-podvoice:1.13.112 publiceret digest
sha256:23bf15ba875c22d55820e48a2ea06909594d34d4ef402af7be1c9a1d83f1d6d2.
Installation fuldført via HA med backup: installeret/latest1.13.112 og Kører
observeret i HA. Add-on blev verificeret Stoppet før officiel ESPHome OTA; samme
reviewede OTAartifact ovenfor uploadet til podvoice-pe-0a7e7a.local med OTA successful.
Ny startup13:28:13 lokal tid bekræfter version1.13.112,
git72e6b9427392a4200496e94eee16543dd945ed3c og
rootfs-v1:45f6c670997e1390d90c4c0b1dffac6055ac5b7e73b144af691e5ed71aa7ea6f.
Native13:28:17 bekræfter podvoice_build_113112_liveclosing1,
callback_source_pcm_v1, closing_led_tx_v1 og firmware contract OK. Begge wakeord
hey_chat_hey_jarvis er bekræftet af enheden. Gemte indstillinger er Alpha ON og
UI-timeout4s. Installation/genstart er bevist; unplug/replug og fysisk wake er
ikke prøvet efter denne OTA. Lokal startupkvittering:
/private/tmp/pv112-installed-startup.txt; installationsskærmbillede
/private/tmp/pv112-alpha-installed.png. Goal er igen ACTIVE med samme mål.

Den godkendte højst5-klips batch blev kørt præcis én gang i den installerede
.112. Den stoppede korrekt efter første quiet-klip: UNKNOWN,
invalid_response,1.18s. Ingen TV/positive/boundary-klip blev sendt og ingen retry
foretaget. Det er en dokumenteret protokolafvisning, ikke en bevist forkert
semantisk vurdering. Den eksisterende UI gemte ikke et synligt run-id/model,
og idløst reportGET viser idle; den detaljerede rapport er derfor ikke
genfindelig gennem den aktuelle understøttede UI uden det præcise run-id.
Uafhængig sourcegennemgang bekræfter dette observerbarhedshul. Det præcise
afviste responsefelt er UKENDT; modelalias/snapshot eller andet felt må ikke
patches på gæt. Synligt første resultat bevares i
/private/tmp/pv112-provider-probe-visible.txt. Ny TV-closure forbliver inaktiv
(guard0/empty); ingen fysisk gate eller løsning af feltfejlen påstås. Næste
afgrænsede ændring skal gøre samme protokolfejl og retainedrapport genfindelig,
før en ny godkendt providerprøve og fysisk inputgrænse kan åbne aktivering.

### Aktive kodegrænser før næste release

Astra har gennemgået hele kæden og mindst én nabogrænse: firmware forbruger PCM
og kan tabe det ved native send-failure; NativeMicFrame indeholder kun hostorden;
activity.sample_end er ikke mapping til transmitteretPCM. Lead beslutter minimal
sourceprovenance/fence i eksisterende firmware+VoicePELink, ingen transportændring.
Hypotese: samme captureepoch, transmitteret interval og synlig lokal afslutter-
fence med explicit tab kan bevare før-F input og afvise ukendt/drop fail-closed.
Code-draft er isoleret i /private/tmp/pv-alpha-fence-draft indtil review.

Thin skal have én attemptrecord og bounded history i sin eksisterende audio-
consumer; output-only4s ekskluderer rawinputrevision, bevarer work/output-blokkere.
Fencesetup,mute,judge og parse deles om samme2s. Relevant replay kun aldrig sendte
bytes; background bruger eksisterendefinalizer; UNKNOWN/error tekniskfejl uden
ny4s eller retry. Tool/confirmation rårevision beholdes; closure-only receipt
separeres i Thin og provider samlet. Ingen nye klassifikationstimer-ejere.
Regressioner før activation: preFforsinkelse/postF, TXtab/overflow, pending send,
stale/duplicateACK/verdict, Stop ved hverawait, præcisengangsreplay, farvel vs
nyinput, Talk ogOFF. Sourceændring kræver independentreview, firmwarecompile,
frozenrelease samt fysisk sammebits bevis; sourcefence og providerdeadline
stadigikke bevist. Ingen ny firmwareinstallation hævdes.

## 1/10 — enkel live-status på rumkortet (aktiv beslutning)

Brugeren beder om et dummy-proof UI og synlighed af hvilken logik der bestemmer
lige nu. Direkte evidens: eksisterende idle-diagnostik viser rå inputaktivitet,
output/work-blokkere og målt ro; panelet viser ikke denne forklaring. Lead: denne
tråds implementør. Hypotese: en læsende projektion af den eksisterende Thin-ejer,
med samme session/generation og friskhed, kan forklare ventetid uden en ny timer
eller skjult lifecycleændring. Kæde: native/browser input → Thin/provider/work →
output → eksisterende idle/end-policy → teardown/rearm → rumkortets status.

Invarianter: én Thin-ejer; model ejer hensigt; afspilning er fysisk sandhed;
stale/ukendt er aldrig klarhed; Talk og OFF bevares. Ingen klassifikation af musik,
AI-tanker, ekstra optagelse, ny lukningslogik, gain eller firmwaretuning.
Vis primær tilstand, senest registrerede tekst (ikke akustisk bevis), aktuel
beslutningskilde og blocker; nedtælling kun hvor den reelle ejer har en aktiv
frist og frisk dokumentation. Ellers vis hvorfor den står stille/er ukendt.
Brug eksisterende status/SSE; bounded observation max én gang/sekund og eksplicit
session-generation-binding. Regressioner: aktiv/stille/stale, værktøj/output,
gammel session, lukning/rearm, Talk/OFF samt mobil/keyboard. Uafhængigt review og
relevant gate før release; rollback: fjern kun statusprojektion/kort. Fysisk
lukning er stadig ikke bevist af UI.

Implementeret: Thin læser egne pending-work/quiet-window/close/readiness-fakta;
hub udsender samme bounded projektion i SSE og snapshot; eksisterende /api/status
opdaterer også inaktive ejere efter teardown uden ny lifecycle-actor. Native ro
vises som målt coverage, OFF som sampled deadline; ingen fake smooth nedtælling.
Aktiv tale ved output-only modelafslutning får ikke et opdigtet UI-veto. Output-
clock/frames/forbrug valideres særskilt; peak alene tæller som queued. Transcript-
fragmenter udsendes max1Hz; ingen ny lydoptagelse. Talk ukendt, stale eller failed
rearm kan ikke vise Klar. Kortet bevarer kontrol- og detailsfokus under SSE/poll.

48 målrettede Python-tests består; shipped-controller Node-kontrakt og isoleret
Chromium ved320/390/430/768/1440 px består inkl. fokus gennem SSE/poll, escaping,
frameidentitet/stale/output og semantisk ro vs raw input. Ruff/mypy består.
Første fastforsøg blev stoppet af mypy ved en Optional-aritmetik i projektionen;
rettet typetjek. Næste fulde fastforsøgs integration blev ugyldig alene af
sandbox socket.bind-afvisning; ingen runtimepatch på den fejl. Samme fastgate
køres med loopback tilladt. Uafhængig adversarial review: GO til software-
releasegate, ingen P1; P2 musikbjælkens width-invalidation rettet (sammenligner
hele det relevante DOM-element). Provider-script/provenance diff er inkluderet
i scope, men giver ingen ny closeautoritet eller fysisk-fence-påstand.
Fuld integration (56,45 s) bestod med loopback. Unit-kørslen blev ugyldig,
fordi lead fejlagtigt ændrede versionsmetadata fra110 til111 under kørslen:
Python havde importeret110, mens filkontrollen læste111. Ingen produktpatch
på dette; versionsfiler er nu ens og frosne før ny gate. Det forsøg tæller ikke
som en grøn samlet gate. Det oprindelige kriterium om uændrede bits fastholdes.
UI-forhåndsvisning med eksplicit eksempeldata-banner er browserkontrolleret;
fysisk golden chain/10/10 for denne kandidat er UKENDT. Ikke installeret endnu.

Frosset111-kandidat: fuld fastgate består nu med Ruff/format, Mypy54 filer,
hele unit89,72 s og hele integration56,79 s. Alle nye filer medtages. Ingen
sourceændring under denne gate; denne kontrol erstatter de ugyldige forsøg.
Uafhængigt slutreview bekræfter GO efter rettelser. Næste trin er præcis én
releasegate på det committede diff, PR-CI/ARM64, merge/publicering og installation.
Ingen firmwareændring; eksisterende109-firmware genbruges. UI er diagnosticering,
ikke aktivering af den endnu ubeviste baggrundsafslutning.

### Udgivelse og installation 1/10 — .111 UI, ikke ny afslutningspolicy

Frossent sourcecommit `23a92a7b152110bd911f91b6d07b44d8f999cb54` bestod
præcis én releasegate: unit92,13 s, integration56,85 s, candidate-scope,
Ruff/format og Mypy54 filer. PR87 exact-commit lint/test og ARM64-build bestod;
uafhængigt adversarial slutreview GO, ingen uløste P1/P2. Merged main
`a3ac48a983844feccfe98e83bd9aa34d8313ec47`; main CI/publish run36833017461
SUCCESS. Podvoice build-context hash
`7638f39c35eae62628843bbb79e68b4491080bc210e95e615e07f40299fc5451`;
publiceret image `ghcr.io/bixelventures/aarch64-addon-podvoice:1.13.111`,
digest `sha256:42fc52144d2944dc45f260f2228acbb55efebfb6e418d05ab5c5da9fe3044948`.

HA-opdatering med backup gennemført; frisk browser viser1.13.111 Kører og
installeret panelets header1.13.111/status live. R0 er forbundet, Wake afprøves,
Styring: Enhedens readiness, Ingen åben samtale. Første ingressforsøg gav502
under opstart; efter reload ses panelet korrekt. Ingen firmwareændring.
Browserkontrol blev midlertidigt stoppet af Chrome-udvidelsesdialog/routingreview-
timeout; normal inventory gav adgang igen. Efterkontrol bekræfter AlphaON,4s og
dual Hey Chat/Hey Jarvis med deviceconfirmation. Installeret screenshot gemt
/private/tmp/pv-live-status-installed.jpg. HA har bevaret konfigurationen. Fysisk golden chain og10/10 for denne artifact
fortsat UKENDT. UI giver ikke ny lukningsautoritet; TV-afslutning er stadig uløst.

## 30/9 — samlet løsningsforslag: Live-ejet idle-vurdering, én close-ejer

Brugeren har nu godkendt implementering og eksplicit bedt om Goal. Goal er oprettet
og ACTIVE med hele leverancen inkl. review, release, installation og fysisk bevis.
Goal er nu BLOCKED efter tre sammenhængende Goal-turns med samme eksterne hindring:
HA-adgangen. Hele objektivet er bevaret. Lokal implementering er gemt i
`983231d` og `82b66fb`; næste runtimeændring kræver stadig rigtig providerprøve.
Seneste kontrol: HA-cloud viser igen "Unable to connect to Home Assistant", og
`homeassistant.local:8123` får igen DNS-timeout. Der er ingen igangværende
providerprøve eller installation at vente på. Genoptag ved faktisk HA-adgang;
verificér først adgang, privat nøgleoverførsel og eksklusivt providervindue.

Første implementeringsmilepæl er den sideeffektfrie native Live-idle-protokolprøve;
den nye policy er ikke aktiveret i produktion. Independent idle_protocol_review
gennemgår især append-ACK vs faktisk delegation og kontinuerlig input-invalidering.

### Implementeringsresultat 30/9 — første milepæl, ikke runtimeaktivering

`scripts/live_idle_check_eval.py` er nu implementeret som en isoleret prøve af den
faktisk shippede `OpenAILiveSession` med installeret OpenAI SDK 3.13.0. Ingen
produktionsimport, firmwareændring, mikrofonoptagelse, domænehandling eller ekstra
samtalemotor. Prøven har én forbindelse, ét internal-check, højst to backend-
responser, 45 s observation og 15 s oprydning. Fixture-manifestet er valideret.
De første cases er quiet, kontinuerlig syntetisk TV og en sen opfølgning; den sidste
er observation-only og kan ikke bevise inputbevaring ved fysisk close.

Oraklet kræver korrekt kendt åbningsinput, nonzero assistant-output efterfulgt af
fire sekunders ro, append-ACK, korreleret faktisk delegation, enum-resultat,
resultatafsendelse og en færdig backendfortsættelse inden prøvebudgettet på 2 s.
Request-token alene er ikke wire-korrelation. TV skal være kontinuerligt gennem
hele idle-perioden, beslutningen og observationsslutningen. Intet provider-output
må ledsage det interne check. Manglende korrelationsfelter, gammel generation,
gentagne/for sene hændelser, ukendt forbrug eller fejl giver UNKNOWN.
Provider-cleanup kan ikke efterfølgende fremstille et bestået observationsresultat.

33 målrettede regressioner består, inkl. den faktiske adapters append gennem en
kontrolleret SDK-forbindelse: ACK opfinder hverken verdict eller delegation.
Fast-gatens Ruff, format og mypy bestod. Dens første integrationskørsel var ugyldig,
fordi sandboxen afviste lokale testserveres socket.bind. Ingen runtimepatch blev
lavet på den fejl. Kun de afbrudte pytest-stadier blev genkørt med loopback tilladt;
fuld unit og integration bestod. Efter sidste lille orakelrettelse bestod de 33
målrettede tests og Ruff/format igen. Ingen releasegate eller fysisk gate er kørt.

Uafhængig adversarial reviewer `idle_protocol_review` fandt først to afgørende
bevisgrænser: append-ACK er ikke modelafgørelse, og TV må ikke starte efter verdict.
Begge er rettet og permanent testet. Sidste review: GO til den afgrænsede
providerprøve; ingen runtime-/release-/fysisk godkendelse arves derfra.
Reviewet scripts SHA256:
`0cd2f4289346405f94b2aeed9f7a1e5c5b39356b8dd23a53dc5037e10b25102b`.
Tests SHA256:
`5cf0e01749c8e2e731df8b603e1345f933a5be3ed2806d07ff1b8441d9d2edef`.
Arbejdskopi: `/private/tmp/pv-close-104`, branch
`codex/live-input-provenance-111`, base HEAD `015b23d`.

Næste Goal-turn: den frosne prøve er commit `983231d`. Seks ekstra transport-
regressioner gennemfører hele prøve-controlleren med den installerede SDK's
serializer/parser på den eksisterende kontrollerede socket. Ingen mock af Live-
metoder. Quiet og kontinuerlig TV-source kontrolleres hver med korreleret kæde,
lovligt fraværende `delegation.created.client_event_id` og en fejlet resultatsend.
Kun den første kombination kan få et softwaremæssigt OBSERVED_PASS; de øvrige
giver UNKNOWN og udfører ingen continuation-retry. Én start, ét append, ét
resultatsendforsøg og én close; alle forbindelser frigives. Korte testfrister og
scriptede serverafgørelser bruges kun lokalt og beviser ikke AI'ens forståelse,
den rigtige 2 s-frist eller fysisk afslutning. 39 målrettede tests samt Ruff,
format og diff-check består. Runtime og det reviewede script er uændrede;
ingen ny fuld gate er nødvendig for denne isolerede testtilføjelse.
Ny tests SHA256:
`2705ddb2f30543f4dbb62b1fbdf7ad5c818b65254bc60d3885b9f4ab6239035f`.

Aktuel ekstern hindring: frisk HA-browserforbindelse viser "Unable to connect to
Home Assistant". Ingen OpenAI-nøgle er overført eller udlæst; ingen lyd er sendt;
ingen add-on er stoppet eller opdateret. Den private, tidligere godkendte adgang
og en eksklusiv providerprøve afventer HA. Goal-status står øverst. Næste beslutning
skal bygge på faktisk providerresultat, ikke de grønne lokale prøver ovenfor.
Genvalidering i næste Goal-turn: cloud viser fortsat samme forbindelsesfejl.
Alternativet `homeassistant.local:8123` fejlede også med DNS-timeout ved sidste
kontrol. Ingen kendt frisk lokal HA-IP findes i den aktive beslutning; gamle
Voice PE-IP-adresser må ikke bruges som gættede HA-adresser.

Brugeren præciserer: løsningen skal udledes af forskning, repositories, faktisk
kode og best practice, ikke findes som et særligt dansk færdigprodukt. Denne post
beskriver runtimeplanen; kun den isolerede første milepæl ovenfor er implementeret.
Lead: hovedagenten. Stærkeste fejlbevis er den tidligere .109-felttrace: afsluttet
assistant-svar og >10 s output-ro uden backendarbejde, men TV/inputveto holder
samtalen åben. En anden læst kodefejlgrænse er, at ethvert inputfragment både
fornyer raw inputrevision og annullerer semantisk end; ikke kun relevante spørgsmål.

Valgt hovedretning: GPT-Live vurderer henvendelse og semantisk færdiggørelse i
den allerede åbne samtale. ThinSession ejer én deterministisk afslutningsproces.
Ved UI-inaktivitet sendes én korreleret intern idle-check via dokumenteret
session.instructions.append, med en snæver startupregel for tavs delegation og
en isoleret backend-resolver. Dette er et app-design, ikke et native OpenAI-event
eller en garanti for lydløs/modelrettidig udførelse. Rigtig SDK/providerprøve skal
bevise checkets tavshed, delegation, svarlatens og modifikation ved ny henvendelse.
Ingen ny talemotor, transport, pVAD-enrollment eller permanent ekstra audio-model.

Hierarki:
1. Fysisk/panel-Stop preempter alt; én teardown/rearm. Spoken stop forbliver hush;
   stop musik forbliver domænehandling. Disse regler ændres ikke.
2. Ny klart henvendt besked før close-commit annullerer ældre close-check/hensigt.
3. Korreleret eksplicit semantisk afslutning accepteres kun efter nødvendigt
   backend-settlement; faktisk output/drain må ikke springes over.
4. Udløbet UI-frist beder Live om en eksplicit vurdering af den aktuelle samtale,
   ikke blot om et farvel. Ingen forventet høflighedsreplik efter ren tak.
5. Missing/unknown AI-resultat er fejl/ukendt. Det er ikke dokumenteret baggrund
   eller succes. Bounded teknisk oprydning må ikke blive en normal idle-success.

Idle-check-kontrakt: local request-id, session/epoch/provider generation,
input sample-/send-fence, inputrevision og observationstid binds af serveren.
Frontend vurderer original samtalelyd og kontekst; backend får dens delegation,
ikke original lyd. Resolver svarer relevant/clear_to_close/unknown med kort
årsagskategori; den har ingen domæneværktøjer eller autorisationsret. Ett relevant
verdict skal referere til nyt input i checkets lokale evidensområde. Kun nye
relevante samples kan forny fristen; duplicate check-resultater, samme gamle
spørgsmål og modelproducerede ord er ikke nye brugerinteraktioner. Ikke-relevant
TV nulstiller ikke fristen. Frontend/backend/tool descriptions skal være konsistente.

Raw inputrevision bevares uændret til værktøjsautorisation, bekræftelser og stale
action checks. Lukning får en særskilt, snævert scoped evidensgrænse i ThinSession;
et baggrundsverdict må ikke gøre gamle musik-/robot-/bekræftelseskald aktuelle igen.
Rå VAD/transkript bliver diagnostik og provisorisk inputbeskyttelse, ikke et
ubegrænset semantisk veto. Den disabled LiveInputPolicy må ikke aktiveres som
konkurrerende timer; dens intervalmekanik genbruges kun hvis den matcher kontrakten.

Kæde og race-gate: native mic → ordnet VoicePELink-input → Live frontend →
korreleret check/delegation → færdig resolver → Thin close-owner → provider close
→ faktisk fysisk lydhale → teardown/rearm → ny wake. Kontinuerlig inputmåling
og ringbuffer fortsætter under checket. En beslutning gælder kun sin forseglet
inputgrænse; senere samples må ikke kasseres som allerede klassificeret TV.
Ved endelig check bruges en kort lokal forsegling/buffer via samme inputconsumer
og rigtig provider mute-ACK. Relevant/ukendt buffer skal behandles før normal
close; ved genoptagelse må kun endnu ikke leverede bytes replayes, præcis én gang.
Mute-ACK beviser kommandaccept, ikke henvendelse, modelbehandling eller fysisk lydslut.

Den vigtigste falsificering: denne buffer/check-runde skal kunne afslutte med
uafbrudt TV og samtidig bevare et nyt, svagt spørgsmål lige ved grænsen. Hvis
alle TV-pakker konstant invaliderer dommen, er designet stadig samme livelock og
ikke testklart. Der må ikke tilføjes uendelige checks/retries for at skjule det.
Der etableres én samlet review-deadline, ikke en ny frist pr. TV-pakke. Foreslået
evalbudget for intern idle-check er højst 2 s ud over UI-fristen, plus målt
fysisk lukning; det er et kandidatbudget, ikke målt kapabilitet. Ved ukendt hale/
fejl må normal lukning ikke påstås; bounded teknisk afslutning markeres særskilt.
Denne afvigelse fra normal UX skal fremgå af panelet og af acceptresultatet.

Stop-the-line: Hvis den native Live-check ikke giver pålidelig, tavs og scoped
beslutning inden budgettet, eller input-fencen ikke beskytter reelle opfølgninger,
skal kandidaten stoppes. En ekstra OpenAI audio+context-judge er da en separat
reviewbar alternativ beslutning, ikke en samtidigt aktiveret reserveklassifikator.
Usikkerhed om bruger vs TV kan ikke elimineres ved en timeout eller prompt alene.

Implementeringsrækkefølge og leverancer:
- Protokolprøve først: tavs internal-check med rigtig SDK og ingen hjemhandlinger;
  TV, reel opfølgning, topic change, aside og tænke-/bekræftelsespause.
- Thin/Live integration: én idle-ejer, korrelation, relevant vs raw revision,
  ingen false-success på unknown, permanent regression for den observerede kæde.
- Native input-cut/buffer/replay og Talk-observation; kun firmwareændring hvis
  faktisk nødvendigt for en kildegrænse. Gain/wake/modeller ændres ikke her.
- LED følger faktiske tilstande: åbent/blåt, eksisterende roterende arbejdslys
  kun ved arbejde, slukket først efter fysisk rearm-ACK. Fejl logges reelt.
- Adversarial review, relevante fast/lifecycle og semantik-eval; én releasegate
  efter freeze. Grøn main-artifact installeres med Alpha ON og vedvarende setting.
- Samme kandidat skal fysisk bevise TV og samtale til andre, rettidig opfølgning,
  farvel, 10/10 lifecycle, Stop→ny wake, ON/OFF og unplug/replug. Talk tæller
  ikke som Voice PE-bevis. Latens fra sidste relevante tale/svar til rearm opdeles
  i UI-frist, check og fysisk lukning; ingen skjult forhøjelse af 4 s.

Rollback: installeret .110 er senest registrerede softwareartifact; .109 er
senest feltobserverede kandidat. Ingen af dem er TV-close-godkendt. Ny candidate
kan slås fra separat uden at miste Alpha-valget. Ingen frisk fysisk gate her.

## 30/9 — uddybende research: henvendelse er ikke rå taleaktivitet

Brugeren beder om mere research før påstand om en ægte løsning. Ingen runtime,
prompt, model, timeout, afhængighed, lyd-egress eller installation er ændret.
Følgende primærkilder og konkrete kildefiler præciserer den aktive beslutning:

- Amazon beskriver audio-only Follow-up Mode som særskilt device-directed
  speech detection: akustiske/ASR-signaler kombineres med aktuelle og tidligere
  ytringers semantik. "Tak", "stop" og "okay" kan stadig være tvetydige.
  https://www.amazon.science/blog/how-alexa-knows-when-youre-talking-to-her
- Apples follow-up-paper bruger tidligere spørgsmål og ASR-usikkerhed;
  rapporterer 20–40% relativ reduktion i falske accepter ved fastholdt 10%
  falske afvisninger. Det er deres trænede classifier/datasæt, ikke GPT-Live,
  dansk køkkenperformance eller en færdig model til Voice PE.
  https://arxiv.org/html/2411.00023v1
- Apples multimodale paper understøtter kombination af lyd, tekst og ASR-
  signaler. Live må ikke tillægges n-best/confidence-felter, vi ikke modtager.
  https://arxiv.org/html/2403.14438v1
- Alexa Conversation Mode bruger lyd plus visuelle henvendelsessignaler og
  afslutter ved manglende interaktion. Kameradelen kan ikke overføres til pucken.
  https://www.amazon.science/blog/new-alexa-feature-enables-natural-multiparty-interactions
- Attention Labs SAS-paper rapporterer audio-only F1=0.86 på et internt
  engelsksproget datasæt. Paperet nævner falsk accept af TV-spørgsmål og af tale
  til en anden person efter en tidligere device-henvendelse. SDK/modelforskning
  giver derfor ikke et sikkert dansk plug-in. On-device ARM Cortex-A-tal er
  hverken ESP32-bevis eller hosted SDK-latens.
  https://arxiv.org/html/2604.08412v1
- tuya/nomo-pvad giver target-speaker-aktivitet fra enrollment, ikke addressee.
  Brugerens tale til ægtefællen vil stadig være target-speaker. FireRedChat
  pVAD/end-of-turn løser heller ikke i sig selv end-of-session.
  https://github.com/tuya/nomo-pvad
  https://github.com/FireRedTeam/FireRedChat
- isair/jarvis har en kontekstuel intent-judge, men den faktisk læste prompt
  i src/jarvis/listening/intent_judge.py tvinger directed=true i hot window.
  Dette er en konkret grund til ikke at kopiere dens timeout-policy til TV-casen.
  https://github.com/isair/jarvis/blob/main/src/jarvis/listening/intent_judge.py

OpenAI-grænse: Live kan instrueres til at ignorere samtaler i nærheden, men
ignorering giver ikke automatisk appen et eksplicit henvendelsesverdict.
Realtime-promptguidens wait_for_user-eksempel er ikke et native Live-inputevent.
Vores Live-backend har allerede et tilsvarende værktøj ved delegation, men
backend får delegeret kontekst, ikke original lyd, og frontend skal ikke
delegere al baggrund alene for at være tavs. Ingen delegation/svar kan derfor
ikke fortolkes som dokumenteret baggrund. Thinking/context-append må heller
ikke opfindes som et garanteret stille classifier-API.
https://developers.openai.com/api/docs/guides/live-prompting
https://developers.openai.com/api/docs/guides/live-conversations
https://developers.openai.com/api/docs/guides/voice-prompting

Lead-retning efter research: Bevar AI-ejet henvendelsesfortolkning og én
ThinSession-lukkeejer. Hold eksplicit semantisk afslutning, mekanisk afspilnings-
settlement og inaktivitetsfallback adskilt. Accepteret relevant interaktion må
forny fristen; rå VAD/transkript er observation, ikke ubegrænset veto. Dette
kræver en valideret relevanskilde, ikke blot at slette den nuværende beskyttelse.
Prøv først eksisterende Live-semantik i det afgrænsede evalspor. En positivt
forstået samtaleovergang kan afslutte stille; TV alene er ikke en sådan overgang.
Hvis det ikke dækker vedvarende TV, er næste research-/evalkandidat lyd plus
samtalekontekst ved lukkegrænsen, uden ny samtalemotor eller filtrering af alle
svar. Ingen ny classifier eller tredjepart er valgt/aktiveret.

Den bevarede tekniske stopregel er eksakt forseglet inputinterval, frisk dom
og bevaring af input efter grænsen. En dom over tidligere lyd må ikke opsluge
en ny opfølgning; en konstant voksende TV-hale kan ikke få ubegrænset venten.
Ukendt henvendelse er en eksplicit produkt-/evalgrænse, ikke automatisk tavshed.
Eksisterende semantic-completion-eval har kun baseline UNKNOWN med afvigende
fixturetranskript; implicitvarianten er ikke kørt. Research ophæver ikke dette
resultat eller de fysiske TV-/opfølgningsgates. Kandidat2 er fortsat uvalideret.

## 30/9 — repo-research: semantisk afslutning og app-ejet inaktivitet

Brugeren bestiller konkret repo-research og sammenhæng med princippet
"AI ejer fortolkningen; koden udfører afslutningen". Read-only runtimearbejde:
ingen prompt-, timeout-, firmware- eller installationsændring i denne research.
De offentlige kildefiler er læst ved følgende commits, ikke blot README-slogans:

- LiveKit `15b4bc84c7057a6da4dfc66208ae5d89454c84db`:
  `livekit-agents/livekit/agents/beta/tools/end_call.py` lader modellen kalde
  `end_call`; callback på speech-handle afslutter via session.shutdown.
  Realtime-auto-tool-reply har særskilt venten på næste speech-handle med
  bounded 5 s opstartsvagt. Sessionens user-away-timer er separat og undertrykkes
  ved aktive værktøjer. Dette er en reference for ejerskab, ikke fysisk Voice PE-bevis.
- Pipecat `20999cd7b816dc5950eb9553b1ae36a1e771f2bc`:
  `src/pipecat/turns/user_idle_controller.py` starter efter BotStoppedSpeaking,
  annullerer ved bruger-/assistant-tale og holder en tæller for aktive
  function calls. `wait_for_user()` genarmerer efter en tur uden assistant-svar.
  Der er ingen addressee-klassifikation i denne controller. Eksemplet
  `examples/turn-management/turn-management-detect-user-idle.py` bruger to
  kontaktforsøg og derefter afslutning; det er app-policy, ikke et krav til os.
- GPT-Live-app Jarhead `84474ee3c664e48301302695016ce5dc5411e17c`:
  `packages/live/src/instructions.ts` instruerer modellen i at delegere
  dismissal, mens stop/cancel beholder samtalen. Engine har én fallAsleep-ejer
  og separat idleSleepMinutes. Hvert Live-inputtranskript kalder kevinSpoke
  og nulstiller inaktivitet. Derfor er denne kode ikke bevis for TV-sikker timeout.
- GPT-Live-adapter autonomous-os `a0328995850ad986e8258a262a24189ab3a16f32`:
  `hal/realtime/voice_agent/gpt_live.py` kasserer tavse outputpakker via RMS,
  estimerer svargrænser fra output-gap/transkript og beskytter backend-busy.
  Den syntetiske grænse er ikke en officiel Live-turn-end eller fysisk drain.

Direkte sammenlignelig upstream-feltrapport: LiveKit issue6030 beskriver støj/
baggrundstale, der forhindrer user-away. Tilknyttet PR6880 er ved research
OPEN/ikke merged og tilføjer user_away_signal="transcript"; kun tekst nulstiller
timeren. Dens diff/regressioner er læst. Det løser untranscribed noise, men
indeholder ingen vurdering af henvendelse; transskriberet TV kan stadig holde åbent.
https://github.com/livekit/agents/issues/6030
https://github.com/livekit/agents/pull/6880

Supplerende implementeringsmønster: attenlabs/saa-sdk bruger en særskilt hosted
addressee-model før STT og gates via prediction/turn_ready. Kun SDK er open source;
modellen er hosted/proprietær. README oplyser ekstra round-trip og kendt
cross-lingual recall-begrænsning. Det er leverandørevidens, ingen dansk køkken-
validering og ingen beslutning om ny afhængighed eller lyd-egress.
https://github.com/attenlabs/saa-sdk

Lead-konklusion: Bevar én ThinSession-close-ejer. Completed korreleret semantisk
end-hensigt går til eksisterende settlement/playback/close; fysisk Stop preempter.
Inaktivitet er en separat trigger til samme ejer, ikke en ekstra samtalemotor.
Manglende Live-svar er ikke en eksplicit baggrundsdom. Rå VAD må ikke gives
ubegrænset semantisk autoritet, men kan heller ikke fjernes uden en afgrænset
inputrelevans-/opfølgningsgrænse. Den lokale kode har allerede output-only
semantisk close, men inputrevision kan revokere den; den uafgrænsede rå inputveto
står især i idle-stien. Research ændrer derfor ikke den eksisterende gate-status.
OpenAI Docs bekræfter app-ejet inaktivitet, færdig playback og nødvendigt arbejde:
https://developers.openai.com/api/docs/guides/live-conversations

## 29/9 — .110 installeret; næste afgrænsede inputbevis under arbejde

PR86 blev merged som `61f31f3aee93bbc06a2ea28a92880be200866c3f` efter
uafhængigt review, frosset lokal releasegate og grøn PR-CI. Main-jobbet
publicerede registertag `1.13.110`; Home Assistant installerede med backup ON
og viste installeret/nyeste 1.13.110, Kører. Panelet viste v1.13.110, Alpha
ON og gemt 4 s. Opstartsloggen bekræftede samme git-SHA. Voice PE var offline:
`.local` slog ikke op, og forbindelsen til senest kendte `192.168.86.27:6053`
blev afvist. Derfor er der **intet fysisk lyd- eller lukningsbevis på .110**.
Firmware er ikke ændret. Den tidligere .109-baseline og TV-fejlen står ved magt.

Aktiv næste beslutning: Bevis en eksakt, ordnet inputgrænse, før TV-tale kan
fritage den fælles lukkeproces fra rå VAD/transkript. Den fysiske .109-trace
viste >10 s output-ro uden backend-/værktøjsarbejde, men aktiv inputveto;
den samme trace tabte 220 capture-kommandoer. Kæden er native mikrofoncallback
→ `VoicePELink` kø/epoch → `ThinSession` pump → OpenAI append/transkript →
inputrelevans → den eksisterende close-ejer → fysisk playback/teardown/rearm.
Invarianter: én mikrofonconsumer, ordnede frames, ingen stale generation,
intet tabt opfølgningsord, Stop preempter, Talk/OFF uændret. Falsificerbar
hypotese: en callbackbundet sample-sekvens kan afsløre huller/epochskift uden
at ændre de bytes, som når OpenAI. Ikke-mål: aktivering af TV-lukning, ny
timeoutværdi, VAD/gain/prompt, ekstra samtalemotor eller firmware.

Før adfærdsændring kræves bevis for lokal buffer/replay gennem samme session,
eksakt input-fence og provider-ACK, og en frisk relevansdom som dækker lyd
helt frem til close-grænsen. Kontinuerlig TV-tale med forsinket klassifikation
efterlader ellers altid en ubestemt hale; et output-only 4 s close er derfor
ikke en godkendt fallback. Regressioner skal injicere forsinkede, dublerede og
omordnede frames omkring Stop/rearm/næste wake; køtab, mute/ACK-fejl og en
svag dansk opfølgning lige ved grænsen må ikke blive en falsk lukning. Målrettet
native/Thin-test, uafhængig adversarial review, relevante gates og senere
fysisk TV+opfølgning på samme bits kræves. Rollback-grænse er installeret .110,
mens .109 er senest feltobserverede kandidat. Denne post registrerer en plan,
ikke et resultat af kandidat 2.

Foreløbigt kodearbejde på separat branch: `VoicePELink` lægger nu native
mikrofonbytes i samme begrænsede kø synkront i callbackrækkefølge og knytter
host-modtagelsestid, sekvens, audio-/forbindelsesgeneration og køtab til hver
frame. `ThinSession` kan observere den sidst lokalt afsendte native frame;
OpenAI får stadig de samme PCM-bytes. Det ændrer hverken lukning eller
provider-mute. En syntetisk late-callback-test efter rearm viser grænsen for
host-metadata: hvis en callback først *invokeres* efter ACK, får den ny
host-epoch. Host-metadata alene beviser derfor ikke fysisk sample-alder,
source-komplethed eller provider-kvittering. Feltklassifikation må ikke bruge
dem som sådan. Den uafhængige adversarial review fandt efter rettelse ingen
tilbageværende P1 for at beholde koden som forberedelse uden lukkeautoritet,
men gav ikke release- eller TV-close-godkendelse. Den rettede fokuserede
`scripts/dev fast` bestod Ruff, format, Mypy og samtlige udvalgte tests med lokal
loopback-adgang. En tidligere HTTP-tests `PermissionError` kom alene fra
sandkassens blokering af lokal socket og bestod ved isoleret genkørsel med
adgang. Fuld releasegate, PR, installation og fysisk prøve af denne branch
er ikke udført.

Korrigeret firmware-/protokolaudit: den første læsning blandede en ældre
firmwaresti ind og påstod fejlagtigt, at Stop/ring-reset ikke var synkroniseret.
I den aktuelle main-kode holder både producent, Stop/reset og ring-read samme
`audio_mutex_`; drain-send, Stop og rearm køres på main/API-tasken, og native
API sender beskeder i FIFO på samme forbindelse. Allerede sendt før-Stop PCM
kan derfor ikke overhale en senere `recovered`-ACK. Et før-ACK decodet, men
forsinket host-callback afvises af den eksisterende host-epoch-cut. Næste wake
trimmer efter firmwaredetektorens præcise samplegrænse; den gamle generelle
320 ms pre-roll-beskrivelse gælder ikke denne kandidat. Det er en stærkere
mekanisk grænse end den første audit antog, men ikke en måling af fysisk
optagelsestid i lavere mic-buffere eller et relevansverdict for TV. A/B-PCM,
forsinket callback/TX, Stop→rearm→næste wake og rigtig opfølgning skal stadig
bevises på de shippede bits før en ændret close-politik. Ingen firmwareændring
er besluttet eller udført på dette grundlag.

## Aktiv observationskandidat 29/9 — automatisk lydlog ved panelstart og hurtigere writer

Fysisk .109-prøve kl. 18.51 sluttede først cirka 28,1 s efter sidste
backend-svar, selv om UI stod på 4 s; der var fortsat baggrundstale.
Samtalen havde runtime-tidslinje, men intet nyt automatisk lydmanifest.
`ThinSession` autoarmerede kun ved fysisk `rearm_attempt_id`, mens panel-Lyt
går gennem `wake(None)`. En tidligere TV-prøve havde desuden 220 tabte
capture-kommandoer; den positive/negative lydklassifikation var derfor
ikke godkendelsesbevis. Ingen af observationerne giver autoritet til at
ændre timeout eller semantisk farvel.

Berørt kæde: panel eller fysisk wake → Thin trace-admission → uændret
Voice PE-PCM/Live-append → asynkron writer → manifest → teardown/rearm.
Invarianter: én native mikrofonconsumer og én samtaleejer, ingen
diagnostik på Talk/OFF, ingen falsk fysisk wake-reference ved panelstart,
ingen PCM- eller providerændring, og en fuld trace-kø skal fortsat markere
tab. Falsificerbar hypotese: programmatisk native Alpha-start kan optages
automatisk uden at anmode firmware om fysisk wake-reference; hurtigere
eksakt PCM-statistik reducerer writerarbejdet uden at ændre WAV-bytes.
Ikke-mål: TV-lukning, VAD, gain, prompt, LED, firmware og nye timeoutregler.

Regressioner: panel-WAKE_WORD gemmer device-PCM med `wake_source=programmatic`
og nul wake-reference-anmodninger; fysisk wake, Stop, Talk/OFF og fuld
trace-kø forbliver uændret; signed-16-bit ekstremværdier giver præcis samme
statistik og WAV. Målrettede tests, fast gate, uafhængigt review, én frosset
releasegate og fysisk manifestkontrol kræves. Rollback er installeret .109.
Den bredere PR85 er ikke en releasekandidat: dens første releasegate
afviste blandingen af audio-input, fysisk output og rearm. Denne snævre
kandidat er isoleret fra den PR og skal bedømmes på egne bits.

Faktisk snævert diff i dev-clonen: automatisk native Alpha-trace starter også
ved panel-WAKE_WORD; fysisk wake-reference anmodes fortsat kun ved fysisk
wake-token. Manglende automatisk recorder-admission får en warning. Den
asynkrone writers PCM-statistik bruger ækvivalente indbyggede summeringer;
køgrænse, bytes og tabsrapportering er uændret. Målrettede tests 18/18 PASS.
`scripts/dev fast --base origin/main` bestod Ruff, format, Mypy og den
fokuserede integration-/unit-gate på dette isolerede diff. Dette er
softwarebevis, ikke færre tab på Pi eller fysisk lukningsbevis. Uafhængigt
slutreview, frosset releasegate, publicering, installation og nyt fysisk
manifest er endnu ikke udført.

## .109 installeret 28/9 — fysisk kandidatprøve afventer

PR81 `dcbeac2` bestod PR-CI og den fulde lokale releasegate; merged main som
`43b2775635e2f760030cd1b6faee3f9a0e6178ec`. Registryets immutable
`1.13.109` og `sha-43b2775635e2f760030cd1b6faee3f9a0e6178ec` har samme
index-digest `sha256:1ebf773c0c34c9f24edcdfddbb4be9db756d97c502b29ea9e42174e18b9f12a1`.
Dette image fandtes, selv om GitHub Actions-oversigten og eventlisten ikke
viste et main-push-job for PR81. Den tidligere konklusion om manglende
publicering var derfor forkert. PR82's main-job bestod lint/test, men
publish-jobbet afviste korrekt at overskrive den eksisterende version.

HA-opdatering med backup ON gennemført. UI viser installeret/latest 1.13.109,
Kører; PodVoice-panel viser v1.13.109/status live. Opstartslog rapporterer
git SHA `43b2775` og firmwarekontrakt OK. Native readback: installeret
`podvoice_build_113108_livenotifyisolation1`, mute OFF, begge wakeord ACK,
reply stopped, StopContext idle og rearm recovered. Alpha ON og gemt UI-
timeout 4 sekunder bekræftet i panelet; enheden er forbundet. Ingen ny
firmwareflash var nødvendig. Fysisk Stop→næste wake, automatisk lukning ved
TV, arbejdslys under værktøj og 10/10 på .109 er fortsat ubeståede gates.

Supplerende før-installationsbevis fra automatisk .108-trace
`20260928T134822-798-2fc09d8a` (del 7, +80–84 s): 8 nye Live-inputfragmenter,
native input ofte `active`, men 0 ventende responses, batches, tools, continuation
eller pending audio. Idle-diagnostikken viste `input_not_quiet`/gentagne reset;
selv en kort ro nåede kun 0,08 s mod UI-værdien 4 s. Den gemte historik viser
fortsat samtale i rummet uden ny assistentopgave; detaljer gengives ikke her.
Tracen sluttede ved add-on-genstart for .109 (`process_restart`, ufuldstændig),
så den er **ikke** bevis for en naturlig afslutning. Dette reproducerer den
kendte inputveto-flaskehals på .108 og giver ingen tilladelse til at aktivere
kandidat2 uden valideret relevans af den opfangede tale.

Første .109-feltforløb 14.01–14.04: tre separate wake/sessioner blev registreret.
Den sidste automatiske trace `20260928T140338-544-2280768f` har huller i
lydmålingerne, men korrelerede hændelser og brugerrapport: efter sidste
assistent-/værktøjsarbejde var der >10 s output-ro uden pending response,
tool, continuation eller audio. Ved +31,040 s viste output-only shadow
4,214 s, mens runtime kun havde 0,307 s på grund af native input; ved
+37,284 s var shadow 10,407 s og runtime igen `input_not_quiet`. I del 3
fortsatte input-VAD aktiv/rolig skiftevis uden nyt Live-inputfragment, men
timeout fik stadig aldrig 4 s. Bruger identificerede lyden som baggrundstale
fra TV og oplevede LED/samtale fortsat åben. Dette er ny fysisk evidens for
inputveto-fejlen på selve .109, ikke et signal om at al native tale er irrelevant.

Brugerens Stop i samme trace: `button_pressed` +53,459 s, `close_requested`
+53,462 s, providerterminal og release færdig +54,722 s, `teardown_complete`
+54,811 s, eksakt `wake_rearm_recovered` +55,018 s. Knap→rearm 1,559 s;
socketrelease fra +54,711 til +54,722 s ≈11 ms. Brugeren oplevede at Stop
virkede og rapporterede ingen klik/knas samt fungerende senere Hey Jarvis.
Panelet viser to tidligere .109-rearms efterfulgt af ny wake kl. 14.02.09 og
14.03.38, men ingen korreleret ny wake efter det sidste Stop kl. 14.04.32.
Netop denne Stop→næste-wake-kæde og fysisk lydstop under faktisk tale er derfor
endnu ikke fuldt bevist. De tidligere .108-målinger arves ikke.

Årsagshypotese for næste isolerede afslutningskandidat: rå native VAD er en
sikker foreløbig beskyttelse, men kan ikke alene eje relevans ved vedvarende
baggrundsstemmer. Fravær af Live-transcript eller providerrespons er heller
ikke i sig selv et positivt baggrundsverdict. Den forberedte kandidat2 må
fortsat ikke aktiveres på output-only ro; næste gate er at validere en eksakt,
frisk relevanskilde mod dette TV-spor og en reel opfølgning, inklusive sen
providerrespons, før Thin får en ændret close-beslutning. Ingen timeout-,
prompt-, VAD- eller firmwareændring er udført på dette fund.

Full-duplex-beslutningsgrænse: GPT-Live kan behandle samtidig bruger- og
assistenttale, men `session.input_transcript.delta` har kun omtrentlige
lydintervaller og ingen markeret afsluttet samtaletur; manglende transcript
beviser hverken stilhed eller at lyd er ikke-henvendt. OpenAI anbefaler en
appstyret inaktivitetstimeout baseret på lydaktivitet, afspilning og ventende
arbejde (Managing GPT-Live sessions, afsnittene “Manage speech and transcripts”
og “Close idle sessions and resume”). Her kræver et sikkert close derfor to
uafhængige observationer: fysisk færdig assistentlyd/arbejde og frisk bevis
for at ny mikrofonlyd ikke er en henvendt opfølgning. En output-only timer
kan måle muligheden for lukning, men ikke alene give close-tilladelse.
`wait_for_user` er en modelfortolkning af et set input, ikke et tidsstemplet
verdict over enhver senere VAD-spændvidde. Den næste isolerede gate skal prøve
både transskriberet og ikke-transskriberet TV-lyd, lav dansk opfølgning over TV
og forsinkede providerhændelser på samme kandidat; ukendt relevans må ikke
rapporteres som bekræftet stilhed. Ingen ny produktionsadfærd er aktiveret.

## Aktiv releasebeslutning — manglende main-publicering efter PR81

PR81 blev merged 28/9 kl. 11:28:15 UTC som `43b2775635e2f760030cd1b6faee3f9a0e6178ec`.
PR-kontrollerne for `dcbeac2` er grønne, og main peger på merge-committet,
men GitHub oprettede intet push-workflow i de første minutter. Workflowet er
aktivt; manuel dispatch afvises (HTTP 422), fordi triggeren mangler. Årsagen
til det manglende push-event er ukendt. Vi antog da fejlagtigt, at image
1.13.109 ikke var publiceret; se efterfølgende registry- og installationsbevis
ovenfor. Ingen ny runtimehypotese udledes heraf.

Mindste recovery: tillad eksplicit manuel CI-dispatch kun på main og lad
publish-jobbet bruge præcis det checkout, de samme lint/tests og den eksisterende
immutable-version-kontrol. PR-events må fortsat kun bygge, ikke publicere;
push-events bevarer den nuværende path-filter. Ingen runtime-/firmwarefiler
ændres. Uafhængigt review skal kontrollere eventgating, ref- og artifact-
identitet, version-immutabilitet og at manuel job ikke omgår tests. Rollback:
ingen dispatch eller installation ved forkert SHA/version eller tvetydigt
publish-resultat. Dette er en releaseværktøjsrettelse, ikke ny produktfunktion.
GitHub eventlisten viser `PullRequestEvent` for PR81-mergen, men ingen
`PushEvent` for main, hvor PR80-mergen havde begge. Bruger har eksplicit
godkendt den begrænsede workflowændring efter automatisk reviews første
afvisning. Uafhængigt review af den faktiske workflowdiff: GO uden alvorlige
findings; dispatch kræver main, successful lint/test er `needs`, release-tag
kan ikke publiceres fra PR, eksisterende immutability-check består. PR kan
stadig lægge sit hidtidige build-cache-tag op; dette er ikke et release-tag.
Diffcheck og frossen releasegate PASS. PR82 merged som `725bf745a53df486dea96c02dc7214d8aed2ca6b`.
Den normale main-kørsel startede af sig selv; ingen manuel dispatch blev kørt.
Den korrekte versionsbeskyttelse afviste dobbelt-publicering. Se .109-status
ovenfor for den faktiske installation og åbne fysiske gates.

## Aktivt samlet mål — solid Alpha i køkkenet

Brugeren har eksplicit sat samlet goal: straks Stop/hurtig nextwake uden knas,
automatisk semantisk/timeout-afslutning ved TV/baggrundstale, samme blå roterende
arbejdslys, og gentagne fysiske køkkenforløb på samme installerede kandidat.
Goal-feature bekræfter active. Alle fire krav skal opfyldes; LED alene er ikke mål.
Frisk runtime-log indsnævrer107-fejlen: close11:21:57.919; providerterminal
11:22:00.799 og SDK-release færdig02.661. Native unexpected disconnect27.224,
connect27.235, handshake27.283, entities27.424, tom rearmACK27.470, wakeconfirm
27.472, recovered27.961. Lang recovery falder sammen med native reconnect.
Dette beviser ikke reboot eller decoder-deadlock; deadlines ændres ikke på gæt.
LED-review fandt lokal mute/failure kunne overskrives af rotation; rettet med
effekt-stop før lokal safety-visning. Uafhængig re-review GO på kilde/tests,
ikke fysisk godkendelse. Panelets vejledning følger den nye cyan-rotation.
Dette afsnit beskriver .108-forberedelse; nyere .109-status står øverst.

## Aktiv beslutning — .109 luk den målte Live-socketvent uden tidlig rearm

Lead: denne tråds hovedagent. På installeret .108 varede Stop→rearm 3,391 s;
providerens terminal kom efter ca. 0,960 s, og efterfølgende SDK-socketrelease
brugte 1,810 s. Lokal lyd standsede straks uden hørt klik i én brugerprøve.
Rigtig OpenAI SDK 3.13.0 med websockets 15.0.1 reproducerer, at manager-exit
kan vente på peer Close/TCP, selv efter gyldig `session.closed` og slutforbrug.
Det beviser en afgrænset softwarevent, ikke fysisk besparelse på Voice PE.

Berørt kæde: fysisk Stop→lokalt lydstop→Thin close→providerterminal→reader join→
transportlukning→budgetfrigivelse→firmware-rearm→næste wake; normal farvel,
idle-timeout, fejl, Talk/WebRTC og gammel generation er tilstødende grænser.
Berørte invarianter: én close-ejer, gyldig terminal og korrekt slutforbrug,
ingen tidlig budgetfrigivelse/rearm, ingen gammel socket ind i næste generation.
Falsificerbar hypotese: kun vent på peerens websocket/TCP-lukning efter fuldt
modtaget terminal kan fjernes ved at afbryde præcis den ejede WebSocket lokalt,
vente på lokalt `connection_lost`, og derefter gennemføre SDK-oprydning. Ukendt
terminal, startup og WebRTC beholder normal lukning. Ikke-mål: ændring af
semantisk timeout, VAD/gain, prompt/model, firmware eller fysisk lydstop.

Planlagte regressioner: rigtig SDK over lokal TCP med peer, der tilbageholder
Close/TCP, ventende og annulleret writer, sen gammel socket mod næste generation;
afvis forkert terminal/generation/transport og afbrydelse netop under lokal
lukning. Fælles Thin/lifecycle og Talk-adapter samt fast- og én frossen
releasegate kræves før PR/merge. Rollback-grænse: enhver ubekræftet lokal
lukning, tabt oprydningsejer eller tidlig rearm er NO-GO. Uafhængig reviewer
fandt faktisk cancellation-race i første diff: `wait_closed` kunne afbrydes,
mens references/lease blev frigivet. Kandidaten er derfor **ikke testklar**;
grænsen rettes og reviewes igen før gate eller installation.

### .109 rettet og uafhængigt reviewet — endnu ikke udgivet

Kandidatens faktiske kode afbryder kun den aktuelle primære WebSocket efter
accepteret `session.closed`, gyldigt slutforbrug og afsluttet reader; den venter
på lokal lukning og fuldfører derefter SDK-oprydning. Hvis lukningen afbrydes
eller timer ud, beholdes samme connection, manager, client og budgetlease;
`connect` afvises, og et serialiseret `close` genoptager netop den socket uden
nyt abort. WebRTC, ukendt terminal og inkompatibel transport følger SDK-vejen.
Ingen timeout, prompt, VAD, lyd eller firmware er ændret; add-on 1.13.109
genbruger installeret .108-firmware.

Uafhængig adversarial reviewer fandt den oprindelige cancellation-race og gav
NO-GO; efter rettelsen GO for kilde/tests uden P0/P1. Reviewerens endelige
kontrol: 184 OpenAILive-unit og 126 rigtig TCP/ThinLive/TalkLiveWav-integration
PASS, diffcheck PASS. Leadens separate fem SDK/TCP-cases PASS og Ruff PASS.
Dette er softwarebevis. Fast/releasegate, PR, publicering, installation og
fysisk Stop→næste wake på .109 er stadig åbne. Reviewet ændrer ikke status for
TV/baggrundstale, LED-feltprøve eller køkkenets 10/10.
Fast-gate på dette diff PASS i usynkroniseret dev-clone: hele integration- og
unitpakken, Ruff, format og mypy. Første sandboxkørsel kunne ikke binde lokale
testservere og er kasseret som miljøfejl; samme gate med loopback-adgang PASS.
Changelog er ukendt scope for fastværktøjet, så resultatet er mærket partial;
den frosne fulde releasegate kræves stadig.

## Aktiv beslutning — adskil firmware-wake fra pthread-join

Lead: denne tråds hovedagent. Observeret fejl: fysisk Stop→nextwake30.045s,
native disconnect/reconnect og gemt CPU1 interrupt-watchdog i TCP/select-semafor.
Eksakt106-kilde viser notification-array=1; main_task task/ISR-wake,
lwip_fast_select og wake_freertos bruger slot0. IDF5.5.4 pthread_join venter
på samme slot0 uden at kontrollere færdigtilstand igen før TLS-destruktion og
vTaskDelete. micro-decoder.stop kalder join fra mainloop. Uafhængig reviewer
har bekræftet kollisionen. Crash uden timestamp er konsistent, ikke fysisk
reproduktionsbevis for netop11:21-sessionen.

Falsificerbar hypotese: pending/samtidig normal loop-wake frigiver pthread_join
før HTTP-reader er færdig; TLS-semafor slettes mens select-waiter stadig er
registreret; efterfølgende TCP-data signalerer frigivet kø. Berørt kæde:
knap→lokalt lydstop→decoderjoin/HTTP→native ACK→Thin teardown→rearm→wake.
Invarianter: én lifecycle-ejer, fysisk playback-sandhed, ingen tidlig ACK/rearm,
ingen gammel generation ind i næste; begge reader/decoder og alle normale
wake-producenter skal bevares. Fejlgrænsen gælder også normal close/error og
play_url-prestop ved join af endnu kørende tråde, ikke kun knappen. For tidlig
decoderdeletion kan give lydbrud, men knas/pop er endnu ikke kausalt bevist. Ikke-mål: gain/VAD/model/prompt/timeouttuning,
ny transport eller ny motor.

Mindste planlagte grænse: reserver eget notification-index til alle ESPHome
mainloop-wake-producenter og consumer, behold pthreads slot0. Byg skal sikre
mindst2slots og reproducerbar patch af kandidatens genererede kilder, aldrig
ændre global installeret toolchain. Før implementation verificeres faktisk
upstream-mulighed og alle kald. Permanent actual-source regression injicerer
pending og samtidig wake under join og kræver at kun rigtig completion kan
frigive den; task/ISR/fastselect/consume og stale-events dækkes. Samlet
firmwarecompile, relevante runtime/adapterfelttests, uafhængig review og én
frossen releasegate. Rollback/stop-the-line ved manglende wake, tidlig rearm,
ukendt sourceidentity eller uløst race; ingen fysisk godkendelse arves.

## .108 implementation og første softwarebevis

Mainloop-wake er flyttet til index1 i tre nøjagtigt hashbundne genererede
ESPHome2026.6.2-filer: main_task task/ISR, lwip_fast_select producer og
wake_freertos consumer. Pthread beholder index0; SDK-notification-array=2.
Buildhook skriver kun projektkopier og afviser ukendt kilde/version før ændring.
Ingen global toolchainændring. 10 målrettede regressioner PASS (inklusive SCons-entrypoint, array-size-compileguard
og symlink/hardlink/source-drift-afvisning): kompilerede faktiske
wake-funktioner og IDF-pthread_join-krop reproducerer for tidlig trådsletning i
106-kontrol og bevarer begge joins i den rettede variant, ved pending/samtidig
wake fra task/ISR/TCP. Dette er softwaremekanismebevis, ikke fysisk crashrepro.
Kandidat108 har parrede markerændringer og cyan-roterende arbejdslys; UI-tekst
følger samme adfærd. Første isolerede udviklingscompile PASS123.93s i
/private/tmp/pv108-firmware, log /private/tmp/pv108-firmware-compile.log,
config_hash0x3e9cdaba. Genereret patch og effektiv kernelconfig2 verificeret.
Det bruger lokal komponentkilde og er ikke det endelige immutable releaseartifact.
Uafhængigt endeligt review og releasegates afventer. Kæden på hver side er kontrolleret: knapcallback stopper mic/reply lokalt,
resampler-stop og event kommer før decoderjoin ved behandling af stopkøen.
Native EventResponse omgår batchdelay og forsøger socketwrite synkront.
Ved socketbackpressure kan event dog køes, og sikre joins kan stadig
vente på rigtig HTTP-afslutning; derfor er Stoplatens/knas/nextwake og alle
køkkengates fortsat åbne. Kandidat2 er ikke aktiveret.

## .108 låst firmwarekilde og pinned compile

Uafhængig komponentreview GO. Sourcecommit
526ceb822938cfa2c1c6f7b0372228c954e38096 på codex/firmware-wake-isolation-108
(tree dc8d7337e5a8fb79bf1611600ea9c07122a2d528) indeholder de to reviewede
componentændringer. Alle tre firmwarepins bruger denne commit. 20-file manifest
2d755be7f9002bde64b1c9b16ca2bc7c84464d5cec04b9134f980a1a287ab67b.
Pinned ESPHomecompile PASS15.97s; config_hash0xa40f17cb. Hook byte-matcher
reviewet kilde, alle tre genererede kernefiler matcher patchhashes, og effektiv
kernel-notification-array=2. OTA c16abd3c472cda4f69316d2f2c9150420d9d6c1b66d66bc805d5c9d4e457041a;
ELF e66d44947ceb2da2fa72eddef7bff089cafcdc4c48646ef682016c1e56acfdf8.
Filer bevaret i /private/tmp/pv108-artifacts. Fastgatens delkontroller PASS (unit78.64s, integration55.05s, Ruff/format/mypy),
men outer gate afviste resultatet fordi lead ændrede denne STATUS-fil under
kørslen. Resultatet må ikke bruges som kandidatgate. Ingen produktfejl og ingen
runtimepatch; filerne fryses før autoritativ genkørsel. Slutreview pågår;
releasegate, PR/merge og installation er endnu ikke udført. Samtlige fysiske
gates står åbne. Dette ændrer ikke kandidat2 eller løser automatisk TV-relevans.

## .108 samlet review og diff-freeze

Uafhængig Astra-review semantic_eval_review GO til freeze/releasegate: cached
immutable commit er korrekt/clean, alle35 komponentfiler byte-matcher, tre
patchhashes, kopieret hook, effektiv kernel2, begge YAML, firmwaremarkers og
OTA/ELF er verificeret. 76 couplingtests PASS. Ingen uløst alvorlig finding.
Den ugyldige fastgate kasseres; én releasegate genkører samme kontroller på det
nu frosne diff og er autoritativ. Ingen filer ændres under kørslen. Reviewet
beviser ikke fysisk Stop, lydfri lukning, køkkenlifecycle eller semantisk TV-afslutning.

## .108 PR80 merged — publication/installation udestår

PR80 https://github.com/BixelVentures/podvoice/pull/80 head
42fa9bf459d78dd7e6f470c9d5c7bbeb9a6950f6 bestod CI36407978186:
lint-test108881154415 og build-addon108881154645 PASS. Merged som
 aeb03c3efdb9b52fa234d6b166fddc4d3d0dc7ee; merge-tree
33c4879364e1bd15f4dcfcbce322270d5068768b matcher præcis lokal testtree.
Main CI36408389105 PASS: lint108882477796 og publish108883414885.
Publiceret digest sha256:9e969000c5dc56b5697a2a2cfa13cdd5f5045eac4e5c60b9ae35b16a04134164.
HA viser fortsat1.13.107; panelrum er klar og
forbundet, ingen aktiv samtale. En browserhandling blev afvist af automatisk
review-routingtimeout; næste forsøg passerede review, men CDP-klikket fik
timeout. Synlig PodVoice-genvejsnavigation virkede; browseren er tilgængelig.
Ingen firmwareflash eller add-on-opdatering endnu.

## .108 endelig lokal releasegate

Frosset kandidat: releasegate PASS81.3s (unit80.94s; øvrige checks grønne).
Log /private/tmp/pv108-release-gate.log. Ingen filer ændret under kontrollen.
Kun denne resultatpost tilføjes bagefter. Exact-commit CI, ARM64-publicering,
parret add-on/firmwareinstallation og fysisk accept udestår.

## .108 installeret28/9 — fysisk accept stadig åben

HA-opdatering udført med sikkerhedskopi ON. UI bekræfter installeret/latest
1.13.108 og Kører. Den gamle update-entity blev opdateret med
homeassistant.update_entity før installation; ingen forkert version installeret.
Eksakt bevaret OTA c16abd3c472cda4f69316d2f2c9150420d9d6c1b66d66bc805d5c9d4e457041a
overført til192.168.86.27; ESPHome rapporterer OTA successful/upload9.86s.
Efter reboot læser nativeAPI markør podvoice_build_113108_livenotifyisolation1,
StopContext idle, reply stopped, wakeACK hey_chat_hey_jarvis og rearm recovered.
HA panel er v1.13.108, VoicePE forbundet. Gemt Alpha ON, begge wake words bekræftet,
UI-timeout4s, mute OFF, wake sound OFF, sensitivity Moderately sensitive bevaret.
Midlertidige firmware-mismatch events under parret opdatering er historiske;
forbindelsen er tilbage. Ingen lydtest eller musik startet under installationen.

Brugeren er bedt om én fysisk Stop-under-svar→straks HeyJarvis-prøve og at oplyse
knas/pop. Automatisk diagnostik kører. Ingen fysisk golden/10/10 eller køkkenaccept
registreret endnu. TV/baggrundstale-afslutning og kandidat2 er fortsat åbne;
providertrial afventer specifik privat nøgleoverførselstilladelse. Målet forbliver aktivt.

## .108 opfølgning28/9 — logs og evalberedskab

Frisk HA-log til12:32:11 viser runtime1.13.108/git aeb03c3,
rootfs-v1:33fd8d257709acd2051e570c518e262e78612dffdb17afd3566ea03335821fd4.
Firmwarekontrakt OK12:30:02.700, beggewakeACK02.747 og recovered03.235.
Ingen ny samtale/Stop-test i det læste interval; det er installationsbevis,
ikke fysisk gate. Fejl før12:30 tilhører det forventede versionsskift.

Den reviewede semantiske eval er nu bundet til den installerede .108-kildes
fingerprint55ece0737677e2ee6c2ef91cd0e1d63b0612c86971c1fb3713a3790b2346b205.
Sara-fixtures valideret på ny uden providerforbindelse. Ingen ny kode, prompt,
VAD eller timeout ændret. Providerprøve afventer fortsat det allerede stillede
spørgsmål om privat nøgleoverførsel og eksklusivt prøvevindue; fysisk Stop-prøve
venter på brugeren. Goal er aktivt; ingen afslutnings- eller køkkenaccept udledt.

## Frisk .108 feltprøve28/9 kl12:38 — fremgang, ikke samlet accept

Brugeren oplever måske1–2s utilgængelighed efter knapStop. Frisk HA-log:
close(stop)12:38:45.249 → provider close request45.491 → terminal46.452 →
socket release46.462–48.272 → release done48.279 → rearm recovered48.640.
Host-close→rearm=3.391s; providerterminalvent0.960s og socketrelease1.810s.
Ingen teardown-timeout/native disconnect i denne friske kæde. Næste fysiskwake
49.639 → samtaleåben49.642 → providerready51.882 (wake→ready2.243s).
Historikken matcher kendt input: historie blev afbrudt; næste samtale indeholder
Hvad er2plus2→Det er fire; Hvad sagde du→Jeg sagde det er fire; Tak→Selv tak.
Det beviser næste wake og semantisk konsistent input, ikke akustisk Stoplatens/pop.

Efterfølgende samtale: provider close request12:39:08.261 → terminal09.191 →
close(idle-fallback)09.634 → socketrelease09.746–11.046 → rearm11.426.
Den afsluttede via idle-fallback, ikke modelsemantisk farvel. Ingen værktøjskald
eller working-LED-case i det læste friske forløb; ingen fysisk første-lydsmåling.
Kontinuerlig TV/baggrundstale og gentagne lifecycleforløb er ikke bevist.
Native efterlæsning: .108, StopContextidle, reply stopped, beggewakeACK, rearmrecovered.
Browserens fjernadgang var midlertidigt utilgængelig; lokalHAHTTP200 og retry
hentede friske logs. Ældre cached106-log bruges ikke som108-evidens.

## Godkendt semantisk providerprøve28/9 — UNKNOWN, produktion genstartet

Brugeren godkendte privat OpenAI-keyoverførsel til lokal prøve. Reviewet one-use
loopbackform modtog nøglen; browservariabel ryddet og formular lukket. HA var
verificeret Stoppet under forsøget og Kører bagefter før brugerens knapprøve.
Session25227 terminal exit3: baseline completed-side-address UNKNOWN ved
observation_deadline; clean_shutdown=true, usage_complete=true, connect_attempts=1,
fixtures_complete=true, opening_answered=true, recognized=false, end_calls=0.
Batch stoppede efter baseline som reviewet; implicitvarianter ikke kørt.
Rapport /private/tmp/pv108-semantic-trial-01/baseline-completed-side-address/report.json.
Nøglen er kun i proceshukommelse/childmiljø, ikke rapport eller git. Ingen
produktionsprompt eller kandidat2 aktiveret. Næste evalskridt er audit af faktisk
fixturegenkendelse; UNKNOWN må ikke behandles som bevis for modelpolicyfejl.

## Evalaudit28/9 — UNKNOWN har konkret inputafvigelse

Timeline fra baselineprøven viser korrekt math-input (Hvad er2plus2) og svar4.
Side-address-fixturens forventede Peter blev derimod transskriberet Bliver:
Bliver nu taler jeg med dig. Hvad skal vi have til aftensmad. Modellen svarede
Hvad har du i køleskabet? Ingen end_conversation. Derfor er prøven ikke et
kontrolleret bevis for genkendt personhenvendelse eller implicit-policy, som slet
ikke blev kørt. Rå source/providerinput er bevaret; næste skridt er audit af
første ords audio/pacing, ikke lempelse af oraclen eller produktionspromptpatch.
Stop-oprydningens manager.__aexit__ er samtidig sendt til uafhængig kildeaudit
for at afgøre SDK/protokolgrænsen bag de målte1.810s. Ingen runtimeændring endnu.

## Aktiv beslutning — luk færdig Live-transport uden ekstra peer-venten

Lead hovedagent. Direkte .108-feltbevis: Stop→rearm3.391s, heraf socketrelease1.810s
EFTER sessionterminal/slutforbrug. Uafhængig SDK-audit: OpenAI3.13.0 managerexit
kalder websockets close, som venter Close-handshake og TCP/TLS-ophør. Loggen kan
ikke skelne disse underfaser. Hypotese: peer-venten efter gyldig slutkvittering
kan fjernes ved at abortere præcis den ejede transport og afvente lokal lukning.
Kæde: fysiskStop→lokal stilhed→session.close→currentgeneration terminal/usage→
readerjoined→transportclosed→clientcleanup/budgetrelease→rearm→næste wake.
Invarianter: ingen tidlig rearm, ingen gammel writer/event ind i næste generation,
én ejer, slutforbrug må ikke opfindes; ukendt finalization/startupfejl og Talk bevares.
Ikke-mål: timeoutændring, baggrundsoprydning, ny motor, gain/VAD eller prompt.
Før runtimepatch: faktisk SDK+TCP-repro af tilbageholdt peer shutdown, præcis
websocketdependencyidentitet (lokalt15.0.1; image transitive endnu ikke fastlåst).
Regressioner: pendingwriter, cancellation, duplicateclose, sen event/nygeneration,
valid vs missing terminal, begge I/O-adaptere. Adversarial review og relevante
gates før release; rollback ved nogen uafklaret transport/usage/ownergrænse.
Fysisk Stoplatens/klik/lifecycle skal bevises på ny kandidat; .108 arves ikke.

## Uafhængig audioaudit — lokalt testinput intakt

semantic_eval_prepare verificerede hele side_address121552bytes som én byteeksakt
forekomst i source-0.pcm ved offset208640 (6.52s), inklusive første ord.
Samme StreamResampler16→24k reproducerer alle1864318providerinputbytes eksakt,
SHA539e94f31c5b79728fcf90bd568664a90b6f56137d01ff651731248970cbf02f.
Ingen hostclipping/resamplingafvigelse. Sideklippet starter2.019s efter math-
svartranscript; dette er pacing, ikke fysisk outputdrænbevis. Resterende usikkerhed
ligger i syntetisk udtale/providergenkendelse/serveringestion; klientoptagelsen
beviser ikke serverens lydmodtagelse. Oraclen afviser også2vs.to; selv korrektion
heraf vil ikke gøre den fejlgenkendte personhenvendelse til gyldigt policybevis.
Ingen ny fixture, oracle, runtime eller firmware ændret på dette resultat.

## Brugerbekræftet .108 lydstop28/9

Brugeren svarede på den konkrete seneste Stop-prøve: talen virkede til at stoppe
straks og uden klik/knas. Registreres som positiv menneskelig observation for
denne ene kandidat/prøve, ikke millisekundmålt akustisk latency eller10/10.
Kombineret med trace er resterende observeret problem3.391s til rearm, mens
lokalt lydstop nu opleves øjeblikkeligt og uden pop. Bevar denne lydvej.

## .109 kandidatforberedelse — rigtig SDK/TCP-reproduktion

Main publishjob108883414885 for installeret108 indeholder wheelvalget
websockets15.0.1 til OpenAI3.13.0 på ARM64; dermed matcher lokal Pythonprøve
faktisk imageafhængighed for disse to pakker. Kontrolleret rigtig SDK+rå lokal
TCPpeer i /private/tmp/pv-live-cleanup-probe.py PASS efter godkendt loopback:
managerexit hænger mindst250ms både uden peer Close og når Close er sendt men
TCP holdes åben, selv efter gyldig typed session.closed/usage. Efter abort af
præcis egen socket + await wait_closed + almindelig managerexit er lokal
shutdown0.116–0.303ms på fire cases. Pending og cancelled writer havde
8327182bufferbytes før og0 efter; alle opgaver joined, ingen baggrundstasks.
Forsinket old.abort under aktiv næste socket lod ny session.close og matchende
terminal lykkes. Dette er faktisk SDK/transportrepro, ikke produktion/physical.
Minste runtimegrænse undersøges: kun primær WebSocket med gyldig aktuel terminal
og slutforbrug, efter joined reader; ingen WebRTC/startup/ukendt usage ændring.
Privat SDK-internal kræver versionsguard/fallback og adversarial review.

## Native crash-bevis28/9 — årsagsgrænse under undersøgelse

Read-only native logsubscription på installeret106 rapporterede gemt crash fra
forrige boot: `Interrupt wdt - Interrupt wdt timeout on CPU1`, core1, PC0.
Backtrace: 4037DFB5 4038171A 421352BE 420A3476 4209299F 420A52CD
4209A812 4209F146 420A2FCA 42094652; core0:4037E0EB 42133A99 42135B53.
Dette beviser et tidligere firmwarecrash, men har ikke eget tidspunkt og beviser
endnu ikke at netop11:21-Stop udløste det. Det er interrupt-watchdog, ikke den
separate5s task-watchdog. Dekodning mod106-ELF sha256
f0c633fa51e24de18df6709386b43dd6aa0e24a691601bab435844568aad62e2
og matchende shipped OTA a1508bda15250e31bc89d0627d00bb5bcf4a60ad7e326ebc02594ef12156fd1a:
CPU1 esp_cpu_compare_and_set→spinlock_acquire/xPortEnterCriticalTimeout→
xQueueGenericSend→sys_sem_signal→select_check_waiters/event_callback→recv_tcp→
tcp_input→ip4_input→ethernet_input→tcpip_thread; core0 idle. Dette afviser
at denne stack direkte beviser decoderjoin/mainloop-taskwatchdog. Næste
årsagsgrænse er select-waiter/semafor under TCP-modtagelse; ingen runtimepatch
før levetid/ejerskab er afgrænset.
Efterfølgende readback har gyldig idle stopcontext, stopped reply, begge wakeACK
og recovered rearmACK; kun WakeReference har missing_state=true. Tidligere tomme
strenge må derfor ikke i sig selv bruges som permanent fejlbevis. Ingen reboot,
flash eller ny lydprøve udført under denne aflæsning.

## Frisk107-driftslog —30s Stop→rearm, native lukning fejler

HA-browseradgang genetableret efter brugerens fortsættelse. Renderet driftslog
session814eca8331807d096e2e4b2253dc32bbc7512b7f09a95a443c13fdb2571aa71f
fra11:21:39: button18030ms, close18032, silence-device timeout20034,
stop-context-disable24036; heartbeat-stop/attention-release total-deadline24036/37.
Retry silence27052/33122/42171, context29106/35146/44193. Teardown47838,
rearm48075:30.045s efter knappen. Provider-close fremgår ikke som timeout.
Dette falsificerer at107-HTTPabort alene løser feltrecovery. LEDændring er
separat visning; næste kausale audit retter sig mod native lydstop/contextACK.
To første retentionposter er samme session, ikke to separate prøver. Lydtrace
20260928T112139-886-c7d27e14 er ufuldstændigt; knasets årsag er fortsat ukendt.

## Ny feltfejl efter107 — Stop/hvid, forsinket wake og støj

Brugeren: ét tryk Stop gav hvid LED og Hey Jarvis åbnede ikke straks; senere
virkede Hey Jarvis. Arbejdsanimation sås også, og hvid kom igen med højttalerstøj
(knas/pop, brugerbeskrevet som støj på linjen). Derfor er107 fysisk Stop→nextwake
FAIL; hverken varighed, årsag, reboot eller lydgrænse er bevist. Native readback
bekræfter106-firmware/mute=false, men tomme context/reply/wake/rearm-statusser.
Det beviser ikke reboot. Kilden viser Stopwhite ved button_stop_latched, og
hostlys kan ankomme efter lokal Stop og overskrive det; fejllys kan også være
reel cleanupfejl. Amp toggles kun ved boot, ikke eksplicit Stop/rearm. Ingen
lyd-/gain-/timeoutpatch på gæt. Den tidligere anmodning om fysisk resultat er
nu besvaret; problemet er dokumenteret, ikke afklaret.

Brugerbeslutning: Alpha arbejdslys skal have samme blå/cyan som samtalen og
rotere, ikke rav/rød som arbejdsindikator. Review finder konkret mangel: eksponeret
led_ring har ingen effekter og nuværende workingfarve er rav. Planlagt afgrænset
LED-kandidat skal bevare Thin-ejerskab, closing/epoch-fences, fysisk Stop/rearm,
ægte fejlindikering og OFF-adapterkontrakt. Regressioner skal dække stale work
efter Stop/ny generation og native effektudbud; firmwarecompile og uafhængig
review før installation. Ingen ændring af lyd/lifecycle som skjult LED-bivirkning.
Rollback ved falsk arbejde efter Stop eller ændret næste-wake-kæde.

## .107 PR79 installeret — Alpha ON, fysisk Stop-gate åben

PR79 https://github.com/BixelVentures/podvoice/pull/79 merged efter CI36399385518
lint-test og build-addon PASS på6c16a8c6dc65dfe5a45bfbf7c4634a1b102f7e01.
Main df8565c5332f7da2c841cf64c9f2a7a6ba922890 er byteidentisk med den testede
tree e5fbb6acc7829f17ea936bc1f04a39bc40ac872a. Main publiceringsrun36399807431
PASS med lint-test og publicering. Image-digest:
sha256:95666e7d4cbd6e312e24128697c43655c132330e657ee3e79ae7f9c2cb284f0a.
HA-opdateringsdialog viste106→107 med sikkerhedskopi valgt; installation
afsluttet: HA viser Nuværende version1.13.107 og Kører. Frisk ingress viser
v1.13.107/statuslive, Voice PE forbundet, GPT-Live Alpha checkbox checked og
begge wakewords bekræftet af enheden. Ingen aktiv samtale. Ingen ny firmwareflash.
Screenshotforsøg blev blokeret af en åben Chrome-extension-UI; ingen omgåelse.
Fysisk Stop/nextwake, rumlyd og10/10 er fortsat åbne. Forudgående HA-info
readback28/9 viser .106 Kører. Alpha/fysiske gates er ikke godkendt af CI.

## Åbne adgangskrav efter installation28/9

Stopprøve på107 er besvaret med fejl; frisk evidens og aktivt mål står øverst.
Automatisk afslutning kan ikke godkendes: providerforsøget er reviewet/offlineklart,
men den specifikke private OpenAI-nøgleoverførsel og korte eksklusive pause har
endnu intet svar. Ingen key flyttet, listener startet eller providerforsøg kørt.
Browseradgang er siden genetableret efter brugerens fortsættelse; den tidligere
Chrome-extension-blokering er ikke længere aktiv.
Ingen aktive test-, build- eller installationsprocesser afventer. Næste meningsfulde
trin er ny fysisk evidens og den særskilt autoriserede modelprøve; yderligere
gættede runtimeændringer er ikke begrundet. Goal forbliver uafsluttet.

## Kandidat .107 — afgrænset HTTP-Stop og lukkediagnostik

Leveret som add-on-only feltkandidat med eksisterende .106-firmware; ingen
firmwarekontrakt, LED, gain, wake, model, prompt eller timeout ændres. Bevist fejl
er serverens bevarede transportkø efter cancel, ikke hele16s-feltårsagen. Samme
Stop→provider/HTTP→device→cleanup→rearm-kæde og rollbackgrænse som beslutningen
nedenfor. De isolerede evalscripts ændrer ingen produktionsindstilling og aktiverer
ikke kandidat2. Release-metadata løftes samlet til1.13.107. Review af endeligt diff
og én releasegate kræves før PR/installation. Ingen fysisk godkendelse arves.
Endelig samlet packaging-review semantic_eval_review GO28/9: versionsfiler
er samstemmende, firmware/settings/prompt uændrede, evalscripts uden for
Docker-buildkontekst og ingen aktivering. Diff frosset; præcis én releasegate PASS79.4s: candidate-scope, Ruff/format,
mypy, hele unit- og integrationssuiten. Resultat /private/tmp/pv107-release-gate.log.
Efter gaten blev kun resultatposten tilføjet før PR. PR/exact-commit CI,
ARM64-publicering og installation er siden bekræftet ovenfor; fysisk kontrol udestår.

## Feltkontrol28/9 09:47 — .106 stopper hørbart, men Stop-recovery er stadig langsom

Bruger: knap-tænd/sluk virkede perfekt, korrekt to-plus-to-svar; Hey Jarvis virker
igen. Native direkte readback: Alpha106 marker, mute=false, Moderate, begge wake
ACK. Teknisk log registrerer Hey Chat og Hey Jarvis; ingen gain/thresholdændring.
Første rapport om manglende Hey Jarvis er ikke forklaret af dette. Detektorens
stop/start under oprydning ses; ingen påstand om akustisk 99,9% wake.

Vedvarende driftsdiagnostik for math-session
6e35ca657c47419f0c4c4db9adc88abd20256ac1c5c9efe1ac458a991c9b5447:
button +7331ms, close(stop)+7333, timeouts+9335/+13336/+13337, rearmblocked+13338,
retrytimeouts+16347/+18367/+22385, teardown_complete+23720,
wake_rearm_recovered+23993. Button→rearm16.662s. Brugerens oplevede gode stop er
ikke det samme som prompt cleanup/nextwake. .106 er IKKE lifecycle-godkendt;
Stop-retryrettelserne forklarer/løser ikke den fulde feltfejl. Årsagsgrænsen
undersøges på ny før mere runtimepatch eller release.

Næste session4254d3683dfe7966f3ae490361f08b671df4cf50b6f441054621a3d4c1646bb2
(09:47:32, tidsforespørgsel) close(idle-fallback)+16192, teardown+17759,
rearm+17970; altså automatisk timeout, ikke modelsemantisk slut. Denne log viser
ingen tilsvarende teardown-timeouts. Audio-trace20260928T094732-043-b064c708 er
ufuldstændigt pga tabte måledata. Hverken rumlatens, golden chain eller10/10 bevist.

## Afgrænset diagnosekorrektion28/9 — behold lukketrinnets navn

Den friske vedvarende driftslog har teardown_step_timeout uden step, selv om Thin
allerede producerer det. Årsag direkte i diagnostic_retention: ukendte strings
fjernes, og step er ikke tilladt. Ret kun retention med en fast allowlist for
eksisterende teardown-trin og total-deadline på teardown-events. Ingen privat tekst,
ny logfrekvens eller ændring af Stop/timeout. Regression: rigtig recorder-persistens
bevarer step ved timeout/fejl, men afviser ukendte værdier og andre eventtyper.
Implementeret lokalt: fast allowlist, seks relevante retentiontests PASS og Ruff
PASS. Ikke installeret. Uafhængig stop_causal_audit-review GO for den afgrænsede retentionrettelse.
Dette gør næste almindelige prøve forklarlig, men løser ikke16s-fejlen. Review og
relevante gates før senere samlet kandidat; ikke selvstændig installation nu.

## Aktiv beslutning28/9 — kasser HTTP-transportkøen ved annullering

Kontrolleret faktisk _live_audio/aiohttp/TCP-prøve (pv106_transport_probe.py) har
55056 bytes vedvarende write-buffer før cancel. close() returnerer fra handler,
men socket/buffer består efter250ms; når klienten læser, leveres de55056 bytes.
Eval-only abort() lukker socket og fjerner buffer; normal finish leverer identisk
25644bytes WAV+PCM i begge varianter. Accelereret producer/pauset klient er en
stressprøve, ikke fysisklatens eller bevis for ESP16s-årsagen.

Berørt kæde: fysisk/panelStop → Thin.cancel → LiveAudioStream.cancel → HTTPwrite
→ TCP → firmwaredecoder → lokaltstop/dræn → ACK → rearm. Invariant: Stop skal
kassere ventende assistantlyd; allerede leverede kernel/devicebytes håndteres
fortsat af firmwarecancel og eksakt dræn. Hypotese til afgrænset patch: abrupt
cancel/incomplete skal abortere samme requesttransport, ikke gracefulclose; normal
finish/write_eof bevares. Ingen ændring af bufferstørrelse, lydtærskel, model,
timeout eller semantisk policy. Identitet og næste streams beskyttelse bevares.

Permanent regression skal bruge rigtig handler og TCP-backpressure, vise positiv
kø før cancel og nul bagefter, normalfinish fuld PCM og næste stream upåvirket.
Uafhængig review + relevante gates før release. Rollback ved trunkeret normalfinish,
ny transport/rearmfejl. Fysisk Stop/næste wake og16s-årsag står fortsat åbne.

Implementeret: kun de to abrupt/incomplete transport.close-kald i _live_audio
er ændret til abort. Normal write_eof er uændret. Den permanente TCP-regression
fejlede før rettelsen og består efter: faktisk vedvarende buffer, ingen klientlæsning
før socket lukket/buffer nul. Sen gammel cancel på samme keepalive-forbindelse
afslutter ikke næste request; normal fuld PCM bevares.33 fokuserede HTTP/Talk/Thin-
tests og Ruff PASS. Uafhængig semantic_eval_review GO uden åbne findings.
Reviewhash web.py faa5f7642a0da37e7aef2dc2133804787ed7bf8e762f7a0fd7ac1284bccf2fb9;
test_live_audio_web.py b0dbc211416e2e57a47333df3e0d0153acd42b8285703f4260ea0c679ef49680.
Fast-gate første forsøg afvist af sandboxens loopback-restriktion; ikke produktfejl.
Samme fast-gate med godkendt loopback PASS78.3s: Ruff/format/mypy samt hele
unit- og integrationsscope. Runtime/testdiff uændret under gate. Ingen release
eller installation endnu; .106 forbliver installeret og Alpha ON.

## Årsagsgrænse28/9 — synkron decoderstop, endnu ikke bevist feltårsag

Den byggede .106 dependency DecoderSource::stop joiner reader/decoder synkront
fra ESPHome mainloop via SpeakerSourceMediaPlayer STOP. Det kan blokere native
ACK-publicering. Modbevis mod simpel cirkulær venten: Thin annullerer allerede
LiveAudioStream før ACK-wait; HTTP handler lukker transport, og decoder kontrollerer
stop mellem reads. transport.close er graceful, ikke abort, men buffered-data-
hypotesen er ikke bevist for den faktiske ESP-reader. Ingen runtimepatch foretages
på denne antagelse. Kontrolleret rigtig TCP/handler-repro undersøges; native log
under brugerens næste prøve skal skelne mainloopstall, HTTPstop og native reconnect.

## Evalcheckpoint28/9 — reviewet forsøg, endnu ingen modelresultater

scripts/live_semantic_completion_eval.py bruger .106 Thin/Live og kun syntetiske
Sara-fixtures. Baseline/implicit, fire cases, 45s observation, én forbindelse,
ingen hjemværktøjer/mikrofon og ingen timed append. Uafhængig Astra-review fandt
forkert tool-result-envelope, manglende wait-description-undtagelse og for svag
oracle. Alle tre rettet;228 offline tests og Ruff PASS. Re-review GO kun til
begrænset providerprøve. Modelbeslutning, natural close og deadline-cleanup er
adskilte; fysiskdræn/continuousTV er UNKNOWN. Provider ikke kørt. Eksisterende
OpenAI-key findes ikke i procesmiljø. Privat engangsoverførsel og et begrænset
pausevindue er forelagt brugeren; ingen credential flyttet endnu.

Engangshandoff scripts/live_semantic_completion_handoff.py er ligeledes reviewet
af semantic_eval_review: GO til den afgrænsede prøve;26 offline tests PASS. Fast
baseline/implicit-positive/implicit-followup,30s admission og210s sekventielt budget.
Stopper på ukendt/ufuldstændigt resultat; credentials ikke i argumenter/log/filer.
Ingen listener/provider startet. Den specifikke nøgleoverførsel/pause afventer svar;
operatøren ejer altid genstart. Dette er forsøgsberedskab, ikke modelvalidering.

Native55s-log af første prøve understøtter beggewake-detektioner. Senere240s-
read-only Stop-observation afsluttet uden ny brugerprøve; kun konfiguration og
Wi-Fi roamcheck(-41dBm). Det er ikke bevis for Stopfunktion eller fejlårsag.

## Aktiv beslutning 28/9 — eksterne systemer og isoleret semantisk forsøg

Research af LiveKit AgentSession/UserIdle, Pipecat UserIdleController, HA ChatLog og
ESPHome viser mekanisk idle/drain, ikke en valideret skelnen mellem henvendelse og
TV. Apple/Alexa DDSD-forskning kombinerer lyd og kontekst. AttenLabs SAA tilbyder
hostet addressedness, men SDK er ikke åbne modelvægte; cross-lingual recall er en
kendt begrænsning. Der tilsluttes ingen ny tredjepart eller filtrering af huslyd.
Kilder: https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/agent_session.py
https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/turns/user_idle_controller.py
https://machinelearning.apple.com/research/llm-device-directed-speech-detection
https://github.com/attenlabs/saa-sdk

Hypotese til separat eval, ikke runtime: Live kan positivt genkende færdig udveksling
og efterfølgende tydelig henvendelse til en anden person, delegere dette og lade
backend bruge eksisterende end_conversation(silent=true). Startup-kontrakten skal
være konsistent i primary/backend/end/wait descriptions. Ingen tidsudløst append,
ingen omskrivning af Thin og ingen ny classifier aktiveres. Ren TV-tilstedeværelse,
tavshed, almindelig kvittering eller tænkepause er ikke positivt afslutningsbevis.
Kæde: deklareret syntetisk lyd → rigtig Live SDK → backendbeslutning → Thin receipt
→ inputrevision/freshness → naturlig close eller dokumenteret manglende native drain.
Hvert nyt transcript kan fortsat annullere receipt; dette omgås ikke i forsøget.

Berørte kontrakter: model ejer hensigt, Thin ejer lukning, gammel input/receipt må
ikke krydse generation; OFF/Talk/firmware er urørt. Falsificering: manglende silent
end på fuldt leveret positiv fixture eller end på reel opfølgning. Regressioner skal
skelne modelbeslutning fra harnessens deadline-cleanup, låse faktisk wireconfig,
bevare rig-defaults og forbyde rigtige handlinger. Uafhængig review før providerprøve;
ingen installation eller kandidat2-aktivering på syntetisk evidens. Rollbackgrænse:
evalfiler kan fjernes; produktion forbliver .106. Runtime/fysiske gates stadig åbne.

Ny brugerobservation: Hey Jarvis vækker ikke efter .106. Dette prioriteres før
Stop-prøve. Direkte native readback bekræfter online enhed og Alpha106 marker;
UI gemt/ACK valg er Hey Chat + Hey Jarvis. Dette beviser ikke fungerende detektor.

## Installeret28/9 — .106 Stop-retry, Alpha ON; automatisk baggrundslukning stadig åben

PR78 https://github.com/BixelVentures/podvoice/pull/78 merged efter PR CI36391424701
PASS på172b99b12093870095ee653d608c20b12b8c5149. Main
bba87b9a3497da4793e9306f2e59de2d305ad74a har samme tree som kandidaten;
main CI/publicering36391774469 PASS. Publiceret image digest
sha256:2c32a9b2f6dde11dd36dbef775db0c0c752be8df831863b7fa3b71f9f6fa59cc.
OTA106 upload PASS8.99s; native krypteret readback bekræfter
podvoice_build_113106_livecancelretry1 på podvoice-pe-0a7e7a. HA105→106 installeret
med backup valgt, Kører og frisk ingressv1.13.106/statuslive verificeret.
Voice PE forbundet; GPT-Live Alpha checkbox checked efter genstart. Ingen lydprøve,
ikke fysisk Stop-/golden-/10/10-godkendt. Kandidat1 observation fortsat aktiv;
kandidat2 er stadig dormant og løser endnu ikke TV/side-conversation-inaktivitet.

Brugerens næste prioritet: sammenlign konkrete andre systemer/repos og genbrug en
bevist relevant afslutnings-/addressedness-mekanisme. Ny audit viser, at hver nonempty
Live-inputtranscript revokerer pending semantic end; continuous TV kan derfor også
forhindre en ellers korrekt semantisk beslutning i at blive færdig. Dette må ikke
fjernes blindt, da nye reelle henvendelser skal kunne annullere lukning. Et muligt
startup-only implicit-semantic-end eksperiment er ikke kandidat2-aktivering og
kan ikke alene love continuous-TV-recovery. Ingen ny produktionsprompt ændret.

## Aktiv beslutning 28/9 — Stop-retry bevarer fremdrift; inputrelevans stadig gated

Bruger har nu bekræftet, at efterfølgende vejrtale var til andre/TV. Raw VAD
er derfor utilstrækkelig inputrelevans for denne feltcase. Ingen lokal fraseregel,
transcriptpause eller ukritisk output-only timeout indføres. Kandidat2 må først
aktiveres med valideret addressedness-kilde; denne rettelse hævder ikke at løse
den akustiske/semantiske del uden dens manglende bevis.

Stopkæden nedenfor viser native silence/context-timeouts. Uafhængig Astra-audit
fandt to konkrete retry-svagheder, men ikke en bevist samlet feltårsag: duplicate
cancel nulstiller firmwaredræn; host cancellation kasserer en udestående disable-
kvittering og næste retry skifter generation. Hypotese: forsinket kvittering og
gentagne requests kan forkaste fremdrift, selv om den oprindelige lukning arbejder.
Regressionerne skal først reproducere dette. Hele kæden: fysisk button mic/reply-
latch → native event → Thin close → silence → provider close → context disabled →
heartbeat/attention → eksakt rearm → næste wake. Providerterminal alene beviser
ikke SDK-close-return. To sekunders hostdeadline ændres ikke på gæt.

Berørte invarianter: én Thin close-owner, eksakt session/generation/playback,
fysisk dræn før rearm, sen event inert på næste session, OFF/Talk bevaret.
Planlagt afgrænset ændring: idempotent samme-token firmwarecancel i STOPPING;
bevar kun en allerede sendt closing-disable-request over hostwait-cancellation,
aldrig en enable/live-permission. Frisk forbindelse/reset/rearm invaliderer den.
Tests: partial drain→duplicate cancel→oprindelig fence/deadline; canceled disable
→late exact ACK→retry; forkert identitet, sendfejl og next-generation ACK; fælles
Thin/VoicePE og Talk. Nødvendig independent review, fast og én frozen releasegate;
firmwarebyg/installation og fysisk Stop/ny wake skal eksplicit bevises. Rollback
til installeret105/.103; kandidatstatus IKKE TESTKLAR før disse gates.

Implementeret checkpoint: idempotent firmwarecancel og exact late-disable proof er
kodet. 63 målrettede unit/native/firmwaretests PASS; sammensat rigtig Thin→VoicePELink
med Alpha ON/OFF PASS (timeout→late ACK→samme retry→rearm→nyt nonce→gammelt ACK inert).
Astra uafhængig source review GO efter revision-fences ved lock-entry/send/return og
fault/reset/rearm/new request. Ingen fysisk eller kandidat2-godkendelse.
Fast-gatens lint/format/mypy PASS; integration blev først blokeret af sandboxens
lokale socketforbud. Samme fulde integrationstage kørt med lokal socketadgang PASS;
ingen runtimepatch baseret på miljøfejlen. Unit-sibling blev afbrudt og kræver fuld gate.

Firmwarekilden er publiceret via GitHub-connector, fordi lokal Git-auth fejler.
Remote source commit f7384c759dd4eef937ca210b1c3d76c04b6dfd0b har samme tree
693aa151139c754790759d26cbba02905b1d1a5a som lokal sourcecommit4ca40fd.
Alle tre pins er opdateret; default113106_cancelretry1 / Alpha113106_livecancelretry1.
19-file source manifest98b4e590854e012a006910361450ad0485a648c10e29a100c7b48bc90335a0b0.
ESPHome2026.6.2 Alpha compile PASS16.21s; config_hash0x8ec32c25.
Genereret podvoice_reply.h byte-matcher den reviewede fil. OTA SHA256
 a1508bda15250e31bc89d0627d00bb5bcf4a60ad7e326ebc02594ef12156fd1a.
Artifact ligger i /private/tmp/pv-firmware-0927-build/.esphome/.esphome/build/
podvoice-pe-live-alpha/.pioenvs/podvoice-pe/firmware.ota.bin. Endnu ikke installeret.

Officiel Live sessions-/promptguide genlæst28/9: prompt kan bede modellen ignorere
nearby conversation, men de gennemgåede guider dokumenterer ikke et intervalbundet
addressedness-event til appen. Inaktivitet er appstyret og transcriptpauser er ikke
stilhedsbevis. Den eksisterende prompt indeholder allerede baggrundsreglen. Derfor
løser en ny formulering alene ikke den beviste native inputblokering. Semantisk
inputrelevans kræver stadig valideret kilde og separat integration før kandidat2.

Frozen releasegate28/9 PASS77.5s: lint/format, candidate-scope physical_output,
mypy54, full integration54.04s og full unit77.18s. Uafhængig packaging-review GO:
alle14 genererede C++/headers byte-matcher, YAML og marker verificeret. Ingen
SafeEval nødvendig: prompt/schema/provider-semantik er uændret. Installation,
eksakt commit-CI/ARM64 og fysisk Stop/ny wake mangler; HA viser fortsat Voice PE
offline. Add-on må ikke installeres alene med den gamle .103 firmware.

## Feltbevis 28/9 — kandidat1: manglende automatisk slut og langsom Stop-oprydning

Frisk HA-ingress viser 1.13.105/status live. Bruger melder "it did not stop".
Seneste trace `20260928T070318-637-bab2ff1f`, sessionhash
`b293f843ecd88b6c330659cc2248ec69e92aedeca386e3511eb00fa8fcc4602e`.
Tider nedenfor er relative host-logtider, ikke rumoptaget lyd:

- Ved +30.254s er output-only shadow klar med 4.015s; runtime har kun
  0.305s input/output-ro. Ved +31.282s er shadow 5.05s, runtime 1.34s.
  Ingen ventende responses, batches, tools, continuation eller pending audio.
- Ved +31.293s bliver native input active (probability180); +32.296s og
  +33.339s viser `input_not_quiet`. Nye provider-inputfragmenter fra +32.022s
  nulstiller også shadow-owner. Dette beviser inputgrænsens blokering, ikke
  om lyden var brugerhenvendt tale, baggrundstale eller støj.
- Ingen semantisk lukning i den viste tidslinje. Knap +34.182s,
  `close_requested(reason=stop)` +34.184s. Syv teardown-timeouts, gentaget
  `rearm_blocked_incomplete_teardown`; teardown først færdig +50.255s,
  `wake_rearm_recovered` +50.517s: 16.335s efter knapregistrering.
  Loggen beviser ikke tidspunktet for fysisk mic-/speaker-stop.
- Lydsporet er automatisk delt og markeret ufuldstændigt/tabte måledata.
  Den viste driftsdiagnostik er fragmentarisk på tværs af gemte dele, selv
  om de enkelte retentionpakker angiver dropped_events=0. Ingen fuld
  fysisk golden chain eller 10/10-godkendelse.

Konklusion: kandidat1 leverer den tilsigtede adskillelse mellem output-ro og
inputveto, men løser ikke timeout. Kandidat2 forbliver inaktiv: valideret
klassifikationskilde og integration mangler stadig. Stop-oprydning er et
separat dokumenteret fejlsymptom, der skal årsagsafgrænses før runtimepatch.
Næste evidens er konkrete teardown-stepnavne fra trace samt sammenhængen
mellem inputlyd/providerfragmenter og idle-reset. Ingen gain-/timeouttuning
eller kandidat2-aktivering udført i denne loggennemgang.

## Installeret 27/9 — 1.13.105 observation aktiv, kandidat2 inaktiv

PR77 https://github.com/BixelVentures/podvoice/pull/77 merged. Reviewed head
5fbe6abcb6b0004a1d3761363948c15005362ab4; main
ee2eca7f22944831dab72e9c79cbd9d079990dd0. PR CI36347307754 PASS;
main CI/publicering36347572544 PASS. Publiceret ARM64 digest
sha256:e838e33124974d05cc44ce7900e0b92d4250fceb8f17a5b3b0f3bbf76928ef01.
HA-opdatering .104→.105 med backup valgt er gennemført: installeret/nyeste1.13.105,
Kører verificeret. Frisk ingress viser v1.13.105/status live og Alpha ON checked.
Firmware .103 er uændret; ingen ny LED-/knap-/lydprøve. Voice PE er bevidst uden
strøm, så fysisk smoke/10/10 og nye feltmålinger afventer næste almindelige brug.
Kandidat1 observerer automatisk næste Alpha-samtale. Kandidat2-koden er dormant,
uden produktionimport eller klassifikator; hverken aktiveret eller fysisk bevist.
Timeoutproblemet er derfor ikke erklæret løst af denne installation.

## Kodeplan 27/9 — robust Alpha-afslutning (plan, ikke implementeret)

Implementeringsstatus 1.13.105-kandidat: NativeIdleShadow er koblet på løbende
metadata og har ingen kontrolauthority; fejl inklusive cancellation er isoleret
fra real idle/end-vinduer. Uafhængig review fandt og fik rettet ophobet arrival lag
og cancellation-isolation. Kandidat1 source review GO; fysisk ingen ny prøve,
Voice PE er bevidst uden strøm. Firmware .103, LED og Stop ændres ikke.

Review/gates: uafhængig source-GO for kandidat1 og dormant kandidat2; ingen åbne
P0/P1. Første frozen releasekørsel bestod scope/lint/format, men mypy fandt otte
typingfejl og afbrød testarbejderne. Kun annotations/ækvivalente None-guards rettet;
fuld mypy54 PASS, berørt lint/format PASS. De afbrudte fulde unit/integration-stages
blev derefter afsluttet én gang: unit72.82s PASS, integration53.88s PASS. Ikke en
påstand om første releasekørsel bestået. Ingen SafeEval: prompt/schema/provider-
semantik uændret. Endelig live_idle SHA256
95ad8c2b306e134a67fe27d8b6e0ddf256bd343bd9c62b209760dd725176ea1e;
dormant policy SHA2564f541aec49161e3f467630c1df0dce1b7032f57beeb88ccd752b494e44b6ea14.

Kandidat2 er kodet som `live_input_policy.py` med tests, men er IKKE importeret
eller instantieret i runtime og er desuden disabled som standard. Den er en
mekanisk forberedelse, ikke en færdig tale/støjklassifikator eller en UI-toggle.
Aktivering kræver fortsat kandidat1-evidens, valideret verdict-kilde og separat
reviewet integration. Et forsinket relevant verdict starter konservativt sin
idleperiode ved modtagelse; denne ekstra forsinkelse skal måles/justeres før
aktivering. Ingen fysisk97/100-, timeoutfix- eller funktionsparitetspåstand.

Udførelsesjustering efter brugerens godkendelse: kandidat1 kodes og kandidat2s
deterministiske input/timeoutpolicy forberedes nu, men kandidat2 forbliver helt
deaktiveret. Ingen model/detektor vælges på gæt. Den forberedte policy accepterer
kun eksakt intervalbundne verdicts, har ukendt/fault som særskilte udfald og kan
ikke give close-tilladelse uden friskt output/workbevis. Aktivering kræver stadig
den aftalte feltgate og et målt usikkerhedsbudget. Tests med kunstige verdicts
beviser kun mekanik, ikke dansk inputklassifikation.

Plan review er godkendt; ingen 97/100-score tildeles før PRODUKTMÅLs obligatoriske
beviser. Implementering af støjklassifikation
er betinget af nedenstående evidensgate. Lead ejer én retning i ThinSession.

### 1. Fast kontrakt og mindste ændringsflade

- `podvoice/gatekeeper/live_idle.py`: adskil frisk, sammenhængende observation af
  forbrugt assistant-output fra inputrelevans. Bevar kildeidentitet, sekvens,
  counter-wrap, gaps, freshness og manglende-dræn-fejl. Ingen falsk audio-done.
- `podvoice/gatekeeper/thin.py`: ejer aktivitetsbeslutning, idle-anker, foreløbig
  inputbeskyttelse, semantisk anmodning og én endelig close-transaktion. Udvid de
  eksisterende `_observe_live_quiet`, `_live_quiet_ready`, `_await_live_end`,
  `_finish_live_conversation` og `_finalize_live_conversation`; ingen ny motor.
- `voicepe.py`: leverer observationer med aktuel session/generation og kildetid.
  Firmware ændres kun hvis en nødvendig eksisterende DSP-observation ikke er
  tilgængelig. Ingen samtidige gain-/wake-/VAD-tuninger.
- `openai_live.py`: bevar rå inputsekvens, providerhændelser og terminal receipts.
  En separat idle-policy revision må IKKE ændre samtykke, tool-authorisation eller
  freshness af semantiske receipts. Nye rå input gør gamle receipts ugyldige også
  når en hjælpedetektor senere vurderer input som baggrund.
- `talk.py` og browseradapter: samme lifecycle-kontrakt, men eget input/outputbevis.
  WebRTC-sporets slutning er ikke fysisk render-dræn. Manglende bevis giver bounded,
  eksplicit ubekræftet afslutning; ingen påstand om Voice PE/Talk-paritet uden test.

### 2. Inputbeslutning uden at flytte samtaleforståelsen

Observationer skal kunne skelne: relevant tale, dokumenteret baggrund, foreløbig
tale og ukendt. Hver vurdering bindes til audiointerval, session, generation,
sekvens, kildetid, friskhed og kilde/version; sene svar kan ikke ændre næste session.
VAD-onset beskytter omgående mod close, før en transcript kan nå frem. Relevant
tale nulstiller idle-perioden. Valideret baggrund ophæver den foreløbige blokering
uden at starte fire sekunder forfra. Ukendt er aldrig automatisk baggrund.
Gentagne rå VAD-events må ikke forlænge samme uafklarede episode uendeligt.
En baggrundsafgørelse frigiver kun sit dækkede audiointerval; nyere onset og
uklassificeret hale forbliver beskyttet, også når tale starter under konstant støj.
Foreløbig onset-beskyttelse gælder både semantic og inactivity-close.

Aktiv kandidat1, 27/9: bruger har godkendt udførelse. Lead fastholder invariants om
én ThinSession, frisk/native playback-identitet, uændret input/tool-autorisation og
ingen fabrikeret providerhændelse. Falsificerbar hypotese: samme friske observationer
kan bevise roligt forbrugt output, mens ordinary idle resettes af input_not_quiet.
Implementer en output-only shadowmåling i eksisterende idlemodul og content-free
løbende diagnose; den må aldrig kalde close eller ændre kontrolvinduet. Ikke-mål:
ingen klassifikation, VAD/gain/promptændring eller aktiveret ny timeout i kandidat1.
Regressioner: aktiv input + nuloutput; stale/gap/new owner; diagnostikexception;
ingen ændret normal close/Stop/OFF. Rollback: fjern observer-hook uden runtimepolicy-
ændring. Fysisk gate fortsat ubestået. Uafhængig reviewer har GO for shadowplanen,
men kandidat2 er lukket indtil lydgrundlag og klassifikation er valideret.

Før kontrol aktiveres: sammenlign eksisterende feltlyd og VAD/outputevents. Hvis
årsagen er ikke-tale, evaluer eksisterende tale/støjdetektor på den faktiske DSP-
lyd. Hvis årsagen er andre stemmer, kræves kontekstuel addressedness-vurdering,
ikke blot en ny VAD. Dette er en eksplicit semantisk kontraktbeslutning før kode:
hjælperen må kun levere input til inactivity, aldrig hensigt, værktøjsvalg eller
afslutningshensigt. Dansk, svartid, ressourceforbrug og fejl skal måles. Første
kørsel er shadow-only på autoriserede eksisterende optagelser; ingen ekstra rå
lydretention/cloudoverførsel introduceres stiltiende. Blokeret optagelsesadgang
omgås ikke; uden lydgrundlag frigives ingen akustisk rettelse.

### 3. To tidsforløb og ét commitpunkt

UI-værdien (nu fire sekunder) er samtalens inactivityperiode, fra seneste relevante
input er afsluttet OG observeret assistant-output/krævet arbejde er roligt. Aktiv
assistant-output, værktøjer, backend, åbning og relevante bekræftelser forhindrer
normal close. Efter nyt arbejde starter en hel ny periode. Efter valideret baggrund
kan den eksisterende periode fortsætte, kun med bevaret sammenhængende outputbevis.
En inputepisode uden afgørelse har separat bounded fejlhåndtering; dens grænse
vælges fra målt observation/klassifikationsforsinkelse før aktivering. Udløb er en
synlig fejl/recovery, ikke en vellykket firesekunders timeout eller påstået stilhed.

Semantisk end kan være stille eller med tale. Eksisterende outputbeskyttelse
bevares, indtil en erstatning er bevist; fjern ikke quiet-vinduet på et backend-
receipt alene. Idle-fallback må ikke starte endnu et helt idle-vindue i finalizer.
Ny input før commit annullerer pending close. Den sidste generation/input/work/
outputkontrol og ejerskabsovertagelse sker uden await. Efter afsendt provider.close
kan forbindelsen ikke genåbnes ved at annullere en task: gamle resultater afvises,
teardown/rearm fuldføres, og næste wake/tryk åbner ny session. Ingen automatisk
videresendelse af afklippet input til næste session uden særskilt godkendt kontrakt.

Normal finalisering beholder provider.close → provider.closed → stream.finish →
identitetsbundet fysisk playback_finished → teardown/rearm. Fysisk/panel-Stop
bruger straks cancel-vejen og venter aldrig på klassifikation eller normal drain.
Allerede udførte handlinger gentages eller tilbagerulles ikke af lifecycle.

### 4. Tre reviewbare kandidater

1. Evidens + inputobservation i shadow-mode. Genbrug løbende diagnose og log kun
   beslutningsårsag/tider/identitet: idle startet, beskyttet, nulstillet, genoptaget,
   semantic requested, close committed, drain confirmed/unconfirmed, rearmed.
   Leverance: årsagsklassifikation og målte fejl/latens for valgt signal; ingen
   ændret lukkebeslutning endnu.
2. Valideret inputpolicy + timeout. Integrer kun vindende signal i eksisterende
   Thin/idle-kæde. Fysisk Stop/OFF uændret. Replay skal vise både at feltets
   never-close forsvinder og at lav/ny rigtig tale ikke klippes.
3. Samlet semantic/drain/Talk-kontrakt. Promptændring kun hvis konkret regression
   kræver den; tidligere mislykkede reassessment-prompts må ikke genbruges som
   bevist mekanisme. Ingen ny obligatorisk farvelsætning eller fast nøgleordsliste.

### 5. Regressioner, release og stopregel

Udvid eksisterende `tests/unit/test_live_idle.py`,
`tests/unit/test_voicepe_activity.py`, `tests/integration/test_thin_live_idle.py`,
`test_thin_live_quiet_close.py`, `test_thin_live.py` og relevante Talk/Stop-tests.
Matrix: quiet room, VAD-noise bursts/continuous activity, TV/music, echo, low speech,
ack uden assistantsvar, lange tænke-/værktøjspauser, speech ved deadline, input før
og efter commit, stale/duplicate/out-of-order observations/classifier results,
generation switch, Stop i hver fase, manglende provider.closed/playback finish.
Bevis intet dobbelt værktøj, ingen stale lyd, én close/rearm og fungerende næste wake.

Uafhængig adversarial review før frozen diff; relevante fast/lifecycle-gates i
usynkroniseret clone og én releasegate efter freeze. SafeEval kun hvis prompt,
schema, tools eller providersemantik ændres. Samme releaseartifact skal gennem
frisk fysisk golden chain og 10/10 ubrudt lifecycle (naturlig og idle-afslutning),
ON/OFF-regression og målrettede støj/afbrydelsescases. Rapportér false-close,
never-close, fysisk tid til IDLE, clipping og uafklarede afslutninger separat.
Release/install er ikke fysisk accept. Rollback aktiveres ved ny clipping,
selvafbrydelse, ubegrundet close eller rearmfejl; OFF og eksisterende firmware
bevares som sammenligningsvej. Kan inputrelevans ikke valideres, stoppes kandidat2;
der sættes ikke blot en hård timeout hen over mulig rigtig tale.

## Research 27/9 — full-duplex completion and inactivity (no runtime change)

User requested completed research, not another prompt-only attempt. Current field
trace proves native input activity repeatedly resets the idle window after assistant
output/work are quiet; it does not identify whether the sound is noise or irrelevant
speech. Two primary reassessment experiments produced no end delegation. Neither
result establishes that all semantic approaches are impossible.

Primary-source findings:
- OpenAI explicitly assigns inactivity policy to the application, using audio,
  playback and application activity. Transcript gaps are not silence. Append ACKs
  confirm context delivery, not completion assessment. Live exposes no output-audio-
  done event: https://developers.openai.com/api/docs/guides/live-conversations
- LiveKit separates user-away detection from application shutdown:
  https://docs.livekit.io/agents/logic/sessions/
- Smart Turn predicts a completed USER TURN after VAD pause; it is not a session-end
  or device-directedness classifier:
  https://github.com/pipecat-ai/docs/blob/main/api-reference/server/utilities/turn-detection/smart-turn-overview.mdx
- Alexa research combines context and acoustic/recognition evidence to distinguish
  device-directed speech from other voices. It supplies a design principle, not a
  ready Danish Voice PE classifier:
  https://www.amazon.science/blog/how-alexa-knows-when-youre-talking-to-her
- Follow-up DDSD research supports context plus ASR uncertainty, but its published
  error tradeoff is not household acceptance or a deployable guarantee:
  https://arxiv.org/abs/2411.00023

Recommended boundary, not yet implemented: ThinSession owns one close operation.
Physical Stop has priority. Semantic completion may request quiet closure without
mandatory farewell; new relevant input revokes a pending close. Ordinary inactivity
uses the saved UI interval after actual output/work settle, with relevant input
resetting it. Acoustic activity is a provisional protection signal, not indefinite
proof of addressed interaction. Unknown observations must not be treated as silence.
The latter requires a validated classifier or explicit bounded uncertainty policy;
it must not be smuggled in as a VAD threshold change.

Remaining empirical research, in order:
1. Compare native VAD, DSP microphone audio, output reference and timeline for the
   known field interval. Determine non-speech false activity versus real unrelated
   speech versus echo. Current recording download restriction prevents that acoustic
   conclusion; existing logs alone cannot supply it.
2. Evaluate an existing speech/noise detector only if non-speech is the cause. If
   unrelated speech is the cause, evaluate contextual addressedness instead. Neither
   detector may own tool authorization or replace Live conversation ownership.
3. Specify provisional speech protection before transcript arrival, classifier
   uncertainty/failure, and late-input cancellation. A text-only observer cannot
   guarantee protection of new speech before its transcript arrives.
4. Evaluate semantic end and inactivity separately on silent acknowledgments,
   thinking pauses, low speech, TV/music, echo, long replies, pending tools and late
   corrections. Report false closures, never-closures, physical close delay and
   clipped speech separately; no arbitrary aggregate 97/100 acceptance claim.
5. Keep inactivity duration separate from bounded teardown cleanup. Do not add a
   second full four-second window after the first expires. Strict four-second
   closure and unlimited protection of unobservable silent thinking cannot both be
   guaranteed; this is a policy tradeoff, not another hidden timeout constant.

No new engine/framework migration is justified by these sources. No firmware,
prompt, gain, VAD, timeout, runtime or installed artifact changed for this research.

## Active decision 27/9 — close ownership audit after installed103

Installation verified: HA installed/latest1.13.104, backup enabled. .103 firmware
unchanged. App Running verified before coherent model trial; physical Voice PE was
offline, so no physical acceptance claim.

Coherent primary reassessment trial02 /private/tmp/pv-primary-reassessment-api-02:
reviewed parked primary/backend/Live-only end+wait policies align; source fingerprint
dd07418db6ed38910517f4bbfa956c0135b56dc0a12592bd482b6d36392b48bf.
FAIL again: recognized/timingtrue, one request+matchingACK, zero backend/endcalls,
no runtimefault, clean shutdown, usagecomplete, cost0.035USD conservative. Request
14.060s, ACK14.751s; no decision by45s. The extra one-shot primary steering has not
proved effective even with coherent policy; do not install or repeat payload.
Negative scenarios are not run because positive efficacy failed. Source/model
policy-only evidence cannot resolve noisy-room activity or physical closure.
Production restarted immediately after trial: HA Running verified; fresh panel
v1.13.104 statuslive and GPT-Live Alpha checkbox checked. Physical Voice PE remains
unverified/offline; no claim that noisy-room timeout or absent delegation is fixed.

Publication: PR76 merged581009f7268091b6ee5a951bc257aa391159a3ff.
PRCI36343697049 and mainCI36344001746 PASS. Published digest
sha256:d298cffb248129ab63a3bd6a88ee7466ec9cf18ced6f60fc11f8add143bf6017.
HA update103→104 requested with backup; installed state not yet verified.

Primary reassessment model trial01 /private/tmp/pv-primary-reassessment-api-01:
recognized=true, request1/ACK1, backend/endcalls0,45s observation, clean shutdown,
complete46s usage, conservative0.038333USD. Exact experiment FAIL; not proof the
API cannot support assessment. Independent audit verifies source identity and
matching append ACK, no protocol error. Confound: retained104 primary requires
pureack silent waiting; backend/end schema permits silent only explicit ending.
The appended completed-exchange instruction conflicts with those policies.
No retry of this payload. Separate coherent-policy experiment may combine the
already reviewed parked policy with one-shot steering; never ship based on ACK.
HA was restarted and Running verified immediately after this trial.

Research outcome (not shipped): the existing Live primary append_instructions path
is audio-aware and may be used for a one-shot reassessment experiment; managed
Responses send_text instead creates a user message and cannot be treated as a
room-audio classifier. Any experiment must state only output/work observations,
never pretend the input VAD proves irrelevant noise. A resulting end still needs
completed delegated receipt and normal finalization. No end decision is not
permission to close. Four seconds to assess plus backend work plus current four
seconds after settlement can exceed eight seconds; no four-second promise.
This is a bounded model-policy experiment, not an approved runtime change.

Validation checkpoint: all integration tests passed with local test ports enabled.
Frozen release run passed lint, formatting, mypy, scope and integration54.32s;
unit found only the missed __version__103 string. Corrected to104 and reran only
unit: PASS. Independent runtime-review SHA remains unchanged. Initial sandbox
integration failure was local bind PermissionError, not product behavior.
Draft PR76 created; publication/installation pending CI. Latest HA panel103 is
live, but Voice PE reports offline (20:34); physical proof remains unavailable.

Independent adversarial review: GO for this exact three-line runtime correction;
reviewed thin.py SHA2566840c9771d01c500123f8a40b4020d1306c493e983f6aeb68a22eda7a771abce.
Regression before patch: matching-finish case passes spoken and fails silent.
After patch: full test_thin_live passes; reviewer17 focused quiet/stale/missing/
Stop/new-wake cases pass with silent and spoken variants. No new acoustic claim.
Release candidate1.13.104 reuses the installed103 firmware unchanged.

Lead: root. Scope is the remaining semantic close and noise-blocked inactivity;
installed103 button,102 work LED and Speakers0.26.3 are retained.
Direct field evidence324067f8: no pending work/output, ordinary quiet reaches3.19s
then native input_not_quiet resets it. This proves the blocking boundary, not an
acoustic classifier error. The exact field WAV download is blocked by organizational
browser policy; no alternate download route or invented acoustic conclusion.
Actual Live trial03 received the question/Okay, remained silent and never delegated
end during45s. The parked prompt candidate is not a fix and is excluded here.

Concrete independent source finding to reproduce: _await_live_end(silent=True)
bypasses _finish_live_conversation and _finalize_live_conversation. A silent semantic
choice means no new spoken farewell, not permission to cancel earlier queued audio.
Hypothesis: a completed silent end can invoke cancellation/rearm before matching
physical tail, while the spoken branch waits correctly. Reproduce both branches
with the same pending live lease, stale finish, real finish, correction and Stop.
Affected invariants: one Thin close owner; current completed tool receipt; physical
playback truth; generation fences; OFF isolation. Whole chain: model end candidate →
completed backend batch → results/continuation settlement → current receipt → quiet
policy → provider close/closed → stream finish → exact playback finish → teardown →
rearm → next wake. Silent and spoken must use the same mechanical path.
Non-goals: guessing new VAD/gain/timeout; local phrase classification; installing the
failed semantic prompt; claiming acoustic/physical success from software.
Rollback: retain103 if scoped regression or independent review fails. Planned gates:
causal regression first, Live/native and Talk regression, independent adversarial
review, frozen release gate only if the candidate merits publication. Physical
acceptance remains open and must not be inherited.

Research input: Amazon Science device-directed speech combines acoustics and
semantic context (https://www.amazon.science/blog/how-alexa-knows-when-youre-talking-to-her).
Google Continued Conversation describes a bounded follow-up window and contextual
ending, not its internal classifier (https://support.google.com/googlehome/answer/7685981?hl=en).
OpenAI explicitly assigns inactivity/playback/pending-work closure to the app
(https://developers.openai.com/api/docs/guides/live-conversations). These support
separating sound detection from addressed interaction; none supplies a drop-in
reliable directed-speech signal for our current Live adapter. No runtime policy
change is justified by vendor behavior alone.


## Active release decision — 1.13.103 physical button only

Release scope: paired physical-button firmware and exact runtime firmware identity,
based on installed .102. One active short press locally stops capture and assistant
output; Thin remains the sole cleanup/rearm owner. Idle short press starts the saved
mode; repeats during cleanup do nothing; active Stop also silences a ringing timer.
No change to ThinSession, Live prompt, semantic ending, inactivity timing or model.

The combined semantic candidate is PARKED in /private/tmp/pv-close-103 and is NOT
part of this release. Actual Live trial03 recognized the question and Okay and
stayed silent, but did not close during the bounded observation. Therefore no
semantic/noise-timeout fix is claimed. Existing .102 LED and Connect fixes remain.
Historical combined-candidate notes below are retained as evidence, not release
approval. Its coupling marker was removed; the button-only diff requires its own
independent scope review and frozen release gate before publication/installation.
Independent button-only source/artifact review GO; exact coupling gate PASS.
Frozen release gate PASS75.3s (unit75.00s, integration52.64s), plus100 targeted
firmware/button/identity checks. No prompt/schema/Realtime change in this release.
Paired OTA/source identity recorded below remains byte-identical and applicable.
Physical button/next-wake acceptance remains pending; no 97/100 claim.

Current consolidated work since 16:49 (27/9):
- Noise blocking the four-second ordinary fallback: unresolved deterministic audio
  distinction; parked semantic candidate failed to close in actual Live trial03; not released.
- Contextual silent completion and safe quiet/drain: parked, NOT shipped in .103.
- Physical button: idle single press starts; active single press must stop locally
  immediately; repeats during cleanup ignored. Firmware correction source-reviewed and paired build passed; installation pending.
- Actual-work LED: .102 published, main8581e16e; HA installation verified; running again after preflight preparation.
- Connect Speakers 0.26.3 installed and Running, boot/watchdog ON; DNS-SD seen
  17:54:13. Actual Spotify disappearance/recovery remains physically unproved.
Robot-area naming and wake tuning remain parked per user scope.


Panel verification caught stale cyan-only explanatory copy after the first freeze.
Updated only its three descriptions to match the reviewed work-light behavior;
no UI lifecycle logic changed. Final frozen release gate PASS76.3s (unit75.90s, integration51.72s) includes this correction.

LED1.13.102 gates: full fast PASS74.7s; frozen release PASS72.3s, unit71.94s
and integration51.68s. First sandbox fast failed local server binds with explicit
PermissionError; permitted local-port rerun passed without a runtime patch.

LED release candidate1.13.102: independent original LED review GO; parent independent
review of native animation extension GO. Advertised firmware Thinking effect uses
its existing approximately200ms brightness cycle, not a claimed calm pulse. Targeted
LED/native tests74PASS and existing Live/Talk115PASS. No idle/prompt fix in this
release; background-noise fallback remains unresolved. Physical gate pending.

Actual receipt preflight 01: one connection attempted; it ended with connection
failure at 8019ms before LiveReady or input delivery. Clean local teardown; final
usage unknown. Verdict UNKNOWN, not a model-policy failure or pass. Report is
/private/tmp/pv-receipt-api-01/report.json; no room audio was used. HA was restarted
and its Running status verified immediately afterwards. Do not release the prompt
candidate on this result. Candidate full integration passes; full unit run found
one stale firmware-marker assertion, now being corrected to the actual paired bits.

Composite independent source/artifact review GO: all three source pins match
26148b9, runtime/YAML markers match .103, and all four changed compiled C++ files
match the reviewed bytes. Silent/spoken endings still have one Thin owner; local
button Stop does not replace cleanup/rearm. Model and physical gates remain open.

Actual receipt preflight 02 reached the provider, recognized the math question
and Okay (numerals 2 rather than word form caused the strict automatic recognizer
UNKNOWN), answered four, then delegated wait_for_user and spoke a checking preamble.
No end_conversation occurred during the 45s observation. Clean shutdown and final
usage complete; conservative cost0.052118USD. This is direct evidence against the
candidate receipt behavior, not acceptance. The shared wait_for_user declaration
still recommends waiting for a pure acknowledgment, contradicting the adapted Live
prompt. Amend only Alpha's declaration to preserve uncertainty/open tasks but route
contextual completion to silent end; make the silent-delegation exception explicit
in the permitted-preamble rule. OFF declaration stays unchanged. Re-review and new
bounded model trial required; no timeout/VAD change and no release on trial02.

Actual receipt preflight 03: math and Okay recognized correctly, answer four,
no extra spoken reply, but no semantic ending during the bounded observation.
The prompt candidate therefore remains NOT TEST READY; do not publish it as a fix.
Lead splits the independently reviewed local-button correction into .103 from the
installed .102 baseline. Semantic prompt/quiet-flow changes remain in /private/tmp/pv-close-103
and are not part of this button release. No rollback of installed LED or
Connect fixes. Normal HA operation restored and Running verified after trial03.

## Active decision 27/9 — field idle noise and truthful Alpha work LED

Receipt API01 diagnosis: UNKNOWN before LiveReady, no input delivered, no final
provider usage. Thin's existing8s CONNECT_TIMEOUT_S cancels startup at8.019s;
release evidence has client/manager but no reader, placing the unresolved await
at WebSocket manager entry before session.start. DNS/ordinary HTTP availability
does not prove this WebSocket path. Wall timestamps advance932.912s while monotonic
elapsed advances8.019s; sleep/clock discontinuity is possible, not established.
Existing runtime sanitized startup-stage diagnostics were lost because the wrapper
did not attach provider_observer and disables logs. Minimal evaluator-only fix
attaches that existing observer and prewarms the existing pure SDK import before
timed wake, matching production bootstrap. An isolated fresh import measured0.782s;
it is not proven to cause the trial timeout. Initial limits now truthfully45s/1
start; no fixture is queued after failed readiness. No runtime timeout or protocol
change, no retry loop. A deterministic cancelled WebSocket entry verifies retained
stage/type and cleanup without credentials/network. API01 remains UNKNOWN; a fresh
bounded trial requires parent review/final source identity and the exclusive window.

Handoff browser compatibility checkpoint: first real Chrome submission was rejected
before any provider run; production restart was requested. Reproduced in a separate
Chrome tab using only a synthetic key: the old no-referrer policy sends Origin:null
for a native form POST, which the exact-origin guard correctly rejects. Changed only
the response policy to same-origin; exact Origin/Host/path checks remain mandatory.
The same Chrome dummy flow then returned Accepted and the one-use helper exited.
Added fixed allowlisted rejection codes without body/key/header values. No real
credential, clipboard, HA tab or provider was accessed in this diagnosis. Native
form behavior matches https://fetch.spec.whatwg.org/#append-a-request-origin-header .
New source fingerprint27258633b28e0f27cf5b4a46a176e57495ec93b7db4148fe80d1e3495a96137c;
fixture manifest unchanged. Parent re-review required before real handoff.

Physical-button amendment: field session324067f8 receives single_press at76.844s
and requests Stop at76.847s, but teardown/rearm completes around80.299s. Current
firmware only emits the event; it has no local Stop action. Thin fences incoming
work immediately but physical cancellation needs the native round trip, and the
old listening/work LED persists until cleanup. Hypothesis: a firmware-local Stop
latch at the active short release closes that boundary without replacing Thin.
Reuse capture-held with invalid token0 to reject delayed start/hold/resume until
existing authoritative rearm. Revoke reply admission, stop announcement/resampler,
and retain the conversation latch; publish existing single_press for exactly one
Thin cleanup. A dim white stopping indicator is not idle/readiness proof. Idle
single press, amplifier boot, wake models/gain/VAD, spoken Stop and normal semantic
close stay unchanged. Regression: delayed capture keepalive/resume, queued/stale
announcement, duplicate press, teardown ACK and rearm/next generation; compile
paired .103 source identity. Independent review before release/install. Rollback
must restore the paired .100 firmware/.101 baseline, without inheriting proof.
Implementation checkpoint: local button Stop now holds capture with token0,
revokes reply admission and cancels announcement before publishing single_press.
The mic's button latch survives rearm until a new physical begin, rejecting a late
untagged keepalive while idle. Existing retired-token high-water and reply session
nonce reject known stale rotation/announcement commands after next wake; an unseen
old capture token is not generation-identifiable by the current token-only wire
protocol and still relies on its ordered native command boundary plus Thin's
cancellation fence. Active conversation Stop also takes precedence over a ringing timer and silences
it; an idle timer-only press retains its previous behavior. Sixteen targeted
regressions pass. Independent adversarial source review GO: eight additional
button/rotation checks and two actual C++ harnesses PASS. The sole rotation owner
is cancelled and joined before rearm; a failed join blocks opening_complete, and
native commands sent earlier precede rearm on the ordered connection. Thus the
unseen-token issue is not reachable in this supported owner chain; firmware alone
is not claimed generation-proof. Source-only commit
26148b9f377e50978373eef7c9995ddd67d9c959 is published for immutable pinning.
Paired compile now PASS; physical Stop remains pending. An already in-flight LED write
may briefly override the local stopping colour, without reopening mic/playback.

Paired firmware checkpoint: all three immutable component pins now use reviewed
26148b9f377e50978373eef7c9995ddd67d9c959; 19-file source manifest
06514887fdf6a4daeafba8946cce68df8d646a573cafb403d5ac9d7de202b558.
All 28 firmware contract/button/Stop tests pass. ESPHome2026.6.2 compiles the exact
pinned Alpha configuration successfully (16.82s, config_hash0x68db26ce). All four
changed generated C++ component files byte-match the reviewed source. Marker:
podvoice_build_113103_livebuttonstop1. OTA3065024bytes SHA256
 d98993c2b31565c4b7b5f230b3154a0cb0a6e61b9564fcce5c04c8226f4e572c.
Artifact: /private/tmp/pv-firmware-0927-build/.esphome/.esphome/build/podvoice-pe-live-alpha/.pioenvs/podvoice-pe/firmware.ota.bin.
Configuration: /private/tmp/pv-firmware-0927-build/podvoice-live-alpha.yaml;
its existing private provisioning file is unchanged. No installation or physical
Stop proof follows from this compile; parent retains release/install ownership.


User reports .101 remains open; confirms only background sound while silent.
Fresh automatic diagnostic session324067f8 (17:23:35) shows no semantic end,
backend/tool work earlier, then zero pending work and consumed zero output.
Quiet reaches3.19s at75.184s; input_not_quiet resets it at76.229s. Physical
button closes at76.847s; teardown/rearm follows. This establishes input activity
blocking ordinary inactivity, not proof of stuck backend or .101 semantic bound.
No guessed VAD threshold or transcript-only silence rule is authorized as evidence.
Need distinguish background acoustic activity from addressed speech without a new
local intent parser, cutting legitimate input or weakening playback drain truth.

Semantic amendment: fresh HA history r0:1790522614820483754 matches session324067f8.
After the football question and club followup, the answer ends at1790522669.5765;
the user says “Okay” at1790522673.4314, then reports only background sound.
The shipped Live primary explicitly forbids delegation for a pure receipt, while
its backend inherits an unconditional keep-open receipt rule. This prevents the
model from choosing silent completion in that observed context. User authorizes
contextual semantic closure first, with the saved four-second fallback retained.
Hypothesis: adapt only Live's receipt policy so the model can recognize a completed
exchange and delegate end_conversation(silent=true), with no spoken politeness.
No keyword parser, transcript timer, acoustic threshold or OFF prompt change.
Preserve new requests, assent to offers/approvals, unfinished work, ordinary
backchannels, plain Stop and music Stop as open conversation. Chain: whole live
utterance/context → delegated semantic decision → existing correlated terminal
receipt → output/work drain → close/rearm. Existing generation/new-input guards
must remain intact. Regression covers both generated prompts and guarded negative
contexts; existing Live eval/preflight must assess model behavior before release.
This does not solve background-noise fallback without a contextual receipt, and
does not establish physical success. Independent review required; rollback .101.

Silent-close mechanical amendment: current Alpha _await_live_end bypasses the
saved quiet/drain path for silent=true and requests immediate teardown after
backend settlement. Silence controls spoken output; it must not bypass playback
truth or the opportunity for a follow-up. Route both Alpha variants through the
same _finish_live_conversation owner; OFF silent handling and physical Stop remain
unchanged. Chain: validated tool -> terminal receipt -> four seconds consumed
output quiet with no pending work -> provider close -> exact physical drain ->
teardown/rearm. New accepted input/backend work, stale generation, Stop and queued
nonzero audio must invalidate or block the old ending. Known residual: speech
before its first provider transcript is not fully observed by receipt revisions.
Regressions cover silent and spoken endings against noisy VAD, queued audio,
correction and owner changes. Parent independently reviews this runtime delta.
Implementation result: both Alpha variants now enter the same existing finish
owner. Expanded native quiet/close and Thin tests pass, including silent four-second
noisy-VAD closure, stale owner cancellation, corrections and queued nonzero audio.
One old wire-contract test assumed immediate silent close; its isolated fixture now
uses the existing explicit quiet-policy fixture and passes. Lint/diff checks pass.
No model or physical success is inferred from these deterministic checks.

Policy scope amendment (separate hypothesis from the observed Okay receipt):
primary/backend may choose silent semantic completion only for a naturally
completed exchange with only irrelevant background audio. This is not an end
command after every answer. Preserve thinking pauses, open questions, approvals,
uncompleted tasks, plain Stop and music-control conversations. No local intent
parser, transcript-only timer or new acoustic threshold. Actual Live policy eval
is required; deterministic receipt tests cannot prove model classification.
Rollback remains .101 and physical noise/late-speech behavior remains unproved.

Receipt implementation checkpoint: Live primary and adapted backend now permit
that contextual silent end and retain the pending-dialogue/Stop exceptions. OFF
prompt15 is unchanged. Generated-prompt contracts, the complete Thin Live suite,
native idle/quiet-close suites, Ruff and diff checks PASS. These are deterministic
instruction/mechanism checks, not model-behavior or physical proof. No local API key
is available. Existing SafeEval runs Realtime, not GPT-Live; live_alpha_probe uses
substitute prompts. scripts/live_confirmation_eval.py uses shipped Live prompts
and Thin with synthetic audio, but currently has approval-only cases, so there is
no ready receipt preflight command. Receipt model evaluation and independent
review remain release blockers for this prompt candidate. The no-receipt noise
fallback remains unresolved.

Receipt preflight preparation: lead authorizes a bounded single-generation
developer evaluator reusing existing ObservedLive, SyntheticCapture and real
ThinSession. Synthetic Danish speech only: completed math → Okay; math → Okay
with followup; plain Stop preserves conversation. No HA tools, room microphone,
runtime patches or alternate conversation engine. Explicit fixture-pacing labels
are not provider speech-completion events. Require correlated input/tool/close,
final usage and cleanup; ambiguous timing/recognition remains UNKNOWN. New fixture
bytes and candidate source hashes must be retained. A new private one-use localhost
credential form may be prepared with exact origin/path checks and expiry, but must
not start before independent parent review. Existing documented route uses the HA
option directly into memory, never reports/chat/repo. Parent owns idle/version,
exclusive provider window and production restart in finally. No physical proof.

Preflight tooling checkpoint: scripts/live_receipt_eval.py reuses the existing
real Thin/ObservedLive/SyntheticCapture adapters and adds only three fixed cases.
scripts/live_receipt_handoff.py implements reviewed one-use loopback form, exact
Origin/Host/path, 90s total admission, bounded reads and source/manifest checks
before admission and child start. It stores no key on disk or in reports. Synthetic
Sara fixtures in /private/tmp/pv-receipt-fixtures-0927-v2 are nonempty and validated;
sandbox speech yielded empty PCM and was isolated by authorized system speech
access, with no runtime patch. Four localhost tests verify one-use, rejected
origin, incomplete body expiry and trickled-header expiry; no real key/provider.
Assessor requires matching current-generation settled semantic decision and rejects
missing/old output intervals. Verdict is model_policy_only; saved audio requires
independent listening. SyntheticCapture lacks native observations, so physical
quiet/close is explicitly UNTESTED and cleanup is local after policy observation.
Limits: one connection, 45s observation +15s cleanup +5s hard deadline, four backend
responses, no HA declarations, no blind retry. Final provider usage is required;
conservative cost accounting rejects missing usage or >$5. This is an operational
bound, not a provider-side monetary cutoff. Official pricing checked27/9:
https://developers.openai.com/api/docs/pricing and
https://developers.openai.com/api/docs/models/gpt-5.6-luna .
Fingerprint f9c7eb7c12af430e6e7fd7064dbac1b8ac5d62d4ae2e322c70efd1b45dcee672
includes runtime Python, version files and all three evaluator/helper scripts.
Fixture manifest cc52ecfc7ec91f85b992becb2920f50af54737d1e92ffc751986c0db1b13ddf2.
No actual provider trial or credential handoff has started at this checkpoint.

LED candidate: existing Alpha override makes known backend/tool work cyan. Show
existing amber THINKING appearance while response/batch/tool/continuation work is
actually outstanding, cyan when clear. Display-only: no mic gate/state transition,
no guessed primary silent-thinking state and no firmware change. Recompute through
existing event/heartbeat ownership, deduplicate paints, fence queued writes across
Stop/generation, retain OFF/error precedence. Regression: real SDK-shaped work,
overlap, failures, continuation, stale writes, Stop and OFF. Independent adversarial
review before release; physical LED/duplex behavior remains unproved until installed.
Rollback .101; idle policy changes require separate evidence within this same post.

LED amendment: user requests an existing device animation for known work. Use the
firmware-advertised Thinking effect (two opposing LEDs, approximately 200 ms
brightness cycle), with static amber fallback if unavailable. Every normal/off
write explicitly clears the effect. No new firmware or network animation loop;
Thin keeps its existing stale-write guards and Talk/fakes retain static fallback.
Regression: advertised capability, fallback, cyan/Stop effect reset and Thin
work dispatch. Parent independently reviews this additional implementation.


## Active decision 27/9 — bounded semantic close and truthful failure stages

Lead Codex. User authorizes timeout/farewell correction toward97/100 quality; no
numeric score is established. Direct source evidence in installed .100:
_finish_live_conversation waits for semantic quiet without a deadline; provider
request/terminal and physical drain exceptions are all labelled live-drain-failed.
The field report of never closing is not yet causally reproduced. Official Live
session guide requires playback/pending work completion before close, and backend
settlement is not primary speech completion. Immediate close after model intent is
therefore NOT justified; retain current observed-zero playback policy for now.

Chain: model terminal tool -> result/continuation settlement -> same-generation
output observation -> provider close/terminal -> exact physical drain -> teardown
and rearm -> next wake. Invariants: one Thin owner, model-only intent, no fabricated
speech completion, no stale close across input/generation, physical drain truth.
Hypothesis: missing/continuously reset observations can leave a valid semantic
intent waiting forever; bounding this phase turns that hang into explicit failed
closure. Bound is configured quiet period plus existing provider operation timeout,
not a replacement silence threshold. Normal inactivity retains the saved UI value.
No gain/VAD/prompt/transport change or unconditional inactivity maximum. Distinguish
provider-finalization failure from physical drain failure for both close paths.
Regression: missing observation, continuing output, new input and stale generation
at deadline, provider request/terminal failure, wrong physical finish, successful
quiet close and next wake, OFF/Talk regressions. Independent adversarial review,
fast gate then one frozen release gate. Rollback paired .100; physical gate pending
while Voice PE offline. Faster farvel without clipped audio remains unproved.

Bounded close candidate checkpoint27/9:12 composed quiet-close tests PASS, including
actual error teardown/rearm and next wake. Independent reviewer GO, no P0/P1;
existing Live+idle suites independently PASS. Injected provider/device timeouts
prove classification only. Immediate semantic close remains rejected because
backend completion is not speech completion. Version1.13.101 uses .100 firmware.
No field no-close reproduction or physical97/100 claim.

Frozen release gate PASS70.7s: unit70.47s, integration51.78s, lint/format/mypy
and single-domain scope. Full fast PASS75.8s. Earlier development gate was
discarded because tests changed while it ran; no runtime patch from that event.
Publication27/9: PR73 merged asd6d588611a677ce2d4b8293dd7de86413d943b64.
PR CI36317068190 PASS including ARM build; main CI/publication36317283600 PASS.
Version1.13.101 published and installed on HA Green27/9 with the UI backup
option enabled. HA update entity confirms installed/latest1.13.101; add-on info
confirms Running; restarted panel confirms v1.13.101 status live. Settings freshly
verified: Alpha ON, silence4s, Hey Chat + Hey Jarvis saved. PodConnect and home
control verified in panel. Voice PE remains offline; no firmware update performed
or required (.100 firmware retained). No physical gate or97/100 claim. Normal
inactivity root cause remains unknown; only unbounded semantic waiting/failure
classification are changed. Browser debugger attachment failed; installation was
completed through native Chrome UI. Installation evidence recorded locally.


## Active decision 27/9 — field reliability: button, close evidence, history and music

Lead Codex. User authorizes fixing all analysed issues, including unreliable single
press Stop, missing inactive Start, no double-press feature, automatic close and
PodConnect disappearance/reconnection. Direct evidence: shipped .99 Thin handles
single_press only while active; firmware multi-click consumes rapid presses as
separate double/triple events. Sept25 history stores Live fragments as complete
turns and reports generic music requests resolved as literal titles. Speakers log
Sept25 18:49–18:50 proves failed health checks and engine restart; Sept27 10:27 proves
alias selection succeeded but playlist context returned404. Neither proves one
universal network cause. Four-second UI value freshly verified; field no-close
cause remains unproven, so no guessed silence/acoustic threshold changes.

Chain: physical button/wake→firmware privacy latch→native admission→Thin provider
startup/tool work→announcement/mixer→close cancellation/drain→rearm→next input;
Spotify action→alias/context resolution→engine→AirPlay→reported action outcome.
Invariants: one Thin close owner, firmware capture owner, stale-generation fencing,
physical drain truth, no model intent parser, no repeated side effects on unknown
outcomes, OFF/Talk parity. Hypotheses: multi-click discrimination suppresses intended
Stop; fragment-as-turn persistence destroys useful retention; unresolved provider
context failures must not masquerade as successful music. Activity reset reasons
must establish whether the strict quiet contract blocks the reported close.

Non-goals: hidden timeout increase, guessed gain/VAD tuning, new conversation engine,
unmeasured wake recall claims or numeric quality score as substitute for evidence.
Implement bounded button admission/cancellation and firmware first-short-press with
rapid-repeat suppression; retain maintenance long-press safely. Add truthful fragment
history and durable content-free lifecycle diagnostics. Speakers changes remain an
independently identified candidate; preserve dirty source work. Regression scope:
startup/listening/playback/tools/closing, duplicate/delayed press, next generation,
privacy latch, restart retention, partial/interleaved transcripts, Spotify failure
and recovery without duplicate actions. Independent adversarial review then relevant
fast/software/firmware gates; one frozen release gate only after resolved findings.
Rollback: current paired .99 plus existing speaker artifact; no inherited physical
acceptance. User quality target97/100 is not a measured acceptance result.

Implementation checkpoint 27/9: button first-short-release now bypasses old multi-click
consumption; a rapid repeat is ignored, and a distinct firmware capability protects
the new post-press privacy boundary during mixed-version upgrade. Common startup
ownership now cancels/joins OFF as well as Live before rearm; independent review
found and fixed late-connect resurrection, sticky close flag and queued press during
rearm. Six real lifecycle regressions passed independently. History distinguishes
Live segments and preserves original fragments for existing context seeding.
Diagnostics retain content-free correlated metadata14days/32MiB separately from
24h audio, including idle blockers; restart and late-rearm overwrite regressions pass.
PodConnect candidate now propagates engine/no-session/search/library/device failures
and panel Stop errors without retries. Its source review has no unresolved concrete
P0/P1; no physical recovery claim. Final Alpha firmware build succeeded15.65s with distinct113100_livebutton1
identity; base is113100_button1. Component ref4fe6f4612402b8f7ef4dd579132eca9abdcc1617.
No test-key image is eligible for installation.

Workflow finding: existing serial full-suite fast fallback again exceeded120s; first
attempt also lacked local-server sandbox permission. These are not product causes.
Permanent tooling regression now keeps complete unit and integration suites in two
isolated bounded workers, matching the existing release split. No time budget raised.
Full fast gate passed27/9: lint/format/mypy, unit70.77s and integration49.93s.
Independent source review reports no unresolved concrete P0/P1. Candidate remains
NOT release-ready: final release gate and physical gates
are not yet established. Current installed version remains1.13.99, freshly read in HA.
Timeout field cause and Spotify discovery stall are not yet proven or declared fixed.
Release attempt27/9 stopped at candidate-scope (audio_input plus rearm); remaining
workers were cancelled, so this is NOT a green release gate. Independent review isolated the extra domain to the separate prompt16 music change.
That change and its two version assertions are saved as a separate pending patch;
this mechanical candidate retains prompt15. No classifier exception was added.
No installation performed.

Final mechanical candidate: rooted at public main baf74ddb4914f08c5defc68da2b52a8fc2061b26.
Independent final review GO; production fingerprint
92cfff8af7db5a59d2029977f06211c2ce3dac5ff52cd642b2ccaeebbe27d197.
Prompt15 unchanged. Scope PASS rearm with no exception. Frozen release gate PASS74.2s:
unit73.93s, integration50.53s, whole-tree lint/format, mypy and diff checks.
Firmware test compile PASS. Exact-commit CI/image and paired installation remain next;
physical golden and10/10 remain NOT RUN. No97/100 acceptance claim.

Installation evidence27/9 (physical acceptance remains separate): PR71 merged as
 dd619133f7ca835efc01eafdcced34dc6858ff3e. Main CI36310575439 PASS and exact image
sha256:f5d2574c0a8622a395db9473f8ac21a2b502bed3f296d26227409a20d12b462c published.
HA update UI confirms installed1.13.100 with backup. Provisioned Alpha OTA succeeded;
native readback confirms113100_livebutton1 and physical_button_capture_v1, compiled
2026-09-27 11:45:16 +0200. OTA SHA256
d92b2402e89b203ade6080592b202ba856bf6488d2ee7e4a4a4ffcdfb8c5bd9e.
Speakers PR2 merged c7cbee910ba2c92adbe3e022230828beb2d9fd07; native ARM publication
36310260809 PASS; HA confirms0.26.2 running. Control v0.10.1 installed via HACS;
required Core restart completed (HA UI: Home Assistant er startet).
Post-restart UI confirms1.13.100, Voice PE connected, HA/MCP and PodConnect
verified. Settings confirm Alpha ON and saved/device-ACKed Hey Chat plus Hey Jarvis.
No new room conversation or physical button result yet; golden/10of10 NOT RUN.
Prompt16 is preserved separately on codex/music-intent-pending-0927 (26ea67d),
not deployed and not live-validated. Four-second setting and wake acoustics unchanged.

## Active decision 25/9 — measured Hey Chat acoustic improvement

Lead Codex. User requests agent-managed improvement/training of Hey Chat and
explicitly authorizes installation after completion. Strongest current failure
evidence is repeated user-reported kitchen misses; .99 proves dual-model selection
and restart persistence, not acoustic recall. Preserve installed .99 and Jarvis.
Hypothesis: a speaker-disjoint Hey Chat candidate trained with reverberation and
background interference improves held-out recall at no worse false activations and
within the current device inference budget. Threshold-only wins must be compared
at matched false-activation rate; neither synthetic recall nor 99.9% aspiration is
home proof. Chain: room/mic/XMOS wake channel → frontend/model/window/VAD → latch →
LED/capture → ThinSession/Live → physical playback → close/rearm → either next wake.
Invariants: firmware sole wake/latch owner, one ThinSession and VoicePELink, privacy
boundary, existing gain/VAD, deterministic Stop, exact dual selection and fresh rearm.
Non-goals: new audio transport, provider gain/prompt/timeout changes, replacing
Hey Chat, or continuous private audio export. Never upload household audio to TTS.

Experiment: pin trainer/evaluator/model hashes; create isolated local training env;
preassign speaker pools and source recordings before any mixing/augmentation; use
separate validation and untouched test sets, positive and confusing-negative speech,
noise/music and room impulse responses. Preserve source/seed/split metadata. Match
feature stride, quantization, smoothing and VAD semantics to shipped ESPHome; report
any replay limitation explicitly. Compare baseline and candidate on identical clips,
recall, false activations/hour and detection offset. Current free disk ~27 GiB:
bounded downloads only; stop before filling the system volume. Independent adversarial
review covers recipe and final diff; firmware compile/resource and current field
regressions precede physical comparison. Freeze once for release gate. Rollback is
paired .99 artifact plus exact dual selection; no inherited physical acceptance.
A new model is not install-ready until controlled comparison supports improvement,
no unresolved severe review finding remains and relevant device gates pass.

Progress: pinned Apple Silicon trainer 60abc9a2f92ea1f048e50684d7909b11c154435e;
local official evaluator, Piper generator and training engine fetched; isolated
Python 3.11.16 installed, dependencies being prepared. Stock trainer random-WAV split
and ordered speaker-pair truncation rejected: they can leak speakers and bias data.
No trained candidate, production model change or 99.9% measurement yet.

## Active decision 25/9 — simultaneous Hey Chat and Hey Jarvis

Lead Codex. User reports unreliable Hey Chat in kitchen and explicitly requests
Jarvis always available alongside it. Source confirms both models already shipped,
but selection service disables all except one and ACK requires count==1.
Hypothesis: a canonical combined selection and exact enabled-mask ACK provides
persistent dual wake without a second conversation engine. This is availability,
not proof of acoustic improvement. Chain: saved choice → reconnect apply → firmware
model flags → either detection → one physical capture/latch → Thin/Live → playback
→ teardown/rearm → either next wake. Invariants: firmware sole wake owner, one
Thin/VoicePELink, token/generation-fenced confirmation, Stop model independently
owned; muted/active conversations cannot be reopened by the other phrase.
Non-goals: model retraining, VAD/gain/cutoff changes, any new transport. Keep faster
host acknowledgement isolated in existing candidate. Regressions: exact enabled
flags, failed enable/disable, unknown selection, old/wrong/stale ACK, persistence,
dual callback admission, existing OFF/Talk and shipped firmware compilation. Review
independent before release, one frozen releasegate. Rollback: previous paired
artifact and single choice; no inherited physical reliability. Installation and
power-cycle/physical dual wake require actual device access and remain unproven.


Implementation/review 25/9: explicit combined choice, exact four-model flag ACK,
persistent setting/reconnect and honest either-phrase example implemented. Compiled
shipped selector covers all initial masks and failed toggles; shipped admission
lambda covers consecutive detections, Stop exclusion and next conversation.
Independent dual_wake_review: GO after fixes; 34 independently run regressions pass.
Targeted final regressions: 46 pass. Browser save/restart/readback/error regressions
pass at 320/390/1440 px. Real ESPHome 2026.6.2 compile passes after correcting the
StringRef ternary caught by the compiler. No sensitivity or acoustic change.
Final frozen release gate PASS in 73.9 s (unit 73.50 s, integration 51.07 s,
ruff/format, mypy, candidate scope). Earlier aggregate fast hit its 120 s bound
without reported assertion failure; final parallel release completes both suites.
Artifact: add-on 1.13.99, firmware podvoice_build_11399_dualwake1; OTA SHA-256
605210467285c39e08ee115aa1563dfd607107560fb82824b98bdc5dcbb6e810.
Before installation: cloud UI confirms .98 Alpha ON and Hey Chat; verified physical
device still advertises .97 diagnostic firmware. Its mDNS address now resolves to
a different DHCP address, explaining the failed fixed-IP check. No install or
physical dual-wake acceptance yet; publication and paired install remain next.


Installation result 25/9: PR70 merged as baf74ddb4914f08c5defc68da2b52a8fc2061b26;
main CI36132170456 PASS including publication. Image digest
sha256:2bae28047f9cfb532999b27a1020f3feff0e76aa6d68363c2e7b8d91068cfa64.
Paired OTA succeeded; native readback verifies11399_dualwake1 with compilation time
2026-09-25 13:48:50 +0200. HA installed1.13.99 with backup. The stale HA update
entity was refreshed explicitly before installation. App is running; Alpha remains
ON; stored choice is hey_chat_hey_jarvis. Device exact-mask ACK confirms both.
After one native hardware restart and automatic reconnect, a fresh ACK again
confirms the pair; UI independently shows saved and device-confirmed pair. Existing
moderate thresholds remain Hey Chat230/255 and Jarvis235/255. Observed inference
transition reaches DETECTING_WAKE_WORD; no allocation/inference errors in the two
bounded post-selection/post-restart observations. Benign already-running warning
appeared during add-on reconnect before normal detector recovery. This is installation,
selection and restart evidence, NOT acoustic recall, physical power unplug, golden
chain, interruption or10/10 evidence. User asked to try each phrase from the kitchen.
Artifacts: /private/tmp/pv-099-artifacts/. Room performance remains unaccepted;
Hey Chat acoustic retraining/improvement remains open.


## Candidate — physical Alpha wake acknowledgement before native context ACK

Lead Codex, 2026-09-23. Observed event trace places the light command about 205 ms
after wake, after native context acknowledgement. This is command timing, not an
optical measurement. Source comparison found no changed Hey Chat model, wake gain,
channel or threshold since .76. Acoustic recognition remains unproven.

The candidate keeps ThinSession as sole light/session owner and paints its existing
cyan after native Alpha capability checks, before waiting for context ACK, only for
physical wakes. No microphone gate, provider readiness, firmware, sensitivity,
model, prompt or timeout changes. Firmware-local painting was rejected because it
would require a new takeover/cleanup boundary on host failure.

Regression covers delayed/failed context ACK, Stop while pending, final dark/rearm
and unchanged programmatic startup; Talk regression also passes. Independent adversarial source review GO; four frozen wake regression cases and
seven Talk cases pass. Relevant fast gate PASS47.2s after granting its existing
localhost HTTP test the required binding permission. No runtime patch followed
the sandbox failure. No release, installation or
physical improvement is claimed. HA is currently unreachable; hearing calibration
requires the existing retained audio and device settings once access returns.
Rollback boundary is this isolated host change; do not add speculative gain/model
changes to compensate for unavailable acoustic evidence.


### .98 adversarial finding — pending output must block quiet closure

Independent composed review reproduced a new race introduced by waiting: a full
silent output queue and already-started lease can leave a dequeued nonzero chunk
waiting outside both provider and stream queues. Both idle and semantic work-clear
incorrectly returned true. Candidate remains blocked until pending nonzero output
is owner-scoped, counted as work, cleared safely across cancellation/generations,
and a permanent regression proves neither closure path can pass while it waits.

Resolution implemented and independently reviewed: pending nonzero audio now has
an exact epoch/provider/generation/stream token; both quiet-close gates reject it.
Receipt resets quiet timing, and finally retires only its own token. Constant-zero
transport does not become user/assistant activity. Regression covers both gates
and delayed old-wait cleanup against a replacement marker. Independent final
source review: GO, no unresolved blocking findings. Focused owner suite41 and
independent suite50 pass; actual HTTP route passed outside loopback sandbox.
Fast gate passed121.0s with the supported full-suite timeout budget after the
initial120s budget expired at98% without failed assertions; no runtime change
was made from that process timeout. Frozen release and exact-commit CI pending.

## Active .98 decision — bounded Live output startup backpressure

Lead: Codex. A physical .97 attempt failed without speech, with red LED and
`live-output-overflow`; exact paired artifact verified. Private diagnostic trace
has dropped commands, so the label alone cannot prove capacity rather than a
sealed stream. Independent composed reproduction: eleven 100ms PCM envelopes
queued before scheduling playback exceed the unchanged 1000ms stream ceiling;
this also reproduces without automatic diagnostics. Field causation remains open.

Chain: physical wake/admission → provider input/start → queued Live output →
Thin producer → existing HTTP consumer → native playback → close/rearm/next wake.
Hypothesis: bounded producer backpressure allows the already-scheduled playback
consumer to progress without raising the audio storage ceiling or dropping PCM.
Keep one Thin owner, exact stream/session/generation identities, independent Stop,
completed tool authorization, final audio drain, Talk WebRTC and Alpha OFF.
Non-goals: firmware, gain/VAD, model/prompt/tools, saved idle timeout, buffer tuning.
Use the existing 2.5s playback-start ceiling for a stalled capacity wait; no retry.
Invalidate waiting PCM before append on cancellation, sealing, generation change
or provider failure; intentional provider closing must still drain terminal audio.
Log static fault and bounded counters outside the lossy recorder path.
Regression requirements: burst before native ACK/HTTP consumption, unchanged cap
and byte order, dead sink, Stop/seal/generation/provider failure during wait,
terminal audio and next identity, HTTP adapter and opposite I/O contract.
Independent adversarial review, fast and frozen release gates required. No claim
of physical correction before the installed candidate is used successfully.
Rollback boundary: preceding paired .96/.94 retained; .97 is not a golden baseline.


## v1.13.97 candidate — bounded automatic Alpha diagnostics

Reviewed source candidate; not physically accepted. Ordinary physical Alpha sessions
save bounded rolling diagnostics, with an explicitly requested pre-wake reference
kept outside provider input. Alpha OFF, model behavior, gain/VAD and saved timeout
are preserved. Independent source review covered the entire ownership chain and
resolved stale scheduling, diagnostic congestion and multipart evidence boundaries.
Firmware source is pinned to `9f77e300680339c96028eb677825a61dd020da11` and the paired
marker is `podvoice_build_11397_diagnostics1`. Physical wake, audible latency and
lifecycle acceptance remain pending; private household evidence is retained locally.

<!-- historical .97 reviewed coupling (not applicable to .98)
{
  "version": 1,
  "base_tip": "c8c765849990276f43dd7c44458f3a6a7e4ea72e",
  "merge_base": "c8c765849990276f43dd7c44458f3a6a7e4ea72e",
  "domains": [
    "ha_tools",
    "physical_output",
    "realtime_semantics",
    "rearm"
  ],
  "fingerprint": "fbbc6eb794c8f0632f6a123f053b3bfc74da375e8cc08a7bcd40da41a0b96116",
  "reviewer": "Independent Astra reviewer /root/wake_regression_audit; source and mechanical identity GO, 2026-09-23",
  "rationale": "One bounded observational chain: admitted physical Alpha wake, requested pre-wake reference, native ownership, provider event metadata, rolling local persistence, teardown and next-wake evidence. No gain/VAD/model/prompt/tool/idle semantics changes. Exact source review resolved diagnostic congestion, stale scheduled-task ownership and multipart evidence misuse; mandatory regressions and fingerprint bind this coupled candidate. Physical acceptance remains separate."
}
-->


## Aktiv beslutning 22/9 — Alpha værktøjstiming

Lead Codex. .90-log viser 1811/1607 ms fra continuation-send-done til næste
admission, men mangler backendmodtagelse og kø/lock-grænser. Hypotese: venten
ligger før dispatch; observationerne skal kunne falsificere lokal køventen.
Kæde: input → provider → backend created/completed → batch enqueue/receive →
lock request/acquire → autoriseret dispatch → resultat/continuation → lyd →
close/rearm. Invarianter: Thin ejer samtalen; completed-response-validering,
autorisation, generationsisolation, OFF/Talk og fysisk playback uændret.
Kun faste metadata, hash-identiteter og host monotonic timestamps; ingen
resultater/transcripts/nøgler. Ingen per-audio logging eller nye waits.
Regression: ordnede milepæle, lock contention, stale generation og observerfejl.
Uafhængig review og relevante gates; rollback er kun diagnostikdiffet.
Ingen fysisk latency- eller installationspåstand for denne kandidat.

Implementeret som 1.13.93: host_monotonic_ns på eksisterende diagnostik,
backend received/enqueued/received og lock_wait start/done. Trace-projektion
bevarer felterne. Tre nye regressioner: timing/privatliv, faktisk holdt lock
og trace-projektion. Fast partial gate PASS48,5s inkl. Ruff/format/mypy og
relevante integrations-/providertests. Astra timing_review GO; ingen åbne
findings. Kun hostmodtagelse måles, ikke ren providerberegning. Diff fryses
før fuld releasegate; ingen SafeEval da semantik/prompt/schema er uændret.
Release-precheck fandt .92s historiske coupling-marker. Den er arkiveret som
historisk record; denne kandidat har kun ét klassificeret domæne og kræver
ingen coupling-undtagelse. Runtime og scopegate er uændrede.
Releasegate PASS 22/9 (58,1 s): Ruff/format/mypy, scope, unit og integration.
Første forsøg krævede localhost-tilladelse; næste fandt en glemt versionsværdi
i pyproject.toml, nu rettet til 1.13.93 og fuld gate genkørt grøn.
Offentliggørelse af opdateret STATUS afventer konkret brugergodkendelse efter
automatisk upload-afvisning. Ingen .93-PR, installation eller fysisk prøve endnu.



## Feltobservation 22/9 — køkken, før 1.13.93

Brugeren rapporterer langsom svarstart, hakkende assistant-lyd og svag wake med
baggrundsmusik på installeret 1.13.92. Historikken 14:31–14:33 viser forstået
bestilling af grundig støvsugning/vask i køkkenalrum og entré, men gentagne
utilgængelighedssvar. HA GetLiveContext 14:36:02 viser Roborock unavailable;
at robotten opleves online i egen app beviser ikke HA-forbindelsen.
Samtalen lover først genkontrol efter 30 sekunder og logning af lydfejl, men
trækker begge kapabilitetspåstande tilbage. Registreres som UX-fejl, ikke udført
opgave. Historikkens 311 ture er tekstfragmenter, ikke 311 brugerhenvendelser.
Runtime-tail viser stop 14:34:21.575, provider terminal 14:34:22.660 og rearm
14:34:24.984. Ingen timeout/farvel-accept udledes af dette Stop-forløb.
Logvisningens tilgængelige tail starter 14:33:22; fuld logdownload er blokeret
af browserens organisationspolitik. Ingen påstand om komplet loganalyse,
præcis fysisk svartid eller årsag til lydhak/wake. Firmware/gain/buffere uændret.
1.13.93 måleændringen løser ikke disse fysiske feltfejl i sig selv.
Opfølgning samme dag: HA-enhedssiden viser I dock, oplader og 78 procent.
Aktivitetsloggen daterer genetableringen til 14:36:06, efter samtalens Stop.
Ingen integrationsgenstart eller rengøringskommando udført af agenten.

## Aktiv R2-afslutningsbeslutning — brugerafgrænset næste Alpha-release

21/9, Lead Codex. Brugeren kræver timeout/farvel færdiggjort, udgivet og installeret;
fysisk acceptprøve udføres efter næste release. Køkkennavne, robotområder og usikker
wake er eksplicit fjernet fra denne opgave. Derefter er hastighed hovedprioritet,
forudsat afslutning/Stop/afbrydelser/ekko består den efterfølgende prøve.

Stærkeste direkte kodebevis: Alpha sætter altid _idle_deadline=None; den almindelige
heartbeat blokerer samtidig på continuous-WAV playing, også under nul-PCM.
Semantisk end venter terminal backendreceipt og seks sekunders markeret grace,
provider session.closed, samme stream-seal og fysisk playbacklease-finish.
Hypotese: den manglende Alpha-specifikke, friske input-/output-ro-kontrol forklarer
manglende inaktivitetslukning. Eksisterende Stop og semantiske ejere bevares.

Før styring: koordineret passiv native optagelse af eksisterende activity-sensor under
kort panelåbnet samtale. Ingen gain-/VAD-/volumenændring eller testtone. Tidligere
30 s uden aktiv context gav kun retained unknown snapshot og er ikke cadencebevis.
Native input genbruger firmware-VAD; eksakt digitalt nul er en konservativ kandidat
for outputro, ikke en valgt amplitudetærskel. Manglende/forældet observation er ukendt.
Provider-PCM og mixerframes må ikke sammenlignes ved sample-rate alene uden samme
startpunkt/coverage; der må ikke fabrikeres en provider audio-done-hændelse.

Afgrænset kæde: provider-/native readiness → frisk faktisk input og output → gemt
UI-stilhedsperiode (4 s) uden kendt ventende arbejde → atomisk identity/work-recheck
→ providerlukning → streamfinish → samme playbacklease-dræn → eksisterende teardown/
rearm. Ny inputrevision før commit revokerer semantisk end; støjenergi ejer ikke
hensigt. Naturligt farvel må ikke byttes til en rå transportlukning eller klippes.
Regressionskrav: tavse streams, pending tools/startup, stale/duplicate telemetry,
input før commit, queued/delayed output, samme-generation restart, Stop/followup,
OFF og Talk. Uafhængigt adversarial review og frossen releasegate før installation.
Rollback: dette afgrænsede kontrol-diff; 1.13.91-R1 holdes særskilt. Ingen fysisk
accept hævdes før brugerens efter-release prøve. Runtimekontrol implementeret nedenfor.


R1 nu udgivet og installeret: PR #62 merged, main
2413e4b0ec89afa2cf3499885d9e36d6959fe84b; main ARM64/publicerings-CI grøn.
HA startup 21/9 18:05:55 bekræfter version 1.13.91 og artifact
rootfs-v1:16a58e7dbe99e186f967923092a83edfc81f136bde716e49fa767e6e9db40b89.
Native firmwarekontrakt OK, Hey Chat readback og gemt Alpha ON efter genstart.
Dette er installationsbevis; ingen ny fysisk golden chain eller 10/10.
Den tidligere publiceringsblok blev ophævet af eksplicit brugergodkendelse.
Panel-Lyt kl.17:59 gav live-context-unconfirmed før provider: programmatisk wake
havde ikke firmware-ejet fysisk nonce. Målingen kan ikke kalibrere aktivitet, og
admissionen ændres ikke for at omgå den. Fysisk prøve ligger efter næste release.

R2 konkret kontrolpolitik under implementation: samme gemte UI-periode for input+
output-ro ved idle; output-ro alene ved modelvalgt farvel, så rå VAD-støj ikke kan
veto'e semantisk hensigt. Accepteret nyt input revokerer stadig farvel. Digitalt nul
og kildens egne consumed-frames anvendes konservativt; intet sample-rate-baseret
fælles startpunkt opfindes. 200 ms freshness er en eksplicit forkastningsgrænse for
firmwarens 100 ms rapporteringskontrakt, ikke en målt akustisk tærskel. Stale/ukendt
nulstiller perioden. Forsinkede reelle svar og støj skal prøves på releasekandidaten.


Implementeret i 1.13.92-kandidaten: NativeIdleWindow holder kilde-/sample-/forbrugs-
kontinuitet uden provider-frame-mapping. Thin holder alle readiness-/arbejds-/input-
checks og én fælles close-transaktion. En fuld nul-PCM-buffer blokerer ikke alene;
ikke-nul PCM, ægte arbejde, ny inputidentitet og stale kildedata nulstiller perioden.
Aldrig-startet output kræver særskilt eksplicit producer/resampler/source-quiescence.
Udløbet approval/review tæller ikke længere som ventende arbejde; den eksisterende
handlingsautorisation ændres ikke. Semantisk farvel ignorerer rå input-VAD, men ikke
nyt accepteret input. Talk beholder sin markerede sekssekunderspolicy og ukendt
browserdræn; native aktivitetsbevis overføres ikke til WebRTC. Silent=true er uændret.

Målrettet kontrol: 43 helper-/aktivitetsprøver, 110 eksisterende Live-lifecycleprøver
og 2 sammensatte native quiet→provider-close→samme playback-finish→rearm-prøver PASS.
En gammel test ventede fast 90 ms på den udgåede grace; den venter nu på den faktiske
receipt-invalidering på heartbeat. Ingen runtimeændring blev lavet for testens timing.
Ruff og mypy på hjælper/runtime PASS. Uafhængig Astra-slutreview GO uden åbne
findings på samlet kilde, identiteter, Stop, pending-work, OFF/Talk og de rigtige
helper-/close-prøver. Fast-gate PASS 104,0 s med hele testsuiten, Ruff, format og
mypy 51 kildefiler. Første sandboxkørsel kunne ikke binde lokale testservere;
samme gate med localhost-rettighed bestod uden produktpatch. Kodediffet er frosset;
den ene releasegate og publicerings-CI skal bestå før installation. Der køres ingen
ny fysisk prøve før release. Talk-dræn og observerede native ACK-begrænsninger
påstås ikke rettet af denne kandidat. Fysisk godkendelse mangler som aftalt.


Release-precheck stoppede før softwaretrinnene, fordi den eksisterende scopegate
ikke kendte den nødvendige audio_input + physical_output-kobling. Den isolerede
toolingrettelse kræver nu de eksakte Thin/live_idle-overflader, alle tre egentlige
quiet-/close-regressioner og ekstra sink-prøver ved recorderændring. Urelaterede
adaptere/firmware, manglende prøver og stale review afvises stadig. Reviewer lavede
gateændringen, Lead gennemgik den uafhængigt; 24 scope-regressioner og Ruff PASS.
Ingen runtimebytes blev ændret for precheckfejlen. Den fulde releasegate genoptages
på dette frosne diff med nedenstående eksakte reviewbinding.

<!-- historical-reviewed-coupling
{
  "version": 1,
  "base_tip": "2413e4b0ec89afa2cf3499885d9e36d6959fe84b",
  "merge_base": "2413e4b0ec89afa2cf3499885d9e36d6959fe84b",
  "domains": [
    "audio_input",
    "physical_output"
  ],
  "fingerprint": "2e8c5eb99fbc3ab9e30fee0df260ab8a4363bc11ac1e5a5f9b469ed280988dda",
  "reviewer": "Independent Astra alpha_tool_chain_audit; Lead reviewed isolated scope-tooling change",
  "rationale": "Native Alpha inactivity necessarily couples current input observations with consumed announcement output under ThinSession. Exact source review found no unresolved finding; actual helper and full close-chain regressions pass. Optional recorder changes retain their sink/observer regressions. No firmware, adapter, prompt, VAD or gain change. Scope/release admission only; room acceptance follows installation by user authorization."
}
-->


## Aktuel installation — GPT-Live Alpha 1.13.92, 21/9 kl. 18:53

Lead Codex. Brugerens aktuelle afgrænsning: rum-/robotnavne og usikker akustisk wake
udgår. Timeout/farvel-rettelsen er nu udgivet og installeret; fysisk afprøvning ligger
EFTER denne release. Når afslutning, Stop, afbrydelser og ekko består, er næste fokus
kun hastighed i denne opgave. Ingen fysisk acceptance eller 10/10 hævdes her.

PR #63: https://github.com/BixelVentures/podvoice/pull/63 — merged.
Installeret main: e52067d878da9a4010eecca83de1e6ecdaf8dbc4.
Præcis reviewet/testet tree: 0ee97f39c33c95e7b0d41b1b5f05f05175f03bc2.
HA startup 18:52:52 bekræfter version 1.13.92 og
rootfs-v1:f91c8e79caaf70eb84096c9729029d9c366787075f9124ef949563adf04fefba.
Native firmwarekontrakt OK; gemt Alpha ON og UI idle_timeout_s=4 er verificeret
efter add-on-genstart. Voice PE er forbundet; næste fysiske wake er ikke prøvet.

Løsning: Thin bruger friske input-/forbrugte announcement-outputobservationer til
den gemte stilhedsperiode. Tavse transportpakker alene tæller ikke som tale.
Semantisk farvel bruger outputro, så rå VAD-støj ikke vetoer modellens hensigt;
nyt accepteret input revokerer stadig en ventende afslutning. Begge deler
providerlukning og korreleret fysisk playback-finish. OFF, firmware, gain, VAD,
talt Stop-politik og rent-tak-politik er uændrede. Talk beholder sin særskilte,
endnu ubekræftede drængrænse; tidligere native ACK-fejl påstås ikke fysisk løst.

Bevis: uafhængig Astra-review GO; 43 aktivitetsprøver, 110 eksisterende Live-prøver,
2 sammensatte quiet→provider-close→playback-finish→rearm-prøver og 24 scope-prøver
PASS. Fast fuld suite PASS104,0s. Frossen releasegate PASS63,5s. PR CI35627199327
og main/publicering35627675201 grønne; ingen manuelle CI-genkørsler. Scope-precheck
krævede en særskilt snæver toolingrettelse med uændret fingerprint/reviewbinding;
localhost-sandboxfejl blev håndteret som testmiljø, aldrig runtimepatch.

Aktuel usynkroniseret kilde-/gatekopi:
/private/tmp/pv-alpha-r2-observe-0921 (publiceret tree ovenfor; efterfølgende lokal
STATUS-opdatering er kun leveringslog). Den gamle Documents-worktree indeholder
historiske ucommittede ændringer og må ikke bruges som installeret-kildebevis.
Ingen fysisk lydprøve, ændret lydstyrke eller firmwareflash blev udført ved denne
installation. Næste konkrete handling er brugerens aftalte efter-release prøve.


## Aktiv R2-observationsbeslutning — målevej, ikke idle-aktivering

21/9, Lead Codex; afgrænset implementation delegeret: isoleret kandidat fra 699d1ed,
mens R1 udgives.
Direkte kode-/sinkbevis: Thin sender aktivitet som en nested observation, men både
StatusHub og AudioTraceRecorder gemmer kun scalar-felter. Native Live PCM appendes
til outputstream uden speaker-capture. Derfor mangler de eksisterende målespor
aktivitet og den accepterede native outputgrænse; ingen fysisk stilhed er bevist.

Falsificerbar hypotese: en fast, præfikset scalar-allowlist gennem de rigtige sinks
bevarer adapterens identitet, kildetid og unknown-status. Capture efter accepteret
native append bevarer nøjagtig PCM uden at medtage stale/rejected/WebRTC-output.
Kæde: adapterens aktuelle owner-check → Thin session/generation → særskilt armet
room/session-ejet trace → bounded Hub/Recorder → manifest/WAV. Outputkædens næste
trin (stream → native speaker → drain → teardown/rearm) ændres ikke og er ikke
bevist af WAV. Nærliggende races er gammel generation, andet rum, trace afsluttet,
rotation, observerfejl og afvist append; alle skal forblive uden runtimeeffekt.

Berørte kontrakter: én Thin-ejer, ingen stale events over generation/session,
ærlig ukendt aktivitet/drain, one-shot lokal optagelse og bounded diagnostik.
Plan: billig room/session-ownership, fast scalar-projektion, selvstændigt antal-/
bytebudget med eksplicit truncation og accepteret native PCM-capture. Regressioner
går gennem rigtig Hub+Recorder til manifest/WAV og afviser ovenstående fejlveje;
målrettet audio_trace/Thin/VoicePE/Talk-test, Ruff og typecheck i usynkroniseret clone.
Ingen idle-aktivering, tærskler, VAD/gain, firmware, timeout, semantisk farvel eller
tak-politik. Ingen release/push her. Rollback er dette observationsdiff alene.
Implementeret: kun armet room/session ejer nye hooks; fast activity_-projektion,
stabil SHA256[:16]-reference for provider-session, fuld uint64-counterrange og
uændret unknown/freshness/drain-status. Recorder accepterer observationer før Hub
og deler en eksplicit truncation-marker ved 1024 events eller 1 MiB; provider- og
lifecycle-events beholder egne budgetter. Native speaker-WAV får præcis PCM efter
accepteret stream-append. Diagnostiske exceptions inklusive synkront rejst
CancelledError isoleres i de nye no-await hooks; transportens cancellation ændres
ikke. Ingen nye lifecycle-/lydklassifikationsbeslutninger.

Målrettet suite PASS: 177 tests i test_audio_trace, test_voicepe_activity,
test_thin_activity_observer, test_thin_live og test_talk_webrtc. Ruff PASS for alle
fire ændrede kode-/testfiler; mypy PASS for de to ændrede produktionsfiler.
Uafhængig alpha_tool_chain_audit kildegennemgang lukkede sine to findings
(diagnostisk cancellation og rå provider-session-ID); slutresultater sendt til lead.
Fuld releasegate, release, installation og fysisk observation er ikke kørt for R2.
4 s idle, støjgrænser og semantisk final-output/drain er stadig ubevist/ufærdigt.

R1-publiceringsgrænse ved denne handoff: lokal commit 699d1ed67e2f0f5b6c682f9c4629946c552c45ed,
tree 5118853e315a33669b74e6620ffe559a9b2d68bb, releasegate PASS. Connector-blobs
er verificeret, men create_tree blev afvist af automatisk approval-review på grund
af offentlig CHANGELOG-videregivelse, selv efter bevis for gammel offentlig tekst
plus 11 releaselinjer. Eksplicit brugerspørgsmål afventer svar. Ingen remote branch,
PR, merge eller installation er foretaget. HA 1.13.90 med Alpha ON er verificeret i UI
af lead; det er ikke fysisk lifecycle-godkendelse eller en R1-installation.

## Aktiv lead-beslutning — Alpha lifecycle recovery, planrevision 2

Brugerautorisation21/9: planreview til mindst97/100, derefter implementér,
udgiv og installér; slut med gemt AlphaON på den ene Voice PE. Lead Codex.
97 er planens fuldstændighed, aldrig runtime-/akustikgodkendelse.

Planreview: uafhængig Astra alpha_tool_chain_audit revision1=84/100,
revision2=97/100 (kausal19/20,ejerskab20/20,aktivitet24/25,gates19/20,scope15/15).
GO til R1, ikke R2-aktivering eller fysisk godkendelse.
R1 årsagshypotese præciseret: Live-admission mangler den eksisterende bounded
produktionspacing for completed toolchains. Feltkæden viser ny fjerde response,
levende lease og ingen replay; kapacitetsafvisning er stærkeste kodeunderstøttede
forklaring, men numerisk shortfall blev ikke logget. Brug eksisterende ledger-
refill/pacing med samme response/generation før dispatch, ikke nye limits, rerun af
HA eller providerretry. Regression skal også afvise stale/cancel/udløbet venten.
Startupfejltale har bevist ejerfejl: silence-device revokerer Live-playbackadmission,
men error-oneshot forsøger URL uden ny admission. Mindste rettelse: close-ejet
error-only admission med epoch/close-id/Stop/reconnect-fence før og efter nativeACK.
Normal _set_live_context closing-guard bevares. Denied/staleACK må afspille nul lyd
og fortsætte samme cleanup. Regression bruger den virkelige native admissiongate.
Native Stop-ACK-timeouts er afgrænset til device-/worker-/drain-grænsen, men loggen
kan ikke vælge mellem forkert identity, worker/drain eller levering. Ingen patch
eller tidsforhøjelse på gæt; få korreleret grænsebevis i fysisk prøve.
Providerclose er ikke bevist deadlock: terminalwait afbrydes, reader joins, SDKexit
bruger2.15s. Ingen timeoutpatch på dette fund alene.


R1 implementeret som kandidat 1.13.91: lokal kapacitetsventen med samme admission-
identitet og uændrede limits; close-ejet frisk native admission til fejltale.
Uafhængig samlet Astra-kodereview: GO, ingen findings. Providerregressioner 156 PASS,
fem rigtige native-admissiongrænser PASS og fire tidligere error-close-regressioner
PASS. `scripts/dev fast --base origin/main` PASS (104 s, netværk tilladt).
En sandboxkørsel blev afbrudt ved lokale forbindelser; ingen runtimeændring deraf.
Den historiske .90 coupling-record arkiveres; den gælder ikke dette diff.
Releasegate PASS på det frosne runtime-diff (58.9 s; unit, integration, mypy,
Ruff og scope). Historisk coupling-arkivering uafhængigt godkendt; ingen gatekode
ændret. CI/ARM64-publicering, installation og fysisk kontrol udestår. R1 ændrer ikke firmware,
4 s timeout, farvel, native Stop-ACK, gain, VAD eller tak-politik.

Leverance og rækkefølge:
1. Kandidat R1: dokumenter præcis admission-afvisningsgren og hele close-await/
   nativeACK-kæden fra feltfejlene nedenfor. Deadlock er en hypotese, ikke et fund.
   Reproducer samme kæde i regression før mindste ejerrettelse. Accepted HA-effect
   er irreversibelt: ingen replay, nyt samtykke eller ommærkning til fejlet handling
   ved fejlet resultatsvar. Resultatstatus skal overleve cleanup. Kapacitetsreservation
   og frisk usage forbliver fail-closed; ingen vilkårlig limit-/timeoutforhøjelse.
   Startupfejl må bruge frisk Live-admission til eksisterende fejltale, ellers ærlig
   stille fejl/LED og cleanup; aldrig keywordfallback. Stopcleanup undersøges fra
   producerstop/admissionrevoke gennem taskcancel, providerterminal, native drain/
   disableACK til rearm. Én Thin-closeejer, ingen reader-self-await eller ACK-lockcykel.
   Eksisterende trinfrister beholdes indtil spor beviser forkert ejergrænse.
2. Kandidat R2: færdiggør aktivitets- og afslutningskontrakten nedenfor efter
   observationsmåling. R1 må installeres selvstændigt med ærlig reststatus; R2
   må ikke styre på freshness_verified=false eller gættede tærskler.
3. Særskilt mappingkontrol: læs aktivt Roborock map-ID/segment-ID og HA-area/alias-
   register, list de to umappede segmenter og bevis kobling. Køkken må ikke mappes
   til større Køkkenalrum uden at de faktisk er samme ønskede område. Zoner kræver
   eksisterende støttet koordinat-/zoneidentitet, ikke gæt. Ingen rengøringsprøve
   eller navneændring som bivirkning af læsningen. Eventuel mappingrettelse reviewes
   særskilt; uklar fysisk afgrænsning kræver brugerens betydning af rummene.
4. Wake/latens: mål misset fysisk wake separat fra registreretwake→providerready,
   sidsteord→meningsfuld rumlyd, tooltid og afbrydelseslydhale. Sammenlign samme
   position/afstand/lydstyrke, stille/støj/musik. Gains/VAD/wakefølsomhed ændres kun
   hvis dette vælger konkret flaskehals; ingen samtidige akustiske tuninger.

R2 eksekverbar kontrakt og bevisgrænse:
- Identitet: Thin epoch/session + providergeneration + native connection/run/context
  + playbacklease. Input bruger frisk faktisk firmwareVAD-inference på nye samples;
  native source_ms er kun lokalt firmwareur, modtagelse får Python monotonic.
  Sequence/source-run-fremdrift valideres; duplicates/out-of-order skaber ikke friskhed.
  Talk bruger egen browserobservation og browser/playbackidentitet, ikke nativeACK.
- Freshness-expiry og amplitudetærskler vælges fra observerede cadence/jitter og
  optaget stille/lavtale/ekko/musik/samtidigtale-matrix, fastfryses med regression.
  Måleudfald bestemmer værdierne, ikke planens score. Hvis ro ikke kan adskilles
  sikkert, stopper R2-aktivering ved denne grænse; bevar tydelig ukendt/fejl.
- Idle eligibility = ready AND frisk inputro AND frisk assistant-ro/drain AND ingen
  ventende backend/tool/approval/producer/playback/close. Kontinuerlig monotonic
  periode med gemt UI4s; enhver invaliditet nulstiller perioden. Sidste check og
  closecommit udføres uden await. Manglende observationsfremdrift er separat bounded
  teknisk fejl, aldrig stilhed. Ingen transcriptpauser eller musik tæller som robevis.
- Semantisk end er tentative receipt bundet til samme completed backend og resultat-
  continuation. Ingen ukendt terminalbackend accepteres. Current user-inputrevision
  revokerer receipt inden commit; queued gyldig inputobservation behandles før commit-
  check. Efter commit afvises input til gammel epoch, næste wake får ny session.
- En quiet snapshot beviser ikke at forsinket farvel er færdigt. Før sekssekunders
  grace fjernes skal rigtig providerprøve bevise terminalresultat→genereret farvel→
  closekvittering uden afklip. Providerens session.closed forsegler stream; derefter
  kræves samme playbackleases faktiske consumer-watermark/finish og lydhale. Ingen
  silencepakker alene må forsegle den. Hvis protokollen ikke giver tilstrækkelig
  grænse, behold markeret grace og stop denne del, dokumentér præcis begrænsning.
- Støjenergi kan ikke ophæve semantisk end; faktisk ny brugerbesked kan. Vedvarende
  tvetydig baggrundstale er et måleproblem, ikke tilladelse til lokal intentparser.
- Talk skal have browserens faktiske output/drainkvittering; manglende kvittering
  giver ubekræftet afslutning og bounded cleanup, aldrig falsk succes.

Regression/accept per kandidat: feltsekvens med vellykket HA→fejlet admission,
startup uden playback, Stop under hver fase, forsinkede audio/result/ACK efter
Stop/fault/rearm/næstewake; frisk/stale/reordered aktivitet, stille stream, output-
restart, langsomt tool og input/end-race; samme Thin-kontrakt i VoicePE/Talk og OFF.
Sideeffektfri rigtig installeret SDK/Live-protokol for multibatch continuation og
hush/musik/farvel-semantik, eksklusiv eval uden produktionssamtale. Uafhængig Astra
adversarial review, fast under udvikling, release én gang på frozen diff; ingen
manuel CI-retry. Grøn mainartifact verificeres ved installeret sha/digest; firmware
kun hvis ejerrettelsen kræver det, ampboot bevares. Gem AlphaON og kontroller efter
restart. Ingen uvarslede høje tests.

Fysisk accept: sammeartifact golden+10/10 (5semantiske/5idle med opfølgning/næstewake),
20afbrydelser,50ekko-frie svar,Talk-drain,ON/OFF/ON,funktionsparitet og40simple+20tool
rumlatens. Lavlydstyrke først. Manglende fysisk medvirken/lydbevis rapporteres som
udestående; må aldrig erstattes af plan-score, syntetisk ACK eller CI. Stop-the-line
ved ny kausal modstrid, uløst alvorligt review, klippet svar eller tabt næste wake.
Rollback kræver kendt artifact og efterfølgende feltkontrol, arver ikke stabilitet.

## Feltfund 21/9 efter installation .90 — lukning, rumvalg, hastighed og wake

Read-only gennemgang af HA-download
`/private/tmp/23375871_podvoice_2026-09-21T14-52-59.514Z.log` (10000 linjer).
Samme .90 startupidentitet 0c570873 / rootfs688ff471. Ingen runtime-/settingsændring.
Kandidaten er ikke fysisk godkendt; nedenstående fejl stopper accept.

- 16:45:17.883: HA accepterer app_segment_clean, area_ids=[kokkenalrum], repeat1,
  efter cleaning_mode=vacuum kl.16:45:15.034. Resultatsendelse og backendcontinue
  returnerer kl.17.902. Næste batch fejler i admission kl.19.416; error_class-hash
  0fa733f52f631ab0 matcher ProviderBudgetUnavailable. Ingen OpenAI-rate-limit er
  dermed bevist; præcis underårsag (lease/replay/kapacitet) mangler i loggen.
  Close starter19.419, provider-close timeout27.581, recovered28.951:9.532s.
- Capabilities kl.16:45:11.930 viser Køkkenalrum, intet separat Køkken og
  unmapped_segments=2. Det beviser eksponeret mapping, ikke at Køkken ikke findes
  på robotkortet eller i HA. Rå mapping og de to umappede segmenter skal kontrolleres
  før navne/aliaser/zoner ændres. Ingen ny rengøring startet ved denne gennemgang.
- Wake16:44:58.390 → readerstart59.766=1.376s (ikke session-ready/audible proof).
  Første capabilitydispatch16:45:11.559 → cleaning accepted17.883=6.324s.
  Wake→accepted19.493s inkluderer brugerens tale; kan ikke kaldes svartid.
  Rumoptaget sidste ord/første meningsfulde lyd findes ikke i denne log.
- 16:23:09.021 wake registreret, providerconnect fejler19.283, fejltale fejler
 19.514 med Stop context is not armed. Derfor er denne manglende respons efterwake.
- Stop16:23:57.598 efterfølges af gentagne stop-context-disable timeouts;
  Stop16:27:28.594 af silence-device og stop-context-disable timeouts, reconnect
 16:27:44.268. Det er særskilt fra akustisk wake-rate og semantisk timeout.
- Musik16:43:14 søges som Collert Pumas og fejler;16:43:30 Colors Black Pumas lykkes.
  Ingen kildeoptagelse: genkendelse vs misfortolkning er ikke afgjort.
- Alpha sætter fortsat idle_deadline=None. Ingen idle/semantisk lukning ses i disse
  fem eftermiddags-sessioner; stop/error lukker dem. FirmwareVAD/gain uændret.

Anbefalet hierarki til næste kandidat: fysisk/panelStop og fatalfejl ejer bounded
cancel/cleanup; modelsemantisk end ejer naturlig afslutning efter kvitteret arbejde
og faktisk lydhale, ny brugerbesked kan annullere før commit; ellers gemt UI-idle
kun ved frisk verificeret ro og intet ventende arbejde. Støjenergi alene er hverken
samtalehensigt eller grund til at holde en semantisk afsluttet session åben.
Ukendt aktivitet må ikke tælle som ro. Ved vedvarende tvetydig tale/støj skal
observationsgrænsen bevises; ingen skjult længere timeout eller lokal intentparser.
Ret konkret admission/cleanup/startup-fejl før akustisk tuning; undersøg derefter
wake-hitrate i rummet separat fra efterwake og playback-ekko.

## Aktiv lead-beslutning — Alpha Stop og lys, 21/9

Brugeren understreger: implementér aftalt adfærd, begræns diagnosearbejdet.
Lead Codex. Bevist statisk årsagskæde: Thin Alpha wake + playback armer keyword;
VoicePELink kræver armed og firmware StopContext.admits kræver enabled. Det
lokale keyword kan derfor kappe “stop musik”; blot disable blokerer også lyd.
Samtidig kan shared end_conversation-beskrivelsen gøre hush eller musikhandling
terminal. Dette retter en kendt ejergrænse uafhængigt af den endnu uafklarede
post-action exception. Observerkandidat færdiggøres softwaremæssigt; ingen ny
separat diagnoseinstallation før denne konkrete adfærdsrettelse er klar.

Kæde: physicalwake nonce → keyword-disabled Live-admission + workerACK →
kontinuerlig mic/Live → modeltolket stop/musik → backendautorisation/dispatch →
playback → fysisk/panel cancel eller senere close/rearm. Invarianter: én Thin,
intet lokalt intentparse, ingen genoplivning af cancelled context, exact generation
og ACK, OFF uændret, ingen gevinst/VAD/buffer-/timeouttuning. Hypotese: separat
playback_allowed med disabled keyword og Live-only semantik lader hele sætningen
nå modellen og bevarer samtalen ved hush/musik; forsinket native-stop fra tidligere
kontekst kan ikke påvirke den nye. Må ikke kaldes fysisk bevist uden afbrydelsesprøve.

Implementering: capability live_semantic_stop_v1 + service podvoice_live_context,
nyt korreleret live-ACK; gammel stop-service bevares. Alpha kræver kapabiliteten
før provideropen. Fysisk/panel Stop og close revokerer admission og annullerer lyd.
Live-only prompt/declaration skelner hush fra session-end og bevarer samtalen efter
musik; tak-policy og OFF-prompt urørt. Cyan er feedback for åben Alpha, ikke falsk
påstand om tale fra kontinuerlig stream; fault/idle forbliver hændelsesbaseret.
Regressioner: gammelt/newfirmware x ON/OFF, disabledkeyword playback, fault/manglende
ACK, cancelled/sent detection/stale generation, fysiskStop, tekst/modelsemantik,
Talkparitet. Uafhængig Astrareview, målrettet SafeEval ved semantikændring, relevante
gates før install. Rollbackgrænse: nul lyd eller forkert ejer/cancel/fault medfører
NO-GO, ingen fallback til lokalt keyword i Alpha. Post-action/idle/goodbye stadig åbne.

Observerkandidatens releasekørsel: delchecks grønne, men samlet gate **ugyldig**,
fordi lead ændrede STATUS under kørslen. Ingen installation eller releasegodkendelse
udledes heraf. Næste samlede gate køres først på frosset konkret Stop-kandidat.

### Uafhængigt review af frosset Stop-kandidat

Source-review GO fra Astra /root/alpha_tool_chain_audit: begge P1-findings lukket,
ingen uløst sourcefinding. Firmwarekilde er publiceret som
`d22da734e6bbef650881b3b6bd413ffe145764e5`; de to komponentgrupper er pinnet til
samme revision. Manifest19-filer `b14ac035f86a9535db7dde9e3e3592096b7bc80fdbf39dcc1a7bddcee597087f`.
Den eksisterende scopegate mangler netop denne tre-domæners kombination; den får
en afgrænset tooling-regression (22 PASS). Særskilt Astra tooling-review GO:
missing/stale review og ændrede bytes afvises stadig. Ingen runtimehypotese ændres.

<!-- historical-v1.13.90-candidate-scope-coupling
{
  "version": 1,
  "base_tip": "275e9ca8d030388b3722e1e2aa0d31f263d19ada",
  "merge_base": "275e9ca8d030388b3722e1e2aa0d31f263d19ada",
  "domains": [
    "physical_output",
    "realtime_semantics",
    "rearm"
  ],
  "fingerprint": "57478c06d23bf823b67bf3b719a054cc515966ac1126a9fd3774e36f898d4b46",
  "reviewer": "Independent Astra /root/alpha_tool_chain_audit",
  "rationale": "One approved Alpha Stop contract requires keyword-disabled firmware playback admission and exact native ACK/revocation, worker-run continuity through cleanup/rearm, and Live-only semantic distinction between hush/music control and session closure. Splitting these domains would preserve keyword truncation, block playback, or leave semantic closing inconsistent. Inert observations remain identity-bound. Cancellation and restart races have regressions; OFF and thanks policy unchanged. Software gates only, not semantic or physical acceptance."
}
-->

### Installeret 1.13.90 — Alpha gemt ON, 21/9 kl. 14.13

Brugeren gav udtrykkelig ready/merge/install-godkendelse. PR61 er merged fra
`a0020fb7b35b62ef06219baae76380fa695ef4fa` til main
`0c5708733a5f5cbcd75e6a94e121aa191a636b75`. Main-run35597567667:
lint-test og publish-addon SUCCESS, ingen manuelle CI-genkørsler.
HA opdateret gennem appens normale opdatering: installeret1.13.90, Kører.
Startup bekræfter samme git_sha og artifact
`rootfs-v1:688ff471dbc5fa02b74c22c455693ccbbddad24bc7c37cc53a4dbd598a67934a`.
Voice PE genforbundet kl.14.13.28, krypteret handshake, live_semantic_stop_v1,
activityobserver og amplifier-boot capability til stede; kanal1/gain16 bevaret.

Frisk indstillingsvisning efter add-on-genstart: GPT-Live Alpha checkbox=1,
ingen aktiv samtale, Hey Chat bekræftet af enheden, gemt timeout4s.
Valget persisteres i HA `/data/podvoice.json` og læses ved hver ny wake.
Voice PE efterlades dermed med Alpha valgt til næste samtale; strømfrakobling
ændrer ikke HA-valget. Faktisk unplug/replug og hørbar samtale er ikke prøvet her.
Brugeren har én Voice PE; ingen særskilt køkken-enhedsvariant er oprettet.

Nedenstående approvalblok er historisk og løst. Hele Alpha-goal er ikke færdigt:
post-action-fejl, aktivitetskalibrering/stilhedstimeout, farvel/Talk-drain og den
samlede fysiske accept udestår. Installation er ikke fysisk golden/10/10-bevis.

### Delinstallation og afventende konkret repository-godkendelse

PR61 exact-head `a0020fb7b35b62ef06219baae76380fa695ef4fa`: CI lint-test og ARM64
build-addon SUCCESS (run35591325208). Firmware OTA c6e305ad… blev installeret med
acknowledged success. Krypteret API bekræfter samme MAC20:F8:3B:0A:7E:7A,
compiletime2026-09-21 12:45:03+0200, ny podvoice_live_context-service og activitysensor.
Rapport `/private/tmp/pv-stop-build-0921/installed-report.json`. Ingen hørbar eller
lifecycle-proof endnu. HA kører fortsat1.13.89; Stop/LED-apprettelserne er ikke aktive.

Automatisk approvalreview afviste `gh pr ready61` (og revurdering med tidligere
installationsgodkendelse): reviewer kræver udtrykkelig godkendelse af draft→ready.
Et konkret spørgsmål om ready+mergePR61+HA-install er sendt til brugeren; afventer
svaret. Ingen workaround eller anden mergevej er forsøgt. Goal er fortsat aktivt.

### Lokal releasegate grøn — installation udestår

Frosset `982ea3a`: `scripts/dev release --base origin/main` PASS på54,8s med
localhost-testporte tilladt. Ruff/format, mypy50, exact candidate-scope og fulde
unit/integration-suiter PASS. Log `/private/tmp/pv-stop-release-final-0921.log`.
Fixturevedligeholdelsen har særskilt Astra GO; productionfingerprint er uændret.
Næste gate er exact-head CI/ARM64-image og installation af samme godkendte kandidat;
ingen modelsemantisk eller fysisk gate udledes af dette resultat.

### Gateforløb og test-fixture-kompatibilitet

Første kontrol blev ugyldiggjort af sandboxens forbud mod localhost-bind; ingen
runtimeændring fulgte. Genoptaget med testporte tilladt fandt7 historiske Talk-WAV-
fixtures, som tvang WebRTC fra uden at simulere den nye native admission. De nåede
derfor korrekt ikke SDK-start. Testfixtures og SyntheticCapture-evaluatoren har nu
eksplicit syntetisk capability/ACK, markeret uden fysisk bevis. Produktionens Talk
og Thin er urørt. 216 berørte tests PASS; ingen timeoutforhøjelse. Næste releasegate
køres med nødvendige testporte og hele diffet frosset under kørslen.

### Provisioneret Stop-build

ESPHome2026.6.2 compile PASS fra remote d22da73-pin. Alle21 genererede C++-filer i
de ændrede komponentgrupper er byteidentiske med reviewet kilde. Ny Live-service,
kapabilitet, observer-define og amplifier-boot er verificeret i genereret main.
Privat artifact: `/private/tmp/pv-stop-build-0921/esphome/.esphome/.esphome/build/podvoice-pe-live-alpha/.pioenvs/podvoice-pe/firmware.ota.bin`.
3061616bytes, SHA256 `c6e305ada9d7daa9d7d62818f4e89d4ccf2ae10a83ca874354a0422b89660fed`.
Report `/private/tmp/pv-stop-build-0921/compile-report.json`. Ikke installeret;
ingen fysisk gate arves. Rollbackbuild og eksisterende enhed er urørt.

### Faktisk Stop/LED-ændring før installationsbuild

Thin bruger nu særskilt Live-admission ved wake og første playback; Alpha kræver
kapabiliteten og korrekt ACK før provideropen. Firmware tillader playback med
keyword slået fra. Native Stop/close/fault revokerer admission og ventende ACKs;
kontrolleret providerrotation kan få en ny admission. OFFs keywordvej bevares.
Live-only instruktion og end-tool skelner hush fra lukning og bevarer samtalen efter
musikstyring. Tak-policy er ikke ændret. Ready Alpha viser stabil cyan gennem
lytning, backendarbejde og lyd; error/mute/idle har fortsat egen betydning.

Astrareview fandt en reel restart-race: et disabled keyword kunne få sit fault
nulstillet og samme kommando genbekræftet mellem to mainloop-ticks. Rettelsen
binder Live-admission/ACK/play til inferenceworkerens run ved fysisk wake. Ny run
kan ikke genbruge admission; normal cleanup og næste wake kan stadig komme videre.
En foreslået generel cancel-latch blev ikke beholdt, fordi samme cancel bruges ved
legitim bekræftelsesrotation. Terminal closing og native revisionsfence ejer Stop.

Målrettet samlet Thin/Live/Talk/native/prompt-suite: 194 PASS. Uafhængige 9
adversarial Thin-regressioner PASS; firmware/observer/worker-suite 19 PASS.
Ruff/format og mypy for de tre ændrede Python-runtimefiler PASS. Dette er
softwarebevis, ikke bevis for modeltolkning, lyd i rummet eller installation.
Source-review og provisioneret build er nu PASS; frozen releasegate udestår endnu.
Firesekunders stilhedslukning, erstatning for farewell-grace, post-action-fejlen
og fysisk slutmatrix er fortsat åbne dele af det samlede Alpha-goal.

## Fast godkendt Alpha-adfærd — præcisering fra chatten, 21/9

Ingen ny produktbeslutning: brugerens godkendte plan er autoriteten for ON.
- Talt “stop”: stop assistant-tale, lyt videre i SAMME samtale.
- “stop musik”: stop musikken, bevar samtalen.
- Ny tale under svar: naturlig afbrydelse og behandling af den nye hensigt.
- “farvel”: naturlig afslutning, hele farvel afspillet, derefter næste wake klar.
- Fysisk Stop/panel-Stop: luk session og annullér igangværende/ventende/incoming lyd.
- Reel stilhed: UI-værdien (aktuelt4s), efter klar lydvej og uden ventende arbejde.
- ON/OFF gælder næste samtale. OFF bevarer sin eksisterende kontrakt.
Modellen fortolker alle talte ønsker; lokal keyword-stop skal ikke kunne afskære
“stop musik” i Alpha. Fundet teknisk kobling mellem keyword-enable og playback-
admission er en fejlgrænse, som skal adskilles, ikke en grund til at ændre aftalen.
“Tak for det” indgår i gennemgangen af eksisterende stille-lytten-regel; brugerens
seneste citerede “blot til debat, ikke ændre” autoriserer ingen ny tak-policy.

## Aktiv lead-beslutning — gennemfør Alpha, observationsgrundlag, 21/9

Brugeren gentager eksplicit gennemførsel af hele den godkendte plan; goal er nu
oprettet og aktivt. Lead Codex. .89 er installeret, men fysisk musikreproduktion
mangler. Post-action-fejl må ikke gættes væk. Uafhængigt af dette kan planens B
observationsgrundlag implementeres og reviewes uden at aktivere timeoutkontrol.
Observeret kodefejl: Alpha har ingen idle-deadline, og en kontinuerlig tavs stream
kan beholde AI_SPEAKING. Eksisterende VAD-bool mangler friskhedsbevis, mens mixeren
allerede ejer source-pending/output-consumed frames. Hypotese: friske kontekstbundne
VAD-inferences og announcement-source-målinger kan levere aktivitet uden musik-
forurening; den skal falsificeres mod optagelser før signalet må lukke en samtale.
Kæde: fysisk capture/VAD → native observation → VoicePELink → Thin-trace og
announcement source før mix → output-consumed watermark → samme observer.
Invarianter: Thin ene samtaleejer, ingen ny semantikmotor, gammel observation inert,
manglende/stale data ukendt, ingen musik som assistant-tale, OFF uændret, fysisk
output/finish stadig eksisterende korrelerede gates. Ikke-mål: ændrede gain/VAD,
lydtærskler, timeout eller transport. Talk skal få tilsvarende observation med
browserkilde og ærligt ukendt fysisk rumdræn. Ingen provider-tur-events fabrikeres.
Regressioner: stale/duplicate/reconnect/contextskift, inference-opvarmning/stop,
source/mixer-bufferfremdrift, musikadskillelse, intet signal før korrekt identitet.
Afgrænset review og gates før installation; ingen fysisk accept eller timeout-
aktivering uden kalibrering. Denne observationsændring er ikke et fix af kandidat1.

21/9 konkret fremdrift på observationsgrundlaget: native firmwaretelemetri,
VoicePELink-ingest, Thin-trace og Talk WebRTC stats/render-observer er implementeret
lokalt. Ingen af signalerne styrer endnu timeout eller farvel; transportfriskhed
og fysisk dræn er eksplicit ubekræftet. Root-suite141 PASS (ThinLive/native capture/
activity), native validering23 PASS, Talk udvalgte24 PASS og root mypy PASS.
Uafhængig Astra-review fandt P2: gentagen VAD-inference stod som frisk stilhed;
source-work kunne krydse restart-epoch; synkron Talk-observer CancelledError kunne
lukke samtalen. Talk-finding er rettet/regression PASS; firmwarefindings rettes nu.
Frosset diff/release/installation af denne kandidat er IKKE udført.

21/9 root prøvede selv musikpause via Talk på installeret .89 kl12:03:49.745.
Prøven fejlede før dispatch: klient/budget frigivet12:03:59.327, ingen reader/socket,
provider connect failed tom exception12:03:59.335 og close error:connection.
Ingen musikhandling udført; dette er IKKE reproduktion af post-action-fejlen.
Kausal regression beviser offer→hængende HTTP-create→ydre Thin-opstartstimeout,
levende ping, nul dispatch, ren cleanup og ny session uden replay. Receive-loop-
deadlock er afkræftet. Kodekonflikt: Thin samlet8s vs browserICE15s og adapter15s;
der er ikke indført en større timeout på gæt. Den oprindelige musikfejl er åben.

21/9 observationskandidat1.13.90: uafhængig Astra-review GO, alle tre P2 rettet.
Native23 tests, Talk24 udvalgte, samlet review36 cases PASS. Fastgate format/Ruff/
mypy50 PASS; hele pytest kun fejlet på den forventede gamle immutable firmwarepin.
Denne test opdateret til endeligt reviewet pin/manifest og målrettet PASS.
Rigtig firmwarekompilering afslørede feature-defines include-order; afgrænset fix
uafhængigt reviewet og real-MWW-test ændret til genereret defines.h (ikke blot -D).
Komponentkildeacc6dbd efterfulgt af35ea628e252d8a6825ff1f6df0a04ac27fbd3393 er pushet.
Begge ændrede komponentpins bruger35ea628; podvoice_audio forbliverb56a08a6.
Manifest19 udvalgte kildefiler SHA256ebf3aa7742a58ec4fe0b9a29951b6df9ccc83465ddeae4ccccb6a26317d6e0f2.
Observer-sensor er disabled_by_default i HA (undgår recorder/state-længdeproblemer),
men native-synlig. Rigtig ESPHome boot/package-regression PASS OFF ogAlpha.
Slutbyg kører i/private/tmp/pv-activity-build-0921; rollbackbuild er urørt.
Ingen firmwareflash eller1.13.90-installation endnu; releasegate afventer slutbyg.

Næste Stop-implementering er afklaret mod brugerens allerede godkendte kontrakt:
separat capability live_semantic_stop_v1/service podvoice_live_context giver
keyword-disabled playback-admission gennem samme nonce/generation og exact worker-
ACK; gammel stop-service/OFF bevarer enabled=playback-admission. Ny tilladelse må
ikke omgå cancelled/fault/ACK eller genoplive cancelled kontekst. Thin Alpha wake
og playback bruger den nye admission; manglende firmwarekapabilitet fejler før
provider. Fysisk/panel-Stop beholder fuld cancellation. Live-only instruktion og
end_conversation-beskrivelse skal skelne hush fra session ending og bevare musik-
samtalen; kanonisk OFF-prompt og eksisterende tak-policy ændres ikke. Dette er
implementeringsgrundlag, IKKE færdig kode eller fysisk afbrydelsesbevis.

21/9 slutbyg PASS73.01s. OTA3060768bytes SHA256
e020b824e87c79a4ad3295510aed8a90b92958ff938f90b844fbe6d05b7cd2e5.
Alle8 genererede observerfiler matcher35ea628; ampboot og default-disabled sensor
bekræftet. Ingen flash. Første release-preflight stoppede før tests, fordi den
manglede den eksisterende gatekontrakts exact-tree coupling-post. Uafhængig Astra
verificerede nedenstående fingerprint/domæner og godkendte den nødvendige kobling.
Ingen runtime-/gateændring udledt; releaseforløbet genoptages på samme produktbits.

<!-- historical-observer-candidate-scope-coupling
{
  "version": 1,
  "base_tip": "275e9ca8d030388b3722e1e2aa0d31f263d19ada",
  "merge_base": "275e9ca8d030388b3722e1e2aa0d31f263d19ada",
  "domains": [
    "physical_output",
    "rearm"
  ],
  "fingerprint": "8ca1413662b378c81472c4cc4b0fefdc7ce0d567f7f69c18996f56de438bce6a",
  "reviewer": "Independent Astra high alpha_tool_chain_audit",
  "rationale": "One observation-only activity contract correlates fresh firmware VAD inference and announcement-source consumption with native session/epoch and Thin identity. Splitting removes the paired calibration evidence. No timeout, Stop, gain, VAD or playback control changes. Exact production tree independently reviewed; firmware matches pinned35ea628."
}
-->

## Aktiv lead-beslutning — Alpha kandidat 1: resultat og lukningsdiagnostik, 21/9

Brugeren har godkendt implementering af den fulde Alpha-plan. Lead Codex starter
med kandidat1; øvrige runtimeændringer venter på den kendte post-action-fejls
årsagsgrænse. Observeret kæde: HA HassMediaPause action_done09:46:04.125 →
live-tool-failed09:46:05.204 → provider-close timeout09:46:13.350 → rearm09:46:14.786.
Den konkrete exception skjules. Hypotese: fejl mellem afsluttet dispatch og
backend-fortsættelse; SDK-serialisering er separat bevist, faktisk serveraccept ukendt.
Kæde dækkes fra brugerinput/generation → completed/admission → dispatch/result →
provider continuation/lyd → close-send/terminal/socket-release → fysisk stop/rearm.
Invarianter: én Thin-ejer, ingen replay af udført handling, autorisation bevaret,
stale-generation isoleret, fysisk afslutning ikke afledt af provider/UI.
Første ændring er udelukkende redigeret diagnostik: statiske stadier og fejltyper,
korrelationsidentitet, providerfejlkode uden tekst/payload, close-milestones.
Ingen ændring i timeout, gain, prompt, payloadform, Stop, transport eller fallback.
Regressionsplan: rigtige SDK-wirekald, fejl før/efter output/continuation, observerfejl
uden adfærdseffekt, ingen hemmeligheder i diagnostik, current/stale tool-failure og
én dispatch, stop/cancel under close. Målrettet gate, fastgate, uafhængig Astra-review;
release først efter diff-freeze. Fysisk gate er IKKE bestået; ny diagnostik kræver
installeret exact artifact og frisk korreleret prøve før årsagspatch. Ukendt årsag
må ikke omgås med næste symptompatch. Rollback til dokumenteret .88/amp_boot_v1;
ingen fysisk accept arves. Ingen nye testlyde eller musikstart planlagt.

21/9 kandidat1 implementeret som1.13.89 diagnose-only. OpenAILiveSession logger
redigerede stage-milestones og aktiverer provider_observer; IDs er SHA256-referencer,
maskinfejlkoder allowlistes, ukendte værdier hashes. Ingen payload/exceptionmessage,
lyd eller transcript i den nye diagnostik. Thin registrerer resultatantal og præcist
stadie, også ved sen fejl, men gamle sessioner kan ikke få trace/close ind i næste.
Observer- og logsinkfejl kan ikke ændre dispatch/cancellation. Provider141 tests PASS;
hele ThinLive109 PASS før sidste encoding-hardening, fokuserede5 PASS. RealSDK bruges
over offline socket; det er ikke server- eller fysisk bevis. Uafhængig Astra
alpha_candidate1_review GO efter rettelse af alle findings; P0/P1/P2=0.
Review SHA256 openai_live21cd04e021d17d092ab320eff01747837b8a7330d42bb8ff8072529c1f88bfd7,
thin331b23b0ddbecbc49d0e1ecf11aa2e473b4f04806f8a741575fc0aa31173f96d.
Pakning .89 matcher pyproject/config/__version__; ingen ny firmware-OTA krævet.
Brugerens drøftelse af stille afslutning efter “tak for det” er KUN debat: ingen
ændring af instruktion eller afslutningspolitik i kandidat1. Produktdiff frosset;
fastgate kører og én releasegate følger. Musikfejlens årsag og alle fysiske gates
står fortsat åbne. Det godkendte Alpha-goal er aktivt, ikke fuldført.

21/9 fastgate: Ruff/format/mypy PASS. Første pytest lå under sandbox uden lokale
socketrettigheder og indsamlede én assertion mens provideragentens sidste testedit
landede; ingen produktpatch udledt. Den invaliderede pytest-del blev kørt igen på
frosne bits med lokale testporte: hele tests PASS. Derefter ét afgrænset diagnostik-
hul rettet: interne LiveProtocolError-årsager får hashed protocol_error_ref, også før
providerens indre stadier. Nye145 provider-/6 målrettede Thin-prøver PASS. Uafhængig
Astra re-review GO, P0/P1/P2=0. Endeligt frosne produkt-SHA256:
openai_live b67a2ebc382fa89203ea7ef378a065754b408ee60eb091b75e28fdbf17997815;
thin88d1cf10b0706c48000904aaade78d336f2ba1c3f11943cc18d6c593901edce1.
Releasegaten startes nu én gang på dette diff. Ingen fysisk prøve kørt i arbejdet.

21/9 releasegate på e7b7542 PASS51.1s: Ruff/format, candidate-scope,
mypy50, unit og integration. Log /private/tmp/pv-alpha89-release.log.
Ingen SafeEval, da kandidat1 ikke ændrer prompt/schema/semantik. Næste grænse er
exact-head CI/ARM-image, installation og frisk post-action-prøve; ingen fysisk accept.
Frisk read-only HA-kontrol: fortsat1.13.88. En senere bruger-session10:16:24–10:17:03
havde webopslag og model-close/rearm uden den viste tool-fejl; den ophæver ikke de to
musikfejl eller beviser svarets korrekthed/lyd. Ingen agentudløst lydprøve.

21/9 PR60 oprettet og vedhæftet; head b07ab7c726bdf776ed3d87f070f511abc35adf50,
base307e2f8. CI35578364975 lint-test og ARM build-addon SUCCESS, PR MERGEABLE/draft.
Automatisk godkendelseskontrol AFVISTE gh pr ready/merge før eksekvering: den kræver
brugerens eksplicitte godkendelse til merge af draft og installation af1.13.89.
Afgrænset spørgsmål er sendt med PR/version/genstart/ingen adfærdsændring. Ingen
merge, publicering eller installation er udført. HA forbliver1.13.88; ingen ny OTA.
Denne logopdatering holdes lokal, så den præcise grønne PR-head ikke ændres under
ventetiden. Næste handling ved godkendelse: merge eksakt head, grøn main-publicering,
HA backup/update, versions-/artifactkontrol, optag frisk prøve. Uden godkendelse
forbliver draft og installation uændrede; intet alternativt deploy må omgå blokken.

21/9 brugerens nye instruktion “ret de resterende fejl og så installer” er forelagt
godkendelseskontrollen med konkret PR60-diagnoseforudsætning. Handlingen blev tilladt:
PR60 MERGED09:43:51Z til275e9ca8d030388b3722e1e2aa0d31f263d19ada. Main-
CI35584910634 kører; installation afventer grøn publicering. Ny arbejdsgren
codex/gpt-live-alpha-followup starter på denne main med tidligere lokal ventelog
bevaret. Bruger gentager, at “tak for det” kun er debat: ingen policyændring.

21/9 main-CI35584910634 lint-test/publicering SUCCESS. HA-opdatering udført med
backup-switch verificeret ON; separat backup-resultat ikke kontrolleret. HA viser
1.13.89 Kører. Runtimeopstart11:54:46 og identity11:54:47 bekræfter
275e9ca8d030388b3722e1e2aa0d31f263d19ada og
rootfs-v1:ee6f3ddb5a1a84ccbd97d2466f25104cbc1efbff83c5fafbd6cdf019168e2951.
MCP18 værktøjer og Voice PE-handshake11:54:51 lykkes; firmwarekontrakt OK inkl.
podvoice_amp_boot_v1. Stale rearm-ACK afvist; wake detector recovered afventer
første fysiske bevis. Ingen firmwareflash, testlyd eller lydstyrkeændring udført.
Diagnostik er installeret; musikfejl, fysisk golden chain og 10/10 er IKKE bevist.
Goal-værktøjet returnerede null ved denne genoptagelse; tidligere aktiv-status
ovenfor er historisk og må ikke læses som aktuel schedulerstatus.

## Aktiv lead-beslutning — tavs fysisk højttaler efter Alpha-installation, 21/9

Lead Codex. Installeret add-on 1.13.88 og firmware podvoice_build_11382_livewav2
på MAC 20:F8:3B:0A:7E:7A. Brugeren rapporterer normal lyssekvens men ingen tale
med Alpha ON eller OFF; heller ingen lyd fra panelets højttalertest.
Frisk OFF-prøve 09:15:11–24: wake, device mic, session.updated accepteret,
korrekt input “Hvad er seks gange syv?”, completed respons og lydtokens;
Voice PE henter 64345 B FLAC (114240 B PCM). Firmware melder playback-start,
UI viser 1664 ms, og normal idle/teardown/rearm følger. Brugerens stilhedsobservation
modsiger påstanden om hørbar lyd. Native read-only probe på samme MAC viser
media_player IDLE, volume=1.0, muted=False, mikrofonmute=False. Ingen gainændring,
genstart, firmwareinstallation eller ny testlyd udført af lead under diagnosen.

Kæde: firmware package-merge/boot → forstærker/DAC → wake/mic → provider → FLAC/WAV
HTTP/mixer/resampler → output/amp → faktisk lyd → finish/teardown/rearm/næste wake.
Falsificerbar hypotese: Alphas nye listeformede on_boot i podvoice.yaml erstatter
basens mappingformede on_boot ved ESPHome package-merge, så amplifier-enable ved
boot bortfalder. Forstærkeren har ALWAYS_OFF og er internal; softwarevolume og
playback-events kan derfor stadig se normale ud. Hypotesen afventer verificering
mod den faktiske ESPHome 2026.6.2 mergefunktion; den er endnu ikke en bevist årsag.
Invarianter: OFF-bevarelse, én fysisk lydvej, firmware som hardwareejer, fysisk
lydbevis stærkere end events/UI. Ikke-mål: model, prompt, VAD, gain, timeout,
transport, mixer eller nye runtimeabstraktioner.

Plan: uafhængigt Astra-review af hypotesen; mindst mulige konfigurationsrettelse,
regression af den reelt sammenflettede OFF- og Alpha-bootkæde, firmwarebyg og
relevante gates på frosne bits før installation. Bevar capture-status-init og hele
basens bootsekvens uden dobbelt amp-init. Ny firmware skal have egen identitet.
Rollback kræver eksisterende verificeret binær eller nyt verificeret baselinebyg;
ingen slettet /tmp-artifact må antages tilgængelig. Kandidaten er IKKE fysisk
testklar; golden chain, 10/10, Alpha-duplex og hastighed er ikke godkendt.

21/9 faktisk årsag bekræftet: ESPHome2026.6.2 merge_config erstatter mapping med
liste; original307e2f8 mister hardware-boot. Uafhængig Astra silence_boot_audit
reproducerede fejlen med uændret upstream helper og reviewede den minimale rettelse.
Base on_boot er nu samme automation i en liste; alle handlinger/prioritet bevaret.
Alpha annoncerer desuden podvoice_amp_boot_v1 som revisionsidentitet, ikke fysisk
bevis. 11382-markøren bevares som kompatibilitetsidentitet; ny binær SHA identificerer
rettelsen. Ingen add-onændring. Den nye regression bruger den faktiske ESPHome
package-merge for både baseline og nestedAlpha, beviser begge boot-hooks og reproducerer
den gamle fejl. AGENTS kræver regressionen ved hvert firmwarebyg.
Genereret main.cpp er uafhængigt kontrolleret for begge prioriteter og amp-enable;
32 komponentfiler matcher buildkopien. Fastgate PASS116.0s inklusive hele den valgte
testsuite. ESPHomebyg PASS; rollbackbyg fra preAlpha-parent kører, da gammel binær er
slettet. Brugeren har eksplicit godkendt installation, når klar. Voice PE volumen
100→20 procent er sendt og læst tilbage; mute fortsatFalse. Ingen OTA endnu.
Astra scoped GO til firmware-only-recovery efter artifactkontrol; fysisk lyd/golden/
10/10 stadig åbent. Diff fryses nu til én releasegate.

21/9 installation gennemført på brugerens eksplicitte godkendelse. Første release-
precheck afviste gammel Alpha-coupling-record; den er historiseret, og den nye
firmwareregression er lagt i tests/firmware/boot_package_regression.py. Næste gate
bestod Ruff/format, scope og mypy50, men fandt en eksisterende tidlig assertion i
Live-confirmation-testen: _active=False indtræffer før provider-close. Uafhængig
reviewer ændrede kun testen til bounded await af den eksisterende close-task;
root gennemgik diffet. Begge parametriseringer PASS, dernæst hele unit+integration
PASS på de endelige bits; ingen runtimepatch eller gentagen fuld releasegate.
Firmwarekilde/testrettelse commit9e83a09. Kandidat-OTA3057856bytes,
SHA256afc70fc46eb7140bf22ff2988662a789149c7aaf888dd10a7129fa70389e1a5c.
Rollback fra præ-Alpha b3f4bd5,11378, blev genbygget (ikke arvet fysisk godkendt):
3054096bytes SHA256f1fb0c561c370e45fbfcc6e57f472696ec6db9d7a3f796972a0154c327be65ec.
Begge binærer opbevares privat i speaker-recovery-20260921-arkivet.
OTA til frisk DNS-verificeret192.168.86.30: SUCCESS9.24s. Efter reboot bekræfter
krypteret nativeAPI samme MAC20:F8:3B:0A:7E:7A, kompatibilitetsmarkør11382,
ny revisionsmarkørpodvoice_amp_boot_v1, volume0.2 og mutedFalse. HA1.13.88
har genfundet Voice PE; ingen add-oninstallation eller Alpha-settingsændring.
Brugeren er bedt om én høreprøve. Hørbarhed, golden chain,10/10 og AlphaON-prøve
AFVENTER; firmwareevents eller grøn UI kan ikke erstatte brugerens lydobservation.

21/9 brugerens første Alpha-prøve efter amp-rettelsen: “alpha virkede ret godt i
første hug”. Dette er brugerbekræftet hørbarhed/afgrænset Alpha-brug, ikke golden
chain/10/10. Nye observationer: stop musik problematisk, pause musik virker;
farveskift1–3s efter start; manglende idle-lukning. Read-only kodeaudit:
Thin850 sætter Alpha idle_deadline=None og ingen Live-event genarmerer den; normal
UI idle_timeout_s kan derfor ikke virke. Thin851 armer lokal stop for hele Alpha;
4867–4885 accepterer korreleret wake_stop uanset samtalestate i Alpha. Stop musik
kan afbrydes før fuld semantisk forståelse, men præcis brugerhændelse er ikke
korreleret til stop-word i de viste logs. Fysisk LED sættes til cyan LISTENING før
providerconnect; første80ms kontinuerligt output kan udløse playback-start og grøn
AI_SPEAKING, også uden bevis for meningsfuld tale. Eksakt rapporteret blå→cyan hue
kan ikke fastslås uden matchende trace/visuel observation. Astra alpha_ux_audit
bekræfter idle- og LED-ejergrænser. Ingen runtimeændring udført.
Direkte HA-log:09:46:04.125 HassMediaPause action_done;09:46:05.204 live-tool-failed,
09:46:13.350 provider-close timeout. Så selv vellykket musikpause har en separat
fejl efter handlingen; årsagen er ikke logget af catch-blokken og må ikke gættes.
09:46:54→09:47:26 stille session lukkes først ved stop. Næste kausale undersøgelser:
tool-resultat/close-fejl; Alpha-ejet stilhed baseret på rigtige tale/lydgrænser;
Stop-konflikt og sand LED-status. Ingen fraseregler eller opdigtede Realtime-events.

## Plan efter første hørbare Alpha-prøve — 21/9, kun undersøgelse

Brugeren beder om plan og loggennemgang. Ingen ny runtimeændring, indstilling,
lydprøve eller installation i denne undersøgelse. Lead Codex; uafhængige read-only
Astra-audits alpha_ux_audit og alpha_tool_failure_plan. Installerede bits er fortsat
HA1.13.88 + amp_boot_v1 ovenfor. Første brugerprøve er positiv; kandidaten er ikke
lifecycle-godkendt, og kendte tool-/idle-fejl skal afklares før acceptserien.

Loggrundlag: de tidligere læste sessioner09:45:32–09:47:30 og genlæst HA-loghale
09:45:39–09:52:31. To provider-close timeouts09:45:46.122/09:46:13.350;
09:46:04.125 musikpause action_done efterfølges af live-tool-failed09:46:05.204.
En session09:46:54.585–09:47:26.913 har meget lavt micniveau og slutter ved stop;
lavt gennemsnitsniveau alene beviser hverken fysisk stilhed eller mikrofonfejl.
Loghalen er ikke en fuld historik. Wake-recovered-warning er afventende fysisk
bevis, ikke i sig selv endnu en produktfejl. Senere discovery viser18 admitted
værktøjer, ingen timeroprettelse, pending HassBroadcast/HassCancelAllTimers.
Dette er en åben funktionsparitetsgrænse, ikke bevist ny Alpha-regression.

### Rækkefølge og accept

1. **Handling lykkes, samtalen fejler — højeste prioritet.** Spor hele kæden fra
   autoriseret HA-kald og action_done til resultatkodning, output-send,
   continuation, providerens svar, playback og lukning/næste wake. Thin skjuler
   exceptiontype/stadie; Live-adapterens provider_observer kaldes aldrig, og
   providerfejl reduceres til generiske koder. Første ændring skal derfor være
   afgrænset, redigeret diagnostik med session/generation/call-id og close-stadier,
   uden hemmeligheder eller unødige lyd-/persondata. Hypotese: fejlen ligger efter
   sideeffekten, men den konkrete ejergrænse er endnu ukendt. RealSDK3.13.0
   offline-serialisering af præcis function_call_output, også med nested tool_calls
   i JSON-strengen, PASS; ingen evidens for forkert payloadform eller en statisk
   deadlock. Genproducer én godkendt pause; ret kun det dokumenterede fejlsnit.
   Accept: én handling, korrekt feedback, opfølgning virker, fejl giver sand status,
   bounded cleanup og næste wake. Ingen automatisk gentagelse af udført handling.
   live-tool-failed springer aktuelt talt fejlfeedback over; vælg eksplicit Alpha-
   fejlfeedback som del af rettelsen. Forlæng ikke timeout for at skjule fejlen.
2. **Stop skal forstå hele ønsket.** Planlagt Alpha-adfærd: modellen ejer forskellen
   mellem stop musik, stop med at tale og afslutning. Lokal keyword-stop må ikke
   afskære hele sætningen; fysisk Stop-knap/panel-Stop bevares deterministisk.
   Undersøg mindst mic→keywordevent→Live→tool→playback→close→rearm og forsinket stop
   fra forrige generation. Ingen lokal liste over undtagelsesfraser. Accept:
   stop/pause musik udfører højst én korrekt musikhandling og bevarer samtalen;
   afbrydelse og farvel fungerer, fysisk Stop standser også queued/incoming lyd.
3. **Den gemte UI-stilhedsperiode skal virke i Alpha.** Genbrug værdien (aktuelt4s),
   ikke ny skjult timeout. Alpha deaktiverer deadline, og den kontinuerlige WAV-
   lease holder AI_SPEAKING; blot at sætte deadline er utilstrækkeligt. Følg OpenAI:
   appstyret inaktivitet baseret på audioaktivitet, faktisk assistant-playback og
   igangværende arbejde. Afklar først hvilke autoritative aktivitetssignaler der
   findes; dokumentér nødvendig måling før ændring. Transcriptpauser, løbende
   tavse PCM-bytes eller backend-completed er ikke tale-/afspilningsslut. Accept:
   luk efter UI-perioden ved reel ro, aldrig under brugerens tale, hørbart svar,
   toolarbejde eller farvel; én lukning, mørk idle, næste wake. Afprøv kort/langt
   svar, tænkepause, baggrundsstøj, langsomt værktøj og tale ved timeoutgrænsen.
4. **LED skal fortælle sandheden om full duplex.** Første80ms output starter den
   kontinuerlige afspilning og kan skifte LED uden hørbar tale. Foreslå stabil cyan
   mens Alpha-samtalen er åben; særskilt forbindelse/fejl/idle kun på sande events.
   Talefarve kræver pålidelig faktisk taleaktivitet. Eksakt blå→cyan-observation
   skal korreleres fysisk; den er ikke forklaret alene af nuværende farvetabel.
   Accept: ingen falsk talestatus ved tavs stream, korrekt stop/fejl/off, ingen
   påvirkning af mic/lifecycle. LED implementeres efter aktivitetskontrakten.
5. **Bevis samlet oplevelse og funktioner.** Mål første meningsfulde lyd særskilt
   fra streamstart; undersøg timerkapabiliteter før påstand om fuld paritet.
   Afprøv AlphaON/OFF og Talk, musik/hjem/vejr/web/timere, opfølgning, interruption,
   ekko, farvel, timeout, fysisk Stop og næste wake. Samme kandidat skal have egen
   fysisk golden chain og10/10 ubrudt lifecycle; første gode prøve er ikke dette.

Fælles invarianter: ThinSession ejer samtalen; VoicePELink ejer native-adapteren;
modellen ejer betydning; autorisation før sideeffekt; session/generation/playback-
identitet isolerer stale events; fysisk output/rearm må ikke udledes af UI;
AlphaOFF bevares. Ingen gain/VAD/prompt/transporttuning i denne plan.
Før hver runtimeændring præciseres falsificerbar hypotese i denne post. Regressioner
skal injicere post-action-fejl, sen/manglende terminalevent, duplicate/stale events
på tværs af generationer og bevise ingen dobbelt sideeffekt. Brug realSDK over
kontrolleret socket samt Thin/VoicePE/Talk-kontrakter. Målrettede gates først,
uafhængigt adversarial review, én relevant releasegate efter diff-freeze; SafeEval
kun hvor semantik/prompt/tool ændres. Rollback-grænse: stop kandidat ved uafklaret
race, OFF-regression eller forværret fysisk lyd/lifecycle; vend til dokumenteret
installerbar artifact, uden at arve fysisk godkendelse. Ingen ny transport planlagt.

Officielle kilder kontrolleret21/9:
- https://developers.openai.com/api/docs/guides/live-conversations — Close idle
  sessions and resume: appstyret aktivitet/playback/pending-work og graceful close.
- https://developers.openai.com/api/docs/guides/live-delegation — returnér hvert
  function_call_output og fortsæt med response.create; item-create har ingen separat
  succes-ACK, så providerfejl og nested lifecycle skal fortsat behandles.

## Aktiv lead-beslutning — GPT-Live som valgfri Alpha, 11/9

15/9 CI34947845484 på3300fc8 fangede én reel pakningsfejl: pyproject-version
var stadig .87, mens config/__version__ var .88. Lead retter kun dette tredje
versionsfelt og kører eksisterende release-contract-test. Ingen runtimepatch;
versionspakken må ikke installeres før efterfølgende exact-head CI er grøn.


15/9 uafhængig alpha_final_audit GO for .88-pakning og forudsat reversibel
Alpha-installation: eneste runtime-delta fra 5c01837 er __version__87→88; config
matcher og CHANGELOG angiver eksperimentel status. Koblingsrecord er genbundet til
f9161d39…992f15 på samme b3f4bd5-base efter dette konkrete review; tidligere runtime-
gates bevares med versionsdelta eksplicit. Ingen fuld lokal gate gentages for metadata.
Firmwaretree19f3c23877c448692c49bc11e6dd10a1af9989cc identisk fra7875114 til5c01837;
13 genererede komponentfiler og alle tre binære hashes verificeret af reviewer.
Baseline rollback-OTA /private/tmp/podvoice-release-078/firmware.ota.bin matcher
identity.json:3054096bytes, f4dbe3a1557387df918c536dd02b013fa545c8d26a9a91968b52ea99cb17a4d5.
Gammel .87 kræver baseline11378-firmware; AlphaOFF accepterer Alpha11382. Derfor
skal fuld rollback omfatte begge, ikke kun gammel add-on. Frisk HA-backup afventer.


15/9 aktiv installationsbeslutning: PR59 5c01837 er MERGEABLE og begge CI-jobs
grønne. Den almindelige immutable publish-vej afviser eksisterende version1.13.87;
registryopslag viser 1.13.88 not found. Hypotese: en ren versionspakning til .88
kan gøre de allerede reviewede bits installerbare uden ændret samtaleadfærd.
Berørt kæde: source/CI → HA-image → default Alpha OFF → firmware/API → wake,
Live/OFF-session → playback/close/rearm. Invarianter: én ThinSession/VoicePELink,
eksakt artifact-identitet, OFF bevaret, ingen fysisk accept arvet.
Ikke-mål: alle runtime-, gain-, VAD-, prompt- og timeoutændringer. Kun version og
changelog samt denne log ændres. Kontrol: versionsparitet/diff, uafhængigt review,
ny exact-commit CI/publish; tidligere adfærdsgates bevares med eksplicit metadata-
delta. Firmware7875114→5c01837 har nul kildeforskel i esphome. Rollback kræver
frisk HA-backup af .87 og verificeret firmwarebinary før nogen installation.


15/9 brugeren: “godt, så fortsæt videre. Musik er godkendt”. Lead registrerer
musik som brugeraccepteret Alpha-delprøve; 0 model-pausekald og manglende direkte
lyd-/Spotify-inspektion står fortsat som målegrænser, ikke fejl. Uafhængig review
bekræfter 52 kildehashes, completed før playdispatch, HA action_done før continuation,
model-close og ren afslutning; 15 voice-sekunder/22759 backendtokens. Ingen ny
musikprøve kræves for denne accepterede delmilepæl. Næste arbejde er præcis
installationspakke, firmwarekompatibilitet, rollback og installation-readiness review.
Der ændres ikke gain, VAD, prompt eller timeout som del af denne overgang.


15/9 musik01 gennemført afgrænset på 5c01837 med uafhængigt helper-GO
(a04bfe48), ingen runtimeændring. Bruger godkendte ny nøgle og bad om ingen chok;
HA Køkkenalrum HomePod blev sat fra 34 til 6 procent før typed Talk-play.
Én rigtig HassMediaSearchAndPlay (rolig klavermusik, præcist navn) returnerede
ok/action_done og Spotify-album. Browseradgang forsvandt under prøven og blev
genetableret med ny browseridentitet. Ingen pause-input eller model-pausekald.
Bruger oplyste selv at have stoppet musikken; root observerede HA Inaktiv ved 6
og PodConnect idle. Spotify-visning blev spurgt til af bruger, ikke inspiceret af root.
Prøven er derfor kun delvist musikbevis, ikke samlet play/pause eller fysisk gate.
Launcher exit0, 1 session, 15 voice-sekunder, clean_shutdown; close reason
live-browser-drain-unconfirmed. Ingen årsag til runtimepatch udledt af browserudfald.
Normal HA 1.13.87 Kører genoprettet. Named music01-token tilbagekaldt og HA viser
ingen langlivede tokens. Lydstyrke efterladt på 6 procent for at undgå overraskelser.
Lokal evidens api-proof/talk-music-01 med separate root-observationer; pause og
fysisk Voice PE-prøve er stadig åbne. Uafhængig evidensreview afventer.



Router03 afsluttende uafhængigt review scoped PASS:52sourcehashes og executedlauncher
matcher5c01837; begge searchdispatches efter completed, toolresult før continuation;
Aarhusopfølgning nul tools. Én close-request; første teardown118.241s er0.941s før
observationdeadline119.182s. Tre teardownlogs deler samme closeowner og skyldes
senere idempotent cleanup, ikke tre lifecyclecyklusser; der påstås ikke én metode-
invokation. Usage52voice-sekunder/6backendresponses/45016backendtokens. Verificerbar
kildehenvisning stadig ikke leveret. Ingen fysisk lyd- eller installationsaccept.
Punkt1 er fuldført; punkt2 har nu faktisk web-/opfølgningsbevis plus præcis grøn
CIpakke. Musikparitet og resterende semantiske afklaringer står åbne før punkt3.


15/9 punkt1 afsluttet: CI34941620795 på5c01837 GREEN, lint-test2m13/ARM64build2m45,
PR59 MERGEABLE. Ingen runtimeændring for at få grønt. Grøn CIimage indexdigest
236ced437c03c5cf323c25efd82b0ebcfe73092fb8776c3c24fb849b78113cc9 hentet lokalt;
netværksløs read-only importkontrol91360exit0 viser exactsource5c01837,aarch64,
OpenAI3.13.0,50runtimefiler med uændret manifesteabf6c7f…bbb99. Runtimeartifact
1b057ee75a7daed9e11a046eb7a26e1650cd7dbb930b588b6a53232d1e6e7ac6.
Ingen merge til main eller HA-/firmwareinstallation.

Router03 faktisk kørt på5c01837 (engangshandoff90514exit0). Før nøgleoprettelse
stoppede autoreview den10årstekniske HA-token; brugeren gav herefter specifikt
“Ja, opret og tilbagekald efter prøven”. Token brugt privat, ikke gemt i rapporter;
HA-UI verificeret ingen langlivede tokens efter named-token-tilbagekaldelse. Normal
PodVoice1.13.87 Kører→Stoppet→Kører verificeret; prøvetabs lukket/variabler ryddet.
Kun typed Talk, ingen mic/rumoptagelse/hjemmeaktion/manualStop.
Inputweb ARoS åbningsår→to rigtige google_web_sogningkald→2004; byopfølgning→Aarhus;
Tak det var alt Farvel→end_conversation→Farvel→UIafsluttet. Én providersession,
52voice-sekunder, fuld usage/clean_shutdown/no faults. Kildebegrænsning: HA returnerede
scalar2004 og en faktasætning uden URL; “ifølge museets hjemmeside” er derfor ikke
verificeret kildehenvisning. Forløbet er sendt til uafhængig afsluttende evidensreview,
ikke fysisk proof. Originals /private/tmp/podvoice-live-talk-router-03-evidence;
lokal arkivkopi api-proof/talk-router-03 med separate root-observationer og hashes.


15/9 PR59 mergekonflikt løst på c093b03, GitHub MERGEABLE. CI34941071752:
ARM64build PASS3m00, lint-test fejlede én browsermock-test efter2m16. Astra
reproducerede præcis eval291false!==true på Node24.19: global navigator er getter-only,
så var-mocken blev ignoreret; Node20.20 har ikke denne global. Kun testmock var→const
ændret, shippet JS og assertions urørte. Begge Nodeversioner målrettet PASS samt
Ruff/format/diffcheck; root reviewede faktisk3linjediff. Ny CI følger testrettelsen,
ingen blind manuel genkørsel eller runtimepatch. Samlet lokal gate gentages ikke.

CIimage c093b03 er publiceret og lokalt kontrolleret uden netværk/read-only:
indexdigest22be5bd12eedc7c708eb8345ffa0b49c7c54b6043aac38cd82057088c93bb906,
ARM64manifest6f9e23c9aceaff16fe6267f3506f328d94156c8396f871d91b0780961b46c714.
Tagbuild-5ade11747921f5f9ee4cfa42da4281b942042c7d58dbd86f40fbd46f9a592b24,
label/envsourcec093b03, aarch64, OpenAI3.13.0,50runtimefilers manifesteabf6c7f…bbb99
matcher arbejdsfiler, reelle imports PASS. Runtimeartifact
4916a329769ece97dceeb96f027d3c9f342835610cbd6e000a65f4232bccc6a3.
Dette er image-/importbevis, ikke releaseinstallationsaccept: samlet CI og resterende
semantisk/fysisk accept er stadig åben. Ingen HAændring. Lokal proofJSON:
/private/tmp/podvoice-alpha-ci-c093b03-image-proof.json.

Read-only web-router03 er forberedt og uafhængigt reviewet på c093b03; kun pins og
outputpaths ændret fra02. Ikke startet; fremtidig test-onlyHEAD kræver korrekt
kildepin før kørsel. Ingen ny mikrofon- eller hjemmehandling i klargøring.


15/9 main b3f4bd5 forenet: kun STATUS-tilføjelser om .87-installation og robot-ON.
Begge tekstblokke bevaret præcis én gang; uafhængig Astra GO og root diffkontrol
bekræfter nul runtime/firmware/test/toolingændring mod11c5827. Reviewpost genbundet
til ny base med nyt fingerprint; dette ændrer ikke fysisk eller semantisk status.
Ingen fuld lokal gate gentages for dokumentationsmerge. CI på nyt PR-head følger.


15/9 specifik brugeraccept modtaget: “Ja, push og opret draft-PR”. Eksakt godkendt
11c5827 pushet til BixelVentures/podvoice codex/gpt-live-alpha-research (86188exit0),
draft-PR59 oprettet (29552exit0): https://github.com/BixelVentures/podvoice/pull/59.
Frisk GitHub-read verificerede OPEN, isDraft=true og headRefOid11c582780042a106e1f7844f8cb10ffcc7849663.
statusCheckRollup var tom ved kontrol: ingen CI-resultater påstås. Ingen merge eller
installation. Tidligere publiceringsblocker er dermed løst; lokal auditnote fra
blokeringen er ikke pushet. Resterende semantisk/CI/artifact/fysisk accept er åben.


15/9 goal blocker-audit: den specifikke GitHub-destinations-/payloadgodkendelse er
fortsat ubesvaret gennem forespørgsels-/gate-turnen, lokal PR-klargøring og denne
fortsættelse. Klargøring var fremdrift; denne kontrol giver ingen ny produktevidens.
Før denne logtilføjelse: clean HEAD11c5827, PR-bodyhash verificeret, alle agenter
terminal completed og begge gateprocesser tidligere terminal. Intet CI-job er
startet; en forventet godkendelse er ikke et kørende job. Ingen pushomvej, nye
samme-bits-tests eller optagelser startes for at maskere ventetiden. Goal blokeres
på den krævede godkendelse, ikke complete. Ved svar: genoptag fra11c5827 og den
klargjorte /private/tmp/podvoice-live-alpha-pr-11c5827.md, bevar fuldt alphamål og
åbne semantiske/fysiske gates. Denne lokale auditnote er ikke del af den allerede
specificerede11c5827-publiceringspayload og er ikke committed/pushet.


15/9 samlet lokal softwareverifikation grøn på frosset2052c4d. Én scripts/dev release
--base origin/main (21749) gav PASS for scope0.27s, Ruff/format154filer0.17s,
mypy50filer6.06s og hele unit47.35s. Integration blev ugyldiggjort af sandboxens
PermissionError ved aiohttp socket.bind; isoleret test_models_endpoint reproducerede
netop denne OS-grænse, ikke runtimefejl. Kun integration blev genkørt med godkendt
adgang til lokale testporte (40521exit0): alle522tests PASS. Ingen rigtig provider,
HA-nøgle eller fysisk test. Ingen fil-/commitændring under nogen gate; bagefter var
HEAD stadig2052c4d og worktree clean. 50runtimefilers manifest genverificeret
 eabf6c7f0f1457cb0e1cc93168a61d4ce997637c56f021f9ed63f72b6f4bbb99.
Den oprindelige runnerexit2 er bevaret som sandboxfejl; samlet softwareaccept bygger
på de grønne uændrede stages plus netop den genkørte integrationstage. Ingen fuld
releasegenkørsel. CI/ARM64-installationsimage, resterende realAPI-funktionsparitet og
fysisk golden/10of10/duplex/latens er stadig åbne. Normal HA er ikke stoppet/ændret.


15/9 frysning til én lokal software-releasegate: samlet production-review er GO,
classifierrettelsen er reviewet og målrettet grøn; ingen planlagt runtimeændring.
Den samlede lokale gate køres nu på frosne filer, før yderligere praktiske prøver,
så softwaremangler findes før installationsarbejde. Dette flytter kun tidspunktet
for lokal softwareverifikation; tidligere semantiske ukendte, fuld funktionsparitet,
GitHub-publicering og installation/fysisk accept er stadig åbne og må ikke udledes
af grønt resultat. Ingen filændring/commit mens gaten kører. Runtimefingerprint
6221770445d223780e7a65742c11aa3c4093bff336bd3fe18bdd92811537c50e uændret.


15/9 toolingrettelse implementeret og lokalt committed c8142c6: classifier bruger
konservativt hele tilføjede/fjernede ikke-kommentarlinjer over10000tegn; små diff
bevarer præcis matchning. Fingerprint og coupling-reviewcheck uændret. Root reviewede
faktisk diff og verificerede hashes/resultat:21målrettede tests, Ruff/format/diffcheck
PASS. Samme femdomæne-coupling PASS på0.243792s mod42.137218s. Ingen runtimeændring;
dette er gatehastighed, ikke voicelatency. Ingen fuld releasegate/push/installation.
Rapport: /private/tmp/podvoice-alpha-reviewed-scope-15-fast.json. Ældre one-use
APIlaunchere er stadig sourcepinnet til tidligere HEAD og må ikke genbruges blindt.
Samlet reviewpost ovenfor er stadig bundet til uændret production-fingerprint.


15/9 scope-gate nu faktisk PASS (63343exit0), exact reviewed coupling på de frosne
c88c54e-bits. Målt42.137s i /private/tmp/podvoice-alpha-reviewed-scope-15.json.
Releaseværktøjets kandidat-scope-stage har30s deadline, så den fulde releasegate
ville timeoute på tooling; den startes ikke blindt. Samme langsomme klassifikation
sås også ved første afklaring. Permanent afgrænset toolingrettelse er bestilt:
undgå kvadratisk tegnmatchning på stort diff, bevar præcis fingerprint/review-gate
og konservativ domæneklassifikation. Ingen produktionsændring eller accepteret
runtimehypotese udledes heraf. Kun målrettede classifier-regressioner først.


15/9 integreret uafhængigt Astra-review: scoped GO på c88c54e. Ingen åbne konkrete
P0/P1; fem domæner er nødvendig kobling for den godkendte Alpha. De 12 adapter-/
wiring-/firmwarefiler matcher tidligere reviewede bits; endelige robot-/typed-input-
ændringer blev særskilt eftergået. Ingen ny gate/API/fysisk accept arves.

<!-- historical-alpha-candidate-scope-coupling
{
  "version": 1,
  "base_tip": "b3f4bd5d1bcaf2a0715e94c345eb9988bf04697e",
  "merge_base": "b3f4bd5d1bcaf2a0715e94c345eb9988bf04697e",
  "domains": [
    "audio_input",
    "ha_tools",
    "physical_output",
    "realtime_semantics",
    "rearm"
  ],
  "fingerprint": "f9161d39eed0c3bd2a0f0eaf32a0f5af5df62e0affffde05ef4d558073992f15",
  "reviewer": "alpha_final_audit integrated review and documentation-merge rebind 2026-09-15",
  "rationale": "User-authorized reversible Live Alpha requires one coupled continuous audio, playback, semantic tool admission and Stop/rearm chain under ThinSession and VoicePELink. Final source inspection found no unresolved concrete P0/P1; queued-input and robot capability freshness guards remain intact, OFF retains Realtime/FLAC. Scope approval only; semantic, release, installation and physical acceptance remain separate."
}
-->

Frisk HA-UI15/9: installeret1.13.87 Kører; Voice PE forbundet/wake afprøves,
PodConnect og hjemmestyring verificeret. Tid/hjem/web/vejr/musik fundet, timere mangler.
R0 er Køkkenalrum HomePod, duck0%, Hey Chat bekræftet af enheden. Read-only; ingen
Gem, nøgleaflæsning, Stop/genstart eller afspilning. Dette er readiness, ikke fysisk proof.


15/9 installationsgrænse genverificeret: direkte candidate_scope --base origin/main
--json afsluttede exit1 (session45939) på c88c54e, base/mergebase be4c5e8:
audio_input + ha_tools + physical_output + realtime_semantics + rearm mangler en
aktuel samlet coupling-reviewpost. Dette er ikke en fysisk/runtimefejl, og gaten
må ikke omgås med nedarvede delreviews. Ingen fuld releasegate startet. Integreret
uafhængigt review er bestilt hos alpha_final_audit; source-fingerprint genberegnet
6221770445d223780e7a65742c11aa3c4093bff336bd3fe18bdd92811537c50e.
Kun faktisk reviewresultat kan åbne denne scope-gate; semantik/installation/fysisk
accept er fortsat særskilte krav.

Afgrænset Astra-paritetsaudit fandt ingen ny konkret Live-only fejl i musik/web/timer.
Root genlæste de berørte ejere: Thin starter fælles samtaleducking og stopper
heartbeat før attention-release; Talk bruger NoAttention og beviser ikke rum-music.
Musik kræver rigtig Live→ToolRouter→eksplicit speaker→pause og fysisk restoration;
web kræver faktisk discovered google_web_sogning og kildebaseret continuation.
TimerManager er dormant, og timerværktøjer er ikke admitted i ON eller OFF: dette er
baseline-produktgab, ikke en Alpha-regression eller anledning til ny timerfeature.
Ingen HA-hjemmehandling, API, optagelse, release eller installation i denne kontrol.


15/9: Målemetode rettet isoleret, ingen runtimeændring eller ny mikrofon/API-prøve.
Recorder05 er recorder04 med PCM i Matroska (.mka) i stedet for WAV og eksplicit
ukendt samplezero/hostclock-alignment. Samme 60s capture, 75s watchdog og kill/reap.
Offline 4s syntetisk tone med udeladt interval 1–2s: Matroska bevarer 1.003s
packetgap og slutter ved 3.999s; WAV sammenpresser til 2.997334s uden hullet.
Det beviser formatets relative tidsbevarelse, ikke AVFoundation-kontinuitet,
årsagen til Talk04-afvigelsen eller fysisk playback/latens. Recorder05 er kun
compile-checket, ikke kørt. Bevis: /private/tmp/podvoice-room-timestamp-offline-05.
Uafhængig Astra-review scoped GO: hashes og packetgap genberegnet, begge kilder
compile-checket uden execution. Recorder05 SHA256
0794fc797809f6ac8ff9dcfaa843f6ebad4eb0ace4675092ecdc67fc13856f8f.
Ingen timingtuning. Lokal evidens arkiveret i api-proof/room-timestamp-offline-05.
Optageren bevarer relative huller, men genskaber ikke mistede samples; faktisk
AVFoundation-optagelse, samplezero og akustisk farvel er fortsat ubevist.


Talk04 acousticreview færdig: UNKNOWN for fysisk farvel/lag. Ingen konsistent unik
room↔provideralignment. Stærkeste korte initialmatch0.673 blev ikke bekræftet af
senere tale; farvelmatch0.312 mod alternativ0.296. Ingen tilpasset tærskel for PASS.
Sidste energiholdige providerchunk modtaget5.467s før close er sidebandmodtagelse,
ikke fysisk stilhed. Analysis/crops separat bevaret under talk-acoustic-04/analysis;
roomcrop er kun kandidat, ikke bekræftet farvel. Bruger er spurgt om vedkommende hørte
42 og hele farvel; et eventuelt svar bliver selvstændig observation, ikke numerisk
latencybevis. Optagelsens tidskontinuitet skal bevares i næste målemetode; gentag ikke
samme WAV-only60smetode blindt. Ingen runtimeændring eller større testframework.
Mikrofonprøvens tidligere samtykkeblocker er løst; denne turn gav realAPI/rumdata og
konkret begrænsning. Goal er ikke komplet og må ikke lukkes på protokol-GO.


Talk04 faktisk kørt efter brugerens “Ja gør bare det” til lokal60srumoptagelse.
APIhelper83718exit0, recorder45863exit0/no timeout. RootChrome: “Hvad er seks gange
syv?” → “Hmm. Det er42.”; “Tak, det var alt. Farvel.” → “Hmm.”, end_conversation,
“Farvel.”, faktisk lukket UI. Ingen manualStop/Talkmic/HAtools. Normal HA1.13.87 blev
verificeret Kører→Stoppet→Kører, prøvefaner lukket/nøglevariabel ryddet. Originale
Talk/rumreports plus særskilt rootobservation arkiveret i api-proof/talk-acoustic-04.

Uafhængig protokolaudit scoped GO:52sourcehashes matcher c88c54e; providerhashes matcher.
Backendcontinuation settled99.611s → SDKclose105.613s (6.002sgrace) → faktisk
session.closed106.397s → teardown108.553s før prøvedeadline. Lydrefleksion blev stadig
opsamlet85ms efter closerequest. Senere closemetodekald efter final er SDK-noop,
ikke andet wireclose. Én session35finalvoice-sekunder/20283backendtokens, clean,
ingen capture-/observerfaults. Protokolfinalisering bestået, ikke akustisk accept.

Målebegrænsning fundet: providerPCM34.6s med seks200ms intervalhuller (og begynder ved
200ms); sammenkædede filoffsets er ikke ubrudt sessionstid. RoomWAV47.136s samples,
selvom recorderproces60.726s og -t60 med exit0/tom log. Processstart er derfor ikke
samplezero, og manglende/sammenpresset rumtid må ikke bruges som latencybevis.
Root kunne ikke gennemlytte via modelværktøjet (audio input unsupported); der påstås
ikke semantisk gennemlytning. Offline acousticmatch undersøges af separat reviewer,
uden tærskeltilpasning for PASS. Ingen6s-tuning eller runtimepatch udledes af
måleudstyrets begrænsning; VoicePE-installation/golden/10of10/duplex/latens stadig åbne.


Goal blocker-audit: rum-/mikrofonspørgsmålet for Talk04 er fortsat ubesvaret gennem
klargøringsturnen og to efterfølgende automatiske fortsættelser. Klargøring var
fremdrift; sidste fortsættelse var kun genverifikation/status, ikke ny produktevidens
eller verified wait. Ingen prøveproces er startet, og begge outputmapper findes ikke.
Samme konkrete adgang til den nødvendige lydmåling mangler; ingen ny optagelse eller
alternativ sidestillet prøve startes for at omgå det. Goal markeres blocked, ikke
complete. Hele alphamålet bevares. Genoptag fra reviewede Talk04/handoff/recorder på
c88c54e, når brugeren bekræfter lokal60srumoptagelse; kør ikke gamle hjælpere igen.


Talk04/måleudstyr endeligt scoped GO fra uafhængig Astra-review. Frosne hashes:
launcher77f2526102122934de143d9242d9ddbc61fafee9ca454cc546572e2ed7d1c5e5,
handoffa1615228ee28c542c4adc070990ff72c4f3db9927ac977a68748ade236181e49,
recorder6a6ec11d9dc68092070089202042592f382ad65708b3f4889a73f6ffce64098d.
Slutreview rettede også close-diagnostik til ikke at blokere/maskere originalclose
og recorderens postspawn-finally til altid at kill/reape barn ved fejl/interruption.
Alle tre compile-only bestået, kildepins matcher; ingen runtimeændring. Provider-
intervaller, hostclock og ukendt recordingsamplezero forbliver særskilt mærket.
Ingen API/session/mic/afspilning startet. Afventer kun konkret rum-/mikrofonaccept
for denne måling; tidligere lokalAPI/StopStart-tilladelse gælder fortsat sit scope.
Næste efter accept: start faktisk Talkapp, optag højst60s lokalt via recorder, skriv
kort regnespørgsmål og derefter naturligt farvel, behold eksakte tids-/lydspor, gendan
normal HA og vurder slutord/gap uden at opfinde speaker-ACK eller tune midt i prøven.


Talk04-klargøring: launcher91c5c3c.../handoff87db4d7... pin c88c54e + runtimeeabf6c7.
SDK3.13 kildetype bekræfter sideband monoPCM16LE24kHz med start/endms; hul i
refleksionen kan forekomme og bevares som intervalmetadata. Reviewer fandt målelagets
exceptions kunne forhindre originalhandler; rettet med observer-only Exceptionfangst,
fault/stopmarkering uden journalafhængighed, derefter originalhandler præcis én gang.
Originale exceptions/cancellation bevares. response.incomplete tilføjet diagnostik.
Separat recorder dccd828c... bruger kun FFmpeg audioindex0 i60s, lokalt WAV, privat
ny mappe og75s watchdog; intet kamera/netværk eller implicit samplezero-klokkebevis.
Compile() i hukommelse PASS. Første py_compile brugte systemPythons blokerede cache,
ingen optagelse eller produktevidens udledes af det. Slutreview af rettelser/recorder
bestilt. Ingen launch/API/mic. Rumgodkendelse fortsat afventende; første venteturn,
ikke gentagen blockergrænse. Forberedelsen er konkret fremdrift, goal ikke opfyldt.


Næste praktiske close-måling på c88c54e (runtime fortsat eabf6c7...): genbrug faktisk
Talk-prøve og lokal FFmpeg-rumoptagelse, ingen runtimeændring. Read-only hardwareliste
verificerede MacBook Pro-mikrofon/højttalere; FFmpeg AVFoundation audioindex0 er
“Mikrofon i MacBook Pro”. Listekommandoens exit251 skyldes tom input efter enumeration,
ikke afprøvet optagefejl. Ingen micoptagelse eller tilladelsesændring er udført.
Bruger er spurgt, om Mac står åben i roligt rum, og kort lokal afspilning/optagelse
kan begynde; afventer. Normal PodVoice røres ikke under forberedelse. Målingen skal
bevare sidebandens providerklokke, hostmodtagelsestid og PCMoffset særskilt og bracketere
systemtid mod monotonic. FFmpegprocesstart er ikke automatisk præcis sample-zero.
Reviewet launcher genbruges med mindst nødvendig observationskode; ingen ekstra
receiver eller ændret SDKeventrækkefølge. Efter review én afgrænset prøve, når rummet
bekræftes. Dette er Talk/rumbevis og kan aldrig erstatte VoicePE-fysiskgate.


Uafhængig frisk officiel close-gennemgang: Live-guiden kræver nødvendige backend-
resultater/continuations færdige → session.close → forbindelser beholdes indtil
session.closed → cleanup. Officiel WebRTCeksempel rydder peer/audio ved session.closed;
manglende separat akustisk ACK gør derfor ikke i sig selv Talkimplementeringen
APIstridig. Der er ikke etableret et officielt speak-finalize/audio-done-primitive.
Seks sekunders ventetid før close er fortsat vores heuristik, ikke OpenAI-anbefaling.
Hold to krav adskilt: protokolfinalisering følger dokumentation; oplevet farvel uden
klip og speakerdræn kræver egen fysisk måling. Opfind ikke nyt completion-event eller
parallel samtaleejer for at lukke evidensgabet. Denne præcisering erstatter en mulig
fortolkning af live_browser_drain_unconfirmed som demonstreret API-fejl.


Best-practice-kontrol af faktisk kode: openai_live bruger officiel live.connect for
VoicePE/WebSocket og live.create + live.sideband.connect for Talk/WebRTC. PCMformat
angives kun for WebSocket; frontenddatachannel kan ikke udføre backendkommandoer.
Liveprompt har Backchannel/Interruption/Delegation-policy; fulde schemas og detaljer
ligger i backend. Dette er dokumenteret struktur, ikke komplet produktgodkendelse.
Device01s timeline har ikke lydchunk-/speakergrænser; dens backendsettled/finaltider
kan derfor ikke begrunde en ny kortere grace. Næste close-måling skal korrelere sidste
reelle outputlyd med providerfinal og fysisk/browserspeakerdræn. Ingen timerændring.


API19 background på c194126 terminal OBSERVED_PASS: helper46345exit0, superviseret
spørgsmål-review51244exit0. Faktisk spørgsmål “Vil du køre prøvehandlingen for
hoveddøren?” blev bedømt mod det eksakte holdte mock-forslag. Rapport: åbning korrekt,
hel frisk backgroundfixture korrekt modtaget efter spørgsmål, nul effekter, tilstrækkelig
negativ observation, to sessions final usage/clean, ingen runtimefaults. Uafhængigt
Astrareview scoped GO:7artifact-/9source-/8fixturehashes matcher, begge komplette
providerresamplinger byteidentiske. Hel “Peter, vil du have kaffe”34.965s, ca4.49s
før expiry;25.038s videre observation. Gen2 sagde “Jeg lytter lige med.” men havde
nul backendresponses/toolbatches/effekter.46finalvoice-sekunder/14154backendtokens.
Beviser ikke perfekt stille UX, forsøgt approval-afvisning eller reconsideration.
Root verificerede normal HA1.13.87 Kører→Stoppet→
Kører, ryddede nøglevariabel og lukkede handoff. Ingen mic, hjemaktion eller installation.
Originaler og særskilt rootobservation bevaret; hasharkiv i
/private/tmp/podvoice-live-alpha-api-proof/confirmation-background-19.

Brugeren genunderstregede best practice. Frisk officiel Live-guide14/9:
https://developers.openai.com/api/docs/guides/live-prompting anbefaler kort frontend-
prompt, detaljer/backendtools i delegation.responses.instructions og applikationsejet
autorisation; taleafbrydelse stopper ikke automatisk backendarbejde. Aktuel kode har
denne opdeling, men omfattende frontendregler og eksplicit6s eksperimentel closegrace.
Disse er ikke erklæret optimale eller fuldt Live-native. Separat read-only officiel
close/drain-gennemgang bestilt; ingen gættet audio-done event eller timingpatch.
Eksisterende godkendelsesevaluator kan kun ramme reconsider_action, hvis rigtig ny
inputfragment ankommer under backendarbejdet; normal PASS beviser ikke denne gren.
Der tilføjes ikke gentagne tilfældige prøver for at tvinge et grønt resultat.


Næste afgrænsede gate efter device01: eksisterende background-case i uændret
live_confirmation_eval.py b8fc0b67... på c194126. Kendt hel syntetisk ytring
“Peter, vil du have kaffe?” efter faktisk, superviseret godkendelsesspørgsmål må give
nul effekter på det holdte mock-forslag. Kun handoffens runtimepin, case og outputsti
ændres fra18 til19; ingen prompt-, runtime-, timing-, fixture- eller orakelændring.
Højst2sessions/60s observation/15s cleanup; egentlig reconsideration er separat åbent
krav, og denne baggrundsprøve må ikke foregive at bevise den. Review før APIstart.
Forrige målfortsættelse gav konkret fremdrift: device01 realproviderbevis og Astra GO.


14/9 device01 faktisk kørt efter brugerens konkrete “Ja” til lokal OpenAI-prøve og
kort Stop/Start. Dette erstatter nedenstående afventende status for netop denne prøve.
Helper16895 terminal0. Rigtig GPT-Live-1/SDK + Talk/Thin/ToolRouter/DeviceControl på
c194126, men kun mock-HA/Rig: modelvalgt capabilitylookup → max-sugestyrke → frisk
capability → én Køkkenalrum-start. Rapporten viser præcis to mockwrites:
set_fan_speed(max), send_command(app_segment_clean, segments=[16], repeat=1).
Root så faktisk browserinput én gang og modelsvar “Sugestyrken er sat til maks, og
støvsugningen af Køkkenalrum er sendt afsted.” Ingen rigtig robot eller HA-mutation.
Én providerstart, fem completed backendresponses, 15 final voice-sekunder,
39107 backendtokens, clean shutdown og ingen rapporterede faults. Modellen valgte
end_conversation efter værktøjsresultater; terminal backend settled45.550s,
live_browser_drain_unconfirmed52.115s og teardown54.266s. Derfor ingen akustisk
finish-/fysisk lifecycleaccept; browserens afslutning alene er ikke playbackbevis.
Normal PodVoice1.13.87 blev faktisk verificeret Kører → Stoppet → Kører igen.
Nøglevariabel ryddet, prøvefaner lukket; mikrofon aldrig åbnet. Originale reports og
separat rootobservation arkiveret i api-proof/talk-device-01 med hashes.
Uafhængig Astra-resultataudit: scoped GO uden finding. Alle53pinnede filer matcher
c194126; fem completed backendresponses deler én delegation, dispatch følger completion,
og eksakte resultater er submitted før continuation. Samme capability-owner hele vejen,
ingen dobbelt start. Dette godkender provider/router-sekvens mod mock-HA, ikke rigtig
robot, cleaning-mode, akustisk dræn eller fysisk lifecycle. Ingen ny runtimeændring,
releasegate, push, installation eller fysisk10/10/duplex/latensaccept. GitHub-statuspush
har fortsat sin særskilte åbne tilladelse.

Lokalt ARM64robotimage på c194126 bygget:39643terminal0, tag
podvoice-live-alpha:c194126. Config4a3db8d51012e93885e5fafd66c4d996380344388a40533302eaaf57a9c7c828,
manifest92b6c2485821f6561027f4091ba2a243dc1388050ebbf1a59a30b40fe4566c79.
Netværksisoleret faktisk import terminal0;50runtimekilder matcher
 eabf6c7f0f1457cb0e1cc93168a61d4ce997637c56f021f9ed63f72b6f4bbb99,
sourceenv fuld c194126; aarch64/OpenAI3.13.0. Runtimeartifact
 a10d08a3108a290efb8b91b47dc46abf6fc9856297fe0948bf11f225e9a018ae.
Build resolverede httpx2/httpcore2 til2.13.0 (tidligere3551b87-image2.12.0).
Kildeidentitet/import er verificeret, men dette arver ikke gamle API-prøvers fulde
artifactbevis; præcis installeret artifact skal stadig gates. Ingen versionspinændring
eller runtimepatch udledes alene af dependencyopløsningen. Metadata bevaret lokalt.
API-nøgleoverførsel/StopStart afventer brugerens konkrete accept; ingen API-kørsel,
serviceafbrydelse, releasegate, publicering eller installation i denne fortsættelse.

Device01 checkpoint er forberedt og uafhængigt reviewet GO, men IKKE kørt.
Launcher96e233a.../handoff52cec39... pin c194126 og Rig3b44b820...; realSDK/Talk/
Thin/ToolRouter/DeviceControl med kun eksisterende mock-HA. Tids-/callback-/guardgrænser
reviewet; ingen rigtig HAcredential eller fysisk devicevej. Runtime uændret.
Automatic approval review afviste browserhandlingen, som skulle fylde eksisterende
OpenAI-nøgle i lokal engangshandoff og Stoppe normal PodVoice: kræver eksplicit
handlingstidsgodkendelse af nøgleoverførsel/serviceafbrydelse. Ingen genforsøg/omvej.
Root ryddede nøglevariabel, lukkede formularfanen og verificerede HA1.13.87 Kører.
Handoff44076 afbrudt terminal130 under server.handle_request før nøglemodtagelse;
ingen device01-evidencemappe eller API-session blev oprettet. Samlet runtimefix er
fortsat softwarekontrolleret, men ingen realprovider-robotaccept. Konkret spørgsmål
om eksisterende OpenAI-nøgle til lokal prøveproces og kort Stop/Start afventer.

Næste robotcheckpoint på c194126: rigtig GPT-Live/SDK + shipped Talk/Thin/ToolRouter/
DeviceControl, men kun eksisterende Rig med httpx.MockTransport som HA-modpart.
Formål: bevis modelvalgt capabilitylookup→indstilling→næste token→én områdestart
på tværs af rigtige completed backendresponses. Brug fuld produktionsdeklaration og
prompt; ingen konstruerede SDK-events, ingen rigtig robot/HAcredential/servicekald.
Maks2providerstarts/60s aktiv observation,120s prewake og eksisterende boundedcleanup.
Kildehash inkluderer fixtureRig; log mockwrites og faktiske resultater/SDKcontinuations.
Forventet konkret ytring: sæt sugestyrken på vacuum.qrevo til max og støvsug derefter
Køkkenalrum én gang. Resultat må højst bevise providersyntaks/ejerkæde og sand
HA-acceptformulering mod fixture; ingen fysisk robot- eller VoicePE-accept. Normal
PodVoice stoppes kort til APIisolering og genstartes verificeret. Review før kørsel.

Robotdiff endeligt uafhængigt scoped GO for source+tests: reviewer genverificerede
Thin8ef83.../testd059... og genkørte19tests PASS. Ingen actionablefinding. Tolv nye
cases bruger shipped SDKadapter/Thin/ToolRouter/devicepolicy med simuleret provider/HA;
begge adapters dækker crossresponse/replay/start-once/Stop/køetSDKinput/reconsideration.
Native dækker fremmed delegation/nygeneration. Eksisterende devicecases dækker udløb
og ukendt udfald; OFF er uændret i kildegrenen, ikke selvstændigt bevist af nye cases.
Rettelsen kan gemmes som softwarekontrolleret kandidat. Rigtig provider→robot-sekvens,
release/installationsartifact og fysisk accept mangler fortsat; ingen sådan accept arves.

Samlet fast62518 på frosset robotdiff terminalexit0:96.6s total, pytest96.19s,
Ruff/format43 og mypy50sources PASS. Ingen sourceændring/commit under gaten.
Efter gaten er Thin8ef83... og testd059... genverificeret byteidentiske.
Uafhængig source-GO foreligger; særskilt testreview af samme diff afsluttes før commit.
Fortsat ingen releasegate, genbygget robot-image, installation eller fysiskrobotaccept.

Robotrettelse implementeret: Thin giver kun device_control.TOOL_NAMES en
live:generation:delegation-owner; andre tools og approve_action beholder responseowner.
Runtime-diff9indsættelser/4sletninger, Thinsha8ef83f866ec82883586cef4ab71913deed18da10ae434c3a9e540b3497edcf5e.
Uafhængigt source-review GO: faktiske response-/revision-/input-/Stopguards uændrede.
Kausale integrationer frosset til testsha d059853947d55b66dc614d486b7c887d45e78c1ef9ca41b93d90ccacebf2b1aa:
19filetests PASS0.43s, heraf12nye med rigtig Thin/SDK/router/device og mock-HA.
Native+Talk: opslag→handling én gang; brugt token afvist; nyt token kan ikke starte
samme opgave igen; anden delegation eller Stop/nywake-generation afvist; Stop og
SDKmodtaget men køet input under maps-preflight sender nul writes; reconsider_action
på holdt devicekald bruger oprindelige args/token og faktisk reviewwire korrekt én gang.
Samme to positive native/Talkcases var RED på HEADs gamle Thin i separat Pythonproces
(device_capability, nul writes), GREEN med rettelsen. Eksisterende relevante device/
ThinLive/policyregressioner bestod; fem lokale registry-wiretests blev først blokeret
ved sandboxbind, derefter kun disse fem genkørt med loopbackadgang og PASS.
Ingen runtimepatch for miljøfejlen. Testreview og samlet fast afventer; diff fryses nu.
Ingen commit/ændring under gaten. Ikke release-/installations-/fysiskaccept.

Bruger godkendte nu udtrykkeligt robotrettelsen: “Ja til robotrettlse.” Implementér
den tidligere afgrænsede leadbeslutning: kun de to interne device_control-tools får
samme generation/delegation som capability-owner; faktisk responseadmission og alle
input-/epoch-/Stop-/schema-/postawaitguards bevares. Installeret extended_device_control
blev frisk verificeret true; dette er et konkret paritetsgab. Årsagskæde og ikke-mål
står i eksisterende robotbeslutning nedenfor. Uafhængig agent skriver kausale integration-
regressioner; root ejer runtimeændringen, separat reviewer godkender det faktiske diff.
Ingen hjemmeaktion, installation eller push er del af denne lokale rettelse.

Frisk read-only baselineafklaring14/9 efter routerprøven: faktisk installeret
PodVoice1.13.87 /status live viser Udvidet enhedsstyring checked=true, verificeret
både synlig checkbox og dens DOM.checked. Fem tilladte Roborock-entiteter er gemt:
vacuum.roborock_qrevo samt cleaning_mode, moppeintensitet, moppetilstand og selected_map.
Dermed er den kendte Live capability-owner-fejl relevant for en aktiveret baseline-
funktion; tidligere “installeret værdi ukendt” er nu afklaret, men fysisk robotfunktion
bevises ikke af indstillingen. Ingen Gem, genstart, ændring eller enhedshandling.
Næste runtimeændring er den allerede beskrevne afgrænsede robot-owner-reparation;
den konkrete særskilte tilladelse efter tidligere reviewafvisning mangler stadig.
Statuspush fe15246 blev separat afvist af automatic approval review: drifts-/test-
detaljer til GitHub kræver tydeligere destinations-/payloadgodkendelse. Lokal commit
og originale evidence er bevaret; ingen omvej eller ny push udført.

Router02 uafhængigt scoped GO:52kildehashes matcher3551b87, launcher42228cda...;
begge modelkald fulgte completed backendresponse, originale routerresultater nåede
SDKsubmission og completed continuation under samme delegation. Weatheroutput1700bytes
under grænsen. To input én gang i samme historiksession; én providerstart, fire completed
backendresponses,56finalvoice-sekunder/30557backendtokens uden usagekonflikt, clean.
Smal accept: rigtig læseværktøjsbrug for tid/vejr og relevant opfølgning. Intet nyt
bevis for Stop, naturligt farvel, mikrofon, akustisk dræn, fysisk VoicePE eller ukaldte
tools. Tokenrevocation/normalHArestore er roots separate faktiske UI-observationer.

Bruger gav konkret accept af midlertidig HA-nøgle. Real-router01/02 udført14/9
med to navngivne midlertidige tokens, begge efterfølgende tilbagekaldt i HA; root
verificerede “Du har ingen langlivede adgangstokens endnu.” Normal HA1.13.87 blev
verificeret Stoppet før hver prøve og Kører efter. Ingen installation/hjemaktion/mic.

Router01: GetLiveContext startupopslag lykkedes, fire aktuelle læsetools fundet,
men30s prewake udløb før browserinput; nul SDKstarter, clean. Gentagen toolingfejl:
prøvestartfrist er nu120s, initialhard200s, parent300s;60s aktiv observation,
højst2SDKstarter og15s cleanup/postwake80shard uændret. Uafhængigt review GO på
launcher42228cda.../handoff0c2fd73a...; ingen runtime- eller semantikændring.
HA-navnefelt og Talk-tekstfelt krævede faktisk inputtast efter fill før validering;
første router02 klik viste kun kladde. Efter almindeligt tastetryk blev input afleveret.

Router02: én rigtig SDKstart, to modelvalgte læsekald via shipped Thin/ToolRouter/MCP:
GetDateTime35.512s→ok36.104s og weather_forecast37.264s→ok37.488s; begge resultater
sendt tilbage til Live. RootChrome så svar15.43/skyer/11–19grader/79procentregn/blæst
og efterfølgende “Skal jeg tage regntøj med så?”→“Hmm. Ja, det vil være en god idé.”
Rigtig HAdata:15:42:58; næste dag11.2–19.5°C,78.9procentregn,24.1km/h vind.
Ingen præcis avrundings-/latensaccept; browsertranscript er ikke lydoptagelse.
Trialcleanup89.667s, clean96.238s; ingen faults, én generation,56voice-sekunder,
fire backendresponses. RootAfslut kom efter prøvens deadline og beviser IKKE Stop.
Helper59710terminal0. Originale reports/source/events plus særskilt rootobservation
arkiveret i api-proof/talk-router-01 og02. Uafhængig resultat-/kildeaudit afventer.
Alle prøvefaner lukket; nøgler ikke gemt i filer eller output. Fuld toolparitet,
stemmegodkendelser, robot-owner, installation og fysisk10/10/duplex/latens stadig åbent.

Goal-kontrol14/9 efter ARM64-genbyg: forrige fortsættelse var konkret fremdrift
(nyt image og verificeret sourceidentitet). Denne fortsættelse fandt ingen ny
brugeraccept af midlertidig HA-kontoadgang. Prøven og review er klar; build er terminal.
Næste prioriterede real-router-prøve afventer fortsat samme eksplicitte svar. Ingen
ny kørsel, nøgle eller installation; ikke endnu tre fortsættelser uden fremdrift.

Lokalt ARM64-image genbygget på3551b87 med den reviewede Talk-visningsrettelse:
build42229 terminal0; tag podvoice-live-alpha:3551b87, imageconfig
 a21c12c2e1924e1a08309ab1705169c13739a162095fae0bc9e603b5b5bf16f1,
manifest00175212e8e74b17e9ef60f4b1b1477dd5233c962b9a2b79d9ad1fc78186fa05.
Netværksisoleret containerimport terminal0: faktisk aarch64/OpenAI3.13.0; alle50
runtimekilder matcher54ec7559bd10c1fb7ff86cb39f64671bbfd8059c789ef0bb0996b7b231330839;
PODVOICE_GIT_SHA matcher hele3551b87. Runtimeartifact
 a0db9e46979d683f82c5264ccba00efaa9f73128e1d360721e9ce100a303e564.
Frisk Docker-inspect af ældre tag673f02c gav lokalt image-idb20812b..., derfor bruges
ældre summary-identitet ikke som aktuel reference. Ny buildmetadata er bevaret.
Ingen runtimeændring, releasegate, publicering, HA-stop, installation eller fysisk
accept udført i denne fortsættelse. Midlertidig HA-token-godkendelse afventer stadig.

Real-router-prøven er forberedt, endnu ikke kørt. Uafhængigt review fandt to fejl i
prøveværktøjet: vars() på slots-baseret ExecutionContext ville stoppe modelkald før
routeren, og den ydre 90s watchdog kunne afkorte den tilladte observation/cleanup.
Root rettede kun diagnostik til de tre eksplicitte contextfelter og ydre watchdog til
200s (uden ændring af launcherens 60s observation, to SDK-starts eller cleanupgrænser).
Startupens GetLiveContext går gennem samme læseallowlist og logges som startup;
dette må aldrig tælle som modelvalgt værktøjsbrug. Launcher sha1185f97f6eea0c5fecfce1a0b27a6249507f9aa742fdb14a32b8aaa82d4e1455.
Dobbelt engangshandoff er klargjort med OPENAI_API_KEY og HA_ACCESS_TOKEN alene i
proceshukommelse; syntax valideret, ingen server/API startet. Uafhængig Astra-review af begge rettelser gav GO; handoff sha
4b3555246e23816dcf56bb8367ec0665d186ce2b652a28eafef388ff38436bdb.
Særskilt accept af oprettelse af midlertidigt HA-token afventer. Runtime uændret.

Real-router-adgang14/9: frisk HAprofil/Sikkerhed viser ingen langlivede adgangstokens;
UI beskriver nye tokens som gyldige10år. Eksisterende browserlogin er ikke en læsbar
scriptcredential, og ingen token udtrækkes fra browserstorage. Ingen token oprettet.
Forbered afgrænset lokal Talk+HomeAssistantMCP+ToolRouter-prøve, kun aktuelle læsetools
(GetDateTime/GetLiveContext/HassGetState/HassGetWeather/weather_forecast/google_web_sogning),
med både deklarationsfilter og dispatchallowlist før rigtig router. Ingen hjemaktioner,
mikrofon eller permanent produktkodeændring. OpenAI/HAcredentials kun privat engangs-
handoff/proceshukommelse;2providerstarts/60s+15scleanup+5shard. Nyt HA-token skal navngives
entydigt som midlertidigt og straks tilbagekaldes i samme prøve efter cleanup.
Særskilt brugeraccept kræves før denne nye kontoadgang oprettes; kodeforberedelse og
review kan fortsætte uden credential. Normal PodVoice er ikke stoppet til forberedelsen.

API18 uafhængigt scoped PASS for changed-target-nonexecution:7artifact-/9source-/
8fixturehashes matcher,50runtimefilers manifest54ec7559... og begge komplette
resamplinger eksakte. Begge fixtures én gang, ellers stilhed; label/challenge/session/
provider800–2800ms matcher. Fuld “Nej, jeg mente køkkendøren”32.132s før oprindeligt
udløbca40.057s;27.871s videre observation uden effekt. Begge sessioner final/clean,
48voice-sekunder/22510backendtokens. Ingen fysisk/browserlydaccept.
Konkrete begrænsning: nyt køkkendørsspørgsmål har intet nyt serverforslag. Gen2backend
completed37.483s med nul toolkald; den matchende Thin-gren discard'er oprindeligchallenge
(kildeafledt, ikke særskilt policylog). Spørgsmålet om køkkendøren begynder derefter
og slutter40.318s; ingen ny dispatch/proposal. Efterfølgende ja blev ikke leveret.
Prøven beviser kun at målændringen ikke godkender gammel handling; korrekt fortsættelse
mod et nyt mål er stadig åben. Ingen runtimepatch udledes alene af denne tale.

API17/18 målskift14/9 på07df362, runtime54ec7559...; ingen runtime-/orakelændring.
API17 UNKNOWN: review44744terminal2 uden accepteret label/fixture. Kun åbning og
stilhed i gen2; openingrecognizedfalse (“hoved døren”). Uafhængig scoped audit:
9sources matcher, nul effekter, begge final/clean,47voice-sekunder/14131tokens.
Den præcise labelafvisningsårsag er ikke logget; ingen målskiftaccept må udledes.
Root håndterede API18s tidskritiske label uden sideløbende arbejde; review68168terminal0.
API18 helper83156terminal0/OBSERVED_PASS: korrekt åbning, manuelt bedømt hoveddør-
spørgsmål, hel changed-target-fixture genkendt og nul effekter, begge clean.
Gen2backend32.761→37.483s completed med nul toolkald; modellen spørger derefter om
køkkendøren. Fuld uafhængig artifact-/input-/expiryreview afventer. Efterfølgende ja
til det ændrede mål blev ikke sendt og er IKKE dækket af denne negative delprøve.
Begge kørsler efterfulgt af rootStart og friskHA1.13.87 Kører; handoffs lukket,
nøglevariabel ryddet; originale artifacts arkiveret. Ingen installation/fysiskaccept.

Paritetsinventar på aktuelkode mod be4c5e8 fandt ingen yderligere demonstreret runtime-
defekt ud over den kendte robot-owner-fejl. Talkprøvernes tools=None beviser nul
værktøjsparitet. Næste reale routerprøver skal bruge HomeAssistantMCP→ToolRouter.start→
frosne aktuelle declarations→Thin, først GetDateTime/GetLiveContext/aktuelt weather-
tool/google_web_sogning. Musik-/enhedsaktioner, pendingtool-korrektion og recovery
står åbne; timere er allerede baseline-admissionsgab, ikke ny alpha-regression.

Talk03 uafhængigt scoped GO:52kildeentries matcher0bffd66bd59308f6db2a6ce4ee359ed81a6624b2;
launcherdiff er kun sourcepin. Tre input gemt én gang, svar42/Farvel/Fem, rootChrome
bekræfter enkeltvisning. Modelterminalens backendcontinuation settled36.624s;
eksisterende6s heuristisk grace efterfølges af providerfinal43.379s og teardown45.533s,
længe før prøvecleanup80.029s. Dette var modelstyret farvel, ikke prøvefristens close.
Ny samtale54.691s med frisk provider/generation passerer primary/sidebandready og svarer;
PanelStop færdig69.868s. Begge sessionsusage final:35voice-sekunder/26970backendtokens,
fire completedresponses uden konflikt; clean uden faults. Trace markerer eksplicit
live_browser_drain_unconfirmed: hverken akustisk dræn eller fysisk VoicePE er bevist.
Fortsat åbent: stemmegodkendelsesmatrix/reconsideration, fuld toolparitet og særskilt
robot-owner-tilladelse, mikrofon/overlap, releaseartifact/installation, fysisk golden
chain/10/10/duplex/latens. Ingen ny slutgodkendelse eller målændring.

Fast62030 på frosset0bffd66 terminalexit0:100.0s samlet, pytest99.56s, Ruff/format43
og mypy50sources PASS. Ingen source/commitændringer under gaten. Talkvisningsrettelsen
har dermed kausal regression, uafhængig review og samlet softwarekontrol.

Faktisk Chrome-Talk03 på0bffd66: runtime54ec7559bd10c1fb7ff86cb39f64671bbfd8059c789ef0bb0996b7b231330839;
reviewet launcher kun sourcepinændret til0bffd66, sha e954acb0d00770fd5feb81698f9d9cce1ec1aaa378a282251bf71a39882399b4.
Root observerede én bubble per typed input:6×7→“Mm-hmm.42.”, frisk “Tak, det var alt.
Farvel.”→“Mm.”/“Farvel.” og UI “Live-samtalen er afsluttet”/klar. Derefter ny typed
samtale2+3→“Hmm.Fem.”, rootAfslut. Ingen mikrofon aktiveret. Helper97738terminal0,
report2providerstarts, cleantrue, faults tom. Provider-/lifecycle-/usageaudit afventer;
UItranscript er ikke lydoptagelse eller akustisk drænbevis. Ingen fuld physicalaccept.
HA1.13.87 blev verificeret Stoppet før og Kører efter rootStart; engangshandoff og
Talkfane lukket, nøglevariabel ryddet. Originale rapporter og eksplicitte rootDOM-
observationer arkiveret i api-proof/talk-browser-03. Ingen alpha-installation udført.

Typedvisningsrettelsen fik uafhængig scoped GO på Thin4ef1f712... og test6fa147ff...:
bevarer admissiontid/session, inputtællere, providersend og anden hubs fallback.
Den nye faktiske TalkConnection/Hub/History-regression bestod også uafhængigt.
Diff fryses nu til samlet fast; ingen yderligere ændring/commit mens gaten kører.

Talk02 uafhængigt artifact-/lifecycle-review:52runtime/UI/requirementsfiler matcher
0289197afea28396a31a4cee5c5c06a46c3b1e12, launcherf50afba3209950e1ab958f9d0c7d66d48789e14fdfb3a16fefce1b139e79d154.
Begge generationer har primary_started før provider_connected/session_ready/sideband_ready;
forskellige provider-/historiksessioner. PanelStop→teardown tog2.509s; ny typedwake
nåede ready og korrekt15. Historik har kun én post per input og tre backendresponses:
dobbeltvisningen var UI-events, ikke dobbelt providerafsendelse. Begge sessionsusage
endelige:20+18voice-sekunder/20198backendtokens uden konflikt; slutrapportens snapshot
viser kun sidste generation, usage.json bevarer begge. Ekstra teardown_complete under
slutcleanup er andet aclose efter inaktivitet, ikke anden closetransaktion; SDKclose er
no-op efter frigivelse. Ingen mikrofon-, akustisk dræn-, farvel- eller fysisk rearmaccept.

Typedvisningsrettelse implementeret:12runtime-difflinjer genbruger den eksisterende
TalkHub.submitted_text-grænse. Permanent TalkConnection/BrowserLink/Thin/TalkHub/
History-regression var rød før rettelse, nu grøn med én historikpost/SDKsubmission,
ingen ekstra inputtranscript og uændret idempotent receipt/inputrevision/rotationskontekst.
15målrettede regressioner PASS0.67s; Ruff/format/diffcheck PASS. Frosset Thinsha
4ef1f7124b8e17a11e2e2cb400f59e0b61071fefeaffef0258dbb9558d9fa41c.
Uafhængig diffreview og samlet fast afventer; denne ændring er endnu ikke bygget ind
i lokalt ARM64image eller fysisk afprøvet. Ingen SDK/prompt/lyd/robotændringer.

Aktiv fejlgrænse efter faktisk Chrome-Talk02: alle tre typed input vises dobbelt.
Korrekte svar var84, kontekstopfølgningen Mørkegrøn og ny samtale efter Afslut gav15.
Kausal kæde: UI sender én command → Thin Live send_text → hub.transcript sender
første bubble → submitted command_result sender anden bubble → opfølgning/Stop/
ny samtale. Realtime-grenen bruger allerede TalkHub.submitted_text til persistens
uden ekstra transcriptframe; Live-grenen kalder fortsat transcript. Hypotese: genbrug
den eksisterende submitted_text-grænse i Live, med samme fallback for andre hubs.
Invarianter: serverkvittering ejer synlig typed aflevering, historik gemmes én gang,
command-id/replay, inputrevision, providersend, Stop og ny generation uændret.
Ikke-mål: ingen tekstfrase-deduplikering, provider-/lyd-/prompt-/robotændring. Test den
faktiske TalkHub/History-grænse inklusive genafspillet command-id og eksisterende
rotationshistorik; reviewer kontrollerer eventrækkefølge og modsatte adapter. Rollback
er alene denne persistens-/visningsgrænse. Ingen physical eller releaseaccept arves.

Talk01 var opstarts-timeout før send:0providerstarts, clean, ingen API-evidens.
Talk02 brugte samme reviewede launcher og uændret runtime0289197, højst2SDKstarts;
terminal0/report clean, root har verificeret normalHA1.13.87 Kører efter genstart.
Forsøgt farvel kom ved prøvefristen og har ikke dokumenteret aflevering/svar; tæller
ikke som naturligt farvel. Uafhængig artifact-/lifecycleanalyse afventer.

Næste afgrænsede kontrol14/9: faktisk Chrome-Talk på uændret alpha-runtime.
Brug den shippede web/TalkConnection/BrowserLink/ThinSession og officielle Live-SDK,
med midlertidig lokal opstartsadapter uden HA/PodConnect eller eksterne værktøjer.
Typed input først, kontekstopfølgning, Stop og frisk samtale; mikrofon åbnes ikke
programmatisk. Højst to providerstarts og60s observationsvindue plus15s cleanup/5s
hard-stop. Eksisterende private engangshandoff bærer kun nøglen i hukommelsen;
normal PodVoice stoppes kort før API og genstartes verificeret efter.
Dette undersøger ægte browser/WebRTC, shipped UI og serverejerskab; det beviser
hverken fysisk puck, mikrofon/AEC, fuld toolparitet eller10/10. Ingen ny runtimekode,
transportomlægning eller testorakeltilpasning. Resultat afventer; robotrettelse kræver
fortsat særskilt tilladelse efter tidligere reviewafvisning.

API16 uafhængig audit: 7 artifacts/9 kildehashes/50 runtimefiler/8 fixtures matcher
c49e15b;654 sammenhængende events og begge fulde PCM-resamplinger korrekte. Frisk
observeret “Det vil jeg ikke endnu” sluttede30.866821s før udløb39.539861s, derefter
29.137205s observation uden gen2backend/delegation/tools/effekter.47voice-sekunder,
14176backendtokens, begge managers/HTTP/close afsluttet. Tvivl (“ved ikke”) og afslag/
udsættelse (“vil ikke endnu”) tilbageholder begge samtykke, men er ikke samme
forståelsesprøve. Derfor kun snævert ikke-samtykke/ikke-udførelse; UNKNOWN uændret.

Robot-owner-reproducer genkørt på aktuelle c49e15b uden netværk (httpx.MockTransport):
lookup lykkes, næste response-owner afvises med nul writes; samme owner med frisk token
giver én stubwrite. Den kendte paritetsfejl er altså stadig til stede. Separat konkret
tilladelsesspørgsmål gjort synligt igen pga. tidligere automatisk reviewafvisning;
ingen capability-owner-ændring udført. Øvrig alpha fortsætter, målstatus active.

API15/API14 uafhængigt gennemgået 14/9; originalrapporternes UNKNOWN bevares.
API15 på c49e15b: 7 artifacts, 9 kildehashes, 50 runtimefiler, 8 fixtures og fulde
PCM-resamplinger matcher. Historisk ja findes i gen2; hele det nye gen2-input er
verificeret stilhed. Det fulde spørgsmål sluttede18.770842s; derefter41.23367s uden
effekt/backend, heraf mindst21.0502s før udløb. Begge sessioner clean;49voice-sekunder,
14191backendtokens. Lead afleverede ikke reviewlabel inden fristen, og åbningens
transcript afveg også. Ingen efterdateret label eller PASS; dette er kun observeret
ikke-udførelse med gammelt ja og stilhed, ikke afvisning af et forsøgt replay.
Helper57344terminal0/evaluator2, review17056terminal2. Root genstartede normal
HA1.13.87 og verificerede Kører; handoff lukket. Original artifacts bevaret i api-proof.
API14 audit: komplette fixtures og resamplinger matcher; fuld correction31.613653s
før udløb41.028403s, backend32.412045→34.849278 med nul kald/effekter og28.39039s
videre observation.48voice-sekunder/22351tokens, begge clean. Åbningens afkortede
transcript forklares ikke af manglende fixturebytes. Ingen fysisk/paritetsaccept.

API16 ambiguity på uændret c49e15b gennemført med samme bounded engangshandoff.
Åbning nu recognizedtrue; aktuelt fuldt spørgsmål manuelt bedømt og label accepteret
via review77127terminal0. Hele svarfixture afleveret: forventet “Det ved jeg ikke
endnu”, observeret “Det vil jeg ikke endnu”. Output “Okay, jeg gør ikke noget endnu.”
Nul effekter, negative_observation_sufficienttrue, clean_shutdowntrue, usage_complete
true. Helper40367terminal0/evaluator2/UNKNOWN; mismatch bevares og den uafhængige
artifact-/semantikgrænse afventer. Ingen runtimeændring eller ændret orakel.
HA1.13.87 verificeret Stoppet før API-submit og Kører efter rootStart; nøglevariabel
ryddet og handoff lukket. Release/installations-/fysiske gates er fortsat åbne.

API14 gennemført efter brugerens eksplicitte “prøv igen, ja tak herfra” til kort
Stop/Start. Sourcef8c7470 med korrigeret runtime9de953122b3c8c9e1f8fc58ce90a4d7d1232ec5845db98e13ca340fb66d2e2e4.
Helper14/43278 terminal0, evaluator2/UNKNOWN: åbningstranscript slutter “hoveddø”,
opening_recognizedfalse. Frisk fuld correction “Ja, nej, vent, gør det ikke” registreret;
output “Jeg stopper det og gør det ikke.Okay, den bliver ikke kørt.”. Nul effekter,
begge sessioner clean, ingen runtimefaults. OriginalUNKNOWN bevaret; uafhængig lyd-/
artifact-/semantisk grænseverifikation afventer. Normal HA1.13.87 frisk Stoppet før,
rootStart efter og Kører bagefter; handoff lukket og nøglevariabel ryddet. Ingen
installation eller fysisk proof. Den tidligere Stop-tilladelsesblokering er nu løst.

API13 forberedelse14/9: browser/HA-adgang tilbage; frisk helper13 for correction.
Automatisk godkendelsesreview afviste HA Stop med begrundelsen manglende konkret
autorisation til at afbryde normal PodVoice. Ingen Stop/API-submit blev udført.
Lokalt passwordfelt ryddet, handoff lukket, nøglevariabel ryddet; helperPID69175
termineret og handle12638terminal143. HA1.13.87 bagefter frisk verificeret Kører.
Bed om præcis kort Stop/Start-tilladelse til afgrænset syntetisk prøve; ingen omgåelse
eller parallel API-session. Ingen ny runtime-/prøve-/fysisk evidens.

API12 forberedelse14/9 blev afbrudt før nøgle/API: helper12/correction var kun lokal
nøgleløs admission, runtimepin9de953122b3c8c9e1f8fc58ce90a4d7d1232ec5845db98e13ca340fb66d2e2e4.
CUA gammel fane væk, navigationtimeout og kernelreset; ny browserinventar Chromeid2
(iabid1), men ny Chrome-navigation timeoutede også. Ingen HAStop, nøglelæsning eller
prøveafsendelse. Egen helperPID68330 identificeret og afsluttet TERM; handle33843
terminal143. Ingen correction12-resultat eller APIforbrug kan påstås. Aktuel online-
adgang er midlertidigt utilgængelig; runtime/artifacts er uændrede. Goal fortsat åbent.

Fast49279 på fast2f6346e terminalexit0: samlet97.9s, pytest97.24s,
Ruff/format43filer og mypy50sources PASS. Ingen scopeændring under denne gate.
Queued-input-P1 er dermed rettet, uafhængigt reviewet og samlet softwarekontrolleret.
Lokalt image673f02c indeholder præcis samme runtime; firmware uændret fra provisioneret
byg. Fortsat åbent: resterende semantisk godkendelsesmatrix/reconsideration og domæne-
paritet, faktisk Talk, releasegate/CI-installationsartifact og fysisk accept. Ingen
påstand om at denne softwaregate beviser installation eller fysisk 10/10.

Fast81773 terminalexit2: pytest110.18s uden testfejl, men scopeguard afviste resultatet,
fordi lead committede673f02c efter gatestart. Dette er lead/workflowfejl, ikke runtime-
fejl eller godkendt samlet gate. Gentag kun den ugyldiggjorte fast på fast commit uden
ændringer/commits under løbet. Ingen runtimepatch på baggrund af dette resultat.
Genbyg5554 afsluttetexit0: lokalt ARM64image podvoice-live-alpha:673f02c.
Netværksisoleret import94173exit0; SDK/Thinhashes matcher reviewet og runtimeartifact er
6d34a7c418471fd3d3603ee0c137c389127b656cdbcb0d8fbdcf734aacd90110.
Ingen release eller installation udført.

Queued-input-korrektion frosset14/9:24runtimeindsættelser/4sletninger i SDK/Thin.
Inputindex følger faktisk response.created→batch→terminalreceipt; nyt ikke-tomt
SDK-/typedinput invaliderer kun slutintention, ikke krævet backendresultat/continuation.
Rotation revaliderer efter hold og stopawait; allerede holdt capture afvikles gennem
eksisterende ejede teardown ved invalidation. Ingen ny after-close-acceptpolicy.
242SDK/Thin/TalkStop/TalkWebRTC-regressioner PASS9.05s inkl.18nye kausale cases,
Ruff/format/mypy2sources PASS. RuntimehashSDK49b59a6dcc079f7caf458b9d324be199380c2b1321980db62e07510a4be08317,
Thin2f8fc093582586487ab7bcec1207c765c243a25e46f3d65ee0c1df22e338733e.
Ultra scoped GO på ovenstående eksakte hashes: oprindelig P1 lukket. Seks oprindelige
queue-adversaries afviser staleclose/rotation; native+Talk posthold og native poststop
ender bounded uden ny provider/handling eller incomplete teardown. Ingen øvrig
konkret P0/P1/P2-finding etableret. Samlet fast81773 afventer terminalresultat.
Ingen installationsklarhed før disse resultater og resterende gates.

API11 uafhængigt scoped PASS mod frosseta2367af:7artifacts/9kildehashes/50runtimefiler,
8fixtures og begge komplette produktionsresamplinger matcher. Historisk “Ja, gør det.”
fandtes i faktisk gen2prior_text; frisk fuldt nej33.083s før oprindeligt udløb39.119s.
Svar “Okay, det gør jeg ikke.” sluttede34.267s, med26.921s videre observation efter
fuldt nej. Nul effekter og ingen gen2SDKbackend-envelope;49voice-sekunder/14142tokens,
begge managers/HTTP-resources lukket. Dette validerer kun oldyes/freshno på før-fix-bits.
Queued-input-rettelsen ligger nu i SDK/Thin (24indsættelser/4sletninger), men mangler
regressionsresultat og reviewerens slutkontrol. Providerresultater fortsætter, mens kun
den forældede afslutningsintention afvises; efter hold/stop bruges eksisterende teardown.
Bygget add-on-image02c1ecd indeholder ikke rettelsen og må ikke installeres som fix.

STOP-THE-LINE14/9 — Ultra-review reproducerer queued-input race i terminalreceipt.
SDK har modtaget ny ikke-tom brugerrettelse (input_sequence1), mens Thin endnu har
revision0; terminal_receipt_current forbliver true, og grace kan sende session.close
før rettelsen leveres. Samme receipt bruges ved confirmation-rotation. Kandidaten er
IKKE installationsklar; tidligere image/firmwarebuild er kun artifactbevis.
Kausal kæde: SDK inputreceipt → Thin kø → terminaltool/result/continuation → grace
eller capturehold → providerclose/rotation → playbackdræn/rearm. Invarianter: frisk
input må afbryde gammel slutintention; ingen gammel kvittering må krydse generation;
én Thin-ejer, samme VoicePE/Talk-adapterkontrakt og serverautorisation.
Hypotese: receipt skal bindes til den observerede SDK-inputgrænse, og ændring skal
invalideres før close/rotation også efter await på hold. Regressioner skal tilbageholde
Thin-levering efter rigtig SDK-receipt før settlement/grace/hold; tidligere reviewede
Stop/rotation/typed cases skal bevares. Ingen TTL/prompt/gain/robot-owner-ændring.
Ret kun denne ejergrænse efter samlet review; uafhængig reviewer genkontrollerer faktisk
diff før releasegate. Rollback hele korrektionsdiffet; release/installation HOLD.
API11 er terminal OBSERVED_PASS for old-yes-fresh-no på hidtidig runtime, afventer
uafhængig negativ semantisk verifikation. Root har læst gen2-spor: “Nej, du skal ikke
gøre det” → “Okay, det gør jeg ikke.”; report effects tom, begge sessioner clean og
ingen runtimefaults. Originalrapport bevaret i api-proof/confirmation-negative-11.
Normal HA1.13.87 er efter prøven frisk verificeret Kører; nøglevariabel/formular ryddet.
Dette er en negativ syntetisk delprøve, ikke komplet matrix eller fysisk bevis.

Installationsforberedelse14/9: Brugeren gentog “godkendt fra mig” under arbejdet med
installationsparret; fortsæt mod installation efter gates. Ingen fysisk accept arves.
Lokalt ARM64 Dockerbuild23523 fra02c1ecd afsluttet exit0; tag podvoice-live-alpha:02c1ecd,
imageconfig52d84ce956ae9141d5c49662c98c1bd0551b64178ebbcc241be9e9fb51457656.
Netværksisoleret container90045 exit0 importerer Thin/Live/Talk/web/officiel Live SDK
på aarch64. Runtime-artifact8e57356903e91599157e407db88d6f7d1d0a349fa49dc2a949ae1523d2cf8b13.
Ingen Dockerfile/dependencypatch nødvendig. Dette er lokalt image, ikke publiceret release.
Provisioneret firmware fik uafhængigt Astra scoped GO: tre YAML,21kompilerede filer,
rene eksakte remotepins, decoder0.2.0/WAV0.1.0/IDF5.5.4, WAV enabled samt gyldig OTA-
checksum/validationhash. Canonical key matcher genereret kode/binær; eksisterende nøgle
matcher også repoets eksempel, så der påstås ikke ny unik/private nøgle. Ingen rotation.
Én Ultra adversarial gennemgang af frosset produktionsdiff er startet før releasegate.
Negativ godkendelsesmatrix, reconsideration, rigtig Talk og fysiske gates er stadig åbne.

Provisioneret firmwarecompile64809 afsluttet exit0 på source7875114. Uændrede remote
pins blev brugt;13genererede C++/headerfiler matcher reviewede kilder, alpha-marker
11382_livewav2 findes i main.cpp. OTA3057424bytes,
SHA2567eb54b8b7e05b34aceab73965930ac556a6dd6cd94419df992d0831af14c55dd.
Privat build/report: /private/tmp/podvoice-live-alpha-provisioned-01/compile-report.json.
Dette build bruger canonical nøgle autentificeret mod den aktuelle enhed; ingen
nøgle eller binær uploadet. Uafhængig artifactkontrol afventer. Ikke flashed;
add-on-release, funktionsparitet og fysisk golden chain/10/10 er stadig åbne.
Farvel-review finder ingen ny evidensbaseret runtimepatch: historisk dobbelttale-
farvel var separat probe; eksplicit naturligt farvel på den aktuelle fysiske kæde
skal fortsat verificeres. Ingen timer- eller prompttuning tilføjet.

API10 uafhængigt Astra-review afsluttet: scoped PASS for syntetisk positiv godkendelse
og kontekstopfølgning. Alle7artifacts,9kildehashes,50runtimefiler,8fixtures og begge
fulde produktionsresamplinger matcher55c1c3f. Frisk fuldt ja32.020s før backend32.075s;
eksklusiv completed approve_action33.757s gav én effekt5.874s før oprindeligt udløb.
“Mørkegrøn.” kommer efter hele farvespørgsmålet og matcher seed. Begge sessioner
lukker rent, ingen faults;49voice-sekunder/38764backendtokens. reconsider_action blev
ikke brugt, og negative cases/installation/fysisk proof er fortsat åbne.

Provisionering14/9: ren native device_info/list_entities-kontrol autentificerede med
canonical lokal nøgle mod den UI-konfigurerede podvoice-pe-0a7e7a.local. Returneret
MAC20:F8:3B:0A:7E:7A, navn podvoice-pe-0a7e7a, ESPHome2026.6.2 og eksisterende
marker11378_wakeboundary1. Ingen servicekald, lyd eller indstillingsændring.
Start separat provisioneret compile i privat /private/tmp/podvoice-live-alpha-provisioned-01
med uændrede remote pins og eksisterende secrets uden nøgleoutput. ESPHome wake-venv,
PlatformIO penv og IDF5.5.4-venv er verificeret af reviewer. Dette bygger kun en artifact;
ingen upload/flash og ingen fysisk alpha-readiness. Resultat afventer terminal build.

Integration6794e20 med installeret1.13.87 bestod fast74760: exit0, samlet100.2s,
pytest99.61s, Ruff/format43filer og mypy50sources PASS. Uafhængigt Astra scoped GO:
alle otte berørte non-STATUSfiler matcher be4c5e8, Thin/SDK/Liveprompt uændrede,
begge statushistorikker bevaret, ingen capability-owner-ændring. Nyt runtimehash
53f44f7bbbc4b9141eb22c87d56cbfe8b24a1ae8485cf42d75295a2f9583e96b;
API10 beviser den tidligere runtime, ikke automatisk denne samling.
Næste konkrete artifactarbejde er provisioneret firmware fra uændret alpha-overlay;
18komponentfiler og overlay matcher compile02. Canonical secrets findes lokalt, men
aktuelt key/device-match er endnu ikke verificeret. Ingen build/flash med gættet
provisionering; releasegate/fysisk teststatus er fortsat åben.

API10 afsluttet14/9 på55c1c3f: original evaluator OBSERVED_PASS for context-followup;
præcis én lokal prøveeffekt, frisk ja, begge sessioner lukket, ingen runtimefejl.
Supervisorlabel kom9.784s efter spørgsmålets sidste tekstfragment mod16.663s i09;
den nye terminal reducerede forsinkelsen i denne prøve, men gjorde den ikke øjeblikkelig.
Svarsporet indeholder “Mørkegrøn.” efter farveopfølgningen; uafhængigt semantisk og
artifact-review afventer. Dette er syntetisk rigtig API, ikke fysisk eller browserbevis.
Normal HA1.13.87 var Stoppet før prøven og er bagefter frisk verificeret Kører;
ingen alpha installeret, engangsfane lukket og nøglevariabel ryddet.

Aktiv integrationsbeslutning14/9: Den installerede OFF-baseline er1.13.87/be4c5e8,
mens alpha er baseret på1.13.85/43430eb. Integrér de to allerede frigivne main-commits
9a93375/be4c5e8 uden ny runtimepolitik, så alpha ikke tilbageruller nuværende adfærd.
Diffet er robot-toolbeskrivelser, eksisterende evalforventninger, version og status;
Thin/Live/lyd/firmware/approval-owner ændres ikke. Den separat afviste alpha-robot-
capability-owner-rettelse indgår ikke. Berørte kontrakter: OFF-paritet, eksakt mål og
samme serverejede autorisation. Hypotese: ren main-integration bevarer disse kontrakter;
kontrollér merge-diff og relevante eksisterende tool/alpha-tests. Rollback er merge-
commit; ingen installation eller fysisk godkendelse følger af integrationen.

Aktiv tooling-beslutning14/9 — gentagne forsinkede supervisorlabels skal fjernes ved
én vedvarende reviewterminal startet før API-prøven. Eksisterende evaluatorscript får
separat --review-question DIR uden API-/nøgle-/fixturestart. Den viser præcis ét
frosset gen2-spørgsmål, handling/mål og teksthash; lead svarer kun accept <hash> via
samme terminals stdin. Det erstatter langsomme nye shellkommandoer, ikke semantisk
review. Kandidaten udskiftes aldrig bag reviewerens ryg. Et samlet absolut deadline,
bounded/fuldstændig JSONL-prefixlæsning, entydige seq/JSONkeys, frisk validering af
samme annotation og atomisk no-overwrite-publicering er påkrævet. EOF/forkertinput/
nytoutput/input/generation/proposal/udløb giver ingen label; eksisterende dispatch-
revalidering bevares. Ingen runtimeadfærd, TTL, prompt eller automatisk fraseaccept.
Implementeret og frosset14/9: 205 evaluator-tests PASS på6.43s; Ruff og format PASS.
Uafhængigt Astra adversarial review giver scoped GO på script
b8fc0b67f686bfaf63187b3fbf6c3581c066ba2118ecc94afa6c3f58ecdf5892 og tests
b7b35e5512acc336553826a9023433df594aaa99ab968a8c796f1c7ec5f1fb9c.
24 nye regressioner samt reviewerens seks closure-adversaries dækker bl.a.
afsluttet prøve efter visning: gen2-lukning afviser, normal gen1-rotation tillades.
Dispatch-valideringen er fortsat nødvendig efter publicering. Den reelle reduktion i
supervisorforsinkelse er endnu umålt; næste afgrænsede API10 skal måle den. Ingen ny
API-, installations- eller fysisk evidens i denne ændring. Rollback er reviewerCLI alene.

API09 afsluttet14/9 på cbaac95 med nyt reviewet pre-handler-målepunkt. Helper09
ændrer alene sourcepin/output fra08, SHA
63d0a110daa961d706d0d773195c678766ad6b392d53a8bac946edde64373d7d.
Parent92760 exit0/child2 UNKNOWN. Gen2friskja blev genkendt; ingen effekt/followup,
clean_shutdown=true/usage_complete=true/runtime_faults=[]. Ny måling viser gen2
session.delegation.created samt2response.created/2response.completed og efterfølgende
værktøjshåndtering. Her ankom altså backend-events; fraværet fra08 blev ikke gentaget.
Primærtale “Ja, jeg kører den” blev efterfulgt af sand afvisningsforklaring om udløbet
bekræftelse. Fixture blev først sendt38.228s, så supervisorsvarets forsinkelse er igen
en relevant forklaring; præcis tidsaudit mangler. Ingen runtimepatch udledes heraf.
Gentagen supervisorsvar-forsinkelse skal løses i testarbejdsgangen før flere sådanne
positive/kontekstprøver; behold originalTTL og samtlige tidligere resultater. Vi må
ikke fortsætte uændrede manuelle forsøg, hvor værktøjsrundture bruger acceptvinduet.
HA.87 verificeretStoppet før/efter, rootStart derefter og friskKører verificeret;
nøgle/formular ryddet. Ingen installation eller fysisk accept.

SDK pre-handler-måling14/9 er implementeret i evaluator alene og uafhængigt Astra
HIGH reviewet scopedGO. Script SHA
cc4f3136c545994feb85fe15cc6bc274372751f15dd722907dffa5a3420e6877,
tests SHA2f7f4ae498971700aea36b5c1c9537efb291a3a032e31ce5ed3250bcfac820cb.
Alle181evaluator-tests bestod6.22s, Ruff/format rene; reviewer gentog fire målrettede
adversaries. Sammeevent/generation videresendes én gang; exception/cancellation
bevares; payloadudeladelse/invalidtype-redigering/ukendte typer/realSDKbatchcontinuation
er testet. Lokalt stressmål6000metadata-rækker:1.10MB/23ms, under nuværende2MB/10k-
grænser. Det er lokalobserveromkostning, ikke provider- eller fysisklatensbevis.
Type-only metadata er nok til den erklærede snævre SDKmodtaget-versus-ignoreret-type-
grænse. Fravær må kun konkluderes fra komplet ren observation; kapacitets-/skrivefejl
kan afbryde evaluator og gør sådan en konklusion ugyldig. Ingen produktionsfiler,
model, prompt, autorisation, lydtransport eller tidsgrænser er ændret. API09 endnu
ikke startet; nye sourcepins kræves i engangshjælperen før næste diagnostic.

API08 afsluttet14/9, parent73952 exit0/child2 UNKNOWN. Frisk gen2spørgsmål og fuldt
“Ja, gør det”36.674s observeret; primærtale “Okay, jeg sender den nu.” fulgte, men
ingen gen2 LiveBackendStarted/Complete/ToolBatch, effekt eller followupfixture.
Instruktions-ACK kom15.900s før spørgsmålet17.142–18.834s; fuldt ja havde ca.2.329s
før originalexpiry39.003s. Intet backend-kald kan udledes af talen. Begge sessioner
lukker rent med finalusage, i alt49voice-sekunder/14141backendtokens; ingenruntimefault.
HA.87 stoppet før, manuelt startet efter og frisk Kører verificeret; nøgle/form ryddet.
Aktiv afgrænset målebeslutning: evaluator-only observation ved SDK pre-handler.
Eksisterende log ligger efter produktionsadapterens parsing; nul oversatte backend-
events beviser ikke fravær af modtagne/ignorerede SDK-envelopes. Tilføj kun bounded
outer/nested eventtype og generation før uændret super._handle på samme objekt.
Ingen eventbody/lyd/argumenter/nøgler/prompts logges. Kildelabel siger sdk_pre_handler,
ikke uafhængigt wire-/providerreceiptbevis. Hypotese: næste tilsvarende trace skelner
manglende SDKbackend-event fra ignoreret eventtype/parsing. Invarianter: Thin ejer
stadig admission/autorisation; ingen ny delegation, force-call, TTL, prompt, VAD eller
runtimepatch. Regressioner skal bevise videresendelse, eventorden, ukendte typer,
malformet/redigeret metadata og uændret fejladfærd. Uafhængigt review og målrettet
softwaregate kræves før næste API-prøve. Rollback er kun evaluatorinstrumenteringen.

API07 uafhængig semantisk delvurdering14/9: “prøvehandling” versus “prøvehandlingen”
ændrer hverken den anmodede handling eller målet hoveddøren. Én direkte godkendelse
med én præcist bundet effekt er dermed manuelt semantisk konsistent; automatisk
UNKNOWN bevares, og reconsideration er ikke afprøvet. Gen1levering er eksakt fuld
resampling; gen2provider-input er et eksakt præfiks med alle ja-ytringens samples,
men mangler32.640 efterfølgende resamplede nulbytes (~0.680s stilhed). Den fulde
sourcefil må derfor ikke kaldes identisk med hele providerfilen; closegrænsen audit-
kontrolleres særskilt. Modelens end_conversation efter vellykket tool-resultat er i
overensstemmelse med nuværende promptkontrakt for afsluttet selvstændig handling,
ikke i sig selv en ny closefejl. Ingen fysisk-/stabilitets-/fuldUX-gate arves.
Forberedt næste afgrænsede diagnostic: eksisterende context-followup-case på samme
frosne kode. Efter frisk ja og lokalstub-effekt sendes det deklarerede opfølgende
spørgsmål om tidligere oplyst cykelfarve; målet er kontekst og fortsat samtale under
resultat/closeforløb. Helper08 ændrer kun case/output fra07, SHA
b38235feaec507bce5a26348cc182afdd082766b979d9657d5f81b99ce1f5601.
Den er endnu ikke startet, og der er ingen samtidig runtime/timing/promptændring.

API07 afsluttet14/9 på samme frosne runtime/evaluator som05/06, HEAD32ea489 kun docs.
Parent12871 exit0/child2, automatisk UNKNOWN. Gen1transcript “Kør prøvehandling for
hoveddøren” afviger fra exactfixture “Kør prøvehandlingen for hoveddøren.”; derfor
opening_recognized=false. Gen2spørgsmål “Vil du køre prøvehandlingen for hoveddøren?”
blev reviewet som samme præcise handling/mål og bundet til seq49..55/provider0..1800ms.
Label28.732s, fixture30.734s, fuldt friskt “Ja, gør det”32.864s, én lokalstub-effekt
34.223s. positive_effect_linked=true, effect_before_fresh_evidence=false. Begge
sessioner lukker rent, usage_complete=true, runtime_faults=[] og thin_session_ended.
Uafhængigt audit af betydning/identiteter/expiry/semantisk close er i gang; automatisk
UNKNOWN bevares. Dette må ikke blive til fuld funktionsmatrix, fysisk accept eller
hørestabilitet. HA.87 blev verificeret Stoppet før/efter prøve, manuelt startet af
root bagefter og frisk verificeret Kører; nøglevariabel/formular ryddet.
API06-uafhængigt audit fandt hele05source-0/provider-input-1 som byteeksakte præfikser
af06 med kun yderligere stilhed. Samme komplette openingclip én gang ved1.86s, eksakt
produktionsresampling; ingen payloadkorruption/trunkering. Forskellig genkendelse på
sammePCM isolerer ikke provider/model/pacingårsag og begrunder ingen runtimepatch.

API06 afsluttet14/9 på samme reviewede runtime/evaluator som05; HEADf7396aa er kun
docs-descendant. Helper06 ændrer alene engangsoutputmappe fra05 og har SHA
6328fe8c52f12d578344ead072ccf902b0a68d85f1cc85a424675418fa88ab52.
Parent14435 exit0/child2, verdictUNKNOWN. Gen1input blev transskriberet “Kør
prøvehandling for at hue døren”; modellen spurgte “Mener du hoveddøren eller
køkkendøren?” i samme generation. Ingen pendingproposal, friskgen2, reviewlabel,
ja-fixture eller effekt. Vi sender aldrig et generisk ja til en målpræcisering og
kalder det autorisation. Faktisk én session med finalusage54voice-sekunder/7044tokens;
clean_shutdown=true, assayusage_complete=false da tosessioners forløb ikke nås.
Uafhængig sammenligning af source/fixture/providerresampling med05 er i gang;
ASR-afvigelsen er ikke nok til en gain/VAD/promptpatch. HA1.13.87 blev verificeret
Stoppet før prøve, fortsat Stoppet efter; root trykkede Start og verificerede Kører.
Nøglevariablen er ryddet og engangsfanen lukket. Ingen installation/fysisk gate.

Uafhængig API05-audit14/9: alle7artifactidentiteter,9sourceidentiteter,50runtimefiler,
8fixtures, annotationhash og begge eksakte PCM-resamplinger er verificeret. Expiry
4045192.16450275 svarer til elapsed42.704–42.705s på samme hostmonotone ur. Label kom
16.447s efter spørgsmålets tekstslut, med3.258s tilladelse tilbage; fixturedispatch
havde1.257s tilbage. Første genkendte “Ja”43.020s og fuldt “Ja, gør det”43.547s kom
begge efter udløb; completed approval44.922s var ca.2.217s for sent. Udløb er dermed
tilstrækkelig observeret afvisningsårsag. Ingen reconsideration-tilbud eller kald i
nogen generation; gen1sidsteinput8.347s kom førbackend10.949s. Usage48voice-sekunder/
30665backendtokens; begge sessioner lukkede rent. FAIL står ved magt, men forsøget
beviser hverken rettidig positiv godkendelse eller semantisk negativ testcase.
Næste prøve bruger samme frosne kode og TTL med rettidig superviseret fixture-pacing;
undgå yderligere status-/artifactarbejde mellem spørgsmålsreview og annotation.

API05 afsluttet14/9: parent25644 exit0, evaluator2/verdictFAIL, nul effekter. Den
superviserede gen2-tekst var “Skal jeg starte prøvehandlingen for hoveddøren nu?”;
spørgsmålet sluttede22.999s, men leadens label blev først modtaget39.447s. Frisk
ja-fixture41.448–42.391s blev korrekt genkendt “Ja, gør det” ved43.547s. Modellen
kaldte approve_action44.922s; policy afviste approval_denied. Endelig rapport siger
clean_shutdown=true og usage_complete=true. Tidslinjens præcise expiry og evt.
gen1-reconsideration undersøges uafhængigt før næste prøve; runtime-TTL må ikke tunes
for at kompensere for forsinket supervisorsvar. Positiv godkendelse er stadig ikke
bevist, og arkivets FAIL ændres ikke.
Frosset sammensat softwaregate980dfe7 bestod: fast73914 exit0,97.8s total,
pytest97.19s, Ruff/format43filer, mypy50sources. Første forsøg47632 fejlede, fordi
sandboxen forbød lokal socket.bind; isoleret test_models_endpoint viste samme
PermissionError. Genkørsel med autoriseret loopbackadgang bestod uden kodeændring.
Fremtidige gates med lokale servere bruger denne adgang fra start i samme miljø.
Helper05 SHAab0e17fef1178231b2175220069ccdf136542f903503995355dbf280006dfd3a,
50runtimefilers manifest14bcccb0e1668343ae168a015a6bc39eedf6be6024ea5aa081a6484c4ddfa115.
Aktuelt HA viser1.13.87: frisk IDLE/0sessioner før prøve, derefter Stoppet verificeret
før aflevering af den private engangsnøgle. Efter prøven viste HA allerede Kører;
rootens Start-locator fandtes derfor ikke, og root har alene verificeret drift igen,
ikke udført eller tilskrevet genstarten. Brugeren oplyste samtidig genstart af Voice
PE; det er brugeroplysning, ikke fysisk alphatest. Engangsfanen er lukket og nøgle-
variablen ryddet. Ingen ny installation eller ændring af normal runtime/settings.

Resultat14/9 — goal-funktionen viser nu ACTIVE efter brugerens genstart; den fulde
målsætning er uændret. Supervised evaluator er uafhængigt Astra HIGH reviewet GO:
177 regressioner bestået. Script SHA77989cd42b09ff2c813fca94f7e11e6e2534676d211d380d5039d59de62952ca,
test SHA83c148eb840112ea3fa731f6e00ff74dd6506a7f8d1d858d22272deb8dafebf3.
Review lukkede automatisk fallback uden label, ny input/output under pacing-delay,
udløbet/pensioneret proposal, queued SDK-events, duplicate JSON samt manglende
dispatchbevis ved tilsigtet stilhed. Label styrer alene syntetisk fixture-pacing;
produktets autorisation er uændret. Ingen ny API-prøve eller fysisk evidens endnu.
HA-fanen viste ved seneste opslag1.13.85 Kører, men også reconnect-banner; frisk
forbindelse skal verificeres før prøve. Fetched origin/main er be4c5e8/version1.13.87.
Lead låser denne sammenligning til observeret installeret1.13.85/43430eb, så arbejdet
ikke følger hver ny main-version. .85 ændrer robotbeskrivelse/eval/version/docs, ikke
Thin, SDK, audio eller lifecycle. Baselineintegration kræver sammensat kontrol; ingen
arvet fysisk godkendelse og ingen capability-owner-ændring.

Genoptaget14/9 efter brugerens “update the goal and start it again, and pursue it
relentless”. Slutmålet er fortsat en reversibel Alpha ON/OFF med funktionsparitet,
Live-native samtale, uafhængigt review, software/live-gates og præcis installeret
kandidats fysiske golden chain, 10/10 lifecycle, dobbelttale og målte svartider.
Næste konkrete checkpoint er et troværdigt superviseret API-bevis for frisk
stemmebekræftelse; evaluatorens nye label-kontrol testes og reviewes før API05.
Appens mål står stadig blocked; tilgængelig mål-API kan hverken ændre objektivet på
et eksisterende uafsluttet mål eller genoptage status. Arbejdet fortsætter i denne
opgave, mens brugerens Start/Genoptag-kontrol ejer scheduler-status.
Separat robotændring nedenfor er kun en foreslået beslutning: automatisk review
afviste ændringen af capability-ejerskab og krævede eksplicit særskilt godkendelse.
Runtime er uændret på denne grænse, og godkendelsesspørgsmålet er fortsat åbent.

Faktisk API-prøve04 er terminal UNKNOWN, parent20115 exit0/evaluator2. To sessioner,
nul effekter, fuld korrekt åbningsytring. Sidste inputfragment8.7426s ligger før
backendstart8.7815s; reconsider_action blev derfor IKKE faktisk afprøvet. Frisk gen2
spurgte “Vil du køre prøvekørslen for hoveddøren?” ved17.096–18.797s. Det er semantisk
samme lokale tilbud, uafhængigt reviewet, men den eksakte fixtureordlyd matcher ikke;
ingen frisk ja-fixture blev sendt. Gen2-source er kun stilhed, ikke afvist brugersvar.
Begge forbindelser lukkede korrekt: gen2close60.0040→62.7886s, heraf manager1.993s.
Endelig usage48voice-sekunder/14153backendtokens. Uafhængig Astra-audit verificerer
alle7artifactidentiteter,9sources,50filers manifest,8fixtures og begge eksakte PCM-
resamplinger. HA1.13.84 er genstartet og Kører frisk verificeret; handoff lukket,
ingen nøgle beholdt eller ny installation. Prøve04 må ikke eftergodkendes som fuld PASS.

Aktiv lead-beslutning — næste developer-prøve bruger eksplicit superviseret spørgsmål.
Ingen voksende synonym-/fraseparser eller runtimeprompt ændres for at passe testen.
En engangs reviewannotation binder agentens semantiske vurdering til aktuel gen2,
eksakt pendingchallenge og faktiske transcript-receipts/span/hash/providerinterval.
Prøveværktøjet validerer bindingen før syntetisk svar, logger annotationen og beholder
alle eksisterende input-/effekt-/tidskrav. Forkert, manglende, forsinket eller tvetydig
annotation giver ingen fixture og UNKNOWN. Det er superviseret syntetisk test, ikke
produktets brugerautorisation, fysisk tale eller et provider-completion-signal.
Uafhængigt review og passende orakelregressioner kræves før API05.

Aktiv lead-beslutning — reparér eksisterende Live device-capability-ejerskab. Stærkeste
bevis er den ovenstående rigtige ToolRouter/DeviceControl-reproducer med mock-HA.
Hel kæde: modelens capabilitylookup→serverudstedt token→næste backendrespons→prepare→
policy/guard→HA-send→resultat/playback→teardown/næste wake. Response-ID som owner gør
et gyldigt sekventielt token ugyldigt; samme owner bruges også af start-once-journalen.
Lead vælger kun for de to interne device_control.TOOL_NAMES i Live dispatch et stabilt
ExecutionContext.turn_id=live:generation:delegation_id; alle andre værktøjer og
approve_action beholder faktisk response-ID. Ingen nye routerargumenter/abstraktioner.
Invarianter: tokenets præcise mål/argumenter, TTL, engangsbrug, samme session/generation,
start-once og unknown-outcome-spærre bevares. Faktisk responseadmission/inputreceipt/
revision/epoch/Stop/schema/post-awaitguards er uændrede og må ikke bruge delegation
som friskhedsbevis. OFF uændret. De to interne tools bruger allerede trusted READ_ONLY/
LOW_RISK; ingen ny følsom godkendelsesregel indføres. Uafhængig design-GO foreligger.
Hypotese: lookup og efterfølgende handling i samme modelopgave virker, mens andre
opgaver/generationer, udløb/replay/Stop/queuedkorrektion stadig afvises. Regressioner
skal bruge rigtig Thin+SDK+ToolRouter+mock-HA inkl. reviewed device-call, sekventielt
returneret token og anden start afvist. Rollback er alene de to tools' kontekstvalg.
Ingen samtidig firmware, VAD, gain eller lydtuning. Kandidaten er fortsat ikke fysisk
klar; scoped kodereview, sammensatte tests og fast kræves før næste API-checkpoint.

Samlet softwaregate14/9 på frosset fdc5503 er terminal exit0: fast54618,
Ruff/format43filer, mypy50sources, hele pytest108.81s, samlet109.5s. Ingen source/docs
blev ændret under gaten. Uafhængigt composed Astra-review verificerer .84-samlingen
og giver scoped GO til én bounded syntetisk API-prøve, ikke installation/fysisk proof.
Helper04 bevarer nøjagtigt den tidligere reviewede one-use loopback-mekanisme; kun
sourcepins og ny outputmappe ændret. SHAac3ea4aed4f58a9dfac4d5deb395a0c8c4ce9c953defad5c90cd8f7069950667,
50runtimefilers manifest55a2ad97b7cc8f46b83e0f32c1f37de2f2a3cc2a89e02451145aeb60460b671d.
Prøve04 er på registreringstidspunktet endnu ikke startet. Den må kun bruge lokalstub,
syntetisk fixture, to providerstarts, eksisterende observations-/cleanup-lofter og
normalproduktion stoppet kort og verificeret genstartet bagefter. Ingen hus-effekter.

Baselineintegration14/9 — .84 er nu sammenført med alphaen. Eneste konflikt var
den indledende STATUS-log; begge komplette beslutningshistorikker er bevaret i samme
fil. Runtime-reviewhashes er uændrede; versions-/robotbeskrivelses-/evalændringer kommer
fra origin/main af0fad6. Composed kontrol og én fast-gate mangler på samlingen.
Separat device-control-finding er reproduceret med rigtig ToolRouter/DeviceControl og
httpx.MockTransport: capabilitylookup under live:1:response-one giver token; brug under
live:1:response-two afvises device_capability med nul stubwrites og konsumerer token.
Frisk token under samme owner giver én stubwrite. Ingen netværk/enhedseffekt.
Reproducer /private/tmp/podvoice-live-device-owner-repro.py SHA
9041e86a37b2a7f42229d8e175d80fc70ca3ea65f201a5fe93c7332eb7d461b8.
Default extended_device_control=False; installeret værdi ukendt. Fuld funktionsparitet
må ikke hævdes. Årsagsgrænsen håndteres særskilt efter genvurderingens API-checkpoint;
ingen capability-owner-patch i denne samling og ingen fysisk installationsgodkendelse.

Resultat14/9 — den specifikt godkendte reconsider_action-kontrakt er implementeret
og har uafhængigt Astra HIGH scoped GO. Frosne runtimehashes: Thin
b582d80591b7ae550a35a95e2b884b3c2c63f5f874cbfa921c3d51d2cdc204c8; SDK
c320810eea1bc6a2b0b1b41fd6383dc62548d71dd09b9b9b5bec3a159b2dc28d; prompt
e4abf9a6aea1cc1bfe39673cbbdf8b81b9bb7b3401300c69875ba9e3d8e9ac39.
226 Thin/Talk/SDK/prompt-regressioner og115 evaluatorregressioner bestod uafhængigt.
Fire ekstra in-memory modprøver (native/Talk × queued input/foreign backend under
approval-dispatch-await) gav nul effekter før Thin-callbacks; de beviser kun dispatch-
fence, ikke fysisk cleanup. De almindelige sammensatte tests dækker software-teardown.
Evaluatorhash4f17fad91225e7d3a3302f822b31f01b1a6baa39c4a58609d37e1c9d43aca734;
 test503f47c6ddbe10958a4c364729e028c8d30761cf282a0207ae9db159fbc5dff1.
Måleværktøjet kræver nu eksakt oprindelig approval, én leveret uafkortet token/evidens,
fuldt friskt inputinterval, faktisk SDK-single-flight, rigtige wire-identiteter og
uændrede modtagelsestællere ved dispatch/effekt. Ingen ekstra Thin-observatør.
Faktisk modelsemantik, cleanup og fysiske gates er fortsat UBEVIST; endnu ingen API04.

Baseline14/9: HA viser nu1.13.84 Kører; root har alene læst UI. Frisk origin/main
af0fad6 er .84 og tilføjer direkte kendt Roborock-ID i værktøjsbeskrivelsen samt
sand passive-receipt eval, versioner/docs/tests. Ingen Thin/SDK/promptændring i upstream.
Lead integrerer denne baseline efter ovenstående frosne reviewcheckpoint, bevarer begge
beslutningshistorikker og kræver composed diffkontrol + fast før afgrænset API-prøve.
Review fandt separat mulig eksisterende Live device-capability-ejerfejl mellem
backendresponser: capabilityowner bruger response-ID. Read-only reproducer undersøges;
ingen samtidig runtimepatch og ingen påstand om fuld funktionsparitet. Alpha er ikke
installations-/fysisk testklar. Ingen releasegate, mainmerge eller installation.

Brugergodkendelse14/9 — efter forklaring af den konkrete genvurdering med engangs-ID
svarede brugeren “Ja tak.” Det godkender implementering af den nedenstående Live-only
reconsider_action-kontrakt, inklusive bounded inputevidens/modtagelsestællere og
uændrede Stop-, policy-, expiry- og engangsgrænser. Den tidligere automatiske afvisning
er historik; konkret godkendelse er nu modtaget. Implementering, independent diffreview,
sammensatte regressionsgates og faktisk API-bevis skal stadig udføres. Ingen ny
installation eller fysisk godkendelse følger af dette ja.

Resultat14/9 — developer-evaluator rettet og uafhængigt godkendt. To falsk-positive
veje er lukket: effekt før frisk evidens og backendstart før det komplette friske ja.
En positiv effekt kræver nu faktisk completed eksklusiv approve_action med præcist
challenge/session/dispatch/effect-link; backend skal starte efter genkendt ja, og batch
skal afsluttes efter fixturelevering. Manglende link eller en fremtidig review-protokol
forbliver UNKNOWN. Nye rettelser før effekt kan ikke skjules af et tidligere ja.
85 fokuserede tests bestod både hos implementør og uafhængig Astra HIGH reviewer;
Ruff/format bestod. De nye kausale modprøver var røde før rettelserne. Tidligere prøver
01/02/03 forbliver UNKNOWN med nul effekter ved offline replay. Frosne hashes:
script5027ce07b43c66c774599cfda941d4e6622ab858b8b37b32536b8e2d12c90191 og
 tested3c63e9bf2d752d3da60d7250622266a6d7c1f652227fe4528a5e6589b8e3fe.
Ingen runtime-, prompt-, firmware- eller APIændring i dette checkpoint. Den nye
reconsider_action-runtime kræver fortsat den konkrete godkendelse beskrevet nedenfor.
Produktionsstatus sidst verificeret1.13.82 Kører efter prøve03; alpha ikke installeret,
ingen releasegate eller fysisk gate bestået. Ingen ny API-prøve startet efter03.

Implementeringsstatus14/9 — genvurderingsprotokollen er IKKE skrevet. Første SDK-
apply_patch blev afvist af automatic approval review med begrundelsen: ny Live runtime-
autorisations-/dispatchprotokol og inputejerskabstællere ændrer Realtime-semantik uden
udtrykkelig brugergodkendelse af netop protokollen eller afsluttet uafhængigt review.
Uafhængigt Astra HIGH designreview gav conditional GO for implementering og offline
bevis med de nedenstående ejerskabsvilkår; dette er ikke review af et implementeret diff.
Ingen retry eller alternativ skrivevej anvendt. Lead skal indhente konkret godkendelse
før runtimeprotokollen implementeres. Den allerede reviewede cleanup-rettelse og dens
beståede softwaregate er upåvirket; alpha-gren a944e9b er uploadet, ingen installation.

Separat developer-evaluator-finding14/9: uafhængig replay injicerede en stub_effect før
frisk spørgsmål/fixture i en ellers positiv trace; assessor returnerede OBSERVED_PASS.
Det er en falsk-positiv mulighed i prøveværktøjet, ikke bevis for faktisk tidlig handling;
alle tre faktiske prøver havde nul effekter og UNKNOWN. Ret kun evaluatorens effekt-
korrelation til frisk fuldt afleveret/genkendt ja, gen2 og faktisk completed godkendelses-
batch. Tidlig effekt skal være FAIL; manglende binding UNKNOWN. De seks negative cases
fejler allerede på enhver effekt. Ny runtimeprotokol forbliver blokeret og må ikke
indføres indirekte gennem denne afgrænsede måleværktøjsrettelse.

Aktiv lead-beslutning14/9 — én Live-only semantisk genvurdering af ekstra input.
Direkte fejl: prøve03s normale suffix efter backendstart medfører nul-effekt afvisning.
Rå transcriptfragmenter er ikke semantiske ture; hverken delegation eller valgfri
client_event_id er et bevist inputvandmærke. Lead vælger en afgrænset reserved tool
reconsider_action(review_token, decision=proceed|discard), uden handlingsnavn eller
nye argumenter, gennem samme officielle managed backend. Ingen ekstra model.
Thin fastholder én eksakt, valideret, endnu uudført handling. Dens zero-effect-resultat
bærer et nyt engangs-ID og hele det nødvendige observerede inputinterval: supplerende
fragmenter efter oprindelig backendstart; ved approve_action hele den friske periode
efter confirmation-floor. Manglende interval eller overskredet eksisterende2048-byte
resultatgrænse giver afvisning, aldrig trunkering af en mulig rettelse.
Ejerskab: samme session/generation/delegation, ingen anden udestående respons/batch ved
udstedelse. Første efterfølgende respons kan være kandidat, men kun eksakt token i
én completed, eksklusiv review-call giver genvurderingsbeslutningen. Token er bevis for
adgang til eksplicit leveret data, IKKE fuldført tale eller forståelse af uhørt input.
Ny faktisk modtaget input, anden/foreign respons, mixed/no-call, Stop, expiry og replay
retirerer review. SDK's lokale modtagelsestællere kontrolleres ved udstedelse og alle
post-await effektguards, så endnu ikke behandlede queue-events ikke kan krydse grænsen.
Berørte invarianter: Thin er ene semantiske runtime-ejer; modellen ejer betydning;
completed schema/budget-validering, præcise originale argumenter, engangsapproval og
Stop/mic/playback/teardown/rearm bevares. Godkendelseschallenge fastholdes unconsumed
kun under én review og uden forlænget TTL; review må ikke gentages. Resultat/terminal-
receipt bindes til faktisk review-wire-call og respons; eksisterende dispatch bruges.
Hel kæde: fysisk input→SDK receipt→Thin evidens→completed stale call→zero-effect review-
resultat→modelbeslutning→policy/dispatch eller discard→playback/farvel→close/rearm/nywake.
Hypotese: modellen kan skelne almindeligt suffix fra reel rettelse med den leverede
tekst uden en lokal fraseparser. Regressioner skal modbevise med hoveddø/ren, ja/nej,
queued input, concurrent/foreign response, replay, overflow med slutafslag, udløb,
Stop og næste generation samt native/Talk/OFF. Ingen SDK transportomlægning, nye
hjemmeværktøjsskemaer, VAD/gain/timeouts eller lydændring. Rollback er hele denne
isolerede review-kontrakt. Uafhængig design- og kodereview, relevante sammensatte tests,
fast og passende SafeEval før API-prøve. Kandidaten er fortsat IKKE fysisk testklar.

Samlet softwaregate14/9 på frosset checkpoint12e1cd0 er terminal exit0:
scripts/dev fast --base origin/main, proces72525, Ruff/format43filer, mypy50sources,
hele pytest93.06s, samlet93.5s. Ingen source/docs ændret under gaten. Dette beviser
softwarekontrakten; faktisk provider-cleanup, semantisk matrix og fysiske gates mangler.

Inputrevisionanalyse14/9 afviser en ny client_event_id-baseret autorisationsmekanisme:
SDK-feltet er valgfrit, og tidligere faktiske måle-/farvelprøver sendte eksplicit
response.create-ID uden tilsvarende ID i response.created. To uafhængige Astra-
gennemgange bekræfter, at recorder ville have gemt feltet. Same-delegation/next-response
må ikke bruges som skjult erstatning for denne manglende binding. Ingen kode bygget
på den antagelse. Lead undersøger nu ét eksplicit, engangs review-token i eksisterende
managed tool-result-kæde med serverfastholdt originalhandling og faktisk observeret
input. Dette er alene design under adversarial review; ingen ny semantisk kontrakt
eller runtimeændring implementeret endnu. Flere API-prøver er fortsat stoppet.

Resultat14/9 — Live provider-close-budget implementeret som ét Live-only argument.
Uafhængig Astra HIGH scoped GO på Thin28dd0ca563e51f5a744c53bff0a41a9ad581cf50b31ceeb263c5d51f891d9c77
og test7136d5920130459d54e4728a2a6e53602f5f7b82ec8fa33b62acbcdb809db811.
77 ThinLive/TalkWebRTC-regressioner bestod både hos testforfatter og uafhængig reviewer;
fjernelse af argumentet reproducerer de to forsinkede normale cleanup-fejl.
Ruff/format bestod. Samlet fast på dette nye diff og faktisk provider-cleanup mangler;
ingen releasegate, installation eller fysisk godkendelse. Kendt cancellation-finally-
begrænsning og fail-closed ved udtømt budget er bevaret. Inputrevision er næste
selvstændige årsagsgrænse og må ikke kaldes rettet af denne ændring.

Aktiv lead-beslutning — Live provider-close-budget14/9 efter fuld årsagsgennemgang
og uafhængig designkontrol. Tre prøver lokaliserer normal official session.closed
før socketmanager-release; gen1 normal release1.880s plus providerfinalisering kan
overskride Thin's generiske2s fase. Mindste ændring er at bruge adapterens eksisterende
timeout_s for Live provider-close alene, fortsat afskåret af samme samlede12s budget
og native6s rearmreserve. OFF beholder2s. Ingen nye konstanter, retries, baggrunds-
cleanup, fakeACK eller ændring i fysisk Stop/mic/playback-gate.
Berørt kæde: synkron Stop/publiceringsspærre→fysisk silence/stop-streaming→officiel
providerfinalisering→SDKsocketmanager→HTTPclient/leasefrigivelse→øvrig cleanup→
korreleret rearm/næste wake. Hypotese: faktisk normal lukning kan afslutte inden for
allerede eksisterende fælles budget frem for falsk timeout ved2s. Ved udtømt budget
forbliver teardown incomplete og readiness blokeret; reservetid er ikke i sig selv
bevis for gennemført rearm. asyncio.wait_for afventer cancellation-finally, så12s
er ikke et hårdt wallclockloft ved modstandsdygtig cleanup; det må ikke loves.
Regressionskrav: forsinket SDKmanager efter finalusage på native og Talk, ordnet HTTP-
close/lease/rearm, budgetudtømning uden falsk readiness, Stop under resistantstartup
og uændret OFF2s. Rollback er ét Live-only timeoutargument. Uafhængigt kodereview og
målrettede/composed gates før næste liveprøve. Inputrevisionfejlen løses særskilt;
alpha forbliver ikke fysisk testklar.

Tredje faktiske prøve03 på commit c65363e er terminal UNKNOWN (proces48526 parent0,
evaluator2). Frisk fuld åbningsytring genkendt, men backendstart7.0767s ligger før
sidste transcriptfragment "ren" ved7.3691s (provider4200–4400ms). Completed eksakt
oprindeligt værktøj8.7118s afvises stale_input_revision8.7128s før StubTools-dispatch.
Ingen proposal/rotation/gen2 og dermed IKKE faktisk afprøvet ny spørgeinstruktion.
Én faktisk session, nul effekter, finalusage54voice-sekunder og13303backendtokens.
Assay usage_complete=false kræver to generationer; den ene faktiske sessions usage
ER final. Uafhængig Astra-audit matcher source/artifact/hash og fuld PCM-resampling.
Cleanup nu præcist lokaliseret: finalusage/closed/readerdone ved60.7562s;
manager_exit starter60.7562s og annulleres62.0057s af ydre2s provider-step.
HTTPclientclose afslutter normalt62.0177s efterca12ms. .82 genstartet og Kører
frisk verificeret. Ingen fortsatte prøveprocesser eller installation.
Stop-the-line på yderligere API-prøver: hele inputfragment→backendstart→completed
forslag→revisionguard skal forklares uden at opfinde lokale semantiske ture.
Separat ejerskabsreview undersøger Live SDK-close kontra eksisterende12s samlet
teardown/6s rearmreserve; endnu ingen timeoutpatch. De to kendte fejlgrænser holdes
adskilt. Kandidaten er fortsat IKKE testklar; heller ikke kun fordi softwarefast
eller instruktions-ACK senere skulle bestå.

Frosset kandidat14/9 har uafhængigt Astra HIGH scoped GO: Thin
 d0c4dfcbe5a09cd8eef45fc2a5ab1f7bd1119a835b06b81787ecc5245e4e5de5 og test
1f1ab2b0f7102475a4c41e922483f3d5c91c9704968a11aafc1b1cd58eb6775c (181Thin/SDK
regressioner); evaluator85055009571f58b72e435075cde2d392340e9b4fb8ca04555c99d345baac2d51
og tests3b483318c7e041088e602fd7e17166c649e653818f426361dd058c47eaacc225 (63tests).
Samlet autoritativ fast96631 er faktisk terminal exit0: Ruff/format43filer,
mypy50sources og hele pytest95.07s, samlet95.5s. Ingen kode/docs ændret under gate.
Næste gate er én afgrænset positiv faktisk API-prøve; helper03 er samme reviewede
mekanik med nye sourcepins/outputmappe, SHA68bc7b1673e79bddc8a6427a9b3ed322d72c22adee1dbc686ef4f4578bf01706.
50runtimefilers manifest560f111302c6e28b31f97b25e3579d613b43f1639a6b01837669bd1cdbe14c12.
Der er ikke kørt releasegate, ny installation eller fysisk gate. Gammelt farvel-UX,
fuld funktionsparitet, cleanup og fysisk duplex/latens er fortsat åbne.

Release-observation afgrænset14/9: SDK3.13's manager.__aexit__ afventer WebSocket
close, mens AsyncOpenAI.close afventer HTTPX.aclose. Lead godkender to små lokale
forwarding-observatører i developer-evaluatoren omkring netop disse faktiske await-
kanter. De bruger eksisterende statiske close_phase-labels, kalder originalen én
gang og bevarer returværdi/cancellation/error. Ingen global monkeypatch, alternativ
cleanup, længere timeout eller skjult retry. Regression injicerer cancel/error i
hver kant og kræver korrekt ejerfrigivelse samt UNKNOWN ved manglende bevis.
Formålet er at skille socketmanager fra HTTP-client i næste allerede afgrænsede
måling; produktrettelse må først besluttes ud fra det faktiske resultat.

Anden faktiske prøve02 er terminal UNKNOWN: proces1445 parent exit0/evaluator2.
Ingen gen2-transcript/backend/spørgsmål og ingen positiv fixture; to providerstarts,
nul stubeffekter, finalusage7+42=49voice-sekunder og13429backendtokens. Astra har
uafhængigt verificeret identiteter og eksakt PCM-resampling. .82 er genstartet og
Kører frisk verificeret. Teardown-timeout er nu lokaliseret efter providerens
finalisering: close60.0048s, request return60.0052s, release enter60.8801s med
finalusage/closed/readerdone alle sande, release cancel62.0071s. Gen1 release tog
1.880s og bestod. Manager/socket kontra HTTP-client release er stadig ukendt;
ingen timeoutændring er begrundet endnu.

Aktiv årsagsbeslutning — begynd det friske godkendelsesspørgsmål via officiel
Live-mekanisme. Prøve02 beviser tavshed under gen2 stilhed; nuværende rotation
konfigurerer spørgsmålet i startup-instruktionerne, men sender ingen frisk speech-
first-instruktion efter session.started. OpenAI-guiden genlæst14/9 beskriver netop
session.instructions.append med delegation_id=null efter opstart, korreleret
session.instructions.appended, fortsat inputaudio/stilhed og valgfrit kort
commentary.append. Kilde: https://developers.openai.com/api/docs/guides/live-conversations#greet-before-the-caller-speaks
Hypotese: én frisk dansk instruktionsappend efter ny capture/pump er aktiv anmoder
modellen om at stille sit allerede konfigurerede spørgsmål før brugersvar. Brug
først den eksisterende append_instructions-adapter; ingen ny abstraktion eller
syntetisk brugerbesked, backendresponse, approve_action eller completion-ACK.
Berørt kæde: fastholdt forslag→gammel finalisering→frisk capture/provider→instruktions-
ACK→modelspørgsmål→ægte input→completed approval→dispatch→close/rearm; både native
og Talk. Invarianter: én Thin-ejer, eksakt generation/engangschallenge, ingen
instruktion som frisk brugerinput, OFF uændret, Stop/expiry/stale ACK fejler lukket.
Regressionskrav: audio kan fortsætte mens ACK afventes; forkert/stale ACK er inert;
Stop/expiry/ny generation under await kan ikke fremkalde sen tale/dispatch; ingen
inputrevision eller godkendelse fra append alene. Hold startup-/close-timeouts,
model/voice/backend og andre prompts uændrede. Manglende spørgsmål efter append
forbliver måleresultat; ACK er ikke tale eller fysisk playback. Runtimepatch kræver
uafhængigt review, målrettet Thin+adapter og relevant samlet fast før ny live-gate.
Rollback er denne særskilte instruktionskant. Alpha fortsat ikke fysisk testklar.

Evalrettelsen har nu uafhængigt Astra HIGH scoped GO på script
 d81aaa32a59cac8016fc183144bda2835c29d0aa13824298374f6a69b02b195e og tests
4b2d30a31274e0b20c6957a83e1d9d7f15b790df9363ec942fd05ddbcd76679b.
57 fokuserede tests består uafhængigt. Før-spørgsmål/før-fixture inputkvitteringer
med senere providertimestamps giver UNKNOWN; oprindelig prøve01 forbliver UNKNOWN.
Evaluator venter nu på den deklarerede syntetiske spørgetekst med terminalt '?',
frisk generation og gyldige fremadgående providerintervaller. Parafrase eller intet
spørgsmål giver intet syntetisk svar/UNKNOWN, ikke en produktfejl. Close/request_close/
release har developer-only enter/return/cancel/error-observationer og scalar-state;
produktionens timeouts/semantik er uændret. Helper02 ændrer kun scriptpin og ny
outputmappe, SHA f720b4707d38a04c285b4d84401167e09495bcc4cae38a2b4c4c9994db3b5ebb.
Anden afgrænset API-prøve startet i proces1445 efter frisk Kører→Stoppet i HA.
Output /private/tmp/podvoice-live-confirmation-positive-02; resultat afventes.

14/9 faktisk positiv API-prøve01 — UNKNOWN, ikke semantisk accept. Efter brugerens
strømtilslutning blev .82 Kører frisk verificeret; Stop blev kvitteret Stoppet før
engangs-handoff. Proces97828 afsluttede faktisk: evaluator exit2, parent exit0.
Rapport: /private/tmp/podvoice-live-confirmation-positive-01/report.json. To
providerstarts, final usage på begge generationer (7+41=48 voice-sekunder; tre
backendresponses, i alt21137tokens), nul lokale stubeffekter. .82 blev genstartet
og Kører frisk verificeret bagefter. Ingen fysisk playback, installation eller
hjemmehandling i prøven.
Uafhængig Astra-kontrol bekræfter source-/fixture-/artifactidentitet og eksakt
pending proposal + historik i frisk provider. Men syntetisk ja blev sendt18.229–
19.151s og genkendt på gen2 interval2800–3400ms FØR faktisk nyt spørgsmål på
5800–8200ms (host23.153–25.462s). Åbningsdiagnostik mangler desuden sidste suffix
("hoveddø"), hvorfor exact opening-recognition ikke består. Provider-close ramte
2s teardown-step-timeout ved62.007s, selv om finalusage foreligger. Ingen af disse
observationer må omtales som vellykket autorisation eller fysisk forståelse.
Aktiv næste årsagsgrænse er testfixture→provider-spørgsmål→frisk fixture, ikke
runtime-authorisation: evaluatorens fase1/readiness er ikke bevis for et stillet
spørgsmål. Ret kun developer-evaluatorens rækkefølge og instrumentér manglende
close-kanter før ny API-prøve. Invarianter: ægte Thin/SDK/policy, ingen opfundne
provider-ACKs, højst2connects/60s observation, ukendt input/cleanup giver UNKNOWN.
Hypotese: vent på observeret nyt spørgsmål, så fixtureintervallet først begynder
bagefter; manglende eller stale spørgsmål skal blive ukendt, ikke udløse et ja.
Timeoutårsag er endnu ukendt: close omfatter request/finalusage, SDK-reader,
manager og client-release. Ingen runtime-, prompt-, VAD- eller timeouttuning uden
lokaliseret await/evidens. Regressionen skal genafspille observeret før-spørgsmål-
sekvens og afvise den. Rollback er developer-script/tests; uafhængigt genreview
kræves før en ny API-prøve. Kandidaten er fortsat ikke fysisk testklar.

Genoptaget 14/9 efter brugerens eksplicitte destinationsgodkendelse: push af
reviewet commit a6b548af4d844add60b69e735c31c1fdca2d55d2 til den separate branch
codex/gpt-live-alpha-research i BixelVentures/podvoice lykkedes (proces33627,
exit0). Ingen merge til main, release eller installation. Den tidligere
publiceringsblokering er dermed fjernet. Uafhængig Astra-verifikation har nu
hentet den eksakte firmwarepin b56a08a6d31044f7507b178961ac74f731474253 fra GitHub
ind i en ny bare repo uden lokale objekter. Alle18 komponentfiler matcher både
reviewet repo, lokal buildkopi og provenancefilens SHA256; ordnet manifest er
25f0c9a87232d3bc043466e36dc87be77d4b95365d51850d176d264a04f098e2.
Remote-kilden er dermed bevist hentbar og byteidentisk. Dette ændrer ikke den
historiske dummy-PSK-build til en provisioneret installationsartifact.
Mac/browseradgang virker igen. HA-info viste først cached 1.13.82/Kører med
forbindelsesfejl; frisk reload og HA's egen Retry now endte begge på Unable to
connect to Home Assistant. Derfor er nuværende driftstilstand UKENDT, ikke bevist
Kører. Den dokumenterede lokale adresse homeassistant.local:8123 fejler DNS-opslag.
Ingen nøgle er læst, ingen produktionsservice stoppet og ingen ny API-prøve startet.
Den reviewede positive eval afventer adgang til eksisterende konfiguration og et
verificeret isoleret testvindue. Der udledes ingen runtimefejl af forbindelsesfejlen.

Lokal nøgle-handoff har nu scoped GO efter uafhængige Python3.12.13 socket-tests:
partial body0.253s og tricklede headers0.329s, ingen accepteret nøgle. Reviewer
verificerede finally-close og global admissionalarm. Endelig helperhash
3bb2d7801432300ead1509b43bf25ead4c2c9291fa6cf9bd0af5593bf9bb4ccc afviger fra
reviewet helper kun ved opdateret, reviewet evaluatorpin; begge sourceguards består.
Leadens validate-only på de otte Sara-fixtures består uden providerforbindelse.
Software og den første afgrænsede prøve er nu konkret klargjort. Videre provider-
og installationsbevis kræver ulåst Mac til eksisterende HA-konfiguration/testvindue;
remote-publicering kræver svar på den allerede sendte destinationsgodkendelse.
Ingen faktisk API-evaluering, upload, release, installation eller fysisk gate i dette
checkpoint. Målet er ikke opnået, og ingen releasegate startes før semantisk bevis.

Syntetisk API-evaluator har nu uafhængigt Astra HIGH scoped GO på script
2ce13fa93374375361568d5353373421fedf7ed8ba2a19fb4c5f810784b5d988 og tests
d6dfd6a75dae5bf87623997068480d252073c633cf4fbe7c6fdd8ddadf7ac62a.
Alle42 offline tests består; reviewer reproducerer gammelt/overlappende output som
UNKNOWN og gyldigt senere output som OBSERVED_PASS. Eksakt startup-SEED-kontrol,
2-connect cap, ægte Thin/SDK/policy og afgrænset cleanup er reviewet. GO gælder én
afgrænset syntetisk prøve, ikke faktisk samtykkesemantik eller fysisk funktion.
De otte syntetiske Sara-fixtures er valideret; ingen provider er kaldt endnu.
Nøgle-handoff har fået global admission-deadline og bounded socketreads; ufuldstændig
body/tricklede headers lukker i lokale tests uden accepteret nøgle. Den endelige
reviewede evaluatorhash er nu pinned i handoff; endeligt handoff-review afventes.

Eval-genreview:33 offline tests består efter de første to rettelser, men uafhængigt
review reproducerer stadig forsinket gammelt output: spørgsmål på providerinterval
8000–10000ms efterfulgt af senere modtaget output fra2000–3000ms gav falsk PASS.
Kontekstcasen er derfor fortsat HOLD. Bedømmelsen skal bruge samme generation og
providerens egne intervaller; ingen omregning til hosttid. Manglende/overlappende
interval giver UNKNOWN. Startup-SEED-kontrollen er nu verificeret korrekt.
Den eksisterende engangs-loopback-nøgleoverførsel er klargjort til én positiv
60s/2-sessioners prøve i /private/tmp/podvoice-live-confirmation-handoff-01.py;
den er ikke startet. 50 runtime-Pythonfiler og evaluatorens hash kontrolleres både
før handoff og før childstart. Sourceguard mismatch-test består; særskilt review
pågår. API-vindue og faktisk prøve afventer fortsat ulåst Mac. Ingen nøgle er læst,
intet produktionsstop og intet API-kald er udført i dette trin.

Samlet fast77163 på runtimecheckpoint5e49a9c plus første frosne evalscript består:
Ruff/format43filer, mypy50sources, hele pytest88.94s, samlet89.3s. Dette beviser ikke
at evaluatorens verdict er korrekt. Uafhængigt review reproducerer to falske PASS:
mørkegrøn før followup kan tælle som svar efter followup; gammelt-ja cases kan
PASS uden bevis for at SEED var i generation2 startup input. Derfor HOLD på
evaluator fc78786a6d36eaadca8aa7063581be69791867104ae98090e29177c619ba51fb,
ingen faktisk API-prøve. Owner retter kun de to bedømmelsesgrænser efter fuld gate
blev terminal. 26 offline tests og manifestvalidering er ikke semantisk accept.
Ingen ny runtimefejl er udledt af disse testværktøjsfejl.

Efter prototypefjernelse består24 releasekontrakt/live-policy/execution-guard-tests
og git diff --check. Identitetsændringen har27 målrettede tests og uafhængigt review;
lokal firmwarecompile er bestået som beskrevet nedenfor. Dette er et lokalt
software-/buildcheckpoint; det nye semantiske evalscript er et separat ufrosset diff.

Lokal firmwarecompile faktisk bestået: proces18707 exit0, ESPHome2026.6.2,
101.80s; marker11382_livewav2 findes i den genererede binær. 13 C++/headerfiler
fra de tre pinned komponenter er byteidentiske mellem reviewet input og compilerens
src-tree; alle18 inputfiler matcher det tidligere manifest. OTA-binær3057344bytes,
SHA256 b2aefe0fdcf79af3f9974525e56482aa8cfa35994bf59d8e52cf631a0eab75a8.
Buildrapport ligger i /private/tmp/podvoice-live-alpha-build-02/compile-report.json.
Eksplicit dummy-PSK og lokale source-overrides; remote-fetch/provisionering/install
og fysisk gate er IKKE bevist. CUA viser nu låst Mac; HA/API-testvindue afventer
adgang, men intet produktionsstop eller API-kald er udført i dette trin.

Mindst nødvendig kode — lead-beslutning og uafhængigt læsereview: Den gamle
live_confirmation.py timestamp-ledger har kun sin isolerede test som importør;
SDK/Thin bruger nu execution_policy.confirm_live og frisk provider-generation.
Beholdt prototype øger artifactoverfladen uden funktion. Fjern modulet og den ene
isolerede test (714 linjer), bevar historisk evidens og alle aktive policy/SDK/Thin-
regressioner. Hypotese: ingen aktiv import/eksport/schema/buildreference ændres;
Docker kopierer mindre kode. Invarianter er én autorisationsvej, uændret runtime-
ejer og eksakt artifact. grace_review har verificeret import-/buildergrænsen.
Stage begge sletninger før gate: selector-only-prøve viser ellers at dev-tooling
vælger den slettede test; staged deletion vælger eksisterende fuld testsuite.
Rollback er de to filer; ingen fysisk accept eller release arves.

Firmwareidentitet har uafhængigt Astra HIGH scoped GO og27 firmware/native tests
bestået. Push til origin blev afvist af automatisk godkendelseskontrol med krav
om specifik destinations-/publiceringsgodkendelse. Intet upload blev udført;
spørgsmål er sendt til brugeren. Arbejdet fortsætter med lokal dummy-PSK compile
på byteidentiske lokale komponentkilder, som ikke beviser remote-pinned fetch
eller provisioneret artifact. Disse to gates afventer fortsat separat bevis.

Præcis firmwarekandidat — aktiv lead-beslutning: Alpha-overlay og host accepterer
stadig den ældre prototypeidentitet podvoice_build_11379_livewav1, selv om capture
hold/resume og disconnect-fence siden er ændret. Hypotese: en ny specifik marker
podvoice_build_11382_livewav2 binder denne Alpha-kandidat til hostens forventning,
så den gamle prototype ikke kan bestå kontrakten under den nye identitet.
Berørt kæde: kildepinned ESPHome-build → annonceret firmwaremarker → VoicePELink
kontrakt → Alpha-admission → capture/playback/rearm. Invarianter er eksakt artifact-
identitet, OFF-kontrakten og ingen arvet fysisk accept. Ændringen er kun de to
Alpha-markerværdier og en gammel-marker regression; ingen audio-/VAD-/gain-tuning.
Komponentkilden forbliver b56a08a6d31044f7507b178961ac74f731474253 med verificeret
18-fil manifest. Før build skal denne commit være hentbar på den faktiske Git-URL.
Første compile bruger eksplicit dummy PSK og er ikke den provisionerede installations-
artifact. Kræver uafhængigt review, firmwarekontrakt og frisk ESPHome compile.
Rollback er hele Alpha-kandidaten; ingen firmwareflash i dette trin.

Kontekstcheckpoint efter P2: regressionen fejlede med assistent før bruger på
urettet kode og består nu gennem rigtig SDK-eventkø. 71 Thin+History-tests og Ruff
består efter timestamp-rettelsen. Uafhængigt Astra HIGH genreview giver scoped
composed GO efter16 fokuserede historik-/konteksttests på Thin
5166395aae345b7b9d8ded11491a8f044ea4ec5fc7b03b9d09ac6955edab586f.
SDK84a365629c7e1577c4eb4a813ec5ba99b49e8ca74806da341a1df6ece1710377 og
prompt635f04036dcc1b89d309b32fa23c0862fc2f2735e5d45f118cbc8b3e540e4b8d
har124 enhedstests samt Ruff/mypy bestået. Ingen resterende deterministisk finding
på dette reviewscope. Den tidligere hele fast er på diffet før den lille timestamp-
rettelse; målrettet regression og review dækker rettelsen. Ingen releasegate endnu.
Næste konkrete gate er isoleret, bounded API-evaluering med rigtig Thin/SDK/policy,
to providergenerationer højst, syntetiske danske fixtures og kun lokal stubeffekt.
Nul effekter uden genkendt fixture/proposal/fresh session må ikke kaldes semantisk
PASS. .82 produktion og tidligere fysisk baseline ændres ikke af dette checkpoint.
Alpha er stadig ikke installeret eller fysisk godkendt.

Samlet fast på kontekstdiff før nedenstående P2-rettelse: session5879 exit0;
Ruff/format43filer, mypy51sources, hele pytest84.80s, samlet85.2s. Uafhængigt
kontekstreview består194 målrettede tests, men reproducerer P2: typed text får
ankomsttid efter await SDK-send, så hurtigt provider-output kan gemmes før sit
udløsende spørgsmål. Årsagsgrænse: Thin accepteret tekst → await response.create
→ samtidig transcript → historiksortering → næste provider startup input.
Ret kun tidspunktets ejer: fang tidspunkt ved tekst-admission og brug det ved
vellykket persist sammen med allerede fanget session-id. Ingen falsk provider-ACK
eller ændret godkendelsesrevision. Regression injicerer output mens SDK-kaldet
stadig afventer og kræver bruger før assistent i gemt og gendannet tekst.
Samme-session/ordre/OFF-invarianter berøres; rollback er denne timestamp-rettelse.
Resultat og uafhængigt genreview afventes, ingen fysisk acceptance arves.

Faktisk P1-resultat: initial/post-rotation Talk-heartbeat og tom/whitespace input
reproducerede fire fejl før rettelsen. To Thin-betingelser retter de ejergrænser;
55 Thin-tests, Ruff/format/mypy består. Uafhængigt Astra HIGH genreview har scoped
GO efter15 fokuserede regressioner på Thin a4f693afc230d4fa629738c1628313474070e1466af2620dd91178bba43154fd.
Readerfejl og native pumpfejl lukker stadig korrekt. Denne accept omfatter ikke den
nye kontekstintegration nedenfor eller fysisk alpha.

Kontekstintegrationens første faktiske softwarebevis: History.session_text filtrerer
præcis room/session, uden fallback til nærliggende samtaler. Thin samler tilstødende
samme-rolle-fragmenter med newline, beholder en sammenhængende nyeste del inden for
SDK-bytebudget og skærer aldrig inde i et fragment. Snapshot tages efter gammel
reader er samlet op og stages én gang; typed text gemmes én gang under oprindelig
session. Test viser historisk ja i session.input, uændret frisk-inputrevision og nul
handling uden nyt input; næste wake får ingen gammel startuphistorik. 58 Thin Live
og12 History-tests består; Ruff og mypy på de to kilder består. Thin hash
f3b4c913eb6f1a40ae13fe00e29e9ad7c7de1d77015b99d9638095232ee257d7.
SDK/prompt-ejer færdiggør særskilte tests; samlet review og semantisk API-gate mangler.
Ingen påstand om bevaret intern provider-state eller fulde toolresultater.

Kontekstkontinuitet gennem godkendelse — aktiv lead-beslutning: Den nye provider
modtager nu kun det serverholdte forslag; tidligere samtaletekst mangler, så
opfølgninger kan miste deres referencer. Dette er direkte kodebevis, ikke en
observeret akustisk fejl. OpenAI Live conversations-guiden, genlæst 11/9, understøtter
startup session.input med tidligere rolleopdelte tekstbeskeder (128 beskeder/8192
samlede tokens). Vi vælger denne officielle mekanisme frem for store/fork.
Hypotese: et immutable snapshot af netop samme Thin-session giver tekstkontinuitet,
uden at historik kan hæve frisk-input-revisionen. Snapshot mærkes som tidligere
kontekst i både primary- og backendinstruktioner; forslag og engangsautorisation
forbliver særskilte serverdata. SDK accepterer højst64 user/assistant-beskeder med
samlet UTF8(role)+UTF8(text)+32 bytes per besked højst6000; dette er en konservativ
bytegrænse, ikke en tokenmåling. Default uden historik ændrer ingen prompt/config.
Kæden er eksisterende transcript/typed input → samtaleejet historik → capture hold
og gammel provider-finalisering → engangsstaged startup input → frisk capture/input
→ completed approval → eksisterende exact-args guard → opfølgning/Stop/næste wake.
Invarianter: samme samtale/room, ingen historisk event som frisk input, ingen replay
af handlinger, Stop/generationsisolation, én Thin-ejer og OFF uændret. Ikke-mål:
fuld intern provider-state, ny lagerpolitik, modelbaseret summarizer eller lokal
fortolkning af ja/nej. Fejl/oversize må ikke lække data til næste connectforsøg.
Regressioner: forkert room/session, rollebevaring, immutable payload, næste wake,
Stop/failed connect, typed input, og intet nyt input giver mekanisk nul effekt.
Semantisk API-gate kræver gammelt ja + nyt nej/forbehold/baggrundstale/rettelse,
ændret mål samt positivt nyt ja; alle home-tools er stubs. Historik kan ikke alene
bevise korrekt modelsemantik. Uafhængigt review og faktisk negativ API-evaluering
kræves før alpha-installation; fysisk gate stadig ikke bestået.

Aktiv afgrænset P1-korrektion efter uafhængig reproduktion: Talk Live WebRTC har
bevidst ingen Thin PCM-pump, men heartbeat behandler `_pump is None` som fejl og
lukker den ellers fungerende samtale; fejlen gælder også efter bekræftelsesrotation.
Separat kan et tomt eller whitespace-only Live-inputfragment øge inputrevisionen,
så et efterfølgende eksklusivt approve_action kan passere fresh-input-gaten uden
indhold. Komponenttests var for korte til første heartbeat og prøvede ikke tomt
providerinput. Dette er kode-/reproduktionsbevis, ikke en ny fysisk observation.

Berørt kæde: browser-peer/native pump → Thin heartbeat/reader → Live inputfragment
→ fresh-generation/revision → completed approval → policy/dispatch → Stop og næste
wake. Hypotese: heartbeat kræver pump kun på en pump-ejet transport, mens tomme
inputfragmenter aldrig flytter autoriserende revision. Begge rettelser ligger i
Thin; native pumpfejl og alle readerfejl skal stadig lukke sikkert. Berørte krav:
én samtaleejer, lifecycle/readiness og invariant14's serverautoriserede konkrete
handling samt generations-/Stop-isolation. Ingen timeout-, VAD-, prompt-, grace-
eller firmwaretuning; ingen historikimplementering i dette diff. Regressioner:
faktisk Thin/BrowserLink/SDK før og efter rotation over heartbeatgrænsen, native
pump- og readerfejl, tomt/whitespace-fragment før approval giver nul effekter, og
normal frisk input godkender fortsat præcis én handling. Uafhængigt re-review efter
fokuserede tests; ingen fuld gate, API, release eller installation i denne patch.
Rollback er de to Thin-betingelser og deres regressionsdiff. Alpha er fortsat ikke
fysisk eller semantisk accepteret.

Syvende faktiske isolerede API-prøve (4s grace, evidence-api-02) er afsluttet:
én tool/result/continuation, backendcompleted→close4.004s, officiel closed/finalusage
15.0s, backend1074+1133tokens. Faste testfrasers SHA256-match viser forventet
“Farvel, og tak for den hyggelige snak.” ved6000–7800ms efterbackendcompletion;
men også et tidligt “Farvel.”3400–3800ms førcompletion. Derfor er protokol og
post-backend-output observeret, men dobbeltfarvel er stadig UX-fejl; ingen akustisk
eller fysisk accept. Capture460800PCMbytes/156964WebMbytes gemt. .82 blev stoppet
og efter prøven genstartet, “Kører”1.13.82 bekræftet på HA-screenshot. Ingen Alpha-
installation. Samme process13980 blev fulgt til exit0 trods click-observationstimeout;
inget ekstra API-kald. Ingen længere grace vælges; uafhængigt evidensreview pågår.

Capture hold/resume har nu uafhængigt Astra HIGH scoped GO (grace_review),69tests
(65native/host +4C++harness) består. Den præcise unsubscribe/samme-pointer-race er
rettet og genprøvet uden mellemliggende loop; ingen åbne P0/P1/P2 på denne grænse.
Source er frosset i b56a08a6d31044f7507b178961ac74f731474253. Overlayets to
komponentrefs peger nu på den præcise lokale commit;18filers manifest
25f0c9a87232d3bc043466e36dc87be77d4b95365d51850d176d264a04f098e2 er verificeret,
12firmwarekontrakttests består. Ref er endnu ikke publiceret/fetchet af et
rigtigt firmwarebuild; dette er ikke release eller device-bevis.

Forudsætninger under implementering/review: SDK/prompt95tests består også ved leadens
uafhængige genkørsel; normal default/custom prompt er uændret når flag er OFF. Native
barriere64tests og4C++harness består. Adversarial review fandt VA unsubscribe/resubscribe
på samme pointer uden loop kunne genbruge token: den vendorede VA-disconnect-handler
kalder nu stop_streaming synkront, med C++-regression og faktisk YAML-kontraktstest.
Talk-review fandt peer lukket før provider session.closed; hold ændres til mic-held
med primary/DC bevaret indtil officiel finalisering. Sammenkobling i Thin pågår.
Den nye firmware er ikke repinnet/provisioneret: sourcefreeze, manifest og særskilt
Alpha-buildidentitet skal opdateres før artifact-gate; ingen gamle bit-claims arves.

Næste implementering: frisk provider-generation til stemmegodkendelse inden for
samme Thin-samtale, brugerautoriseret Alpha-paritet. Observeret mangel: Live-dispatch
returnerer confirmation-unavailable; den gamle unwired timestamp-ledger kan ikke
bruges, da protokolprøverne ikke leverer den nødvendige nye delegation/ask-anchor.
Kodegennemgang på begge I/O-adaptere viser eksisterende stop/start kun rydder host/
ring et øjeblik; passive callbacks og et allerede dequeued pump-frame kan krydse
providergrænsen. Hypotese: tokenbundet firmware hold→ordnet held-ACK→frisk provider
→matching resume, plus cancel/join af gammel pump/send, udelukker gammel forwardet
lyd uden at ændre native PCM-format. Hold blokerer også keepalive/start/begin;
ACK skærer host-epoch synkront før waiter vågner. Samme native forbindelse kræves.
Dette er forwarding/callback-grænse, ikke påstand om ADC-flush eller hørt spørgsmål.

Berørt kæde: fysisk capture/ring/native queue → VoicePELink → Thin pump → SDK-
generation → completed tool/admission → serverholdt engangsforslag → provider-
rotation/fresh input → confirm_live/exakt ApprovedCall → eksisterende dispatchguard
→ playback/Stop/teardown/rearm/næste wake. Thin beholder history/epoch/attention;
rotation er ikke wake/teardown. Gammel usage bevares før SDK reconnect. Talk bruger
frisk peer med eksplicit bevaret mic-intent og ingen mic-permission for typed-only.
Eksisterende approval-mode=live, original expiry og serverholdt args-hash genbruges;
ingen modelleverede erstatningsargs, gamle ja-fragmenter eller lokal taleparser.

Invarianter: én Thin-ejer, én native adapter, firmware mic/rearm-ejer, eksklusiv
completed tool-admission, Stop/privacy, generationsisolation, OFF uændret og ingen
fabrikeret turn/audio-done. Ikke-mål: ny transport, gain/VAD-tuning, ADC-proveniens,
nyt ledgerlag eller fysisk accept fra tests. Regressioner: hold/start/keepalive,
gammel token/ACK/reconnect, PCM før ACK leveret senere, allerede dequeued send,
Stop i alle awaits, ny generation, typed-only/mic-intent, expiry/replay/mixed batch
og guard efter awaited target-preparation. Host C++ + begge adaptere + Thin/shared
policy, uafhængigt Astra HIGH review, derefter fast/semantisk live-gate på frosne
bits. Firmware-kildepin skal matche faktisk bygget komponent før provisionering.
Rollback: Alpha OFF og hele provider-rotation/hold-diffet; ingen installation før
sammensatte gates. Kandidaten er ikke fysisk testklar.

Terminalreceipt-diffet har uafhængigt Astra HIGH scoped GO (grace_review):110 tests
(78 SDK +32 Thin) består. Tre reproducerede races er rettet: nyt backendarbejde
invaliderer gammel close permanent; correction før waiterstart annullerer receipt
synkront; gammel waiter/callback må ikke ændre ny ejers ending-state eller receipt.
Reviewede sourcehashes: SDK b97bb4ffe519c646c8dee5f35283082fe45d39ae237a9ede48d8a4c21c7367e9,
Thin f48ed33474322a0768af6082d15874f5e1c6994c46a46877aa7dd97b3c55165b.
Samlet fast14942 består Ruff/format/mypy; pytest blev ugyldiggjort af sandbox
socket.bind PermissionError, isoleret med én aiohttp-test. Genkørsel80961 med
loopback-adgang har én gammel Talk-testfejl (direkte internt funktionskald uden
receipt). Testen går nu gennem faktisk SDK backend-end/result/continuation og
alle4 Talk WebRTC-tests består. Ingen runtimepatch afledt af miljø/testfejlene.
Samlet fast83849 på det frosne diff består: Ruff/format38filer, mypy51sources,
hele tests-træet83.63s, samlet84.1s. Release/install/fysisk gate stadig ikke bestået. Grace er fortsat eksplicit heuristik og stemmegodkendelse mangler.

Den forberedte 4s-prøve evidence-api-01 udløb før browserens Start: kun prepared/cleanup,
0 bytes provider/browserlyd og ingen API-session. Proces74052 er terminal. Næste
browserkontrol møder låst Mac; ingen Alpha-installation eller produktionsstop er
udført i denne prøve. Softwarearbejdet fortsætter; dette er ikke en providerfejl.

Næste runtimekorrektion retter den observerede backend-grænse før farvel. Direkte
kodebevis: Thin starter grace efter send_tool_results-return; LiveBackendComplete
emitteres før klassifikation af function-items; enhver response.created rydder den
nuværende globale continuation-inflight. Ingen af disse er et korreleret settlement.
Adapteren får én generation/batch/delegation-bundet terminalreceipt registreret før
resultatskrivning, bundet først når faktisk continuation udsendes og dens nye respons
observeres. Den afsluttes kun efter korrekt completed nul-call respons og intet
udestående krævet arbejde. Flere toolcalls opgiver natural-close, men må dispatches.
Thin venter uden tool-lock og bevarer inputrevision/epoch/Stop-grænser. Stemmeinput
og accepteret typed correction afbryder pending settlement/grace; silent-end venter
samme backend men uden talegrace. Tests: sen/foreign/duplicate respons, completion
før write-return, flere toolcalls, typed/voice correction, Stop→ny wake→sen completion.
Ingen output-done-claim. Graceværdien optimeres først fra den separate lydprøve.
Adversarial review reproducerer ny backend under grace: gammel close ville lukke
med pending response. Derfor invaliderer adapterens næste response.created permanent
det afsluttede intent; Thin genkontrollerer efter settlement og før close. Regression
skal dække både pending og allerede færdigt nyt arbejde samt køet event.
Rollback er receipt/Thin-ending-diffet; uafhængig anden reviewer før accept.

Uafhængigt API-review af backend-first-prøven finder3.35ms fra sidste backend-
completion til close-request; sidste output-PCM ligger før completion. Kun output-
transcriptet3200–3400ms ligger før første tool-completion. Protokol består, farvel-UX
fejler: øjeblikkelig close giver ikke den primære stemme en brugbar mulighed for
farvel. Mindste næste developer-kandidat bevarer prompt/tool/continuation og tillader
4.0s eksplicit eksperimentel, annullerbar ending-grace EFTER completed continuation,
med I/O åbent. Ingen tale-færdig-claim, ingen stilhedsdetektor/ny LLM/prompttuning.
Derefter samme officielle close/closed og cleanup; samlet30s bound bevares. Grace
skal afbrydes af Stop og må ikke skjule manglende farvel i capture. Valget4.0s er en
prøveværdi for levedygtighed, endnu ikke målt optimum eller runtimegodkendelse.

Samlet fast på f293e65: Ruff/format38filer og mypy51sources består; pytest82.14s
har én fejl i gammel string-kontrakt test_panel_contract.py:169, som kræver direkte
pagehide→micStop. Shippet handler lukker nu også Live-peer før micStop. Dette er
observeret forældet testforventning, ikke grund til runtimepatch. Testen opdateres
med faktisk side-/socketcleanup og relevant browseradfærd; genkørsel skal dække den
invaliderede pytest-gate. Checkpoint er endnu ikke samlet grønt.

Talk WebRTC-wiring har nu uafhængigt Astra HIGH scoped GO uden åbne P0/P1/P2 på
Thin dabd0a4d / Talk03b2cbcd / UI230c4b57. Reviewer gentog106 tests og kørte den
faktiske browserkode med ekstra Stop-races: pending getUserMedia, sen remoteanswer,
gammel datachannel/ontrack og ny peer. Mikrofon forbliver gated før live_ready;
sideband alene åbner ikke readiness. OFF og nul dobbelt media består. GO gælder
software og næste bounded rigtig Talk-prøve; sekssekunders-grace og fysisk/akustisk
oplevelse er fortsat ikke accepteret. Dette checkpoint fryses nu til samlet fast.

Backend-first developer-prøven1fa1d10f er afsluttet med proces0 og korrekt protokol:
én delegation ved3000ms, ét eksklusivt terminalværktøj/resultat, én faktisk completed
continuation, så close/closed. Finalusage15.0s, backend1070+1134tokens. MEN forventet
farvel mangler i outputtranscriptet: kun ét6-byte fragment ved3200–3400ms, ikke match
til den kendte farvelsætning. Capture/providerlyd er gemt, ikke fysisk gennemlyttet.
Dette er protokolbevis, IKKE bestået farvel-UX. Evidence: leverancens
api-proof/farewell-backend-03 og samme /private/tmp-kildemappe. .82 er genstartet og
Kører verificeret. Uafhængigt lyd-/eventreview pågår før konkret næste korrektion.
Talk-wiring er frosset til uafhængig review med106 targeted tests, Ruff/mypy/JSsyntax
bestået; samme source er endnu ikke samlet fast/release-/fysisk godkendt.

Det afsluttede Astra HIGH lifecycle-review anbefaler én konkret backend-first kandidat:
accepter end-intent under eksisterende input/generation/Stop-guards; færdiggør resultat
og nødvendig continuation; close; bevar media/readers til closed og finalusage; cleanup.
For WebRTC er officiel cleanup efter closed en gyldig implementering, selv om fysisk
dræn ikke er bevist. Fravær af ekstra browserdræn-ACK må ikke alene skabe en runtime-
fejl; telemetry skal stadig sige drain unconfirmed. Voice PE kræver derimod stream-EOF
og den eksakte fysiske playback-lease færdig. Rejektionskriterier for kandidaten:
manglende/klippet farvel i faktisk capture, tabte handlingsresultater, tidligt annulleret
continuation, ny input der ikke afbryder pending close, fejl i Stop/finalusage/stale.
Dette præciserer nedenstående midlertidige unconfirmed-slutvej; ingen fysisk gate er bestået.

Astra HIGH lifecycle-review har korrigeret en for stærk implementeringsforudsætning:
der kræves ikke et ekstra deterministisk spoken-finish-event for at implementere
den officielle close-protokol. Det kommende developer-forsøg erstatter den afviste
farvel-før-delegation-rute: backend modtager end-intent, completed eksklusiv terminal-
stub får resultat, den krævede Responses-continuation afsluttes, så session.close →
session.closed/finalusage → adaptercleanup. Naturligt farvel styres i Live/backend-
resultatprompt; faktisk lyd må bagefter afvise afklippet/manglende farvel. Backend-
completion er aldrig audio.done. Ingen ny timer som tale-bevis, ingen lokale fraser.
Samme syntetiske fixture, muted capture, tids-/værktøjsgrænser og credentialhåndtering.
Kun developer-probe og regressioner ændres nu; normal probe bevares, tidligere kilder
og fejlede prøver er frosset. Review før API. Runtimeændring følger først efter bevis;
Voice PE's fysiske playback-events kræves fortsat ved den fysiske releasegate.

Den kontrollerede policy-prøve c84ed4c2 er nu afsluttet og AFVIST på samme terminal-
gate. Begge14 fragmenters hashes matcher igen kendt input og hele farvelsætningen;
nul delegation/backend. Finalusage28.0s og session.closed modtaget; deadline-close,
ikke semantisk close. Evidence: /private/tmp/podvoice-live-farewell-policy-02 og
leverancens api-proof/farewell-policy-02. .82 er genstartet og Kører verificeret.
Der køres ikke flere varianter af samme farvel-før-delegation-hypotese. Næste review
undersøger backend-før-farvel med officielle lifecycle-signaler og ærligt mediedræn;
inget arbitrært grace-interval må beskrives som providerens talefærdig-signal.
Talk WebRTC-wiring udvikles fortsat under den nedenstående separate ejergrænse.

Næste nødvendige Alpha-implementering er Talk WebRTC-wiring i eksisterende Thin,
BrowserLink og panel. Direkte kodebevis: adapterens prepare_webrtc findes, men Thin
allokerer stadig WAV og starter PCM-pump; BrowserLink har ingen SDP-handshake.
Hypotese: én socket-/attempt-/provider-generation-bundet handshake kan bruge den
reviewede SDK-adapter og bevare samme Thin close-owner. Kæde: eksplicit Talk input
→ frisk offer → SDKcreate/sideband → answer → faktisk primary started + sideband-
snapshot → løbende direkte media → Stop/disconnect → samme teardown → ny peer.
Invarianter: Thin-ejerskab, OFF-paritet, privacy, ingen dobbeltlyd, stale-afvisning,
readiness adskilt fra playback. Ingen nye endpoints/SDK-wrappere/samtalemotorer.
Regressioner: samme rigtige Thin/BrowserLink, forkert/duplikat/sen identitet, Stop
ved alle opstarts-awaits, typed-first uden micpermission, ny wake og nul WAV/PCM i
WebRTC. Naturligt farvel er fortsat separat uafklaret: fravær af WAV-lease må IKKE
blive succesbevis for browserdræn. Indtil policyen er bevist skal denne slutvej
rapportere dræn ubekræftet. Det er en ufærdig kandidat, ikke reduceret acceptkrav.
Rollback er disse tre filers transportwiring; Astra HIGH skal reviewe samlet diff.

Uafhængigt Astra HIGH evidence-review bekræfter alle14 transcript-hashmatches og
nul delegation/backendevents. Close blev anmodet30.023s efter session-create;
closed kom30.809s efter. Provider-PCM har tre200ms tidsstempelhuller: sammenkædet
filposition må ikke bruges som sessionsur. Begge lydfiler indeholder ikke-stille
output, men reviewet har ikke bevist hørt/fysisk farvel. Reviewer støtter kun den
kontrollerede promptprøve; ingen ekstra transskription eller rå tekstlog er nødvendig.

Promptdiffet er nu implementeret som developer-only og har93 eksisterende probe-
regressioner samt Ruff/format grønt. Uafhængigt Astra HIGH scoped GO på SHA
c84ed4c2901f9910efdd139163140e274692311e538451daa26f0dab580b4f0d;
review verificerede uændret normal config og alle øvrige forsøgsparametre. Frosset
prøve ligger i /private/tmp/podvoice-live-farewell-policy-02. Ingen ny samlet runtime-
gate kræves for dette isolerede promptforsøg; faktisk API-resultat udestår stadig.

Næste developer-only hypotese følger den friskt læste officielle live-prompting-guide:
bevar Delegation policy og dens tre labels, beskriv afslutning som backendkapabilitet
og giv en konkret delegationsbetingelse. Den fejlede prøve havde fri prosa uden denne
struktur. Kun prøvens primære prompt ændres; samme kendte farvel, før-delegation-
rækkefølge, backendstub, lydfixture, transport, close-ejer og 30s grænse bevares.
Hypotesen er falsificerbar ved fortsat manglende delegation; labels er ingen garanti.
Ingen runtime- eller OFF-ændring. Review af promptdiff og eksisterende developer-
regressioner kræves før en ny isoleret API-prøve. Rollback er kun promptdiffet.
Kilde: https://developers.openai.com/api/docs/guides/live-prompting (11/9).

Den fjerde isolerede API-prøve er afsluttet på a357d52 (WS02667b36/WebRTCb7437f15).
Resultatet AFVISER den prøvede farvel-før-delegation-kæde: ingen delegation eller
terminal backendfunktion kom inden prøvens grænse. SHA256-match mod kun de to kendte
syntetiske fraser rekonstruerer input “ Tak for hjælpen. Det var alt. Farvel” og
output “ Farvel, og tak for den hyggelige snak.”; alle transcriptfragmenter matcher.
Det støtter semantisk farveltekst, men beviser ikke lyd i rummet eller efterfølgende
lukning. Deadline udløste close; session.closed bekræftede 28.0s endeligt voiceforbrug,
ingen backendforbrug/manglende terminaler. Browsercapture og provider-PCM er bevaret
under api-proof/farewell-reviewed-01 i leverancen, med transcript-evidence.json.
Prøven returnerede farewell_trial_evidence_incomplete, ikke succes. .82 er startet
igen og HA UI viser Kører. Næste årsagsgrænse er primærmodellens delegation efter
farvel, ikke manglende input eller et påvist FLAC-problem. Uafhængigt evidence-review
pågår før ny prøve; ingen runtimeændring eller fysisk gate arves af transcriptet.

Farvel-prøvens korrigerede scripts har nu uafhængigt Astra HIGH scoped GO på
WS02667b36/WebRTCb7437f15:93 tests på1.35s plus direkte late create/attach/update-
og resistant typed-send-reproduktion. Ingen sen SDP, én remoteclose, ingen uønsket
continuation. Capture er autentificeret/bounded; fejlet optagelse og manglende eller
ikke-endeligt voiceforbrug afviser. Node syntaxcheck af den faktiske browserkode
består. Initial browserrendering kan komme før onplaying-optagelsen; dette er en
udtrykkelig måleusikkerhed, ikke bevis for providerklip. Gemte bytes eller closed
beviser ikke hørt farvel/fysisk dræn. Samlet fast på frosne filer bestod81.7s: alle valgte
tests100%, Ruff/format36 filer og mypy51 sources. Én kort syntetisk prøve kan nu
køres i den allerede godkendte isolerede pause. Frisk HA UI viser.82 Kører, R0 klar/standby, native forbundet,
PodConnect/hjemmestyring verificeret; fysisk wake er endnu uprøvet efter genstart.

Næste sammenhængende godkendelsesrute er nu afgrænset ved read-only Astra HIGH:
frisk provider-generation for den sjældne følsomme challenge, inden for samme Thin-
samtale. Der findes ingen eksisterende mid-conversation capture-ACK: stream_stop
nulstiller firmware-ring, men service-return beviser ikke effekten; fuld rearm har
uønskede conversation/reply/Stop-bivirkninger. En mulig minimal Alpha-barriere må
lukke forwarding/keepalive, nulstille ring under eksisterende mutex, observere frisk
micfremdrift, kassere kontrolvinduet og ACK'e eksakt token mens input fortsat er
lukket. Adapteren skærer lokal generation synkront ved ACK; kun matching resume
åbner lyd til den nye provider. Stop/timeout/stale token forbliver lukket. Browseren
kræver ny capture/peer-generation. Det er captureproveniens, ikke fysisk hørelse.
Ingen implementering endnu: gammel audio efter ACK, keepalive, speech over grænsen,
expiry, gammel backend og Stop skal prøves; ingen implicit fornyelse af challenge-TTL.

Developer-farvelprøvens uafhængige review er foreløbig NO-GO: den eksisterende
WebRTC-probe kan miste ejerskab til en remote session, hvis create returnerer sent
på trods af Stop/cancellation, fordi den afviser før session-id gemmes. Den normale
allerede afsluttede API-prøve havde ikke dette forløb; dens observerede transport-
resultat består, men generelle Stop-claims må ikke arves. Korrektionen beholder
sen remoteidentitet og cleanup-attach før afvisning og får permanent regression.
Dette er developer-proben; den tilsvarende runtimeadapter er separat rettet/reviewet.
Ingen ny API-prøve før reviewer lukker fundet og kontrollerer forbrug/capture-evidens.

Stop/disconnect-diffet har nu uafhængigt Astra HIGH scoped GO uden åbne P0/P1/P2.
Reviewer kørte322 tests på38.88s inklusive OFF/shared Thin, Talk, Live og SDK; root
kørte101 kombinerede regressioner grønt. WebRTC late create/attach/update med
undertrykt cancellation gav ingen sen SDP, én remote/client-close og nul leases.
Reviewed hashes: Talkb061d65b,Thinb9af8b5e,SDK29653e51,testd5e78a38. En kommando der
fortsat modsætter sig cancellation efter providercleanup beholdes ejet og logges;
shutdown påstås ikke bounded i den situation. Samlet fast på næste frosne checkpoint
udestår; intet release-/installations-/fysisk bevis er tilføjet.

Uafhængigt review fandt desuden P1 i den samme Stop/disconnect-kæde: ved sockettab
venter run_talk på en annulleret commandworker FØR session.aclose. En virkelig
Thin/BrowserLink-prøve med cancellation-resistant typed SDK-send holdt derfor
Thin aktiv uden nogen providerclose, også efter SDK-deadline. Årsagen er inverteret
cleanup-ejerskab, ikke netværkets varighed. Korrektion inden for samme Talk-diff:
start den eksisterende Thin shutdown/close før join af commandworker, så resource-
cleanup kan frigøre SDK-send; behold ejerskab og rapportér uafsluttet cleanup ærligt.
Regression dækker sockettab under typed send og eksisterende Stop, næste wake og
forsinkede gamle events. Astra fandt også at direkte Thin.aclose ikke annullerer
Live-opstart før settle: en sent returneret connection kunne derfor stadig starte.
Lead retter aclose til at bruge den eksisterende _request_close(shutdown) og afvente
samme shieldede close-owner; direkte teardown er kun fallback uden aktiv samtale.
Det bevarer central task-annullering, inputfence og ressourceejerskab for begge I/O.
Kandidaten forbliver ikke testklar til review er lukket.

Stop-regressionen har nu direkte sammensat modevidens:18/19 targeted består, men
real Thin+BrowserLink med SDK __aenter__, der ignorerer cancellation, kan sende
session.start efter Stop. Thin afventer først åbningens retirement, så adapterens
closeflag er endnu ikke sat. Kandidaten er IKKE testklar. Mindste årsagsrettelse:
provideropstart skal afvise en faktisk annulleret ejertask efter ethvert SDK-await,
før start/answer/readiness kan blive accepteret. Det må ikke ændre graceful close
eller normale responses. Den forsinkede forbindelse skal stadig frigives af samme
owner. Regressionen bevares; independent review skal kontrollere begge transporters
sene create/attach og næste wake. Ingen runtimepatch på timeout alene. Root har
nu tilføjet kontrol af opstartsejerens faktiske cancellation efter attach og i
kommando-admission før readiness. Den tidligere røde sammensatte regression og
de77 valgte Talk/Live-adaptertests består. Independent Astra HIGH-review pågår;
ingen samlet gate eller fysisk status arves af disse deltests.

Separat developer-only næste målehypotese (ingen API-kørsel endnu): Live siger et
kort genkendeligt farvel FØR delegeret end-intent; completed eksklusiv terminalstub
returneres uden ny backendcontinuation, derefter officiel graceful close. Bevar
providerlyd/browser-renderet lyd og faktisk session.closed hver for sig. Dette er
ikke prompt-/runtimegodkendelse eller bevis for talerækkefølge; normal probeadfærd
bevares. Ny prøve kræver frozen source og uafhængigt review; ingen HA-handlinger.

Astra HIGH-paritetsaudit korrigerer kravet til stemmegodkendelser: OFF Talk tillader
full-duplex-afbrydelse og policyen bruger ikke playback-finish eller hørt-spørgsmål
som autorisation. Den fælles kontrakt er eksakt serverholdt handling, umiddelbart
næste autoritative input, completed eksklusiv semantisk godkendelse, expiry/once og
aktuel kontekst. Alpha må derfor ikke blokeres på et ekstra krav om fysisk hørelse.
Den reelle P1 består: gammelt input må ikke ligne frisk godkendelse. En frisk Live-
generation er kun en mulig løsning, hvis gammel capture/historik ikke kan krydse
som nyt input; der opfindes stadig ingen complete-turn-event. Dette erstatter den
stærkere fysiske-godkendelsesfortolkning, ikke kravene om fysisk afspilning/lifecycle.

Næste aktive årsagsgrænse: Talk Stop under opstart. Direkte kodebevis i run_talk:
wake/text/stop går gennem samme worker, der afventer session.wake/submit_text.
En ventende provideropstart holder derfor Stop bag sig. Falsificerbar hypotese:
Stop skal nå den eksisterende Thin close-owner før opstart fuldføres; pre-Stop
kølagte kommandoer skal afvises og må ikke genåbne næste generation. Berørte
invarianter: én close-owner, privacy/Stop, stale input, samme Thin for begge I/O.
Kæde: browserkommando → kø/opstart → Thin provider/mic/afspilning → Stop → teardown
→ næste eksplicitte wake. Ingen transport-, prompt-, timer- eller policyændring.
Regressioner: blokeret wake og typed startup, queued input før Stop, gentaget Stop,
sockettab under Stop, ny wake samt sen gammel startup. Ret mindste køejer; reviewer
skal modbevise cancellation/ordering. Rollback er det isolerede Talk-diff; intet
installeres eller kaldes fysisk bevist af denne softwareændring.

Samlet fast-gate kørte alle valgte tests til100% på81.52s, Ruff/format og mypy51
sources bestod, men wrapperen afviste resultatet fordi lead ændrede STATUS under
kørslen. Resultatet tæller ikke som samlet gate. Filer fryses før én gentagelse;
ingen runtimeændring udledes af denne workflowfejl. Gentagelsen på frosne filer
bestod: fast79.4s, hele valgte testscope100%, Ruff/format og mypy51 sources. Det
er softwarebevis, ikke release-/installations-/fysisk godkendelse. Adapteren har separat Astra
HIGH GO efter rettelse af close ved receiverfejl; Talk-wiring er endnu ikke lavet.

Ny direkte evidens afviser ordinary-continuation-hypotesen for godkendelsesankeret:
den afsluttede SDK-prøve i /private/tmp/podvoice-live-ws-measurement-01/evidence
(sourcea1ea1d99) viste én delegation ved source3000ms. Frisk response.create gav
en ny respons under SAMME delegation, uden ny delegation.created eller client-id-
korrelation på response.created. Astra HIGH har uafhængigt kontrolleret det. Det
gamle offset må aldrig genbruges til frisk samtykke; ledger/wiring forbliver lukket.
Den efterfølgende instructions.append-prøve er også afsluttet: source283f23e9,
/private/tmp/podvoice-live-instruction-probe-01/evidence. Det friske event-id
korrelerede kun til ACK ved estimeret7200–7400ms;17 output-transcriptfragmenter
havde intet client_event_id, inklusive4 fragmenter og195 PCM-events efter ACK.
Uafhængigt Astra HIGH-review afviser denne konkrete korrelationsvej, ikke enhver
mulig Live-konfiguration. Finalusage26.0s, backend907+962 tokens,1279680 modtagne
og skrevne outputbytes; session.closed og procesexit0. Ingen fysisk lyd er bevist.
.82 er efter tredje autoriserede prøve igen bekræftet Kører i HA.

Målet er nu verificeret ACTIVE efter brugerens genstart. Næste afgrænsede designreview
undersøger en frisk Live-generation bundet til den eksakte challenge, inklusive om
den faktisk beviser spørgsmål-før-svar og ikke blot challenge-før-input. Det er en
uafklaret hypotese med mulig ekstra latenstid, ikke implementeringsgodkendelse.
Der tilføjes ingen alternativ samtalemotor eller lokale godkendelsesfraser for at
omgå denne grænse; stemmegodkendelses-wiring forbliver inaktiv.

SDK-prøven sluttede grønt med27.0s, backend904+966 tokens, source123834 bytes og
1292160 modtagne = skrevne outputbytes inklusive terminallyd. Output-WAV og3312
ordnede tidslinjeevents er bevaret. Dette er første måling uden tab af terminal-PCM,
men ikke semantisk farvel- eller højttalerbevis. .82 er efterfølgende startet igen
og “Kører” bekræftet i HA. Begge pause/genstarter fulgte brugerens udtrykkelige ja.

Næste runtime-afgrænsning efter virkelig WebRTC-protokolprøve: udvid kun den
eksisterende OpenAILiveSession med officiel create/sideband/SDP-vej til Alpha Talk.
Samme Thin ejer fortsat budget, generation, værktøjer og close; ingen ekstra motor.
OFF og Voice PE's WS-transport ændres ikke. Kæde: bounded browseroffer → SDKcreate
→ samme-session sideband → answer sendt før ventet readiness → faktisk matching
session.updated + browser-start → eksisterende typed/backend-policy → Stop/close.
Nøgle bliver på serveren, frontend har ingen providercommand-tilladelser. Stop under
create/attach/SDP/readiness skal bevare ejerskab til sen ressource og afvise stale
generation. Der må ikke fabrikeres session.started, audio.done eller fysisk finish.
Først isoleret adapterkode og regressioner; Talk-tilkobling kræver separat sammensat
review og en ærlig løsning på terminal media-dræn. Ingen WAV-dobbeltlyd på WebRTC.

Første rigtige WebRTC/sideband-prøve er afsluttet (frosset source90d1f254/importeec62553,
evidence-api-01 i /private/tmp/podvoice-live-webrtc-reviewed-01). Præcis én session;
create → sideband attach → SDP answer → korreleret session.updated → primary started
→ typed submit → completed stub/result/continuation → session.closed blev observeret.
Forbrug28.0s, backend845+902 tokens, ingen manglende terminaler; lokale tracks og proces
blev lukket. Output var muted og syntetisk fixture startet: dette er transportbevis,
ikke hørt svar, dansk forståelse, mikrofoninputparitet eller fysisk latency/dræn.
Klikværktøjet meldte timeout efter at Start-knappen blev disabled; den samme faktisk
startede session blev observeret færdig, aldrig genstartet pga. observationstimeout.
.82 blev kort stoppet med brugerens eksplicitte tilladelse og er efter prøven
bekræftet “Kører” igen i HA UI. Ingen Alpha-installation fandt sted.

Brugeren har nu udtrykkeligt godkendt begge afventende punkter: kort pause/genstart
af PodVoice til den isolerede API-prøve og den beskrevne Live-stemmegodkendelsesvej
først efter bestået protokolprøve og review. Tilladelsesblokeringerne nedenfor er
dermed afløst af dette ja. Ingen teknisk eller fysisk gate er afløst af tilladelsen.

Seneste eksterne kontrol efter brugerens “klar”: Chrome virker igen, og den
eksisterende API-konfiguration blev overført én gang i hukommelsen til den frosne
WebRTC-prøve. Ingen session-create blev startet. Automatisk godkendelseskontrol
afviste Stop af den kørende .82-add-on: browserprøven blev ikke anset som specifik
autorisation til den korte produktionsafbrydelse. Stop blev ikke udført; HA UI
bekræftede efterfølgende “Kører”. Den lokale prøveproces udløb uden API-start
(child returncode1, kun prepared/cleanup i rapporten); nøglereference og prøvetabs er ryddet.
Browserblokeringen er løst. Næste API-prøve afventer nu udtrykkelig tilladelse til
pause/genstart for isolation. Den separate HA-stemmegodkendelses-wiring er ligeledes
fortsat inaktiv og afventer det tidligere beskrevne specifikke ja samt protokolbevis.

Seneste resultat: den UNWIRED ledger-korrektion har uafhængigt Astra HIGH GO
(source02e1235c,44 tests plus reviewerens egne stale-session/replay/tidsgrænser).
Den gamle spørgsmål/ja-reproduktion afvises nu uden faktisk anchor og før et senere
anchor. P2 exact-object ejerskab er bevaret. Lead kørte også55 ledger/policy-tests
og typekontrol grønt. Dette lukker den mekaniske reproduktion, ikke hele voice-parity-
gaten: Live skal stadig bevises at levere den nye eksakt korrelerede delegation.
Fremtidig wiring skal modtage metadata udelukkende fra den aktuelle SDK-generation,
observere delegationer fra sessionsstart og aldrig acceptere modelleverede anchors.
Thin returnerer fortsat confirmation-unavailable; ingen HA-godkendelsesvej er aktiveret.

Alpha-leverancegrænse (ikke release-/installationsstatus):

| Brugeroplevelse | Aktuelt bevis | Mangler før Alpha accepteres |
| --- | --- | --- |
| ON/OFF ved siden af nuværende løsning | Lokal setting og sessionsnapshot; OFF følger .82 | Installeret, kontrolleret skift og rollback |
| Naturlig løbende samtale | SDK-prøve og sammensatte Thin-regressioner | Rigtig input/afbrudt svar/opfølgning med uændret forståelse |
| Alle nuværende værktøjer | Fælles router; rigtig API kun med ufarlig statusstub | Domæneparitet inkl. friske stemmegodkendelser |
| Snappy Talk | WAV streamer, men Chrome-start ca.4.75s | Direkte WebRTC-protokolprøve, integration og målt oplevelse |
| Naturligt farvel | Foreløbig seks sekunders ventepolicy; måleværktøj reviewet | Målte terminalgrænser uden klipning eller unødig venten |
| Stop, privacy og næste wake | Software-regressioner og browser-WAV Stop-prøve | Samme provisionerede kandidat fysisk golden chain og10/10 |
| Full duplex på pucken | Firmware compile og AEC/forwarding-kæde undersøgt | Rigtig dobbelttale/ekko, room-audio og latencyfordeling |

Firmware fra compile-prøven indeholder dummy-PSK og er ikke installationsartifact.
Ingen af tabellens softwarebeviser gør Alpha fysisk testklar.

Næste UNWIRED korrektion af samtykke-P1: ledgeren må ikke udstede reviewgodkendelse
uden en ny faktisk session.delegation.created efter det serveroprettede proposal.
Ledgeren genererer et friskt continuation-event-id; kun præcis korrelation, hidtil
uset delegation og valideret faktisk offset_ms kan åbne source-grænsen. Gamle eller
genbrugte delegationer, fraværende/mismatched korrelation og ugyldig offset afviser.
Forsinket gammelt spørgsmål/ja efter lokal register skal afvises både uden anchor og
før et faktisk senere anchor. Det er en betinget protokolkontrakt: almindelig Live-
continuation er ikke bevist at levere denne nye korrelerede delegation. Ingen runtime-
wiring, estimeret append-tid, komplet-tur-garanti eller HA-aktivering tilføjes.

Aktuel stop-the-line for stemmegodkendelsesforslaget: uafhængigt Astra HIGH-review
reproducerede, at et helt forsinket gammelt spørgsmål og ja kan passere den lokale
fragmentledger. Seneste modtagne transcript-tid er ikke challenge-oprettelsens
kildetid; hypotesen nedenfor er derfor ikke bevist. Ledgeren er UNWIRED og kandidaten
er ikke testklar. En separat cross-ledger ownership-fejl afgrænses med præcis udstedt
objektidentitet samt session/challenge/hash, men dette løser ikke gammel samtykke-lyd.
Ingen router-/Thin-aktivering må følge af grønne ledger-tests.

Automatisk godkendelseskontrol afviste at forbinde denne nye godkendelsesvej til
HA-handlinger: Alpha-målet blev ikke anset som tilstrækkelig specifik autorisation
til den ændrede godkendelsesgrænse. Den afviste ToolRouter-ændring blev ikke anvendt.
Der forsøges ingen indirekte aktivering; øvrig transport- og målearbejde fortsætter.
Et konkret, selvstændigt reviewet forslag skal først foreligge før brugerafklaring.

Seneste afgrænsede reviewresultater: Astra HIGH har lukket cross-ledger-fejlen;
forsinket gammel samtykke-lyd er fortsat reproducerbar og åben. 43 målrettede
ledger/policy/prompt-tests bestod ved reviewerens kontrol. v15 Live-prompttilpasningen
bestod det strukturelle review; den kan ikke erstatte semantisk provider-eval.

WebRTC-developerprøven har Astra HIGH GO på source90d1f254 efter to Stop-rettelser:
Stop før første create afviser sen opstart; blokerede typed SDK-sends holder ikke
shutdown-låsen. 45 offline tests bestod. Præcis reviewed probe + importeret afhængighed
er frosset i /private/tmp/podvoice-live-webrtc-reviewed-01. Chrome blokerede efterfølgende
browserstyring med et åbent udvidelsesvindue. Handoff-serveren er stoppet uden modtaget
nøgle, ingen API-session startet, og midlertidig browserreferencenøgle er ryddet.
Transport-, tids- og playback-bevis står derfor stadig åbent.

Installeret baseline er observeret i HA som1.13.82. Frisk origin/mainf880c68 har kun
eval-fixture/test-, versions- og statusændringer siden34fb8c8; runtime/prompt/firmware
er uændret i git-diff. Den er efterfølgende flettet ind i Alpha uden konflikt;249
målrettede eval-harness/Live-prompt-tests bestod på sammenfletningen. Ingen fysisk
gate arves. Alpha-review og fysiske krav er uændret åbne.

Samlet lokal fast-gate på379c220 plus nedenstående arbejdsdiff mod origin/mainf880c68
bestod på81.0s: hele valgte tests-træ, Ruff/format35 filer og mypy51 kildefiler. Det
er udviklingsgaten, ikke releasegaten eller fysisk readiness. Uafhængigt Astra HIGH
godkendte også SDK/policy-diffet med91 tests: nye Live-API'er er stadig inaktive, OFF's
risiko og næste-tur-binding er bevaret, og SDK-counteren følger faktisk eventmodtagelse.

Måleprøvens valgfrie JSONL-tidslinje og terminal-PCM-dræn har særskilt Astra HIGH GO
(sourcea1ea1d99,50 offline tests). En blokeret outputpipe fejler bounded uden falsk
drænbevis. Tidslinjen skelner SDK request/return, faktisk delegation.offset_ms,
PCM-sampleoffset og pipe-write; ingen kant påstår hørt lyd eller færdigt farvel.
Næste harmløse protokolmåling skal afprøve, om en frisk response.create-korrelation
faktisk giver en ny delegation med ny source-position. Genbrugt delegation, manglende
korrelation og estimeret append-ACK må ikke bruges til at bortforklare samtykke-P1.

Næste aktive ændring: Live-bekræftelser. Observeret blocker er, at den nuværende
Alpha afviser bl.a. vacuum/mute/relativvolumen, fordi provider ikke har OFF's komplette
næste-brugertur. Hypotese: samme managed backend kan vurdere et serverfastholdt,
uforanderligt udsnit af faktisk input/output og frigive samme eksisterende one-shot-
policy uden at opfinde en tur. Kæde: canonical challenge → genereret præcist forslag
→ senere faktisk bekræftelsesinput → reserveret review_pending_action → evidence-token
→ senere completed eksklusiv approve_action → uændret target/schema/policy og final-
send guard → resultat/tale → close/rearm. OFF confirm/begin_turn forbliver uændrede.

Plan: én aktiv Live-challenge; eksplicit mode på serverens ExecutionContext afviser
cross-mode. Review returnerer kun token, når hele nødvendige materialet passer i
2048-byte værktøjsresultatet. Ingen skjult afkortning. Token binder session/generation,
challenge/argumenthash, immutable fragmentreferencer, observeret revision, udløb og
SDK's modtagne response-created highwater. En godkendende respons skal være modtaget
EFTER tokenudstedelsen, ikke bare behandlet senere fra køen. Valgte outputfragmenter
skal være efter challenge-registrering; voice-input skal tidsmæssigt følge det fulde
valgte forslag. Typed input mærkes eksplicit som tekst med lokal modtagelsesrækkefølge,
ikke et opdigtet provider-tidsstempel. Hele efterfølgende input skal indgå; modellen
må ikke vælge kun “ja” og skjule et allerede observeret “nej”. Nyt input/ændret forslag,
Stop, udløb eller anden generation afviser token og senere sends. Nyt input alene
annullerer ikke betydningen af selve forslaget. Semantik afgøres af modellen; ingen
lokal liste over godkendelsesord. Outputtekst beviser generering, ikke hørt lyd;
Alpha lover aktuelt observeret samtykke, ikke en komplet fremtidig ytring.

Regressioner: korrekt release, forkert mål/evidence, overlap/for tidligt eller sent
forsinket ja, ja…nej, nye fragmenter under target/MCP-await, tokenreplay, cross-mode,
expiry, ændret schema, Stop og en allerede kølagt response-created før reviewtoken.
Sen fejlkontrol må ikke genafspille en allerede sendt handling. Fysisk og semantisk
API-eval samt Astra HIGH's endelige adversarial review kræves før aktivering/release.
Rollbackgrænse er Alpha OFF; der ændres ingen risikoklassifikation eller TTL.

Aktivt Alpha-goal er nu oprettet på brugerens udtrykkelige ordre: fortsæt til den
samlede on/off-Alpha, ikke kun delmilepæle. Lokal prototype5bba274 er udgangspunkt;
main34fb8c8 (.81) indarbejdes nu. Git-diff viser v15 stille-tak plus eval-/versions-
ændringer; ingen ny firmware eller mic-/playbackmekanik. Begge beslutningshistorikker
bevares. OFF får præcis main's v15. Alpha tilpasser samme produktregel: et rent
modtaget-signal efter svar giver stille fortsat lytning; høflighed i spørgsmål,
anmodning eller godkendelse skal stadig forstås. Live behøver ikke et wait-værktøj
for at lytte i stilhed. Regression sammenholder v15-kilderegler og begge prompts.
Der arves ingen fysisk eller Alpha-semantisk gate ved baselineopdateringen.

Aktiv implementeringsbeslutning efter brugerens fortsæt-besked: testvinduet hos
.80 begrænser kun eksterne prøver. Alpha-kode fortsætter i isoleret clone. Én lead,
Astra SDK/audio som implementører, Astra HIGH som uafhængig reviewer. Observeret
API-kompatibilitet fra prøve2 retfærdiggør nu adapterintegration; ingen latency- eller
fysisk funktionspåstand. Falsificerbar hypotese: en eksplicit kontinuerlig Live-
protokol under samme ThinSession kan føre input → completed toolbatch → streaming →
én close/rearm uden at ændre OFF's Realtime/FLAC-eventkæde.

Kæde og invariantscope: wake/privacy/native mic → sessiongeneration og Live-inputclock
→ delegation/responsebatch + uændret ToolRouter/policy → session-WAV/HTTP → tokeniseret
announcement/mixer → korreleret fysisk finish → én teardown/rearm/næste wake. Tests
skal injicere stale generation, duplicate/out-of-order batch, for sen append/fetch,
output overflow/disconnect, Stop under tool/send/close, mic efter close, manglende
fysisk finish og modsatte Talk-adapter. Ingen lokalsemantik, legacydirectPCM, gain,
VAD, wake eller OFF-tuning. Output clock følger providerens PCM; ingen lokalt opfundne
silencepakker i output. HTTP queue tom er ikke EOF. Providerclose er ikke DAC-finish.

Implementeringsgrænser: openai_live.py ejer kun officiel SDK/wire, typed Live-events,
24k output/inputformat og16→24k inputresampling, completed atomisk batch og særskilt
backend-/sekundusage. live_audio.py + separat beskyttet HTTP-route ejer kun bounded
sessionstream. Thin ejer input, dispatch, playbacklease og close. Samme settingsflag
snapshot vælges ved næste wake; ingen hot-swap. Standard WAV-codec aktiveres eksplicit
som firmwarefeature før fysisk ON-test, FLAC/mixerforbindelser bevares.

Alpha-voice-approval er et særskilt åbent delkrav: nuværende policy kræver bekræftelse
for blandt andet vacuum, relativ volumen og mute. De må IKKE klassificeres ned for
at få parity. Før den nye godkendelseskontrakt er testet, må Alpha returnere eksplicit
unavailable-confirmation og udføre nul effekter, ikke bede om et virkningsløst ja.
Det er en implementeringsmellemtilstand og en reel full-parity-gate, ikke en færdig
Alpha. Core udvikles videre imens. Forslag til senere godkendelse er eksakt server-
challenge + postproposal source-tidsinterval + immutable evidence-review + completed
semantisk beslutning + atomisk generation/revision/expiry/once check. Den gamle
next-turn-garanti må ikke påstås for Live. Godkendelse åbnes først efter sen-rettelse-
regressioner og uafhængigt review. UI-click er kun alternativ, ikke voice-parity.

Graceful close bliver en udtrykkelig Alpha-policy: efter modelsemantisk completed
close-intent gives bounded mulighed for terminalt svar; målte grænser er ikke
provider audio.done. Accepter slutlyd indtil session.closed, forsegl den aktuelle
HTTPstream og kræv dens fysiske finish før rearm. Stop/mute/fejl kasserer derimod
queued/incomingaudio og bruger eksisterende stopfence. Kandidaten er ikke fysisk
testklar før sammensatte gates, review og alle Alpha-paritykrav er opfyldt. Rollback:
OFF fra næste samtale, Stop afslutter aktiv ON, ingen replay af sideeffekter.

Adversarial review under integration fandt tre konkrete ejergrænser: ON skal
admitteres på eksplicit WAV-capability før providerforbindelsen; ny inputrevision
under ToolRouter's awaited targetforberedelse skal kontrolleres igen umiddelbart
før HA/MCP-dispatch og hvert batchmål; en afsluttet Live-reader efter session.closed
må ikke udløse heartbeatfejl midt i fysisk dræn. Mindste rettelser er Alpha-only
capability admission, valgfri server-ejet execution_guard ført til final send efter
MCP-initialize og et eksplicit forventet reader-slutvilkår under graceful close.
OFF har ingen guard og uændret transport. Regressioner skal holde target-read og
initialize blokeret, ændre revision/Stop, frigive og bevise nul efterfølgende sends.

Næste reviewfangst: SDK-context entry kan afslutte efter Stop, hvis close kun ser
efter allerede oprettet connection. Adapterens connect-operation skal derfor være
lukbar fra første await, med generationsfence og oprydning af en sent erhvervet
context. Thin ejer tilsvarende en separat Alpha-openingtask, som close annullerer
og afventer før fysisk stop/rearm; sent start_streaming/connect må ikke starte
reader/pump i en afsluttet eller ny samtale. OFF's åbning ændres ikke.
Talk-browserprøven observerede Chrome Range: bytes=0- og416/decoderfejl. Den præcise
initial-range må behandles som200 nonseekable hel stream; andre ranges afvises stadig,
uden falsk Content-Range eller genbrug af forbrugt sessionstream.
Forbrug tilføjes som særskilt Live-sekund/backendtoken-ledger med dedup; eksisterende
OFF-regnskab bevares og ukendt pris må ikke vises som gratis. Prisgrundlag verificeres
på officielle kilder; ændringen påvirker ikke samtalens semantik.

Live-native UX-review på brugerens præcisering: Live ejer overlap, lytterreaktioner,
rettelser og taletiming; backendarbejde lever videre under en taleafbrydelse. En rå
inputfragmentrevision er IKKE en semantisk opgaverevision. Produktets eksisterende
præcise read-only-kontrakter må derfor færdiggøre og returnere deres parameterbundne
resultat efter ny tale; ukendte/ændrende handlinger beholder konservativ final-send-
revision og Stop/generation/budgetgrænse. Ingen lokal frasegenkendelse. Regression:
"mm" under opslag giver resultat, Stop under samme opslag giver ingen ny dispatch;
rettelser vurderes af backend mod det returnerede resultat og dets oprindelige opgave.
Primær-/backendprompts tilpasses hver for sig til Live med uændrede produkt- og
handlingsregler. Den nuværende sekssekunders farvel-grace er en ufærdig prototype,
ikke accepteret brugeroplevelse; ingen ny lydtærskel fastlægges uden en defineret
optaget sammenligning. Kort outputro efter semantisk lukning er en mulig målepolicy,
ikke provider audio.done. Voice-approval er fortsat en fuld parity-gate.

Lokalt Chrome-forsøg på eksakt WAV-route har bevist muted streaming før EOF,
Stop/HTTP-disconnect med afvist sen append efter ca.197ms og afspilning af ny
streamidentitet. BrowserLink kan nu udtrykkeligt modtage denne codec. Første playback
var ca.4,75s efter første PCM i forsøget; det er en observeret browserbegrænsning og
IKKE snappy Talk-bevis. WebRTC er fortsat officiel browseranbefaling; browserens
native Live-rute må vurderes særskilt uden at bruge Talk som fysisk puck-bevis.
Firmwareoverlay compiler, men den genererede binær har dummy-PSK og er ikke en
provisioneret installationskandidat. Runtime/setting er nu lokalt implementeret,
ucommittet og ufrossen; intet herfra er installeret, ingen Alpha golden/10/10.
Historiske "endnu ikke implementeret" nedenfor beskriver tidligere probemilepæle.

Det afgrænsede integrationsreview er efter rettelser bestået: 19 Thin-regressioner
for én modesnapshot, skift under typed admission, Stop før første lyd, sent mic-start,
teardowntimeout/retry, stale generation, læseopslag under lytterreaktion, sidesend-
revision, fysisk dræn og endeligt forbrug. Astra HIGH reproducerede de afgørende
races. Syv yderligere tests bruger den reelle ToolRouter/MCP mod HTTP-testtransport:
revision/Stop efter targetforberedelse og initialize giver nul efterfølgende kald;
revocation efter første mål sender ikke de resterende mål. Tolv lokale HTTP-tests
består med loopback aktiveret. Sandboxens afviste bind er miljøfejl, ikke lydfejl.

Firmware-/AEC-kæden er nu kodegennemgået: native mic-forwarding afhænger af wake-
privacy og subscription, ikke announcement-state; XMOS-reference og AEC/IC/NS findes
i den kompilerede vej. Ingen fysisk double-talk-forståelse er bevist. Før accept
sammenlignes kendte danske brugerord alene og under egen tale, output-only residualt
ekko og ekstern musik, med synkroniseret device/provider/output/rumlyd. Backlog,
drops, gain/clipping, Stop/mute og næste wake registreres særskilt. Mikrofon åben er
ikke bevis for forståelse. En kontinuerlig afspilningslease er heller ikke bevis for
kontinuerlig tale; Alpha LED/UI skal vurderes mod dette før produktaccept.

Lokal integrationsmilepæl: scripts/dev fast --base origin/main bestod på det samlede
aktuelle runtime-diff i80,7s: hele valgte tests-træ, Ruff/format27ændrede Pythonfiler
og mypy50kilder. Den første fulde kørsel fandt kun paneltestens gamle ordlyd for
Realtime-model; den forsætlige mere præcise label er nu dækket af kontrakttesten.
Den delte gate-lås blev respekteret, mens en anden release kørte. Ingen runtime-
ændring blev foretaget på grund af sandboxens netværksafvisning.
Astra HIGH's afgrænsede Thin- og promptreview har nul resterende P0/P1/P2 i deres
reviewede scope. Prompten tillader valgfri relevant indledning, fjerner gammel
per-tur/talesekvensstyring og lader backend kontrollere frisk værktøjstilgængelighed.
Forbrugsregnskabet bevarer final voice-sekunder og særskilt backendusage efter Stop;
ukendte beløb/finalisering vises som ukendte, ikke gratis. Dette er IKKE samlet
releasegodkendelse. Releasegate er ikke kørt, .80/v15-alignment og fuld Alpha-paritet
mangler, og der er ingen installation eller fysisk golden/10/10 for denne kandidat.

Seneste resultat: anden API-prøve med hashverificeret dansk syntetisk fixture
bestod den afgrænsede SDK-/managed-delegation-kæde. source_input_bytes123834,
synthetic_silence_bytes1195206, input_bytes_sent1319040. Én completed-valideret
get_probe_status, ét indsendt stub-resultat og én continuation; to backendterminaler
med905/965tokens, nul manglende terminal/usage. session.started og session.closed,
final Live usage27s. Modtaget PCM1286400bytes/26.8s, peak16000/RMS829.13.
Astra HIGH bekræfter protokolmilepælen uafhængigt. Aggregatet gemmer ikke alle
response/delegation-id'er og er ikke en standalone tool-result-ACK eller fuld trace.
Output er endnu ikke gennemlyttet; dansk forståelse, meningsfuldt talt svar,
afbrydelse, farvel og fysisk afspilning er derfor stadig ikke bevist. To audioevents
blev kasseret under deadline-close som forventet af Stop-proben, ikke graceful drain.

.79 er efter anden prøve genstartet: frisk status viser Kører/IDLE/native connected,
MCP/PodConnect up og korreleret rearm-ack; fysisk wake afventer bevis. Intet installeret herfra.
Provider-vinduet er frigivet til .80-opgaven. Ingen flere liveforsøg uden koordinering.
Valgt integrationsretning er officiel Live-SDK/WebSocket og managed Responses;
standard-WAV/PCM gennem eksisterende HTTP-announcement/mixer er lokal lydkandidat
på baggrund af pinned host-proof. ThinSession bevarer ejerskab, OFF bevarer FLAC.
Runtime og ON/OFF-setting er endnu ikke implementeret. Før runtime skal Alpha-
kontrakten for bekræftelser og graceful close være eksplicit og falsificerbar.
Live mangler komplette inputtur- og spoken-output-done-events; de må ikke opfindes.
En målt farvel-grace kan være en eksplicit Alpha-politik, aldrig providerbevis;
alle accepterede slutbytes skal drænes til samme fysiske stream/DAC før rearm.
Følsomme handlinger må ikke åbnes med falsk næste-tur-bevis. Næste arbejde er review
af eksisterende prøveoutput og den kontrakt, derefter adapter-/firmwareintegration.

Bruger har nu godkendt, at lead vælger adgangsrute og fortsætter. Valgt rute er
HA's eksisterende PodVoice-option; nøglen må kun overføres lokalt til den afgrænsede
probe i hukommelsen, aldrig til chat, repo eller rapport. En kort loopback-only
engangshandoff med origin/path-validering kan forbinde browserens godkendte
konfiguration til prøveprocessen. Ingen ny credential eller offentlig endpoint.
Før netværksprøven kontrolleres idle og installeret version; produktion pauses kort
for at overholde eksklusiv testadgang og genstartes efter forsøget, også ved fejl.
Prøven bruger kun syntetisk dansk input og immutable stub, højst30s plus startup/
close-deadlines, ingen reconnect. Resultat skal vise faktisk start, audio, tool og
session-close separat; en fejl er ikke tilladelse til blind retry eller runtimepatch.

Faktisk første API-forsøg 11/9: .79 var IDLE og native-forbundet; kort pause,
én SDK-session og efterfølgende genstart blev gennemført. session.started og
session.closed kom, final voice usage var27.0s, backendusage tom. Modtaget PCM var
1315200bytes/27.4s, peak45/RMS1.16 af32768; det beviser ikke tale. Den syntetiske
inputfixture viste sig at være0bytes. Alle1339200sendte bytes var EOF-padding.
Forsøget er derfor kun forbindelses-/finaliseringsbevis; dansk, delegation, stub,
afbrydelse og farvel er IKKE bestået. Probe-exit0 var utilstrækkelig forsøgsvalidering.
Den lokale første handoff blev afvist før API-kald; same-origin Referrer-Policy og
en nøglefri POST-test rettede adgangsvejen uden at svække origin/path-kontrollen.

Afgrænset korrektionshypotese: et separat inputkildetæller og fejlet resultat ved
nul kildebytes forhindrer denne falske prøveaccept. Kæden er fixture → faktisk pipe-
read → EOF-padding → SDK-session → rapport/exit. Ingen runtime-, lyd- eller provider-
konfiguration ændres; invarianten er sand evidens og uændret OFF. Regression skal
bruge rigtige OS-pipes med tomt/ikke-tomt input og bevare final usage ved inputfejl.
Astra HIGH reviewer dette lille probe-diff separat. Ikke-nul bytes er heller ikke
bevis for forståelig tale. macOS say gav tom fil under sandbox; én kontrolleret
kørsel uden sandbox gav123834bytes PCM24k/2.579875s, peak18502/RMS4266.85.
SHA256c08aa5cad00ddbb0fcda022302a86c22cd28d759d68ec86e69dfdf4b309c0019.
Fixturekvalitet kræver stadig semantisk kontrol; ingen blind ny API-prøve.

Korrektionsdiffet tæller nu source_input_bytes direkte fra pipe-read og returnerer
no_source_audio/exit1 ved nul kildebytes, selv om session.closed og final usage findes.
26 målrettede prøver består. Astra HIGH fandt og fik rettet en P2 i den nye CLI-test:
optional SDK blev importeret uden skip i normalmiljøet. Uafhængigt genreview PASS,
0 uløste P0/P1/P2;26pass med SDK og22pass/4skip ved simuleret manglende SDK-import.
Frossen fast-gate PASS79.2s, alle tests valgt plus ændret Python Ruff/format.
ScriptSHA256eec62553f5a5fc6b93dff876fbfd96e226dbe52a651de12625462208d15151fb;
testSHA25634ab41b5fdccde7f35f4343af4ae031200e0714228a14a3412c8a494e867d8db.
Ingen ny SDK-dependency er tilføjet den shippede add-on.

Efter prøven viser frisk .79-status IDLE/native connected=true, MCP/PodConnect up
og korreleret rearm-ack; wake afventer fysisk bekræftelse og OpenAI afventer næste
rigtige Realtime-session. Ingen ny golden/10/10 er bevist. .80-opgaven har nu det
koordinerede installations-/provider-vindue; Alpha foretager kun offlinearbejde,
indtil det er frigivet. Ingen credentials er gemt i repo, lyd eller rapport.

Implementering startet på brugerens godkendelse 11/9. Lead er denne tråds Codex;
Astra medium arbejder på afgrænsede SDK-/lydopgaver, Astra high er uafhængig auditor.
Første ændring er et isoleret developer-probeprogram og dets regressioner; ingen
setting eller produktionsvej aktiveres. Officiel SDK mangler i eksisterende testvenv;
brug en separat usynkroniseret Python3.12-venv og registrér den installerede version.

Aktiv falsificerbar hypotese: den officielle Live-SDK og Responses delegation kan
føre en dansk, løbende lydsamtale med ét ufarligt værktøj, korrekt correlated
completed-response-dispatch og afgrænset close uden gamle Realtime-turevents.
Kæde: paced testinput → SDK/start/readiness → Live audio/delegation → valideret
stub-resultat → kontinuerlig testoutput → close/final event. Probeoutput er ikke
puck- eller rumbevis. Ingen HA-klient eller produktionssideeffekt tilsluttes proben.
Test stale/duplicate/malformed/failed response, ordnet audio, backpressure,
input-EOF versus session-close, fejl og deadlines. Rollback er at fjerne den isolerede
probe; OFF/runtime/firmware skal have nul adfærdsændring i denne leverance.
Uafhængig audit sker mod faktisk diff; fysisk kandidatstatus forbliver ikke testklar.

SDK3.13.0 er installeret i separat /private/tmp/podvoice-live-sdk-venv og dens
AsyncOpenAI.live.connect er verificeret lokalt. Ingen API-nøgle findes i testmiljøets
environment; adgangsvej er efterspurgt uden at bede om nøglens værdi.
Supplerende off-device-hypotese: officiel micro_decoder WAV-codec kan muligvis
bære kontinuerlig PCM over den eksisterende HTTP-announcement/mixer uden ny encoder.
Prøv præcis pinned decoder med fragmenteret/ukendt længde/EOF; et FFmpeg-resultat
alene tæller ikke. Ingen firmware-/runtimeændring før kompatibilitetsresultat.

Astra-high arkitekturaudit: managed Responses understøtter completed-batch og
skrevet user-input. Tilpas manglende standalone-resultat-ACK til sand pending/error-
status. Fuld paritet er endnu blokeret af uprøvet næste-brugertursgodkendelse,
opgaverevision ved rettelser, separat Live-/backend-budget og semantisk farvel til
fysisk dræn. Ingen transcriptfragment/delegation må opfindes som brugertur. Den
ufarlige probe kan fortsætte; auditten er ikke runtimegodkendelse.

Styrende brugerpræcisering: standardintegration og mindst mulig egen vedligeholdt
kode. Officiel Live-SDK og dokumenteret delegation først; eksisterende funktioner
bevares, men Alpha skal ikke efterligne gamle Realtime-turregler. WebSocket er den
officielle servervej, WebRTC browservejen. Lokal FLAC/PCM/WebRTC vælges efter egnethed
og samlet vedligeholdelse; specialencoder er ikke længere automatisk første build.

Lead: Codex. Brugerens nye scope er dyb undersøgelse af tre transportveje og en
on/off-Alpha med samme aktuelt tilgængelige funktioner som den brugbare løsning.
Seneste præcisering: OFF er fortsat half-duplex; ON skal sigte efter full duplex
under aktiv Live-samtale. Undersøgelsen er ikke en aktivering af det gamle flag.
Det tillader en eksplicit eksperimentel Live-politik; det er ikke godkendelse af
en ny stabil baseline eller af quarantined Classic/direct-PCM. OFF skal vælge den
eksisterende vej fra næste samtale. Én ThinSession og én fysisk mic-/playbackejer.

Tidligere researchbaseline: main70a623a08e2dfb29328c9f391105deb30920924c (.76).
Implementeringsclone er nu fast-forwardet til main778f5bd8b578a5b9830e8f7840161c29985af1de
(.79), efter brugerens besked om forestående .79-installation. Før API-forsøget
verificerede denne tråd frisk .79 som installeret og kørende. Clone
/private/tmp/podvoice-live-alpha-research. Den gamle arbejdsmappe og .71-eksperimentet
er ikke implementeringsgrundlag. Denne undersøgelse ændrer ikke installeret enhed.

Direkte evidens: aktuelle officielle Live-dokumenter mangler spoken-response-done,
Realtime speech_stopped/commit og output-item-identitet i primær audio. Nuværende
Thin kræver netop disse ejergrænser. Hele kæden der skal redesignafklares: wake og
privacy → native mic og buffer → Live-input/clock → delegation/autorisation →
stream/mixer/DAC → fysisk dræn/ekko → follow-up, semantisk close og næste wake.
Invarianter: én runtimeejer, fysisk half-duplex for OFF, session-/generationisolation,
værktøjsautorisation og senere bekræftelse, én teardown/rearm, sand playback/evidens.
Realtime-specifikke ACK-/turnregler kan ikke opfyldes ved opdigtede Live-events.
En ny Alpha-kontrakt skal bevises og opdatere autoritative dokumenter før runtime.

Hypotese: en frameleverende FLAC-encoder kan fjerne væsentlig lokal opsamling og
bevare mixeren; fysisk streamgrænse er separat og endnu uløst. Tre undersøgte veje:
1 FLAC-streaming, 2 ny lokal PCM-kilde i samme mixer, 3 direkte WebRTC med server-
broker/sideband. Full duplex er nu et eksplicit Alpha-mål. Ikke-mål: skjult
duplex i OFF, VAD-/gain-/wake-tuning, fjernelse af
tools, skjult fallback/replay eller en setting uden fungerende backend.

Faktisk research: 8 CLI-forsøg og 4 libFLAC-forsøg, syntetisk 24kHz PCM i 20ms
realtidspakker; alle 12 fulde roundtrips var byteidentiske. Lokal macOS FLAC1.5.0,
ikke shippet ARM64 eller puck. CLI med releaseargumenter gav første post-metadata-
lydbytes efter441ms(støj)/1121ms(tone). Kun960-sampleblok gav261–269/946–965ms.
libFLAC callback med4096blok gav første komplette frame180–183ms;960blok61.6–62.3ms.
Metoderne har forskellige leverings-/metadataegenskaber og isolerer ikke én buffer.
Resultatet afviser FLAC-formatet som påvist nødvendig transportudskiftning; ingen
måling beviser akustisk latency eller den samlede målopfyldelse.

Uafhængigt adversarial review fra latency_review: vej1 kun første transportforsøg,
ikke fuld Alpha-testklarhed. Alvorlige fælles åbne spørgsmål er kontinuerlig mic-/godkendelsesgrænse,
gyldig senere approve_action, tool-output uden standalone ACK, farvel/dræn, typed
Talk og separat Live-/Responsesusage. Disse er indarbejdet i researchleverancen.
Reviewer har ikke godkendt runtime eller fysisk test. Historisk voice.py-docstring
om uændret interface ved GPT-Live er ikke migrationsautoritet.
Afsluttende review af rapport/HTML: ingen P0/P1. Præcisering indarbejdet: approve_action
kræver umiddelbart næste brugertur; mellemliggende input/ændring/udløb/teardown aflyser.

Gældende implementeringsplan efter brugerens best-practice-præcisering:
1. Officiel Live-SDK/quickstart med dansk, ufarligt værktøj, afbrydelse og afslutning.
   Afklar adgang, delegation, godkendelser, typed Talk, usage og close i samme prøve.
2. Fysisk dobbelttale og valg af ét egnet lokalt lydled efter vedligeholdelse og målte
   krav. FLAC er kandidat, ikke forhåndskrav; fysisk prøve kan ske uafhængigt af trin1.
3. Tilslut fuld funktionsparitet under ThinSession, kontinuerlig Alpha-input og fælles
   værktøjsautorisation. Skriv eksplicitte Alpha-regler i autoritative docs før runtime;
   gamle Realtime-eventkrav må ikke opfindes som Live-kontrakt.
4. Én setting OFF/ON fra næste samtale, gemt versus aktiv status og samme firmware.
5. Sammensatte regressioner, uafhængigt review, passende software-/firmwaregates,
   præcis installation og frisk fysisk golden chain plus10/10. Kontroller også OFF.
6. OFF/ON/direkte Live-reference:40enkle+20toolture, rumlyd og fejl med i opgørelsen;
   fjern kun målte ekstra ventetider, med relevante fysiske gates per tuning.
Første implementeringsleverance er trin1, ikke en ny FLAC-encoder. Den gennemgåede
encoderhypotese ovenfor er tidligere research og bestemmer ikke transportvalget.
Detaljeret brugerplan ligger i researchleverancens alpha-plan.md. Denne post er
fortsat den eneste aktive beslutningslog. Trin1 har implementeret off-device-probe;
rigtig Live-API-prøve og den samlede Alpha mangler fortsat.
Full-parity Alpha kræver alle eksisterende funktioner tilsluttet, uafhængigt review
og relevante software/protokol/fysiske adgangsgates. Baselineparitet må inventeres:
.76 har dormant TimerManager, ikke bevis for admitted stemmetimere.
Rollbackgrænse: OFF fra næste samtale; Stop kan afslutte aktiv Alpha; ingen ny
session må genafspille en allerede udført handling. Samme firmware skal bevare OFF.

Ny full-duplex-research: XMOS v1.3.1/1a1df7c og præcis ESPHome-komponent
772f2b9 er gennemgået. Separate I2S-input/output; XMOS læser digital speakerreference
og kører AEC. ESPHome sætter kanal1=NS (XMOS alene har defaultAEC); aktiv I2C-stage
og dobbelttalekvalitet er ikke fysisk verificeret. Ekstern HomePod er ikke denne
speakerreference. Full duplex kræver ikke WebRTC eller udskiftning af FLAC.

Uafhængigt genreview fra latency_review: gammelt full_duplex-flag er ingen genvej.
Det er blokeret i settings/factory, fjerner lokal Stop-context, aktiverer ikke
providerinterrupt, har600ms barge-debounce og en stop-ACK/taleslut-race. Echo-tail
skærer stadig mic-generation og kan tabe dobbelttale. Realtime-truncate kan ikke
opfindes i Live. Med det nye mål bortfalder behovet for per-svar mic-genåbning;
farvel/dræn, autorisation og én teardown/rearm består. Ingen runtime er godkendt.
Før implementering skal Alpha-kontrakten optages i autoritative dokumenter; den
fysiske produktionskontrakt er ikke ændret af research. Detaljer/prøvematrix ligger
i researchleverancens full-duplex.md; samme lead-post er fortsat beslutningslog.

Faktisk første kodeleverance: scripts/live_alpha_probe.py, isoleret fra add-onen,
med officiel OpenAI-SDK3.13.0, dansk probe-prompt, ufarligt get_probe_status,
20ms-paced PCM, markeret EOF-stilhed, bounded startup/close, ingen reconnect,
completed-batch-staging, særskilt forbrug og max256 backend-outputtokens per response.
Der er ingen dollarbudgetgaranti eller fysisk drain i proben. Reproduktion står i
scripts/LIVE_ALPHA_PROBE.md; dependency er kun scripts/requirements-live-alpha.txt.

22 regressionsprøver i tests/unit/test_live_alpha_probe.py består og opdages af den
normale releasegate. Astra HIGH fandt og fik rettet overset backendusage under close,
ignoreret nested backend error og continuation efter Stop under awaited result-send.
Uafhængig genprøve og frossen audit: PASS, ingen uløste P0/P1/P2 for proben.
ScriptSHA256cd8dd5a36b3c2cbf14c602adccc2c2ed8f7555e07b1e41cd5b60bdc5a627d132;
testSHA2560044fb0f72a304b88c221767b8271bebc77ec11dbbe0c4ed8e45b731a2d9e8a2.
Fast på .79-kilde, isoleret Python3.12-venv: PASS81.7s med alle tests valgt samt
Ruff/format. Første forsøg stoppede før test pga manglende lokal origin/main-ref;
ref er hentet korrekt. Mellemkørsel havde grønne tests men forkastet scope pga audit-
rettelser under kørsel; kun det efterfølgende frosne resultat tæller. Ingen runtime-
eller firmwareændring og ingen release/installationsgate kørt for den fulde Alpha.

Standard-WAV-hostprøve: pinned micro-decoder0.2.0 og micro-wav0.1.0, verificeret50
kildefiler,8cases/16streams. Fragmenteret PCM16mono16/24kHz, ukendt længde0xFFFFFFFF,
lyd før EOF, EOF og stop/genstart giver forventet PCM. Zero-length-header giver nul
lyd som negativ kontrol. Astra-high verificerede sourcechecksums og de16PCM-resultater.
Det begrunder standard-WAV som kandidat uden specialencoder; ESPHTTP, firmware,
mixer/DAC, dobbelttale og farvel er ikke fysisk bevist. Reproduktion/evidens er i
/private/tmp/podvoice-live-wav-probe og kopieret til researchleverancens wav-proof.

API-adgang og den afgrænsede completed-delegation-kæde er nu bevist af anden prøve.
Første fejlbehandlede nul-inputforsøg er bevaret som fejl og permanent regression.
Den samlede Alpha, samtalekvalitet og fysiske funktion er fortsat ikke bevist.

Status: første isolated probe implementeret og softwareauditeret; research og offlineforsøg afsluttet. Ingen Live-API-/kontoadgangsprøve,
runtimeimplementering, setting, releasegate, installation, golden chain eller10/10
for Alpha. Kandidaten er ikke fysisk testklar. Ingen produktionsdiff.
Researchleverance ligger i den lokale Codex-visualiseringsmappe gpt-live-alpha med
undersoegelse.md, index.html, begge reproduktionsscripts og rå JSON-resultater.
## Aktuel leveringsstatus — .87 installeret, Roborock ON til fysisk prøve

14/9 kl.12.35: offentlig .87, installeret exact mainbe4c5e8cc9b8e3e371eeb622b326c03019f98416,
rootfs4987991b718e18906ec4236180562e6975ad1f82a55c4036639bc8cb1f21c2f6.
Komplet sikker robotprofil eval-1789381509-b91ff2 bestod seks scenarier/otte ture;
alle svar konkret godkendt af lead og uafhængig reviewer. Robotudvidelse gemt ON
med de fem tidligere godkendte entiteter uændrede. Efter genstart matcher faktisk
router502ac0be97ee4644deb7cd881254a7df7180b4209f5607f562da9ab6d56b125d
præcis den sikre kandidats router; samme artifact, diagnostic_active=false,
VoicePE forbundet/IDLE/HeyChat bekræftet. 21 eksisterende tools bevaret, to
robottools tilføjet. Automatisk app-opdatering gendannet og UI-verificeret ON.
Backup af .86 verificeret før installation og opdateringsbackup ON; deaktivering
er hurtig sikker rollback for nye robotkommandoer. Ingen rigtig rengøring startet.

Fysisk prøve er klar, ikke bestået: én lokal optagelse armet til næste samtale;
brugeren bedt spørge hvilke rum Roborock kan rengøre, afslutte og prøve ny wake.
Faktisk rengøring med HA-områder/indstillinger/gentagelser, fysisk opfølgning,
golden chain og 10/10 lifecycle er fortsat ikke dokumenteret af denne release.
De tidligere fejlede/ufuldstændige .83–.86-evalueringer bevarer deres status.

## Aktiv lead-beslutning — .87 eksplicit mål og ejerskab af læsevalidering

.86 eval-1789379823-ff9989: rumspørgsmålet med eksakt vacuum.eval_qrevo gav GET{}
før GET med det angivne ID, nul handlinger og korrekt rumliste, men 40.2s. Tidligere
"known exact"-præcisering garanterer altså ikke direkte opslag. Uafhængigt review
klassificerer dette som reel overflødig discovery, ikke forkert svarbedømmelse.
Årsagen er en hypotese: modellen kan fortolke "known" som tidligere verificeret.
Kodebevis: GET kontrollerer allowlist før register/stateadgang; discovery er ikke
nødvendig for at validere et brugerangivet mål. Kæde: input→Realtime vælger mål→GET
validerer→capabilityresultat→tale→opfølgning/close/rearm. Kun beskrivelsen ved valget
ændres; read-only-validering før og resultatform efter, handlinger og begge I/O-
adapteres lifecycle bevares. Realtime ejer semantik, inklusive negation/målrettelse.
Erstat første GET-sætninger og parametertekst med én regel: brug den aktuelle
forespørgsels eksplicitte mål direkte; GET validerer tilladelsen. Brugerens nuværende
mål går før tidligere værktøjskontekst. Kopiér ikke blot første nævnte ID og udled
aldrig ID fra naturlige navne. Intet ekstra værktøj, taleparser, budget- eller
runtimeindgreb. Eksakt afvist mål må ikke falde tilbage til anden robot.
Regressioner: tilladt eksplicit mål med flere robotter; afvist ID før HA-læsning og
uden fallback/handling; ukendt mål/sole-robot uændret; samme sikre 6-scenarieprofil
bevarer exact-one-call. Fokuserede tests→fast→review→frossen gate→grøn .87→backup/
installation→komplet frisk profil og konkret svarreview. Rollback .86 OFF.
Stopregel: gentages dobbelt-discovery på denne præciserede kontrakt, stopper yderligere
beskrivelsestuning. Nyt løsningsprincip kræver særskilt beslutning, ikke endnu en
blind releasecyklus. Ingen aktivering eller fysisk accept arves fra tidligere runs.

Faktisk ændring: kun GET-beskrivelsens to tekstfelter;271 målrettede tests PASS,
fast PASS87.0s med fulde tests, Ruff/format og mypy47. Uafhængigt review
robot_83_result_review GO, ingen uløste P0/P1/P2. ReviewdiffSHA256
595e61c6e265a9c3f5208b6facb032ff744067bd9751e51f571a2b2ae508d2ce.
To værktøjer,2774→3257UTF8bytes (+483); fixture, systemprompt, runtime og lifecycle
uændrede. Tests beviser afvist ID uden HA-læsning/handling/token/fallback, ikke AI'ens
negationsforståelse. Hele diffet inklusive status fryses nu til releasegaten.

Frossen .87-releasegate PASS44.2s: fulde unit/integration, Ruff/format127, mypy47,
candidate-scope. Ingen filer ændret under gaten. Offentlig CI/artifact og frisk
installeret liveprofil mangler fortsat; denne linje er leveringsmetadata.

PR57 head6dea5bb003f7768a1de0041ad265bc5ba3bc3807, CI34831922756
lint-test1m44s/ARM64-build1m48s PASS. Squashmerged til main
be4c5e8cc9b8e3e371eeb622b326c03019f98416. Publiceret image afventes før installation.

MainCI34832110591 PASS, publiceret .87-image
sha256:94160cfef5b75a9486f576425e10aa8243164a42adc8b32326b8448446cb7d03.
Frisk krypteret lokal manuel backup14/9 kl.12.14,14.04MB, PodVoice1.13.86
verificeret. Installeret kl.12.19.57 med opdateringsbackup ON. Runtimegit
be4c5e8cc9b8e3e371eeb622b326c03019f98416 og rootfs-v1:
4987991b718e18906ec4236180562e6975ad1f82a55c4036639bc8cb1f21c2f6 verificeret.
MCPassist/OFF-schema og promptv15 uændrede; VoicePE192.168.86.245 forbundet,
HeyChat firmwarebekræftet. Fuld frisk sikker robotprofil eval-1789381509-b91ff2
startet én gang. Aktivering afventer komplet resultat og konkret svarreview.

Frisk .87-robotprofil eval-1789381509-b91ff2 COMPLETE/PASS: præcis seks scenarier,
otte ture, alle uden findings; candidate_contract_passed=true,selected_ok=true.
Generiske profile_complete/coverage_complete=false gælder standardprofilen, ikke
robotsættet; robotprofilens egen fuldstændighedspredikat er opfyldt. 207688tokens,
$0.3193448,351.0s kapacitetsventen. To lange sekvenser med korrekte indstillinger/
repeat2, sand kvittering og hhv. modelclose/åben dialog; ukendt udfald uden retry;
navnekonflikt uden ID-oplæsning; rumspørgsmål og rettelse hver præcis én GET,
Køkken/Spisestue og nul handlinger. Alle otte svar konkret læst af lead og
uafhængigt robot_83_result_review: GO til kontrolleret ON, ikke fysisk godkendelse.
Artifact matcher installeret .87. Kandidatrouter
502ac0be97ee4644deb7cd881254a7df7180b4209f5607f562da9ab6d56b125d;
SafeEval-enabled-schema2c7a4c48411be59d219885fa2088da087f664651e54acd47eb23ed7a31282d68
er en anden hash-type. Aktivering kræver faktisk routermatch, samme artifact,
uændrede fem entiteter og frigivet diagnosticlås. Disse kontroller følger nu.

## Aktiv lead-beslutning — .86 sand anmodningsaccept uden obligatorisk frase

.85 liveeval-1789378753-072362 viser korrekt GET+fire handlinger+modelclose og
eksplicit ubekræftet fysisk udfald, men svaret afvises af testens positive krav om
præcis "den fysiske udførelse er ikke bekræftet". Uafhængigt årsagsreview bekræfter
falsk negativ: en accepteret ANMODNING er ikke en påstand om robotaccept/fysisk start.
Hele kæden fysisk input→Thin→Realtime→capability/handling→HA-accept→modelsvar→
playback/close/rearm er uændret; fejlen ligger alene i efterfølgende fixturebedømmelse.
Nabogrænser: eksakte argumenter, rækkefølge, single-use, ukendt udfald og lifecycle
bevares. Hypotese: testens acceptkilde, ikke én disclaimer-ordstilling, skal afgøre
om neutral anmodningsaccept kan passere. Sendt/HA-accept har allerede intet krav om
en bestemt disclaimer. Fjern kun det ekstra krav på passiv anmodningsaccept og
afvis positivt påstået fysisk bekræftelse særskilt, så gamle negative tests fortsat
afvises af den rigtige årsag. Intet runtime-, prompt-, tool-, firmware- eller
kapacitetsindgreb og ingen ny taleparser. Alle live-svar kræver fortsat manuelt
semantisk review; regexer er afgrænsede regressionsfiltre, ikke en sandhedsdommer.
Plan: observeret svar plus varierede og korte sande kvitteringer; kontraster med
negation, forkert acceptkilde, positiv fysisk bekræftelse og sen falsk påstand.
Fokuseret regression→fast→uafhængigt review→én frossen gate→grøn .86-pakke→backup
og én installation→komplet frisk sikker profil. Tidligere fejl arver ikke PASS.
Aktivering kræver fuld profil og schemaidentitet. Rollback er installeret .85 OFF;
ingen fysisk godkendelse uden frisk Voice PE-/robotbevis.

Faktisk .86-diff: kun to kvitteringsforventninger, 182 målrettede evaltests PASS.
Fast PASS79.9s med fuld testsuite, Ruff/format og mypy47. Uafhængigt review
robot_83_result_review: GO, ingen uløste P0/P1/P2. ReviewdiffSHA256
2e4e9f412093a874ecce072c19e92bbe3d0fec4fbb2ce671764f3f464c60353d.
Alle strukturerede fixtures, øvrige scenarier, tool-schema/prompt/runtime/lifecycle
er uændrede. .85-svaret og korte kvitteringer passerer; falske kilder/fysisk bevis,
negation og sene modsigelser afvises. Diff inklusive status fryses nu til én gate.

Frossen .86-releasegate PASS42.0s med fulde unit/integration, Ruff/format127,
mypy47 og candidate-scope. Ingen ændringer under gaten; kun dette leveringsresultat
tilføjet bagefter. Publicering, installation og fuld frisk robotprofil resterer.

PR56 headfed2470a17d7a9b7ad627c0d173c15568ca7bfe5: CI34829879343
lint-test1m43s/ARM64-build2m9s PASS. Squashmerged til main
9a93375c3d64a02e64baddd835232310660265ad. Frisk lokal krypteret manuel backup
14/9 kl.11.49,14.04MB, indhold PodVoice1.13.85 verificeret. Automatisk app-
opdatering midlertidigt OFF; gendannes efter kontrolleret installation.

MainCI34830100108 PASS. Publiceret .86-image
sha256:6dfee7568b1ab167517277a49129c9dc9d08272665d7904bda45dfd1e4e75813.
Opdateringsdialog verificeret .85→.86 med backup ON; installation startet.

Kl.11.56.12 installeret .86 verificeret: git9a93375c3d64a02e64baddd835232310660265ad,
rootfs-v1:b27d8ddd27eb74ea6abcd98a5c3a6e598d35eb988834e3c4a7c69e65725580a5.
Promptv15/OFF-router uændret; MCP og VoicePE192.168.86.245 forbundet, HeyChat
firmwarebekræftet. Auto-opdatering gendannet ON. Frisk fuld sikker robotprofil
eval-1789379823-ff9989 startet én gang; fuldt resultat og semantisk review afventes.

.86-liveprofil FAIL efter 7/8 ture: device-sequence, unknown, ambiguous og
accepted-dialogue PASS. Alle seks svar i disse scenarier læst; anmodningskvittering,
ukendt udfald uden retry og navnekonflikt uden rå ID'er er korrekte. Room-question
fejler alene exact-one-call: "Hvilke rum kan Roborock vacuum.eval_qrevo rengøre?"
gav GET{} efterfulgt af GET{entity_id:vacuum.eval_qrevo}. Korrekt svar "Køkken og
Spisestue", nul effekter, åben dialog, men 40187ms og et overflødigt modelopslag.
Room-correction blev ikke kørt. 198543tokens,$0.3878112,339.78s kapacitetsventen.
Tidligere direkte-opslagshypotese er dermed ikke tilstrækkeligt bevist. Robotstyring
forbliver OFF, ingen fysisk accept. Nyt uafhængigt årsagsreview før kode: skeln
udtrykkeligt mellem et brugerangivet eksakt ID og et allerede verificeret ID;
GET ejer selv læsevalideringen, så discovery bør ikke bruges til at validere det.
Ingen blind genkørsel eller svækkelse af exact-one-call-gaten.

## Aktiv lead-beslutning — .85 samlet rumafklaring og robot-svarbedømmelse

14/9 brugeren bestiller fuld rettelse/udgivelse/installation efter .84. Evidens:
eval-1789375253-af30e5 afklarer sikkert med nul handlinger, men oplæser interne
kitchen_one/two-ID'er. Uafhængigt review reproducerer desuden OR-hul i de to
rumopslags answer_patterns: "Hej", "Køkken er startet" og ét rum kan passere.
Det er både et afgrænset tale-UX-hul og en utroværdig testgate, ikke forkert HA-dispatch.
Kæde: fysisk wake/mic → Thin accepterer tur → Realtime læser eksisterende GET-
beskrivelse → friske capabilities/HA-navne → modelsvarets tekst → evalbedømmelse
→ aktiveringsbeslutning; fysisk playback/followup/close/teardown/rearm er uændret.
Nabogrænser: native/Talk-input og serverens capabilityvalidering forbliver identiske.
Hypotese: skelnen mellem menneskelige navne og tekniske ID'er skal fremgå af GET;
samtlige seks fixtures skal kræve både nødvendige data og fravær af falske påstande.
Realtime ejer fortsat sprog og semantik. Ingen parser, nye værktøjer, scripts,
firmware-, VAD-, lyd-, kapacitets- eller systempromptændring. Interne ID'er må bruges
i kald og ved eksplicit teknisk forespørgsel; aldrig som navne på rum i almindelig tale.
Navnekollision uden aliaser skal forklares, ikke løses med opdigtet etage eller ID.
Plan: eksisterende answer_all for alle nødvendige navne/ID'er, ét sammenhængende
bounded regex per svarklasse; ingen global OR→ANDændring. Kontrasttests på tværs af
alle otte ture: negationer, falsk fortsættelse, ukendt kontra afvist, rå ID'er,
opdigtede skel og delvise rumlister. Bevar eksakte tools/args, rækkefølge, single-use,
no-retry, nul sideeffekt ved opslag, modelclose og modsat ønsket videre dialog.
Målrettet test → fast → uafhængigt review → én frossen samlet releasegate → grøn
mainartifact → backup/én installation → fuld frisk sikker robotprofil → ON først
ved komplet bestået profil og matchende artifact/schema. Rollback er installeret
.84 med udvidelse OFF. Fysisk golden chain og faktisk rengøring arves ikke.
Tidligere .83/.84-kørsler forbliver fejlet/ufuldstændige. Ingen blind genkørsel.

Faktisk ændring: eksisterende GET-beskrivelse præciserer HA-navne/aliaser i almindelig
tale og tekniske ID'er i kald/udtrykkeligt tekniske forespørgsler. To værktøjer før/
efter; kompakte deklarationer2472→2774UTF8bytes (+302). Systemprompt, parametre,
runtime, tokens og firmware er uændrede. Alle otte tures nødvendige data kræves med
answer_all; sammenhængende svarfiltre erstatter OR-hullet. Globale gradersemantik
ændres ikke. Strukturerede fixturekald/argumenter/batches/sideeffekter/lifecycle
er identiske med .84. Regexer er fortsat bounded regressioner med manuelt live-review.
Fast PASS79.3s inklusiv fuld testsuite. Reviewer fandt to falsk-negative ved
terminalt "Udfaldet er ukendt" og "Begge rum ... unikke navne"; begge rettet med
positiv/negativ kontrast før freeze.240 målrettede device/evaltests PASS.
Endeligt uafhængigt robot_83_result_review: GO til samlet freeze, ingen uløste
P0/P1/P2. ReviewdiffSHA256 aa79510267ebbaa5e5c4e5a41a036354c13b51556ee945d50e2cb4d40a5b208e.
Hele diffet inklusive denne status er frosset til releasegaten; ingen installation
eller robotaktivering er resultat af dette review.

Frossen samlet .85-releasegate PASS41.7s: Ruff/format127, mypy47,
candidate-scope og fulde unit-/integrationstests. Ingen filer blev ændret under
gaten. Publicering/installation og den komplette sikre liveprofil resterer;
denne efterfølgende statuslinje er leveringsmetadata, ikke fysisk godkendelse.

PR55 head44207d31a820bd10f81d5c429147dabd12266c3f: CI34828249643
lint-test1m41s og ARM64-build2m7s PASS. Squashmerged til offentlig main
43430eb95c98f6062f3728b19469b250dd220129. MainCI34828494938 PASS;
publiceret .85-image sha256:a2ce4588e7026d47dfe7ce32a8546da39ec0a69055c9fe34fd9e5c7b0f71483c.
Frisk manuel lokal krypteret backup 14/9 kl.11.33, "Custom backup 2026.8.2",
14.04MB, indhold PodVoice1.13.84 verificeret. Opdateringsdialog .84→.85 med
backup ON godkendt. Installation er startet; runtimeidentitet/livegate afventes.

Kl.11.38.22 installeret .85 verificeret i startup: git43430eb95c98f6062f3728b19469b250dd220129,
rootfs-v1:e01d1f796b4f9571a5e02f490293816a795d4036be989c648a22f8f72ab9a0e2.
Promptv15 og OFF-router508001010df295576e6bd63f02594c9a6ab514da702c729049929aed30e90e23
uændret; MCPassist og VoicePE192.168.86.245 forbundet. Automatisk opdatering
gendannet ON. Komplet sikker robotprofil eval-1789378753-072362 startet én gang;
aktivering afventer hele resultatet. Ingen fysisk robotstart eller golden chain endnu.

Liveeval-1789378753-072362 FAIL efter 2/8 ture, kun answer-pattern-mismatch i
device-sequence tur2. GET+fire handlinger+end, eksakte argumenter, single-use,
fire syntetiske effekter og modelclose PASS. Svaret var: "Anmodningen er accepteret,
og robotten er sat til at støvsuge og vaske køkkenet to gange med maksimal sugestyrke
og ekstrem vaskeintensitet. Det er ikke bekræftet, om den fysisk er startet eller
blevet færdig endnu." 72355tokens, $0.119988,95.42s kapacitetsventen. Ingen reel
robotstart. Installeret .85 er ikke robot-testgodkendt; udvidelsen forbliver OFF.
Årsagsreview åbnet før mere kode: den positive kvitteringsregel kræver én bestemt
ordstilling om fysisk ubekræftelse, selv om svaret udtrykkeligt angiver den samme
usikkerhed. Gentagne synonymlapper er ikke en robust bedømmelsesstrategi. Undersøg
acceptkilden og sandhedskontrakten frem for endnu en forventet svarfrase.

## Aktiv lead-beslutning — direkte robotopslag uden overflødig discovery

11/9 Lead Codex, efter brugerens ønske om videre arbejde. .79 live SafeEval
eval-1789126001-bff797: eksplicit vacuum.eval_qrevo gav capabilities {} efterfulgt
af capabilities med entity_id. Korrekt dansk rumliste og nul fixture-sideeffekter,
men exact-one-call-gaten fejlede; 37956ms omfatter provider/pacing, ikke fysisk
svartid. Fire forudgående scenarier bestod, korrektionsscenariet blev ikke kørt.
Robotudvidelsen forbliver OFF. Parallel opgave ejer .81-release og live-vindue.

Kæde: fysisk wake/mic → accepteret Thin-tur → Realtime læser deklaration og vælger
argumenter → completed batch/pacing → read-only, servervalideret capability →
modelgrundet svar → fysisk playback → opfølgning/close → teardown/rearm → ny wake.
Begge nabogrænser er uændrede: modelinput før valg, validering/resultat efter valg.
Hypotese: deklarationen lærer no-ID-discovery, men mangler prioritet for et eksplicit
kendt ID. En præcis parameterinstruktion kan fjerne det første opslag uden at
fortolke tale lokalt. Falsifikation: samme sikre live-scenarie bruger stadig to kald.
Ingen påstand om, at hele ventetiden skyldes discovery.

Invarianter: Realtime ejer semantik; ingen gættede ID'er, nye værktøjer, hævede
budgetter, runtime-/firmware-/VAD-/lifecycleændringer eller svækket oracle. Bevar
ukendt robots discovery, tvetydighed, serverallowlist, stale/duplicate/timeout-
afvisning og sand HA-kvittering. Ændring afgrænses til eksisterende tool-beskrivelse.
Regressioner: reproducer to read-only-kald + korrekt svar som fejl; ét direkte kald
som bestået, forkert mål/start som fejl; direkte eksplicit mål med flere tilladte
robotter; no-ID single/multi-path og detached Voice/Talk/fixture-schema.
Målrettede tests → fast → uafhængigt adversarial review → på samlet frisk base én
frossen releasegate. Live robotprofil og fysisk prøve kræves før aktivering/accept.
Rollback er at kassere denne isolerede beskrivelsesændring og bevare installeret
version/config; ingen ny installation eller fysisk godkendelse i denne post endnu.
Gammel dev-clone fejlede fetch på manglende git-blob; frisk usynkroniseret clone
/private/tmp/podvoice-robot-direct-lookup på .80/main4fd4016 bruges uden at ændre
Documents-workspace eller den gamle lokale leveringslog. Rebase til .81 før release.

Faktisk ændring: kun GET-værktøjets beskrivelse og entity_id-parameterbeskrivelse;
to værktøjer før/efter, serialiserede deklarationer2223→2472UTF8bytes (+249).
Systemprompt, parametervalidation, runtime, budget og obligatoriske kald er uændrede.
152 målrettede tests PASS; fast på stabilt diff PASS1.6s med Ruff/format, mypy47 og
169 fokuserede tests. Uafhængigt robot_lookup_causal_review: GO til integration/
freeze, P0/P1/P2=0,152 unit+11 integration PASS. Reviewdiff SHA256
513bce2bdb34234d9e8ef11bc7db8ea78fa099dbf8f11a37e520afb2ef3aff91.
Ingen releasegate/liveeval/installation udført for rettelsen. No-ID sole-robot-
natursprog er ikke dækket af den eksplicitte multi-robot-livefixture og skal prøves
fysisk; den mekaniske sole-robot-vej er dækket lokalt. Review ændrer ikke .79's
fejlede robotgate eller giver fysisk accept.

Rent rebaset på .81/main34fb8c8b816801f4836c6fc21b69389970f4e218, kandidat
b6471184ccbd9bd2fc21f5acbf06d3fd06ca570b. Reviewer genbekræftede identisk reviewdiff
og GO til lokal freeze/gate. Én frossen releasegate PASS41.1s: Ruff/format127,
mypy47, candidate-scope og fulde unit-/integrationstests. Ingen produktionsændring
efter freeze. Denne statusopdatering er kun leveringsmetadata; offentlig kode/CI-
artifact, koordineret installation og sikker robotliveeval resterer. .81-opgaven
ejer fortsat live-vinduet; ingen HA-state er ændret af denne rettelse.

Brugeren har nu eksplicit bestilt push, build, installation og aktivering efter
sikker test. .83 bruges på offentlig .81-base; separat upubliceret .82-payload
medtages ikke. Installationsvinduet er frigivet. Kun versionsmetadata/changelog
tilføjes til den reviewede robotrettelse; rollback er installeret .81 og dens
backup, robotudvidelse OFF ved fejlet gate. Ingen nye beskeder til anden opgave.
Endelig .83-metadatareview robot_lookup_causal_review: GO, P0/P1/P2=0;
engangstoken-terminologi præciseret. Frossen .83-releasegate PASS45.7s med fulde
unit/integration, Ruff/format127, mypy47 og candidate-scope. Publicering følger;
installation/live-gate/aktivering er endnu ikke resultater.
Efter første grønne PR53-CI34603987929 (lint-test1m41s, ARM64-build1m44s) er .82
nu offentliggjort som mainf880c682. .83 er rebaset derpå; begge changelogafsnit og
hele den offentlige .82-fixtureændring bevares. Robotreviewhash er uændret.
Reviewer genbekræftede GO til ny samlet freeze; tidligere gate er ikke bevis for
denne nye base. Installationsvinduet afventer igen den anden udgivelse, og Chrome
blokerer HA-automatisering med et åbent udvidelsesvindue. Brugeren er bedt lukke det.
Automatisk app-opdatering blev midlertidigt slået OFF før push (tidligere ON);
gendan efter kontrolleret installation. Robotudvidelsen er OFF, fem entiteter bevaret.
Samlet frossen .83-på-.82-gate PASS44.5s: Ruff/format127, mypy47, candidate-scope,
fuld unit/integration. Ny PR-head kræver frisk CI; ingen manuel genkørsel af CI.

14/9 genoptaget efter eksplicit ordre om installation/færdiggørelse. Frisk PR53-
kontrol: headcfe20a3, CI34604609086 lint-test/ARM64-build PASS. Offentlig main var
fortsat .82/f880c682. PR53 nu squashmerged til479aa5b5ec0059344706b27fec80935b677d0189;
mainCI34819500914 bygger/publicerer. Ingen kodeændring eller gategenkørsel.
HA-fjernadgangen viser "Unable to connect to Home Assistant"; separat HTTPS-check
fejler TLS-forbindelse, og homeassistant.local:8123 kan ikke resolves her. Nabu Casa-
forbindelsessiden kræver login og er åbnet til brugeren. Det er adgangsblokering,
ikke bevis for add-onfejl. Installation, frisk config-status og robotliveeval kan
ikke verificeres endnu; ingen aktivering udført. Ingen beskeder til andre opgaver.
MainCI34819500914 nu PASS: lint-test1m42s, publish-addon2m9s. .83-image publiceret
sha256:a068b65dd15a6d69145bfe27fdaaab9bf2d687e431c5ef3bf211464d0f779a2e.
Kode, merge og publiceret installationspakke er færdige. HA-adgang/login er eneste
aktuelle installationsblokering; sikker robotliveeval og fysisk accept er stadig
ikke udført. Denne lokale leveringspost er ikke en påstand om installeret .83.

14/9 HA-adgang genetableret. .83 installeret én gang med eksplicit aktiveret backup;
HA viser lokal backup "PodVoice 1.13.82",14.04MB. Automatisk app-opdatering gendannet
ON. Kørende startupidentitet: version1.13.83,git479aa5b5ec0059344706b27fec80935b677d0189,
rootfs-v1:ba736c9d28213644518418a34307253671c9b37143a7b306ab89adfc93084562.
Promptv15:9f18bc2bdeafd28b30c5d6022adcf152975dce7cbcd920d2c5cc03d0331056c9;
MCPassist schema508001010df295576e6bd63f02594c9a6ab514da702c729049929aed30e90e23.
Sikker fuld robotprofil startet eval-1789373379-0712ad; resultat afventes før ON.
Voice PE er fortsat offline: mDNS-opslag timer ud, cached192.168.86.240:6053 giver
Errno113; samme fejl observeret før .83 på .82. Ingen firmwareændring eller fysisk
accept. HA/MCP og PodConnect svarer igen; forbindelsesfejl er ikke robotsemantik.

Liveeval-1789373379-0712ad afsluttet FAIL i device-sequence tur2: eneste finding
answer-pattern-mismatch. GET + fire forventede handlinger + end_conversation blev
godkendt; fire syntetiske sideeffekter, ingen virkelige HA-handlinger. Svar:
"Anmodningen er accepteret med maksimal sugestyrke og ekstrem vaskeintensitet, og
køkkenet er sat til at blive støvsuget og vasket to gange. Den fysiske udførelse er
ikke bekræftet." Oracle kræver sendt eller navngivet HA-accept. Manglende kilde er
under uafhængig vurdering; ingen påstand om falsk fysisk start alene fra regexfail.
2/8 ture kørt; rumspørgsmål/korrektion ikke kørt, candidate_contract_passed=false.
71529tokens,$0.1113872;94.57s budgetventen. Robotudvidelse verificeret OFF med alle
fem tidligere entiteter bevaret. Ingen blind genkørsel, oracleændring eller ON.

Leadbeslutning .84 — kun eval-oracle: uafhængigt robot_83_result_review reproducerer
falsk negativ; den citerede kvittering beskriver anmodningsaccept/fremtidig opgave,
ikke robotkvittering eller fysisk start. Samme svar med eksplicit HA-navn består.
Kæde/nabogrænser: completed modelrespons → evalobservations svartekst → bounded
regressionfilter → profilstatus → aktiveringsgate. Produktionsdispatch og fysisk
wake/playback/teardown/rearm ændres ikke. Hypotese: positiv regex er for snæver;
afgrænset passiv anmodningsaccept med eksplicit fysisk ukendt skal kunne bestå,
mens passiv accept fra robotten og fysisk succes fortsat afvises. Ikke-mål: ingen
prompt-, runtime-, schema-, firmware-, budget- eller aktiveringsændring; ingen
generel semantisk dommer og ingen retroaktiv godkendelse af .83-run.
Regressioner: observeret svar positivt; samme prefix med enhedsaccept/start/færdig
negativt; eksisterende rækkefølge, præcise mål, no-retry, close og exact-one-call
uændret. Konkret diff reviewes før én frossen releasegate, grøn offentlig artifact,
backup/installation og fuld frisk robotprofil. Rollback er .83 med udvidelse OFF;
fysisk gate stadig ukendt, Voice PE aktuelt offline.

Faktisk .84-diff: kun de to positive kvitteringsfiltre plus kontrasttests og
versionsmetadata. Passiv anmodningsaccept kræver i den nye regexvej eksplicit fysisk
ubekræftet; eksisterende sendt/HA-accept-veje er bevaret. Global negativ guard
afviser passiv accept fra robotten, også ved samtidigt "sendt". Det er fortsat et
begrænset regressionsfilter, ikke generel semantisk bedømmelse eller produktfraser.
Uafhængigt robot_83_result_review: GO, ingen P0/P1/P2;85tests PASS, rent diff-check.
Reviewhash fixture/tests acc9cc20a3788ca36c70b4d635225d7e038add464f0e07b7ffd39511b35786e6.
Fast PASS86.5s inklusiv fuld testsuite. Den gamle debug-venv manglede pytest; anvendt
eksisterende ekstern Python3.12.13 live-sdk-venv, ingen dependency-/runtimepatch.
Brugeren bekræfter strømmen til Voice PE havde manglet. Efter genindkobling viser
panelet automatisk native genforbindelse og wake-motorafprøvning; ingen manuel
add-on-genstart nødvendig. Fysisk ny wake/samtale er endnu ikke bevist.
Første releasekørsel havde grønne deltests men blev korrekt ugyldiggjort, fordi
lead opdaterede leveringsmetadata mens gaten kørte. Ingen produktfejl; hele diffet
fryses nu også for status, og kun den ugyldiggjorte releasegate genkøres.
Samlet frossen .84-releasegate PASS40.5s med Ruff/format127,mypy47,candidate-scope
og fulde unit/integration. Dette er efterfølgende leveringsmetadata; ingen ændring
af reviewet fixture/tests. Offentlig CI, installation og fuld liveprofil resterer.
14/9 PR54 headad73888b2b47f6dffb6af34e62ccff52f7b4f574 fik grøn CI34822345778
(lint-test1m31s,ARM64-build2m22s) og blev merged til
af0fad6c881db4d299feff5eafc4201dc5fece8d. MainCI34822612612 PASS og publicerede
.84-image sha256:ccec63e8e382dca478f572868cdfdd3adb95561240993c15b5965be0b363ff53.
Installation af .84 er endnu ikke udført: .83 blev eksternt stoppet10:28:43 og
startet10:30:46 på samme rootfs. Opgaven "Planlæg 10x hurtigere Voice PE" er aktiv;
ingen besked sendt dertil. Brugeren er spurgt om live-vinduet, før HA overskrives.
Automatisk app-opdatering er midlertidigt OFF til kontrolleret backup/installation;
gendan ON bagefter. Udvidelsen er stadig OFF. Ny .84-liveprofil/fysisk prøve resterer.
Senere læsekontrol fandt, at den separate API-opgave har stoppet nye prøver efter
eget fund; produktion forblev .83. Ingen tværopgavebesked sendt. Manuel lokal,
krypteret backup oprettet10:38 (UI-navn Custom backup2026.8.2),14.04MB, indhold
eksplicit PodVoice1.13.83. Opdateringsdialog verificeret .83→.84 og backupON.
.84 nu installeret én gang og Kører; automatisk app-opdatering gendannetON.
Startup10:40:16:gitaf0fad6c881db4d299feff5eafc4201dc5fece8d,
rootfs-v1:bacb3fd0c1b3f887ffa3b67d750ffbe61237a8669b2820ed44e47dc1d76ff260.
Prompt/schema er uændret fra .83. Fuld frisk sikker profil eval-1789375253-af30e5
startet på installeret .84; resultat afventes. Voice PE native forbindelse er tilbage.
Liveeval-1789375253-af30e5 FAIL/ufuldstændig efter4/8ture: device-sequence og
device-unknown PASS, device-ambiguous kun answer-pattern-mismatch. GET på eksakt
vacuum.eval_ambiguous, nul sideeffekter og åben samtale bestod. Svaret var:
"Jeg kan se to forskellige områder, der begge hedder Køkken, så jeg kan ikke sikkert
vælge det rigtige. Vil du have, at jeg renser kitchen_one, kitchen_two, eller begge?"
Regex genkender hvilk/præcis/to rum/flere rum/mener du, men ikke denne alternative
opklaring. Samtidig nævner svaret rå area_id'er, hvilket ikke opfylder den ønskede HA-rum-UX.
Fixture giver kun to identiske Køkken-navne og forskellige interne ID'er; ingen
brugbare menneskelige skel. Ikke bevis for forkerte robotactioner, heller ikke en
godkendt fuld profil. 110062tokens,$0.2251896,175.33s kapacitetsventen.
Lead stopper aktivering og yderligere blind evalgenkørsel; uafhængigt review af
samlet oracle/ambiguity-grænse bestilt før ny rettelse. .84 er publiceret/installeret,
men robotudvidelsen forbliver OFF og fysisk robot-/golden-chain-accept ukendt.

## Aktiv lead-beslutning — rent tak uden verbal kvittering .80

11/9 Lead Codex. Brugeren bestiller promptændring, test og installation. Direkte
feltobservation på installeret .78: trace 20260911T130736-240 viser spørgsmål om
klokken, korrekt opslag/svar, dernæst transskriptet “Tak.” og faktisk afspillet
“Selv tak. Sig bare til, hvis du mangler noget andet.” Ingen semantisk lukning;
normal idle-close/rearm fulgte. Dette er en unødvendig verbal kvittering, ikke en
fejl hvor tak ikke blev hørt. Baseline for kode er offentlig .79 main778f5bd.

Kæde: firmwarewake/mic → provider turforståelse → prompt/deklaration → reserveret
wait_for_user → korreleret silent-tool-ACK → eksisterende followup-mic → næste
spørgsmål/svar eller fysisk idle → teardown/rearm → ny wake. Hypotese: promptv14
forbyder wait_for_user ved al henvendt tale; den sammenhængende løsning er at tillade
et rent, afsluttet modtaget-signal uden ny anmodning som semantisk stille venten.
Ingen lokal fraseregel. “Ja tak” til et tilbud/godkendelse og tak med et spørgsmål
skal stadig behandles. Uklar henvendt tale kræver opklaring. Opgaver og fejl skal
stadig kvitteres sandt. Et rent tak lukker ikke automatisk samtalen.

Invarianter: Realtime ejer betydning, én ThinSession/half-duplex-kæde, eksklusivt
wait-signal, korreleret ACK og uændret generation/mic/playback/teardown/rearm.
Kontrakten for wait udvides i prompt, deklaration og autoritative dokumenter;
ingen runtime-mekanik, firmware, VAD, gain, timeout eller robotændring.

Planlagte regressioner: prompt/deklarationsparitet og promptmigration; ingen tale
ved stille venten (også audio uden transskript); næste meningsfulde tur besvares;
wait-ACK-fejl/stale ACK, idle-close og begge I/O-adaptere bevares. En afgrænset sikker
Realtime-profil afprøver ren tak, opfølgning, høflig handling, ja tak og uklar tale
med syntetisk dispatch. Kandidatens semantik må ikke arve .79-robot-evalueringen.
Uafhængigt adversarial review efter diff-freeze, fast og én releasegate, grøn CI.
Ingen lokal API-nøgle: live semantik testes på HA efter diagnostic-first installation,
med sand særskilt status indtil evalueringen består. Roborock HA ejer det aktuelle
live-vindue; ingen installation/live-test før det frigives. Rollback til .79 ved
regression. Fysisk rent-tak/opfølgning og ny wake er særskilt ubevist efter software-
gates. Før test er profilen fastlagt til 5 scenarier/12 ture: klokkeslæt → tak → ugedag →
høfligt regnespørgsmål → mange tak → udtrykkelig stille lukning; ja tak til præcis
godkendelse; høflig lyshandling; uklar rummål-henvendelse; ærlig fejl → tak.
Oracle kræver nul tekst/lyd ved alle tre rene kvitteringer, også før tool-kaldet.
Faktisk ændring: promptv15, parret wait-deklaration, kun stock-v14-migration og
kontraktdokumenter. Separat opt-in quiet-thanks-fixture/panelknap bevarer gamle
preflight- og replaycases. Ingen produktionsmekanik ændret. 35 målrettede prompt/
migrations-/adaptertests og fast PASS78.8s. Første fast blev ugyldiggjort af lokal
sandbox-bind-begrænsning og fixture-isolationsfejl; ingen runtimepatch fulgte dem.
Uafhængigt review fandt et eval-oraclehul: synkront tool-ACK kunne overhale allerede
kølagt svarlyd. Eval driver lægger nu ACK i samme FIFO og behandler output først;
59 målrettede checks består (inklusive pre/postcommit og direkte/forsinket ACK).
Roborock-opgaven har frigivet live-vinduet. .79 robot-eval fejlede et dobbelt opslag;
extended_device_control skal fortsat være OFF. .80 arver ingen robotgodkendelse.
Andet reviewfund var for svag fejl-oracle: en succesfrase med ordet fejl bestod.
Den nye profils fejlsvar kræver nu faktisk fejlbetydning og afviser kendte falske
succesudsagn; syv positive/negative kontrastcases beskytter dette. Reviewer tilføjede
rå-wire-regression med den faktiske OpenAI-adapter: output før præcis result-ACK
bliver observeret og kan ikke give falsk grønt. Samlet seneste målrettede gate25PASS.
Live-profilen beviser ikke alle former for afklippet lyd eller tak under ventende
opgave/godkendelse; disse uændrede regler dækkes kun af eksisterende øvrige tests.
Ingen fuld præflight, fysisk golden chain eller 10/10 kan udledes af denne profil.
Live Alpha har også frigivet sit vindue efter genstart af .79; ingen samtidige prøver.
Uafhængig reviewer quiet_thanks_080_review: GO til diagnostic-first release/install,
uløste P0/P1/P2=0. Reviewer kørte24 quiet/wire-tests PASS og diff-check. Diff fryses
nu. Første releaseforsøg stoppede før tests på .79s forældede coupling-record;
reviewposten er nu bundet til .80s faktiske produktionstræ. Endelig releasegate
PASS43.6s: Ruff/format127, mypy47, præcis coupling-record samt unit/integration.
Ingen runtimeændring efter freeze. Publicering, installation, kandidatens liveeval
og fysisk prøve resterer.


Kandidatcommit acc3e38700323cc79d99e2de98b231ea0c23955e, 20 gennemgåede filer.
Push blev afvist af automatisk godkendelseskontrol: offentlig .80-egress kræver
specifik brugerbekræftelse; tidligere .76-godkendelse blev ikke accepteret. Ingen
push, PR, CI eller installation udført. .79 er fortsat installeret. Kandidaten er
lokalt færdig, men ikke live-evalueret/testklar til fysisk acceptance. Afventer kun
bekræftelse af offentliggørelsen for at fortsætte den allerede bestilte installation.
Brugeren svarede derefter “Godkend alt”. Kandidat acc3e387 er publiceret som PR50;
GitHub CI34597589202 bestod. PR50 er squash-merget til main
4fd401645cd1c99e41935ab615d82e6b48803dad; mainCI34597873047 bestod inklusiv
publicering af den præcist testede ARM64-image. HA viser nu installeret1.13.80
(backup af .79 valgt før opdateringen), og panelet rapporterer samme version.
Native r0 er IDLE/connected med bekræftet hey_chat; MCP og PodConnect up.
Den aktive gemte prompt indeholder v15s stille-tak-regel; modellen er fortsat
gpt-realtime-2.1, og extended_device_control er visuelt verificeret OFF.
Quiet-thanks liveeval eval-1789129433-fad789 er startet én gang på HA; resultat
afventes. Ingen fysisk .80-samtale, golden chain eller10/10 endnu.
Startup-log verificerer git_sha4fd401645cd1c99e41935ab615d82e6b48803dad,
rootfs-v1:537fde31f6996919ceeea184d06d8f905f457405b1f52fe6686037c7ae2382dd,
promptv15:9f18bc2bdeafd28b30c5d6022adcf152975dce7cbcd920d2c5cc03d0331056c9,
effortmedium. Testen nåede bekræftelsesscenariet og approve_action omkring14:26;
det er fremdrift, ikke en PASS. Browserforbindelsen forsvandt derefter (CUA-timeout,
Chrome ikke længere tilgængelig i browserlisten). Samlet live-resultat kan derfor
ikke aflæses endnu. Ingen genkørsel eller runtimepatch. Den afgrænsede HA-test ejer
fortsat sin diagnostiklås indtil terminal status; .80 er installeret, men kandidatens
semantiske PASS og fysiske acceptance er ikke bevist.


Genoptaget11/9: terminal liveeval eval-1789129433-fad789 er gennemført12ture,
10PASS/2FAIL, pris$0.2500792. Alle3 rene tak giver eksklusivt wait_for_user,
output_emitted=false,0audiotokens og remain_open=true. Hele6tur-opfølgningen PASS.
To fejl: exact challenge-id vælges korrekt ved Ja tak, men30s servergodkendelse
udløber under evalens kapacitetsventen (approval_denied; ærlig fejl,0effekter).
Fejlcasen kræver kontor, selv om testkonteksten definerer stue som eneste rum;
modellen afklarer derfor legitimt i stedet for at ramme device_unavailable.
Kandidaten er IKKE fysisk testklar: fuld valgt semantisk gate er rød.

Lead-hypotese til eval-only korrektion: testopsætningen modsiger egne positive
forudsætninger; promptens nye tak-regel har derimod direkte3/3livebevis. Berørt kæde:
syntetisk kontekst → modelvalg → fixture-policy/kapacitetsventen → sandt resultat →
stilhed/opfølgning. Produktionens godkendelsesgrænse,30sTTL, model, prompt, firmware,
lyd, VAD, Thin, Talk og fysisk rearm må ikke ændres. Plan: kendt stue som utilgængeligt
mediemål i denne isolerede profil; målrettet Ja tak-kontrast til et almindeligt tilbud
uden adgangshandling. Eksisterende særskilte approval/expiry-regressioner bevares;
denne profil må ikke længere påstå positiv livegodkendelse af adgangshandlinger.
Reviewer vurderer afgrænsningen før implementering. Regressioner skal bevise kendt
mål→fejl, ja tak→meningsfuldt svar uden wait, samme produktionsprompt og uændret
approvalpolicy. Frossen releasegate og én ny installation kun for testrettelsen;
rollbackgrænse .80, hvis diagnostik eller produktionsidentitet ændres utilsigtet.

.81 er nu implementeret som7filers test-/versions-/dokumentationsdelta fra main4fd4016.
Uafhængig reviewer quiet_thanks_080_review GO,32målrettede checksPASS, ingen åbne
findings. Prompt/deklaration/harness/ExecutionPolicy/defaultmanifest byteuændrede.
Ny regression efterligner de målte ventetider og beviser korrekt30s-expiry med0effekter
samt kontrol uden ventetid med1fixtureeffekt. Tilbuds-oraklet accepterer naturlige
spørgevarianter, men afviser generisk tilbud, tidlig handling og tavst ja-tak-svar.
Stue-fejlfixturet er entydigt; gammel standardmedie-fixture er separat bevaret.
Den gamle .80-coupling-record er historiseret, da .81 kun har ét klassificeret domæne.
.80s tredje stille tak fulgte en opklaring, ikke den tilsigtede enhedsfejl; dette er
præcis den manglende dækning, .81 skal måle. Frosset diff; endelig releasegate PASS42.2s (Ruff/format127,mypy47,
kandidatscope,unit/integration). Fast-testene bestod, men resultatet blev kasseret,
fordi reviewerens sidste oraclepræcisering flyttede diffet under kørslen. Den fulde
releasegate tester de endelige bits. Ingen produktionsændring efter freeze.
Publicering af7gennemgåede .81filer blev afvist af automatisk godkendelseskontrol,
som kræver eksplicit godkendelse til det præcise offentlige payload. Ingen push,
PR eller .81installation udført; .80 er fortsat installeret. Afventer bekræftelse.

Brugeren godkendte eksplicit .81offentliggørelse/installation/test med “JA!”.
7filer publiceret som80a82484256bbb86b5e8b01a94929ddb43b046b5, PR51.
PRCI34600695018PASS inklusivARM64; squashmain34fb8c8b816801f4836c6fc21b69389970f4e218.
MainCI34600921751PASS inklusivpublicering afpræcis testetimage.
HAupdate til.81 er startet med sikkerhedskopi af.80 valgt; resultat ogliveprofilafventes.

.81installation bekræftet iHA ogstartup14:54:32: git34fb8c8b816801f4836c6fc21b69389970f4e218,
rootfs-v1:aec9819357afbc65316f5013d4e30898a464dc8fae2f7b98514390d29c8fdd66,
promptv15:9f18bc2bdeafd28b30c5d6022adcf152975dce7cbcd920d2c5cc03d0331056c9,
modelgpt-realtime-2.1/medium. HeyChatgemt, nativeforbundet, MCP/PodConnectverificeret,
extended_device_controlOFF visueltbekræftet. Ingenfirmwareændring.
Revideretquiet-thanks eval-1789131341-8e301e startetén gang; resultat afventes.

.81liveeval eval-1789131341-8e301e er terminal11/12PASS,$0.221228. Alle3tak er
stille/open,6tur-opfølgningPASS,ja-tak-tilbudPASS,høflighandlingPASS,uklarhedPASS.
Sidste fejl: HassMediaPause area=stue+domain=[media_player] blev schema-valideret,
men afvist af fixturet; et efterfølgende kald med device_class=[speaker] blev også
afvisteval_fixture_args_mismatch. Modellen gav en ærlig fejl og ventede stille vedtak.
Ingendevice_unavailable-case blev endnu udløst; samletgatefortsatRØD,ikkefysisk testklar.

Lead.82test-onlyhypotese: den eksakte lokale fixtureargs-list er smallere enddet
alleredevaliderede shippedeHA-schema. Kæde: model→produktionsschemavalidering→fixture-
argsmatch→fejlresultat→sandtsvar→stille kvittering; produktionsdispatch/Thin/firmware
ogpromptv15måikkepatches. Retkunprofilens tilladteheledicts til3direkteverificerede
former (areaalene,area+domain,area+device_class), allemedsammeutilgængelighedsfejl.
Ingennormalisering/wildcards/ukendtefelter. Oraclekræverstadigpræcisétkald,0effekter,
ærligfejl/open. Regressioner: alle3former, forkertmål/domæne/klasse,ekstrafelter,
tom-/multiliste ogdobbeltekald; standardfixturesuændrede. Liveadmissionvaliderer
allecasesmodaktueltHAschemaførproviderforbrug. Kombinerededomæne+klassefelter er
ikkeobserveret ogtilføjesikke. .82nummerkoordineretfritmedrobotopgaven. Rollback.81;
review,énfrossengate,konkretpubliceringstilladelse,installation oglivePASSafventes.

.82uafhængigreviewGO quiet_thanks_080_review,45målrettedePASS,ingenP0/P1/P2.
FastPASS79.4s. Alle3formerog10negativevarianter/dubletterafprøvet;
prompt/Thin/harness/policy/settings/defaultmanifest/panel/firmwarebyteuændrede.
Diffetfrosset;releasegatePASS41.3s(Ruff/format127,mypy47,scope,unit/integration).
.81diagnostiklåsfrigivet,nativeIDLE/connectedhey_chat.
.82har7gennemgåedefiler. Offentligpush blevafvist afautomatiskgodkendelseskontrol,
somkræverspecifik.82payloadgodkendelse; .81godkendelsenaccepteresikke.
Ingen.82commit/push/installationudført. RevideretlivePASSogfysiskacceptanceresterer.


## Aktiv lead-beslutning — præcis wake-samplegrænse .78

11/9 Lead Codex. Brugeren kræver både sammenhængende “Hey Chat, hvad er klokken”
og “Hey Chat” → pause/cyan → samme spørgsmål. .77 er installeret fra main52b1e5e;
serveranalysen af .76trace20260911T092402-321 er gennemført. Første provider-item
0–640ms indeholder en allerede-devicebåret energihale:99.95% energi første160ms,
RMS320–640ms3.95. Spørgsmålet kommer senere; mic-close/quarantine afskærer det efter
at halen har udløst velkomst. Halesemantik er ukendt; transskript er ikke bevis.

Kæde: fælles fysisk mic-chunk → PV-sampleclock/rolling ring → MWW-kø/feature-consume →
detektionskø → firmwarelatch/mic → native/preconnect → første provider-item → Thin
accept → playback → teardown/rearm → ny wake. Mindst begge sider af mistænkt grænse
indgår. Invarianter: firmware ejer wake; én Thin/mic-gate; Realtime ejer semantik;
post-detectionlyd bevares, ingen wakeprefix som brugerinput; stale generationsgrænser;
Talk uændret. Ingen gain/VAD/prompt/sensitivity/delay/fraseregler eller ny runtimevej.

Hypotese: fast320ms callback-relative replay genindfører lyd før den faktiske
behandlede detektorposition. En korreleret sampleposition fra samme rå mic-chunk,
båret uændret gennem MWW-detektionen, kan kassere den gamle prefix og bevare alle
senere samples trods inference-/main-loopkø. Producer-snapshot ved inference er
udtrykkeligt afvist af uafhængigt årsagsreview: det kan være foran/bag modelinput.

Plan før implementering: PV passiv callback publicerer fælles producerposition før
MWW-callback fra samme mic-chunk; konfigurationen binder begge til samme fysiske mic
og rate. MWW mapper faktisk consumed-featureposition til denne clock. Separate
cursorer/generationer og kontrolleret bufferreset beskytter overflow/restart. Markør
følger queued detection; firmware bruger den én gang og logfører produced, consumed,
callback og retained. Ingen forkortelse ved senere start/keepalive. Forkert/stale/
utilgængelig mapping fejler lukket. Den faktiske model kan stadig detektere sent;
det skal måles fysisk, ikke antages væk.

Regressioner: faktisk PCM-ring under pause+initialhale, direkte tale og korte spørgsmål;
forsinket callback/backlog, begge callbackrækkefølger (forkert mapping afvises), wrap/
overflow, samtidige producenter, dublet, keepalive, stale detection efter teardown/rearm.
Test shippede/genererede komponenter og native/preconnect/Thin/Talk-feltregressioner.
Uafhængigt adversarial review før én frossen releasegate og firmwarecompile. Release/
installation dokumenteres særskilt. Rollback .77 med .76firmware; ingen ny kandidat
arver fysisk godkendelse. Parret fysisk pause/same-breath og lifecycle kræves efter
installation. Lokal implementering og 75 målrettede tests består; fuld releasegate,
publicering, installation og fysisk bevis er endnu ikke gennemført.

Uafhængigt review fandt check→trim-race, gammel feature over PVepoch og skjult Stop-
blindperiode ved mappingtab. Atomisk claim med MWW→PV-låserækkefølge, streng PVepoch-
floor og eksplicit Stop-fault ved shared-frontend-reset er implementeret. Actual
worker-reset-regression bevarer fault og remapper frisk input; normal mic-close
bevarer Stop/frontend. C++-harness kompilerer begge faktiske komponenter med platform-/
modelstubs og PCM-ring. Det beviser mekanikken, ikke modellens akustiske detektionstid.
ESPHome2026.6.2-konfiguration med lokale kandidatkomponenter består; actual final-
validator afviser forkert fysisk mic og begge priorityoverrides. App sorterer setup
faldende, PV101 før MWW100, MicrophoneSource registrerer direkte på samme callbackliste.
Lokal pre-P2 firmwarecompile bestod116.6s; det er ikke det endelige artifact.
Sourcefreeze-review: P0/P1/P2=0, uafhængigt4/4 C++harness PASS. Reviewer
pause_076_causal_review; seks komponentfiler samletSHA
1d87411a1afdd635e10006a0960f9bde1bcf36d5899c9452195f6b4be2336dcb.
Kilden er lokalcommit61da40c0885e07641a334636f5f2548288ed84f1; begge ændrede
komponentpakker er pinnet dertil. Partial-write og min64ms-ring er dækket.
Whole-diff review: GO til frossen releasegate, P0/P1/P2=0. Reviewer har uafhængigt
kørt4 C++harnesses og12 firmwarekontrakter; tidligere69/70 havde kun én forældet
pin-assertion, som nu er rettet. Sourcecommit blev formatteret (Pythonimport),
uden C++-/runtimeændring. Fast PASS77.2s, efter normale formatteringsrettelser og
opdatering af den gamle testref. Scope er én ejergrænse: rearm. Ingen ændring af
prompt/schema/Realtime-semantik, så ingen SafeEval. Frossen releasegate PASS40.4s: Ruff/format, mypy47, candidate-scope,
unit og integration. Ingen manuel CI-genkørsel. Main er frisk verificeret52b1e5e.
Offentlig kilde/image, endeligt pinned firmwarebuild, installation og fysisk bevis resterer.

Sidste faktiske ESP32-compile fandt std::min-typekonflikt på32bit. Én eksplicit
<size_t>-templateparameter rettede den uden semantisk ændring; særskilt review
P0/P1/P2=0. Lokal endelig firmwarecompile PASS16.75s, ESPHome2026.6.2,
config_hash0xd5520ca2, build11/9 12:14:30. Fem genererede C++/headerfiler er
byteidentiske med source61da40c0885e07641a334636f5f2548288ed84f1; main har ny marker og wake-claimwiring.
OTA3054064bytes SHA256dc897525790339ea17974dabfa280995c327ffdb244497e73a43b51eca0aad71.
Firmware bruger lokale komponenter svarende til de kommende immutable pins;
remote-pin-build kan først verificeres efter offentliggørelse. Ingen OTA udført.
Den tidligere releasegate40.4s er superseded af denne compilerettelse; sidste diff
fryses nu til ny gate. Automatisk review afviste publicering, fordi tidligere
eksplicit approval dækkede .77, ikke19filerne i .78. Ingen publicering/PR/install.

Endelig frossen gate efter compilerettelsen: PASS40.4s (Ruff/format, mypy47,
candidate-scope, unit/integration). Komponentpins og18fil-integritet består.
19 gennemgåede filer er lokalt klar; offentliggørelse og installation kræver
brugerens eksplicitte .78-godkendelse efter automatisk afvisning. Ingen ny fysisk prøve.
## Aktiv lead-beslutning — Roborock bruger HA-områder, 11/9

Lead Codex. Bruger godkendte implementering af rumkobling, forkert værktøjsvalg og
diagnose af ventetid. Isoleret clone /private/tmp/podvoice-roborock-ha-areas,
branch codex/roborock-ha-areas på main52b1e5e (.77). Ingen ændring af den separate
.78 wake-kandidat, firmware, gain, VAD, scripts eller eksisterende Assist/Spotify.

Frisk HA UI: Core2026.8.2. Otte HA-områder på Stueplan, ni segmenter; Kitchen21 og
Dining room22 deler Køkkenalrum Stueplan. Balcony19/24 er ikke koblet. 1.Sal har
separate koblinger. Intet gemt/omdøbt eller startet i HA under kontrollen. Officiel
2026.8.2-kilde bekræfter get_entries.options.vacuum.area_mapping og kortbundne IDs
mapFlag_segment; area_registry/list leverer områdenavne/aliaser.
Implementeret HA-area-ID som modelmål, server-ejet ekspansion til alle segmenter,
navne/aliaser i bounded snapshot og afvisning af stale/partiel/cross-map kobling.
Entydig robot læses uden ekstra liste/modelrunde; ingen nye værktøjer eller budgetlofter.
Private segmentgrupper bevares i capability, ikke gentaget i modelresultatet.

Uafhængigt årsagsreview fandt ikke dobbeltreservation. Ca17.49s ligger før udførelsen,
men pacingårsagen kræver næste måling. Allerede eksisterende production_capacity_wait
og scalarfelter føjes kun til armet fysisk trace; ingen ændret pacingmekanik.
Reviewer robot_area_freeze_review reproducerede P1: sidste area-read lå efter state-
kontrol og kunne skjule kortskift/busy. Metadata flyttes før det sidste samlede state-
snapshot; fire regressioner injicerer map/busy under begge metadataawaits. Kandidaten
er IKKE testklar, indtil rettelsen er uafhængigt genkontrolleret og gates består.

Målrettet166-testsæt bestod før sidste reviewrettelse. Første brede fast havde
localhost-sandboxfejl og en testfixture-rækkefølgefejl (nye scenarier indsat før gamle
indeks); ingen produktpatch for miljøfejlen. Fixture-orden rettet; følgende fulde
pytest bestod, men fast-gaten afviste korrekt ændret scope under kørsel: resultatet
er kasseret. Ny gate køres først på stabilt diff. Rebase37c1b12 ovenpå frigivet
.78/main4e5d22c bevarer hele PR48; kun STATUS-konflikt, begge beslutningsposter bevaret.
Bruger godkendte installation når gates tillader. Ingen robotrelease eller installation
udført her endnu; fysisk godkendelse, SafeEval og endeligt review står åbne.

Bruger har nu eksplicit godkendt diagnostik-først: efter grønt review/kodegate må
.79 installeres med extended_device_control=false, derefter sideeffektfri HA-hostet
device-control-eval under providerlåsen. Kun bestået eval og gennemgåede svar kan
genåbne udvidelsen til fysisk prøve. Tidligere true/fem tilladte entiteter gemmes;
listen bevares ved midlertidigt fravalg. Ingen API-nøgle flyttes til lokal clone.
Reviewets anden P1: finalregistry kunne vise ændret robot-/control-identitet uden
afvisning. Samme relevante-gruppe/identitet bruges nu både i snapshot og sidste
metadata-kontrol; seks kausale mutationstests består. Første P1s fire tests består.
84 robot-unitcases er grønne efter rettelserne; det er stadig ikke releasegate.
P2: gamle ekstra handlingsfelter fjernet fra evalfixtures, så de matcher den nye
produktionskontrakt. Syntetiske testområder har anonymiserede børneværelsesnavne.
Reviewers live-shape-probe med tre faktiske control-ID/formater og syntetiske HA-ID'er
er1456UTF8bytes og bevares af providerens rigtige serializer; faktiske aliasmængder
afventer live readback. Maks1800 for capability/envelope2048 bevares.

Endeligt uafhængigt review robot_area_freeze_review: GO til freeze/gates,
ingen åbne P0/P1/P2. Sidste P2 lukkes med closure-/sessionsguard på traceobserveren:
en gemt gammel callback kan ikke skrive ventetid ind i næste armede samtale;
original sink bevares, pacing/lifecycle er uændret. Permanent A→close/rearm→B-test
og reviewerens oprindelige reproduktion består. Uafhængigt147 device/eval-tests,
11 registry/Voice/Talk-tests og12 Thin capacity/observer-tests består. Runtime-
diffhash e4b54f9e71f447b387d4629bed04f45dc9b9192a0282fcb02ba6f47b9bc35f8d.
Dette er teknisk review, ikke SafeEval eller fysisk accept. .79 beholder .78-firmware.
Installation må ikke afbryde den separate armede .78-wakeprøve; vindue afventer.
Stabil fast PASS81.6s, efterfulgt af én frossen releasegate PASS43.2s:
Ruff/format126, mypy47, exact reviewed coupling samt unit/integration er grønne.
Ingen produktionsændring mellem review, fast og release. CI/ARM64-mainartifact,
diagnostisk installation, live SafeEval og fysisk acceptance resterer.

<!-- historical-080-coupling
{"version":1,"base_tip":"778f5bd8b578a5b9830e8f7840161c29985af1de","merge_base":"778f5bd8b578a5b9830e8f7840161c29985af1de","domains":["ha_tools","realtime_semantics"],"fingerprint":"9057adf48e7355586afc2c2f0d89091032c7c5d306c84ca705dba663805e5d8f","reviewer":"quiet_thanks_080_review","rationale":"One model-owned silent acknowledgement contract: matched prompt/declaration and stock migration, isolated synthetic semantic gate and both-adapter regressions. Actual provider wire verifies output before synchronous ACK; no production lifecycle, audio, firmware or robot-control change."}
-->

Direkte .77-runtimebevis: session r0:1789121515721818489. Første spørgsmål blev
fragmenteret efter uønsket velkomst. HassVacuumStart blev foreslået på et rumspørgsmål,
men needs_confirmation blokerede start. Efter brugerrettelse gav to capabilities-
opslag rå engelske Roborock-navne uden HA-kobling. Speech-stop→fysisk svar24265ms;
opslagenes registrerede udførelse4ms/241ms, med ca.3.84s/13.66s før udførelse.
Kæden sluttede rent med teardown/rearm. Dette er fejlbevis, ikke robotgodkendelse;
ingen robotstart observeret. Kapacitetsventen er en hypotese, ikke endnu bevist årsag.

Kæde: wake/input→Realtime-intention→completed batch/admission→read-only HA registry,
aktuelt kort og rumkobling→modelvalg→servervalidering→HA-kald→sand kvittering→fysisk
playback→close/rearm→næste wake. Invarianter: Realtime ejer semantik; server ejer
eksakt mål/autorisation, enkeltudførelse og stale-grænser; én Thin/Talk/Voice PE-kæde;
kapacitetsgrænser og2048-byte-resultat bevares. Ingen lokale tale-/navnegætteregler.

Hypotese: extended snapshot springer options.vacuum.area_mapping og HA-områderegister
over; den eksisterende engelske værktøjsnote forstærker fejlen. Verificér live mapping
og installeret HA-kontrakt; forbind HA-area-ID/navn/alias til ALLE kortbundne segmenter.
Revalider mapping/kort ved handling, afvis tvetydig/stale mapping. Entydig robot kan
opslås direkte uden modelrunde til liste. Kortlæg pacing før evt. særskilt rettelse;
ingen budgetforøgelse eller fjernelse af kvitteringsreservation.

Planlagte tests: flere segmenter per område, flere kort med genbrugte segmentnumre,
ændrede/slettede mappings, manglende områder, Unicode/aliaser, fulde poster indenfor
bytegrænse, offline/timeout, replay/generation og settings→start-kæde. Semantisk sikker
eval for rumspørgsmål, negation, fragment/korrektion og start; nul sideeffekter i eval.
Målrettede adaptertests→fast→uafhængigt adversarial review→frossen releasegate + bounded
SafeEval. Fysisk test afventer maskinel gate og forklaret inputkæde; ingen ny fysisk
godkendelse. Rollback: præcis tidligere installeret artifact/config, eller separat
disable af udvidelsen; ingen af dem arver stabilitetsbevis. Release/install resterer.

## Aktiv lead-beslutning — .76 fejler ved pause, nu med gemt lyd

Lead Codex,11/9. Brugerens præcisering: Hey Chat blev hørt; brugeren ventede,
og velkomsten begyndte før spørgsmålet. .76/main70a623a/rootfs760a2d5e og
firmware11376heychat1/Moderate230 er installeret. Denne pauseprøve FEJLER;
kandidaten er ikke fysisk godkendt eller testklar til videre accept-/børnerunde.
Følsomhedens installation er bevist, men genkendelsesrate er ikke målt.

Trace20260911T092402-321/sessionr0:1789111442321107169,11/9 kl.09:24:02:
fysiskwake+1ms,mic+275,provider+2548; first item_EMpu8d4lAH0FH8u6FKcZK
speech-start modtaget+3509 med audio_start_ms0,stop+3511 med audio_end_ms640.
Thin accepterer første item og lukker mic+3511; response.create+3649.
Transskription af første segment: Okay. (diagnostik, ikke akustisk bevis).
Second item_EMpu9LutzaVOND5HiVkUo starter+3650/audio_start_ms2380 og afvises
under THINKING; stop+6705/audio_end_ms4219,deleteACK+6843,transkript
Hvilken dag er det?+7251. Velkomst fysiskstart+6333,finish+11019,followup+11240,
idle-close+15248,teardown+15522,recovered+15806. Ingen velkomst fra idle-timeout.
Brugeroplevelsens før-spørgsmål og providerens buffer-/eventure holdes adskilt;
transskriptets ankomsttid må ikke omsættes til faktisk talestart.

Recorder faktisk gennemført: device249088samples/16kHz/15568ms,
provider231839samples/24kHz/9660ms,speaker105120samples/24kHz/4380ms.
Alle tre WAV-links og manifest findes i HA; næste-capture er nu forbrugt/slået fra.
Browsermanifestet er læst inkl. providerens egne offsets. Lokalt audioexport har
endnu ikke leveret fil: pageAssets klassificerer WAV som video og afviser MIME;
anonym direkte API-læsning401 (ingen cookies/nøgler hentet), browserens normale
gem-dialog gav ingen observeret lokal fil. Downloadoversigtens URL blev blokeret
af browserpolitik og blev ikke omgået. Lyden er IKKE gennemlyttet endnu.

Kæde og invarianter er fortsat firmware-wake/buffer→native/preconnect→provider-
segment→Thin accept/gate→quarantine→playback→close/rearm,næste wake;
firmware ejer wakegrænsen,én Thin,half-duplex,livscyklus1–2/6–11.
Falsificerbar hypotese: første0–640ms indeholder wake-rest fra bevaret320ms
bridge eller umiddelbar efterklang. Kun lyd kan skelne dette fra anden lyd eller
providersegmentering. Uafhængigt årsagsreview igangsat. Ingen ny gain,VAD,prompt,
timeout,buffer- eller firmwareændring. Næste kodebeslutning kræver forklaring af
startsegment og spørgsmål samt regression for pause/sammenhængende tale,kort
spørgsmål,stale generation,Talk,recovery og shippede komponentbytes.
Uafhængigt årsagsreview: mic-close/quarantine følger den eksisterende half-duplex-
kontrakt; mistanken ligger før Thin ved wake→prefix. Genereret og repoets
podvoice_audio.cpp er byteidentiske SHA256
fef75ce3e898b032e2c9053389086f20a61f8656e36551c046f2b5e63350e122,
begge WAKE_BRIDGE_MS320. Ingen observeret artifact-mismatch. Provider-WAV indeholder
også syntetisk nul-PCM under quarantine; audio_end4219 er derfor ikke ren fysisk
slut på spørgsmålet. Eksisterende firmwaretest er tekstassert; same-breath-integration
antager, at fixture allerede indeholder spørgsmålet. En grænserettelse skal derfor
bevises med faktisk PCM-ringtest og kausal pause/same-breath-sekvens.
11/9, adgangsdiagnose: Google Admin viser ingen særlige downloadbegrænsninger for
både boxz.dk og mba-brugeren. Brugerleveret politikliste fra samme Chrome-profil
viser DownloadRestrictions, OnFileDownloadedEnterpriseConnector og øvrige
downloadregler som Ikke angivet. Ingen Workspace-politik er ændret; årsagen til
Chromes downloadblokering er fortsat ukendt. .76-artifact-ruten returnerer WAV som
audio/wav uden særskilt downloadspærring i PodVoice-koden. Direkte afspilning af det
eksisterende provider-spor blev startet via browserens afspil-knap; efterfølgende
skærmbillede viser 0:09/0:09. Det beviser afspillerfremdrift, ikke at agenten har hørt
indholdet. Brugeren er bedt identificere starten af optagelsen; akustisk årsag og
pausefejl forbliver åbne. Ingen ny optagelse, runtimeændring eller installation.
Rollback for .76 er fortsat .75/Stop2-parret; .75 havde samme pausefejl og er ikke
et bevis for en løsning. Ingen automatisk rollback på denne kendte pausefejl.

### Aktiv diagnoseudvidelse — analyser gemt lyd på HA

11/9: Bruger har eksplicit sat mål om hurtigst mulig løsning uden mere manuel
browser-/lyttehjælp. Lead Codex. Eksisterende WAV ligger fortsat på HA, mens lokal
download er blokeret; browserafspilning alene giver ikke agenten adgang til lyden.
Eksisterende replay er begrænset til kendte evalfraser og vælger samples ved event-
modtagelse, ikke providerens audio_start_ms/audio_end_ms. Den kan derfor ikke bruges
ukritisk til dette korte første item. Ingen ændring af historisk manifest.

Plan: afgrænset, eksplicit startet analyse af én afsluttet optagelse på serveren.
Brug item-korrelerede provider-offsets til første segment, beregn niveau/tidsprofil,
og indhent diagnostisk transskription via samme OpenAI-konto; ingen lydfiler eller
nøgler udleveres i analyseresultatet. Modelfortolkning er stadig sekundært bevis.
Analysen må ikke ændre optagelsen, åbne mikrofon, afspille på pucken eller styre hjemmet.
Én kørsel ad gangen, hårde lyd-/tids-/responsgrænser og ingen automatiske retries;
værn mod traversal, symlinks, forkert WAV-format, stale item/generation og afbrudt job.
Invarianter: én Thin/lifecycle-ejer, fysisk gate uændret, privat ingressadgang og
adskillelse mellem rå lyd, transskript og bevist årsag. Hypotese: serveranalysen kan
afklare segmentets indhold og energifordeling uden browserdownload.
Regressioner: provider-offsets versus modtagelsestid, samme item/generation, korrupt
og for stor fil, netværksfejl/timeout, dubletstart og ingen produktionssideeffekter.
Uafhængigt review kræves før release. Kandidat .77 er implementeret lokalt i /private/tmp/podvoice-pause-analysis.
31 målrettede regressions-/HTTP-tests er grønne; fast-gaten bestod på76.8s. Første
HTTP-testforsøg manglede sandboxens localhost-tilladelse og blev kørt én gang igen
med den korrekte tilladelse; ingen runtimepatch som følge af miljøfejlen. Uafhængigt
review har lukket generation-, overlappende item- og stale callback-findings og
melder P0/P1/P2=0 på det aktuelle diff. Browsertest dækker start, kørende, reload, resultat, fejl og aktiv optagelse ved
320px/desktop. Første browserfixture manglede UTF-8 og blev rettet til shippet
tegnsæt; ingen ændring af produktionskode pga. denne testfejl.
Frossen releasegate PASS39.9s efter uafhængigt review af14filer,
diffSHA83ed8c21688f49195ea83eb141081e083fb9211d23c355159e014c722a5a316e.
Ruff/format126filer,mypy47 og hele unit-/integrationssættet grønne.
Web-only-negativkontrollen består med korrekt staging og eksplicit domæne-/filassert.
Ingen publicering eller installation endnu. Scopeklassifikatoren ser audio_input og
physical_output, fordi analysen læser disse eventnavne. Den eksisterende mekanisme
for eksakt uafhængigt review er udvidet snævert til de fem analyse-/paneloverflader;
Thin, adaptere og firmware afvises fortsat selv med en ny gyldig reviewhash.
42 scope-/analysetests bestod før sidste ekstra web-only-negativkontrol.

<!-- historical .77 scope record
{
  "version": 1,
  "base_tip": "70a623a08e2dfb29328c9f391105deb30920924c",
  "merge_base": "70a623a08e2dfb29328c9f391105deb30920924c",
  "domains": [
    "audio_input",
    "physical_output"
  ],
  "fingerprint": "c51fc7444456c8d2ade68db02c90eaa32a2c98ca06d9e1eade2e542db7a5c5a4",
  "reviewer": "pause_analysis_review independent adversarial review",
  "rationale": "Read-only completed-recording analysis must name input and playback events to reject ambiguous first-item boundaries. No Thin, Realtime, VoicePE or firmware behavior changes. Exact five-file production surface reviewed with bounded server analysis, shared diagnostic ownership, strict ingress and permanent regression tests."
}
-->
Ingen firmware-/VAD-/gain-/prompt-/Realtime-semantikændring; SafeEval er derfor ikke
relevant for dette diff. Tilbageførsel er .76 med uændret11376heychat1-firmware.
Ingen akustisk tuning må baseres alene på et nyt transskript.


## Aktiv lead-beslutning — virksom Hey Chat-følsomhed oven på .75

Lead Codex,10/9. Bruger ønsker følsomhedsrettelsen leveret før næste fysiske prøve.
Baseline er installeret .75/maincb6e96b med Stop2; diagnostik og genforbindelse bevares.
Direkte kildebevis: den gemte sensitivity-selector ændrer kun de tre andre modeller;
Hey Chat fastholdes på manifest242/255, selv ved gemt Moderate. Tidligere native
readback viste Moderate. Rummets genkendelsesrate og modelscorefordeling er ukendt.
Hypotese: korrekt wiring giver Moderate230/255 og dermed flere accepterede score-
vinduer. Det beviser ikke bedre genkendelse i køkkenet eller løsning af pausefejlen.

Hele kæden: selector restore/apply → modelscore/cutoff og cooldown → firmware wake/
latch/320ms-prefix → native/preconnect → Realtime/Thin accept/quarantine → playback/
Stop → close/rearm → næste wake. Lavere cutoff kan flytte detektionstidspunkt og
påvirke cooldown; derfor skal både pause og sammenhængende tale prøves efter levering.
Invarianter: firmware ejer wake, én Thin/VoicePELink, half-duplex og lifecycle6–11,
korreleret Stop/rearm, sand artifact- og optagelsesstatus. Ingen ændring af mic-gain,
VAD, vindue, wake-model, 320ms-buffer, prompt, providersemantik eller LED/tidsfrister.

Plan: port den afgrænsede selector242/230/217 og faktisk getter-log fra lokal .73 til
.75; giv firmware og add-on én ny eksakt parmarkør11376heychat1. Bevar tilbagevalg
Slight242. Permanente actual-lambda- og firmwarekontraktregressioner, detectorens
cooldown/disable/rearm-review, fælles Thin/Talk, .74-recovery og .75-manifestregressioner.
Fast, config/compile, uafhængigt Ultra-review ved freeze og én samlet releasegate.
Ingen SafeEval: ingen ændring af Realtime-/audiosemantik. Fysisk resultat er ukendt.

Før installation kræves frisk .75-backup og verificeret Stop2-rollbackbinary samt
målidentitet/nøgle uden secret-output. Opdater add-on/firmware som par; add-on holdes
stoppet under mismatch. Efter installation verificeres native markør, valgt Hey Chat,
faktisk cutoff230 fra getter-log, forbindelse og frisk arming. Ved falske wakes bruges
Slight242; ved lifecyclefejl tilbagerulles begge til .75/Stop2, uden at kalde rollback
fysisk stabil. Offentlig publicering af denne firmwarekandidat er endnu ikke godkendt;
den tidligere .75-godkendelse dækkede diagnostikfilerne. Ingen installation udført.

Implementeret .76-port: fuld fast PASS83.4s; første sandboxkørsel blev afvist ved
lokal socket-oprettelse og er ikke produktevidens. Korrekt tilladt testkørsel grøn.
ESPHome2026.6.2 compile PASS107.41s/config0x35047002/build20:34:00+0200;
RAM76088/23.2%, flash3051607/37.6%. Esptool5.3.0 bekræfter checksum og imagehash.
Ny firmware SHA256f4030c0bd769c55eb316f2282ac10dbe7db362098ad50877ee8abd4ca67a06c6.
Generated Noise-key matcher tidligere productionbuild (kun boolsk sammenligning).
En kendt tilbageførbar Stop2-binary ligger under /private/tmp/podvoice-stop-word,
SHA256823f0f394ece0b50f829fcb41c80b278cf22889d3fe73df19bca5f3a53664672.
Den anderledes /private/tmp/podvoice-stop-rollback indeholder Stop1 og må ikke bruges.

Gentagen buildcachefejl var manglende WHEEL/METADATA i uv-arkiver. Den færdige compile
og imagevalidering er grønne; ingen runtimepatch. Precheck udvidet med --uv-cache og
permanent manglende-WHEEL-regression. Den beskadigede cache er bevaret som
uv.incomplete-20260910-heychat076; ny cache samt venv/penv-precheck er grønne.
Der genbygges ikke blot for en efterfølgende cacheadvarsel; buildbits er valideret.

Uafhængigt Ultra-review GO, P0/P1/P2=0. Reviewer kørte109 kontrakt/selector/recovery-
checks,232 Thin/Talk-integrationer,22 provider-offset/capture,27 Stop-checks og begge
firmwaremiljøtests samt1320 genkompilerede detectorchecks mod genereret kilde. Model-
og komponentbytes samt ny OTA og gammel Stop2-rollback er uafhængigt verificeret.
Staged reviewdiff SHA25618516909de6cd9e63308ce5311e1903248ab6e1a9abdb6751f86838b3c27da7b;
productiondiff39ab805ccc3fab6dbdca68ff3757ba7d63050f6cc7e3ee0e9713409d37900b52.
Ingen fysisk forbedring eller lifecycle-godkendelse udledes. Frossen releasegate
PASS39.4s inklusive hele unit/integration, Ruff/format, mypy og candidate-scope.
Kandidaten er lokalt færdigbygget og gennemgået; afventer eksplicit offentlig
publicering, exact-head CI/main-image og parret installation. Ingen brugerprøve
bestilles før det installerede par og lydoptagelsen er verificeret.

## Aktiv lead-beslutning — leverbar første-input-diagnostik på .74

Lead: Codex, 10/9. Installeret baseline er .74/main6f64cc2 med Stop2-firmware.
Et nyt fysisk pauseforsøg viser første accepterede lydsegment, afvist næste input
og en generisk velkomst. Almindelig tidslinje findes, men lokal optagelse var ikke
armed; tidligere udviklede provider-audiooffsets blev aldrig installeret.
Hypotese: første segment indeholder wake-rest; lyd og providerens egne offsets skal
kunne falsificere den. Eventmodtagelsestid kan ikke bruges som akustisk grænse under
hurtig drænning af preconnect-bufferen. Dette ændringssæt retter diagnosedækningen,
ikke den endnu uafklarede akustiske årsag.

Kæde/naboer: firmware-wake/lydbuffer → native/preconnect → providerens speech-event
→ passiv observer → armed manifest sammen med device/provider/speaker-WAV →
Thin accept/quarantine → playback → teardown/rearm → næste wake. Diagnostikken
må aldrig styre nogen af disse beslutninger eller krydse provider-generationer.
Invarianter: én Thin-ejer, half-duplex-kontrakt, lifecycle6–11 og sand evidens.
Scope: flyt den eksisterende bounded offset-patch til .74; vis eksplicit optagelse
slået fra versus næste samtale versus optager, samt dato/version for tidligere lyd.
Ingen ændring af wakefølsomhed, firmware, lyd, VAD, prompt, timeouts eller armingpolitik.
Optagelse er fortsat lokal og én samtale per aktivering, højst60s, seneste12 traces.

Planlagte gates: rå speech-events gennem observer og armed manifest, ugyldige/
manglende offsets, stale generation, uarmeret paritet, Voice PE/Thin/Talk og .74-
genforbindelse; synlig panelstatus kontrolleres. Uafhængigt review før én frossen
releasegate, derefter exact-head CI/main-artifact, backup og installation.
SafeEval er ikke relevant: ingen prompt/schema/Realtime-semantik ændres.
Rollback: .74 add-on, samme Stop2-firmware. Kandidat .75 er endnu ikke udgivet,
installeret eller fysisk afprøvet. Lydoptagelse skal aktiveres og verificeres EFTER
installation, før brugeren bedes gentage forsøget; en lokal test er ikke den kontrol.

Implementeret: eksisterende bounded audiooffsets og observerallowlist porteret til
.74, versionsmetadata .75. Full fast PASS74.4s: hele pytest-sættet74.04s,
Ruff/format og mypy46. Ingen ændring af .74 VoicePELink eller firmware.
CUA har kørt den faktiske index.html uændret via lokal HTTP med syntetiske API-data:
off + tidligere trace viser slået fra og optagelsesdato/.70-version; armed viser
næste samtale og genstartsnulstilling; active viser optager/højst60s; API-fejl viser
ukendt og deaktiverer arming. Dette er panelverifikation, ikke fysisk lydbevis.
Uafhængigt Ultra-review GO, P0/P1/P2=0: 37 fokuserede regressioner samt60
baseline-sammenligninger på duplicate/unknown/malformed events og observerfejl på
Voice PE/Talk bestod. Rå provider-events nåede faktisk Thin-observer og gemt manifest.
ReviewdiffSHA256 cf5f95faa31e89c458bd670b8d7e9835c73df3584d24e16337cf10c25fc65454.
Frossen releasegate PASS39.2s: unit35.93s, integration38.91s, candidate-scope,
Ruff/format og mypy46 grønne. Ingen produktionsændringer efter review/freeze.
Kandidaten afventer eksplicit godkendelse til offentlig publicering, exact-commit
CI/ARM64-image og installation. Ingen publicering eller installation udført.

## Aktiv lead-beslutning — genforbindelse efter strømtab, 10. september 2026

Lead: Codex. Bruger kræver automatisk tilbagekomst efter gentagne strøm-/netudfald.
Baseline main12e96da, installeret1.13.72/rootfs757c96aee65c552b4e951901085f90d56e4d9fa77174b047f38bad2de128719d,
firmwareStop2 uændret. Felt09:14–09:17: native handshake lykkes, efterfulgt straks
af expected disconnect, gentaget ca.5s på både IPv4/IPv6. Direkte diagnostic status
svarer korrekt, men produktionslink er offline, diagnostic_active=false. Ingen
genstart udført; den initiale exception er endnu ikke indsamlet.

Falsificerbar hypotese: rotation invaliderer gammel connection-generation før
unsubscribe/stop; en exception efter denne grænse efterlader gammel reconnect-ejer
aktiv, men alle dens callbacks stale. Hvert handshake bliver derfor afbrudt lokalt.
Test skal reproducere hele denne kæde, ikke kun kontrollere et disconnect-kald.
Kæde/naboer: strømtab → native disconnect → Thin close/mic/playback/duck-release →
adresseopslag → gammel ejer stoppet → identitet/firmware/settings/subscriptions →
korreleret fysisk rearm → readiness → næste wake. Overlappende admission/discovery,
sen audio/state/wake-callback, stop-timeout, gentagne fejl og aclose/start indgår.
Invarianter: én VoicePELink, én Thin close-owner; lifecycle6–7/10–15; stale events
inert; ingen falsk readiness eller genudførelse af hjemmehandlinger. Nul ændring af
Realtime-semantik, prompt, værktøjer, gain/VAD, firmware eller Roborock-aktivering.

Plan: permanent kausal regression med pinned native-bibliotek hvor muligt;
mindste ejerrettelse med vedvarende bounded-backoff recovery og bevaring af gamle
ejere indtil stop er bekræftet; Thin/Talk og tidligere feltregressioner; uafhængigt
adversarial review før én frozen releasegate. Ingen SafeEval ved rent adapterfix.
Rollback: hele add-on-kandidaten til eksisterende1.13.72, uden firmware/configændring;
den baseline har denne feltfejl og kaldes ikke stabil. Backup kræves før installation.
Fysisk gate: endnu ikke testklar; kræver frisk golden chain og gentagne power/network
recovery-prøver plus 10/10 lifecycle på samme artifact. Permanent hardware-/net-/
auth-fejl skal være sandt offline, aldrig skjules med falsk ready.

Udviklingsbevis: pinned APIClient45.3.1 VA-unsubscribe er kørt med gammel subscription
og ny endnu-ikke-handshaket APIConnection; den ægte send_message rejser
ConnectionNotEstablishedAPIError. Baseline fejler fire permanente regressioner:
unsubscribe, rotation (med/uden gentagne stopfejl) og shutdown. Den fulde download
af feltloggen blev blokeret af organisationens browserpolitik; ingen omgåelse.
Derfor er den oprindelige feltexception fortsat ukendt, selv om den reproducerede
kodefejl forklarer den observerede femsekunders-loop præcist.

Rettelse: begge unsub-handles detach'es før best-effort callback; pensioneret native
ejer bevares indtil stop+disconnect lykkes. Recovery fortsætter med eksisterende
capped backoff også efter >3 cleanupfejl eller fejlet replacement-start. Shutdown
overtager samme ejer; initial start-fejl/cancel bevarer ejeren og blokerer en ny
generation indtil cleanup. Adapteren propagerer terminal cleanupfejl, men Thin's
allerede eksisterende shutdown-wrapper undertrykker den; ingen ny UI-påstand.
VA-audio/start/stop bruger nu samme subscription-token som state-callbacks, også
ved ny socket på samme APIClient; ingen ny audio-cut eller ændret mic-gate.

Målrettet fast PASS76checks/9.3s inkl. Ruff/format og mypy46. Efterfølgende adapter-
checks PASS inkl.10 gentagne adresse-/admissioncyklusser og samme-klient stale audio.
Hele Thin+Talk-integrationssættet PASS. Første brede fast-forsøg var ugyldigt pga.
sandboxens afvisning af localhost-binding, ikke en produktfejl; genkontrol kørte
med localhost-tilladelse. Branch er rebaseret på samme aktuelle main12e96da;
historisk datarelease-dokumentation bevaret. Ingen produktionskontrakt udenfor
VoicePELink ændret. Foreløbigt uafhængigt review fandt initial-start orphan/P1,
som er rettet med fejl- og cancellation-regressioner; endeligt review afventer.

Ingen ny version reserveret, merge/installation/flash eller fysisk prøve udført.
Parallel HeyChat-opgave planlægger .73 og firmwareændring; deling af status mellem
opgaver er blokeret af sikkerhedskontrollen og afventer brugerens eksplicitte accept.
Kandidaterne må ikke blandes eller installeres oven i hinanden uden afstemning.
Fuld frozen releasegate afventer endeligt review og samlet leveringsafgrænsning;
den installerede .72 er stadig rollback/reference, ikke bevist stabil.

Endeligt uafhængigt Ultra-review reconnect_freeze_review: GO til én frozen
releasegate, P0/P1/P2=0. Runtime SHA256
12fc5d1bba0353cae664473ac2ca26c9d2ceb7831f29dcdd7be33689007165d9.
Pinned native stop/cancellation og begge adapters nabogrænser er reviewet.
Diffet fryses nu uden yderligere ændringer under den fulde lokale gate.
Versionsnummer/CI-artifact og installationsafstemning er stadig HOLD; grønt lokalt
runtime-diff må ikke publiceres under den allerede eksisterende .72-version.

Frosset lokal releasegate PASS39.0s: hele unit-sættet34.48s, hele integration-
sættet38.70s, Ruff/format120, mypy46 og kandidat-scope (kun VoicePELink-runtime).
Ingen filer ændret under gaten. Ingen SafeEval nødvendig for dette mekaniske scope.
Kode/review/lokal gate er grønne; merge, ny releaseidentitet, exact-head CI/ARM64,
backup/installation og fysisk strøm-af/på + golden/10af10 er IKKE gennemført.
Installationshold skyldes endnu ikke godkendt koordinering med wakeword-opgaven,
ikke en resterende kendt finding i det reviewede genforbindelsesdiff.

10/9 installationsbesked: brugeren har eksplicit godkendt installation. Frisk
origin/main er stadig12e96da, ingen åbne PR'er, den parallelle lokale wakeword-task
er idle. Statusdeling blev fortsat afvist; ingen blokeret deling omgås. .73 er
reserveret af den separate firmwarekandidat, derfor bruges .74 til denne rene
add-on-rettelse på uændret Stop2-firmware. Ingen firmwareflash eller anden kandidats
ændringer medtages. Kun tre versionsautoriteter og changelog ændres efter den grønne
runtimegate; særskilt metadatareview/versionstest efterfølges af normal exact-head
PR-CI og main-publish. Runtime SHA ovenfor skal forblive identisk. Backup af aktuelt
installeret .72 kræves før én .74-installation; fysisk bevis registreres særskilt.

Metadatareview GO og6/6 release-contract-tests PASS; versionscommit cac7911 oven på
reviewet runtime1671e21. Push er BLOKERET af sikkerhedskontrollen, også efter frisk
verifikation af origin=https://github.com/BixelVentures/podvoice.git, PUBLIC,
viewerPermission=ADMIN og main12e96da som installeret .72-baseline. Kontrollen kræver
eksplicit brugeraccept af publicering af rettelsens kildekode og releasenoter til
netop dette offentlige repository. Ingen alternativ push/API/omgåelse anvendes.
Derfor ingen PR/CI/main-artifact eller .74-installation endnu; .72 er urørt.

Brugeren har nu eksplicit godkendt publicering af rettelsens kildekode og
releasenoter i det offentlige BixelVentures/podvoice-repository. Normal PR-CI,
merge/publish og backup/installation fortsætter; ingen firmwareændring medtages.

## Aktiv lead-beslutning — relevante data, 9. september 2026

Lead: Codex. Bruger har godkendt implementering af den afgrænsede datakontrakt.
Baseline er main20c0e92, installeret 1.13.71 ifølge den seneste verificerede
installation i arbejdsfladens status. Ingen ny fysisk godkendelse arves.
Feltforløb r0:1788954796343794092: spørgsmålet om seneste Spotify-sang gav et
succesfuldt recently_played-kald med 22 poster / 2195 UTF-8-bytes. Den shippede
2048-byte-grænse erstattede listen med data.truncated; modellen kunne ikke svare.
Private sangdata kopieres ikke til repo. Syntetiske data skal reproducere grænsen.

Hypotese: modelvalgt limit plus formatbevidst resultatvalg før providergrænsen
bevarer det efterspurgte svar uden nye værktøjer eller obligatoriske modelrunder.
Kæde: fysisk wake/input → Thin-tur → Realtime vælger deklarerede argumenter →
completed batch/policy → uændret HA-kald → validering/udvalg/bytegrænse → output-ACK
→ model vurderer dækning → fysisk svar → opfølgning/close → teardown/rearm/ny wake.
Nabofejl: malformed/tomt resultat, unsupported filtre, stale schema, timeout,
Stop/ny tur under dispatch, kildebegrænsninger og kvitteringer må ikke omfortolkes.
Invarianter: Realtime ejer semantik; HA ejer data; lifecycle 10–15, immutable
sessionschema, completed-batch/policy/ACK, sand kilde/dækning og uændret 2048 bytes.

Kortlægning: tre statiske podconnect.*-services returnerer tracks(name,artist,uri),
ingen argumenter i den eksisterende HA-adapter. Lokal kildekode fjerner gentagelser
og tidspunkter fra recently_played; et udsnit er ikke komplet afspilningshistorik.
Der tilføjes kun lokal limit(1–50, default5) til de tre eksisterende declarations.
weather_forecast har den observerede success/result/forecast-form med datetime,
kilde/enheder og eksisterende 1800-byte-kompaktering; behold periodedækningen.
GetDateTime, HA-state/weather og google_web_sogning bruger det aktuelle MCP-schema
uændret: ingen nye parametre, tidsstempler, datofiltre eller dækning opfindes.
Ukendte/små former passerer; store ukendte former forbliver eksplicit begrænsede.

Ikke-mål: PodConnect-opdatering, scripts, flere værktøjer, fuld historik, pagination,
cache, nye AI-kald, højere kvoter, firmware/VAD/lifecycle eller Roborock-aktivering.
Mekanisk filtrering er deterministisk; ingen tekstmatching må vælge brugerens hensigt.
Planlagte gates: store/små/tomme/malformed/Unicode-resultater gennem rigtig router
og provider-output, schema/stock-promptmigration, kilde/URI-bevarelse, HA-paritet,
kvitterings-/kapacitets-/Thin-/Talk-regressioner og fokuseret sikker semantisk eval.
Uafhængigt review før exact-diff releasegate, derefter CI/artifact, backup og én
installation. Før fysisk test kræves kandidatens maskinelle gate; golden/10af10
og næste wake kan aldrig udledes af unit-tests. Rollback er hele add-on-diffet
til den verificerede .71-backup; robot forbliver OFF. Status: implementering starter.

Første udviklingskontrol: fuld testudvælgelse, Ruff/format og mypy46 bestod (73,3s).
Dette er hverken frozen releasegate eller semantisk/fysisk bevis. Reviewer fandt
to kausalt nærliggende huller: den gamle fallback kan overskride2048bytes med
500fire-byte-tegn i summary (2074bytes), og ny track-validering skjuler eksplicit
kildefejl som malformed. Scope præciseret før rettelse: bevar eksplicit source-error
uændret inde i en fejlenvelope uden listefiltrering; begræns kun den eksisterende
fallback-summary efter faktisk UTF-8-envelope, ikke højere budget. Ingen ændring
af action-, admission- eller replay-ejerskab. Permanente regressioner kræves.

Implementeret kandidat1.13.72/prompt14: fælles resultat-encoding/bytegrænse,
tre modelvalgte lokale limit-parametre, hele tracks med selection-metadata,
eksakt stock-v13-migration med custom-preservation og generisk dataprincip.
Hele kildens liste valideres konservativt; malformed post også uden for limit
afviser resultatet. Ingen selektiv skipping, ny dedup eller infereret historik.
Eksplicit kildefejl bevares i en fejlenvelope; hvis datakilden selv skjuler en fejl
som tracks:[], kan denne adapter ikke genskabe årsagen. PodConnect ændres ikke.
Sikker opt-in data-selection-profil har seks scenarier/syv ture og samme shippede
selector på syntetiske kildeposter. Kun tre read-navne er admitted; øvrige tools
afvises uden HA-client. Eksisterende full/device-profiler er separate. Testfanen
får én knap til profilen; den ændrer ingen produktionsadgang eller lifecycle.

Måling mod main: tre musiktools før/efter; deklarationswire831→1700bytes (+869),
prompt14214→14841UTF8bytes (+627). Syntetisk22posters kilde2363bytes bliver343bytes
ved limit1 eller767ved limit5; ét uændret HA-servicekald, ingen automatisk ekstra
AI-runde. Målrettede checks bestod inklusive faktisk provider-output→eksakt ACK
→præcis én korreleret resultatsrespons. Seneste full-fast: alle tests, Ruff/format13
og mypy46 PASS,72.2s. Ingen fysisk godkendelse kan udledes af disse checks.

Releasekontrollen er BLOKERET: den maskinlæsbare scope-coupling-post fra .71
har gammel base/fingerprint og gælder ikke denne kandidat. Sikkerhedskontrollen
afviste at arkivere den gamle markør uden eksplicit brugeraccept. Hele markøren
og JSON står derfor urørt; ingen classifierændring, workaround eller releasegate
er udført. Endeligt uafhængigt review fortsætter; derefter kræves brugerens accept
af kun historikmarkeringen, før den nye kandidat kan kontrolleres normalt.
Sikker live-eval kræver kandidatens installerede bits og autentificeret Testfane;
den kan ikke bevises på gammel .71. Installation, live- og fysisk test udestår.

Freeze-review fandt to eval-only P2 før godkendelse: manifestets forbid-felt
forbyder toolnavne, ikke svartekst, så falsk afkortning og opdigtet historik kunne
bestå; og data-profilens separate manifest ugyldiggjorde tidligere fuld preflight
på samme produktionskontrakt. Hypotese: brug eksisterende answer_patterns med
parrede sand/falsk-regressioner; adskil evalmanifest fra produktionsidentitet ved
retention af dataprofilen, men invalidér stadig reel model/prompt/schemaændring.
Ingen produktionsprompt eller taleparser ændres for at tilfredsstille testoraklet.
Release forbliver blokeret både af review og den uændrede gamle scope-post.

Brugeren har efterfølgende forhåndsgodkendt merge og installation, betinget af
normale grønne gates; den særskilte accept af gammel .71-historikmarkør er spurgt
og afventer. Ingen release eller installation er udført. Sidste full-fast bestod
71,2s før den seneste terminal-path-rettelse, så det er ikke den frosne gate.
Reviewet fandt også, at data-eval cancelled/early-blocked manglede samme
produktionsidentitet og kunne fjerne tidligere full-preflight. Rettelsen sætter
profilidentitet før retention og beregner manglende hashes fra run-snapshot og
samme konstanter som successmetadata. Målrettede terminalregressioner genkontrolleres.

Svarmønstre i den syntetiske profil er kun mekanisk regressionskontrol, ikke
en fuldstændig semantisk dommer. Reviewet reproducerede resterende falske
positiver med omskrevne opdigtede datoer/antal. Ingen yderligere fraseliste eller
lokal semantikparser tilføjes: alle syv faktiske live-eval-svar, argumenter og
resultater SKAL gennemgås for sandhed/dækning før semantisk GO. En grøn automatisk
profil alene åbner ikke denne gate, og den erstatter aldrig fysisk Voice PE-bevis.
Sideløbende latencyarbejde holdes i separat .71-clone; det må ikke blandes ind i
denne kandidat eller måles hen over en installation uden ny artifactidentitet.

Uafhængigt freeze-review relevant_data_freeze_review: teknisk GO, P0=0/P1=0,
55 data/provider/adapterchecks og 30 aktuelle evalchecks PASS. Begge terminal-
retentionfund er lukket; stock-v13-fixture/hash byteverificeret. Eneste resterende
P2 er det dokumenterede begrænsede svarorakel, med obligatorisk manuel livekontrol.
Base/merge-base20c0e92a468a8a7390b5baa91df6f43ac4770116;
production_fingerprint c19bdd2084775ff03a5c3644d089e3bfb29cb11cf09d55d2d5368177a5b706fb.
GO gælder én normal releasegate, grøn exact-artifact CI og diagnostisk installation;
ikke semantik, fysisk Stop, golden chain eller 10/10. Den gamle couplingmarkør
er stadig urørt og releasekontrollen stadig HOLD indtil særskilt accept.

Sidste fast-forsøg havde grønne pytest/Ruff/format/mypy, men blev korrekt
kasseret af workflowet, fordi lead skrev reviewresultatet i STATUS under kørslen.
Det er en ændret dokumentations-scope under gate, ikke en observeret produktfejl.
Ingen runtimepatch begrundes af dette. Nu fryses også STATUS under den afgrænsede
fast-genkontrol; ingen yderligere filændringer før den returnerer.

Den frosne fast-genkontrol stoppede på eksisterende
test_missing_playback_start_retries_same_lease_then_closes: testen ventede kun
State.IDLE og assertede derefter brain.closed. Direkte kode viser IDLE sættes
før await stop-streaming/provider-close; IDLE er ikke teardown-bevis. Thin-runtime
er uændret mod basen. Kandidaten holdes indtil en isoleret testrettelse injicerer
forsinket provider-close og venter på den faktiske close-transaktions afslutning.
Ingen runtime-/timeoutændring; denne observerede slutbetingelse reviewes separat.

Isoleret testrettelse bestod 1/1 og Ruff/format; uafhængigt genreview gav GO,
ingen nye P0/P1/P2. Testen beviser IDLE før forsinket provider-close og afventer
derefter den faktiske close-task; oprindelige slutassertions bevares. Produktions-
fingerprint er uændret c19bdd2084775ff03a5c3644d089e3bfb29cb11cf09d55d2d5368177a5b706fb.
Tidligere teknisk review gælder fortsat. Den fulde frosne releasegate mangler
stadig og må først køres efter accept af gammel .71-historikmarkering. Ingen merge,
ny artifact, backup, installation eller fysisk verifikation er udført i denne omgang.

Brugeren har nu eksplicit godkendt historikmarkeringen af netop .71-reviewposten.
Kun dens HTML-markør ændres til historical-reviewed-coupling; JSON og bevis bevares.
Classifier og adgangskrav er uændrede. Main er frisk verificeret på20c0e92.
Kode og dokumentation fryses nu til én samlet releasegate på det reviewede diff.

Frosset releasegate PASS39,0s: scope, Ruff/format119, mypy46, alle unit- og
integrationstests. Ingen filer blev ændret under gaten. Denne efterfølgende
dokumentation ændrer ikke runtime-fingerprint. Exact-head CI/ARM64-artifact,
backup/installation, alle syv semantiske evalsvar og fysisk prøve udestår.

PR43/head3140420: ARM64 build PASS, lint/type/format PASS, CI34378328856
pytest FAIL i eksisterende schema-correction-close-test. Den ventede _active=false
og antog attention-release færdig; Thin sætter _active=false før de asynkrone
teardowntrin. Samme fejlklasse som den tidligere IDLE-test, ikke nye runtimebits.
Merge/installation HOLD. Permanent testregression skal injicere forsinket
attention-release og afvente close-task, uden at svække 1-release-assertionen.
Kun den berørte test/CI-gate ugyldiggøres; ingen manuel genkørsel af rødt head.

Isoleret schema-correction-test rettet og 2/2 lokale teardownregressioner PASS,
Ruff/format PASS. Uafhængigt review1/1 PASS, ingen nye findings; samme produktions-
fingerprint. Ny test/docs-only commit udløser normal CI på nyt head. Runtimegate
og review er uændrede; merge kræver fortsat grøn CI på præcis det nye head.

Levering 9/9: PR43 head edfb3927bd4ffb55616ea105c021cdbcb89ec51a bestod
CI34378887653 og blev squash-merged som12e96da1f1005ed973e5ebe34add78fbadedb501.
Main CI34379247222 er grøn inklusive publish-addon. Publiceret1.13.72-image:
sha256:1671b4467f9260474ff559a8df570b5207f121b114f1a92eccbb2bfc5597d839.
Krypteret lokal backup a47820c4 er oprettet18:51 og indhold verificeret:
kun PodVoice1.13.71,14.21MB. Restore er ikke afprøvet. .71 er rollback-målet.
Installation afventer kort koordineret hold til sideløbende wake-optagelse;
ingen .72-installation, live-eval eller fysisk godkendelse er endnu udført.

19:04: én opdatering til1.13.72 udført, HA viser Kører og ny startup bekræfter
git12e96da1f1005ed973e5ebe34add78fbadedb501,
rootfs-v1:757c96aee65c552b4e951901085f90d56e4d9fa77174b047f38bad2de128719d,
promptv14:0df6f944c580d1380ea8159480595d88be55a2114e66ad1c01d946e3d49b24b9,
schema899d3940bbfb480c8af62a991365afc47b0b742d51dd4e541bd1d8c7b7826367.
Modelgpt-realtime-2.1/medium, firmwareStop2, kanal1/gain16 og HeyChat uændret.
MCP18+PodConnect3, firmwarekontrakt OK, fysisk wake efter restart afventer.
HA's ekstra automatiske pre-update-backup blev bevaret slået til. Ingen restore.
Sikker dataprofil eval-1788973551-3bc570 startet én gang; resultat afventer.

19:10 samme run terminal COMPLETE, selected_ok=true:6/6scenarier,7/7ture.
Lead har manuelt læst alle faktiske svar, argumenter og resultater: seneste
Nordlys/Testorkestret medlimit1/én hel URI; kunstneropfølgning uden nyt tool;
seneste5/top5/liked5 medlimit5 og korrekt kilderækkefølge, alle uden irrelevant
afkortning. Dato-/playcount-spørgsmål forklarer manglende tidsstempler/tællinger
uden opdigtede tal og uden unødvendigt opslag. Fire fixture-reads, nul effekter,
11providerresponses, nul schema-corrections;76170tokens,$0.2606128.
212.401s kapacitetspause i den isolerede evalrolle; ingen production-latencypåstand.
Fokuseret datasemantik GO. Rapportens ok=false/profile_complete=false og
release_preflight_passed=false er korrekt: separat dataprofil, ikke fuld preflight.
physical_result_verified=false. URI-afspilning via fysisk opfølgning, faktisk
vejr/web/hjem-svar på .72 og golden/10af10 er fortsat ikke fysisk bevist.
Efter eval: fresh status1.13.72, diagnostic_active=false, r0IDLE/forbundet,
ducked=false/level100, MCP/PodConnectup,21tools. OpenAI/VoicePE står degraded
uden frisk fysisk produktionssamtale; eval alene gør ikke fysisk readiness grøn.

## Udgivelsesværktøj — valgfri cache blokerer PR42

Lead Codex, 2026-09-09: CI34341280596 på f79f03b har grøn lint/test og
færdig ARM64-image/push, men står fortsat i GHA-cacheeksport efter cirka 20 minutter.
Dette beviser en procesforsinkelse, ikke en runtimefejl eller en bestemt ekstern
cacheårsag. Hypotese: fjernelse af cacheeksport fra begge kritiske build/publish-
trin fjerner denne observerede blokering uden at svække imagekontrollen.
Reviewer production_capacity_cause har godkendt denne afgrænsning før implementering.

Kæde: reviewed source → PR-tests/build → main-tests/publish → backup/installation
→ uændret Voice PE/Talk-kæde → fysisk test. Invarianter: obligatoriske build/push-
fejl, immutable version, eksakt SHA/artifact og ingen fysisk godkendelse fra CI.
Ingen runtime-, firmware-, prompt- eller HA-ændring; cache-import beholdes.
Plan: permanent workflowregression, uafhængigt eksakt diff-review, nyt head-CI.
Kun den derefter forældede præcise CI-kørsel må annulleres; ingen manuel genkørsel
eller accept af dens image-push som grøn release. Rollback: behold installeret .70
hvis nyt CI/main-artifact ikke består. Fysisk status er fortsat uændret/ikke godkendt.

## Aktiv lead-beslutning — samlet 1.13.71: kapacitet, kvittering og vejr

<!-- historical-reviewed-coupling
{"version":1,"base_tip":"4640ea9113464d8b18c03c0f7a3f8efc073bbb59","merge_base":"4640ea9113464d8b18c03c0f7a3f8efc073bbb59","domains":["ha_tools","realtime_semantics"],"fingerprint":"c116fcf6541cf523e50b45762102f402904985f25a18a41c149a0c73fffd71d9","reviewer":"production_capacity_cause","rationale":"Completed HA batch admission, bounded weather output and truthful receipt share one exact provider ACK and child-response contract. Independent composition review and permanent real-ledger regression preserve ownership, Stop cancellation, output bounds and receipt source. No firmware/rearm change."}
-->

Brugeren har eksplicit bestilt én samlet build, installation og sikker prøve før
sin fysiske test. Lead: Codex. Denne post erstatter tidligere scope-/installations-
HOLD nedenfor: gammel .70 skal ikke bestå 10/10 før en diagnosticeringskandidat
installeres. Installation er ikke fysisk godkendelse.

Direkte evidens: .70 kasserer stor HA-vejrprognose ved providerens 2048-bytegrænse;
den sikre robot-eval viste en kvittering stærkere end HA-service-ACK; den dokumenterede
lange værktøjskæde kræver mere end ét lokalt kapacitetsvindue. Hypotese: de tre
separat reviewede ejerrettelser kan samles uden at ændre tool-listen eller genafspille
handlinger. Kandidaten samler receipt a2d7771, weather 2dbbaeb og capacity 1eb0d74.

Kæde: fysisk wake/input → Thin-tur → Realtime completed batch → generationsbundet
kapacitetsadmission → eksisterende HA-policy/dispatch → kilde-/coverage-bevarende
resultat → exact ACK → kapacitetskontrol → sand modelkvittering → fysisk playback →
én teardown/rearm → næste wake. Invarianter: én ejer, 2048-bytegrænse, autoritativ
usage, ingen sideeffekt før admission, ingen stale/sibling/ACK efter Stop eller ny tur,
samme kontrakt for Voice PE og Talk. Resultatformat og længere prompt må ikke skjule
kapacitetsfejl. Ikke-mål: firmware, gain/VAD, model, musikrouting, ekstra værktøjer,
HA-scripts eller bredere robotadgang. Roborock forbliver OFF med tom allowlist.

Planlagte gates: kompositionstest, uafhængigt adversarial freeze-review og én samlet
releasegate; exact-head CI og main-artifact; backup og én add-on-installation med
uændret Stop2-firmware; fokuseret sideeffektfri live-eval og read-only vejrkontrol.
Først derefter brugerens golden chain/10 fysiske cyklusser og senere robotprøve.
Rollback er hele add-on-kandidaten til backup/.70, ikke skjult delvis rollback.
Lokation: HA-hjemmets koordinater matcher Met.no; bykontekst til web skal verificeres
separat og må ikke indeholde eller sende privat adresse/koordinater til websøgning.
Samling implementeret: alle syv kapacitetsfiler er byteidentiske med det separat
reviewede 1eb0d74-diff; kvittering og vejr er bevaret fra 2dbbaeb/a2d7771. Version
1.13.71 i alle tre felter; standardprompt v13 migrerer også installeret stock-v11.
Fast: 1619 tests, Ruff/format og mypy45 bestod. Uafhængigt kompositionsreview:
P0=0/P1=0/P2=0, 124 fokuserede checks og 8 Thin-checks bestod. Samlet rigtig
provider-/ledgerregression bevarede kvitteringsflags og 13 vejrrækker under 2048
bytes gennem exact ACK og sen kapacitetsnedjustering; ét child-kald, ingen replay.
Dette er kontrolleret testtid, ikke livekapacitet eller fysisk latency. Ingen ny
artifact, installation eller fysisk godkendelse på dette tidspunkt.

Releasekontrollen stoppede før pytest på en tooling-fejl: scope-regexen klassificerede
vejrets "continuity is not implied" som wake/rearm. Ingen firmware- eller rearmkode
er ændret. Årsagsgrænsen er classifieren, ikke runtime: afgræns continuity-match til
wake-/detektor-/mikrofonkontinuitet og behold de øvrige rearm-signaler; tilføj
positiv/negativ tooling-regression. HA/Realtime-kompositionen skal stadig have den
eksisterende eksakte, fingerprint-bundne uafhængige reviewpost. Den standsede gate
beviser ikke unit/integration; de afbrudte dele skal gennemføres efter tooling-review.
Classifier-only rettelse og 19 regressioner bestod; reviewer bekræftede den eneste
falske rearm-trigger og den afgrænsede rettelse. Ingen ny coupling-type eller bred
undtagelse er tilføjet. Kun den eksisterende eksakte HA/Realtime-reviewkontrakt bruges.

Samlet frozen releasegate bestod: 1270 unit + 352 integration = 1622 tests,
Ruff/format 116 filer, mypy45 og exact-reviewed candidate-scope. 39,2 s. Første
forsøg var afbrudt før pytest af den ovenfor dokumenterede classifier-fejl; kun
tooling blev rettet før den gennemførte gate. Kandidatens produktionsfingerprint
er uændret. Exact-head CI, main-image, installation og live/fysisk bevis udestår.

Publication forsøgt, men afvist før GitHub-tree-write af sikkerhedskontrollen: den
kræver eksplicit brugeraccept af de 25 ændrede kode/test/version/STATUS-filer til
det offentlige BixelVentures/podvoice. Ingen remote branch, PR, build eller ny
installation er oprettet. Separat afvist HA-ændring: kun eksisterende weather-
værktøjs beskrivelse skulle angive brugerens by; dialogen blev annulleret og gammel
beskrivelse genlæst uændret. Begge konkrete godkendelser er nu spurgt brugeren.
Lokal releasecommit før denne statusnote: 57f0266c617e0c9cf44e5c07994a5404ca2bcdf5,
tree 32c8689c8a3df24d8b7b67b4d796dac5b1dbadad. Installation er stadig .70.

Brugeren har nu eksplicit godkendt udgivelsen/uploaden og installationen. Bytilføjelsen
er IKKE godkendt: HA's eksisterende hjemmeplacering og den faktiske overførsel af
lokation til MCP/Realtime undersøges read-only. Ingen ændring af HA-værktøjet.

## Aktiv lead-beslutning — brugbare vejrdata og web-reservevej

Lead: Codex. Brugeren har bedt om at færdiggøre vejr og en oversigt over restarbejde.
Frisk Talk-prøve på installeret .70 kaldte weather_forecast med succes, men svaret
oplyste, at prognosen var afkortet. UI-resultatet indeholder en rigtig hourly-
prognose fra HA/Met.no. Providerens uændrede grænse på 2048 UTF-8-bytes erstatter
for store resultater med data.truncated=true uden prognose. Hypotese: en bounded,
tabsbevidst formatkonvertering af netop dette dokumenterede read-only-resultat
bevarer brugbare perioder under eksisterende wiregrænse. Grænsen må ikke hæves.

Kæde: stemme/Talk-input → Realtime-værktøjsvalg → eksisterende schema/policy → MCP
weather_forecast → resultatkontrakt → bounded provider-output → eksakt output-ACK →
modelrespons → fysisk playback/drain → model-close/teardown/rearm → næste wake.
Invarianter: model-ejet semantik, sand kilde/coverage, autorisation, 2048-bytebudget,
completed batch/ACK, én ejer i Thin og begge adaptere. Naboer: forkert eller tom
prognose, manglende tid/enheder, partial data, MCP-fejl, ukendt lokation, stale
callbacks og resultater fra musik/andre domæner. Ikke-mål: større kvote, nyt tool,
nye HA-scripts, mere adgang, ændret musikrouting, gain/VAD/firmware/lifecycle.

Plan: komprimér kun kendt success/result/forecast-envelope til navngivne kolonner
med uændrede værdier og explicit antal/coverage. Ukendte/malformed resultater må
ikke omfortolkes; fejl må ikke blive succes. Bevar de eksisterende bytes ved små
resultater og alle andre tools. Afkortning skal ske ved hele rækker med synlig
udeladelse, aldrig som falsk komplet prognose. Modellens vejrfallback præciseres
for fejl, manglende eller ubrugelige data, kun med kendt by/område og deklareret web;
ingen hjemmeadresse/koordinater skal søges eller sendes til web.

Regressioner: observeret store payload gennem router og faktisk provider-bounding;
bevarede værdier/kilde/tidszone/enheder, tom/malformed/error, lang unicode, delvis
coverage og uændret andre domæner. Sikker eval skal dække HA først, HA-fejl→web,
ukendt sted→spørg, manglende web→ærlig fejl, succes uden fallback. Begge adaptere,
uafhængigt adversarial review og én frossen releasegate før offentlig kandidat.
Rollback hele vejrdiffet; ingen live-installation under den åbne fysiske .70-gate.
Denne branch bygger på lokal .71-kvitteringskandidat; den er ikke en installeret
baseline. Ingen påstand om færdigt vejr eller gennemført fysisk vejropgave.

Implementeret lokalt: weather_result.py pakker kun den observerede succesform.
Alle beholdte målinger, kilden, enheder og tidsstempler bevares; højst 1800 UTF-8-
bytes før uændret 2048-byte providergrænse. Udeladte perioder er mærket; ugyldige,
naive eller usorterede tider omfortolkes ikke. Huller i serien lover ikke kontinuitet.
Prompt v13 tillader fallback ved manglende/fejlede/ubrugelige vejrdata, kræver kendt
by/område og forbyder adresse/koordinater til web. Stock-v12-migration er eksakt;
egne prompts bevares. Ingen versionsrelease er tildelt denne ufærdige kandidat.

123 målrettede checks bestod, inkl. rigtig MCP-klient/router → den shippede
provider-boundingfunktion, anden-tool-paritet, migration, fejl/unicode/tid/coverage.
Baseline i regressionen bliver faktisk til data.truncated=true; kandidaten bevarer
prognosedata. To tidlige fixturefejl (manglende MCP tools-capability og ikke-eksisterende
router-cleanupmetode) blev rettet i testen, ikke runtime. Ruff og mypy45 bestod.
Uafhængigt weather_contract_review: P0=0/P1=0. P2 om tidsvalidering og falsk kontinuitet
blev rettet med fire permanente cases; reviewer har genlæst. Reviewer bestod 40
første checks samt eksisterende Thin-/Talk-integration. GO kun lokal freeze og
sikker semantisk eval, ikke merge eller installation. Mekanisk scope-check PASS
som unclassified_runtime; menneskeligt review afgrænser dette som HA-resultat-/
promptkontrakt, ikke ny lifecycle. Ingen classifier-workaround blev skrevet.

Separat live Talk-prøve på stadig installeret .70: eksplicit webopslag om Aarhus
kaldte google_web_sogning og fik et kort vejrresultat tilbage. Det indeholdt dato
og prognosetekst, men ingen kilde-URL. Det beviser kald/resultat, ikke selvstændigt
verificeret meteorologisk korrekthed eller automatisk failover. Begge værktøjer
går gennem samme HA/MCP-forbindelse; web er ikke backup for tab af selve forbindelsen.
Ingen ny fysisk samtale, robotaktivering eller firmwareændring under vejrarbejdet.

Åbent før release: sikre livekontraster for HA først, HA-fejl→web, ukendt sted→spørg,
manglende/fejlet backup→ærlig fejl og partial coverage. Dernæst én frossen releasegate,
exact-head CI/artifact og fysisk godkendelse. .70-lytte-/afslutningsprøve, 10/10,
Roborock-produktionskapacitet og manglende timeradapter er fortsat særskilte huller.

Samlet lokal udviklingskontrol bestod: 1.591 tests, Ruff/format og mypy45. 71,6 s;
fuld suite blev valgt konservativt, fordi det nye testsnit endnu ikke var tracked.
Første start stoppede ved lintkrav om itertools.pairwise; den mekaniske rettelse
ændrede ikke sammenligningen eller reviewets tidskontrakt. Ingen releasegate,
publicering, installation eller semantisk livegodkendelse er foretaget.

## Aktiv lead-beslutning — kvitteringskilde på recovery-baseline, 1.13.71

Lead: Codex. Den isolerede prompt-/evalrettelse overføres til main
4640ea9113464d8b18c03c0f7a3f8efc073bbb59 (installeret 1.13.70).
Observeret: sikker .69-eval gennemførte fire syntetiske rengøringshandlinger og
model-close, men tilskrev robotten en accept, som kun Home Assistant havde givet.
accepted_by_ha=true og physical_result_verified=false beviser ikke fysisk start.
Det gamle svarfilter kunne samtidig afvise sand HA-accept. Ingen robot blev startet.

Kæde: wake/mic → Realtime → kapabiliteter → indstillinger/start → servicekvittering →
output-ACK → model-close → kvitteringslyd → fysisk drain → teardown/rearm → ny wake.
Invarianter: Realtime ejer semantik, sand fysisk evidens, half-duplex 3–7,
lifecycle 10–15, completed-batch-atomik og output-ACK. Hypotese: én generisk regel
om kildebevaring retter overfortolkningen uden at ændre start-/dialogkontrakten.
Nærliggende fejlveje: delvis accept, ukendt udfald, fejlagtigt mål, ønsket dialog,
duplicate/stale-events, kapacitetsafslag og lyd-/cleanupfejl. Ikke-mål: flere tools,
lokal taleparser, Assist/Spotify-routing, budget/provider, lyd eller firmware.

Kun tidligere reviewede prompt v12, eksakt stock-v11-migration og parrede
eval-regressioner overføres; brugerdefineret prompt bevares. Versionen bliver .71,
så recovery .70 ikke overskrives. Den tidligere uafhængige reviewer fandt P0=0/P1=0;
80 prompt/migration/eval/adaptercases og 21 ACK/Stop/stale/Assist/musikcases bestod.
Regex er kun et begrænset regressionsfilter; live-svar skal vurderes manuelt.

Plan: verificér byteidentitet af tidligere reviewede produkt-/testfiler, kontrollér
samspil med ny recovery-base, uafhængig releasegrænsevurdering, én frosset releasegate
og derefter relevante sikre livekontraster på faktisk installerede bits.
Rollback: hele .71-diffet tilbage til .70; aldrig cherry-pick mellem ejergrænser.
Fysisk .70-gate er endnu åben. Denne post autoriserer lokal klargøring, ikke en
påstand om fysisk godkendelse eller tilladelse til at omgå installationsgaten.
Roborock er verificeret OFF med tom allowlist efter .70-installation. Kapacitet er
en særskilt uløst produktionsgate; den løses ikke af en sandere kvittering.

1.13.70-installation er læst tilbage fra HA og add-onens egen startup-identitet:
main 4640ea9113464d8b18c03c0f7a3f8efc073bbb59, rootfs-v1
9808e95495d0627e47e85b155563f8076bc2f1c07c33e6acd5218d30d02ec670.
MCP Assist og Voice PE er forbundet, Stop2-kontrakt OK, Hey Chat bekræftet.
Prompt v11 og tool-schema er uændret. Ingen firmwareflash; backup valgt ved update.
Én lokal samtaleoptagelse er armeret til brugerens næste eksplicitte prøve.

Overførsel gennemført: de seks tracked produkt-/testdiffs matcher det tidligere
reviewede diff eksakt; stock-v11-fixture SHA-256 er uændret
1b93a66b8a2bdb80313df32293ab3011956bc7a32c76f9b0aed2ce920fb32764.
Version/changelog er nu .71. Frisk målrettet kontrol: 95/95 prompt-, migration-,
eval- og versionscases bestod; diff-check og single-domain ha_tools bestod.
Produkt- og testdiff er frosset. Ingen ny runtime-logik er skrevet eller udgivet.
Uafhængig releasegrænsevurdering receipt_source_freeze_review: P0=0/P1=0,
GO til én lokal releasegate. Syv kilde-/test-/fixturefiler er byteidentiske med
tidligere review; .70-recoveryblobs er intakte; ingen konflikt med den nye base.
Tracked diff SHA-256 uden STATUS:
2248925c2cb1345cbfe2de6d345c2cbf8f7313b10ef4ba3529028ca5daf4cd9b.
Den ene frosne releasegate er nu grøn: 1.232 unit og 341 integration, i alt 1.573;
Ruff/format, mypy44 og scope bestod. Wrapper 39,1 s med parallelle testtrin;
ingen genkørsel eller produktionspatch. Lav fri disk (49,8 GiB / 10,8 %) var en
workflow-advarsel, ikke produktfejl. Exact-commit CI/ARM64-image er ikke kørt endnu.
Merge/installation forbliver HOLD: behold installeret .70 til frisk golden chain
og 10/10 fysisk lifecycle efter PRODUKTMÅL linje 165. Ingen live-eval må afbryde
den ventende fysiske observation. Seneste trace er fortsat .69, ikke .70-bevis.

## Aktiv lead-beslutning — recovery-release 1.13.70

Lead: Codex. Brugeren har autoriseret den afgrænsede add-on-release og installation.
Observeret fejlklasse: manglende playback-start/stopkvittering blev efterfulgt af et
umuligt fejllydforsøg, som brugte cleanupbudgettet; native reconnect vækkede ikke en
sovende cleanup-retry. Første manglende fetch/playback er stadig uforklaret. Denne
release retter kun de dokumenterede genopretningsfejl og lover ikke fysisk stabilitet.

Kæde: wake → mic/provider → reply-request → manglende fetch/start → close-barriere →
korreleret stop → mic/provider/Stop-context/attention-cleanup → reconnect → samme
teardown-owner → frisk fysisk silence → rearm → næste wake. Invarianter: half-duplex
2–7, lifecycle 6–7 og 9–13; én close-owner, generationsbundet bevis og nul rearm før
fuld cleanup. Hypotese: spring umulig fejllyd over og væk samme retry-owner ved
reconnect, uden at lade gammel silence eller rearm-ACK krydse forbindelsesgrænsen.
Ikke-mål: forklare første no-fetch uden evidens, ændre prompt, værktøjer, firmware,
gain, VAD, timeouts eller HA-adgang. Roborock forbliver off; recovery er ikke flagstyret.

Implementeret: bevar cleanupbudget; reconnect forsegler wake synkront, ugyldiggør
gammelt silence-bevis og vækker samme cleanup-owner. Reviewets reconnect-under-rearm
P1 er rettet for både original close og fuld retry, failed/late ACK og shutdown.
Gamle ACK må ikke publicere readiness; frisk fysisk stopkvittering kræves. Modsatte
Talk-overflade og eksisterende Stop/musik/fejlkontrakter er kontrolleret.
De to oprindelige regressioner var røde mod base og grønne efter rettelsen.

Uafhængigt Ultra-runtime-review: P0=0/P1=0; 95 udvalgte Thin/Talk/native-checks og
særskilt real VoicePELink-probe med gammel ACK, blokeret wake og frisk drain bestod.
Reviewede blobs: runtime bf24d41e0ebc94ff6a1a760df932807dc69f39fa;
test 129c46a41bd81c747d9d82b13c6ab8e3d8ab0357. De er uændrede.
Én lokal releasegate: 1.197 unit bestået; integration ramte sandboxens socket-
rettighed. Kun integrationsdelen blev genkørt med lokal portadgang: 341 bestået.
Samlet 1.538 tests, Ruff/format, mypy44 og single-domain rearm. Ingen runtimepatch
eller fuld wrapper-genkørsel efter miljøfejlen. Ingen SafeEval ved uændret semantik.

Releaseversion 1.13.70 ændrer kun de tre versionsfelter og changelog oven på de
reviewede bits. Frisk versionskontrakt 6/6 og scope rearm bestået; hele produktsuiten
gentages ikke for metadata alene. Uafhængig releasegrænse-review afgør GO til
exact-head CI og diagnostisk installation med backup efter PRODUKTMÅL gate 3.
Rollback er hele recovery-diffet. Ingen cherry-pick af separat prompt-/kapacitetsarbejde.
En frisk prøve på den gamle installerede version bestod svar og afslutning efter
genstart; det erstatter ikke denne kandidats egne fysiske tests. Kandidaten er ikke
fysisk godkendt, golden chain og 10/10 er åbne. Ny fysisk fejl stopper testforløbet.

Uafhængigt releasegrænse-review recovery_release_boundary: GO, P0=0/P1=0 til
exact-head CI og derefter backed-up add-on-only diagnostisk installation. Reviewer
genbekræftede uændrede blobs, scope, diff-check og runtime artifact-identitet 1/1.
Dette er ikke fysisk recovery-/stabilitetsgodkendelse eller en no-fetch-rettelse.

Publicering forsøgt via den eksisterende GitHub-forbindelse, men automatisk review
afviste upload af kandidatens syv filer med krav om eksplicit payload-/destinations-
godkendelse. Ingen tree/commit/PR blev oprettet; ingen workaround anvendes.
Den verificerede origin er BixelVentures/podvoice. Lokal kandidat og gatebevis
bevares; publicering og installation afventer denne konkrete godkendelse.

Brugeren har efterfølgende udtrykkeligt godkendt publicering af kode, tests og
versions-/statusfiler til BixelVentures/podvoice samt videre merge og installation.
Ingen nøgler eller lydoptagelser medtages. Destinationsblokeringen genprøves med
denne godkendelse; ingen påstand om publiceret release før faktisk kvittering.

Senest opdateret: 2026-09-09.

## Aktiv lead-beslutning — accepteret start er ikke fysisk færdig, 9. september 2026

Lead: Codex. Bruger har bedt om rettelse af den observerede afslutningsfejl.
Installeret 1.13.68 gennemførte i sikker Realtime-eval alle fire syntetiske
rengøringshandlinger og kvitterede sandt for HA-accept, men kaldte ikke
end_conversation. Ingen fysisk robot blev startet. Default prompt v10 og
afslutningsværktøjet kræver en fuldt udført handling, mens startresultatet korrekt
kun beviser accepted_by_ha=true og physical_result_verified=false.
Hypotese: kontrakten er tvetydig om forskellen mellem brugerens startanmodning og
den efterfølgende fysiske proces; en generisk præcisering i prompt og værktøjets
beskrivelse kan lukke efter accepteret start uden at påstå fysisk færdiggørelse.
Dette er en falsificerbar hypotese, ikke bevist årsag: samme sikre sekvens skal
afslutte efter resultatet; ønsket dialog, ukendt udfald og tvetydige mål skal stadig
forblive åbne. Et nyt modelafslag stopper kandidaten, ikke en blind genkørsel.

Kæde: fysisk wake/mic → Realtime-hensigt → kapabilitetsopslag → sekventielle
bekræftede indstillinger → accepteret start → tool-output ACK → modelvalgt separat
end_conversation → sand kvittering → fysisk playback/drain → teardown/rearm → ny
wake. Nærliggende fejlveje: kun delvist accepteret opgave, ukendt start, ventende
brugerbekræftelse, ønsket status/opfølgning, duplicate/stale tool-events, cancel og
kapacitetsafvisning før close. Invarianter: Realtime ejer semantik; half-duplex 3–7,
lifecycle 10–15, completed-batch-atomik, tool-output ACK og sand fysisk evidens.
Ikke-mål: lokal auto-close eller fraseliste, nye værktøjer, større pris-/kapacitetsloft,
Assist-/Spotify-routing, HA-adgang, lyd, firmware eller lifecycle-mekanik.

Plan: præcisér kun den generiske semantiske kontrakt; migrér uændret gemt v10-prompt,
men bevar brugerdefinerede prompts. Fasthold den observerede fejl som eval-regression,
tilføj accepteret start med ønsket videre dialog og kontrollér begge I/O-adaptere.
Målrettede tests, fast, uafhængigt Ultra-review ved diff-freeze og én releasegate;
grøn exact-head CI og add-on-only installation med Roborock OFF. Sikker enhedstest
og afslutningskontraster på installerede bits før aktivering. Rollback: hele dette
prompt-/beskrivelsesdiff; eksisterende firmware og øvrige indstillinger bevares.
Kandidaten er IKKE testklar; fysisk golden chain, Stop og 10/10 er fortsat pending.

Implementeret kandidat 1.13.69: prompt v11 og afslutningsbeskrivelse skelner mellem
accepteret start og fysisk færdiggørelse; ingen runtime-mekanik er ændret. Eksakt
stock-v10 migreres, tilpasset prompt bevares. Den eksisterende live-fixture fastholder
fire accepterede handlinger før separat model-close; en ny kontrast gentager samme
handlinger med udtrykkeligt ønsket videre dialog og forbyder close. Den observerede
.68-kvittering uden close er en permanent rød eval-orakel-regression. Begge adaptere
beviser, at HA-accept ikke selv lukker, men at model-close følger den eksisterende
kvitterings-/playback-/rearm-kæde og gammel token ikke kan genafspilles ved næste wake.
Målrettet kontrol 64/64 grøn; fast bestod alle 1.529 tests, Ruff/format og mypy44.
Fast valgte hele testsuiten på grund af changelog-scope og tog 73,3 s, ikke den ønskede
korte udviklingscyklus. Den først valgte gamle tmp-venv manglede pyvenv.cfg; skift til
eksisterende intakt ekstern Python 3.12-venv løste miljøet uden produktionsændringer.
Uafhængigt diff-freeze-review og efterfølgende én releasegate afventes. Ingen ny
live-/fysisk evidens, HA-aktivering eller firmwareændring.

Uafhængigt Ultra-review accepted_start_freeze_review: P0=0/P1=0, GO til frosset
releasegate, exact-head grøn CI og default-OFF diagnostisk installation. Revieweren
bestod 60 kontrakt-/migration-/eval-/adaptercases og 24 særskilte provider-ACK-,
stale-, approval- og Thin/Talk-cases. Årsagen er fortsat en hypotese; det korrelerede
provider-spor beviser en completed ren tekst/lydrespons efter accepteret start uden
function-call, ikke en mistet close i collectoren. Ikke-blokerende P2: eksisterende
svarregex kan acceptere en ubekræftet fysisk startpåstand. Derfor skal de faktiske
live-kvitteringer læses manuelt; en grøn regex er hverken sandheds- eller fysisk
aktiveringsbevis. Hele runtime/version/test-diffet er nu frosset til én releasegate.

Frosset releasegate bestået én gang: 1.197 unit + 332 integration = 1.529 tests,
Ruff/format, mypy44 og single-domain realtime_semantics grøn; samlet 42,6 s.
Ingen runtime/version/tests er ændret efter review eller under gaten. CI, publiceret
image, installation og sikker live-test afventes; fysisk status er uændret.

## Aktiv lead-beslutning — bounded diagnostisk kapacitetsventning, 8. september 2026

Lead: Codex. Brugeren har godkendt færdiggørelse af Stop .67 samt kapacitetsrettelsen
oven på publiceret main e067cf9; eksisterende Roborock-adgang forbliver off.
Observeret i installeret .66 live-fixture: discovery og korrekt cleaning-mode lykkes,
men efter fem completed responses afviser pre-dispatch-kapacitetsgaten næste batch,
før den eksisterende diagnostiske pre-wire-refill-ventning nås. Usage er fuldt afstemt;
ca. 6.427 tokens resterer mod et større konservativt followup-reservekrav. Det er
en lokal diagnostisk kapacitetsafvisning, ikke provider-429 eller forkert målvalg.
Kæde: eksklusiv eval-lease → modelresponse → autoritativ usage → staged batch →
pre-effect reservation → fixture → tool-output ACK → pre-wire reservation → næste
response → terminal cleanup/lease-release → ny fysisk wake. Produktion følger samme
sikkerhedsgate, men må ikke få diagnostikkens lange ventning. Nærliggende fejlveje:
cancel/reconnect under wait, gammel socket/generation/lease, late rate-snapshot,
missing usage, provider-429, hard deadline/prisloft, schema-correction og silent close.
Invarianter: lifecycle 10–15, completed-batch-atomik og nul effekt uden kapacitet;
Thin/VoicePE/Talk-ejerskab, half-duplex og eksisterende Stop/Assist/musik bevares.
Hypotese: bounded ventning på den eksisterende eval-lease før batchens sikkerhedsgate,
efterfulgt af eksakt generations-/lease-revalidering og samme atomiske reservation,
fjerner dette diagnostic-only stop uden at svække produktionens fail-closed-adfærd.
Ikke-mål: større provider-/prisloft, ny model/prompt/schema, færre værktøjer, retries af
providerfejl, Roborock-parser/scripts, lyd-/firmware-/lifecycle-tuning.
Plan: reproducer observeret usage/eventrækkefølge med rigtig provideradapter og
budgetbog; bevis ventning før effekt, cancel/release/stale-generation og providerfejl,
uændret produktionsafvisning og begge I/O-adaptere. Uafhængigt adversarial review,
én frosset releasegate, ny version og exact-head CI; sikker Roborock- og Stop-semantik
på shippede bits før koordineret korrekt firmwarepar og fysisk gate. Rollback er
hele kapacitetsdiffet; off/tom allowlist bevares. Kandidaten er endnu IKKE testklar.

Implementeret diagnostic-only kandidat 1.13.68: eksisterende refill-callback før
pre-commit-kapacitetsafvisning, kun ved utilstrækkelig eval-reservation; ukendt sent
rate-snapshot clamps konservativt, samme socket/generation/input/lease/hook revalideres
efter await og samme atomiske gate afgør frigivelse. Eligible schema correction følger
samme grænse. Pre-wire-clamp/pacing, collectorens pricecheck og Usage-regnskab bevares.
En ny regression er rød mod .67 og grøn mod rettelsen med typed authoritative usage.
Cases dækker cancel, deadline, release/replaced lease, socket/close/generation/input,
duplicate done og ingen wait ved ikke-completed/missing usage; en sammensat case
fortsætter gennem ægte tool-output item-ACK til præcis én matching næste response.
Første fast-gate ramte lokale portrettigheder; dette er testmiljø, ikke runtimefejl.
Genkørsel med testportadgang bestod 1.524 cases; én versionsidentitetstest ramte
versionsskiftet efter import under denne ikke-frosne fast-kørsel. Frisk kontrol af
versionskontrakt og alle 18 nye kapacitetscases er 24/24 grøn. Ingen runtimeændring
på grund af miljø-/metadatafejl. Ruff/format og mypy44 er grønne.
Uafhængigt årsagsreview godkendte det afgrænsede eksperiment og krævede, at fuld
produktionsevne IKKE udledes af eval. Den eksisterende produktionsgate kan stadig
afvise lange kæder ved lav kapacitet. Fysisk aktivering kræver måling på det faktiske
kommando-/værktøjssnapshot; hvis den reproducerer kapacitetsfejl, kræver produktionens
ejergrænse en separat begrundet rettelse. Ingen ændring af firmware, prompt, værktøjer,
Thin eller VoicePE/Talk i dette diff. .67 Stop-gates er stadig pending på samme par.

Uafhængigt Ultra diff-freeze-review `/root/capacity_freeze_review`: P0=0/P1=0,
GO til frosset releasegate, exact-head grøn CI og default-off diagnostisk installation.
Revieweren bestod 599 eksisterende tests samt sammensatte adversarial probes for sent
rate-snapshot, terminal 429 uden retry og prisloft under pre-commit-ventning uden effekt.
Tre ekstra probes som permanente tests er en ikke-blokerende P2-opfølgning.
Review er ikke godkendelse af fysisk Stop eller produktions-Roborock.
Den eksisterende fulde sikre preflight indeholder Stop-kandidatens 30 nye scenarier;
den køres under uændrede hårde budgetter uden ny UI/testvej eller automatisk genforsøg.
Runtime/version/tests fryses nu til én samlet releasegate.

Frosset releasegate bestået én gang: 1.193 unit + 332 integration = 1.525 tests,
ruff/format, mypy44 og single-domain scope grøn; samlet 42,7 s. Ingen ændring i
runtime/version/tests under eller efter gaten. Exact-head CI, publiceret image,
installation, live preflight og fysisk gate er endnu ikke resultater.

## Aktiv lead-beslutning — Stop-kontekst v2, 8. september 2026

Lead: Codex. Bruger har godkendt hele planen: modelsemantik under lytning uden
fraseregler; lokal stille afbrydelse under tænkning/tale; ingen omgørelse af allerede
udførte handlinger. Base c85eca5 (1.13.64) bevares, inklusive afsluttet-handling-semantik.
Observeret: tidlige Stop-forsøg fejlede, senere Stop/Hey Chat virkede. Kodebevis:
PLAYING enable genindlæser Stop og giver mindst100x10ms cooldown. Tidligere stubtests
rammer ikke inferens. Frisk trace20260908T123630-251 fejlede separat på
max_output_tokens, ikke netværk, og beviser ikke Stop-detektion.
Kæde: mic/modelberegning → generationsbundet eligibility/ACK → detektion → lokal
outputstop → Thin close barrier → tool/provider-cancel → drain → disable ACK →
teardown/rearm → Hey Chat; modsat vej listening → fuld modelsemantik → completed
silent end_conversation → samme close. Invarianter: half-duplex3–7, lifecycle6–7/10–13.
Hypotese: varm inferens med worker-fenced generationsgrænse fjerner load-blindhed uden
at lade stale/idle detektion ramme nyt svar; modelvalgt silent-close giver stille
semantisk afbrydelse uden keyword-routing. Ikke-mål: same-breath-tuning, outputloft,
fejlklassifikation, gain/VAD/cutoff, fuld duplex eller nye medieejere.
Regressioner: actual pinned MWW cooldown/queue, adapter+Thin THINKING/tool/playback/
listen ACK-races, silent-schema/commit, modsatte Talk, 30 live semantiske cases ($5),
40 fysiske Stop (39/40,p95<=500ms),10 tænketidsstop,50 self-stop-negativer,10 lifecycle.
Uafhængigt review før frosset releasegate og ét parret artifact. Rollback: hele v2-parret.
Status: under implementering; ingen ny release/installation/fysisk godkendelse.
Brugerens merge-stop: Stop-kandidaten må først merges og installeres, når Roborock-
delen i Home Assistant er ude. Denne afhængighed skal verificeres frisk før merge;
implementering, tests og uafhængigt review kan fortsætte imens.

Arbejdskandidat, endnu ikke testklar: silent end er implementeret med strict bool og
korreleret output-ACK; seks målrettede tests består. Pinned ESPHome 2026.6.2
streaming_model.cpp testes nu uændret med TFLite/platformgrænsen simuleret. Testen
viser 100 under-cutoff-slices ved reload/reset; høje scores kan forlænge blindheden.
StopGate bruger varm inferens, producer/consumer-watermark, release-fence og højst ét
event per epoch uden upstream Stop-reset. Det beviser eventkorrelation, ikke neural
isolation eller akustisk kvalitet. Firmware-, adapter- og Thin-kobling er under arbejde.
Første adversarial review fandt P1 reconnect uden recovery-nonce og P1 same-batch
rearm/wake-context-tab samt timer/mute-fejlveje. Årsagsgrænsen omfatter derfor retained
context til disable-only recovery, reset før rearm-ACK og timerens separate epoch.
Ingen frysning/releasegate før de fund er rettet og regressionsbevist. Ingen fysisk
test, ny installation eller godkendelse er foretaget.
Source-review stoppede derefter pinning på én P1: idle timer kunne bære en enabled
Stop-epoch gennem detector-restart og ende permanent faulted uden ejer. Rettelsen
skal bruge den eksisterende cancel/drain/rearm-kæde: suspendér timerens eligibility
under cleanup, kvittér først efter disabled worker-fence, genoptag efter rearm. Ved
egentlig idle-inferensfejl annulleres den ringende timer synligt, nye wake afvises,
og samme Thin-teardown-recovery udføres. Ingen selvstændig firmware-restart-owner.
Actual StopGate+PodVoiceReply testes sammen. Nyt review fandt et manglende main-tick
mellem planlagt worker-stop og restart: idle fault må ikke annullere en timer, som
cleanup har suspenderet for senere genoptagelse. Regressionen injicerer nu dette tick;
kandidaten forbliver ikke testklar indtil uafhængig genkontrol.

Samlet review fandt desuden P1: en forsinket idle-fault callback uden reset-/session-
identitet kunne lukke næste wake. Fejl-events bindes derfor til forbindelsen og reset-
generationen, og idle-fejl må kun eje idle recovery. En regression tilbageholder
callbacken over rearm og ny samtale. Review fandt samtidig en sovende cleanup-retry,
som kunne stoppe næste wake efter en anden succesfuld cleanup. Retry bruger nu samme
teardown-lock også omkring silence og revaliderer epoch/inaktiv/ufuldendt efter waits.
Ingen separat cleanup-owner tilføjes. Evalreview fandt også en utilstrækkelig stilheds-
observation ved silent ACK; PCM og transcript efter tool-commit skal med i oraklet.
Komponentkilde baf41b9 er uafhængigt godkendt (14 filer, SHA256
8409fc77758a899ed5086510db85683f7f16bb7e5e5605a76ccedf3a99d8eec4), men push blev
afvist af automatisk godkendelseskontrol. Destinationsgodkendelse afventes; ingen
publiceret pin, release eller installation. De 30 nye semantiske scenarier er testdata;
rigtig Realtime og fysisk gate er fortsat ikke kørt på kandidaten.

Lokal kontrol 8. september 15:30: uafhængigt helkæde-review ved
/root/stop_field_review: ingen resterende P0/P1, GO kun til lokale samlede gates.
Tre findings er rettet og regressionsbevist: stale idle fault, sovende cleanup retry,
og ikke-vakuøst silent-orakel. Ruff/format og mypy (43 kilder) er grønne. Den samlede
fast-gate med adgang til lokale testporte kørte alle tests på 70,72 s; kun de to
bevidste distributionslåse fejler, fordi firmwarekilden stadig er en lokal sti.
Ingen tests eller låse svækkes for at omgå manglende publicering. 203 evaltests og
14 actual-MWW/Stop-tests er særskilt grønne; dette er ikke live semantisk evidens.
ESPHome 2026.6.2 compile er grøn (14,76 s), config_hash 0x90f13c23,
build_time 2026-09-08 15:29:32 +0200. Alle 10 genererede C++-/headerfiler fra de
14 reviewede komponentfiler matcher kilden byte for byte. Compile-only OTA SHA256:
c66f58f705d5a03e0307917577f18305cee462b0ddf9be79bb8bc53b41bab826.
Denne binær bruger dummy-testsecrets og må ikke installeres.
Næste grænse: destinationsgodkendelse → publiceret source-pin → frisk main/Roborock-
identitet og samlet review/freeze → krævede gates → koordineret rigtigt versionspar
og live/fysiske prøver. Ingen frossen releasegate, merge, installation eller fysisk
prøve er udført på Stop-v2. Kandidaten er fortsat ikke testklar til fysisk installation.
Brugerens "merge" autoriserer nu publicering og merge. GitHub verificeret frisk:
Roborock PR36 er merged som 7d25bea, og efterfølgende PR37 giver main6360104 /
1.13.66 med grøn CI. Komponentrevision baf41b9 er nu publiceret på featurebranchen;
immutable pin kan derfor valideres fra GitHub. Samlet Stop-kandidat bliver 1.13.67.
Main er integreret med bevaret Roborock-kode og begge beslutningshistorikker.
Mergeforberedelsen kræver nyt review af det effektive diff og frosset releasegate.
Dette ændrer ikke fysisk gate-status; Stop-v2 er endnu ikke installeret eller bevist.

Scope-precheck klassificerer Stop-kæden som audio_input, ha_tools, physical_output,
realtime_semantics og rearm. Den eksisterende reviewkontrakt accepterer kun to
historiske par og afviser derfor den eksplicit bestilte fuldkæde. Tooling udvides med
præcis denne femtuple under uændrede krav om uafhængigt review og fingerprint af hele
det effektive produktionstræ/base. Regressioner skal fortsat afvise intet review,
ændret kilde/base/domæne og manglende test. Ingen domæne eller invariant fjernes.
Denne toolingændring indgår i det uafhængige slutreview før frysning/releasegate.

Slutreview mod main6360104: /root/stop_field_review giver GO til frosset releasegate,
P0/P1=0. Reviewer har selv verificeret 86 effektive produktionsfiler og nedenstående
fingerprint. Alle 16 eksisterende semantiske scenarier samt Roborock-kontrakten er
bevaret. Scope-regressioner (17) og Roborock-integration (10) består. Firmware bygger
nu fra den publicerede pinbaf41b9: ESPHome2026.6.2, 16,04 s, config0xeb4c6bdb,
build2026-09-08 15:57:07+0200. Alle 10 genererede komponent-C++/headerfiler matcher.
Compile-only OTA SHA256 823f0f394ece0b50f829fcb41c80b278cf22889d3fe73df19bca5f3a53664672;
dummy-testcredentials, ingen installation. Produktionsdiff fryses nu til releasegate.

<!-- historical-stop-coupling (merged as e067cf9; not this candidate's scope approval)
{
  "version": 1,
  "base_tip": "6360104ce22a5d96a8ec562764e4b4e9fd5ce6bf",
  "merge_base": "6360104ce22a5d96a8ec562764e4b4e9fd5ce6bf",
  "domains": ["audio_input", "ha_tools", "physical_output", "realtime_semantics", "rearm"],
  "fingerprint": "7d2bd66ef187021ea650bf7425535bd4a3208d0c8ee992c416a2bf4b1385f987",
  "reviewer": "/root/stop_field_review",
  "rationale": "The requested Stop contract couples warm firmware detection, assistant-turn admission, physical cancellation and rearm with model-owned silent closure during listening; current Roborock behavior is preserved."
}
-->

Frosset releasegate på 26d10af mod6360104: grøn på42,3 s. Exact-coupling-scope,
Ruff/format, mypy44filer,1175unit og332integration =1507tests består. Produktionsdiff
var uændret under gate; kun denne resultattekst tilføjes bagefter. Kandidaten går nu
til ét PR-flow med exact-head CI/ARM64 før den autoriserede merge. Live semantisk og
fysisk gate er fortsat pending, og ingen Stop-v2-firmware er installeret.

## Aktiv lead-beslutning — præcist handlingsmål, 8. september 2026

Lead: Codex. 1.13.65 er merget, publiceret og installeret som godkendt diagnostik,
med udvidet enhedsstyring off/tom allowlist. Frosset releasegate og exact-head CI
bestået; dette er ikke enabled/fysisk godkendelse. Den første rigtige fixturetest
fejlede efter discovery: modellen valgte select.select_option/vacuum-ID i stedet for
det returnerede controls[].entity_id. Nul fixtureeffekter; modellen rapporterede sandt
afvisning og undlod retry/start/close. Ukendt- og tvetydighedsscenarier blev ikke kørt.
Kandidaten er IKKE testklar til aktivering. Ingen rigtig robotkommando er sendt.
Direkte evidens: retained live-resultat og uafhængig reproduktion i production Rig;
forkert select-mål og efterfølgende genbrug af token giver begge afvisning/nul writes.
Kæde: brugerinput → GET vacuum → controls/option-resultat → modelvalgt EXEC-mål →
engangstoken/target-validering → afvisning → sand fejlbesked → åben dialog/normal
teardown ved afslutning → næste wake. Ingen ændring af disse mekaniske ejergrænser.
Berørte invarianter: Realtime ejer valg; HA ejer præcise ID'er; server autoriserer
uden target-inference; lifecycle 10–15 og eksisterende Assist/musik bevares.
Falsificerbar hypotese: en beskrivelse på EXEC.entity_id, der skelner control-ID fra
vacuum-ID, får modellen til at vælge korrekt mål i det uændrede live-fixture.
Ikke-mål: routing, fejl-retry, afslutning, prompt, firmware, lyd, budget og fixtures.
Plan: én feltbeskrivelse; permanent forkert-domæne-regression med consumed token og
nul writes, schema/off-paritet og uændret fuldkæde på begge adaptere; uafhængigt
review, én frosset releasegate og ny isoleret live-test. Rollback: feltbeskrivelsen;
off bevares indtil live/manual-reply-review, schema-match og fysisk canary er bestået.

Implementeret kandidat 1.13.66: kun EXEC.entity_id-feltets beskrivelse er præciseret;
dispatch, validering, fixtures, prompt og lifecycle er byteuændrede. Fire nye cases:
feltkontrakt samt select-på-vacuum og begge vacuum-handlinger på select, alle med
genbrugt token og nul writes. 81 fokuserede unit- og 10 integrationtests bestået.
Fire lokale socketcases krævede korrekt testserver-tilladelse; ingen runtimepatch.
Uafhængigt review: ingen nye findings, GO til frosset gate og derefter grøn CI/off-
diagnostikinstallation. Revieweren genkørte selv ni regressionscases inkl. begge
adapteres lifecycle-kæde. Live-forbedring er endnu ikke påvist; aktivering er NO.
Frosset releasegate mod 7d25bea bestået: Ruff/format, mypy 44 filer, scopekontrol,
1.139 unit- og 315 integrationtests. Ingen ændringer under kørslen. Exact-head CI og
ny ARM64-publicering skal stadig bestå, før denne kandidat installeres til live-test.

## Aktiv lead-beslutning — afgrænset enhedsstyring, 8. september 2026

Lead: Codex. Brugeren har godkendt planen og implementering på frisk main `c85eca5`
(1.13.64). Separat usynkroniseret worktree; eksisterende dirty workspace bevares.
Observation: Assist-kataloget giver ikke modellen Roborocks komplette kombination af
indstillinger, segmenter og gentagelser. Direkte evidens er ToolRouters statiske
Assist-admission og HA 2026.9.0 Roborock-kilde: get_maps, cleaning-selects og
app_segment_clean. Ingen frisk fysisk Qrevo-test foreligger.
Hypotese: to bounded HA-værktøjer med on-demand capabilities og præcis validering
giver Realtime de manglende handlinger uden ændring i samtalemotor eller musikvej.
Kæde: wake/input → Realtime completed/commit → eksisterende ToolRouter-policy →
friske HA-metadata/indstillinger → én tilladt handling → resultat → Realtime-svar →
playback → teardown/rearm → næste wake. Cancellation, stale schema/config/kort,
duplikater, uvis HA-start og fejl mellem indstillinger/start skal afvises sikkert.
Berørt kontrakt: HA ejer live-data/handlinger; server ejer autorisation; lifecycle
10–15 (korrelation, commit, sideeffekter og budget) bevares. Den eksisterende statiske
HA-serviceadapter udvides eksplicit; Assist erstattes ikke. Ikke-mål: firmware, lyd,
VAD, gain, timeouts, lokal taleparser, HA-scripts, HA-MCP-installation og nye
adminhandlinger/adgangsrettigheder.
Plan: default off, eksplicit entity-allowlist, to statiske schemas højst 6 KiB,
friske lovlige værdier og aktivt Roborock-kort før start; ingen automatisk retry.
Regressioner: off-paritet, præcis +2 tools, rå service-/target-injektion, forkert
integration/device/select, ændret kort/options, disable under read, timeout og fejl;
eksisterende Thin/Talk commit/lifecycle samt lys/Spotify. SafeEval uden HA-sideeffekter,
uafhængigt adversarial review og frosset releasegate kræves før publicering.
Rollback: slå funktionen fra (nye handlinger afvises straks), eller fjern hele
kandidatdiffet. En allerede afsendt robotopgave stoppes ikke af toggle/rollback.
Status: implementering startet; ikke testklar, udgivet, installeret eller fysisk bevist.
Fysisk golden chain, 10/10, to køkkenpassager og før/efter musik-/lyslatens afventer.

Første lokale kandidat: default-off settings og to schema-deklarationer, on-demand
read-only registry (`config/entity_registry/get_entries`), state og `roborock.get_maps`.
Kun cleaning_mode/mop_mode/mop_intensity på samme tilladte Roborock-device kan ændres;
selected_map skal også tillades og læses kun. Engangscapabilities bindes til præcis
session/tur/config-generation, registeridentitet og kort. Hver indstilling læses tilbage,
og tidligere bekræftede værdier kontrolleres før næste handling. Start er ét præcist
`app_segment_clean` med segmentliste og repeat, aldrig et ekstra Assist-startkald.
HA-ACK markeres eksplicit som ikke-fysisk bevis. Ingen runtime/prompt/firmware-tuning.

Frisk upstream-kontrakt er kontrolleret mod HA 2026.9.0:
[Roborock vacuum](https://github.com/home-assistant/core/blob/2026.9.0/homeassistant/components/roborock/vacuum.py),
[cleaning/map selects](https://github.com/home-assistant/core/blob/2026.9.0/homeassistant/components/roborock/select.py),
[entity registry](https://github.com/home-assistant/core/blob/2026.9.0/homeassistant/components/config/entity_registry.py).
Dette er kildeverifikation, ikke verification af installeret HA-version eller Qrevo.

Testforløb: første brede kørsel kunne ikke åbne localhost i sandbox; ingen runtime-
workaround. Den efterfølgende kørsel fandt kolliderende unit-/integration-filnavne;
integrationstesten fik særskilt navn. Korrigeret `scripts/dev fast --base origin/main`
er grøn på kandidatens samlede testsuite, Ruff/format og mypy (52,5 s). 41 nye unit-
cases og 8 sammensatte cases dækker de to værktøjer, registerprotokol, identitet/kort,
engangskald, disable/cancellation/timeout, indstillingsreadback, eksisterende Assist/
Spotify-kald uden ekstra opslag samt Thin/Talk commit og replay. Scope er kun ha_tools.
Fast-tiden overskrider toolingmålet og er ikke latency-evidens for produktet.

Resterende arbejde før aktivering: uafhængigt review, fokuseret sideeffektfri live
Realtime-eval med den udvidede kontrakt, browserbetjening og fysisk Qrevo-verifikation.
Det eksisterende SafeEval-profile indeholder endnu ikke disse to fixture-kontrakter;
et grønt gammelt profile kan derfor ikke godkende denne feature. Ingen installation,
fysisk funktion, robot-repeat eller uændret fysisk musik-/lyslatens er bevist.

Review fandt tre konkrete kandidatfejl før fysisk test: Supervisor-WebSocket skal
bruge `/core/websocket`, ikke `/core/api/websocket`; et nyt capability-opslag kunne
omgå engangstoken efter samme turs start/timeout; og vacuum-/select-states var læst før
et afventet kortopslag. Kandidaten er ikke testklar. Rettelser begrænses til den
dokumenterede endpointgrænse, en terminal startgrænse per robot/tur (uvis start blokerer
også næste tur), og sidste aktuelle state-/indstillingskontrol efter metadataopslag.
Regressioner skal injicere præcis disse rækkefølger. Assist og lifecycle ændres ikke.

Rettet: Supervisor-ruten er fastlåst i kode/protokoltest; terminaljournalen gemmer
hver robot/session/tur og kan ikke overskrives af et andet rums samtale. Ukendt start
blokerer også senere ture. Sidste kontrol er ét serverbygget, read-only HA-template
med kun validerede præcise IDs, efter alle metadataopslag og før policy/afsendelse.
HA-state er stadig cachede enhedsdata, ikke en atomisk lås på den fysiske robot.
Journalen er bounded og proceslokal; en add-on-genstart beviser ikke, at en tidligere
uvis robotopgave ikke blev startet. Ingen automatisk retry implementeres.
HA's `/template` kræver eksisterende administratorautorisation; adapteren genbruger
samme Supervisor-adgang som ToolRouters nuværende area-opslag og tildeler ingen nye
rettigheder. Modellen kan hverken vælge templatekode eller adminhandlinger. Manglende
adgang giver et fejlet opslag uden robotkommando.

Review fandt også, at store capability-resultater kunne miste token/rum i providerens
2048-byte-beskæring. Hele svaret må nu være højst 1800 bytes før token udstedes; større
opslag giver en eksplicit fejl, ikke en falsk anvendelig succes. Regressionen bruger
den rigtige provider-serializer. Sidste template-timeout klassificeres som opslag uden
afsendelse; service-timeout klassificeres særskilt som uvis handling.
57 målrettede unit-/integrationcases er grønne efter rettelserne (0,35 s), inklusive
to ejere A→B→A, friskt opslag efter timeout og stateændring under kortopslag. Det
oprindelige review var NO-GO; reparationsreview afventer. Ingen releasegate er kørt.

Afsluttende reparationsreview fra `/root/device_control_review`: P0=0/P1=0 i det
reparerede scope; otte repair-regressioner genkørt uafhængigt. Reviewer godkender kun
lokal kandidathandover og én frosset lokal releasegate. Reviewet module-SHA256 er
`7bf95573e1c877bba7192c28e3056f0884e771f0b15b9883b6b976fedc63262e`.
Den ene efterfølgende `scripts/dev release --base origin/main` er grøn (29,0 s):
ha_tools-scope, Ruff/format, mypy, 1107 unit- og 313 integrationtests. Kun denne
resultattekst ændres efter gaten; runtime forbliver frosset. Tidligere NO-GO-findings
er afløst af reparationsreviewet, ikke bortforklaret af tests.

Handover: første lokale implementering er klar på `codex/bounded-device-control`,
baseret på main c85eca5/1.13.64. **Ikke klar til aktivering eller fysisk test endnu.**
Ingen publicering, versionbump, installation eller konfigurationsændring i hjemmet.
Næste arbejde er fokuseret sideeffektfri live SafeEval med de to faktiske værktøjer,
enabled-feature svar/playback/lifecycle-bevis, browserprøve og derefter de fysiske
Qrevo-/musik-/latensgates. Den eksisterende kørende installation er urørt.

### Mergeforberedelse — 8. september 2026

Brugeren beder om at gøre klar til merge. Frisk fetch bekræfter stadig main `c85eca5`;
den rene kandidat `5c3d5a0` er én commit foran. Ingen installation eller aktivering.
Kandidatversion ændres samlet til 1.13.65 i manifest, package og projektmetadata,
så en senere main-publicering ikke forsøger at genbruge den immutable 1.13.64-version.
Funktionskode og reviewet device_control-modul bevares byteidentisk. Changelog skal
beskrive funktionen som eksperimentel/default-off, ikke som fysisk leveret.
Samme kausale kæde, invarianter og rollback-grænse som ovenfor gælder; ingen ny
samtale- eller enhedsadfærd. Plan: afgrænset review af versions-/artifact-deltaet,
én frosset lokal gate og kladde-PR med exact-head CI/ARM64-build. Merge forbliver
blokeret af fokuseret live SafeEval og enabled-feature reply/playback/lifecycle-
evidens; browser- og fysisk aktiveringsgate arves ikke fra eksisterende tests.

Afgrænset metadatareview `/root/merge_metadata_review` godkender versionskonsistens,
uændrede funktionsbytes og korrekt immutable-tag-adfærd til lokal gate/kladde-PR.
Ny frosset lokal gate på 1.13.65 er grøn (28,6 s): scope, Ruff/format, mypy,
1107 unit- og 313 integrationtests. Kun resultattekst ændres efter gaten.
Kandidaten er klargjort til remote CI/review som kladde; dette er ikke merge-,
installations- eller aktiveringsgodkendelse. De nævnte live-/lifecycle-gates mangler.

Push til den eksisterende origin `https://github.com/BixelVentures/podvoice.git`
blev afvist før eksekvering af automatisk sikkerhedsreview: mergeforberedelse blev
ikke vurderet som specifik tilladelse til at eksportere kandidatkode/metadata til
destinationen. Ingen remote branch, PR eller CI blev oprettet. Lokalt commit/handover
kan afsluttes; push og kladde-PR afventer brugerens eksplicitte uploadgodkendelse.

### Autoriseret levering — 8. september 2026

Brugerens "Yes skub skub helt til add on" autoriserer nu push, merge og installation,
men ophæver ikke testkrav. Branch er skubbet og kladde-PR #36 oprettet. ARM64-build
bestod på b60fdfe; CI fandt en testantagelse, ikke en observeret runtimefejl:
`issued_at=0` er ikke udløbet på en runner med monotonic-uptime under 120 sekunder.
Rettelsen begrænses til relativ alder i testen. Ingen timeout eller runtime ændres.
Enabled-feature integrationen udvides med kvittering/playback, modelstyret lukning,
én teardown/rearm og ny wake med afvist gammel capability på både Voice PE og Talk.
Dette er deterministisk adapterbevis, ikke fysisk lyd-/robotbevis. Kandidaten er
fortsat ikke merge-/aktiveringsklar; fokuseret live SafeEval og browsergate mangler.

Resultat: 59 målrettede cases bestod. `/root/device_control_review` finder ingen
konkret blocker i det test-only delta og bekræfter bevisgrænsen (FakeVoicePELink,
rigtig BrowserLink/ThinSession, ikke fysisk Voice PE). `fast` er grøn på hele
testsuiten (51,8 s); langsom samlet kørsel ændrer ingen runtimehypotese.
Chrome-browserprøve på loopback med kandidatens uændrede web/settings-kode og
sideeffektfri HA-fixture bekræfter default-off, linjevis entity-liste, gemt tilvalg
med præcis to værktøjer, gemt fravalg med straks nul ekstra værktøjer uden genstart,
og afvisning af `light.not_allowed`. Fixturet sendte nul HA-handlinger.
Live HA-panelet er læst og viser fortsat v1.13.64; hjemmets indstillinger er urørt.

Frosset gate efter test-only reparation er grøn (28,6 s), 1107 unit- og 315
integrationtests. Runtime og add-on-context er uændret fra b60fdfe.
Reviewers leveringsafgørelse er NO under den nuværende eksplicitte før-merge-gate:
default-off beviser ikke den manglende fokuserede live SafeEval. Et isoleret,
server-ejet fixture-profile kan teste de to kandidatdeklarationer under den
eksisterende diagnostiklås uden at aktivere HA-handlinger. Dette er endnu ikke
implementeret. Ingen nye SSH-/administratorrettigheder er nødvendige som udgangspunkt.
Diagnostik-først-installation er en anden rækkefølge end den registrerede releaseplan
og kræver brugerens specifikke godkendelse; alternativet er en isoleret stagingvej.
Ingen merge, installation eller aktivering udføres før den afklaring.

### Godkendt diagnostik-først — 8. september 2026

Brugeren har efter forklaringen af den simulerede robot godkendt "ja gør alt det".
Rækkefølgen ændres eksplicit: review og maskinelle gates → merge/installér med
enhedsstyring fortsat off → isoleret live fixture-test → først derefter fysisk canary.
Dette godkender diagnostikinstallation, ikke allerede bevist Roborock-funktion.
Observation: det eksisterende SafeEval afviser de nye værktøjer og har kun tre
normale response-edges per tur. Hypotese: et separat, eksplicit valgt Roborock-profile
med server-ejede fixtures og ni reserverede edges kan prøve hele indstillingskæden
uden HA-trafik eller ændring af standardprofilet. Ingen nye scripts i HA eller taleparser.
Samme kæde og invarianter som ovenfor; diagnostiklåsen tages før kandidat-snapshot
og providerforbindelse, og alle fejl/cancellation frigiver den. Faktisk off-snapshot,
hypotetisk enabled-snapshot, fixturehash og artifactidentitet må ikke sammenblandes.
Plan: success/max/extreme/repeat, ukendt start uden retry og tvetydigt rum uden start;
afvis udeklarerede og ikke-fixturerede kald; normal evaluering og musikvej uændret.
Regressionskrav: baseline-paritet, eksklusiv lease, cancellation, faste budgetter,
token-/actionrækkefølge, artifact-/schemaidentitet og sand UI-resultattekst.
Rollback: off bevares; fjern kun det valgfrie evalprofile ved diagnosefejl. Ingen
ukendt robotstart kan blive gjort kendt ved genstart. Fysisk gate er stadig ikke bestået.

Implementeret valgfrit `device-control`-profile med tre scenarier/fire ture: discovery
og max/extreme/køkken×2, ukendt start uden retry, tvetydigt rum uden handling. Ingen
produktionsindstillinger aktiveres; alle kald bliver i eksakte syntetiske fixtures.
Hele faktisk off-katalog suppleres med præcis kandidatmodulets to deklarationer.
Diagnostiklås tages før snapshot; faktisk/kandidat providerhash og rå routerhash
registreres separat sammen med modul-, fixture- og runtime-artifact-identitet.
Normal SafeEval beholder sine fire reserverede edges og sit uændrede corpus.
Det nye profile reserverer ni token-edges, men afregner autoritativ usage per response
og kontrollerer hver næste worst-case $1-edge mod det samme samlede $5-loft.
Review fandt manglende svar-orakler og en prisgrænse ved fortsættelse efter fejlet
discovery. Rettet kun i fixture-profilet: tomme/falske succesbeskeder afvises, og en
bedømt fejl stopper scenariet før næste brugerinput. Dermed holdes forhistorisk lyd
inden for den eksisterende konservative prisberegnings 12.288 audio-tokens.
Mode skal vælges først; fan og vaskeintensitet må derefter bytte rækkefølge via to
eksakte tokenkæder. Begge kæder ender i præcis én start med køkkensegment 16/repeat 2.
Browserprøven med lokalt mock-resultat bekræfter den nye testknap og tydelig tekst om
simuleret robot/ingen aktivering; dette er UI-bevis, ikke en kørt live modeltest.

Uafhængigt repair-review: P0=0/P1=0, 28 nye regressioner bestået; GO til én frosset
lokal releasegate og derefter grøn CI/merge/install med enhedsstyring off og tom allowlist.
Resterende P2: svar-orakler er begrænsede heuristikker og kan acceptere et blandet
ukendt-/succesudsagn. Før aktivering skal lead manuelt gennemgå de bevarede faktiske
live svar: ukendt må ikke påstå start eller afslutning, tvetydighed skal reelt afklares.
`candidate_contract_passed` alene åbner aldrig aktivering eller fysisk canary.
Et tidligere fast-gateforsøg blev ugyldigt, fordi diffet ændredes under kørslen;
det tæller ikke som en frosset kandidatgodkendelse.

Frosset lokal releasegate bestået mod frisk origin/main c85eca5: Ruff/format,
mypy (44 kildefiler), scope ha_tools, 1.135 unit- og 315 integrationtests.
Første start blev afvist før kørsel af en sideløbende gates fælles lås; efter dens
afslutning kørte denne gate én gang til grønt. Ingen produktionsændring under gaten.
Næste nødvendige bevis er CI/ARM64 på det præcise nye commit; live fixture og fysisk
Roborock/Voice PE er stadig ikke kørt eller godkendt.

## Aktiv lead-beslutning — afsluttet handling, 8. september 2026

Lead: Codex; separat kandidat fra main 1707b03. Brugeren bekræfter Texas Sun virker,
men oplever fortsættelse efter "stop musikken" og ønsker modelsemantik uden fraseregler.
Direkte kodeevidens: både prompt v8 og end_conversation-beskrivelsen forbyder mediestop
som afslutning. Hypotese: en afgrænset fælles kontrakt for bekræftet, selvstændig handling
fjerner denne modstrid. Ingen fysisk trace beviser endnu, at dette er hele feltårsagen.
Kæde: wake → accepteret input → modelvalgt medieværktøj → korreleret resultat →
modelvalgt end_conversation → kort kvittering → fysisk finish → én teardown/rearm.
Invarianter: Realtime ejer betydningen; lifecycle 3–6 og 10–13 bevares. Uklarhed,
ventende bekræftelse, fejl og ønsket videre dialog må ikke blive vellykket opgave-close;
ingen ændring i mic, firmware, VAD, timeouts, dispatch eller transportejerskab.
Planlagte målinger: SafeEval-par for handling/alene, handling+dialog, uklarhed og fejl;
bekræftet resultat skal ligge i en tidligere tool-batch end opgave-close. Migration
må kun erstatte byteidentisk gammel standardprompt. Thin/Talk-regressioner, uafhængigt
review og én frosset releasegate. Rollback: hele prompt/schema/migration-diffet.
Review fandt modstridende ældre evalkrav efter godkendt handling og manglende
negativ kontrol af falske succesudsagn ved fejl/uklarhed. Evalkrav og terminalrespons-
beskrivelsen opdateres samlet; ingen lokal samtalelogik indføres.
Implementeret: prompt v9 og værktøjsbeskrivelse deler reglen om bekræftet, selvstændig
handling; standardprompt v8 migreres, brugerændringer bevares. Begge I/O-adaptere har
regression for handling → resultat → close → kvittering → finish → én teardown.
Uafhængigt adversarial review: P0=0/P1=0, godkendt til én lokal releasegate efter
grønne målrettede regressioner. Ruff/format og målrettede regressioner er grønne.
Releasegate forsøgt én gang: Ruff/format og mypy grønne, men scopekontrollen stoppede
på en nedarvet stop-coupling-post. Posten er arkiveret uændret nedenfor; genkontrol
viser ha_tools + realtime_semantics fra evalfixtures og semantikkontrakten. Ingen
produktionsdispatch er ændret. Scopegaten er fortsat rød; den omgås eller svækkes ikke.
De resterende unit- og integrationstests er efterfølgende kørt samlet og bestået;
diff-whitespacekontrollen er grøn. Dette ophæver ikke den røde scopegate.
Status: ikke releasegodkendt. Live SafeEval på kandidatens installerede schema/prompt
samt fysisk golden chain/10 af 10 afventer. Kandidaten er ikke fysisk
testklar eller installeret. Eksisterende fysisk baseline ændres ikke.

Brugeren autoriserer nu merge og udgivelse. Scopefejlen løses i toolingens eksisterende
fingerprint-bundne reviewkontrakt: det præcise par ha_tools/realtime_semantics kan
godkendes uafhængigt, uden at fjerne registrerede risikodomæner. Hele det effektive
produktionstræ og base bindes stadig til reviewet; ændrede bytes ugyldiggør det.
Regressioner skal bevise afvisning uden review samt ved stale bytes/base/domæner/tests.
Ingen yderligere runtimeændring. Ny tooling-kandidat kræver review og frosset gate.

Toolingreview godkendt af /root/scope_review: P0=0/P1=0, 16/16 scopetests grønne.
Revieweren har uafhængigt beregnet nedenstående fingerprint. Den nye frosne releasegate
er grøn (28,8 s): scope, Ruff/format, mypy, unit og integration. Tidligere rød gate er
afløst af dette resultat; kun dokumenteret resultattekst ændres efter gaten.
Kandidaten er klar til autoriseret publicering, ikke fysisk featuregodkendt.

<!-- archived-action-close-coupling
{
  "version": 1,
  "base_tip": "1707b03ef94d5346a09d9fc4266a02d92aaddd2b",
  "merge_base": "1707b03ef94d5346a09d9fc4266a02d92aaddd2b",
  "domains": [
    "ha_tools",
    "realtime_semantics"
  ],
  "fingerprint": "e8ad1b66c5b1fc7a97e98ddd7499b275e86d85388270e32b5b98475d4262039c",
  "reviewer": "/root/scope_review",
  "rationale": "Confirmed-action semantics require matching prompt, tool description and SafeEval fixtures. Production dispatch and lifecycle owners are unchanged; full effective production tree independently verified."
}
-->

## Stop efter Hey Chat — 8. september 2026

Brugeren har betinget stop-merge af, at Hey Chat først er merged. GitHub bekræfter
PR #32 merged 2026-09-08 09:25:45 UTC; ny main er `fe6c471` (1.13.62).
Lead: Codex. Kandidat 1.13.63 kombinerer de to firmwarekontrakter med markør
`podvoice_build_11363_stop1`. Hey Chats settings-ACK, abonnementsgeneration og
wake-admission bevares; Stop beholder sin særskilte playback-/timer-ejer.
Kausal kontrol: modelvalg/readback → orphan-stop/drain → korreleret rearm → pending
wake-admission → svar → Stop → én teardown/rearm → næste Hey Chat. Test skal bevise,
at stop-/playback-events stadig behandles under wake-admission, men stale callbacks
ikke kan afbryde næste forbindelse. Ingen gain/model-cutoff/Realtime-tuning.
Komponent-pin 305b510 er uændret, men den samlede firmware får Hey Chat-modellen og
skal kompileres igen. Integration, uafhængigt review, ny fingerprint og releasegate
kræves mod denne main. Ingen installation eller fysisk bevis er autoriseret/udført.
Sammensat regression med rigtig adapter/Thin er grøn: tilbageholdt wakevalg-ACK →
orphan stop/drain → rearm-ACK+wake i samme batch → bevaret PCM → nyt abonnement,
hvor gammelt token-gyldigt stop er inert. Uafhængigt review: P0=0/P1=0; reviewer har
verificeret den nye fingerprint over alle 73 effektive produktionsfiler. Kombineret
firmware kompilerer (26,12 s), genereret main.cpp indeholder Hey Chat, begge ACK/status-
kanaler og 11363-markøren. Alle 10 komponent-C++-filer matcher pin305b510 byte for byte.
Første fast-forsøg blev afbrudt pga. Hey Chats nye fixture uden reply-status-felt;
fixture er nu tilpasset, uden runtime-workaround. Den frosne releasegate er grøn
(28,6 s): 1354 tests, Ruff/format, mypy og exact-coupling-scope. Kun denne
resultattekst er ændret efter gaten. Ingen fjern-CI eller fysisk funktion er bevist.
GitHub-main er frisk bekræftet som fe6c471. Automatisk review afviste fortsat push,
fordi eksplicit publicering af kode til GitHub-destinationen ikke var godkendt.

### Publicering og installation — 8. september 2026

Brugerens “godt go ahead... fuld arbejde” autoriserede publicering, merge og installation.
PR #33 er merged 09:53:40 UTC som `202b48b87614ec4fdc364f0aae85d12bcd45401a`.
PR-CI og main-CI/run34212512316 er grønne. Udgivet ARM64-image 1.13.63 har digest
`sha256:f523ef190453cc86f43233fd1fab8f40084544077004087dc6ea25221dea429b`.
Remote firmware-konfiguration validerede efter publicering af source-pin305b510.

Frisk manuel HA-backup “Før PodVoice 1.13.63 Hey Chat og Stop”, 44,01 MB, er
verificeret på Dette system. Den eksisterende API-nøgle autentificerede den enhed,
PodVoice allerede er konfigureret til; dens identitet blev verificeret før OTA.
Ingen USB-enhed blev brugt. Add-on blev opdateret fra 1.13.61 til 1.13.63 med yderligere
opdateringsbackup; Home Assistant bekræfter installeret 1.13.63.

Firmware blev bygget fra kandidatens produktions-YAML med remote komponent-pin og
enhedens eksisterende nøgle. Build 16,33 s, config_hash `0xc8e5abad`, bygget
11:57:31 +0200; OTA SHA-256
`110800acff643c450070a1a84757906c364032cdc44131eb732b1b91e55e273a`.
OTA lykkedes; samme MAC genforbandt med ESPHome2026.6.2 og samme buildtid. Native API
annoncerer reply_play/cancel, set_wake_word, Reply Status og wake word ACK.
PodVoice-panelet viser 1.13.63 og forbundet Voice PE. Hey Chat blev gemt, og panelet
viste korreleret “Bekræftet af enheden: Hey Chat”. Genstartens UI viste HTTP502, men frisk sideindlæsning bekræftede live1.13.63,
forbundet Voice PE og gemt/bekræftet Hey Chat efter genstart. Hjem-panelets
vejledning siger stadig Okay Nabu; dette er en observeret UI-rest, ikke modelreadback.
Ingen akustisk wake/stop-gate,
stoplatency, golden chain eller 10/10 er endnu bevist på dette artifactpar.

<!-- archived-stop-coupling
{
  "version": 1,
  "base_tip": "fe6c471e9bfaf4031bbeb8709fc6f23a3299286f",
  "merge_base": "fe6c471e9bfaf4031bbeb8709fc6f23a3299286f",
  "domains": [
    "physical_output",
    "rearm"
  ],
  "fingerprint": "b61a027a3600c08341b65e4787ec8177ee043b42865aed7a96ac5af199779ae9",
  "reviewer": "/root/stop_merge_review",
  "rationale": "The requested local stop drains its owned playback before the same teardown rearms; Hey Chat admission from base is preserved."
}
-->

## Merge-kandidat 8. september 2026

Brugeren har nu autoriseret push og merge; installation er fortsat ikke autoriseret.
Lead: Codex. Stop-deltaet genanvendes på main `21c97fe` (1.13.61), uden at genindføre
snapshot-baselinens ældre provider-, audio- eller dokumentationskontrakter.
Kandidat: 1.13.62. Hele kæden og stop-gates nedenfor gælder stadig. Nyere main tilføjer
playback-id til cancel-adapteren; korrelerede cancel-kald skal afvise et fremmed id.
Review fandt yderligere en ejerfejl: manglende playback-start førte til retry, som den
nye adapter korrekt afviste, men Thin lod exception slippe ud uden close. Hypotese:
én admission på token-adapteren og ejet exception→close bevarer bounded teardown.
Regression: rigtig adapter med manglende start/sendfejl samt sen started efter lukning;
stale cancel må ikke stoppe aktuel lyd; stop/teardown/rearm og modsatte
Talk-overflade skal bestå mod denne main. Ny uafhængig review og én releasegate på
integreret diff kræves. Firmwarekilde-pin er uændret; remote fetch valideres efter push.
Review beviste også tidlig drain-ACK: mixerens callback reducerede pending før den
separate owner-callback talte de samme frames. Snapshot mellem callbackene kunne
kvittere med 50 frames tilbage. Rettelse: mixer-ejet consumed-tæller øges før pending
reduceres; owner læser depth før denne tæller. Regression injicerer begge mellemtrin,
counter-wrap og terminal drain. Ændret firmware kræver nyt source-pin og nyt build.
Begge findings er rettet og målrettede regressioner grønne. Ny komponent-pin: `305b51059dc0c7391b95896f359a6c7f64548f16`.
Nyt adversarial review er afsluttet: P0=0/P1=0; source freeze er godkendt.
Rettet ESP32-build er grønt (99,10 s); alle 10 kompilerede C++-filer matcher 305b510.
Første integrerede releaseforsøg blev stoppet af den nye scope-gate (output+rearm),
som annullerede testjobs. Processen er rettet med en reviewbundet undtagelse i STATUS,
ikke en runtime-workaround: 15 scope-regressioner er grønne, og uafhængig reviewer har
verificeret fingerprintet over alle 71 effektive produktionsfiler. Tooling-review:
P0=0/P1=0. Den korrigerede releasegate er grøn på frosset diff (27,9 s): 1029 unit- og 298
integrationtests, Ruff/format, mypy og eksakt reviewbundet scope. Kun resultattekst er
ændret bagefter. Ingen exact-commit CI/ARM64-publicering, remote firmware-fetch,
installation eller fysisk afprøvning er gennemført. Automatisk godkendelsesreview afviste
igen GitHub-push: det kræver eksplicit kode-/destinationsgodkendelse ud over “Merge
gerne”. Remote package-fetch og merge er derfor fortsat blokeret, installation er
ikke autoriseret. Rollback er hele 1.13.62-deltaet. Ingen ny fysisk funktion er bevist.

## Isoleret stop-word-kandidat — 5. september 2026

**Lead:** Codex, Lead Voice/Reliability Engineer. Bruger har autoriseret implementering
og test, men **ingen merge eller installation før eksplicit besked**. Arbejdet ligger på
`codex/voicepe-local-stop` i `/private/tmp/podvoice-stop-word`, oven på lokal snapshot
`d936fe5` af workspace `186d0fc` plus de eksisterende v1.13.48-ændringer. Snapshot er kun
isolationsgrundlag, ikke en ny fysisk baseline. Installerede bits er ikke undersøgt
live i denne opgave; nedenstående auguststatus er historisk, ikke frisk verification.

- **Observation:** koden indeholder stopmodellen, men armering afhænger af stock Assist
  og callbacken afviser aktive samtaler. Adapterens STOP returnerer ved afsendelse,
  ikke ved tømt pipeline. Ingen frisk fysisk stopmåling findes.
- **Kæde:** mic → lokal stopmodel under eget playback → låst stop-token → lokalt
  announcement STOP → korreleret stopdetektion → Thin close-owner → pipeline-drain ACK
  → provider/mic/attention teardown → korreleret rearm → næste wake. Naboer: svarstart,
  svarslut/lydhale, timer-ejerskab, farvel, disconnect, gamle callbacks og sen URL.
- **Invarianter:** half-duplex 1–5, lifecycle 6–7 og 10–13. Lokal detektion er en
  eksplicit transport-stopknap; Realtime beholder almindelig semantisk afslutning.
  Hypotese: playback-bundet lokal armering og token-korreleret stop/drain kan afbryde
  uden provider-input, dobbelt close eller lyd fra en gammel generation.
- **Ikke-mål:** fortsat samtale efter stop, vilkårlig barge-in, tænketids-stop, latency,
  gain/VAD/prompt/timeout-tuning, nye players, Classic/direct eller ændret tool-schema.
- **Gates/rollback:** rød→grøn adapter/Thin/firmware-regression, kompilering af præcise
  firmwarebits, modsatte Talk-adapter, uafhængigt adversarial review og én releasegate
  efter diff-freeze. Fysisk canary + stopmatrix + golden chain/10 afventer særskilt
  installationstilladelse. Rollback er hele feature-deltaet/tilhørende artifactpar.
  Eksisterende audio-epoch-rettelse bevares; kandidaten er **ikke fysisk testklar**.
- **Årsagsgrænse efter adversarial kilde-review:** ESPHome 2026.6.2-mixeren kan
  beholde en source-reference efter source STOPPED og derefter publicere sidste mix.
  Derfor er resampler/state-polling alene ugyldigt. Kandidaten holdes NO-GO mens en
  kausal fence etableres: producer/command-quiescence → resampler-task stoppet →
  sidste mixer-source-reference frigivet → pending output-frames passeret via fysisk
  output-callback. Dette kræver kun observerende getters i pinnede upstream-komponenter;
  source- og speakeradfærd ændres ikke. Paused/forced shared-stop giver fault, ikke ACK.
  Atomic token+URL-admission erstatter den gamle separate expect+media-call, så en
  sent afleveret URL ikke kan passere stop-låsen. Review gentages på hele kæden.
- **Implementeret:** én firmwarelokal stop-owner, atomisk token+URL-admission,
  playback-bundet stopmodel og korreleret pipeline-drain. Thin lukker lyd/provider/tools
  synkront for ny publicering, samler stop i én close-owner og kræver ny silence-ACK
  efter afbrudt fejlbesked. Reconnect blokerer wake før første cleanup-await og ejer
  begrænset timeout/retry/rearm. Ingen prompt/schema/provider-semantik er ændret.
- **Review:** uafhængig adversarial reviewer `stop_review` har gennemgået adapter,
  faktisk C++-owner, upstream-kø/task/fence, error-oneshot og reconnect. Begge reconnect-
  findings er rettet med kausale regressioner; afsluttende P0=0/P1=0. Godkendelsen gælder
  diff-freeze/lokal releasegate, aldrig fysisk funktion eller installation.
- **Verificeret før freeze:** 17 fokuserede stop/orphan-regressioner bestået; `scripts/dev
  fast --base origin/main` grøn (38,9 s), herunder fuld testsuite, lint/format/typecheck.
  ESPHome 2026.6.2 config valideret og ESP32-build gennemført (204,33 s) med falske
  testcredentials. Alle 10 kompilerede C++-filer for owner/observers er byteidentiske
  med komponentcommit `7a81707e8b722fcd4e50203f0f47f6f0117e2725`. Stopmodellens manifest
  og TFLite SHA-256 håndhæves ved configvalidering. Modellen er trænet på engelsk;
  dansk udtale er ukendt indtil den fysiske matrix.
- **Gateafvigelser:** første fulde testsuite ramte sandboxens socketforbud; samme gate
  blev kørt med lokal socketadgang. En efterfølgende kørsel blev korrekt forkastet,
  fordi commit flyttede scopesnapshot under testen. Den næste uændrede fast-gate er
  grøn. Ingen runtimekode er ændret for at kompensere for disse workflowfejl.
- **Pakning/stopgrænse:** YAML peger nu på den ovenstående immutable komponentcommit.
  Automatisk godkendelsesreview afviste feature-push til GitHub pga. manglende eksplicit
  publiceringstilladelse. Commit findes derfor kun lokalt: frisk remote package-fetch
  kan endnu ikke valideres. Det kompilerede testbuild brugte byteidentisk lokal source;
  det beviser C++-kompilering, ikke den endelige remote-pakke. Push af feature-branch
  og efterfølgende configvalidering afventer brugerens godkendelse. Ingen merge,
  installation, fysisk golden chain, stoplatency eller 10/10 er udført.
- **Resultat:** én `scripts/dev release --base origin/main` er grøn på det frosne
  diff (39,1 s): 1008 tests, lint/format og mypy. Kun denne resultattekst er opdateret
  efter gaten. Exact-commit CI/ARM64-artifact er ikke kørt. Kandidaten er fortsat
  **ikke fysisk testklar**; remote package-fetch og alle fysiske gates er åbne.

## Aktiv lead-beslutning

### Aktiv beslutning 8. september — Hey Chat-kandidat (ikke testklar)

- **Lead:** Codex. Kandidatgrundlag er main `21c97fec67f3cb52cdc5111469fe6965ddc24365`
  (add-on 1.13.61 / firmware `podvoice_build_11346`) i `/private/tmp/podvoice-hey-chat`.
  Det ændrede practical-bassi-workspace og dets stop-/lydarbejde holdes urørt.
- **Observeret fejl:** UI tilbyder wake_word, men settings.DEFAULTS mangler feltet;
  save_settings ignorerer derfor valget. Firmware har kun tre almindelige modeller,
  og VoicePELink logger afsendt modelvalg som anvendt uden firmware-readback.
- **Hypotese:** Delt validering, en pinned fjerde model og korreleret firmware-readback
  kan bevare det gemte valg gennem genstart uden at foregive fysisk genkendelse.
- **Kæde/races:** Gem → config → native reconnect → modelvalg/readback → fysisk wake →
  eksisterende mic-latch/ThinSession → svar/opfølgning → teardown/rearm → næste wake.
  Initial state replay, delayed ACK efter reconnect, disconnect og gammel firmware
  må aldrig blive aktiveringsbevis. Stopmodellen beholder sin nuværende ejer.
- **Invarianter/ikke-mål:** Én firmware-wakevej, én ThinSession, half-duplex og
  lifecycle-invariant 10 (aktuel generations sandhed). Ingen prompt-, VAD-, gain-,
  følsomheds-, Assist-, stop- eller lydændringer. Brugerens eksplicitte featureplan
  afgrænser dette arbejde; ingen påstand om fysisk kvalitet.
- **Gates/rollback:** Settings/API, firmwaremodel/hash/render/compile, korreleret
  reconnect-readback, Thin/Talk/stopregressioner og browser mobil/desktop; fast,
  uafhængigt adversarial review og én release efter freeze. Hele Hey Chat-diffet
  rulles tilbage som ét add-on/firmware-par til ovenstående grundlag ved regression.
  Frisk golden chain, 10/10 lifecycle og Hey Chat-akustikgate er endnu IKKE kørt.

**Stop-the-line under review:** Uafhængig reviewer reproducerede en wake via
subscribe_states, mens settings-ACK stadig afventedes og link ikke var admitted.
Efterfølgende disconnect kunne derfor mangle Thin-linklost-kanten. Hypotesen udvides
kun ved adapterens adgangsgrænse: en ny wake må først leveres efter settings-ACK og
reconnect/rearm; eksisterende playback/teardown-events må stadig behandles. Hvert
state-abonnement får egen identitet, også ved reconnect på samme native klient, så
gamle callbacks ikke kan krydse næste forbindelse. Regression kræver pending-ACK wake,
disconnect/timeout, frisk admission og næste wake. Ingen fysisk test eller release
før fundet er løst og reviewet igen. Review fandt også stale browser-readback ved
mistet backend; visningen skal degraderes uden at vente på nyt room-snapshot.

**Anden reviewkant:** At afvise alle wakes før async admission er færdig kan tabe
en fysisk wake umiddelbart efter den eksakte rearm-ACK i samme native receive-batch.
Firmwaren har da allerede åbnet næste latch og mic. Den samlede grænse præciseres:
wakes før settings-ACK/rearm kasseres; højst én wake efter netop denne forbindelses
matching rearm-ACK beholdes indtil admission lykkes, og tabes ved disconnect/fejl.
Test skal injicere rearm-ACK → wake uden event-loop-yield, samt disconnect før
admission afsluttes. Lydkøen og audio-generation-grænsen må ikke ændres.

**Implementeret/foreløbigt verificeret:** Fire valgmuligheder, delt settings/config-
validering, pinned model, nonce-bundet readback, abonnementsspecifik stale-afvisning
og separat gemt/bekræftet panelstatus. De to reviewraces har permanente regressioner;
samlet målrettet suite er grøn. Bred `scripts/dev fast` bestod 42,8 s før den sidste
admissionrettelse; endeligt releasebevis skal dække det frosne diff. Browser med
shippede settings-markup/controller og API-fixtures bestod gem/genstart/400-fejl,
gammel/offline firmware, mistet backend og synligt fokus ved 320/390/1440 px.
Dette er ikke fuld HA-ingress/HA-app eller fysisk Voice PE-test.

ESPHome 2026.6.2 config og compile bestod (129,77 s). Buildrapport: statisk RAM
76.312/327.680 bytes (23,3 %), flash 3.046.475/8.126.464 (37,5 %). Runtime heap,
PSRAM og genkendelse er ikke målt. Reviewer kontrollerede de faktisk cachede
manifest-/TFLite-bytes mod registrerede SHA-256 og den genererede C++-modelliste:
fire almindelige modeller plus intern Stop; Hey Chat default disabled, cutoff
242/255, vindue 5, arena 30000. Manifestets feature-step er 10.

**Installationsblokering:** Kompileringen brugte en eksplicit compile-only testnøgle
i ignoreret secrets.yaml; disse binærer må IKKE flashes. Et reelt par kræver enhedens
korrekte eksisterende navn/Noise-nøgle, add-on-image og artifactidentitet. Lokal Docker-
daemon er ikke startet, så et add-on-image er endnu ikke bygget. Main blev genverificeret
som `21c97fec`; ingen push/merge, installation, golden chain, fysisk 10/10 eller
Hey Chat-akustikgate er udført. Kandidaten er fortsat ikke fysisk testklar.

**Review/freeze:** Uafhængig adversarial reviewer har genkontrolleret begge
admissionrettelser og stale UI; 27 fokuserede regressioner blev kørt uafhængigt.
Ingen uløste P0/P1 i det aktuelle diff. Produktionsdiffet fryses nu til én lokal
releasegate. Installations-/fysiske gates ovenfor forbliver åbne uanset resultatet.

**Releasegate:** Den ene frosne lokale release bestod på 27,7 s: candidate-scope,
Ruff/format, mypy, unit 17,71 s og integration 27,35 s. Ingen SafeEval, da prompt,
schema og Realtime-semantik er urørt. Ingen manuel gategenkørsel efter freeze.
Den eksisterende canonical `esphome/secrets.yaml` er siden fundet lokalt og bruges
nu uden nøgleoutput til et separat firmwarebuild; den første testnøgle-binær
erstattes og leveres ikke. Eksakt CI/ARM64-image og fysisk verification mangler.

**Lokalt handoff:** Implementationscommit `4ef2dec` på `codex/hey-chat` i
`/private/tmp/podvoice-hey-chat`; addon-version 1.13.62, firmwaremarkør
`podvoice_build_11363_stop1`. Firmwarebuild med den eksisterende canonical
Noise-konfiguration bestod på 16,43 s (statisk RAM 76.312 bytes, flash 3.046.547).
Det er endnu ikke live-verificeret, at den lokale nøgle/navnekonfiguration matcher
den aktuelt startede enhed. Secrets og binærer er ignorerede og må ikke pushes.

- OTA SHA-256: `bfdda9c7dd248ec8bf5a8a17cdcbf07ef67cb5a7deee9e9979dd6ca6dfe265a3`.
- Factory SHA-256: `4bbaa82362fa3b599fa6329190b9ec4e0c9ad8958ec8739baac4ce1654849ff1`.
- Add-on source-context SHA-256: `26ddbe312516c9ec7b23001900db506fb652ef3bf5d2d58066944c55c145e52b`.

Push til `https://github.com/BixelVentures/podvoice.git` blev afvist af automatisk
sikkerhedsreview, fordi eksportdestinationens autorisation ikke var tilstrækkeligt
etableret. Ingen push, PR, merge eller installation fandt sted. Næste handling kræver
godkendelse af denne konkrete GitHub-destination til branch/PR/ARM64-CI. Derefter
skal imageidentitet og live enhedsmatch verificeres før installation/fysisk test.
Der er ingen installation at rulle tilbage fra denne opgave; det tidligere par er urørt.


### Aktiv beslutning 5. september — Grundtestens skjulte knapper

- **Observeret fejl:** På installeret 1.13.59 var grundtest-run
  `82da65389ccb86aa487f7f87` startet, current_index 0, ingen resultater. En frisk
  ingress-side viste korrekt talepapir, men også slutkontrollens wake-knapper.
  `.crow { display:flex }` overstyrer browserens standardregel for `hidden`.
- **Hypotese og kæde:** API-run → eksisterende render/hidden → CSS → synlige
  bedømmelsesknapper. En scoped CSS-regel skal skjule kun grundtestens skjulte
  action-rækker. Reload skal genfinde serverens run uden at starte eller bedømme det.
- **Scope:** 1.13.61 bygger på main 27f2ea2 (1.13.60); kun panelvisning ændres.
  Runtime, prompt, tools, firmware, lyd, timeout og teardown/rearm er urørte.
  UI må ikke foregive fysisk godkendelse eller ændre lifecycle.
- **Bevisplan:** rød→grøn hidden-regression; rigtig browser med ikke-startet,
  igangværende, sidste wake, bestået og fejlet run samt reload; uafhængigt review,
  én releasegate og CI/image. Rollback er denne CSS-regel. Fysisk 10/10 er
  fortsat ikke bevist; paneltesten er ikke Voice PE-evidens.

**Implementeret og reviewet:** Kun én scoped CSS-regel ændrer produktadfærd.
Den nye unit-regression fejlede før rettelsen; browserkontrollen bestod alle fem
tilstande ved 320/1440 px både frisk og efter reload, uden writes eller JS-fejl.
Den kører de shippede CSS/markup/controller-dele isoleret, ikke fuld HA-ingress.
Uafhængigt adversarial review: P0=0/P1=0. Ruff, format og mypy bestod; lokal
fast-pytest blev ugyldiggjort af sandboxens forbud mod loopback-bind, ikke en
observeret produktfejl. Release køres med tilladt lokal testserver. Diff er frosset;
Lokal release bestod på 27,0 s: unit 16,68 s, integration 26,75 s, Ruff/format,
mypy og kandidat-scope grønne. Ingen separat lifecycle eller SafeEval: samtale-
og Realtime-kontrakten er uændret mod main. CI/image og installeret panel-smoke
mangler endnu.


### Aktiv beslutning 5. september — tilsluttet Spotify-konto og musikhandling

- **Brugerbeslutning:** Brugeren har eksplicit bedt om at fjerne den ekstra
  stemmegodkendelse for sin allerede tilsluttede Spotify-konto. Kun de tre
  statiske PodConnect-musiklæsninger klassificeres read-only. Spotify OAuth
  håndhæves stadig af HA; andre private data og risikohandlinger er uændrede.
- **Evidens på installeret v1.13.59:** 09:41 personlig musik bad om gentagen
  godkendelse og endte stale; 10:15 recently_played lykkedes efter approve_action.
  14:43–14:44 korrekt transskriberet afspilningsønske gav kun forslag og ingen tools.
  14:45 søgte HassMediaSearchAndPlay bogstaveligt efter kunstneren “Musik”.
- **Hypotese:** musik-kontrakten skelner utilstrækkeligt mellem afspilning,
  anbefaling og datalæsning. Ekstra lokal musikgodkendelse er eksplicit fravalgt af
  brugeren; dette er ikke en generel ophævelse af serverautorisation.
- **Kæde og invarianter:** fysisk input → Realtime med samme tools → completed
  tool commit → HA-musikdata → HA-play → svar → fysisk finish → teardown/rearm.
  Realtime beholder semantik; øvrige følsomme handlinger beholder eksakt engangs-
  godkendelse, næste-tur-grænse og TTL. Ingen model-, lyd-, firmware-, VAD- eller
  lifecycleændring. Ingen direkte Spotify-klient i PodVoice.
- **Faktisk kandidat 1.13.60:** tre eksakte Spotify-læsninger tillades direkte;
  prompten kræver musikhandling og fortsættelse efter datalæsning og undgår
  bogstavelig søgning på generisk “musik”. Tidligere gemt 1.13.59-standardprompt
  migreres via eksakt hash; brugerdefinerede prompts bevares.
- **Regressioner:** alle tre data-services gennem rigtig ToolRouter/HA REST-mock;
  private øvrige tools/lookalikes/destruktive beskrivelser er stadig beskyttet;
  eksakt gammel prompt migreres, custom prompt bevares. Aliasrettelsen leveres
  separat i PodConnect Speakers 0.26.1.
- **Gates og rollback:** målrettede tests bestået; samlet lokal releasegate bestået (unit/integration, mypy, Ruff).
  Uafhængigt review krævede promptmigration (nu implementeret). CI/ARM64,
  sideeffektfri semantisk prøve og fysisk musik/Connect-prøve mangler stadig.
  Isoleret add-on-delta kan rulles tilbage uden firmwareflash.
  Status: ikke installeret og endnu ikke fysisk verificeret.

### Aktiv beslutning 4. september — HA er eneste live-domænesandhed

- **Observeret fejl og stærkeste direkte evidens:** Den publicerede main-kandidat
  v1.13.57 (`cbd335f`) skiftede alene Realtime-reasoning til `medium`, men den seneste
  armerede fysiske kæde valgte fortsat det lokale `get_time` på ren matematik. Den
  samme friske session havde korrekt wake-, audio-, playback-, timeout-, teardown- og
  rearm-korrelation. `tools.py` eksponerer samtidig både lokal `get_time`, lokale
  in-memory-timere og HA's `GetDateTime`; den nuværende admission fjerner kun identiske
  navne og kan derfor sende semantisk overlappende ejere til modellen. Den konkrete
  årsagshypotese er, at blandet værktøjsejerskab gør et live-domæneværktøj til en
  konkurrerende forklaring på almindelig tale. Hypotesen falsificeres, hvis samme rene
  provider-PCM fortsat vælger HA `GetDateTime`, efter at lokale dubletter er væk.
- **Hele berørte kæde og invarianter:** Voice PE-lyd → én frisk Realtime-session →
  immutable tool-schema → modelbeslutning → completed, response-bundet dispatch →
  playback → samme follow-up-session → semantisk close eller fire sekunders reel
  stilhed → én teardown/rearm → frisk næste wake. HA er eneste ejer af tid, vejr, web,
  musik, hjem og senere timer; Realtime ejer betydning og værktøjsvalg; PodVoice ejer
  kun schema-admission, autorisation, dispatch og lifecyclemekanik. Ukendte eller
  semantisk konfliktende HA-værktøjer må aldrig glide automatisk ind i en ny session.
- **Én kandidat og eksplicitte ikke-mål:** v1.13.58 fjerner lokal `get_time` og lokale
  timere fra det model-synlige schema, accepterer kun en statisk klassificeret
  HA-værktøjsflade med `GetDateTime` og `google_web_sogning` som eneejere og binder den
  superviserede MCP-klient til `/api/mcp/assist`. Den samme kandidat gør kun det lokale
  test-/buildflow hurtigere uden produktionsadfærd. Firmware, LED, gain, VAD,
  audioformat, half-duplex, FLAC-playback, audio-boundaries, firesekunders-timeout,
  teardown, rearm og model er frosne. Reasoning fastholdes på aktuelle `main`-
  indstilling `medium`; Kandidat A ændrer derfor ikke modeltuning samtidig med
  værktøjsejerskabet.
  Vejrkonfiguration og HA-backed timere er efterfølgende separate kandidater.
  Den eksisterende statiske `podconnect.*` HA-serviceadapter til private musikdata
  bevares uændret; den er HA-ejet, allowlistet og indgår i det effektive schema-hash,
  men er ikke et dynamisk MCP-værktøj.
- **Regressioner, sammensatte gates og rollback:** Tool-inventory skal vise præcis én
  ejer for tid og web, ingen lokale timer, ingen ukendte modelværktøjer og et eksakt
  API-id/schema-hash. Matematik og numerisk opfølgning skal være direkte svar i samme
  session; kun tid må kalde `GetDateTime`; web må kun kalde `google_web_sogning`;
  HA-tab skal fail-closed uden stale dispatch. Completed/cancelled/stale batch-, Talk-
  og ThinSession-kontrakter genkøres. Derefter én sideeffektfri, prisbegrænset live-gate,
  exact-commit CI/ARM64 og én fysisk Golden Chain før 10/10. Hvis ren lyd stadig vælger
  `GetDateTime`, rulles der ikke videre med fraserouting; næste og eneste afgrænsede
  diagnose er en identisk-PCM-modelsammenligning. Hele tool-deltaet kan rulles tilbage
  uden firmwareflash.

- **Faktisk implementering og lokal status:** Kandidat A er implementeret som
  v1.13.58. Lokal `get_time` og model-synlige in-memory-timere er fjernet;
  `GetDateTime` og `google_web_sogning` har hver én HA-ejer via det eksakte
  `/api/mcp/assist`-endpoint. Sessionens værktøjsskema er immutable, og stale,
  dublerede, ufuldstændige eller ikke-committede tool-batches udfører ingen handling.
  Talk og Voice PE deler fortsat samme `ThinSession`-kontrakt. Reasoning er tilbageført
  til `medium`, så kandidaten ikke blander modeltuning ind i tool-deltaet.
  Candidate-scope består som ét domæne (`ha_tools`); kontrollen klassificerer nu kun
  de faktisk ændrede tekstfragmenter, så et uændret `end_conversation` på samme
  JSON-linje ikke giver en falsk semantikændring. Ruff, formattering, mypy,
  tool-/eval-/scope-tests, hele Thin-integrationen og de reelle konsol-WebSocket-tests
  er grønne. Den samlede releasekørsel fandt to forældede Talk-fixtures, der stadig
  brugte lokal `get_time` uden provider-commit; de er migreret til den samme
  committede `GetDateTime`-batch som produktionskontrakten, og hele den berørte
  integrationpakke er derefter grøn. Det adversariale review fandt P0=0; dets to
  P1-observationer er lukket:
  adapterpariteten er grøn, og candidate-scope håndhæves nu også af `release` mod den
  frosne merge-base. Den lokale releasegate er dermed grøn som én samlet, uændret
  kandidat efter den målrettede integrationgenkørsel. Exact-commit CI/ARM64,
  installation, SafeEval og fysisk Golden Chain mangler stadig og må ikke foregives
  som bestået.

- **Installeret artifact og identitetskorrektion:** v1.13.58 blev publiceret og
  installeret som git `b32b0958827e58f00f937e4a10b7b53a9e0d3311`. Startup beviste
  MCP API-id `assist`, 17 klassificerede HA-værktøjer uden konflikt og en gyldig
  Voice PE-firmwarekontrakt. Realtime-koden sendte `reasoning.effort: medium`, men
  startup-identiteten og changeloggen rapporterede fejlagtigt `low`. v1.13.59 retter
  kun denne observerbarheds-/dokumentationsfejl ved at dele én reasoning-konstant;
  provider-wire, værktøjer, prompt, audio og lifecycle er uændrede. SafeEval og fysisk
  Golden Chain afventer det korrigerede installerede artifact.

### Aktiv beslutning 4. september — fysisk semantik fejlede på frisk v1.13.56-session

- **Observeret fejl og stærkeste direkte evidens:** Den armerede fysiske trace
  `20260904T104120-439` kørte installeret add-on v1.13.56, rootfs
  `b35e4449ab9d2537fae324f4a40910d92c808e48679b3fa4471a11212ba84908`, Prompt V7,
  schema `f712a7c5e2a9` og firmware `podvoice_build_11346`. Wake oprettede den friske
  provider-conversation `conv_EKJm56rcQEKDZ4iMzSQRe`; gammelt sessionsindhold er
  derfor afkræftet for denne trace. Alligevel kaldte første tur `get_time` på det diagnostiske input
  “Hvad 12 gange syv?”, opfølgningen blev diagnosticeret som “Læs sjette”, og en tredje
  697 ms lydtur fik tomt transcript men et nyt kontekstbaseret svar. Samtalen lukkede
  korrekt ved `idle-fallback` med én teardown og én rearm. Numerisk replay blev
  fail-closed før providerbrug, fordi den diagnostiske tekst ikke matchede den kendte
  sikre eval-ytring.
- **Kæde, invarianter og falsificerbar hypotese:** fysisk wake → frisk Realtime-session
  → tre accepterede provider-VAD-ture i samme conversation → forkert semantik/tool →
  korrekt timeout/teardown/rearm. Realtime skal fortsat eje sprog, matematik,
  værktøjsvalg og uklar tale; PodVoice må ikke indføre transcript-veto, frase-routing
  eller lokal matematik. Hypotesen er, at `reasoning.effort: low` er utilstrækkeligt
  robust til den fysiske danske lyd med fuldt produktionsschema. Det er ikke bevist af
  én fejlende trace, fordi samme low-konfiguration tidligere har bestået. `medium` er
  derfor kun en A/B-kandidat, der falsificeres, hvis den ikke forbedrer korrekt direkte
  matematik, opfølgning og uklar-input-adfærd uden at ændre ownergrænsen.
- **Én kandidat og ikke-mål:** v1.13.57 ændrer kun Realtime reasoning fra `low` til
  `medium`. Prompt, schema, model, gain, VAD, noise reduction, turn cue, ekkohale,
  firmware, lydtransport, playback, firesekunders timeout, teardown og rearm er frosne.
  Den tredje lydtur kan være brugerens afslutning eller fysisk restlyd; uden segmentets
  gennemlytning må den ikke bruges til en timingpatch.
- **Regressioner, gates og rollback:** statisk wirekontrakt og fuld releasegate skal
  være grønne; uafhængigt adversarial review skal have P0=0/P1=0. Den igangsatte
  sideeffektfrie low-test forbliver diagnostik og må ikke blokere lokal udvikling ved
  lang rate-limit-ventetid. En installation af v1.13.57 må kun ske som diagnostisk
  kandidat, fordi HA-add-onen ejer Realtime-nøglen; ingen fysisk produkttest må starte,
  før kandidatens sideeffektfrie Golden-semantikgate på medium er 5/5 under $5-loftet.
  Derefter én armeret fysisk kæde: 12 x 7 → 84, “Læg seks til” → 90, semantisk
  close, én teardown/rearm og næste wake. Kun samme artifact kan derefter gå til 10/10.
  Rollback er hele reasoning-deltaet, hvis medium ikke forbedrer korrektheden eller øger
  median provider-first-audio mere end 300 ms.

**Beslutningsejer:** Lead Voice/Reliability Engineer. **Fysisk baseline:** v1.13.11.
**Installeret kandidat:** add-onen rapporterer v1.13.56 med runtime-rootfs
`b35e4449ab9d2537fae324f4a40910d92c808e48679b3fa4471a11212ba84908`.
Den armerede v1.13.56-trace `20260904T104120-439` er NO-GO for fysisk semantik som
beskrevet ovenfor. Den tidligere v1.13.55-trace `20260902T141043-607` bestod én Golden
Chain: 12 × 7 gav 84, “Læg seks til” gav 90 i samme provider-conversation og generation,
og “Tak, det var alt” gav præcis ét `end_conversation`, én teardown og én rearm.
Den efterfølgende tekst/lyd-sammenligning `eval-1788351114-20fddc` gav korrekt 90 uden
værktøj i 5/5 tekstkontroller og 5/5 replay af den eksakte provider-PCM. Rapportens
samlede NO-GO er dog ikke gyldig som provider-kædedom: oraklet kræver en indbyrdes
rækkefølge mellem to sideordnede start-events, som alle ti liveforsøg og den armerede
trace leverede modsat. Den separate diagnostiske ASR skrev samtidig “Klik seks til” i
5/5 lydforsøg. Device-/provider-sammenligningen viser efterfølgende, at hele signalet
nåede providerinputtet uforvansket; afvigelsen tilhører derfor den separate
diagnose-ASR og er ikke en Voice PE-transport- eller runtime-semantikfejl. Den bevares
synligt som en konservativ diagnostisk afvigelse. **Aktuel fysisk gate:** v1.13.56
Golden Chain **0/1**; ubrudte lifecycle-cyklusser **0/10**. Den tidligere v1.13.55-
succes arves ikke af kandidaten.

**Forrige diagnostiske kandidat:** v1.13.57 ændrede kun Realtime reasoning fra `low`
til `medium`. Den er ikke en bevist rettelse og har ingen aktiv kandidatstatus efter
beslutningen ovenfor. Firmware, gain, VAD, fysisk lydtransport, playback,
firesekunders timeout, teardown og rearm forbliver frosne i v1.13.58.

### Aktiv beslutning 2. september — Grundtesten skal måle den bindende 5+5-gate

- **Observeret fejl og stærkeste direkte evidens:** Panelets nuværende Grundtest beder
  om `Farvel` i alle ti samtaler, kræver tre input- og tre outputtranscripts samt blot
  en vilkårlig senere `IDLE`, og kan samlet bestå med 9/10 korrekte. Den måler derfor
  hverken de fem bindende firesekunders-timeouts, stille model-close eller den faktiske
  close-/teardown-/rearm-kæde i `docs/PRODUKTMÅL.md`.
- **Kæde, invarianter og hypotese:** Testbeviset skal følge det automatisk optagede,
  lokale device-/provider-/speaker-trace fra ét fysisk wake gennem to accepterede ture
  og deres provider-ejede svar/playback til enten én modelsemantisk close eller præcis
  `idle-fallback`, efterfulgt af én teardown og én korreleret rearm. Næste fysiske wake
  skal binde den lukkede trace til præcis den næste session og provider-generation.
  Hypotesen er alene, at Grundtestens UI og evaluator er forældede; produktionsruntime
  udførte den seneste armerede Golden Chain korrekt og må ikke ændres for at rette
  acceptværktøjet.
- **Mindste plan og eksplicitte ikke-mål:** De ti eksisterende to-turs-samtaler får fem
  varierede semantiske afslutninger og fem eksplicitte stilhedsforløb. Serveren måler
  den forventede close-type, accepterede fysiske ture, playback-finish, close-id,
  teardown og rearm i samme session; transcript bruges kun som synligt diagnosebevis.
  Kun 10/10 med præcis 5/5 i hver close-type kan bestå. Ingen ændring af `ThinSession`,
  Realtime-wire, prompt, schema, model, reasoning, VAD, firesekunders-timeout,
  firmware, gain, lydtransport, playback, teardown eller rearm er mål.
- **Regressioner, gates og rollback:** Bevis både kort og stille model-close samt
  `idle-fallback`; krydsede close-typer, ekstra tale under timeout, manglende/dobbelt
  close, manglende teardown/rearm, fremmed session og 9/10 skal afvises. Kør fokuseret
  web-/paneltest, lifecycle-gaten, uafhængigt adversarial review og én `release` på
  frosset diff. Hvis evaluatorens observering selv ændrer runtime eller en forkert
  close-type kan blive grøn, rulles hele Groundtest-deltaet tilbage.
- **Faktisk ændring og foreløbig status for v1.13.56:** Grundtesten armerer selv ét
  lokalt lydbevis for hver af de ti samtaler og for den afsluttende wake-kontrol. Det
  eksisterende strenge `TraceOracle` kontrollerer fysisk wake, accepteret lyd,
  provider-ejet response, playback, close, teardown, audio-boundary og rearm; en lille
  wrapper kontrollerer præcis 5 semantiske closes, 5 firesekunders timeouts og eksakt
  generation-/tokenkobling mellem samtalerne. Første fejl stopper runden, manuelle
  lydknapper kan ikke overtage recorderen, og afbrudte mobilrequests frigiver deres
  claim. De seneste 12 traces beholdes lokalt, så hele runden plus slutkontrollen kan
  efterprøves. `ThinSession` har kun fået passiv wake-/artifact-provenance i tracen;
  udgående Realtime-wire og produktadfærd er uændrede. Første adversarial review fandt
  tre falsk-grønne bevisveje: manglende generationsfelter, manglende komplet
  providerrespons og manglende speaker-spor. Alle tre er nu fail-closed og dækket af
  konkrete mutationer. En fjerde mutation kræver desuden konkret og ens
  audio-generation på slut-wake, wake-gate og forrige rearm. Den fokuserede gate er
  27/27 grøn, `scripts/dev fast` gennemførte formattering, Ruff, mypy og den valgte
  fulde testsuite på 43,8 sekunder, og den fulde lokale releasegate bestod på 43,7
  sekunder. Frozen Ultra-re-review er **GO med P0=0/P1=0** og bekræfter ingen ændring af
  Realtime-wire, prompt, VAD eller firmwareadfærd. Exact-commit CI/ARM64, installation
  og den fysiske 10/10 mangler fortsat. Fysisk status er derfor stadig Golden Chain 1/1
  og ubrudte lifecycle-cyklusser 0/10 på v1.13.55.

### Aktiv beslutning 2. september — eval-oraklet må afspejle providerens partielle orden

- **Observeret fejl og stærkeste direkte evidens:** Alle 5/5 tekst- og 5/5 lydsessioner
  har eksakte, sammenhængende conversation-, generation-, user-, assistant- og
  response-id'er samt completed-status. Den faktiske rækkefølge er konsekvent
  `user added → response.created → response.output_item.added → assistant item added →
  response.output_item.done → response.done`. Oraklet kræver fejlagtigt de to
  sideordnede item-start-events i omvendt rækkefølge og mærker derfor alle ti som
  `provider-item-chain-broken`. Den fokuserede fysiske lydsammenligning placerer
  opfølgningssegmentet fra providerfilens 4,45–5,45 s ved devicefilens 13,09–14,09 s
  med normaliseret korrelation 1,000 efter den kendte 16→24 kHz-konvertering. Det
  beviser, at transporten ikke forvanskede opfølgningen; det afgør ikke alene den
  separate ASR's ordvalg.
- **Kæde, invarianter og falsificerbar hypotese:** Beviset skal fortsat kræve
  `U1 → R1 → A1 → done → U2 → R2 → A2 → done` i samme conversation og generation,
  med eksakt ancestry, item-/response-id, rolle, type, status og nul ekstra response-
  eller tool-items. Hypotesen er kun, at `conversation.item.added` for assistant-itemet
  og `response.output_item.added` er to start-observationer uden dokumenteret indbyrdes
  totalorden; begge skal ligge efter `response.created` og før
  `response.output_item.done`. Den diagnostiske transcript-afvigelse er en separat
  inputbevisakse og må hverken omskrives til “Læg”, bruges til runtime-routing eller
  fejlagtigt klassificeres som tekst-/promptkontraktfejl.
- **Mindste plan og eksplicitte ikke-mål:** Ret kun evaluatorens eventorden og dens
  testfixture til den faktisk observerede rækkefølge. Bevar transcript-afvigelsen
  synlig og fail-closed, indtil den kan klassificeres med den bevarede lyd; ingen betalt
  provider-genkørsel er nødvendig for eventorden. Ingen ændring af `ThinSession`,
  Realtime-wire, prompt, tool-schema, model, reasoning, Voice PE, firmware, gain, VAD,
  resampling, playback, timeout, teardown eller rearm er mål.
- **Planlagte regressioner, gates og rollback:** Bevis begge lovlige rækkefølger af de
  to start-events. Afvis stadig manglende, stale, duplicate eller ekstra events samt
  enhver start-event før `response.created` eller efter `response.output_item.done`.
  Kør den fokuserede oracle-suite og `scripts/dev fast`; en uafhængig reviewer skal
  kontrollere, at ingen ID-, ancestry-, conversation-, generation- eller done-kant er
  svækket. Hvis en ugyldig mutation bliver grøn, rulles evaluatorændringen tilbage.
  Produktionsartifact v1.13.55 ændres eller geninstalleres ikke af denne
  evaluatorrettelse; næste produktbevis er 10/10 ubrudte fysiske cyklusser på samme
  installerede bits.
- **Faktisk evaluator-delta og resultater:** Oraklet kræver nu
  `user < response.created < begge item-start-events < output-item.done < response.done`
  uden at opfinde en indbyrdes orden mellem de to start-events. Den faktisk observerede
  orden var rød før rettelsen og er grøn bagefter; begge lovlige ordener består for
  både tekst- og lydtarget, mens hver start-event efter `output-item.done` fortsat
  afvises. Den fokuserede chain-suite er grøn **16/16**, og den samlede
  `scripts/dev fast --base origin/main` er grøn på **42,6 s** med Ruff,
  formatteringskontrol, mypy, hele pytest-suiten og diff-check. Uafhængigt afsluttende
  review fandt **P0=0, P1=0 og P2=0**. Ingen runtime-, prompt-, schema-, audio-, VAD-,
  firmware- eller lifecyclefil er ændret. Den ene autoritative
  `scripts/dev release --base origin/main` er grøn på **42,9 s**. Rettelsen er alene
  kilde-/evalværktøj; den installerede v1.13.55 skal ikke erstattes for dette delta.

### Aktiv beslutning 1. september — afvist VAD skal være terminal før næste mic-open

- **Observeret fejl og stærkeste direkte evidens:** Den installerede exact-v1.13.54-
  protokolprobe åbnede én `gpt-realtime-2.1`-session og fuldførte bootstrapresponsen. Efter
  forced commit, user-item og delete-ACK publicerede adapteren karantænen som opløst uden
  en terminal `speech_stopped`. Probe-fase 2 sendte derefter frisk PCM ind i providerens
  fortsat aktive VAD-spændvidde; derfor kom ingen ny `speech_started`. Efter den
  konfigurerede stilhed kom en legitim sen stopkant, men adapteren havde allerede
  slettet sin span og lukkede kl. 16:08:10 med `speech_stopped for unknown item`.
  Changed-ID er dokumenteret tilladt efter manuel commit, men live-start-ID'et blev ikke
  bevaret, så den eksakte ID-relation foregives ikke. De
  4,669 sekunder fra den forced-committede inputtransskription til fejlen matcher
  semantic-VAD plus probens friske stilhed. Proben stoppede korrekt som
  `provider-or-protocol-failure`; Golden Chain og 10/10 blev ikke åbnet.
- **Kæde, invarianter og falsificerbar hypotese:** crossed fysisk/provider-input under
  lukket answer-gate → nul response/tool/playback → provider-VAD skal bringes til én
  autoritativ terminal stopkant → hvert resulterende user-item skal slettes med eksakt
  ACK → først derefter må samme sessions `LOUNGE_WINDOW` åbne. OpenAIs officielle
  kontrakt siger, at manuel commit under aktiv VAD bryder start-/stop-item-id-ligheden;
  den siger ikke, at selve stopkanten kan foregives afsluttet. Hypotesen er derfor, at
  den eksisterende forced-commit-specialcase pensionerer spanen for tidligt og lader
  næste fysiske lyd blive dens hale.
- **Mindste plan og ikke-mål:** Erstat den falske forced-commit-terminal med én bounded,
  indholdsneutral nul-PCM-drænvej, mens den eksisterende fysiske state-gate er lukket.
  Provideren skal selv levere natural `speech_stopped`/commit/item; det eksakte afviste
  item slettes og ACKes, før karantænen opløses. Nul-PCM er protokolmekanik og må aldrig
  indeholde Voice PE-frames, skabe response/tool/playback eller åbne en ekstra session.
  Manglende terminal stop/commit/delete-ACK lukker samme session bounded fail-closed.
  Ingen firmware-, gain-, VAD-type/eagerness-, prompt-, model-, reasoning-, schema-,
  værktøjs-, playback-, timeout-, teardown-, rearm- eller lokal semantikændring er mål.
- **Planlagte regressioner, gates og rollback:** Den eksakte live-rækkefølge skal være
  rød før rettelsen og grøn bagefter: crossed start → nuldræn → natural stop → matching
  commit/item/delete-ACK → frisk start/stop i samme generation → præcis én korreleret
  response. Dæk stop før/efter commit, duplicate/stale/out-of-order events, manglende
  stop, fresh PCM før resolution, reconnect, Talk-paritet og trace-sandhed. Kør `fast`,
  relevant sammensat lifecycle, ét afsluttende `release` og uafhængigt adversarial
  review. Derefter ét PR/merge/install og én ny eksplicit prisgodkendt live-probe. Hvis
  natural terminal cleanup ikke kan bevises på rigtig provider uden fysisk mic-læk eller
  en ekstra session, rulles deltaet tilbage og crossed span lukker fail-closed; der
  tilføjes ingen ny timing-, gain-, prompt- eller fraseroutingpatch.
- **Faktisk kandidatdelta og lokale resultater:** v1.13.55 sender ikke længere manuel
  commit på en afvist aktiv VAD. Adapteren sender kun 20 ms nulrammer op til den
  konfigurationsafledte grænse og joiner den eksakte drain-task ved natural
  `speech_stopped`, før stop, item-sletning eller næste tur kan fortsætte. Manglende
  terminalkant, fremmed ID, duplicate stop/delete-ACK eller uordnet cleanup lukker
  fail-closed; duplicate matching commit/item er idempotente og kan ikke opløse
  karantænen tidligt.
  Proben tæller alle faktiske providerbytes, inklusive intern nul-PCM, og reserverer
  samme silence-bound i både karantæne- og friskfasen. Semantic VAD-grænserne er
  `high=2,25 s`, `auto/medium=4,25 s` og `low=8,25 s`; low-regressionen beviser 413
  20-ms-frames per fase og samlet 24,52 s maksimal providerlyd. En blokeret-send-
  regression beviser, at ingen append kan fuldføres efter stopbarrieren. Den målrettede
  owner/probe/adapter/lifecycle-suite er grøn **78/78**; ACK-watchdoggens tre tidligere
  fixed-sleep-tests er event-baserede og grønne **90/90** over 30 gentagelser. Den
  samlede `scripts/dev fast --base origin/main` er grøn på **43,2 s** med Ruff,
  format-check, mypy, hele pytest-suiten og diff-check. Firmware, gain, fysisk
  lydtransport, VAD-konfiguration, prompt, model, reasoning, schema, værktøjer,
  playback, timeout, teardown og rearm er fortsat byte-/adfærdsmæssigt uden for deltaet.
  Uafhængigt afsluttende Ultra-review fandt **P0=0, P1=0, P2=1** og gav GO til
  merge/install samt én ny prisgodkendt live-probe. Det ene P2 er kun diagnostisk:
  den fysiske trace gemmer allerede lokal karantæne, commit/delete, provider-PCM og
  offsets, men ikke de fire nye rå VAD-/nuldrænlabels. Det ændrer ingen gate og kan
  tilføjes i en senere ren observabilitetsrelease; v1.13.55 må ikke udvides for det.
  Den ene autoritative `scripts/dev release --base origin/main` er grøn på **43,0 s**
  med Ruff, format-check, mypy, hele pytest-suiten og diff-check. Exact-commit-CI,
  ARM64-image, merge, installation og den nye live-probe mangler fortsat.

### Aktiv beslutning 1. september — proben skal kunne startes uden browseromgåelse

- **Observeret fejl og stærkeste direkte evidens:** Den installerede v1.13.53 har den
  maskintestede, ingress-begrænsede `POST /api/eval/protocol-owner`, men panelet har
  ingen synlig kontrol, som kan sende den kanoniske prisbekræftelse. Efter brugerens
  eksplicitte `$5`-godkendelse afviste browserens URL-sikkerhed en scriptnavigation;
  proben blev derfor ikke startet, og intet API-budget blev brugt. Direkte LAN-adgang
  gav korrekt 403 og er ikke en tilladt triggervej.
- **Kæde, invarianter og hypotese:** bruger ser fast prisloft → eksplicit klik → præcis
  `application/json`-body `{"max_cost_usd":5}` gennem HA-ingress → eksisterende
  ingress-/framingkontrol → eksisterende eval-lock og højst én probe → eksisterende
  statuspoll. Hypotesen er alene, at en synlig knap over den allerede testede route
  lukker workflow-hullet. Browserbeskyttelse, ingresskrav, canonical body og
  sideeffektfri probe skal bevares.
- **Ikke-mål:** ingen ændring af `ThinSession`, Realtime-adapter, VAD, lyd, firmware,
  prompt, model, reasoning, schema, værktøjer, playback, timeout, teardown, rearm eller
  budgetberegning. Ingen skjult automatisk probe og ingen genbrug af en tidligere
  godkendelse.
- **Faktisk UI-delta og regressioner:** Panelet har præcis én synlig
  `Test sikker Realtime-svarstyring`-knap. Et fysisk klik låser alle evalknapper, sender
  den eksakte kanoniske body og genbruger den eksisterende `run_id`-poller samt
  generationssikre oplåsning. GO-visningen kræver exact
  `complete/ok/GO_TO_RELEASE_GATE/protocol-owner-proven`; alt andet vises som blokeret
  og siger fortsat, at fysisk Golden Chain og 10/10 mangler. Start→poll-integration,
  canonical body/content-type, single-trigger, busy, disabled-state og fail-closed
  rendering er grønne. Panel+probe er **66/66**, fokuseret web er **19/19**, og leadens
  fokustest er **21/21**. `scripts/dev fast --base origin/main` er grøn på **42,6 s**
  med Ruff, format-check, mypy, hele pytest-suiten og diff-check. Uafhængigt review af
  kode/UI fandt **P0=0, P1=0 og P2=0**; et efterfølgende dokumentreview fandt to P1-
  statusmodsigelser, som denne opdatering lukker uden produktionskodeændring. Første
  `release`-forsøg afslørede derefter en eksisterende test-race: `IDLE` publiceres
  bevidst før teardownens asynkrone attention-release og rearm, mens tre nye response-
  close-tests brugte `IDLE` som fuld slutbetingelse. Ingen runtime blev ændret; de tre
  tests venter nu også på eksakt rearm og bevarer assertions om præcis én release og én
  rearm. Den oprindelige måltest er grøn **50/50** i separate processer, og de tre
  naboer er grønne **60/60**; Ruff og format-check er grønne.
- **Releasegate, installeret resultat og rollback:** Den autoritative `release` var grøn
  på **42,4 s**. UI-deltaet blev merged som exact main
  `a026e9431b9efb801e3951fea5feae5103cf827b`; CI/ARM64-image blev grøn, og v1.13.54
  blev installeret. Det eksplicitte fysiske klik nåede den korrekte ingress-route med
  entydig framing og startede præcis én probe, så UI-scope er bevist. Proben fandt
  derefter en separat runtime-protokolfejl og stoppede blokeret; den åbner derfor ikke
  den fysiske canary. Hvis knappen kan starte uden et nyt fysisk klik, eller ingress-
  framing afviger, rulles UI-deltaet tilbage. Golden Chain og 10/10 er fortsat **0/1**
  og **0/10** og arves aldrig fra v1.13.53.

### Aktiv beslutning 1. september — kun accepteret fysisk tur må skabe providerrespons

- **Observeret fejl og stærkeste direkte evidens:** I exact v1.13.52-trace
  `20260901T101334-410` kom en ny provider-`speech_started` under `THINKING`. Thin
  registrerede `half_duplex_input_discarded` og sendte `input_audio_buffer.clear`, men
  providerens VAD-spændvidde forblev aktiv gennem fysisk playback. Efter mic-gaten igen
  åbnede, voksede provider-PCM-offsettet, og den forsinkede stop/commit-kant oprettede
  et nyt user-item og en automatisk respons med `get_time`. Der fandtes ingen ny
  accepteret lokal `speech_started`. Samme conversation og item-ancestry var intakte;
  dette er provider-turn-ejerskab, ikke mistet kontekst, audio-generation-replay,
  heartbeat, teardown eller rearm.
- **Hele berørte kæde og nærliggende races:** accepteret fysisk start → stop → provider-
  commit/user-item → ét svar → fysisk playback → ekkohale → åbent opfølgningsvindue.
  En start over den lukkede answer-gate skal derimod karantæneres, afsluttes og få sit
  eksakte item fjernet, før opfølgningen åbner. Nærliggende fejlveje er delayed/duplicate/
  stale start, stop, commit og delete-ACK; providerrespons uden lokalt request-id;
  tool-call fra en afvist respons; timeout eller semantic close under karantæne;
  reconnect og Talk/full-duplex-paritet.
- **Berørte invarianter, hypotese og ikke-mål:** én wake ejer én session; kun en
  accepteret tur må eje respons og værktøjer; Voice PE er half-duplex; Realtime ejer
  fortsat sprog, kontekst, værktøjsvalg og semantisk close; fire sekunders reel stilhed
  ejer kun mekanisk close. Den falsificerbare hypotese er, at
  `create_response: true` gør provideren til en konkurrerende response-owner, mens
  `input_audio_buffer.clear` fejlagtigt blev behandlet som VAD-reset. Ingen firmware-,
  gain-, VAD-type/eagerness-, prompt-, model-, reasoning-, schema-, playback-, timeout-,
  teardown-, rearm- eller lokal semantikændring er mål.
- **Faktisk implementeret kandidatdelta:** Voice PE beholder semantic VAD, men bruger
  `create_response: false` og `interrupt_response: false`. Providerens item-id,
  generation og commit bindes til den fysiske talespændvidde. Kun et accepteret stop
  efter matching commit må sende præcis ét korreleret `response.create`. En crossed
  start må aldrig svare eller kalde værktøjer; dens aktive buffer afsluttes, det eksakte
  item slettes med korreleret ACK, og opfølgningsgaten forbliver lukket indtil
  karantænen er tom. Én bounded input-span-ledger ejer commit-/item-/delete-ACK;
  `ThinSession` accepterer eller afviser turen, mens provideradapteren alene sender
  wire-eventet. Initiale og efterfølgende tool-/schema-/close-responses arver samme
  `(root_item_id, turn_id, provider_generation)` og et unikt request-id; numerisk
  metadata serialiseres som kanoniske decimale strenge efter providerkontrakten.
  Ukorreleret providerrespons, child-event eller cleanup-fejl lukker fail-closed. Talk
  beholder sin eksplicitte full-duplex-kontrakt og bruger samme response-owner-kontrakt.
- **Historiske lokale regressioner og review:** v1.13.53-regressionen kørte den rigtige
  OpenAI-adapter gennem `ThinSession`, men kodificerede den nu live-modbeviste antagelse,
  at forced commit + item + delete-ACK kunne afslutte VAD uden `speech_stopped`. Den var
  derfor grøn uden at bevise providerens terminale VAD-tilstand. v1.13.55 erstatter
  denne test med crossed start → bounded nuldræn → natural matching stop → eksakt
  commit/item/delete-ACK → frisk accepteret tur i samme generation → præcis én ny
  `response.create`, uden ghost tool eller playback.
  Dertil er accepted/rejected ownership, typed Talk, child/tool-responses, stale,
  duplicate, out-of-order, reconnect, timeout mod semantic close og trace-oraklet
  modtestet. Adversarial review fandt først P1-huller for forged response-start, stale
  child-events samt den officielle no-`speech_stopped`- og string-metadata-kontrakt;
  exact request/root/turn/generation-validering og regressioner lukkede hullerne. Den
  samlede provider-owner-/oracle-/probe-/Thin-suite er grøn **286/286**. Den skjulte
  ingress-rutes sikkerheds- og panelkontrakt er grøn **19/19**, og den isolerede
  protokolprobe er grøn **41/41**. Proben videresender og hasher den effektive aktive
  VAD-/noise-konfiguration, afviser ukendte eller uprissatte modeller før lock/socket
  og kan højst optage to lokalt budgetgodkendte responses under det faste $5-loft.
  `scripts/dev fast --base origin/main` er grøn på 41,9 s med Ruff, format-check,
  mypy, hele pytest-suiten og diff-check. Den smallere `lifecycle`-wrapper henviste som
  designet til `release`, fordi diffet også rører release-/dokumentationsflader; det er
  ikke en produkt- eller testfejl. Uafhængigt afsluttende Ultra-review af det frosne
  diff fandt **P0=0, P1=0 og P2=0**.
- **Live-resultat og resterende maskinelle gates:** Proben blev kørt på installeret
  v1.13.54 som `eval-1788271680-65640a`, brugte 171 tokens og estimeret `$0.009`, og
  stoppede ved en legitim sen `speech_stopped`, efter at den gamle regression allerede
  havde erklæret karantænen opløst. Resultatet er **NO-GO** og modbeviser manual commit
  som terminal. v1.13.55 skal derfor bevise `crossed start → bounded nuldræn → natural
  matching stop → exact item/delete-ACK → nul response → frisk tur i samme session →
  explicit response.create` mod rigtig provider. Den frosne v1.13.53-kandidat bestod den ene
  autoritative `scripts/dev release --base origin/main` på **42,5 s** med Ruff,
  format-check, mypy, hele pytest-suiten og diff-check. Den blev merged som exact main
  `3f548a222f487868552f5f2b7eba8047dcef0cda`; exact-commit-CI og ARM64-add-on-build
  blev grønne, og v1.13.53 blev installeret og startede med Voice PE samt HA/MCP.
  Proben kunne ikke startes legitimt fra det installerede panel, fordi triggerknappen
  manglede; derfor er v1.13.53 stadig **ikke provider- eller fysisk testklar** og
  supersedes kun af den UI-only v1.13.54. Den fokuserede semantiske 5×-preflight er
  ikke en erstatning for protokolproben og genkøres kun, hvis semantikscope eller ny
  ren fysisk evidens kræver den.
- **Fysisk gate og rollback:** Der køres ingen flere fysiske gentagelser på v1.13.52
  eller v1.13.54. Exact v1.13.55-artifact skal efter grøn installeret protokolprobe
  først bestå én
  armeret golden chain: 12 × 7 → 84;
  “Læg seks til” → 90 i samme session; “Tak, det var alt” → ét model-close; én teardown,
  én rearm og næste wake med frisk provider-generation. Derefter kræves 10/10 ubrudte
  cyklusser, fem med semantisk close og fem med fire sekunders reel stilhed. Hvis den
  officielle commit/delete-sekvens ikke kan bevises stabilt, må der ikke tilføjes
  timing-, gain- eller fraseplastre; crossed input skal i stedet lukke sessionen
  fail-closed. Den meget korte første tur med arabisk diagnosticering forbliver en
  separat ukendt wake-/audio-boundary-observation, som kræver gennemlytning af device-
  og providerlyd før enhver lyd- eller firmwareændring. Aktuel fysisk status for den
  aktive exact v1.13.54-kandidat er canary **0/1** og ubrudte cyklusser **0/10**; intet
  fysisk resultat arves fra v1.13.53.

### Historisk beslutning 1. september — idle-timeout må aldrig vinde over aktiv brugertale

- **Observeret fejl og stærkeste direkte evidens:** Trace `20260901T092200-847` åbnede
  opfølgningsgaten ved 7.253 ms, modtog et accepteret provider-`speech_started` ved
  8.098 ms og modtog intet `speech_stopped`/commit. Ved 13.127 ms lukkede ThinSession
  som `idle-fallback`; de 5.029 ms fra start til close matcher næste
  `HEARTBEAT_S=5.0`-tick. Teardown og korreleret rearm gennemførte rent. Dette beviser
  lokal timeoutfejl, men ikke hvorfor provider-VAD manglede stopkanten.
- **Hele kæden og nærliggende fejlveje:** fysisk followup-PCM → åben state-ejet mic-gate
  → provider-VAD-start → fortsat samme Realtime-session → enten matching VAD-stop og
  svar eller bounded fejl/close → teardown → rearm. Nærliggende races er start lige før
  idle-deadline, langsom `THINKING`/værktøjsrunde, half-duplex-input der straks ryddes,
  Talk/full-duplex `Interrupted`, duplicate/stale stop og teardown uden stopkant.
- **Berørte invarianter og falsificerbar hypotese:** Fire sekunders timeout betyder
  ubrudt stilhed i `LISTENING`/`LOUNGE_WINDOW`. Hypotesen er, at den eksisterende
  heartbeat forveksler “ingen ny provider-event” med stilhed, fordi den ikke gemmer en
  accepteret aktiv talespændvidde og ikke afgrænser idle-close til lyttestates. Et
  current start→stop-interval skal derfor overleve idle-deadlinen, mens ren stilhed
  fortsat lukker og den eksisterende max-session stadig er hård ydergrænse.
- **Ikke-mål:** ingen firmware-, gain-, VAD-, audio-, prompt-, model-, reasoning-,
  schema-, værktøjs-, playback-, teardown- eller rearmændring; ingen ny timer- eller
  lifecyclemotor og ingen lokal semantik.
- **Planlagte regressioner og gates:** reproducer fysisk
  `LOUNGE_WINDOW → speech_started → idle-deadline → speech_stopped`, deadline-racet,
  ren stilhed, langsom `THINKING`/værktøjsrunde, answer-gate-clear, Talk-paritet og
  reset ved wake/teardown. Trace-oraklet skal forstå det shippede `speech_started` og
  afvise close inde i et åbent start→stop-interval. Kør målrettet test, `fast`, én
  `lifecycle`, uafhængigt adversarial review og én `release`; ingen SafeEval, fordi
  Realtime-semantikken er uændret.
- **Rollback- og fysisk gate:** enhver ændring uden for timeout-owner/oracle/test/docs,
  enhver idle-close under aktiv tale eller manglende ren-stilhed-close stopper hele
  kandidaten. Efter exact-commit CI og installation kræves én frisk fysisk canary;
  først derefter må den tidligere 5+5-klassifikation eller 10/10 åbnes igen.
- **Faktisk v1.13.52-delta:** ThinSession gemmer én accepteret provider-VAD-spændvidde
  som mekanisk faktum, separat fra de fem produktstates. Talestart fjerner den aktuelle
  idle-deadline; matching stop rydder faktummet synkront efter Voice PE's mic-send-lock
  og går til `THINKING`. Idle-close kræver fortsat `LISTENING`/`LOUNGE_WINDOW`, ingen
  aktiv tale og en uændret udløbet deadline, som kun armeres ved wake, aktiv re-wake og
  fysisk followup-open. Provider-metadata kan ikke flytte den. Heartbeat-poll er 250 ms,
  så firesekundersvinduet har en bounded tolerance uden en ny timer. Trace-oraklet
  normaliserer shippet `speech_started` og afviser kun `idle-fallback` inde i åben tale;
  max-duration og explicit stop/error forbliver autoritative closere.
- **Faktiske fokuserede resultater og review:** Den eksakte feltsekvens, første tur,
  deadline-race bag mic-lock, ren stilhed, langsom THINKING/værktøjsrunde, provider-
  metadata, delayed/discarded start, max-session, Talk-paritet, 10 simulerede cyklusser
  og field-canary/oracle er grønne. Den uafhængige reviewer fandt først et P1-oraclehul,
  hvor legitime sikkerhedsclosere blev afvist; det er rettet med modtests. Refrosset
  slutreview er GO med P0=0, P1=0 og P2=0; reviewerens 242 fokuserede tests, Ruff,
  format, mypy og diff-check er grønne. `scripts/dev lifecycle` er korrekt ikke
  anvendelig på det samlede release-metadata-scope. Den stærkere autoritative
  `scripts/dev release --base origin/main` er grøn på 37,8 sekunder med Ruff, format,
  mypy, hele pytest-suiten og diff-check.
- **Efterfølgende fysisk status:** v1.13.52 blev siden merged, exact-main-bygget og
  installeret som dokumenteret øverst. Den fysiske trace `20260901T101334-410` gjorde
  kandidaten NO-GO på den senere response-owner-fejl og supersedede derfor denne
  historiske lokale godkendelse. Ingen bestået gate arves af v1.13.53.

### Historisk beslutning 30. august — bevis native Realtime-kontekst mod audiosemantik

- **Observeret fejl og stærkeste direkte evidens:** I den armerede trace
  `20260828T152317-683` svarede én provider-generation først 84 på tolv gange syv. På
  “Læg seks til.” henviste Realtime selv til 84, men fortolkede samtidig lydens seks som
  tres/uklart. En senere ikke-armeret prøve transskriberede diagnostisk “Med tallet seks
  oveni.”, mens Realtime svarede på “lyd 6”. Begge forløb brugte én lokal session; close,
  teardown og korreleret rearm var rene. Den diagnostiske transskription og Realtime-
  modellens direkte audioforståelse er separate processer og må ikke sidestilles.
- **Hele kæden og nærliggende fejlveje:** fysisk Voice PE-PCM → audio-generation →
  provider-user-item → response/conversation → assistant-item → fysisk playback →
  opfølgnings-user-item i samme provider-conversation. Nærliggende alternativer er
  forkert artifact/provenance, manglende provider-item-ancestry, schema-/promptkonflikt,
  native audiosemantik eller modelnondeterminisme. Mic-gate og stale transport åbnes kun
  igen, hvis en korreleret PCM-/generationstrace direkte placerer fejlen dér.
- **Berørte invarianter, hypotese og ikke-mål:** Realtime ejer fortsat sprog, matematik,
  kontekst og værktøjsvalg; PodVoice observerer kun mekanikken. Hypotesen er, at
  provider-konteksten består, mens den native model ikke stabilt fortolker den korte
  danske lyd. Ingen transcript-first vej, lokal semantik, frase-/matematikrouting,
  conversation-history replay, firmware-, gain-, VAD-, prompt-, reasoning-, schema-,
  lifecycle-, playback-, timeout- eller rearmændring er mål for denne kandidat.
- **Planlagte regressioner og sammensatte gates:** Observer alle provider-user- og
  assistant-items med conversation-, item-, response-, previous-item- og generation-id
  uden at ændre udgående wire eller gemme nyt indhold. Udvid exact PCM-replay med 1–5
  tekstkontroller og 1–5 audioforsøg under ét $5-loft, exact provenance og nul eksterne
  effekter. Dæk korrekt/brudt `U1 -> A1 -> U2`, duplicate/out-of-order/stale events,
  tool-items, Talk/typed og Voice PE/audio samt observer on/off-wireidentitet.
- **Stop og rollback:** En provenancefejl er BLOCKED, ikke produktevidens. Først en frisk
  exact trace og tekst/PCM-klassifikation må vælge næste ene adfærdsdelta. Enhver wire-,
  ACK-, dispatch-, latency-, playback- eller lifecycleændring fra observabiliteten
  ruller hele v1.13.51-deltaet tilbage. HA Green var 30. august ikke tilgængelig fra
  udviklingsmaskinen via Nabu Casa eller `homeassistant.local`, så live A/B og fysisk
  canary står åbne og må ikke foregives som resultater.
- **Faktisk v1.13.51-delta:** Providerobserveren er content-free, bounded og kun
  installeret i den ene eksplicit armerede samtale; den gendannes på normal teardown,
  connect-fejl og cancellation. Fysisk trace får version samt `rootfs-v1`-fingerprint,
  som bygges over den færdige runtime-rootfs inklusive base-runtime, installerede
  pakker, FLAC, modes og symlinks, men ikke foregiver at være en OCI-manifestdigest.
  Numerisk A/B kræver matching `rootfs-v1`, model, Prompt V7/hash, fuldt schemahash,
  room-context, turn-preset og OpenAI-noise før nogen providersocket åbnes. Begge ture
  kræver en komplet ordnet `U1 -> A1 -> U2 -> A2`-kæde med exact response/generation;
  tekst kræver request-ACK, lyd kræver audio-commit. Taloraklet afviser blandt andet
  184 som 84, 190 som 90, negation og modstridende tal. Sent transcript bevarer den
  allerede bundne ancestry; outputtekst og første lyd bindes til den afsluttede
  response; ukendt provider-usage stopper hele replayet fail-closed. Panelet kan kun
  vise grøn ved provenance-match og samtlige 5+5 beståede forsøg. Dockerfile er den
  eneste ændring uden for add-onens diagnostikkode: den skriver rootfs-fingerprintet
  ved build. Firmware og al frossen produktionsadfærd ovenfor er uændret.
- **Faktiske lokale resultater og review:** Den endelige målrettede suite har **509/509**
  grønne tests for evaluator, providerprotokol, audio trace, rootfs-identitet, Thin,
  Talk/panel og web. Ruff, formattering, mypy over 42 source-filer og diff-check er
  grønne. Første adversarial review fandt fire P1-huller i diagnosticeringen: sent
  transcript overskrev trace, ukendt usage kunne se gratis ud, modeloutput manglede
  responsebinding, og preset/noise manglede i provenance. Alle fire er rettet med
  falsificerende regressioner. Det første helt uafhængige slutreview fandt derefter to
  yderligere P1-huller: ekstra stale/duplicate/function-items kunne ligge ved siden af
  den forventede providerkæde, og en fejlet/cancelled eval-response uden usage kunne
  passere den normale terminalgren. Oraklet kræver nu den eksakte direkte-svarsekvens,
  og alle eval-terminalstatusser stopper på ukendt usage; de fire nye falsifikationer er
  grønne uden at ændre production-terminaladfærd. En tidligere fuld fast-gate på 1.094
  tests blev grøn på
  40,3 sekunder, men blev efterfulgt af disse rettelser og tæller derfor ikke som den
  endelige releasegate. Det endelige uafhængige review af det refrosne diff gav
  **GO med P0=0, P1=0 og P2=0**. Derefter bestod præcis én autoritativ
  `scripts/dev release --base origin/main`: Ruff, formattering, mypy og **1.113/1.113**
  tests grønne på **40,0 sekunder**. Exact-commit CI og ARM64-build står fortsat åbne.
- **Præcis kandidat- og fysisk status:** v1.13.51 er lokalt releasegodkendt, men endnu
  **ikke exact-commit-CI-godkendt, installeret, live-klassificeret eller fysisk golden**.
  Der findes endnu ingen frisk `rootfs-v1`-bundet Voice PE-trace, ingen betalt 5+5 A/B,
  ingen fysisk canary og ingen 10/10. HA Green er fortsat den eksterne grænse. Næste
  tilladte rækkefølge er PR/CI/ARM64 → én installation → frisk armeret trace → den
  sideeffektfrie 5+5-klassifikation. Først et
  `GO_TO_PHYSICAL_CANARY` åbner canary; alt andet stopper uden symptompatch.

### Historisk beslutning 28. august — timer-schema må ikke konkurrere med matematik

- **Observeret fejl og stærkeste direkte evidens:** Første tur blev transskriberet som
  “Hvad er tolv gange syv?”, svaret direkte uden værktøj og afspillet fysisk med
  `speech-stop -> audible = 1447 ms`. Opfølgningen blev korrekt transskriberet som
  “Læg seks til.” i samme provider-session, men modellen valgte `list_timers`; den
  ekstra værktøjsrunde gjorde `speech-stop -> audible = 3883 ms`. “Slut.” gav præcis ét
  `end_conversation`, én teardown og en korreleret rearm-ACK. Der blev ikke observeret
  et efterfølgende wake, så rearm-kontinuitet er fortsat ubevist.
- **Hele kæden og årsagsgrænsen:** Fysisk lyd → providertransskription → Realtime-
  kontekst → værktøjsvalg → værktøjsresultat → ekstra modelrespons → fysisk playback.
  Lydgrænsen leverede `[A, B]` som planlagt; fejlen opstod først ved Realtime-
  værktøjsvalget. Den oplevede “gamle samtale” må derfor ikke bruges som evidens for
  stale audio i denne trace.
- **Berørte invarianter og falsificerbar hypotese:** Realtime ejer fortsat matematik,
  opfølgning og værktøjsvalg. Timer-værktøjer må kun vælges ved en klar timerhensigt.
  Hypotesen er, at de brede beskrivelser af `set_timer`, `list_timers` og
  `cancel_timer` lader en kort numerisk opfølgning konkurrere med timerdomænet, selv om
  standardprompten allerede kræver direkte matematik uden værktøj.
- **Eksplicitte ikke-mål:** ingen lokal frase-, transcript- eller matematikrouting;
  ingen firmware-, gain-, VAD-, state-, mic-gate-, playback-, timeout-, teardown-,
  rearm-, HA/MCP- eller promptændring.
- **Planlagte regressioner, gates og rollback:** Præcisér kun timerdeklarationernes
  anvendelsesgrænse og test schemaet statisk. Kør derefter den eksisterende
  sideeffektfrie Realtime-sekvens mod hele produktionsværktøjskassen fem gange; kun den
  eksplicitte tidstur må kalde `get_time`, og ingen matematiktur må kalde timer- eller
  andre domæneværktøjer. Hårdt samlet prisloft er $5. En ulovlig tool-selection stopper
  kandidaten uden fysisk test. Rollback er hele schema-deltaet ved timerregression eller
  manglende forbedring; der må ikke tilføjes lokal semantik som plaster.
- **Faktisk v1.13.50-delta og lokal gate:** Kun beskrivelserne af `set_timer`,
  `list_timers` og `cancel_timer` er præciseret med den samme model-ejede grænse:
  seneste klare hensigt skal være en timerhandling; matematik og opfølgning til et
  ikke-timeremne er eksplicit uden for værktøjets formål. Standardprompten, dispatch og
  al mekanik er byteuændret. Den statiske schema-regression samt hele den hurtige gate
  med Ruff, formattering, mypy og fuldt testset er grøn på 38,9 sekunder.
- **Maskinel kandidatstatus:** Den fokuserede diagnose er nu én femturs-session med
  matematik → opfølgning → tid → ugedag → modelafslutning og kan køre fem friske
  sessioner under én samlet $5-grænse uden budgetprobe eller eksterne effekter. Tre
  positive timer-fixtures beviser samtidig `set_timer`, `list_timers` og `cancel_timer`
  mod de faktiske produktionsdeklarationer. Fast-gaten er grøn på 39,4 sekunder.
  Uafhængigt adversarial review genkørte den grøn på 38,7 sekunder og gav GO med
  P0=0/P1=0.
- **Resterende stop før installation/fysisk test:** Én releasegate på dette frosne diff,
  build/CI og installation mangler. Derefter skal den sideeffektfrie live-gate være 5/5
  på de installerede bits. Live-rapporten skal samtidig bevise den aktive prompt-
  identitet; en ukendt eller utilsigtet brugerdefineret prompt stopper kandidaten i
  stedet for at blive skjult af schemaændringen. Først derefter åbnes én fysisk canary;
  v1.13.50 er endnu ikke fysisk golden.

### Afsluttet beslutning 26. august — én state-ejet mic-gate per Realtime-tur

- **Observeret fejl og stærkeste direkte evidens:** Den armerede fysiske trace
  `20260826T154813-263` modtog først “Hvad er tolv gange syv?”, men Realtime valgte
  `get_time(fields=["weekday"])` og svarede “Det er onsdag”. Efter fysisk playback og
  echo-gate blev næste tur transskriberet som præcis samme matematikspørgsmål og gentog
  samme forkerte værktøjsrunde. Loggen viser til sidst én idle-teardown, to kørammer
  drænet ved rearm og en korreleret `recovered`-ACK. Lifecycle kom hjem; input-/tur-
  sandheden gjorde ikke.
- **Hele berørte kæde og nærliggende races:** fysisk audio-callback A kan være planlagt,
  men endnu ikke afviklet, når providerens `speech_stopped` afslutter tur A. Den
  eksisterende v1.13.48-generation skærer kun ved rearm og kan derfor ikke afvise en
  forsinket A-callback, der krydser THINKING/playback/echo-halen inden for samme
  Realtime-session. Den modsatte fejl er at skære ved wake og klippe same-breath-prefix,
  eller at åbne før fysisk playback-finish og sende højttalerekko som brugerlyd.
- **Berørte invarianter og falsificerbar hypotese:** Én wake ejer én Realtime-session;
  `State.LISTENING`/`LOUNGE_WINDOW` er de eneste fysiske mic-åbne states; alle øvrige
  states er mic-lukkede; hver forsinket callback fra en lukket audio-generation er
  inert; opfølgningen bevarer samme provider-generation. Hypotesen er, at én synkron
  audio-boundary ved `speech_stopped`, én ny boundary lige før opfølgningsgaten åbner og
  den eksisterende rearm-boundary giver providerinput `[A, B]` i stedet for `[A, A]`.
- **Eksplicitte ikke-mål:** ingen firmware-, gain-, VAD-, prompt-, reasoning-, tool-,
  playback-, HA/MCP-, Talk-semantik- eller lokal frase-/transcriptændring. Realtime ejer
  fortsat matematik, værktøjsvalg og `end_conversation`. Den fejlagtige `get_time` må
  ikke patches lokalt, før ren transport er bevist.
- **Bindende firesekunders produktkrav:** Planen ændrer samtidig den gemte/default
  opfølgnings-timeout fra otte til fire sekunder og UI-minimum fra fem til tre. Det er
  en eksplicit produktbeslutning, ikke en forklaring på stale-audio-fejlen og ikke en
  modelbeslutning. Regressionen skal bevise default/config/UI-værdien samt mekanisk
  close efter fire sekunders fysisk stilhed; den fysiske canary skal stadig nå en normal
  opfølgning inden for vinduet. Hvis den eksakte kandidat klipper en rettidig
  opfølgning, er kandidaten NO-GO og boundary-deltaet må ikke bortforklare timingfejlen.
- **Planlagte regressioner, gates og rollback:** Registreret native callback A skal
  kunne forsinkes over `speech_stopped` og blive afvist; callbacks under playback skal
  afvises efter opfølgningsboundary; umiddelbar frisk B efter åbning skal bevares én
  gang. Dæk queue-full, reconnect, duplicate playback-finish, samtidig timeout/close og
  Talk-paritet. Kør fokussuite, 30/30 sammensat lifecycle, fuld releasegate, uafhængigt
  adversarial review og én exact fysisk canary. Rollback er hele mic-/audio-boundary-
  deltaet ved klippet same-breath, død opfølgning, ekstra provider-session, LED/state-
  divergens eller teardown/rearm-regression. En gentaget stale/replay-fejl stopper
  videre symptompatching og udløser særskilt plan for at erstatte kun Thin-
  orkestreringen.
- **Faktisk v1.13.49-delta:** `VoicePELink.cut_audio_boundary(reason)` øger den allerede
  eksisterende callback-generation synkront og dræner køen. `ThinSession` bruger de fem
  eksisterende states som eneste Voice PE-mic-gate og skærer kun på første gyldige
  `speech_stopped`, efter current playback-lease/epoch er valideret ved ekkohalens slut,
  og gennem den eksisterende korrelerede rearm-ACK. En gammel ekkohale-task valideres
  før den må røre køen. Wake skærer aldrig. LED følger samme kæde; ufuldstændig fysisk
  teardown forbliver rød i stedet for falsk mørk readiness. Ingen `esphome/**`, firmware-
  ABI, gain, VAD, kanal, prompt, reasoning eller værktøjskontrakt er ændret.
- **Maskinelle resultater på den frosne kandidat:** Den eksakte callback
  A→boundary→B-regression, blocked provider-send ved speech-stop, samme-session
  math/follow-up-isolation, gammel echo-tail efter nyt wake, Talk A→B stop/truncate-
  races, Talk-transportfejl, LED/reconnect/fault, målrettet v10→v11-timeoutmigration,
  firmwarekontrakt og fail-closed trace-oracle er grønne. Hele releasegaten med Ruff,
  formattering, mypy og fuldt unit-/integrationstestsæt bestod på 38,8 sekunder.
  Uafhængigt adversarial lifecycle-review og separat firmware/LED/single-truth-review
  gav begge **GO med P0=0 og P1=0**. Exact-commit CI og ARM64-image står fortsat åbne
  efter commit; dette er maskinel testklarhed, ikke fysisk godkendelse.
- **Fysisk status:** **IKKE TESTET**. v1.13.49 er ikke golden, ikke 10/10 og ikke
  97/100, før exact artifact er installeret og den bindende canary plus ubrudte fysiske
  cyklusser er gennemført.

## Historisk evidens- og beslutningslog — udelukkende baggrund

Alt nedenfor bevares som årsags-, regressions- og rollback-evidens. Historiske ord som
“skal”, versionsplaner og kandidater er ikke længere aktive beslutninger og må aldrig
tilsidesætte den aktuelle v1.13.51-beslutning ovenfor, `docs/INVARIANTER.md`,
`docs/PRODUKTMÅL.md` eller `docs/ARKITEKTUR.md`.

### Historisk beslutning 26. august — sen gammel mic-frame krydsede næste wake

- **Observeret fejl og stærkeste direkte evidens:** På installeret exact v1.13.47 sagde
  brugeren “Okay Nabu, hvad er tolv gange syv?”. Tracens første provider-VAD-turn varede
  kun 276 ms, men blev transskriberet som hele den tidligere ytring “Hvad er klokken?” og
  udløste `get_time`. En senere rigtig ytring blev korrekt transskriberet som “Hvad er
  syv gange tolv?”, og “Læg seks til” blev også korrekt transskriberet, men kaldte
  fejlagtigt `end_conversation`. Device-, provider- og speakerlyd er gemt samlet som
  `20260826T145627-246`. En 276 ms turn kan ikke være den rapporterede fulde sætning;
  kandidaten er fysisk NO-GO.
- **Hele berørte kæde og nærliggende race:** samtale A → firmware
  `podvoice_stream_stop` køes → add-on dræner `_audio_q` → allerede in-flight native-
  API-audiocallback fra A ankommer efter drain → rearm → wake B → start bevarer med
  vilje same-breath-frames → A-frame bliver første lyd på den friske providersocket.
  Den nærliggende modsatte fejl er at dræne ved wake og derved klippe B's første ord.
  Providerens forurenede kontekst kan påvirke senere værktøjsvalg, men falsk semantic
  close skal måles særskilt efter ren lydtransport.
- **Berørte invarianter, hypotese og ikke-mål:** lyd fra generation A må aldrig nå B;
  samme-breath-input fra B må ikke mistes; én wake ejer én provider-generation; Realtime
  ejer fortsat betydning og `end_conversation`. Den falsificerbare hypotese er, at
  service-send + øjeblikkelig kødrain ikke udgør en transportbarriere, så en sen callback
  efter drain overlever til næste wake. Ingen gain-, VAD-, prompt-, tool-description-,
  playback-, budget- eller lokal semantikændring er mål.
- **Planlagte regressioner og rollback:** gengiv close A → drain → forsinket A-frame →
  rearm → wake B og kræv nul A-bytes på B's provider, samtidig med at B's 320 ms
  same-breath-prefix bevares. Dæk duplicate/failed stop, reconnect og Talk-paritet.
  Rettelsen skal ligge ved den mekaniske stop/rearm-generationsgrænse og må ikke være en
  tidsbaseret sleep. Rollback er hele grænseændringen ved mistet B-prefix, dead mic,
  ekstra stream/socket eller rearm uden fuld teardown. Først rød→grøn regression,
  relevant adapter/Thin-gate, adversarial review, fuld gate, exact install og én ny
  armeret fysisk canary kan åbne testen igen.
- **Faktisk kandidat v1.13.48:** den registrerede native audio-callback fanger en
  monoton audio-generation synkront, før aioesphomeapi planlægger dens coroutine. Kun
  den eksakte aktive `recovered`-ACK avancerer generationen og dræner køen, før Thin
  fortsætter. En forsinket A-callback bliver derfor inert; umiddelbar B-audio efter ACK
  bevares. Wrong/fault/duplicate ACK og drainfejl forbliver fail-closed. Firmware,
  ThinSession, Talk, Realtime-semantik, prompt, VAD, gain og playback er uændrede.
- **Maskinbevis og review:** callback-regressionerne går gennem de faktisk registrerede
  old/new native subscriptions og dækker fault→retry, reconnect, forsinket A og
  umiddelbar B. 191 relevante Voice PE/Thin/Talk-tests er grønne; fuld releasegate er
  grøn på 37,1 sekunder. Uafhængigt adversarial review gav GO med P0=0/P1=0. To
  eksisterende teardown-tests venter nu på det cleanup-resultat, de påstår at bevise,
  i stedet for et tidligere mellemstadie; det fjerner en observeret test-race uden at
  ændre runtime.
- **Præcis fysisk status:** v1.13.48 er maskinelt testklar, men ikke fysisk bevist og
  ikke golden. Næste og eneste feltgate er exact image/install og én armeret canary,
  der beviser ren første ytring, samme-session-opfølgning, model-close, én teardown,
  rearm og næste wake. Audio, der først dekodes efter ACK, kan kun afvises eller
  bekræftes af denne fysiske trace.

### Historisk installationsbeslutning — selvstændig ESPHome-kilde

- **Observeret fejl og stærkeste evidens:** HA's ESPHome Builder kan hente
  `esphome/podvoice.yaml` fra GitHub, men den shippede `external_components`-blok peger
  stadig på den lokale mappe `components`. En frisk HA-konfiguration fejler derfor med
  `Could not find directory '/config/esphome/components'`, før firmware kan kompileres
  eller flashes.
- **Berørt kæde og invarianter:** katalogopdatering → eksakt add-on-version → GitHub-
  firmwarepakke → ekstern `podvoice_audio`-komponent → ESPHome render/compile → USB-
  flash → reboot → automatisk native-API handshake og eksakt firmwarekontrakt. Runtime,
  lyd, VAD, gain, playback, teardown og rearm må være byteidentiske.
- **Falsificerbar hypotese og ikke-mål:** den lokale udviklerkilde er den eneste årsag;
  skift til ESPHomes Git-kilde på samme repo, den immutable v1.13.44-commit
  `385b71c4f1d3285f130390d8735849268427add3` og den eksplicitte sti
  `esphome/components` skal gøre en ren HA-build mulig uden kopierede filer. Der ændres
  ingen firmwareadfærd, secrets, prompt eller lifecycle.
- **Gate og rollback:** ren remote-package config/compile skal finde præcis
  `esphome/components/podvoice_audio`; diffet må kun ændre kildeleveringen, og en
  uafhængig reviewer skal kontrollere repo-layout, refresh/ref og rekursion. Rollback er
  hele kildeændringen ved ændret renderet firmware eller manglende komponent.
- **Historisk resultat:** en helt ny ESPHome 2026.6.2-workdir renderer den pinnede Git-
  komponent grønt, og den statiske regression afviser igen en aktiv lokal kilde.
  Uafhængigt adversarial review bekræfter ESPHomes `esphome/components`-opslag, ingen
  rekursion og korrekt komponentafgrænsning; den oprindelige mutable `main`-reference
  blev afvist og erstattet af immutable commit og eksplicit sti. HA Green byggede den
  pinnede produktionskonfiguration med ESPHome 2026.7.4. Factory-binaryens SHA-256 er
  `45351a57cd215ded3fee3e270215b156c6d873f5982211db4c6dfd42db78f306`; før flash blev
  den kontrolleret for `podvoice_reply_play`, `podvoice_reply_silence`,
  `correlated_reset_rearm_v2`, `correlated_playback_v2` og `podvoice_build_11344`.
  USB-flash til ESP32-S3 fuldførte med dataverifikation og hardware-reset. Uden add-on-
  genstart genfandt PodVoice derefter enheden via `.local`, gennemførte Noise-handshake,
  godkendte den eksakte firmwarekontrakt, anvendte mic channel 1/gain 16 og wake word
  `okay_nabu`. Loggen står nu på “wake detector recovered; awaiting first physical
  proof”. Det beviser installation og automatisk reconnect, ikke golden chain eller
  næste fysiske re-wake efter en afsluttet samtale.

### Frisk fysisk evidens 26. august — v1.13.44 NO-GO

- Tre fysiske wakes kl. 11.03.30, 11.03.58 og 11.04.23 åbnede hver en ny session og
  leverede mic-frames. De to første hørte “Hvad er tolv gange syv?” korrekt og
  afspillede svar fysisk. Brugeren forsøgte samtidig at hæve lydstyrken med puckens
  drejehjul. v1.13.44's private `podvoice_reply_player` er den nye ejer af Nabu-svar,
  mens firmware-scriptet `control_volume` fortsat kun ændrer `external_media_player`;
  fysisk svarlydstyrke og drejehjul har dermed ikke længere én dokumenteret ejer.
- Den konfigurerede firesekunders stilhedslukker udløste efter svarenes fysiske drain,
  før opfølgningen blev afleveret. Stilhedslukningen er ikke ændret i v1.13.43/44, men
  brugerens lydstyrkehandling gjorde vinduet praktisk utilstrækkeligt i denne prøve.
- Tredje wake blev delt af Realtime til “Ja.” og derefter “Hvad er klokken?”. Det første
  fragment havde allerede skabt en aktiv respons, så det andet udløste providerfejlen
  `conversation_already_has_active_response`. Det er en half-duplex/turn-boundary-fejl,
  ikke manglende mic-transport.
- Efter close kl. 11.04.40 meldte firmware igen `wake detector recovered; awaiting first
  physical proof`, men brugerens efterfølgende wake gav ingen `wake signal`. To tidligere
  re-wakes i samme forløb gør fejlen intermittent; de kan ikke godkende den tredje.
  Kandidaten forbliver NO-GO. Næste ændring skal forklare både rotary→privat reply-volume
  og den eksakte tredje teardown→reset→detector-eventkæde; gain, VAD, prompt og værktøjs-
  semantik må ikke tunes for at maskere dem.

### Historisk beslutning 26. august — bevar v1.13.43-adfærd og stop blandede kandidater

- **Beslutningsejer og eksakt baseline:** Lead Voice/Reliability Engineer. Den sidste
  kodebaseline før v1.13.44's private playback er v1.13.43 commit
  `8d4fc9cd521f564a6205359f610ba2761284fc74`. Den ejer rollback-sandheden for
  drejehjul → `external_media_player`, samme-session-opfølgning og 1.13.43's korrelerede
  rearm-reset. En erindret samtale eller et versionsnummer alene er ikke rollbackbevis.
- **Observeret procesfejl:** exact diff v1.13.43→v1.13.44 ændrede i én kandidat mindst
  provider/Realtimes terminale events, fysisk playbacktopologi og rearmens
  silence/drain-grænse. Den uafhængige forudgående review advarede specifikt om, at den
  private `podvoice_reply_player` var bredere og mere risikabel end den eksisterende
  `external_media_player`-vej. Maskingaten var grøn, men havde ingen fysisk rotary-
  regression. Det er en gatefejl, ikke acceptabel feltvarians.
- **Berørte invarianter og kæde:** fysisk rotary/master-volume → aktiv Nabu-player →
  fysisk reply start/drain → fuldt firesekunders opfølgningsvindue → samme Realtime-
  session → semantic close → én teardown → privat/public player silence → detector-
  reset → næste ægte wake. Playback-ejerskab må ikke kunne arves af fremmed HA-lyd, og
  rearm må ikke godkendes af `recovered` alene.
- **Falsificerbare hypoteser:** (1) volume-regressionen skyldes, at basefirmwarens
  `control_volume` kun muterer `external_media_player`, mens v1.13.44 afspiller Nabu på
  `podvoice_reply_player`; en fælles fysisk master-volume eller en eksakt tilbageførsel
  til 1.13.43-playeren skal få rotary-canary til at bestå. (2) Den intermittente tredje
  re-wake ligger efter v1.13.44's nye private-player drain eller i det uændrede
  stop/start-reset; kun en korreleret firmwaretrace må vælge mellem dem.
- **Én-delta-regel og rollback:** første kandidat må kun ændre playback/volume og skal
  enten bevare den private tokenkæde med reel rotary-paritet eller tilbageføre hele
  1.13.44-playbackdelen til exact v1.13.43. Den må ikke samtidig ændre rearm, VAD, gain,
  prompt, Realtime eller idle-timeout. En separat senere kandidat må kun ændre rearm.
  Hvis privat playback ikke kan bevise rotary, opfølgning og fremmed-HA-isolation i én
  kort canary, er rollback-grænsen exact 1.13.43-playback — ikke et hybridt mellemtrin.
- **Nye procesgates:** `scripts/candidate_scope.py` afviser flere uafhængige
  produktionsdomæner eller produktionskode uden en ændret regression. Den strikte
  `scripts/field_canary.py` kræver mindst fire fysiske ture, model-close, korrekt
  teardown/playback, et fysisk afsluttet svar før hver almindelig opfølgning, næste
  wake + frisk provider-session samt et eksplicit fysisk rotary-bevis. Ti fokustests
  er grønne; disse værktøjer ændrer ingen runtime.
  Udvikling og gates flyttes til en lokal usynkroniseret clone: samme exact diff tager
  ca. 0,02 s dér mod timeout over 20 s i Documents-worktreet.
- **Faktisk kandidat v1.13.45:** den private token-isolerede player beholdes, men får
  v1.13.43's eksakte volume-interval og increment. Hver ændring fra det fysiske
  drejehjuls `external_media_player` spejles til den private player; LED-callbacken,
  som `!extend` ellers ville erstatte, bevares eksplicit. Ved reply-start udføres volume
  og media-URL i to separate ESPHome-calls, fordi componentens URL-gren returnerer før
  volume ellers anvendes. Rearm, idle-timeout, VAD, gain, Realtime og lifecycle er
  uændrede.
- **Faktiske maskinresultater og review:** kandidat-scope klassificerer kun
  `physical_output` og består. 80 fokuserede kontrakt-/proces-tests er grønne;
  ESPHome-konfigurationen validerer mod de immutable components; hele releasepakken
  inklusive lint, format, mypy og test-suite er grøn på 42,2 sekunder i den lokale
  clone. Den uafhængige adversarial reviewer fandt først den ugyldige kombinerede
  volume+URL-call; efter opsplitning og ny regression gav samme reviewer GO uden
  P0/P1-findings.
- **Installeret kandidat og kontraktbevis:** main commit
  `672fbb02f9dcfdaa841609a336529fd7885ab8b9` er installeret som add-on v1.13.45 og
  OTA-flashet på Voice PE. Den 26. august kl. 12:07:59 annoncerede den genstartede puck
  `podvoice_build_11345`; add-on'en accepterede firmwarekontrakten, anvendte mic
  channel 1/gain 16 og satte wake word til `okay_nabu`. HA/MCP var samtidig forbundet
  med 19 værktøjer. Dette beviser kandidatidentitet og maskinel readiness, ikke fysisk
  samtaleadfærd.
- **Resterende usikkerhed og fysisk gate:** v1.13.45 er fortsat fysisk ubevist og derfor
  NO-GO som release. Én kort canary skal bevise dial under aktivt svar, mindst tre
  almindelige svar med samme-session-opfølgning, model-close, præcis teardown og næste
  ægte wake/friske session. Hvis den fejler rotary eller opfølgning, tilbageføres hele
  playbackdelen til exact v1.13.43; rearmfejlen må først ændres i en separat kandidat
  efter korreleret fysisk trace.
- **Fysisk canary-resultat 26. august ca. 12:20 — NO-GO og rollback udløst:** drejehjulet
  ændrede lydstyrken under Nabus svar, så v1.13.45 beviser rotary-paritet. Samme-session-
  opfølgningen fejlede derimod: efter det korrekte svar på »Hvad er tolv gange syv?«
  absorberede echo-shield 382 mic-frames frem til 12:21:07, men »læg 6 til« producerede
  hverken provider-`speech_started` eller transcript. Den lokale femsekunders
  idle-fallback lukkede først kl. 12:21:13; Realtime kaldte ikke `end_conversation`.
  En ny wake kl. 12:21:29 åbnede en frisk session og svarede, så dette spor beviser
  hverken semantisk fejllukning eller manglende efterfølgende rearm. Den falsificerbare
  årsag er den v1.13.44-introducerede private playbacktopologi/echo-gate-grænse, som
  v1.13.45 beholdt. I henhold til den forhåndsdefinerede rollback-grænse tilbageføres
  nu hele playbackdelen til exact v1.13.43; der laves ikke endnu en lokal timinghybrid.
- **Lead-beslutning efter canary og adversarial review:** den delvise playback-rollback
  er erstattet af en fuld restore af den Voice PE-relevante produktionsruntime til
  exact v1.13.43. Det omfatter firmware, `VoicePELink`, `ThinSession`, Realtime-
  integration, runtime-config og deres kontrakttests. Kun den fjernede parallelle
  simulator, immutable component-pin samt test/trace/buildinfrastruktur afviger; de
  ændrer ikke den fysiske samtalevej. Rearm optimeres først som et separat delta efter
  en frisk fysisk baseline.
- **Faktisk kandidat v1.13.46 og maskinbevis:** version/build-id er alene løftet til
  `1.13.46`/`podvoice_build_11346`, så installerede restore-bits kan bevises. Fokuseret
  firmware/VoicePE/Thin/Talk-gate er grøn, lifecycle-manifestets 259 tests er grønne,
  hele releasegaten er grøn på 36,7 sekunder, og ESPHome-konfigurationen validerer mod
  de immutable kilder. Den generelle
  single-domain-scope-gate klassificerer bevidst restore-diffet som tre domæner; det er
  ikke en ny blandet featurekandidat, men en eksplicit total rollback godkendt af lead
  og underlagt uafhængigt diff-review.
- **Præcis gate-status:** v1.13.46 er ikke fysisk bevist, ikke golden og ikke release-
  godkendt. Næste gate er exact-commit CI/image, installation og én frisk fysisk kæde,
  som også beviser auto-connect og ny wake efter rearm. Først derefter laves en isoleret
  rearm-kandidat; når golden chain, rearm og auto-connect er bevist på samme bits,
  etableres 1.14-linjen og 10/10 ubrudte fysiske cyklusser køres.

### Historisk beslutning 26. august — næste wake blev falsk afvist af fast 15k-reservation

- **Observeret fejl og stærkeste direkte evidens:** Den installerede exact v1.13.46-
  kæde gennemførte fem Realtime-responskanter i samme session. Providertranscriptet
  indeholdt ordret `Læg seks til.`, modellen kaldte `end_conversation` på `Tak, det var
  alt.`, fysisk farvel blev afspillet, og én teardown/rearm sluttede kl. 13.46.30. En ny
  fysisk wake kl. 13.46.33 blev registreret med `active=False`, åbnede en ny lokal
  samtalegeneration og blev derefter afvist **før providersocket** med
  `rate_limit_capacity · provider token capacity is insufficient for a voice session`.
  Samme lokale afvisning gentog sig kl. 13.46.46. Det beviser rearm og næste wake, men
  afviser golden chain, fordi den nye Realtime-session ikke blev oprettet. Brugerens
  første wakeforsøg gav intet observeret wake-event og forbliver en separat fysisk
  wake-usikkerhed; firmwarefølsomhed må ikke ændres uden lyd-/wake-bevis.
- **Hele berørte kæde og nærliggende races:** completed usage/rate-snapshot i gammel
  generation → model-close → exact release af gammel production-lease → firmware-rearm
  → ny wake/mic-latch → `OpenAIRealtime.connect()` → ny production-owner → session-
  update/socket → første sideeffektfrie modelrespons → eventuel tool/farvel-kapacitet →
  playback/teardown/rearm. Stale release/rate/usage fra gammel generation, samtidig
  eval, duplicate wake/connect, connectfejl, provider-429 og underfinansieret toolrunde
  skal forblive fail-closed og exactly-once.
- **Berørte invarianter, falsificerbar årsag og ikke-mål:** Én wake må eje højst én
  production-generation/socket; eval og production forbliver eksklusive; HA/MCP og
  lifecycle-værktøjer må kun frigives efter completed autoritativ usage og eksakt
  follow-up-kapacitet. Årsagen er den faste admission i `production_started(tokens=15000)`:
  efter lease-release beholdt den autoritative rullende bucket sandt mindre end 15.000,
  selv om én frisk sideeffektfri første respons kunne være mulig. Den nye generation
  skal derfor eje `min(15000, floor(available))`, mens dens cap for atomisk senere top-up
  forbliver 15.000. Ingen bucket-reset, magisk 6k-grænse, ekstra probe, automatisk retry,
  ny socket, prompt-/schemaændring, firmware-, wake-, gain-, VAD-, playback- eller
  lifecycleændring er mål.
- **Planlagte regressioner og sammensatte gates:** Gammel session bruger bucket under
  15k → exact release → +2,6 s → ny generation får en partial lease uden overreservation
  og højst én socket. Duplicate start, stale release/rate/usage, connect/setup-fejl,
  diagnostic/eval-eksklusivitet, cold bucket og zero-capacity dækkes. En completed
  sideeffektfri første respons må bogføres/lukkes; et completed HA/MCP/`end_conversation`-
  forslag uden follow-up-kapacitet giver nul dispatch/commit og én teknisk teardown;
  gyldig current-generation top-up giver præcis én dispatch. Provider-429 giver ingen
  retry eller anden socket. Thin/Voice PE-integrationen skal bevise close A → wake B
  efter 2,6 s → ny providergeneration, og hele lifecycle-/releasegaten samt uafhængigt
  adversarial review skal være grønne før versionering.
- **Rollback-grænse og fysisk status:** Hele partial-leaseændringen rulles tilbage ved
  overreservation, tabt eksklusivitet, ekstra socket/retry, ekstern effekt uden reserve
  eller stale generationsejerskab. v1.13.46 forbliver fysisk NO-GO. En maskinelt grøn
  kandidat må kun åbne én ny fysisk canary; den overtager ingen baseline før første wake,
  samme-session-opfølgning, model-close, én teardown/rearm og umiddelbar næste wake med
  ny rigtig Realtime-session er samlet bevist.
- **Faktisk ændring og maskinresultat for v1.13.47:** `production_started()` giver én
  eksklusiv production-generation `min(15000, floor(available))`, men beholder dens
  15.000-cap til en senere atomisk top-up. Usage med forkert, lukket eller fremmed lease
  afvises før debit. Der er ikke tilføjet probe, retry, socket, bucket-reset eller nogen
  Voice PE-/Talk-lifecyclevej. 121 fokuserede budget-/Realtime-tests er grønne på under
  ét sekund; de nye regressioner dækker nul og partial kapacitet for HA, MCP og
  `end_conversation`, current-generation top-up, duplicate done, stale usage,
  provider-429, setupfejl, release og diagnostic-eksklusivitet. Ruff, format, mypy og
  diff-check er grønne. Uafhængigt adversarial diff-review gav P0=0, P1=0 og GO til
  commit/maskinel releasegate. Den første hurtiggate ramte worktreets langsomme lokale
  `.venv`; med den etablerede usynkroniserede værktøjsruntime blev hele testsuiten grøn,
  hurtiggaten sluttede på 37,0 sekunder og den fulde lokale releasegate på 38,4 sekunder.
- **Præcis kandidatstatus:** v1.13.47 er kun maskinelt reviewet og fortsat fysisk NO-GO.
  Den ændrer kun add-onen og kræver derfor ikke ny firmwareflash;
  `podvoice_build_11346` forbliver eksakt firmwarekontrakt. Først en grøn fuld gate,
  exact image/install og den ovenfor definerede fysiske canary kan flytte status.

### Historisk beslutningspost — provider-tail og fysisk playback-korrelation

- **Observeret fejl og stærkeste evidens:** en deterministisk reproduktion af
  `response.done(r) → response.created(r) → audio.delta(r) → response.done(r)` gav
  både `TurnComplete` og en stale `AudioChunk`, efterlod provideren aktiv og kan wedge
  næste tool-resultat. En almindelig completed respons uden PCM åbner opfølgning og kan
  gemme et uhørt assistant-transcript. Shippet firmware udsender samtidig kun boolske
  `podvoice_playback_started/finished/fault`; Thin-tests bruger syntetiske playback-id'er,
  som den fysiske adapter aldrig leverer. `simulate` kan fortsat aktiveres via shipped
  config/UI og importerer legacy `sim.py`.
- **Hele berørte kæde og nærliggende races:** provider response-id/status → audio og
  transcript → Thin turn-complete/history/followup → reply lease/id →
  firmware-ejet reply-play → privat announcement start/drain/fault → native API →
  playback finish → close/teardown/rearm. Nærliggende fejlveje er done-before-created,
  terminal tail, duplicate/out-of-order events, gammel finish efter ny arm, reconnect,
  missing/fremmed token, silent semantic end versus silent ordinary response, Talk-
  adapteren og dev-simulatoren.
- **Berørte invarianter:** lifecycle 3–5 og 10–13; Realtime-events efter terminal status
  skal være virkningsløse, kun korreleret semantic end må lukke stille, fysisk playback
  skal ejes af samme lease fra request til drain, og classic/sim må ikke kunne aktiveres
  fra produktion. Én wake/én session, opfølgninger og rearm må ikke ændres.
- **Falsificerbar årsagshypotese:** terminal response-id'er kontrolleres for sent i
  providerparseren; Thin skelner ikke ordinary zero-PCM completion fra lovlig silent
  semantic end; firmwareeventtypen kan ikke bære leaseidentitet; og simulatorflaget er
  blevet bevaret som produktionsindstilling. Tidlig terminal-afvisning, ordinary
  zero-PCM fail-closed, en tokenbærende entity fra firmware samt fjernet shipped
  simulate-aktivering skal lukke hullerne uden lokal semantik eller parallel runtime.
- **Planlagte regressioner og sammensatte gates:** eksakt fire-event provider-tail plus
  næste normale tool-resultat; ordinary zero-PCM må ikke gemmes eller åbne followup og
  skal fejle hørligt, mens korreleret silent semantic end fortsat lukker rent; source-
  kontrakt for nul shipped simulate-import/config/UI; token-match gennem
  expect→start→finish/fault og afvisning af missing/wrong/stale/duplicate/out-of-order
  token efter ny lease/reconnect; Talk-paritet; focused, lifecycle, fuld release,
  firmware render/config/compile og to uafhængige frozen reviews.
- **Ikke-mål og rollback:** ingen prompt-, gain-, VAD-, mic-channel-, resampling-,
  HA/MCP-, tool-, rearm- eller latencyændring. Dev-simulation må leve som separat
  test-entrypoint, aldrig shipped runtime. Rollback er hele provider/silent/sim/token-
  ændringen, hvis token kan krydse leases, Talk ændres, ordinary svar lukkes semantisk,
  eller firmware/add-on bits ikke har eksakt samme kontrakt/buildmarkør.

**Faktisk ændring og resultater for v1.13.44.** Providerparseren tombstoner nu både
events efter et terminalt response-id og et nyt response-id, der genbruger allerede
forbrugt request-metadata; den efterfølgende legitime tool-resultrespons bruger stadig
samme socket. Thin fejler ordinary completed uden PCM hørbart og uden transcript eller
followup, mens korreleret silent semantic end fortsat lukker stille. Tool-taskens
levetid kan ikke længere nulstille response-ejerskab før dens lydløse decision-
`TurnComplete`. Shipped simulate-config, runtime, console-fallback og modul er fjernet;
kun `tests/fakes/legacy_sim.py` er bevaret som testfixture.

Fysisk svarplayback bruger nu én procesrandomiseret og monoton token fra Thin-lease via
native API til firmware-ACK `token:started|finished|fault`; missing, wrong, stale,
duplicate, out-of-order og disconnect-events er inerte. Normale svar sendes med præcis
én device-ejet `podvoice_reply_play(token,url)`. Timer og diagnostik reserverer først et
auxiliary token, muterer derefter ReplyBus og starter samme private player, men deres
ACK'er når aldrig Thin. Den private FLAC-player har egen HTTP-kilde, resampler og mixer-
input; HA's offentlige media player kan derfor ikke levere falske reply-events. En
forladt auxiliary reservation udløber bounded, og ny reserve afvises under start/drain.
Cancel og ukendt orphan-recovery kvitteres først efter privat player-idle og fysisk tom/
stoppet resampler. Disconnect bevarer den ukendte lease; rearm udfører desuden sin egen
bounded silence/drain-gate før wake-recovery; adapterens 9 s og Thin-gatens 9,5 s
dækker firmwaregrænsen på 3 + 2 + 3 s. Firmware-reset med mismatchet exact cancel
falder via fault over i frisk tokenbåret orphan-silence ved næste retry. Wake stopper
auxiliary playback før Realtime-admission, og manglende stop afviser wake.

- **Lokale gates:** den auditerede lifecycle-manifestpakke er 163/163 grøn; fuld
  releasegate er grøn på 42,7 s med Ruff, format, mypy og hele pytest-suiten.
  Localhost-webregressionen beviser, at aktivt svar ikke kan overskrives af
  `test_speaker`. Preflight læser nu kun tre repræsentative filer i stedet for at
  hydrere hele det synkroniserede checkout; den tidligere 15 s timeout er elimineret.
- **Firmwarebevis:** ESPHome 2026.6.2 config og validation-only compile er grønne fra
  kilde-SHA-256 `fed87c0e510b7100192fa7fb98aaada32f70e2c8dec43a2917487de50775d6cb`.
  ELF indeholder `podvoice_build_11344`, `correlated_playback_v2` og
  `podvoice_playback_ack`. SHA-256 er OTA
  `4429da95127528b809576d902941a688ed9fd2607989f3fc335173ceff6ade38`, ELF
  `4c06e3445e2f3e1ae2b6d9e1a8a700e48a6ecd8550aa3e5d0cab15c54ff19672` og factory
  `b70e871347c3ce639457c4990b6445dbe3b319a5bf89cdbd0893dc100d85eace`.
- **Afvigelser og resterende usikkerhed:** første reviewer-loop falsificerede den
  tidsbaserede `armed → offentlig media-command`-løsning: en HA-announcement kunne
  arve tokenet. Det krævede den isolerede private FLAC-pipeline ovenfor; prompt, gain,
  VAD, HA/MCP og rearm-semantik blev ikke ændret. Validation-firmware bruger dummy-
  secrets og må ikke flashes. Kandidaten er ikke fysisk testklar før final frozen review,
  commit, exact-commit CI/ARM64 og installerbar artifact/digest; derefter kræves frisk
  fysisk golden chain og 10/10 ubrudte cyklusser. Rollback-grænsen ovenfor gælder.
- **Frozen review:** to uafhængige adversarial reviews er GO for exact commit/CI uden
  P0/P1 og scorer henholdsvis 97/100 og 98/100 maskinel confidence. Det er ikke fysisk
  releasebevis; exact-SHA CI/ARM64 er nu grøn, mens installerbar bitidentitet fortsat
  mangler.

### Historisk feltbeslutning 25. august — minimal Realtime-lifecycle uden overfit

**Observeret på installeret v1.13.41 kl. 13.28–13.29.** Voice PE åbnede én
Realtime-session. `get_time` lykkedes. Realtime modtog den korrekte transskription
“Hvad er tolv gange syv?”, men svarede `28`. To korrekte transskriptioner af “Læg seks
til.” førte til stadig længere forsvar for den forkerte modelkontekst. “Farvel.” gav
præcis ét `end_conversation`, et kort fysisk farvel, model-close, attention-release og
fysisk wake-rearm. Den armerede trace `20260825T132842-361` gemmer device-, provider- og
speakerlyd samt hele eventrækkefølgen.

- **Hele berørte kæde og nærliggende fejlveje:** fysisk wake → præcis én
  Realtime-generation → samme socket/kontekst gennem opfølgninger → direkte svar eller
  nødvendige domæneværktøjer → ét committed `end_conversation` → valgfri kort
  providerlyd eller eksplicit stille afslutning → én teardown → bounded fysisk rearm →
  næste wake. Nærliggende races er delayed/unrelated `TurnComplete`, modstridende
  lifecycle-kald i samme batch, forskellige duplicate end-kald, playback uden lyd,
  hængende provider/device/attention-close og den modsatte Talk-adapter.
- **Berørte invarianter:** Realtime ejer betydning og afslutningsvalg; Thin ejer kun
  mekanik og må aldrig fraseparse. Én wake må skabe én session. Kun den korrelerede,
  completed terminalrespons må bekræfte semantic end. Lifecycle-signaler skal være
  entydige, og teardown/rearm skal have præcis én ejer og en hård tidsgrænse.
- **Falsificerbar årsagshypotese:** produktionsvejen er én og grundlæggende rigtig, men
  modelkontrakten gentager afslutningsreglen i systemprompt, reserved tool og
  domæneværktøj og overstyrer providerens batchform. Samtidig mangler Thin fire
  serverhåndhævede grænser: close-response-korrelation, atomisk afvisning af mixed
  wait/end, afvisning af flere end-kald og bounded teardown. Fjernes dubletterne og
  håndhæves disse grænser, skal rå eventpermutationer blive deterministiske, mens en
  lille live matrix stadig lukker “Farvel”, “Tak, det var alt” og “Stop samtalen”, men
  ikke “Tak”, “stop musikken” eller en ny opgave.
- **Bindende minimal kontrakt:** wake åbner én Realtime-session; første tur og 0..N
  naturlige opfølgninger deler præcis den samme socket og samtalekontekst uden nyt wake;
  Realtime svarer direkte eller kalder kun nødvendige værktøjer;
  et entydigt `end_conversation` lukker. Har den korrelerede terminalrespons lyd,
  afspilles den færdig; har den ingen lyd eller fejler, lukkes der stille uden lokal
  semantik eller falsk playback-fejl. Derefter udføres én bounded teardown og én rearm.
  “Stop musikken” er en domænehandling; “stop samtalen/Nabu” er semantic end.
- **Planlagte regressioner og gates:** korreleret response-id/generation; stale,
  duplicate og out-of-order completion; atomisk mixed wait/end og duplicate-name-end;
  terminalrespons med farvel, completed uden lyd og failed uden lyd; hung provider,
  device og attention med total teardown-deadline; samme tests for Voice PE og Talk;
  ti simulerede lifecycle-cyklusser. Den lokale `lifecycle-smoke` må kun bevise disse
  mekaniske egenskaber og skal normalt køre på få sekunder til højst to minutter. En
  lille live close-matrix beviser kun modelvalget. Fuld SafeEval, øvrige funktioner,
  CI/ARM64 og fysisk golden chain er separate senere gates.
- **Ikke-mål og rollback:** ingen lokal fraseliste, transcript-veto, calculator eller
  anden semantikmotor; ingen `continue_conversation`, parallel runtime, audio/VAD/gain,
  firmware-, HA/MCP- eller funktionsændring. Matematik er ikke længere lifecycle-bevis.
  Ved uløst P1, forskel mellem Talk og Voice PE, ukorreleret close eller stille close
  uden et committed `end_conversation` forbliver kandidaten NO-GO og rulles tilbage
  samlet før fysisk test.
- **Faktisk ændring og maskinel status for v1.13.42:** samme-session-opfølgninger er
  bevaret og promptlåst. Terminal request, source call-id, response-id, socket-generation,
  PCM og completion er nu én korreleret kæde; stale, duplicate, superseded og raw
  done-before-created-events fejler lukket. Kun eksakt terminal PCM kan blive farvel;
  ellers lukkes stille. Silence, cachet fejllyd, teardown og første rearm deler én samlet
  deadline, og hvert rearm-retry er bounded. Voice PE og Talk har parallelle mekaniske
  regressioner. Hurtig lifecycle-gate: 54 selectors, 118/118 cases på 10,02 s;
  Thin: 122/122; providergrænser: 89/89; tidligere samlet prompt/eval/UI-gate: 352/352.
  Ruff, format og mypy er grønne. Uafhængigt adversarial recheck af det uversionerede
  runtime-snapshot fandt P0=0/P1=0 og gav GO for maskinel testklarhed; versions-/docsændring
  ændrer ikke runtime. Resterende usikkerhed er den lille rigtige Realtime-close-matrix,
  rigtige Realtime-close-matrix og fysisk Voice PE-kæde. Kandidaten blev 25. august
  installeret fra det opdaterede HA-katalog som v1.13.42. Opstartsloggen viste
  `PodVoice gatekeeper v1.13.42`, HA/MCP-forbindelse med 19 værktøjer og fungerende
  `GetLiveContext`, `PodVoice ready — rooms: ['r0']`, succesfuldt Voice PE-handshake,
  firmwarekontrakt OK, mic-tuning og wake word `okay_nabu`. Den er derfor installeret
  og klar til næste gate, men var på dette tidspunkt **ikke live-close-matrix-, fysisk
  golden-chain- eller releasegodkendt**.

- **Frisk fysisk evidens for v1.13.42 kl. 15.24–15.25:** én wake åbnede én
  Realtime-session. `12 × 7` gav korrekt `84`; opfølgningen “Læg seks til” gav korrekt
  `90`; datoen blev hentet korrekt; den senere reference til det tidligere regnestykke
  bevarede konteksten og bad fornuftigt om præcisering mellem `84` og `90`. Afslutningen
  gav præcis ét committed `end_conversation`, en kort fysisk farvelrespons, én
  model-close, media stop og attention-release. Add-on-loggen registrerede derefter
  `wake continuity proven`, men ingen ny wake blev observeret, og ejerens umiddelbare
  efterfølgende “Okay Nabu” virkede ikke. Det er stærkere fysisk modbevis end ACK'en:
  samtaledelen er grøn, men lifecycle/golden chain er **NO-GO**.
- **Ny falsificerbar rearm-hypotese:** firmwaregrenen for kontinuitet accepterer
  `podvoice_detector_continuity_proven`, den brede tilstand
  `micro_wake_word.is_running()` og fire nye mikrofonframes som fysisk bevis. Det
  beviser et levende mic-sourceflow, men ikke entydigt at modellen står i
  `DETECTING_WAKE_WORD` og faktisk kan genkende næste wake. Den nuværende automatiske
  regression gengiver samme antagelse statisk og kan derfor ikke opdage denne
  falsk-grønne tilstand. Før ny fysisk kandidat skal readiness enten få et stærkere
  firmwarebevis eller degraderes ærligt, og den observerede ACK-uden-ny-wake-kæde skal
  være en regression. Ingen gain-, VAD-, prompt- eller semantikændring er indiceret af
  denne fejl.
- **Historisk rearm-korrektionsgrænse:** hele kæden er afsluttet fysisk playback →
  `podvoice_stream_stop` → provider/attention-close → én firmware-rearm → næste
  detektion → én ny session. Berørte invarianter er exactly-once teardown/rearm,
  firmwareejet fysisk wake og sand readiness. Den minimale plan er at fjerne den
  falsk-grønne kontinuitetsgren som autoritet, gennemføre én bounded og observerbar
  detektor-reset ved rearm, holde latch lukket ved stop/start-/audio-timeout og kun
  rapportere reset som `recovered`; en virkelig efterfølgende wake er fortsat eneste
  grønne bevis for den nye detektorinstans. Regressionerne skal afvise mic-progress,
  `STARTING`/`STOPPING`, stale/duplicate ACK, disconnect og timeout som `proven`, bevise
  én reset/én latch-open/én add-on-rearm per teardown og bevare den modsatte Talk-
  adapter. Firmware-render/compile, fokuseret lifecycle-suite, fuld statisk/testgate,
  uafhængigt adversarial review, artifact-identitet og fysisk wake → dialog → close →
  ny wake er sammensatte gates. **Ikke-mål:** ingen ændring af gain, VAD, lydtransport,
  Realtime, prompt, semantik, playback eller stilhedslukning. Rollback er hele firmware-
  og kontraktændringen, hvis reset ikke når stabil operationelt gul readiness bounded,
  skaber duplicate wake/session eller den nye fysiske wake fortsat fejler.
- **Adversarial stop-the-line under v1.13.43-arbejdet:** første cross-session-orakel
  bandt kun næste wake og provider-connect via rum og tid. En afvist wake A kunne derfor
  efterlade beviset åbent, så en senere wake/session B fejlagtigt gjorde A grøn. Samme
  review viste, at et kendt mic-forward-fault (`down`) kunne overskrives til
  `degraded` af en vellykket detektor-reset. Kandidaten forbliver NO-GO, mens
  wake-attempt, history-session og frisk provider-generation bindes med ét nonce,
  samtlige early-return-/fejlveje invaliderer netop dette forsøg, bevisvinduet udløber,
  og mic-fault forbliver `down` indtil en faktisk vellykket mic-start. Regressionerne
  skal falsificere wake A → early return → wake/session B, uændret provider-generation,
  flere firmware-buildmarkører og statusopgradering efter mic-start-fejl.
- **Andet adversarial stop-the-line:** timeout/fejl i mic-stop, provider-close,
  heartbeat-stop eller attention-release kunne stadig efterfølges af firmware-rearm.
  Det strider mod invariant 7 og kunne åbne næste latch oven på gammel fysisk eller
  provider-tilstand. Rettelsesgrænsen udvides derfor kun til mekanisk teardown:
  rearm blokeres, readiness forbliver `fault`, nye wakes afvises, og den samme
  close-owner genkører hele teardown bounded før én rearm. Det strikte trace-orakel
  skal kræve `teardown_complete` før rearm og afvise enhver teardown-/mic-fejl.
- **Faktisk ændring og maskinel status for v1.13.43:** firmware-rearm er nu én
  tokenkorreleret, bounded detektor-reset med `recovered`/`fault`; add-on accepterer
  aldrig ACK som fysisk `proven`, kræver eksakt buildmarkør `podvoice_build_11343` og
  afviser stale, duplicate, disconnectede og fremmede ACK'er. Thin rearmer kun efter
  bekræftet fysisk silence, mic-stop, provider-close, heartbeat-stop og
  attention-release. En fejl
  holder latch og readiness lukket, afviser nye wakes og genkører hele teardown før
  præcis én rearm. Den næste fysiske callback bindes med nonce til netop den nye
  history-session og en større provider-generation; rejected/early/nonphysical
  forsøg, udløbet bevis og senere sessions kan ikke retroaktivt gøre tracen grøn.
  Mic-forward-fault forbliver `down` indtil en faktisk vellykket mic-start.
  Lifecycle-manifestet har 71 eksplicitte selectors og kører på cirka 10 sekunder;
  den fulde lokale gate (Ruff, format, mypy og hele testsuiten) er grøn på 37,1 s i
  den rene Python 3.12-runtime. ESPHome config og en frisk compile af de aktuelle bits
  er grøn; ELF indeholder både `correlated_reset_rearm_v2` og
  `podvoice_build_11343`. Validation-only OTA-artifact har SHA-256
  `8e21eb11d201db800d9bc0d7647d60149473ab8af39a9edcff75358a841dcd2d` og må ikke
  flashes, fordi det er bygget med dummy-valideringsnøgle. Uafhængigt review har nul
  P0/P1; kandidatstatus er GO til rigtig build/install og én frisk fysisk
  golden-chain-gate, men fortsat NO-GO til golden-label/release. Resterende usikkerhed
  er operationel ESPHome `STARTING` versus rigtig detectorfunktion og kan kun lukkes
  af den korrelerede fysiske kæde teardown → reset → næste “Okay Nabu” → ny
  provider-session; derefter kræver lifecycle-release stadig 10/10 ubrudte cyklusser.
- **Tredje adversarial stop-the-line:** frozen review fandt, at native reconnect efter
  en returneret men ufuldstændig close kunne omgå full-teardown-retry og kalde rearm,
  at en stray wake-callback kunne male readiness grøn før samme gate, og at resultatet
  fra fysisk `silence-device` ikke indgik i `teardown_complete`. Kandidaten er igen
  NO-GO, indtil reconnect kun afleverer ejerskab til full-teardown-retry, callbacken
  afvises før readiness-promotion, fysisk silence indgår i gaten/retryes, og
  cross-session-TTL bruger monotont ur. Ovenstående maskinelle resultat er derfor
  historik for pre-fix-diffen, ikke kandidatgodkendelse.
- **Tredje stop-the-line er lukket på frozen diff:** reconnect afleverer nu kun
  ufuldstændig teardown til den single-flight full-teardown-retry; en callback under
  samme tilstand afvises før readiness-promotion. Fysisk silence er en reel gate, og
  den shippede Voice PE-adapter returnerer kun succes, når både required reply-cancel
  og announcement media-player STOP er køet; manglende target/client eller exception
  forbliver fejl og bevarer `_announcing`. Den integrerede fail→success-regression
  beviser nul tidlig rearm, to rigtige adapter-stopforsøg og præcis én senere rearm.
  Den endelige fulde gate er grøn på 37,1 s, focused causal suite er 227/227 grøn,
  `git diff --check` er grøn, og to uafhængige frozen reviews finder P0=0/P1=0 med
  henholdsvis **97/100** og **96/100** maskinel confidence. v1.13.43 er derfor **GO
  til rigtig build/install og én frisk fysisk golden chain**, men fortsat NO-GO til
  golden-label/release, indtil den installerede buildmarkør, fysisk playback-finish,
  teardown/reset og den næste wake→provider-session er bevist på samme kandidat.

### Historisk feltbeslutning 25. august — falsk semantisk close på matematisk opfølgning

**Observeret på installeret v1.13.39 kl. 11.42.** Voice PE åbnede én
Realtime-session. Første tur brugte `get_time`; næste tur “Hvad er tolv gange syv?”
blev besvaret korrekt med `84`. På den kontekstafhængige opfølgning gemte den
asynkrone diagnostiske transskription “Læg seks til.”, men Realtime kaldte
`end_conversation`, sagde farvel og lukkede. Fysisk playback, én teardown og wake-rearm
gennemførte rent. Turen er rød: det korrekte svar var `90` eller, ved usikker lyd, en
opklaring — aldrig afslutning. Audio-trace var ikke armeret i denne samtale; der findes
derfor intet eksakt provider-PCM fra feltfejlen, som må foregives matchet eller replayet.

- **Hele berørte kæde:** rearmet mic-gate → fysisk opfølgningslyd → providerens rå
  audiotolkning → automatisk tool-valg → `end_conversation`-resultat → farvel-playback
  → teardown/rearm → næste wake. Transcriptet kommer fra en separat asynkron
  transskriptionsmodel og beviser derfor ikke alene, hvad Realtime-modellen hørte.
- **Berørte invarianter:** Realtime ejer semantisk afslutning; PodVoice må ikke indføre
  frasebaseret close/anti-close eller en parallel semantikmotor. Thin må kun udføre den
  mekaniske close præcis én gang efter et gyldigt modelkald. Samme session og kontekst
  skal overleve naturlige opfølgninger.
- **Falsificerbar hovedhypotese:** Realtime-audiomodellen forveksler den fonetisk korte
  danske fortsættelse med afslutningshensigt, og den reserverede tool-beskrivelses brede
  positive regel om et høfligt wrap-up efter en opgave øger risikoen. Den er kun støttet,
  hvis tekstkontrollen svarer `90`, mens den eksakte provider-PCM gentagne gange vælger
  `end_conversation`; ellers skal event-/kontekst- eller prompt/tool-kontrakten undersøges.
- **Planlagte regressioner og sammensatte gates:** bevar eksisterende tekstkontrol og
  skaf først en ny, samtykket audio-trace, hvis den eksakte normaliserede transskription
  matcher en kanonisk sikker eval-ytring. Kør derefter tre friske, uafhængige replays af
  target-turnens eksakte provider-PCM med matchende model, produktionsprompt,
  byte-identisk tool-schema og rumkontekst; gem response-/call-id, diagnostisk transcript
  og usage.
  Enhver rettelse skal bevare eksplicit afslutning, høflighed uden close, matematik
  `84 → 90`, wait-for-user, almindelige domæneværktøjer, Talk/Thin og fysisk lifecycle.
  Derefter focused gate, fuld suite/static, uafhængig adversarial review, exact ARM64
  artifact og én frisk fysisk golden chain. 10/10 starter først efter denne kæde.
- **Ikke-mål og rollback:** ingen lokal fraseliste, transcript-veto, obligatorisk
  `continue_conversation`, to-respons-vej, lyd/VAD/gain/firmware-, playback-, DHCP- eller
  HA/MCP-ændring. Hvis lydreplay ikke reproducerer årsagen, stoppes prompt/tool-
  ændringen; v1.13.39 forbliver installeret som diagnostisk, men ikke testgodkendt.

**Historisk minimal produktbeslutning.** Der findes direkte fysisk eventevidens for samme
session, de to korrekte svar, det efterfølgende committed `end_conversation`-kald,
farvel-playback, teardown og rearm samt den separate diagnostiske transskription “Læg
seks til.”. Der findes **ikke** eksakt provider-PCM for target-turnen, fordi audio-trace
ikke var armeret. Hovedhypotesen er derfor fortsat falsificerbar, ikke bevist: den brede
positive sætning i `end_conversation`-deklarationen om et høfligt wrap-up efter en
afsluttet opgave kan gøre den foregående opgaves afslutning til fejlagtigt positivt
close-bevis, selv om den seneste korte tur plausibelt fortsætter konteksten.

Den mindste planlagte produktændring er én variabel: fjern den brede positive sætning
fra den reserverede tool-beskrivelse og gør eksplicit, at en tidligere opgaves
afslutning aldrig i sig selv er end-intent; den seneste tur skal selv klart afslutte.
Den observerede tekstsekvens `Hvad er tolv gange syv?` → `Læg seks til.` tilføjes som
tekst-/live-eval-diagnostik med forventet `84 → 90`, men må ikke kaldes lydækvivalent
eller fysisk reproduktion. Ikke-mål er uændret: ingen frase- eller transcript-veto,
ingen `continue_conversation`-/to-respons-vej, ingen promptomskrivning og ingen ændring
af Realtime-eventrækkefølge, Thin-lifecycle, playback, teardown eller rearm. Rollback-
grænsen er den ene tool-description-diff, hvis betalt Realtime-validering ikke reducerer
false-close uden samtidig at bryde eksplicit semantisk close.

**Faktisk evalgrundlag.** Audio-replay af en
kontekstafhængig scenarietur åbner en frisk Realtime-session for tekstkontrollen og hver
af de tre PCM-prøver. Den seeder tidligere ture som **kanonisk scenarietekst** i samme
session og kræver, at hver expectation og session-id består, før target-PCM må sendes;
rapporten siger eksplicit, at den fysiske prefix-lyd ikke er replayet.
Fejler én seed-tur, sendes target slet ikke, og rapporten klassificerer
`context-seed-failure`; en isoleret tur tre kan derfor ikke længere se grøn ud uden tur
et og to. Rapporten bevarer seed-turenes usage, committed call-/response-/batch-id'er og
providertrace ved siden af kontrol og trials. Alle seed- og target-ture tælles i de
eksisterende token-/responskanter, og den
prospektive grænse plus faktisk usage forbliver under det hårde samlede loft på $5.

Reviewerens første NO-GO er lukket fail-closed i evalvejen: en trace uden matchende
kildemodel, prompt-source/version/hash, tool-schemahash eller rumkonteksthash må ikke
åbne providerreplay eller blive grøn; gamle traces uden provenance afvises. En
kontekstuel target kræver eksakte provider-sample-offsets. Hver PCM-prøves nye
diagnostiske transcript skal være ikke-tomt og eksakt normaliseret lig den kanoniske
ytring, ellers får prøven `audio-transcript-missing` eller
`audio-transcript-mismatch`. Scenariets tekstkontrol bruger nu det observerede ordvalg
“Læg seks til.” og forventer `90`; det er en diagnostisk tekstklasse, ikke en påstand om
lydækvivalens. Uden armed PCM fra feltkørslen findes stadig ingen fysisk replay-fixture.

**Faktisk minimal produktændring, endnu ikke testlåst eller releasegodkendt.** Kun den
reserverede `end_conversation`-beskrivelse er ændret: tidligere opgaveafslutning er ikke
close-bevis, og en kort seneste tur, som plausibelt fortsætter, korrigerer, præciserer
eller refererer til det foregående svar, skal besvares eller afklares. Systemprompt,
Realtime-runtime, Thin-lifecycle, lyd, firmware og værktøjsdispatch er urørte. Thin
gemmer desuden kun de allerede anvendte model-, prompt- og rumkonteksthashes som
trace-provenance; det ændrer ingen samtaleadfærd. Den tidligere fokuserede
eval-harness/audio-trace/replay-endpoint-pakke var **155/155** grøn på 3,00 s, men det er
ikke resultat for den nye tool-description-diff. For den nye diff er den målrettede
prompt-/tool-/eval-/oracle-/Thin-gate **30/30** grøn på 4,79 s; Ruff check var grøn på
0,01 s, mypy for `thin.py` og `eval_harness.py` var grøn på 0,32 s, og `diff --check` er
ren. Ingen betalt provider blev kaldt. Uafhængigt adversarial review gav derefter GO
til live-eval med 0 P0/P1. Den billige P2-lukning ændrer kun evalprofilen: historiske
`arithmetic-followup` bevarer “Og læg seks til.”, observerede
`arithmetic-followup-observed` bevarer “Læg seks til.” som en separat eksakt tekstcase,
og `explicit-short-close` tilføjer den korte positive kontrol “Farvel.”. Den selektive
close-valideringsprofil omfatter desuden `semantic-close` og den eksisterende
`low-risk-action-then-close`, så task→close-batchrækkefølgen fortsat bevises. Profilen er
præcis disse fem scenarie-id'er og **8 ture** i alt. En lille betalt kørsel af netop denne
profil er stadig obligatorisk, fordi deterministiske tests ikke kan bevise, at
Realtime-modellens tool-valg faktisk ændres, eller at naturlig eksplicit close bevares.
P2-ændringen tilføjer ingen produktionsadfærd. Dens fokuserede
manifest-/admission-/oracle-/context-gate er **11/11** grøn på 0,47 s; Ruff check var
grøn på 0,01 s, mypy for `eval_harness.py` var grøn på 0,30 s, og `diff --check` er ren.
Den genåbner endnu ingen fysisk gate.

### Historisk feltbeslutning 25. august — Voice PE strandet på cachet DHCP-adresse

**Observeret på installeret v1.13.38 efter strømudfald og HA Green-genstart.** Voice PE
stod sandt offline i PodVoice, og ESPHome Builder viste først `No status`. PodVoice-loggen
viste, at add-on-containeren ikke kunne opløse `podvoice-pe-0a7e7a.local`, valgte den
cachede adresse `192.168.86.162` og fik `Connect call failed` mod ESPHome API-port 6053.
ReconnectLogic fortsatte derefter mod samme numeriske klientadresse uden recovery.

En USB-reset og ubrudt serielog beviste en sund firmwareboot: nul mislykkede bootforsøg,
Voice Kit 1.3.1, fuldført setup, Wi-Fi SSID `Banana-split`, signal omkring -30 dBm og ny
DHCP-adresse `192.168.86.193`. Den installerede add-on fandt ikke denne adresse selv.
Som kontrolleret feltworkaround blev rumadressen midlertidigt sat til `.193`; efter en
PodVoice-genstart gennemførte klienten resolve, TCP-connect og Noise-handshake, verificerede
firmwarekontrakten, genanvendte mic channel 1/gain 16 og `okay_nabu`, og panelet viste
`Voice PE: forbundet - wake afprøves`. Workarounden er ikke en produktrettelse: næste
DHCP-skift kan gentage fejlen.

- **Hele berørte kæde:** puck-boot og DHCP → navne-/adresseopdagelse i add-on-netværket →
  APIClient/ReconnectLogic-ejerskab → Noise-handshake → entities/services/subscriptions →
  mic/wake-konfiguration → sand link/readiness → første wake. Ingen Realtime-session eller
  HA/MCP-effekt må åbnes under adresseflytningen.
- **Berørte invarianter:** VoicePELink er eneste native-API-adapter; én fysisk puck må have
  højst én aktiv klient/reconnect-ejer; panelet bliver kun grønt efter et ægte fuldført
  handshake; reconnect skal genopbygge subscriptions, firmwarekontrakt, mic tuning og
  wake word uden at skabe duplicate callbacks eller en parallel runtime.
- **Falsificerbar årsag:** når `.local` ikke kan opløses ved `start()`, konstrueres
  `APIClient` én gang med cachet numerisk adresse. Senere retries kan ikke udskifte klientens
  target, selv om puckens DHCP-adresse har ændret sig. En test med cache `.162`, afvist
  forbindelse og efterfølgende discovery `.193` skal derfor forblive offline på gammel kode
  og gennemføre præcis ét frisk handshake på rettelsen.
- **Bindende retning:** behold det stabile `.local`-navn som enhedsidentitet, men gør
  numeriske fallbackadresser generationsbundne og udskiftelige efter en connection-shaped
  fejl. Adressekilden skal være lokal og identitetsbundet; en ny klient/reconnect-generation
  må først overtage efter den gamle er stoppet og må kun publicere link efter fuld Noise-
  handshake og firmwareverifikation.
- **Planlagte regressioner/gates:** startup med valid cache; stale cache → ny adresse → én
  handshake; aktiv disconnect efter DHCP-skift; discovery-stale/duplicate/out-of-order;
  auth/PSK-fejl må ikke rotere blindt; close/reconnect-race; ingen dobbelt subscriptions eller
  callbacks; link forbliver falsk indtil fuld connect; reassert af mic/wake/firmwarekontrakt;
  Thin opposite-adapter/lifecycle-regression. Derefter focused, fuld unrestricted suite,
  Ruff/format, mypy, diff-check og uafhængigt adversarial review før build/install.
- **Rollback og ikke-mål:** ingen firmwareflash, prompt-, audio-, VAD-, playback-, Realtime-,
  HA/MCP- eller semantic-lifecycleændring. Ingen fast IP eller ubegrænset subnetscan som
  produktløsning. Ved uklar identitet eller uafsluttet gammel generation forbliver linket
  offline frem for at forbinde til en vilkårlig ESPHome-enhed.

**Faktisk lokal v1.13.39-ændring og resultat.** `VoicePELink` ejer nu én
generationsbundet klient og recovery-ejer. En connection-shaped fejl mod en cachet IP
starter native `.local`-discovery med tværgenerations-backoff `1/2/5/10/30/60`.
Gammel klient lukkes før næste generation. Noise, eksakt enhedsnavn, device-info,
firmwarekontrakt, subscriptions, mic channel/gain, wake word og fysisk rearm skal alle
bestå før linket publiceres; kun den autentificerede peer caches atomisk. Forkert
enhedsnavn evikterer cache, mens reel PSK/auth-fejl ikke roteres blindt. Stale callbacks
og forsinket recovery er inerte.

Uventet fysisk linktab lukker en aktiv `ThinSession` præcis én gang. Teardown ejer
rearm, så samtidig reconnect hverken fortsætter en session med manglende lyd, genstarter
gammel mic eller dobbelt-rearmer. Talk og prompt/Realtime/værktøjer/HA/MCP/lyd/VAD/
playback/firmware er uændrede.

Den sammensatte regression beviser `.162` → `.193` → gammel ejer lukket → præcis ét
subscriptionsæt → mic channel/gain + wake word → fysisk rearm → først derefter
link-ready og cache `.193`; senere `.200` genfindes. En separat regression beviser
capped backoff, én resolver-/klientejer og senere recovery. Pauset teardown/reconnect
beviser én providerlukning og én rearm.

Gates på de frosne kildebytes: **46/46 fokuserede** grønne; fuld unrestricted pytest
**exit 0** inklusive HTTP/WebSocket; Ruff og format (**91 filer**) grønne; mypy
**42 kildefiler** grøn; scoped `git diff --check` ren. Worktreeens cloud-dehydrerede
Python-runtime hang før collection, så fuldsuiten blev kørt mod samme kildebytes i et
frisk, låst Python 3.12-miljø. Uafhængig adversarial review finder nul P0/P1 og scorer
**97/100**. Dette er softwarebevis: v1.13.39 skal bygges og installeres, rummet sættes
tilbage til `podvoice-pe-0a7e7a.local`, og den eksisterende stale `.162`-cache skal
automatisk ende på `.193` med første wake, før den fysiske gate genåbnes.

### Fysisk golden-chain-forsøg 23. august — v1.13.38, ikke bestået

Den første friske fysiske kæde efter den grønne maskinegate åbnede én Realtime-session,
svarede korrekt `84` på den første tur, bevarede sessionen gennem opfølgningen og
lukkede senere semantisk med fysisk farvel, teardown/rearm og en vellykket ny wake.
Opfølgningen kan dog ikke godkendes: den kendte ytring “Og læg seks til” blev gemt som
“Hold sekste”, og modellen svarede `72` i stedet for det korrekte `90`. Den efterfølgende
friske session hørte “Hvad er to plus to?” og svarede korrekt `4`, hvorefter
`end_conversation`, farvel-playback og wake-rearm gennemførte rent.

Forsøget er derfor **rødt**, selv om brugeren oplevede den mekaniske kæde som flydende.
Et korrekt første svar og ren lifecycle kan ikke opveje semantisk afvigende fysisk
input. Den armerede trace gemte device/provider/speaker-lyd for forsøget, men den
aktuelle revisionsvej kan ikke hente WAV-filerne uden en separat browser-sessioncookie;
historikkens konkrete transcript/svar er allerede tilstrækkeligt til at afvise forsøget.
Næste tilladte forsøg bruger en tydeligere, stadig kontekstafhængig opfølgning og skal
have semantisk konsistent transcript, korrekt `90`, samme session og den samme fulde
close/rearm/new-wake-kæde. 10/10 forbliver blokeret.

Det næste forsøg gav korrekt `84` og derefter korrekt `90` i samme session og lukkede
rent via modelsemantik. Det tæller alligevel ikke som golden chain: en forudgående
kort fejlopstart forbrugte den armerede lydtrace, den korrekte sessions opfølgning blev
stadig gemt som det tvetydige “Læg sekste”, og der kom ingen efterfølgende ny wake efter
den korrekte sessions rearm. Dette er et nyttigt fysisk delbevis, men ikke en grøn kæde.

### Feltstop 23. august — v1.13.37 kunne ikke se det syntetiske områdenavn

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787501209-667292` gennemførte 30/36 mulige providerkanter og bestod
seks af syv scenarier uden 429. Low-risk-turnen kaldte først det produktionsschema-
gyldige `HassTurnOn(area="stuen", domain=["light"])` og derefter
`HassTurnOn(area="Evalrum", domain=["light"])`. Begge blev afvist af den lokale
fixture, som alene kendte `area="stue"`; tredje tool-batch ramte korrekt finality-
loftet før dispatch, så fixtureeffekter forblev nul. Rapporten brugte $0,145 og 327,52
sekunders pacing.

- **Falsificeret præmis og stærkere årsag:** `stue` var ikke eksponeret i providerens
  schema. Admission sender den byte-identiske produktionsdeklaration med fri
  area-string; canonical fixture og scenarioexpectation er server-side. Samtidig
  injicerede den semantiske evaldriver den synlige rumkontekst `Evalrum`, hvilket
  forklarer modellens andet forslag præcist. At begge forslag nåede fixture mismatch
  frem for schemafejl beviser, at et påstået enum aldrig var på wire.
- **Bindende minimalændring:** den semantiske SafeEval-rumkontekst navngiver nu det ene
  syntetiske basisområde eksplicit og med små bogstaver: `stue`. Den skjulte fixture
  forbliver præcis `area=stue`; `stuen`, `Evalrum`, `name=stue`, scalar-domain, ekstra
  felter og duplicates forbliver røde. Rumkontekstprofil og hash gemmes i rapporten.
  Ingen fuzzy alias, enum-overlay, global prompt-/produktionsschemaændring eller højere
  edge-loft.
- **Næste bounded gate:** den eksisterende eksplicitte scenario-selector må køre kun
  `low-risk-action-then-close`. Rapporten skal vise præcis dette coverage-scope og
  `selected_ok=true`, `profile_complete=false` og
  `release_preflight_passed=false`; `ok` følger release-preflight og må derfor ikke
  blive sandt for et subset. En grøn målrettet kørsel er ikke fuld profilbevis.
- **Rollback og ikke-mål:** produktionsprompt, schema/hash/dispatch, providerpacing,
  prisloft, audio/VAD, Thin, HA/MCP, firmware og lifecycle er frosne. Ved nyt model-loop
  forbliver scenariet rødt frem for at udvide fixture eller cap.

**Faktisk lokalt resultat på frosne bits:** den semantiske SafeEval-driver viser nu
det ene syntetiske basisområde som `stue`; den eksisterende fixture forbliver eksakt
`area="stue", domain=["light"]`, og regressionsmatricen holder `stuen`, `Evalrum`,
`name`, scalar-domain, ekstra felter og duplicates røde. Rapporten gemmer både
rumkontekstprofil/hash og scenariemanifesthash uden at ændre produktionsprompt,
produktionsschema/hash, dispatch eller edge-loft.

Målrettet scope er fail-closed adskilt fra releasebevis:
`selected_ok` beskriver kun de valgte scenarier, `profile_complete` beskriver det
krævede fulde selector-scope, `coverage_complete` falder ved terminalt delresultat, og
`release_preflight_passed`/`ok` kræver alle tre. Rapporter gemmes bounded pr. run-id;
subset og audio-replay kan ikke overskrive seneste fulde kandidat, en fejlet fuld
kørsel tilbagekalder den, og ændret prompt/schema/kontekst/scenariemanifest gør ældre
fuldt bevis stale. Panel/API bruger samme konjunktion og viser målrettet resultat som
delbevis, ikke samlet grønt.

Gates før feltkørsel: **338/338 fokuserede**, **857/857 fulde unrestricted**,
Ruff-format/Ruff-check grøn, mypy **42 filer** grøn og `git diff --check` ren.
v1.13.38 blev derefter bygget i GitHub CI inklusive ARM64, installeret og startet med
19 atomisk admitted HA/MCP-værktøjer, 26 samlede deklarationer, vellykket
`GetLiveContext` og Voice PE-firmwarekontrakt OK.

**Faktisk installeret live-resultat:** fuld SafeEval
`eval-1787503600-2aaa0e` bestod alle **7/7 scenarier og 12/12 ture**.
`selected_ok`, `profile_complete`, `coverage_complete`,
`release_preflight_passed` og `ok` er alle sande; status og klassifikation er
`complete`. Low-risk-turnen kaldte præcis
`HassTurnOn({"area":"stue","domain":["light"]})`, fik ét lokalt `ok`, kaldte
derefter `end_conversation` og lukkede semantisk. Web kaldte én tilladt eksakt query;
følsom handling oprettede én lokal challenge og blev godkendt præcis én gang i næste
tur. Alle response-statusser var completed; schema-korrektioner og provider-retries
var nul. Forbrug: **125.410 tokens**, **$0,2341568** og **322,36 s** bounded
rate-limit-pacing, under $5-loftet.

Efter run: `diagnostic_active=false`, sessions/virkelige tool-kald/attention er nul,
r0 er IDLE/forbundet/ikke ducked, og MCP er current/ready med generation 4, 26
deklarationer og ingen fejl. Hjem, web, musik, tid og timere er synlige; vejr mangler
fortsat sandt. SafeEval har bevist maskinel routing/finality og nul virkelige effekter,
men ikke fysisk wake, playback eller rearm. Én frisk fysisk golden chain må først
startes efter den samtidige uafhængige slutscore på mindst 97/100.

### Feltstop 23. august — v1.13.36 målte fixturestavning frem for semantisk kontrakt

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787499427-4fb6ef` gennemførte arithmetic, alle tre time-ture,
semantic-close og pacinggaterne. Rapporten brugte 12/12 reserverede ture, 120.296
faktiske tokens, $0,1755 og 318,98 sekunders pacing. Tre scenarier blev røde:

- Web kaldte `google_web_sogning` med de schema-gyldige queries
  `FC København seneste kamp resultat` og `FCK latest match result`. Begge blev lokalt
  afvist, fordi fixturen kun kendte `FCK seneste kamp`; modellen rapporterede derefter
  webfejl.
- Sensitive-confirmation kaldte først `EvalUnlockDoor(name="hoveddør")`, som fixturen
  afviste, og derefter `name="hoveddøren"`, som korrekt skabte én challenge. Næste tur
  godkendte den én gang med præcis én lokal fixtureeffekt.
- Low-risk-action kaldte først `HassTurnOn(area="stue", domain=["light"])` og derefter
  `HassTurnOn(name="stue", domain=["light"])`; begge blev fixtureafvist. En tredje
  tool-batch ramte korrekt det normale tre-response-loft før dispatch, så effekter
  forblev nul. Fejlen er et per-turn model-loop/finality-stop, ikke globalt tokenbudget.

- **Berørte invarianter:** SafeEval må kun returnere lokale, eksplicit deklarerede
  fixtureudfald og aldrig fuzzy-matche, coerce eller kontakte HA/MCP. Produktionsprompt,
  fuldt produktionsschema, schemahash, runtime-dispatch og tre normale responsekanter
  er frosne. Den eval-følsomme fixture er fortsat udelukket fra schema-korrektion: et
  ikke-kanonisk argument stopper terminalt uden ToolCall, output, challenge eller
  effekt; gentagne kald skal fortsat gøre scenariet rødt.
- **Falsificerbar årsag:** den hidtidige oracle kræver én eksakt argumentdict per tool,
  selv når produktionsschemaet med vilje tillader fri søgetekst. Det gør en sikker,
  semantisk korrekt query til en kunstig tool-fejl og fremkalder model-retry. Omvendt
  er adgangs- og HA-mål ikke fritekst-fixtures: de skal have én syntetisk kanonisk
  identitet, så eval aldrig foregiver rigtig target-resolution.
- **Planlagte regressioner:** web accepterer kun tre navngivne fuld-dict-cases og
  graderen accepterer præcis ét kald med én af dem, ét `ok`-udfald og korrekt svar.
  Forkert klub, future-query, ekstra felt, tom query, to tilladte kald og mismatch plus
  heldigt svar er røde. EvalUnlockDoor er eval-only låst til `hoveddøren`; `hoveddør`
  stopper terminalt med nul schema-korrektion/ToolCall/output/challenge/effekt. Kun det
  eksakte kald kan skabe én challenge og næste tur godkende én gang. Den syntetiske HA-
  testverden hedder kun `stue`; `name=stue`, `area=stuen`, scalar-domain, ekstra felt
  og duplicates er røde.
- **Rollback og ikke-mål:** edge-loftet hæves ikke. Ingen produktionsschema-, hash-,
  dispatch-, prompt-, provider-, lyd-, VAD-, Thin-, firmware-, HA/MCP- eller lifecycle-
  ændring. Hvis den finite oracle ikke kan bevises eksakt og sideeffektfri, beholdes
  v1.13.36 NO-GO.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.** Web-oraclet
har nu præcis tre eksplicitte fuld-dict-fixtures. `tool_args_any` accepterer kun ét
faktisk kald med én af de tre dicts; beslutning og `ok`-udfald skal fortsat forekomme
præcis én gang, og svaret skal fortsat sige, at FCK vandt 2-0. Forkert klub, future-
query, tom query, næsten-match, ekstra felt, to ellers tilladte kald og heldigt svar
efter fixtureafvisning er røde.

Den eval-only følsomme deklaration eksponerer kun enum-værdien `hoveddøren`.
`hoveddør` stoppes derfor terminalt af den eksisterende sensitive no-correction-grænse
med nul ToolSchemaCorrection, output, ToolCall, challenge og effekt. Det eksakte kald
kan fortsat oprette én serverholdt challenge, som kun næste tur kan godkende én gang.
Produktionssnapshot, produktionshash og produktionsdispatch er byte-/adfærdsmæssigt
uændrede.

Den syntetiske HA-testverden har nu ét dokumenteret basisområdenavn: `stue`.
Kun `{"area":"stue","domain":["light"]}` får det lokale succesresultat;
`name=stue`, `area=stuen`, scalar-domain, ekstra felter og duplicates er røde. Det
normale tre-response-loft er uændret; terminalteksten siger nu sandt
`eval model response-edge limit exhausted before final answer` frem for at ligne et
globalt providerbudgetproblem.

Frosne lokale gates: **329/329 focused**, **843/843 unrestricted full** inklusive
HTTP/WebSocket, Ruff check og format grønne for 91 filer, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Uafhængigt adversarial review, versionering, CI/ARM64,
installation og én frisk SafeEval er fortsat åbne; v1.13.36 forbliver derfor NO-GO
for fysisk golden chain.

### Feltstop 23. august — v1.13.35 genberegnede ikke pacing efter nyt snapshot

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787498165-272088` bestod arithmetic og de første to time-ture. Efter
en completed response med `total_tokens=5695` blev et gyldigt sent snapshot accepteret
med `remaining=18632`. Den næste completed kant efterlod lokalt `remaining=13653` og
eval-owned `3637`. Før næste brugertur beregnede den atomiske capacity-check derfor
én vent på `2,019 s` for target `15000`. **34,851 ms** efter den foregående done
ankrede endnu et gyldigt nedadgående snapshot `remaining=11485`. Efter den allerede
beregnede vent var den nye recheck kun nået til `remaining=12844`; runtime stoppede
med `diagnostic_capacity · rate_limit_capacity · eval response cannot preserve
production headroom`. Der blev ikke sendt en ny response, udført effekt eller prøvet
igen hos provideren.

- **Hele berørte kæde:** turn-preflight → atomisk capacity-check → lokal bounded sleep
  under nøgle-eksklusiv diagnostic → samtidig gyldigt nedadgående provider-snapshot →
  atomisk recheck → højst én `response.create`. Et snapshot under ventetiden kan gøre
  den tidligere wait-beregning for kort; næste beregning skal derfor bruge den nye
  locked ledger og samme hårde run-deadline.
- **Berørte invarianter:** live-eval er gensidigt eksklusiv med produktion og bruger
  `production_headroom=0`; lokalt simuleret fysisk headroom er ikke en sikkerhedsgrænse.
  Hver klientstyret responsekant skal være admitted umiddelbart før wire. Vent før wire
  er pacing, ikke provider-retry. 429 forbliver terminal; cancellation, lease-tab,
  nonwaitable state eller deadline giver nul create/effekt.
- **Falsificerbar årsag:** `prepare_response_capacity()` gør præcis én wait og én
  recheck. Den accepterede downward anchor under sleep er korrekt, men ændrer target-
  underskuddet efter at wait allerede er fastlagt. Fejltekstens “production headroom”
  er historisk og falsk for denne sti; konkret var protected headroom nul.
- **Planlagte regressioner:** den eksakte sekvens `13653 → wait 2,019 s → snapshot
  11485 → recheck 12844` skal genberegne en ny bounded wait og derefter sende præcis én
  create. Flere nedadgående snapshots må forlænge pacing uden wire-retry; deadline,
  cancellation, lease-tab og nonwaitable state stopper før wire. En provider-429 efter
  en faktisk create forbliver terminal uden retry.
- **Rollback og ikke-mål:** ingen margin, fast ekstra sleep, lease-refund eller ændring
  af prompt, model, audio, VAD, Thin, HA/MCP, firmware eller fysisk lifecycle. Hvis den
  recomputede loop ikke kan bevises bounded af samme run-deadline, beholdes v1.13.35
  NO-GO.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.**
`prepare_response_capacity()` genberegner nu den atomiske capacity-state efter hver
bounded sleep, indtil samme responsekant enten er admitted eller den eksisterende
run-deadline, cancellation, lease-tab eller nonwaitable state stopper før wire. Det er
lokal pacing før requesten, ikke provider-retry. Den eksakte feltregression udfører
første vent fra `remaining=13653`, accepterer under sleep snapshot `11485`, rechecker
omkring `12844`, beregner endnu én vent og sender derefter præcis én
`response.create`. Flere nedadgående snapshots er dækket uden fast margin eller
ubegrænset loop.

De tre nabogates bruger nu samme ene capacity-seam: typed text ejer ikke længere en
dobbelt fail-fast-precheck før den eksakte response-create-callback; audio-replay
afventer den bounded preparer før PCM/VAD; og SafeEval tool-batches afventer minimum
feedbackkapacitet før lokal fixtureeffekt, hvorefter den eksisterende context-derived
follow-up-gate stadig gælder. Deadline, cancellation, lease-tab og nonwaitable state
giver nul wire/fixtureeffekt. Fejltekst og arkitekturdokument siger nu sandt, at
diagnostikken er nøgle-eksklusiv og bruger `production_headroom=0`.

Frosne lokale gates: **313/313 focused**, **827/827 unrestricted full** inklusive
HTTP/WebSocket, Ruff check og format grønne for 91 filer, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Uafhængigt adversarial review fandt nul kendte P0/P1;
v1.13.36 er versioneret lokalt, mens CI/ARM64, installation og én frisk SafeEval er
fortsat åbne; v1.13.35 forbliver derfor NO-GO
for fysisk golden chain.

### Feltstop 23. august — v1.13.34 afviste et entydigt sent completion-snapshot

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787495167-f34dcd` modtog en completed response
`resp_EG3SG…` med typet usage `total_tokens=5812`. **38,21 ms** senere ankom en gyldig
token-rate-event med `remaining=5204` og `reset_seconds=52.193`. Tracen klassificerede
den sandt positionelt som `late_after_done`, men runtime afviste den som ledger-anchor
og beholdt lokalt `remaining=15269`. Næste responsekant blev derfor admitted med
`target=9396`; OpenAI afviste den med `limit=40000`, `used=34532`, `requested=5764`
og `retry_after=0,444 s`. Kørselen stoppede terminalt uden retry eller rigtig ekstern
effekt; fysisk test blev ikke startet.

- **Hele berørte kæde:** completed `response.done` + autoritativ usage → gyldig
  positionsløs token-rate-event → providerledgerens monotone anchor → atomisk
  capacity-wait/recheck → højst én `response.create` → providerterminal eller næste
  completed response → diagnostikteardown. Eventet har ikke response-id og må derfor
  aldrig bindes ved nærhed alene, når en ny response allerede er pending/created.
- **Berørte invarianter:** hver klientstyret responsekant skal admitted mod den nyeste
  kausalt forsvarlige kapacitet; gyldig providertelemetri må ikke kasseres, når dens
  placering er entydig; ambiguous/stale/duplicate/cross-generation-events må ikke øge
  kapacitet; 429 er terminal uden retry; diagnostiklås, $5-loft, SafeEval-isolation og
  nul rigtig HA/MCP-effekt bevares.
- **Falsificerbar hypotese:** på samme socketgeneration uden pending eller aktiv næste
  response er en gyldig, event-id-bærende token-rate-event efter én completed response
  det nyeste absolutte providersnapshot. Den må ikke kaldes response-id-kausal, men kan
  sikkert forankre ledgeren nedad og dermed forhindre false-admission. Den eksisterende
  generelle `late_after_done`-afvisning kasserer dette strengere snapshot. Hvis et nyt
  response allerede er registreret som pending/created, er samme placering tvetydig
  og skal fortsat afvises; en præcis aktiv response beholder den eksisterende
  starttelemetri-seam. Under en endnu uafsluttet capacity-wait er snapshotten fortsat
  nedadgående input til den obligatoriske atomiske recheck.
- **Påkrævede regressioner:** eksakt `done → 38,21 ms → valid rate → target 9396`
  skal forankre `remaining=5204`, vente/rechecke og sende præcis én response; den samme
  late event med næste pending/created skal være `ambiguous_previous_or_next` og inert.
  Duplicate, gammel generation og event efter close er inerte; usage og snapshot må
  ikke dobbeltdebitere; provider-429 forbliver terminal uden wire-retry. Rapportens
  positionslabel skal være sand og må ikke kaldes response-id-kausal.
- **Rollback og ikke-mål:** ved uafklaret association beholdes terminal NO-GO frem for
  fast margin, blind ventetid eller retry. Prompt V6, model, lyd, gain, VAD, firmware,
  playback, Thin-lifecycle, HA/MCP og værktøjspolitik er frosne. Implementeringen må
  kun ændre rate-eventens entydige late-completion-seam, ledger-anchor og tilhørende
  bounded observations-/regressionstests.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.** En
completed response åbner nu en generationsbundet engangsseam for ét gyldigt,
event-id-bærende token-snapshot, men kun mens der ikke er en nyere registreret
`response.create` eller en aktiv response. Snapshotten mærkes fortsat positionelt
`late_after_done`, tilskrives ikke retroaktivt til den completed eller næste response
og kan kun stramme den atomiske ledger: remaining, limit og refill-hastighed kan aldrig
stige. Seamen forbliver åben gennem en eventuel capacity-wait, så dens obligatoriske
slutrecheck ser en snapshot, der ankommer under ventetiden; den lukkes atomisk før
request-registrering og wire-I/O. Når en deferred tool-result-response oprettes inde i
selve provider-readeren, kan readeren ikke samtidig konsumere den allerede kølagte
snapshot. Den eval-eksklusive admission klemmer derfor den uobserverede completion-
kapacitet til nul og bruger den samme bounded refill-wait plus slutrecheck; den gætter
ikke en millisekundventetid og ændrer ikke produktionsvejen. Første gyldige snapshot
forbruger seamen; exact/different duplicate,
non-completed status, pending create, sendefejl, korreleret 429, stale generation,
close/reconnect og teardown er inerte. En præcis aktiv response beholder den eksisterende
starttelemetri, så senere responses ikke dobbeltdebiteres.

Den eksakte feltregression debiterer først usage 5.812 til lokal remaining 15.269,
modtager 38,21 ms senere snapshot 5.204/reset 52,193, venter atomisk på target 9.396,
rechecker og sender præcis én `response.create`; der er ingen retry. Højere observeret
limit kan ikke hæve hverken øjeblikkelig kapacitet eller fremtidig refill, mens et lavere
limit strammer begge. En særskilt rå inline-regression beviser `done → fast tool-result
→ late rate kølagt bag readeren → konservativ wait/recheck → præcis én create`; den
senere læste rate mærkes sandt som tvetydig og kan ikke finansiere requesten bagud.
Frosne lokale gates efter den sidste safetyrettelse: **304/304 focused**, scoped Ruff
check og format, scoped mypy og `git diff --check` grønne. Den ubegrænsede full suite,
uafhængigt review, versionering,
CI/ARM64, installation og én frisk SafeEval er fortsat åbne; kandidaten er derfor
fortsat NO-GO for fysisk golden chain.

### Feltstop 23. august — v1.13.33 afviste schema-ugyldig HA-domain før effekt

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787489397-3f58f2` gennemførte arithmetic-, time-, semantic-close-,
web- og sensitive-approval-forløbene uden 429 eller rigtig ekstern effekt. I
`low-risk-action-then-close` genererede modellen et `HassTurnOn`-kald med
`domain: "light"`, mens den aktuelt annoncerede Home Assistant-deklaration kræver en
array. Runtime afviste derfor kaldet før `ToolCall`, SafeEval-fixture og enhver rigtig
HA/MCP-dispatch med: `tool arguments failed schema at domain: 'light' is not of type
'array'`. Diagnostiklåsen blev frigivet; fysisk test blev ikke startet.

- **Berørte invarianter:** modelargumenter er altid utroværdige; deklareret schema og
  runtimevalidering skal være samme kontrakt; en schema-korrektionsrunde må aldrig
  dispatches som værktøj eller udvide mål, domæner eller effekt; SafeEval må kun acceptere eksplicitte,
  schema-gyldige fixturevarianter; fejl må give nul rigtig effekt, ingen automatisk
  transport-/provider-retry og højst én bounded schema-korrektion.
- **Falsificerbar hypotese:** GPT-Realtime-2.1 understøtter function calling, men ikke
  Structured Outputs, så schema-ugyldige argumenter kan forekomme. Prompt V6 tillader
  én schemafejlskorrektion, men runtime kasserer i dag det ugyldige kald terminalt uden
  et sanitiseret `function_call_output`; modellen får derfor ingen mulighed for den
  lovede korrektion. Samtidig er eval-fixturen forkert modelleret: “lyset i stuen” er
  et områdekald og skal bruge `area: "stuen", domain: ["light"]`, ikke
  `name: "stuen"` som om rummet var én entitet.
- **Påkrævet regression:** admission accepterer kun den eksakte schema-gyldige
  område-fixture og afviser scalar-domain som canonical fixture. Et råt ugyldigt
  modelkald giver nul `ToolCall`/fixture/rigtig effekt og højst én sanitiseret
  schema-korrektionsresponse til samme call-id under de eksisterende capacity-, ACK-,
  deadline- og $5-gates. Et efterfølgende korrekt array-kald udføres præcis én gang før
  completed-gated `end_conversation`; andet ugyldigt, stale/duplicate/cross-response,
  cancel eller 429 stopper terminalt uden yderligere retry. Thin og SafeEval skal dele
  samme Realtime-kontrakt, og udtømt korrektion klassificeres som model-/tool-contract-
  fejl, ikke providerudfald. Full suite, Ruff, mypy, uafhængigt review, nyt CI/ARM64 og
  installation kræves før én ny live-kørsel.
- **Rollback og ikke-mål:** behold streng schemaafvisning frem for coercion,
  schema-løsning, promptændring eller løs fixturematching. Prompt V6, model, lyd, gain, VAD, firmware,
  playback, Thin-lifecycle, HA/MCP-discovery og fysisk adfærd er frosne.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.** Den fælles
Realtime-provider udsender nu en særskilt `ToolSchemaCorrection` kun for ét enkelt,
deklareret, ikke-reserveret schema-ugyldigt kald i en completed response med gyldig
usage og kapacitet. Eventet er aldrig et `ToolCall`: Thin og SafeEval returnerer ét
bounded, sanitiseret `function_call_output` på samme call-id uden adapterdispatch,
kasserer eventuel værktøjspreamble og lader den næste schema-gyldige proposal passere
de normale commit-, policy-, approval-, ACK- og capacity-gates. Andet ugyldigt kald,
blandet batch, lifecycle-/approvalværktøj, eval-følsom fixture, manglende kapacitet,
429, ACK-fejl eller teardown stopper terminalt. Den normale tre-kants turngrænse får
kun én mekanisk fjerde kant, når den typede korrektion faktisk er observeret; pris- og
deadlinebudgettet reserverer konservativt denne mulighed på forhånd.

SafeEval-rumtesten bruger nu den produktionsrealistiske fixture
`{"area":"stuen","domain":["light"]}`. Den følsomme `EvalUnlockDoor`-deklaration er
uændret låst til påkrævet `{"name":<string>}`. Regressionen gennemfører den fulde
syntetiske sekvens ugyldig scalar → sanitiseret korrektion → gyldigt `HassTurnOn` →
`end_conversation` → farvel med fire reelle providerkanter, præcis én lokal
fixtureeffekt og nul rigtig HA/MCP-effekt. Preamble, duplicate/output-item-rækkefølge,
mixed batch, anden fejl, capacity/429, ACK, teardown, reset og shared Thin-adapter er
dækket. Frosne gates: **255/255 focused**, **802/802 unrestricted full** inklusive
HTTP/WebSocket, Ruff check og format grønne for 91 filer, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Den resterende usikkerhed er kun feltadfærd: GPT-Realtime-
2.1 skal på eksakt bygget artifact faktisk bruge den ene korrektion og fuldføre hele
Prompt V6-profilen. Installeret v1.13.33 forbliver NO-GO; næste gate er versionering,
CI/ARM64, installation og præcis én ny sideeffektfri live-preflight.

### Feltstop 23. august — v1.13.32 mangler rate-snapshot-proveniens

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787486814-7a4d94` bestod `arithmetic-followup` i samme session med
svarene 84 og 90 og korrekte topniveauer. I `time-followup` gennemførte modellen fem
responsekanter og valgte kun den lokale `get_time`-fixture. Den sjette kant blev
afvist med `TPM limit=40000, used=35073, requested=5757, retry=1,245 s`.

- De to gemte arithmetic-responses havde provider-total 5.533 og 5.566, og begge
  havde `residual=0`. Runtime-loggen viste desuden fem completed time-responses med
  totalsummerne 5.623, 5.613, 5.676, 5.709 og 5.774; alle havde `residual=0`.
- Rapporten sluttede korrekt som `diagnostic-capacity`, `coverage_complete=false`,
  uden retry eller næste scenarie. Den viste 33.720 faktisk registrerede tokens,
  $0,0561008 og 55,666 sekunders pacingventetid. Dette budgettal udelader usage fra den
  afbrudte tur og kan derfor ikke sammenlignes direkte med providerens `used=35073`.
- Ingen rigtig HA-, MCP-, PodConnect-, musik- eller timerhandling blev udført. Den
  eksklusive diagnostiklås blev frigivet terminalt; fysisk wake/rearm er ikke bevis.
- **Falsificeret hypotese:** De gemte responses viser, at topniveau-minus-detaljer
  ikke forklarer afvigelsen på disse kanter. Rettelsen af den officielle usage-kontrakt
  forbliver nødvendig, men er ikke tilstrækkelig til en grøn fuld preflight.
- **Uafklaret kausalitet:** v1.13.32 loggede ikke de rå `rate_limits.updated`-
  tokenfelter eller deres before-created/active-rækkefølge, og den afbrudte scenario-
  observation blev ikke gemt. OpenAI-eventet har intet response-id. Feltbeviset kan
  derfor endnu ikke skelne mellem forkert lokal snapshot-association, providerens
  interne completion-justering, nylig/ekstern samme-nøgletrafik eller en ufuldstændig
  lokal rapportaggregation.
- **Berørte invarianter:** hver responsekant skal admitted kausalt; providerfejl og
  budgettilstand skal være revisionsbare; ingen 429 må skjules med retry; afbrudte
  scenarier må ikke kassere det evidensspor, der kræves for årsagsanalyse; ingen
  diagnostisk fixture må nå en rigtig adapter.
- **Næste afgrænsede ændring:** tilføj bounded, sanitiseret per-edge proveniens med
  monotontid, response-id, created/done, rå token-limit/remaining/reset, ledger før/
  efter, parsed usage-total, admission target/wait og terminal provider used/requested/
  retry. Gem også den afbrudte partial observation. Ændr ikke pacingmatematikken ud fra
  denne kørsel; en ny live-kørsel må først ske efter frozen tests/review/CI/ARM64.
- **Rollback og ikke-mål:** behold terminal NO-GO frem for fast buffer, blind ekstra
  ventetid eller automatisk retry. Prompt V6, model, lyd, gain, VAD, firmware,
  playback, Thin-lifecycle, HA/MCP og værktøjspolitik er frosne.

**Lokalt instrumenteringsresultat, endnu ikke versioneret/bygget/installeret/live.**
Ingen pacingberegning eller provideradmission er ændret. Eval-only tracing gemmer nu
højst 128 sanitiserede, monotont ordnede rækker per tur: atomic capacity-check/wait/
recheck, pre-wire/sent request-id, created response-id og request-match, positional
rate-event med rå gyldige tokenfelter, pending-count/ids, duplicate/ambiguous/late-
klassifikation, done-status/usage/rate-count og strukturerede 429-tal uden rå
providertekst. Recorderens fravær eller fejl ændrer ikke wire, pacing eller terminal
adfærd; Voice PE/Talk bruger de oprindelige ikke-allokerende budgetveje.

Failed, timeoutede og pre-wire-afbrudte ture bærer deres bounded partial observation
ind i rapporten. Dermed gemmes alle fem completed `time-followup`-kanter og deres lokale
fixture-outcomes før en sjette 429. Den nye rapport viser særskilt completed trace-total,
budget-total og forskellen. Dette retter også feltfortolkningen: `33720` var arithmetic
`11099` plus kun de første fire time-kanter `22621`; den femte completed kant `5774`
blev kasseret af den gamle fejlrapport. Alle completed responses før 429 summerede
derfor til `39494`, så `35073-33720=1353` var en sammenligning af forskellige
populationer og er **ikke** et bevist provider/lokalt gap. Selve false-admission er
fortsat uafklaret, indtil de nye rate-/ledger-rækker findes fra eksakt installerede bits.

Frosne lokale gates: **160/160 focused**, **790/790 unrestricted full** inklusive lokale
HTTP/WebSocket-integrationer, Ruff grøn, mypy grøn for 42 sourcefiler og
`git diff --check` grøn. Uafhængigt adversarial review finder ingen åben P0/P1 i denne
instrumenteringsslice, men scorer den 94/100, fordi root cause og pacing bevidst ikke er
ændret. Kandidaten er fortsat NO-GO for fysisk test indtil version/build/CI/ARM64,
installation og en ny SafeEval-trace er uafhængigt vurderet.

### Feltstop 23. august — v1.13.31 forklarede ikke hele providerens rullende forbrug

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
v1.13.31 startede korrekt med Voice PE, 19 HA/MCP-værktøjer og vellykket
`GetLiveContext`. SafeEval `eval-1787484610-a49ab1` fastholdt Prompt V6/default og de
forventede schemahashes. `arithmetic-followup` bestod begge ture i samme
Realtime-session med svarene 84 og 90. En senere sideeffektfri værktøjsopfølgning blev
afvist af OpenAI med `TPM limit=40000, used=35743, requested=5692, retry=2,152 s`.

- Rapporten klassificerede fejlen som `diagnostic-capacity`, satte
  `coverage_complete=false` og fortsatte ikke til næste scenarie. Lokalt registreret
  forbrug var 33.455 tokens, $0,065332 og 55,073 sekunders pacingventetid.
- Forskellen mellem providerens `used=35743` og det lokale `actual_tokens=33455` er
  **2.288 tokens**. Den forrige kontinuerlige refill rettede epoch-jump-fejlen, men
  feltbeviset falsificerer, at completed-response-usage alene beskriver hele den
  kapacitet, providerens næste responsekant reserverer imod.
- Ingen rigtig HA-, MCP-, PodConnect-, musik- eller timerhandling blev udført:
  `/api/status` viste efter stop `diagnostic_active=false`, 0 sessions, 0 tool calls og
  HA/MCP oppe med 26 deklarationer. Voice PE blev frigivet; fysisk wake/rearm er ikke
  brugt som bevis i denne maskinelle kørsel.
- **Berørte invarianter:** providerfejl skal være kausalt korrelerede og synlige;
  eval må ikke skjule 429 med retry; hver klientstyret `response.create` skal være
  sikkert admitted; diagnostiklåsen skal frigives terminalt; diagnostiske fixtures må
  aldrig nå rigtige adaptere; maskinelt grønt må ikke udledes af et delvist scenarie.
- **Falsificerbar hovedhypotese:** Realtime-providerens rullende TPM-regnskab omfatter
  reservation/overhead, som ikke findes i den lokale sum af `response.done.usage`,
  eller den lokale debit/refill binder en autoritativ snapshot til den forkerte
  responsekant. Før rettelse skal rå feltevents og officiel kontrakt skelne mellem
  outputreservation, cached/input-usage, protokoloverhead og ekstern samme-nøgletrafik.
- **Påkrævet regression:** reproducer `used=35743`, lokal completed usage 33.455,
  `requested=5692` og 2,152 s uden at gætte en fast margin; bevis atomic admission ved
  hver initial og deferred tool-result-responsekant, korrekte before/active/late/
  manglende rate-events, flere efterfølgende debits, timeout/teardown og nul wire-send,
  fixtureeffekt eller retry ved utilstrækkelig kapacitet. En ny live-kørsel må først
  ske efter frozen focused/full/lint/mypy, uafhængigt review og nyt CI/ARM64-artifact.
- **Rollback:** v1.13.31 forbliver installeret men live-preflight må ikke genkøres og
  fysisk golden chain må ikke begynde. Ved usikker årsag bevares terminal 429 og den
  sideeffektfrie NO-GO i stedet for at sænke gaten eller tilføje en blind buffer.
- **Frosne ikke-mål:** Prompt V6, model, lyd, gain, VAD, firmware, playback,
  Thin-lifecycle, HA/MCP-discovery og produktionsværktøjspolitik ændres ikke.

**Lokalt implementeringsresultat, endnu ikke versioneret/bygget/installeret/live-kørt.**
Den officielle Realtime-kontrakt gør topniveauets `total_tokens`, `input_tokens` og
`output_tokens` til den samlede usage for en completed response. Den hidtidige parser
ignorerede disse felter og summerede kun tekst-/lyddetaljer. Parseren kræver og
validerer nu ikke-negative heltal, `total=input+output`, at topniveauet ikke er mindre
end detaljerne, og at cached er en delmængde. Providerledger, responsekapacitet og
SafeEvals faktiske tokenloft bruger `total_tokens`; modalitetsdetaljer bevares til pris,
og en uklassificeret input-/outputrest prises konservativt med den dyreste relevante
modalitet. Image-input kan ikke forsvinde fra prisloftet.

Hver eval-response gemmer nu et sikkert observationsobjekt med response-id,
topniveauets tre totalsummer, detaljesum og input-/outputrest i rapporten og en
tilsvarende sanitiseret loglinje. Den gamle v1.13.31-rapport gemte ikke topniveauet, så
de 2.288 tokens er **ikke retrospektivt bevist** som denne rest; ekstern samme-nøgle-
trafik eller anden providerbaseline er fortsat en falsificerbar alternativ forklaring.
Den næste live-kørsel kan nu skelne dem per response.

Rå regressioner beviser blandt andet: detaljesum 33.455/topniveau 35.743 og næste kant
5.692 giver præcis `(35743+5692-40000)/(40000/60)=2,1525 s` plus den eksisterende
50 ms grænsemargin og præcis én wire-send; malformed/manglende/modstridende totalsummer
fejler lukket; topniveau større end detaljesummen kan ikke frigive en staged
værktøjseffekt uden kapacitet til resultatet; duplicate completion debiterer ikke igen;
en budgetejet direkte produktionsresponse uden gyldige topniveauer fejler terminalt,
så en senere tur ikke kan admitted på stale kapacitet; residual, cached og image
dobbelttælles ikke og bliver ikke gratis. Focused-, full-, Ruff- og mypy-gaten er nu
kørt: **221/221 focused**, **772/772 unrestricted full**
inklusive lokale HTTP/WebSocket-integrationer, Ruff grøn, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Uafhængigt adversarial review, versionering, CI/ARM64-build,
installation og en frisk fuld live-eval er fortsat åbne gates; kandidaten er derfor
fortsat NO-GO for fysisk golden chain.

### Feltstop 23. august — v1.13.30 preflight ramte TPM på en responsekant

**Observeret, ingen automatisk retry.** Add-on-kataloget leverede v1.13.30, og den
installerede kandidat startede korrekt: loggen viste versionslinjen, 19 atomisk
admitterede HA/MCP-værktøjer, et vellykket `GetLiveContext` og en godkendt Voice PE-
firmwarekontrakt. Den eksplicit startede SafeEval `eval-1787479390-7aa3ed` tog den
nøglebrede diagnostiklås og frigav den igen terminalt.

- Prompt V6/default og de effektive, produktions- og reserverede schemahashes blev
  fastholdt i rapporten. Første scenarie `arithmetic-followup` bestod begge ture med
  svarene 84 og 90, samme Realtime-session og typet usage.
- Næste scenarie valgte det lokale SafeEval-værktøj `get_time` på completed
  responsekanter. Ingen rigtig HA-, musik- eller timerhandling blev udført.
- En efterfølgende `response.create` blev afvist med
  `TPM limit=40000, used=34805, requested=5769, retry≈861 ms`. Kørselen klassificerede
  det som `diagnostic-capacity`, satte `coverage_complete=false`, stoppede før næste
  tur/scenarie og genforsøgte ikke.
- Faktisk registreret forbrug før stop var 33.792 tokens og **$0,0772896**, langt under
  det prospektive $5-loft. Den fulde profil for web, approvals, værktøjsrækkefølge og
  semantisk close blev ikke gennemført og giver derfor ikke 97/100.
- **Falsificerbar regressionshypotese:** Den lokale reset-aware pacing tillod flere
  produktionsformede responsekanter i samme scenariesession tættere end providerens
  rullende TPM-vindue kunne bære. Den eksakte feltsekvens er flere completed
  `get_time`-beslutning/resultatkanter efter den synlige resetventetid, derefter 429 på
  næste result-response med kun 574 tokens over loftet. Før ny live-kørsel skal en rå
  regression bevise pacing før hver responsekant i samme session, inklusive
  tool-resultat/follow-up, uden at acceptere 429 eller indføre automatisk retry.
- **Frosne ikke-mål:** Prompt, model, lyd, gain, VAD, firmware, playback,
  Thin-lifecycle, HA/MCP-discovery og produktionsværktøjspolitik ændres ikke ud fra
  denne kapacitetsfejl.

**Lokalt implementeringsresultat, endnu ikke versioneret/installeret/live-kørt.** Den
eksakte feltmatematik viste et rullende token-bucket-problem: `34805 + 5769 - 40000 =
574`, og `574 / (40000/60) = 0,861 s`. Providerledgeren refiller derfor nu kontinuerligt
med det dokumenterede TPM-loft/60 på hvert monotont read/debit; en gyldig
`rate_limits.updated` forankrer remaining, men `reset_seconds` bruges aldrig som slope.
En eval-only callback genbekræfter atomisk den fulde eller kontekstafledte kapacitet ved
den sidste lokale grænse før **hver** klientstyret `response.create`, inklusive normal,
hurtig og deferred tool-result/follow-up. Den genbruger ikke completed edges og retryer
ikke en 429. En planlagt refillventetid vækkes ind i collectorens private mekanik, så den
er uden for 20-sekunders semantisk timeout, men fortsat inden for kørselsdeadline og
synlig `rate_limit_wait_s`. Worst-case-deadlinen følger nu alle 36 mekanisk mulige
responsekanter og vises dynamisk som omtrent 41 minutter; normalprofilen forventes
kortere.

Rå regressioner dækker feltets 574-token underskud, officiel near-full/reset-permutation,
senere debits uden epoch-jump, valid rate før/under response, malformed/manglende og
unsolicited late rate, initial og tool-result-create, fast og normal tool-marker-
rækkefølge, atomic recheck-fejl uden wire-send, timeout-credit og stale target ved close.
Resultater på det frosne lokale træ: **201/201 focused**, **599/599 non-socket** og
**753/753 fuldt testsæt** grønne; Ruff, mypy for 42 sourcefiler og `git diff --check` er
grønne. Der er ikke kørt live API, installeret, committed eller pushed. Kandidaten er
fortsat **NO-GO** indtil uafhængigt adversarial review, byg/CI og én ny rigtig Prompt
V6-live-preflight på de præcise byggede bits; fysisk golden chain følger først derefter.

### Feltstop 22. august — v1.13.29 havde en unødvendig separat providerprobe

**Observeret fejl og daværende lead-beslutning.** Den installerede v1.13.29 afsluttede
preflight før semantisk eval, fordi en ekstra throwaway Response ikke modtog den
forventede `rate_limits.updated`. Feltsekvensen var `session.updated` →
`response.created` → samme `response.done(completed)` uden en logget gyldig rate-event.
Det falsificerer rate-telemetri som obligatorisk cold-admission-autoritet.

- **Valgt safety-model:** Den separate providerprobe, probelease, probesocket,
  proberapport og probepris fjernes helt. Første rigtige, sideeffektfrie semantiske
  evalrespons er providerpreflight og bruger den eksakte produktionsprompt, hele det
  frosne schema og kun `SafeEvalTools`. `rate_limits.updated` er valgfri pacingtelemetri.
- **Mekaniske grænser:** Den nøglebrede, modeluafhængige diagnostiklås, et nyt lokalt
  40.000-token/60-sekunders vindue per diagnostik/model, completed response med typet
  usage på hver kant, causal tool-resultatkapacitet, højst tre responsekanter per tur,
  hard deadline og prospektivt $5-loft. Gammel providertelemetri genbruges ikke.
- **Hele kæden:** panelstart → diagnostiklås → prompt/schema/fixtureadmission → første
  semantiske evalsession → første `response.create` → optional rate-event → completed
  `response.done` med typet usage → fortsat scenario eller terminal diagnostik. Der
  findes ingen ekstra providerresponse før den faktiske assistenttest.
- **Fail-closed:** Manglende/malformed usage, timeout, ikke-completed response og
  provider-429/capacity stopper hele kørslen før næste tur, scenarie eller efterfølgende
  fixtureeffekt. Eval-fixtures er lokale og kan ikke skabe en rigtig ekstern effekt;
  der er ingen automatisk retry. Alle leases frigives terminalt.
- **Ikke-mål:** Prompt, model, lyd, VAD, firmware, playback, Thin-lifecycle, HA/MCP og
  produktionsværktøjspolitik ændres ikke. Kandidaten er NO-GO, indtil frozen focused,
  full, lint, mypy, uafhængigt review, CI/ARM64 og rigtig Prompt V6-live-eval er bevist.
- **Faktisk lokal korrektion og resultat:** Throwaway-API, probelease, probesocket,
  probepris og proberapport er slettet. Første semantiske response ejer preflighten.
  Exact diagnostic-owner, tværmodelserialisering, completed+usage uden rate-event,
  malformed/manglende usage, 429, timeout/non-completed, reset og terminal release er
  dækket. Provider/eval/panel-fokus er **141/141**, hele repoet **742/742**, Ruff,
  formattering, scoped mypy og diff-check er grønne. Uafhængigt frozen review fandt
  ingen åben P0/P1; CI/ARM64 og rigtig Prompt V6-live-eval står fortsat åbne, så
  kandidaten er stadig NO-GO for fysisk test.

### Feltstop 22. august — v1.13.28 live-preflight og HA-readiness

**Dette er observerede resultater og daværende beslutning før rettelse.** Der må ikke køres
flere blinde preflight-genforsøg eller fysisk golden chain på v1.13.28.

- Første sikre providerbudget-probe sluttede som
  `rate_limit_capacity · provider budget probe response did not complete (incomplete)`.
  OpenAIs officielle kontrakt begrænser `incomplete` til `max_output_tokens` eller
  `content_filter`. PodVoice parsede den konkrete `status_details.reason`, men
  eval-harnessen og runtime-loggen kasserede den, så den afsluttede kørsels eksakte årsag
  kan ikke rekonstrueres. Proben var sideeffektfri og brugte ingen HA-/MCP-værktøjer.
- Proben var hårdt begrænset til otte outputtokens. Den falsificerbare hovedhypotese er,
  at GPT-Realtime-2.1 brugte tokenloftet, inklusive eventuelle reasoningtokens. En ny
  instrumenteret probe med et fortsat lille, eksplicit loft skal vise den autoritative
  reason; `content_filter` skal fortsat fejle lukket.
- Et efterfølgende eksplicit run fik en completed probe og åbnede den rigtige eval, men
  endte senere med `provider token headroom is insufficient for eval plus production`.
  Loggen viser flere completed evalresponser og derefter en response uden synlig terminal
  kant. Dette må ikke klassificeres som blot pacing eller saldo, før den præcise
  response-/budgetkæde er korreleret og watchdogens slutresultat er bevist.
- Standardprofilen har syv friske scenariesessioner. Med den dokumenterede Tier-1-
  guard kræver seks mulige resetmellemrum alene mindst cirka 363 sekunder, mens v1.13.28
  afslutter hele kørslen efter 300 sekunder. Det er en deterministisk deadlinefejl.
  Alle scenarier bevares; kandidaten skal bruge autoritative resetkanter og et beregnet,
  synligt hard-limit, der også indeholder turn- og connect-timeouts. Ingen grøn profil
  opnås ved at springe scenarier over.
- Budgetleasen på 15.000 tokens er i v1.13.28 både sessionslås og kumulativ beholdning.
  Hver completed respons trækker fra den gennem hele samme Realtime-socket, og en
  provider-reset fylder den ikke op. En legitim sekvens som direkte svar → værktøj →
  værktøj/farvel kan derfor ramme 6.000-token-resultatgaten, selv når providerens nye
  vindue har rigelig kapacitet. Rettelsen skal adskille eksklusivt sessionsejerskab fra
  per-response rolling headroom; ingen sideeffekt frigives uden kausalt reserveret
  kvitterings-/farvelkapacitet.
- Ved samme add-on-opstart returnerede Home Assistants Supervisor/Core MCP- og
  service-endpoints HTTP 502. Panelets manglende hjem/web/vejr er derfor et sandt
  øjebliksbillede af den nye sessions værktøjsliste, men **ikke** bevis for forkert
  eksponering eller permanent manglende integration. Automatisk MCP-recovery og
  readiness-sandhed auditeres separat; ingen HA-konfiguration ændres blindt.
- **Berørte invarianter:** eval må være sideeffektfri og må aldrig overlappe en
  produktionssession på den delte providerpulje; providerfejl skal være korrelerede og synlige; kun aktuelt opdagede
  deklarationer må kaldes; HA-recovery må ikke kræve add-on-/Voice PE-genstart.
- **Frosne ikke-mål:** produktionsprompt V6, model, lyd, gain, VAD, firmware, playback,
  semantisk afslutning, timeout, teardown og rearm ændres ikke i korrektionen.
- **Accept før ny live-kørsel:** rå tests for begge incomplete-reasons, præcis
  response-/usage-korrelation, nul semantiske trials og nul værktøjseffekt ved probe-
  fejl, bounded eksplicit genkørsel, autoritativ reset-aware pacing samt et matematisk
  tilstrækkeligt og stadig hårdt samlet tidsloft for hele syv-scenarieprofilen.
  HA-fejlen kræver en separat recovery-regression fra den observerede 502-rækkefølge.
- Før cold-proben må de valgte scenariers eksakte produktionsværktøjer og kanoniske
  fixtureargumenter valideres mod det frosne deklarationssnapshot. Manglende, omdøbt,
  duplikeret eller schema-inkompatibelt værktøj giver en struktureret capability-block
  med nul providerforbrug. Der må ikke bruges løse navnehints, syntetiske
  produktionstools, stille scenario-skip eller rigtige HA-sideeffekter for at gøre
  preflight grøn.

#### Lead-beslutning — live-preflight er eksklusiv diagnostik

- **Falsificeret designantagelse:** Et lokalt 15.000-token "produktionsheadroom" kan
  ikke garantere en samtidig fysisk Realtime-session, når providerens egen reservation
  for en produktionsformet evalrespons allerede har reduceret `remaining` under dette
  niveau. At afbryde evalen bagefter kan forhindre sideeffekter, men kan ikke tilbageføre
  providerens allerede brugte input-/outputkapacitet.
- **Valgt kontrakt:** Den manuelt/eksplicit startede live-preflight ejer én bounded,
  gensidigt eksklusiv diagnostiklease. Den må kun starte, når ingen Voice PE-/Talk-
  session er aktiv. Nye produktionssessioner under kørslen afvises straks med præcis
  `diagnostic_busy`, følger den normale fejl-teardown og rearmes én gang; de køer eller
  konkurrerer aldrig skjult med evalen. Panelet viser, at Nabu testes og ikke er fysisk
  klar. Leasen frigives ved success, fejl, timeout, klientafbrydelse og add-on-stop.
- **Hvorfor:** Med samme OpenAI-projekt/rate-limit-pulje findes ingen lokal mekanisme,
  der kan bevise øjeblikkelig produktionskapacitet efter en vilkårligt stor provider-
  reservation. Sand parallel drift kræver en separat evalprojekt-/nøglepulje og er et
  senere selvstændigt designvalg; den opfindes ikke i denne kandidat.
- **Berørte invarianter:** én provider-ejer ad gangen; eval er sideeffektfri; fysisk
  wake må aldrig blive hængende; teardown/rearm er exactly-once; readiness er sand.
  Prompt, model, audio, gain, VAD, firmware, playback og semantisk close forbliver
  frosne.
- **Obligatoriske regressioner:** aktiv produktion → eval nul sockets; aktiv eval →
  Voice PE og Talk får `diagnostic_busy`, nul provider-connect og én ren rearm/fejl;
  eval success/fejl/timeout/cancel/add-on-stop frigiver låsen; næste wake virker; ingen
  HA/MCP/PodConnect-sideeffekt; UI viser aldrig fysisk klar under diagnostik.

#### Historisk recovery-beslutning — HA/MCP efter Supervisor-start

- **Årsagen er nu feltbekræftet:** Den uændrede installerede v1.13.28 genvandt selv
  forbindelsen ved det gamle ti-minutters probeinterval. Loggen viser 502-svar kl.
  10:04:55 og derefter kl. 10:15:03 successfuld initialize (200), notification (202),
  `tools/list` (200), 19 HA-værktøjer samt et vellykket `GetLiveContext`; panelets
  runtime havde derefter 26 deklarationer inklusive PodConnect og
  `google_web_sogning`. Integration og eksponering manglede altså ikke. Fejlen var et
  transient Supervisor/Core-opstartsvindue, som den gamle 600-sekunders retry gjorde
  synligt i ti minutter.
- **Falsificerbar årsag:** Hvis de observerede 502-svar er et kort Supervisor/Core-
  opstartsvindue, skal hurtige, begrænsede discovery-genforsøg hente samme konfigurerede
  Assist/MCP-værktøjer uden add-on- eller Voice PE-genstart. Fortsætter 502 efter
  backoffvinduet, skal panelet vise det aktuelle endpoint, sidste fejl og næste forsøg;
  det må ikke påstå, at integrationen mangler.
- **Valgt mekanik:** Discovery ejer ét generationsbundet snapshot. Fejl forsøges igen
  efter omtrent 1, 2, 5, 10 og 30 sekunder og derefter højst én gang pr. minut. Et
  succesfuldt komplet `tools/list` erstatter snapshot atomisk for **næste**
  Realtime-session; en allerede åben session beholder sit accepterede schema. Der
  oprettes ingen parallel samtalemotor eller HA Assist-samtale.
- **Degraded sandhed:** Den aktuelle installation hoster web, HassMedia og PodConnect-
  data bag HA/Supervisor. Under et HA-udfald kan kun samtalen, lokal tid og lokale
  timere garanteres. Nye sessioner får local-only, indtil recovery lykkes; gamle
  deklarationer udføres ikke blindt. `PRODUKTMÅL` er præciseret tilsvarende. Uafhængig
  drift for web/musik kræver senere egne adapters og er ikke en skjult del af denne
  rettelse.
- **Naborisici:** samtidige refreshes, stale succes efter nyere fejl/succes,
  add-on-teardown under backoff, forkert MCP API-id/endpoint, delvis tool-liste,
  tidligere succes vist grøn mens værktøjet nu er væk, og timertekst fejlklassificeret
  som musik. Readiness skal vise generation, hentet-tid, endpoint/API-id, seneste fejl
  og retrytilstand.
- **Regressioner før resultat:** den eksakte `502, 502, succes`-sekvens; vedvarende 502
  med bounded tidsplan; stop/teardown uden lækket task; stale/overlappende svar; aktiv
  session uændret mens næste session får nyt snapshot; nuværende fravær må ikke blive
  grønt af gammel historik; lokale timere må ikke tælle som musik.
- **Rollback:** Recoverybølgen er add-on-only og må rulles tilbage samlet. Ved én
  schema-/sessionmutation eller retry-loop beholdes v1.13.28's konservative degraded-
  visning frem for at kræve manuel HA-konfigurationsændring eller genstart som produktvej.

- **Observeret fejl:** Trace `20260821T103257-225` havde diagnostisk “Hvad er
  klokken?”, men Realtime kaldte intet værktøj og gav et irrelevant fysisk svar.
- **Stærkeste evidens:** Korreleret Voice PE-trace med device-/provider-/speakerlyd,
  playback-finish, teardown og rearm. Den diagnostiske tekst beviser ikke, hvad den
  native audiomodel forstod.
- **Hel kæde under audit:** Fysisk wake → mic-latch/device-PCM → provider-PCM →
  accepteret Realtime-session/prompt/værktøjsskema → modelbeslutning → FLAC-playback →
  ekkogate → idle/semantisk close → teardown/rearm → næste wake.
- **Falsificerbar hypotese:** Et fremtidigt replay med OpenAIs egne VAD-grænser, samme
  dokumenterede værktøjsskema og et delt TPM-budget kan afgøre, om fejlen følger lyden
  konsekvent eller varierer i modellen. Den nuværende replay kan kun give diagnostik.
- **Nærliggende fejlveje:** Forkert lydudsnit, ændret værktøjsskema, eval-sideeffekt,
  schema-overload, TPM/rate-limit, stale trace, forkert rumkontekst og forveksling af
  providerbevis med fysisk puckbevis.
- **Frosne ikke-mål:** Promptens almindelige V6-adfærd, model, gain 16, VAD, noise, firmware,
  announcement-playback, semantisk afslutning, timeout, teardown og rearm ændres ikke.
- **Faktisk ændring i v1.13.27-kandidaten:** Providerens tool-kandidater frigives kun
  efter en korreleret, completed respons; schemas og ACKs valideres fail-closed;
  følsomme handlinger kræver en server-ejet, næste-tur-bundet engangsgodkendelse;
  HA-mål opløses frisk og dispatches som det samme kanoniske mål; og ét fælles
  providerbudget beskytter tool-resultat/farvel mod TPM-udtømning. Prompt V6 ændrer kun
  den minimale approval-protokol. Audio, gain, VAD, firmware og playback er uændrede.
- **Maskinel evidens:** 634/634 tests, Ruff, format, mypy og diff-check er grønne efter
  cold-start- og response-korrektionsbølgen. GitHub CI-run `32482026582` bestod på
  commit `2c09042`, inklusive den komplette `linux/arm64` add-on-containerbuild.
- **Uafhængig review:** NO-GO for replay som beslutningsbevis. De nuværende
  `provider_sample_offset` afspejler tidspunktet, hvor eventet behandles, ikke OpenAIs
  autoritative `audio_start_ms`/`audio_end_ms`; den kendte v1.13.25-trace mangler
  værktøjsskema-hash; og evalens TPM-pacing er ikke koordineret med aktive fysiske
  sessioner. Installation alene er GO som reversibel diagnostik uden firmwareændring.
- **Afvigelse fra planen:** Panelet kan vise et bestået audio-replay, selv når
  `schema_match` er ukendt. Resultatet må derfor ikke bruges til at godkende årsag,
  prompt, lydkæde eller fysisk golden chain.
- **Næste gate:** Installér præcis v1.13.28-artifactet og kør den sikre cold-probe og
  Prompt V6-live-eval. Først derefter køres én frisk golden chain samt 10/10
  ubrudte fysiske cyklusser. Det gamle replay forbliver diagnostisk og kan ikke godkende
  lydårsagen.
- **Rollback/grænse:** v1.13.11 forbliver fysisk baseline. v1.13.28 overtager ingen
  fysisk gate, før live-eval, image-build, frisk golden chain og 10/10 er bestået.

## Officiel OpenAI-kontraktaudit 21. august

En ny read-only audit har sammenholdt den aktive Realtime-implementation med OpenAIs
aktuelle officielle dokumentation for conversations, server-/client-events, tools,
VAD, transcription, rate limits, costs og GPT-Realtime-2.1. Tre uafhængige reviews er
samlet af lead. **Auditten udvider stop-the-line fra replay til runtime-værktøjssikkerhed.**
Ingen runtimekode, prompt, lyd, VAD eller firmware blev ændret under auditten.

### Historisk udviklingsbeslutning — providerfinalitet og serverautorisation

**Beslutning taget før releasegodkendelse; nedenstående er krav og hypoteser, ikke
opnåede resultater.** Kandidaten forbliver stop-the-line og må ikke installeres som
normal runtime eller åbnes for fysisk golden chain, før resultatafsnittet senere kan
dokumentere alle gates som bestået.

- **Observeret/auditeret fejl:** `response.function_call_arguments.done` kunne starte
  HA-/lifecycle-sideeffekter før owning `response.done`; følsomme handlinger havde kun
  promptbeskyttelse; tool-output og flere causale client-events manglede korreleret ACK.
- **Falsificerbar implementeringshypotese:** Hvis værktøjskandidater stages per
  providerrespons og kun frigives atomisk efter eksplicit `status=completed`, og hvis
  alle sideeffekter passerer en server-ejet, sessions-/tur-/argumentbundet policy, kan
  cancelled, malformed, stale og uautoriserede kald give præcis nul sideeffekter uden at
  ændre Realtime-ejet sprogforståelse eller den fysiske half-duplex-kæde.
- **Berørte invarianter:** Livscyklus 3, 4, 6, 9, 10 og 12 samt ejerskabet “Realtime
  vælger; serveren autoriserer; Thin ejer samtalen”. Særligt skal en batch med en
  godkendelseskrævende handling og `end_conversation` forblive åben; en low-risk handling
  plus semantisk afslutning må først lukke efter samlet resultat og fysisk farvel.
- **Valgt retning:** Provider-neutrale tool-events får response-/batchidentitet.
  Kandidater valideres og registreres samlet før første dispatch. Højrisiko afgiver en
  serverholdt challenge; en senere, completed-gated intern approval-beslutning må kun
  frigive den eksakte gemte handling én gang i samme session. Ingen lokal fraseliste
  eller diagnostisk ASR-tekst må godkende eller afvise brugerens mening.
- **Schema-/capability-sandhed:** Et dynamisk værktøj må ikke annonceres, hvis dets
  schema ikke kan valideres af runtime. Enten bruges fuld standardsvalidering, eller
  deklarationen filtreres før `session.update`, og capability markeres degraded med
  årsag. Mid-turn “annonceret men umulig” er ikke acceptabelt.
- **ACK-/readiness-sandhed:** Kun accepteret `session.updated` må betyde provider-klar.
  Tool-output skal være item-kvitteret før `response.create`; fejl på create, truncate
  og clear skal korreleres til deres operation og fejle lukket.
- **Frosne ikke-mål:** Promptens almindelige samtale-, routing-, sprog- og lydpolitik,
  model, audio, gain, VAD, firmware, playback-lease, timeout, teardown og wake-rearm må
  ikke tunes i kandidaten. Den eneste tilladte promptændring er den minimale protokol
  for det nye reserverede `approve_action`: Realtime må efter en klar semantisk
  bekræftelse på den umiddelbart næste tur sende det eksakte serverudstedte challenge-id,
  men må aldrig gentage eller ændre den oprindelige handling. Ændringen versionsmærkes
  særskilt og kræver prompt-contract- samt semantisk eval; den må ikke bruges til at
  tune de kendte input-/svarfejl. Den seneste irrelevante tidsrespons og det gamle
  replaybevis er fortsat uløste og må ikke erklæres repareret af
  værktøjssikkerhedsarbejdet.
- **Maskinel gate:** Rå providerpermutationer skal dække completed/cancelled/failed/
  incomplete/manglende status, late/duplicate/cross-response call-id, malformed schema,
  multi-call atomik og ACK-fejl. Thin/Talk/Voice PE-kontrakten skal dække approval på en
  senere tur, expiry/replay/sessionteardown, følsom handling plus close, tool-round-
  ordering og næste wake. Alle eksisterende tests, typecheck, lint, build og uafhængig
  adversarial review skal være grønne med mindst 97/100 og nul P0/P1.
- **Rollback:** Ændringen er add-on-only og må ikke kræve firmwareflash. Enhver failed
  gate kasserer kandidaten samlet; v1.13.11 forbliver fysisk baseline. Der pushes ingen
  release/version og udføres ingen fysisk test, før ovenstående er dokumenteret som
  faktiske resultater i et separat afsnit.

#### Historisk delresultat — fælles providerbudget før eksklusiv diagnostik

Det historiske auditfund nedenfor om ignoreret `rate_limits.updated` var korrekt for den
installerede baseline. Punkterne dokumenterer den tidligere headroom-model og dens
maskinelle delresultat; modellen er nu **falsificeret og erstattet** af den bindende
eksklusive diagnostikkontrakt ovenfor. De må ikke bruges som aktuel releasepåstand.

- Voice PE og Talk tager ved provider-connect straks en 15.000-token
  produktionslease gennem hele socket-generationen. Den venter aldrig bag eval og
  bevarer kapacitet til første svar plus en mulig tool-/farvelopfølgning. Kendt
  utilstrækkelig kapacitet fejler før socket og sideeffekt; ukendt budget tillader højst
  én produktionssession og ingen eval.
- Hver preflight-/replay-prøve reserverer 15.000 tokens plus 15.000 tokens uberørt
  produktionsheadroom. Kun én eval-prøve kan være aktiv per nøgle/model. En fysisk eller
  Talk-session kan starte under den aktive prøve; næste prøve afvises, indtil
  produktionen er lukket.
- Providerens token-`limit`, `remaining` og `reset_seconds` afstemmes på et monotont ur.
  Completed `response.done` debiterer tekst-/lydinput og -output på den eksakte
  generation/evallease én gang. Et staged produktionsværktøj frigives kun, når usage er
  eksplicit, typet og ikke-negativ, og samme lease fortsat ejer mindst 6.000 tokens til
  tool-resultat/farvel; ellers udsendes nul `ToolCall`/`ToolRoundComplete` og dermed nul
  sideeffekt. Duplicate terminalevents, stale generationer, reconnect, fejl og teardown
  kan ikke frigive den aktuelle lease eller debitere samme respons igen. Ingen afsluttet
  tur autogenkøres.
- Nye samtidigheds-/permutationstests dækker eval→produktion, to evals, ukendt og
  utilstrækkeligt budget, providerreset, forbrug, duplicate terminalevent og idempotent
  release. Hele den aktuelle suite bestod 622/622 uden sandboxens loopback-begrænsning;
  Ruff og mypy bestod for de berørte provider-/evalfiler.

Som en bevidst konservativ P2-begrænsning er produktionskapaciteten serialiseret: et
samtidigt Talk-/andet-rum-forsøg afvises straks i stedet for at blive køet. Den aktive
ene samtale ændres ikke; parallelle rum kræver en senere selvstændig kapacitetsgate.

Dette er maskinel kontraktevidens, ikke live provider-, fysisk lyd- eller
releasegodkendelse. Prompt, model, audio, gain, VAD, firmware og playback er uændrede;
v1.13.11 forbliver fysisk baseline, og kandidatens samlede adversarial review/build og
fysiske gates er fortsat åbne.

#### Historisk cold-start-korrektion — efterfulgt af eksklusiv diagnostik

**Dette er feltfejl og plan før rettelse, ikke et opnået resultat.** Den installerede
v1.13.27 afviste den sikre preflight med
`rate_limit_capacity · live eval requires an authoritative provider token budget` på
en frisk add-on-proces, selv om ingen fysisk samtale var aktiv.

- **Direkte evidens og kæde:** Panelets preflight → `LiveEvalService` → første
  evalreservation → afvisning før Realtime-connect. Ingen Response blev oprettet, ingen
  `rate_limits.updated` kunne derfor ankomme, og evalen kunne aldrig etablere den
  autoritet, den krævede. Fysisk Voice PE, playback, teardown og rearm blev ikke berørt.
- **Officiel kontrakt og falsificerbar årsag:** OpenAI dokumenterer, at
  `rate_limits.updated` først udsendes ved begyndelsen af en Response og allerede
  afspejler dens outputreservation. Kravet om autoritativt remaining **før den første
  Response** er derfor cirkulært. Hypotesen er, at én separat, minimal og kasseret
  diagnostic Response kan etablere autoriteten, hvorefter den første rigtige evalprøve
  åbnes i en ny session under den normale fulde reservation. Hvis providerens event
  udebliver, må ingen rigtig evalprøve starte eller bestå.
- **Berørte invarianter/naborisici:** Eval må ikke reducere fysisk headroom; produktion
  må aldrig vente bag eval; kun én eval/produktion må eje de nuværende leases;
  manglende, stale eller malformed rate-event skal fejle lukket; bootstrap må ikke
  kunne gentages mellem prøver eller blive stående efter timeout/teardown.
- **Planlagte regressioner:** cold-start probe → autoritativ event og completed
  Response → ny rigtig evalsession; manglende/malformed event eller providerfejl → hele
  run fejler; fysisk wake under proben får sin 15k reservation og stopper efterfølgende
  eval; to prober serialiseres; lavt autoritativt remaining stopper næste prøve; lease
  frigives én gang ved timeout/fejl.
- **Frosne ikke-mål og rollback:** Prompt, model, audio, gain, VAD, firmware, playback,
  tool-policy og lifecycle ændres ikke. Rettelsen er add-on-only. Hvis fysisk headroom
  eller fail-closed-grænsen ikke kan bevises maskinelt, beholdes feltfejlen som NO-GO
  frem for at genindføre ubegrænset evalpacing.

**Faktisk ændring og maskinelt resultat:** Cold-start bruger nu én dedikeret ephemeral
Realtime-session og en out-of-band `response.create` med `conversation: none`, tekst-only,
ingen tools, `tool_choice: none` og højst 64 outputtokens. Feltets 8-token-probe sluttede
`incomplete`; 64 er fortsat bundet af den separate 2k-lease. Output kasseres; både en
gyldig `rate_limits.updated` og en completed `response.done` kræves før socket og lease
lukkes. Først derefter tager en **ny** Realtime-session den normale autoritative
evalreservation. Manglende/malformed rate-event, timeout og providerfejl fejler lukket.
Hele jobbet ejer den nøglebrede, modeluafhængige diagnostiklås fra før proben til sidste
teardown; Voice PE og Talk får `diagnostic_busy` uden provider-socket, og panelet viser
Nabu som midlertidigt utilgængelig. En transient fejl kan genprøves af et senere
eksplicit run, men aldrig automatisk eller samtidigt. En completed probe kan kun
attestere den rate-event, parseren bandt til samme Response og socketgeneration; en
tidligere incomplete probes snapshot kan ikke genbruges af en senere completed probe
uden sin egen rate-event.

Sessionsejerskab og rolling responsekapacitet er adskilt: en autoritativ reset genfylder
den eksakte aktive lease, tre-turs same-session-forløb paces uden for den semantiske
turn-timeout. Før en toolsideeffekt frigives, reserveres nu den afsluttede responses
eksakte gentagne input/outputkontekst plus højst 2 KiB værktøjsresultat, 1.024 nye
outputtokens og 512 tokens protokol-/specialtokenmargin; utilstrækkelig capacity giver
nul `ToolCall`. Under den eksklusive
diagnostik kan en response-start med 14k remaining derfor fortsætte, når den konkrete
kausale opfølgning faktisk kan rummes; der simuleres ikke samtidig fysisk headroom. Den
beregnede full-profile-deadline
omfatter alle 11 mulige inter-turn-resetkanter, ikke kun nye sockets. Proben rapporterer
actual usage/pris separat fra de semantiske evalture og ellers sit konservative
2k/$0,128-makspris-loft. Hver semantisk tur har desuden et mekanisk loft på tre
providerresponser; en tredje tool-loopkant stoppes før ny fixtureeffekt eller en fjerde
Response. Full-profile har dermed 36 mulige responsekanter, men et prospektivt $5-loft
stopper før næste tur. En custom prompt over 32 KiB blokerer kun live-eval før
diagnostiklås/socket; produktionsprompten ændres byte-identisk.

Replayets særskilt fakturerede `gpt-live-transcribe` reserveres nu fra eksakt
PCM-varighed × lydgentagelser til $0,017/minut før diagnostiklås/socket. Det vises som
`transcription_budget` og indgår i samme $5-loft; tekstkontrollen koster ingen
transskription. Produktionsmåleren lægger konservativt faktisk videresendt
mikrofonvarighed til som en særskilt post, exactly once ved teardown.

Web-routingens oracle kræver nu både den kanoniske
`google_web_sogning(query="FCK seneste kamp")` og fixtureudfaldet `ok`. Et afvist kald
med forkerte argumenter kan derfor ikke blive grønt, selv hvis modellen bagefter
hallucinerer det forventede 2-0-svar.

Den gamle `eval_harness --live`-CLI er pensioneret: den kunne ikke levere det eksakte
frosne produktionsværktøjssnapshot, som den korrekte admission kræver. Den fejler nu
struktureret før service, budgetlease og provider-socket; live-preflight kan kun startes
fra add-on-panelets autentificerede Test-fane.

Den seneste fokuserede gate er **275/275 grøn** for providerbudget, rå Realtime,
eval/probe, tool-commit, Voice PE-/Talk-diagnostic teardown, UI-kontrakt og settings-
regressioner. Den separate HA/Thin/Realtime-gate er **300/300 grøn**, og den brede
lokale suite gav **726 grønne** tests; kun to console-tests blev blokeret af sandboxens
forbud mod localhost-bind. Ruff, formattering, scoped mypy og diff-check er grønne.
Uafhængig slutreview finder nul kendte P0/P1 og scorer den lokale kandidat **93/100**.
Den komplette socket-aktiverede CI-suite, ARM64-image og live-feltbevis står fortsat
åbent. Den
installerede v1.13.28 er feltfejlet og må ikke genbruges som bevis for korrektionen.

Headroom-/overtagelsesadfærden i dette historiske delresultat er efterfølgende afvist:
en allerede startet providerrespons kan have brugt pladsen, før lokal kode kan afbryde
den. Den aktuelle kandidat skal derfor erstatte den med den dokumenterede eksklusive
diagnostiklås. De tidligere 135/135- og 681/681-tal godkender ikke denne efterfølgende
kontraktændring; den fokuserede gate ovenfor er stadig ikke live- eller fysisk bevis.

#### Samlet maskinelt resultat for v1.13.27-kandidaten

- Providerens `function_call_arguments.done` er kun staging. Først en korreleret
  `response.done(status=completed)` registrerer hele batchen atomisk, og en eksakt
  `ToolRoundComplete(response_id=...)` må frigive den. Cancelled, failed, incomplete,
  ukendt status, malformed JSON/schema, duplicate/late call-id og manglende commit giver
  nul dispatch og nul semantisk close.
- `session.updated` er readiness-grænsen. Preconnect-lyd tømmes i rækkefølge, og tool-
  output, `response.create`, clear og truncate har generationbundne event-id'er, ACKs,
  fejlkorrelation og watchdogs.
- `ExecutionPolicy` validerer og autoriserer uafhængigt af prompten. Følsomme handlinger
  bliver serverholdte challenges og kan kun udføres én gang efter en klar beslutning på
  den umiddelbart næste tur i samme session. Ændrede argumenter, session, tur, udløb,
  replay eller et andet input fejler lukket. En højrisikohandling plus afslutning holder
  samtalen åben; en godkendt lavrisikohandling udføres før farvel.
- HA-mutationer bruger frisk, autoritativ målresolution. Det mål, der autoriseres, er
  det samme eksakte entity-id, der dispatches. Områder, navne, klima, private læsninger,
  inverse lock/cover/valve-handlinger og argument-smuggling har særskilte regressions.
- Eval bruger de samme reserverede deklarationer, resultatformater, approval-policy og
  commitgrænser som produktion, men faste sideeffektfrie fixtures. Rapporten skelner
  effektivt evalschema, produktionsschema og reserved-kontrakten.
- Uafhængig adversarial review efter grøn ARM64-CI: **95/100**, fordelt 25/25
  providerfinalitet, 29/30 autorisation/HA, 19/20 ACK/readiness/budget, 15/15
  lifecycle/adapters og 7/10 releaseevidens. Der er nul kendte P0/P1; live Prompt V6-
  eval på de eksakte produktionsdeklarationer er sidste maskinelle gate til 97/100.
- Endelig maskinel gate på commit `47100d7`: **622/622 tests**, Ruff, formattering,
  mypy og diff-check grønne lokalt og i CI; GitHub byggede desuden add-on-image til
  `linux/arm64`. Det er nødvendigt softwarebevis, ikke live/fysisk releasegodkendelse.

### Historiske releaseblokkere — maskinelt lukket i v1.13.27-kandidaten

Punkterne nedenfor beskriver de fejl, auditten fandt i v1.13.26. De er bevaret som
årsags- og regressionshistorik, men er **ikke** aktuelle P0/P1-fund i den nye kandidat.
Completed-gaten, serverautorisationen, korrelerede ACKs, streng status/schema-validering
og det fælles providerbudget er nu dækket af rå eventpermutationer og den samlede suite.

1. **P0 — et annulleret eller ufuldstændigt modelsvar kan nå at udføre et værktøj.**
   PodVoice sender i dag `response.function_call_arguments.done` direkte videre til
   `ThinSession` og værktøjsrouteren. OpenAI dokumenterer, at eventet også udsendes,
   når en respons afbrydes, bliver ufuldstændig eller annulleres; det autoritative
   slutpunkt er den altid udsendte `response.done`, hvis `status` skal være
   `completed`. Den senere oprydning kan ikke fortryde en allerede udført HA-handling
   eller semantisk afslutning. Kald skal derfor stages per `response_id` og må først
   frigives efter en completed `response.done`; alle andre statusser kasserer dem.
2. **P0 — følsomme handlinger har kun promptbeskyttelse.** Prompten kræver bekræftelse
   før blandt andet oplåsning, alarm fra, beskeder og køb, men routeren kan udføre et
   deklareret HA-/MCP-kald uden et server-ejet approval-token. OpenAI beskriver netop
   function tools som stedet, hvor applikationen ejer forretningslogik,
   adgangskontrol og approval checks. Der kræves en deterministisk, sessions- og
   argumentbundet godkendelsesbarriere i applikationen; prompten må kun eje den
   naturlige dialog, aldrig selve tilladelsen.
3. **P1 — causalt vigtige WebSocket-operationer mangler kvittering og korrelation.**
   Typed Talk-input venter allerede korrekt på sit præcise item-ACK. Tool-output,
   `response.create`, `conversation.item.truncate`, input-clear og flere øvrige
   operationer har derimod intet klient-`event_id`, og tool-output anses for leveret,
   før `conversation.item.created` bekræfter det. En providerafvisning bliver dermed
   ofte kun en loglinje og senere timeout. Samme ACK/error-kontrakt skal gælde alle
   operationer, der kan ændre tur, værktøjsresultat eller samtalekontekst.

### Dokumenterede P1/P2-fund

- Ugyldig JSON i funktionsargumenter bliver til `{}` og dispatches. Protokol- eller
  schemafejl skal fejle lukket med nul sideeffekter.
- OpenAI-readiness publiceres ved socket-connect, før `session.updated` har bevist den
  effektive konfiguration. UI og traces skal skelne socket, `session.created` og
  accepteret `session.updated`.
- Providerens `rate_limits.updated` ignoreres. Eval bruger et lokalt Tier-1-budget,
  som ikke koordineres med fysiske sessioner eller øvrig projekttrafik.
- `response.done` uden officiel status behandles som completed af hensyn til gamle
  fakes. Produktion skal fejle lukket på manglende/ukendt status; fakes skal følge den
  officielle kontrakt.
- Diagnostiske inputtranscripts mister `item_id`; OpenAI garanterer ikke completion-
  rækkefølge på tværs af ture. Det kan forvride historik og bevis, men transcriptet
  ejer fortsat hverken værktøjsvalg eller semantisk afslutning.
- Replay bruger lokal event-modtagelsestid som lydgrænse og kasserer OpenAIs
  autoritative `audio_start_ms`/`audio_end_ms`. Derfor er eksisterende replay kun
  diagnostik, ikke årsags- eller releasebevis.
- Den viste pris mangler den separat fakturerede live-transskription. Langvarige
  sessioner har desuden ingen eksplicit målt context-/truncation-politik.
- Timer- og dynamiske MCP-schemas valideres ikke tilstrækkeligt server-side. Modellen
  understøtter function calling, men ikke Structured Outputs; schemas er derfor ikke
  en erstatning for runtimevalidering.

### Det, der er korrekt og skal bevares

- Backend-WebSocket, 24 kHz mono PCM16, `output_modalities=["audio"]`,
  `gpt-realtime-2.1`, lav reasoning, automatisk tool choice og sessionslængden under
  OpenAIs 60-minuttersgrænse er gyldige valg.
- `session.updated` bruges allerede til at frigive buffered audio og typed input;
  fejlen er readiness-påstanden omkring det, ikke selve bufferingen.
- Voice PE's `interrupt_response=false` er en bevidst og korrekt half-duplex-kontrakt.
  Talk stopper lokal afspilning og bruger truncate ved barge-in som foreskrevet for
  WebSocket-klientstyret playback.
- Inputtransskriptionen er korrekt behandlet som asynkron diagnostik og ikke som det,
  den native audiomodel nødvendigvis hørte.
- Den normale tool-resultatsekvens — `function_call_output` med samme `call_id`,
  derefter én `response.create` — følger API'et; den mangler blot ACK/error-sikkerhed.

### Oprindelig gate efter auditten — gennemført maskinelt

Completed-bundet tool-staging, server-ejet approval, event-ID/ACK-fejlgrænser,
provider-sand readiness og et fælles rate-limitbudget er nu implementeret og maskinelt
testet. Den næste bindende gate er derfor ikke mere kode på disse hypoteser, men
reproducerbar releaseevidens: add-on-image, live Prompt V6-eval og fysisk Voice PE.
Audio-replay/proveniens er fortsat et separat uløst diagnosespor. Promptens almindelige
adfærd, gain, VAD, firmware og playback må fortsat ikke ændres for at maskere det.

## Historisk feltstatus 21. august

Den installerede v1.13.25 registrerede efter en manuel Voice PE-genstart en rigtig
fysisk wake kl. 09.57.53. Realtime-socketen nåede `provider_connected` efter 1.341 ms,
men lukkede 116 ms senere som den generiske `error:connection`. Den faste fejllyd blev
fysisk afspillet, teardown gennemførte én gang, og firmware kvitterede `wake_rearmed`
83 ms efter playback-finish. Pucken og wake-motoren var dermed operationelle igen;
prøven fejlede i providerleddet og tæller ikke som golden chain.

Brugeren identificerede samtidig en sandsynlig manglende OpenAI-saldo. v1.13.25
bevarede ikke den præcise providerfejlkode i status og kunne derfor ikke skelne
`insufficient_quota` fra 429, ugyldig nøgle eller netværksbrud. Årsagen må ikke kaldes
endeligt bevist ud fra den generiske trace alene.

Efter saldoen var genoprettet gennemførte v1.13.25 en ny fysisk tur. Wake, én
Realtime-session, fysisk playback, ekkogate, idle-close og wake-rearm fungerede;
rearm kom 95 ms efter close-request. Inputtet blev imidlertid observeret som
“Åh, bagklappen”, og Realtime forsøgte derfor korrekt ud fra sin opfattelse at sætte
køkkenhøjttaleren på pause. Brugeren havde muligvis holdt en pause efter wakefrasen.
Turen beviser provider- og lifecycle-recovery, men ikke korrekt same-breath-input og
tæller hverken som golden chain eller som grundlag for gain-/VAD-tuning. Næste fysiske
prøve skal have armeret device- og providerlyd og én naturlig ytring uden kunstig pause.

Den aftalte, pausefri prøve kl. 10.32 blev optaget som trace
`20260821T103257-225` og **fejlede også golden chain**. Den diagnostiske
transskription var denne gang ordret “Hvad er klokken?”, men Realtime kaldte intet
værktøj og svarede irrelevant, at den ikke kunne række eller flytte ting i den
fysiske verden. `session.updated` var accepteret med `gpt-realtime-2.1`, dansk
transskription, Prompt V5 og responsive VAD. Den mekaniske kæde bestod: playback
startede 2.750 ms efter speech-stop, playback-finish frigav ekkogaten, idle-close
gennemførte, og wakeword blev rearmet efter 91 ms. Device- og provider-sporet havde
samme peak på 29,06 %, nul clipping og et ordret diagnostisk input; det er ikke i sig
selv et lyttebevis for den native audiomodel.

Umiddelbart efter bestod den isolerede, sikre Realtime-preflight alle fire scenarier
med samme model og Prompt V5, herunder `Hvad er klokken?` →
`get_time(fields=["time"])`, tidsopfølgninger, web-routing og semantisk afslutning.
Det placerer fejlen i den fysiske audio-native beslutning eller den konkrete lyd, som
Realtime modtog — ikke i en generelt manglende `get_time`-deklaration. Preflighten
brugte dog den daværende reducerede sikre eval-liste og udelukker derfor ikke overload
eller konkurrence i hele produktionsskemaet. Prompt, gain, VAD og lifecycle må ikke
ændres ud fra denne ene tur.

v1.13.26 er den afgrænsede statuskandidat. Den bevarer providerens seneste fejlkode,
klassificerer saldo/kredit, rate-limit, nøgle, timeout og forbindelse separat og sender
ændret årsag live til panelet, selv når servicefarven er uændret. Voice PE viser separat
offline, forbundet/afprøves og fysisk wake-klar. Kandidaten lukker desuden en gammel
konfigurationsrest: fysisk Voice PE er nu ubetinget half-duplex ved både settings-,
config- og buildergrænsen; kun Talk-adapteren kan vælge browser-duplex. Den ændrer ingen
prompt, model, værktøjsrouting, gain, VAD, firmware eller playbacksekvens og kræver ingen
firmwareflash. Kandidaten tilføjer en isoleret diagnose: seneste provider-WAV kan
genafspilles tre gange i friske Realtime-sessioner sammen med en tekstkontrol. Alle fire
kørsler eksponerer den aktive prompt, rumkontekst og hele produktionsskemaet, men bruger
en sikker lokal værktøjsrouter uden HA-, MCP- eller PodConnect-sideeffekter. Nye traces
gemmer samplegrænser og værktøjsskema-hash; den eksisterende
`20260821T103257-225`-trace kan kun bruge den eksplicit markerede legacy-estimering for
første tur. Kandidaten er maskinelt grøn med 509 tests, Ruff, formatkontrol, mypy og
panel-script-parsing. GitHub CI's ARM64 add-on-containerbuild er grøn; kun en ekstra
lokal Docker-containerbuild blev ikke kørt, fordi den lokale Docker-motor var stoppet.

## Officiel milepæl

**v1.13.11 er PodVoices første fysisk virkende half-duplex-version.**

Den betegnelse betyder præcist, at én frisk Voice PE-kæde har gennemført:

```text
wake
  → én Realtime-session
  → korrekt første svar
  → korrekt opfølgning i samme session
  → GPT Realtime valgte end_conversation på “Tak, det var alt”
  → “Farvel” blev fysisk afspillet
  → én teardown og wake-rearm (~99 ms)
  → en ny wake åbnede en ny Realtime-session
```

Det er den første evidens for, at grundarkitekturen virker i rummet — ikke bare i Talk,
en fake eller CI. Den tidligere serie af døde wake-låse og frasebaserede lukninger er
dermed ikke længere den gældende arkitektur.

Den samme trace havde dog en diagnostisk inputtransskription på “Bag” for første
tidsforespørgsel. Realtime valgte alligevel det rigtige tidsværktøj og gav det rigtige
svar. Milepælen beviser derfor lifecycle-kæden og en fungerende fysisk samtale, men **ikke**
stabil ord-/intentgenkendelse. Den må aldrig bruges som lydkvalitetsbaseline alene.

## Hvad betegnelsen ikke betyder

| Niveau | Status |
|---|---|
| Én fysisk golden chain | **Bestået på v1.13.11** |
| Automatisk lifecycle-gate, 10/10 | Bestået i tests; skal altid genkøres på kandidat |
| Fysisk Voice PE-gate, 10/10 ubrudt | **Mangler; daværende fysisk bevis er 1/10** |
| Svartid p90 ≤ 2,5 s | Ikke bevist; de seneste ture ligger omtrent 2,3–2,9 s |
| Fuld funktionsmatrix | Ikke godkendt |
| 7 døgn + Gemini/Alexa-benchmark | Ikke gennemført |

Vi må derfor sige “første virkende version”. Vi må endnu ikke sige “release-godkendt
10/10”, “færdigt produkt” eller “bedre end Gemini/Alexa på alt”.

## Den shippede produktionsvej

```text
Voice PE firmware
  → VoicePELink
  → ThinSession
  → OpenAI Realtime + eksponerede værktøjer
  → ReplyBus/FLAC announcement
  → firmware playback_started/playback_finished
  → atomisk teardown
  → fysisk wake-rearm
```

Voice PE er half-duplex. Talk bruger samme `ThinSession`, men browserens full-duplex I/O
er kun software-/providerdiagnostik og ikke fysisk puckbevis. Classic, stock HA Assist og
direct PCM er ikke produktionsveje.

## Kandidat- og evidenshistorik

v1.13.12 er truth-hardening oven på den beviste v1.13.11-baseline. Den gør mislykket
mic-start/-stop synlig, venter på fysisk fejllyd, binder stopmålinger og historik til
sessionen, rydder alle lydspor og forbyder netværks-TTS i et mekanisk farvel-fallback.
Kandidaten er publiceret på `main` med grøn CI og kræver kun add-on-opdatering, ikke en
firmwareflash. Den fejlede den fysiske prøve `20260819T123836-240`: første ytring blev
observeret som “Nu er klokken”, næste ytring var tom, og Realtime gav derfor to forkerte
svar. Playback, idle-close og wake-rearm gennemførte korrekt. Samme kanal, gain, VAD,
støjvalg og firmware var aktive som i den tidligere prøve, og 1.13.12 ændrede ikke prompt,
transskriptionsmodel eller audio-forwarding. Fejlen er derfor foreløbig klassificeret som
**ustabil fysisk inputforståelse**, ikke som bevist lifecycle-regression.

v1.13.12 erstatter ikke den officielle baseline. Ingen feature-, latency- eller UI-udvikling
fortsætter, før inputfejlen er forklaret, en frisk golden chain består uden tomt eller
semantisk afvigende input, og derefter 10 ubrudte fysiske cyklusser består.

v1.13.13 er den næste softwarekandidat. Den erstatter den overlappende 1.13.12-prompt
med Prompt V2, tilføjer et provider-neutralt og mekanisk tavst `wait_for_user`-signal
for baggrundstale og binder tavse værktøjsrunder til præcis session, tur og kald. Den
ændrer ikke firmware, gain, VAD, pre-roll, mic-gate, playback eller wake-rearm. Grøn CI
er kun softwarebevis; kandidaten overtager først den officielle baseline efter den
samme friske golden chain og den efterfølgende ubrudte 10/10-gate.

Den fysiske V2-prøve `20260819T145100-102` bekræftede
`prompt_source=default`, `prompt_version=2`. Klokkeslæt og opfølgende ugedag var
korrekte i samme Realtime-session. Første klare “Tak, det var alt for nu” blev dog
fejlroutet til det forrige `get_time`-værktøj og gentog “Det er onsdag”. Ved andet
forsøg valgte modellen korrekt `end_conversation`, men OpenAI Tier-1 ramte 40.000 TPM,
da næste respons forsøgte at reservere 5.521 tokens. Den cachede “Farvel”-fallback blev
fysisk afspillet, close gennemførte én gang, og wake blev rearmet efter cirka 99 ms.
Trace viste bagefter en falsk `missing-start-or-finish`, selv om både playback-start og
-finish allerede var bevist. Prøven er derfor **ikke** en bestået golden chain, men den
beviser, at V2 var aktiv, at inputtet var forståeligt, og at fallback/lifecycle kom hjem.

v1.13.14 afgrænsede `get_time` til den seneste
brugerturs faktiske tids-/datohensigt, styrker den semantiske wrap-up-routing uden
frasematching, sætter Realtime `max_output_tokens=1024`, fjerner watchdoggens falske
playback-fault efter et bevist start/slut-par og gør rød fejl-LED midlertidig. Efter
fejllyd, teardown og fysisk rearm går ringen tilbage til mørk IDLE. Kandidaten ændrer
ikke firmware, gain, VAD, pre-roll, mikrofonport eller half-duplex-ejerskab.

Den fysiske v1.13.14-prøve `20260819T153836-401` havde ren lyd, korrekt klokkeslæt og
korrekt opfølgende ugedag i samme Realtime-session. Den klare afslutning “Tak, det var
alt for nu” blev også transskriberet korrekt, men GPT sagde “Selv tak, det var så lidt!”
uden at kalde `end_conversation`. Playback sluttede normalt; samtalen lukkede først på
idle-fallback cirka 7,3 sekunder senere. Det var derfor en semantisk beslutningsfejl,
ikke en mikrofon-, gain-, playback- eller wake-fejl.

v1.13.15 krævede én eksplicit
Realtime-beslutning: domæneværktøj for handling/opslag, `continue_conversation` for
direkte svar eller opklaring, `end_conversation` for afslutning eller `wait_for_user`
for ikke-henvendt tale. En maskinel live Talk-prøve stoppede kandidaten før fysisk test:
første tekst kunne forsvinde, når provider-opkoblingen tog længere end en fast 300 ms
ventetid, og Realtime kunne vælge `continue_conversation`, sige “Lad mig lige regne det
kort igennem” og aldrig levere svaret 84. Kandidaten er derfor ikke testklar.

v1.13.16 lod Talk vente på den virkelige provider-ready-grænse før første tekst blev
sendt. `continue_conversation` blev ændret til en
mekanisk to-respons-kontrakt: beslutningsresponsens lyd kasseres, det interne resultat
registreres, og præcis én efterfølgende respons med `tool_choice=none` skal levere hele
svaret. Dermed kan svaret hverken erstattes af en mellemreplik eller starte en ny
lifecycle-loop. Promptversionen er 4. Firmware, gain, VAD, pre-roll, mic-gate, playback
og wake-rearm er uændrede.

Den maskinelle live-preflight den 20. august stoppede v1.13.16 før fysisk test. Efter en
frisk Talk-forbindelse gav direkte matematik et fuldt svar efter
`continue_conversation`, tids-/ugedagsværktøjet virkede, semantisk afslutning kaldte
`end_conversation` én gang, og en ny samtale kunne åbnes efter lukning. En naturlig
matematisk opfølgning brugte dog kun den sikkert etablerede kontekst i én af to gyldige
gentagelser. Desuden viste en gammel Talk-socket fortsat "online", selv om den første
tekst aldrig nåede `ThinSession`, og browseren kunne vise/rydde tekst under afslutning,
før serveren havde accepteret turen. Talk kalder i denne kandidat stadig
`brain.send_text()` direkte og undertrykker sendefejl; den skrevne vej ejer derfor ikke
en autoritativ `ThinSession`-tur og kan ikke bruges som releasebevis.

v1.13.16 har dermed bevist, at den nye to-respons-mekanik kan levere et komplet svar,
men **live-preflighten er ikke bestået, og fysisk golden chain må ikke startes på denne
kandidat**. Den næste kandidat skal først indføre fælles tur-ejerskab, serverkvittering,
korrelerede session-/tur-/playback-id'er og sand forbindelsesstatus. Prompt V4,
firmware, gain, VAD og lydkæde fryses under denne mekaniske rettelse. v1.13.11 forbliver
den officielle fysiske baseline.

v1.13.17 blev bygget grønt i CI, installeret og kørt mod den rigtige Realtime-provider
den 20. august. Preflighten stoppede korrekt før fysisk test: `session.updated` blev
accepteret, men OpenAI afviste det første tekst-item med `string_above_max_length`, fordi
PodVoice dannede `pv_` plus 32 hashtegn — 35 tegn i alt mod providerens maksimum på 32.
Der blev ikke oprettet noget modelsvar. Fejlen er dermed transportmekanisk og har intet
med dansk, prompt, TPM, gain eller Voice PE at gøre. **v1.13.17 er ikke testberettiget.**

v1.13.18 rettede item-længden og blev installeret den 20. august. Realtime accepterede
`session.updated`, og der kom ingen item-afvisning, men preflighten stoppede med
“OpenAI did not acknowledge the typed conversation item”. Den efterfølgende
protokolaudit fandt årsagen: providerlaget ventede kun på den ældre
`conversation.item.created`, mens den aktuelle GA-protokol sender
`conversation.item.added` for et klientoprettet item. Der blev fortsat ikke oprettet et
modelsvar. **v1.13.18 er derfor ikke testberettiget.**

v1.13.19 blev installeret og live-preflightet den 20. august. GA-kvitteringen virkede:
matematikken gav 84 og opfølgningen 90; tid og opfølgende ugedag var også korrekte.
Rapportens promptidentitet afslørede dog, at den aktive prompt var en nøjagtig kopi af
den gamle Prompt V2, ikke den indbyggede V4. De to gennemførte scenarier brugte 28.700
tokens, hvorefter semantic-close og web-routing blev startet uden pause tæt på kontoens
40.000 TPM-vindue og timede ud uden en gyldig semantisk dom. De to fejl må derfor ikke
klassificeres som produktfejl eller bestået evidens. **v1.13.19 er ikke testberettiget.**

v1.13.20 var den foregående softwarekandidat. Alle egne og normaliserede Realtime-
item-id'er er nu præcis højst 32 tegn, og en eksplicit itemafvisning fejler øjeblikkeligt
uden `response.create`. Providerlaget accepterer både den aktuelle
`conversation.item.added` og den ældre kompatibilitetsevent. Hvert create-kald har et
korreleret `event_id`, så en uvedkommende recoverable providerfejl ikke kan afvise den
ventende tur. Den tidligere audit fandt og lukkede desuden tre nærliggende sandhedshuller:
preflighten bruger nu faktisk gemt prompt, effektive model og stemme; rapporten bærer
promptkilde/version/hash og tool-schema-hash; og Talk afviser ubundet tekst- eller
command-id-længde før wake/provider. Eval-oraklets tid- og sportskrav er desuden gjort
strengere, så en tvetydig delstreng eller forkert kampretning ikke kan give falsk grøn.

Den præcise gamle V2-hash migreres nu til V4 ligesom andre gemte standardprompter;
egentlige brugerændringer bevares. Preflighten holder et konservativt 30.000-token
rullende vindue, reserverer 10.000 TPM til almindelig brug og viser sin automatiske
rate-limit-pause. Total-run-budgettet er 80.000 tokens og $0,25, så fire friske scenarier
kan fordeles over flere minutter uden at blive fejldiagnosticeret som semantikfejl.

Den 20. august består kandidaten lokalt med **476 tests**, inklusive reelle lokale
HTTP/WebSocket-tests, plus Ruff, formatteringskontrol og mypy for 39 kildefiler. Prompt
V4, firmware, gain, VAD, pre-roll og fysisk half-duplex er uændrede. v1.13.20 nåede
live-preflight, men leverede ikke en bevaret slutrapport og blev derfor aldrig fysisk
testklar.

1.13.20's installerede preflight gav ikke en gyldig slutrapport. Den fler-minutters
evaluering blev holdt inde i ét Ingress-HTTP-kald; et efterfølgende request så den
stadig aktive serverkørsel og panelet erstattede den med “kører allerede”. Det er en
jobtransportfejl, ikke bevis for bestået eller fejlet semantik.

v1.13.21 var den foregående softwarekandidat. Preflighten ejes nu af add-on-processen
som et baggrundsjob med fast id og bevaret resultat. Panelet starter én gang og poller;
reload, midlertidigt nettab eller et genforsøg kan ikke annullere jobbet eller starte en
parallel kørsel. Provider-connect har et otte-sekunders loft, hele jobbet et
femminutters loft, og alle åbne evalressourcer lukkes også ved tidlig opkoblingsfejl og
add-on-stop. TPM-softgrænsen er 25.000, så 15.000 tokens holdes fri til én målt normal
PodVoice-session. Kandidaten ændrer ikke prompt V4, firmware, gain, VAD, pre-roll,
mic-gate, playback eller wake-rearm. Den er først fysisk testberettiget efter grøn CI,
installation og en fuld bevaret live-rapport med `prompt_source=default` og
`prompt_version=4`. Lokalt er **484 tests**, alle 10 panel-scripts, Ruff,
formatteringskontrol og mypy for 39 kildefiler grønne; de reelle lokale
HTTP/WebSocket-tests blev kørt uden sandboxens portblokering.

Den installerede 1.13.21-preflight `eval-1787221960-a23d2f` overlevede en reel
panelreload og bevarede hele slutrapporten. Den brugte `gpt-realtime-2.1`, den
indbyggede Prompt V4 med hash `84ff3a0c…`, syv provider-kvitterede ture og 52.165
tokens med 163 sekunders automatisk TPM-pause. Matematik/opfølgning, tid/ugedag og
semantisk afslutning bestod. Web valgte korrekt `google_web_sogning` og svarede “FCK
vandt 2-0”, men oraklet krævede de bogstavelige talord “to” og “nul”. Rapportens eneste
røde tur var derfor en dokumenteret falsk negativ, ikke en produktfejl.

**v1.13.22 var den senest installerede softwarekandidat.** Web-oraklet accepterer den korrekte
FCK-sejr med cifre eller danske talord, men bevarer vinderretningen, så et omvendt
resultat stadig fejler. Panelet viser desuden den præcise finding under hver rød tur.
Produktionsprompt, model, tool-kontrakt, Voice PE-firmware og lifecycle er byte-/logisk
uændrede. Lokalt er **486 tests**, Ruff, formatteringskontrol, mypy for 39 kildefiler
og alle 10 panel-scripts grønne; de reelle HTTP/WebSocket-tests er kørt uden
sandboxens portblokering. CI-kørsel `32360366628` bestod både testjob og ARM
add-on-build, og 1.13.22 er installeret og kører i Home Assistant.

Den installerede preflight `eval-1787222997-bf8511` bestod **4/4 scenarier og 7/7
ture** på `gpt-realtime-2.1` med den indbyggede Prompt V4. Den beviste matematik og
opfølgning, tid/ugedag, almindelig høflighed uden falsk lukning, modelsemantisk
afslutning og korrekt web-routing/svar. Rapporten brugte 52.255 tokens, estimeret
$0,078 og 162 sekunders automatisk TPM-pause. Den efterfølgende rigtige Talk/Thin-test
bestod 84 → opfølgning → 90 i samme session, semantisk Farvel/lukning og et nyt
klokkesvar i en frisk session. En indledende prøve med faste browserpauser nåede at
ramme idle-fallback og åbnede derfor en ny session; den tæller ikke som produktfejl og
dokumenterer, at automatiske Talk-tests skal vente på serverevents frem for faste
sekunder.

Kandidaten blev dermed **maskinelt adgangsgodkendt til én fysisk golden chain**, men den
fysiske prøve `20260820T131337-909` afviste den. Voice PE observerede korrekt “Hvad er
tolv gange syv?”, hvorefter Realtime først kaldte det obligatoriske
`continue_conversation` og den tvungne anden respons svarede “7 gange 7 er 49.” På
opfølgningen kaldte Realtime `end_conversation`, før den asynkrone diagnostiske
transskription “Læg sekste.” ankom, og sagde “Farvel, vi tales ved.” uden en reel
afslutningshensigt. Fysisk playback, én teardown og wake-rearm på 98 ms virkede, men
semantikken fejlede. **v1.13.22 er derfor fysisk afvist og ikke testklar.**

**v1.13.23 er den senest installerede, men nu maskinelt afviste kandidat.** Den fjerner den obligatoriske
fortsættelsesbeslutning og den tvungne to-respons-vej. Realtime bruger automatisk
værktøjsvalg: direkte spørgsmål besvares i én respons, domæneværktøjer bruges kun ved
behov, og `end_conversation` forbliver den eneste modelsemantiske lukningsautoritet.
Firmware, gain, VAD, pre-roll, half-duplex, playback og rearm ændres ikke i denne
kandidat. Lokalt er 483 tests, Ruff, formatteringskontrol og mypy for 39 kildefiler
grønne. Commit `f64e526` er pushed til `main`; CI-kørsel `32364539944` bestod både
testjob og ARM add-on-build, og 1.13.23 er installeret og kører i Home Assistant.

Den installerede live-preflight `eval-1787226288-e7a8d8` bestod **4/4 scenarier og
7/7 ture** på `gpt-realtime-2.1` med `prompt_source=default`, Prompt V5 og prompt-hash
`a94586b7…`. De direkte regneture svarede 84 og derefter 90 i samme session med tomme
værktøjsbeslutninger og uden ekstra modelrespons. Tidsopslaget brugte `get_time`, mens
ugedagsopfølgningen genbrugte resultatet direkte i samme session. Almindeligt “Tak”
holdt samtalen åben; den klare afslutning kaldte præcis `end_conversation` og lukkede.
FCK-spørgsmålet brugte `google_web_sogning`. Rapporten brugte 35.104 tokens, estimeret
$0,091 og 107 sekunders automatisk TPM-pause. Første modellyd lå på 861–1.112 ms for de
direkte og lokale ture; web lå på 2.802 ms. Dette er browser/provider-evidens, ikke
fysisk Voice PE-playback.

En efterfølgende rigtig Talk/Thin-kæde fandt en deterministisk playback-race og stoppede
fysisk test. Providerens svar var færdiggenereret kl. 14:00:37.126, browserens playback
startede først 859 ms senere, men den gamle faste 500 ms-regel havde allerede åbnet næste
tur. Da det gamle svar sluttede under den nye `get_time`-tur, blev slut-eventet anvendt
på globale felter og afkortede det nye svar. Det er en lifecycle-/playbackfejl, ikke en
prompt-, model-, gain-, VAD- eller danskfejl. **1.13.23 er derfor ikke testklar.**

**v1.13.24 er den installerede, maskinelt beståede kandidat.** Den erstatter tidsreglen med én playback-
lease per svar, bundet til session, tur, output-item og playback-id. Ny brugerlyd og
skrevet input forbliver gated gennem ventet start, fysisk afspilning og ekkohale. Kun
matching start→finish kan åbne opfølgningen; stale, dublerede, omvendte og manglende
events kan ikke ændre en nyere tur. Manglende start genprøver samme lease én gang og
lukker derefter rent. Talk håndhæver samme id/rækkefølge, og fysiske traces bærer nu
session-/tur-/playback-id, så oraklet kan afvise krydset ejerskab.

Lokalt er **489 tests** grønne, inklusive reelle HTTP/WebSocket-tests uden sandboxens
portblokering. Ruff, formatteringskontrol og mypy er grønne. Commit `12c2eed` er pushed
til `main`, og CI-kørsel `32370186433` bestod både testjob og ARM add-on-build.
v1.13.24 blev derefter installeret i Home Assistant den 20. august 2026.

Den installerede Talk/Thin-preflight bestod en serverkvitteret sammenhængende kæde:
15 + 27 gav 42; opfølgningen “gang resultatet med to” gav 84 i samme Realtime-session;
`get_time` gav korrekt dato, og ugedagsopfølgningen genbrugte konteksten og svarede
torsdag. `end_conversation` blev kaldt præcis én gang, farvel blev afspillet og sessionen
lukket; en efterfølgende regnetur åbnede en frisk session og svarede korrekt. Talk viste
først klar efter de korrelerede browser-playback-events. En indledende ugyldig prøve,
hvor testdriveren ventede cirka 20 sekunder på grund af versalfølsom tekstmatching og
dermed ramte den normale idle-timeout, er kasseret og tæller ikke som produktfejl.

Dette er stærk browser/runtime-evidens, men ikke fysisk Voice PE-bevis. Kandidaten er
derfor først klar til den korte fysiske golden chain; den er ikke lifecycle-
releasegodkendt, før samme bits derefter består 10/10 ubrudte fysiske cyklusser. Prompt
V5, `gpt-realtime-2.1`, firmware, gain, VAD og pre-roll er uændrede.

Den friske fysiske golden chain den 20. august 2026 er **afvist**. Trace
`20260820T165000-859` beviste den nye playback-mekanik: én wake og én Realtime-session,
tre turbundne playback-leases, korrekte start/slut-par, fysisk farvel, én teardown og
wake-rearm efter 99 ms. Opfølgningen nåede provider-kæden komplet og blev diagnostisk
transskriberet ordret som “Og hvilken ugedag er det?”. Realtime kaldte `get_time`, som
returnerede `weekday: torsdag`, men svarede forkert “Det er uge 34.” Golden chain fejler
derfor på semantisk resultatgrunding, selv om lifecycle består. Første turs diagnostiske
tekst var desuden “Backschrauben”, mens native Realtime valgte korrekt tidsværktøj og
svarede med klokkeslættet; denne tur er høre-mæssigt ukendt, indtil device- og
providerlyden er gennemlyttet. En efterfølgende frisk wake gav korrekt dato og lukkede
igen; det ændrer ikke den afviste gate. **Start ikke 10/10 på v1.13.24.**

**v1.13.25 var korrektionskandidaten og er nu installeret.** Realtime ejer fortsat betydning og
værktøjsvalg, men `get_time` kræver nu, at modellen vælger ét eller flere præcise
tidsfelter: `time`, `date`, `weekday` eller `week_number`. Værktøjet returnerer kun de
valgte felter med et fokuseret dansk svargrundlag. Der er ingen lokal ordliste,
frasegenkendelse eller deterministisk hensigtsrouting. Eval-oraklet kontrollerer både
værktøjsnavnet og modellens feltargument og afviser nu eksplicit `week_number` som svar
på en forventet `weekday`. Lyd, Prompt V5, `gpt-realtime-2.1`, firmware, gain, VAD,
half-duplex, playback, teardown og rearm er uændrede. Dens aktuelle fysiske evidens og
afgrænsningen til v1.13.26 står øverst i dette dokument.

Den fulde gate omfatter Ruff, formatteringskontrol, mypy for 39 kildefiler, parsing af
alle 10 panel-scriptblokke og reelle lokale
HTTP/WebSocket-tests. Testmiljøet blev bevidst lagt i `/private/tmp` efter den kendte
Documents/iCloud-låsning af projektets gamle venv.

## Adgangskrav før næste udvikling

1. Før fysisk test skal næste kandidat bestå automatiske regressionssuiter og en rigtig
   live Talk-kæde gennem en serverkvitteret `ThinSession`-tur: direkte matematik →
   opfølgning → tidsværktøj → opfølgning → semantisk afslutning. Første tekst må ikke
   tabes, UI må ikke vise en uaccepteret tur som afleveret, og hver direkte tur skal give
   ét fuldt svar uden lifecycle-værktøj eller ekstra modelrespons.
2. Opdatér derefter add-on til den beståede kandidat og gentag den korte golden chain. Den første klare
   afslutning skal vælge `end_conversation`; de almindelige ture skal svare direkte,
   mens opslag kun må bruge deres relevante domæneværktøj. Et bevist playback-start/slut-
   par må ikke efterfølges af `playback_fault`; afslutningen skal ende med mørk IDLE og
   fungerende wake.
3. Kontrollér at den nye trace fortsat viser `prompt_source=default`,
   `prompt_version=5`, og at Realtime accepterer `max_output_tokens=1024` og
   sessionens automatiske værktøjsvalg. Et korrekt
   svar tæller ikke som bestået, hvis kendt testinput bliver tomt eller semantisk forvansket.
4. Kør 10 ubrudte fysiske lifecycle-cyklusser på samme kandidat. Ingen gain-, VAD-,
   prompt- eller UX-tuning midt i serien.

## Bindende roadmap efter adgangskravet

1. **Udviklingsprioritet 1 — total hastighedsoptimering.** Mål den oplevede fysiske kæde
   fra `speech_stopped` til `playback_started`, og vis hvert delstræk separat. Optimer
   kun den største målte flaskehals ad gangen. Enkle ture skal nå p50 ≤ 1,2 s og p90
   ≤ 1,8 s; stretchmålet er p50 så tæt på 1,0 s som muligt. Eksterne opslag måles
   særskilt, så langsom web/HA ikke skjuler PodVoices egen transporttid. Et earcon eller
   “det tjekker jeg” tæller ikke som første meningsfulde svar.
2. **Udviklingsprioritet 2 — ét diskret “jeg har hørt dig”-signal.** Først når
   latency-gaten er fysisk bestået og låst, må et ca. 80 ms firmwarelokalt signal ved
   `UserSpeechStopped` bygges som en tredje, isoleret mixerindgang. Det må køre parallelt
   med Realtime, aldrig bruge announcement-vejen og aldrig ændre mic-gate, VAD,
   playback-telemetry, ekkoskærm, semantisk lukning eller rearm.
3. **Udviklingsprioritet 3 — automatisk HA/MCP-recovery.** Hvis
   HA-værktøjsforbindelsen fejler, fortsætter
   samtale, tid, web og musik, mens PodVoice forbinder igen. Hjem og vejr bliver
   automatisk aktive igen uden reload eller genstart, og panelet viser den konkrete
   fejl samt recovery-status.
4. **Udviklingsprioritet 4 — fuld fysisk funktionsmatrix.** Dansk, hjem, vejr, web,
   musik, timere og
   opfølgninger køres med de faste antal og korrekthedskrav i `docs/PRODUKTMÅL.md`.
5. **Udviklingsprioritet 5 — samlet UI-gennemgang.** Hele panelet gennemgås funktionelt
   og visuelt på mobil,
   HA-app og desktop: readiness-sandhed, fejlhandlinger, Talk, indstillinger, test,
   historik, dansk sprog, accessibility og browseradfærd skal bestå deres UI-gate.
   Felt-TODO 21. august: Tryk på Voice PE-knappen gav ingen synlig handling, status
   eller fejlfeedback. Kontrollen skal spores fra klik til backend-resultat og altid
   vise udfald; observationen må ikke fortolkes som en wake-/Realtime-fejl.

Derefter følger 7-døgns stabilitet og den målte Gemini/Alexa-sammenligning.

Latency og feedback må ikke udvikles i samme kandidat: først måles og låses den hurtige
baseline, derefter tilføjes feedback som en separat, fuldt reversibel feature. Fuld
duplex, barge-in og nye motorer er ikke en del af denne rækkefølge.

<!-- historical-103-button-coupling
{
  "version": 1,
  "base_tip": "8581e16e4f0f60dd49f4046a0a019bb13dbbb70d",
  "merge_base": "8581e16e4f0f60dd49f4046a0a019bb13dbbb70d",
  "domains": [
    "physical_output",
    "rearm"
  ],
  "fingerprint": "49318dcdb8300456395105c6768c2a9192ba47613f85c574c58f780960800667",
  "reviewer": "connect_recovery independent adversarial review",
  "rationale": "Button-only local Stop boundary: physical short release latches microphone capture, revokes reply admission and stops local announcement before publishing the existing event to the sole ThinSession cleanup/rearm owner. Reviewed immutable component26148b9 and paired103 runtime/YAML identities match the compiled firmware. Prior independent review covered stale playback, repeated presses, timer precedence and cancellation-resistant rotation joins before rearm. ThinSession, Live prompts and evaluation scripts are byte-identical to installed102; failed semantic candidate is excluded. This exact software coupling does not claim physical button or lifecycle acceptance."
}
-->

<!-- historical-112-candidate-scope-coupling
{
  "version": 1,
  "base_tip": "a3ac48a983844feccfe98e83bd9aa34d8313ec47",
  "merge_base": "a3ac48a983844feccfe98e83bd9aa34d8313ec47",
  "domains": [
    "audio_input",
    "physical_output",
    "realtime_semantics"
  ],
  "fingerprint": "d33f91e32bccb87c940b6bdb229abcd007920f77690721d63b7bab43bd32ac8f",
  "reviewer": "astra_closure_solution independent adversarial final source and scoped tooling review",
  "rationale": "One approved experimental Alpha closing chain: callback source provenance and physical LED TX acknowledgement to one ThinSession bounded audio/context decision and existing replay/finalizer/rearm. All five severe runtime findings fixed with causal regressions; exact final component083424 and actual ESP32-S3 compile match. Talk/OFF and authorization unchanged. Guard stays inactive until artifact-bound measured physical coverage; provider/room acceptance not inferred. Narrow tooling admission independently reviewed at patch1f9e6f4b with negative stale/deleted/extra-domain regressions. Complete fast gate and targeted tooling38 tests green; one frozen release gate follows."
}
-->

### 6/10 — aktiv .116: gul fase gentager ikke det allerede opfyldte UI-vindue

Lead/root. Base main 9a1d7f1 (.115), usynkroniseret dev-clone. Brugerens tre
fysiske prøver lukkede automatisk: første, TV/baggrundstale og høj musik.
Samme installerede rootfs-v1 efa60669826c99d0989e6fe651a865e6ad9abbe9a53c1a7750567203f673d5d7,
firmware podvoice_build_113112_liveclosing1. Gul→sluk var 8.823/3.983/6.771s.
Frisk, reduceret privat evidens: /private/tmp/pv115-field-20261006/closure-summary.json.
Traces er incomplete; ingen rumoptagelse eller golden/10/10 udledes.

Falsificerbar årsag: count0/provisional sourcehuller nulstiller quiet-ankeret
EFTER korreleret gul LED-TX. _run_live_idle_preclose og finalizer kræver derefter
igen hele UI4s, selv når den aftalte 2s fase er udløbet, og frisk valid fysisk
forbrugt nuloutput fra samme kilde er tilbage. Første prøve genopbyggede 4s;
TV-prøven uden dette hul holdt omtrent 2s. Providerterminal og fysisk drain/rearm
lægger fortsat omtrent 2s til; denne kandidat lover ikke gul→sluk på 2s.

Berørt kæde: mic/providerarbejde → announcement FLAC/mix → faktisk consumption
→ UI4s admission → native LED-TX/2s → atomisk finalizer → providerterminal →
streamfinish/fysisk drain → teardown/rearm/næste wake. Alpha-undtagelsen bevares;
ThinSession ejer én lukning, firmware ejer fysiske events, modellen ejer semantik.
Invarianter om identitet, friskhed, stale events, playback-sandhed og fysisk rearm
bevares. Ingen ny fortolker, prompt, gain, VAD, firmware, transport eller UI-timeout.

Plan: efter UI4-admission bindes den fulde native outputproof-identitet til gul.
Ved udløbet kræves samme identitet og FRISK, VALID, faktisk forbrugt nuloutput
uden endnu en 4s periode. Count0/stale/missing kan aldrig autorisere lukning.
Ny lyd/backend/tekst/Stop/reset/source-skift ophæver den gamle tilladelse. Finalizer
validerer præcis task/token/deadline uden await inden ownership-overførsel.
Regressioner: feltets provisional→frisk same-owner zero; intet frisk bevis;
source/reset/playback-skift; forkert/direct token; pending SDK-arbejde; gamle
Stop/wake/LED-races, Talk/OFF. Uafhængig adversarial review før diff-freeze,
relevante gates, én releasegate og grøn main-artifactinstallation. Rollback ved
forkert generation, tidlig afklipning, stale adgang eller uløst alvorlig finding.

Seneste to samtaler er også læst: 11:52:37 trace ...5eece6c7 slutter app-idle-timeout;
11:53:07 trace ...9343b9ae slutter model-close, terminal backend settled +16229ms,
providerclose +23863ms, playbackfinished +25286ms, rearm +25709ms. Ingen gul er
forventet i semantic-close-vejen. Semantic-vejen bruger fortsat den gemte UI4s
outputquiet-policy; ingen prompt/semantik ændres på gæt i denne timing-kandidat.
Inputordene skal kontrolleres i historikken før sammenkædning med tak/farvel.
Et spørgsmål påbegyndt før gul, men uden endnu observerbart providerarbejde eller
output, er fortsat en fysisk accept-usikkerhed; komponenttests beviser ikke det.

Første status ved beslutningsoprettelse: endnu ikke implementeret. .115 er fortsat
den installerede feltbaseline. Faktiske resultater og kandidatstatus følger nedenfor.

Scope præciseret af brugeren: ved semantisk farvel skal UI4s netop ikke bruges.
Historik bekræfter 11:52 “Tak”→“Velbekomme” og 11:53 “Tak, farvel”→“Ja. Farvel.”
Sidstnævnte HAR model-close, men gammel _finish_live_conversation nulstiller et
nyt semantisk quiet-vindue og venter UI4 før providerclose. Modellen har besluttet
END og den obligatoriske nulværktøjs-continuation er settled; app-inaktivitet er
ikke længere den rette admission. Kæden udvides til semantic receipt → gennemført
resultat/continuation → atomisk current-receipt → providerclose med receiver åben →
session.closed → FLAC-streamfinish → eksakt fysisk playbackfinish → teardown/rearm.
OpenAI live-conversations#usage-and-graceful-close er hentet: afslut nødvendig
Responses-arbejde, send session.close, modtag ventende events indtil session.closed,
og ryd lyd/transport op bagefter. Active Responses kan afslutte; queued arbejde
annulleres. Ingen tale-/audio-done-event opfindes.

Ny hypotese: en gyldig afsluttet semantisk receipt kan bruge eksisterende finalizer
umiddelbart uden inaktivitetstæller; receiver/FLAC skal fortsat acceptere sidste
providerlyd helt indtil terminalevent og fysisk hale skal afspilles før rearm.
Talks ubekræftede browserdræn forbliver særskilt parkeret og får ingen ny påstand.
Regressioner: semantisk luk uden native quiet-målinger/UI4, sen farvellyd efter
close-request men før providerterminal, forkert playbackfinish, manglende terminal,
Stop/ny generation, gammel receipt, værktøjer/continuation pending og queued input.
Rigtig installeret SDK-protokol skal dækkes; fokuseret semantikpreflight/gate
kontrolleres efter produktkontrakten. Fysisk afspilning af HELE farvel og ny wake
kræves i kandidatprøven; software alene beviser ikke providerens talehale.

Review fandt desuden en konkret P1-race i første .116-diff: monotonic kan krydse
freshness-grænsen mellem to checks uden await. Optimistisk committed=True kunne
springe native LED-cancel over ved afvist finalizer. Stop-the-line indtil permanent
regression og korrekt admitted-ownership er på plads. Ingen release/install udført.


Implementeret .116 (endnu ikke released/installeret): gul adgang bevarer hele native
proof-owner og atomisk task/token/deadline; frisk, faktisk forbrugt nuloutput fra samme
kilde kan revalidere ved deadline uden at gentage UI4s. Provisional/stale kan ikke
lukke. P1-freshness-racen er rettet: native cancel springes kun over efter faktisk
admitted finalizer-ejerskab. Permanent clock-crossing- og pending-SDK-regression er grøn.
Semantisk, gyldig END/settled-continuation går direkte til eksisterende finalizer;
receiver er åben indtil session.closed, så også første lyd efter session.close modtages.
Eksakt fysisk lease-finish kræves fortsat før teardown/rearm. Talk/OFF er uændret.

Uafhængig yellow_phase_review: ingen uløste source-P0/P1. Runtime SHA256 thin.py
6e5fe54273b343d456a5169fa1455075a629a3e5da0de9da617a5c68f947a7d4, live_idle.py
3611aea369b51f4f118490f1eb9ddb1f24607dece91081b1f7dca2f44278f04b.
Permanent faktisk SDK-wire-regression er 17/17 grøn og injicerer første PCM EFTER
close-request, terminal og forkert/rigtig fysisk finish. Harness unit-oraclet havde
en gammel UI-venteforventning: positiv observation holder nu test-only admission
udtrykkeligt; alle tre modes og oracle-assertions bevares, 23/23 grøn. Ingen runtime-
patch er udledt af testens timeout. Samlet opdateret fastgate kører; releasegate ikke kørt.

Rigtig SDK3.13.0/GPT-Live-protokolprobe: én syntetisk math→farvel-session med offentlig
standardprompt, ikke installeret customprompt. Input “Tak, farvel”, output “Jeg afslutter
samtalen.”, eksklusiv END, gennemført resultat og nulværktøjs-continuation, close+17.756s,
terminal+18.557s og ren syntetisk rearm. Tre audio-deltas modtages efter close; 449280
PCM-bytes, sidste nonzero +9192ms i providerlydaksen. Original oracletest fejlede ved
ordret krav om “farvel”; originalresultat bevares, uafhængigt review klassificerer det
som oracle-falsk-negativ, ikke en runtime-fejl. Reduceret privat evidens i
/private/tmp/pv116-real-farewell-networkfixed-20261006/mechanical-observation.json.
Ingen rum-/farvel-/wake-godkendelse udledes af nullsink eller transcript.

Review kræver den fokuserede semantiske 5×-gate, da providerens lydafslutningsgrænse
flyttes; smallere protokolprobe er ikke nok. Brugeren har godkendt gemt prompt til
OpenAI samt privat midlertidig HA-adgang for kun GetDateTime. HA tilbyder udelukkende
bred, teknisk 10-årig nøgle; automatisk approval kræver dette præciseret og godkendt
før oprettelse. Ingen ny nøgle er oprettet endnu. Kandidaten er ikke releaseklar før
5×-gate, afsluttet fastgate, endeligt review og én frossen releasegate. .115 er startet
igen efter den afgrænsede prøve. Ingen settings/firmwareændring eller hus-sideeffekt.


6/10 .116 faktisk gate-status: samlet fastgate PASS (149,2s, alle unit-/integration-,
Ruff/format/mypy; ingen skipped cases). Brugeren godkendte udtrykkeligt HA-nøglens
brede kontoadgang/10-årige tekniske gyldighed. Nøglen blev oprettet, privat overført,
kun anvendt i den afgrænsede proces og tilbagekaldt efter første fejlede prøve;
HA sikkerhedssiden viser nu ingen langlivede tokens. .115 er genstartet og panelet
viser 1.13.115, Voice PE forbundet og ingen åben samtale. Ingen hus-sideeffekt.

5×-gaten STOPPEDE ved første math-input, fixture_response_deadline_math. Ingen af
fem sekvenser er bestået. Input matcher “Hvad er seks gange syv?”, 38794 sourcebytes;
kontinuerligt input/resampler matcher gemte bytes. 24 outputaudio-events er alle
nul-PCM (115200bytes); ingen svartekst, backendrespons eller END-receipt. Den ændrede
lukning blev kun nået ved oprydning, så dette begrunder ingen runtime-patch.
Privat evidens: /private/tmp/pv116-five-live-20261006/summary.json og session-1.
Pris $0.0016667, én forbindelse, ingen automatisk retry. Release-GO tilbageholdt.

Næste afgrænsede årsagskontrol er én transportdiagnose med præcis samme første
fixture/config og 18s svargrænse: faktisk SDK append-enter/return/byteantal/varighed
og receiver-events. Observer-hook før append er ikke send-kvittering. Ingen nye
runtimeindstillinger/prompt/gain/VAD; ingen HA-nøgle nødvendig til første math.
Diagnosen tæller ikke som 5×-gate. Helper-oraclet strammes separat: 0,6s pause er kun
pacing; weekday-opfølgning må ikke kalde værktøj; succesfuldt eksakt sink-dræn skal
ligge før rearm, cancellation/finally er aldrig afspilningsbevis. Ved fortsat ukendt
fejl stopper kandidaten; ingen blind gentagelse af gaten.


Den ene transportdiagnose er gennemført, helper SHA548de02e1e59e61cec5f5dae5d6e07761218bd90739d7a58ac9bffe462bf1591:
samme præcise math-fixture38794bytes, saved/public prompt9f18, GetDateTime-schema,
én forbindelse, ingen HA-nøgle/kald. 155 faktiske SDK append-enter/return, nul fejl,
max1,711ms; 26 outputaudio-events/124800bytes, heraf28800nonzero. Input matcher
spørgsmålet; første svarlyd og “Det er” observeres +5,968s. Diagnosen stopper ved
svarstart og beviser IKKE svarets korrekthed/fuldstændighed. Slutforbrug er kendt,
cleanup lykkedes, pris $0.0016667. Privat report:
/private/tmp/pv116-transport-diagnostic-20261006/report.json. Det første gate-failure
bevares; årsagen er ikke reproduceret og kan ikke sikkert placeres hos provider.
Ingen produktionspatch er udledt. .115 er startet igen. Helperens eksakte EOF/lease-
regressioner er grønne offline; ny femgate er endnu ikke startet eller godkendt.


Diff-freeze-review final_116_review (Sol Ultra, read-only) bekræfter samme base9a1d7f1
og runtime-SHAer: conditional source-GO, ingen source-P0/P1. Yellow proof/task/token,
semantic current settled receipt, receiver→terminal→exact leasefinish og Stop/newwork/
stale-nextwake er kontrolleret. Talk/OFF uændret; ingen fysisk accept udledes.
Den ene fulde lokale releasegate PASS, 109,8s; Ruff/format202filer, mypy55, alle97
unitmoduler og hele integration. Ingen genkørsel eller runtimeændring efter freeze.

Uafhængigt review giver GO til ÉN ny 5×-gate med rettet helper, actual SDK-send-observer,
exact EOF/lease-finish før rearm og weekday uden værktøj. HelperSHA
40e4af50e8322cecf3be6b879fc52c76a338d9ca7a4f4e9af1f2292b5d9f7da0; offline validation
SDK3.13.0 PASS uden forbindelser. Alle25 input/svar/tid og lifecycle kræver review.
Samlet live-pris under $5, første faktiske fejl stopper igen; originalfejl bevares.
Ny gate afventer udtrykkelig action-time-godkendelse til en NY tilsvarende HA-nøgle,
da den første allerede er tilbagekaldt. Ingen ny nøgle, gate, PR/merge/release eller
.116-installation udført endnu. Installeret .115 kører igen med Alpha; firmware uændret.


6/10 klargøring til bygning efter brugerens “når alt er lavet, byg og installer”:
draft-PR #93 https://github.com/BixelVentures/podvoice/pull/93 er oprettet og attached.
Head a18a89f9161c43366c1047b42091f867779caf91, tree445ecca5faf3e04dd2353d509f69cb9ee94fbe7d.
Alle12 GitHubblob-SHAer matcher det lokale, testede diff; samlet Git-tree matcher også.
Lokalt HEAD er bundet til samme remotecommit uden reset; ingen runtimeændring.
PR CI run37454085723/run497 er startet automatisk med fuld lint/test og ARM64bygning.
Ingen manuelle CI-genkørsler, merge/mainpublicering eller installation. PR er draft,
og semantisk5×-gate forbliver obligatorisk. Ny HA-nøgle er endnu ikke oprettet.


6/10 PR #93 CI run37454085723/run497 er færdig SUCCESS på head a18a89f9161c43366c1047b42091f867779caf91:
lint-test112237305195 SUCCESS og build-addon112237305510 SUCCESS. Publish er SKIPPED,
fordi dette er en draft-PR, ikke main. ARM64-buildcontext
61234d1ba09d733ea0cc92f71f403c8d5db92250399ccf29d43b3d18fbb9a6f9;
OCI index sha256:06e579fe9af791acc9125b02d23a22f99a478bf912ee1c36a9563d11fabbcbad,
platformmanifest sha256:7df3e43d356fb10372974bfa0c71eb84670ef0ba60b16e25bbb608279d2eacaa.
Buildarg/OCI-revision matcher PR-head. Ingen manual retry. Dette er en byggede
PR-kandidat, IKKE publiceret/installeret main og ikke semantisk/fysisk godkendelse.

Samme nødvendige blocker er nu gentaget gennem tre målturns: den første HA-nøgle er
revoked, og ny security-sensitive oprettelse har ikke fået sit action-time-svar.
Afgrænset 5×-gate kan derfor ikke starte, og release-GO/merge/main-install kan ikke
udføres. Al uafhængig source-review, én lokal releasegate og PR CI/ARM64bygning er
færdig; ingen live proces afventer mere. Ingen ny nøgle/providerprøve/runtimepatch
startes på et gættet samtykke. Goal markeres blocked, indtil brugerens nøglesvar
kommer; allerede godkendt merge/installation kræver ikke nyt installationssamtykke.


6/10 brugerens “Ja til alt” godkender nu udtrykkeligt det udestående spørgsmål om
NY tilsvarende midlertidig HA-nøgle (bred kontoadgang/10-årig teknisk gyldighed),
privat anvendelse kun GetDateTime i én ny afgrænset femgate og straks-revoke også
ved fejl. Goal er resumed/ACTIVE. Installeret baseline forbliver .115; source/SDK/
helperidentitet er genkontrolleret uændret før prøve. PR #93 CI/ARM64 er allerede grøn.


6/10 ny, godkendt 5×-gate /private/tmp/pv116-five-renewed-20261006 STOPPEDE på
første sessions math-opfølgning. Input er “Hvad er6gange7? Læg to til det tal”.
Provideroutputtranscript svarer først42 (“Seks gange syv er toogfyrre”), derefter48
(“Otteogfyrre”), forventet44. Første math er korrekt; ingen fuld femsekvens er grøn.
467 faktiske SDK sends returnerer, nul sendfejl, max1,084ms; ingen backend/tool/END
før fejl. Ny closingkode er ikke nået. Intentional oprydning efter gate-fault giver
synthetic sink LiveAudioError; det er ikke bevis for semantic-close-regression.
Slutforbrug voice9s/backendcomplete, pris$0.0075; ingen blind retry.

Ny nøgle blev oprettet efter “Ja til alt”, anvendt kun i prøven og straks tilbagekaldt
ved fejlen. HA viser ingen langlivede tokens. Privat credentialfile blev slettet før
connect. .115 Start er sendt igen; frisk running-status skal bekræftes. PR #93
forbliver draft/grøn softwarebygning, IKKE testklar til release; fuld semantikgate
mangler. Den observerede fejl er nu afgrænset til opfølgningssvar/evt transcript,
ikke til send-stall eller afslutningsvej. Uafhængig raw-review er startet før yderligere
beslutning; ingen prompt/model/gain/VAD/runtimepatch udledes af denne kontrolfejl.

Uafhængig raw-review yellow_phase_review finder ingen konkret harness-/oracle-fejl:
fixtures er byteidentiske og produktionsresampler reproducerer alle providerbytes.
Alle467 sends lykkedes. Transcript48 er en reel semantisk gate-failure; revieweren
har ikke kunnet gennemlytte ordet og påstår derfor ikke akustisk48-bevis. END og
ændret closingkode nås ikke før oprydning. Ingen begrundet runtimepatch eller
blind ny gate. Fuld .116 normal release-status forbliver ikke releaseklar.

Frisk HA-UI bekræfter installeret .115 Kører efter genstart. Brugeren er nu stillet
ét konkret spørgsmål om eksplicit undtagelse: installere samme kilde-reviewed,
softwaregrønne .116 som Alpha-feltkandidat trods den fejlede primære modelkontrol,
uden at kalde den release-/lifecycle-godkendt eller97/100. Ingen sådan undtagelse
er antaget på det generelle “Ja til alt”, som godkendte nøgle/prøve. PR93 holdes
draft, gate-failure er tilføjet PR-body; ingen merge/main-publicering/installation.

Genstart/restoration er nu frisk bekræftet: HA appinfo Kører1.13.115, panelet
VoicePEforbundet, ingen åben samtale; SettingsAlpha-checkboxchecked, UI4 og
beggewakewords devicebekræftet. Ingen settingsskrivning. Frisk privat screenshot
/private/tmp/pv115-restored-alpha-20261006.png. ChatGPT-readiness står ærligt
standby/ikkeprøvet efter genstart; ikke en ny fysisk wake-/samtalegodkendelse.

final_116_review har derefter bounded-reviewed seneste STATUS/renewed-report:
ingen ny sourceP0/P1 eller direkte fysisk modevidens. ConditionalGO alene til
udtrykkeligt brugergodkendt Alpha-felteksperiment på uændret a18a89f; IKKE normal
release/testklar/lifecycle97 og ikke waiver af den fejlede5×gate. Afvent konkret
undtagelsessvar. Ved klippet farvel, stale lyd, Stop/teardown-fejl eller tabt næste
wake standses feltprøven og .115-baseline/settings geninstalleres; rollback arver
ingen golden/10×status. Ingen nye providerkald eller firmware-/promptændringer.

Blokeringsaudit efter tre sammenhængende målturns (brugerresumption plus to
automatiske fortsættelser): faktisk renewed-summary viser stadig passedfalse og
math_answer_mismatch_math_followup; source a18a89f uændret, PR93 stadig draft og
ikke merged ved seneste friske GitHubkontrol. Krævet5×gate er ikke bestået, og
konkret spørgsmål om feltkandidat-undtagelse er ubesvaret. Ingen levende prøve
afventes, ingen evidens begrunder kodepatch eller blind retry. Der er ikke mere
meningsfuldt autoriseret arbejde uden brugerbeslutning. Goal sættes blocked,
IKKE complete eller paused; hele målet og fejlede gate bevares. .115Alpha er
genstartet/bekræftet; ingen .116-mainartifact er publiceret eller installeret.

Brugeren svarer nu konkret “installere tak” efter spørgsmålet om undtagelse til
den fejlede modelkontrol. Det er eksplicit godkendelse til installation af .116
som Alpha-feltkandidat på de kendte vilkår, ikke en bestået5×gate eller97/100.
Goal er ACTIVE igen. Source er uændret a18a89f/runtimeSHAer; providerfejl42→48
bevares uløst. Ingen runtime-/promptpatch er begrundet. final_116_review har givet
conditional feltGO på netop denne brugerundtagelse. Denne dokumentationsopdatering
ændrer ingen shippede runtimebits og ugyldiggør ikke den ene frosne releasegate.
PR93 skal merge til grøn main/publiceret1.13.116 og installeres med AlphaON og
uændret firmware; eksakt artifact og faktisk readiness kontrolleres efterpå.

6/10 .116 er faktisk publiceret og installeret som eksplicit godkendt Alpha-feltkandidat:
PR93 merged, main a2b5a27e997ff168f0ca99e86611b466750acd6e,
tree83dc9feb1d8ea41c4e785703e0a57972263f8515. PR498 og main499/run37459745559
SUCCESS; main lint112256053118 og publish112257280194 SUCCESS, ingen manuelle
CI-genkørsler. OCIindex sha256:82db4718463b476d6d4d3393a8145c6420b6d7ee9240def986d41bea6a4d1fb0;
ARM64manifest sha256:2607975e067eb34ddfa82e1f9ae16f4014a538b27d4dde782be008061726c89a.
Buildcontext61234d1ba09d733ea0cc92f71f403c8d5db92250399ccf29d43b3d18fbb9a6f9.
HA Opdatér til1.13.116 udført med .115-backup tilvalgt. Frisk startup14:05:29
beviser version116 og eksakt mainSHA samt rootfs-v1
dcdbfac9db5aa1bad9be61a97aeead2ae2f665679b65cad5cf48e99ce675d0f5.

VoicePE genforbundet14:05:32, firmwarecontractOK, uændret
podvoice_build_113112_liveclosing1; channel1/gain16 og begge wakewords devicebekræftet.
Panelet viser v1.13.116/statuslive, forbundet/ingen åbensamtale. SettingsAlphaON,
UI4 og gemtHeyChat+HeyJarvis bekræftet; ingen settings-/firmwareskrivning. Privat
screenshot /private/tmp/pv116-installed-alpha-on-20261006.png. Ingen ny GPTLive
forbindelse eller fysisk samtale startes uden brugerens efterfølgende prøve.
Readiness viser ærligt standby/ikkeprøvet og wakeafprøves. Begge midlertidige
HA-nøgler er tilbagekaldt; credentialfiler slettet. .1165×modelgate forbliver FEJLET
(42→48, expected44), installeret ved eksplicit brugerundtagelse; IKKE97/100,
normal releaseaccept eller fysiskgolden/10×. Talk-browserdrain er fortsat parkeret.

Installationsmålets slut-audit: runtimefix/source-review/regressioner/énlocalreleasegate,
greenmain/immutableartifact/HAinstallation/AlphaON/kompatibelfirmware og nøglerevoke
har direkte evidens ovenfor. 5×gate udført men afvist, undtagelsen er menneskegodkendt;
ingengatefailure slettes. Fysisk farvelhale, guldeadline, korrekt cancellation og
næstewake er UBEVIST på116 og afventer brugerens prøver. Ved regressionsfejl stands
prøven og rollback115; installation kan afsluttes som den godkendte feltleverance,
ikke som fuldAlpha-/produktaccept. Ingen fortsat optimering før fysisk feedback.
