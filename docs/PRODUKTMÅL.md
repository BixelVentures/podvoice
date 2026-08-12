# PodVoice-produktmål — den målbare danske hjemmeassistent

> Kanonisk mål fra 2026-08-11. En funktion er ikke leveret, fordi koden findes, en
> kontrakttest er grøn eller firmwaren kompilerer. Den er leveret, når den tilsvarende
> gate er kørt på den fysiske Voice PE og resultatet er gemt.

## Nordstjernen

Et familiemedlem siger wake-ordet, taler naturligt dansk og får enten den rigtige korte
hjælp eller en hørbar, handlingsanvisende fejl. PodVoice må aldrig være tavs, hænge i en
tilstand, handle på en forkert enhed eller foregive at vide noget aktuelt uden opslag.

Systemets faste form er:

- Voice PE er øre, wake-ord, lysring og mund.
- OpenAI Realtime er samtalemotoren; PodVoice ejer transport, sikkerhed og fejladfærd.
- Home Assistants MCP-server er eneste vej til hjemmets eksponerede enheder.
- Musik er HA-first, men ikke HA-only: PodConnect Control i Home Assistant ejer Spotify-søgning,
  bibliotek, historik og `media_player`-styring, mens PodConnect Speakers ejer den fysiske
  HomePod-vej, ducking, account-agnostic stop/release og genopretning. Web er stadig korrekt,
  når spørgsmålet handler om ekstern viden om en sang, kunstner, album, koncert eller betydning.
- Aktuel viden går gennem hjemmets eksisterende Gemini-søgeagent, eksponeret via
  Home Assistant/MCP. En OpenAI-baseret reserve må kun tilføjes, hvis en målt A/B-test
  viser en gevinst i kvalitet, svartid eller fejladfærd uden at skabe to tvetydige veje.

## Definition of done

Alle målinger køres først uden musik og derefter med normal musik/TV i samme rum.

| Område | Releasekrav |
|---|---|
| Hel samtale | 50 × wake → spørgsmål → hørbart svar → opfølgning → luk. 0 fastlåste faser, 0 stumme svar. |
| Dansk | Fast sæt med 50 korte/lange/fjerne ytringer: mindst 95 % korrekt intention og 0 svar på andet sprog. |
| Svartid | Lokal/videnssvar: første hørbare lyd p50 ≤1,5 s og p90 ≤2,5 s. Panelet viser begge percentiler. |
| Ekko og afbrydelse | 50 svar: 0 selvafbrydelser. “Stop”/wake midt i svar gør pucken stille p95 ≤300 ms. |
| Web | 20 aktuelle spørgsmål (nyheder, sport, vejr/pris): 20 reelle søgekald, kilder gemt, 0 opdigtede aktuelle tal; p90 ≤8 s eller tydelig fejl. |
| Hjem | 30 reversible HA-kommandoer på tværs af lys, klima, scener/lister: 100 % korrekt mål, 0 uønskede handlinger, fejl siges højt. |
| Musik | 30 play/pause/næste/lydstyrke/søgning/library-kald: korrekt rum hver gang; Spotify-søgning går via PodConnect Control/HA; duck-ACK ≤300 ms og fysisk stop/release går via PodConnect Speakers; oprindelig musiktilstand gendannes efter samtalen. |
| Sikkerhed | Oplåsning, alarm fra, køb, besked og sletning kræver eksplicit bekræftelse i 10/10 adversarielle forsøg. |
| Fejl | OpenAI nede, HA/MCP nede, PodConnect nede, puck genstarter og adresse ændres: alle bliver synlige i panelet og hørbare, ingen endeløs spinner. |
| Stabilitet | Syv døgn i husets normale brug uden manuel genstart, fastlåst session eller tabt musiktilstand. |

Det er også benchmarken mod Gemini for Home og Alexa+: samme danske manuskript, samme
rum og samme handlinger. Vi hævder kun at vinde de rækker, hvor PodVoice har bedre målte
tal. “Bedre på alle måder” er retningen; tabellen er beviset.

## Release-gates

### Gate A — reproducerbart softwarefundament

- Python 3.12, runtime- og dev-afhængigheder installeret sammen.
- Hele testpakken, lint, format og typer er grønne fra en frisk venv.
- ESPHome 2026.6.2 validerer og kompilerer uden for iCloud.
- Den genererede C++ viser separate speaker-livscyklusser for Voice Assistant og
  external media player.

**Status 2026-08-11:** kode/test/build er grøn; lint-konfiguration og afhængighedspins
afsluttes i samme kandidat. Hardware er ikke en del af Gate A.

### Gate B — fysisk direct-lyd

Flash den kompilerede firmware. Kør mindst én hel dansk samtale og bevis i log/panel:

1. `direct_speaker_v3` og `podvoice_direct_prepare` annonceres.
2. Et helt svar høres i korrekt tempo og uden tabte ord.
3. `reply_played` ankommer efter sidste hørbare byte.
4. `voice_assistant_phase` forlader 5 og vender til idle.
5. En opfølgning uden nyt wake-ord besvares.
6. Ny wake efter luk virker.

Indtil alle seks er grønne, forbliver `speaker_path="announce"` standarden. Den gamle
1.11.0-firmware annoncerede `reply_played`, men kunne hænge før eventet; derfor kræver
automatisk valg nu den nye `direct_speaker_v3`-markør og dens eksplicitte API-lyd-håndtryk.

### Gate C — live kapabiliteter

Kør delprøverne for web, HA og musik fra tabellen med den rigtige OpenAI-konto, HA's
eksponerede enheder og husets højttalere. Mocktests beviser kun kontrakter, ikke adfærd.

### Gate D — familie-soak og oprydning

Syv døgn på den validerede kandidat. Først derefter bliver `thin`/`direct` standard og
de gamle `classic`/announce-fallbacks kan markeres til sletning. En fallback slettes
aldrig i samme release, som dens afløser første gang består en stuetest.

## Næste konkrete rækkefølge

1. Flash Gate B-kandidaten og gem en komplet samtalelog.
2. Aktivér direct eksplicit for prøven; promover ikke default før beviset.
3. Kør web-, HA- og musikmatrixen — herunder kildebevis fra Gemini-agenten og PodConnect
   Control/Speakers-bevis for musik — og ret én
   observeret fejl ad gangen.
4. Udgiv en release candidate, kør syv-døgns soak, og ryd først derefter fallbackkode.

## Stuetest — den korte protokol før noget kaldes “virker”

Kør først på standardvejen (`speaker_path="announce"`), derefter kun på `direct` når
Gate B specifikt testes. Gem panelhistorik og add-on-log for hvert run.

1. **Turtagning og feedback**
   - “Okay Nabu. Hvad er klokken?”
   - Forvent: kort dansk svar, grøn ring mens svaret høres, tydeligt tur-bip/dæmpet cyan
     når det er din tur, og LED slukker efter farvel/timeout.
2. **ASR-usikkerhed og web**
   - “Hvad tid skal AGF spille i aften?”
   - Forvent: `Det tjekker jeg.`, et reelt `google_web_sogning`-/MCP-kald, ingen
     vejr-svar medmindre du bad om vejret, og kilder i resultatet/historikken.
3. **Vejr dér hvor hjemmet er**
   - “Hvordan bliver vejret her i eftermiddag?”
   - Forvent: vejr-entity/script eller søgeværktøj bruges med hjemmets/nærområdets
     placering; kort dansk svar med temperatur/nedbør/vind hvis tilgængeligt.
4. **Opfølgning uden wake**
   - Efter svaret: “Hvor spiller de?”
   - Forvent: den forstår konteksten og svarer eller søger; ingen ny wake kræves.
5. **Hjemmestyring**
   - “Sluk/tænd [en ufarlig delt lampe i samme rum].”
   - Forvent: korrekt HA-værktøj, korrekt mål, én fast dansk kvittering, ingen handling
     på andre rum.
6. **Musik**
   - Start musik i rummet og sig “Pause”, “Næste”, “Skru lidt ned”, “Spil noget
     afslappende her”, og “Hvad har jeg hørt for nylig?”
   - Forvent: korrekt rum hver gang; PodConnect Control/HA bruges til Spotify-søgning,
     library/historik og normal transport; PodConnect Speakers bruges til ducking og
     account-agnostic stop/release; musik dæmpes under samtalen og gendannes bagefter.
7. **Afbrydelse og lukning**
   - Afbryd et langt svar med “stop” eller wake-ordet.
   - Forvent: pucken bliver stille hurtigt, samtalen går tilbage til at lytte eller
     lukker rent; ingen fastlåst LED, ingen stille spinner.

Hvis ét punkt fejler, rettes den ene observerede fejl før næste runde. En grøn firmware-
kontrakt eller en grøn unit-test må aldrig erstatte denne fysiske protokol.
