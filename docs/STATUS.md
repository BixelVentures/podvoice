# PodVoice-status — én aktuel sandhed

Senest opdateret: 2026-08-20.

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
| Fysisk Voice PE-gate, 10/10 ubrudt | **Mangler; aktuelt fysisk bevis er 1/10** |
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

## Aktiv kandidat

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

**v1.13.23 er den aktive lokale softwarekandidat.** Den fjerner den obligatoriske
fortsættelsesbeslutning og den tvungne to-respons-vej. Realtime bruger automatisk
værktøjsvalg: direkte spørgsmål besvares i én respons, domæneværktøjer bruges kun ved
behov, og `end_conversation` forbliver den eneste modelsemantiske lukningsautoritet.
Firmware, gain, VAD, pre-roll, half-duplex, playback og rearm ændres ikke i denne
kandidat. Lokalt er 483 tests, Ruff, formatteringskontrol og mypy for 39 kildefiler
grønne. Add-on-build, installeret live-preflight og fysisk gate mangler fortsat; den er
derfor endnu ikke testklar.

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

Derefter følger 7-døgns stabilitet og den målte Gemini/Alexa-sammenligning.

Latency og feedback må ikke udvikles i samme kandidat: først måles og låses den hurtige
baseline, derefter tilføjes feedback som en separat, fuldt reversibel feature. Fuld
duplex, barge-in og nye motorer er ikke en del af denne rækkefølge.
