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

Mekanik bedømmes eksakt. En forkert beslutning genkøres ikke væk. Gentagelser
bruges senere til at måle modellens variation, ikke til at vælge et heldigt svar.

## Sikker live-kørsel

Live-eval er opt-in og bruger `SafeEvalTools`. Routeren indeholder ingen HA-, MCP-
eller PodConnect-klient og returnerer kun faste testresultater. Et ukendt værktøj
nægtes. Når add-onen kalder evalueringen, eksponeres den fulde aktuelle liste af
produktionsdeklarationer for Realtime, men dispatch forbliver den sikre lokale router.
Dermed kan den rigtige produktionsprompt, Realtime-model og værktøjskonkurrence testes
uden at tænde lys, starte musik eller ændre hjemmet.

I add-on-panelets Test-fane køres samme afgrænsede suite med **Kør sikker preflight**.
Det ingressbeskyttede endpoint er `POST /api/eval/live`; requesten kan kun vælge kendte
scenarie-id'er og kan aldrig levere API-nøgle, model eller værktøjsimplementation.

Inde i add-on-containeren:

```text
python -m gatekeeper.eval_harness --live
```

Lokalt fra repoets rod kræves `PYTHONPATH=podvoice`. Nøglen læses fra
`OPENAI_API_KEY` eller add-onens beskyttede `/data/options.json`; den indgår aldrig
i rapporten. `LiveEvalService` serialiserer kørsler og er den tilsigtede indgang
for et autentificeret ingress-endpoint.

Hver kørsel har hårde lofter for antal ture, reserverede outputtokens, faktiske
tokens og estimeret pris. Faktiske tokenfelter gemmes særskilt, så prisestimater
kan opdateres uden at ændre det oprindelige bevis.

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
