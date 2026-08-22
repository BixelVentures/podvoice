# Maskinel PodVoice-evaluering

Den maskinelle eval er et ekstra bevislag under de bindende gates i
`docs/PRODUKTMÅL.md`. Den kan aldrig erstatte den fysiske Voice PE-gate.

## Hvad den beviser

`gatekeeper.eval_harness` kører faste danske samtalescenarier gennem en lille
`ConversationDriver`-kontrakt. Samme oracle kan derfor bruges af den direkte
Realtime-adapter, Talk og en simuleret Voice PE-adapter uden at skabe flere
samtalemotorer.

Kernescenarierne dækker:

- direkte svar og kontekstuel opfølgning i samme session;
- korrekt valg af tid og web;
- almindelig høflighed uden falsk lukning;
- Realtime-semantisk afslutning;
- direkte svar i én respons uden et kunstigt lifecycle-værktøj;
- eksplicitte providerfejl, timeout og lifecycle-resultater.
- Prompt V6's serverholdte godkendelsesforløb: et følsomt forslag giver
  `needs_confirmation` og nul fixture-effekter, kun det eksakte challenge-id på den
  umiddelbart næste tur kan frigive handlingen én gang, og replay/ændring/udløb afvises;
- en følsom handling sammen med afslutningshensigt forbliver åben, mens en
  lavrisikohandling skal afsluttes før et efterfølgende `end_conversation`-kald.

Mekanik bedømmes eksakt. En forkert beslutning genkøres ikke væk. Gentagelser
bruges senere til at måle modellens variation, ikke til at vælge et heldigt svar.
Et komplet værktøjsbatch stages uden effekt og frigives først på en ikke-tom,
eksakt matchende `ToolRoundComplete.response_id`. Manglende, stale eller forkert marker
fejler turen med nul fixture-effekter; et efterfølgende `TurnComplete` kan ikke
bagudrettet autorisere batchen.

## Sikker live-kørsel

Live-eval er opt-in og bruger `SafeEvalTools`. Routeren indeholder ingen HA-, MCP-
eller PodConnect-klient og returnerer kun faste testresultater. Et ukendt værktøj
nægtes. Når add-onen kalder evalueringen, eksponeres den fulde aktuelle liste af
produktionsdeklarationer for Realtime plus ét eksplicit mærket, eval-lokalt følsomt
fixture-værktøj. Dispatch forbliver den sikre lokale router. Fixturet genbruger
produktionens `ExecutionPolicy`: det første kald returnerer præcis samme
`needs_confirmation`-wireformat med `approval.challenge_id`, og godkendelse går gennem
samme sessions-, tur-, argument-, udløbs- og one-shot-barriere før en tæller ændres.
Der oprettes aldrig en rigtig HA-, MCP- eller PodConnect-klient.

Rapporten skelner mellem `tool_schema_sha256` for det faktisk eksponerede evalskema,
`production_tool_schema_sha256` uden det ekstra følsomme fixture og
`reserved_tool_schema_sha256`. De tre reserverede deklarationer — `end_conversation`,
`wait_for_user` og `approve_action` — importeres direkte fra produktionen og erstattes i
samme rækkefølge; evalueringen har ingen kopieret skemavariant. Audio-replay bruger
fortsat profilen `production-replay` uden eval-fixture, så trace-schemahashen kan
sammenlignes direkte med produktionssporet.

Dermed kan den rigtige produktionsprompt, Realtime-model og værktøjskonkurrence testes
uden at tænde lys, starte musik eller ændre hjemmet.

I add-on-panelets Test-fane køres samme afgrænsede suite med **Kør sikker preflight**.
Det ingressbeskyttede endpoint er `POST /api/eval/live`; requesten kan kun vælge kendte
scenarie-id'er og kan aldrig levere API-nøgle, model eller værktøjsimplementation.

Den selvstændige CLI kan liste de statiske scenarier, men `--live` er pensioneret og
fejler før budgetlease, provider-socket og værktøjsdispatch. CLI'en kan ikke levere og
bevise add-onens eksakte frosne produktionsværktøjssnapshot. Live-kørsel må derfor kun
startes fra Test-fanen gennem det autentificerede ingress-endpoint, hvor
`LiveEvalService` modtager snapshot og serialiserer kørslen.

Live-eval og de rigtige Voice PE-/Talk-sessioner deler én procesbred
provider-budgetkoordinator per envejs-hashet nøgleidentitet og model. Den rå nøgle
gemmes eller vises aldrig i ledgeren. En produktionssession tager straks en konservativ
15.000-token lease, som dækker første svar og en mulig værktøjs-/farvelopfølgning.
Den eksplicit startede live-preflight er en gensidigt eksklusiv diagnostiktilstand:
den kan kun starte uden en aktiv produktionssession, og nye Voice PE-/Talk-sessioner
afvises hurtigt som `diagnostic_busy`, indtil den bounded eval er lukket og låsen
frigivet. Det er en synlig vedligeholdelsestilstand, ikke en påstand om parallel
rate-limit-isolation. Hver eval-/replay-prøve må kun starte, når providerens
`rate_limits.updated` har givet et autoritativt tokenbudget, ingen produktion er aktiv,
og diagnostiktilstanden fortsat ejer den eksklusive providerlås. Kun én eval-prøve kan
have reservationen ad gangen. `response.done`-usage debiterer både input-/outputtekst og -lyd;
providerens næste rate-limit-event afstemmer remaining/reset med et monotont ur.
Reconnect, fejl og teardown frigiver kun deres egen generation én gang. Eval genkører
aldrig en afsluttet tur automatisk for at skjule rate-limit eller modelvariation. Som
en bevidst konservativ P2-begrænsning accepteres kun én samtidig produktionssamtale i
add-on-processen: et parallelt Talk-/andet-rum-forsøg afvises straks og køes ikke. Det
ændrer ikke den aktive ene Voice PE-samtale, men ægte samtidige rum kræver en senere,
separat kapacitetsgate.

Kommandoen foretager en rigtig, men afgrænset provider-evaluering og må kun køres
eksplicit. Unit-/CI-kørsler foretager ingen live API-kald. Et grønt fixture-scenarie er
derfor maskinel kontraktevidens; det må ikke rapporteres som en gennemført live-eval,
før kommandoens rapport faktisk har status `complete`.

Hver kørsel har hårde lofter for antal ture, reserverede outputtokens, faktiske
tokens og estimeret pris. Faktiske tokenfelter gemmes særskilt, så prisestimater
kan opdateres uden at ændre det oprindelige bevis.

Den semantiske profil tillader højst tre providerresponser per brugertur og 36 for hele
standardprofilen. En tredje værktøjsloopkant stoppes før ny fixtureeffekt eller en
fjerde Response. Før hver tur reserveres den konservative pris for alle tre kanter;
samlet faktisk pris stopper ved $5, og budgetproben har sit separate $0,128-loft.
Manglende, negativ eller malformed `response.done.usage` klassificeres
`provider-usage-unknown` og stopper kørslen uden næste providerkant. En custom prompt
over 32 KiB blokeres før diagnostiklås/socket uden at ændre produktionsprompten.

Audio-replay reserverer desuden eksakt PCM-varighed gange antal lydforsøg til OpenAIs
særskilt fakturerede `gpt-live-transcribe`-pris på $0,017/minut. Tekstkontrollen har
ingen transskriptionsafgift. Beløbet indgår i samme $5-loft før provider-socket og
rapporteres særskilt som `transcription_budget`; `budget.cost_usd` er det samlede
estimat. Produktionsmåleren registrerer konservativt faktisk videresendt mikrofonlyd
som en separat transskriptionspost, fordi `response.done.usage` kun beskriver
Realtime-responsen.

Før en completed tool-batch frigives, skal dens eksakte input-/outputusage plus et
2 KiB UTF-8-bundet toolresultat, 1.024 nye outputtokens og 512 tokens protokolmargin
kunne rummes. Ellers udsendes nul `ToolCall` og dermed nul fixture-/lifecycleeffekt.
Et scenarie bliver kun grønt, når dets eksakte fixtureargumenter og krævede
værktøjsudfald også er observeret; et tilfældigt korrekt slutsvar kan ikke erstatte en
afvist fixture eller et forkert værktøjskald.

På en frisk add-on-proces findes providerens authoritative tokenbudget først, når en
Response er begyndt. Hver eksplicit live-eval udfører derfor højst én separat
budgetprobe, når autoriteten mangler: en ny,
værktøjsfri Realtime-session sender en kasseret out-of-band tekstresponse med højst 64
outputtokens. Både `rate_limits.updated` og completed `response.done` skal observeres,
probesessionen lukkes, og først derefter må en ny rigtig evalsession reserveres. Proben
er omfattet af den samme eksklusive diagnostiklås. Manglende eller malformed rate-event,
timeout/providerfejl eller en aktiv produktionssession før diagnostikken starter,
stopper evalueringen; de gør aldrig budgettet implicit grønt. Der er
ingen automatisk retry i samme run. Et senere eksplicit run må prøve igen efter en
transient fejl, mens samtidige prober fortsat afvises. Rapportens
`provider_budget_probe` viser særskilt faktisk usage/pris, når provider leverer den, og
ellers den mekaniske reservation og konservative maksimumspris; proben tæller ikke som
en semantisk evaltur.

## Genafspilning af fysisk provider-lyd

**Genafspil seneste OpenAI-lyd 3×** tager kun lyd fra PodVoices lokale, armerede
audio-trace. Den kan ikke modtage en brugerleveret lydfil eller en fri forventning via
API'et. Den diagnostiske transskription skal matche en kendt eval-ytring præcist, før
kørslen accepteres.

Replay udfører fire friske sessioner under samme model, aktive prompt, rumkontekst og
fulde deklarationsliste:

1. én tekstkontrol med den kendte ytring;
2. tre realtime-paced afspilninger af præcis provider-PCM'en.

Hver session er separat, så et heldigt tidligere svar eller gammel kontekst ikke kan
farve næste resultat. Der er hårde token-, pris-, tids- og TPM-lofter. Rapporten gemmer
PCM-hash, udsnitsmetode, diagnostisk transskription, prompt-hash og værktøjsskema-hash.
Et nyt trace har sample-præcise eventgrænser. Et ældre trace må kun bruge wall-clock-
fallback på første tur før første playback og markeres som ikke sample-præcist.

Klassifikationerne betyder:

- `prompt-or-tool-contract-failure`: tekstkontrollen fejlede også;
- `audio-replay-consistent`: alle tre lydkørsler valgte den forventede betydning;
- `audio-specific-failure`: tekstkontrollen bestod, men ingen lydkørsel gjorde;
- `audio-model-nondeterminism`: samme PCM gav forskellige resultater.

Replay er providerdiagnostik. Den beviser ikke puckens wake, AEC, DAC, LED, playback-
finish eller rearm og ændrer aldrig produktionskædens tilstand.

## PCM-fixtures

`read_pcm_fixture` accepterer kun mono PCM16 WAV ved 16 kHz (Voice PE-devicegrænsen)
eller 24 kHz (OpenAI-providergrænsen). `pace_pcm` sender 20 ms ad gangen i realtime;
en hel fil må ikke dumpes øjeblikkeligt og kaldes en VAD-test.

Kun samtykkede, anonymiserede optagelser må blive permanente fixtures. Device- og
provider-fixtures skal holdes adskilt, så resampling/preconnect og Realtime-forståelse
kan isoleres.

## Bevisgrænse

Maskinen kan bevise providerprotokol, prompt/tool-adfærd, kontekst, timeout,
korrelation og simuleret lifecycle. Kun den fysiske puck kan bevise wakeword,
same-breath-mikrofon, gain/AEC, LED, reel højttalerstart/-slut, rumekko og faktisk
wake-rearm. En release kræver derfor fortsat både live-eval og de fysiske gates.
