# Spor B: Den tynde klient — planen der slår Gemini for Home (juli 2026)

Skrevet 2026-07-02 efter tre dybde-research-briefs (GPT-Realtime-2, Gemini Live, LiveKit/Pipecat/
Vapi/Retell best practice). Erstatter den gamle lap-plan. Princip: **modellen ejer samtalen;
vores kode er wake-gate, lydtransport, tools, ducking, LED — og intet andet.**

## Dommen (research-syntese)

**Byg IKKE på et framework.** Pipecat kræver numpy/numba/onnxruntime/soxr (umuligt på vores
Alpine/musl); LiveKit Agents er bygget om deres WebRTC-rooms (glibc-only wheels). HA-miljøets
prior art for præcis vores form (Voice PE + s2s-API + add-on-proxy) er uniformt tynde custom
asyncio-loops — dét har vi allerede. Vi **stjæler frameworkenes mønstre** i stedet:

1. **Barge-in-filtrering** (alle gør det oven på provider-VAD): 0,2–0,5 s vedvarende tale før
   en afbrydelse honoreres + 2 s transskript-bekræftelse — ingen ord transskriberet → genoptag
   talen (LiveKits `resume_false_interruption`). KPI: **false-barge rate** (Retell).
2. **Playout-ur + truncate**: sekvens-markører i audio-strømmen, enheden ack'er ved afspilning,
   `audio_end_ms` = sidste ack − bufferdybde. Gem trunkeret item-id og mute sene deltas.
3. **Genopkobling**: Gemini resumption-handles m/ 3-forsøgs-loft + historik-reseed (Pipecats
   mønster); OpenAI har ingen resume → wake-gatede sessioner gør det ligegyldigt.
4. **Heartbeat/watchdog på pipelinen** (5 s) i stedet for vores pr.-tur kill-timere.
5. **Tænke-lyd under tools** (OpenAI R2 taler selv "preambles"; Gemini NON_BLOCKING gør det
   naturligt — vores filler-prompt-regler kan slettes).
6. **Wake-gatede sessioner + kort fortsat-samtale-vindue** er 2026-normen (også LiveKits egen
   wakeword-arkitektur og Gemini for Homes "Continued Conversation"). Altid-åben addressee-
   detektion er research-grade, ikke produkt-grade. Vores wake-gate er ikke arv — den er facit.

## Motorvalg: byg provider-agnostisk, start på GPT-Realtime-2, A/B mod Gemini

| | GPT-Realtime-2 (GA) | Gemini 2.5 native-audio (preview, v1alpha) | Gemini 3.1 Flash Live |
|---|---|---|---|
| Afbrydelse m/ bufferet højttaler | **`conversation.item.truncate`** — historik = det hørte | Ingen truncate → kræver ≤200-300 ms devicebuffer | samme mangel |
| "Lytter med, svarer kun når relevant" | Nej (kun `create_response:false` + egen logik) | **Proactive audio** (+ `RESPONSE_REJECTED`-signal til LED) | Nej |
| Tools | Parallel + async m/ auto-holdefraser; DEFER-create stadig nødvendig (vores maskineri genbruges) | Async (NON_BLOCKING) + INTERRUPT/WHEN_IDLE/SILENT scheduling | Kun sync |
| Sessioner | 60 min hårdt loft, ingen resume | 10 min WS + resumption-handles (2 t), kompression → uendelig | samme som 2.5 |
| Stilhed koster | **Nul tokens** | Faktureres (32 tok/s målt!) — proactive-lytning er dyr | fakturér kun det streamede |
| Familiepris/md (wake-gated) | ~$45–70 (audio-out dominerer) | **~$15–25** (inkl. 1-2 min proactive grace-vindue) | ~$10 |
| Kendte lydfejl | få (GA) | ctrl-token-lækage → tavse svar; "bag ElevenLabs" | bedst prosodi af de tre |
| Dansk | Uvalideret i felten | Uvalideret i felten | Uvalideret + language hints |

**Rækkefølge:** B2 bygges på **GPT-Realtime-2** (GA, truncate tilgiver buffer-unøjagtighed,
det er vores kørende provider med nøgler + DEFER-maskineri). B3 tilføjer **Gemini 2.5 m/
proactive audio** som grace-vindue-eksperiment (og 3-4× billigere drift) — vi HAR allerede to
provider-implementeringer, så togglen findes. **Øretest på dansk afgør defaulten** — ingen
af motorerne har publicerede danske felt-rapporter.

## Sletteliste (koden der dør når B2 er ejer-valideret)

Lounge-VAD + lounge-vindue · closure/politeness-ordlisterne ("tak"-maskineriet — modellen
forstår selv farvel) · byte-estimat-turn-hold + turn-done-timere · gate-mute/silence-maskineriet ·
streaming-FLAC-stien · announce-retry · pr.-tur watchdog (erstattes af pipeline-heartbeat) ·
THINKING-state-krykkerne. **Overlever:** wake-gate (privatliv), podvoice_audio (mic-transport),
tools + timere, speech.py (faste linjer i egen stemme), ducking, LED, panel.

## Faser (hver fase: lille, bag flag, ejer-valideret før næste)

**Gate 0 — mikrofonrøret er beviseligt rask** (0.72: forstår den dig? Det er transport-testen,
ikke en dialog-lap). Rødt → fix transporten FØRST, alt andet er meningsløst.

**B1 — Den levende højttaler** (forudsætning for ALT — begge motorer kræver den):
- 2a: flash KUN VA-output-skiftet (`media_player: !remove` + `speaker:`), INTET andet →
  isolér om wake-bruddet kom fra VA-ændringen eller mww-automationen (0.67 blandede dem).
- 2b: chipmunk-fixet: klient-resample 24→16 kHz FØRST (nul firmware-antagelser; StreamResampler
  findes), derefter evt. korrekt stream-info fundet i esphome-KILDEN (ikke gættet).
- 2c: playout-uret: bytes sendt − device-buffer = afspillet; VA-eventflowet giver naturlige
  ack-punkter. Mål: ≤300 ms buffer, målt.
- Studér de to HA-community-projekter der HAR gjort dette (Gemini-Live-flow til Voice PE og
  gpt-realtime-2 Voice PE-add-on — links i research-noterne) før én linje skrives.
- Ejer-test efter HVERT trin ("Okay Nabu" + Test speaker). Announce-stien forbliver fallback.

**B2 — Tynd løkke v1 (GPT-Realtime-2)** bag `engine: classic|thin`-toggle:
- Session pr. wake: `semantic_vad` + `interrupt_response:true` + `idle_timeout_ms≈6000`
  (serveren siger selv til når samtalen er død — vores idle-timere dør).
- Barge-in: provider-VAD + 0,3 s debounce + 2 s transskript-bekræftelse + genoptag-ved-falsk.
- `conversation.item.truncate(audio_end_ms)` fra playout-uret + mute-late-deltas.
- Async tools m/ auto-holdefraser; DEFER-create-maskineriet genbruges som det er.
- Pipeline-heartbeat (5 s) → én audible fejl + clean IDLE.
- classic-motoren urørt som fallback-toggle indtil thin er uger-stabil hos jer.

**B3 — Gemini-varianten + øretesten:**
- Samme tynde løkke på Gemini 2.5 (v1alpha): proactive audio som fortsat-samtale-vindue
  (1-2 min efter hver samtale, LED viser "lytter med" via `waiting_for_input`), resumption-
  handles m/ 3-forsøgs-loft, NON_BLOCKING tools m/ WHEN_IDLE.
- **Øretest-protokol (I bestemmer):** 10 faste danske sætninger + 5 opslag på hver motor
  (marin/cedar vs. Kore/2.5 vs. 3.1); bedøm prosodi, sprog-slip, afbrydelses-følelse. Vinderen
  bliver default; taberen bliver toggle.

**B4 — Poler + slet:** false-barge-rate + TTFR p50/p90 + dagspris i panelet · slet classic-
motoren (slettelisten ovenfor) · overvej 3.1/nyere modeller når proactive/async lander dér.

## Scorecardet mod Gemini for Home (sådan vinder vi)

Svartid: R2 leverer ~300 ms første-lyd server-side; med B1-højttaleren er kæden ægte realtid
(Gemini for Home: 1-3 s + berygtede udliggere). · Afbrydelse: truncate-baseret barge-in med
false-barge-filtrering — GfH har det kun i Live-mode. · Fortsat samtale: har vi (de FJERNEDE
deres). · Kedelige ting: tools + timere lokalt, watchdog-hjerteslag, audible fejl i egen stemme.
· Dansk: øretest-valgt motor + hård prompt-pinning (GfH svarer dokumenteret af og til på
engelsk). · Privatliv: wake-gated per design — mic streamer KUN mellem wake og samtale-slut
(GfH: altid-lyttende sky). · Pris: $15-70/md uden abonnement (GfH: 899 kr + $10-20/md).

## Jernreglerne (uændrede)

Intet flashes/pushes uden ejer-kvittering i stuen · validate → compile → upload · én ændring
ad gangen bag default-OFF flag · hver fase ejer-valideres før næste.
