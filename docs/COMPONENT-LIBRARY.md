## Aktuel kandidat · faktisk afspilning og read-only recovery ·24 oktober2026

Samme eksisterende PlayerView, LiveMediaView, LiveControlView, LiveQueueView og SpeakerOutputView bruges i produkt og bibliotek. Ingen ny komponentfamilie. Den samlede lukkede v2-servicekontrakt står i [PODVIEW-CONTRACT](PODVIEW-CONTRACT.md); historiske v1-afsnit nedenfor er ikke v2-reglen.

- Aktuelt output er den faktiske native binding, adskilt fra konfigureret standard og næste ønskede afspilning. Navne formateres kun ved præcis optaget katalogidentitet. Standard/NEXT må aldrig erstatte aktuelt output. Et tidligere valideret navn kan bevares som læsbar tekst for samme konto/native-par og samme boot/rum/provider/transport, selv når kataloget udløber. Denne navnecache giver ingen aktuel katalogmarkering eller handling; identitets-/ejerskift, adgangsafvisning og oprydning rydder den.
- Frisk kontometadata uden bekræftet rute bruger den eksisterende kontostatus/højttaler-ikke-bekræftet rolle og ingen aktuelle transport-/køkommandoer. Udløbet rute er ikke det samme som Green-tab.
- Midlertidigt læse-/transportudfald beholder optaget cover, sang, kunstner, navigation og ærlig sidst-kendt status; kontometadata må heller ikke ligne live state efter udløb. Frisk idle rydder aktiv afspilning. Ejer-/rum-/adgangsskift må ikke genindføre gammel visning eller tilbud.
- Aktuel outputmarkering og aria-pressed i den eksisterende ListRow følger præcis frisk native binding, ikke katalogets selected-hint. En tidligere faktisk markering kan kun bevares med sidst-kendt tekst, uden pressed/effektmyndighed.
- Aktuelle kommandoer kræver egne friske servertilbud med samme forventede binding. Ingen automatisk effekt-replay, optimistisk lydpåstand eller ny seek. Layout, coverramme, tekst- og kontrolmål forbliver kittets eksisterende roller.
- Direkte feedback24oktober: den eksisterende read-only tidslinje opdateres hvert sekund under frisk observeret afspilning fra kildens position og observationstid, højst til samme observations udløb og sangens varighed. Det er en lokal beregnet visning, ikke en ny providerobservation, seek eller afspilningskommando. Pause, ny kildeposition, sang-/ejerskift og oprydning erstatter eller stopper uret; udløb vises som sidst kendt.
- Lydstyrke er en absolut procentskala0–100. En servergrænse på eksempelvis35% ændrer ikke35% til et fuldt slider-spor. Lovlige effektgrænser valideres særskilt ved eksplicit betjening. LiveControlView ejer én samlet kontrolprojektion pr. render; en mellemprojektion må ikke nulstille eller deaktivere et fortsat gyldigt tilbud. Manglende faktisk lydstyrke vises ukendt uden opdigtet værdi eller automatisk korrektion.
- Den senest validerede lydstyrkemåling må bevares deaktiveret for præcis samme boot, rum, provider, konto, ejerepoke, faktiske native binding og transport, også når kontroltilbuddet udløber. Målingen giver aldrig effektmyndighed. Ny ukendt måling, valgt pending start, idle, ubundet afspilning, tilbagekaldt adgang eller ændret ejer rydder den. Ukendt volumen har neutral midterplacering, “—” og tilgængelig label “Ukendt lydstyrke”; det er ingen måling på50%. Faktisk0% forbliver0%.
- Et eksplicit musikvalg viser straks de valgte metadata som afventende, også under nødvendig kildefornyelse; det er ikke observeret afspilning. Efter en accepteret kvittering kan den eksisterende LiveMediaView følge passive læsninger i højst8sekunder. Samme ejers læsninger samles; en ny konto/provider/transport må ikke parkeres bag en gammel læsning. Match kræver frisk faktisk observation og den indfangede native destination, både for standardrum og eksplicit NEXT. Track/episode kræver desuden samme URI; et playlistvalg beviser ikke playlist-medlemskab via et almindeligt track-svar. Manglende match afslutter ventetilstanden ærligt uden gentagelse af handlingen. Ændret ejer, navigation eller oprydning kan ikke genstarte den gamle hensigt, og ingen kilde-/tilbudsfrist forlænges.
- UNKNOWN-kvitteringen forbliver ukendt. En senere frisk observation på den indfangede native destination må igen eje den aktuelle visning uden afhængighed af et udløbet navnekatalog; dette gør hverken kvitteringen accepteret eller den brugte handling gyldig igen.
- TopBar beholder sit64px kontrolanker og symmetriske titel-/kontekstkolonner;980px må tekst krympe/trunkeres med bevaret tilgængelig label, så Svar ikke overlapper vejr/tid. Navigationens pil+title er ét touchmål og etableres før fejlbarligt domæneindhold.

Kandidatstatus: samlet funktionelt/visuelt review og serviceintegration under udførelse; ikke installeret eller fysisk accepteret.

<!-- NEXT explicit named-screen enrollment: same existing owners/anatomy, no new family. -->
Den eksisterende SetupFlow beholder formular, navnefelt, status og Button. Det native setupfelt bruger den fælles `.pv-form-field`-variant: mindst64px højde med kittets body-typografi og genbrugt feltstyling i `ui/library/library.css`. Varianten ændrer ikke almindelige inputfelter i Dialog og er ingen ny komponentfamilie.

Et link, der er dekoreret som Button, følger samme knapanatomi uden understregning. Skærmens read-only ListRow bevarer16px mellem label og værdi. Ved vellykket eksplicit skærmtilmelding bruger den eksisterende Button teksten “Åbn PodView” sammen med det eksisterende HA-administrationslink.

Transportens navngivne profilforløb er ikke-visuelt og giver ingen capabilities fra browserlagring. Normal HA-adgang bevares. Se enrollment-afsnittet i PODVIEW-CONTRACT.md; kilde-/kliktest er ikke renderet eller faktisk enhedsaccept.

## NEXT · kontostatus er ikke bekræftet rumoutput ·23 oktober2026

Den næste kildekandidat optager den eksplicitte serverstatus `account_observed` i eksisterende `podview.room-playback.v1`. Dette er kildekontrakt, ikke installeret78, fysisk lydbevis eller gennemført native integrations-/renderaccept. Den eksisterende PlayerView beholder cover, titel, kunstner og faktisk playing/paused-status i samme anatomi. Statusrollen siger “Afspiller · højttaler ikke bekræftet” eller “På pause · højttaler ikke bekræftet”; detaljen kvalificerer det som Kontostatus. Et konfigureret målnavn er læsekontekst, aldrig bevis for fysisk output.

`media-observation.accountObservationBound` kontrollerer konto, boot/rum, eksplicit playback-læseadgang, præcis konfigureret binding og målets ID. Den lukkede server-envelope har de eksisterende otte felter; dens lukkede native data har otte felter uden `room_proof_valid_until`. Friskhed, ejer-epoch og pollrækkefølge bevares. Resultatet er altid `readOnly:true`, `roomBound:false`; `roomObservationBound` og `roomObservationCurrent` bliver derfor ikke sande. Rå kontodata uden denne server-envelope optages ikke som rumbundet afspilning.

Kø, seek og rumbundne transport-/outputhandlinger får ingen myndighed fra kontostatus. Nedgradering fra bekræftet rumstatus rydder gamle køtilbud og musikkontrolbindinger. Udløbet kontostatus forsvinder efter sin faktiske læsefrist; den får ikke room-proof-branchens særskilte adgang til retained display. Uafhængigt tilbudt musikvalg eller valg af næste højttaler følger fortsat sine egne aktuelle capabilities og friske native offers. Ingen ny renderer, familie, ekstra statusflade eller klientudstedt tilladelse tilføjes.

## NEXT · områdebundne HA-lys og næste afspilning ·23 oktober2026

Dette afsnit beskriver den næste kildekandidat og erstatter de ældre generelle udsagn om read-only live-lys nedenfor **kun inden for det konkrete scoped-light-udbud**. Koden og de eksisterende registry-ejere er gennemgået; native integrations-CI og renderet Product Design-/Impeccable-review af denne kandidat afventer. Det er ikke installeret78 eller fysisk lys-/lydaccept.

Lys genbruger `WidgetHost`, `pv-light-widget` og de eksisterende Tile, ChoiceList, Button, Dialog, Toggle og Slider-roller. `ha-home-observation.js` optager kun lukkede `lightAreas`, `lightPlacement` og scoped `lights` med faktiske HA-område-/entitets-ID'er, samme kilde-epoch, binding og placeringsrevision. Den15sekunders kildefrist forlænges ikke i browseren. `home-model.scopedLightDevice` leverer den samme faktiske observation til præsentationen; `applyHome` optager kun `isOwnArea:true` i overblik. Hjemmets rail viser kun eget eksplicit bundne, friske område med matchende placering og katalog. Et rum navn er aldrig udledt fra lokalt eksempel eller “Hele hjemmet”.

Den eksisterende rumvælger viser katalogets faktiske navne/område-ID'er uden en ekstra Hele hjemmet-mulighed. `lightChoices(device, lightAreas)` markerer det faktisk observerede `lightScope.areaId`, ikke et ønsket `selectedAreaId`. Udløb eller ændret katalogidentitet bevarer læsbare navne uden aktivt valg. Et eksplicit andet rum læses gennem eksisterende `home({lightArea})` og erstatter kun `liveLightDetail`; eget overblik/rail, musik, output, timer og vejr ændres ikke. Et sent svar fra gammelt rum, binding, transport eller læsegeneration kan ikke optages. “Opdater lys” er en eksplicit læsehandling, aldrig en effektgentagelse.

Et komplet tomt område siger **Ingen lys i rummet**, ikke0 af0. Delvist ukendt status kvalificerer de bekræftede antal; ukendte lamper bliver ikke optalt som slukkede. Udløb/offline mærker kendt indhold sidst kendt. Rå lysstyrke0–255 kan vises som procent, men kun `supportsBrightness:true` giver en dæmperrolle; manglende værdi forbliver Niveau ukendt. En kontakts entitetsnavn eller en observeret lysstyrke giver ingen slider- eller effektmyndighed.

Åbning af kort, rum eller lampedialog sender ingen lyskommando. De passive Tile-/lampemodal-kontroller forbliver læsende for live-data. “Betjen lys”/“Betjen lampe” åbner den samme registrerede kontrol-Dialog og læser en frisk server-task. Kun faktisk tilbudte `turn_on`, `turn_off` og `brightness`-optioner kan bruges; brightness kræver understøttelse hos alle valgte entiteter. Eksakt område, binding, revision, kilde-epoch og entitetsmedlemskab samt aktuel transport, adgang og samtaleejer genkontrolleres før setup og send. Serverens opaque task/option-ID og udløb ejer én eksplicit handling. Pending bevarer observationen; accepted er en kvittering, ikke observeret lysændring. Ukendt udfald gentages ikke automatisk. Ingen scener, farver, ny familie eller lokal live-effekt-reducer indføres.

Den eksisterende tomme players outputkontrol kan vise **Næste afspilning: navn** efter et eksplicit, aktuelt højttalervalg. `SpeakerOutputView.nextDestinationLabel()` bruger præcis samme konto-/rum-/transport-/ejerbinding som det huskede setup-mål; teksten er intention til næste Play, ikke observeret output. Uden et aktuelt valg bruges eksisterende konfigureret højttaler/Musik-fallback. Under pending start eller aktiv afspilning ejer den faktiske/pending player fortsat outputrollen; det ønskede navn må ikke erstatte observeret output. At vælge et næste mål starter eller flytter ikke lyd. Samme eksisterende Button og ListRow anvendes.

## Kontobundne playlister ·23 oktober2026

Den eksisterende fane `top`/For dig kan bruge den faktisk tilbudte læsekilde `account_playlists`. Den beholder de samme tre musikkort og deres cover-, tekst- og kontrolroller. Overskriften er da “Dine playlister”; kilden er første side med højst20 ejede eller fulgte playlister, ikke en påstand om fuld bibliotekslæsning eller personlige anbefalinger. Uden denne capability bevares den ærlige Topsange-kilde. Kildeidentiteten indgår særskilt i cache, request og valg; fanens interne ID giver ingen kilde- eller afspilningsmyndighed.

Senere direkte brugerfeedback23 oktober afviser den løsrevne kildenote i nederste hjørne. Når der vises playlister, er det eksisterende statusfelt til venstre for “Andre forslag” derfor tomt; side-/antal-/ejerteknik vises ikke som en ekstra note. En faktisk tom kilde og en genindlæsningsfejl bruger fortsat feltets eksisterende feedbackrolle med nyttig kort tekst. Fejl har forrang, og ventetid beholder pladsen. Ingen ny overskriftsrække eller flytning af kort/knapper.

Native DTO `podconnect.user_playlists.v1` giver det faktiske playlistnavn og eventuelt det validerede Spotify-cover. “Playliste” er kun typebetegnelse, aldrig opfundet kunstner eller ejer. Manglende kandidatmyndighed viser læsbart indhold med de eksisterende deaktiverede Play-kontroller. Et senere valg bruger eksisterende setup-/confirm-ejer med nye opaque kilde-ID'er, samme konto/rum og den friske serverkontrols ejer-epoch. Ingen ekstra bekræftelsesmodal, AI-overførsel, ny kortfamilie eller opdigtet Daily Mix/daylist.

## Hjem-navigation · seneste direkte brugerbeslutning23 oktober

Brugeren har valgt Hjem med husikon til enhedens passive grundvisning. Den sekundære overbliksknap bruger Hjem, tilgængeligt navn Gå hjem og det fælles officielle Phosphor Regular house-ikon. Ikon24px, label17/24, trykhøjde48px,16px vandret padding og8px gap følger eksisterende TopBar-variant. Ro, Billedramme og Foto/image-square er afvist som navigation. Eksisterende #show-photo, photo/rest-IDs og aktiviteternes identitet ændres ikke; et tryk skifter visning, musik og timere fortsætter. Hele grundvisningen fører tilbage til Lige nu. Tidligere Foto-tekst nedenfor er historik, ikke gældende navngivning.

## Modal: fuldskærms-overlay og centrering · senere direkte brugerbeslutning23 oktober

En modal dækker hele viewporten med ét sammenhængende overlay og centreres vandret/lodret i hele viewporten. Den afgrænses ikke til venstre indholdskolonne. Dialogens indhold følger fortsat520px bredde (tilpasset faktisk viewport),32px padding og kittets tekst-/kontrolroller. Dette gælder alle eksisterende native modal-dialoger, herunder Skærm og enhed, højttalervalg og lampedetalje. Tidligere venstreafgrænset modalplacering/scrim er afvist og erstattet. Toast er en anden variant med sin egen eksisterende placeringsregel; den må ikke arve modalens overlay eller centrering.

## Tidligere Foto-navigation · afvist og erstattet23 oktober

Den eksisterende fototilstand hedder Foto i brugergrænsefladen. Overblikkets sekundære knap viser Foto med det fælles Phosphor Regular image-square-ikon og tilgængeligt navn Vis foto. Måneikonet er forbeholdt reel nat/søvn-semantik; Ro er ikke produktlabel. Senere brugerfeedback afviser også Billedramme som for langt i denne knap; Foto er den gældende korte tekst. Eksisterende #show-photo, photo/rest-tilstande, navigation og bevægelse bevares. Et tryk ændrer visningen; musik, timer og hjemmets aktiviteter fortsætter. Hele billedfladen fører tilbage til Lige nu.

## Indstillinger i Dialog ·23 oktober, visuel korrektion

Dialog følger520px bredde,32px padding og16px grundafstand. Titel28/34, indstillingstitler20/26, værdier17/24 og hjælp15/20. Settings-varianten af den eksisterende ListRow har tekst/hjælp til venstre og64px Toggle-betjening til højre. Settings-Toggle bruger neutral Tile-flade med tydelig valgt kant og Til/Fra; den arver ikke Chips' sorte valgflade eller primær Buttons hierarki. Read-only-rækker har label/værdi i to kolonner; højttalervælgerens ikon/titel/status-grid gælder dens knaprækker. Sekundær forbindelses-/buildinformation kan ligge i eksisterende native disclosure med24px chevron og64px trykflade. Disse er varianter af eksisterende ejere, ikke en separat indstillingskomponent.

## Obligatorisk visuelt UI-kit-review · direkte brugerbeslutning23 oktober2026

Gælder **hver gang** der ændres UI i PodView: komponenter, størrelser, tilstande, modaler, detaljesider og sammensætninger. Dette er en del af designsystemets kvalitets- og afleveringskontrakt, ikke en valgfri QA-aktivitet.

**Hovedregel:** Brug altid det eksisterende designsystem/UI-kit. Hvis det ikke dækker behovet, ret eller udvid den kanoniske kit-ejer og dens dokumenterede regler, så bibliotek og produkt deler løsningen. Ingen lokal engangsrettelse eller parallel styling. Brug altid UI-review via Product Design og Impeccable som del af leverancen; funktion/kliktest er kun én mindre del af den samlede kvalitetssikring. Reglen gælder også små ændringer og fejlrettelser.

- Brug Product Design og Impeccable til at gennemgå det faktisk renderede resultat mod det kanoniske UI-kit. Kontrollér hierarki, spacing, padding, højder, typografi, alignment, komponentvalg, farver/kontrast samt bevægelse og relevante tilstande i sammenhæng.
- Vurdér både bibliotek og produkt ved de relevante faktiske viewport-/komponentmål. Inspicér screenshots visuelt; DOM-mål understøtter vurderingen, men erstatter den ikke.
- Ret de samlede visuelle fund i de eksisterende kit-ejere og fælles tokens. Ingen lokal specialkomponent som genvej.
- Kliktest kontrollerer funktion og udføres som særskilt kontrol. Kliktest, komponentgate, syntaks og beståede tests er **aldrig tilstrækkeligt visuelt bevis** og må ikke alene lukke et UI-feedbackpunkt.
- Før et UI-punkt meldes færdigt: registrér faktisk bibliotek-/produktreference, inspiceret billedbevis, plugin-reviewets fund/udfald og konkrete rester i den aktuelle feedbackmatrix. Skeln mellem funktionelt kontrolleret, visuelt gennemgået og brugeraccepteret. Genåbn ved ny brugerfeedback.

## Feedback i Card og Hero ·23 oktober

Card/Hero kan have den eksisterende feedbackrolle som direkte `data-kit-slot=feedback`-barn:17/24 tekst, arvet kontrast og ingen egen kortflade. Timer reserverer48px i samme formular-/instrumentgrid, så afventning og ukendt udfald ikke flytter fladen under playerens topanker. Den samme statusnode flyttes til det aktuelle synlige timerkort eller udkast; den bliver ikke i et skjult gammelt kort. Ukendt udfald bevarer udkast/observeret timer og blokerer automatisk genafsendelse. Det er vedvarende feedback i den eksisterende flade, ikke en ny toast eller en fejlpanel-familie.

## Asynkront vejrråd i Hero ·23 oktober

Vejrrådet bruger Heroens eksisterende body-slot med tre reserverede tekstlinjer (72px). Før forespørgsel reserveres plads uden at påstå indlæsning. Når den faktiske POST er sendt og svaret endnu afventes, projekterer `LiveWeatherAdvice` sin interne `requesting`-tilstand til Heroens allerede eksisterende pending-rolle. Samme diskrete gradient og aria-busy bruges ved faktisk server-pending; ingen synlig loading-sætning. `requesting` er ikke en ny wire-status, receipt eller godkendt AI-tekst. Kun den projicerede pending-rolle har aria-busy. Gradientbevægelsen er afgrænset til otte gennemløb og er statisk ved reduceret bevægelse. Den færdige tekst toner hurtigt ind; Hero, prognose og betjening bevares. Passive AI-råd er højst120 tegn og skal bygge på den aktuelle kildebundne prognose. Bibliotekets forfattede tilstandsprøver er tydeligt adskilt fra faktisk modelgenerering; de beviser ikke providerforbindelsen.

NEXT-rettelsen af POST-ventetid ændrer kun eksisterende `LiveWeatherAdvice.sync` og `liveWeatherModel`: request-inflight starter ingen polling. Det eksisterende pollforløb følger fortsat faktisk server-pending med de samme kilde-/ejerbindinger, frister og budgetter; eksisterende afbrydelses-/recovery-læsning ændres ikke. Ready/fejl/utilgængelig, navigation, skjult fane, ændret kilde/transport og cleanup følger de eksisterende afbrydelsesværn. Ingen ny DOM-node, familie, wire-/admissionændring eller ekstra provideranmodning tilføjes. Dette er en særskilt arbejdende efterfølger til den uændrede7201-pakke; kilde-/enhedstests er ikke renderet review eller faktisk provideraccept.

Samme efterfølger binder standardernes native `setTimeout`/`clearTimeout` til `globalThis`, før de gemmes på LiveWeatherAdvice. Dermed bevares browserens krævede receiver under polling/oprydning; injicerede testtimere ændres ikke. Det retter den konkrete lokale Chrome Illegal invocation-fejl uden ny timer, deklaration eller API; en Green-årsag er ikke bevist.

## Hero-roller · direkte brugerfeedback23 oktober

Navigationen identificerer detaljen (fx Tesla). Heroens titel beskriver den aktuelle situation, hvor det giver mening (fx Bilen lader); en separat status må ikke gentage samme besked. Fakta beholder deres egne label/værdi-roller. Model og årgang hører som lille billedtekst under det relevante billede, ikke som konkurrerende titel øverst til højre. Vis kun metadata, som ejeren faktisk leverer; et bilbillede eller Model Y/2023 fra lokal fixture må ikke lække ind i passive live-observationer. Message-varianten ved manglende forbindelse bevarer sin eksisterende fælles anatomi.

## Button på mørk flade ·23 oktober

Eksisterende Hero/Card angiver `data-kit-tone=dark`. Button beholder samme primær/sekundær roller og mål, men bruger fladens semantiske kontrasttokens. På mørkt: primær lys med mørk tekst; sekundær mørkere neutral med lys tekst. På lyst: primær mørk med lys tekst; sekundær lys neutral med mørk tekst. Farver arves fra faktisk fladekontekst, aldrig fra domænenavn. Destruktiv rolle beholder sin særskilte semantik. Ingen ny knapfamilie.

## Large-fakta23 oktober kl.14.31

Højst fire faktaceller i2×2-grid. Ingen tredje række. En måler, der spænder over begge kolonner, bruger to celler og starter på en ny række. Når kortets faktisk tilbudte overblikshandling er synlig, også deaktiveret under pending, begrænses fakta til to celler på én række, så den faste handlingsfooter har fri plads. Den eksisterende ejer `applyResourceFactBudget` anvender budgettet efter den faktiske action-policy; domænestatus alene bestemmer det ikke. Kerneroller som batteri/rum/tændtantal gentages ikke i ekstra fakta. Der er24px mellem to faktarækker; ukendte værdier udfyldes ikke. Resterende oplysninger hører til detaljesiden. Kilderækker bevares ved størrelsesskift.

## Radio-valg23 oktober kl.14.18

Stationens Tile beholder hvid baggrund både valgt og ikke valgt. Valg kommunikeres af den fælles mørke kant og teksten “Valgt”; ingen ekstra baggrundsfarveændring. aria-pressed og faktisk valg-ID bevares.

## S/M/L samme kerne ·direkte korrektion23 oktober kl.14.03

Størrelse ændrer plads og mængde, ikke oplysningens grammatik. Verbal hovedstatus20/26 ved24/72, sekundær17/24 ved24/106 i alle tre størrelser. Robot viser fx “Ved basen” → “Batteri76%” som samme inline metadata i S/M/L. Large må tilføje andre kildebekræftede fakta fra170px; batteri/rum må ikke gentages som større faktablock. Domænernes ægte måleroller (vejrtemperatur, batteriprocent, nedtælling) bevarer deres definerede måletypografi. Ingen større verbal status alene fordi kortet er større.

## Direkte knapregel23 oktober kl.13.50

Detaljers handlingsknapper bruger generiske semantiske farver, ikke domænefarve. Primær/bekræftelse: mørk neutral med lys tekst. Sekundær/Annuller: lys neutral med mørk tekst. Destruktiv: fælles farefarve. Valgmarkering bevares med samme neutrale kontrast og kant. Handlingsnavne må ikke ellipses; brug læsbare fulde labels og ombrydning inden for den faste trykflade. Robot-overblikkets Pause/Fortsæt bruger eksisterende pause-/playikon.

## Kompakt introduktion i detalje ·23 oktober

Eksisterende Hero.message har en kompakt tæthed (`data-kit-density=compact`) til korte introduktioner foran valgmuligheder: minimum96px,16px padding,32px ikon,20/26 titel og17/24 brødtekst. Radio bruger denne tæthed, så fem stationer kan være synlige ved1280×720. Længere fejlbeskeder må vokse naturligt. Skjulte handlinger optager ingen plads. Dette ændrer ikke øvrige Hero.message-fladers standardhøjde.

## Direkte rettelser23 oktober kl.13.42

- Lys: den separate statuslinje bruger “Tændt”/“Slukket” med stort begyndelsesbogstav, også under “2 af4”. Dette erstatter tidligere argument om en sammenhængende sætning.
- S/M med tilbudt overblikshandling: primær og sekundær tekst bevarer24px venstreanker; begge slutter mindst16px før knappens128px zone. Pending må ikke gå ind under knappen. Ingen fuld kortbredde på absolut placerede tekstroller.
- Valgt højttaler: “Valgt”; andre kendte tilgængelige: “Klar”. Manglende tilgængelighed bevares ærligt.

## Direkte kontraktpræcisering23okt · Card S/M og Topbar

Layout er bindende på tværs af domæner og states. Card177px: indvendig24px; ikon32px ved(24,24); titel vedx72; hovedrolle ved(24,72),20/26semibold; undertekst ved(24,106),17/24regular. En utilgængelig tilstand bruger hovedankeret til sin ærlige status. Ingen domæneadapter bestemmer egen lodret placering. Domæneaccent gælder kun hovedrollen; undertekst er neutral. Ekstra fakta har separat zone; de må ikke skubbe læseklyngen. Large bruger samme roller men sin særskilte læse-/faktazone; Vejr bevarer målerollen og en topforankret klynge. Musik med cover er den registrerede medievariant.

Topbar-titelknappen er indholdsafgrænset med16px indvendig luft. Ur åbner den eksisterende Dialog-opskrift Skærm og enhed. Ro er en særskilt eksisterende Button med måneikon/label, ikke detaljens Tilbage. Ingen hardwarekontrol eller Wi-Fi-fakta uden kildeejet kapabilitet.

Statuslinjer begynder med stort på tværs af størrelser: “Tændt”, “Slukket” og “Ved basen”, også når en separat hovedværdi viser “2 af 4”. Handlingslabels begynder med stort, fx “Tænd”.

# PodView · det eneste komponentbibliotek

## Størrelser og detaljer · direkte brugerbeslutning 22. oktober 2026

Den samlede Small-retning er godkendt efter renderet kontaktark. Samme princip gælder Medium, Large og alle detaljesider: tydelig identitet, vigtigste faktiske værdi/status først og indhold tilpasset pladsen. Alle bruger de eksisterende kitdele, registrerede ejere og samme tokens; størrelse er en variant, ikke en ny renderer. Bibliotek og produkt kalder samme ejere. Ingen særskilte skærmrettelser eller parallelle kit.

- Small bruger korte visuelle domænenavne: Robot, Vejr, Musik, Lys, Tesla, Radio, Timer. Det fulde ressourcekildenavn forbliver tilgængeligt; det skal ikke klemmes til »Robotst…«. Denne beslutning erstatter den ældre Small-titelregel nedenfor.
- Ikon/header har reserveret rolle; værdi/status og eventuelle metadata ligger separat. Musik beholder faktisk sang og kunstner i to linjer. Vejr viser temperatur og tilstand. Robot viser status; batteri er ikke hovedværdi. Lys og Tesla viser kun faktisk kendte værdier. Ukendt, forældet og manglende forbindelse må aldrig ligne en frisk måling.
- **Typografi og farve, præciseret 22. oktober:** Roligere fælles størrelser og vægte pr. semantisk tekstrolle. Verbal status er ikke et stort måltal. Domænets eksisterende identitetsfarve må fremhæve hovedværdi/status via samme kit-token; sekundær tekst og metadata er neutrale. Farve må aldrig medføre en anden størrelse, vægt eller placering. Mørk Timer bevares. Groks tal og forslag er reviewinput, ikke bindende beslutninger.
- Medium/Large bevarer samme identitet og prioriteter med nyttige kendte metadata/prognose. Detaljer bruger samme TopBar, Hero, Tile, Chip, Button, Slider, ListRow og Dialog med domænets egne nødvendige roller. Ingen universel Hero-højde eller opfundne kapabiliteter følger af sammenhængen.

### Direkte præciseringer · 23. oktober 2026

- **Card unavailable:** statusrollen er ens i S/M og domæner:17/24 vægt400, neutral `--pv-ink-2`, venstrestillet ved hovedankeret (24,72) i177px kortet. Dette erstatter den tidligere nederste statuszone. Aktiv status-/målingstypografi genbruges ikke i denne tilstand. Ikke forbundet siger det samme i Robot, Lys og Tesla.
- **Radio ved bred timer:** TimerView ejer, om timeren bruger baren. Radio bruger automatisk M dér og S uden bred timer; eksisterende Card mediestørrelse genbruges. Eksplicitte biblioteksstørrelser har forrang. Dette erstatter ældre Radio-altid-S/faste-størrelser-reglen for netop Radio; øvrige widgets beholder deres mål.
- **Hero variant `message`:** samme kanoniske layout i Radio-intro og enheders/Vejrs forbindelsesvisning. Ejeren binder eksisterende noder til `data-kit-slot=icon|copy|title|body`; kittet bestemmer layoutet.48px ikon,32px padding,16px kolonneafstand,8px mellem hovedtekst28/34 vægt600 og hjælpetekst17/24 vægt400. Gruppen centreres i mindst200px; lang tekst må øge højden. Ingen redundant domænelabel. Identitetsfarve og faktisk årsagstekst bevares. Skjulte Heroes forbliver skjult; normal gendannelse fjerner message-varianten og genbruger noderne.
- **TopBar/Svar:** den senere slanke opskrift har48px synlig pille og tilsvarende faktisk trykflade. Hover/tryk ejer hele pillen. Tastaturens focus-visible bevares.
- **Detaljeprognose:** fast timecelle med tid15/20, ikon32, temperatur20/26 semibold, regn/vind15/20 dæmpet. Vindlabel og retning står samlet på én linje; kendt fuld beskrivelse bevares ved afkortning. Dagsrækker følger faste dato/ikon/lav/bar/høj-kolonner. Kilde er15/20 dæmpet. Kun faktisk anbefaling bruger `--pv-t-advice`17/24 semibold; ikke vilkårlig sidste tekstlinje. VejrL-overblikkets godkendte opskrift ændres ikke.
- Musik og Radio beholder samme varme neutrale flade; ingen ny fast identitetsfarve er vedtaget.

### Card-kontrakt for S/M/L

Størrelserne bruger én Card-anatomi med reserveret header, hovedindhold, sekundær kontekst og eventuel handling. Padding er 24, headerikon 32, headerlabel 20/26 vægt 600. M verbal status er 20/26 vægt 600; L verbal status er 28/34 vægt 600. Faktiske numeriske målinger kan bruge 28/34 i M og 40/44 i L; vejrets godkendte L-temperatur beholder 64/64. Disse er tekstroller, ikke en automatisk forstørrelse af alle ord. Kunstner/tilstand er 17/24 vægt 400, metadata 15/20 vægt 400. Godkendt Small-anatomi bevares.

- Hovedstatus kan bruge eksisterende domæneaccent; headers er neutrale, sekundær tekst og metadata neutrale. Ingen logoafledt neonflade eller opacity på kendt artwork.
- Mediekortets titel, kunstner og afspilningstilstand er én venstrestillet gruppe. M artwork er 96; L 160. Afspilningslinjen er læsende og bruger samme faktiske position/varighed som playeren. Ingen ny seek-handling.
- Device-kortets nuværende status er primær. M Robot har én eventuel aktuel Pause/Fortsæt i en reserveret 128×64-zone. L viser højst rum, batteri og faktisk kildeleveret fremdrift. Lys bruger faktiske tændte lampers kendte lysstyrke som læsende ListRows; M højst to. Tesla viser kendt batteri, én status og kildebundne fakta; ingen gentaget status i løs bundtekst.
- Tom Musik/Radio/Timer bruger samme header- og indgangsrolle. Ingen ekstra navigationschevron, opdigtet historik eller pladsfyld. Timer beholder mørk flade.

### Delt tilstandskontrakt

Ready viser faktiske oplysninger. Empty er en ærlig indgang uden opdigtet værdi. Unknown viser Ukendt/— og ingen ny kommando. Pending bevarer indhold og kun den allerede tilbudte handling afventer. Error forklarer faktisk fejl/recovery. Offline bevarer læsbar navigation og kendt indhold uden fjernkommando. Stale mærker sidst kendt information og må ikke vise frisk fremdrift. Samme rolle, dataidentitet og ydre mål bevares i S/M/L; kun størrelsens informationsbudget varierer. N/A er korrekt for ikke-understøttede domænetilstande. Live Lys, DR-radio og Tesla er fortsat TBD; bibliotekseksempler giver ikke livekapabilitet.

Bevis: [Small, alle syv](qa-ui21/SMALL-ALL-SEVEN.png). Medium/Large er kontrolleret i [M](qa-ui21/MEDIUM-COLOUR.png) og [L](qa-ui21/LARGE-COLOUR.png), detaljer i [otte sider](qa-ui21/DETAILS-ALL-EIGHT.png). Renderkontrol er ikke fysisk accept eller en påstand om færdig installation.

## Tværgående sammenhæng · v42 · 22. oktober 2026

Kvaliteten vurderes løbende på tværs af widgets, detaljer, bibliotek og faktiske klikforløb: fælles topanker, typografiske roller, ikonvægt, flader, spacing, handlingsplacering og tilstandsskift. En isoleret pæn skærm er ikke accept. Ændringer udføres hos den eksisterende ejer og kontrolleres i dens forbrugere; brugerens direkte beslutninger har forrang for eksterne reviews.

- Card M med cover bruger cover/titel/kunstner/status; de generiske faktarækker må ikke lægges oven i denne anatomi. Card L kan vise kildebundne ekstra fakta. Allerede synlig kunstner, stationsnavn og lysantal gentages ikke som endnu en måling; L-rengøringsform kan bruge to linjer i sin eksisterende faktarolle. Kunstneren er body, underordnet titel. S-titler afkortes på én linje frem for at bryde danske ord; små musik-/radiokort har ingen ekstra dekorativ navigationsrække.
- Robot M viser status som hovedværdi og faktisk batteri/rum som metadata. Det er ikke et lille telemetri-dashboard. Detaljens inaktive areal/varighed mærkes »Senest« via samme formatter i lokal og live ejer. Pending knyttes til den faktisk sendte option; andre kommandoer kan være disabled uden at foregive at være den afventende handling.
- Lampens valgte objekt viser sin tilstand (Tændt/Slukket), mens rum/hjem bruger tællinger. Dialogens handling hedder Tænd/Sluk. Egen accepteret ændring bevarer den åbne dialog, fokus og kladde; ændret ekstern binding/revision, scope eller adgang lukker den efter de eksisterende sikkerhedsregler.
- Vejrets Hero bruger samme indryks- og tekstroller som ressource-Hero. Kildebundne gamle oplysninger mærkes »Sidst kendte vejr«; et faktisk tomt succesopslag er fortsat forskelligt fra en kendt forbindelsesfejl.
- Den aktive Timer beholder mørk dial og sine eksisterende kontroller. På pause, færdig eller forældet status står inden i dialens eksisterende tekstrolle, så tallet ikke kan læses som et almindeligt kørende ur. Normal Timer-titel gentages ikke dér.
- Radio beholder den statiske introduktion; valg vises på station og i den eksisterende player. Ingen ekstra »Se afspiller«-vej til en tom nummerkø for direkte radio. Musik bevarer sin rigtige kø. En tom player-detalje genbruger samme ærlige tilstandstekst som den faste player, ikke en opdigtet bekræftelse af tom afspilning.

Render- og flowbeviser samt afgrænsninger: [v42 review](qa-v42/REVIEW.md). Ingen ny komponentfamilie, nye live-kapabiliteter eller AI-testkald følger af dette kvalitetsløft.

## Afgrænset v39-forbedring · 21. oktober 2026

Groks forslag bruges selektivt efter de direkte brugerbeslutninger nedenfor. Vejrets tomme Hero lader tekstrollen spænde hele det eksisterende grid, når ikonrollen er skjult; kendt vejr bevarer ikon/tekst og timeprognose. Ingen fast 810px tekstbredde, universel 264px Hero eller opdigtet vejrejer-fejltilstand.

De eksisterende interaktive roller Svar, outputvælger, titel/kunstner og positions-slider bruger `--pv-hit` (64px). Svar bevarer sin synlige 48px pill i den større native trykflade. Titel og kunstner deler den eksisterende knap; kunstneren bliver ikke en ny handling. Playerens faste ydre geometri bevares; separate kontrolrækker får deres egne ikke-overlappende touchområder, og det eksisterende kvadratiske billedområde tilpasser sig pladsen. Andre forslag bevarer sit eksisterende 64px mål.

Manglende forbindelse bruger »Ikke forbundet«; hjælpesætningen forklarer kun opsætning, når den faktisk mangler. Offline med kendt indhold og en ikke-understøttet radiofunktion beskrives særskilt. Tesla-kortets overflødige dekorative chevron er fjernet; hele den eksisterende knap ejer fortsat navigation. Ingen nye kommandoer, komponentfamilier, interaktionsgestus eller providerrettigheder følger af rettelserne.

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
| Musikforslag | `MusicResults` i `dist/music-results.js` | Den samme `button.result` med billede, tekst, feedback og play. Fire faner: Stemning, Humør, For dig, Senest. Live og lokale data bruger den samme instans. |
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

23. oktober · genopretning i eksisterende betjening: Højttalerlistens udløb fjerner handlingsadgangen, men bevarer de kendte rækker deaktiveret. Aktuelt output fra en udløbet læsning betegnes “Sidst kendte output”; et valg til næste afspilning er fortsat kun brugerens hensigt. Den eksisterende generiske Button “Opdater liste” genhenter én gang pr. eksplicit klik, bevarer rækker under ventetid og muliggør nyt forsøg efter læsefejl. Ingen automatisk polling, udløbet kommando eller udvidelse af en højttalers serverpolitik. ListRowens sekundære tekst forklarer faktisk ukendt/ikke tilgængelig status eller manglende adgang til at vælge målet; “Fundet” er ikke bevis for betjeningsadgang.

RobotControlPanel bevarer status, pleje og eventuelle eksisterende kontroller, mens LiveControlView henter en aktuel task. Kun det eksplicitte `loading`-flag viser “Henter aktuel betjening…” i panelets eksisterende metadata-statusrolle. Manglende task alene betyder ikke loading, og en fejl må ikke blive stående som ventetid. Ingen kontroller opfindes før ejerens aktuelle tilbud.

Rum-Tiles i RobotControlPanel fordeles efter deres faktiske beholderbredde med kittets `--pv-tile-compact-min:200px`. Dermed bruger den 520px brede dialog to kolonner, mens en bred detalje fortsat kan vise tre. Viewportens bredde alene må ikke presse tre afklippede rumnavne ind i en smal dialog. Lukning fjerner både dialogens indhold og ejerens panelreference, så genåbning altid har et monteret status-/ventefelt.

`musicSourcePage` er en DOM-fri støttefunktion til den eksisterende LiveMusicCatalogueView. Topsange/Senest deduplikerer præcis URI og fordeler kendte, præcise kunstnerlabels mellem tre kort med stabil kildeorden som tie-break. Både kort og valgkvittering bruger de samme oprindelige kildeindeks. Fornyelse bevarer de allerede viste kort; kontoplaylister og serverens Stemning/Humør beholder deres kildes rækkefølge. Dette er ikke en indlært smagsprofil eller dokumenteret tids-/kontekstanbefaling.

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
| **7. Musikvalg Q061–070** · MusicResults/assetmapping | Fire aftalte faner; Stemning har tre faktiske playlists; Humør har egen playlisttype; For dig/Senest har tre tracks fra de eksisterende kilder; tilbage bevarer kort/fane; reload starter Stemning; mål AI-valgenes tid og relevans; stemningskunst matcher og har proveniens; trackcover er faktisk eller ærligt fallback; voice/touch vælger samme option trods forsinkede svar. | 12–18 |
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

The existing PlayerView compact and detail anatomy includes an optional native read-only progress rail. It displays admitted `progress_ms` with the same item’s `duration_ms`. The direct24October feedback supersedes the former no-interpolation rule: fresh playing observations allow a bounded once-per-second display calculation from the original observation timestamp until its original expiry. This creates no seek authority, draggable thumb, network call or provider truth. Missing/invalid position hides and clears the rail; expired retained display is labelled last known. No new component family or simulated integration is introduced.

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
- Bibliotekets bevægelseskontrol binder direkte til den eksisterende `pv-widget-host[data-motion]` og annullerer ejerens igangværende bevægelse, når præferencen skifter. Den er et inspektionsværktøj, ikke en produktindstilling. Gentagne uændrede valg genstarter ingen bevægelse; normal tilstand gendanner de samme hændelsesbårne cues.
- Bilens ladeopdatering bruger samme eksisterende120ms opacity-kvittering på batteriets bladnode i overblik og detalje. Tallet og meteret får straks den faktisk observerede værdi; ingen optælling eller simuleret ladning. Kun en nyere, frisk observation i aktuelt læsescope kan udløse kvitteringen. Første visning, genåbning, uændrede værdier og genetableret forbindelse er statiske; skjult, stale/offline, skiftet ejer og reduceret bevægelse stopper eller undertrykker den. Ingen konstant ladeanimation.
- Bilens kendte Hero har ingen løs dekorativ bil-ikonblok under målingerne. Faktisk artwork beholder illustrationsrollen; forbindelses-Heroen beholder sit fælles message-ikon. Manglende bilbillede udfyldes ikke med opdigtet artwork eller ekstra metadata.
- Lokalt sangvalg bevarer aktuel lydstyrke og valgt output gennem pending og kvittering. Startværdien35% gælder initialiseringen; en senere kvittering må ikke rulle brugerens nyere lydstyrke tilbage. Live afspilning følger fortsat den aktuelle ejerobservation.
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
| Dialog/Toast `.pv-dialog`, `.pv-toast` | Dialog520 bred/padding32; fuldt viewport-overlay og centrering. Toast64h, nederst venstre, højst én | Eksisterende native dialoger/showFeedback/TimerNotice |
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

StepGuides eksisterende primære Næste trin-Button bruger den semantiske kit-variant, så tekstkontrasten bevares også ved hover. Sammenligningsknapper følger64px-reglen uden en ældre48px-override. En faktisk afsluttet lokal trinopgave vises i samme felt som “Alle trin er gennemgået” og “Afsluttet”; afslutningsknappen er deaktiveret, mens indhold, kilder og noder bevares ved genåbning. Dette er kvittering for den lokale opgave, ikke bevis for en ekstern handling. Live- og historiske svar følger fortsat deres eksisterende read-only-/ejerkontrakt.

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

En ny eksplicit og gyldig køhandling er en ny hændelse, også når fejlteksten bliver den samme. `LiveQueueView` nulstiller kun sin egen feedbackkilde ved starten af den validerede handling eller en udtrykkelig kølæsning med feedback. Redraw, passive reads og genbrug af en brugt handling nulstiller intet. Ukendt udfald gentages ikke automatisk; kendt sang og kø bevares.

Når samtalen bliver inaktiv, toner samme statusflade ud over 120 ms i både Ro og aktiv visning. Den bliver straks inert og skjult for hjælpeteknologier, mens den oprindelige Svar-knap beholder klik- og fokusansvaret under udgangen. Gentagne inaktive opdateringer starter ikke udgangen igen; efter afslutning er status skjult og animationsejeren frigivet.


## Inaktiv Timer ved Radio · direkte brugerbeslutning21. oktober2026

I overblikket beholder Vejr sin store venstre plads og Robot sin eksisterende plads øverst til højre. Under Robot danner Lys/Tesla og Radio/Timer en2×2-gruppe af ens S-fliser. Find musik beholder sin større venstre plads under Vejr. Den inaktive Timer står derfor ved siden af Radio i tredje fælles gridrække, uden en ekstra løs fjerde række. Når en timer er aktiv, bevares den særskilt godkendte brede timer øverst. Musik og Radio bruger fortsat neutral base med indholdsfarver; ingen ekstra domænefarve.


## Timerens inaktive vægt · senere brugerbeslutning21. oktober2026

Den inaktive S-Timer er en rolig variant: `--pv-timer-idle-surface` er et semantisk alias til den eksisterende varme koksgrå `--pv-ink-2`. Hvidt ikon og `--pv-on-dark`-tekst bevares. Aktiv bred timer, timerdetalje og Ro bruger fortsat `--pv-dark` som tydelig aktiv vægt. Denne senere beslutning præciserer den tidligere formulering om altid samme mørke timerflade; anatomi og grid ændres ikke.

### Player · første læsning, tom, fejl og radio · 21. oktober 2026

`PlayerView` ejer fortsat både den kendte afspiller og `#player-empty`. Første læsning og fejl bruger samme rumrække, en reserveret kvadratisk artworkplads med den eksisterende musiknode-fallback, præcis status og den eksisterende discovery-/kontovalgshandling, når den faktisk er tilgængelig. Ingen opdigtet sang, position, afspilningsknap eller retry-autoritet. Kendt, fortsat kildebundet indhold bevares gennem læsefejl; usikker position markeres som sidst kendt, og fejlet status navngives. Ro viser fejlen i sin kompakte anatomi i stedet for en almindelig tomtilstand. Lokal radios manglende lyd angives ved stationens metadata og i det tilgængelige navn, uden en ekstra konkurrerende status over rumrækken.

**Aktuel native betjening ·25 oktober:** En afvist eller ugyldig passiv kontrol-læsning for fortsat korrektbundet afspilning forklares i den eksisterende reserverede player-/detaljestatus, også efter navigation; en kort toast er ikke tilstrækkelig. Den erstatter ikke sang, position eller kilde og bruger ingen selection-overlay. Valgt indholds pending/UNKNOWN-feedback har prioritet. Kun frisk gyldig kontrol-læsning for samme aktuelle kontekst rydder læsefejlen; ingen force-enable, samme-poll-retry eller automatisk effekt.

Målt volumen vises absolut0..100 uafhængigt af den aktuelle kommandogrænse. En kendt100%-måling med tilbudt0..35 må tillade en eksplicit sænkning til35 eller mute0, uden at målingen automatisk omskrives eller sendes. Frisk binding, aktuelt ubrugt tilbud og det præcise autoriserede inputinterval gælder stadig; ukendt/udløbet/pending/spent/UNKNOWN er blokeret. Mute kræver faktisk tilbudt0; en husket100 må ikke gendannes under max35.

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
| Lys | Faktiske område-/entitetsnavne, on/off/unknown/unavailable, rå lysstyrke0–255 og eksplicit `supportsBrightness`. | NEXT-kilden øverst beskriver lukket områdebinding og særskilt frisk server-task til tilbudt tænd/sluk/dæmpning. Passiv observation og lampedialog er fortsat læsende; lokale fixturehandlinger giver ingen live-adgang. Ingen scener/farver. Afventer kandidatens native CI/render; ikke installeret78. |
| Tesla | Batteri, rækkevidde, låsestatus, ladestatus/effekt/sluttid, klimastatus og kabinetemperatur. Ingen optaget model/årgang, bagagerum eller sædevarme. | Live-observation har `actions: []`. Kun lokal fixture har klima, måltemperatur og bekræftet låsning. Ladegrænse er fjernet fra UI; bagagerum afventer faktisk state og tilbudt handling hos samme ejer. |

Den ensartede ikke-tilsluttede Robot/Lys/Tesla-Hero er bevaret efter brugerens positive tilbagemelding. Robotopsætningens hjælpesætning vises kun i den konkrete præsentationsplaceholder; ukendt, fejl og sidst kendt tilstand beholder deres egen betydning. En historiksektion uden faktiske hændelser skjules sammen med sin overskrift. De samme timeline-noder bevares og vises igen ved reelle hændelser; tomme seneste valg giver heller ingen fyldsektion.

### Fælles indholdsrækker og vejrets Hero ·21okt2026

Indholdstunge detaljekort/-tiles bruger den eksisterende 3-kolonne-komposition (`--pv-detail-columns-content:3`), som Radio/Find musik. Det eksisterende 4-kolonne-grid bevares til små toggle-tiles; ingen global gridændring. Vejr følger samme Detail-template med 16px sideindryk: kun eksisterende current-Hero er vejrtonet, med temperatur, forhold, interval/vind og kildebunden rådgivning i naturlige tekstroller. Timer/dage forbliver de samme retained forecast-noder, og tomt/stale vejr bevarer ærlig kilde/status.

Robot-detaljen bruger den eksisterende `pv-vacuum-widget` som Hero: aktuel status er primær, mens kendt batteri, rengjort areal og varighed er metadata. `RobotControlPanel` beholder præcis ejerens tilbudte optioner og kontrollen af opgave, udløb, tilstand og forbindelse. Én Start-knap i Heroens eksisterende handlingsrække er knyttet til den samme rumformular med native `form`-attribut; den bliver først aktiv efter rumvalg. Rum er eksisterende robotfarvede Tiles, gentagelser er Chips, og observerede plejeværdier bruger læsbare ListRows uden nye kommandoer. `LocalRobotView` viser den fælles metadata “Eksempel” og tilbyder kun handlinger for sin aktuelle eksempeltilstand; den opdaterer udelukkende de lokale eksempeldata. Ingen transport, HA-beføjelse eller fysisk rengøring følger af eksempelknapperne. Tom/ukendt/fejl bevarer den eksisterende ærlige Hero og forklaring.


### Lys: samme lampe-Tile og Dialog lokalt og med HA-observationer · 21. oktober 2026

Den eksisterende `WidgetHost.renderLightAdjustments` normaliserer kun optagne navne, tænd/sluk/ukendt og lysstyrke til samme retained Tile. Tre kolonner med ens222px højde bruges, når bredden tillader det; smalle flader bruger to eller én kolonne. Rumvalg ligger efter Hero og bruger64px Chips. Komplette, aktuelle optalte lys giver Hero-værdien “2 af4 tændt” i hero64; tom/ukendt/fejl bevarer den godkendte kompakte forklaring, og stale antal bliver aldrig til en aktuel måling.

Hver kendt lampes eksisterende navneknap er navigation til én retained native Dialog, dekoreret med `applyKitDialog`; den skifter ikke lampen ved åbning. Dialogen viser faktisk navn, tilstand og kendt lysstyrke. Lokal Toggle og Slider sender kun med aktuelt session/task/revision, lampens stabile ID og samme valgte scope. Optagne HA-lys kan åbnes og læses; de passive kontroller i denne lampedialog forbliver read-only. NEXT-udvidelsen øverst bruger en særskilt eksplicit knap til den eksisterende task-bundne kontrol-Dialog, aldrig direkte effekt ved åbning. Manglende lysstyrke er “Niveau ukendt”; den bliver aldrig til0. Ingen farve-/temperaturdialog eller scenechips tilføjes uden felter og en aktuel ejer.

Skift af session/opgave/revision/rum, fjernet lampe, ukendt lampetilstand eller forbindelsesskift lukker eller afskærer den gamle binding. Luk/Escape returnerer fokus til den samme synlige navneknap; en fjernet knap falder tilbage til den eksisterende overskrift. En forsinket close-hændelse kan ikke rydde en genåbnet binding. Samme Dialog, Tile, Button, Toggle og Slider-ejere gælder bibliotek og produkt; ingen ny familie eller HA-kommandomyndighed.

Færdigt visuelt svar følger den eksisterende `AnswerAutoReturn`: 30 sekunder efter både tale og visuelt indhold er afsluttet → Lige nu; derefter den eksisterende 3 minutters inaktivitet til Ro. Berøring, ny tale, modal, holdt peger og åbne detaljer følger ejerens afbrydelsesværn. Musik, timer og svarhistorik bevares.


### v40 · delte tilstandsrettelser, 21. oktober 2026

TopBar afkorter lange titler før den faste Svar-pille med mindst24px mellemrum på desktop. Variable Button/Chip-labels bruger én linje med ellipsis; fuldt tilgængeligt navn bevares. Musikcovers og titler dæmpes aldrig ved manglende transportmyndighed; kun kommandomålet deaktiveres. Radio forbliver Card S, også med aktiv timer, og afviste/ikke tilbudte stationshandlinger blokeres både nativt og i handleren.

Direkte brugerkorrektion: Den eksisterende Toast-portal beholder sin tidligere naturlige højde, ombrudte tekst og Retry med normal luft i flowet. Ingen tvungen64px række eller afkortning. Den reserverer ingen layoutplads, udløber efter6sekunder og lukkes ved tryk udenfor uden at opsluge trykket. Kun Retry tager pointer-events. Vedvarende forbindelsesforklaring står i det relevante Hero. Kun kendt årsag giver setup-/utilgængelig-/adgangstekst; et tomt vellykket opslag bliver ikke til opdigtet adgangsfejl.

Lokale færdige svar-fixturer bruger samme returregel som produktet: bundet svarrevision, færdigt visuelt indhold og afsluttet tale, dernæst30sekunder uden berøring til Lige nu og en frisk eksisterende3minuttersfrist til Ro. Fixturen simulerer kun sin egen afgrænsede taleafslutning; ingen betalt AI eller livekvote bruges.


v41 topanker: Den eksisterende desktop-komposition bruger samme --pv-topbar-content-gap for både fyldt .player.pv-card og #player-empty i alle tomme/fejl-/offline-tilstande. Begge starter ved y96, mens venstre scrollkant/headerdivider fortsat er y80. Dette er en præcisering af den fælles kompositionsregel, ingen ny variant eller mobil-/Ro-ændring.

### Musikfanen For dig · brugerbeslutning 23. oktober 2026

Synlige faner er Stemning, Humør, For dig og Senest. For dig bevarer collection-ID `top`, kontobinding, cache og handlingskontrakt. Den nuværende topsangskilde beskrives som **Dine topsange** i eksisterende metadata. Personlige Spotify-mixes, daylist og Discover Weekly må ikke påstås tilsluttet eller erstattes med omdøbte søgeresultater; lokale bibliotekskort forbliver eksempeldata. En fremtidig kilde kræver faktisk ejerudbudt indhold og myndighed.
