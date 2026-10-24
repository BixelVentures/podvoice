# Musikbetjening · lydløs nat 24.–25. oktober 2026

## Aktuelt menneskeligt bevis og mål

Brugeren bekræfter faktisk lyd og hurtig betjening fra mobilens Spotify-app, både afspil→Connect og Connect→afspil. PodViews valg af musik giver derimod 8–12 sekunders feedbackforsinkelse, ustabil lydstyrke/højttalervisning og ingen lyd. Den positive mobilprøve lukker ikke PodViews valgte-indhold→native-route-forløb.

Leverancen er en sammenhængende fjernbetjening: eksplicit intent→én ejerbundet kommando→ærlig kvittering→frisk observation→kanonisk player. PodConnect/PodSpeakers ejer afspilning, route, lydstyrke og observation. PodView projekterer og betjener; accepteret er ikke det samme som faktisk afspilning eller akustisk accept.

## Grænser og ejerskab

- Ingen musik, Play/Resume, Connect-transfer, output-, seek-, volume- eller mute-kommando mod hjemmet; heller ikke ved lydstyrke nul. Ingen alarm, robot, lys, genstart, installation, pairing eller adgangsudvidelse som nattest.
- Kun inert loopback-fixture og passive læsninger. Installeret baseline PodVoice 2.0.82 / PodSpeakers 0.26.51 bevares, ligesom alle tidligere frosne pakker.
- Denne tråd ejer de kanoniske frontendmoduler og samlet visuelt review. Eksisterende v2.X-tråd ejer backend/native samt eneste release/installation. Brugeren har direkte godkendt koordinationsbeskeder til v2.X.
- Ét requestId og consume-before-await. UNKNOWN genafspilles aldrig automatisk. Ingen bredere grants, implicit adoption, optimistisk playing eller forlænget effektfrist.

## Konkrete kausale fund og igangværende rettelser

| Ejer | Fund | Rettelse / bevis der kræves |
| --- | --- | --- |
| LiveMusicSelection / SpeakerOutput | `actionDispatched` gjorde efterfølgende `current()` falsk og blokerede collection Plays accepted-refresh. Pending begyndte efter forberedende reads. Katalogudløb kunne skjule frisk faktisk native-identitet. | Brug eksisterende result-owner-fence; vis intent før prerequisite-await; frys præcis native destination til sammenligning, ikke ny myndighed. Kontrollér standarddestination og eksplicit NEXT særskilt. |
| LiveMedia | En enkelt accepted-read kunne hente old/idle; næste read kom først efter op til 8 sekunder. | Samme ejer udfører afgrænset passiv opfølgning i eksisterende 8-sekunders budget fra kvitteringen. Stop ved match, frist, nyt intent, ejer-/kontoskift eller disconnect. Intet overlap eller effekt-replay. |
| LiveControl / Player | Udløbet actiontilbud fjernede lovligt målt volume og gav spring til ukendt/0. | Bevar sidste målte værdi kun under samme præcise output/account/boot/provider-binding, deaktiveret uden friskt tilbud. Ny destination/ejer rydder værdien. Ukendt er — med neutral disabled thumb; faktisk nul forbliver nul. |
| v2.X backend | Langsom valgfri volume-read kunne blokere transporttilbud. Mobilens prepared-stream-forløb er forskelligt fra PodViews selected-content staging. | Backend arbejder på parallel afgrænset læsning og den faktiske selected-content→actor/C-kæde. Provider staging og faktisk lyd er ikke bevist ved frontendtests. |

v2.X har bekræftet eksisterende 8-sekunders passiv observationsramme. Pollfloor er bekræftet serviceinternt (`observe_after_poll_sequence` / `_confirm_destination`); browserkvitteringen er uændret, og intet nyt wirefelt er tilføjet. HTTP-command timeout og observationsfrist er forskellige forhold. En frontend-timeout betyder UNKNOWN, aldrig automatisk afvisning/genforsøg.

## Validering og aflevering

Fokuserede kausale regressionsprøver køres hos de enkelte kildeejere. Derefter samlet syntaks, `npm test` inklusive komponentgate og faktisk Product Design-/Impeccable-review af produkt 1280×800, 980×800 og bibliotek. [Renderet review og billedbeviser](NIGHT-MUSIC-REMOTE-UI-20261024.md) registreres særskilt. Ingen kilde-/kliktest lukker visuelt eller fysisk bevis.

Loopback-fixturen på 4191 bruger de faktiske kanoniske renderere og forfattede serverobservationer uden live-proxy eller hjemmets mål. Test gentagne valg, held targets/setup/action, accepted→oldidle→matching observation, endelig ubekræftet tilstand, skift af konto/ejer, katalogudløb, volume-expiry, pause/stale/progress og Back. Fixturen beviser softwareadfærd, ikke Spotify-provider eller lyd.

**Status:** samlet kilde og uafhængigt review består. Endelig fuldtest:2186/2186 PASS,0fail/cancel/skip; komponentgate63; seks ændrede runtimefilers syntaks består. Første fuldkørsel fangede to reelle tværgående regressioner (synkron renewal-invalidation og legacy-binding singleflight); de er kausalt rettet. Browserpasset fandt tab af højttalernavn ved katalogudløb; præcis display-only aliasretention er rettet og slutkontrolleret. Faktisk Product Design-/Impeccable-review består i det afgrænsede lokale produkt1280/980 og bibliotek, med syv personligt inspicerede slutbilleder. Ingen ny udgivelse, installation eller akustisk accept. v2.X undersøger klient-disconnect efter admission med fastholdt prepare: højst én commit ved fortsat gyldig authority, nul ved revocation og cached udfald uden replay. Eksisterende 12s browsergrænse bevares indtil målt kontraktgrundlag foreligger. Frontendefterfølgeren fryses i `/private/tmp/podview-music-remote-20261024-final` med fuld203-runtimeparitet, source/tests og beviser. Manifestet er `MUSIC-REMOTE-PINS.json`; kvitteringens hash registreres særskilt efter frysning. Hele den øvrige restliste i [leverancemålet](../UI-DELIVERY-GOAL.md) bevares.


## Afstemt backendstatus fra v2.X · samme nat

v2.X har gennemført en inert diskriminator på uændret Speakers0.26.51: public prepare→syntetisk lokal FLAC/AES→faktisk decode→commit→actor/C, både fra tom ejer og ved erstatning af aktiv writer. Det er lokalt softwarebevis, ikke Spotify-providerstaging eller højttalerlyd; ingen Native-produktionsfejl er påvist, og en ny Speakersudgivelse er derfor ikke begrundet.

Backendefterfølgeren er komponeret over præcis82 i `/private/tmp/pv-next-music-combined-20261024`; composition receipt SHA256 `ff2a0244f0a839de392a631194ca0cd0750ef0eff0784849345c932500eaabac`. Fire Python-runtimefiler og fire tests er ændret;203UI var endnu uændrede ved denne backendkomposition. Backendpakkerne dækker afgrænset valgfri volume-read, passiv START-proof inden for samme8s og test-only klientcancel: én commit med gyldig authority, nul ved tilbagekaldelse, cached duplicate uden replay. Endelig UI-integration og efterfølgende installations-/fysisk accept er særskilte trin hos v2.X.
