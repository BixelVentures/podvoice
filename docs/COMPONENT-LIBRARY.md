# PodView · det eneste komponentbibliotek

## Gældende tværgående detaljeregler · 21. oktober 2026

Senere direkte brugerbeslutninger i denne runde har forrang over ældre daterede skitser nedenfor. De gælder de eksisterende 12 primitiver, produktets faktiske ejere og bibliotekets samme fabriksfunktioner:

- **Navigation:** Enhver detalje går tilbage til Lige nu, derefter Ro. Ankomst via tale, svarhistorik, widget eller direkte link ændrer ikke hierarkiet. Titel og pil deler tilbagehandling.
- **Komposition:** Område-/objektkontekst før indhold; relateret betjening i samme gruppe; primære hyppige handlinger før sekundære indstillinger. Samlinger følger ét venstrestillet grid. En ekstra omsluttende flade skal have en selvstændig funktion.
- **Handling:** Kortnavigation får ikke en dubleret CTA. Relevante kommandoer har en reserveret handlingszone og må ikke trænge ind i ikon/titel/status. Tilladelse genvurderes ved klik med faktisk ejer, opgave og revision.
- **Feedback:** Normal pending på musikvalg vises på valgt kort/play, uden ekstra synlig venteprosa. Kortets tekst har fuld bredde; play ligger i sin bundzone. Fejl skal forklare et konkret problem og en faktisk mulig recovery. Status er ikke fysisk effektbevis.
- **Tilstande:** Kendt indhold og anatomi bevares ved opdatering; ukendt første load, tomt, fejl og manglende artwork er forskellige tilstande. Ingen store tomme tekstpaneler, opdigtede målinger eller falske kontroller.
- **Farver:** Samme semantiske foreground/background-par og ikonbehandling gælder i alle tilstande. Mørke flader kræver en faktisk lys foreground; opacity og farvet baggrund må ikke lade ældre neutrale regler gøre tekst ulæselig. Deklarerede tokens og kildegate er ikke i sig selv renderbevis.
- **Tryk/fokus:** Alle knapper har den samme umiddelbare, endelige trykfeedback uden layoutskalering. Pointerfokus og tastaturfokus er forskellige; tydeligt tastaturfokus bevares. Ingen utilsigtet tekstmarkering på kontroller. Deaktiverede kontroller foregiver ikke respons.
- **Svar i viewport:** Korte svar afsluttes inklusive primær handling i den faktiske content-viewport. Længere svar bruger naturlige afsnit og tydelig fortsættelse; ingen lidt afklippet CTA, tekstskalering, fast klipning eller kunstig tom fyldhøjde for at simulere langt indhold.
- **Lys:** Områdevalget er synligt, og samme scope styrer status, scener og lamper. Kun understøttede dimmere; en kontakt får ingen opdigtet slider. Offline tillader læsbar navigation i kendt indhold, men ingen kommando. No-op opdatering bevarer revision og aktiv drag; ændret binding afbryder.
- **Domænegrænse:** Lys, Tesla og Robot sammensætter disse regler med faktiske capabilities. En ny server-/enhedsmulighed er ikke automatisk en knap. Manglende seats/trunk/live-scene-udbud må ikke blive aktive fantomkontroller.

## Tre overbliksstørrelser · direkte brugerbeslutning F77/F78 · 21. oktober 2026

L er vejrets kendte data. M er Robot og Find musik; deres faste ydre mål bevares, og den eksisterende sekundære tekstrække må vise ekstra **faktuelle oplysninger**, når kilden faktisk har dem. Musik viser sangens kendte kunstner under status/titel; Robot kan vise aktuelt rum, aktuelt observeret procent færdig og kendt batteri. Manglende oplysninger fyldes ikke med nuller, opdigtet fremdrift, ventetekst eller flere handlinger. Forældet afspilning beholder sin mærkning; rummets og rengøringsprocentens telemetri skal være aktuel. En M uden metadata beholder samme geometri.

S er Lys, Tesla, Radio og den inaktive Timer. Hele kortet åbner den eksisterende detalje. **Ingen ekstra indre knapper i S**, heller ikke Tænd/Sluk i Lys. Dette er den senere direkte brugerbeslutning og overstyrer den tidligere generelle regel om lyskommando i overblikket. Den aktive brede Timer beholder sin egen eksisterende timerhandling; M Robot beholder kun aktuel ejerudbudt Pause/Fortsæt. Ekstra information giver aldrig ekstra kommandomyndighed. Samme størrelser, dataregler og renderere gælder produkt og bibliotek.

Den eksplicitte størrelsesopskrift er `data-kit-size="s|m|l"` på den eksisterende ydre kortejer inde i `#now-view`: direkte vejr-/musik-/radio-/Tesla-kort, Robot/Lys' `.resource-card` (eller den eksisterende `.resource-preview`, når den står alene) og den **inaktive** `#timer-card`. Ingen ny komponent, kopi eller størrelsesrenderer oprettes. Uden attributten beholder produktet sit normale grid.

| Størrelse | Fælles ydre mål | Indhold |
|---|---|---|
| S | 199 × 177 px | Titel, status og hele kortets eksisterende navigation. Ingen indre kommando eller ekstra metadata/vejrudsigt. |
| M | 414 × 177 px | Samme anatomi, valgfri kendt metadata. Vejr kan vise sin kompakte, faktisk eksisterende time-/temperaturudsigt. |
| L | 414 × 370 px | Mere plads til eksisterende kendte fakta; vejrets højst/lavest og ikonudsigt bevares. Ingen opdigtet fyld. |

Målene ejer ét sæt tokens i `dist/ui-kit.css`: `--pv-card-s-width`, `--pv-card-m-width`, `--pv-card-l-width`, `--pv-card-row-height` og `--pv-card-l-height`. M er to S-kolonner med det fælles 16 px mellemrum; L er to 177 px rækker med samme mellemrum. Titel kan ombrydes i sin reserverede rolle, mens status og kortets ydre mål bevares.

En allerede synlig Robot-kommando afvises også ved klik, hvis samme kortejer siden er blevet S; `resourceOverviewAction` modtager den aktuelle størrelse både ved render og klik. CSS-skjulning alene giver ingen tilladelse. Den aktive brede Timer er fortsat sin godkendte særskilte komposition og ignorerer kompakte S/M/L-mål. Bibliotekets tre Timer-størrelser bruger den faktiske inaktive Timer-ejer og mærker undtagelsen for den aktive brede Timer; den må ikke klemmes ind i en ny kompakt alarmkomposition.



## Kittet ejer handlingernes synlighed · direkte brugerbeslutning 21. oktober 2026

En overblikswidget får ikke en ekstra knap, blot fordi den kan åbne en detalje. Hele kortet ejer allerede navigation. En separat knap kræver en konkret, relevant og aktuelt tilladt **kommando**. Denne regel gælder alle tilstande og lokale/live-forbrugere; den må ikke genopfindes af hver renderer eller implementeres som en CSS-skjulning af en ellers aktiv handling.

Den fælles politik er `resourceOverviewAction` i `dist/ui/resource-tile.js`. `WidgetHost.renderOverviewAction` anvender den både ved render og igen ved klik med det aktuelle device, session-ID, task-ID og revision. Domæneejeren leverer sine tilladte actions; en label, tilstand eller et synligt kort giver aldrig yderligere rettigheder.

| Ressource / tilstand | Ekstra overbliksknap | Kortets egen navigation |
|---|---|---|
| Robot ved basen, stoppet, færdig eller inaktiv | Ingen. **Vælg rum** gentager kortets navigation og er fjernet. | Åbner samme robotdetalje, hvor rum og rengøring vælges. |
| Robot gør rent | **Pause**, kun når den aktuelle ejer har tilbudt præcis `pause`. | Åbner samme detalje. |
| Robot på pause | **Fortsæt**, kun når den aktuelle ejer har tilbudt præcis `resume`. | Åbner samme detalje. |
| Robot på vej til basen, fejl, ukendt eller ikke forbundet | Ingen opdigtet Start/Pause/Fortsæt eller ekstra navigationsknap. | Bevarer adgang til kendt indhold eller ærlig tom detalje. |
| Lys tændt/slukket/blandet | Ingen indre kommando i S efter F78; faktisk Tænd/Sluk hører til detaljen. | Hele S-kortet åbner samme lysdetalje. |
| Lys ukendt, fejl eller ikke forbundet | Ingen kommandoknap. | Ærlig tom/sidst kendt detalje kan stadig åbnes. |
| En relevant handling afventer svar | Samme allerede tilladte knap bevares deaktiveret; ingen ekstra kommando kan sendes. | Bevarer kortets tilstands- og feedbackroller. |
| Offline, forældet observation, præsentationsplaceholder eller manglende kontroltilladelse | Ingen ny aktiv overblikskommando. Den aktuelle live-adapter uden forberedt effekttilladelse forbliver lukket. | Navigation er uafhængig af kommandomyndighed. |
| Timer | Den eksisterende `TimerView` ejer sin konkrete Annuller/Stop/Færdig-handling. Denne politik opfinder ikke en generisk timerknap. | Åbner samme timerdetalje; én timer ad gangen fastholdes. |
| Vejr, Find musik, Radio og Tesla i overblikket | Ingen ekstra CTA, der blot gentager åbning af kortet. Domænebetjening forbliver i sin eksisterende ejer. | Hele det eksisterende kort åbner den relevante komposition. |

Status, batteri og faktisk pending-/fejlfeedback har faste roller i samme kort. En kvittering fra en lokal fixture er ikke fysisk success. Klik genvurderer politikken; en knap fra en tidligere tilladt tilstand må ikke udføre handlingen efter tilstand, forbindelse, opgave eller revision har ændret sig. Ingen ny komponentfamilie er oprettet. Kilderegel og fokuserede tests er implementeret; aktuel browser- og publiceringskvittering rapporteres særskilt.


## Aktuel fælles implementation · v34-kandidat · 20. oktober 2026

Brugerens v33-audit fører til en konkret fælles DOM-implementation i `dist/ui/kit.js`. De offentlige **12 komponenter** er den præcise `KIT_COMPONENTS`-liste: Card, Hero, Tile, Chip/Segmented, Button, Slider, Toggle, ListRow, SectionHeader, TopBar/DetailHeader, Dialog/Toast og Icon. Dialog/Toast og Chip/Segmented er hver én registreret primitiv med varianter. Domænewidgets, svarformater, tilstandsprøver og registerets modulantal er ikke ekstra primitive komponenter. Den gamle domæneopdeling må ikke bruges som et konkurrerende komponenttal.

`createKitComponent(type, options)` opretter en native node med den fælles præsentationsopskrift. `applyKitComponent(node, type, options)` anvender den samme opskrift på den eksisterende ejers node; børn, fokus, listeners, stabile ID'er og domænetilstand bevares. `createKitTemplate(kind, options)` og `applyKitTemplate(node, kind)` deler de to skabelonrammer `detail` og `response`. Helpers ejer hverken integrationer, serverbinding, tilladte handlinger eller effektkvitteringer. Uændrede præsentationsopdateringer må ikke skrive classes, attributter eller disabled-værdier igen. Identiteter er neutral/vejr/robot/lys/Tesla, ikke vilkårlige modelgenererede farver.

Produktets eksisterende ejere importerer denne fælles kode: `WidgetHost`, `TimerView`, `PlayerView`, `RobotControlPanel`, `RadioView`, `VehicleView`, `AnswerWidget` og de fælles library-/visual-renderere. Det præcise import-/ejerskab står fortsat i `component-library-registry.json`. Domæneejeren sammensætter primitivernes anatomi, leverer faktiske data og bevarer sine hidtidige tilladelser. CSS-reglerne og de bundne tokens ligger i `dist/ui/components.css` og `dist/ui-kit.css`; biblioteket indlæser de samme kilder.

`dist/library.html` er nu den aktuelle dokumentationsindgang:

- **Tokens:** neutrale flader/tekst, hver af de fire domæneidentiteters tint/strong/ink, typografi, afstand, form/touch, fælles skygge og bevægelse. Værdierne aflæses fra den indlæste CSS.
- **12 komponenter:** selvstændige native DOM-eksemplarer oprettet gennem samme `kit.js`-import som produktet. Hvert opslag viser anatomi, mål og relevante default/selected/disabled/loading-varianter; loading bevarer den viste anatomi og indhold. Button har primær/ikon/destruktiv variant, Slider har vandret/lodret og Icon har 24/32/48. Card/Hero/Tile viser de fire domæneidentiteter.
- **2 templates:** selvstændige detalje- og svarrammer fra den delte template-helper, sammensat af de samme primitiver.
- **Skærme og forløb:** navngivne opskrifter angiver de brugte primitiver og åbner den fulde faktiske `index.html`-komposition. Domæne-/tilstandsgrupper tælles særskilt. Komponentopslag er ikke beskårne skærmbilleder eller iframes af et uvedkommende domæne.

Den seneste direkte timerbeslutning har forrang: **En aktiv eller pauset timer skal annulleres eller afsluttes, før en ny kan oprettes eller varigheden ændres. Ingen Erstat/Behold, presets eller +1/+5 under den aktive timer.** Ældre Grok-tekst og historiske releaseforløb nedenfor ophæver ikke dette.

Dette afsnit beskriver v34-kandidatens kilde-/ejerskabskontrakt. Aktuel render-, klik-, motion- og tilstandskontrol samles i `docs/UI-DELIVERY-GOAL.md`; kode eller komponentgate er ikke visuel accept, performancebevis, publicering eller fysisk accept. Ældre beskrivelser og målinger nedenfor bevares som dateret baggrund.


Gældende beslutninger: 16.–17. oktober 2026. Brugeren har bedt om at låse de eksisterende godkendte elementer som det eneste bibliotek, PodView og agenter må bruge. A · anbefalet fælles ramme er valgt for overblikket. Denne kontrakt gælder produktets faktiske skærm, både localhost og live. Den godkender ikke automatisk alt, der tidligere er blevet skrevet eller lagt i workshoppen.

Den maskinlæsbare ejer- og variantliste er [component-library-registry.json](component-library-registry.json). En registreret renderer ejer sin anatomi. En adapter leverer data, tilstand og faktisk tilladte handlinger til den renderer. Den må ikke lave en særskilt live-udgave af samme kort, player, historik eller svar.

Den direkte beslutningsoversigt er [USER-DECISIONS-2026-10-16.md](USER-DECISIONS-2026-10-16.md). Headerens højre gruppering, visuel historik med samme `pv-answer`, ti lokale QA-formater og fælles robottimeline er konkrete kompositioner af de eksisterende identiteter. Brugeren valgte visuel retning **1 · Visuel forklaring** til opgradering af alle ti formater; ældre afvist styling bliver ikke godkendt eller låst af dette register. Den visuelle opgradering og browseraccept er stadig særskilte leverancer.

## Brug det, der allerede findes

| Behov | Den eneste produkt-renderer | Godkendt anatomi og variant |
|---|---|---|
| Skærm og navigation | `dist/index.html`, `WidgetHost` i `dist/widget-view.js` | Eksisterende billedramme, overblik, svar-/detaljeflade og player. Headerhistorik genbruger `#open-history`, `#history`, `#retained` og `pv-answer`. |
| Musikforslag | `MusicResults` i `dist/music-results.js` | Den samme `button.result` med billede, tekst, feedback og play. Fire faner: Stemning, Humør, Topsange, Senest. Live og lokale data bruger den samme instans. |
| Afspiller og kø | `PlayerView` og `renderPlayerControls` i `dist/player-view.js`, eksisterende markup i `dist/index.html` | Player, detalje, transport, lydstyrke, rumvalg og `queue-track` med rækkefølge/billede/tekst/play. En anden live-player er ikke en variant. |
| Vejr | `renderWeather` i `dist/weather-view.js` | Overskrift, aktuelt vejr, eksisterende time-/dagsrækker, ét råd og kilde. `localWeatherModel` og `liveWeatherModel` leverer samme model. Nye datafelter bliver i de eksisterende rækker. |
| Timer | `TimerView` i `dist/timer-view.js` | Eksisterende urskive, tid/tekst, handlinger, formular og tidligere tider. Overblik og detaljer er samme familie med forskellig tæthed. Skjul er ikke annullér. |
| Kompakt widget/åbn detalje | `createResourceTile`/`updateResourceTile` i `dist/ui/resource-tile.js` og eksisterende `.home-shortcuts` | Fælles visuel plads, titel/undertitel og chevron. A-rammen samler vejr, musik og ressourcekort; domænefarve og genkendeligt instrument bevares. Den kompakte højde er ikke en regel for detaljer. |
| Robot og lys | `pv-vacuum-widget`/`pv-light-widget` i `dist/ui/library/components.js`, `WidgetHost.renderDevices` | Eksisterende instrument, status/metadata og handlingsrække. Flere Roborock-felter grupperes i eksisterende detalje-/disclosure-anatomi; de opfinder ikke et nyt kort eller flere beføjelser. |
| Svar | `pv-answer` i `dist/answer-widget.js` | Den eksisterende overskrift, scrollflade, svarhandlinger og kildeområde. Lokale eksempler og ejede live-svar bruger samme renderer. |
| Fire visuelle svar | `VisualComponent` i `dist/ui/library/visual-components.js` + `validateVisualContent` i `dist/visual-content.js` | `pv-fact-card`, `pv-sourced-image`, `pv-answer-timeline`, `pv-simple-diagram`. Samme visuelle brødtekst, liste/figur og kildedisclosure. Model-HTML, model-CSS og modelhandlinger er ikke indhold. |
| Valg, tabel, trin, tjekliste og kilder i svar | De individuelt registrerede roller i `LibraryComponent` | Eksisterende keyed lister, native knapper, tabel og trin. Bevar stabile option-ID'er og fokus. Brug kun roller markeret `approved-existing-role` i registeret. |
| Hændelseshistorik | `pv-activity-timeline` i `dist/ui/library/components.js`, eksisterende `#device-timeline` | Keyed `ol/li`, tidspunkt + hændelse. Observerede hændelser og anmodninger samles under én overskrift, **Seneste hændelser**, med tydelige hændelseslabels og faktisk kildetid. En anmodning accepteret af HA er ikke bevis for færdig rengøring. |
| Meningsfuld besked | Eksisterende `#timer-alert` og `#playback-status`/`showFeedback` | Faktisk færdigmelding, resultat, fejl eller ukendt udfald. Timerens eksisterende notice-ejer er en fuldskærms native dialog: navn 40, tid 64, Stop 96 × 96, indgang 240 ms og en ringpuls begrænset til 60 sekunder. Stop bruger timerens konkrete ID og eksisterende rettigheder; Luk visning/Escape kvitterer kun visuelt. Ingen generel ventetekst som toast. |
| Samtalestatus | `VoiceSurface` i `dist/voice-surface.js` | Den eksisterende markør og tekst for faktisk lytning/tænkning/svar/klar. PodVoice ejer talen. Tilstandsbevægelse stopper ved exit, reduceret bevægelse og disconnect. |

Eksempel: live-musik leverer kort til `host.musicResults.render(...)`; den bygger ikke `article.live-result`. Live-afspilning leverer modeller til `host.playerView.renderPlayer(...)`, `renderControls(...)` og `renderQueue(...)`. Live-vejr kalder `renderWeather(view, liveWeatherModel(...))`. En ny undertitel eller et mærket vindfelt i en eksisterende time-række er en rettelse inde i samme komponent.

## Tilstande er også en del af biblioteket

Den fælles tilstandskontrakt nedenfor gælder alle ejede komponenter, både lokalt og live. Voice og touch bruger de samme stabile option-ID'er; session, task og revision bindes af serveren. Viewer-identitet giver aldrig ejerskab.

`visual-history` og headerens eksplicitte QA-stages er lokale prøvedata og må ikke fylde almindelig/live-historik. Ti lokale QA-formater er data til eksisterende renderere, ikke ti nye komponenter eller bevis for ti liveproducenter.

Historiske, tidligere kildeadmitterede svar bruger samme `pv-answer` og preview-anatomi med original dato og en eksplicit intern historisk tilstand. Tilstanden giver ingen kilde-, retry- eller betjeningsadgang og indlæser ikke udløbne fjernbilleder. Hydrering bevarer uændrede kort; autoritativ fjernelse påvirker kun de pågældende svar. Den afgrænsede reload-/rum-/bootkontrakt står i PODVIEW-CONTRACT.md. Kandidatkode er ikke installeret Green-accept.

## Workshop og historisk præsentationsgæld

`dist/patterns.html`, `dist/components.html`, `dist/scenes.html`, `dist/legacy.html` og deres historiske moduler er reference. `dist/library.html` er fra v34 den aktuelle dokumentation af de delte primitiver og produktkompositioner som beskrevet øverst. De er ikke alternative godkendte produktindgange. Det samme gælder katalogets ubrugte roller: eksempelvis workshop-versionerne `pv-music-results`, `pv-now-playing`, `pv-transport-controls`, `pv-queue-view`, `pv-timer-widget` og `pv-activity-card`. Produktet har allerede ejede renderere for disse behov. At en rolle findes i kataloget eller registreres af det fælles modul giver ikke tilladelse til at tage den i brug.

De oprindelige præsentationsafvigelser D01–D07 bevares her som historik. De er nu kilde-/kontraktmæssigt løst inden for eksisterende familier; de er ikke aktive undtagelser eller en godkendelse af nye familier. **Aktiv oprindelig præsentationsgæld: 0.** Det betyder ikke nul resterende produkt- eller acceptopgaver.

| Historisk ID | Løst præsentationsafvigelse og gældende ejerskab |
|---|---|
| D01 | `dist/live-home-view.js`: observerede hændelser og anmodninger går til én `pv-activity-timeline`; care-data bruger eksisterende semantisk disclosure, og genbrug bruger fælles knapper. Ingen ekstra historik-/robotkortfamilie. Domænedataprojektion er adapterarbejde. |
| D02 | `dist/live-control-view.js`: native tilladte formularer bruger fælles `dialog.pv-component`, content/actions/button-opskrifter og canonical CSS. Robotvisning delegeres fortsat til dens ejer. Ingen selvstændig formularstil. |
| D03 | `dist/live-answer-view.js`: ejer-kilder bruger samme native dialog/header/content/meta-opskrift. Faktiske kilder, expiry og eventbinding bevares; ingen ny svarfamilie. |
| D04 | `dist/live-media-view.js`: `pv-choice-list` ejer kontovalg, og `PlayerView` ejer player, transport og kø. Adapteren ejer ikke en alternativ player eller valgliste. |
| D05 | `dist/live-music-selection-view.js`: eksplicit søgning bruger samme native dialog/form/button-opskrifter; `MusicResults` ejer resultater. Seneste direkte beslutning18okt: ét Play bruger præcis serverbundet rum uden målvalg eller ekstra bekræftelse. Opaque option-ID'er og serverens ejerskabs-/udløbskontrol bevares. Feedback vises kun i den eksisterende højre `PlayerView`; accepteret anmodning er ikke observeret afspilning. |
| D06 | `dist/robot-control-panel.js`: den tidligere særskilte shadow-formular er fjernet. `pv-vacuum-widget` ejer observation; native navngivne forms/fieldset/input/select bruger fælles light-DOM-styling og eksisterende tilladte optioner. Ingen shadow CSS eller duplikeret robotinstrument. |
| D07 | Generisk venteprosa er fjernet fra de gennemgåede synlige forløb. Egne tomme/bevarede widgetnoder og `aria-busy` bruges; faktiske voice-faser samt resultat/fejl/ukendt udfald beholder deres særskilte rolle. Interne pending-sentinels, der beskytter authority, er ikke synlig UI-prosa. Historisk variantpost bevares som `resolved-original-presentation-debt`. |

[Lukningsreview af D01/D06/D07](../integration/astra-design-review-20261017/debt-remaining-review/receipt.md) dokumenterer kausale tests og præcis metadataændring uden ny runtimeændring, bredere roots/imports eller ændret gate-logik. [D02/D03/D05-migration](../integration/astra-design-review-20261017/debt-native-dialogs/receipt.md) og [fælles CSS/browserkvittering](../integration/astra-design-review-20261017/debt-native-dialogs/css-receipt.md) dokumenterer native kontrolmål, lukkede dialoger og fjernede forældede stilregler. Gate: 54 aktive moduler, 0 aktive unapproved-adapter-noter; negative mutationstests er bevaret. Dette er kilde-/lokaltestbevis, ikke fuld live-state-, Green-, bruger- eller fysisk accept.

Historisk `UI-KIT-SPEC` er ikke canonical. Dette bibliotek og det præcise register er fortsat de eneste gældende ejerskilder. Forældede scrollreferencer og et ubrugt hvidt bilasset er ryddet/arkiveret efter consumer-kontrol; det opretter ingen ny familie. Ny gæld må ikke skjules ved at udvide registeret eller kopiere en implementation ind som godkendt. Nye produktbehov uden eksisterende rolle kræver fortsat konkret specifikation og brugerens godkendelse.

## Kontrol og ændringer

Kør `node scripts/check-component-library.mjs` fra projektroden og `node --test tests/component-library.test.js`. Ved adoption skal `npm test` køre komponentkontrollen før de eksisterende tests. Det bliver foreslået i integrationens særskilte bindingssnippet; root-filerne er ikke ændret af den isolerede levering.

Kontrollen følger de faktiske aktive importkanter fra `dist/index.html`, kræver den samme produktindgang, registrerer nye produktmoduler/HTML/CSS, afviser DOM-bygning i datamoduler, nye custom-elementer og katalogfamilier, kopierede/navngivne renderere, nye navngivne beholderrødder og tab af de fælles renderer-ruter. De eksisterende musik-/kø-rækkers kerneanatomi er også bundet. De kausale negative tests ændrer den faktiske kilde i en midlertidig kopi; de sammenligner ikke bare to ens lister.

Native HTML er byggesten inde i en komponent. En ekstra `span`, label, tilgængelighedstekst, korrektion af data eller eksisterende tilstandsvariant er ikke i sig selv en ny komponent. Registeret låser ikke hele renderfilers bytes, alle tags eller al copy. Nye navngivne renderere og ændringer af import/ejer/anatomi kræver derimod konkret review. En ren data-/motion-helper kan registreres som support uden at få tilladelse til at bygge DOM.

En ny komponent kræver før brug: konkret behov, hvorfor eksisterende rolle ikke dækker det, én navngiven ejer og fælles live/lokal renderer, anatomi/varianter/tilstande, handlingers ejerskab samt en visuel eksempelvisning. Brugeren godkender denne specifikation. Derefter tilføjes den præcise beslutning, scope og ejerskab til registeret og kontrollerne. En agent må ikke selv erklære en ny komponent godkendt, svække kontrollen eller omdøbe en kopi til “adapter”.

Kontrollen er en strukturel review-port, ikke en sikkerhedsparser eller et bevis for visuel kvalitet. Den kan ikke afgøre hensigten med vilkårlig kode inde i en eksisterende metode eller bevise, at en tekst i et approval-felt kom fra et menneske. Almindelig kilde-/visuel review og den faktiske menneskelige beslutning er fortsat nødvendige. PASS er kildeoverensstemmelse, ikke browser-, live- eller fysisk accept.


## Samlet UI-kit · direkte beslutning 17. oktober 2026

**Dette komponentbibliotek er UI-kittet og den eneste visuelle source of truth.** Research, audits og isolerede kandidater er arbejdsbeviser, ikke alternative biblioteker. Et adapterlag må levere data og tilladte handlinger; det må ikke definere sin egen player, widget, formularstil, tilstand, animation eller komposition. Samme renderer ejer både lokal og faktisk visning. AI-output vælger kun registrerede formater og deres data; ingen modelgenereret HTML/CSS eller improviserede elementer.

Brugerens seneste beskeder tillader at rette, justere og løfte de eksisterende komponenter. Det omfatter farver, ikoner, typografi, layout, komposition, skygger, billeder, states, motion, flow og tilgængelighed. Det giver ikke automatisk tilladelse til en ny komponentfamilie. Agenter skal løse almindelige rettelser i den eksisterende ejer og bruge ændringen overalt; ingen parallel lokal/live-variant eller separat UI-kit. De historiske D01–D06-afvigelser er migreret til eksisterende kompositioner; adaptere må ikke genindføre de særskilte visuelle familier.

### Fælles mål og optisk rytme

- Fælles kit-værdier ejes af `dist/ui-kit.css`; `dist/ui/components.css` bevarer de registrerede komponentstyles og kompatibilitetsaliaser. Overbliksfamilien bruger `--pv-overview-*` for slot, højde, padding, indre/ydre afstand, typografi og domænefarver. Skærmkomposition og komponentstyles forbruger disse tokens; de er ikke selvstændige designkilder.
- Landskab:64px motivslot, fælles tekststart, samme chevron-inset og radius. Ved kompakt600px højde bruges104px kort,20px padding og16px ens rækkeafstand; større landskab116px kort,24px padding og24px rækkeafstand. Optisk motivstørrelse vurderes ud fra tegningen; robotasset med intern luft må kræve en anden billedbredde end en fyldt node.
- Titler og metadata har én fælles skala. Timer beholder sin mørke instrumentidentitet, men følger de samme plads-, vægt- og tekstregler som øvrige oversigtswidgets. Hvid cirkel under robot/lys er fjernet. Timerens store udfyldte mørke flade er ikke en grund til at gøre dens ikon eller tekst mindre.
- Overblikket bruger ét fælles gitter i DOM-rækkefølge: vejr/musik, robot/lys, derefter timer/radio og Tesla. En inaktiv timer fylder én almindelig celle; en faktisk aktiv eller færdig timer må fylde begge kolonner til den eksisterende urskive, status og handling. Kortets fælles højde er et minimum, så ombrudt tekst kan vokse uden at blive klippet; celler i samme række følger hinanden. En manglende makker opfinder ikke indhold eller en større Tesla-widget. Smalle skærme bruger én kolonne.
- Musikforslag og de fire faner er én indholdsbestemt gruppe: fanerne følger kortene med den fælles afstand, også på høje skærme. Kortene beholder deres valgte geometri; kun kortområdet scroller, når den faktiske skærmhøjde kræver det. Tomt indhold reserverer ikke en usynlig kort-høj flade.
- Musikbilleder gengives uden et dækkende lys-/mørkelag og uden hover-zoom. Læselighed støttes kun lokalt ved den eksisterende tekst; endeligt tryk-/afventningsfeedback tilhører Play eller Andre forslag, ikke billedets farver eller lysstyrke.
- Musikbilledets eksisterende kvadrat reserveres fra første render. Første ukendte/manglende billede er en stille `--pv-surface-2`-flade uden ikon, spinner, shimmer eller ventetekst. Samme valgs sidst accepterede billede bevares under opdatering, ved fejl og ved manglende erstatning; et andet valg låner aldrig det gamle billede. Allerede dekodede, aktuelt tilladte præcise URL’er genbruges straks fra den eksisterende billedhjælpers begrænsede cache inden for samme konto/boot/rum/valg/billedgeneration. Et nyt dekodet billede vises straks med højst 120 ms fade; reduceret bevægelse bruger ingen animation. Ejerskifte, annullering og sene svar er fortsat afgrænset af konto/boot/rum/valg. Ingen ny billedpipeline eller ekstra billedcontainer.
- Vejrfoto er kun tilladt i overblikkets vejrwidget som et lille, blødt afgrænset højreområde ved kendt passende vejr/dagtid. Vejrdetaljen bruger ikke foto. Ingen hård rektangulær billedstribe eller større hero. Data, råværdier og faktisk kilde ændres ikke af farve/billede.

### Sammenhængende tilstandsserie og handlinger

**Samme renderer ejer alle tilstande.** Der findes ingen ad hoc-undtagelse for loading, fejl, tomt indhold, demo, live, overlay eller historik. Dataadapteren vælger model og faktisk adgang; den ejer ikke DOM, styling eller animation. En mangel rettes i den eksisterende ejer og gælder alle kaldesteder. De løste historiske D01–D07-afvigelser giver ingen undtagelse eller genvej til en ekstra variant.

| Tilstand | Fælles kontrakt |
|---|---|
| Tom / første læsning | Ægte tom anatomi med reserveret plads. Ingen opdigtede værdier, billeder, cover, volumen eller option-ID'er. Tom player bevarer rummets overskrift og de faste pladser til status, billedområde og musikhandling; det tomme billedområde viser kun det eksisterende musiksymbol. Ro bruger samme kompakte variant. |
| Udfyldt | Domæneinstrument, hierarki og handlinger følger samme anatomi. Opdatering flytter ikke knapper eller tekst til andre positioner. |
| Igangværende / opdatering | Bevar nyttigt indhold og samme noder; brug `aria-busy` og endelig tilstandsbevægelse. Ingen generiske “Henter…”, “Starter…” eller tidsstyret venteprosa. Et nyt resultat erstatter først gammelt, når det er brugbart. |
| Gammel / offline | Bevar senest kendte data, kvalificér aktualiteten hvor nødvendig, og vis kun faktisk mulige handlinger. Forbindelse genbekræftes før klar-status. Ingen opdigtet genoprettelse. |
| Afvist / fejl | Bevar opgave og brugerens valg. Forklar den konkrete fejl og tilbyd en faktisk mulig genopretning. Ingen automatisk gentagelse med ukendte sideeffekter. |
| Accepteret / ukendt udfald / færdig | Adskil anmodning accepteret, observeret effekt og fysisk bekræftelse. Ukendt udfald forbliver ukendt; en timer eller afspilning får ikke dobbelt færdigmelding. |
| Bevægelse / fokus | Endelig, afbrydelig bevægelse med reduced-motion-variant. Ingen dekorativ evighedsaktivitet. Ryd timere/listeners ved disconnect; bevar fokus og læseposition ved opdatering. Scrollindikator følger faktisk overflow. |
| Tilbage / genåbning | Gendan samme opgave, valgte fane, indhold, output og relevant scrollposition. Skjul er ikke stop. Genåbning genstarter ikke afspilning. Historik bruger samme svaridentitet og renderer. |

Primære handlinger står i den eksisterende handlingsrække. Scope, indstillinger og udførsel har forskellige roller: vælg først område/rum/option, vis det valgte, og udfør derefter den navngivne handling. Sekundære indstillinger og kilder åbnes gennem eksisterende disclosure, aldrig en ny specialformular. Dialoger har samme luk-/tilbageprincip og returnerer fokus til udløseren. Touch og voice afklarer konkurrerende intentioner og bruger samme stabile mål; et sent svar må ikke udføre en forældet handling.

Robottens detalje samler observeret status og den eksisterende åbnehandling i ét kompakt `pv-vacuum-widget`. Ét tilgængeligt knapmål åbner den samme robotdialog; kortet starter aldrig rengøring. Pause/Stop ligger først og uden foldning i dialogen, når den faktiske betjening tilbyder dem. Pleje og observerede indstillinger ligger i dialogens eksisterende disclosure, adskilt fra **Seneste hændelser**. Uden kontroladgang, ved gammel status eller ved fejlet betjeningslæsning kan den samme dialog stadig vise allerede læsbare robotoplysninger; ingen task eller handling opfindes. Fornyelse af en eksisterende betjening bevarer dens deaktiverede kladde, indtil en ny faktisk task overtager. Indstillingsændringer udføres fortsat hver for sig og er ikke en del af et samlet Start-udkast. Et valideret forslag fra seneste valg kan tilbydes i samme områdeform som **Brug forslag**: kun den aktuelle tasks tilladte områder og gentagelser udfyldes efter et særskilt tryk. Ingen auto-Start, overskrivning af en redigeret kladde eller gendannelse af indstillinger. Forkerte, udløbne eller forbrugte taskbindinger viser ikke forslaget.

Historik genbruger `pv-answer` i direkte læsbar tæthed, ikke generel 50%-miniaturisering. Preview er inert og skjult for hjælpeteknologier; faktisk online/offline-status bevares og må ikke forfalskes for at deaktivere preview.

`Svar` åbner den eksisterende historik som et ikke-blokerende venstre opgavepanel. Player og header kan stadig betjenes; historikkens previews og scroll bliver i venstre område. Antal vises kun, når der faktisk findes svar. Panelets lukning gendanner den tidligere opgave og dens læseposition.

### Tesla og radio · nuværende visuelle scope

Brugeren har bestilt Tesla- og radiowidget med detaljevisning **uden ægte knapfunktion**, og derefter frabedt synlige eksempelmarkeringer. Derfor vises rene lokale visuelle data; interne fixtureflag og manglende betjeningsautoritet bevares. På live findes endnu ingen Tesla-/radioejer, så der må ikke opfindes aktuel bildata eller sendes kommandoer. Det er ikke en funktionel integration.

`RadioView` bruger den eksisterende valgkomponent til P3/P1/P4Østjylland/P6Beat/P8Jazz. Et lokalt stationsvalg ændrer kun indhold i den samme `PlayerView`; intet nyt player-layout eller Musik/Radio-fanesæt. `VehicleView` viser brugerens **grå Tesla Model Y 2023** og bruger eksisterende overskrift, instrument/data, native disclosure og `pv-activity-timeline`. Navngivne ejere og konkret anatomi er registreret; ingen generel ret til nye familier følger af disse to.

### Fælles art direction og opgaveforløb

A er én rolig komposition med stabil geografi: hovedopgaven har fokus, vedvarende afspilning ligger til højre, og robot/lys beholder deres rækkefølge. Hierarki kommer fra størrelse, placering og luft før ekstra flader og skygger. Domæneinstrumenter bevarer deres identitet; ens roller deler typografi, afstand, ikonrytme, hjørner og semantiske farver. Foto-Ro er et bevidst roligt sted. Musikcovers og stemningsbilleder skal passe til indholdet og have dokumenteret proveniens; referencernes fotos og illustrationer er ikke produktassets.

Alle flows vurderes gennem **se → find → vælg → udfør → vent → bekræft → genopret → vend tilbage**. Musik bevarer valg og output; robot adskiller områdevalg fra Start; timer kan findes og stoppes fra Ro og Lige nu; vejr adskiller overblik fra kildebelagt detalje; spørgsmål vælger et passende visuelt format, og historik genåbner det samme svar. Voice kan fortsætte den synlige opgave og touch kan overtage uden et parallelt opgave-ID. En flot enkeltskærm lukker ikke flowet.

### Ejerskab for tokens og adfærd

`dist/ui-kit.css` ejer fælles farver (`--pv-ink`, `--pv-muted`, `--pv-accent`, `--pv-selection`, `--pv-danger`), overblik (`--pv-overview-*`), typografi (`--pv-type-*`), afstand (`--pv-space-*`), hjørner (`--pv-radius*`), touch (`--pv-hit-*`, `--pv-focus-ring`) og motion (`--pv-motion*`, `--pv-ease`). De eksisterende renderer-ejere i tabellen ovenfor forbruger dem; lokale literals må ikke etablere konkurrerende skalaer. Et eksisterende token er ikke i sig selv bevis for tilgængelighed eller godkendt styling.

`SceneMotion` i `dist/ui/motion.js` ejer fælles sceneovergange; `dist/ui/touch-intent.js` og `dist/ui/gestures.js` ejer touchfortolkning. `SpeakerOutputView` i `dist/speaker-output-view.js` ejer eksisterende rumdialog. Tilstand, eventbinding og oprydning forbliver hos den relevante registrerede komponent. Et supportmodul får ikke renderer-adgang ved at kalde sig helper.

### Kvalitetskontrakt · 12 dimensioner, 120 konkrete kriterier

Dette er krav til den eksisterende implementation, **ikke 120 beståede tests**. Hver dimension nedenfor har ti kontroller i rækkefølge; Q-numre giver sporbarhed til researcharbejdet. Krav-ID'er henviser til [den samlede 31-punktsstatus](PODVIEW-STATUS-2026-10-17.md) og ændrer ikke dens acceptstatus. En dimension skal kontrolleres i alle relevante tilstande og forløb, ikke blot i et tomt eksempel.

| Dimension / eksisterende ejer | Ti konkrete kriterier | Krav-ID'er |
|---|---|---|
| **1. Komposition Q001–010** · skærm/WidgetHost | Samme A lokalt/live; stabil widgetrækkefølge; header Svar→vejr→ur; Ro holder vigtige ressourcer tilgængelige; Back gendanner kontekst; én hovedopgave dominerer; alle familier har registerejer; højre player står fast under opgaveskift; pairing er findbar uden falsk klar-status; ingen /flow-navigation. | 1–6, 8, 31 |
| **2. Farver Q011–020** · fælles tokens | Normal tekst mindst 4,5:1; stor tekst mindst 3:1; essentielle kontrolkanter/fokus mindst 3:1; status også gennem tekst/form; pause er ikke fejlfarve; samme handlingsrolle har samme accent; Ro-tekst testes på lyse/mørke crops; timerhast kan forstås uden farve; vejrfarver opfinder ikke fare; disabled ligner ikke valgt. | 2, 3, 6, 8, 11, 26–28, 31 |
| **3. Typografi Q021–030** · domænerenderere/type-tokens | Titel/værdi/metadata har faste roller; værdi dominerer enhed; lang musiktitel klipper ikke modalstyring; langt kunstnernavn bevarer identitet og adgang til fuld tekst; danske enheder/afrundinger følger kilden; Start/Pause/Stop/Til base er præcise; fejl forklarer næste handling; ingen for tidlig færdigcopy; 200% tekst mister ingen vigtig handling; lignende rumnavne kan skelnes. | 2, 8, 9, 15, 20, 26–28, 30 |
| **4. Ikoner Q031–040** · eksisterende ikonroller/resource-tile | Play/Pause matcher faktisk status og navn; Stop/Base skelnes; outputikon er ens i alle playersammenhænge; vejrikon følger periode/dag/nat; ikonknapper har tilgængelige navne; ens roller har optisk ens vægt; stemningskunst ligner ikke et falsk cover; robotillustration ligner ikke et opdigtet livekort; ukendte svarsymboler forklares; alle assets har proveniens. | 2, 4, 11, 18, 20, 22, 25, 26, 28, 29 |
| **5. Flader Q041–050** · surface/line/radius-tokens | Peer-widgets deler radius; indre hjørner passer i ydre; modalens dybde bevarer kontrast; skygge angiver lag uden at alle kort konkurrerer; køseparation har ingen dobbeltkant; valgt/hover/fokus skelnes; cover/fallback deler geometri; fokus klippes ikke; peer-flader deler tokens; Ro har ingen utilsigtet søm eller stræk. | 2, 6, 9–12, 18 |
| **6. Geometri Q051–060** · spacing/hit-tokens/touch-intent | Mål lige mellemrum; primære trykflader mindst 48×48px; trykflader overlapper ikke; modal har sikker indre afstand; tre hele kølinjer uden klippet fjerde; kø scroller selvstændigt; vigtig landskabsfunktion kræver ikke sidescroll; drag annullerer tap; rumtekst og valgmarkør bevarer touchareal; hovedopgave/akut timer identificeres på tre sekunder ved 2m. | 2, 3, 9–11, 20, 27 |
| **7. Musikvalg Q061–070** · MusicResults/assetmapping | Fire aftalte faner; Stemning har tre faktiske playlists; Humør har egen playlisttype; Topsange/Senest har tre tracks; tilbage bevarer kort/fane; reload starter Stemning; mål AI-valgenes tid og relevans; stemningskunst matcher og har proveniens; trackcover er faktisk eller ærligt fallback; voice/touch vælger samme option trods forsinkede svar. | 12–18 |
| **8. Player Q071–080** · PlayerView/SpeakerOutputView | Tom Ro har musik-CTA; alle fem playerstates bevarer anatomi; faktiske PodConnect-mål uden Tesla; outputændring er eksplicit; første Play starter én gang; hurtige tryk kan ikke udføre forældet intent; aftalt startvolumen 35% matcher provider; naturlig slutning fortsætter én gang og manuel stop gør ikke; kø matcher afspilning; luk detalje bevarer track/output. | 7–10, 19–24 |
| **9. Feedback Q081–090** · domænestates/beskedroller | Loading bevarer widget; nyt svar bevarer nyttigt gammelt indhold indtil klar; accepteret/startet/bekræftet skelnes; gammel robot/vejrstatus kvalificeres; vejrets kilde/tid er tilgængelig; pending-handling er identificerbar og uden dubletter; svarretry bevarer spørgsmål; online-status genbekræftes; timer har én færdigmelding; hændelser viser udfald og faktisk tid. | 8, 11, 17, 22, 25–28, 30 |
| **10. Motion/input Q091–100** · SceneMotion/VoiceSurface/gestures | Overgang bevarer objektidentitet; reduced motion bevarer feedback; disconnect rydder aktiviteter; ingen uønsket evighedsbevægelse; fokusorden og dialogretur fungerer; fokus skelnes fra valg; voice bevarer option/opgave; touch/voice afklarer konkurrerende intent; trykfeedback er hurtig men success afventer udfald; tokenstyret overgang kan afbrydes uden strandet lag. | 11, 13, 22, 26, 29 |
| **11. Svar/historik Q101–110** · pv-answer/VisualComponent/LibraryComponent | Ti formater bruger ejede renderere; format vælges efter opgaven; grafer har enhed/skala/kilde; tabeller skelner manglende fra negativ; trin har tydelig rækkefølge; diagramtekst overlapper ikke; historik har genkendeligt visuelt preview; genåbning bevarer svaridentitet; loading/fejl bevarer kontekst; follow-up bindes til synlig revision. | 29, 30 |
| **12. Enheder/accept Q111–120** · robot/timer/vejr/lys + kontrolgate | Faktiske områder/gentagelser vises før Start; to faktiske maps har stabile ID'er; robotkommandoer rammer rigtigt og bekræftes; Seneste hændelser skjuler ikke nutid; timerstop rydder alle visninger; vejrrunding/perioder/vind kontrolleres mod kilden; lys holder aftalt scope; lokal/Green/fysisk dokumenteres særskilt; gate bestås uden at rebaseline ny familie; sammenligningsscore bruger samme opgave og forhold. | 1, 4, 17, 24–31 |

Visuelle kriterier kræver aktuelle renderede billeder og relevante målinger. Tilstande og navigation kræver faktiske handlingssekvenser. Målbinding, aktualitet og udfald kræver providerbevis. Hørbar afspilning, fysisk robotrespons og afstandslæsbarhed kræver fysisk prøve. Kildekontrol alene opfylder ingen af de sidste tre kategorier.

### Referenceappendiks · hvad vi faktisk har set

[Det fulde kildegrundlag](../integration/astra-design-review-20261017/references/references.md) dækker **24 forskellige firmaer**: Apple, Google, Sonos, Spotify, Bang & Olufsen, Signify/Hue, IKEA, ecobee, Tesla, Rivian, Roborock, Dyson, Withings, Garmin, Oura, Linear, Notion, Figma, Stripe, Airbnb, Nintendo, Microsoft, Samsung og OpenAI. Der er 23 vellykkede direkte officielle sideåbninger; Linear har officiel søgeudtrækning og fejlede direkte åbninger. Dette er relevante produktkilder, ikke en dokumenteret rangliste over verdens bedste design.

[Otte visuelle inspektioner](../integration/astra-design-review-20261017/references/visual-reference-inspection.md) er faktisk set og udsendt som Chrome-billeder: Hue (scenegitter kontra justering), Apple (stor instrumenthierarki og luft), Tesla (fast kontrolgeografi), Roborock (scope, valg og udførsel), ecobee (primær værdi kontra sekundært mål), Figma (gruppering og diskret overlaydybde), Oura (overblik kontra aktuelt fokus) og Dyson (gentagen ikon/label-rytme). Det er officielle guide-/promobilleder eller produktrenders, **ikke betjente apps eller målte sammenligningstests**. Oura-artiklen er historisk. Mobbin krævede betalt adgang; Linear 404, Rivian-redirect og Notion-visning uden kvalificerende UI-billede tæller ikke med i de otte.

Øvrige kilder begrunder dokumenterede mønstre: Google kontinuitet; Sonos/Spotify kø og output; B&O meningsfulde valg; IKEA/Samsung mål og rum; Rivian vedvarende ressourcer; Withings/Garmin læselige målinger; Notion/Linear genkendeligt preview; Stripe adskilte udfald; Microsoft ærlig fremdrift; Airbnb valgkontekst; Nintendo entydige kontroller; OpenAI struktureret forklaring. Den præcise observation, dato, URL og begrænsning står ved hver kilde. Ingen kilde autoriserer kopiering af assets, nye PodView-funktioner eller automatisk kvalitetsgodkendelse.

Researchfiler, herunder den oprindelige 120-punktsproposal, er sporbar baggrund. **Denne fil er den gældende samlede kvalitetskontrakt**; research er ikke et parallelt UI-kit eller en selvstændig implementation.

### Måling, score og åbne beviskrav

97/100 er ambition, ikke et konstateret resultat. Den senest rapporterede A-audit før rettelser er **81/100 og 24/40**; disse to auditmål konverteres ikke til hinanden eller til nedenstående rubric. Ingen automatisk efter-score udledes af kodeændringer, referencetal eller 120 kriterier. De 31 krav beholder deres individuelle status i statusdokumentet; dette bibliotek lukker dem ikke.

Den fælles 100-point benchmark vægter opgavesucces/effektivitet 20, blik/læsbarhed/visuelt hierarki 15, touch/tilgængelighed 15, kontinuitet/stabil geografi 15, ærlig tilstand/genopretning 15, svarforståelse/proveniens 10, respons/motion 5 og systemkonsistens/finish 5. [Benchmarkmatricen](../integration/astra-design-review-20261017/references/benchmarkmatrix.md) beskriver samme-opgave-prøver og accept pr. rejse. Hver score skal have dato, build, viewport, dataforhold, testsekvens og observation; manglende evidens er et åbent hul, ikke gratis point. En kategori får vægt × beståede relevante kontroller / alle relevante kontroller; ukendte får nul point og rapporteres samtidig som umålte. Rapportér både score og dækning.

Hårde gates går før totalscore: samme canonical renderer lokalt/live; ingen opfundet authority/data/success; ingen farlig eller forældet dobbelt handling; gennemførlige kerneflows; ægte recovery; ingen essentiel kontrol tabt ved reduced motion, fokus eller tekstforstørrelse. Kildegate, Chrome-visning, integration og fysisk prøve dokumenteres særskilt. Ingen “bedre end 24 produkter” eller 97/100 på tværs af dem uden direkte sammenlignelige opgavetests. Det åbne arbejde er aktuel gennemgang efter rettelser, dækkende tilstands-/flowprøver, Green-paritet og fysisk accept, hvor kravet kræver det.

### Direkte musikstart ·18. oktober2026

Ét eksplicit Play på et musikresultat bruger skærmens præcise serverbundne rum/højttaler. Ingen ekstra destinationvælger, OK eller bekræftelsesdialog i dette forløb. Det særskilte eksplicitte rumskift forbliver hos `SpeakerOutputView`. `LiveMusicSelectionView.observePlayback` er en ikke-visuel lifecycle-metode; den afklarer accepteret feedback ud fra frisk matchende faktisk observation. Den samme eksisterende højre playerstatus ejer pending, afvisning og ukendt udfald, mens kendt cover, titel og faktisk Play/Pause bevares. Ingen optimistisk afspilning, gentagelse af ukendt handling eller ekstra statusflade i musikkort/venstre side.


### 19. oktober · historikvalg i den eksisterende robotformular

RobotControlPanel validerer den valgfrie, task-bundne historyDraft med den eksisterende control-model.controlArgs. Ingen ny komponentfamilie eller formular: det historiske valg udfylder de aktuelle områdevalg og gentagelser, kan justeres og kræver eksplicit Start. Sen AI må ikke overskrive brugerens valgte udkast. Kun en aktuel task med både reuse og start kan levere redigerbar historik; reuse alene forbliver den eksisterende låste gentagelse. Den redigerbare Start bruger aktuelle indstillinger; den separate sekundære uændrede gentagelse bruger den gemte opsætning. Registreringen omfatter kun valideringsmetoden og import til eksisterende model, ikke nye DOM-rødder eller ny handlingsautoritet.

### Player source-position refinement · 19 October 2026

The existing PlayerView compact and detail anatomy includes an optional native read-only progress rail. It displays admitted room-bound `progress_ms` with the same item’s `duration_ms`, without extrapolation, seek authority or a draggable thumb. Missing/invalid position hides and clears the rail; retained observations label the position as last known. Unchanged observations do not rewrite it. No new component family or simulated integration is introduced.

### Lokal robotrejse i samme produkt · 19. oktober 2026
`LocalRobotView` i `dist/local-robot-view.js` leverer kun lokale eksempeldata og hændelser til den eksisterende `RobotControlPanel`, `renderRobotHistory` og den allerede anvendte kontroldialog. Den opretter ingen komponentfamilie, transport eller fysisk handlingsautoritet. Overblik → robot → historik → genbrug → justér kan dermed afprøves i samme kanoniske preview. Et lokalt Start registreres som `accepted_local`, aldrig HA-kvittering eller gennemført rengøring. Livevælgeren anvender fortsat kun livekontrolkontrakten.

## Samlet UI-kit v1 · 20. oktober 2026 · v33-kontrakt, videreført i v34

Brugerens seneste konkrete kit afløser tidligere tokenlister og begrebsmæssige grupperinger. `dist/ui-kit.css` ejer de låste tokens og de tolv komponenters fælles visuelle regler. Eksisterende renderere og registrerede handlingskontrakter bevares; domænewidgets er sammensætninger, ikke nye primitive familier. Biblioteket viser tokens → komponenter → skabeloner → skærme og klikbare forløb med de samme produkt-renderere.

### Låste tokens

- Farver: side #F7F5F0, surface #FFFEFA, surface-2 #F2EFE9, line #E6E2DA; tekst #1B1D1C / #4A4741 / #6E6A63; danger #A2402F og tint #F6E7E4.
- Vejr #E4EDF2 / #C9DAE5 / #2F5D7C; Robot #F6E4E6 / #EDC9CE / #8C3A4B; Lys #F8EFD2 / #F0DC9E / #7A5A10; Tesla #E1EFE9 / #C3E0D3 / #2F6B55. Find musik/Radio bruger neutral surface-2. Covertoning højst12%.
- Typografi: Inter. Meta40015/20, body40017/24, label60020/26, title60028/34, value50040/44, hero50064/64. Kun Ro-uret128/500. Tal bruger tabular-nums.15px er kun metadata.
- Spacing8/16/24/32/40; radius16/24/999; nul er en strukturel nulstilling. Border, illustrationers datakoordinater, viewport-/gridmål og faktiske billeder er ikke spacingtokens.
- Én kortskygge:0 1px 2px rgba(27,29,28,.06),0 8px 24px rgba(27,29,28,.06). Scrim rgba(27,29,28,.32).
- Motion: cubic-bezier(.2,0,0,1); press90ms; fast200ms; move280ms. Retur240ms er bevaret som besluttet navigationstilstand. Reduceret bevægelse120ms opacity med settle≤150ms. Ingen konstant aktivitet uden formål.
- Primære hitområder64px; sekundære48px. Ikoner outline, stroke2,24/32/48; instrumenter og illustrationer er særskilt mærket og er ikke ikoner.

### De tolv komponenter

| Komponent | Anatomi og mål | Eksisterende ejere |
|---|---|---|
| Card `.pv-card` | S1×1, M2×1, L2×2 eller fuld bredde; padding24, radius24; tint/surface; default/pressed/disabled/loading | Ressourcekort, LibraryComponent, domæne-renderernes fælles flader |
| Hero `.pv-hero` | Fuld bredde, min200, padding32; ikon48, label20, værdi64/status17, højst2 handlinger | Status-/instrumentdelen i eksisterende domæne- og svarrenderere |
| Tile `.pv-tile` | Ens kolonnespor, ikon32, titel20, status17; off/on/pressed/utilgængelig | Lys, robotområdevalg, stationer og øvrige eksisterende valg |
| Chip/Segmented `.pv-chip`, `.pv-seg` |64h, header48, padding0 24; ikon24 og17/600; multi-/enkeltvalg med stabile ID'er | LibraryComponent, RobotControlPanel, eksisterende faner/scener |
| Button `.pv-btn` | Primary/secondary/icon;64h, ikon64×64, pill; højst én primary pr. zone | Eksisterende ejede handlinger og native buttons |
| Slider `.pv-slider` | Lodret64×160 eller vandret64h; hele sporet trækbart; værdi17 | Lys, PlayerView, VehicleView |
| Toggle `.pv-toggle` | Tile med on/off/pressed/utilgængelig | Eksisterende enheds-/kontrolmodeller |
| ListRow `.pv-row` |64h, gap16; ikon32/cover48, titel17/600, meta15, kontrol/håndtag | Kø, hændelser, historik og kildevalg |
| SectionHeader `.pv-section` | Titel20/600 og valgfri48h handling; margin-top32/bottom16 | Eksisterende sektionsoverskrifter |
| TopBar/DetailHeader `.pv-topbar`, `.pv-dhead` | Global80h, detailheader96 når den eksisterende komposition kræver det; én64hit tilbage; titel28 | WidgetHost/index og eksisterende detaljeheader |
| Dialog/Toast `.pv-dialog`, `.pv-toast` | Dialog520 bred/padding32; scrim kun venstre. Toast64h, nederst venstre, højst én | Eksisterende native dialoger/showFeedback/TimerNotice |
| Icon `.pv-icon` | Outline stroke2, round caps,24/32/48 currentColor | Eksisterende bundne SVG-assets og ikonprojektioner |

### Button: ejerbundne tilstande

Den eksisterende Button har én fælles tilstandskontrakt i `dist/ui-kit.css`. Den ændrer ingen option-ID'er, handlinger eller adgang:

- **Tryk og slip:** `attachPressedState` ejer den faktiske trykfeedback, afbrydelse og oprydning. Et tryk på en underkontrol markerer ikke forældrekortet.
- **Valgt/tændt:** Button-ejerens aktuelle `aria-pressed="true"`, `aria-checked="true"` eller allerede ejede `data-selected="true"` giver tint-strong, domænets ink og en indvendig 2 px markering. Brug `data-kit-identity` på selve Button for domænefarve; kit-noder nulstiller deres egne identitetstokens. En synlig knap eller et tryk bekræfter ikke en fjernhandling.
- **Afventer:** kun knappens egen `aria-busy="true"` viser den eksisterende Icon-størrelse 24 som en statisk delring efter én afsluttet 200 ms fremtoning. Den bruger knappens eksisterende indre plads, opsamler ingen pointerevents og ændrer ikke label eller mål. Ejeren fjerner attributten, når det aktuelle udfald er afklaret, og blokerer gentagne intents. Ingen timer, automatisk gentagelse eller opdigtet succes. MusicCard ejer allerede `.result-play`-markøren og får ingen ekstra ring.
- **Utilgængelig:** native `disabled` eller `aria-disabled="true"` vises nedtonet. Ejeren håndhæver fortsat adgang og aktuelle session/task/revision; `aria-busy` alene er ingen handlingsblokering.
- **Fejl:** kun eksplicit `data-state="error"` eller `aria-invalid="true"` på selve Button giver danger/tint. En overordnet fejl eller manglende måling farver ikke automatisk alle handlinger som mislykkede. Den konkrete ejer viser problem og mulig handling i sit eksisterende feedbackområde.
- **Reduceret bevægelse:** ingen Button-transition eller markøranimation; samme synlige tilstand og indhold bevares. Uændrede attributter starter ingen ny feedback.

Bibliotekets eksisterende Button-opslag viser standard, primær, ikon, destruktiv, valgt, afventende, utilgængelig og eksplicit fejl. Valgt-eksemplet kan skiftes direkte som et lokalt komponentvalg med samme native knap; det sender ingen produktkommando.

Skeleton og Empty er Card/Hero-tilstande. De er ikke nye familier. Illustrationer, grafer, fotos og albumgrafik bevarer deres faktiske indhold. Albumstriben på808s & Heartbreak må ikke beskæres væk.

### Detaljeskabelon

1. Global header med én tilbage og titel.
2. Ét hovedkort i fuld kolonnebredde med faktisk kendt svar/status.
3. Betjening i ens Tiles/Sliders; højst én primary pr. zone.
4. Forslag/scener i Chips når der er indhold.
5. Faktisk historik i Card/ListRows; tom zone udelades.
6. Meta/kilde15px. Forbindelsesproblemer står før betjening, én gang.

Kolonnegrid4 spor, gap16, zonegap24 og32 bundpadding. Længere indhold scroller med top48/bund72 fade. Ingen kunstig historik eller opdigtet boliggeometri for at udfylde højden. Playeren bliver stående til højre; scroll/fokus og igangværende ressourcer bevares.

### Svarskabelon

Den eksisterende `response`-skabelon bruger Card-varianten `response-canvas`, ejet af `AnswerWidget`, `VisualComponent` og de eksisterende `LibraryComponent`-formater. `AnswerWidget.update` kalder den samme ejers `renderAnswer` og synkroniserer derefter hidden/inert for de eksisterende formatcontainere; dette er samme registrerede renderer, ikke en ny familie. Ingen ny familie. Rammen fylder den venstre læseflade fra samme top som playeren: padding32, faktisk titel/spørgsmål som normal konteksttekst17 inde i kortet, ikon48 og særskilt konklusion28. Længere konklusioner over100 tegn bruger rolig20/26px brødtekst. Titlen kaldes ikke en transskription, medmindre det faktisk er dokumenteret; gentaget titel i selve konklusionen skjules som dublet. Handlinger samles i en nederste dock med64px trykflader. Kilder er en tekstlig disclosure nederst efter svaret og handlingerne; de tre prikker og kildeknappen over konklusionen er fjernet. Den samme kilde-node og de samme kvitterings-IDer bevares. Længere indhold bevarer sin rækkefølge og scroller i den eksisterende venstre opgaveflade; ressourcer og timer nedenunder bevares.

Formatets indhold bestemmer det visuelle felt: numeriske fakta har én64px hovedværdi på mørk instrumentflade og20px støttefakta; tekstlige fakta bruger en rolig tonal flade uden mørk hero; vejr bruger den eksisterende blå identitet. Tre sammenligninger/valg står i tre ens kolonner med konkrete værdier, uden en efterladt tredje flise. Grafer bruger16px søjler,20px labels og40px faktiske tal. Tidslinjer bruger96px rækker med28px tid og20px hændelse. Trin viser det faktiske40px trinindeks, fremdrift,28px instruktion og64px navigation; læste live-trin bevarer deres læseadgang uden opdigtet kontrol. Tjeklister bruger fuldbredde80px rækker. Billede/illustration har ét320px afgrænset billedfelt med kildebundet forklaring og20px støttefelter.

Venter bevarer den samme anatomi og eventuelt tidligere indhold. Afbrudt, fejl og offline bevarer faktisk modtaget indhold; en særskilt statusstribe og eksisterende retry forklarer tilstanden. Hele svaret farves ikke som en fejl. Der opfindes hverken data, kilder, handlinger eller livekvitteringer. Denne opskrift er en implementeret lokal revision, ikke brugerens visuelle slutaccept.

### Svar: færdigt viewportforløb

Ved1280×800 skal et kort svar kunne aflæses og dets eksisterende primære handling kunne trykkes uden en afskåret bundknap. Den samme `response-canvas`-ejer vælger `answerExtent=short/long` ud fra synligt indhold: over650 teksttegn i konklusion, faktarækker/instruktioner og billedtekst eller over6 rækker giver lang form. Kilde-URLer, receipts, eksempel-IDer og skjulte metadata indgår ikke. Det er en tæthedsregel, ikke garanti udledt af et testantal; browseren skal måle slutfladen.

Kort form bruger24px kortpadding,16px gruppegap og indholdsbestemte flader: numerisk instrument min160, vejrets aktuelle instrument min128, støtteprognose min96, billede højst240. Samme17px brødtekst,20/28/64px hierarki og64px kontrolflader bevares. Trinindeks og fremdrift står sammen frem for i hver sin høje række. Forhåndsvisningens gentagne forklaring ligger i Kilder, mens konkrete vejrforhold bliver i svaret.

Lang form har naturlig højde, rigtige sektioner og den eksisterende venstre scrollflade. Der må ikke skabes afskæring, skalering, skjulte handlinger eller tomme afstandsstykker for at få en ønsket højde eller scrollmarkering. En brugeråbnet kilde- eller tekstuddybning kan øge højden; dens indhold skal kunne scrolles og lukkes uden at nulstille svaret, musik eller timer.

### Skærmopskrifter og brugerens præciseringer

- Overblik: fast TopBar, fast aktivitetsplads, Card L Vejr, Card M Robot, Tile Lys/Tesla, Card M Find musik/Radio. Placeringer afhænger aldrig af tilstand. Aktivitet prioriterer timer → robot i gang/fejl → Tesla opladning; status/deeplink uden dubleret Pause.
- Robot: Hero → faktisk områdevalg som Tiles og gentagelse som Seg → gemte valg/historik. Ingen tilfældig betjeningsmodal og ingen fabrikeret plantegning.
- Lys: aktuel Hero → rum-Chips64 → ens lampe-Tiles med navn/status og kendt lysstyrke. Navneknappen åbner samme lampedialog; Toggle og Slider bruger kun ejerens faktiske lokale rettigheder. Ingen eksempel-scener eller farvevalg i produktet. Ukendt/frakoblet må ikke blive til falsk succes.
- Tesla: Hero med kendt batteri/rækkevidde/ladegrænse → Klima, temperatur og adgang som kontrolfliser → faktisk historik. Lås/lås op kræver bekræftelse.
- Timer: **Én timer. Aktiv eller pauset timer skal afsluttes eller annulleres før en ny eller en varighedsændring. Ingen Erstat/Behold og ingen presets/+1/+5 under aktiv timer.** Denne senere direkte brugerbeslutning overstyrer den modstridende Grok-tekst. Færdig alarm følger eksisterende femminutters afslutning.
- Find musik: faktisk Fortsæt/valg, stemninger og senest; covers bevarer identitet og korrekte kilder. Ingen opfundne playlister.
- Radio: kendte stationer i ens fliser; sidste celle kan være faktisk Afspiller-handling. Valgt er ikke automatisk bekræftet lyd.
- Player/kø: én vedvarende player, output samlet med volumen, kø til venstre uden dobbelt transport. Træk bevarer rækkefølge.
- Ro: foto,128ur, ens glaschips og hændelsesbundet minutskift. Nat/idle/drift bevares. Konstant bevægelse, UI-lyde og automatisk fjern-layout er parkeret.

### Kontrol

Komponentgaten beskytter kanoniske ejere og anatomi; den er ikke visuel godkendelse. Computed-tokeninventaret skal måle faktisk renderede værdier efter hele kaskaden. Farvekomposition, ikonpixels, touchflows, motionframes og fysisk læsbarhed kræver særskilt evidens. Ingen score9,5 eller fuld194-tilstandsdækning udledes af beståede unit-tests.

### Player på høje visningsflader · 21. oktober 2026

Stor player følger tilgængelig højde op til692px og topflugter altid. Højere vinduer strækker ikke de interne rækker; cover, titel, transport og volumen beholder samme rolle og afstand. Ved højder op til680px bruger den eksisterende kompakte rækkeopskrift coverets faktisk tilgængelige plads. Ro-opskriften er uændret.


## Timeridentitet · direkte brugerbeslutning21. oktober2026

Timerens identitet er altid koksgrå: `--pv-dark` med `--pv-on-dark` til tekst og ikoner. Det gælder også den inaktive S-genvej i overblikket, før en timer er startet, på alle viewportvarianter. Genvejen beholder sit eksisterende S-format og sin placering; aktiv timer, Ro og detalje bruger samme identitet og deres eksisterende anatomi. Ingen neutral, lys inaktiv variant.


## Fælles overbliksanatomi · direkte brugerbeslutning21. oktober2026

S-, M- og L-fliser deler 24px indryk, 16px mellemrum, 32px ikon og titel20/26. Verbal status bruger altid body17/24, uanset flisens størrelse eller forbindelsestilstand. Et fast48px statusfelt starter på samme øverste tekstlinje på tværs af en række; to linjer i Lys flytter derfor ikke Teslas første linje. Robotbatteri og tilsvarende sekundær metadata kan bruge feltets anden linje som meta15/20. Kontrolknapper ejer deres eksisterende plads og må ikke flytte titel eller statusfelt. Timerens mørke identitet bevares. Vejrets kildebundne numeriske64px-værdi og timeprognose er en særskilt indholdszone under den samme header.

### Musikresultater · ens flader · 21. oktober 2026

Alle kort fra MusicResults bruger `--pv-surface` og samme runde afspilningskontrol: 64 px trykflade i `--pv-surface-2` med mørkt 24 px ikon. Anbefalingsrang ændrer ikke udseendet; kun faktisk valgt eller afventende tilstand får den fælles statusmarkering. Kortenes illustrationer, mål, indryk og footer bevares på tværs af alle fire faner.

## Samtale- og beskedbevægelse · 21. oktober 2026

Den eksisterende `VoiceSurface` ejer én fast 224 px samtaleplads: 64 px trykflade i topbaren og 48 px statusflade. Ikon og tekst beholder deres spor gennem faseskift. Igangværende faser bruger Lytter…, Tænker…, Svarer…, Afslutter… og Venter…; den afsluttede opfølgningsfase hedder Klar til mere. Aktiv placering er y16; i Ro er placeringen y48, dvs. 24 px inden for fotoets topkant. Samme ejer flytter én gang mellem positionerne uden at genstarte samtalefasen. Eksisterende mic, chat-circle, soundwave og check2-aktiver bruges; der er ikke tilføjet en komponentfamilie.

Kun en faktisk aktiv samtalefase har vedvarende ikonbevægelse: mikrofonens rolige åndedræt under lytning, tankesymbolets bløde lys under arbejde og lydkurvens amplitude mens ejeren angiver AI_SPEAKING. Det er tilstandsvisning, ikke et målt mikrofonniveau eller fysisk lydbevis. Klar/afslutning har én kort landing. Samme session/turn/fase bevarer den eksisterende animation; berigelse og identiske opdateringer genstarter den ikke. Faseskift, inaktivitet, baggrund, reduceret bevægelse og disconnect rydder aktiviteten. Reduceret bevægelse bruger statiske ikoner.

`NotificationQueue` er fortsat eneste beskedejer. `SceneMotion.feedback` giver én stille ankomst, indholdsændring eller udgang; gentagen uændret tekst genstarter intet. Den faktiske tekst bevares til udgangen er færdig. Offline/fejl står stille efter ankomst. Ingen af disse effekter ændrer navigation eller spillerens Ro-overgang. Browser- og fysisk accept registreres separat.

Når samtalen bliver inaktiv, toner samme statusflade ud over 120 ms i både Ro og aktiv visning. Den bliver straks inert og skjult for hjælpeteknologier, mens den oprindelige Svar-knap beholder klik- og fokusansvaret under udgangen. Gentagne inaktive opdateringer starter ikke udgangen igen; efter afslutning er status skjult og animationsejeren frigivet.


## Inaktiv Timer ved Radio · direkte brugerbeslutning21. oktober2026

I overblikket beholder Vejr sin store venstre plads og Robot sin eksisterende plads øverst til højre. Under Robot danner Lys/Tesla og Radio/Timer en2×2-gruppe af ens S-fliser. Find musik beholder sin større venstre plads under Vejr. Den inaktive Timer står derfor ved siden af Radio i tredje fælles gridrække, uden en ekstra løs fjerde række. Når en timer er aktiv, bevares den særskilt godkendte brede timer øverst. Musik og Radio bruger fortsat neutral base med indholdsfarver; ingen ekstra domænefarve.


## Timerens inaktive vægt · senere brugerbeslutning21. oktober2026

Den inaktive S-Timer er en rolig variant: `--pv-timer-idle-surface` er et semantisk alias til den eksisterende varme koksgrå `--pv-ink-2`. Hvidt ikon og `--pv-on-dark`-tekst bevares. Aktiv bred timer, timerdetalje og Ro bruger fortsat `--pv-dark` som tydelig aktiv vægt. Denne senere beslutning præciserer den tidligere formulering om altid samme mørke timerflade; anatomi og grid ændres ikke.

### Player · første læsning, tom, fejl og radio · 21. oktober 2026

`PlayerView` ejer fortsat både den kendte afspiller og `#player-empty`. Første læsning og fejl bruger samme rumrække, en reserveret kvadratisk artworkplads med den eksisterende musiknode-fallback, præcis status og den eksisterende discovery-/kontovalgshandling, når den faktisk er tilgængelig. Ingen opdigtet sang, position, afspilningsknap eller retry-autoritet. Kendt, fortsat kildebundet indhold bevares gennem læsefejl; usikker position markeres som sidst kendt, og fejlet status navngives. Ro viser fejlen i sin kompakte anatomi i stedet for en almindelig tomtilstand. Lokal radios manglende lyd angives ved stationens metadata og i det tilgængelige navn, uden en ekstra konkurrerende status over rumrækken.

## MusicResults · Play-feedback og handlingsfod · 21. oktober 2026

Alle fire musikfaner bruger samme kort: kvadratisk billede, titel og beskrivelse i fuld bredde samt en reserveret handlingsrække med den eksisterende 64 px tonale Play-cirkel nederst til højre. Play ligger hverken i teksten eller over billedet. Normal ventetid tilføjer ingen synlig statuslinje; den eksisterende live-region kan stadig fortælle hjælpeteknologier, at afspilning er anmodet.

Kun det faktisk valgte, ejerbundne kort får pending-outline og en rolig ring omkring Play. Trekanten står stille; ringen er feedback på brugerens igangværende handling og er statisk ved reduceret bevægelse. `LiveMusicSelectionView` bevarer det klikkede opaque kort-ID som ren præsentationsbinding gennem klargøring; scope, kildemedlemskab og generation kontrolleres fortsat af de eksisterende ejere. Uændrede opdateringer ændrer ikke pending-attributterne. Udfald, ejer-/kildeforandring, frakobling og cleanup fjerner aktiviteten. Det betyder aldrig, at musik allerede spiller: observeret/kvitteret udfald hører fortsat til den kanoniske player. Fejl og ukendt udfald følger det eksisterende genopretningsforløb uden automatisk gentagelse.

Queue ListRow alignment (F49): PlayerView keeps four identical slots for current, paused and upcoming items: a centered 64px indicator area, 64px cover, flexible title/artist column and a 64px trailing playback hit area with the existing 24px glyph. Numbers and current-state icons share one center. Direct user decision F68 (21 October): queue drag-and-drop is deferred. The indicator has no grip, gesture/keyboard reorder handlers, extra tab stop or move instructions in local/live UI; vertical touch scrolling remains native. Existing model/protocol reorder contracts remain unexposed for possible later work. Rows remain 96px tall with 16px vertical / 24px horizontal padding and 16px column gaps. Long title/artist text truncates visually while the complete accessible name remains available. Current-state changes retain the row, stable identity and actual playback authority. Body/meta typography uses the shared kit tokens. F86 (21 October): the actual current row uses aria-current=true and the same full-row neutral selection surface plus inset border as selected speaker ListRows; it is not an aria-pressed toggle. Playing and paused retain their respective soundwave/pause indicators and actual pause/resume action; upcoming rows retain their order number and Play action. Disabled state quiets only the action glyph, never artwork, copy or the selected-current surface. A current item remains recognizable even when transport authority is unavailable. The fixed slots and truncation rules above remain unchanged. Screenshot review found the former current and upcoming surfaces indistinguishable; rendered post-change acceptance is separate.

VolumeSlider icon action (F53): the persistent player uses the existing IconButton variant for its 64px volume icon target, with the shared 24px icon. Music and radio use the same owner and admitted volume setter. Zero is requested only when that setter allows zero; unmute restores a previously observed nonzero value for the same boot/room/account/owner/target binding. A changed binding forgets it; an initially observed zero without a remembered value leaves restoration unavailable, while the range remains usable. No mute authority is inferred from a volume display. Pressed state, icon and label follow observed volume, not the requested result. Pending and unknown requests cannot be repeated; a changed observed volume releases the local intent fence. Existing source control fences still decide command admission.

Player destination stability (F55): the populated player retains its fixed 48px output row, with a reserved 20px status region and centered 28px destination region. Hiding routine status text or switching play/pause cannot reflow the destination, artwork or control rows. Actual pending/error feedback stays in that reserved status region. Browser measurements remain the acceptance evidence for rendered rectangles.

## Fælles tryk- og fokusfeedback · 21. oktober 2026

`attachPressedState` er den samme præsentationsejer for produktets og bibliotekets native Button, Chip, Toggle, ListRow, links og disclosure-summary. Det nærmeste faktiske kontrolmål får straks en diskret indvendig farvetilstand og en endelig 90 ms farvelanding ved slip, så også hurtige tryk kan ses. Der ændres hverken størrelse, placering, klik, afspilning eller anden handling. Farvefeedback er også brugbar med reduceret bevægelse; ingen bevægelse eller uendelig aktivitet tilføjes.

Pointerup fjerner holdtilstanden. Scrolltræk, cancel, mistet capture, baggrund, blur og disconnect rydder den; kun et reelt slip får landingen. Deaktiverede/inert-kontroller og indlejrede input, select, textarea, slider og redigerbar tekst overtages ikke. Kontroltekst har ingen markering eller touch-callout, mens læseindhold og native tekstfelter fortsat kan markeres.

Fokus styres efter faktisk inputmetode: pointerfokus får ikke en vedvarende tastaturring, heller ikke når samme navigation flytter fokus til en anden eksisterende knap. Næste tastaturhandling fjerner pointermarkøren, så `:focus-visible` igen viser den normale ring. Den oprindelige native aktivering og fokusautoritet bevares; der simuleres ingen klik.


### Tesla: adgang og samlet klima · 21. oktober 2026

`VehicleView` bruger fortsat samme Hero/Tile/Button/Slider/ListRow-ejere. Adgang står først i læserækkefølgen; Klima samler den aktuelle tilstand, eventuel faktisk kabinetemperatur, power og måltemperatur i én Tile. Måltemperatur er en indstilling og må ikke præsenteres som en måling. Opladning er én indholdsbestemt Tile under disse: status i overskriften, kun kendt effekt/sluttid i de eksisterende ListRows og ladegrænse som sekundær Slider. Ingen tomme faktruder, gentagen status eller tvungen minimumshøjde i denne sekundære sektion. Samme rytme gælder ved delvise observationer; ukendt kabeltilstand må ikke omskrives til “Ikke tilsluttet”.

Der er fortsat ingen optaget sædevarme- eller bagagerumstilstand/-handling i den passive vehicle-kontrakt. Disse kontroller og tilstande udelades. En HA-dokumenteret mulighed giver hverken PodView en state eller kommandomyndighed. De fire eksisterende lokale fixture-handlinger bevares uden ny live-adapter. Låsning/oplåsning kræver fortsat en eksplicit bekræftelse på samme revision; afbrudt forbindelse eller en anden revision annullerer bekræftelsen. Sammenhængende klima, temperatur og låsevalg beholder de samme noder ved opdatering.

Kilde-/adfærdskontrol af denne komposition findes i `tests/vehicle-view.test.js`. Visuel kontrol, publicering, installation og fysisk bilbetjening er særskilte beviser.

### Robot: aktuel handling og lokale rumvalg · 21. oktober 2026

`RobotControlPanel` bruger den samme Hero, rum-Tiles, gentagelses-Chips, Buttons og native indstillingsdisclosure i detalje og dialog. Aktuelt tilbudt Pause ved rengøring eller Fortsæt ved pause er den ene primære transporthandling; Til basen og Stop forbliver sekundære, hvis ejeren faktisk tilbyder dem. Indstillinger udfoldes efter behov og vises kun fra den aktuelle task. Ingen knap udledes af en observeret indstilling eller en Roborock-funktionsliste. Uændret task bevarer formular, åbne disclosures og redigerede valg; ny task genbinder til sine præcise options. En løsrevet gammel formular, udløbet task, offline, pending eller forældet observation kan ikke sende en handling.

`LocalRobotView` udfører ingen robotkommando. Formularen forklarer før rumvalget, at **Gem valg lokalt** kun bevarer valget i denne visning og ikke overlever genindlæsning. Gemning viser de valgte rum/gennemløb og **Redigér valget**, som åbner det samme redigerbare udkast uden at starte robotten. Den rigtige live-Start beholder ejerens aktuelle option, argumenter og forbrugte-task-/ukendt-udfaldsgrænser. Seneste valg og faktiske hændelser har fortsat hver deres eksisterende ejer.

Tidligere robotvalg bliver læsbare ListRows ved offline, pending, stale eller tab af kommandomyndighed. Live-visning kræver fortsat aktuel `homeRead: vacuum`, samme præcise boot/room-`homeScope` og den optagne `home_assistant_state`-kilde; læsefratagelse, recoveryblokering eller et fremmed scope rydder rækker og hændelser. Klik genkontrollerer kilde, scope, record-ID, aktuelt device og nuværende kontroltilladelse. En tidligere læse- eller kontroltilladelse genbruges aldrig som ny tilladelse.

### Tesla: ukendt bil og opladning i Hero · direkte brugerbeslutninger F83/F85/F87 · 21. oktober 2026

Før bilens model er kendt, viser den eksisterende Tesla-detalje den generiske bil-Icon, **Bil** og ærlig forbindelsesstatus. Modelnavn, årgang og den valgte grå Model Y-illustration bruges kun af den eksplicit identificerede Model Y 2023-fixture. Den aktuelle passive HA-kontrakt optager ingen model-/årgangs-/billedmetadata, så observerede biler får ikke udledt disse fra øvrige data eller lokale eksempler.

**Ladegrænse er fjernet fra UI efter brugerens beslutning.** Der er heller ingen særskilt Opladning-flade. Kendte opladningsfakta ligger i den eksisterende Hero efter Batteri og Rækkevidde: Ladeeffekt og Forventet færdig. Ukendte værdier skjules; rækkefølge og noder bevares gennem opdateringer. Adgang og Klima beholder deres eksisterende separate Tiles. Tidligere afsnit om en ladegrænse-Slider eller sekundær Opladning-Tile er hermed erstattet. Den ueksponerede lokale reducer er ikke en UI-kontrol eller live-tilladelse.

Bagagerum hører til den eksisterende Adgang-komposition, når en faktisk optaget ejer leverer tilstand og en eksplicit tilladt handling. Den nuværende vehicle-kontrakt leverer hverken bagagerumsobservation eller effektoption; derfor vises ingen opdigtet bagagerumsknap, tom ekstrafamilie eller aktiv placeholder. Klima-knappens valgte farve følger dens faktiske `aria-pressed`-tilstand. Bekræftelsesvalg for låsning er ikke netværks-pending og udløser ingen opdigtet busy-state.

### Robot og Lys: samme læsbare Hero i alle detaljer · 21. oktober 2026

Robot- og lysdetaljen bruger fortsat den eksisterende Hero-ejer i `ui/library/components.js`, også i robotpanelets dialog. De faste roller er ikon, kort titel, status eller faktisk måling, hjælpetekst og tilbudte handlinger i hver sin normale gridrække. Hjælpetekst må aldrig placeres i statusrækken eller bag en stor værdi. Statusfraser bruger kittets titeltypografi; kun en faktisk kendt robotbatteriprocent bruger den større målingstypografi. Ukendt batteri opfinder hverken nul, procent eller en ekstra “Batteri: —”-linje.

Ikke tilsluttet, ukendt og fejl bevarer samme anatomi og kendte data uden nye knapper. Pending bevarer den aktuelle observation og den samme tilbudte knap deaktiveret; offline bevarer læseindhold og blokerer fjernhandling. Status-, hjælpetekst- og handlingsopdateringer bygger hverken kortet eller dets forældrekort igen. Den varme lysidentitet og robotidentiteten følger de eksisterende tokens. Dette præciserer de eksisterende detailkompositioner og opretter ingen ny variantfamilie eller handlingsmyndighed.

### ListRow: valgt flade uden sort ramme ·21okt2026

Direkte brugerfeedback13.47.48 erstatter den kraftige indre sorte kant: valgt række bruger den fælles tonale `--pv-line`-flade og eksisterende semantiske tilstandsikon. Ingen dekorativ sort kant; tastaturets focus-visible bevares særskilt. Samme ListRow-regel gælder kø og højttalervalg.

### Datakilder og betjening · kildekontrolleret 21. oktober 2026

Tabellen beskriver den aktuelle optagne kodekontrakt; den er **ikke** en frisk aflæsning af brugerens HA-enheder eller fysisk accept.

| Domæne | Faktiske felter kan optages fra HA | Hvad kan betjenes fra PodView? |
| --- | --- | --- |
| Robot | Status og batteri; kun kildeleveret rum, kortmetadata, tid, areal, procent, fejl, dock/vand, pleje og indstillingsobservationer. Manglende værdier forbliver ukendte. | Kun ejerens aktuelle vacuum-task: Start/genbrug, Pause/Fortsæt/Stop/Til basen samt tilbudte typed indstillinger. Ny rengøring bruger præcise område-IDer og 1–3 gennemløb. Hverken observeret indstilling, kortnavn eller HA-understøttelse giver kontrolmyndighed. Den aktuelle installerede robots fulde handlingsudbud er ikke frisk verificeret her. |
| Lys | Entitetsnavn, on/off/unknown/unavailable og eventuel rå lysstyrke 0–255. | Den aktuelle live-projektion er read-only. Toggle og dæmpning er lokale fixtures med stabilt scope. Hygge/Middag bliver i modeltests og tilbydes ikke i produktet; ingen opdagede scener eller aktiveret HA-betjening antydes. `controlTask` optager fortsat kun music/vacuum. |
| Tesla | Batteri, rækkevidde, låsestatus, ladestatus/effekt/sluttid, klimastatus og kabinetemperatur. Ingen optaget model/årgang, bagagerum eller sædevarme. | Live-observation har `actions: []`. Kun lokal fixture har klima, måltemperatur og bekræftet låsning. Ladegrænse er fjernet fra UI; bagagerum afventer faktisk state og tilbudt handling hos samme ejer. |

Den ensartede ikke-tilsluttede Robot/Lys/Tesla-Hero er bevaret efter brugerens positive tilbagemelding. Robotopsætningens hjælpesætning vises kun i den konkrete præsentationsplaceholder; ukendt, fejl og sidst kendt tilstand beholder deres egen betydning. En historiksektion uden faktiske hændelser skjules sammen med sin overskrift. De samme timeline-noder bevares og vises igen ved reelle hændelser; tomme seneste valg giver heller ingen fyldsektion.

### Fælles indholdsrækker og vejrets Hero ·21okt2026

Indholdstunge detaljekort/-tiles bruger den eksisterende 3-kolonne-komposition (`--pv-detail-columns-content:3`), som Radio/Find musik. Det eksisterende 4-kolonne-grid bevares til små toggle-tiles; ingen global gridændring. Vejr følger samme Detail-template med 16px sideindryk: kun eksisterende current-Hero er vejrtonet, med temperatur, forhold, interval/vind og kildebunden rådgivning i naturlige tekstroller. Timer/dage forbliver de samme retained forecast-noder, og tomt/stale vejr bevarer ærlig kilde/status.

Robot-detaljen bruger den eksisterende `pv-vacuum-widget` som Hero: aktuel status er primær, mens kendt batteri, rengjort areal og varighed er metadata. `RobotControlPanel` beholder præcis ejerens tilbudte optioner og kontrollen af opgave, udløb, tilstand og forbindelse. Én Start-knap i Heroens eksisterende handlingsrække er knyttet til den samme rumformular med native `form`-attribut; den bliver først aktiv efter rumvalg. Rum er eksisterende robotfarvede Tiles, gentagelser er Chips, og observerede plejeværdier bruger læsbare ListRows uden nye kommandoer. `LocalRobotView` viser den fælles metadata “Eksempel” og tilbyder kun handlinger for sin aktuelle eksempeltilstand; den opdaterer udelukkende de lokale eksempeldata. Ingen transport, HA-beføjelse eller fysisk rengøring følger af eksempelknapperne. Tom/ukendt/fejl bevarer den eksisterende ærlige Hero og forklaring.


### Lys: samme lampe-Tile og Dialog lokalt og med HA-observationer · 21. oktober 2026

Den eksisterende `WidgetHost.renderLightAdjustments` normaliserer kun optagne navne, tænd/sluk/ukendt og lysstyrke til samme retained Tile. Tre kolonner med ens222px højde bruges, når bredden tillader det; smalle flader bruger to eller én kolonne. Rumvalg ligger efter Hero og bruger64px Chips. Komplette, aktuelle optalte lys giver Hero-værdien “2 af4 tændt” i hero64; tom/ukendt/fejl bevarer den godkendte kompakte forklaring, og stale antal bliver aldrig til en aktuel måling.

Hver kendt lampes eksisterende navneknap er navigation til én retained native Dialog, dekoreret med `applyKitDialog`; den skifter ikke lampen ved åbning. Dialogen viser faktisk navn, tilstand og kendt lysstyrke. Lokal Toggle og Slider sender kun med aktuelt session/task/revision, lampens stabile ID og samme valgte scope. Optagne HA-lys kan åbnes og læses, mens alle effektkontroller forbliver read-only. Manglende lysstyrke er “Niveau ukendt”; den bliver aldrig til0. Ingen farve-/temperaturdialog eller scenechips tilføjes uden felter og en aktuel ejer.

Skift af session/opgave/revision/rum, fjernet lampe, ukendt lampetilstand eller forbindelsesskift lukker eller afskærer den gamle binding. Luk/Escape returnerer fokus til den samme synlige navneknap; en fjernet knap falder tilbage til den eksisterende overskrift. En forsinket close-hændelse kan ikke rydde en genåbnet binding. Samme Dialog, Tile, Button, Toggle og Slider-ejere gælder bibliotek og produkt; ingen ny familie eller HA-kommandomyndighed.

Færdigt visuelt svar følger den eksisterende `AnswerAutoReturn`: 30 sekunder efter både tale og visuelt indhold er afsluttet → Lige nu; derefter den eksisterende 3 minutters inaktivitet til Ro. Berøring, ny tale, modal, holdt peger og åbne detaljer følger ejerens afbrydelsesværn. Musik, timer og svarhistorik bevares.
