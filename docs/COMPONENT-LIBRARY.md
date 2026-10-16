# PodView · det eneste komponentbibliotek

Gældende beslutning: 16. oktober 2026. Brugeren har bedt om at låse de eksisterende godkendte elementer som det eneste bibliotek, PodView og agenter må bruge. A · anbefalet fælles ramme er valgt for overblikket. Denne kontrakt gælder produktets faktiske skærm, både localhost og live. Den godkender ikke automatisk alt, der tidligere er blevet skrevet eller lagt i workshoppen.

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
| Hændelseshistorik | `pv-activity-timeline` i `dist/ui/library/components.js`, eksisterende `#device-timeline` | Keyed `ol/li`, tidspunkt + hændelse. Observerede hændelser og senest anmodede opskrifter har hver sin tydelige overskrift. En anmodning accepteret af HA er ikke bevis for færdig rengøring. |
| Meningsfuld besked | Eksisterende `#timer-alert` og `#playback-status`/`showFeedback` | Faktisk færdigmelding, resultat, fejl eller ukendt udfald. Eksisterende luk/åbn-handlinger; ingen generel ventetekst som toast. |
| Samtalestatus | `VoiceSurface` i `dist/voice-surface.js` | Den eksisterende markør og tekst for faktisk lytning/tænkning/svar/klar. PodVoice ejer talen. Tilstandsbevægelse stopper ved exit, reduceret bevægelse og disconnect. |

Eksempel: live-musik leverer kort til `host.musicResults.render(...)`; den bygger ikke `article.live-result`. Live-afspilning leverer modeller til `host.playerView.renderPlayer(...)`, `renderControls(...)` og `renderQueue(...)`. Live-vejr kalder `renderWeather(view, liveWeatherModel(...))`. En ny undertitel eller et mærket vindfelt i en eksisterende time-række er en rettelse inde i samme komponent.

## Tilstande er også en del af biblioteket

- Første indlæsning bruger den eksisterende widgets reelle, tomme anatomi uden opdigtede billeder, værdier eller option-ID'er. Opdatering bevarer de samme noder og det senest kendte indhold.
- `aria-busy` og den eksisterende endelige tilstandsbevægelse må kommunikere igangværende arbejde. Synlig prosa som “Henter…”, “Starter…” eller “Det tager lidt længere tid” er ikke en godkendt loading-variant. Faktiske samtalefaser og meningsfulde fejl/resultater vurderes efter deres egen rolle.
- Ukendt, tomt, offline og fejl er ærlige tilstande. Behold nyttigt indhold og angiv gammel status, hvor det er nødvendigt. Ingen optimistisk “færdig”, loopet retry eller lokal opgradering af handleadgang.
- Voice og touch sender de samme stabile option-ID'er. Viewer-identitet giver ikke ejerskab. Session, task og revision bindes af serveren; kontroller vises kun med den faktisk indrømmede adgang.
- `visual-history` og headerens eksplicitte QA-stages er lokale prøvedata. De må ikke fylde almindelig/live-historik. Ti lokale QA-formater er data til eksisterende kanoniske renderere, ikke ti nye komponenter. De fire strukturerede visual-familier er fortsat en særskilt indholdskontrakt; lokal formatdækning beviser ikke ti liveproducenter.

## Workshop og kendt gæld

`dist/library.html`, `dist/patterns.html`, `dist/components.html`, `dist/scenes.html`, `dist/legacy.html` og deres historiske moduler er reference. De er ikke alternative godkendte produktindgange. Det samme gælder katalogets ubrugte roller: eksempelvis workshop-versionerne `pv-music-results`, `pv-now-playing`, `pv-transport-controls`, `pv-queue-view`, `pv-timer-widget` og `pv-activity-card`. Produktet har allerede ejede renderere for disse behov. At en rolle findes i kataloget eller registreres af det fælles modul giver ikke tilladelse til at tage den i brug.

Registeret indeholder afgrænsede `unapproved-debt`-undtagelser, så eksisterende kode kan migreres uden at blive nygodkendt:

| Gæld | Faktisk kilde og afgrænsning |
|---|---|
| D01 | `dist/live-home-view.js`: observerede hændelser og tydeligt adskilte anmodninger genbruger nu `pv-activity-timeline`. Resterende live kilde-/plejedetaljer og genbrugsknapper er afgrænset gæld, ikke en ny historie- eller widgetfamilie. |
| D02 | `dist/live-control-view.js`: eksisterende live-betjenings-/setupformular. Den indrømmer serverejede optioner, men udgør ikke en ny generel designfamilie. |
| D03 | `dist/live-answer-view.js`: eksisterende særskilt ejer-kildedialog. Ingen ny svar-/faktakortfamilie her. |
| D04 | `dist/live-media-view.js`: eksisterende konto-vælger. Player og kø skal fortsat gå gennem `PlayerView`. |
| D05 | `dist/live-music-selection-view.js`: eksisterende søgning/bekræftelse/målformular. Musikresultater skal fortsat gå gennem `MusicResults`. |
| D06 | `dist/robot-control-panel.js`: eksisterende bespoke shadow-formular og historik. 36 ønskede robotfelter er ikke en automatisk godkendelse af denne som ny widgetfamilie. |
| D07 | Eksisterende loading-prosa på tværs af ejede renderere. Den er ikke en godkendt tilstandsvariant; den isolerede loading-rettelse skal bruge tomt/bevaret indhold i samme anatomi. |

En gældsundtagelse må indsnævres eller fjernes efter review. Den må ikke udvides ved blot at kopiere den nye implementation ind i registeret. Hvis et nyt produktbehov kræver mere end det eksisterende bibliotek, skal det først beskrives konkret og godkendes af brugeren.

## Kontrol og ændringer

Kør `node scripts/check-component-library.mjs` fra projektroden og `node --test tests/component-library.test.js`. Ved adoption skal `npm test` køre komponentkontrollen før de eksisterende tests. Det bliver foreslået i integrationens særskilte bindingssnippet; root-filerne er ikke ændret af den isolerede levering.

Kontrollen følger de faktiske aktive importkanter fra `dist/index.html`, kræver den samme produktindgang, registrerer nye produktmoduler/HTML/CSS, afviser DOM-bygning i datamoduler, nye custom-elementer og katalogfamilier, kopierede/navngivne renderere, nye navngivne beholderrødder og tab af de fælles renderer-ruter. De eksisterende musik-/kø-rækkers kerneanatomi er også bundet. De kausale negative tests ændrer den faktiske kilde i en midlertidig kopi; de sammenligner ikke bare to ens lister.

Native HTML er byggesten inde i en komponent. En ekstra `span`, label, tilgængelighedstekst, korrektion af data eller eksisterende tilstandsvariant er ikke i sig selv en ny komponent. Registeret låser ikke hele renderfilers bytes, alle tags eller al copy. Nye navngivne renderere og ændringer af import/ejer/anatomi kræver derimod konkret review. En ren data-/motion-helper kan registreres som support uden at få tilladelse til at bygge DOM.

En ny komponent kræver før brug: konkret behov, hvorfor eksisterende rolle ikke dækker det, én navngiven ejer og fælles live/lokal renderer, anatomi/varianter/tilstande, handlingers ejerskab samt en visuel eksempelvisning. Brugeren godkender denne specifikation. Derefter tilføjes den præcise beslutning, scope og ejerskab til registeret og kontrollerne. En agent må ikke selv erklære en ny komponent godkendt, svække kontrollen eller omdøbe en kopi til “adapter”.

Kontrollen er en strukturel review-port, ikke en sikkerhedsparser eller et bevis for visuel kvalitet. Den kan ikke afgøre hensigten med vilkårlig kode inde i en eksisterende metode eller bevise, at en tekst i et approval-felt kom fra et menneske. Almindelig kilde-/visuel review og den faktiske menneskelige beslutning er fortsat nødvendige. PASS er kildeoverensstemmelse, ikke browser-, live- eller fysisk accept.
