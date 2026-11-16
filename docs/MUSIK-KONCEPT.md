# Musik i PodView — grundkoncept for køkkenets væg-iPad

Status: koncept til beslutning, 2026-11-16. Ingen produktkode er ændret.
Mål: iPad Air 5 på væggen, 1180×820 liggende, HA Companion i kiosk, delt familiekøkken.
Grundregel: intet opdigtet. Hver etiket og tilstand skal kunne spores til Spotify-data via
PodConnect, til HA-data, eller til et AI-svar, der er mærket som AI.

---

## 0. Tre fakta, der ændrer opgaven

1. **Den egne AI er OpenAI, ikke Gemini.** Brief'et siger »Gemini via PodVoice«. Koden siger noget
   andet:
   - Stemmen kører på `gpt-realtime-2.1` / `-mini` (`podvoice/gatekeeper/openai_realtime.py:258`).
   - PodViews forslag kører på `gpt-6-luna` (`podview_enrichment.py:22`, brugt af `podview_mood.py`).
   - `settings.py:46` skriver: »v3: the OpenAI-only overhaul — drops saved gemini_* …«.
   - `docs/PLAN-BEAT-GEMINI.md` blev fjernet fra træet i `a38a4ae5`. Kun en gammel kopi ligger i
     hovedcheckout'en.

   Konceptet bruger derfor »den egne AI« om OpenAI-vejen gennem PodVoice. Valget af motor ændrer
   ikke designet, men det ændrer Terms-vurderingen i §2.3, fordi data sendes til OpenAI.
2. **Det sikre AI-mønster findes allerede.** `MoodSelector` (`podview_mood.py`) giver modellen kun
   time og rumtype og en lukket liste af egne temaer. Den får ingen Spotify-data. Den returnerer tre
   tema-id'er fra en `enum`, og Spotify-søgning laver resten. Det er præcis »kontekst ind, Spotify
   ud«. Konceptet bygger videre på det; det opfinder det ikke.
3. **Stemmen sender allerede Spotify-metadata til OpenAI.** Værktøjerne
   `podconnect_recently_played`, `podconnect_top_tracks` og `podconnect_liked` (`tools.py:152-172`)
   returnerer `tracks(name, artist, uri)` til realtime-modellen. Det er den Terms-risiko, brief'et
   spørger til, og den er allerede i drift. Se §2.3.

Andre fakta fra koden, der former designet:
- `recently_played` i PodConnect (`api.py:106`) smider `played_at` og `context` væk og
  deduplikerer. I dag kan vi ikke vise »fra hvilken playliste« eller noget med tidspunkt.
- `top_tracks` og `top_artists` sender ingen `time_range` (`api.py:96-104`), så Spotify bruger
  sin standard (medium).
- PodConnect laver 429 om til en tekst-exception med `retry-after` inde i strengen (`api.py:56`).
  PodVoice kender fejlarten `rate_limited` (`podview_music.py:17`), men ikke ventetiden.
- `explicit` projiceres ikke nogen steder i PodVoice (`podview_music.py:_item`). En børnesikker
  tilstand kræver altså en ny projektion.
- PodVoice har allerede vejr (`podview_weather*.py`), HA-timere (`ha_timers.py`) og opskrifter
  (`podview_recipes.json`, 8 opskrifter). PodView bruger i dag ingen tilstedeværelse
  (`person.*`), så »hvem er hjemme« er ikke en eksisterende kilde.

---

## 1. Jobs-to-be-done i et delt køkken

| Job | Hvem | Hvad de faktisk vil | Stemme eller tryk | Det, designet skal levere |
|---|---|---|---|---|
| Lave aftensmad | Den, der laver mad | Noget i baggrunden, der passer, uden at tørre hænderne | **Stemme** først, ét stort tryk som alternativ | Ét forslag lige nu, startet på 1 tryk. Lydstyrke og pause skal kunne ramme fra 1 m |
| Morgenræs | Voksen og børn | Det sædvanlige morgenradio eller playliste, hurtigt | Tryk | »Spil igen«-hylden øverst før kl. 9, fordi det er det, man spillede sidst |
| Barnet vil høre sin sang | Barn 4-12 år | Præcis den sang, nu | Tryk på et billede, ikke tekst | En »Familiens«-hylde med store omslag fra kontoens egne familieplaylister. Ingen søgning nødvendig |
| Gæster | Vært | Noget neutralt og ikke pinligt; ingen private »Liked«-sange på væggen | Tryk | Mulighed for at skjule personlige hylder. Kontekstforslag med AI-mærke |
| Rolig aften | Voksne | Lavt og roligt, ingen pludselig skift | Stemme eller tryk | Aftenhylden og lav standardlydstyrke. Ingen autoplay af noget nyt |
| »Det plejer vi« | Alle | Starte igen dér, hvor huset slap | Tryk | »Fortsæt« = den aktuelle/sidste kontekst og de seneste spillede sange |
| Skifte rum | Alle | Musikken med ind i stuen | Tryk | Højttalervælgeren i playeren. Playeren ejer rummet; browsing ændrer det aldrig |
| Nogen spiller fra egen telefon | Partner med egen konto | At kunne se det og ikke blive afbrudt ved et uheld | — | Tilstanden »Anden konto« (`placement==='other-account'`), som er read-only og ærlig |

Hvem bestemmer hvad, på én konto:
- **Sidste tryk vinder** (eksisterende regel 2). Der er ingen personlig adgangskontrol på
  skærmen, fordi skærmen ikke ved, hvem der står foran den. Det må vi ikke lade som om.
- **Stemme og tryk er det samme intent.** `music-flow.js` binder allerede tale og tryk til samme
  `optionId`. Konceptet beholder det: et AI-forslag på skærmen kan vælges med »nummer to« eller
  med et tryk.
- **Kun ejeren ændrer politik.** AI til/fra, børnesikker tilstand, skjulte hylder og
  AI-budget hører til i add-on-konfigurationen i HA, ikke på køkkenskærmen.

---

## 2. Hvor AI ærligt tilføjer værdi

### 2.1 Det, AI'en gør

**A. Fra ønske til Spotify-handling.** Et ønske som »noget roligt til madlavning« bliver til:
1. AI'en (gpt-6-luna, struktureret output) returnerer 1-3 søgestrenge, en kort etiket og en
   begrundelse. Begrundelsen må kun henvise til de kontekstfelter, den fik.
2. PodConnect kører `/search` med type `playlist` (og evt. `track`), højst 10 resultater pr.
   forespørgsel.
3. **Valget blandt resultaterne foretages af kode, ikke af AI.** Koden bevarer Spotifys
   rækkefølge og fjerner dubletter efter URI (præcis som `assign_playlists` i
   `podview_feeling.py`). Er børnesikker tilstand slået til, droppes eksplicitte numre. Koden
   viser til sidst tre valg.
4. Skærmen viser Spotifys navn og omslag uændret. AI-etiketten og -begrundelsen står separat og
   mærket »AI-forslag«.

Stemmen gør allerede trin 1-2 i dag: realtime-modellen omsætter tale til
`HassMediaSearchAndPlay(search_query)`. Tryk-vejen får samme mønster gennem PodView.

**B. Kontekst, AI'en må bruge, fordi den er vores egen:**

| Kontekst | Kilde i dag | Bemærkning |
|---|---|---|
| Time, ugedag | Enhedens ur (Europe/Copenhagen), allerede i `discoverySectionLabel` | Bruges i dag kun som `hour` |
| Rum og rumtype | `room_kind` i mood-politikken | `kitchen` / `living_room` / `other` |
| Vejr (tilstand, temperatur) | `podview_weather.py` → `condition`, `temperature` | Kun tilstandsordet og et tal, ingen lokation |
| Opskrift i gang | PodViews opskriftsforløb, titel fra `podview_recipes.json` | Fx »Kylling i karry«. Egne data |
| Aktiv timer | `ha_timers.py` | Kun »timer kører, X min tilbage« |
| Hvem er hjemme | **Findes ikke i PodView i dag** | Først efter ejerens tilvalg; send kun et antal, aldrig navne |
| Brugerens egne ord | Tale eller tryk-chip | Brugerens input er ikke Spotify-data, heller ikke når det indeholder et kunstnernavn |

**C. Det, AI'en ikke gør:** den finder ikke på playlister, sange eller kunstnere, der ikke er
kommet fra Spotify i samme forespørgsel. Den skriver ikke »Spotify-mix«. Den udtaler sig ikke om
lytteadfærd, fx »det I plejer at spille nu«. Og den analyserer ikke lydindhold eller tempo.

### 2.2 Hvor AI ikke hører hjemme

- I hylderne »Spil igen«, »Dine topsange«, »Dine playlister« og »Gemte sange«. Det er rene
  Spotify-lister i Spotifys rækkefølge. AI ville kun gøre dem mindre sande.
- I playeren og køen. Status er det, højttaleren rapporterer (regel 1).
- Som erstatning for anbefalinger. `recommendations`, `related-artists` og `audio-features` er
  væk, og vi må ikke genopfinde dem ved at analysere Spotify-data (III.13).

### 2.3 Terms-risiko: Spotify-metadata til en LLM

*Dette er en produktvurdering, ikke juridisk rådgivning. Få en jurist til at læse III.5, III.9 og
III.13 i den aktuelle version, før bane 2 bygges.*

| Bane | Hvad sendes til OpenAI | Risiko | Anbefaling |
|---|---|---|---|
| **1. Kontekst ind, Spotify ud** | Tid, ugedag, rumtype, vejr, opskriftstitel, timer og brugerens egne ord. **Intet fra Spotify** | Lav. Der videregives ingen Spotify-data (III.9), og intet Spotify-indhold analyseres (III.13). AI-svaret er en søgestreng, som Spotify selv besvarer | **Brug denne.** Det er `MoodSelector`-mønsteret, bare med flere kontekstfelter og fri søgestreng i stedet for lukket enum |
| **2. AI rangerer Spotify-navne** | Titler og kunstnernavne fra søgeresultater eller biblioteket | Middel til høj. At give tracknavne til en tredjepart ligner »passing Spotify data to another service« (III.9). At lade den vælge ud fra dem ligner analyse eller afledte vurderinger (III.13) | **Byg den ikke.** Rangering sker i kode og i Spotifys egen rækkefølge |
| **3. Eksisterende stemmeværktøjer** | `podconnect_recently_played/top_tracks/liked` sender `name, artist, uri` til realtime-modellen | Samme som bane 2, og den er **allerede i drift** | Beslut eksplicit: enten (a) behold med juridisk vurdering, eller (b) lad værktøjerne afspille direkte (fx »spil mine topsange« → `play_from_library`) uden at returnere navne til modellen. Jeg anbefaler (b) |

Grænsetilfælde: når brugeren selv siger »spil Gasolin'«, er navnet brugerens input. Når modellen
bagefter læser »Nu spiller: Kvinde min« fra Spotify for at svare, er det Spotify-data. Svaret
efter afspilning bør komme fra en fast skabelon i kode (»Den spiller nu i køkkenet«), ikke fra
modellen.

---

## 3. Delt køkken med én konto — ærligt

**Hvad én konto betyder:**
- Alt personligt, altså topsange, gemte sange, »Spil igen« og playlister, er **ejerens**. Det er
  ikke »jeres«. Lærredet `A-MusikHjem` skriver »Fra jeres Spotify-konti« (flertal), og det er
  forkert i dag.
- Alt, familien spiller, påvirker ejerens Spotify-historik og anbefalinger i Spotify-appen. Det
  skal ejeren vide, så hvert køkkentryk ikke kommer som en overraskelse.
- Skærmen kan ikke vide, hvem der står foran den.

**Husstandsfunktioner, der virker med én konto:**
1. **»Familiens«-hylden:** playlister, som ejerkontoen *ejer*, og hvis navn begynder med et aftalt
   præfiks, fx `Familien ·` (»Familien · Børnenes«, »Familien · Fredagsbar«). Filtreringen sker i
   kode på `/me/playlists` (`owner.id == me` og præfiks). Det er ikke AI og ikke analyse.
   Ejeren laver listerne i Spotify-appen. Med PodConnect-ændringen `/playlists/{id}/items` (kun
   egne lister) kan hylden vise de enkelte sange, så barnet kan trykke direkte på »sin« sang.
2. **Børnesikker standard:** `explicit` findes på track-objekter. Når tilstanden er slået til,
   vises og startes eksplicitte *numre* ikke fra PodView. Ærlig begrænsning: playlister ejet af
   andre kan ikke læses, så deres indhold kan ikke filtreres. Den reelle løftestang er Spotifys
   egen kontoindstilling for eksplicit indhold. `/me` returnerer `explicit_content` med scope
   `user-read-private`, men det skal verificeres i dev-mode. Kan den læses, viser PodView den som
   status (»Eksplicit indhold er filtreret på kontoen«), men den ændrer den ikke.
3. **Gæstetilstand:** skjuler »Gemte sange« og »Dine topsange« på skærmen. Det er ren
   præsentation, ingen datakald.
4. **Lav aftenlydstyrke:** forslag fra skærmen starter med lydstyrkeloft efter klokkeslæt.
   `guarded_send(..., max_volume)` findes allerede i `podview_music_selection.py:397`.

**Det, en fremtidig flerkonto-tilstand kræver:**
- PodConnect: én OAuth-post pr. person og et tokenvalg pr. kommando. Ejerskab pr. rum
  (`own/other/unknown`) findes delvist og driver allerede »Anden konto«.
- PodConnect Speakers: den kontoneutrale `/api/release` gjort tilgængelig for PodView, så man kan
  overtage en højttaler fra en anden konto. Audit'en 2026-11-07 §1.5 siger, at den mangler.
- PodView: en eksplicit »Hvem lytter?«-vælger (ansigt eller initial, intet login) foran personlige
  hylder. Sidste valg nulstilles efter 10 min, ligesom playerens regel.
- Spotify: dev-mode har et loft over, hvor mange brugere der kan godkendes. Tallet skal
  verificeres, før det bliver et løfte.
- Indtil da: »Anden konto« er read-only med den eksisterende tekst
  `En anden Spotify-konto spiller her`.

---

## 4. Informationsarkitektur for Musik ved 1180×820

### 4.1 Rammen

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Topbar (eksisterende, ~72 px)                                                         │
├──────────────────────────────────────────────────────────┬───────────────────────────┤
│ Indholdskolonne ≈ 760 px (lodret rulning, én side)        │ Player-kolonne 372 px      │
│                                                          │ (fast, rulles ikke)        │
│  [Hero: Til lige nu]                       ~260 px        │  Omslag, titel, kunstner   │
│  [Ønskelinje: chips + »Sig det«]            ~64 px        │  Transport, lydstyrke      │
│  Hylde 1  ───────────────────────────────►  ~220 px       │  Højttalervælger           │
│  Hylde 2  ───────────────────────────────►                │  Kø (næste 3-5)            │
│  Hylde 3 …                                                │                            │
└──────────────────────────────────────────────────────────┴───────────────────────────┘
```

**Player-kolonnen bliver på 372 px til højre.** Jeg har overvejet at gøre afspilning til en
fuldbredde-hero som i Spotify, men gør det ikke, af tre grunde:
- Den faste kolonne er fælles for alle sider, så man kender den fra resten af PodView.
- Den ejer højttalervalget (regel 6), og det skal man altid kunne nå.
- På 760 px er der plads til 4 omslag à 160 px eller 5 à 132 px pr. hyldelinje, og det er nok.

Køen bliver i playeren, ikke i en egen fane. Lærredet `Musik-Koe` kan genbruges.

### 4.2 Sektioner og hylder

Rækkefølgen er fast, med én undtagelse: før kl. 9 rykker »Spil igen« op over hero'en.

| # | Sektion | Datakilde | Rækkefølge | Tom tilstand | AI-mærke |
|---|---|---|---|---|---|
| 0 | **Til lige nu** (hero, 1 stort + 2 små) | AI-søgestrenge fra kontekst (§2.1) → `/search` type playlist | Spotifys rækkefølge, dublet-fri | Uden AI: falder tilbage til den faste temaliste for tidspunktet (`THEMES`/`SETS`), uden AI-mærke | Ja: »AI-forslag« + begrundelse |
| 1 | **Ønskelinje** | Faste, egne intentioner (som `podview_feeling.THEMES`) + brugerens ord | Fast | Vises altid | Kun resultatet bliver AI-mærket, hvis AI lavede søgningen |
| 2 | **Fortsæt** / **Spil igen** | Nu: `recently-played` (tracks). Efter PodConnect: `context` (album/playliste) | Spotifys (nyeste først) | »Intet spillet for nylig på kontoen.« | Nej |
| 3 | **Familiens** | `/me/playlists` filtreret: ejet af kontoen + præfiks `Familien ·` | Spotifys | »Lav en playliste i Spotify, der starter med ›Familien ·‹, så dukker den op her.« | Nej |
| 4 | **Dine playlister** | `/me/playlists` (resten) | Spotifys | »Ingen playlister i dette udvalg.« (eksisterende) | Nej |
| 5 | **Dine topsange** | `/me/top/tracks`; senere med faneknap »4 uger / 6 mdr. / Altid« (`time_range`) | Spotifys rang | »Ingen sange i dette udvalg.« (eksisterende) | Nej |
| 6 | **Gemte sange** | `/me/tracks` | Spotifys (nyeste gemt først) | »Ingen gemte sange endnu.« | Nej |
| 7 | **Vibe** | Faste `podview_feeling.THEMES` → `/search` | Fast tema, Spotify-resultat | »Ingen humørforslag at vise.« (eksisterende) | Nej, det er faste egne temaer |

Bevidst fravalgt fra lærredet `A-MusikHjem`, fordi det ikke kan spores til data:
- »Nyt fra jeres kunstnere · Udgivet denne uge«: der er ingen tilgængelig kilde for nye
  udgivelser.
- Etiketten »Spotify-mix«: der findes intet mix.
- »Det I plejer at spille nu«: det kræver en lyttemønsteranalyse, jf. III.13 og den manglende
  `played_at`.

Det kan blive senere: »Snart jul« må gerne komme som et *kontekstforslag* fra AI'en (datoen er
egen kontekst), ikke som en redaktionel hylde.

**Daylist-lignende hylde, men ærlig:** Spotifys Daylist bygger på lytteanalyse. Vi kan ikke og
må ikke kopiere den. Vores version er hero'en »Til tirsdag aften«: den bygger på egen kontekst
og Spotify-søgning, og den er mærket som AI-forslag.

---

## 5. Tre retninger

### A — »Spotify-hjem«

```
┌ Musik ───────────────────────────────────────────┬ Player 372 ┐
│ Fortsæt                                   Se alle │            │
│ [▣][▣][▣][▣][▣]                                   │            │
│ Familiens                                         │            │
│ [▣][▣][▣][▣]                                      │            │
│ Dine playlister · Dine topsange · Gemte sange …  │            │
│ Til tirsdag aften (faste temaer, ingen AI)        │            │
└───────────────────────────────────────────────────┴────────────┘
```

- **Data:** recently-played, `/me/playlists`, top tracks, liked og de faste temaer. Alt findes i
  dag.
- **Indsats:**
  - PodConnect: 0 (valgfrit `time_range` og `context`).
  - PodVoice: M. Det er en omlægning af `music-results.js` og `live-music-view.js` fra faner til
    én side med hylder; datakaldene findes.
- **Risici:**
  - Det er mest ejerens musik, så familien har kun »Familiens« at holde sig til.
  - Det løser ikke madlavnings-jobbet bedre end i dag.
  - Det bliver let et Spotify-klon uden grund til at være på væggen.

### B — »AI-DJ for køkkenet«

```
┌ Musik ───────────────────────────────────────────┬ Player 372 ┐
│ ┌──────────────────────────────────────────────┐  │            │
│ │  AI-forslag · Rolig aftensmad                │  │            │
│ │  [stort omslag]  Playlistenavn (Spotify)     │  │            │
│ │  »Valgt ud fra: aften · regn · karry i gang« │  │            │
│ │  [Afspil]  [Noget andet]  [Mere energi]      │  │            │
│ └──────────────────────────────────────────────┘  │            │
│ Sig fx »Okay Nabu, noget roligt« …               │            │
│ (resten skjult bag »Bibliotek«)                   │            │
└───────────────────────────────────────────────────┴────────────┘
```

- **Data:** AI-søgestrenge fra kontekst, `/search` og knapperne »Noget andet« og »Mere energi«,
  der laver en ny AI-forespørgsel med en justering.
- **Indsats:**
  - PodConnect: S (struktureret 429, `explicit`).
  - PodVoice: L. Det kræver en ny AI-kontrakt med fri søgestreng, budget pr. dag, en
    styringssløjfe, ventetid og fejlstier, og det skal deles med stemmevejen.
- **Risici:**
  - Hver handling koster et AI-kald. Budgettet er i dag default-off og højst 20 kald.
  - Ventetiden er cirka 1-4 s pr. justering (`asyncio.timeout(4)`).
  - Uden AI er siden tom.
  - »Mere energi« fristes til at blive tempoanalyse (III.13).
  - Det mindst Spotify-agtige af de tre.

### C — »Kontekst-først« (anbefalet)

```
┌ Musik ────────────────────────────────────────────────────┬ Player 372 ┐
│ Til tirsdag aften                         AI-forslag  ⟳   │            │
│ ┌───────────────────────┐ ┌───────────┐ ┌───────────┐     │            │
│ │ [omslag 212]          │ │ [omslag]  │ │ [omslag]  │     │            │
│ │ Playlistenavn         │ │ Navn      │ │ Navn      │     │            │
│ │ Spotify · ejer        │ │           │ │           │     │            │
│ │ [▶ Afspil]            │ └───────────┘ └───────────┘     │            │
│ └───────────────────────┘                                  │            │
│ Valgt ud fra: aften · 6° og regn · Kylling i karry i gang  │            │
│ [Roligt] [Til madlavning] [Fest] [Børnenes] [🎙 Sig det]   │            │
│ Fortsæt ──────────────────────────────────────────────►    │            │
│ Familiens ────────────────────────────────────────────►    │            │
│ Dine playlister · Dine topsange · Gemte sange · Vibe  ►    │            │
└────────────────────────────────────────────────────────────┴────────────┘
```

- **Data:**
  - Hero: AI-søgestrenge fra egen kontekst plus `/search`. Uden AI bruges faste temaer for
    tidspunktet, uden mærke.
  - Ønskelinje: faste egne intentioner. Et tryk laver en ny AI-søgning med den intention som
    brugerens ord.
  - Hylderne under: A's rene Spotify-hylder.
- **Indsats:**
  - PodConnect: S-M (`time_range`, `context` + `played_at` på recently-played, `/items` for egne
    lister, `explicit`, struktureret 429 med `retry_after_s`).
  - PodVoice: M-L, i tre trin. Trin 1: A's hylder. Trin 2: udvid `MoodSelector` med ugedag,
    vejr, opskrift og timer, stadig med lukket enum. Trin 3: fri søgestreng for ønskelinjen.
- **Risici:**
  - Begrundelseslinjen kan blive løgnagtig, hvis den skrives frit af modellen. Den bygges derfor
    i kode af de felter, der faktisk blev sendt, og kun den korte etiket kommer fra AI.
  - AI-budgettet skal kunne bære cirka 6-15 kald om dagen.
  - Dårlige søgeresultater for brede strenge, fordi `limit ≤ 10`.

### Anbefaling: C

C er den eneste retning, der både løser madlavnings-jobbet (et forslag på ét tryk, der passer til
situationen) og er Spotify-agtig (hylder, omslag, »Fortsæt«). Den virker også uden AI: hero'en
falder tilbage til faste temaer, og hylderne er rene Spotify-data. Den kan leveres i trin, hvor
trin 1 er nyttigt alene. B bliver i stedet en *tilstand* af C: »Sig det« og »⟳ Andre forslag« er
DJ'en, så der ikke bygges en separat side.

---

## 6. Dansk UI-tekst for retning C

### 6.1 Faste tekster

| Sted | Tekst | Kilde/regel |
|---|---|---|
| Sidetitel | `Musik` | |
| Hero-overskrift | `Til {ugedag} {morgen/eftermiddag/aften}`. Om natten: `Til i nat` | `discoverySectionLabel` findes |
| AI-mærke | `AI-forslag` | Vises kun, når AI lavede søgningen |
| Begrundelse (kode) | `Valgt ud fra: {felter}`. Felter i fast rækkefølge: `aften`, `6° og regn`, `Kylling i karry i gang`, `timer: 12 min` | Kun felter, der faktisk blev sendt |
| AI-etiket (model, ≤ 32 tegn) | Fx `Rolig aftensmad` | Står efter `AI-forslag ·` |
| Kort-undertitel | `Spotify · {ejerens visningsnavn}` (playlistens ejer fra Spotify) | |
| Afspil-knap | `Afspil` → `Starter…` → `Spiller` | Som lærredet: ét skift pr. handling (regel 4) |
| Andre forslag | `Andre forslag` | Eksisterende `DISCOVERY_ACTION.mood` |
| Ønske-chips | `Roligt` · `Til madlavning` · `Fest` · `Børnenes` · `Morgen` | Faste egne intentioner |
| Stemme-chip | `Sig det` → åbner tip: `Sig »Okay Nabu, spil noget roligt i køkkenet«` | Wake-ordet afhænger af opsætningen; brug det konfigurerede |
| Uden AI (fallback) | Hero-overskrift som ovenfor, intet mærke, undertekst `Faste forslag til tidspunktet` | |
| Hylde | `Fortsæt` · `Familiens` · `Dine playlister` · `Dine topsange` · `Gemte sange` · `Vibe` | »Dine«, ikke »jeres« |
| Topsange-filter | `4 uger` · `6 måneder` · `Altid` | Kræver `time_range` |
| Se alle | `Se alle` | |
| Gæstetilstand aktiv | `Personlige hylder er skjult` | |
| Børnesikker aktiv | `Eksplicitte numre er skjult` | |

### 6.2 Tilstande

PodView skal vise sidst kendte data i første frame (regel 5). Der bruges ingen spinner over
hele siden, og fejl påvirker kun det tryk, de opstod ved (regel 3).

| Tilstand | Udløser (kode) | Hero | Hylder | Player |
|---|---|---|---|---|
| **Indlæser, med cache** | Første læsning efter åbning | Sidste forslag vises. Lille tekst `Opdaterer…` ved ⟳ | Sidste data | Uændret |
| **Indlæser, uden cache** | Kold start | Tre tomme omslagsrammer i fast størrelse, ingen tekst | Tomme rammer pr. hylde | Uændret |
| **AI tænker** | Tryk på chip eller ⟳ | Nuværende kort bliver stående. Chippen viser `Finder…` | — | — |
| **AI utilgængelig** | Ingen nøgle, budget brugt, timeout, 429 fra OpenAI | Fald stille tilbage til faste temaer, uden mærke. Ingen fejltekst | — | — |
| **Tom** | Kilden svarer, men har 0 rækker | — | Se tom-teksterne i §4.2. Hylden skjules, hvis teksten ikke er handlingsbar | — |
| **Offline** | `unavailable` / ingen forbindelse til PodVoice | Sidste data, nedtonet. Linje: `Ikke forbundet · viser sidst kendte` | Nedtonet, tryk deaktiveret | Eksisterende `Ikke opdateret · ` |
| **Spotify-login udløbet** | `authentication_required` | `Spotify skal forbindes igen i Home Assistant` | Skjult | Uændret |
| **Anden konto** | `placement==='other-account'` | Uændret, men `Afspil` bliver til `Spil i stedet her` på dette rum, hvis frigivelse findes. Ellers deaktiveret med `En anden Spotify-konto spiller her` | Uændret (det er ejerens bibliotek) | Eksisterende: `En anden Spotify-konto spiller her` |
| **Kvote overskredet (429)** | `rate_limited` (+ `retry_after_s` efter PodConnect-ændring) | Sidste data. Ved tryk vises en kort toast: `Spotify har travlt · prøv igen om {n} sek.` (uden tal: `prøv igen om lidt`) | Sidste data, ingen automatisk genlæsning før ventetiden er gået | Uændret; transport virker, hvis Spotify tillader det |
| **Afvist eller ukendt udfald** | `rejected` / `unknown` | Kortet går tilbage til `Afspil`. Kort toast `Det lykkedes ikke · prøv igen`. Hvis musikken faktisk skiftede: ingenting | — | Aldrig låst (regel 3) |

---

## 7. Faseplan

**Fase 1 — kun PodVoice, dagens data (C trin 1)**
- Lav fanerne (`MUSIC_TABS`: Stemning/Humør/For dig/Senest) om til én side med hylder:
  hero, Fortsæt (tracks), Familiens (præfiksfilter på `/me/playlists`), Dine playlister, Dine
  topsange, Gemte sange og Vibe. Hero'en bruger den eksisterende `MoodSelector`, når den er slået
  til, og ellers `SETS`/`start_page`.
- Ret teksterne: »Dine«, ikke »jeres«. Fjern »Spotify-mix«, »Nyt fra jeres kunstnere« og »det I
  plejer« fra lærredet.
- Byg begrundelseslinjen i kode, kun med `aften`, fordi kun `hour` sendes i dag.
- Indsats: M. Ingen PodConnect-ændring.

**Fase 2 — PodConnect (kan køre parallelt med fase 1)**
1. `top_tracks`/`top_artists`: parameter `time_range` (`short_term`/`medium_term`/`long_term`).
2. `recently_played`: bevar `context` (uri, type) og `played_at` i stedet for kun at
   deduplikere tracks. Det giver »Fortsæt« med playlister og album, ligesom »Jump back in«.
   `played_at` bruges til visning, fx »i går«, ikke til mønsteranalyse.
3. `/playlists/{id}/items` kun for lister, kontoen ejer, så Familiens kan vise sange.
4. `explicit` på track-projektioner hele vejen gennem `podview_music._item`.
5. 429: returnér `{"error_kind": "rate_limited", "retry_after_s": n}` struktureret i stedet for
   tekst. PodVoice respekterer det i polling og genlæsning.
6. Verificér om `/me` → `explicit_content` er læsbar i dev-mode.
- Indsats: S-M i PodConnect, S i PodVoice-projektionerne.

**Fase 3 — AI-rørføring (C trin 2 og 3)**
- Trin 2: udvid `MoodSelector`-input fra `{hour, roomKind}` til
  `{hour, weekday, roomKind, weather:{condition, temperature}, recipe?, timerMinutesLeft?}`.
  Bevar det lukkede tema-enum og udvid temalisten (fx `kids`, `focus`, `dinner_guests`).
  Det er stadig ingen Spotify-data og lav Terms-risiko. Indsats: S-M.
- Trin 3: ny kontrakt `podview_music_wish_v1`. Input er kontekst + brugerens ord. Output er
  `{queries[1..3] (≤ 40 tegn), label (≤ 32 tegn)}`. Valg sker i kode, og budget og
  `approval_ref` følger samme model som mood. Delt med stemmen, så »Sig det« og chips giver samme
  resultat. Indsats: M-L.
- Parallelt: beslut skæbnen for de tre stemmeværktøjer, der returnerer Spotify-navne til OpenAI
  (§2.3 bane 3).

**Fase 4 — flere konti (først når brugerhistorierne kræver det)**
- Gør PodConnect multi-OAuth og `/api/release` tilgængelig. Tilføj »Hvem lytter?« i PodView.

**Rækkefølgen er bevidst:** fase 1 gør siden bedre i dag uden ny AI. Fase 2 gør »Fortsæt« og
»Familiens« rigtige. Fase 3 lægger først AI ovenpå, når der er noget sandt at lægge den ovenpå.

---

## 8. Åbne spørgsmål til ejeren

1. Familie-præfiks: `Familien ·` (anbefalet), `Køkken ·` eller en manuel liste i add-on-config?
2. De tre stemmeværktøjer, der sender sangnavne til OpenAI: (a) behold, (b) lav om til
   »afspil direkte« (anbefalet) eller (c) slå fra?
3. AI-budget for Musik: højst 20 kald i alt (som nu), eller en daglig ramme (fx 30/dag)?
4. Skal tilstedeværelse (`person.*`) tilføjes som kontekst, kun som et antal, eller holdes ude
   (anbefalet indtil videre)?
