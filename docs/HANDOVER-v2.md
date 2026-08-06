# Reliability Overhaul v2 — HANDOVER til Mads (0.91.0)

Alt kode-arbejde i fase 0–3 er implementeret, testet (320 tests, ruff+mypy rene)
og ligger på branchen `claude/podvoice-reliability-v2-6g8yjz`. Det, der er
tilbage, er præcis det, der IKKE kan valideres i simulation: ekko, wake-ord og
lyd i stuen. Punkterne herunder er dine, i rækkefølge.

## 0. Før første test (én gang)

1. **HA: slå MCP-serveren til** — Indstillinger → Enheder & tjenester → Tilføj
   integration → "Model Context Protocol Server". Vælg at klienter må styre.
2. **HA: eksponér enheder** — Indstillinger → Stemmeassistenter → Expose.
   Det ER nu allowlisten (panelets gamle vælger er væk).
3. **Websøgning (valgfrit, men du brugte den):** lav et HA-script der slår op
   (fx via conversation.process mod din søgeagent), giv det et godt navn +
   beskrivelse, og eksponér det til Assist — det bliver automatisk et værktøj.
4. Opdatér add-on'et, genstart, og tjek panelets service-dots: **ChatGPT / Voice
   PE / PodConnect / Home control** skal alle være grønne. Er "Home control" rød:
   Supervisor-proxyen når ikke `/api/mcp` — sæt da i Settings → Advanced:
   `HA MCP URL = http://homeassistant.local:8123/api/mcp` + en long-lived token
   (HA-profil → Sikkerhed). Loggen siger præcis hvad der fejler.
5. Verificér i loggen at der står `MCP tools: N from HA (...)` med de værktøjer
   du forventer (HassTurnOn, GetLiveContext, dit søge-script, …).
6. Hurtig røgtest i **Talk-fanen**: "hvad er klokken?", "tænd/sluk <lampe>",
   "sæt en timer på ti minutter", "hvad spiller lige nu?".

## 1. Fase 1.4 — ekko/afbrydelses-matrixen [HUMAN]

Formål: bevis at conservative-presettet dræber selv-afbrydelsen, og afgør om
duplex kan promoveres. **Engine: thin** under hele matricen.

Per celle: 10 svar. Log (fra panelets Metrics + Log-tab):
- falske barge-ins pr. 10 svar (Metrics: "Barge-ins" der IKKE var dig +
  "False barges (filtered)" viser dem debounce'en åd),
- missede ÆGTE barge-ins (du taler over svaret og intet sker),
- STT-præcision på de 10 faste sætninger (5 DA + 5 EN — vælg dem én gang, genbrug),
- subjektivt ekko (hører modellen sig selv? svar-loops?).

| Konfiguration (Settings) | Stille rum | Musik spiller (duck aktiv) | 4+ m afstand |
|---|---|---|---|
| A. `turn_preset: responsive`, `full_duplex: false` (≈ gammel adfærd) | | | |
| B. `turn_preset: conservative`, `full_duplex: false` | | | |
| C. som B men `full_duplex: true` (ekko-skjold FRA — mic åben under svar) | | | |
| D. `channels:[1]` + `gain_factor: 4` i firmwaren (AGC-løs; reflash, se audio-path.md) | | | |

- Forventet vinder: **B**, og at **C** består oven på B (det ér duplex-testen).
- D er KUN diagnostik: er D markant bedre end B, er det AGC'en der re-forstærker
  rest-ekko → så justerer vi firmware-kanal, ikke arkitektur.
- **Promoveringskrav for duplex (C):** < 1 falsk barge-in pr. 10 svar i BÅDE
  stille rum OG med musik. Består C: sæt `full_duplex: true` som jeres daglige
  drift og sig til — så gør jeg det til default og rydder op i skjold-koden.
- Software-AEC-rækken fra opgaven er bevidst IKKE bygget (kun hvis alt andet
  fejler).

## 2. Fase 3.3 — samtale-livscyklus [HUMAN]

Med `engine: thin`, `turn_preset: conservative`:
1. "Okay Nabu" → "tænd lyset i stuen" → vent på svar → **uden nyt wake-ord**:
   "og sluk det igen" → "hvad er klokken?" (3+ ture i én samtale).
2. Afslut med "tak, det var alt" → kort farvel → musikken tilbage (LED slukker).
3. Gentag på engelsk ("turn on…", "that's all").
4. "Stop" midt i et langt svar → lyden dør MED DET SAMME.
5. Sig ingenting efter et svar → samtalen lukker selv efter ~25 s
   (`idle_timeout_s` i Settings; serveren lukker den også selv på conservative).

## 3. Fase 2 — wake-ord [HUMAN + træning]

Runbook: `docs/wake-word.md`. Vælg frasen, træn (Colab-notebook), læg
`.tflite`+`.json` som GitHub-release, uncomment blokken i `esphome/podvoice.yaml`,
reflash. Acceptkrav: én uges familiebrug, ~nul falske triggers, pålidelig
aktivering ved samtale-lydstyrke tværs over rummet. (Falsk trigger = et wake i
History uden efterfølgende tale.)

## 4. Fase 4.1 — ducking-retune [HUMAN]

Efter matricens vinder er valgt: spil musik, kør 10 kommandoer, og justér
`duck_level` (og PodConnects fade) til det føles rigtigt. Vandt en celle med
mindre AEC-margin (C eller D), skal ducking være MERE aggressiv (lavere %).

## 5. Fase 4.2 — GPT-Live-1 venteliste (2 min, dig)

Skriv jer på https://openai.com/form/gpt-live-1-in-the-api/ — og glem den så.
Når adgangen lander: ny modelstreng i `openai_realtime.py`, kør matricen igen,
slet de duplex-workarounds den nye turn-logik overflødiggør.

## Kendte efterladenskaber (bevidste)

- **Classic-motoren står urørt** som fallback-toggle. Når thin har kørt stabilt
  hos jer i nogle uger: sig til, så sletter vi orchestrator/state/watchdog-laget
  (PLAN-BEAT-GEMINI §B4-slettelisten) — det er yderligere ~1.500 linjer.
- Priserne i `usage.py` er 2026-07-estimater fra sekundærkilder — sensorerne er
  til at OPDAGE en løbsk dag, ikke til fakturaafstemning.
- `ha-realtime-assist` (reference i opgaven) er slettet fra GitHub (404,
  verificeret 2026-07-23); adfærden er porteret fra cachede beskrivelser.
- AGC på input (3.3): ikke rørt — mål først om der overhovedet clippes
  (mic-level-linjerne i loggen viser det).
