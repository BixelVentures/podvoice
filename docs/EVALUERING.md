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
- fuldt svar efter `continue_conversation`;
- eksplicitte providerfejl, timeout og lifecycle-resultater.

Mekanik bedømmes eksakt. En forkert beslutning genkøres ikke væk. Gentagelser
bruges senere til at måle modellens variation, ikke til at vælge et heldigt svar.

## Sikker live-kørsel

Live-eval er opt-in og bruger `SafeEvalTools`. Routeren indeholder ingen HA-, MCP-
eller PodConnect-klient og returnerer kun faste testresultater. Et ukendt værktøj
nægtes. Dermed kan den rigtige produktionsprompt og Realtime-model testes uden at
tænde lys, starte musik eller ændre hjemmet.

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
