# PodView · audit af den højre kolonne

8. november 2026. Product Design og Impeccable. Visuelt anker er den oprindelige valgte tavle **PodView · levende detaljer**. Det valgte v4-overblik viser, hvordan tavlens idéer fordeles over et helt hub. Kandidaten er den højre kolonne fra det lokale sammenligningsbibliotek. [Visuelt anker](../../DIRECTION.md) · [Valgt overblik](../references/01-overview.png)

**Dom.** Kandidaten har en genkendelig familie af flader. Den mangler en fælles adfærd, når huset skifter tilstand eller brugeren trykker. I inspirationsbilledet ligger karakteren i, at et fast kvadratgrid skærer eller bygger noget genkendeligt. Skyen bliver et hul i feltet. Lyset samler sig om en kerne. Timeren opløser kanten af sit eksisterende ur. Det kan blive PodViews signatur, hvis de samme celler får forskellige roller i samme produkt.

## Observeret i browseren

| Trin | Fund | Designkonsekvens |
| --- | --- | --- |
| 1. Se hele overblikket | Vejr, Robot og Lys har statiske felter. Vejrets negative sky kan aflæses. Lys har et afgrænset ravfelt, som holder status læsbar. Robot fylder et stort hjørne med en ensartet rasterflade. De nederste genveje bruger forskellig farve og ikon, men fællesheden ses svagere. | Giv Vejr den største signatur. Brug en mere karakteristisk kurve eller et tydeligt tomrum på Robot og gør hvileformen roligere. Lad genvejene dele kant, typografi, fokustilstand og trykrespons. [Overblik](01-overblik.png) |
| 2. Åbn Lys og tryk Sluk for Køkkenet | Køkkenet skiftede farve, label og tilbudt handling fra Tændt til Slukket. Stuen forblev tændt. Rumkortet havde allerede ved start en ensfarvet flade uden ravmaterialet fra overblikket. | Genbrug samme lille lyskerne i rumkortet. Dens tæthed kan følge bekræftet lysstyrke. Når kun on/off kendes, er to former tilstrækkelige. [Før](02-lys-foer.png) · [Efter](03-lys-efter.png) |
| 3. Se Robot i gang og tryk Pause | Den aktive detalje havde 38 % og et lille felt, der visuelt lignede feltet ved basen. Pause skiftede til “Rengøring på pause” og “Fortsæt”, mens både den grafiske detalje og den aktive måler forsvandt. | Samme mekaniske kontur skal kunne genkendes gennem hele forløbet. Ved basen samles den langs én kant. Rengøring åbner en retningsbestemt kanal. Pause fastholder den som en stille form. Den faktiske måler følger fortsat ejerens data. [Aktiv](04-robot-aktiv.png) · [Pause](05-robot-pause.png) |
| 4. Se den aktive Timer | Den koralfarvede ring er allerede et læsbart instrument. Kandidaten ændrer farve, mens referencebilledets cellekant mangler. Den lokale demo har Pause. | Læg få celler ved ringens eksisterende ende. Det viste tal og den faktiske resterende tid styrer stadig ringen. Bevar native timerhandlinger ved en implementering. [Timer](06-timer-aktiv.png) |

## Ét sprog fordelt over hele hubben

| Flade | I hvile | Når der sker noget |
| --- | --- | --- |
| Vejr | Tydeligt negativt vejrtegn i kobolt med fri prognosezone. | Samme gitter går kort over i en ny form, når den aktuelle vejrtilstand skifter. |
| Robot | Samlet mekanisk rosekant ved basen. | Åben kanal ved rengøring, fastholdt ved pause. Ingen kortillustration eller fremdrift udledt af feltet. |
| Lys | Ravfelt med en lyskerne ved tændt. Neutral kerne ved slukket. | Kort samling eller udfoldelse ved observeret effekt. Styrke kan følge faktisk lysstyrke, når den findes. |
| Tesla | Stille bilikon, sageflade og tydelig tilgængelighed. | En kort cellekant ved det eksisterende batteri- eller ladeinstrument, når ladning er observeret. |
| Find musik | Genvejens eksisterende ikon og tydelig handling. | Tryk samler sig om ikonet. Albumomslag og playeren bærer den vedvarende visuelle identitet. |
| Radio | Stille radioikon og tydelig stationstekst. | Faktisk stationsskift giver en kort landing ved stationens mærke. |
| Opskrifter | Stille bogikon og genkendelig genvej. | Dens karakter ligger i en kort sideåbning ved navigation og i rigtige madbilleder i detaljen. |
| Timer | Mørkt Small-kort og timerikon. | Koralring med en cellekant ved aktiv nedtælling. Én afslutning ved udløb. |
| Svar og Player | De eksisterende kontroller og cover. | Svarmarkøren får materiale ved en reel samtalefase. Playerens feedback bliver på den aktiverede kontrol eller ved bekræftet outputvalg. |

## Det tekniske bud

Brug et stabilt SVG-gitter og ét maskeprincip i det eksisterende motivfelt. CSS styrer farve, tæthed og korte lokale overgange. JS modtager ændringer fra den eksisterende renderer og udløser reaktionen én gang. Lad samme gitter stå fra opdatering til opdatering. Begynd med **tryk**, **afventer** og **observeret effekt** som forskellige øjeblikke. Tryk svarer straks i kontrolfladen. En ventende handling bliver på kontrollen. Først den observerede effekt ændrer kortets betydning. Fejl får forklaring ved den berørte handling.

Første designprøve bør være ét overblik med **Robot ved basen → rengør → pause**, **Lys tændt → slukket** og **Timer tom → aktiv**. Se helheden i hvile og under én handling. Hver status skal kunne læses med tekst og fokus. Reduceret bevægelse beholder de statiske former og resultatet. [SVG-masker i CSS](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image) · [Reduceret bevægelse](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) · [Tilgængelige statusbeskeder](https://www.w3.org/WAI/WCAG21/Understanding/status-messages)

## Teknisk fund og evidensgrænse

Det brede overblik placerer Timer nederst til højre med CSS, mens den kanoniske DOM-rækkefølge stadig lægger Timer først. Det giver forskellig læse- og fokusrækkefølge. Følg det fælles visuelle grid i DOM'en, når overblikkets ændring implementeres.

Robotmaterialet er bundet til en synlig fremdriftsmåler. Bekræftet rengøring uden procent kan derfor miste mønstret. Lysmaterialet er bundet til klar og tændt på overblikket, så en afventende kommando kan fjerne feltet, selv når den observerede tilstand stadig er tændt. Bind begge til den observerede domænetilstand og hold afventerfeedback på kontrollen. Musik skifter til Small ved 1100 px, mens griddet også kræver tilstrækkelig højde og en inaktiv timer. Brug samme betingelse for begge. [Kandidatens visningsregler](../candidate.css) · [Lokal previewopsætning](../inert.js)

Impeccable gav ingen blokerende fund i den scannede markup og CSS. Et råd om gentaget gradient ramte den lille ternede markør i bibliotekets egen topbar. Browserobservationerne er fra lokale eksempler ved 1280 × 720. Lys og Robot blev afprøvet lokalt. Forslagene til animation, reduceret bevægelse, tastaturflow og fysisk touch har endnu ingen implementeringsevidens i denne audit.
