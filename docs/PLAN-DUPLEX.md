# PLAN-DUPLEX — det gatede duplex-spor (bilag til ARKITEKTUR.md)

> **UNDERORDNET [ARKITEKTUR.md](ARKITEKTUR.md) (2026-08-07).** Duplex er en FINESSE
> bag målbare gates — ikke målet. 3-dages-framingen er annulleret: robusthed før
> deadline (ugerne 1-3 i ARKITEKTUR.md løses først), og matrix-C-promoveringskravet
> kan afvise duplex permanent uden at "solidt bedre end Gemini" falder (G4/G5/G7/G2
> vindes af half-duplex-systemet). Det tekniske indhold herunder — minimal-diffs,
> ch1+gain4-testen, matrix-kravene — bevares ordret som OPSKRIFTEN for uge-4+-etapen.
> OBS: §4b's idle_timeout_ms-afsnit er skærpet af modprøven: feltet droppes HELT
> (genprompt-semantik = G7-race), ikke kun "sendes ikke i v1".



> Resultatet af dyb multi-agent-research (6 kortlæggere: motor-kode 0.90, 0.91-branchen,
> firmware, live OpenAI-docs, Voice PE/XMOS-kildekode, konkurrent-UX) + 1 arkitekt +
> 3 adversarielle verifikatorer. Alle påstande herunder er enten kildekode-/doc-citerede
> eller eksplicit markeret som hypoteser med en afgørende test.

## 1. Vision

Du taler til huset som til et menneske: du kan afbryde midt i et svar med almindelig
tale, sige "mm" og "ja" uden at ødelægge noget, og assistenten stopper inden for et
halvt sekund og husker præcis, hvad du nåede at høre. Hurtigere svar end Alexa+,
hurtigere afbrydelse end Gemini (0,23 s er bevist muligt på OpenAI-stakken mod Geminis
2,20 s). Og den gør ALDRIG noget af sig selv — hellere døv end egenrådig.

## 2. Goal-metrikker (gate-version — måles af add-on'ets egne metrikker, ikke Audacity)

| # | Metrik | Mål | Verdensklasse | Kilde |
|---|--------|-----|---------------|-------|
| G1 | Barge-in stop-latens (tale-onset → puck stille) | ≤800 ms* | ≤500 ms | NY log-metrik: Interrupted → announcing=false |
| G2 | Falsk-barge-rate | ≤1/20 svar | 0/20 | eksisterende `false_barges`-tæller |
| G3 | Backchannel: "mm/ja/okay" ignoreres ≥80 %; "stop" virker ≥95 % | — | — | gate-protokol (10 ytringer) |
| G4 | Svar-latens (tale-stop → første ord) | ≤1,6 s (announce) | ≤1,0 s (kræver 2b) | eksisterende TTFR-metrik |
| G5 | For-tidlig-afbrydelse af BRUGEREN | ≤1/50 ture | 0/50 | dansk turskifte er verdens langsomste (+300 ms median) → `silence_duration_ms=700` er korrekt, ikke konservativt |
| G6 | Efter barge: sammenhængende svar ≤1,5 s, aldrig forfra | — | — | del af G1-protokol |
| G7 | Uopfordrede handlinger | 0/uge | 0 | log-audit |
| G8 | Ignorerede forespørgsler | ≤1/50 | 0/50 | del af G4 |

\* G1-målet er 800 ms fordi announce-vejen buffer-holder hele FLAC-svaret på enheden;
stop-latensen instrumenteres dag 0 og AFLÆSES dag 1 — er den >800 ms, er det 2b-vejens
promoveringsargument, opdaget på dag 1, ikke dag 3 (verifikator-krav).

## 3. Koncept & abstraktion

- **Motoren ejer samtalen** (Spor B står fast): ThinSession er eneste samtale-hjerne.
- **To enheder, én kontrakt**: VoicePELink (puck) og BrowserLink (Talk-fanen). Talk kører
  beviseligt den ægte motor (0.90) og browserens mic har native AEC → **Talk er
  duplex-proving-ground nr. 1**, før pucken røres.
- **Duplex-tilstanden bor i ThinSession** som ét flag (`full_duplex`, findes i 0.91:
  settings → config → session, live uden redeploy). Flaget slår KUN ekko-skjoldet fra;
  barge→debounce→truncate→re-announce-kæden er tilstands-uafhængig og genbruges urørt.
  **Default: Talk=True, puck=False** indtil felttesten dømmer.
- Ekko-afvisning i duplex bæres af hardware (XMOS AEC) + serverside (server_vad
  threshold + far_field) — aldrig af håb.

## 4. Beslutninger (med verifikator-domme)

### (a) Kanal-strategi: ch1+gain4 er den dokumenterede ASR-baseline; ch0 er fallback-diagnostik

Verifikator-dom: **kunne ikke afvises — styrket på 3 punkter**:
1. Begge XMOS-kanaler er AEC'ede (kildekode: voice-kit-xmos main.c; ch0 = AEC+IC+NS+**AGC**,
   ch1 = samme UDEN AGC). Ch0's ekko-problem er AGC, der re-forstærker residualet.
2. Gain 4 er en ren, saturerende +12 dB (ESPHome microphone_source.cpp: Q25-clamp, aldrig wrap).
3. **HA core selv skifter til ch1 for STT** (assist_satellite.py, `prefers_auto_gain_enabled=False`),
   og Nabu Casas egen wake kører ch1+gain4 (upstream-yaml). 0.87's "ch1 er stum" var gain-1-tappen.
   0.87-committen beviser selv at wake (ch1+gain4) fyrede under testen.

Fysisk stuetest er stadig gate: +12 dB kan være for lavt i enkelte rum, men løsningen
måles først mod samme dokumenterede baseline, ikke mod gemte felt-eksperimenter.

**Den afgørende test (dag 2, ~30 min efter flash, pucken bliver i stuen — OTA):**
1 m / 3-4 m / høj-stemme-klip-check / wake-regression ×5, målt med 0.87's mic-RMS-log +
OpenAI speech-events. BEKRÆFTET → duplex-kanal. DELVIST (virker 1 m, dør 4 m) → gain 8-16
(1-linjes diff). AFVIST → OTA-revert til ch0+skjold; duplex forbliver Talk-feature.

### (b) VAD: server_vad "conservative" — med to doc-korrektioner af 0.91

`server_vad { threshold: 0.45, prefix_padding_ms: 800, silence_duration_ms: 700,
create_response: true, interrupt_response: true }`. Voice PE channel 1 har allerede
XMOS NS, så provider `noise_reduction` er off; Talk bruger én `far_field`-pass efter
at browser-NS/AGC er slået fra. Model: **gpt-realtime-2.1**; mini er cost-mode.

- **Korrektion 1 — `idle_timeout_ms`**: Verifikator-dom: feltet FINDES, men **kun under
  server_vad** (semantic_vad-feltlisten har det ikke → derfor 0.77-afvisningen; begge
  session-erfaringer var rigtige). MEN semantikken er en anden end 0.91 tror: det lukker
  IKKE sessionen — ved timeout trigges en MODELRESPONS (timeout_triggered, "er du der?").
  Beslutning: **send ikke feltet i v1**; klient-idle-fallback forbliver eneste lukker.
  0.91's HANDOVER-§2-påstand "serveren lukker selv" skal rettes (dag 0).
- **Korrektion 2 — semantic_vad parkeres**: docs-modstrid om `eagerness` (tal vs enum) og
  udokumenteret dansk semantik. Genoptages kun efter en 1-skuds session.update-test.

### (c) Merge-rækkefølge: 0.91 FØRST (den er ~90 % af arbejdet), så fire punkt-fixes

0.91 = full_duplex-flag end-to-end, presets, MCP-klient, firmware-kommentarblok, 320
grønne tests (lokalt verificeret). Genopfind intet. MEN: mergen SKIFTER hjemmestyringen
til MCP → **ejerens HA-checkliste er en hård forudsætning FØR add-on-opdateringen**
(HANDOVER-v2 §0: MCP-Server-integration + Expose + evt. ha_mcp_url+token + grøn dot).

### (d) Skjold-afvikling: betinget og gradvis — skjoldet slettes ALDRIG, det parametriseres

Trin 1 Talk-duplex (browser-AEC) → Trin 2 puck-duplex efter (a)-testen, settings-toggle
(øjeblikkelig revert) → Trin 3 default kræver 1.4-matricens celle C: <1 falsk barge pr.
10 svar i både stille rum OG med musik. Panelet blokerer responsive+full_duplex (utestet).

## 5. Nødvendige ændringer (fil-for-fil, oven på 0.91-mergen)

1. `openai_realtime.py` (0.91 l.359-369): yield `Interrupted` **ubetinget** på
   speech_started. 0.91's gating på `_active_response` gør duplex-barge næsten unåelig
   (response.done lander FØR hovedparten af hørbar afspilning). Sikkerheden flyttes til:
2. `thin.py`: barge-debounce-guard `if not self._speaking` → `if not (self._speaking or
   self._device_playing)` (dækker den bufferede hale; early-return ved idle).
3. `thin.py` (1 linje): gate end-phrase-fallback på `not self._device_playing` — ellers
   kan rest-ekko af modellens eget "farvel" lukke samtalen.
4. `__main__.py`: Talk-sessionens `full_duplex=True` default; puck følger settings (False).
5. **NY instrumentering (verifikator-krav)**: log-metrik for stop-latens (media-STOP →
   announcing=false) og barge-latens (Interrupted → announcing=false) — erstatter
   Audacity-protokollen med indbyggede tal.
6. OBS testsuiten: punkt 1-2 ændrer barge-semantik → 0.91's tests skal OPDATERES, ikke
   bare bestå (budgetteret dag 0). Docs: developers.openai.com-links; idle-kommentar.
7. `esphome/podvoice.yaml`: aktivér ch1+gain4-blokken — KUN dag 2, som isoleret flash.

**Valgfrit (eksplicit UDEN for 3-dages-scope):** 2b direct PCM (~G1→0,3 s; koden findes,
mangler 5-linjers on_tts_start-pin fra 0.67-commit 0177310 — men 0.67-præcedensen gør
det til deadlineens største enkeltrisiko; announce forbliver fallback). Custom wake-ord.

## 6. Dag-for-dag (verifikator-korrigeret: én release, OTA-flash, indbyggede metrikker)

**Nøglen der gør 3 dage realistisk (og som v2-dommen ikke vidste):** upstream-firmwaren
har `ota:` → **flash over wifi, pucken bliver i stuen** (kompilering stadig på Mac'en).
Ingen USB-samlokalisering; revert er også OTA. Plus: ÉN samlet release efter dag 0 →
ejeren opdaterer add-on'et ÉN gang. Plus: gates måles af indbyggede metrikker.

**Dag 0 (kun udvikler — ingen ejer-tid):** merge pv-091 → main; punkt-fixes 1-5;
testsuite-reparation; HANDOVER-idle-rettelse; validate.sh; ÉN release (0.92.0).
ch0-baseline-protokollen klargøres (mic-RMS under afspilning logges allerede).

**Dag 1 (ejer ~45 min):** MCP-checklisten i HA (FØR add-on-opdatering!) → opdatér til
0.92 → grønne dots → **GATE A (Talk-duplex, 10 min)**: 5 spørgsmål + 5 midt-i-afbrydelser;
bestået = stop ≤1 s, sammenhængende fortsættelse, "mm" stopper intet. Samme aften:
ch0-baseline på pucken (5 svar, RMS-under-afspilning aflæses af loggen) + stop-latens
aflæses (G1-antagelsen afgøres HER, ikke dag 3). FALLBACK: Talk-duplex=False; huset
kører som 0.90 + conservative preset — i sig selv en forbedring.

**Dag 2 (ejer ~1 time, ingen USB):** OTA-flash ch1+gain4 → 30-min-testen (4a) → dom
(BEKRÆFTET / DELVIST→gain 8 / AFVIST→OTA-revert). Derefter puck-halv-duplex-matrix
(conservative, 10 svar stille + 10 med musik). **GATE B**: 10 svar med musik, 0
selv-afbrydelser, dansk STT intakt. FALLBACK: ch0+skjold urørt (dag 1-tilstand).

**Dag 3 (aften — ukomprimerbar, ejer = almindelig brug):** puck-duplex toggle ON på
vinderkanalen → **GATE C (celle C)**: normal aftenbrug med musik, <1 falsk barge pr. 10
svar, afbrydelse virker, modellens eget "farvel" lukker ikke samtalen; én bevidst TIDLIG
afbrydelse + "hvad nåede du at sige?" (truncate-ærlighed). Bestået → duplex er DEFAULT.
FALLBACK: toggle off — dag 2's halv-duplex er en fuldgyldig, Gemini-slående leverance.

**Ærlig tidsramme (verifikator-dom indarbejdet):** 3 fokuserede dage er realistiske MED
OTA + én-release-strukturen + auto-metrikker. Ét rødt led (MCP-dot hos ejeren, knækket
testsuite ud over budget, ch1-afvisning) → 4-5 dage. 2 dage kræver held. Dag 3-aftenen
kan ikke flyttes frem.

## 7. Risici (top 5)

1. **ch1+gain4 fejler akustisk** (ingen offentlig præcedens for OpenAI-streaming; xanderves
   ch0-forsøg endte i feedback-hyl). → objektiv RMS-test FØR matricen; OTA-revert; halv-duplex
   er fuldgyldig leverance.
2. **Rest-ekko forurener STT/turn-taking** (ekko committes som brugertale; falsk end-phrase).
   → §5-fix 3, threshold 0.45 + 800 ms prefix + far_field, matricens ekko-kolonne;
   fejler C: skjoldet består.
3. **Reflash bryder wake** (0.67-præcedens). → kun 2 mic-linjer pr. flash (jernreglen: én
   ændring pr. flash), esphome-config-gate, wake-regression ×5 i dag 2-protokollen.
4. **Truncate lyver** (wall-clock-approx + announce-buffer → modellen "husker" uhørt tekst).
   → dag 3's tidlig-afbrydelses-måling; stor fejl = 2b-promoveringsargument, ikke duplex-stop.
5. **MCP-kæden fejler hos ejeren** (Supervisor-proxy /api/mcp aldrig live-testet her; rød
   dot-gren kræver long-lived token). → checklisten ligger FØR alt andet, med ha_mcp_url+token
   som dokumenteret fallback og udvikleren på standby under dag 1.

## Appendix: felt-lærdomme der hermed korrigeres (med evidens)

1. ~~"Kanal 0 er ikke ekko-annulleret"~~ → begge kanaler AEC'es; ch0's problem er AGC-re-forstærket
   residual (XMOS-kildekode).
2. ~~"Kanal 1 er stum"~~ → gain-artefakt (gain 1 uden AGC); mww kører ch1+gain4 upstream, HA core
   bruger ch1 til STT. Dog: OpenAI-STT på ch1 er stadig felt-ubevist → dag 2-testen.
3. ~~"idle_timeout_ms findes ikke" (0.77)~~ → findes, kun under server_vad — og gør noget ANDET
   end antaget (genprompt, ikke luk). Sendes ikke i v1.
4. 0.91's Interrupted-gating på _active_response beskrives som sikkerhed, men gør duplex-barge
   næsten unåelig — sikkerheden flyttes til thin-guarden (§5 pkt. 2).
