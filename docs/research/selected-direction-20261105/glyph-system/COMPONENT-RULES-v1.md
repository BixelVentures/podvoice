# PodView · levende komponenter v1

Seneste visuelle sammenfatning efter brugerens afvisning af små/store ikonkopier: [direction-resolved-v4](direction-resolved-v4/README.md). Dens kildebundne billeder bruger de fremhævede referencer og erstatter det afviste v3-ark som designforslag; kittets faktiske ejere og kontrakter er uændrede.

Seneste positive brugerreferencer og sammenhængsaudit: [COHESION-AUDIT-2026-11-06.md](COHESION-AUDIT-2026-11-06.md). Hele kittet deler grammatikken; stort felt, instrumentdetalje og rolig betjening er forskellige roller. Dette ændrer ingen eksisterende kontrol- eller layoutanatomier.

Art direction · 6. november 2026. Revideret efter direkte brugerfeedback: videreudvikl de nuværende komponenter; opfind ikke et parallelt kit. Materialeforslagene nedenfor er ikke implementeret eller accepteret som nye komponentgeometrier. Runtime, animation og fysisk accept er ikke gennemført. Det direkte valgte visuelle anker er **exec-786c731f-985b-4c40-b059-1e016c0ece3f.png** — den oprindelige, rigt detaljerede komponenttavle. Senere forsøg med små hjørnepixels erstatter ikke dette valg.

Dette kapitel beskriver materialitet og adfærd inden i det eksisterende kit: Card, Hero, Tile, Icon, TopBar, Button, Slider, Toggle, ListRow og Dialog/Toast. Kittets eksisterende mål, renderere, handlingsejere og tokens er fortsat kanoniske: [COMPONENT-LIBRARY](/Users/madsbachandersen/Developer/podvoice/docs/COMPONENT-LIBRARY.md). Ingen ny komponentfamilie, state-bus eller lokal renderkopi er besluttet her. De genererede ark er visuelle illustrationer; reglerne nedenfor afgør betydningen ved en billedafvigelse.

### Neutrale handlinger · direkte brugerbeslutning 8. november 2026

Normale handlingsknapper bruger én neutral familie på tværs af domæner: mørk primær og lys sekundær; på mørk instrumentflade lys primær og mørk sekundær. Valgte faner/handlingsvalg følger samme neutrale kontrolgrammatik. Domænefarver bevares i identitet, materialer, flader og indholdsstatus—ikke som farvede CTA'er. Fare og fejl beholder deres særskilte semantiske behandling. Reglen erstatter tidligere brun opskrifts-CTA, lilla musikhandlinger og koral Færdig-knap samt modstridende billedstudier; den opretter ingen ny komponentfamilie.

De daterede konceptafsnit nedenfor bevarer deres historiske bevisniveau. Implementerede lokale kandidatregler og seneste billeder står i [leveranceoversigten](../../../UI-DELIVERY-GOAL.md); produktadoption og fysisk accept er særskilte.

## 0. Bindende afgrænsning: den nuværende komponent først

### Small er ét format · direkte brugerpræcisering 6. november

Lys, Tesla, Find musik, Radio, Opskrifter og inaktiv Timer deler samme ydre Small-mål: **199 × 177px** ved den aktuelle faste komposition. Ingen domænespecifik strækning. Materialefeltet tilpasses den samme ramme og må vige for label, status og tilbudt handling. Vejr Large er414 ×370px; Robot Medium414 ×177px; fælles mellemrum16px. Et firekolonners venstregrid er dermed844px bredt. Playeren følger sin selvstændige højde; resterende luft under venstregrid er ikke anledning til at strække Small-kortene. ImageGen-illustrationer er ikke målebevis; rendererens fælles størrelsestokens bestemmer målene.

**Dette afsnit har forrang over de frie ImageGen-ark og tidligere mål-/copyforslag nedenfor.** De tre atlasark viser grafiske muligheder, ikke en erstatning for de faktiske komponenter. De skal ikke implementeres som tegnede. Den oprindelige brugerudvalgte materialeretning bevares.

Aktuel kildecheck: canonical checkout HEAD `504f3ea1`, 6. november. Gemte QA-billeder er strukturreferencer fra5november, ikke nye enhedscaptures.

| Eksisterende komponent / ejer | Bevares konkret | Nyt materiale må kun |
| --- | --- | --- |
| TopBar `index.html` / `WidgetHost.renderTopbar`; separat `VoiceSurface` i `voice-surface.js` | Svar/history-handlingen og dens48px pille; separat statusnode med24px `.voice-mark`, `.voice-copy` og ejerens faktiske labels | Raffinere den eksisterende mark-rolle. Ingen nye faseknapper, ændret navigation eller animeret idle-Svar |
| Vejr `weather-view.js`: `#home-weather`, `.home-temperature`, `.home-condition`, `.home-forecast`; detaljens `.weather-current` | Faktiske størrelsesvarianter, temperatur, betingelse, prognoseceller, kilde/tid og navigation | Bearbejde eksisterende ikon-/illustrationslag eller dokumenteret ledig flade hos samme ejer; aldrig skubbe prognose væk eller skjule fakta |
| Robot `robot-control-panel.js` → eksisterende `pv-vacuum-widget.pv-hero`; `ui/library/components.js` | `.pv-instrument`, faktisk status/metadata, source-owned transport, separat faktisk progress; egne rum-/settingsområder | Berige instrumentet eller en faktisk ledig materialeflade inden i samme Hero. Ingen ekstra robot, dubletstatus, fiktiv progress eller ændret actionplacering |
| Robotindstillinger samme panel, `decorateLevel()` | ChoiceGroups,24px `vacuum`/`wind`/`drop`/`arrow-refresh`-ikoner, labels og faktisk tilbudte valg | Raffinere ikon-/feedbackrollen. Ingen nye controls eller omkodning af ukendte valg til en opdigtet kraftskala |
| Lys `LightRoomView` i `light-room-view.js` | Rumliste og power-Tile, særskilt navigation/ChoiceGroup, global handling kun når tilbudt, eksisterende Card med scener og Lamper-disclosure | Berige den eksisterende rum-/ikonrolle. Ingen ny pære-Hero, nested Sluk-knap eller scener fra et demoeksempel i live. Live global Sluk alt er skjult, når modellen ikke tilbyder den |
| Timer `TimerView` i `timer-view.js` | `.timer-instrument`, eksisterende SVG-track/progress, `.timer-copy`, kontroller og særskilt finish-anatomi; eksisterende overblikssammensætning | Forfine ringbåndets materiale. Native aktiv timer beholder faktisk tilbudte±60sek/Annuller. Ingen lokal Pause kopieret ind i native forløb |
| Feedback i den eksisterende aktiverede kontrol/kvittering/toast | Den konkrete handlings label, pending, receipt og effektbevis | Forfine samme feedbackslot. Klar/Afventer/Bekræftet på arkene er tilstandsforklaringer — de bliver ikke tre nye produktknapper |

### Hvad i atlasarkene der ikke er en komponentbeslutning

- De opfundne S/M/L-miniaturers rektangler/piller, skalering og layout erstattes af **de faktiske biblioteksspecimener**. Ingen ny geometri udledes af et ImageGen-billede.
- Headerens tidligere40–48px motivfelt/64px pille og label Arbejder er ikke den aktuelle kontrakt. Voice-mark er24px; fasecopy er **Lytter…, Tænker…, Svarer…, Spørg videre, Afslutter…, Venter…**.
- Timerens illustrative5:00/0:00-kort erstatter ikke komponentens faktiske finish, der viser **Tiden er gået**, eller dens native handlingsmuligheder.
- De store pæremotiver er materialestudier. De giver ikke en ny Lys-Hero, ny Sluk-knap eller en ekstra brightness-kontrol.
- Farve-/glyphparametre nedenfor er forslag til eksisterende token-/renderer-ejere. De indføres kun med konkret renderkontrol; ikke som lokal styling.

**Faktisk billedgrundlag:** [Robot i biblioteket](/private/tmp/podview132-robot-panel-proof/05-library-care-reference.png), [Robot klar](/private/tmp/podview132-robot-panel-proof/07-warm-840ms.png), [Native Timer i biblioteket](/Users/madsbachandersen/Developer/podvoice/docs/qa-native-timer-v2-20261105/podview-timer-library-local-running.png). Det er de gemte native/kit-referencer; en ImageGen-gentegning må aldrig kaldes en faktisk før-capture eller pixelpræcis målekilde.

### Arbejdsmetode for næste visuelle iteration

1. Identificér konkret komponent, størrelse, state, renderer og eksisterende billede.
2. Vis et faktisk udsnit som før-reference. Hold mål, indhold, tekstroller, ikonidentitet og handlinger fast.
3. Påfør kun den aftalte materialebehandling. Hvis den kræver nye pladser eller flytter kontrolroller, er forslaget uden for refinement og gennemføres ikke stiltiende.
4. Sammenlign før/efter ved samme størrelse og tilstand. Skærmkomposition er efterfølgende kontrol, ikke anledning til at opfinde nye komponenter.

## 1. Art direction: præcise, levende instrumenter

Det varme, rolige UI bærer et tæt, grafisk materiale. Et negativt mellemrum bliver til sky, lyskerne, robot eller timerring. **Detaljen må gerne være stor og rig.** Vi ensretter grammatikkens betydning, ikke alle motivers form. Hver flade har én tydelig funktion og én grafisk hovedidé.

Tre kanaler holdes adskilt:

| Kanal | Besvarer | Må ændre |
| --- | --- | --- |
| Form | Hvilket domæne eller hvilken type? | Silhuet: sky, nedbør, luft, vand, lys, ring |
| Tilstand | Hvad ved vi faktisk? | Samlet/brudt/stoppet form, valgt kant, kildebekræftet værdi |
| Styrke | Hvor meget, når det er kendt? | Begrænset celletæthed, udbredelse og strømningsrytme |

Farve identificerer domænet. **Bevægelseshastighed betyder aldrig fremdrift, kvalitet eller succes.** Procent vises kun af en faktisk kvantitativ måler. Interaktion må give en kort materialereaktion, men må ikke foregive ændret fysisk tilstand.

## 2. Fælles komponentanatomi

Hver opskrift samler fem eksisterende roller:

1. **Identitet:** genkendeligt ikon og domænenavn.
2. **Primær læsning:** status eller ægte måltal, aldrig begge i konkurrerende størrelser.
3. **Kontekst:** enhed, rum, tidspunkt og eventuel datatilstand.
4. **Motivfelt:** reserveret grafisk område; det flytter ikke tekst og kontroller.
5. **Handling/feedback:** kun aktuelle ejerudbudte kontroller med lokal pending/recovery.

| Størrelse/rolle | Motivets plads | Regel |
| --- | --- | --- |
| Header | Eksisterende24px voice-mark;48px status-/Svar-anatomi | Ét tydeligt tegn, fast tekstbaseline; status og history-action har hver sin ejer |
| Small widget | Kittets ikonfelt; eventuelt afgrænset sidefelt, hvis indholdet tillader det | Ingen beskåret miniudgave af et stort motiv; brug særskilt enkel silhuet |
| Medium widget | Kun eksisterende ledig ikon-/materialeflade, højst ca.20–35% | Ét rigt motiv med fri zone mod tekst/handling; indhold flyttes ikke for at opnå procenten |
| Large/Hero | Eksisterende instrument-/illustrationszone eller faktisk ledigt baggrundsfelt | Stor negativ form kun hvor den kan rummes; fakta, progress og controls beholder deres slots |
| Button/Slider | Eksisterende ikon-/feedbackslot | Ingen animeret tekstur bag labels, greb eller fokusmarkering |

Ydre mål og responsive brud følger kittet. Card/Tile-opskrifter bruger normalt24px inset og den registrerede24px radius; Hero beholder sin variantbestemte24/32px padding, og Dialog beholder32px padding/520px bredde. Inset, radius og kontrolmål er separate roller, ikke ét globalt mål. Der er16px mellem relaterede dele og32px mellem kontrolgrupper. Tekst: 28/34 sidetitel,20/26 status/korttitel,17/24 body/kontrol,15/20 metadata. Måltal bruger kittets særskilte talroller. Kontrolmål følger den konkrete registrerede variant — fx48px TopBar og64px øvrige relevante kontroller. En mindre synlig Sluk-cue giver ikke en ny nested knap eller ændret power-Tile.

Materialet bruger et deterministisk cellegrid: ca.6px grundtrin i store felter,4px i header/ikon, med2–3px kvadrater, punkter og få plusser. Samme identitet bevarer sit grid og sin seed. Det genudtrækkes ikke ved polling. Opacitet må ikke være eneste betydningsbærer. Ingen konfetti, glitter, glasskin, bevels, falsk scan eller shader på rigtige albumcovers.

**Materialeaccenter til v1:** vejr-celler koboltblå ca.#0756F8; robot-celler rose ca.#A6385D; lys-celler varm okker ca.#B87908; timer-kant koral ca.#FF8B73; kendt nat kan bruge et afgrænset marineblåt felt ca.#10245C med lyse celler. Det er foreslåede materiale-tokens til den eksisterende kit-ejer, ikke nye tekstfarver eller en global dag/nat-temaskifter. Flader og tekst bruger fortsat kittets domæne-/kontrastroller. Fejl bruger fare-rollen; stærkere sugeevne bliver ikke mere fare-rød. De præcise farvepar skal kontrast-/renderkontrolleres ved implementering.

## 3. Opskrift: Header / Svar

TopBar ejer placering og touch; den eksisterende samtaleejer leverer fasen. Den oprindelige tavles åbne glyph-apertur er materialereference til det eksisterende24px mark-felt; den skaber ikke et nyt større headerfelt. Den nuværende Svar/history-handling bevares uafhængigt.

| Faktisk fase | Statisk form | Bevægelse |
| --- | --- | --- |
| Hvile / ingen aktiv samtale | Åben, let cellekontur | Stille |
| Lytter | Modtagende, åben aperture | Rolig indadgående samling, mens den faktiske lyttefase varer |
| Tænker… (THINKING) | Tættere felt med stabil kerne | Kontrolleret omorganisering; aldrig en procentmåler |
| Svarer… (AI_SPEAKING) | Bredere, udadrettet form | Rolig udvidelse, kun mens talefasen faktisk er aktiv |
| Visuelt svar klar | Samlet, åben figur | Én landing på280ms; eksisterende ejer bestemmer visningens levetid |
| Afbrudt / forbindelsen væk | Brudt, statisk kontur + eksisterende statuscopy | Strømningen standser straks |

Ingen opdigtet lydstyrke, syllaberytme, mikrofontilladelse eller lyttestatus. Amplitudereaktion kræver et reelt tilbudt signal; det findes ikke som antagelse i v1. Svarhistorik og navigation bevarer deres eksisterende funktion.

## 4. Opskrift: Vejr-widget / atmosfærisk felt

Grafikken **viser vejrtype**, ikke bare en tilfældig bølge. Dens tidsbinding er den samme som tekstens: **Nu er nu; kl.16 er en prognose.** Vind fra en senere time må ikke animere Nu-kortet.

| Kildedata | Grafisk form | Dynamik og grænse |
| --- | --- | --- |
| Klar / sol | Klar negativ solskive med sparsomt felt | Langsom forskydning i motivfeltet ved aktivering |
| Let skyet / overskyet | Skyens negative form; større skydække ved overskyet | Blød formtransport; ingen præcis skyprocent udledt af en kategori |
| Regn / styrtregn | Sky og nedadgående cellestrømme; to adskilte kvalitative motiver | Styrtregn er tættere end regn; mm-tal bliver ikke mm/time uden kendt periode |
| Sne / slud | Krystalform; slud blander regn og krystaller | Krystaller driver; hverken glitter eller skærmfyldende partikler |
| Tåge | Lagdelt, lavt felt med blød negativ horisont | Meget rolig forskydning; tal og tekst er fortsat skarpe |
| Blæst + vind fra samme periode | Retningsbestemte cellekonturer | Hastighed normaliseres til m/s. Grafiske bånd:0–3,3–8,8–14,≥14m/s. Det er designbånd, ikke meteorologiske vindklasser |
| Torden | Sky med statisk brud/lyn-silhuet | Ingen blinkende lyn eller stroboskop |
| Kendt nat | Måneform og roligere felt i samme blå identitet | Kun kildeudbudt dag/nat eller gyldig clear-night; aldrig udledt af uret |
| Ukendt vejrtype | Neutralt, åbent felt | Ingen opfundet sol, regn eller nat |

Vindretning vises kun ved kendt bearing. Copy angiver **fra**-retning; formtransport kan gå derfra, mens det eksisterende retningssymbol følger ejerens konvention. Ved manglende bearing er motivet retningsneutralt. Manglende vindstyrke bruger en neutral kvalitativ rytme uden talmæssig styrkepåstand.

Nedbørsmængde og nedbørssandsynlighed bevares som to forskellige fakta. 80% regnchance betyder ikke80% kraftigere eller tættere regn. Vi viser sandsynligheden som eksisterende tekst/faktaværdi, ikke som motivets intensitet.

Friske fakta driver motivet. Sidst kendte fakta beholder form, temperatur, oprindeligt hentetidspunkt og tydelig copy; feltet bliver neutraliseret og statisk. Efter ejerens faste udløb fjernes de ugyldige fakta og erstattes af ærlig ukendt anatomi. En render eller reload fornyer ingen frist. Timeprognose kan udløbe, mens dagsdata stadig er gyldige. Ingen opdigtet UV, luftfugtighed, føles-som, radar eller solopgang.

## 5. Opskrift: Robot-widget / mekanisk felt

Robotkroppen er et fast centrum; en rig, afgrænset grafisk kappe fortæller aktivitet/type. Den må ikke ligne et gulvkort eller en faktisk kørt bane. **Drift, indstilling og kladde er adskilte lag.**

| Observeret tilstand | Form og bevægelse | Tilgængelig kontrol |
| --- | --- | --- |
| Ved basen / stoppet | Samlet, hvilende robotform; rig statisk sidekappe er tilladt | Hele kortet åbner detaljen; ingen ekstra Start-overbliksknap |
| Rengør · støvsugning | Indadgående, tørre luftsegmenter omkring robotkernen | Pause kun ved faktisk tilbud |
| Rengør · vask | Bredere, vandret vand-/dråbeceller omkring samme kerne | Samme ejerudbudte handlinger |
| Rengør · begge | Luft og vand deler samme felt i to stabile lag | Ingen dubletstatus eller ekstra vandpanel |
| På pause | Den aktuelle form fryser præcis hvor den er; tydelig tekst | Fortsæt kun ved faktisk tilbud |
| Til basen | Kappen samles mod et genkendeligt basesymbol | Ingen linje, rute eller ETA |
| Vasker/tørrer/tømmer ved basen | Særskilt lille aktivitetsfigur i samme instrument | Kun ved faktisk observeret dock-aktivitet |
| Fejl | Brudt kappe, statisk faremarkør, konkret fejlcopy | Bevar eksisterende tilbudt recovery; ingen rød blinksekvens |
| Ukendt / sidst kendt | Sidste gyldige form fryser og neutraliseres med korrekt copy | Ingen fortsat aktivitet ud fra gammel observation |

### Type, kraft og rengøringsvalg

| Faktum | Visuel kodning | Hvor |
| --- | --- | --- |
| Observeret Type | Luft / vand / begge bestemmer motivets geometri | Widget og detaljens status |
| Observeret Sugeevne | Tæthed og bredde i **luftlaget**, højst moderat ændring af tempo | Detalje; diskret i større widget |
| Observeret Vandmængde | Antal og bredde af **vandceller**; ikke tankniveau | Detalje; kun ved relevant mode |
| Rute / mop_mode | Kategorisk mønsterkarakter, fx jævn eller tættere passage | Rengøringsvalg; aldrig et rumkort |
| Antal gange | Tydelig1×/2×/faktisk tilbudt værdi | Egen eksisterende kontrol; ingen simulerede omgange |
| Faktisk clean_percent | Separat, tynd kvantitativ måler med tal | Kun frisk, forbundet og faktisk rengøring |

Styrke skaleres efter **de faktisk tilbudte ordnede valg**: n niveauer fordeles mellem ca.25–85% visuel celletæthed. Navne som Balanceret/Turbo/Maks. kommer fra ejeren; der opfindes ikke en universel femtrinsskala. Ikke-ordnede/ukendte valg ændrer ikke styrkegrafikken. Tæthed viser relativ indstilling, ikke watt, sugestyrke i Pa, kvalitet eller procent rent.

En usendt kladde kan vise et **statisk forhåndsblik i den valgte kontrols motivslot**, mærket Valgt. Den aktive robotgrafik bliver ved den observerede indstilling. Pending ligger i den aktiverede kontrol og viser Afventer. En accepteret kommando er ikke effektbevis. Først en frisk autoritativ observation ændrer driftsmotivet og må give en kort bekræftelse. Uafklaret udfald bliver Ukendt; ingen automatisk gentagelse.

Aktuelt rum er position/context; valgte jobrum kommer særskilt fra currentSetup.areas. Vi udleder ikke jobomfang fra robotposition. Manglende procent giver aktivitet uden procentmåler. Ingen ETA, kortgeometri, koordinater, varme-/dækningskort, tankprocent eller fysisk bevægelse udledes af grafikken.

## 6. Opskrift: Lys / lyskerne

Den valgte tavles store negative pære og tætte gyldne felt bevares som Large/Hero-motiv. Medium bruger et afgrænset lysfelt; Small et tydeligt pæretegn. Observeret lysstyrke regulerer feltets udbredelse og tæthed, ikke tekstens kontrast. Ukendt lysstyrke viser en kendt on-form uden opfundet procent. Slukket har en åben, hvilende pære; mixed har en eksplicit blandet form og tekst, ikke et beregnet gennemsnit af ukendte lamper.

Under slidertræk følger **kontrollens forhåndsvisning** brugerens intention; den observerede status forbliver adskilt indtil bekræftet observation. Farvetemperatur/farve får kun betydning ved faktisk tilbudte og observerede felter. Pending ændrer hverken hele forældrekortet eller øvrige lamper.

Rum-power Tile, rum-navigation, scenevalg og hele-hjemmet Sluk alt er forskellige roller. De må ikke slås sammen for at fjerne visuel gentagelse. En mindre synlig Sluk-cue følger den eksisterende power-Tile; Sluk alt findes kun ved faktisk tilbud og beholder sin eksisterende Button-variant; scener er valgt efter faktisk identitet, ikke udledt af lignende lysstyrke.

## 7. Opskrift: Timer / tidsinstrument

Den mørke flade og koralring er hovedmotivet. Ringens fyld er actual remaining / known total og følger timerens autoritative deadline; den har én sammenhængende restbue og én glyph-kant. Tid og handlinger står stille. Hvis total mangler, vises resttid uden en opdigtet procentbue. Pause fryser; deadline/justering gentegner samme timer uden ny indflyvning. Udløb følger TimerViews eksisterende finish med Tiden er gået og de faktisk tilbudte afslutningshandlinger; materialet må kun berige den eksisterende ringrolle. Ingen blink eller automatisk genstart. Idle Timer-genvejen har intet aktivt ur eller fremdrift.

## 8. Opskrift: Button, valg og feedback

| Tilstand | Form | Betydning |
| --- | --- | --- |
| Klar | Neutral, samlet glyph | Handlingen kan vælges; ingen checkmark |
| Valgt kladde | Eksisterende valgt kant/fyld + statisk intention | Endnu ikke sendt eller observeret |
| Tryk | Kort120ms lokal kompression/samling | Input er registreret, ikke udført |
| Afventer | Kompakt omorganisering i feedbackslot | Kun denne konkrete handling afventer |
| Accepteret | Rolig ventende form og eksisterende kvitteringscopy | Ikke Handlingen gennemført |
| Bekræftet effekt | Én280–420ms samling til check + konkret resultat | Kun ved relevant ejers effektbevis |
| Afvist / fejl | Brudt statisk tegn, fejl og konkret recovery | Ingen succesform |
| Ukendt udfald | Åben/brudt statisk figur og Ukendt | Ingen replay eller falsk fejl/succes |
| Utilgængelig | Statisk neutral markør og ærlig copy | Navigation kan stadig fungere |

Primær/sekundær følger den fælles neutrale og inverse regel ovenfor; destruktiv/fare og fejl følger deres særskilte semantik. Et tryk ændrer ikke forældrekortets animation. Fokus, selected, disabled og fare må aldrig afhænge af glyph-bevægelse. Toast har sin eksisterende portalplacering; modaler forbliver centreret over hele viewporten med ens scrim. Materialet animerer ikke scrim eller dialogposition.

## 9. Hvor vi er tilbageholdende

Musik/radio: originalt artwork og logo er urørte. Afspilningsstatus kan få en lille fasefigur i det eksisterende statusfelt, men ingen falsk equalizer uden lydsignal. Read-only progress har intet greb; seek-Slider kun ved faktisk tilbudt kapabilitet. Tesla: glyph-materiale må følge et konkret frisk felt som ladning/klima; frisk klima gør ikke lås eller adgang frisk. Ikke forbundet er statisk. Opskrifter: fremdrift følger faktisk markeret trin; ingen simulation af tid/tilberedning. Foto-Ro: fotoet og uret dominerer; ingen global ASCII-filtrering af private fotos.

## 10. Bevægelsesregler og sammensætning

| Hændelse | Designregel |
| --- | --- |
| Åbning / nye data ændrer faktisk tilstand | Én600–900ms materialetransformation fra den eksisterende form |
| Identisk observation / polling | Ingen ny bevægelse, seed eller intro |
| Aktiv samtale / pending | Lokalt faseforløb mens den faktiske fase varer; aldrig simuleret procent |
| Overblik | Én markant bevægelse ad gangen. Motiver må være rige statisk. Ingen automatisk animationskarrusel |
| Fokuseret detalje | Ét rigt procesmotiv kan leve, mens data er friske og brugeren har åbnet fladen. Kontroller/text flytter ikke |
| Berøring / pointer | Lille lokal deformation; må ikke ændre datakodet form, styrke eller status |
| Skjult, offscreen, utilgængelig eller stale | Stop framearbejde; behold den korrekte statiske/ukendte form |
| Tilbage / afbrydelse / ny hændelse | Retarget fra synlig form; ingen kø af gamle animationer |
| Eksisterende reduceret bevægelse | Færdig statisk form; ingen strømning/parallakse/glyph-transport. Data og timertekst opdateres stadig korrekt |

Små vindændringer inden for samme grafiske bånd flytter ikke motivets form. Som designmæssig hysterese kræves0,5m/s over/under en båndgrænse, før kraftlaget skifter bånd; det ændrer aldrig den viste faktiske vindværdi. Diskrete robotindstillinger skifter kun ved en ny observeret kategori. Hurtige nye observationer retargeter det eksisterende materiale fra den synlige form; statuscopy og kvitteringer opdateres straks og må ikke forsinkes af grafikken.

Fasefeedback i Header har første visuelle prioritet; derefter direkte manipuleret kontrol; derefter fokuseret proces. Uden disse får en direkte brugerudløst tilstandsændring én endelig materialetransformation. Samtidige baggrundsprocesser i overblikket beholder ellers deres rige, datakorrekte statiske former; der startes ingen rotationskarrusel eller tilfældig vinder. Den seneste direkte interaktion kan afbryde en ældre materialetransformation uden at ændre dens faktiske status. Essentiel lokal pending-markering og tekst forbliver synlig, også når dens ikke-essentielle materialebevægelse er undertrykt. Ingen ny global state-/command-ejer; dette er kit-kompositionens visuelle budget.

V1 lover ikke en bestemt shaderteknologi. WebGL/Canvas/SVG vælges efter faktisk ydelse og samme visuelle resultat. Designbudget: isolerede motivfelter, højst30fps under bevægelse, nul kontinuerligt framearbejde i statisk hvile. Hvis ydelsen svigter, reduceres felttæthed/opdatering, aldrig tekstlæselighed eller kontrolmyndighed. Længere ikke-essentiel bevægelse kræver en konkret kit-ejet stopmekanisme, der ikke pauser timer, robot eller musik. En sådan udvidelse er ikke en eksisterende bekræftet funktion og indføres ikke stiltiende her.

**Afgrænsning af bevægelsesvalg:** Den tidligere foreslåede nye Levende detaljer-Toggle er parkeret, ikke en eksisterende funktion eller del af denne refinement. Brug de eksisterende reduceret-bevægelse-/lifecycleejere. Ikke-essentiel vedvarende materialebevægelse må ikke indføres uden en passende, konkret kit-ejet stopmekanisme; indtil da er materialeforløb endelige. Det skaber ingen ny indstilling eller ekstra kontrol ud fra et atlasark.

## 11. Kontrol før implementering og accept

- Samme komponent i S/M/L og samme faktiske renderer i bibliotek/produkt.
- Nu/prognose, enheder, kildealder, manglende felter og recovery vises ærligt.
- Kladde→pending→accepteret→observeret samt afvist/ukendt prøves særskilt.
- Samtidig musik/timer/svar/robot må ikke miste identitet, ændre geometri eller konkurrere med flere store animationer.
- Gentagne identiske observationer, navigation, afbrydelse, hidden/offscreen, reduced motion og cleanup kontrolleres.
- Product Design og Impeccable gennemgår faktisk renderede komponenter og kompositioner; statiske ImageGen-ark er designbevis, ikke funktions-/enhedsaccept.

## Datagrundlag og UX-referencer

Kildeafstemt mod publiceret2.0.136, commit69b357b72cdd451751e0c3ea72d3feed4c8c9527. `weather-observation.js`/`weather-view.js` og `robot-observation.js`/`robot-control-panel.js` matcher denne kilde. De eksisterende ejere bestemmer observationer, frister, kapabiliteter og effektbevis; dette dokument opfinder ingen.

W3C understøtter bevægelsesvalget: [Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) beskriver mulighed for at deaktivere ikke-essentiel interaktionsanimation (AAA); [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) beskriver brugerens kontrol over relevante automatiske bevægelser/opdateringer (A). Vores design vælger desuden **ingen blinkende effekter**, stærkere end at designe op til en blinkgrænse; se [Three Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html). Dette er designkrav, ikke en påstand om WCAG-godkendelse.


## Implementeringskontrakt 8 november

Første implementering bygger videre på ovenstående eksisterende anatomi. Dette er en konkret designkontrakt, endnu ikke implementeringsbevis. Fremdrift ligger i UI-DELIVERY-GOAL.

### Fælles materiale og tidsforløb

- Ét deterministisk SVG-cellegitter pr. eksisterende motivzone. Cellepositioner bevares ved opdatering. Form skabes gennem maske, tæthed og negativt rum. Ingen tilfældig genfordeling eller ekstra stort identitetsikon.
- Startværdier til renderprøven: 7 CSS-px gitterafstand ved fuld widgetstørrelse, cellebredde 1–4 px, celler klippes til eksisterende flade. Det lille headerinstrument tegnes særskilt på samme princip i sin eksisterende 24 px rolle. Målene er prøvetokens og valideres visuelt inden adoption.
- Motivet viger for titel, status, metadata, kontroller og fokus. En lang label reducerer motivzonen. Motivet er dekorativt og ikke en ekstra tilgængelig statusnode.
- Trykrespons starter straks, 100–150 ms på den aktiverede kontrol. Den må aldrig skalere forældrekortet ved tryk på en underkontrol.
- Afventer bruger eksisterende busy-/receiptrolle. Sidst observerede domænetilstand bevares. Ingen animation må ligne en effektbekræftelse før observation.
- Observeret tilstandsskift får 180–280 ms lokal overgang. En større materialeforandring må bruge op til 420 ms. Samme statusopdatering genstarter aldrig bevægelsen. Nyere state afbryder og overtager den igangværende overgang.
- Ingen permanent ambient løkke. En vedvarende proces kan have en stabil retningsform, mens faktiske tal/progress opdateres af eksisterende ejer. Aktivitet betyder ikke konstant bevægelse.
- Reduceret bevægelse viser den nye statiske form og samme tekst/feedback. Skjult eller afmonteret komponent stopper animation og rydder lokale callbacks. Ingen dekorative timere eller ekstra polling.

### Tilstandstabel for første kodepakke

| Komponent | Observeret tilstand | Materiale | Handling og overgang |
| --- | --- | --- | --- |
| Lys | on | Ravkerne i ledig motivzone. Faktisk observeret procent kan styre tæthed; uden procent anvendes fast on-form | Tilbudt Sluk bevares. Kort udslukning først ved observeret off |
| Lys | off | Stille neutral kerne med samme placering | Tilbudt Tænd. Observeret on samler feltet |
| Lys | mixed | Afgrænset delt felt med eksisterende mixed-label | Ingen opdigtet gennemsnitsprocent |
| Lys | pending | Bevar sidst observerede form | Afventer på eksisterende kontrol; ingen foregrebet off/on |
| Lys | stale/unknown/unavailable | Stille nedtonet form når sidst kendt data findes, ellers neutral flade | Eksisterende labels, navigation og adgangsregler |
| Robot | docked | Samlet mekanisk rosekontur i ledig kantzone | Stille, ingen rengøringsbevægelse eller ekstra overbliksknap |
| Robot | cleaning | Åben kanal i samme kontur | Kort retningsskift ved indgang. Faktisk procent forbliver særskilt instrument og er ikke forudsætning for materialet |
| Robot | paused | Samme kontur fastholdes, roligere kontrast | Tilbudt Fortsæt; identitet og reserveret plads bevares |
| Robot | returning | Samlet retningsform mod kant | Ingen opdigtet rute, position eller resterende tid |
| Robot | pending | Bevar observeret form | Ejerens afventende handling vises lokalt |
| Robot | error/unknown/stale | Stille form, tydelig eksisterende status | Ingen implicit success, retry eller fake aktivitet |
| Timer | idle | Charcoal Small og eksisterende ikon | Ingen falsk ring eller progress |
| Timer | running | Eksisterende koralring med kort celleafslutning, bundet til den faktiske ringende | Eksisterende deadline ejer fremdrift. Ingen ny nedtællingsejer |
| Timer | finished | Ringens slutform og eksisterende finishtekst | Én kort afslutning. Ingen gentaget blink eller lyd fra materiale |
| Timer | pending/error/unavailable | Bevar eksisterende instrumentets ærlige state | Native actions forbliver ejerudbudte; lokal fixture-Pause bliver ikke en produktkapabilitet |

### Kausale acceptprøver

1. Lys on → tryk Sluk → pending → observeret off. Pending beholder on-formen. Fejlet kommando beholder observeret status og forklarer fejlen. Room/detail og overview deler formreglen.
2. Robot docked → cleaning uden procent → cleaning med procent → paused → resume. Materialet er til stede med og uden procent. Pause fastholder motiv og mål. Pending foregriber ingen tilstand.
3. Timer idle → running → deadlineændring → finished. Celler følger eksisterende ring. Et uændret render giver ingen ny afslutningsanimation. Native kontrolmuligheder bevares.
4. Hurtigt skift, gentagen identisk observation, reduced motion, skjul og afmontering. Ingen efterladte animationer eller timers. State og handlinger kan stadig aflæses uden materialet.
5. Fælles overblik i hvile og under én handling. Seks ens Small, bevarede tekstzoner, samme fokus-/DOM-rækkefølge som det viste grid. Ingen aktivitet i øvrige kort som følge af én underkontrol.


### Verificeret ejerbinding og første snit

Kildecheck af `5cf897a4` bekræfter følgende bindingspunkter. Den gældende arbejdsrækkefølge er **Robot → Tesla → Find musik → Opskrifter**, derefter øvrige domæner og fælles dele. Lys har lavere prioritet. Tabellen kortlægger ejere og angiver ikke prioritet.

| Område | Eksisterende ejer | Binding |
| --- | --- | --- |
| Lys og Robot overblik | `ui/resource-tile.js` | Observeret `data-resource-status` holdes adskilt fra pending/stale i `data-kit-state` |
| Lys rum | `light-room-view.js` | `data-power-on` og separat loading. Rum har ingen opfundet brightness |
| Lys lampe | `light-lamp-view.js` | Observeret `row.level` 0–100. Sliderdraft er intention, ikke effekt |
| Robot detalje | `robot-control-panel.js:updateObservation()` og `robot-observation.js` | Valideret device.status og freshness. Materiale uafhængigt af `.player-progress` |
| Robot bevægelse | `ui/robot-motion.js` | Udvid eksisterende deduplikering, reduced motion, visibility og cleanup |
| Timer | `timer-view.js:card()` og `timer-model.js` | Eksisterende `data-status`, `data-stale`, `data-progress-known` og `--progress` |
| Fælles visuelt lag | `ui/components.css` | Samme materiale-/motiontokens for bibliotek og produkt |
| Overblik rækkefølge | `WidgetHost.alignOverview()` og `scene-model.js` | Samlet Small-betingelse samt fælles visuel/DOM-rækkefølge |

`comparison/inert.js` forbliver fixture-/lydløshedstilpasning. Den skal ikke have en ny MutationObserver, animationsejer eller produktstate. Førreference beholdes på frosset kilde, mens den nye kolonne ved integration bindes til den ændrede kanoniske renderer.


## Bevægelse, overgang og feedback på tværs · 8. november

Direkte bestilling: indsamle muligheder på tværs af alle dele, mindst som noter, uden at kræve at alt bygges i prototypen straks. Tabellen er et designforslag til visuel afprøvning. Den er ikke implementeringsbevis. Domænefarve følger hele forløbet og arbejder med flade, tekst, materiale og valg. Eksisterende brugerhandlinger og observerede tilstande er grundlaget.

### Tre visuelle roller

**Materiale:** celler, negativt rum og instrumentkant bærer identitet og observeret tilstand. **Overgang:** bevarer sammenhæng mellem widget, detalje, valg og indhold. **Feedback:** reagerer på den konkrete berøring og fortæller om afventer, effekt eller fejl. De tre roller behøver ikke bevæge sig samtidig.

| Del | Visuel mulighed | Udløser og afslutning | Vigtig afgrænsning |
| --- | --- | --- | --- |
| Robot | Mekanisk rosekontur åbner kanaler ved rengøring. Pause holder formen. Tilbage til base samler kanten | Ny observeret fase giver én kort overgang; ender i stabil form | Ingen falsk rute, procent eller rengøringsbevægelse ved pending |
| Robot indstillinger | Valgt suge-/vandniveau lander med domænefarve i eksisterende valg og ikon | Tryk viser draft/afventer efter ejerens model; observeret indstilling afslutter feedback | Ingen ekstra kraftskala eller ændret ikonbetydning |
| Tesla | Salviefarvet instrumentkant ved batteri, kort energiretning ved observeret ladestart. Klima kan få en lokal overgang ved temperatur/status | Bekræftet ladning/klimaændring; stabilt efter 200–420 ms | Ingen ladeløkke ved offline, ingen opfundne sensorer eller opladningsprocent |
| Find musik | Valgt cover og titel bevarer deres relation fra resultat til player. Kort respons i det valgte søgeresultat | Navigation/valg reagerer straks; player opdateres ved ejerbekræftelse | Cover må ikke foregive afspilning før accept; ingen falsk equalizer |
| Søgning | Eksisterende indhold bevares under forespørgsel; lokal indikation i søgefelt; nye resultater lander samlet | Forespørgsel starter afventer, kun aktuel forespørgsel afslutter | Ingen animation pr. tast eller forskydning af tekst under læsning |
| Radio | Stationsmærke og valgt flade får én diskret landing i radioens farvefamilie | Bekræftet stationsskift | Station valgt og faktisk afspiller er forskellige tilstande |
| Opskrifter | Billede og titel binder oversigt til opskrift. Ingrediensafkrydsning får lokal feedback; aktuelt trin markeres tydeligt | Navigation og eksplicit afkrydsning/trinskift | Kun hvor eksisterende komponent tilbyder handlingen. Ingen automatisk opskriftfremdrift |
| Vejr | Negativt vejrtegn former koboltfeltet. Ændret aktuel vejrtype omformer feltet kort | Ny gyldig observation med ændret semantik | Opdatering af timestamp alene er stille; prognose bliver ikke nutid |
| Timer | Koralcellernes afslutning følger den eksisterende rings ende. Udløb har én kort afslutningsmarkering | Eksisterende deadline/progress og faktisk udløb | Ingen ekstra ur/polling, blink eller lyd. Skel mellem ukendt og afsluttet |
| Lys | Ravkerne ændrer tæthed med observeret styrke. On/off samler eller åbner feltet | Bekræftet effekt; lokal sliderdraft følger fingeren særskilt | Rum uden procent får on/off-form. Afventer bevarer observeret lys |
| Header/Svar | Lille fasefigur i samme 24 px mark: lytter, behandler, svarer. Faseskift forandrer figuren lokalt | Faktisk samtalefase; afbrydelse stopper straks | Hvile står stille; responsiv figur er ingen lydmåler uden lyddata |
| Player | Pause/play skifter præcist i den eksisterende kontrol. Coverovergang ved faktisk trackskift. Outputvalg kvitteres ved højttaleren | Ejerbekræftet transport, track eller output | Seek og volumen har egne drafts; deres betjening må ikke animere hele playeren |
| Small-genveje | Fælles kant-/farverespons og kort ikonrespons ved aktivering | Pointerdown/focus/aktivering, 100–150 ms | Ingen genvejsambient eller bevægelse blot ved scroll. Underkontrol påvirker kun sig selv |
| Buttons/toggles | Øjeblikkelig pressrespons, tydeligt fokus; pending i samme reserverede feedbackplads | Berøring/tastatur → afventer → observeret effekt/fejl | Ingen flyttende label eller for tidlig success. Deaktiveret bevarer læsbarhed |
| Chips/segmented | Valgt markering flytter eller skifter roligt mellem faste pladser | Nyt faktisk valg eller lokal draft i eksisterende rolle | Rumvalg, navigation og kommandovalg må ikke få samme semantik |
| Sliders | Greb følger input uden forsinkelse. Faktisk værdi kan kvitteres med kort domænefarve | Input → commit → observation | Ingen springende talbredde, konstant glød eller simuleret effekt |
| Lister/disclosures | Afgrænset åbning viser relation til trigger; eksisterende indhold forbliver forankret | Eksplicit åbning/lukning | Ingen stykvis koreografi på alle rækker; fokus bevares |
| Navigation/widget→detalje | Domænefarve og ikonplacering giver genkendelse; kort crossfade i indholdsfelt, stabil header/player | Navigation; ender med korrekt fokus og bevaret scroll/valg efter kontrakt | Ingen fuld sideflyvning eller forsinkelse af næste handling |
| Dialog | Samlet viewport-overlay, kort lokal fremkomst og hurtigere lukning | Eksplicit åbning/lukning; fokus ind og retur | Hele viewporten og centrering bevares; ingen domænehandling ved animation |
| Toast/receipt | Kort ind/ud i eksisterende portal. Lokal kvittering følger relevant handling | Ejerens resultat, afslutning efter eksisterende levetid | Ingen ny layoutplads, overlay eller gentagne skærmlæserbeskeder |
| Svarformater | Indhold lander i stabile blokke; graf/trin/checkliste kan fremhæve reel ændring lokalt | Relevant ny eller afsluttet indholdsdel | Ingen genanimation af hele svaret ved streaming, ingen opdigtet talprogress |
| Historik | Valgt svar bevarer identitet til genåbnet svar | Eksplicit åbning og retur | Gamle data må ikke præsenteres som nye observationer |
| Ro/Hjem | Foto får ro; aktive widgets bevarer deres status, skift til overblik er kort og forankret | Brugerens berøring eller eksisterende navigation | Ingen ambient bevægelse oven på foto, ingen genstart af timer/musik |
| Adgang/setup/offline | Lokal forklaring og statusovergang i eksisterende formular eller banner | Faktisk forbindelses-/adgangsændring | Ingen optimistisk forbundet-status eller opfundet readiness |
| Fejl/recovery | Relevant kontrol får tydelig fejltekst og rolig kontrast. Bevar data og valg | Bekræftet fejl/ukendt udfald; recovery kun ved eksisterende tilbud | Ingen shake, automatisk retry eller rød farve som eneste forklaring |

### Fælles teknik og prøvebudget

CSS styrer farve, korte opacity-/transformovergange og pressrespons. SVG/masker definerer det præcise cellenet og instrumentets negative rum. Eksisterende JS-ejere leverer observation og afbrydelse. Brug WAAPI kun når en sekvens har brug for eksplicit cancel og deduplikering. Nye WebGL/shaderafhængigheder vælges kun, hvis et konkret visuelt mål ikke kan nås med den enklere løsning og en måling på målskærmen understøtter det.

Start med 100–150 ms kontrolfeedback, 180–280 ms almindeligt tilstandsskift og højst 420 ms markant materialeovergang. Endelig timing besluttes ved visuel afprøvning. Én aktiv handling bør normalt have ét tydeligt fokuspunkt. Uafhængige reelle hændelser må ikke skjules for at opfylde et dekorativt aktivitetsbudget.

Reduced motion bruger statiske slutformer og øjeblikkelig korrekt feedback. Ingen information forsvinder. Uændrede observationer er stille. Hurtige skift afbryder den gamle sekvens. Afmontering, skjult side og offscreen stopper ikke-nødvendigt animationsarbejde. Kontroller altid handlingens latens, billedro, tastatur/fokus og faktisk frameadfærd med realistisk indhold.

### Visuelt bevis før adoption

For hver valgt idé vises samme komponent før/efter i sammenligningen, et faktisk klikforløb og dens placering i en hel skærm. Product Design og Impeccable vurderer anker, farvefamilie, hierarki, spacing, læsbarhed, bevægelse og afbrydelse. Notér konkret om idéen er foreslået, kodet, visuelt prøvet eller brugeraccepteret. Denne samling er foreslået; en statisk illustration dokumenterer ikke animation.


### Art direction: hvor meget får hver del?

Samme familie betyder samme cellegeometri, farveroller og respons — ikke samme effekt på alt. Fordel detaljerne i tre niveauer:

1. **Identitet i widget og hero.** Ét indlejret felt eller instrument pr. flade, med reserveret tekstzone. Domænets farve og negative rum gør det genkendeligt. Brug ikke et stort gentaget ikon, når det lille allerede gør arbejdet. Materialet må være statisk og stadig føles gennemarbejdet.
2. **Relation i detaljer og valg.** Genbrug farven i sektionsankre, valgt rum, valgt indstilling og værdier. Undlad at gentage heroens store felt i hvert underkort. Indhold som covers, opskriftsfoto og stationsmærker har første ret til opmærksomheden.
3. **Præcision i betjening.** Knap, slider, toggle og kvittering får lokal, kort respons. Bevar neutral fælles struktur og neutral markering af handlingsvalg. Domænefarvet status/materiale må ikke farve handlingsknappen. Fejl og tastaturfokus følger fælles regler, ikke domænets dekorative farve.

**Eksempel Robot:** rose i widget → samme mekaniske kontur i hero → neutralt valgt rum/indstilling → lokal afventerfeedback på handlingen → kontur skifter først ved observeret rengøring. Pause fastholder form og plads. **Eksempel Tesla:** salvie i widget → batteriinstrument og hero → neutrale aktive klimavalg → lokal kvittering. Den faste player bliver ikke grøn, fordi Tesla er åben.

**Farve skal fortjene sin plads · direkte brugerpræcisering 8. november:** En ny widgettype får ikke automatisk sin egen farve. Bevar de etablerede Vejr/Robot/Lys/Tesla-familier, og brug dem konsistent fra widget til detalje og lokal feedback. Musik, Radio og Opskrifter afprøves først med neutral struktur og deres eget indhold som identitet. En ny accent er et forslag, indtil den viser en konkret gevinst for genkendelse, valg eller feedback i det samlede overblik.

Før en farve eller effekt adopteres, skal den kunne svare på: Hvad hjælper den brugeren med at genkende eller forstå? Hvor gentages den meningsfuldt gennem flowet? Hvad betyder den i hvile, afventer, bekræftet effekt og ukendt tilstand? Hvis svaret kun er “mere liv”, fjernes den eller erstattes af bedre form, hierarki eller berøringsfeedback. Farve er aldrig eneste bærer af tilstand.

Samme look skabes af fælles proportioner, typografi, overfladekontrast, cellegeometri og respons. Det kræver hverken samme effekt på alle kort eller en regnbue af domæner. Covers, stationsmærker og opskriftsbilleder kan bære identitet; et ekstra farvelag må ikke konkurrere med dem. Ukendt/offline stopper aktivitetsmateriale, men bevarer genkendelse og læsbarhed.

### Hypoteser der skal vises, før de bygges bredt

- **Cellefelt som tilstand:** ændr kanal, tæthed eller negativt rum med observerede data. Afprøv Robot og Tesla først. Et skift må kunne forstås gennem tekst uden at afkode grafikken.
- **Instrument med celleafslutning:** brug detaljer på en eksisterende batteri-/timerring eller kant. Bevar præcis aflæsning; celler er ikke ekstra datapunkter.
- **Forankret indholdsovergang:** samme cover, opskrift eller stationsidentitet giver sammenhæng fra valg til detalje. Afprøv en enkel crossfade før kompleks shared-element-animation.
- **Taktil overflade:** kort kontrast-/kantændring ved tryk, uden glans, svævende skygger eller skalering af hele kort med underkontroller.
- **Shader som mulig udførelsesteknik:** kun hvis den giver en tydelig kvalitet ud over SVG/CSS. Det visuelle mål er præcist, datadrevet materiale; teknologien er ikke et krav. Ingen vedvarende pointereffekt som primær oplevelse på touchskærmen.

Hvert forsøg registreres i den eksisterende leveranceoversigt som **idé → visuelt studie → kodet prøve → visuelt og interaktivt kontrolleret → brugeraccepteret**. Denne notesamling er på idéniveau; tidligere billeder og kodeprøver beholder deres egne bevisniveauer.

## Direkte feedback · 9. november 2026

- Small-timerens overblik viser nedtælling og handling, uden sekundær “Slutter …”-linje. Detaljens tidsoplysninger bevares.
- Lysmaterialet har en genkendelig pære i negativt rum; det deler den eksisterende observation af on/off/unknown og lysstyrke.
- Materialefeltets yderkant kan gå til kortkanten og klippes af kortets radius. Tekst og betjening beholder deres padding og frizone. Friformsmateriale skal ikke ligne et lille indsat mærkat; selve symbolet skal stadig kunne genkendes.
