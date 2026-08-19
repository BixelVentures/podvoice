# PodVoice-status — én aktuel sandhed

Senest opdateret: 2026-08-19.

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
Den erstatter først den officielle baseline efter en frisk fysisk golden chain; derefter
er næste ufravigelige skridt 10 ubrudte fysiske cyklusser.

## Fast arbejdsrækkefølge

1. Installér v1.13.12 og gentag den korte golden chain. Ved fejl: gem én trace og lav
   regression før ny ændring.
2. Kør 10 ubrudte fysiske lifecycle-cyklusser på samme kandidat. Ingen gain-, VAD-,
   prompt- eller UX-tuning midt i serien.
3. Mål først derefter svartidens delstræk og angrib den største dokumenterede flaskehals.
4. Vurdér en diskret tænke-feedbacklyd som sin egen UX-feature. Den må kun signalere en
   allerede observeret THINKING/tool-tilstand og må ikke ændre mic-gate, VAD, playback-
   telemetry, ekkoskærm eller rearm.
5. Gennemfør funktionsmatrixen for dansk, hjem, vejr, web, musik og timere; derefter
   7-døgns stabilitet og den målte Gemini/Alexa-sammenligning.

Fuld duplex, barge-in og nye motorer er ikke en del af denne rækkefølge.
