# ARKITEKTUR — PodVoice's sande form (kanonisk beslutningsdokument)

> 2026-08-07. Produkt af den holistiske audit (5 undersøgere: lyd-topologi, hjerne,
> HA-stock, kode-fit, fejlflade + chefarkitekt + adversariel modprøve), under ejerens
> ramme: **hardware ligger fast (Voice PE + HomePods), alt andet må udfordres,
> ROBUSTHED FØRST.** Modprøvens tre rettelser er indarbejdet. Dette dokument er lov;
> [PLAN-DUPLEX.md](PLAN-DUPLEX.md) er dets bilag for det gatede finesse-spor.

## 1. Setuppets sande form

- **Øre = pucken** med vores custom firmware (podvoice_audio-tap, ch0/AGC som i dag).
  Stock-firmware kan ikke levere mic-audio til vores motor, og tappet er felthærdet.
- **Mund = PUCKEN. HomePod'erne er musik + ducking — aldrig assistentens mund.**
  Trippelt begrundet: (a) *fysik* — HomePod-lyd har ingen AEC-reference på puckens mic
  og rammer den 0-10 dB kraftigere end brugeren; (b) *transport* — AirPlay er push med
  server-prefetch, 2-5 s startlatens, sekunders stop-latens, strukturelt inkompatibel
  med streaming-svar; (c) *kode* — HomePod-mund bryder `_on_media_state`-sandheden,
  som ekko-skjold, playout-ur og LED hviler på. Elimineret på robusthed alene.
- **Hjerne = OpenAI Realtime (gpt-realtime-2.1-mini), alene.** Gemini Live er
  felt-taber i 2026 (10-min WS, stop-latens 2,2 s, dansk udokumenteret) — genbesøg om
  6 md. **Hybrid-kaskaden (STT+LLM+TTS) er DROPPET** (modprøve-dom A1): den deler
  leverandør, netvej og proces med Realtime og diversificerer derfor INTET fejldomæne;
  dens self-barge-argument er allerede leveret af ekko-skjoldet. Den genopstår kun med
  en anden leverandør og en anden begrundelse (fx bedre dansk STT) — ikke "robusthed".
- **Hjemmestyring = HA's MCP-server** (0.91-skiftet), men selvtesten skal RØRE en
  rigtig enhed: periodisk GetLiveContext-probe + fail-honest pr. kald ("det lykkedes
  ikke at tænde lyset") — tool-antal beviser intet (modprøve A2/F2), og MCP dør midt
  på dagen, ikke ved boot.
- **Ducking = PodConnect /api/attention**, room-scoped (kun det rum der taler), med
  ACK-timeout ≤300 ms og skip-når-stille — duck-ventetid må aldrig blive en seriel
  afhængighed på hvert wake (modprøve H2/A5).
- **Panel = i dag** + årsags-bannere, kørende version øverst, og de talte
  fejl-diagnoser (net/tjeneste/konto) i assistentens egen stemme.

## 2. Beslutningsmatrix (vægt: robusthed ×5, dansk ×2, latens ×2, indsats ×1, pris ×1)

| Scenario | Robusthed | Latens | Dansk | Vægtet |
|---|---|---|---|---|
| **Puck-mund × Realtime (VINDER)** | 5 (felt) | 4 | 4 | **50** |
| Puck-mund × hybrid-hjerne | 4 (papir) | 3 | 4 | 42 — droppet (A1: samme fejldomæne) |
| HomePod-mund × Realtime | 1 | 1 | 4 | 21 — elimineret |
| Hybrid-mund (HomePod v. musik) | 2 | 2 | 4 | 26 — elimineret |

## 3. Hvad bevares af det byggede

Urørt: **device-kontrakten** (thin.py's hasattr-flade — arkitekturens bærende
abstraktion), **reply-bus + FLAC-svarvejen**, **ekko-skjoldet som default**
(OpenAI-docs bekræfter mønstret; stock har samme problem åbent), **Talk-simulatoren**
(officielt proving ground), PlayoutClock, barge-kæden, keepalive/teardown,
firmware-kontraktlaget, ærlig link-status, PodConnect-klienten.

**0.91-branchen: merges, gated** — conservative-preset, presets/custom, MCP-skiftet,
model-strenge, firmware-kommentarblokke og 1.4-matrixdokumentet merges;
**`idle_timeout_ms` fjernes HELT før merge** (modprøve A3: docs siger genprompt —
modellen SVARER selv ved timeout, inkl. mulige tool-calls = G7-race; klient-heartbeaten
dækker allerede begge VAD-typer — feltet er redundant OG farligt); **hård-fejl-værn på
session.update for ALLE felter** (~20 linjer; eagerness-docmodstriden (F5) kan ellers
genoplive 0.77-klassen ad responsive/custom-vejen); **full_duplex-koden bevares men
flaget låses** til matrix-C-gaten.

## 4. Målinger før låsning (rækkefølgen er rettet af modprøven)

1. **Config-accept-røgtest** (10 min, Talk-fanen): conservative-presettet UDEN
   idle_timeout_ms på levende socket; hård-fejl-værnet verificeres ved bevidst at
   sende ét ugyldigt felt og høre fejlen.
2. **Preset-validering FØR default låses** (10 min, stuen — flyttet fra uge 3 til
   uge 1, modprøve A4): 30 s dansk tale-clip på HomePod ved svar-volumen + blød
   tale/4 m-varianten. Afviser threshold 0.7 blød/fjern familietale (G8), justeres
   presettet FØR det bliver default — ikke to uger efter.
3. **HomePod-announce-latens** (10 min, formalitet): media_player.play_media ×10,
   kill-tærskel >1,5 s — lukker HomePod-mund-debatten med et tal for altid.
- ch1+gain4-målingen OVERLEVER som duplex-diagnostik (bilag), udføres først når
  duplex-etapen åbnes.

## 5. Migrationsvej fra 0.90 (uge-etaper; huset fungerer efter hver; alt bag flag)

- **UGE 1 — Fundamentet.** Måling 1+2 → gated 0.91-merge (uden idle_timeout_ms, hård
  session.update-fejl, full_duplex låst, preset-default låst af måling 2) + MCP med
  ægte probe + talte fejl-diagnoser. *Ejer-gate:* 10× wake→kommando stille + 10× med
  musik; 0 stumme fejl, 0 engelsk, Home-control-prik grøn efter ÆGTE enheds-probe.
- **UGE 2 — Aldrig stum.** DHCP-reservation, IP-cache-fallback, "genstarter"-linje,
  version i panelet, repo ud af iCloud — og vigtigst (modprøve F1): **firmware-lokal
  "hjernen svarer ikke"-lyd** — wake uden forbundet add-on (api ikke connected) skal
  give en LOKAL fejltone fra pucken selv; den mest sandsynlige enkeltfejl (dødt
  add-on) er i dag den eneste, der er totalt tavs. *Ejer-gate:* genstart router og
  add-on; pucken forklarer sig hørbart i begge tilfælde.
- **UGE 3 — Altid afbrydelig, aldrig egenrådig.** Stop-i-talestrømmen uden duplex
  (modprøve H1): "Okay Nabu" midt i et svar husher allerede (0.75-adfærd — gøres til
  dokumenteret feature) + svar-længde-cap i prompten + evt. dedikeret stop-model
  senere. Room-scoped duck m/ ACK-timeout. G2/G7-protokollen (20 svar med TV-lyd:
  falske aktiveringer + uopfordrede handlinger tælles). *Ejer-gate:* tallene står i
  panelet; "man kan tysse på den" er bevist.
- **UGE 4+ — Finesse, kun bag grønne gates.** Først 2b direct PCM: **kandidat bygget,
  men ikke fysisk slutverificeret** (se §6). Derefter duplex-rækken (matrix C,
  promoveringskrav <1 falsk barge pr. 10
  svar i stille rum OG med musik) med ch1+gain4 som diagnostik — opskriften står i
  [PLAN-DUPLEX.md](PLAN-DUPLEX.md). Består C ikke, lever huset fint uden duplex:
  G4/G5/G7/G2 vindes allerede af det robuste half-duplex-system.

## 6. 2b direct PCM — kandidat, ikke leveret

1.9.0/1.10.0 opfyldte firmwarekontrakten, men fejlede den nødvendige adfærdstest:
Voice Assistant og external media player delte `announcement_resampling_speaker`.
`RESPONSE_FINISHED` ventede derfor for evigt på en højttaler, medieafspilleren holdt
kørende. `reply_played` kom aldrig, og fase 5 hang. 1.11.1 satte default tilbage på den
beviste announce-vej.

Kandidaten fra 2026-08-11 giver Voice Assistant både en privat resampler **og** en
privat mixer-source med ESPHomes konservative 500 ms-timeout. Det sidste er nødvendigt,
fordi resampleren videredelegerer `has_buffered_data()` til sit output. YAML er valideret, firmware er
kompileret, og den genererede C++ viser de adskilte ejere. **En hel fysisk samtale,
opfølgning og ny wake mangler stadig**, og direct må derfor ikke være standard. Den
målbare gate står i [PRODUKTMÅL.md](PRODUKTMÅL.md).

Svaret sendes som rå 24 kHz PCM ned ad den åbne API-forbindelse i stedet for at blive
hentet som FLAC over HTTP. Den vigtige gevinst er **ikke** latens, men sandhed:

| | announce (gammel) | direct (2b) |
|---|---|---|
| "Er svaret færdigt?" | gæt ud fra bytes/varighed | `reply_played` fra enheden |
| Hvornår fyrer det | media_player-state, kan udeblive | `RESPONSE_FINISHED`: `speaker_buffer_size_ == 0 && !has_buffered_data() && !is_running()` |
| Hørt position | vægur | begrænset af bytes faktisk afleveret |

**Hvorfor 0.67 fejlede (fundet i den pinnede C++, ikke gættet):** add-on'en sendte
`TTS_START` med et tomt data-map, og handleren afbryder på `if (text.empty()) return;`
*før* den fyrer `on_tts_start` og *før* `speaker_->start()`. Rate-pinningen 0.67 selv
havde skrevet kørte derfor aldrig, resampleren beholdt de 48 kHz som den delte
`external_media_player` sidst satte, og 24 kHz-svaret kørte i dobbelt tempo. Én tom dict.

**Regler i kandidaten:**
- Vejen vælges af **enheden** (`supports_direct`, læst af de event-typer firmwaren
  publicerer). Automatisk direct kræver `direct_speaker_v3` plus
  `podvoice_direct_prepare`; `reply_played` alene er
  ikke nok, fordi den defekte 1.11.0-firmware også annoncerede det.
- `full_duplex` afvises på mikrofonkanal ≠ 0: duplex kræver ekkoannullering, og kun
  XMOS-kanal 0 har den. Samme "spørg hardwaren"-regel.
- Tempostyring er obligatorisk: `on_audio` dropper **hele** chunken ved bufferoverløb
  (16 KB), hvilket taber ord lydløst. Forspringet er 0,15 s.

**Kendt omkostning:** `request_stop()` gør intet for højttalervejen (hele grenen er
`#ifdef USE_MEDIA_PLAYER`), så en afbrydelse lader de op til 0,15 s der allerede ligger
i enhedens buffer spille færdig. Puckens lokale wake-ord-hush skærer stadig ved ~51 ms.

## 7. Modprøvens tjekliste (indarbejdet — må ikke regressere)



A1 hybrid=samme fejldomæne → droppet · A2 tool-antal beviser intet → ægte probe ·
A3 idle_timeout=genprompt-race → feltet droppet · A4 målinger før preset-default →
rækkefølge rettet · A5 room-scoped duck → uge 3 · H1 tyssebarhed uden duplex → uge 3 ·
H2 duck-ACK-timeout → uge 3 · H3 opdaterings-/pin-politik for firmware+HA → skrives i
DOCS (opdatér aldrig automatisk; rebuild-ritualet står i validate.sh/VOICE_PE_FLOW) ·
F1 firmware-lokal fejllyd → uge 2 · F2 runtime fail-honest → uge 1 · F5 hård-fejl-værn
alle felter → uge 1.
